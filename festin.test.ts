import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authentificationTest, creerServiceComptes, stockageMemoire } from '../server/comptes';
import { demarrerServeur } from '../server/serveur';
import { SOLDE_DEPART } from '../shared/casino';
import { CASES_FESTIN, echelleFestin, gainFestin, multiplicateurFestin, placerOs, RTP_FESTIN, X_MAX_FESTIN, type VueFestin } from '../shared/festin';
import { suivant } from '../shared/rng';

function hasardFixe(graine: number) {
  let s = graine;
  return (n: number) => {
    const [x, ns] = suivant(s);
    s = ns;
    return Math.floor(x * n);
  };
}
/** Combinaisons (pour vérifier le multiplicateur juste). */
function c(n: number, k: number) {
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return r;
}

describe('Le Festin du Baron : les multiplicateurs', () => {
  it('donne les multiplicateurs attendus', () => {
    expect(multiplicateurFestin(1, 0)).toBe(1);
    expect(multiplicateurFestin(1, 1)).toBe(1.01); // 0,97 × 25/24
    expect(multiplicateurFestin(3, 1)).toBe(1.1); // 0,97 × 25/22
    expect(multiplicateurFestin(3, 2)).toBe(1.25); // 0,97 × 600/462 = 1,2597…
    expect(multiplicateurFestin(24, 1)).toBe(24.25); // un seul poulet sur 25
    expect(multiplicateurFestin(1, 24)).toBe(24.25);
    expect(multiplicateurFestin(12, 13)).toBe(X_MAX_FESTIN); // plafonné
  });

  it('rend 97 % des mises, quelle que soit la façon de jouer', () => {
    for (const os of [1, 3, 5, 10, 18, 24])
      for (let k = 1; k <= CASES_FESTIN - os; k++) {
        const x = multiplicateurFestin(os, k);
        if (x >= X_MAX_FESTIN) break;
        const chance = c(CASES_FESTIN - os, k) / c(CASES_FESTIN, k);
        expect(chance * x).toBeLessThanOrEqual(RTP_FESTIN + 1e-9);
        expect(chance * x).toBeGreaterThan(RTP_FESTIN - 0.01 * chance - 1e-9); // seul l'arrondi au centième en retire
      }
    expect(echelleFestin(3)).toHaveLength(22);
    expect(echelleFestin(3).every((x, i, t) => i === 0 || x > t[i - 1])).toBe(true);
    expect(gainFestin(25_000, 1.25)).toBe(31_250);
  });

  it('place exactement le nombre d’os demandé, partout sur la table', () => {
    const h = hasardFixe(9);
    const vus = new Set<number>();
    for (let k = 0; k < 400; k++) {
      const os = 1 + (k % 24);
      const p = placerOs(h, os);
      expect(new Set(p).size).toBe(os);
      expect(p.every((i) => i >= 0 && i < CASES_FESTIN)).toBe(true);
      p.forEach((i) => vus.add(i));
    }
    expect(vus.size).toBe(CASES_FESTIN);
  });
});

// ---------- Une partie de bout en bout ----------

const identites = {
  'jeton-a': { uid: 'uid-a', nom: 'Lucas', email: 'a@gmail.com' },
  'jeton-n': { uid: 'uid-n', nom: 'Nina', email: 'n@gmail.com' },
};
const stockage = stockageMemoire();
const service = creerServiceComptes({ configWeb: { apiKey: 'cle', authDomain: 'test.firebaseapp.com', projectId: 'test' }, authentification: authentificationTest(identites), stockage });
let serveur: Awaited<ReturnType<typeof demarrerServeur>>;
/** Les os de la prochaine partie (cloches 0, 1, 2 par défaut). */
let osImposes: number[] | undefined = [0, 1, 2];
const connecter = () => io(`http://localhost:${serveur.port}`, { transports: ['websocket'], forceNew: true });
function emettre(s: Socket, evt: string, data?: unknown): Promise<any> {
  return new Promise((ok) => s.emit(evt, data, ok));
}

beforeAll(async () => {
  for (const id of Object.values(identites)) await service.preparer(id.uid, id.nom);
  await service.donnerBadgeCreateur('uid-a');
  serveur = await demarrerServeur({ port: 0, servirClient: false, comptes: service, casino: { delaiEcriture: 30, placerOsFestin: () => osImposes } });
});
afterAll(async () => {
  await serveur.fermer();
});

