/**
 * Deuxième machine à sous du Salon privé : « Les Nuits du Baron ». 5 rouleaux × 3 rangées, 243 façons de gagner
 * (un symbole sur des rouleaux qui se suivent depuis la gauche, à n'importe quelle hauteur).
 *
 * - La Couronne (rouleaux 2 à 4) couvre tout son rouleau : le rouleau entier devient joker.
 * - Le Juge (rouleaux 1, 3 et 5) : 3 Juges paient 2 fois la mise et donnent 8 free games, où chaque tour a son
 *   événement. 3 nouveaux Juges en rajoutent 8.
 * - Sur certains tours, une carte Événement du jeu se retourne :
 *   - Descente de police : 1 ou 2 rouleaux deviennent joker et restent figés pour ce tour et les 2 suivants ;
 *   - Casse du siècle : une Couronne multiplicatrice (×2 à ×10) couvre un rouleau ;
 *   - Trahison : des cartes mystère tombent, puis se retournent toutes sur le même symbole ;
 *   - Alliance : deux rouleaux voisins se soudent (le second recopie le premier) ;
 *   - Couvre-feu : les petits symboles (A, R, D, V, 10) disparaissent, remplacés par des symboles de valeur.
 *
 * Le taux de retour (environ 96 %) est vérifié par simulation : tauxDeRetourNuits().
 */

export type SymbolePayantNuit = 'chat' | 'chapeau' | 'champagne' | 'as' | 'roi' | 'dame' | 'valet' | 'dix';
export type SymboleNuit = SymbolePayantNuit | 'couronne' | 'juge' | 'mystere';
export type TypeEvenementNuit = 'police' | 'casse' | 'trahison' | 'alliance' | 'couvreFeu';

export const PAYANTS_NUIT: SymbolePayantNuit[] = ['chat', 'chapeau', 'champagne', 'as', 'roi', 'dame', 'valet', 'dix'];
const PETITS: SymbolePayantNuit[] = ['as', 'roi', 'dame', 'valet', 'dix'];

/** La mise est partagée en 20 pièces ; gains pour 3, 4 et 5 rouleaux, en pièces, par façon de gagner. */
export const PIECES_NUIT = 20;
export const GAINS_NUIT: Record<SymbolePayantNuit, [number, number, number]> = {
  chat: [9, 22, 60],
  chapeau: [7, 15, 38],
  champagne: [6, 12, 30],
  as: [4, 9, 18],
  roi: [3, 7, 14],
  dame: [3, 6, 12],
  valet: [2, 4, 9],
  dix: [1, 3, 8],
};
/** 3 Juges : 2 fois la mise et les free games. */
export const GAIN_JUGES_NUIT = 2;
export const FREE_GAMES_NUIT = 8;
export const FREE_GAMES_NUIT_MAX = 100;
/** Chance d'un événement sur un tour normal (pendant les free games : à chaque tour). */
export const CHANCE_EVENEMENT_NUIT = 0.05;
const POIDS_EVENEMENTS: [TypeEvenementNuit, number][] = [
  ['police', 3],
  ['casse', 2],
  ['trahison', 3],
  ['alliance', 2],
  ['couvreFeu', 2],
];
const MULTIPLES_CASSE = [2, 2, 2, 3, 3, 5];
/** Tours où les rouleaux de la police restent figés après celui de l'événement. */
export const TOURS_POLICE = 2;

const BASE: Record<SymbolePayantNuit, number> = { chat: 2, chapeau: 3, champagne: 4, as: 5, roi: 5, dame: 6, valet: 6, dix: 7 };
const avec = (extra: Partial<Record<SymboleNuit, number>>): Partial<Record<SymboleNuit, number>> => ({ ...BASE, ...extra });
export const COMPOSITION_NUIT: Partial<Record<SymboleNuit, number>>[] = [avec({ juge: 3 }), avec({ couronne: 1 }), avec({ couronne: 1, juge: 2 }), avec({ couronne: 1 }), avec({ juge: 3 })];

/** Répartit les symboles régulièrement le long du rouleau (les rares ne se touchent jamais). */
function etaler(compo: Partial<Record<SymboleNuit, number>>, decalage: number): SymboleNuit[] {
  const places: { pos: number; ordre: number; s: SymboleNuit }[] = [];
  Object.entries(compo).forEach(([s, n], ordre) => {
    for (let k = 0; k < (n ?? 0); k++) places.push({ pos: (k + ((ordre * 0.41 + decalage * 0.23) % 1)) / (n ?? 1), ordre, s: s as SymboleNuit });
  });
  return places.sort((a, b) => a.pos - b.pos || a.ordre - b.ordre).map((p) => p.s);
}
export const BANDES_NUIT: SymboleNuit[][] = COMPOSITION_NUIT.map((c, r) => etaler(c, r));

