/**
 * The Baron's Wheel (Salon privé) : une roue géante de 40 cases, en direct pour tout le salon, avec quatre bonus.
 *
 * Une manche : mises (15 s) → les multiplicateurs (3 cases de la roue, au hasard, ×2 à ×50) → la roue tourne (8 s) →
 * le résultat. Si la roue s'arrête sur un bonus, son mini-jeu commence ; ceux qui ont misé sur ce bonus font leurs
 * choix (chacun les siens), les autres regardent.
 *
 * - La roue : 12 cases « 1X », 9 « 2X », 6 « 5X », 3 « 10X », 3 BARON, 2 PICKPOCKET, 2 GRANDE ÉVASION, 3 BRAQUAGE.
 *   Toutes les cases ont la même chance (1 sur 40). Les cases chiffres paient ×2,5, ×3,3, ×5 et ×10 (mise comprise) ;
 *   les bonus, plus rares, paient gros (×5 à ×500).
 * - Les multiplicateurs : une fois les mises fermées, 3 cases de la roue reçoivent un multiplicateur (×2 à ×50). Si la
 *   roue s'arrête sur l'une d'elles, ses gains sont multipliés (pour un bonus : tous ses multiplicateurs, sauf les
 *   jackpots, qui restent fixes). Chaque mise rend environ 95 % en moyenne, comme les autres jeux du salon.
 * - Tout est tiré par le serveur avant les animations : la case d'arrêt au départ de la roue, et toutes les récompenses
 *   cachées d'un bonus dès qu'il commence. Les choix du joueur désignent l'une de ces récompenses cachées ; aucune
 *   animation ne décide de rien.
 * - Les jackpots (MINI ×25, MINOR ×50, MAJOR ×100, GRAND ×500 la mise) sont des récompenses fixes, rares, cachées dans
 *   les bonus du Baron et du Braquage. Ils ne sont pas progressifs.
 * - Grande ouverture (la première semaine) : à chaque manche, une 4e case reçoit un multiplicateur doré ×2.
 */

// ---------------------------------------------------------------------------------------------------------------
// La roue

export type ChiffreBW = 'x1' | 'x2' | 'x5' | 'x10';
export type BonusBW = 'baron' | 'pickpocket' | 'evasion' | 'braquage';
export type CaseBW = ChiffreBW | BonusBW;
export const CHIFFRES_BW: ChiffreBW[] = ['x1', 'x2', 'x5', 'x10'];
export const BONUS_BW: BonusBW[] = ['baron', 'pickpocket', 'evasion', 'braquage'];
export const CASES_BW: CaseBW[] = [...CHIFFRES_BW, ...BONUS_BW];
export const estBonusBW = (c: CaseBW): c is BonusBW => (BONUS_BW as string[]).includes(c);

/** Combien de cases de chaque sorte sur la roue (40 en tout). */
export const COMPOSITION_BW: Record<CaseBW, number> = { x1: 12, x2: 9, x5: 6, x10: 3, baron: 3, pickpocket: 2, evasion: 2, braquage: 3 };
export const NB_CASES_BW = 40;
export const DEGRES_CASE_BW = 360 / NB_CASES_BW;
/**
 * L'ordre des 40 cases, dans le sens des aiguilles d'une montre depuis le haut (la roue ne change jamais) : trois
 * chiffres, un bonus, trois chiffres, un bonus… Jamais deux cases pareilles côte à côte, les 10X bien répartis.
 */
export const ROUE_BW: CaseBW[] = (() => {
  const chiffres: ChiffreBW[][] = [
    ['x1', 'x2', 'x1'],
    ['x5', 'x1', 'x2'],
    ['x1', 'x10', 'x2'],
    ['x5', 'x1', 'x2'],
    ['x1', 'x5', 'x1'],
    ['x2', 'x10', 'x1'],
    ['x5', 'x2', 'x1'],
    ['x2', 'x5', 'x1'],
    ['x10', 'x1', 'x2'],
    ['x5', 'x1', 'x2'],
  ];
  const bonus: BonusBW[] = ['baron', 'braquage', 'pickpocket', 'evasion', 'baron', 'braquage', 'pickpocket', 'evasion', 'baron', 'braquage'];
  return chiffres.flatMap((g, i): CaseBW[] => [...g, bonus[i]]);
})();

