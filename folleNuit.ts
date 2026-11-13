/**
 * La Folle Nuit : le show en direct du Salon privé.
 *
 * Une grande roue de 54 cases (1, 2, 5, 10 et quatre jeux bonus), le Top Slot qui ajoute avant chaque tour un
 * multiplicateur sur une case, puis, si la roue s'arrête sur un bonus, le jeu bonus joué par tous ceux qui ont misé
 * dessus : Pile ou face, Chasse au butin, Planche à billes et la Folle Nuit (la roue géante aux trois flèches).
 *
 * Ce module est pur : le hasard est passé en paramètre (un entier de 0 à n − 1), le serveur y branche crypto.randomInt
 * et les tests un tirage imposé. Argent fictif, sans aucune valeur réelle.
 */

export type Hasard = (n: number) => number;
export type NombreFN = '1' | '2' | '5' | '10';
export type BonusFN = 'pile' | 'chasse' | 'billes' | 'folle';
export type CaseFN = NombreFN | BonusFN;

export const NOMBRES_FN: NombreFN[] = ['1', '2', '5', '10'];
export const BONUS_FN: BonusFN[] = ['pile', 'chasse', 'billes', 'folle'];
/** Les 8 cases où l'on peut miser, dans l'ordre du tapis. */
export const CASES_FN: CaseFN[] = [...NOMBRES_FN, ...BONUS_FN];
export const estBonus = (c: CaseFN): c is BonusFN => (BONUS_FN as string[]).includes(c);
export const estCaseFN = (c: unknown): c is CaseFN => typeof c === 'string' && (CASES_FN as string[]).includes(c);
/** Une case chiffrée paie son chiffre pour 1. */
export const PAIEMENT_NOMBRE: Record<NombreFN, number> = { '1': 1, '2': 2, '5': 5, '10': 10 };

/** Jetons, et plafonds : 1 000 000 $ au plus sur une case, 4 000 000 $ au plus pour toute la manche. */
export const JETONS_FN = [1_000, 5_000, 25_000, 100_000, 500_000];
export const MAX_CASE_FN = 1_000_000;
export const MAX_MANCHE_FN = 4_000_000;
/** Multiplicateur le plus haut d'un bonus (Top Slot compris). */
export const X_MAX_FN = 25_000;

/**
 * La roue, dans l'ordre des aiguilles d'une montre : 21 × « 1 », 13 × « 2 », 7 × « 5 », 4 × « 10 », 4 Pile ou face,
 * 2 Chasses au butin, 2 Planches à billes et une seule Folle Nuit. Un bonus toutes les 6 cases.
 */
const BLOCS: NombreFN[][] = [
  ['2', '1', '5', '1', '2'],
  ['10', '1', '2', '1', '5'],
  ['1', '2', '1', '2', '1'],
  ['5', '1', '2', '1', '10'],
  ['2', '1', '5', '1', '2'],
  ['1', '10', '1', '2', '1'],
  ['2', '1', '5', '1', '2'],
  ['10', '1', '2', '1', '5'],
  ['1', '5', '1', '2', '1'],
];
const ENTRE: BonusFN[] = ['pile', 'chasse', 'pile', 'billes', 'pile', 'chasse', 'pile', 'billes', 'folle'];
export const ROUE_FN: CaseFN[] = BLOCS.flatMap((b, i) => [...b, ENTRE[i]]);

/** Tirage pondéré : [valeur, poids][]. */
export function pioche<T>(h: Hasard, table: readonly (readonly [T, number])[]): T {
  const total = table.reduce((s, [, p]) => s + p, 0);
  let r = h(total);
  for (const [v, p] of table) {
    if (r < p) return v;
    r -= p;
  }
  return table[table.length - 1][0];
}

// ---------------------------------------------------------------------------------------------------------------
// Top Slot

export interface TopSlot {
  case: CaseFN;
  x: number;
}
/**
 * Multiplicateurs du Top Slot (sur 1 000). Il en tombe un à chaque manche : ×2 le plus souvent, ×50 rarement
 * (moyenne ≈ 3,64, pour que chaque case rende toujours environ 97,6 % des mises).
 */
