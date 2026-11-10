/**
 * Deuxième machine à sous du Salon privé : « Les Nuits du Baron ». 5 rouleaux × 3 rangées, 243 façons de gagner
 * (un symbole sur des rouleaux qui se suivent depuis la gauche, à n'importe quelle hauteur).
 *
 * - La Couronne (rouleaux 2 à 4) couvre tout son rouleau : le rouleau entier devient joker (un Juge ou un Jeton
 *   qui s'y trouvait est recouvert).
 * - Le Juge (rouleaux 1, 3 et 5) : 3 Juges paient 2 fois la mise et donnent 8 free games, où chaque tour a son
 *   événement. 3 nouveaux Juges en rajoutent 8.
 * - Sur certains tours, une carte Événement du jeu se retourne :
 *   - Descente de police : un rouleau devient joker et reste figé pour ce tour et les 2 suivants (pendant les
 *     free games, pour ce tour seulement) ;
 *   - Casse du siècle : une Couronne multiplicatrice (×2 ou ×3) couvre un rouleau ;
 *   - Trahison : des cartes mystère tombent, puis se retournent toutes sur le même symbole ;
 *   - Alliance : deux rouleaux voisins se soudent (le second recopie le premier) ;
 *   - Couvre-feu : les petits symboles (A, R, D) disparaissent, remplacés par des symboles de valeur.
 * - Le Jeton du Baron porte une somme ou un jackpot (MINI, MINOR, MAJOR). 6 Jetons lancent le bonus Jetons du
 *   Baron : les Jetons restent collés, 3 relances, remises à 3 à chaque nouveau Jeton ; tous les Jetons paient à la
 *   fin, et les 15 cases remplies donnent le GRAND.
 *
 * Le taux de retour (environ 107 % : une machine généreuse, l'argent du salon est fictif) est vérifié par
 * simulation : tauxDeRetourNuits().
 */

export type SymbolePayantNuit = 'chat' | 'chapeau' | 'champagne' | 'as' | 'roi' | 'dame';
export type SymboleNuit = SymbolePayantNuit | 'couronne' | 'juge' | 'mystere' | 'jeton';
export type TypeEvenementNuit = 'police' | 'casse' | 'trahison' | 'alliance' | 'couvreFeu';

export const PAYANTS_NUIT: SymbolePayantNuit[] = ['chat', 'chapeau', 'champagne', 'as', 'roi', 'dame'];
const PETITS: SymbolePayantNuit[] = ['as', 'roi', 'dame'];

/**
 * La mise est partagée en 20 pièces ; gains pour 3, 4 et 5 rouleaux, en pièces, par façon de gagner. Six symboles
 * seulement (sans Valet ni 10) : ils se retrouvent bien plus souvent d'un rouleau à l'autre, et un tour sur deux paie.
 */
export const PIECES_NUIT = 20;
export const GAINS_NUIT: Record<SymbolePayantNuit, [number, number, number]> = {
  chat: [10, 13, 20],
  chapeau: [8, 10, 15],
  champagne: [7, 9, 12],
  as: [7, 8, 10],
  roi: [6, 7, 9],
  dame: [6, 7, 8],
};
/** 3 Juges : 2 fois la mise et les free games. */
export const GAIN_JUGES_NUIT = 2;
export const FREE_GAMES_NUIT = 8;
export const FREE_GAMES_NUIT_MAX = 100;
/** Chance d'un événement sur un tour normal (pendant les free games : à chaque tour). */
export const CHANCE_EVENEMENT_NUIT = 0.07;
const POIDS_EVENEMENTS: [TypeEvenementNuit, number][] = [
  ['police', 2],
  ['casse', 2],
  ['trahison', 3],
  ['alliance', 3],
  ['couvreFeu', 3],
];
const MULTIPLES_CASSE = [2, 2, 3];
/** Tours où les rouleaux de la police restent figés après celui de l'événement. */
export const TOURS_POLICE = 2;