/** Ce que paie une case chiffre (mise comprise) : ×2,5 pour 1 000 $ misés sur le 1X, 2 500 $ reçus. */
export const GAINS_CHIFFRES_BW: Record<ChiffreBW, number> = { x1: 2.5, x2: 3.3, x5: 5, x10: 10 };

/** Les mises : jetons, plafond par case et par manche. */
export const JETONS_BW = [1_000, 5_000, 25_000, 100_000, 500_000];
export const MAX_CASE_BW = 1_000_000;
export const MAX_MANCHE_BW = 4_000_000;

// ---------------------------------------------------------------------------------------------------------------
// Les multiplicateurs : 3 cases de la roue, tirées une fois les mises fermées

export const NB_MULTIPLICATEURS_BW = 3;
/** Les multiplicateurs possibles, et leur poids. */
export const MULTIPLICATEURS_BW: [number, number][] = [
  [2, 48],
  [3, 26],
  [5, 14],
  [10, 8],
  [25, 3],
  [50, 1],
];
/** Une case de la roue (son indice, 0 à 39) et son multiplicateur ; dorée : le ×2 de la grande ouverture. */
export interface BoostBW {
  i: number;
  x: number;
  dore?: true;
}

// ---------------------------------------------------------------------------------------------------------------
// Les jackpots et les tables de récompenses

export type JackpotBW = 'mini' | 'minor' | 'major' | 'grand';
export const JACKPOTS_BW: JackpotBW[] = ['mini', 'minor', 'major', 'grand'];
/** Ce que paie chaque jackpot (fois la mise du bonus, mise comprise). */
export const VALEUR_JACKPOT_BW: Record<JackpotBW, number> = { mini: 25, minor: 50, major: 100, grand: 500 };

/** Une récompense : un multiplicateur (mise comprise), éventuellement un jackpot (son multiplicateur fixe). */
export interface RecompenseBW {
  x: number;
  jackpot?: JackpotBW;
}
/** Une table pondérée : [valeur, poids]. */
export type TableBW<T> = [T, number][];
export type Hasard = () => number;

export function tirerTable<T>(t: TableBW<T>, h: Hasard): T {
  const total = t.reduce((s, [, p]) => s + p, 0);
  let u = h() * total;
  for (const [v, p] of t) {
    if (u < p) return v;
    u -= p;
  }
  return t[t.length - 1][0];
}
export const esperanceTable = (t: TableBW<number>) => t.reduce((s, [v, p]) => s + v * p, 0) / t.reduce((s, [, p]) => s + p, 0);
const jackpot = (j: JackpotBW): RecompenseBW => ({ x: VALEUR_JACKPOT_BW[j], jackpot: j });
const esperanceRecompenses = (t: TableBW<RecompenseBW>) => t.reduce((s, [r, p]) => s + r.x * p, 0) / t.reduce((s, [, p]) => s + p, 0);
/** Remplace la valeur « jackpot » d'une table par le jackpot tiré dans une seconde table. */
function avecJackpots(t: TableBW<number | 'jackpot'>, jackpots: TableBW<JackpotBW>): TableBW<RecompenseBW> {
  const total = jackpots.reduce((s, [, p]) => s + p, 0);
  return t.flatMap(([v, p]): TableBW<RecompenseBW> => (v === 'jackpot' ? jackpots.map(([j, q]) => [jackpot(j), (p * q) / total]) : [[{ x: v }, p]]));
}

