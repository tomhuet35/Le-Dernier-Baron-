import type { BilanNuit } from './types';

/**
 * Expérience gagnée à chaque partie terminée (hors parties de test).
 * Les victoires comptent le plus : une victoire de partie vaut 100, chaque nuit gagnée 20.
 */
export const XP_PARTIE = 10;
export const XP_VICTOIRE = 100;
export const XP_NUIT = 20;

/** Titres du niveau 1 au niveau 10 ; au-delà, on reste Baron (avec le numéro du niveau). */
export const TITRES = [
  'Petite frappe',
  'Guetteur',
  'Pickpocket',
  'Homme de main',
  'Croupier',
  'Contrebandier',
  'Lieutenant',
  'Bras droit',
  'Parrain',
  'Baron',
];

/** XP totale pour atteindre le niveau n : 100 pour le niveau 2, puis 50 de plus à chaque palier (250, 450, 700…). */
export function xpPourNiveau(n: number): number {
  const k = Math.max(0, Math.floor(n) - 1);
  return 100 * k + 25 * k * (k - 1);
}

export function niveauDepuisXp(xp: number): number {
  let n = 1;
  while (xpPourNiveau(n + 1) <= xp) n++;
  return n;
}

export function titreNiveau(n: number): string {
  return TITRES[Math.min(Math.max(1, n), TITRES.length) - 1];
}

export interface Progression {
  niveau: number;
  titre: string;
  /** XP gagnée depuis le début du niveau actuel. */
  xpDansNiveau: number;
  /** XP nécessaire pour passer du niveau actuel au suivant. */
  xpPalier: number;
  /** Avancement vers le niveau suivant, de 0 à 1. */
  fraction: number;
}

export function progression(xp: number): Progression {
  const niveau = niveauDepuisXp(xp);
  const debut = xpPourNiveau(niveau);
  const xpPalier = xpPourNiveau(niveau + 1) - debut;
  const xpDansNiveau = xp - debut;
  return { niveau, titre: titreNiveau(niveau), xpDansNiveau, xpPalier, fraction: Math.min(1, xpDansNiveau / xpPalier) };
}

export interface ResultatJoueur {
  joueurId: string;
  /** 1 pour le ou les vainqueurs (égalité partagée), puis 2, 3… en sautant les places des ex æquo. */
  rang: number;
  score: number;
  victoire: boolean;
  nuitsGagnees: number;
  annoncesReussies: number;
  xp: number;
}

/**
 * Résultats d'une partie terminée.
 * - Victoire de partie : meilleur score final (les ex æquo deviennent tous le Dernier Baron).
 * - Victoire de nuit : meilleur total de la nuit, à condition d'être positif (ex æquo compris).
 */
export function resultatsPartie(joueurs: { id: string; score: number }[], bilans: BilanNuit[]): ResultatJoueur[] {
  const nuits: Record<string, number> = Object.fromEntries(joueurs.map((j) => [j.id, 0]));
  const reussies: Record<string, number> = Object.fromEntries(joueurs.map((j) => [j.id, 0]));
  for (const b of bilans) {
    const meilleur = Math.max(...b.scores.map((s) => s.total));
    for (const s of b.scores) {
      if (meilleur > 0 && s.total === meilleur && s.joueurId in nuits) nuits[s.joueurId] += 1;
      if (s.reussie && s.joueurId in reussies) reussies[s.joueurId] += 1;
    }
  }
  const scores = joueurs.map((j) => j.score);
  return joueurs.map((j) => {
    const rang = 1 + scores.filter((s) => s > j.score).length;
    const victoire = rang === 1;
    const nuitsGagnees = nuits[j.id];
    return {
      joueurId: j.id,
      rang,
      score: j.score,
      victoire,
      nuitsGagnees,
      annoncesReussies: reussies[j.id],
      xp: XP_PARTIE + (victoire ? XP_VICTOIRE : 0) + XP_NUIT * nuitsGagnees,
    };
  });
}

/** Tapis de jeu : récompenses débloquées en montant de niveau. */
export type IdTapis = 'baron' | 'velours' | 'prestige' | 'noir' | 'or-noir';

export interface Tapis {
  id: IdTapis;
  nom: string;
  niveau: number;
}

export const TAPIS: Tapis[] = [
  { id: 'baron', nom: 'Classique', niveau: 1 },
  { id: 'velours', nom: 'Velours', niveau: 5 },
  { id: 'prestige', nom: 'Prestige', niveau: 10 },
  { id: 'noir', nom: 'Noir de sang', niveau: 15 },
  { id: 'or-noir', nom: 'Or noir', niveau: 20 },
];

export const TAPIS_PAR_DEFAUT: IdTapis = 'baron';

export function estTapis(v: unknown): v is IdTapis {
  return TAPIS.some((t) => t.id === v);
}

export function tapisDebloque(id: IdTapis, niveau: number): boolean {
  const t = TAPIS.find((x) => x.id === id);
  return !!t && niveau >= t.niveau;
}

/** Tapis réellement posé sur la table : le choix du joueur s'il est débloqué, sinon le classique. */
export function tapisActif(choix: unknown, xp: number): IdTapis {
  return estTapis(choix) && tapisDebloque(choix, niveauDepuisXp(xp)) ? choix : TAPIS_PAR_DEFAUT;
}

/** Tapis gagnés en passant d'un niveau à un autre (fin de partie). */
export function tapisGagnes(niveauAvant: number, niveauApres: number): Tapis[] {
  return TAPIS.filter((t) => t.niveau > niveauAvant && t.niveau <= niveauApres);
}

/** Tables publiques par niveau : chaque joueur rejoint d'abord une table de sa tranche. */
export const TRANCHES = [
  { min: 1, nom: 'Débutants', detail: 'niv. 1 à 4' },
  { min: 5, nom: 'Confirmés', detail: 'niv. 5 à 9' },
  { min: 10, nom: 'Experts', detail: 'niv. 10 à 14' },
  { min: 15, nom: 'Barons', detail: 'niv. 15 et plus' },
];
export function trancheNiveau(niveau: number): number {
  let t = 0;
  TRANCHES.forEach((x, i) => {
    if (niveau >= x.min) t = i;
  });
  return t;
}

/** Week-end XP double : samedi et dimanche, à l'heure de Paris. */
export const XP_DOUBLE_LE_WEEKEND = true;
export function estWeekendXpDouble(date: Date = new Date()): boolean {
  if (!XP_DOUBLE_LE_WEEKEND) return false;
  const jour = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', weekday: 'short' }).format(date);
  return jour === 'Sat' || jour === 'Sun';
}
