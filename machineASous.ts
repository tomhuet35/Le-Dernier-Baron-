/**
 * Machine à sous « Le Bandit du Baron » (Salon privé du casino) : 5 rouleaux × 3 rangées, 10 lignes de gain fixes.
 *
 * - La Couronne est le joker : elle remplace tous les symboles sauf le Coffre, et paie aussi seule.
 * - Le Coffre-fort paie n'importe où (3, 4 ou 5 sur la grille) et 3 Coffres ou plus lancent le Casse du coffre :
 *   12 coffres fermés, on en ouvre un par coup (billets, lingot qui multiplie le butin, « +2 coups ») jusqu'à ce que
 *   les coups soient épuisés ou que la sirène de police sonne ; on repart avec le butin.
 * - Une Couronne visible sur le premier ET sur le dernier rouleau lance la Roue du Baron : ×10 à ×100 la mise,
 *   10 tours gratuits (gains doublés), ou la case verte du gros lot du salon.
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
/** Tours gratuits de la Roue du Baron, où tous les gains des lignes comptent double. */
export const TOURS_GRATUITS = 10;
export const MULTIPLICATEUR_GRATUIT = 2;
/** Tours gratuits au plus d'affilée. */
export const TOURS_GRATUITS_MAX = 60;

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

/**
 * Nombre de chaque symbole sur chaque rouleau. Le premier et le dernier rouleau sont deux fois plus longs avec une
 * seule Couronne : la Roue du Baron reste rare (une Couronne sur chacun des deux à la fois).
 */
const COURT: Record<SymboleMachine, number> = { couronne: 1, coffre: 1, sept: 2, lingot: 3, diamant: 4, champagne: 5, cigare: 7, fer: 9 };
const LONG: Record<SymboleMachine, number> = { couronne: 1, coffre: 2, sept: 4, lingot: 6, diamant: 8, champagne: 10, cigare: 15, fer: 18 };
export const COMPOSITION: Record<SymboleMachine, number>[] = [LONG, COURT, COURT, COURT, LONG];

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
  /** 3 Coffres ou plus : le Casse du coffre. */
  casse: boolean;
  /** Une Couronne sur le premier et sur le dernier rouleau : la Roue du Baron. */
  roue: boolean;
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
    casse: coffres >= 3,
    roue: grille[0].includes('couronne') && grille[4].includes('couronne'),
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

// ---------------------------------------------------------------------------------------------------------------
// Le Casse du coffre

export type ContenuCasse = { type: 'billets'; valeur: number } | { type: 'lingot' } | { type: 'coups' } | { type: 'sirene' };
/** Les 12 coffres : 6 liasses (multiples de la mise), 2 lingots (+1 au multiplicateur), 2 « +2 coups », 2 sirènes. */
export const CONTENU_CASSE: ContenuCasse[] = [
  { type: 'billets', valeur: 2 },
  { type: 'billets', valeur: 3 },
  { type: 'billets', valeur: 4 },
  { type: 'billets', valeur: 5 },
  { type: 'billets', valeur: 8 },
  { type: 'billets', valeur: 13 },
  { type: 'lingot' },
  { type: 'lingot' },
  { type: 'coups' },
  { type: 'coups' },
  { type: 'sirene' },
  { type: 'sirene' },
];
export const COUPS_DEPART_CASSE = 3;
export const COUPS_BONUS_CASSE = 2;

export interface EtatCasse {
  /** Contenu des 12 coffres (gardé par le serveur). */
  contenus: ContenuCasse[];
  ouverts: boolean[];
  coups: number;
  /** Somme des liasses trouvées, en multiples de la mise. */
  butin: number;
  multiplicateur: number;
  fini: boolean;
  /** Le casse s'est arrêté sur la sirène. */
  sirene: boolean;
}

export function nouveauCasse(hasard: (n: number) => number): EtatCasse {
  const contenus = [...CONTENU_CASSE];
  for (let i = contenus.length - 1; i > 0; i--) {
    const k = hasard(i + 1);
    [contenus[i], contenus[k]] = [contenus[k], contenus[i]];
  }
  return { contenus, ouverts: contenus.map(() => false), coups: COUPS_DEPART_CASSE, butin: 0, multiplicateur: 1, fini: false, sirene: false };
}

/** Ouvre un coffre ; renvoie son contenu (null si le coup est impossible). */
export function ouvrirCasse(e: EtatCasse, index: number): ContenuCasse | null {
  if (e.fini || !Number.isInteger(index) || index < 0 || index >= e.contenus.length || e.ouverts[index]) return null;
  const c = e.contenus[index];
  e.ouverts[index] = true;
  e.coups -= 1;
  if (c.type === 'billets') e.butin += c.valeur;
  else if (c.type === 'lingot') e.multiplicateur += 1;
  else if (c.type === 'coups') e.coups += COUPS_BONUS_CASSE;
  if (c.type === 'sirene') {
    e.fini = true;
    e.sirene = true;
  } else if (e.coups <= 0 || e.ouverts.every(Boolean)) e.fini = true;
  return c;
}