export const X_TOP_SLOT: [number, number][] = [
  [2, 493],
  [3, 230],
  [4, 100],
  [5, 80],
  [7, 42],
  [10, 28],
  [15, 12],
  [20, 8],
  [25, 4],
  [50, 3],
];
/** Case visée par le Top Slot (sur 10 000) : une case à chaque manche, les chiffres fréquents un peu plus souvent. */
export const CASE_TOP_SLOT: [CaseFN | null, number][] = [
  ['1', 1930],
  ['2', 1999],
  ['5', 1159],
  ['10', 824],
  ['pile', 1022],
  ['chasse', 1022],
  ['billes', 1022],
  ['folle', 1022],
];

/** Ce que les deux rouleaux affichent quand ils ne s'alignent pas (pour l'animation). */
export interface TirageTopSlot {
  touche: TopSlot | null;
  /** Affichage des deux rouleaux (case et multiplicateur), même quand ils ne s'alignent pas. */
  affiche: TopSlot;
}
export function tirerTopSlot(h: Hasard): TirageTopSlot {
  const c = pioche(h, CASE_TOP_SLOT);
  const x = pioche(h, X_TOP_SLOT);
  if (c) return { touche: { case: c, x }, affiche: { case: c, x } };
  return { touche: null, affiche: { case: CASES_FN[h(CASES_FN.length)], x } };
}
export const facteurTopSlot = (t: TopSlot | null | undefined, c: CaseFN) => (t && t.case === c ? t.x : 1);

// ---------------------------------------------------------------------------------------------------------------
// Pile ou face : deux multiplicateurs, un par côté de la pièce ; la pièce choisit.

export type CotePiece = 'couronne' | 'chapeau';
export interface Pile {
  couronne: number;
  chapeau: number;
  cote: CotePiece;
}
/**
 * Pile ou face : la Couronne vaut toujours ×10 au moins (jusqu'à ×100), le Chapeau garde les petits multiplicateurs
 * (×2 à ×8). Sur un grand nombre de pièces, le bonus rend autant qu'avant (multiplicateur moyen ≈ 9,5).
 */
export const X_COURONNE: [number, number][] = [
  [10, 560],
  [12, 150],
  [15, 110],
  [20, 80],
  [25, 50],
  [50, 35],
  [100, 15],
];
export const X_CHAPEAU: [number, number][] = [
  [2, 260],
  [3, 250],
  [4, 200],
  [5, 160],
  [7, 80],
  [8, 50],
];
export function tirerPile(h: Hasard): Pile {
  return { couronne: pioche(h, X_COURONNE), chapeau: pioche(h, X_CHAPEAU), cote: h(2) ? 'couronne' : 'chapeau' };
}
export const xPile = (p: Pile) => (p.cote === 'couronne' ? p.couronne : p.chapeau);

// ---------------------------------------------------------------------------------------------------------------
// Chasse au butin : un mur de 108 symboles ; derrière chacun, un multiplicateur. Chacun vise une case.

export const CASES_CHASSE = 108;
export const COLONNES_CHASSE = 18;
export const SYMBOLES_CHASSE = 12;
export const X_CHASSE: [number, number][] = [
  [5, 140],
  [7, 140],
  [10, 170],
  [12, 120],
  [15, 110],
  [20, 90],
  [25, 70],
  [30, 50],
  [40, 35],
  [50, 37],
  [75, 15],
  [100, 15],
  [150, 5],
  [200, 4],
  [500, 2],
];
export interface Chasse {
  valeurs: number[];
  symboles: number[];
}
export function tirerChasse(h: Hasard): Chasse {
  const valeurs = Array.from({ length: CASES_CHASSE }, () => pioche(h, X_CHASSE));
  const symboles = Array.from({ length: CASES_CHASSE }, () => h(SYMBOLES_CHASSE));
  return { valeurs, symboles };
}
/** Case visée par un joueur qui n'a pas choisi : au hasard. */
export const caseChasse = (choix: number | undefined, h: Hasard) => (Number.isInteger(choix) && choix! >= 0 && choix! < CASES_CHASSE ? choix! : h(CASES_CHASSE));

