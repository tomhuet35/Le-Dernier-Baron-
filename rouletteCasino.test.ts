import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authentificationTest, creerServiceComptes, stockageMemoire } from '../server/comptes';
import { demarrerServeur } from '../server/serveur';
import { SOLDE_DEPART } from '../shared/casino';
import { couleurNumero, CYLINDRE, MISES_ROULETTE, retourMise, ROUGES, type VueTableRoulette } from '../shared/rouletteCasino';

describe('Roulette : règles', () => {
  it('liste toutes les mises de la roulette européenne, avec leurs paiements', () => {
    const compte: Record<string, number> = {};
    for (const m of MISES_ROULETTE.values()) compte[m.type] = (compte[m.type] ?? 0) + 1;
    expect(compte).toEqual({ plein: 37, cheval: 60, transversale: 14, carre: 23, sixain: 11, douzaine: 3, colonne: 3, simple: 6 });
    const paiement = (cle: string) => MISES_ROULETTE.get(cle)?.paiement;
    expect([paiement('plein-17'), paiement('cheval-17-20'), paiement('transversale-16-17-18'), paiement('carre-17-18-20-21'), paiement('sixain-13-14-15-16-17-18')]).toEqual([35, 17, 11, 8, 5]);
    expect([paiement('douzaine-2'), paiement('colonne-1'), paiement('rouge'), paiement('passe')]).toEqual([2, 2, 1, 1]);
    // Les mises du zéro : chevaux 0-1, 0-2, 0-3, trios et les quatre premiers.
    for (const cle of ['cheval-0-1', 'cheval-0-2', 'cheval-0-3', 'transversale-0-1-2', 'transversale-0-2-3', 'carre-0-1-2-3']) expect(MISES_ROULETTE.has(cle)).toBe(true);
    expect(MISES_ROULETTE.has('cheval-3-4')).toBe(false); // pas voisins sur le tapis
    expect(MISES_ROULETTE.get('colonne-1')?.numeros).toEqual([1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34]);
  });

  it('paie les mises gagnantes, et rend la moitié des simples sur le zéro (la partage)', () => {
    expect(retourMise('plein-17', 1000, 17)).toBe(36_000);
    expect(retourMise('plein-17', 1000, 18)).toBe(0);
    expect(retourMise('cheval-0-1', 1000, 0)).toBe(18_000);
    expect(retourMise('douzaine-2', 1000, 13)).toBe(3000);
    expect(retourMise('colonne-1', 1000, 34)).toBe(3000);
    expect(retourMise('rouge', 1000, 1)).toBe(2000);
    expect(retourMise('noir', 1000, 1)).toBe(0);
    expect(retourMise('rouge', 1000, 0)).toBe(500);
    expect(retourMise('douzaine-1', 1000, 0)).toBe(0);
    expect(retourMise('inventee', 1000, 5)).toBe(0);
  });

  it('a un cylindre de 37 cases où rouges et noires alternent', () => {
    expect(new Set(CYLINDRE).size).toBe(37);
    expect(ROUGES.size).toBe(18);
    for (let i = 1; i < 36; i++) expect(couleurNumero(CYLINDRE[i])).not.toBe(couleurNumero(CYLINDRE[i + 1]));
    // Toutes les mises rendent 36/37 en moyenne (un peu plus pour les simples, grâce à la partage).
    for (const m of MISES_ROULETTE.values()) {
      let r = 0;
      for (let n = 0; n <= 36; n++) r += retourMise(m.cle, 1000, n) / 37;
      expect(r / 1000).toBeCloseTo(m.type === 'simple' ? 36.5 / 37 : 36 / 37, 6);
    }
  });
});

// ---------- Table de roulette de bout en bout ----------

