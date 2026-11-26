/**
 * LE BAL DU GRAND HÔTEL : la roue géante du bal, en direct (le même moteur que le Baron Express). Deux roues valsent :
 * la grande (54 cases) et la petite (30 crans), qui tourne dans l'autre sens et s'arrête un peu après.
 *
 * - La grande roue : 45 chiffres (×1 sur 24 cases, ×2 sur 12, ×4 sur 6, ×12 sur 2, ×24 sur 1) et 9 bonus (deux cases
 *   chacun pour le Pickpocket, le Choix du Baron, la Fontaine de champagne et les Chaises musicales ; une seule pour le
 *   Bal masqué, la Roue de Minuit au penthouse).
 * - La petite roue multiplie le résultat, bonus compris : ×1 sur 24 crans, ×2 sur 2, ×3, ×5, ×10 et ×20 sur un chacun
 *   (×2,2 en moyenne).
 * - Une case de chiffre paie sa valeur fois la petite roue (mise comprise) ; un bonus, sa récompense fois la petite
 *   roue. Chaque case rend ≈ 97 % de ce qu'on y mise : les chiffres n × valeur = 24 sur 54 (24/54 × 2,2 ≈ 0,978), les
 *   mini-jeux ≈ ×12 en moyenne sur 2 cases, le Bal masqué ≈ ×23,8 sur une.
 */
import {
  DUREES_BW,
  gainChaises,
  gainFontaine,
  gainMinuit,
  tirerCheminFontaine,
  tirerOrdreChaises,
  tirerTable,
  tirerToursMinuit,
  coupeFinaleFontaine,
  estDoubleFontaine,
  MAX_VERSEMENTS_FONTAINE,
  type DureesBW,
  type Hasard,
  type RecompenseBW,
  type TableBW,
} from './baronWheel';

export { gainBW, JETONS_BW, MAX_CASE_BW, MAX_MANCHE_BW } from './baronWheel';

export type ChiffreBal = 'b1' | 'b2' | 'b4' | 'b12' | 'b24';
export type BonusBal = 'pickpocket' | 'donne' | 'fontaine' | 'chaises' | 'minuit';
export type CaseBal = ChiffreBal | BonusBal;
export const CHIFFRES_BAL: ChiffreBal[] = ['b1', 'b2', 'b4', 'b12', 'b24'];
export const BONUS_BAL: BonusBal[] = ['pickpocket', 'donne', 'fontaine', 'chaises', 'minuit'];
export const CASES_BAL: CaseBal[] = [...CHIFFRES_BAL, ...BONUS_BAL];
export const VALEUR_CHIFFRE_BAL: Record<ChiffreBal, number> = { b1: 1, b2: 2, b4: 4, b12: 12, b24: 24 };
export const estBonusBal = (c: CaseBal): c is BonusBal => (BONUS_BAL as string[]).includes(c);

/** La grande roue, dans le sens des aiguilles d'une montre depuis le haut (case 0 : le Bal masqué). */
const P = 'pickpocket';
const G = 'donne';
const F = 'fontaine';
const C = 'chaises';
export const ROUE_BAL: CaseBal[] = (
  ['minuit', 1, 2, 1, 4, 1, P, 2, 1, 1, 1, 2, G, 4, 12, 1, 2, 1, F, 1, 2, 1, 4, 1, C, 2, 1, 24, 1, 2, P, 4, 1, 1, 2, 1, G, 1, 2, 4, 12, 1, F, 2, 1, 1, 1, 2, C, 4, 1, 1, 2, 1] as (number | BonusBal)[]
).map((x) => (typeof x === 'number' ? (`b${x}` as ChiffreBal) : x));
export const NB_CASES_BAL = ROUE_BAL.length;
export const DEGRES_CASE_BAL = 360 / NB_CASES_BAL;

/** La petite roue (30 crans, depuis le haut). */
export const PETITE_BAL = [20, 1, 1, 1, 1, 2, 1, 1, 1, 1, 5, 1, 1, 1, 1, 10, 1, 1, 1, 1, 2, 1, 1, 1, 1, 3, 1, 1, 1, 1];
export const NB_CRANS_BAL = PETITE_BAL.length;
export const DEGRES_CRAN_BAL = 360 / NB_CRANS_BAL;

// ---------------------------------------------------------------------------------------------------------------
// Les mini-jeux du bal

/** Le Pickpocket : le butin (le gros) caché sous l'un des trois chapeaux ; les deux autres gardent un petit. */
export const BUTIN_PICKPOCKET_BAL: TableBW<number> = [
  [15, 3800],
  [20, 2600],
  [30, 1800],
  [40, 1200],
  [75, 450],
  [200, 110],
  [500, 30],
];
export const PETITS_PICKPOCKET_BAL: TableBW<number> = [
  [2, 3000],
  [3, 3500],
  [5, 2500],
  [8, 1000],
];
/** Le Choix du Baron : neuf cartes, chacune tirée dans cette table (la carte du Baron, ×500, est la plus rare). */
export const CARTES_BAL: TableBW<number> = [
  [5, 4700],
  [7, 2100],
  [10, 1400],
  [15, 850],
  [25, 500],
  [50, 250],
  [100, 75],
  [250, 30],
  [500, 25],
];
export const NB_CARTES_BAL = 9;

export type TirageBal =
  | { type: 'pickpocket'; butin: number; mallettes: number[] }
  | { type: 'donne'; cartes: number[] }
  | { type: 'fontaine'; versements: number[][] }
  | { type: 'chaises'; ordre: number[] }
  | { type: 'minuit'; tours: number[] };