/** LE CHOIX DU BARON : trois cartes dorées, chacune tirée dans cette table (la carte secrète cache un jackpot). */
export const CARTES_BARON: TableBW<number | 'jackpot'> = [
  [5, 4700],
  [7, 2100],
  [10, 1400],
  [15, 850],
  [25, 500],
  [50, 250],
  [100, 75],
  ['jackpot', 125],
];
export const JACKPOTS_BARON: TableBW<JackpotBW> = [
  ['mini', 7000],
  ['minor', 2200],
  ['major', 700],
  ['grand', 100],
];
export const TABLE_CARTES_BARON = avecJackpots(CARTES_BARON, JACKPOTS_BARON);

/** THE BIG THEFT : le Pickpocket vole un gros multiplicateur et le cache dans l'une des trois mallettes ; les deux autres gardent un petit. */
export const BUTIN_PICKPOCKET: TableBW<number> = [
  [20, 3600],
  [25, 2200],
  [30, 1700],
  [50, 1500],
  [100, 750],
  [200, 250],
];
export const PETITES_MALLETTES: TableBW<number> = [
  [2, 3000],
  [3, 3500],
  [5, 2500],
  [7, 1000],
];

/** LA COURSE-POURSUITE : trois itinéraires ; plus le risque d'arrestation est grand, plus le butin l'est aussi. */
export type RouteBW = 'boulevard' | 'ruelles' | 'souterrains';
export const ROUTES_BW: RouteBW[] = ['boulevard', 'ruelles', 'souterrains'];
export const ITINERAIRES_BW: Record<RouteBW, { arrestation: number; gains: TableBW<number> }> = {
  boulevard: {
    arrestation: 0.08,
    gains: [
      [10, 3000],
      [15, 3500],
      [20, 2500],
      [30, 1000],
    ],
  },
  ruelles: {
    arrestation: 0.61,
    gains: [
      [20, 3500],
      [30, 3000],
      [50, 2500],
      [100, 1000],
    ],
  },
  souterrains: {
    arrestation: 0.875,
    gains: [
      [50, 4000],
      [100, 3500],
      [200, 2000],
      [500, 500],
    ],
  },
};
export interface IssueRouteBW {
  evade: boolean;
  /** Le butin du Baron s'il s'évade (et celui qu'il aurait eu s'il est arrêté). */
  x: number;
}

/**
 * THE VAULT : trois serrures. 1. Le code : trois combinaisons (×1, ×2, ×3). 2. Le mécanisme : un cadran de 8 zones
 * cachées (×1 à ×5) qu'on arrête au jugé. 3. Le coffre : quatre compartiments (×1 à ×25) ; leur trésor est multiplié
 * par les deux serrures, jusqu'à ×375 (sauf un jackpot, qui paie sa valeur fixe).
 */
export const CODES_BRAQUAGE = [1, 2, 3];
export const ZONES_MECANISME = [1, 1, 1, 1, 2, 2, 3, 5];
export const COFFRES_BRAQUAGE: TableBW<number | 'jackpot'> = [
  [1, 4680],
  [2, 2800],
  [3, 1300],
  [5, 650],
  [10, 320],
  [25, 80],
  ['jackpot', 170],
];
export const JACKPOTS_BRAQUAGE: TableBW<JackpotBW> = [
  ['mini', 5000],
  ['minor', 3000],
  ['major', 1500],
  ['grand', 500],
];
export const TABLE_COFFRES_BRAQUAGE = avecJackpots(COFFRES_BRAQUAGE, JACKPOTS_BRAQUAGE);

