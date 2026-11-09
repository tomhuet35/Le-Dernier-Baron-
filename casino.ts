/**
 * Salon privé du Baron : le casino réservé aux comptes qui ont le badge Créateur.
 * Argent fictif, sans aucune valeur réelle : rien ne s'achète et rien ne s'échange.
 */
import type { ResumeTableBJ } from './blackjack';
import type { ContenuCasse } from './machineASous';

/** Bonus de la machine à sous en cours (à finir avant de rejouer) : le Casse du coffre ou la Roue du Baron. */
export type VueBonusMachine =
  | { type: 'casse'; mise: number; ouverts: (ContenuCasse | null)[]; coups: number; butin: number; multiplicateur: number }
  | { type: 'roue'; mise: number };

/** Solde de départ, au premier passage au salon. */
export const SOLDE_DEPART = 1_000_000;
/** Plafond du solde (au-delà, l'argent gagné est perdu). */
export const SOLDE_MAX = 1_000_000_000_000;

/**
 * Roulette du salon : un tour par jour (heure de Paris), 8 cases de même chance (1 sur 8) ;
 * la case verte (comme le zéro du casino) vaut le million.
 */
export const CASES_ROUE_SALON = [100_000, 25_000, 300_000, 1_000_000, 10_000, 500_000, 50_000, 250_000];
export const CASE_VERTE_SALON = 3;
/** À partir de ce gain, la roulette du salon est fêtée en grand et annoncée à tout le salon. */
export const GROS_GAIN_ROUE = 500_000;

/** Cadeau du Baron : une somme à récupérer une seule fois, jusqu'à la date prévue (mardi 10 novembre 2026, minuit à Paris). */
export const CADEAU_SALON = { id: 'cadeau-9m-2026-11', montant: 9_000_000, fin: Date.UTC(2026, 10, 10, 23, 0, 0) };

/** Gros lot progressif de la machine à sous : montant de départ, et part de chaque mise qui l'alimente. */
export const GROS_LOT_DEPART = 1_000_000;
export const PART_GROS_LOT = 0.01;
/** Le gros lot entier se gagne à la mise maximale ; à une mise plus petite, on en gagne la part correspondante. */
export const MISE_GROS_LOT_ENTIER = 100_000;
export const partGrosLot = (pot: number, mise: number) => Math.floor((pot * Math.min(mise, MISE_GROS_LOT_ENTIER)) / MISE_GROS_LOT_ENTIER);

/** Au-delà de ce multiple de la mise, le gain de la machine à sous est fêté en grand et annoncé dans le salon. */
export const MULTIPLE_GROS_GAIN = 50;

/** « 1 250 000 $ » (ou « $1,250,000 » en anglais). */
export function formatDollars(n: number, en = false): string {
  const v = Math.round(n);
  return en ? `$${v.toLocaleString('en-US')}` : `${v.toLocaleString('fr-FR').replace(/\s/g, ' ')} $`;
}

export interface RicheSalon {
  nom: string;
  avatar: number;
  solde: number;
  moi?: true;
}

/** Ce que le téléphone d'un créateur reçoit en entrant au salon (et à chaque changement). */
export interface VueCasino {
  /** Pseudo et avatar du joueur (en-tête du salon). */
  nom: string;
  avatar: number;
  solde: number;
  /** Prochaine roulette du salon (minuit à Paris), ou null si elle est disponible. */
  roueProchaine: number | null;
  grosLot: number;
  /** Tours gratuits de la machine à sous qui restent (et la mise qui les a déclenchés). */
  toursGratuits: number;
  miseGratuite: number;
  riches: RicheSalon[];
  /** Tables de blackjack ouvertes. */
  tables: ResumeTableBJ[];
  /** Bonus de la machine à sous à jouer (casse ou roue), ou null. */
  bonus: VueBonusMachine | null;
  /** Cadeau du Baron encore à récupérer (montant et fin), ou null. */
  cadeau: { montant: number; fin: number } | null;
}

export interface AnnonceCasino {
  nom: string;
  jeu: 'machine' | 'roue' | 'casse' | 'roueBaron';
  gain: number;
  grosLot?: boolean;
}
