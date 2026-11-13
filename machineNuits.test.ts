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
  JACKPOTS_NUIT,
  jouerNuits,
  jouerBonusJetons,
  JETONS_POUR_BONUS,
  meilleurJackpot,
  RELANCES_JETONS,
  tauxDeRetourNuits,
  tourNuits,
  TOURS_POLICE,
  type ForcerNuits,
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
const PETITS = ['as', 'roi', 'dame'];

describe('Les Nuits du Baron : règles', () => {
  it('compte les 243 façons de gagner, rouleaux joker et multiplicateur compris', () => {
    const g: SymboleNuit[][] = [
      ['chat', 'dame', 'chat'],
      ['as', 'roi', 'dame'],
      ['chat', 'roi', 'roi'],
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

  it('joue chaque événement : police figée 3 tours (mise bloquée, un seul tour en free games), casse multiplicateur, trahison, alliance, couvre-feu', () => {
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
    expect(figes).toHaveLength(1);
    // Pendant les free games, la police ne fige son rouleau que pour ce tour.
    const libre = { ...etatNuitsVide(), gratuits: 3, miseGratuite: 1000 };
    const policeLibre = jouerNuits(h, 1000, libre, { evenement: 'police' });
    expect(policeLibre.resultat.evenement?.type).toBe('police');
    expect(libre.collantes).toBeNull();
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

  it('joue le bonus Jetons du Baron : 3 relances remises à 3, tous les Jetons paient, 15 cases = GRAND', () => {
    // 6 Jetons au départ : le bonus s'arrête quand 3 relances de suite n'apportent rien.
    const depart = Object.fromEntries([0, 2, 4, 7, 9, 13].map((c) => [c, { x: 1 }]));
    const b = jouerBonusJetons(graine(3), 10_000, depart);
    let restantes = RELANCES_JETONS;
    for (const r of b.relances) {
      const nouvelles = Object.keys(r.nouvelles).length;
      expect(r.restantes).toBe(nouvelles ? RELANCES_JETONS : restantes - 1);
      for (const c of Object.keys(r.nouvelles)) expect(depart).not.toHaveProperty(c);
      restantes = r.restantes;
    }
    if (!b.grand) expect(b.relances.at(-1)!.restantes).toBe(0);
    const somme = Object.values(b.valeurs).reduce((t, v) => t + v.x, 0);
    expect(b.gain).toBe(Math.round(somme * 10_000) + (b.grand ? JACKPOTS_NUIT.grand * 10_000 : 0));
    // Les 15 cases remplies : le GRAND (1000 fois la mise) en plus des Jetons.
    const plein = jouerBonusJetons(graine(3), 10_000, depart, true);
    expect(plein.grand).toBe(true);
    expect(Object.keys(plein.valeurs)).toHaveLength(15);
    expect(meilleurJackpot(plein)).toBe('grand');
    expect(plein.gain).toBeGreaterThanOrEqual((JACKPOTS_NUIT.grand + 15 * 0.5) * 10_000);
    // Forcé sur un tour : 6 Jetons au moins, dont un MAJOR, et le gain du tour comprend le bonus.
    const t = tourNuits(sansEvenement(graine(6)), 1000, { gratuit: false, collantes: [], forcer: { bonusJetons: { jackpot: 'major' } } });
    expect(Object.keys(t.jetons).length).toBeGreaterThanOrEqual(JETONS_POUR_BONUS);
    expect(t.bonusJetons).not.toBeNull();
    expect(meilleurJackpot(t.bonusJetons!)).toMatch(/major|grand/);
    expect(t.gain).toBeGreaterThanOrEqual(t.bonusJetons!.gain + t.gains.reduce((s, g) => s + g.gain, 0));
  });

  it('ne compte pas les Jetons recouverts par un rouleau joker, et la trahison ne les retourne pas', () => {
    const h = graine(12);
    for (let i = 0; i < 3000; i++) {
      const r = tourNuits(h, 1000, { gratuit: false, collantes: [], forcer: i % 3 ? undefined : { evenement: 'trahison' } });
      for (const c of Object.keys(r.jetons).map(Number)) {
        expect(r.grille[Math.floor(c / 3)][c % 3]).toBe('jeton');
        expect(r.sauvages).not.toContain(Math.floor(c / 3));
      }
      if (r.evenement?.type === 'trahison') for (const c of r.evenement.cases) expect(r.avant[Math.floor(c / 3)][c % 3]).toBe('mystere');
      expect(!!r.bonusJetons).toBe(Object.keys(r.jetons).length >= JETONS_POUR_BONUS);
    }
  });

  it('rend environ 107 % des mises sur 400 000 tours, et un tour sur deux paie (free games, événements et Jetons du Baron compris)', () => {
    const t = tauxDeRetourNuits(400_000, graine(17));
    expect(t.total).toBeGreaterThan(1.0);
    expect(t.total).toBeLessThan(1.16);
    expect(t.gagnants).toBeGreaterThan(0.45); // un tour sur deux paie quelque chose
    expect(t.rendMise).toBeGreaterThan(0.18); // environ 1 tour sur 5 rend au moins la mise
    expect(1 / t.freeGames).toBeGreaterThan(120); // les free games, environ une fois tous les 155 tours
    expect(1 / t.freeGames).toBeLessThan(200);
    expect(t.evenements).toBeGreaterThan(0.055); // un événement environ une fois tous les 15 tours
    expect(t.evenements).toBeLessThan(0.085);
    expect(1 / t.bonusJetons).toBeGreaterThan(65); // le bonus Jetons du Baron, environ une fois tous les 90 tours
    expect(1 / t.bonusJetons).toBeLessThan(120);
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
let forcer: ForcerNuits | undefined;
const connecter = () => io(`http://localhost:${serveur.port}`, { transports: ['websocket'], forceNew: true });
function emettre(s: Socket, evt: string, data?: unknown): Promise<any> {
  return new Promise((ok) => s.emit(evt, data, ok));
}
const attendre = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

beforeAll(async () => {
  for (const id of Object.values(identites)) await service.preparer(id.uid, id.nom);
  await service.donnerBadgeCreateur('uid-a');
  serveur = await demarrerServeur({ port: 0, servirClient: false, comptes: service, casino: { jeuALaffiche: () => null, delaiEcriture: 30, hasardNuits: graine(8), forcerNuits: () => forcer } });
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
    forcer = { arrets: trouver((x) => x.juges === 3), evenement: 'couvreFeu' };
    await attendre(380);
    const juges = await emettre(a, 'casino_nuits', { mise: 20_000 });
    expect(juges.casino.nuits).toMatchObject({ gratuits: FREE_GAMES_NUIT, miseGratuite: 20_000 });
    forcer = undefined;
    await attendre(380);
    const gratuit = await emettre(a, 'casino_nuits', { mise: 1000 });
    expect(gratuit.nuits).toMatchObject({ gratuit: true, mise: 20_000 });
    expect(gratuit.nuits.evenement).not.toBeNull();
    expect(gratuit.casino.solde).toBe(juges.casino.solde + gratuit.nuits.gain);
    // Jetons du Baron jusqu'au GRAND, pendant un free game : tout est versé d'un coup.
    forcer = { bonusJetons: { grand: true } };
    await attendre(380);
    const jetons = await emettre(a, 'casino_nuits', { mise: 1000 });
    forcer = undefined;
    expect(jetons.nuits.bonusJetons.grand).toBe(true);
    expect(jetons.nuits.gain).toBeGreaterThanOrEqual(1000 * 20_000);
    expect(jetons.casino.solde).toBe(gratuit.casino.solde + jetons.nuits.gain);
    a.close();
  });
});
