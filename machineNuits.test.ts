import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authentificationTest, creerServiceComptes, stockageMemoire } from '../server/comptes';
import { demarrerServeur } from '../server/serveur';
import { SOLDE_DEPART } from '../shared/casino';
import {
  BANDES_NUIT,
  etatNuitsVide,
  FREE_GAMES_NUIT,
  GAIN_JUGES_NUIT,
  gainsNuit,
  GAINS_NUIT,
  jouerNuits,
  tauxDeRetourNuits,
  tourNuits,
  TOURS_POLICE,
  type ResultatNuit,
  type SymboleNuit,
  type TypeEvenementNuit,
} from '../shared/machineNuits';

function graine(g: number) {
  return (n: number) => {
    g ^= g << 13;
    g >>>= 0;
    g ^= g >>> 17;
    g ^= g << 5;
    g >>>= 0;
    return g % n;
  };
}
/** Hasard sans événement (le tirage de l'événement tombe toujours à côté). */
const sansEvenement = (h: (n: number) => number) => (n: number) => (n === 10_000 ? 9999 : h(n));
/** Cherche des arrêts de rouleaux qui donnent un tour voulu (sans événement). */
function trouver(condition: (r: ResultatNuit) => boolean): number[] {
  const h = graine(5);
  for (let i = 0; i < 300_000; i++) {
    const arrets = BANDES_NUIT.map((b) => h(b.length));
    if (condition(tourNuits(sansEvenement(h), 1000, { gratuit: false, collantes: [], forcer: { arrets } }))) return arrets;
  }
  throw new Error('aucun tirage trouvé');
}
const PETITS = ['as', 'roi', 'dame', 'valet', 'dix'];

describe('Les Nuits du Baron : règles', () => {
  it('compte les 243 façons de gagner, rouleaux joker et multiplicateur compris', () => {
    const g: SymboleNuit[][] = [
      ['chat', 'dix', 'chat'],
      ['as', 'roi', 'dame'],
      ['chat', 'valet', 'dix'],
      ['as', 'as', 'as'],
      ['chat', 'chat', 'chat'],
    ];
    // Rouleau 2 joker (et ×3) : chat sur 3 rouleaux (2 × 3 × 1 = 6 façons), puis rien sur le 4e.
    const gains = gainsNuit(g, new Set([1]), { 1: 3 }, 20_000);
    expect(gains.find((x) => x.symbole === 'chat')).toEqual({ symbole: 'chat', longueur: 3, voies: 6, multiple: 3, gain: GAINS_NUIT.chat[0] * 6 * 3 * 1000 });
    // Sans joker : le chat s'arrête au 2e rouleau, rien ne paie.
    expect(gainsNuit(g, new Set(), {}, 20_000)).toEqual([]);
  });

  it('fait couvrir tout son rouleau à la Couronne, et donne 8 free games (et 2 fois la mise) avec 3 Juges', () => {
    const arrets = trouver((r) => r.avant[2].includes('couronne') && !r.avant.flat().includes('juge'));
    const r = tourNuits(sansEvenement(graine(1)), 1000, { gratuit: false, collantes: [], forcer: { arrets } });
    expect(r.sauvages).toContain(2);
    const juges = trouver((x) => x.juges === 3);
    const j = tourNuits(sansEvenement(graine(1)), 1000, { gratuit: false, collantes: [], forcer: { arrets: juges } });
    expect(j.freeGames).toBe(FREE_GAMES_NUIT);
    expect(j.gain).toBeGreaterThanOrEqual(GAIN_JUGES_NUIT * 1000);
    // Pendant les free games : pas de débit (la mise est fixée), un événement à chaque tour.
    const etat = etatNuitsVide();
    jouerNuits(sansEvenement(graine(2)), 5000, etat, { arrets: juges });
    expect(etat).toMatchObject({ gratuits: FREE_GAMES_NUIT, miseGratuite: 5000 });
    const h = graine(9);
    for (let i = 0; i < 5; i++) {
      const t = jouerNuits(h, 100_000, etat);
      expect(t).toMatchObject({ gratuit: true, mise: 5000 });
      expect(t.resultat.evenement).not.toBeNull();
    }
  });

  it('joue chaque événement : police figée 3 tours (mise bloquée), casse multiplicateur, trahison, alliance, couvre-feu', () => {
    const h = graine(4);
    const tour = (evenement: TypeEvenementNuit) => tourNuits(h, 1000, { gratuit: false, collantes: [], forcer: { evenement } });
    // Descente de police : les rouleaux restent joker ce tour et les 2 suivants, à la même mise.
    const etat = etatNuitsVide();
    const police = jouerNuits(h, 10_000, etat, { evenement: 'police' });
    expect(police.resultat.evenement?.type).toBe('police');
    const figes = (police.resultat.evenement as { rouleaux: number[] }).rouleaux;
    expect(etat.collantes).toEqual({ rouleaux: figes, restants: TOURS_POLICE, mise: 10_000 });
    for (let i = 0; i < TOURS_POLICE; i++) {
      const suite = jouerNuits(sansEvenement(h), 100_000, etat);
      expect(suite.mise).toBe(10_000);
      for (const r of figes) expect(suite.resultat.sauvages).toContain(r);
    }
    expect(etat.collantes).toBeNull();
    // Casse du siècle : un rouleau joker multiplicateur.
    const casse = tour('casse');
    const e = casse.evenement as { type: 'casse'; rouleau: number; multiple: number };
    expect(casse.sauvages).toContain(e.rouleau);
    expect(casse.multiples[e.rouleau]).toBe(e.multiple);
    for (const g of casse.gains) if (g.longueur > e.rouleau) expect(g.multiple % e.multiple).toBe(0);
    // Trahison : des cartes mystère, toutes retournées sur le même symbole.
    const trahison = tour('trahison');
    const t = trahison.evenement as { type: 'trahison'; cases: number[]; symbole: string };
    expect(t.cases.length).toBeGreaterThanOrEqual(3);
    for (const c of t.cases) {
      expect(trahison.avant[Math.floor(c / 3)][c % 3]).toBe('mystere');
      expect(trahison.grille[Math.floor(c / 3)][c % 3]).toBe(t.symbole);
    }
    // Alliance : le second rouleau recopie le premier.
    const alliance = tour('alliance');
    const a = alliance.evenement as { type: 'alliance'; de: number; vers: number };
    expect(alliance.grille[a.vers]).toEqual(alliance.grille[a.de]);
    // Couvre-feu : plus aucun petit symbole sur les trois premiers rouleaux.
    const couvreFeu = tour('couvreFeu');
    for (let r = 0; r < 3; r++) for (const s of couvreFeu.grille[r]) expect(PETITS).not.toContain(s);
  });

  it('rend environ 96 % des mises sur 400 000 tours (free games et événements compris)', () => {
    const t = tauxDeRetourNuits(400_000, graine(17));
    expect(t.total).toBeGreaterThan(0.9);
    expect(t.total).toBeLessThan(1.03);
    expect(1 / t.freeGames).toBeGreaterThan(100); // les free games, environ une fois tous les 150 tours
    expect(1 / t.freeGames).toBeLessThan(220);
    expect(t.evenements).toBeGreaterThan(0.04); // un événement environ une fois tous les 20 tours
    expect(t.evenements).toBeLessThan(0.06);
  });
});