export type EvenementNuit =
  | { type: 'police'; rouleaux: number[] }
  | { type: 'casse'; rouleau: number; multiple: number }
  | { type: 'trahison'; cases: number[]; symbole: SymbolePayantNuit }
  | { type: 'alliance'; de: number; vers: number }
  | { type: 'couvreFeu'; cases: number[] };

export interface GainNuit {
  symbole: SymbolePayantNuit;
  /** Nombre de rouleaux (3 à 5) et de façons de gagner. */
  longueur: number;
  voies: number;
  /** Multiplicateur des Couronnes du casse traversées. */
  multiple: number;
  gain: number;
}

export interface ResultatNuit {
  arrets: number[];
  /** Grille à l'arrêt des rouleaux, avant l'événement (cartes mystère comprises), [rouleau][rangée]. */
  avant: SymboleNuit[][];
  /** Grille finale, après l'événement. */
  grille: SymboleNuit[][];
  evenement: EvenementNuit | null;
  /** Rouleaux entièrement joker (Couronnes tombées, police, casse), et leur multiplicateur. */
  sauvages: number[];
  multiples: Record<number, number>;
  gains: GainNuit[];
  juges: number;
  freeGames: number;
  /** Gain total du tour, en dollars. */
  gain: number;
}

/** Tirage pondéré : hasard(n) renvoie un entier de 0 à n − 1. */
function pondere<T>(liste: [T, number][], hasard: (n: number) => number): T {
  const total = liste.reduce((s, [, p]) => s + p, 0);
  let x = hasard(total);
  for (const [v, p] of liste) {
    if (x < p) return v;
    x -= p;
  }
  return liste[liste.length - 1][0];
}

/**
 * Un tour des Nuits du Baron. `collantes` : rouleaux figés par une descente de police en cours. Pendant les
 * free games (`gratuit`), un événement tombe à chaque tour. `forcer` sert aux tests et à la démonstration.
 */
export function tourNuits(
  hasard: (n: number) => number,
  mise: number,
  options: { gratuit: boolean; collantes: number[]; forcer?: { arrets?: number[]; evenement?: TypeEvenementNuit } },
): ResultatNuit {
  const arrets = options.forcer?.arrets ?? BANDES_NUIT.map((b) => hasard(b.length));
  const base: SymboleNuit[][] = BANDES_NUIT.map((b, r) => [0, 1, 2].map((k) => b[(arrets[r] + k) % b.length]));
  const avant = base.map((c) => [...c]);
  const grille = base.map((c) => [...c]);
  const sauvages = new Set<number>(options.collantes);
  const multiples: Record<number, number> = {};
  base.forEach((col, r) => col.includes('couronne') && sauvages.add(r));

  // L'événement du tour.
  let type: TypeEvenementNuit | null = options.forcer?.evenement ?? null;
  if (!type && (options.gratuit || hasard(10_000) < CHANCE_EVENEMENT_NUIT * 10_000)) {
    const possibles = POIDS_EVENEMENTS.filter(([t]) => t !== 'police' || !options.collantes.length);
    type = pondere(possibles, hasard);
  }
  let evenement: EvenementNuit | null = null;
  const libres = [1, 2, 3].filter((r) => !sauvages.has(r));
  if (type === 'police' && libres.length) {
    const nb = Math.min(libres.length, hasard(8) === 0 ? 2 : 1);
    const rouleaux: number[] = [];
    while (rouleaux.length < nb) {
      const r = libres[hasard(libres.length)];
      if (!rouleaux.includes(r)) rouleaux.push(r);
    }
    rouleaux.sort();
    rouleaux.forEach((r) => sauvages.add(r));
    evenement = { type: 'police', rouleaux };
  } else if (type === 'casse') {
    const rouleau = 1 + hasard(3);
    const multiple = MULTIPLES_CASSE[hasard(MULTIPLES_CASSE.length)];
    sauvages.add(rouleau);
    multiples[rouleau] = multiple;
    evenement = { type: 'casse', rouleau, multiple };
  } else if (type === 'trahison') {
    const candidates = Array.from({ length: 15 }, (_, i) => i).filter((i) => !sauvages.has(Math.floor(i / 3)) && grille[Math.floor(i / 3)][i % 3] !== 'juge');
    const nb = Math.min(candidates.length, 3 + hasard(3));
    const cases: number[] = [];
    while (cases.length < nb) {
      const c = candidates[hasard(candidates.length)];
      if (!cases.includes(c)) cases.push(c);
    }
    cases.sort((a, b) => a - b);
    const symbole = pondere<SymbolePayantNuit>(
      [
        ['chat', 1],
        ['chapeau', 2],
        ['champagne', 3],
        ['as', 4],
        ['roi', 4],
        ['dame', 4],
        ['valet', 4],
        ['dix', 4],
      ],
      hasard,
    );
    for (const c of cases) {
      avant[Math.floor(c / 3)][c % 3] = 'mystere';
      grille[Math.floor(c / 3)][c % 3] = symbole;
    }
    evenement = { type: 'trahison', cases, symbole };
  } else if (type === 'alliance') {
    const de = 1 + hasard(2);
    grille[de + 1] = [...grille[de]];
    if (sauvages.has(de)) sauvages.add(de + 1);
    evenement = { type: 'alliance', de, vers: de + 1 };
  } else if (type === 'couvreFeu') {
    const cases: number[] = [];
    grille.forEach((col, r) =>
      col.forEach((s, k) => {
        if (r > 2 || !PETITS.includes(s as SymbolePayantNuit)) return;
        col[k] = pondere<SymbolePayantNuit>(
          [
            ['chat', 1],
            ['chapeau', 2],
            ['champagne', 4],
          ],
          hasard,
        );
        cases.push(r * 3 + k);
      }),
    );
    evenement = { type: 'couvreFeu', cases };
  }

  const gains = gainsNuit(grille, sauvages, multiples, mise);
  const juges = grille.flat().filter((x) => x === 'juge').length;
  const freeGames = juges >= 3 ? FREE_GAMES_NUIT : 0;
  const gain = gains.reduce((t, g) => t + g.gain, 0) + (juges >= 3 ? GAIN_JUGES_NUIT * mise : 0);
  return { arrets, avant, grille, evenement, sauvages: [...sauvages].sort(), multiples, gains, juges, freeGames, gain };
}