describe('Le Festin du Baron en direct', () => {
  it('reste introuvable sans badge Créateur', async () => {
    const n = connecter();
    await emettre(n, 'identifier', { jeton: 'jeton-n' });
    for (const evt of ['casino_festin_vue', 'casino_festin_servir', 'casino_festin_ouvrir', 'casino_festin_encaisser']) expect((await emettre(n, evt, { mise: 1000, os: 3, index: 4 })).erreur).toBe('Introuvable.');
    n.close();
  });

  it('sert un festin, garde les os secrets, paie à l’encaissement et tout perd sur un os', async () => {
    const a = connecter();
    await emettre(a, 'identifier', { jeton: 'jeton-a' });
    expect((await emettre(a, 'casino_festin_servir', { mise: 25_000, os: 3 })).ok).toBe(false); // pas encore au salon
    await emettre(a, 'casino_entrer');
    expect((await emettre(a, 'casino_festin_servir', { mise: 1234, os: 3 })).erreur).toMatch(/Mise/);
    expect((await emettre(a, 'casino_festin_servir', { mise: 25_000, os: 25 })).erreur).toMatch(/24/);

    // Partie 1 : 3 os (cloches 0, 1, 2), deux poulets puis on encaisse.
    const s = await emettre(a, 'casino_festin_servir', { mise: 25_000, os: 3 });
    expect(s.ok).toBe(true);
    expect(s.solde).toBe(SOLDE_DEPART - 25_000);
    const v0: VueFestin = s.festin;
    expect(v0.cloches.every((x) => x === null)).toBe(true); // rien n'est dévoilé
    expect(v0.suivant).toBe(1.1);
    expect((await emettre(a, 'casino_festin_servir', { mise: 25_000, os: 3 })).erreur).toMatch(/en cours/);
    expect((await emettre(a, 'casino_festin_encaisser')).erreur).toMatch(/au moins une cloche/);
    const o1 = await emettre(a, 'casino_festin_ouvrir', { index: 12 });
    expect(o1.festin.cloches[12]).toBe('poulet');
    expect(o1.festin.cloches.filter((x: unknown) => x !== null)).toHaveLength(1); // les os restent cachés
    expect(o1.festin.x).toBe(1.1);
    expect((await emettre(a, 'casino_festin_ouvrir', { index: 12 })).erreur).toMatch(/déjà/);
    const o2 = await emettre(a, 'casino_festin_ouvrir', { index: 20 });
    expect(o2.festin.x).toBe(1.25);
    expect(o2.festin.gain).toBe(31_250);
    const e = await emettre(a, 'casino_festin_encaisser');
    expect(e.festin.etat).toBe('encaisse');
    expect(e.festin.gain).toBe(31_250);
    expect(e.festin.cloches.filter((x: unknown) => x === 'os')).toHaveLength(3); // tout se dévoile à la fin
    expect(e.solde).toBe(SOLDE_DEPART - 25_000 + 31_250);

    // Partie 2 : un poulet, puis un os : la mise est perdue.
    await emettre(a, 'casino_festin_servir', { mise: 10_000, os: 3 });
    await emettre(a, 'casino_festin_ouvrir', { index: 5 });
    const perdu = await emettre(a, 'casino_festin_ouvrir', { index: 1 });
    expect(perdu.festin.etat).toBe('perdu');
    expect(perdu.festin.perdante).toBe(1);
    expect(perdu.festin.gain).toBe(0);
    expect(perdu.solde).toBe(SOLDE_DEPART + 6_250 - 10_000);
    expect((await emettre(a, 'casino_festin_encaisser')).ok).toBe(false);

    // Partie 3 : 24 os, le seul poulet s'encaisse tout seul (×24,25).
    osImposes = Array.from({ length: 24 }, (_, i) => i + 1);
    await emettre(a, 'casino_festin_servir', { mise: 1_000, os: 24 });
    const seul = await emettre(a, 'casino_festin_ouvrir', { index: 0 });
    expect(seul.festin.etat).toBe('encaisse');
    expect(seul.festin.gain).toBe(24_250);

    // La partie en cours attend le joueur : il la retrouve en revenant.
    osImposes = [0, 1, 2];
    await emettre(a, 'casino_festin_servir', { mise: 5_000, os: 3 });
    await emettre(a, 'casino_festin_ouvrir', { index: 9 });
    await emettre(a, 'casino_quitter');
    await emettre(a, 'casino_entrer');
    const retour = await emettre(a, 'casino_festin_vue');
    expect(retour.festin.etat).toBe('enCours');
    expect(retour.festin.poulets).toBe(1);
    expect((await emettre(a, 'casino_vue')).casino.festin.enCours).toBe(true);
    a.close();
  });
});