// ---------- De bout en bout ----------

const identites = {
  'jeton-a': { uid: 'uid-a', nom: 'Lucas', email: 'a@gmail.com' },
  'jeton-n': { uid: 'uid-n', nom: 'Nina', email: 'n@gmail.com' },
};
const stockage = stockageMemoire();
const service = creerServiceComptes({ configWeb: { apiKey: 'cle', authDomain: 'test.firebaseapp.com', projectId: 'test' }, authentification: authentificationTest(identites), stockage });
let serveur: Awaited<ReturnType<typeof demarrerServeur>>;
let forcer: { arrets?: number[]; evenement?: TypeEvenementNuit } | undefined;
const connecter = () => io(`http://localhost:${serveur.port}`, { transports: ['websocket'], forceNew: true });
function emettre(s: Socket, evt: string, data?: unknown): Promise<any> {
  return new Promise((ok) => s.emit(evt, data, ok));
}
const attendre = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

beforeAll(async () => {
  for (const id of Object.values(identites)) await service.preparer(id.uid, id.nom);
  await service.donnerBadgeCreateur('uid-a');
  serveur = await demarrerServeur({ port: 0, servirClient: false, comptes: service, casino: { delaiEcriture: 30, hasardNuits: graine(8), forcerNuits: () => forcer } });
});
afterAll(async () => {
  await serveur.fermer();
});

describe('Les Nuits du Baron de bout en bout', () => {
  it('reste introuvable sans badge Créateur', async () => {
    const n = connecter();
    await emettre(n, 'identifier', { jeton: 'jeton-n' });
    expect(await emettre(n, 'casino_nuits', { mise: 1000 })).toEqual({ ok: false, erreur: 'Introuvable.' });
    n.close();
  });

  it('débite la mise, fige la police sur 3 tours à la même mise, et ne débite pas les free games', async () => {
    const a = connecter();
    await emettre(a, 'identifier', { jeton: 'jeton-a' });
    expect((await emettre(a, 'casino_entrer')).casino.nuits).toEqual({ gratuits: 0, miseGratuite: 0, collantes: null });
    expect((await emettre(a, 'casino_nuits', { mise: 1234 })).ok).toBe(false);
    forcer = { evenement: 'police' };
    const police = await emettre(a, 'casino_nuits', { mise: 10_000 });
    expect(police.casino.solde).toBe(SOLDE_DEPART - 10_000 + police.nuits.gain);
    expect(police.casino.nuits.collantes).toMatchObject({ restants: 2, mise: 10_000 });
    forcer = undefined;
    let solde = police.casino.solde;
    for (let i = 0; i < 2; i++) {
      await attendre(380);
      const r = await emettre(a, 'casino_nuits', { mise: 100_000 });
      expect(r.nuits.mise).toBe(10_000);
      expect(r.casino.solde).toBe(solde - 10_000 + r.nuits.gain);
      solde = r.casino.solde;
    }
    expect((await emettre(a, 'casino_vue')).casino.nuits.collantes).toBeNull();
    // 3 Juges : 8 free games à 20 000 $, sans débit.
    forcer = { arrets: trouver((x) => x.juges === 3) };
    await attendre(380);
    const juges = await emettre(a, 'casino_nuits', { mise: 20_000 });
    expect(juges.casino.nuits).toMatchObject({ gratuits: FREE_GAMES_NUIT, miseGratuite: 20_000 });
    forcer = undefined;
    await attendre(380);
    const gratuit = await emettre(a, 'casino_nuits', { mise: 1000 });
    expect(gratuit.nuits).toMatchObject({ gratuit: true, mise: 20_000 });
    expect(gratuit.nuits.evenement).not.toBeNull();
    expect(gratuit.casino.solde).toBe(juges.casino.solde + gratuit.nuits.gain);
    a.close();
  });
});
