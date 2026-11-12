/**
 * Le profil du casino (Salon privé), à part du jeu de cartes : niveaux, titres et cadres, amis du casino, envois
 * d'argent et défis entre amis.
 *
 * - L'XP vient de l'argent misé dans tous les jeux du salon : 1 XP pour 1 000 $ misés (une mise annulée et rendue ne
 *   compte pas).
 * - Chaque nouveau niveau verse un bonus (niveau × 100 000 $, cinq fois plus tous les 10 niveaux) ; tous les 10
 *   niveaux, un nouveau titre et un nouveau cadre d'avatar. Un niveau n'est payé qu'une fois.
 * - Défis : deux amis jouent chacun de leur côté pendant 5 à 30 minutes ; le meilleur bilan (gains − mises) au jeu
 *   choisi remporte les deux mises du défi. Égalité : chacun récupère la sienne.
 */

export type JeuCasino = 'machine' | 'nuits' | 'blackjack' | 'roulette' | 'folleNuit' | 'coffres' | 'couronne' | 'chute';
export const JEUX_CASINO: JeuCasino[] = ['machine', 'nuits', 'blackjack', 'roulette', 'folleNuit', 'coffres', 'couronne', 'chute'];
export const NOMS_JEUX_CASINO: Record<JeuCasino, [string, string]> = {
  machine: ['Le Bandit du Baron', 'The Baron’s Bandit'],
  nuits: ['Les Nuits du Baron', 'The Baron’s Nights'],
  blackjack: ['Blackjack', 'Blackjack'],
  roulette: ['Roulette', 'Roulette'],
  folleNuit: ['La Folle Nuit', 'Crazy Night'],
  coffres: ['Les Coffres du Baron', 'The Baron’s Safes'],
  couronne: ['Le Vol de la Couronne', 'The Crown’s Flight'],
  chute: ['La Chute des Écus', 'The Falling Crowns'],
};
export const estJeuCasino = (x: unknown): x is JeuCasino => JEUX_CASINO.includes(x as JeuCasino);

// ---------------------------------------------------------------------------------------------------------------
// Niveaux

/** 1 XP pour 1 000 $ misés. */
export const DOLLARS_PAR_XP = 1_000;
export const NIVEAU_MAX_CASINO = 100;

export const xpDeMises = (mise: number) => Math.max(0, Math.floor(mise / DOLLARS_PAR_XP));

/** XP totale pour atteindre le niveau n : 1 000 pour le niveau 2, 3 000 pour le 3, 45 000 pour le 10… (500 × k × (k + 1)). */
export function xpPourNiveauCasino(n: number): number {
  const k = Math.min(NIVEAU_MAX_CASINO, Math.max(1, Math.floor(n))) - 1;
  return 500 * k * (k + 1);
}

export function niveauCasino(xp: number): number {
  if (!(xp > 0)) return 1;
  let k = Math.floor((-1 + Math.sqrt(1 + (4 * xp) / 500)) / 2);
  // Garde-fou contre les arrondis de la racine.
  while (k > 0 && 500 * k * (k + 1) > xp) k--;
  while (500 * (k + 1) * (k + 2) <= xp) k++;
  return Math.min(NIVEAU_MAX_CASINO, k + 1);
}

/** Bonus versé en atteignant le niveau n (rien au niveau 1). */
export const bonusNiveauCasino = (n: number) => (n <= 1 ? 0 : n * 100_000 * (n % 10 === 0 ? 5 : 1));

/** Un titre tous les 10 niveaux. */
export const TITRES_CASINO: [string, string][] = [
  ['Novice', 'Rookie'],
  ['Habitué', 'Regular'],
  ['Flambeur', 'Big spender'],
  ['Joueur de haut vol', 'High roller'],
  ['Grand flambeur', 'Whale'],
  ['Roi des tables', 'King of the tables'],
  ['Magnat', 'Tycoon'],
  ['Nabab', 'Mogul'],
  ['Légende du salon', 'Lounge legend'],
  ['Seigneur du casino', 'Casino lord'],
  ['Baron du casino', 'Casino baron'],
];
export const titreCasino = (niveau: number): [string, string] => TITRES_CASINO[Math.min(TITRES_CASINO.length - 1, Math.floor(Math.max(1, niveau) / 10))];

/** Un cadre d'avatar tous les 10 niveaux. */
export type CadreCasino = 'aucun' | 'bronze' | 'argent' | 'or' | 'rubis' | 'saphir' | 'emeraude' | 'amethyste' | 'perle' | 'flamme' | 'baron';
export const CADRES_CASINO: { id: CadreCasino; niveau: number; nom: [string, string] }[] = [
  { id: 'bronze', niveau: 10, nom: ['Bronze', 'Bronze'] },
  { id: 'argent', niveau: 20, nom: ['Argent', 'Silver'] },
  { id: 'or', niveau: 30, nom: ['Or', 'Gold'] },
  { id: 'rubis', niveau: 40, nom: ['Rubis', 'Ruby'] },
  { id: 'saphir', niveau: 50, nom: ['Saphir', 'Sapphire'] },
  { id: 'emeraude', niveau: 60, nom: ['Émeraude', 'Emerald'] },
  { id: 'amethyste', niveau: 70, nom: ['Améthyste', 'Amethyst'] },
  { id: 'perle', niveau: 80, nom: ['Perle', 'Pearl'] },
  { id: 'flamme', niveau: 90, nom: ['Flamme', 'Flame'] },
  { id: 'baron', niveau: 100, nom: ['Couronne du Baron', 'Baron’s crown'] },
];
export const cadreCasino = (niveau: number): CadreCasino => [...CADRES_CASINO].reverse().find((c) => niveau >= c.niveau)?.id ?? 'aucun';

