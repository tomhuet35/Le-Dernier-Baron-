/**
 * Le jeu à l'affiche (Salon privé) : toutes les 3 heures (0 h, 3 h, 6 h… heure de Paris), un jeu du salon est mis en
 * avant, à tour de rôle. Pendant son créneau :
 * - ses mises comptent double pour l'XP du casino ;
 * - ses gains reçoivent un bonus de 10 %, jusqu'à 1 000 000 $ de bonus par joueur et par créneau.
 *
 * 8 créneaux par jour pour 10 jeux : chaque jour, 8 jeux passent à l'affiche, et l'ordre glisse d'un cran (ceux qui
 * manquent un jour passent dans les deux jours suivants). En 10 jours, chaque jeu passe à chaque heure (celui qui joue
 * toujours le soir les voit tous à l'affiche).
 */
import type { JeuCasino } from './profilCasino';

export const DUREE_AFFICHE = 3 * 3_600_000;
/** L'ordre de passage (un jeu de table, un jeu de hasard, un live… en alternance). */
export const ORDRE_AFFICHE: JeuCasino[] = ['chute', 'roulette', 'baronWheel', 'machine', 'course', 'couronne', 'blackjack', 'coffres', 'nuits', 'folleNuit'];
/** Les mises du jeu à l'affiche comptent deux fois pour l'XP. */
export const XP_AFFICHE = 2;
/** Bonus sur les gains du jeu à l'affiche, et plafond de ce bonus par joueur et par créneau. */
export const BONUS_AFFICHE = 0.1;
export const PLAFOND_BONUS_AFFICHE = 1_000_000;

const PARIS = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Paris',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

export interface AfficheCasino {
  jeu: JeuCasino;
  /** Début du créneau (identifiant du créneau) et millisecondes avant sa fin. */
  debut: number;
  reste: number;
  /** Le jeu du créneau suivant. */
  suivant: JeuCasino;
}

/** Le jeu à l'affiche à l'instant t. */
export function afficheCasino(t: number): AfficheCasino {
  const p: Record<string, string> = {};
  for (const x of PARIS.formatToParts(new Date(t))) p[x.type] = x.value;
  const jour = Math.floor(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)) / 86_400_000);
  const secondes = (Number(p.hour) % 24) * 3600 + Number(p.minute) * 60 + Number(p.second);
  const creneau = Math.floor(secondes / (DUREE_AFFICHE / 1000));
  const dansCreneau = secondes * 1000 - creneau * DUREE_AFFICHE + (t % 1000);
  const n = ORDRE_AFFICHE.length;
  const rang = (((jour + creneau) % n) + n) % n;
  return { jeu: ORDRE_AFFICHE[rang], debut: t - dansCreneau, reste: DUREE_AFFICHE - dansCreneau, suivant: ORDRE_AFFICHE[(rang + 1) % n] };
}

/** Ce que le téléphone voit : le jeu à l'affiche, et le bonus que le joueur y a déjà touché pendant ce créneau. */
export interface VueAffiche extends AfficheCasino {
  bonus: number;
}
