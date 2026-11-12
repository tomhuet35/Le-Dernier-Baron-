import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authentificationTest, creerServiceComptes, stockageMemoire } from '../server/comptes';
import { demarrerServeur } from '../server/serveur';
import { SOLDE_DEPART } from '../shared/casino';
import { COFFRES, echelleCoffres, gainCoffres, multiplicateurCoffres, placerBadges, RTP_COFFRES, X_MAX_COFFRES, type VueCoffres } from '../shared/festin';
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

describe('Les Coffres du Baron : les multiplicateurs', () => {
  it('donne les multiplicateurs attendus', () => {
    expect(multiplicateurCoffres(1, 0)).toBe(1);
    expect(multiplicateurCoffres(1, 1)).toBe(1.01); // 0,97 × 25/24
    expect(multiplicateurCoffres(3, 1)).toBe(1.1); // 0,97 × 25/22
    expect(multiplicateurCoffres(3, 2)).toBe(1.25); // 0,97 × 600/462 = 1,2597…
    expect(multiplicateurCoffres(24, 1)).toBe(24.25); // un seul butin sur 25
    expect(multiplicateurCoffres(1, 24)).toBe(24.25);
    expect(multiplicateurCoffres(12, 13)).toBe(X_MAX_COFFRES); // plafonné
  });

  it('rend 97 % des mises, quelle que soit la façon de jouer', () => {
    for (const badges of [1, 3, 5, 10, 18, 24])
      for (let k = 1; k <= COFFRES - badges; k++) {
        const x = multiplicateurCoffres(badges, k);
        if (x >= X_MAX_COFFRES) break;
        const chance = c(COFFRES - badges, k) / c(COFFRES, k);
        expect(chance * x).toBeLessThanOrEqual(RTP_COFFRES + 1e-9);
        expect(chance * x).toBeGreaterThan(RTP_COFFRES - 0.01 * chance - 1e-9); // seul l'arrondi au centième en retire
      }
    expect(echelleCoffres(3)).toHaveLength(22);
    expect(echelleCoffres(3).every((x, i, t) => i === 0 || x > t[i - 1])).toBe(true);
    expect(gainCoffres(25_000, 1.25)).toBe(31_250);
    expect(gainCoffres(10_000, 2.53)).toBe(25_300); // pas d'erreur d'arrondi (2,53 × 10 000)
  });

  it('place exactement le nombre de badges demandé, partout sur la caisse', () => {
    const h = hasardFixe(9);
    const vus = new Set<number>();
    for (let k = 0; k < 400; k++) {
      const badges = 1 + (k % 24);
      const p = placerBadges(h, badges);
      expect(new Set(p).size).toBe(badges);
      expect(p.every((i) => i >= 0 && i < COFFRES)).toBe(true);
      p.forEach((i) => vus.add(i));
    }
    expect(vus.size).toBe(COFFRES);
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
/** Les badges de la prochaine partie (coffres 0, 1, 2 par défaut). */
let badgesImposes: number[] | undefined = [0, 1, 2];
const connecter = () => io(`http://localhost:${serveur.port}`, { transports: ['websocket'], forceNew: true });
function emettre(s: Socket, evt: string, data?: unknown): Promise<any> {
  return new Promise((ok) => s.emit(evt, data, ok));
}

beforeAll(async () => {
  for (const id of Object.values(identites)) await service.preparer(id.uid, id.nom);
  await service.donnerBadgeCreateur('uid-a');
  serveur = await demarrerServeur({ port: 0, servirClient: false, comptes: service, casino: { delaiEcriture: 30, placerBadgesCoffres: () => badgesImposes } });
});
afterAll(async () => {
  await serveur.fermer();
});

describe('Les Coffres du Baron en direct', () => {
  it('restent introuvables sans badge Créateur', async () => {
    const n = connecter();
    await emettre(n, 'identifier', { jeton: 'jeton-n' });
    for (const evt of ['casino_coffres_vue', 'casino_coffres_lancer', 'casino_coffres_ouvrir', 'casino_coffres_encaisser']) expect((await emettre(n, evt, { mise: 1000, badges: 3, index: 4 })).erreur).toBe('Introuvable.');
    n.close();
  });

  it('lance un casse, garde les badges secrets, paie à l’encaissement et saisit tout sur un badge', async () => {
    const a = connecter();
    await emettre(a, 'identifier', { jeton: 'jeton-a' });
    expect((await emettre(a, 'casino_coffres_lancer', { mise: 25_000, badges: 3 })).ok).toBe(false); // pas encore au salon
    await emettre(a, 'casino_entrer');
    expect((await emettre(a, 'casino_coffres_lancer', { mise: 1234, badges: 3 })).erreur).toMatch(/Mise/);
    expect((await emettre(a, 'casino_coffres_lancer', { mise: 25_000, badges: 25 })).erreur).toMatch(/24/);

    // Partie 1 : 3 badges (coffres 0, 1, 2), deux butins puis on encaisse.
    const s = await emettre(a, 'casino_coffres_lancer', { mise: 25_000, badges: 3 });
    expect(s.ok).toBe(true);
    expect(s.solde).toBe(SOLDE_DEPART - 25_000);
    const v0: VueCoffres = s.coffres;
    expect(v0.coffres.every((x) => x === null)).toBe(true); // rien n'est dévoilé
    expect(v0.suivant).toBe(1.1);
    expect((await emettre(a, 'casino_coffres_lancer', { mise: 25_000, badges: 3 })).erreur).toMatch(/en cours/);
    expect((await emettre(a, 'casino_coffres_encaisser')).erreur).toMatch(/au moins un coffre/);
    const o1 = await emettre(a, 'casino_coffres_ouvrir', { index: 12 });
    expect(o1.coffres.coffres[12]).toBe('butin');
    expect(o1.coffres.coffres.filter((x: unknown) => x !== null)).toHaveLength(1); // les badges restent cachés
    expect(o1.coffres.x).toBe(1.1);
    expect((await emettre(a, 'casino_coffres_ouvrir', { index: 12 })).erreur).toMatch(/déjà/);
    const o2 = await emettre(a, 'casino_coffres_ouvrir', { index: 20 });
    expect(o2.coffres.x).toBe(1.25);
    expect(o2.coffres.gain).toBe(31_250);
    const e = await emettre(a, 'casino_coffres_encaisser');
    expect(e.coffres.etat).toBe('encaisse');
    expect(e.coffres.gain).toBe(31_250);
    expect(e.coffres.coffres.filter((x: unknown) => x === 'police')).toHaveLength(3); // tout se dévoile à la fin
    expect(e.solde).toBe(SOLDE_DEPART - 25_000 + 31_250);

    // Partie 2 : un butin, puis la police : la mise est saisie.
    await emettre(a, 'casino_coffres_lancer', { mise: 10_000, badges: 3 });
    await emettre(a, 'casino_coffres_ouvrir', { index: 5 });
    const perdu = await emettre(a, 'casino_coffres_ouvrir', { index: 1 });
    expect(perdu.coffres.etat).toBe('perdu');
    expect(perdu.coffres.perdant).toBe(1);
    expect(perdu.coffres.gain).toBe(0);
    expect(perdu.solde).toBe(SOLDE_DEPART + 6_250 - 10_000);
    expect((await emettre(a, 'casino_coffres_encaisser')).ok).toBe(false);

    // Partie 3 : 24 badges, le seul butin s'encaisse tout seul (×24,25).
    badgesImposes = Array.from({ length: 24 }, (_, i) => i + 1);
    await emettre(a, 'casino_coffres_lancer', { mise: 1_000, badges: 24 });
    const seul = await emettre(a, 'casino_coffres_ouvrir', { index: 0 });
    expect(seul.coffres.etat).toBe('encaisse');
    expect(seul.coffres.gain).toBe(24_250);

    // La partie en cours attend le joueur : il la retrouve en revenant.
    badgesImposes = [0, 1, 2];
    await emettre(a, 'casino_coffres_lancer', { mise: 5_000, badges: 3 });
    await emettre(a, 'casino_coffres_ouvrir', { index: 9 });
    await emettre(a, 'casino_quitter');
    await emettre(a, 'casino_entrer');
    const retour = await emettre(a, 'casino_coffres_vue');
    expect(retour.coffres.etat).toBe('enCours');
    expect(retour.coffres.butins).toBe(1);
    expect((await emettre(a, 'casino_vue')).casino.coffres.enCours).toBe(true);
    a.close();
  });
});