const identites = {
  'jeton-a': { uid: 'uid-a', nom: 'Lucas', email: 'a@gmail.com' },
  'jeton-b': { uid: 'uid-b', nom: 'Tom', email: 'b@gmail.com' },
  'jeton-n': { uid: 'uid-n', nom: 'Nina', email: 'n@gmail.com' },
};
const stockage = stockageMemoire();
const service = creerServiceComptes({ configWeb: { apiKey: 'cle', authDomain: 'test.firebaseapp.com', projectId: 'test' }, authentification: authentificationTest(identites), stockage });
let serveur: Awaited<ReturnType<typeof demarrerServeur>>;
let numero = 17;
const connecter = () => io(`http://localhost:${serveur.port}`, { transports: ['websocket'], forceNew: true });
function emettre(s: Socket, evt: string, data?: unknown): Promise<any> {
  return new Promise((ok) => s.emit(evt, data, ok));
}
/** Attend une vue de la table qui remplit la condition. */
function attendreVue(s: Socket, condition: (v: VueTableRoulette) => boolean): Promise<VueTableRoulette> {
  return new Promise((ok) => {
    const ecoute = (v: VueTableRoulette) => {
      if (!condition(v)) return;
      s.off('casino_rl', ecoute);
      ok(v);
    };
    s.on('casino_rl', ecoute);
  });
}

beforeAll(async () => {
  for (const id of Object.values(identites)) await service.preparer(id.uid, id.nom);
  await service.donnerBadgeCreateur('uid-a');
  await service.donnerBadgeCreateur('uid-b');
  // Lucas est ami avec Tom (créateur) et avec Nina (sans badge).
  for (const [x, y] of [['uid-a', 'uid-b'], ['uid-b', 'uid-a'], ['uid-a', 'uid-n'], ['uid-n', 'uid-a']]) await service.demanderAmi(x, y);
  serveur = await demarrerServeur({
    port: 0,
    servirClient: false,
    comptes: service,
    casino: { delaiEcriture: 30, delaisRoulette: { mises: 1800, fermeture: 300, tirage: 150, resultat: 250 }, tirageRoulette: () => numero },
  });
});
afterAll(async () => {
  await serveur.fermer();
});