// ---------------------------------------------------------------------------------------------------------------
// Planche à billes : la bille tombe à travers les clous jusqu'à l'une des 16 cases ; DOUBLE double toutes les cases
// et la bille repart.

export const COLONNES_BILLES = 16;
export const RANGEES_BILLES = 12;
export const DOUBLES_MAX_BILLES = 5;
export const X_BILLES: [number, number][] = [
  [5, 180],
  [7, 185],
  [10, 190],
  [15, 140],
  [20, 100],
  [25, 70],
  [30, 45],
  [40, 35],
  [50, 25],
  [75, 15],
  [100, 10],
  [150, 5],
  [200, 2],
];
export interface LancerBilles {
  depart: number;
  /** Pour chaque rangée de clous : −1 (à gauche) ou +1 (à droite). */
  chemin: number[];
  arrivee: number;
  /** Les cases à ce lancer (déjà doublées), 0 = DOUBLE. */
  cases: number[];
}
export interface Billes {
  lancers: LancerBilles[];
  x: number;
}
export function tirerBilles(h: Hasard): Billes {
  let cases = Array.from({ length: COLONNES_BILLES }, () => pioche(h, X_BILLES));
  // Deux cases DOUBLE, jamais côte à côte.
  const d1 = h(COLONNES_BILLES);
  let d2 = h(COLONNES_BILLES - 3);
  d2 = (d1 + 2 + d2) % COLONNES_BILLES;
  cases[d1] = 0;
  cases[d2] = 0;
  const lancers: LancerBilles[] = [];
  for (let k = 0; k <= DOUBLES_MAX_BILLES; k++) {
    const depart = h(COLONNES_BILLES);
    let col = depart;
    const chemin: number[] = [];
    for (let r = 0; r < RANGEES_BILLES; r++) {
      let pas = h(2) ? 1 : -1;
      if (col + pas < 0 || col + pas >= COLONNES_BILLES) pas = -pas;
      chemin.push(pas);
      col += pas;
    }
    // Dernier lancer permis : une case DOUBLE vaut la plus grosse case.
    const derniere = k === DOUBLES_MAX_BILLES;
    const vues = derniere ? cases.map((v) => (v === 0 ? Math.max(...cases) : v)) : cases.slice();
    lancers.push({ depart, chemin, arrivee: col, cases: vues });
    if (vues[col] !== 0) return { lancers, x: Math.min(X_MAX_FN, vues[col]) };
    cases = cases.map((v) => (v === 0 ? 0 : Math.min(X_MAX_FN, v * 2)));
  }
  return { lancers, x: 0 }; // jamais atteint
}

// ---------------------------------------------------------------------------------------------------------------
// Folle Nuit : la roue géante de 64 segments et trois flèches (Or, Bordeaux, Ivoire). Chacun choisit sa flèche.
// DOUBLE ou TRIPLE sous une flèche : ses multiplicateurs sont doublés ou triplés, et la roue tourne à nouveau pour elle.

