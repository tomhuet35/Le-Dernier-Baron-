/**
 * Machine à sous « Le Bandit du Baron » (Salon privé du casino) : 5 rouleaux × 3 rangées, 10 lignes de gain fixes.
 *
 * - La Couronne est le joker : elle remplace tous les symboles sauf le Coffre, et paie aussi seule (5 Couronnes =
 *   1 000 × la mise de ligne).
 * - Le Coffre-fort paie n'importe où (3, 4 ou 5 sur la grille) et 3 Coffres ou plus donnent 8 tours gratuits où tous
 *   les gains comptent double (et qui peuvent se relancer).
 * - 5 Coffres sur une même ligne : gros lot du salon (progressif, géré par le serveur, hors taux de retour).
 *
 * Le taux de retour (hors gros lot) est calculé exactement par tauxDeRetour() : 96 % environ.
 */

export type SymboleMachine = 'couronne' | 'coffre' | 'sept' | 'lingot' | 'diamant' | 'champagne' | 'cigare' | 'fer';
export type SymboleLigne = Exclude<SymboleMachine, 'coffre'>;

export const SYMBOLES_MACHINE: SymboleMachine[] = ['couronne', 'coffre', 'sept', 'lingot', 'diamant', 'champagne', 'cigare', 'fer'];

/** Gains d'une ligne pour 3, 4 et 5 symboles alignés depuis la gauche, en multiples de la mise de ligne. */
export const GAINS_LIGNE: Record<SymboleLigne, [number, number, number]> = {
  couronne: [50, 250, 1000],
  sept: [30, 120, 500],
  lingot: [20, 80, 250],
  diamant: [15, 50, 150],
  champagne: [10, 30, 100],
  cigare: [8, 20, 60],
  fer: [6, 15, 40],
};

/** Coffres n'importe où sur la grille : gain en multiples de la mise totale. */
export const GAINS_COFFRES: Record<number, number> = { 3: 2, 4: 10, 5: 50 };
export const TOURS_GRATUITS = 8;
export const MULTIPLICATEUR_GRATUIT = 2;
/** Tours gratuits au plus d'affilée (relances comprises). */
export const TOURS_GRATUITS_MAX = 64;

/** Mises possibles par tour (réparties sur les 10 lignes). */
export const MISES_MACHINE = [1_000, 2_000, 5_000, 10_000, 20_000, 50_000, 100_000];
export const NB_LIGNES = 10;

/** Les 10 lignes : la rangée (0 en haut, 2 en bas) prise sur chacun des 5 rouleaux. */
export const LIGNES: number[][] = [
  [1, 1, 1, 1, 1],
  [0, 0, 0, 0, 0],
  [2, 2, 2, 2, 2],
  [0, 1, 2, 1, 0],
  [2, 1, 0, 1, 2],
  [0, 0, 1, 2, 2],
  [2, 2, 1, 0, 0],
  [1, 0, 0, 0, 1],
  [1, 2, 2, 2, 1],
  [0, 1, 1, 1, 0],
];

/** Nombre de chaque symbole sur chacun des 5 rouleaux (32 cases par rouleau). */
export const COMPOSITION: Record<SymboleMachine, number>[] = [
  { couronne: 1, coffre: 1, sept: 2, lingot: 3, diamant: 4, champagne: 5, cigare: 7, fer: 9 },
  { couronne: 1, coffre: 1, sept: 2, lingot: 3, diamant: 4, champagne: 5, cigare: 7, fer: 9 },
  { couronne: 1, coffre: 1, sept: 2, lingot: 3, diamant: 4, champagne: 5, cigare: 7, fer: 9 },
  { couronne: 1, coffre: 1, sept: 2, lingot: 3, diamant: 4, champagne: 5, cigare: 7, fer: 9 },
  { couronne: 1, coffre: 1, sept: 2, lingot: 3, diamant: 4, champagne: 5, cigare: 7, fer: 9 },
];

/** Répartit les symboles régulièrement le long du rouleau (les rares ne se touchent jamais). */
function etaler(compo: Record<SymboleMachine, number>, decalage: number): SymboleMachine[] {
  const places: { pos: number; ordre: number; s: SymboleMachine }[] = [];
  SYMBOLES_MACHINE.forEach((s, ordre) => {
    const n = compo[s];
    for (let k = 0; k < n; k++) places.push({ pos: (k + ((ordre * 0.37 + decalage * 0.21) % 1)) / n, ordre, s });
  });
  return places.sort((a, b) => a.pos - b.pos || a.ordre - b.ordre).map((p) => p.s);
}

export const BANDES: SymboleMachine[][] = COMPOSITION.map((c, r) => etaler(c, r));

/** Grille [rouleau][rangée] vue quand chaque rouleau s'arrête sur cette case (rangée du haut). */
export type GrilleMachine = SymboleMachine[][];
export function grilleDepuisArrets(arrets: number[]): GrilleMachine {
  return BANDES.map((bande, r) => [0, 1, 2].map((k) => bande[(arrets[r] + k) % bande.length]));
}

export interface GainLigne {
  /** Numéro de la ligne (0 à 9). */
  ligne: number;
  symbole: SymboleLigne;
  nombre: number;
  /** En multiples de la mise de ligne (avant le multiplicateur des tours gratuits). */
  multiple: number;
}

