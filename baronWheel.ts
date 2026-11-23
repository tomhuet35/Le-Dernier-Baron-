/**
 * The Baron's Wheel (Salon privé) : une roue géante de 30 cases, en direct pour tout le salon, avec quatre bonus.
 *
 * Une manche : mises (10 s) → les multiplicateurs (3 à 7 cases de la roue, au hasard, ×5 à ×100) → la roue tourne (8 s) →
 * le résultat. Si la roue s'arrête sur un bonus, son mini-jeu commence ; ceux qui ont misé sur ce bonus font leurs
 * choix (chacun les siens), les autres regardent.
 *
 * - La roue : 9 cases « 1X », 6 « 2X », 4 « 5X », 2 « 10X », 2 BARON, 2 PICKPOCKET, 2 CHAUDIÈRE, 2 BRAQUAGE, 1 EXPRESS.
 *   Toutes les cases ont la même chance (1 sur 30). Les cases chiffres paient ×2, ×3, ×5 et ×10 (mise comprise) ;
 *   les bonus, plus rares, paient gros (×5 à ×1 000) : ce que les petites cases ont perdu en passant de ×2,7 et ×3,3 à
 *   ×2 et ×3 a été rendu aux bonus, sous forme de nouveaux gros multiples (voir rtpBW).
 * - Les multiplicateurs : une fois les mises fermées, 3 à 7 cases de la roue reçoivent un multiplicateur (×5 à ×100).
 *   Si la roue s'arrête sur l'une d'elles, ses gains sont multipliés (pour un bonus : tous ses multiplicateurs, sauf les
 *   jackpots, qui restent fixes). Choix du créateur : la roue est le jeu généreux du salon ; multiplicateurs compris,
 *   chaque mise rend en moyenne environ 1,7 fois ce qu'elle coûte (rtpBW).
 * - Tout est tiré par le serveur avant les animations : la case d'arrêt au départ de la roue, et toutes les récompenses
 *   cachées d'un bonus dès qu'il commence. Les choix du joueur désignent l'une de ces récompenses cachées ; aucune
 *   animation ne décide de rien.
 * - Les jackpots (MINI ×25, MINOR ×50, MAJOR ×100, GRAND ×500 la mise) sont des récompenses fixes, rares, cachées dans
 *   le bonus du Baron et au fond du Braquage (le Coffre du Siècle). Ils ne sont pas progressifs.
 * - Grande ouverture (la première semaine) : l'XP compte double sur la roue (et un cadeau d'ouverture dans le salon).
 */

// ---------------------------------------------------------------------------------------------------------------
// La roue

export type ChiffreBW = 'x1' | 'x2' | 'x5' | 'x10';
export type BonusBW = 'baron' | 'course' | 'chaudiere' | 'braquage' | 'express';
export type CaseBW = ChiffreBW | BonusBW;
export const CHIFFRES_BW: ChiffreBW[] = ['x1', 'x2', 'x5', 'x10'];
export const BONUS_BW: BonusBW[] = ['baron', 'course', 'chaudiere', 'braquage', 'express'];
export const CASES_BW: CaseBW[] = [...CHIFFRES_BW, ...BONUS_BW];
export const estBonusBW = (c: CaseBW): c is BonusBW => (BONUS_BW as string[]).includes(c);

/** Combien de cases de chaque sorte sur la roue (30 en tout). */
export const COMPOSITION_BW: Record<CaseBW, number> = { x1: 9, x2: 6, x5: 4, x10: 2, baron: 2, course: 2, chaudiere: 2, braquage: 2, express: 1 };
export const NB_CASES_BW = 30;
export const DEGRES_CASE_BW = 360 / NB_CASES_BW;
/**
 * L'ordre des 30 cases, dans le sens des aiguilles d'une montre depuis le haut (la roue ne change jamais) : deux ou
 * trois chiffres, un bonus… Jamais deux cases pareilles côte à côte, les deux 10X face à face, et la case unique de
 * l'Express parmi les chiffres.
 */
export const ROUE_BW: CaseBW[] = (() => {
  // La roue est symétrique autour de l'Express (en haut, entre deux Baron) : la moitié droite, puis son miroir ; le ×2
  // du bas, face à l'Express, fait le lien. Les bonus reviennent toutes les 4 cases.
  const moitie: CaseBW[] = ['baron', 'x1', 'x2', 'x1', 'course', 'x5', 'x1', 'x2', 'chaudiere', 'x1', 'x10', 'x2', 'braquage', 'x5'];
  return ['express', ...moitie, 'x1', ...[...moitie].reverse()];
})();

/** Ce que paie une case chiffre (mise comprise) : ×2 pour 1 000 $ misés sur le 1X, 2 000 $ reçus. */
export const GAINS_CHIFFRES_BW: Record<ChiffreBW, number> = { x1: 2, x2: 3, x5: 5, x10: 10 };

/** Les mises : jetons (jusqu'à 10 000 000 $), plafond par case et par manche (30 000 000 $). */
export const JETONS_BW = [1_000, 5_000, 25_000, 100_000, 500_000, 1_000_000, 5_000_000, 10_000_000];
export const MAX_CASE_BW = 30_000_000;
export const MAX_MANCHE_BW = 30_000_000;

// ---------------------------------------------------------------------------------------------------------------
// Les multiplicateurs : le Top Slot, une fois les mises fermées

/**
 * Le Top Slot : au-dessus de la roue, deux rouleaux s'arrêtent sur une case (l'une des 9, autant de chances pour
 * chacune) et un multiplicateur ; toutes les cases de ce type sur la roue reçoivent ce multiplicateur. Un seul
 * multiplicateur par manche.
 */