// ---------- Jackpots et bonus Jetons du Baron ----------
export type JackpotNuit = 'mini' | 'minor' | 'major' | 'grand';
/** Les jackpots, en nombre de fois la mise. */
export const JACKPOTS_NUIT: Record<JackpotNuit, number> = { mini: 10, minor: 25, major: 100, grand: 1000 };
export const ORDRE_JACKPOTS: JackpotNuit[] = ['grand', 'major', 'minor', 'mini'];
/** Ce que porte un Jeton : x fois la mise (et le jackpot qu'il représente). */
export interface ValeurJeton {
  x: number;
  jackpot?: Exclude<JackpotNuit, 'grand'>;
}
const VALEURS_JETON: [ValeurJeton, number][] = [
  [{ x: 0.5 }, 380],
  [{ x: 1 }, 300],
  [{ x: 2 }, 160],
  [{ x: 3 }, 85],
  [{ x: 5 }, 50],
  [{ x: JACKPOTS_NUIT.mini, jackpot: 'mini' }, 35],
  [{ x: JACKPOTS_NUIT.minor, jackpot: 'minor' }, 8],
  [{ x: JACKPOTS_NUIT.major, jackpot: 'major' }, 2],
];
export const JETONS_POUR_BONUS = 6;
export const RELANCES_JETONS = 3;
/** Chance, à chaque relance, qu'une case vide reçoive un Jeton (en millièmes). */
const CHANCE_JETON_RELANCE = 36;

export interface BonusJetons {
  /** Les Jetons du tour qui lance le bonus (case 0 à 14 = rouleau × 3 + rangée). */
  depart: Record<number, ValeurJeton>;
  /** Chaque relance : les Jetons tombés, et les relances qui restent ensuite. */
  relances: { nouvelles: Record<number, ValeurJeton>; restantes: number }[];
  valeurs: Record<number, ValeurJeton>;
  /** Les 15 cases remplies. */
  grand: boolean;
  gain: number;
}

const BASE: Record<SymbolePayantNuit, number> = { chat: 3, chapeau: 4, champagne: 4, as: 5, roi: 5, dame: 5 };
const avec = (extra: Partial<Record<SymboleNuit, number>>): Partial<Record<SymboleNuit, number>> => ({ ...BASE, ...extra });
export const COMPOSITION_NUIT: Partial<Record<SymboleNuit, number>>[] = [
  avec({ juge: 2, jeton: 2 }),
  avec({ couronne: 1, jeton: 2 }),
  avec({ couronne: 1, juge: 2, jeton: 2 }),
  avec({ couronne: 1, jeton: 2 }),
  avec({ juge: 2, jeton: 2 }),
];
/** En plus des Jetons isolés, chaque rouleau a une pile de Jetons. */
const PILES_JETON = [2, 2, 3, 2, 2];

/** Répartit les symboles régulièrement le long du rouleau (les rares ne se touchent jamais). */
function etaler(compo: Partial<Record<SymboleNuit, number>>, decalage: number): SymboleNuit[] {
  const places: { pos: number; ordre: number; s: SymboleNuit }[] = [];
  Object.entries(compo).forEach(([s, n], ordre) => {
    for (let k = 0; k < (n ?? 0); k++) places.push({ pos: (k + ((ordre * 0.41 + decalage * 0.23) % 1)) / (n ?? 1), ordre, s: s as SymboleNuit });
  });
  return places.sort((a, b) => a.pos - b.pos || a.ordre - b.ordre).map((p) => p.s);
}
function avecPile(bande: SymboleNuit[], taille: number, r: number): SymboleNuit[] {
  const pos = Math.floor(bande.length * ((0.37 + r * 0.29) % 1));
  return [...bande.slice(0, pos), ...Array<SymboleNuit>(taille).fill('jeton'), ...bande.slice(pos)];
}
export const BANDES_NUIT: SymboleNuit[][] = COMPOSITION_NUIT.map((c, r) => avecPile(etaler(c, r), PILES_JETON[r], r));

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
  /** Jetons à l'arrêt des rouleaux, puis ceux qui comptent (hors rouleaux joker), avec ce qu'ils portent. */
  jetonsAvant: Record<number, ValeurJeton>;
  jetons: Record<number, ValeurJeton>;
  /** Le bonus Jetons du Baron, joué d'un coup par le serveur (l'écran le rejoue relance par relance). */
  bonusJetons: BonusJetons | null;
  /** Gain total du tour, en dollars (bonus Jetons du Baron compris). */
  gain: number;
}

export type ForcerNuits = { arrets?: number[]; evenement?: TypeEvenementNuit; bonusJetons?: { grand?: boolean; jackpot?: Exclude<JackpotNuit, 'grand'> } };

function tirerValeurJeton(hasard: (n: number) => number): ValeurJeton {
  return { ...pondere(VALEURS_JETON, hasard) };
}

