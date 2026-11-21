/**
 * Sur les toits (Salon privé, au Bar) : le Monte-en-l'air du Baron court sur le toit d'un train de nuit, de wagon en
 * wagon, jusqu'au fourgon blindé. Le joueur choisit sa mise et la difficulté, puis saute : chaque saut réussi fait monter
 * le multiplicateur ; un saut raté (un tunnel trop bas, un wagon qui se décroche), et la mise est perdue. Il encaisse
 * quand il veut ; au dixième saut, il atteint le fourgon et la partie s'encaisse d'elle-même.
 *
 * Le multiplicateur est juste : après k sauts réussis, il vaut 97 % de l'inverse de la chance d'en être arrivé là, donc
 * chaque façon de jouer rend 97 % des mises en moyenne (comme les autres jeux du salon).
 */

export type Hasard = (n: number) => number;

export type NiveauToits = 'promenade' | 'express' | 'rapide' | 'baron';
export const NIVEAUX_TOITS: NiveauToits[] = ['promenade', 'express', 'rapide', 'baron'];
/** La chance de chuter à chaque saut, selon la difficulté. */
export const RISQUE_TOITS: Record<NiveauToits, number> = { promenade: 0.08, express: 0.16, rapide: 0.28, baron: 0.44 };
export const NOMS_NIVEAUX_TOITS: Record<NiveauToits, [string, string]> = {
  promenade: ['Promenade', 'Stroll'],
  express: ['Express', 'Express'],
  rapide: ['Rapide de nuit', 'Night Flyer'],
  baron: ['Le Baron', 'The Baron'],
};
/** Le nombre de sauts jusqu'au fourgon blindé (le dernier saut y mène). */
export const SAUTS_TOITS = 10;
export const MISES_TOITS = [1_000, 2_000, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 2_500_000, 5_000_000, 10_000_000];
/** Ce que le jeu rend en moyenne. */
export const RTP_TOITS = 0.97;
/** Les obstacles qui font chuter : un tunnel trop bas, l'attelage qui casse. */
export type ObstacleToits = 'tunnel' | 'attelage';

export const niveauValide = (n: unknown): n is NiveauToits => typeof n === 'string' && (NIVEAUX_TOITS as string[]).includes(n);

/** Multiplicateur après `sauts` sauts réussis (arrondi au centième inférieur ; 1 avant le premier saut). */
export function multiplicateurToits(niveau: NiveauToits, sauts: number): number {
  if (sauts <= 0) return 1;
  const chance = (1 - RISQUE_TOITS[niveau]) ** sauts;
  return Math.floor((RTP_TOITS / chance) * 100 + 1e-9) / 100;
}

/** Les multiplicateurs successifs d'une difficulté : après 1 saut, 2 sauts… jusqu'au fourgon. */
export const echelleToits = (niveau: NiveauToits) => Array.from({ length: SAUTS_TOITS }, (_, k) => multiplicateurToits(niveau, k + 1));

/** Le gain d'une mise à ce multiplicateur (mise rendue comprise), en dollars entiers. */
export const gainToits = (mise: number, x: number) => Math.floor((mise * Math.round(x * 100)) / 100);

/** Le saut réussit-il ? (tirage sur 10 000) */
export const sautReussi = (h: Hasard, niveau: NiveauToits) => h(10_000) >= Math.round(RISQUE_TOITS[niveau] * 10_000);

/** La partie vue par le téléphone. */
export interface VueToits {
  mise: number;
  niveau: NiveauToits;
  /** Sauts réussis (le wagon où se tient le Monte-en-l'air : 0 au départ, SAUTS_TOITS sur le fourgon). */
  sauts: number;
  etat: 'enCours' | 'perdu' | 'encaisse';
  /** Le multiplicateur atteint, le prochain (null au fourgon ou partie finie). */
  x: number;
  suivant: number | null;
  /** Ce que rapporterait l'encaissement maintenant (ou le gain final, mise comprise ; 0 si perdu). */
  gain: number;
  /** L'obstacle qui l'a fait chuter. */
  obstacle: ObstacleToits | null;
}
