/**
 * Le Tailleur du Baron (Grand Hôtel du Baron) : une boutique de tenues pour le salon. Chaque tenue est un personnage
 * complet (images cartes/avatar-10.webp à avatar-21.webp) qu'on achète une fois, puis qu'on porte au salon à la place
 * de son personnage habituel (tables, classements, cercles, défis…). Tenues de ville et de soirée en dollars, tenues
 * de prestige en rubis. On peut toujours revenir à son personnage habituel.
 */
import type { EtatSalonJoueur } from './contrats';

export type Gamme = 'ville' | 'soiree' | 'prestige';
export interface Tenue {
  n: number;
  nom: [string, string];
  gamme: Gamme;
  prix: number;
  monnaie: 'dollars' | 'rubis';
}

export const TENUES: Tenue[] = [
  { n: 10, nom: ['Le Livreur de journaux', 'The Newsboy'], gamme: 'ville', prix: 50_000_000, monnaie: 'dollars' },
  { n: 11, nom: ['Le Chauffeur', 'The Chauffeur'], gamme: 'ville', prix: 50_000_000, monnaie: 'dollars' },
  { n: 12, nom: ['La Barmaid', 'The Barmaid'], gamme: 'ville', prix: 50_000_000, monnaie: 'dollars' },
  { n: 13, nom: ['Le Champion', 'The Champion'], gamme: 'ville', prix: 50_000_000, monnaie: 'dollars' },
  { n: 14, nom: ['La Meneuse de revue', 'The Showgirl'], gamme: 'soiree', prix: 500_000_000, monnaie: 'dollars' },
  { n: 15, nom: ['Le Pianiste', 'The Pianist'], gamme: 'soiree', prix: 500_000_000, monnaie: 'dollars' },
  { n: 16, nom: ['L’Héritière', 'The Heiress'], gamme: 'soiree', prix: 500_000_000, monnaie: 'dollars' },
  { n: 21, nom: ['Le Crooner', 'The Crooner'], gamme: 'soiree', prix: 500_000_000, monnaie: 'dollars' },
  { n: 17, nom: ['Le Parrain', 'The Don'], gamme: 'prestige', prix: 150, monnaie: 'rubis' },
  { n: 18, nom: ['L’Espionne', 'The Spy'], gamme: 'prestige', prix: 150, monnaie: 'rubis' },
  { n: 19, nom: ['Le Magicien', 'The Magician'], gamme: 'prestige', prix: 150, monnaie: 'rubis' },
  { n: 20, nom: ['La Baronne', 'The Baroness'], gamme: 'prestige', prix: 300, monnaie: 'rubis' },
];
export const NOMS_GAMMES: Record<Gamme, [string, string]> = {
  ville: ['Tenues de ville', 'Day wear'],
  soiree: ['Tenues de soirée', 'Evening wear'],
  prestige: ['Tenues de prestige', 'Prestige wear'],
};
export const tenue = (n: number) => TENUES.find((t) => t.n === n) ?? null;
export const estTenue = (n: unknown): n is number => typeof n === 'number' && TENUES.some((t) => t.n === n);

/** Le personnage montré au salon : la tenue portée, sinon le personnage du compte. */
export const avatarCasino = (avatarCompte: number, e: Pick<EtatSalonJoueur, 'tenue' | 'tenues'>) => (e.tenue && e.tenues.includes(e.tenue) ? e.tenue : avatarCompte);

export function normaliserTenues(v: unknown): number[] {
  return Array.isArray(v) ? [...new Set(v.filter(estTenue))] : [];
}

export interface VueTailleur {
  tenues: number[];
  tenue: number | null;
}