/** Les multiplicateurs du Top Slot (×2 à ×200), et leur poids : ×14,68 en moyenne. */
export const MULTIPLICATEURS_BW: [number, number][] = [
  [2, 30],
  [3, 22],
  [5, 18],
  [10, 12],
  [20, 8],
  [50, 6],
  [100, 3],
  [200, 1.93],
];
/** Un tirage du Top Slot : la case multipliée et son multiplicateur. */
export interface TirageTopSlotBW {
  c: CaseBW;
  x: number;
}
/** Une case de la roue (son indice, 0 à 39) et son multiplicateur. */
export interface BoostBW {
  i: number;
  x: number;
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

/** LE CHOIX DU BARON (la Grande Donne) : le Baron distribue neuf cartes, chacune tirée dans cette table (la carte du Baron cache un jackpot). */
export const NB_CARTES_BARON = 9;
export const CARTES_BARON: TableBW<number | 'jackpot'> = [
  [5, 4700],
  [7, 2100],
  [10, 1400],
  [15, 850],
  [25, 500],
  [50, 250],
  [100, 75],
  [250, 36],
  ['jackpot', 125],
];
export const JACKPOTS_BARON: TableBW<JackpotBW> = [
  ['mini', 7000],
  ['minor', 2200],
  ['major', 700],
  ['grand', 100],
];
export const TABLE_CARTES_BARON = avecJackpots(CARTES_BARON, JACKPOTS_BARON);

/**
 * LA COURSE DES DRAISINES : quatre draisines (Rubis, Saphir, Émeraude, Or), chacune avec sa cote affichée avant le
 * départ. On choisit la sienne ; la gagnante paie sa cote, les trois autres la prime d'arrivée (×2). Les cotes sont
 * justes : une draisine à la cote c gagne avec la chance (11 − 2) / (c − 2), si bien que l'espérance est ×11 quelle que
 * soit la draisine choisie (comme à la Chaudière). Chaque course tire une grille de cotes, répartie au hasard sur les
 * quatre voies.
 */
export const NB_DRAISINES = 4;
export const PRIME_COURSE_BW = 2;
export const ESPERANCE_COURSE_BW = 11;
export const GRILLES_COURSE_BW: TableBW<number[]> = [
  [[20, 38, 56, 110], 30],
  [[20, 29, 110, 110], 18],
  [[20, 38, 74, 74], 18],
  [[32, 32, 32, 92], 14],
  [[14, 74, 92, 362], 15],
  [[12, 182, 227, 902], 5],
];
/** La chance de gagner d'une draisine à la cote `c`. */
export const chanceCourseBW = (c: number) => (ESPERANCE_COURSE_BW - PRIME_COURSE_BW) / (c - PRIME_COURSE_BW);
/** La chance qu'une draisine (pas la gagnante) déraille pendant la course. */
export const DERAILLEMENT_BW = 0.55;

/**
 * THE BIG THEFT : le Pickpocket vole un gros multiplicateur et le cache dans l'une des trois mallettes ; les deux autres
 * gardent un petit. Il a quitté la roue de l'Express (la Course des draisines a pris ses cases) et rejoindra la roue du
 * Bal : son écran (CasinoPickpocket) et ses tables restent ici en attendant.
 */
export const BUTIN_PICKPOCKET: TableBW<number> = [
  [15, 3800],
  [20, 2600],
  [25, 1800],
  [35, 1200],
  [60, 450],
  [150, 110],
  [500, 30],
];
export const PETITES_MALLETTES: TableBW<number> = [
  [2, 3000],
  [3, 3500],
  [5, 2500],
  [7, 1000],
];

/**
 * LA COURSE-POURSUITE (l'Évasion) : trois itinéraires ; plus le risque d'arrestation est grand, plus le butin l'est aussi.
 * Elle a quitté la roue de l'Express (l'Aiguillage a pris ses cases) et rejoindra la roue du Casse : son écran
 * (CasinoEvasion) et ses tables restent ici en attendant.
 */
export type RouteBW = 'boulevard' | 'ruelles' | 'souterrains';
export const ROUTES_BW: RouteBW[] = ['boulevard', 'ruelles', 'souterrains'];
export const ITINERAIRES_BW: Record<RouteBW, { arrestation: number; gains: TableBW<number> }> = {
  boulevard: {
    arrestation: 0.39,
    gains: [
      [10, 3000],
      [15, 3500],
      [20, 2500],
      [30, 1000],
      [50, 437],
    ],
  },
  ruelles: {
    arrestation: 0.74,
    gains: [
      [20, 3500],
      [30, 3000],
      [50, 2500],
      [100, 1000],
      [200, 211],
    ],
  },
  souterrains: {
    arrestation: 0.917,
    gains: [
      [50, 4000],
      [100, 3500],
      [200, 2000],
      [500, 500],
      [1000, 120],
    ],
  },
};
/**
 * Le calendrier de la course à trois (millisecondes depuis le début de la poursuite, pour une poursuite de 24 s) :
 * les trois voitures démarrent ensemble, puis se séparent ; la caméra suit alors la voiture du joueur jusqu'à la sortie
 * de Paris (issue) : le barrage de police qui l'arrête, ou le saut du pont-levis par-dessus le barrage.
 */
export const COURSE_BW = { depart: 2_600, separe: 1_600, issue: 19_000 };
/**
 * Le calendrier de la Grande Donne (millisecondes depuis le début de chaque étape) : à la donne, le Baron mélange puis
 * distribue les neuf cartes ; au retournement, les autres cartes se retournent en vague, puis la mienne, au centre.
 */
export const DONNE_BW = { melange: 2_600, carte: 290, vol: 420, vague: 500, pas: 300, centre: 3_300, mienne: 4_000 };
export interface IssueRouteBW {
  evade: boolean;
  /** Le butin du Baron s'il s'évade (et celui qu'il aurait eu s'il est arrêté). */
  x: number;
}

/**
 * L'AIGUILLAGE : le train part de Paris avec ×1 au compteur, passe trois aiguillages et arrive à l'un des quatre
 * terminus. Le réseau est un treillis : après l'aiguillage n° l (1 à 3), le train est à la gare (l, k), k = le nombre de
 * fois où il a pris à droite (0 à l). À chaque aiguillage, des deux gares suivantes, l'une est éclairée (sa prime est
 * visible : +×1 à +×3) et l'autre sous bâche (+×0, « travaux sur la voie », à +×20, révélée au passage du train). Les
 * gares éclairées alternent d'une case à l'autre d'un même niveau : chaque aiguillage propose une gare de chaque sorte.
 * Les gares du niveau 3 sont les terminus (Rome, Venise, Istanbul, Vienne) : leur prime s'ajoute, puis leur
 * multiplicateur (montré dès le départ) multiplie le compteur. Ce soir-là, Venise et Istanbul (au milieu du réseau)
 * se partagent ×1,5 et ×2, Rome et Vienne (aux bords) ×1 et ×1,25.
 * Gain = (1 + les primes des trois gares) × le multiplicateur du terminus. Les primes éclairées et sous bâche valent
 * autant en moyenne : choisir entre elles, c'est choisir son risque ; le vrai choix, c'est la route vers le meilleur
 * terminus. Le joueur qui ne choisit pas à temps suit le conseil de l'aiguilleur (le meilleur choix en moyenne).
 */
export const NB_AIGUILLAGES = 3;
export const COMPTEUR_DEPART_AIGUILLAGE = 1;
export const PRIMES_ECLAIREES: TableBW<number> = [
  [1, 72],
  [2, 22],
  [3, 6],
];
export const PRIMES_BACHEES: TableBW<number> = [
  [0, 68],
  [1, 12],
  [2, 8],
  [5, 6],
  [10, 4],
  [20, 2],
];
/** Les terminus, de gauche à droite (k = 0 à 3), et les multiplicateurs qu'ils se partagent (bords, puis milieu). */
export const TERMINUS_AIGUILLAGE = ['rome', 'venise', 'istanbul', 'vienne'] as const;
export type TerminusAiguillage = (typeof TERMINUS_AIGUILLAGE)[number];
export const MULTIS_BORDS_AIGUILLAGE = [1, 1.25];
export const MULTIS_MILIEU_AIGUILLAGE = [1.5, 2];
export interface TirageAiguillageBW {
  type: 'aiguillage';
  /** gares[l - 1][k] : la prime de la gare (l, k) ; le niveau 3, ce sont les terminus. */
  gares: number[][];
  /** eclairees[l - 1][k] : la gare est-elle éclairée (sa prime visible dès le départ) ? */
  eclairees: boolean[][];
  /** Le multiplicateur de chaque terminus (k = 0 à 3). */
  terminus: number[];
}
/** La position (k) du train après les choix faits (0 : à gauche, 1 : à droite). */
export const positionAiguillage = (choix: number[]) => choix.reduce((k, c) => k + (c ? 1 : 0), 0);
/** Le compteur du train après les choix faits (sans le multiplicateur du terminus). */
export function compteurAiguillage(t: TirageAiguillageBW, choix: number[]): number {
  let k = 0;
  let s = COMPTEUR_DEPART_AIGUILLAGE;
  choix.forEach((c, l) => {
    k += c ? 1 : 0;
    s += t.gares[l][k];
  });
  return s;
}
/**
 * Le conseil de l'aiguilleur au r-ième aiguillage (r = le nombre de choix déjà faits) : la direction (0 ou 1) qui mène
 * au plus gros gain en moyenne, sachant ce qui est visible (les gares déjà passées et les gares éclairées ; une gare
 * sous bâche encore à venir vaut sa moyenne).
 */
export function conseilAiguillage(t: TirageAiguillageBW, choix: number[]): number {
  const r = choix.length;
  const mu = esperanceTable(PRIMES_BACHEES);
  const k0 = positionAiguillage(choix);
  const s0 = compteurAiguillage(t, choix);
  let meilleur = { e: -1, c: 0 };
  for (let m = 0; m < 1 << (NB_AIGUILLAGES - r); m++) {
    let k = k0;
    let s = s0;
    for (let j = 0; j < NB_AIGUILLAGES - r; j++) {
      k += (m >> j) & 1;
      const l = r + j;
      s += t.eclairees[l][k] ? t.gares[l][k] : mu;
    }
    const e = s * t.terminus[k];
    if (e > meilleur.e + 1e-9) meilleur = { e, c: m & 1 };
  }
  return meilleur.c;
}
function tirerAiguillage(h: Hasard): TirageAiguillageBW {
  const eclairees: boolean[][] = [];
  const gares: number[][] = [];
  for (let l = 1; l <= NB_AIGUILLAGES; l++) {
    const decale = h() < 0.5 ? 0 : 1;
    eclairees.push(Array.from({ length: l + 1 }, (_, k) => (k + decale) % 2 === 0));
    gares.push(eclairees[l - 1].map((e) => tirerTable(e ? PRIMES_ECLAIREES : PRIMES_BACHEES, h)));
  }
  const bords = h() < 0.5 ? [...MULTIS_BORDS_AIGUILLAGE] : [...MULTIS_BORDS_AIGUILLAGE].reverse();
  const milieu = h() < 0.5 ? [...MULTIS_MILIEU_AIGUILLAGE] : [...MULTIS_MILIEU_AIGUILLAGE].reverse();
  return { type: 'aiguillage', gares, eclairees, terminus: [bords[0], milieu[0], milieu[1], bords[1]] };
}
/** Le multiple gagné à l'Aiguillage d'après les trois choix. */
export const gainAiguillage = (t: TirageAiguillageBW, choix: number[]) => compteurAiguillage(t, choix) * t.terminus[positionAiguillage(choix)];
/** L'espérance de l'Aiguillage en suivant les conseils de l'aiguilleur (calculée une fois, sur un tirage fixe). */
let esperanceAiguillageCache: number | null = null;
export function esperanceAiguillage(): number {
  if (esperanceAiguillageCache !== null) return esperanceAiguillageCache;
  let graine = 20261123;
  const h: Hasard = () => {
    graine = (graine + 0x6d2b79f5) | 0;
    let x = Math.imul(graine ^ (graine >>> 15), 1 | graine);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const N = 200_000;
  let somme = 0;
  for (let n = 0; n < N; n++) {
    const t = tirerAiguillage(h);
    const choix: number[] = [];
    for (let r = 0; r < NB_AIGUILLAGES; r++) choix.push(conseilAiguillage(t, choix));
    somme += gainAiguillage(t, choix);
  }
  esperanceAiguillageCache = somme / N;
  return esperanceAiguillageCache;
}

/**
 * LA CHAUDIÈRE : la pression monte dans la chaudière de la locomotive, et le multiplicateur avec elle : ×10 au départ,
 * ×100 au bout de 10 s, ×1 000 (la pleine pression) au bout de 20 s. Chaque joueur tire le sifflet quand il veut pour
 * encaisser le multiplicateur du moment ; si la chaudière explose avant, il perd. Le serveur a tiré le point
 * d'explosion dès le début : P(explosion après ×m) = 11 / m (jamais avant ×11). Siffler à ×m rapporte donc ×11 en
 * moyenne, quel que soit m : siffler tôt ou tard, c'est choisir son risque, pas son rendement. Sans sifflet, il siffle
 * automatiquement à ×20 ; à pleine pression, tous ceux qui n'ont pas sifflé encaissent ×1 000.
 * Le joueur ne voit le multiplicateur que là où le serveur en est (le point d'explosion reste caché jusqu'à l'explosion).
 */
export const CHAUDIERE_BW = { depart: 10, plancher: 11, max: 1000, auto: 20, decade: 10_000 };
/** Le multiplicateur de la chaudière au bout de `ms` millisecondes de montée en pression. */
export const multiplicateurChaudiere = (ms: number) => Math.min(CHAUDIERE_BW.max, CHAUDIERE_BW.depart * 10 ** (Math.max(0, ms) / CHAUDIERE_BW.decade));
/** Le temps (ms) qu'il faut à la pression pour atteindre le multiplicateur `m`. */
export const tempsChaudiere = (m: number) => Math.max(0, Math.log10(Math.min(m, CHAUDIERE_BW.max) / CHAUDIERE_BW.depart) * CHAUDIERE_BW.decade);
/** Le multiplicateur encaissé (arrondi par défaut : au dixième sous ×100, à l'unité au-delà). */
export const arrondiChaudiere = (m: number) => (m < 100 ? Math.floor(m * 10 + 1e-9) / 10 : Math.floor(m + 1e-9));
export interface TirageChaudiereBW {
  type: 'chaudiere';
  /** Le multiplicateur où la chaudière explose (au-delà de la pleine pression : elle n'explose pas). */
  explosion: number;
}
/** Le multiple gagné à la Chaudière, d'après le sifflet (null : le sifflet automatique). */
export function gainChaudiere(t: TirageChaudiereBW, sifflet: number | null): number {
  const cible = Math.min(sifflet ?? CHAUDIERE_BW.auto, CHAUDIERE_BW.max);
  return cible < t.explosion ? cible : 0;
}

/**
 * LE BRAQUAGE : une seule perceuse pour tout le salon, et aucun choix. Elle perce la banque sous-sol après sous-sol ;
 * chaque sous-sol atteint vaut son multiple, le même pour tout le monde, jusqu'à ce que l'alarme sonne et que la bande
 * file avec le butin. Le premier sous-sol est toujours atteint ; le cinquième, le Coffre du Siècle, cache en plus un
 * jackpot (sa valeur fixe s'ajoute au multiple).
 */
export const ETAGES_BRAQUAGE = [3, 6, 12, 30, 150];
/** Le sous-sol où s'arrête la perceuse (l'alarme sonne pendant qu'elle perce le suivant) ; 5 : le Coffre du Siècle. */
export const ARRET_BRAQUAGE: TableBW<number> = [
  [1, 5100],
  [2, 2580],
  [3, 1390],
  [4, 690],
  [5, 240],
];
/** Le jackpot caché dans le Coffre du Siècle. */
export const JACKPOTS_BRAQUAGE: TableBW<JackpotBW> = [
  ['mini', 5000],
  ['minor', 3000],
  ['major', 1500],
  ['grand', 500],
];

/**
 * Le calendrier de la descente (millisecondes depuis son début), commun au serveur (la durée de l'étape) et aux
 * téléphones (l'animation). La perceuse traverse la dalle au-dessus du sous-sol k à perceeCasse(k) ; le sous-sol est
 * acquis `acquis` ms plus tard. Arrêtée au sous-sol k : l'alarme sonne `alarme` ms après sa percée, puis la fuite dure
 * `fuite` ms. Au Coffre du Siècle, la porte s'ouvre et la fête dure `siecle` ms.
 */
export const CASSE_BW = { premiere: 5000, etage: 5000, acquis: 500, alarme: 3700, fuite: 8000, siecle: 10000 };
export const perceeCasseBW = (k: number) => CASSE_BW.premiere + (k - 1) * CASSE_BW.etage;
/** La durée de la descente quand la perceuse s'arrête au sous-sol `etage` (au calendrier réel). */
export const descenteCasseBW = (etage: number) => perceeCasseBW(etage) + (etage >= ETAGES_BRAQUAGE.length ? CASSE_BW.siecle : CASSE_BW.alarme + CASSE_BW.fuite);

/**
 * Le Top Slot d'une manche : une case et son multiplicateur. À l'heure de pointe, le multiplicateur vaut au moins ×5
 * (une table sans ×2 ni ×3, avec moins de très gros) : la roue rend autant en moyenne.
 */
export function tirerTopSlotBW(h: Hasard, pointe = false): TirageTopSlotBW[] {
  const c = CASES_BW[Math.min(CASES_BW.length - 1, Math.floor(h() * CASES_BW.length))];
  return [{ c, x: tirerTable(pointe ? MULTIPLICATEURS_POINTE_BW : MULTIPLICATEURS_BW, h) }];
}
/** Les cases de la roue multipliées par le Top Slot (toutes celles du type tiré). */
export const boostsDuTopSlotBW = (t: TirageTopSlotBW[]): BoostBW[] => ROUE_BW.flatMap((c, i) => t.filter((x) => x.c === c).map((x) => ({ i, x: x.x })));
/** Le Top Slot vu depuis des multiplicateurs imposés (tests, démonstration) : une ligne par type de case. */
export const topSlotDesBoostsBW = (b: BoostBW[]): TirageTopSlotBW[] => {
  const vus = new Map<CaseBW, number>();
  for (const x of b) if (!vus.has(ROUE_BW[x.i])) vus.set(ROUE_BW[x.i], x.x);
  return [...vus].map(([c, x]) => ({ c, x }));
};
/** Les multiplicateurs d'une manche, tirés au Top Slot. */
export const tirerMultiplicateursBW = (h: Hasard, pointe = false): BoostBW[] => boostsDuTopSlotBW(tirerTopSlotBW(h, pointe));

// -------------------------------------------------------------------------------------------------------------
// Les événements de la gare (heure de Paris)

/** L'heure de pointe : chaque soir de 19 h à 20 h, le Top Slot donne toujours au moins ×5. */
export const HEURE_DE_POINTE_BW = { debut: 19, fin: 20 };
/** La table du Top Slot à l'heure de pointe : jamais moins de ×5, moins de très gros (×14,73 en moyenne). */
export const MULTIPLICATEURS_POINTE_BW: [number, number][] = [
  [5, 52],
  [10, 25],
  [20, 12],
  [50, 8],
  [100, 2.4],
  [200, 0.4],
];
/** Le Grand Départ : le samedi et le dimanche de 18 h à 22 h, l'XP compte double sur la roue. */
export const GRAND_DEPART_BW = { jours: [6, 0], debut: 18, fin: 22 };
export type EvenementBW = 'pointe' | 'depart';
export interface EvenementEnCoursBW {
  type: EvenementBW;
  /** Millisecondes avant la fin. */
  reste: number;
}

const formatParisBW = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hourCycle: 'h23', weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const JOURS_BW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
/** Le jour de la semaine (0 : dimanche) et l'heure à Paris. */
function heureParisBW(t: number): { jour: number; heure: number; minute: number; seconde: number } {
  const p = Object.fromEntries(formatParisBW.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { jour: JOURS_BW[p.weekday] ?? 0, heure: +p.hour, minute: +p.minute, seconde: +p.second };
}
/** Millisecondes jusqu'à l'heure pile `h` du même jour (depuis l'instant t, à Paris). */
const jusquaBW = (p: { heure: number; minute: number; seconde: number }, h: number) => ((h - p.heure) * 3600 - p.minute * 60 - p.seconde) * 1000;

/** Les événements en cours à l'instant t. */
export function evenementsBW(t: number): EvenementEnCoursBW[] {
  const p = heureParisBW(t);
  const e: EvenementEnCoursBW[] = [];
  if (p.heure >= HEURE_DE_POINTE_BW.debut && p.heure < HEURE_DE_POINTE_BW.fin) e.push({ type: 'pointe', reste: jusquaBW(p, HEURE_DE_POINTE_BW.fin) });
  if (GRAND_DEPART_BW.jours.includes(p.jour) && p.heure >= GRAND_DEPART_BW.debut && p.heure < GRAND_DEPART_BW.fin) e.push({ type: 'depart', reste: jusquaBW(p, GRAND_DEPART_BW.fin) });
  return e;
}
/** Le prochain événement s'il commence dans l'heure (pour l'annoncer). */
export function prochainEvenementBW(t: number): { type: EvenementBW; dans: number } | null {
  const p = heureParisBW(t);
  if (GRAND_DEPART_BW.jours.includes(p.jour) && p.heure === GRAND_DEPART_BW.debut - 1) return { type: 'depart', dans: jusquaBW(p, GRAND_DEPART_BW.debut) };
  if (p.heure === HEURE_DE_POINTE_BW.debut - 1) return { type: 'pointe', dans: jusquaBW(p, HEURE_DE_POINTE_BW.debut) };
  return null;
}
/** Le multiplicateur d'une case de la roue (1 si elle n'en a pas). */
export const multiplicateurDe = (boosts: BoostBW[] | null | undefined, i: number | null) => (i === null ? 1 : (boosts?.find((b) => b.i === i)?.x ?? 1));

/**
 * L'EXPRESS DU BARON (la case unique de la roue) : le Baron braque le train de nuit Paris–Istanbul. Chaque joueur
 * choisit l'un des 5 wagons. « Il n'en restera qu'un » :
 * - Paris : chaque wagon charge son butin de départ (×10 à ×100).
 * - Tunnel du Simplon : la police à cheval décroche 2 wagons (ils gardent leur butin).
 * - Les Alpes (le train file sans s'arrêter), puis Venise : chaque wagon restant ouvre un coffre (×10 à ×1 000).
 * - Tunnel des Balkans : la police décroche 2 des 3 wagons restants.
 * - Istanbul : le dernier wagon arrive et ouvre le Coffre du Baron (×50 à ×10 000).
 * Aucun petit multiplicateur : tout ce qui s'ouvre vaut ×10 au moins. Le multiplicateur de la roue multiplie tout :
 * c'est le bonus le plus généreux de la roue.
 */
export const NB_WAGONS = 5;
/** Combien de wagons la police décroche dans chaque tunnel (5 → 3 → 1). */
export const DECROCHES_PAR_TUNNEL = [2, 2];
export const BUTIN_PARIS: TableBW<number> = [
  [10, 80],
  [25, 15],
  [50, 4],
  [100, 1],
];
export const COFFRES_VENISE: TableBW<number> = [
  [10, 75],
  [25, 18],
  [50, 5],
  [100, 1.5],
  [250, 0.4],
  [500, 0.1],
  [1000, 0.03],
];
export const COFFRE_DU_BARON: TableBW<number> = [
  [50, 72],
  [100, 18],
  [250, 6],
  [500, 2.3],
  [1000, 1],
  [2500, 0.3],
  [5000, 0.08],
  [10000, 0.02],
];

// ---------------------------------------------------------------------------------------------------------------
// Les tirages des bonus (tout est caché dans le tirage dès que le bonus commence)

export type TirageBonusBW =
  | { type: 'baron'; cartes: RecompenseBW[] }
  /** cotes : celle de chaque draisine ; deraille : celle qui sort de la voie (jamais la gagnante) ; graine : le scénario. */
  | { type: 'course'; cotes: number[]; gagnant: number; deraille: number | null; graine: number }
  | TirageChaudiereBW
  /** etage : le sous-sol où s'arrête la perceuse (1 à 5) ; jackpot : celui du Coffre du Siècle (au 5e seulement). */
  | { type: 'braquage'; etage: number; jackpot: JackpotBW | null }
  /** decroche[k] : le tunnel (0 ou 1) où le wagon k est décroché, null pour celui qui arrive à Istanbul. */
  | { type: 'express'; paris: number[]; venise: number[]; decroche: (number | null)[]; coffre: number };

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
      return { type, cartes: Array.from({ length: NB_CARTES_BARON }, () => tirerTable(TABLE_CARTES_BARON, h)) };
    case 'course': {
      const cotes = melanger(tirerTable(GRILLES_COURSE_BW, h), h);
      // La gagnante : chacune avec sa chance (elles font 1 à elles quatre).
      let u = h();
      let gagnant = cotes.length - 1;
      for (let k = 0; k < cotes.length; k++) {
        u -= chanceCourseBW(cotes[k]);
        if (u < 0) {
          gagnant = k;
          break;
        }
      }
      const autres = cotes.map((_, k) => k).filter((k) => k !== gagnant);
      const deraille = h() < DERAILLEMENT_BW ? autres[Math.floor(h() * autres.length)] : null;
      return { type, cotes, gagnant, deraille, graine: Math.floor(h() * 2 ** 31) };
    }
    case 'chaudiere':
      // P(explosion > m) = plancher / m : u uniforme dans ]0, 1].
      return { type, explosion: CHAUDIERE_BW.plancher / (1 - h()) };
    case 'braquage': {
      const etage = tirerTable(ARRET_BRAQUAGE, h);
      return { type, etage, jackpot: etage >= ETAGES_BRAQUAGE.length ? tirerTable(JACKPOTS_BRAQUAGE, h) : null };
    }
    case 'express': {
      // L'ordre dans lequel la police décroche les wagons : 2 au premier tunnel, 2 au second, le dernier arrive.
      const ordre = melanger(
        Array.from({ length: NB_WAGONS }, (_, k) => k),
        h,
      );
      const decroche: (number | null)[] = Array(NB_WAGONS).fill(null);
      let r = 0;
      DECROCHES_PAR_TUNNEL.forEach((n, t) => {
        for (let j = 0; j < n; j++) decroche[ordre[r++]] = t;
      });
      return {
        type,
        paris: Array.from({ length: NB_WAGONS }, () => tirerTable(BUTIN_PARIS, h)),
        venise: Array.from({ length: NB_WAGONS }, () => tirerTable(COFFRES_VENISE, h)),
        decroche,
        coffre: tirerTable(COFFRE_DU_BARON, h),
      };
    }
  }
}
/** Le butin d'un wagon de l'Express à la fin du voyage. */
export function butinWagon(t: Extract<TirageBonusBW, { type: 'express' }>, k: number): number {
  const d = t.decroche[k];
  return t.paris[k] + (d !== 0 ? t.venise[k] : 0) + (d === null ? t.coffre : 0);
}

// ---------------------------------------------------------------------------------------------------------------
// Les étapes d'un bonus

export type EtapeBW =
  | 'chargement'
  | 'intro'
  | 'donne'
  | 'cartes'
  | 'vol'
  | 'mallettes'
  | 'grille'
  | 'sprint'
  | 'route'
  | 'poursuite'
  | 'aiguille'
  | 'trajet'
  | 'terminus'
  | 'pression'
  | 'explosion'
  | 'descente'
  | 'wagons'
  | 'paris'
  | 'tunnel1'
  | 'alpes'
  | 'venise'
  | 'tunnel2'
  | 'istanbul'
  | 'revele';
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
  /** L'écran de chargement avant chaque mini-jeu : le temps que chaque joueur ait toutes ses images. */
  chargement: number;
  intro: number;
  /** Temps pour choisir (cartes, mallettes, itinéraire). */
  choix: number;
  /** Le Braquage : la descente de la perceuse jusqu'au Coffre du Siècle (plus courte si l'alarme sonne avant). */
  descente: number;
  vol: number;
  poursuite: number;
  revele: number;
  /** L'Express : présentation, une gare (arrêt, coffres, départ), une embuscade (Alpes, Balkans), l'arrivée (traversee : inutilisé). */
  introExpress: number;
  /** L'intro du Braquage : l'affiche et l'échelle des butins, le temps de les lire. */
  introBraquage: number;
  /** L'intro de l'Évasion : l'affiche et les trois voitures. */
  introEvasion: number;
  /** L'Aiguillage : l'affiche et la carte, chaque aiguillage (le choix), chaque trajet jusqu'à la gare, l'arrivée. */
  introAiguillage: number;
  /** La Chaudière : l'intro, puis l'explosion (ou la pleine pression) ; la montée en pression dure ce que dit le tirage. */
  introChaudiere: number;
  explosion: number;
  aiguille: number;
  trajet: number;
  terminus: number;
  /** Le Choix du Baron : l'affiche, le mélange et la donne des neuf cartes, puis leur retournement (voir DONNE_BW). */
  introDonne: number;
  donne: number;
  reveleDonne: number;
  /** Le Pickpocket (le Bal du Grand Hôtel) : l'affiche, puis le retournement des chapeaux (le vol et le bonneteau : vol). */
  introPick: number;
  revelePick: number;
  /** La Course des draisines : la présentation des quatre équipages, puis la course (feux, coup de pistolet, sprint). */
  introCourse: number;
  sprint: number;
  gare: number;
  tunnel: number;
  traversee: number;
  arrivee: number;
}
/** La durée de la phase des multiplicateurs (le même pour tous les tirages du Top Slot). */
export const dureeMultiplicateursBW = (base: number, _t: TirageTopSlotBW[] | null) => base;
export const DUREES_BW: DureesBW = {
  mises: 10_000,
  multiplicateurs: 4_000,
  tour: 8_000,
  resultat: 6_000,
  chargement: 3_000,
  intro: 4_500,
  choix: 10_000,
  descente: descenteCasseBW(5),
  // Le Bal : le vol du collier au milieu des danseurs, l'inspecteur, puis le bonneteau des trois chapeaux.
  vol: 11_000,
  // La course à trois : le départ ensemble, la séparation, ma voiture jusqu'au barrage ou au saut (voir COURSE_BW).
  poursuite: 24_000,
  revele: 5_500,
  introExpress: 3_000,
  introBraquage: 2_500,
  introEvasion: 6_000,
  introAiguillage: 7_000,
  introChaudiere: 6_500,
  explosion: 3_000,
  aiguille: 6_000,
  trajet: 5_000,
  terminus: 7_000,
  introDonne: 2_500,
  donne: 6_000,
  reveleDonne: 7_500,
  introPick: 2_500,
  revelePick: 7_000,
  introCourse: 3_000,
  sprint: 15_000,
  gare: 11_000,
  // L'embuscade (Alpes, puis Balkans) : le paysage, la police à cheval, deux wagons déviés l'un après l'autre.
  tunnel: 12_000,
  traversee: 3_500,
  arrivee: 13_000,
};

