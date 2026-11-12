import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authentificationTest, creerServiceComptes, stockageMemoire } from '../server/comptes';
import { demarrerServeur } from '../server/serveur';
import { SOLDE_DEPART, type AnnonceCasino } from '../shared/casino';
import { autoValide, gainCouronne, multiplicateurCouronne, RTP_COURONNE, tempsDuMultiplicateur, tirerVol, X_MAX_COURONNE, type VueCouronne } from '../shared/couronne';

describe('Le Vol de la Couronne : les règles', () => {
  it('tire le point de la pie : 97 % / x de chances de dépasser ×x', () => {
    expect(tirerVol(0)).toBe(1); // 0,97 : la pie frappe dès l'envol
    expect(tirerVol(0.5)).toBe(1.94);
    expect(tirerVol(0.99)).toBe(97);
    expect(tirerVol(1 - 1e-9)).toBe(X_MAX_COURONNE);
    // Sur une grille fine de u, la part des envols qui dépassent x vaut 0,97 / x.
    const N = 200_000;
    const points = Array.from({ length: N }, (_, i) => tirerVol((i + 0.5) / N));
    for (const x of [1.01, 1.5, 2, 3, 10, 100]) {
      const part = points.filter((p) => p >= x).length / N;
      expect(part).toBeCloseTo(RTP_COURONNE / x, 3);
    }
    // Sous ×1,01 (environ 4 fois sur 100), la pie frappe dès l'envol.
    expect(points.filter((p) => p === 1).length / N).toBeCloseTo(1 - RTP_COURONNE / 1.01, 3);
  });

  it('fait monter le multiplicateur et calcule les gains au dollar près', () => {
    expect(multiplicateurCouronne(0)).toBe(1);
    expect(multiplicateurCouronne(tempsDuMultiplicateur(2))).toBe(2);
    expect(multiplicateurCouronne(tempsDuMultiplicateur(10))).toBe(10);
    expect(tempsDuMultiplicateur(2) / 1000).toBeCloseTo(7.7, 1);
    expect(multiplicateurCouronne(1e9)).toBe(X_MAX_COURONNE);
    expect(gainCouronne(10_000, 2.53)).toBe(25_300);
    expect(gainCouronne(25_000, 1.37)).toBe(34_250);
    expect(autoValide(1.01)).toBe(true);
    expect(autoValide(1)).toBe(false);
    expect(autoValide(1.005)).toBe(false);
    expect(autoValide(10_001)).toBe(false);
  });
});

// ---------- Des manches en direct ----------

const identites = {
  'jeton-a': { uid: 'uid-a', nom: 'Lucas', email: 'a@gmail.com' },
  'jeton-b': { uid: 'uid-b', nom: 'Léa', email: 'b@gmail.com' },
  'jeton-n': { uid: 'uid-n', nom: 'Nina', email: 'n@gmail.com' },
};
const stockage = stockageMemoire();
const service = creerServiceComptes({ configWeb: { apiKey: 'cle', authDomain: 'test.firebaseapp.com', projectId: 'test' }, authentification: authentificationTest(identites), stockage });
let serveur: Awaited<ReturnType<typeof demarrerServeur>>;
/** Le point de la pie des prochains envols. */
let pointImpose: number | undefined = 3;
// Montée rapide pour les tests : ×2 en 173 ms, ×3 en 275 ms, ×10 000 en 2,3 s.
const K = 0.004;
const connecter = () => io(`http://localhost:${serveur.port}`, { transports: ['websocket'], forceNew: true });
function emettre(s: Socket, evt: string, data?: unknown): Promise<any> {
  return new Promise((ok) => s.emit(evt, data, ok));
}
/** La première vue de la couronne qui remplit la condition. */
function attendre(s: Socket, cond: (v: VueCouronne) => boolean, ms = 8000): Promise<VueCouronne> {
  return new Promise((ok, ko) => {
    const t = setTimeout(() => ko(new Error('vue attendue jamais reçue')), ms);
    const f = (v: VueCouronne) => {
      if (!cond(v)) return;
      clearTimeout(t);
      s.off('casino_cv', f);
      ok(v);
    };
    s.on('casino_cv', f);
  });
}
const pause = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

