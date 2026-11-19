/**
 * Le Grand Hôtel du Baron (troisième brique) : les étages du salon, la carte de membre, la Semaine du Baron, la happy
 * hour, la Ristourne du Baron et le champagne du Penthouse.
 *
 * - Étages, débloqués par niveau du casino : le bar (machines, Coffres) dès le niveau 1, les tables au niveau 5, la
 *   scène (spectacles en direct, Couronne, Chute) au niveau 15, le Penthouse au niveau 40. Le serveur refuse les mises
 *   d'un jeu dont l'étage est fermé.
 * - Carte de membre selon le niveau : bronze, argent (20), or (40), noire (70). Elle multiplie la roulette du salon,
 *   et la carte noire rend chaque lundi 5 % des pertes de la semaine passée (la Ristourne du Baron).
 * - Semaine du Baron : du lundi au dimanche (heure de Paris), un télégramme par jour de connexion ; le dimanche, le
 *   coffre (plus gros si les six autres jours ont été pris).
 * - Happy hour : chaque soir de 21 h à 22 h (heure de Paris), les mises comptent double pour l'XP.
 */
import { dollarsContrat, echelleNiveau } from './contrats';
import { lendemainParis } from './roulette';
import type { JeuCasino } from './profilCasino';

// ---------------------------------------------------------------------------------------------------------------
// Les étages

export type Etage = 'bar' | 'tables' | 'scene' | 'penthouse';
export const ETAGES: { id: Etage; nom: [string, string]; numero: [string, string]; niveau: number; jeux: JeuCasino[]; image: string }[] = [
  { id: 'bar', nom: ['Le Bar', 'The Bar'], numero: ['Rez-de-chaussée', 'Ground floor'], niveau: 1, jeux: ['machine', 'nuits', 'coffres'], image: '/cartes/etage-bar.webp' },
  { id: 'tables', nom: ['Les Tables', 'The Tables'], numero: ['1er étage', '1st floor'], niveau: 5, jeux: ['blackjack', 'roulette'], image: '/cartes/etage-tables.webp' },
  { id: 'scene', nom: ['La Scène', 'The Stage'], numero: ['2e étage', '2nd floor'], niveau: 15, jeux: ['folleNuit', 'baronWheel', 'course', 'couronne', 'chute'], image: '/cartes/etage-scene.webp' },
  { id: 'penthouse', nom: ['Le Penthouse', 'The Penthouse'], numero: ['Dernier étage', 'Top floor'], niveau: 40, jeux: [], image: '/cartes/etage-penthouse.webp' },
];
export const etage = (id: Etage) => ETAGES.find((e) => e.id === id)!;
export const etageDuJeu = (jeu: JeuCasino): Etage => ETAGES.find((e) => e.jeux.includes(jeu))?.id ?? 'bar';
export const etageOuvert = (niveau: number, id: Etage) => niveau >= etage(id).niveau;
/** Les tables VIP du Penthouse : mises et jetons multipliés par 10. */
export const FACTEUR_VIP = 10;
export const jeuOuvert = (niveau: number, jeu: JeuCasino) => etageOuvert(niveau, etageDuJeu(jeu));

// ---------------------------------------------------------------------------------------------------------------
// La carte de membre

export type CarteMembre = 'bronze' | 'argent' | 'or' | 'noire';
export const CARTES_MEMBRE: { id: CarteMembre; niveau: number; nom: [string, string]; roue: number }[] = [
  { id: 'bronze', niveau: 1, nom: ['Membre Bronze', 'Bronze member'], roue: 1 },
  { id: 'argent', niveau: 20, nom: ['Membre Argent', 'Silver member'], roue: 1.5 },
  { id: 'or', niveau: 40, nom: ['Membre Or', 'Gold member'], roue: 2 },
  { id: 'noire', niveau: 70, nom: ['Membre Noir', 'Black member'], roue: 3 },
];
export const carteMembre = (niveau: number) => [...CARTES_MEMBRE].reverse().find((c) => niveau >= c.niveau)!;
export const carteSuivante = (niveau: number) => CARTES_MEMBRE.find((c) => c.niveau > niveau) ?? null;
/** La Ristourne du Baron (carte noire) : la part des pertes de la semaine rendue le lundi, et son plafond. */
export const PART_RISTOURNE = 0.05;
export const RISTOURNE_MAX = 5_000_000_000;
export const ristourne = (niveau: number, mise: number, gain: number) =>
  carteMembre(niveau).id === 'noire' && mise > gain ? Math.min(RISTOURNE_MAX, Math.floor((mise - gain) * PART_RISTOURNE)) : 0;