/** Les étapes d'un bonus. Celles du Braquage dépendent du tirage : la descente s'arrête plus tôt si l'alarme sonne. */
export function etapesBonusBW(type: BonusBW, d: DureesBW = DUREES_BW, t?: TirageBonusBW): EtapeBonusBW[] {
  // Chaque mini-jeu commence par son écran de chargement.
  return [{ nom: 'chargement', choix: 0, duree: d.chargement }, ...etapesDuJeuBW(type, d, t)];
}
function etapesDuJeuBW(type: BonusBW, d: DureesBW, t?: TirageBonusBW): EtapeBonusBW[] {
  const e = (nom: EtapeBW, duree: number, choix = 0): EtapeBonusBW => ({ nom, choix, duree });
  switch (type) {
    case 'baron':
      return [e('intro', d.introDonne), e('donne', d.donne), e('cartes', d.choix, NB_CARTES_BARON), e('revele', d.reveleDonne)];
    case 'course':
      return [e('intro', d.introCourse), e('grille', d.choix, NB_DRAISINES), e('sprint', d.sprint), e('revele', d.revele)];
    case 'chaudiere': {
      // La montée en pression dure jusqu'à l'explosion (au plus jusqu'à la pleine pression), au rythme de la chaudière
      // (raccourci si les durées sont raccourcies, comme dans les tests).
      const m = t?.type === 'chaudiere' ? t.explosion : CHAUDIERE_BW.max;
      const pression = Math.round((tempsChaudiere(m) * d.explosion) / DUREES_EXPLOSION_REF);
      return [e('intro', d.introChaudiere), e('pression', pression), e('explosion', d.explosion), e('revele', d.revele)];
    }
    case 'braquage': {
      const etage = t?.type === 'braquage' ? t.etage : ETAGES_BRAQUAGE.length;
      const descente = Math.round((d.descente * descenteCasseBW(etage)) / descenteCasseBW(ETAGES_BRAQUAGE.length));
      return [e('intro', d.introBraquage), e('descente', descente), e('revele', d.revele)];
    }
    case 'express':
      return [
        e('intro', d.introExpress),
        e('wagons', d.choix, NB_WAGONS),
        e('paris', d.gare),
        e('tunnel1', d.tunnel),
        e('venise', d.gare),
        e('tunnel2', d.tunnel),
        e('istanbul', d.arrivee),
        e('revele', d.revele),
      ];
  }
}
/** La durée de référence de l'explosion (la montée en pression suit le même rythme que les durées). */
const DUREES_EXPLOSION_REF = 3_000;
/** Le nombre d'options de chaque étape de choix, dans l'ordre (un choix par étape). */
export const choixDuBonusBW = (type: BonusBW) => etapesBonusBW(type).filter((e) => e.choix > 0).map((e) => e.choix);