/** Les 243 façons : chaque symbole du premier rouleau, prolongé tant que les rouleaux suivants l'ont (ou sont joker). */
export function gainsNuit(grille: SymboleNuit[][], sauvages: Set<number>, multiples: Record<number, number>, mise: number): GainNuit[] {
  const pieceDollars = mise / PIECES_NUIT;
  const gains: GainNuit[] = [];
  for (const s of PAYANTS_NUIT) {
    let voies = grille[0].filter((x) => x === s).length;
    if (!voies) continue;
    let longueur = 1;
    let multiple = 1;
    for (let r = 1; r < 5; r++) {
      const c = sauvages.has(r) ? 3 : grille[r].filter((x) => x === s).length;
      if (!c) break;
      voies *= c;
      longueur++;
      multiple *= multiples[r] ?? 1;
    }
    if (longueur < 3) continue;
    gains.push({ symbole: s, longueur, voies, multiple, gain: Math.round(GAINS_NUIT[s][longueur - 3] * voies * multiple * pieceDollars) });
  }
  return gains;
}

/** État d'un joueur entre deux tours : free games restants et rouleaux figés par la police. */
export interface EtatNuits {
  gratuits: number;
  miseGratuite: number;
  collantes: { rouleaux: number[]; restants: number; mise: number } | null;
}
export const etatNuitsVide = (): EtatNuits => ({ gratuits: 0, miseGratuite: 0, collantes: null });

/**
 * Joue un tour et fait avancer l'état (free games, rouleaux figés). La mise est imposée pendant les free games
 * et pendant une descente de police (on ne peut pas monter la mise sur des jokers déjà figés).
 */
export function jouerNuits(hasard: (n: number) => number, miseVoulue: number, etat: EtatNuits, forcer?: { arrets?: number[]; evenement?: TypeEvenementNuit }) {
  const gratuit = etat.gratuits > 0;
  const mise = gratuit ? etat.miseGratuite : (etat.collantes?.mise ?? miseVoulue);
  if (gratuit) etat.gratuits -= 1;
  const r = tourNuits(hasard, mise, { gratuit, collantes: etat.collantes?.rouleaux ?? [], forcer });
  // Rouleaux figés : un tour de moins ; une nouvelle descente les fige pour les 2 tours suivants.
  if (r.evenement?.type === 'police') etat.collantes = { rouleaux: r.evenement.rouleaux, restants: TOURS_POLICE, mise };
  else if (etat.collantes) {
    etat.collantes.restants -= 1;
    if (etat.collantes.restants <= 0) etat.collantes = null;
  }
  if (r.freeGames) {
    etat.gratuits = Math.min(FREE_GAMES_NUIT_MAX, etat.gratuits + r.freeGames);
    etat.miseGratuite = mise;
  }
  // Fin des free games : la police lève ses barrages.
  if (gratuit && etat.gratuits === 0 && !r.freeGames) etat.collantes = null;
  return { resultat: r, mise, gratuit };
}

/** Taux de retour mesuré sur n tours joués d'affilée (free games et rouleaux figés compris). */
export function tauxDeRetourNuits(n: number, hasard: (k: number) => number) {
  const etat = etatNuitsVide();
  let mises = 0;
  let gains = 0;
  let freeGames = 0;
  let evenements = 0;
  for (let i = 0; i < n || etat.gratuits > 0 || etat.collantes; i++) {
    const { resultat, mise, gratuit } = jouerNuits(hasard, 1000, etat);
    if (!gratuit) mises += mise;
    gains += resultat.gain;
    if (resultat.freeGames && !gratuit) freeGames++;
    if (resultat.evenement && !gratuit) evenements++;
  }
  return { total: gains / mises, freeGames: freeGames / n, evenements: evenements / n };
}