export function tirerBonusBal(type: BonusBal, h: Hasard): TirageBal {
  switch (type) {
    case 'pickpocket': {
      const butin = tirerTable(BUTIN_PICKPOCKET_BAL, h);
      const k = Math.floor(h() * 3);
      return { type, butin, mallettes: [0, 1, 2].map((i) => (i === k ? butin : tirerTable(PETITS_PICKPOCKET_BAL, h))) };
    }
    case 'donne':
      return { type, cartes: Array.from({ length: NB_CARTES_BAL }, () => tirerTable(CARTES_BAL, h)) };
    case 'fontaine': {
      const versements: number[][] = [];
      do versements.push(tirerCheminFontaine(h));
      while (versements.length < MAX_VERSEMENTS_FONTAINE && estDoubleFontaine(coupeFinaleFontaine(versements[versements.length - 1])));
      return { type, versements };
    }
    case 'chaises':
      return { type, ordre: tirerOrdreChaises(h) };
    case 'minuit':
      return { type, tours: tirerToursMinuit(h) };
  }
}

/** Ce que rapporte la mise d'un bonus (avant la petite roue), d'après le choix du joueur. */
export function recompenseBal(t: TirageBal, choix: number | null): number {
  const c = choix ?? 0;
  switch (t.type) {
    case 'pickpocket':
      return t.mallettes[c];
    case 'donne':
      return t.cartes[c];
    case 'fontaine':
      return gainFontaine(t.versements);
    case 'chaises':
      return gainChaises(t.ordre, c);
    case 'minuit':
      return gainMinuit(t.tours, c);
  }
}

/** Le nombre d'options du choix de chaque bonus (0 : personne ne choisit). */
export const CHOIX_BAL: Record<BonusBal, number> = { pickpocket: 3, donne: NB_CARTES_BAL, fontaine: 0, chaises: 4, minuit: 3 };

export interface EtapeBal {
  nom: string;
  choix: number;
  duree: number;
}
/** Les étapes d'un bonus (sans écran de chargement : chaque intro part de la roue). */
export function etapesBal(t: TirageBal, d: DureesBW = DUREES_BW): EtapeBal[] {
  const e = (nom: string, duree: number, choix = 0): EtapeBal => ({ nom, choix, duree });
  switch (t.type) {
    case 'pickpocket':
      return [e('intro', d.introPick), e('vol', d.vol), e('mallettes', d.choix, 3), e('revele', d.revelePick)];
    case 'donne':
      return [e('intro', d.introDonne), e('donne', d.donne), e('cartes', d.choix, NB_CARTES_BAL), e('revele', d.reveleDonne)];
    case 'fontaine':
      return [e('intro', d.introFontaine), e('versement', d.versement * t.versements.length), e('revele', d.revele)];
    case 'chaises':
      return [e('intro', d.introChaises), e('pari', d.choix, 4), e('musique', d.musique), e('revele', d.revele)];
    case 'minuit':
      return [e('intro', d.introMinuit), e('masques', d.choix, 3), e('tours', d.tourMinuit * t.tours.length), e('revele', d.revele)];
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Les espérances (pour les tests et les règles affichées)

const esperanceTable = (t: TableBW<number>) => t.reduce((s, [x, p]) => s + x * p, 0) / t.reduce((s, [, p]) => s + p, 0);
export const ESPERANCE_PETITE_BAL = PETITE_BAL.reduce((a, x) => a + x, 0) / NB_CRANS_BAL;
export const esperancePickpocketBal = () => (esperanceTable(BUTIN_PICKPOCKET_BAL) + 2 * esperanceTable(PETITS_PICKPOCKET_BAL)) / 3;
export const esperanceDonneBal = () => esperanceTable(CARTES_BAL);

// ---------------------------------------------------------------------------------------------------------------
// La vue envoyée aux téléphones

export type PhaseBal = 'mises' | 'tour' | 'bonus' | 'resultat';

export interface VueBonusBal {
  type: BonusBal;
  etapes: EtapeBal[];
  etape: number;
  /** La petite roue (elle multiplie toutes les récompenses du bonus). */
  multiplicateur: number;
  mise: number;
  mesChoix: (number | null)[];
  choixSalon: number[][];
  resultat: { x: number; gain: number } | null;
  /** Ce qui est déjà révélé, au format des écrans des mini-jeux. */
  butin?: number | null;
  mallettes?: (number | null)[];
  cartes?: (RecompenseBW | null)[];
  fontaine?: { versements: number[][] | null };
  chaises?: { ordre: number[] | null };
  minuit?: { tours: number[] | null };
}

export interface JoueurBal {
  nom: string;
  avatar: number;
  mise: number;
  gain: number | null;
  moi?: true;
}

export interface VueBal {
  numero: number;
  phase: PhaseBal;
  reste: number | null;
  duree: number | null;
  /** Les angles des deux roues au repos (degrés). */
  angle: number;
  angleP: number;
  /** Pendant qu'elles tournent : les angles de départ et d'arrivée, depuis combien de temps, en combien de temps. */
  tour: { depart: number; arrivee: number; departP: number; arriveeP: number; ecoule: number; duree: number } | null;
  /** La case et le cran d'arrêt (une fois les roues lancées). */
  arret: number | null;
  arretP: number | null;
  bonus: VueBonusBal | null;
  mesMises: Partial<Record<CaseBal, number>>;
  peutRefaire: boolean;
  bilan: { mise: number; gain: number } | null;
  joueurs: JoueurBal[];
  historique: { c: CaseBal; x: number }[];
  spectateurs: number;
  solde: number;
}

/** Les durées propres au Bal : la grande roue s'arrête à 6 s, la petite à 7,6 s. */
export const DUREES_BAL = { mises: 12_000, tourGrande: 6_000, tourPetite: 7_600, tour: 8_400, resultat: 6_000 };
