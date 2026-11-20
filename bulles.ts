/**
 * Les Bulles du Baron : machine « en cascade » (6 colonnes × 5 lignes, gains n'importe où).
 * 8 symboles identiques ou plus gagnent ; ils éclatent, d'autres tombent, et chaque nouvelle
 * cascade fait monter le multiplicateur. 4 Bulles Bonus : 10 tours gratuits où le multiplicateur
 * ne redescend pas. Tout se joue en dollars (jamais de rubis).
 */

export const COLONNES_BULLES = 6;
export const LIGNES_BULLES = 5;
export const MISES_BULLES = [1_000, 2_000, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 2_500_000, 5_000_000, 10_000_000];

export type SymboleBulles = 'couronne' | 'rubis' | 'perle' | 'bouteille' | 'coupe' | 'fraise' | 'bouchon' | 'joker' | 'bonus';
export const SYMBOLES_PAYANTS: SymboleBulles[] = ['couronne', 'rubis', 'perle', 'bouteille', 'coupe', 'fraise', 'bouchon'];

/** Poids de tirage de chaque case (réglés pour un retour moyen d'environ 95 %, voir bulles.test.ts). */
export const POIDS_BULLES: Record<SymboleBulles, number> = { couronne: 9, rubis: 10, perle: 10.5, bouteille: 11, coupe: 11.5, fraise: 12, bouchon: 12, joker: 0.3, bonus: 1.6 };
/** Gains en multiple de la mise, pour 8-9, 10-11 et 12 symboles ou plus. */
export const GAINS_BULLES: Record<string, [number, number, number]> = {
  couronne: [2.2, 5.5, 11],
  rubis: [0.6, 2, 5],
  perle: [0.4, 1, 3.4],
  bouteille: [0.35, 0.5, 2.5],
  coupe: [0.2, 0.4, 2],
  fraise: [0.16, 0.35, 1.6],
  bouchon: [0.1, 0.2, 1],
};
export const MIN_GROUPE = 8;
/** Le multiplicateur de chaque cascade (1re, 2e, 3e…). */
export const MULTIS_CASCADE = [1, 1, 2, 2, 3, 5, 8, 10, 15];
export const TOURS_BONUS = 10;
export const BULLES_POUR_BONUS = 4;
/** Plafond d'un tour (bonus compris), en multiple de la mise. */
export const GAIN_MAX_BULLES = 5_000;

export type GrilleBulles = SymboleBulles[][]; // [colonne][ligne], ligne 0 en haut

export interface EtapeBulles {
  grille: GrilleBulles;
  /** Cases qui éclatent : « colonne-ligne ». */
  eclats: string[];
  gain: number;
  multi: number;
}
export interface TourBulles {
  etapes: EtapeBulles[];
  gain: number;
  bonus: number; // nombre de Bulles Bonus sur la grille de départ
}
export interface ResultatBulles {
  tour: TourBulles;
  /** Les tours gratuits joués d'un coup si le bonus est déclenché. */
  gratuits: TourBulles[];
  gain: number;
  multiFinal: number;
}

const TOTAL = Object.values(POIDS_BULLES).reduce((a, b) => a + b, 0);
function tirerSymbole(hasard: () => number, sansBonus = false): SymboleBulles {
  let x = hasard() * (sansBonus ? TOTAL - POIDS_BULLES.bonus : TOTAL);
  for (const [s, p] of Object.entries(POIDS_BULLES) as [SymboleBulles, number][]) {
    if (sansBonus && s === 'bonus') continue;
    if ((x -= p) < 0) return s;
  }
  return 'bouchon';
}

const gainGroupe = (s: SymboleBulles, n: number) => {
  const g = GAINS_BULLES[s];
  if (!g || n < MIN_GROUPE) return 0;
  return n >= 12 ? g[2] : n >= 10 ? g[1] : g[0];
};