export const SEGMENTS_FOLLE = 64;
export const FLECHES_FOLLE = 3;
/** Décalage de chaque flèche par rapport au segment pointé en haut (flèche du milieu). */
export const DECALAGES_FLECHES = [-2, 0, 2];
export const TOURS_MAX_FOLLE = 6;
export type SegmentFolle = number | 'double' | 'triple';
/** Composition des 60 segments à multiplicateur (le reste : 3 DOUBLE et 1 TRIPLE). */
const COMPO_FOLLE: [number, number][] = [
  [10, 16],
  [15, 12],
  [20, 10],
  [25, 7],
  [50, 7],
  [75, 3],
  [100, 3],
  [200, 1],
  [500, 1],
];
export interface ResultatFleche {
  x: number;
  /** Multiplicateur cumulé (DOUBLE, TRIPLE) à chaque tour où la flèche était encore en jeu. */
  facteurs: number[];
}
export interface Folle {
  segments: SegmentFolle[];
  /** Segment sous la flèche du milieu à l'arrêt de chaque tour. */
  arrets: number[];
  fleches: ResultatFleche[];
}
export function tirerFolle(h: Hasard): Folle {
  // Les segments, mélangés, avec DOUBLE et TRIPLE espacés.
  const valeurs: SegmentFolle[] = COMPO_FOLLE.flatMap(([v, n]) => Array.from({ length: n }, () => v));
  for (let i = valeurs.length - 1; i > 0; i--) {
    const j = h(i + 1);
    [valeurs[i], valeurs[j]] = [valeurs[j], valeurs[i]];
  }
  const segments: SegmentFolle[] = [];
  const speciaux: SegmentFolle[] = ['double', 'triple', 'double', 'double'];
  for (let q = 0; q < 4; q++) segments.push(...valeurs.slice(q * 15, q * 15 + 15), speciaux[q]);
  const arrets: number[] = [];
  const fleches: ResultatFleche[] = DECALAGES_FLECHES.map(() => ({ x: 0, facteurs: [] }));
  const facteur = [1, 1, 1];
  const fini = [false, false, false];
  for (let t = 0; t < TOURS_MAX_FOLLE && fini.includes(false); t++) {
    const arret = h(SEGMENTS_FOLLE);
    arrets.push(arret);
    const dernier = t === TOURS_MAX_FOLLE - 1;
    DECALAGES_FLECHES.forEach((d, k) => {
      if (fini[k]) return;
      fleches[k].facteurs.push(facteur[k]);
      const s = segments[(arret + d + SEGMENTS_FOLLE) % SEGMENTS_FOLLE];
      if (typeof s === 'number' || dernier) {
        const v = typeof s === 'number' ? s : Math.max(...(segments.filter((x) => typeof x === 'number') as number[]));
        fleches[k].x = Math.min(X_MAX_FN, v * facteur[k]);
        fini[k] = true;
      } else facteur[k] = Math.min(X_MAX_FN, facteur[k] * (s === 'double' ? 2 : 3));
    });
  }
  return { segments, arrets, fleches };
}
export const flecheFolle = (choix: number | undefined, h: Hasard) => (Number.isInteger(choix) && choix! >= 0 && choix! < FLECHES_FOLLE ? choix! : h(FLECHES_FOLLE));

// ---------------------------------------------------------------------------------------------------------------
// Une manche

export type JeuBonus = { type: 'pile'; pile: Pile } | { type: 'chasse'; chasse: Chasse } | { type: 'billes'; billes: Billes } | { type: 'folle'; folle: Folle };

export interface Manche {
  topSlot: TirageTopSlot;
  /** Case où la roue s'arrête (sous la flèche). */
  arret: number;
  case: CaseFN;
  bonus: JeuBonus | null;
}
export function tirerManche(h: Hasard, imposee?: { arret?: number; topSlot?: TopSlot | null }): Manche {
  const topSlot = imposee?.topSlot !== undefined ? { touche: imposee.topSlot, affiche: imposee.topSlot ?? { case: '1' as CaseFN, x: 2 } } : tirerTopSlot(h);
  const arret = imposee?.arret !== undefined ? ((imposee.arret % ROUE_FN.length) + ROUE_FN.length) % ROUE_FN.length : h(ROUE_FN.length);
  const c = ROUE_FN[arret];
  let bonus: JeuBonus | null = null;
  if (c === 'pile') bonus = { type: 'pile', pile: tirerPile(h) };
  else if (c === 'chasse') bonus = { type: 'chasse', chasse: tirerChasse(h) };
  else if (c === 'billes') bonus = { type: 'billes', billes: tirerBilles(h) };
  else if (c === 'folle') bonus = { type: 'folle', folle: tirerFolle(h) };
  return { topSlot, arret, case: c, bonus };
}