/** Meilleur gain d'une suite de 5 symboles lue de gauche à droite (joker compris). */
export function gainSuite(s: SymboleMachine[]): { symbole: SymboleLigne; nombre: number; multiple: number } | null {
  let jokers = 0;
  while (jokers < 5 && s[jokers] === 'couronne') jokers++;
  const parJoker = jokers >= 3 ? GAINS_LIGNE.couronne[jokers - 3] : 0;
  let meilleur: { symbole: SymboleLigne; nombre: number; multiple: number } | null = parJoker ? { symbole: 'couronne', nombre: jokers, multiple: parJoker } : null;
  const base = s[jokers];
  if (jokers < 5 && base !== 'coffre') {
    let n = jokers;
    while (n < 5 && (s[n] === base || s[n] === 'couronne')) n++;
    const m = n >= 3 ? GAINS_LIGNE[base as SymboleLigne][n - 3] : 0;
    if (m > (meilleur?.multiple ?? 0)) meilleur = { symbole: base as SymboleLigne, nombre: n, multiple: m };
  }
  return meilleur;
}

export interface ResultatMachine {
  arrets: number[];
  grille: GrilleMachine;
  lignes: GainLigne[];
  coffres: number;
  /** Gain total du tour (lignes + coffres, multiplicateur compris), en dollars. */
  gain: number;
  /** Tours gratuits gagnés par ce tour. */
  toursGagnes: number;
  /** 5 Coffres alignés sur une ligne : gros lot du salon. */
  grosLot: boolean;
}

export function evaluerMachine(arrets: number[], mise: number, gratuit: boolean): ResultatMachine {
  const grille = grilleDepuisArrets(arrets);
  const miseLigne = mise / NB_LIGNES;
  const mult = gratuit ? MULTIPLICATEUR_GRATUIT : 1;
  const lignes: GainLigne[] = [];
  let grosLot = false;
  LIGNES.forEach((rangs, ligne) => {
    const suite = rangs.map((rang, r) => grille[r][rang]);
    if (suite.every((x) => x === 'coffre')) grosLot = true;
    const g = gainSuite(suite);
    if (g) lignes.push({ ligne, ...g });
  });
  const coffres = grille.flat().filter((x) => x === 'coffre').length;
  const gainLignes = lignes.reduce((t, l) => t + l.multiple * miseLigne, 0);
  const gainCoffres = (GAINS_COFFRES[coffres] ?? 0) * mise;
  return {
    arrets,
    grille,
    lignes,
    coffres,
    gain: Math.round((gainLignes + gainCoffres) * mult),
    toursGagnes: coffres >= 3 ? TOURS_GRATUITS : 0,
    grosLot,
  };
}

/** Un tour : hasard(n) renvoie un entier de 0 à n − 1 (crypto.randomInt sur le serveur, une graine dans les tests). */
export function tirerMachine(hasard: (n: number) => number, mise: number, gratuit: boolean): ResultatMachine {
  return evaluerMachine(
    BANDES.map((b) => hasard(b.length)),
    mise,
    gratuit,
  );
}

/**
 * Taux de retour exact (hors gros lot), en fraction de la mise :
 * lignes (chaque case d'une rangée suit la composition du rouleau), coffres (fenêtre de 3 cases sur chaque rouleau),
 * puis tours gratuits (E_gratuit = 2 × (lignes + coffres) + P(bonus) × 8 × E_gratuit).
 */
export function tauxDeRetour(): { lignes: number; coffres: number; pBonus: number; gratuits: number; total: number } {
  const probas = COMPOSITION.map((c) => {
    const n = Object.values(c).reduce((a, b) => a + b, 0);
    return SYMBOLES_MACHINE.map((s) => c[s] / n);
  });
  let lignes = 0;
  const suite: SymboleMachine[] = [];
  const parcourir = (r: number, p: number) => {
    if (r === 5) {
      const g = gainSuite(suite);
      // En mises de ligne ; sur 10 lignes à un dixième de la mise chacune, c'est aussi la part de la mise totale.
      if (g) lignes += p * g.multiple;
      return;
    }
    SYMBOLES_MACHINE.forEach((s, i) => {
      const q = probas[r][i];
      if (!q) return;
      suite[r] = s;
      parcourir(r + 1, p * q);
    });
  };
  parcourir(0, 1);
  // Nombre de coffres visibles : loi exacte rouleau par rouleau, puis combinée.
  let loi = [1];
  for (const bande of BANDES) {
    const parRouleau = [0, 0, 0, 0];
    for (let a = 0; a < bande.length; a++) {
      const k = [0, 1, 2].filter((d) => bande[(a + d) % bande.length] === 'coffre').length;
      parRouleau[k] += 1 / bande.length;
    }
    const suivante = new Array(loi.length + 3).fill(0);
    loi.forEach((p, i) => parRouleau.forEach((q, k) => (suivante[i + k] += p * q)));
    loi = suivante;
  }
  const coffres = loi.reduce((t, p, k) => t + p * (GAINS_COFFRES[k] ?? 0), 0);
  const pBonus = loi.reduce((t, p, k) => t + (k >= 3 ? p : 0), 0);
  const gratuit = (MULTIPLICATEUR_GRATUIT * (lignes + coffres)) / (1 - TOURS_GRATUITS * pBonus);
  const gratuits = pBonus * TOURS_GRATUITS * gratuit;
  return { lignes, coffres, pBonus, gratuits, total: lignes + coffres + gratuits };
}