beforeAll(async () => {
  for (const id of Object.values(identites)) await service.preparer(id.uid, id.nom);
  await service.donnerBadgeCreateur('uid-a');
  await service.donnerBadgeCreateur('uid-b');
  serveur = await demarrerServeur({
    port: 0,
    servirClient: false,
    comptes: service,
    casino: { delaiEcriture: 30, delaisCouronne: { mises: 400, pause: 150, pas: 10 }, kCouronne: K, tirageCouronne: () => pointImpose },
  });
});
afterAll(async () => {
  await serveur.fermer();
});

describe('Le Vol de la Couronne en direct', () => {
  it('reste introuvable sans badge Créateur', async () => {
    const n = connecter();
    await emettre(n, 'identifier', { jeton: 'jeton-n' });
    for (const evt of ['casino_cv_entrer', 'casino_cv_miser', 'casino_cv_annuler', 'casino_cv_recuperer']) expect((await emettre(n, evt, { emplacement: 0, mise: 1000 })).erreur).toBe('Introuvable.');
    n.close();
  });

  it('prend les mises, paie à la récupération (à la main ou automatique) et laisse la pie emporter le reste', async () => {
    const a = connecter();
    const b = connecter();
    await emettre(a, 'identifier', { jeton: 'jeton-a' });
    await emettre(b, 'identifier', { jeton: 'jeton-b' });
    expect((await emettre(a, 'casino_cv_entrer')).ok).toBe(false); // pas encore au salon
    await emettre(a, 'casino_entrer');
    await emettre(b, 'casino_entrer');
    const annonces: AnnonceCasino[] = [];
    b.on('casino_annonce', (x: AnnonceCasino) => annonces.push(x));

    // Manche 1 : la pie frappe à ×3. Lucas mise 10 000 $ (à la main) et 5 000 $ (automatique à ×1,5).
    const e = await emettre(a, 'casino_cv_entrer');
    expect(e.ok).toBe(true);
    let v: VueCouronne = e.couronne;
    if (v.phase !== 'mises' || (v.reste ?? 0) < 250) v = await attendre(a, (x) => x.phase === 'mises' && (x.reste ?? 0) > 250);
    expect(v.x).toBeNull(); // le point de la pie reste secret
    expect((await emettre(a, 'casino_cv_miser', { emplacement: 0, mise: 1234 })).erreur).toMatch(/Mise/);
    expect((await emettre(a, 'casino_cv_miser', { emplacement: 2, mise: 10_000 })).erreur).toMatch(/introuvable/);
    expect((await emettre(a, 'casino_cv_miser', { emplacement: 1, mise: 5_000, auto: 1.005 })).erreur).toMatch(/×1,01/);
    expect((await emettre(a, 'casino_cv_miser', { emplacement: 0, mise: 10_000 })).ok).toBe(true);
    expect((await emettre(a, 'casino_cv_miser', { emplacement: 0, mise: 10_000 })).erreur).toMatch(/déjà/);
    const annule = await emettre(a, 'casino_cv_annuler', { emplacement: 0 });
    expect(annule.couronne.mesMises[0]).toBeNull();
    expect(annule.couronne.solde).toBe(SOLDE_DEPART);
    await emettre(a, 'casino_cv_miser', { emplacement: 0, mise: 10_000 });
    const m2 = await emettre(a, 'casino_cv_miser', { emplacement: 1, mise: 5_000, auto: 1.5 });
    expect(m2.couronne.solde).toBe(SOLDE_DEPART - 15_000);
    expect((await emettre(a, 'casino_cv_recuperer', { emplacement: 0 })).erreur).toMatch(/Trop tard/); // pas encore en vol

    const vol = await attendre(a, (x) => x.phase === 'vol');
    expect(vol.x).toBeNull();
    expect((await emettre(a, 'casino_cv_miser', { emplacement: 0, mise: 1_000 })).erreur).toMatch(/envol/);
    expect((await emettre(a, 'casino_cv_annuler', { emplacement: 0 })).erreur).toMatch(/Trop tard/);
    await pause(120); // ×1,6 environ
    const r = await emettre(a, 'casino_cv_recuperer', { emplacement: 0 });
    expect(r.ok).toBe(true);
    const x = r.couronne.mesMises[0].x as number;
    expect(x).toBeGreaterThan(1.3);
    expect(x).toBeLessThan(3);
    expect(r.couronne.mesMises[0].gain).toBe(gainCouronne(10_000, x));
    expect((await emettre(a, 'casino_cv_recuperer', { emplacement: 0 })).erreur).toMatch(/déjà/);

    const volee = await attendre(a, (y) => y.phase === 'volee');
    expect(volee.x).toBe(3);
    expect(volee.historique[0]).toBe(3);
    expect(volee.mesMises[1]).toMatchObject({ etat: 'recuperee', x: 1.5, gain: 7_500 }); // payée exactement à ×1,5
    expect(volee.solde).toBe(SOLDE_DEPART - 15_000 + gainCouronne(10_000, x) + 7_500);
    expect(volee.joueurs[0]).toMatchObject({ nom: 'Lucas', mise: 15_000, x, moi: true });

    // Manche 2 : la pie frappe à ×1,2 ; la mise automatique à ×2 est volée, et il est trop tard pour récupérer.
    pointImpose = 1.2;
    const avant = volee.solde;
    await attendre(a, (y) => y.phase === 'mises');
    await emettre(a, 'casino_cv_miser', { emplacement: 0, mise: 2_000, auto: 2 });
    const volee2 = await attendre(a, (y) => y.phase === 'volee');
    expect(volee2.mesMises[0]).toMatchObject({ etat: 'volee', gain: 0 });
    expect(volee2.joueurs[0].vole).toBe(true);
    expect(volee2.solde).toBe(avant - 2_000);
    expect((await emettre(a, 'casino_cv_recuperer', { emplacement: 0 })).erreur).toMatch(/Trop tard/);

    // Manche 3 : la couronne atteint les étoiles (×10 000) : la mise encore en vol y est payée, et tout le salon l'apprend.
    pointImpose = X_MAX_COURONNE;
    await attendre(a, (y) => y.phase === 'mises');
    await emettre(a, 'casino_cv_miser', { emplacement: 0, mise: 1_000 });
    const etoiles = await attendre(a, (y) => y.phase === 'volee', 9000);
    expect(etoiles.x).toBe(X_MAX_COURONNE);
    expect(etoiles.mesMises[0]).toMatchObject({ etat: 'recuperee', x: X_MAX_COURONNE, gain: 10_000_000 });
    await pause(50);
    expect(annonces.some((y) => y.jeu === 'couronne' && y.gain === 10_000_000 && y.nom === 'Lucas')).toBe(true);
    expect(etoiles.historique.slice(0, 3)).toEqual([X_MAX_COURONNE, 1.2, 3]);

    // Sans point imposé, le serveur tire lui-même le point de la pie.
    pointImpose = undefined;
    await attendre(a, (y) => y.phase === 'mises');
    const auHasard = await attendre(a, (y) => y.phase === 'volee', 9000);
    expect(auHasard.x).toBeGreaterThanOrEqual(1);
    expect(auHasard.historique[0]).toBe(auHasard.x);

    // Le salon montre la couronne en direct.
    const salon = await emettre(a, 'casino_vue');
    expect(salon.casino.couronne).toMatchObject({ enDirect: true, spectateurs: 1 });
    a.close();
    b.close();
  }, 30_000);
});
