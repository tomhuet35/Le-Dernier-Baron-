/**
 * Salon privé du Baron : le casino réservé aux comptes qui ont le badge Créateur.
 * Argent fictif, sans aucune valeur réelle : rien ne s'achète et rien ne s'échange.
 */

/** Solde de départ, au premier passage au salon. */
export const SOLDE_DEPART = 1_000_000;
/** Plafond du solde (au-delà, l'argent gagné est perdu). */
export const SOLDE_MAX = 1_000_000_000_000;

/** Roulette du salon : un tour par jour (heure de Paris), 8 cases de même chance ; la case verte vaut le million. */
export const CASES_ROUE_SALON = [100_000, 100_000, 100_000, 1_000_000, 100_000, 100_000, 100_000, 100_000];
export const CASE_VERTE_SALON = 3;

/** Gros lot progressif de la machine à sous : montant de départ, et part de chaque mise qui l'alimente. */
export const GROS_LOT_DEPART = 1_000_000;
export const PART_GROS_LOT = 0.01;

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
}

export interface AnnonceCasino {
  nom: string;
  jeu: 'machine' | 'roue';
  gain: number;
  grosLot?: boolean;
}