/**
 * Ce que rapporte la mise d'un bonus, d'après les choix du joueur (un indice par étape de choix). `fixe` : une part
 * fixe (un jackpot gagné en plus du multiple), que le multiplicateur de la roue ne multiplie pas.
 */
export function recompenseBonusBW(t: TirageBonusBW, choix: number[]): { x: number; jackpot?: JackpotBW; evade?: boolean; fixe?: number } {
  switch (t.type) {
    case 'baron':
      return { ...t.cartes[choix[0]] };
    case 'course':
      return choix[0] === t.gagnant ? { x: t.cotes[choix[0]], evade: true } : { x: PRIME_COURSE_BW, evade: false };
    case 'chaudiere': {
      // choix[0] : le sifflet, en centièmes de multiplicateur (0 : pas de sifflet, le sifflet automatique).
      const x = gainChaudiere(t, choix[0] ? choix[0] / 100 : null);
      return { x, evade: x > 0 };
    }
    case 'braquage':
      return { x: ETAGES_BRAQUAGE[t.etage - 1], ...(t.jackpot ? { jackpot: t.jackpot, fixe: VALEUR_JACKPOT_BW[t.jackpot] } : {}) };
    case 'express':
      return { x: butinWagon(t, choix[0]), evade: t.decroche[choix[0]] === null };
  }
}

