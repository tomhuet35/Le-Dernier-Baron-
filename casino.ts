/**
 * Salon privé du Baron : le casino réservé aux comptes qui ont le badge Créateur.
 * Argent fictif, sans aucune valeur réelle : rien ne s'achète et rien ne s'échange.
 */
import type { VueAffiche } from './afficheCasino';
import type { ResumeTableBJ } from './blackjack';
import type { CaseFN, HappyHourFN } from './folleNuit';
import type { ContenuCasse } from './machineASous';
import type { VueDefi } from './profilCasino';

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

/**
 * Cadeaux du Baron : chacun est une somme à récupérer une seule fois. Il s'arrête à une date fixe (`fin`), ou reste
 * ouvert `duree` ms à partir de sa mise en ligne (le serveur retient l'heure où il l'a ouvert, même s'il redémarre).
 * Le salon montre d'abord celui qui se termine le plus tôt.
 */
export interface CadeauSalon {
  id: string;
  montant: number;
  fin?: number;
  duree?: number;
}
export const CADEAUX_SALON: CadeauSalon[] = [
  // 50 millions pendant 30 minutes, dès la mise en ligne.
  { id: 'cadeau-50m-30min-2026-11-12', montant: 50_000_000, duree: 30 * 60_000 },
  // 30 millions pendant 30 minutes, dès la mise en ligne.
  { id: 'cadeau-30m-30min-2026-11-10', montant: 30_000_000, duree: 30 * 60_000 },
  // 9 millions pendant 30 minutes, dès la mise en ligne.
  { id: 'cadeau-9m-30min-2026-11-10', montant: 9_000_000, duree: 30 * 60_000 },
  // 9 millions jusqu'au mardi 10 novembre 2026, minuit à Paris.
  { id: 'cadeau-9m-2026-11', montant: 9_000_000, fin: Date.UTC(2026, 10, 10, 23, 0, 0) },
];
/** Fin d'un cadeau : sa date fixe, ou son ouverture + sa durée (null tant qu'il n'est pas ouvert). */
export function finCadeau(c: CadeauSalon, ouvertures: Record<string, number>): number | null {
  if (c.fin !== undefined) return c.fin;
  const debut = ouvertures[c.id];
  return debut !== undefined && c.duree !== undefined ? debut + c.duree : null;
}
/** Le cadeau à montrer à un joueur : encore ouvert, pas encore récupéré, et qui se termine le plus tôt. */
export function cadeauDisponible(cadeaux: CadeauSalon[], ouvertures: Record<string, number>, recuperes: string[], t: number): { cadeau: CadeauSalon; fin: number } | null {
  let meilleur: { cadeau: CadeauSalon; fin: number } | null = null;
  for (const c of cadeaux) {
    const fin = finCadeau(c, ouvertures);
    if (fin === null || t >= fin || recuperes.includes(c.id)) continue;
    if (!meilleur || fin < meilleur.fin) meilleur = { cadeau: c, fin };
  }
  return meilleur;
}

/** Gros lot progressif de la machine à sous : montant de départ, et part de chaque mise qui l'alimente. */
export const GROS_LOT_DEPART = 1_000_000;
export const PART_GROS_LOT = 0.01;
/** Le gros lot entier se gagne à partir de 100 000 $ de mise ; à une mise plus petite, on en gagne la part correspondante. */
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
  /** Niveau du casino (cadre d'avatar). */
  niveau?: number;
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
  /** Tables de roulette ouvertes (même résumé). */
  tablesRoulette: ResumeTableBJ[];
  /** Les Nuits du Baron : free games restants et rouleaux figés par la police. */
  nuits: { gratuits: number; miseGratuite: number; collantes: { rouleaux: number[]; restants: number; mise: number } | null };
  /** Bonus de la machine à sous à jouer (casse ou roue), ou null. */
  bonus: VueBonusMachine | null;
  /** Cadeau du Baron encore à récupérer (montant et fin), ou null. */
  cadeau: { montant: number; fin: number } | null;
  /** La Folle Nuit : en direct ou non, combien regardent, et les derniers résultats. */
  folleNuit?: { enDirect: boolean; spectateurs: number; historique: { case: CaseFN; x: number }[]; happyHour?: HappyHourFN };
  /** Les Coffres du Baron : une partie attend-elle le joueur ? */
  coffres?: { enCours: boolean };
  /** Mon profil du casino, en bref : niveau et XP, demandes d'amis et invitations à un défi, défi en cours. */
  profil?: { niveau: number; xp: number; xpNiveau: number; xpSuivant: number | null; bonusSuivant: number | null; demandes: number; invitations: number; defi: VueDefi | null };
  /** Le Vol de la Couronne : en direct ou non, combien regardent, les derniers envols. */
  couronne?: { enDirect: boolean; spectateurs: number; historique: number[] };
  /** La Course des Écuries : en direct ou non, combien regardent, les derniers gagnants. */
  course?: { enDirect: boolean; spectateurs: number; historique: { cheval: number; nom: string; cote: number }[] };
  /** Le jeu à l'affiche (XP doublée, bonus sur les gains) et le bonus déjà touché pendant son créneau. */
  affiche?: VueAffiche;
}

export interface AnnonceCasino {
  nom: string;
  jeu: 'machine' | 'roue' | 'casse' | 'roueBaron' | 'roulette' | 'nuits' | 'folleNuit' | 'coffres' | 'couronne' | 'chute' | 'course' | 'defi';
  /** Défi gagné : contre qui. */
  contre?: string;
  gain: number;
  grosLot?: boolean;
  /** Les Nuits du Baron : le jackpot décroché (MAJOR ou GRAND). */
  jackpot?: 'major' | 'grand';
}