/** Les multiplicateurs d'une manche : 3 cases différentes (et une 4e, dorée ×2, pendant la grande ouverture). */
export function tirerMultiplicateursBW(h: Hasard, ouverture = false): BoostBW[] {
  const cases = melanger(
    Array.from({ length: NB_CASES_BW }, (_, i) => i),
    h,
  );
  const r: BoostBW[] = cases.slice(0, NB_MULTIPLICATEURS_BW).map((i) => ({ i, x: tirerTable(MULTIPLICATEURS_BW, h) }));
  if (ouverture) r.push({ i: cases[NB_MULTIPLICATEURS_BW], x: 2, dore: true });
  return r;
}
/** Le multiplicateur d'une case de la roue (1 si elle n'en a pas). */
export const multiplicateurDe = (boosts: BoostBW[] | null | undefined, i: number | null) => (i === null ? 1 : (boosts?.find((b) => b.i === i)?.x ?? 1));

// ---------------------------------------------------------------------------------------------------------------
// Les tirages des bonus (tout est caché dans le tirage dès que le bonus commence)

export type TirageBonusBW =
  | { type: 'baron'; cartes: RecompenseBW[] }
  | { type: 'pickpocket'; butin: number; mallettes: number[] }
  | { type: 'evasion'; routes: IssueRouteBW[] }
  | { type: 'braquage'; code: number[]; meca: number[]; coffre: RecompenseBW[] };