describe('Table de roulette de bout en bout', () => {
  it('reste introuvable sans badge Créateur', async () => {
    const n = connecter();
    await emettre(n, 'identifier', { jeton: 'jeton-n' });
    for (const evt of ['casino_rl_creer', 'casino_rl_rejoindre', 'casino_rl_miser', 'casino_amis', 'casino_inviter']) {
      const r = await emettre(n, evt, { code: 'ABCD', cle: 'rouge', montant: 1000 });
      expect(r.ok).toBe(false);
      if (evt !== 'casino_inviter' && evt !== 'casino_rl_miser') expect(r.erreur).toBe('Introuvable.');
    }
    n.close();
  });

  it('fait miser deux créateurs et un bot, paie au dollar près, refait les mises et applique la partage', async () => {
    const a = connecter();
    const b = connecter();
    await emettre(a, 'identifier', { jeton: 'jeton-a' });
    await emettre(b, 'identifier', { jeton: 'jeton-b' });
    await emettre(a, 'casino_entrer');
    await emettre(b, 'casino_entrer');
    const cree = await emettre(a, 'casino_rl_creer', { bots: 1 });
    expect(cree.ok).toBe(true);
    const code = cree.table.code;
    const rejoint = await emettre(b, 'casino_rl_rejoindre', { code });
    expect(rejoint.table.places.map((p: { nom: string; bot: boolean }) => p.bot)).toEqual([false, true, false]);
    // La table apparaît dans le salon.
    expect((await emettre(a, 'casino_vue')).casino.tablesRoulette[0]).toMatchObject({ code, max: 5 });

    // Mises refusées : case inventée, jeton inventé, plus de 500 000 $ sur une case.
    expect((await emettre(a, 'casino_rl_miser', { cle: 'plein-37', montant: 1000 })).ok).toBe(false);
    expect((await emettre(a, 'casino_rl_miser', { cle: 'plein-17', montant: 1234 })).ok).toBe(false);
    expect((await emettre(a, 'casino_rl_miser', { cle: 'plein-17', montant: 100_000 })).ok).toBe(true);
    expect((await emettre(a, 'casino_rl_miser', { cle: 'plein-17', montant: 500_000 })).erreur).toMatch(/500 000/);
    expect((await emettre(a, 'casino_rl_miser', { cle: 'rouge', montant: 25_000 })).ok).toBe(true);
    // Annuler retire le dernier jeton (et le rend), doubler double tout.
    expect((await emettre(a, 'casino_rl_annuler')).ok).toBe(true);
    expect((await emettre(a, 'casino_rl_doubler')).ok).toBe(true);
    expect((await emettre(b, 'casino_rl_miser', { cle: 'noir', montant: 5000 })).ok).toBe(true);
    const fin = await attendreVue(a, (v) => v.phase === 'resultat');
    expect(fin.tirage).toBe(17);
    expect(fin.historique[0]).toBe(17);
    const place = (nom: string) => fin.places.find((p) => p.nom === nom)!;
    expect(place('Lucas')).toMatchObject({ mise: 200_000, resultat: 200_000 * 35 });
    expect(place('Tom')).toMatchObject({ mise: 5000, resultat: 5000 }); // le 17 est noir
    expect(fin.jetons.some((j) => j.place === fin.places.find((p) => p.bot)!.id)).toBe(true); // le bot a misé
    expect(fin.solde).toBe(SOLDE_DEPART + 200_000 * 35);

    // Tour suivant : « Refaire » repose les mêmes mises ; le zéro sort : la mise simple rend la moitié.
    numero = 0;
    await attendreVue(a, (v) => v.phase === 'mises' && !v.closes);
    expect((await emettre(a, 'casino_rl_miser', { cle: 'rouge', montant: 100_000 })).ok).toBe(true);
    expect((await emettre(a, 'casino_rl_refaire')).erreur).toMatch(/déjà misé/);
    expect((await emettre(a, 'casino_rl_annuler', { tout: true })).ok).toBe(true);
    expect((await emettre(a, 'casino_rl_refaire')).ok).toBe(true);
    expect((await emettre(b, 'casino_rl_miser', { cle: 'rouge', montant: 1000 })).ok).toBe(true);
    const zero = await attendreVue(a, (v) => v.phase === 'resultat');
    expect(zero.tirage).toBe(0);
    expect(zero.places.find((p) => p.nom === 'Lucas')).toMatchObject({ mise: 200_000, resultat: -200_000 });
    expect(zero.places.find((p) => p.nom === 'Tom')).toMatchObject({ mise: 1000, resultat: -500 });
    // Les mises sont fermées pendant que la bille tourne.
    numero = 17;
    a.close();
    b.close();
  });

  it('invite un ami créateur à sa table (et seulement lui)', async () => {
    const a = connecter();
    const b = connecter();
    await emettre(a, 'identifier', { jeton: 'jeton-a' });
    await emettre(b, 'identifier', { jeton: 'jeton-b' });
    await emettre(a, 'casino_entrer');
    const codeTom = (await stockage.lire('uid-b'))!.codeAmi;
    const codeNina = (await stockage.lire('uid-n'))!.codeAmi;
    expect((await emettre(a, 'casino_inviter', { code: codeTom })).erreur).toMatch(/Assieds-toi/);
    const { table } = await emettre(a, 'casino_rl_creer', { bots: 0 });
    const amis = await emettre(a, 'casino_amis');
    expect(amis.amis.map((x: { nom: string }) => x.nom)).toEqual(['Tom']);
    expect((await emettre(a, 'casino_inviter', { code: codeNina })).erreur).toMatch(/pas accès/);
    const recue = new Promise<any>((ok) => b.once('invitation', ok));
    expect((await emettre(a, 'casino_inviter', { code: codeTom })).ok).toBe(true);
    expect(await recue).toMatchObject({ de: 'Lucas', code: table.code, casino: 'roulette' });
    // Tom rejoint la table depuis l'invitation.
    await emettre(b, 'casino_entrer');
    expect((await emettre(b, 'casino_rl_rejoindre', { code: table.code })).ok).toBe(true);
    a.close();
    b.close();
  });
});