/** Où en est un joueur : niveau, XP du niveau en cours et du suivant, bonus du suivant. */
export function progressionCasino(mise: number) {
  const xp = xpDeMises(mise);
  const niveau = niveauCasino(xp);
  const max = niveau >= NIVEAU_MAX_CASINO;
  return {
    xp,
    niveau,
    xpNiveau: xpPourNiveauCasino(niveau),
    xpSuivant: max ? null : xpPourNiveauCasino(niveau + 1),
    bonusSuivant: max ? null : bonusNiveauCasino(niveau + 1),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Profil, amis, envois

/** Où joue quelqu'un dans le salon (pour le rejoindre). */
export interface PositionCasino {
  ecran: 'salon' | JeuCasino;
  /** Blackjack ou roulette : le code de sa table. */
  table?: string;
}

export interface StatsJeuCasino {
  mise: number;
  gain: number;
}

export type EntreeJournalCasino =
  | { t: number; type: 'envoi' | 'recu'; nom: string; montant: number }
  | { t: number; type: 'defi'; nom: string; resultat: 'gagne' | 'perdu' | 'nul'; montant: number }
  | { t: number; type: 'niveau'; niveau: number; montant: number };
export const JOURNAL_MAX = 30;

export interface BilanDefis {
  gagnes: number;
  perdus: number;
  nuls: number;
}

export interface ProfilCasino {
  uid: string;
  nom: string;
  avatar: number;
  niveau: number;
  xp: number;
  /** XP du début du niveau en cours, et du suivant (null au niveau maximum). */
  xpNiveau: number;
  xpSuivant: number | null;
  bonusSuivant: number | null;
  solde: number;
  /** Total misé, total des gains versés (mise rendue comprise), plus gros gain d'un coup. */
  mise: number;
  gagne: number;
  plusGrosGain: number;
  jeux: Partial<Record<JeuCasino, StatsJeuCasino>>;
  defis: BilanDefis;
  /** Premier passage au salon. */
  depuis: number;
  enLigne: boolean;
  ou: PositionCasino | null;
  relation: 'moi' | 'ami' | 'demande_envoyee' | 'demande_recue' | 'aucune';
  /** Mon activité récente (seulement sur mon profil). */
  journal?: EntreeJournalCasino[];
}

/** Un joueur du salon, en bref (listes d'amis). */
export interface JoueurCasino {
  uid: string;
  nom: string;
  avatar: number;
  niveau: number;
  enLigne: boolean;
  ou: PositionCasino | null;
}

export interface VueAmisCasino {
  amis: JoueurCasino[];
  recues: JoueurCasino[];
  envoyees: JoueurCasino[];
  /** Les autres joueurs du salon (à ajouter). */
  autres: JoueurCasino[];
  /** Ce qu'il reste à envoyer aujourd'hui. */
  envoisRestants: number;
}

export const AMIS_MAX_CASINO = 50;
/** Sommes proposées pour un envoi, et plafond par jour (heure de Paris). */
export const MONTANTS_ENVOI = [100_000, 500_000, 1_000_000, 5_000_000, 10_000_000];
export const ENVOI_MAX_JOUR = 50_000_000;

// ---------------------------------------------------------------------------------------------------------------
// Défis entre amis

export type JeuDefi = JeuCasino | 'tous';
export const estJeuDefi = (x: unknown): x is JeuDefi => x === 'tous' || estJeuCasino(x);
export const DUREES_DEFI = [5 * 60_000, 10 * 60_000, 15 * 60_000, 30 * 60_000];
/** Mise de chaque joueur (0 : pour l'honneur). */
export const MISES_DEFI = [0, 100_000, 500_000, 1_000_000, 5_000_000, 10_000_000, 50_000_000];
/** Une invitation reste ouverte 10 minutes. */
export const EXPIRATION_DEFI = 10 * 60_000;
/** Invitations envoyées en attente, au plus. */
export const DEFIS_ENVOYES_MAX = 3;

export type EtatDefi = 'attente' | 'enCours' | 'fini' | 'refuse' | 'annule' | 'expire';

export interface JoueurDefi {
  uid: string;
  nom: string;
  avatar: number;
}

export interface VueDefi {
  id: string;
  de: JoueurDefi;
  vers: JoueurDefi;
  jeu: JeuDefi;
  duree: number;
  mise: number;
  etat: EtatDefi;
  creeLe: number;
  /** Bilans (gains − mises) pendant le défi. */
  scores: { de: number; vers: number };
  gagnant: 'de' | 'vers' | 'nul' | null;
  /** Temps restant (ms) au moment de l'envoi : avant l'expiration de l'invitation, ou avant la fin du défi. */
  reste: number | null;
  fin: number | null;
}

/** Résultat d'un défi fini, vu par un joueur. */
export function resultatDefi(d: VueDefi, uid: string): 'gagne' | 'perdu' | 'nul' | null {
  if (d.etat !== 'fini' || !d.gagnant) return null;
  if (d.gagnant === 'nul') return 'nul';
  return (d.gagnant === 'de') === (d.de.uid === uid) ? 'gagne' : 'perdu';
}