function melanger<T>(t: T[], h: Hasard): T[] {
  const r = [...t];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(h() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

export function tirerBonusBW(type: BonusBW, h: Hasard): TirageBonusBW {
  switch (type) {
    case 'baron':
      return { type, cartes: [0, 1, 2].map(() => tirerTable(TABLE_CARTES_BARON, h)) };
    case 'pickpocket': {
      const butin = tirerTable(BUTIN_PICKPOCKET, h);
      return { type, butin, mallettes: melanger([butin, tirerTable(PETITES_MALLETTES, h), tirerTable(PETITES_MALLETTES, h)], h) };
    }
    case 'evasion':
      return {
        type,
        routes: ROUTES_BW.map((r) => {
          const evade = h() >= ITINERAIRES_BW[r].arrestation;
          return { evade, x: tirerTable(ITINERAIRES_BW[r].gains, h) };
        }),
      };
    case 'braquage':
      return { type, code: melanger(CODES_BRAQUAGE, h), meca: melanger(ZONES_MECANISME, h), coffre: [0, 1, 2, 3].map(() => tirerTable(TABLE_COFFRES_BRAQUAGE, h)) };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Les étapes d'un bonus

export type EtapeBW = 'intro' | 'cartes' | 'vol' | 'mallettes' | 'route' | 'poursuite' | 'code' | 'codeRevele' | 'mecanisme' | 'mecaRevele' | 'coffre' | 'revele';
export interface EtapeBonusBW {
  nom: EtapeBW;
  /** Nombre d'options à choisir (0 : on regarde). */
  choix: number;
  duree: number;
}

export interface DureesBW {
  mises: number;
  /** Les multiplicateurs se posent sur la roue, avant qu'elle tourne. */
  multiplicateurs: number;
  tour: number;
  resultat: number;
  intro: number;
  /** Temps pour choisir (cartes, mallettes, itinéraire). */
  choix: number;
  /** Temps pour chaque serrure du coffre. */
  serrure: number;
  /** Révélation d'une serrure. */
  etape: number;
  vol: number;
  poursuite: number;
  revele: number;
}
export const DUREES_BW: DureesBW = { mises: 15_000, multiplicateurs: 3_500, tour: 8_000, resultat: 6_000, intro: 4_500, choix: 10_000, serrure: 8_000, etape: 3_000, vol: 6_500, poursuite: 9_000, revele: 5_500 };

export function etapesBonusBW(type: BonusBW, d: DureesBW = DUREES_BW): EtapeBonusBW[] {
  const e = (nom: EtapeBW, duree: number, choix = 0): EtapeBonusBW => ({ nom, choix, duree });
  switch (type) {
    case 'baron':
      return [e('intro', d.intro), e('cartes', d.choix, 3), e('revele', d.revele)];
    case 'pickpocket':
      return [e('intro', d.intro), e('vol', d.vol), e('mallettes', d.choix, 3), e('revele', d.revele)];
    case 'evasion':
      return [e('intro', d.intro), e('route', d.choix, 3), e('poursuite', d.poursuite), e('revele', d.revele)];
    case 'braquage':
      return [e('intro', d.intro), e('code', d.serrure, 3), e('codeRevele', d.etape), e('mecanisme', d.serrure, 8), e('mecaRevele', d.etape), e('coffre', d.serrure, 4), e('revele', d.revele)];
  }
}
/** Le nombre d'options de chaque étape de choix, dans l'ordre (un choix par étape). */
export const choixDuBonusBW = (type: BonusBW) => etapesBonusBW(type).filter((e) => e.choix > 0).map((e) => e.choix);

/** Ce que rapporte la mise d'un bonus, d'après les choix du joueur (un indice par étape de choix). */
export function recompenseBonusBW(t: TirageBonusBW, choix: number[]): { x: number; jackpot?: JackpotBW; evade?: boolean } {
  switch (t.type) {
    case 'baron':
      return { ...t.cartes[choix[0]] };
    case 'pickpocket':
      return { x: t.mallettes[choix[0]] };
    case 'evasion': {
      const r = t.routes[choix[0]];
      return { x: r.evade ? r.x : 0, evade: r.evade };
    }
    case 'braquage': {
      const c = t.coffre[choix[2]];
      return c.jackpot ? { ...c } : { x: t.code[choix[0]] * t.meca[choix[1]] * c.x };
    }
  }
}

/** Gain (mise comprise) d'une mise de `mise` qui touche un multiplicateur `x`. */
export const gainBW = (mise: number, x: number) => Math.floor((mise * Math.round(x * 100)) / 100);

// ---------------------------------------------------------------------------------------------------------------
// Ce que rend chaque mise (calcul exact) et la simulation de 100 000 manches

/**
 * Espérance (mise comprise) de ce que rapporte un bonus, quels que soient les choix : la part que les multiplicateurs
 * de la roue multiplient, et celle des jackpots (fixes).
 */
export function esperanceBonusBW(type: BonusBW, route?: RouteBW): { multipliable: number; jackpots: number } {
  const separer = (t: TableBW<RecompenseBW>, facteur = 1) => {
    const total = t.reduce((s, [, p]) => s + p, 0);
    return {
      multipliable: t.reduce((s, [r, p]) => s + (r.jackpot ? 0 : (p / total) * r.x * facteur), 0),
      jackpots: t.reduce((s, [r, p]) => s + (r.jackpot ? (p / total) * r.x : 0), 0),
    };
  };
  switch (type) {
    case 'baron':
      return separer(TABLE_CARTES_BARON);
    case 'pickpocket':
      return { multipliable: (esperanceTable(BUTIN_PICKPOCKET) + 2 * esperanceTable(PETITES_MALLETTES)) / 3, jackpots: 0 };
    case 'evasion': {
      const r = ITINERAIRES_BW[route ?? 'boulevard'];
      return { multipliable: (1 - r.arrestation) * esperanceTable(r.gains), jackpots: 0 };
    }
    case 'braquage': {
      const moy = (t: number[]) => t.reduce((s, x) => s + x, 0) / t.length;
      return separer(TABLE_COFFRES_BRAQUAGE, moy(CODES_BRAQUAGE) * moy(ZONES_MECANISME));
    }
  }
}
/** Ce que les multiplicateurs ajoutent en moyenne à une case (×1,26 : une case sur 40 a 3 chances d'en avoir un). */
export function facteurMultiplicateursBW(ouverture = false): number {
  const e = MULTIPLICATEURS_BW.reduce((s, [x, p]) => s + x * p, 0) / MULTIPLICATEURS_BW.reduce((s, [, p]) => s + p, 0);
  return 1 + (NB_MULTIPLICATEURS_BW / NB_CASES_BW) * (e - 1) + (ouverture ? 1 / NB_CASES_BW : 0);
}
/** Ce que rend chaque mise en moyenne (multiplicateurs compris). */
export function rtpBW(ouverture = false): Record<CaseBW, number> & { routes: Record<RouteBW, number> } {
  const F = facteurMultiplicateursBW(ouverture);
  const p = (c: CaseBW) => COMPOSITION_BW[c] / NB_CASES_BW;
  const bonus = (c: BonusBW, route?: RouteBW) => {
    const e = esperanceBonusBW(c, route);
    return p(c) * (e.multipliable * F + e.jackpots);
  };
  return {
    x1: p('x1') * GAINS_CHIFFRES_BW.x1 * F,
    x2: p('x2') * GAINS_CHIFFRES_BW.x2 * F,
    x5: p('x5') * GAINS_CHIFFRES_BW.x5 * F,
    x10: p('x10') * GAINS_CHIFFRES_BW.x10 * F,
    baron: bonus('baron'),
    pickpocket: bonus('pickpocket'),
    evasion: bonus('evasion', 'boulevard'),
    braquage: bonus('braquage'),
    routes: { boulevard: bonus('evasion', 'boulevard'), ruelles: bonus('evasion', 'ruelles'), souterrains: bonus('evasion', 'souterrains') },
  };
}

export interface SimulationBW {
  manches: number;
  frequences: Record<CaseBW, number>;
  /** Pour une mise de 1 sur chaque case à chaque manche : ce que chaque case a rendu, et en tout. */
  retour: Record<CaseBW, number>;
  retourTotal: number;
  /** Écart type du résultat d'une manche (mise de 1 sur chaque case). */
  volatilite: number;
  /** Répartition des multiplicateurs gagnés aux bonus. */
  multiplicateurs: Record<string, number>;
  jackpots: Record<JackpotBW, number>;
  gainMoyen: number;
}
/** Simule `n` manches avec des choix au hasard (le joueur choisit au hasard : ça ne change pas l'espérance). */
export function simulerBW(n: number, h: Hasard): SimulationBW {
  const frequences = Object.fromEntries(CASES_BW.map((c) => [c, 0])) as Record<CaseBW, number>;
  const retour = Object.fromEntries(CASES_BW.map((c) => [c, 0])) as Record<CaseBW, number>;
  const multiplicateurs: Record<string, number> = {};
  const jackpots = { mini: 0, minor: 0, major: 0, grand: 0 };
  let somme = 0;
  let somme2 = 0;
  for (let k = 0; k < n; k++) {
    const boosts = tirerMultiplicateursBW(h);
    const i = Math.floor(h() * NB_CASES_BW);
    const c = ROUE_BW[i];
    const m = multiplicateurDe(boosts, i);
    frequences[c]++;
    let x: number;
    if (!estBonusBW(c)) x = GAINS_CHIFFRES_BW[c] * m;
    else {
      const t = tirerBonusBW(c, h);
      const choix = choixDuBonusBW(c).map((q) => Math.floor(h() * q));
      const r = recompenseBonusBW(t, choix);
      x = r.jackpot ? r.x : r.x * m;
      if (r.jackpot) jackpots[r.jackpot]++;
      const cle = `${c} ×${x}`;
      multiplicateurs[cle] = (multiplicateurs[cle] ?? 0) + 1;
    }
    retour[c] += x;
    const net = x - CASES_BW.length;
    somme += net;
    somme2 += net * net;
  }
  for (const c of CASES_BW) retour[c] /= n;
  const moyenne = somme / n;
  return {
    manches: n,
    frequences,
    retour,
    retourTotal: CASES_BW.reduce((s, c) => s + retour[c], 0) / CASES_BW.length,
    volatilite: Math.sqrt(somme2 / n - moyenne * moyenne),
    multiplicateurs,
    jackpots,
    gainMoyen: moyenne,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// La grande ouverture

/** Le cadeau d'ouverture (le salon l'ouvre à la mise en ligne) ; l'événement dure aussi longtemps que lui. */
export const CADEAU_OUVERTURE_BW = 'cadeau-ouverture-baron-wheel';
export const DUREE_OUVERTURE_BW = 7 * 86_400_000;
export const MONTANT_OUVERTURE_BW = 20_000_000;

// ---------------------------------------------------------------------------------------------------------------
// La vue d'un téléphone

export type PhaseBW = 'mises' | 'multiplicateurs' | 'tour' | 'bonus' | 'resultat';

export interface JoueurBW {
  nom: string;
  avatar: number;
  mise: number;
  /** Gain de la manche (mise comprise), une fois la manche jugée. */
  gain: number | null;
  jackpot?: JackpotBW;
  moi?: true;
}

export interface VueBonusBW {
  type: BonusBW;
  etapes: EtapeBonusBW[];
  etape: number;
  /** Ce qui est déjà révélé (null : encore caché). */
  cartes?: (RecompenseBW | null)[];
  butin?: number | null;
  mallettes?: (number | null)[];
  routes?: (IssueRouteBW | null)[];
  code?: (number | null)[];
  meca?: (number | null)[];
  coffre?: (RecompenseBW | null)[];
  /** Le multiplicateur de la roue posé sur ce bonus (1 si aucun) : il multiplie toutes ses récompenses, sauf les jackpots. */
  multiplicateur: number;
  /** Ma mise sur ce bonus, mes choix (un par étape de choix) et ma récompense une fois révélée (multiplicateur compris). */
  mise: number;
  mesChoix: (number | null)[];
  /** Combien de joueurs ont choisi chaque option, par étape de choix. */
  choixSalon: number[][];
  resultat: { x: number; jackpot?: JackpotBW; evade?: boolean; gain: number } | null;
}

export interface VueBW {
  numero: number;
  phase: PhaseBW;
  /** Millisecondes avant la fin de la phase (ou de l'étape du bonus) et sa durée. */
  reste: number | null;
  duree: number | null;
  /** L'angle de la roue au repos (degrés, sens des aiguilles d'une montre). */
  angle: number;
  /** Pendant qu'elle tourne : de quel angle à quel angle, depuis combien de temps, en combien de temps. */
  tour: { depart: number; arrivee: number; ecoule: number; duree: number } | null;
  /** La case d'arrêt (une fois la roue partie). */
  arret: number | null;
  /** Les multiplicateurs de la manche (une fois les mises fermées ; null avant). */
  multiplicateurs: BoostBW[] | null;
  bonus: VueBonusBW | null;
  mesMises: Partial<Record<CaseBW, number>>;
  peutRefaire: boolean;
  /** Après la manche : ce que j'avais misé et ce que j'ai reçu (mise comprise). */
  bilan: { mise: number; gain: number } | null;
  joueurs: JoueurBW[];
  /** Les derniers résultats : la case, et son multiplicateur s'il en avait un. */
  historique: { c: CaseBW; x?: number }[];
  spectateurs: number;
  solde: number;
  /** Grande ouverture en cours : millisecondes avant la fin. */
  ouverture: number | null;
}

/** Une ligne du journal d'un joueur (ses 20 dernières manches). */
export interface ManchesJournalBW {
  numero: number;
  c: CaseBW;
  mise: number;
  gain: number;
  solde: number;
  jackpot?: JackpotBW;
  t: number;
}
export interface JournalBW {
  manches: ManchesJournalBW[];
  /** Depuis le démarrage du serveur : manches jouées, cases sorties, jackpots. */
  salon: { manches: number; cases: Record<CaseBW, number>; jackpots: Record<JackpotBW, number> };
  /** Mes totaux (depuis le démarrage du serveur). */
  moi: { manches: number; mise: number; gain: number; bonus: Record<BonusBW, number> };
}