// ---------------------------------------------------------------------------------------------------------------
// Les heures de Paris

const FORMAT_PARIS = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', weekday: 'short', hour: '2-digit', hourCycle: 'h23' });
const JOURS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** Le jour de la semaine à Paris : 0 lundi … 6 dimanche. */
export function jourSemaineParis(t: number): number {
  const wd = FORMAT_PARIS.formatToParts(t).find((p) => p.type === 'weekday')?.value ?? 'Mon';
  return Math.max(0, JOURS.indexOf(wd));
}

/** La happy hour du soir (21 h – 22 h, heure de Paris) : en cours, ou la prochaine. */
export const HEURE_HAPPY_HOUR = 21;
export function happyHour(t: number): { debut: number; fin: number; enCours: boolean } {
  const minuit = lendemainParis(t);
  // Aucun changement d'heure n'a lieu entre 21 h et minuit : 21 h est 3 heures avant le minuit suivant.
  const debut = minuit - (24 - HEURE_HAPPY_HOUR) * 3_600_000;
  const fin = debut + 3_600_000;
  if (t < fin) return { debut, fin, enCours: t >= debut };
  const demain = lendemainParis(minuit + 1) - (24 - HEURE_HAPPY_HOUR) * 3_600_000;
  return { debut: demain, fin: demain + 3_600_000, enCours: false };
}

// ---------------------------------------------------------------------------------------------------------------
// La Semaine du Baron

export interface CadeauSemaine {
  dollars: number;
  rubis: number;
}
const RUBIS_JOURS = [1, 1, 2, 1, 2, 2];
const DOLLARS_JOURS = [1, 1, 1.5, 1.5, 2, 2];
/** Le coffre du dimanche : complet si les six autres jours ont été pris. */
export const COFFRE_COMPLET: { rubis: number; dollars: number } = { rubis: 15, dollars: 5 };
export const COFFRE_PARTIEL: { rubis: number; dollars: number } = { rubis: 5, dollars: 2 };

/** Le cadeau d'un jour (0 lundi … 6 dimanche) ; pris : les jours déjà pris cette semaine. */
export function cadeauSemaine(jour: number, niveau: number, pris: readonly number[]): CadeauSemaine {
  const base = dollarsContrat(niveau);
  if (jour < 6) return { dollars: Math.round(base * DOLLARS_JOURS[jour]), rubis: RUBIS_JOURS[jour] };
  const complet = [0, 1, 2, 3, 4, 5].every((j) => pris.includes(j));
  const c = complet ? COFFRE_COMPLET : COFFRE_PARTIEL;
  return { dollars: base * c.dollars, rubis: c.rubis };
}

/** Cadeau de bienvenue des membres : offert une fois, à la première entrée au salon avec un compte (pas en invité). */
export const CADEAU_COMPTE: CadeauSemaine = { dollars: 500_000, rubis: 15 };

/** Le champagne du Penthouse : une fois par jour, pour les membres du Penthouse. */
export const champagnePenthouse = (niveau: number): CadeauSemaine => ({ dollars: 1_000_000 * echelleNiveau(niveau), rubis: 3 });

// ---------------------------------------------------------------------------------------------------------------
// Vue (téléphone)

export interface VueHotel {
  niveau: number;
  carte: CarteMembre;
  /** Semaine du Baron : le jour (0 lundi … 6 dimanche), les jours pris, le cadeau du jour (null s'il est pris). */
  semaine: { jour: number; pris: number[]; cadeau: CadeauSemaine | null; coffreComplet: boolean };
  happyHour: { debut: number; fin: number; enCours: boolean };
  /** Penthouse : le champagne du jour est-il à prendre ? */
  champagne: CadeauSemaine | null;
}

/** Ce que le serveur annonce au téléphone : la Ristourne du lundi. */
export interface AnnonceHotel {
  type: 'ristourne';
  montant: number;
}