/** Le multiplicateur du bonus pour un joueur (son choix dans la Chasse et la Folle Nuit), avant le Top Slot. */
export function xBonus(b: JeuBonus, choix?: number): number {
  if (b.type === 'pile') return xPile(b.pile);
  if (b.type === 'billes') return b.billes.x;
  if (b.type === 'chasse') return b.chasse.valeurs[choix ?? 0];
  return b.folle.fleches[choix ?? 0].x;
}

/**
 * Ce que rapporte une mise sur une case (mise rendue comprise), ou 0 si elle perd. `choix` : la case de la Chasse ou
 * la flèche de la Folle Nuit, déjà fixés par le serveur.
 */
export function retourFN(c: CaseFN, montant: number, m: Manche, choix?: number): number {
  if (m.case !== c) return 0;
  const top = facteurTopSlot(m.topSlot.touche, c);
  if (!estBonus(c)) return montant * (1 + PAIEMENT_NOMBRE[c] * top);
  return montant * (1 + Math.min(X_MAX_FN, xBonus(m.bonus!, choix) * top));
}

// ---------------------------------------------------------------------------------------------------------------
// Durées du show (le serveur les suit, l'écran s'y cale)

export const DUREES_FN = {
  mises: 15_000,
  /** « Rien ne va plus » : les mises se ferment ce temps-là avant la fin. */
  fermeture: 1_500,
  topSlot: 3_200,
  roue: 8_500,
  resultat: 5_500,
  /** Bonus : présentation, choix (Chasse, Folle Nuit), puis le jeu. */
  intro: 3_500,
  choix: 12_000,
  piece: 6_000,
  chasse: 5_000,
  bille: 4_800,
  tourFolle: 7_500,
  finBonus: 7_000,
};
export type DureesFN = typeof DUREES_FN;

/** Durée du jeu bonus après l'intro et le choix (animations comprises). */
export function dureeJeuBonus(b: JeuBonus, d: DureesFN = DUREES_FN): number {
  if (b.type === 'pile') return d.piece;
  if (b.type === 'chasse') return d.chasse;
  if (b.type === 'billes') return d.bille * b.billes.lancers.length;
  return d.tourFolle * b.folle.arrets.length;
}
export const bonusAvecChoix = (b: BonusFN) => b === 'chasse' || b === 'folle';

// ---------------------------------------------------------------------------------------------------------------
// Ce que reçoit le téléphone

export type PhaseFN = 'mises' | 'topSlot' | 'roue' | 'intro' | 'choix' | 'jeu' | 'finBonus' | 'resultat';

export type VueBonusFN =
  | { type: 'pile'; couronne: number; chapeau: number; cote: CotePiece | null }
  | { type: 'chasse'; symboles: number[]; valeurs: number[] | null; choix: number | null }
  | { type: 'billes'; lancers: LancerBilles[] | null; cases: number[]; x: number | null }
  | { type: 'folle'; segments: SegmentFolle[]; arrets: number[] | null; fleches: ResultatFleche[] | null; choix: number | null };

export interface JoueurFN {
  nom: string;
  avatar: number;
  mise: number;
  /** Gain net de la manche, une fois connu. */
  gain: number | null;
  moi?: true;
}

export interface VueFolleNuit {
  manche: number;
  phase: PhaseFN;
  reste: number | null;
  duree: number | null;
  closes: boolean;
  /** Top Slot : connu dès la fin des mises (l'écran le fait tourner). */
  topSlot: TirageTopSlot | null;
  /** Case où la roue s'arrête : connue dès qu'elle tourne. */
  arret: number | null;
  bonus: VueBonusFN | null;
  mesMises: Partial<Record<CaseFN, number>>;
  /** Mises de tout le salon sur chaque case (pour l'ambiance du tapis). */
  misesSalon: Partial<Record<CaseFN, number>>;
  monGain: number | null;
  joueurs: JoueurFN[];
  spectateurs: number;
  historique: { case: CaseFN; x: number }[];
  solde: number;
  peutRefaire: boolean;
  messages: { nom: string; texte: string }[];
}