/** Les groupes gagnants d'une grille : chaque symbole payant compte avec les jokers. */
function analyser(grille: GrilleBulles) {
  const cases = new Map<SymboleBulles, string[]>();
  const jokers: string[] = [];
  grille.forEach((col, c) =>
    col.forEach((s, l) => {
      if (s === 'joker') jokers.push(`${c}-${l}`);
      else if (s !== 'bonus') cases.set(s, [...(cases.get(s) ?? []), `${c}-${l}`]);
    }),
  );
  let gain = 0;
  const eclats = new Set<string>();
  for (const s of SYMBOLES_PAYANTS) {
    const ici = cases.get(s) ?? [];
    if (!ici.length) continue;
    const n = ici.length + jokers.length;
    const g = gainGroupe(s, n);
    if (g > 0) {
      gain += g;
      ici.forEach((k) => eclats.add(k));
      jokers.forEach((k) => eclats.add(k));
    }
  }
  return { gain, eclats: [...eclats] };
}

/** Fait tomber les symboles restants et remplit par le haut. */
function cascade(grille: GrilleBulles, eclats: string[], hasard: () => number, sansBonus: boolean): GrilleBulles {
  const out = new Set(eclats);
  return grille.map((col, c) => {
    const restent = col.filter((_, l) => !out.has(`${c}-${l}`));
    const neufs = Array.from({ length: LIGNES_BULLES - restent.length }, () => tirerSymbole(hasard, sansBonus));
    return [...neufs, ...restent];
  });
}

const nouvelleGrille = (hasard: () => number, sansBonus = false): GrilleBulles =>
  Array.from({ length: COLONNES_BULLES }, () => Array.from({ length: LIGNES_BULLES }, () => tirerSymbole(hasard, sansBonus)));

/** Un tour complet (toutes ses cascades). « depart » : rang du multiplicateur au début (le bonus le garde). */
function jouerTour(mise: number, hasard: () => number, depart: number, enBonus: boolean): { tour: TourBulles; rang: number } {
  let grille = nouvelleGrille(hasard);
  const bonus = grille.flat().filter((s) => s === 'bonus').length;
  const etapes: EtapeBulles[] = [];
  let rang = depart;
  let gain = 0;
  for (let garde = 0; garde < 40; garde++) {
    const a = analyser(grille);
    if (!a.eclats.length) {
      etapes.push({ grille, eclats: [], gain: 0, multi: MULTIS_CASCADE[Math.min(rang, MULTIS_CASCADE.length - 1)] });
      break;
    }
    const multi = MULTIS_CASCADE[Math.min(rang, MULTIS_CASCADE.length - 1)];
    const g = Math.round(a.gain * mise * multi);
    gain += g;
    etapes.push({ grille, eclats: a.eclats, gain: g, multi });
    rang += 1;
    // Pas de nouvelle Bulle Bonus dans les cascades (seulement sur la grille de départ).
    grille = cascade(grille, a.eclats, hasard, true);
  }
  // Hors bonus, le multiplicateur repart de ×1 au tour suivant.
  return { tour: { etapes, gain, bonus }, rang: enBonus ? rang : 0 };
}

export function jouerBulles(mise: number, hasard: () => number): ResultatBulles {
  const premier = jouerTour(mise, hasard, 0, false);
  const gratuits: TourBulles[] = [];
  let gain = premier.tour.gain;
  let rang = 0;
  if (premier.tour.bonus >= BULLES_POUR_BONUS) {
    let restants = TOURS_BONUS;
    // Le multiplicateur démarre à ×2 dans le bonus, et ne redescend plus.
    rang = 1;
    while (restants > 0 && gratuits.length < 30) {
      restants -= 1;
      const t = jouerTour(mise, hasard, rang, true);
      rang = t.rang;
      gratuits.push(t.tour);
      gain += t.tour.gain;
      if (t.tour.bonus >= 3) restants += 5;
    }
  }
  gain = Math.min(gain, GAIN_MAX_BULLES * mise);
  return { tour: premier.tour, gratuits, gain, multiFinal: MULTIS_CASCADE[Math.min(rang, MULTIS_CASCADE.length - 1)] };
}