/**
 * Le multiple final d'une récompense de bonus, multiplicateur de la roue `m` compris : un jackpot seul garde sa valeur
 * fixe ; un multiple est multiplié, et un jackpot gagné en plus (la part fixe) s'y ajoute.
 */
export const valeurRecompenseBW = (r: { x: number; jackpot?: JackpotBW; fixe?: number }, m: number) => (r.fixe !== undefined ? r.x * m + r.fixe : r.jackpot ? r.x : r.x * m);

/** Gain (mise comprise) d'une mise de `mise` qui touche un multiplicateur `x`. */
export const gainBW = (mise: number, x: number) => Math.floor((mise * Math.round(x * 100)) / 100);

// ---------------------------------------------------------------------------------------------------------------
// Ce que rend chaque mise (calcul exact) et la simulation de 100 000 manches

/**
 * Espérance (mise comprise) de ce que rapporte un bonus, quels que soient les choix : la part que les multiplicateurs
 * de la roue multiplient, et celle des jackpots (fixes).
 */
export function esperanceBonusBW(type: BonusBW): { multipliable: number; jackpots: number } {
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
    case 'course':
      // Le même quelle que soit la draisine choisie (les cotes sont justes).
      return { multipliable: ESPERANCE_COURSE_BW, jackpots: 0 };
    case 'chaudiere':
      // Le même quel que soit le moment du sifflet (dès ×11), sifflet automatique compris.
      return { multipliable: CHAUDIERE_BW.plancher, jackpots: 0 };
    case 'braquage': {
      const total = ARRET_BRAQUAGE.reduce((s, [, p]) => s + p, 0);
      const pSiecle = (ARRET_BRAQUAGE.find(([k]) => k === ETAGES_BRAQUAGE.length)?.[1] ?? 0) / total;
      const totalJ = JACKPOTS_BRAQUAGE.reduce((s, [, p]) => s + p, 0);
      return {
        multipliable: ARRET_BRAQUAGE.reduce((s, [k, p]) => s + (p / total) * ETAGES_BRAQUAGE[k - 1], 0),
        jackpots: pSiecle * JACKPOTS_BRAQUAGE.reduce((s, [j, p]) => s + (p / totalJ) * VALEUR_JACKPOT_BW[j], 0),
      };
    }
    case 'express': {
      // Le butin de Paris pour tous ; Venise pour les 3 wagons sur 5 qui passent le premier tunnel ; le Coffre du Baron
      // pour le dernier (1 sur 5).
      const restants = NB_WAGONS - DECROCHES_PAR_TUNNEL[0];
      return { multipliable: esperanceTable(BUTIN_PARIS) + (restants / NB_WAGONS) * esperanceTable(COFFRES_VENISE) + (1 / NB_WAGONS) * esperanceTable(COFFRE_DU_BARON), jackpots: 0 };
    }
  }
}
/**
 * Ce que les multiplicateurs ajoutent en moyenne à une case : le Top Slot tire 1 case sur 9 par manche, à ×14,68 en
 * moyenne, soit ×2,52 (à l'heure de pointe, au moins ×5 : ×14,73 en moyenne, autant).
 */
