import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authentificationTest, creerServiceComptes, stockageMemoire } from '../server/comptes';
import { demarrerServeur } from '../server/serveur';
import { SOLDE_DEPART, type AnnonceCasino } from '../shared/casino';
import {
  BONUS_BW,
  CASES_BW,
  choixDuBonusBW,
  conseilAiguillage,
  COMPOSITION_BW,
  DEGRES_CASE_BW,
  DUREES_BW,
  ETAGES_BRAQUAGE,
  etapesBonusBW,
  gainBW,
  GAINS_CHIFFRES_BW,
  NB_CASES_BW,
  recompenseBonusBW,
  ROUE_BW,
  rtpBW,
  evenementsBW,
  facteurMultiplicateursBW,
  prochainEvenementBW,
  simulerBW,
  tirerBonusBW,
  estBonusBW,
  multiplicateurDe,
  tirerTopSlotBW,
  boostsDuTopSlotBW,
  valeurRecompenseBW,
  VALEUR_JACKPOT_BW,
  type BoostBW,
  type CaseBW,
  type VueBW,
} from '../shared/baronWheel';

/** Un hasard reproductible (mulberry32). */
function graine(n: number) {
  let a = n >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('The Baron’s Wheel : les règles', () => {
  it('a exactement 30 cases de 12° (21 chiffres, 8 bonus et la case unique de l’Express), sans deux cases pareilles côte à côte', () => {
    expect(ROUE_BW).toHaveLength(NB_CASES_BW);
    expect(DEGRES_CASE_BW).toBe(12);
    for (const c of CASES_BW) expect(ROUE_BW.filter((x) => x === c)).toHaveLength(COMPOSITION_BW[c]);
    expect(Object.values(COMPOSITION_BW).reduce((s, x) => s + x, 0)).toBe(30);
    expect(ROUE_BW.filter((c) => estBonusBW(c))).toHaveLength(9);
    expect(ROUE_BW.filter((c) => c === 'express')).toHaveLength(1);
    for (let i = 0; i < 30; i++) expect(ROUE_BW[i]).not.toBe(ROUE_BW[(i + 1) % 30]);
  });

  it('est le jeu généreux du salon (calcul exact) : les petites cases rendent moins, les bonus davantage, l’Express bien plus', () => {
    const r = rtpBW();
    // Les petites cases (×2 et ×3) ont cédé une part de leur retour aux bonus ; ×5 et ×10 rendent environ 1,7 fois la mise.
    expect(r.x1).toBeCloseTo(1.515, 2);
    expect(r.x2).toBeCloseTo(1.515, 2);
    for (const c of ['x5', 'x10'] as const) {
      expect(r[c]).toBeGreaterThan(1.6);
      expect(r[c]).toBeLessThan(1.75);
    }
    // Ce que les petites cases ont perdu est rendu aux quatre bonus (environ 0,15 chacun) : 1,8 à 1,9 fois la mise.
    for (const c of ['baron', 'pickpocket', 'aiguillage', 'braquage'] as const) {
      expect(r[c]).toBeGreaterThan(1.8);
      expect(r[c]).toBeLessThan(1.9);
    }
    // L'Express, le bonus le plus généreux de la roue.
    for (const c of CASES_BW) if (c !== 'express') expect(r.express).toBeGreaterThan(1.8 * r[c]);
    expect(r.express).toBeLessThan(4.5);
  });

  it('tire au Top Slot une seule case par manche et un multiplicateur de ×2 à ×200', () => {
    const h = graine(21);
    const vus = new Set<number>();
    const cases = new Map<string, number>();
    const N = 20000;
    for (let k = 0; k < N; k++) {
      const t = tirerTopSlotBW(h);
      expect(t).toHaveLength(1);
      for (const x of t) {
        vus.add(x.x);
        cases.set(x.c, (cases.get(x.c) ?? 0) + 1);
      }
      // Toutes les cases de ce type sur la roue sont multipliées.
      const b = boostsDuTopSlotBW(t);
      expect(b.length).toBe(COMPOSITION_BW[t[0].c]);
      for (const x of b) expect(ROUE_BW[x.i]).toBe(t[0].c);
    }
    // Autant de chances pour chacune des 9 cases.
    for (const c of CASES_BW) expect((cases.get(c) ?? 0) / N).toBeCloseTo(1 / 9, 1);
    expect([...vus].sort((a, b) => a - b)).toEqual([2, 3, 5, 10, 20, 50, 100, 200]);
    expect(multiplicateurDe([{ i: 7, x: 25 }], 7)).toBe(25);
  });

  it('simule 100 000 manches : fréquences, retour, jackpots rares', () => {
    const s = simulerBW(100_000, graine(5));
    for (const c of CASES_BW) expect(s.frequences[c] / s.manches).toBeCloseTo(COMPOSITION_BW[c] / 30, 2);
    // Le Top Slot (jusqu'à ×200 sur une seule case) rend la simulation plus dispersée : la moyenne exacte est vérifiée
    // par le calcul plus haut.
    expect(s.retourTotal).toBeGreaterThan(1.6);
    expect(s.retourTotal).toBeLessThan(2.5);
    expect(s.jackpots.grand).toBeLessThan(s.jackpots.mini);
    expect(s.volatilite).toBeGreaterThan(1);
  });

  it('cache les récompenses dans les bonus et paie le choix du joueur', () => {
    const h = graine(9);
    for (let k = 0; k < 300; k++) {
      const p = tirerBonusBW('pickpocket', h);
      if (p.type !== 'pickpocket') throw new Error();
      expect(p.mallettes).toContain(p.butin);
      expect(p.mallettes.filter((x) => x === p.butin).length).toBeGreaterThanOrEqual(1);
      // Le Braquage : une seule perceuse, le même multiple pour tous ; un jackpot en plus au Coffre du Siècle.
      const b = tirerBonusBW('braquage', h);
      if (b.type !== 'braquage') throw new Error();
      expect([1, 2, 3, 4, 5]).toContain(b.etage);
      expect(b.jackpot !== null).toBe(b.etage === 5);
      const r = recompenseBonusBW(b, []);
      expect(r.x).toBe(ETAGES_BRAQUAGE[b.etage - 1]);
      expect(r.fixe ?? 0).toBe(b.jackpot ? VALEUR_JACKPOT_BW[b.jackpot] : 0);
      // Plus la perceuse descend, plus la descente dure ; au Coffre du Siècle, la descente entière.
      const etapes = etapesBonusBW('braquage', DUREES_BW, b);
      expect(etapes.map((e) => e.nom)).toEqual(['chargement', 'intro', 'descente', 'revele']);
      if (b.etage === 5) expect(etapes[2].duree).toBe(DUREES_BW.descente);
      else expect(etapes[2].duree < DUREES_BW.descente).toBe(true);
    }
    expect(choixDuBonusBW('braquage')).toEqual([]);
    expect(ETAGES_BRAQUAGE).toEqual([3, 6, 12, 30, 150]);
    // Le jackpot du Coffre du Siècle s'ajoute au multiple, que la roue multiplie (pas le jackpot).
    expect(valeurRecompenseBW({ x: 100, jackpot: 'grand', fixe: 500 }, 10)).toBe(1500);
    expect(valeurRecompenseBW({ x: 25, jackpot: 'mini' }, 10)).toBe(25);
    expect(valeurRecompenseBW({ x: 12 }, 5)).toBe(60);
    expect(etapesBonusBW('aiguillage').map((e) => e.nom)).toEqual(['chargement', 'intro', 'aiguille', 'trajet', 'aiguille', 'trajet', 'aiguille', 'trajet', 'terminus', 'revele']);
    expect(choixDuBonusBW('aiguillage')).toEqual([2, 2, 2]);
    // Chaque mini-jeu commence par son écran de chargement.
    for (const t of BONUS_BW) expect(etapesBonusBW(t)[0]).toMatchObject({ nom: 'chargement', choix: 0 });
    // L'Aiguillage : (1 + les trois primes) × le multiplicateur du terminus ; gauche, droite, droite → Istanbul (k = 2).
    const reseau = {
      type: 'aiguillage' as const,
      gares: [
        [2, 0],
        [1, 10, 3],
        [0, 2, 5, 1],
      ],
      eclairees: [
        [true, false],
        [true, false, true],
        [false, true, false, true],
      ],
      terminus: [1, 1.5, 2, 1.25],
    };
    expect(recompenseBonusBW(reseau, [0, 1, 1])).toEqual({ x: (1 + 2 + 10 + 5) * 2 });
    // L'aiguilleur vise le meilleur terminus en moyenne : Istanbul ×2 par la gare éclairée +3 (à droite, puis à droite).
    expect(conseilAiguillage(reseau, [])).toBe(1);
    expect(conseilAiguillage(reseau, [1])).toBe(1);
    expect(conseilAiguillage(reseau, [1, 1])).toBe(0);
    // Chaque aiguillage propose une gare éclairée et une gare sous bâche ; les terminus du milieu valent ×1,5 et ×2.
    for (let k = 0; k < 300; k++) {
      const t = tirerBonusBW('aiguillage', h);
      if (t.type !== 'aiguillage') throw new Error();
      t.eclairees.forEach((n) => n.forEach((e, i) => i > 0 && expect(e).not.toBe(n[i - 1])));
      expect([...t.terminus.slice(1, 3)].sort()).toEqual([1.5, 2]);
      expect([t.terminus[0], t.terminus[3]].sort()).toEqual([1, 1.25]);
    }
    expect(gainBW(25_000, 5)).toBe(125_000);
    // L'Express : 5 wagons, 2 décrochés au premier tunnel, 2 au second, un seul arrive ; rien sous ×10.
    for (let k = 0; k < 500; k++) {
      const t = tirerBonusBW('express', h);
      if (t.type !== 'express') throw new Error();
      expect(t.decroche.filter((d) => d === 0)).toHaveLength(2);
      expect(t.decroche.filter((d) => d === 1)).toHaveLength(2);
      expect(t.decroche.filter((d) => d === null)).toHaveLength(1);
      expect([...t.paris, ...t.venise, t.coffre].every((x) => x >= 10)).toBe(true);
      expect(t.coffre).toBeGreaterThanOrEqual(50);
      for (let w = 0; w < 5; w++) {
        const r = recompenseBonusBW(t, [w]);
        const d = t.decroche[w];
        expect(r.x).toBe(t.paris[w] + (d !== 0 ? t.venise[w] : 0) + (d === null ? t.coffre : 0));
        expect(r.x).toBeGreaterThanOrEqual(10);
      }
    }
    expect(choixDuBonusBW('express')).toEqual([5]);
    expect(gainBW(1_000, 3.3)).toBe(3_300);
  });
});

// ---------- En direct ----------


describe('The Baron Express : les événements de la gare', () => {
  it('à l’heure de pointe, au moins ×5, sans changer ce que rend la roue', () => {
    expect(Math.abs(facteurMultiplicateursBW(true) / facteurMultiplicateursBW() - 1)).toBeLessThan(0.01);
    let k = 0;
    const h = () => ((k = (k * 9301 + 49297) % 233280) / 233280);
    for (let j = 0; j < 200; j++) {
      const t = tirerTopSlotBW(h, true);
      expect(t).toHaveLength(1);
      expect(t[0].x).toBeGreaterThanOrEqual(5);
    }
  });

  it('l’heure de pointe chaque soir à 19 h, le Grand Départ le week-end de 18 h à 22 h (heure de Paris)', () => {
    // Mardi 24 novembre 2026, 19 h 30 à Paris (18 h 30 UTC).
    const mardi = Date.UTC(2026, 10, 24, 18, 30);
    expect(evenementsBW(mardi).map((e) => e.type)).toEqual(['pointe']);
    expect(evenementsBW(mardi)[0].reste).toBe(30 * 60_000);
    expect(evenementsBW(Date.UTC(2026, 10, 24, 17, 30))).toEqual([]);
    expect(prochainEvenementBW(Date.UTC(2026, 10, 24, 17, 45))).toEqual({ type: 'pointe', dans: 15 * 60_000 });
    // Samedi 28 novembre 2026 : Grand Départ de 18 h à 22 h, l’heure de pointe en même temps à 19 h.
    expect(evenementsBW(Date.UTC(2026, 10, 28, 17, 0)).map((e) => e.type)).toEqual(['depart']);
    expect(evenementsBW(Date.UTC(2026, 10, 28, 18, 10)).map((e) => e.type).sort()).toEqual(['depart', 'pointe']);
    expect(evenementsBW(Date.UTC(2026, 10, 27, 17, 0)).map((e) => e.type)).toEqual([]);
    expect(prochainEvenementBW(Date.UTC(2026, 10, 29, 16, 20))?.type).toBe('depart');
  });
});

const identites = {
  'jeton-a': { uid: 'uid-a', nom: 'Lucas', email: 'a@gmail.com' },
  'jeton-b': { uid: 'uid-b', nom: 'Léa', email: 'b@gmail.com' },
  'jeton-n': { uid: 'uid-n', nom: 'Nina', email: 'n@gmail.com' },
};
const service = creerServiceComptes({ configWeb: { apiKey: 'cle', authDomain: 'test.firebaseapp.com', projectId: 'test' }, authentification: authentificationTest(identites), stockage: stockageMemoire() });
let serveur: Awaited<ReturnType<typeof demarrerServeur>>;
let arretImpose: number | undefined;
/** Les multiplicateurs des prochaines manches ([] : aucun ; undefined : au hasard). */
let multiplicateursImposes: BoostBW[] | undefined = [];
let ouverture: number | null = null;
const indice = (c: CaseBW, k = 0) => ROUE_BW.map((x, i) => (x === c ? i : -1)).filter((i) => i >= 0)[k];
const connecter = () => io(`http://localhost:${serveur.port}`, { transports: ['websocket'], forceNew: true });
function emettre(s: Socket, evt: string, data?: unknown): Promise<any> {
  return new Promise((ok) => s.emit(evt, data, ok));
}
function attendre(s: Socket, cond: (v: VueBW) => boolean, ms = 12_000): Promise<VueBW> {
  return new Promise((ok, ko) => {
    const t = setTimeout(() => ko(new Error('vue attendue jamais reçue')), ms);
    const f = (v: VueBW) => {
      if (!cond(v)) return;
      clearTimeout(t);
      s.off('casino_bw', f);
      ok(v);
    };
    s.on('casino_bw', f);
  });
}
const pause = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const etape = (v: VueBW) => (v.bonus ? v.bonus.etapes[v.bonus.etape].nom : null);
/** Attend l'ouverture des mises d'une nouvelle manche, avec du temps devant soi. */
async function nouvelleManche(a: Socket, apres = 0) {
  return attendre(a, (x) => x.phase === 'mises' && x.numero > apres && (x.reste ?? 0) > 500);
}

beforeAll(async () => {
  for (const id of Object.values(identites)) await service.preparer(id.uid, id.nom);
  await service.donnerBadgeCreateur('uid-a');
  await service.donnerBadgeCreateur('uid-b');
  await service.entrerCasino('uid-a');
  await service.mouvementCasino('uid-a', 30_000_000);
  serveur = await demarrerServeur({
    port: 0,
    servirClient: false,
    comptes: service,
    casino: {
      jeuALaffiche: () => null,
      cadeaux: [],
      delaiEcriture: 30,
      delaisBaronWheel: { mises: 900, multiplicateurs: 120, tour: 250, resultat: 300, chargement: 80, intro: 80, choix: 700, descente: 400, vol: 80, poursuite: 80, revele: 150, introExpress: 80, introBraquage: 80, introEvasion: 80, introAiguillage: 80, aiguille: 700, trajet: 80, terminus: 80, introDonne: 80, donne: 80, reveleDonne: 150, introPick: 80, revelePick: 150, gare: 150, tunnel: 150, traversee: 80, arrivee: 150 },
      arretBaronWheel: () => arretImpose,
      multiplicateursBaronWheel: () => multiplicateursImposes,
      ouvertureBaronWheel: () => ouverture,
    },
  });
});
afterAll(async () => {
  await serveur.fermer();
});

describe('The Baron’s Wheel en direct', () => {
  it('reste introuvable sans badge Créateur', async () => {
    const n = connecter();
    await emettre(n, 'identifier', { jeton: 'jeton-n' });
    for (const evt of ['casino_bw_entrer', 'casino_bw_miser', 'casino_bw_annuler', 'casino_bw_doubler', 'casino_bw_refaire', 'casino_bw_choisir', 'casino_bw_journal']) {
      expect((await emettre(n, evt, { case: 'x1', montant: 1000 })).erreur).toBe('Introuvable.');
    }
    n.close();
  });

  it('prend les mises, s’arrête sur la case tirée et paie les chiffres', async () => {
    const a = connecter();
    await emettre(a, 'identifier', { jeton: 'jeton-a' });
    expect((await emettre(a, 'casino_bw_entrer')).ok).toBe(false); // pas encore au salon
    await emettre(a, 'casino_entrer');
    const e = await emettre(a, 'casino_bw_entrer');
    expect(e.ok).toBe(true);
    let v: VueBW = e.roue;
    if (v.phase !== 'mises' || (v.reste ?? 0) < 500) v = await nouvelleManche(a);
    expect(v.arret).toBeNull();
    expect(v.multiplicateurs).toBeNull(); // posés seulement une fois les mises fermées
    expect((await emettre(a, 'casino_bw_miser', { case: 'x5', montant: 1234 })).erreur).toMatch(/Jeton/);
    expect((await emettre(a, 'casino_bw_miser', { case: 'x3', montant: 1000 })).erreur).toMatch(/introuvable/);
    // Plafonds : 30 000 000 $ par case et par manche.
    for (let k = 0; k < 3; k++) await emettre(a, 'casino_bw_miser', { case: 'x1', montant: 10_000_000 });
    expect((await emettre(a, 'casino_bw_miser', { case: 'x1', montant: 1_000 })).erreur).toMatch(/30 000 000 \$ sur une même case/);
    await emettre(a, 'casino_bw_annuler');
    expect((await emettre(a, 'casino_bw_miser', { case: 'x2', montant: 10_000_000 })).ok).toBe(true);
    expect((await emettre(a, 'casino_bw_miser', { case: 'x5', montant: 1_000 })).erreur).toMatch(/30 000 000 \$ par manche/);
    await emettre(a, 'casino_bw_annuler', { tout: true });
    // Tout est rendu (le million misé a pu faire passer un niveau du salon : son bonus reste acquis).
    const base = (await emettre(a, 'casino_vue')).casino.solde;
    expect(base).toBeGreaterThanOrEqual(v.solde);
    // 25 000 $ sur le 5X, 5 000 $ sur le Baron ; la roue s'arrêtera sur un 5X.
    arretImpose = indice('x5', 2);
    await emettre(a, 'casino_bw_miser', { case: 'x5', montant: 25_000 });
    await emettre(a, 'casino_bw_miser', { case: 'baron', montant: 5_000 });
    await emettre(a, 'casino_bw_miser', { case: 'x10', montant: 1_000 });
    await emettre(a, 'casino_bw_annuler'); // retire le dernier jeton (le 10X)
    const pose = await attendre(a, (x) => x.phase === 'multiplicateurs');
    expect(pose.multiplicateurs).toEqual([]);
    expect(pose.arret).toBeNull(); // la case d'arrêt reste secrète
    const tour = await attendre(a, (x) => x.phase === 'tour');
    expect(tour.mesMises).toEqual({ x5: 25_000, baron: 5_000 });
    expect((await emettre(a, 'casino_bw_miser', { case: 'x1', montant: 1_000 })).erreur).toMatch(/fermées/);
    // La roue tourne de 5 tours et plus, et s'arrête avec la case tirée sous l'aiguille.
    expect(tour.tour!.arrivee - tour.tour!.depart).toBeGreaterThanOrEqual(5 * 360);
    const sous = Math.floor((((-tour.tour!.arrivee % 360) + 360) % 360) / DEGRES_CASE_BW);
    expect(sous).toBe(arretImpose);
    expect(tour.arret).toBe(arretImpose);
    const res = await attendre(a, (x) => x.phase === 'resultat');
    expect(res.bonus).toBeNull();
    expect(res.bilan).toEqual({ mise: 30_000, gain: gainBW(25_000, GAINS_CHIFFRES_BW.x5) });
    expect(res.solde).toBe(base - 30_000 + 125_000);
    expect(res.historique[0]).toEqual({ c: 'x5' });
    const j = await emettre(a, 'casino_bw_journal');
    expect(j.journal.manches[0]).toMatchObject({ c: 'x5', mise: 30_000, gain: 125_000, solde: res.solde });
    expect(j.journal.moi).toMatchObject({ manches: 1, mise: 30_000, gain: 125_000 });
    // Manche suivante : Refaire, puis Doubler.
    const v2 = await nouvelleManche(a, res.numero);
    expect(v2.peutRefaire).toBe(true);
    arretImpose = indice('x1');
    expect((await emettre(a, 'casino_bw_refaire')).ok).toBe(true);
    expect((await emettre(a, 'casino_bw_doubler')).ok).toBe(true);
    const r2 = await attendre(a, (x) => x.phase === 'resultat' && x.numero === v2.numero);
    expect(r2.bilan).toEqual({ mise: 60_000, gain: 0 });
    a.close();
  }, 30_000);

  it('joue le Pickpocket : la récompense reste cachée jusqu’à la fin, chacun choisit sa mallette', async () => {
    const a = connecter();
    const b = connecter();
    await emettre(a, 'identifier', { jeton: 'jeton-a' });
    await emettre(b, 'identifier', { jeton: 'jeton-b' });
    await emettre(a, 'casino_entrer');
    await emettre(b, 'casino_entrer');
    await emettre(a, 'casino_bw_entrer');
    await emettre(b, 'casino_bw_entrer');
    const v = await nouvelleManche(a);
    arretImpose = indice('pickpocket', 1);
    // Un ×5 sur cette case Pickpocket : toutes ses mallettes valent 5 fois plus.
    multiplicateursImposes = [
      { i: arretImpose, x: 5 },
      { i: indice('x1'), x: 2 },
      { i: indice('x10'), x: 50 },
    ];
    await emettre(a, 'casino_bw_miser', { case: 'pickpocket', montant: 100_000 });
    await emettre(b, 'casino_bw_miser', { case: 'pickpocket', montant: 5_000 });
    await emettre(b, 'casino_bw_miser', { case: 'x2', montant: 5_000 });
    const vol = await attendre(a, (x) => etape(x) === 'vol');
    expect(vol.bonus!.butin).toBeGreaterThanOrEqual(20);
    expect(vol.bonus!.multiplicateur).toBe(5);
    expect(vol.bonus!.mallettes).toEqual([null, null, null]);
    expect((await emettre(a, 'casino_bw_choisir', { etape: vol.bonus!.etape, choix: 0 })).erreur).toMatch(/Trop tard/);
    const choix = await attendre(a, (x) => etape(x) === 'mallettes');
    expect(choix.bonus!.mallettes).toEqual([null, null, null]); // toujours cachées pendant le choix
    expect((await emettre(a, 'casino_bw_choisir', { etape: choix.bonus!.etape, choix: 3 })).erreur).toMatch(/impossible/);
    expect((await emettre(a, 'casino_bw_choisir', { etape: choix.bonus!.etape, choix: 2 })).ok).toBe(true);
    expect((await emettre(a, 'casino_bw_choisir', { etape: choix.bonus!.etape, choix: 1 })).erreur).toMatch(/déjà/);
    // Léa ne choisit pas : le serveur choisira pour elle.
    const revele = await attendre(a, (x) => etape(x) === 'revele');
    const mallettes = revele.bonus!.mallettes as number[];
    expect(mallettes).toContain(vol.bonus!.butin);
    expect(revele.bonus!.mesChoix).toEqual([2]);
    expect(revele.bonus!.resultat).toMatchObject({ x: mallettes[2] * 5, gain: gainBW(100_000, mallettes[2] * 5) });
    const fin = await attendre(a, (x) => x.phase === 'resultat' && x.numero === v.numero);
    expect(etape(fin)).toBe('revele'); // pendant les résultats, le bonus reste sur sa révélation
    expect(fin.bilan).toEqual({ mise: 100_000, gain: gainBW(100_000, mallettes[2] * 5) });
    expect(fin.historique[0]).toEqual({ c: 'pickpocket', x: 5 });
    const finB = (await emettre(b, 'casino_bw_journal')).journal.manches[0];
    expect([0, 1, 2].map((k) => gainBW(5_000, mallettes[k] * 5))).toContain(finB.gain);
    multiplicateursImposes = [];
    expect(fin.joueurs.map((x) => x.nom).sort()).toEqual(['Lucas', 'Léa']);
    a.close();
    b.close();
  }, 30_000);

  it('joue le Braquage : une seule perceuse pour tout le salon, le même multiple pour tous', async () => {
    const a = connecter();
    await emettre(a, 'identifier', { jeton: 'jeton-a' });
    await emettre(a, 'casino_entrer');
    await emettre(a, 'casino_bw_entrer');
    const v = await nouvelleManche(a);
    arretImpose = indice('braquage', 1);
    await emettre(a, 'casino_bw_miser', { case: 'braquage', montant: 25_000 });
    // L'intro ne dit rien de la descente ; la perceuse partie, tout est connu (aucun choix à faire).
    const intro = await attendre(a, (y) => etape(y) === 'intro');
    expect(intro.bonus!.casse).toBeNull();
    const descente = await attendre(a, (y) => etape(y) === 'descente');
    const c = descente.bonus!.casse!;
    expect([1, 2, 3, 4, 5]).toContain(c.etage);
    expect(descente.bonus!.mesChoix).toEqual([]);
    expect((await emettre(a, 'casino_bw_choisir', { etape: descente.bonus!.etape, choix: 0 })).ok).toBe(false);
    const fin = await attendre(a, (x) => x.phase === 'resultat' && x.numero === v.numero);
    const bz = fin.bonus!;
    const x = valeurRecompenseBW({ x: ETAGES_BRAQUAGE[c.etage - 1], ...(c.jackpot ? { jackpot: c.jackpot, fixe: VALEUR_JACKPOT_BW[c.jackpot] } : {}) }, bz.multiplicateur);
    expect(bz.resultat).toMatchObject({ x, gain: gainBW(25_000, x) });
    expect(fin.bilan).toEqual({ mise: 25_000, gain: gainBW(25_000, x) });
    a.close();
  }, 30_000);

  it('joue l’Express du Baron : le voyage se révèle gare après gare, un seul wagon arrive à Istanbul', async () => {
    const a = connecter();
    const b = connecter();
    await emettre(a, 'identifier', { jeton: 'jeton-a' });
    await emettre(b, 'identifier', { jeton: 'jeton-b' });
    await emettre(a, 'casino_entrer');
    await emettre(b, 'casino_entrer');
    await emettre(a, 'casino_bw_entrer');
    await emettre(b, 'casino_bw_entrer');
    const v = await nouvelleManche(a);
    arretImpose = indice('express');
    // Un ×10 de la roue sur l'Express : tout le voyage vaut 10 fois plus.
    multiplicateursImposes = [
      { i: arretImpose, x: 10 },
      { i: indice('x1'), x: 2 },
      { i: indice('x2'), x: 3 },
    ];
    await emettre(a, 'casino_bw_miser', { case: 'express', montant: 100_000 });
    await emettre(b, 'casino_bw_miser', { case: 'express', montant: 5_000 });
    const choix = await attendre(a, (x) => etape(x) === 'wagons');
    expect(choix.bonus!.multiplicateur).toBe(10);
    expect(choix.bonus!.express).toEqual({ paris: [null, null, null, null, null], venise: [null, null, null, null, null], decroches: [null, null, null, null, null], coffre: null, gagnant: null });
    expect((await emettre(a, 'casino_bw_choisir', { etape: choix.bonus!.etape, choix: 5 })).erreur).toMatch(/impossible/);
    expect((await emettre(a, 'casino_bw_choisir', { etape: choix.bonus!.etape, choix: 3 })).ok).toBe(true);
    // Paris : le butin de départ de chaque wagon, rien d'autre.
    const paris = await attendre(a, (x) => etape(x) === 'paris');
    expect(paris.bonus!.express!.paris.every((x) => x !== null && x >= 10)).toBe(true);
    expect(paris.bonus!.express!.venise.every((x) => x === null)).toBe(true);
    expect(paris.bonus!.express!.decroches.every((x) => x === null)).toBe(true);
    // Premier tunnel : deux wagons décrochés.
    const t1 = await attendre(a, (x) => etape(x) === 'tunnel1');
    expect(t1.bonus!.express!.decroches.filter((d) => d === 0)).toHaveLength(2);
    expect(t1.bonus!.express!.coffre).toBeNull();
    // Venise : seuls les wagons encore attachés ouvrent un coffre.
    const venise = await attendre(a, (x) => etape(x) === 'venise');
    const ve = venise.bonus!.express!;
    ve.decroches.forEach((d, k) => expect(ve.venise[k] === null).toBe(d === 0));
    const t2 = await attendre(a, (x) => etape(x) === 'tunnel2');
    expect(t2.bonus!.express!.decroches.filter((d) => d !== null)).toHaveLength(4);
    expect(t2.bonus!.express!.gagnant).toBeNull();
    // Istanbul : le dernier wagon ouvre le Coffre du Baron.
    const ist = await attendre(a, (x) => etape(x) === 'istanbul');
    const ex = ist.bonus!.express!;
    expect(ex.gagnant).toBe(ex.decroches.findIndex((d) => d === null));
    expect(ex.coffre).toBeGreaterThanOrEqual(25);
    const fin = await attendre(a, (x) => x.phase === 'resultat' && x.numero === v.numero);
    const brut = ex.paris[3]! + (ex.decroches[3] !== 0 ? ex.venise[3]! : 0) + (ex.gagnant === 3 ? ex.coffre! : 0);
    expect(fin.bonus!.resultat).toMatchObject({ x: brut * 10, gain: gainBW(100_000, brut * 10) });
    expect(fin.bilan).toEqual({ mise: 100_000, gain: gainBW(100_000, brut * 10) });
    expect(fin.historique[0]).toEqual({ c: 'express', x: 10 });
    // Léa n'a pas choisi : le serveur lui a donné un wagon.
    const lea = (await emettre(b, 'casino_bw_journal')).journal;
    expect(lea.manches[0].gain).toBeGreaterThanOrEqual(gainBW(5_000, 100));
    expect(lea.moi.bonus.express).toBe(1);
    multiplicateursImposes = [];
    a.close();
    b.close();
  }, 30_000);

  it('paie un chiffre multiplié, sans multiplicateur doré pendant la grande ouverture', async () => {
    const a = connecter();
    const annonces: AnnonceCasino[] = [];
    await emettre(a, 'identifier', { jeton: 'jeton-a' });
    a.on('casino_annonce', (x: AnnonceCasino) => annonces.push(x));
    await emettre(a, 'casino_entrer');
    await emettre(a, 'casino_bw_entrer');
    // Un ×50 sur un 10X : 100 000 $ misés rapportent 100 000 × 10 × 50.
    const v = await nouvelleManche(a);
    arretImpose = indice('x10', 1);
    multiplicateursImposes = [
      { i: arretImpose, x: 50 },
      { i: indice('baron'), x: 3 },
      { i: indice('x1', 4), x: 2 },
    ];
    await emettre(a, 'casino_bw_miser', { case: 'x10', montant: 100_000 });
    const fin = await attendre(a, (x) => x.phase === 'resultat' && x.numero === v.numero);
    expect(fin.multiplicateurs).toHaveLength(3);
    expect(fin.bilan).toEqual({ mise: 100_000, gain: 50_000_000 });
    expect(fin.historique[0]).toEqual({ c: 'x10', x: 50 });
    await pause(50);
    expect(annonces.some((x) => x.jeu === 'baronWheel' && x.gain === 50_000_000)).toBe(true);

    // Grande ouverture : les multiplicateurs tirés au hasard (3 à 7, ×5 au moins), sans multiplicateur doré.
    ouverture = Date.now() + 3_600_000;
    multiplicateursImposes = undefined;
    arretImpose = undefined;
    expect((await emettre(a, 'casino_vue')).casino.baronWheel.ouverture).toBeGreaterThan(3_500_000);
    const v2 = await nouvelleManche(a, fin.numero);
    expect(v2.ouverture).toBeGreaterThan(0);
    const pose = await attendre(a, (x) => x.phase === 'multiplicateurs' && x.numero === v2.numero);
    expect(pose.multiplicateurs!.length).toBeGreaterThanOrEqual(3);
    expect(pose.multiplicateurs!.length).toBeLessThanOrEqual(8);
    expect(pose.multiplicateurs!.every((b) => b.x >= 5 && !('dore' in b))).toBe(true);
    ouverture = null;
    multiplicateursImposes = [];
    expect(SOLDE_DEPART).toBeGreaterThan(0);
    a.close();
  }, 40_000);
});