/** Gain du casse, en multiples de la mise totale. */
export const gainCasse = (e: EtatCasse) => e.butin * e.multiplicateur;

/**
 * Gain moyen du casse (multiples de la mise), calculé exactement : l'ordre des coffres est au hasard, donc chaque
 * coffre ouvert est un tirage sans remise. Les liasses étant interchangeables, la moyenne vaut
 * E[nombre de liasses × (1 + lingots)] × valeur moyenne d'une liasse.
 */
export function esperanceCasse(): number {
  const n = (t: ContenuCasse['type']) => CONTENU_CASSE.filter((c) => c.type === t).length;
  const billets = CONTENU_CASSE.filter((c): c is { type: 'billets'; valeur: number } => c.type === 'billets');
  const moyenne = billets.reduce((s, c) => s + c.valeur, 0) / billets.length;
  const memo = new Map<string, number>();
  const E = (b: number, l: number, p: number, s: number, coups: number, k: number, g: number): number => {
    const reste = b + l + p + s;
    if (coups <= 0 || reste === 0) return k * (1 + g);
    const cle = `${b},${l},${p},${s},${coups},${k},${g}`;
    const m = memo.get(cle);
    if (m !== undefined) return m;
    let v = 0;
    if (b) v += (b / reste) * E(b - 1, l, p, s, coups - 1, k + 1, g);
    if (l) v += (l / reste) * E(b, l - 1, p, s, coups - 1, k, g + 1);
    if (p) v += (p / reste) * E(b, l, p - 1, s, coups - 1 + COUPS_BONUS_CASSE, k, g);
    if (s) v += (s / reste) * (k * (1 + g));
    memo.set(cle, v);
    return v;
  };
  return E(billets.length, n('lingot'), n('coups'), n('sirene'), COUPS_DEPART_CASSE, 0, 0) * moyenne;
}

// ---------------------------------------------------------------------------------------------------------------
// La Roue du Baron

export type CaseRoueBaron = { type: 'multiple'; x: number } | { type: 'tours'; n: number } | { type: 'grosLot' };
/** 12 cases de même chance, dans l'ordre des aiguilles d'une montre ; la case verte est celle du gros lot. */
export const ROUE_BARON: CaseRoueBaron[] = [
  { type: 'multiple', x: 10 },
  { type: 'multiple', x: 25 },
  { type: 'multiple', x: 10 },
  { type: 'multiple', x: 50 },
  { type: 'multiple', x: 10 },
  { type: 'multiple', x: 25 },
  { type: 'grosLot' },
  { type: 'multiple', x: 10 },
  { type: 'multiple', x: 100 },
  { type: 'multiple', x: 10 },
  { type: 'tours', n: TOURS_GRATUITS },
  { type: 'multiple', x: 25 },
];

/**
 * Taux de retour exact (hors gros lot), en fraction de la mise :
 * - lignes : chaque case d'une rangée suit la composition du rouleau, les rouleaux sont indépendants ;
 * - coffres : loi exacte du nombre de Coffres visibles (fenêtre de 3 cases sur chaque rouleau) ;
 * - casse et roue : probabilité de chacun × gain moyen ; les tours gratuits (gains des lignes et des coffres doublés)
 *   peuvent eux-mêmes relancer casse et roue : E_gratuit = 2 × base + P(casse) × casse + P(roue) × roue(E_gratuit).
 */
export function tauxDeRetour(): { lignes: number; coffres: number; pCasse: number; casse: number; pRoue: number; roue: number; gratuits: number; total: number } {
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
  const pCasse = loi.reduce((t, p, k) => t + (k >= 3 ? p : 0), 0);
  const visible = (bande: SymboleMachine[]) => {
    let n = 0;
    for (let a = 0; a < bande.length; a++) if ([0, 1, 2].some((d) => bande[(a + d) % bande.length] === 'couronne')) n++;
    return n / bande.length;
  };
  const pRoue = visible(BANDES[0]) * visible(BANDES[4]);
  const casse = esperanceCasse();
  const multiples = ROUE_BARON.reduce((s, c) => s + (c.type === 'multiple' ? c.x : 0), 0) / ROUE_BARON.length;
  const toursParRoue = ROUE_BARON.reduce((s, c) => s + (c.type === 'tours' ? c.n : 0), 0) / ROUE_BARON.length;
  const base = lignes + coffres;
  const gratuit = (MULTIPLICATEUR_GRATUIT * base + pCasse * casse + pRoue * multiples) / (1 - pRoue * toursParRoue);
  const roue = multiples + toursParRoue * gratuit;
  return { lignes, coffres, pCasse, casse, pRoue, roue, gratuits: pRoue * toursParRoue * gratuit, total: base + pCasse * casse + pRoue * roue };
}