export function facteurMultiplicateursBW(pointe = false): number {
  const table = pointe ? MULTIPLICATEURS_POINTE_BW : MULTIPLICATEURS_BW;
  const e = table.reduce((s, [x, p]) => s + x * p, 0) / table.reduce((s, [, p]) => s + p, 0);
  // Chacune des 9 cases a autant de chances d'être tirée, une seule par manche.
  return 1 + (e - 1) / CASES_BW.length;
}
/** Ce que rend chaque mise en moyenne (multiplicateurs compris). */
export function rtpBW(): Record<CaseBW, number> {
  const F = facteurMultiplicateursBW();
  const p = (c: CaseBW) => COMPOSITION_BW[c] / NB_CASES_BW;
  const bonus = (c: BonusBW) => {
    const e = esperanceBonusBW(c);
    return p(c) * (e.multipliable * F + e.jackpots);
  };
  return {
    x1: p('x1') * GAINS_CHIFFRES_BW.x1 * F,
    x2: p('x2') * GAINS_CHIFFRES_BW.x2 * F,
    x5: p('x5') * GAINS_CHIFFRES_BW.x5 * F,
    x10: p('x10') * GAINS_CHIFFRES_BW.x10 * F,
    baron: bonus('baron'),
    course: bonus('course'),
    chaudiere: bonus('chaudiere'),
    braquage: bonus('braquage'),
    express: bonus('express'),
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
      // Au hasard (ça ne change rien en moyenne) ; à la Chaudière, un sifflet entre ×10 et ×200.
      const choix = t.type === 'chaudiere' ? [Math.round(arrondiChaudiere(10 * 20 ** h()) * 100)] : choixDuBonusBW(c).map((q) => Math.floor(h() * q));
      const r = recompenseBonusBW(t, choix);
      x = valeurRecompenseBW(r, m);
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
  /**
   * L'Aiguillage : le multiplicateur des terminus et les gares éclairées (dès le départ), et la prime de chaque gare
   * (null tant qu'une gare sous bâche n'est pas révélée, au passage du train à son niveau).
   */
  aiguillage?: { terminus: number[]; eclairees: boolean[][]; gares: (number | null)[][] };
  /**
   * La Chaudière : depuis combien de temps la pression monte (ms, pendant la montée), le point d'explosion (une fois
   * atteint ; au-delà de la pleine pression : elle n'a pas explosé), mon sifflet et ceux du salon (dans l'ordre).
   */
  chaudiere?: { ecoule: number | null; explosion: number | null; monSifflet: number | null; siffles: { nom: string; avatar: number; x: number; moi?: true }[] };
  /**
   * La Course des draisines : la cote de chaque draisine (dès le début), et une fois le départ donné la gagnante, celle
   * qui déraille et la graine du scénario (tout le monde voit la même course).
   */
  course?: { cotes: number[]; gagnant: number | null; deraille: number | null; graine: number | null };
  /** Le Braquage : le sous-sol où s'arrête la perceuse et le jackpot du Coffre du Siècle, révélés quand elle part. */
  casse?: { etage: number; jackpot: JackpotBW | null } | null;
  /**
   * L'Express : le butin de chaque wagon à Paris et à Venise, le tunnel où il est décroché, et le Coffre du Baron (avec
   * le wagon qui l'ouvre), chacun révélé quand le train y arrive.
   */
  express?: { paris: (number | null)[]; venise: (number | null)[]; decroches: (number | null)[]; coffre: number | null; gagnant: number | null };
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
  /** Les multiplicateurs de la manche (une fois les mises fermées ; null avant), et le Top Slot qui les a tirés. */
  multiplicateurs: BoostBW[] | null;
  topSlot: TirageTopSlotBW[] | null;
  bonus: VueBonusBW | null;
  mesMises: Partial<Record<CaseBW, number>>;
  peutRefaire: boolean;
  /** Après la manche : ce que j'avais misé et ce que j'ai reçu (mise comprise). */
  bilan: { mise: number; gain: number } | null;
  joueurs: JoueurBW[];
  /** Les derniers résultats : la case, et son multiplicateur s'il en avait un. */
  historique: { c: CaseBW; x?: number }[];
  /** Combien de manches depuis la dernière sortie de chaque bonus (null : pas encore sorti depuis le démarrage). */
  depuis: Record<BonusBW, number | null>;
  /** Le plus gros gain du jour sur la roue (heure de Paris). */
  record: { nom: string; avatar: number; gain: number; c: CaseBW } | null;
  spectateurs: number;
  solde: number;
  /** Grande ouverture en cours : millisecondes avant la fin. */
  ouverture: number | null;
  /** Les événements de la gare en cours (heure de pointe, Grand Départ), et le prochain s'il commence dans l'heure. */
  evenements: EvenementEnCoursBW[];
  prochain: { type: EvenementBW; dans: number } | null;
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