/** Le bonus Jetons du Baron : 3 relances, remises à 3 à chaque nouveau Jeton ; les 15 cases donnent le GRAND. */
export function jouerBonusJetons(hasard: (n: number) => number, mise: number, depart: Record<number, ValeurJeton>, remplir = false): BonusJetons {
  const valeurs: Record<number, ValeurJeton> = { ...depart };
  const relances: BonusJetons['relances'] = [];
  let restantes = RELANCES_JETONS;
  while (restantes > 0 && Object.keys(valeurs).length < 15) {
    const nouvelles: Record<number, ValeurJeton> = {};
    for (let c = 0; c < 15; c++) if (!(c in valeurs) && (remplir || hasard(1000) < CHANCE_JETON_RELANCE)) nouvelles[c] = tirerValeurJeton(hasard);
    Object.assign(valeurs, nouvelles);
    restantes = Object.keys(nouvelles).length ? RELANCES_JETONS : restantes - 1;
    relances.push({ nouvelles, restantes });
  }
  const grand = Object.keys(valeurs).length === 15;
  const somme = Object.values(valeurs).reduce((t, v) => t + v.x, 0) + (grand ? JACKPOTS_NUIT.grand : 0);
  return { depart, relances, valeurs, grand, gain: Math.round(somme * mise) };
}

/**
 * Durée approximative de l'animation d'un tour chez le joueur (en ms) : rouleaux, carte Événement, bonus Jetons
 * du Baron relance par relance puis le compte. Le serveur attend ce temps avant d'annoncer un gros gain au salon.
 */
export function dureeAnimationNuits(r: ResultatNuit): number {
  let t = 2900 + (r.evenement ? 3300 : 0);
  const b = r.bonusJetons;
  if (b) {
    t += 1600 + 1900 + b.relances.reduce((s, x) => s + (Object.keys(x.nouvelles).length ? 1250 : 1000), 0) + (b.grand ? 2600 : 0) + 500;
    t += Object.values(b.valeurs).reduce((s, v) => s + (v.jackpot ? 1200 : 240), 0) + 1100;
  }
  return t;
}

/** Le plus gros jackpot d'un bonus (pour les annonces et la fête). */
export function meilleurJackpot(b: BonusJetons): JackpotNuit | null {
  if (b.grand) return 'grand';
  const presents = new Set(Object.values(b.valeurs).map((v) => v.jackpot));
  return ORDRE_JACKPOTS.find((j) => presents.has(j as never)) ?? null;
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
  options: { gratuit: boolean; collantes: number[]; forcer?: ForcerNuits },
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
    const rouleaux = [libres[hasard(libres.length)]];
    sauvages.add(rouleaux[0]);
    evenement = { type: 'police', rouleaux };
  } else if (type === 'casse') {
    const rouleau = 1 + hasard(3);
    const multiple = MULTIPLES_CASSE[hasard(MULTIPLES_CASSE.length)];
    sauvages.add(rouleau);
    multiples[rouleau] = multiple;
    evenement = { type: 'casse', rouleau, multiple };
  } else if (type === 'trahison') {
    const candidates = Array.from({ length: 15 }, (_, i) => i).filter((i) => !sauvages.has(Math.floor(i / 3)) && grille[Math.floor(i / 3)][i % 3] !== 'juge' && grille[Math.floor(i / 3)][i % 3] !== 'jeton');
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
      ],
      hasard,
    );
    for (const c of cases) {
      avant[Math.floor(c / 3)][c % 3] = 'mystere';
      grille[Math.floor(c / 3)][c % 3] = symbole;
    }
    evenement = { type: 'trahison', cases, symbole };
  } else if (type === 'alliance') {
    // L'alliance ne fait jamais disparaître un Juge : elle soude alors les rouleaux 3 et 4.
    let de = 1 + hasard(2);
    if (de === 1 && grille[2].includes('juge') && !sauvages.has(2)) de = 2;
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

  // Démonstration : un bonus Jetons du Baron forcé (6 Jetons posés sur les premières cases libres).
  const fp = options.forcer?.bonusJetons;
  if (fp) {
    let n = grille.flat().filter((x, c) => x === 'jeton' && !sauvages.has(Math.floor(c / 3))).length;
    for (let c = 0; c < 15 && n < JETONS_POUR_BONUS; c++) {
      const r = Math.floor(c / 3);
      if (sauvages.has(r) || grille[r][c % 3] === 'jeton' || grille[r][c % 3] === 'juge') continue;
      grille[r][c % 3] = 'jeton';
      if (evenement?.type !== 'alliance' || r !== evenement.vers) avant[r][c % 3] = 'jeton';
      n++;
    }
  }

  // Les Jetons : chacun porte une somme ou un jackpot. Ceux des rouleaux joker sont recouverts.
  const jetonsAvant: Record<number, ValeurJeton> = {};
  avant.forEach((col, r) => col.forEach((s, k) => s === 'jeton' && (jetonsAvant[r * 3 + k] = tirerValeurJeton(hasard))));
  const jetons: Record<number, ValeurJeton> = {};
  grille.forEach((col, r) =>
    col.forEach((s, k) => {
      if (s !== 'jeton' || sauvages.has(r)) return;
      const source = evenement?.type === 'alliance' && r === evenement.vers ? evenement.de * 3 + k : r * 3 + k;
      jetons[r * 3 + k] = jetonsAvant[source] ?? tirerValeurJeton(hasard);
    }),
  );
  if (fp?.jackpot) {
    const c = Object.keys(jetons).map(Number)[0];
    if (c !== undefined) jetons[c] = jetonsAvant[c] = { x: JACKPOTS_NUIT[fp.jackpot], jackpot: fp.jackpot };
  }
  const bonusJetons = Object.keys(jetons).length >= JETONS_POUR_BONUS ? jouerBonusJetons(hasard, mise, jetons, fp?.grand) : null;

  const gains = gainsNuit(grille, sauvages, multiples, mise);
  // Un rouleau joker est entièrement couvert par la Couronne : ni Juge ni Jeton n'y comptent.
  const juges = grille.filter((_, r) => !sauvages.has(r)).flat().filter((x) => x === 'juge').length;
  const freeGames = juges >= 3 ? FREE_GAMES_NUIT : 0;
  const gain = gains.reduce((t, g) => t + g.gain, 0) + (juges >= 3 ? GAIN_JUGES_NUIT * mise : 0) + (bonusJetons?.gain ?? 0);
  return { arrets, avant, grille, evenement, sauvages: [...sauvages].sort(), multiples, gains, juges, freeGames, jetonsAvant, jetons, bonusJetons, gain };
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
export function jouerNuits(hasard: (n: number) => number, miseVoulue: number, etat: EtatNuits, forcer?: ForcerNuits) {
  const gratuit = etat.gratuits > 0;
  const mise = gratuit ? etat.miseGratuite : (etat.collantes?.mise ?? miseVoulue);
  if (gratuit) etat.gratuits -= 1;
  const r = tourNuits(hasard, mise, { gratuit, collantes: etat.collantes?.rouleaux ?? [], forcer });
  // Rouleaux figés : un tour de moins ; une nouvelle descente les fige pour les 2 tours suivants (pas pendant les
  // free games, où chaque tour a déjà son événement : la police n'y fige son rouleau que pour ce tour).
  if (r.evenement?.type === 'police' && !gratuit) etat.collantes = { rouleaux: r.evenement.rouleaux, restants: TOURS_POLICE, mise };
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
  let bonusJetons = 0;
  let grands = 0;
  let gainsJetons = 0;
  let gainsGratuits = 0;
  let gagnants = 0;
  let rendMise = 0;
  for (let i = 0; i < n || etat.gratuits > 0 || etat.collantes; i++) {
    const { resultat, mise, gratuit } = jouerNuits(hasard, 1000, etat);
    if (!gratuit) mises += mise;
    gains += resultat.gain;
    if (gratuit) gainsGratuits += resultat.gain;
    if (resultat.bonusJetons) {
      bonusJetons++;
      gainsJetons += resultat.bonusJetons.gain;
      if (resultat.bonusJetons.grand) grands++;
    }
    if (!gratuit && resultat.gain > 0) gagnants++;
    if (!gratuit && resultat.gain >= mise) rendMise++;
    if (resultat.freeGames && !gratuit) freeGames++;
    if (resultat.evenement && !gratuit) evenements++;
  }
  return {
    total: gains / mises,
    freeGames: freeGames / n,
    evenements: evenements / n,
    bonusJetons: bonusJetons / n,
    grands,
    partJetons: gainsJetons / mises,
    partGratuits: gainsGratuits / mises,
    gagnants: gagnants / n,
    rendMise: rendMise / n,
  };
}
