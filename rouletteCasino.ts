/**
 * Roulette européenne du Salon privé : 37 cases (0 à 36, un seul zéro), règle de la partage (si le 0 sort, les mises
 * simples rendent la moitié). Toutes les mises possibles sont listées une fois pour toutes : le téléphone n'envoie
 * que la clé d'une mise (« plein-17 », « cheval-17-20 », « rouge »…), le serveur la retrouve ici et la paie.
 */

export type TypeMiseRoulette = 'plein' | 'cheval' | 'transversale' | 'carre' | 'sixain' | 'douzaine' | 'colonne' | 'simple';

export interface MiseRoulette {
  cle: string;
  type: TypeMiseRoulette;
  /** Numéros couverts par la mise. */
  numeros: number[];
  /** Gain pour 1 misé (la mise est rendue en plus) : 35 pour un plein, 1 pour une simple. */
  paiement: number;
}

/** Ordre des cases sur le cylindre, dans le sens des aiguilles d'une montre, en partant du zéro. */
export const CYLINDRE = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
export const ROUGES = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
export const couleurNumero = (n: number): 'vert' | 'rouge' | 'noir' => (n === 0 ? 'vert' : ROUGES.has(n) ? 'rouge' : 'noir');

/** Jetons (en dollars), limites d'une case et d'un tour. */
export const JETONS_ROULETTE = [1_000, 5_000, 25_000, 100_000, 500_000];
export const MAX_CASE_ROULETTE = 500_000;
export const MAX_TOUR_ROULETTE = 1_000_000;
export const PLACES_ROULETTE = 5;

/** Les mises simples (rouge/noir, pair/impair, manque/passe). */
export const SIMPLES = ['manque', 'pair', 'rouge', 'noir', 'impair', 'passe'] as const;
export type MiseSimple = (typeof SIMPLES)[number];

/** Numéro de la case dans la grille : colonne (0, 1, 2) et rangée (0 à 11, de 1-2-3 à 34-35-36). */
export const colonneDe = (n: number) => (n - 1) % 3;
export const rangeeDe = (n: number) => Math.floor((n - 1) / 3);
const numero = (rangee: number, colonne: number) => rangee * 3 + colonne + 1;

function construire(): Map<string, MiseRoulette> {
  const m = new Map<string, MiseRoulette>();
  const ajouter = (type: TypeMiseRoulette, numeros: number[], cle?: string) => {
    const tri = [...numeros].sort((a, b) => a - b);
    const c = cle ?? `${type}-${tri.join('-')}`;
    m.set(c, { cle: c, type, numeros: tri, paiement: 36 / tri.length - 1 });
  };
  for (let n = 0; n <= 36; n++) ajouter('plein', [n]);
  // Chevaux : deux numéros voisins dans la grille, et le zéro avec 1, 2 ou 3.
  for (let r = 0; r < 12; r++)
    for (let c = 0; c < 3; c++) {
      if (c < 2) ajouter('cheval', [numero(r, c), numero(r, c + 1)]);
      if (r < 11) ajouter('cheval', [numero(r, c), numero(r + 1, c)]);
    }
  for (const n of [1, 2, 3]) ajouter('cheval', [0, n]);
  // Transversales : une rangée de 3, et les trios du zéro (0-1-2, 0-2-3).
  for (let r = 0; r < 12; r++) ajouter('transversale', [numero(r, 0), numero(r, 1), numero(r, 2)]);
  ajouter('transversale', [0, 1, 2]);
  ajouter('transversale', [0, 2, 3]);
  // Carrés : quatre numéros qui se touchent par un coin, et les quatre premiers (0-1-2-3).
  for (let r = 0; r < 11; r++) for (let c = 0; c < 2; c++) ajouter('carre', [numero(r, c), numero(r, c + 1), numero(r + 1, c), numero(r + 1, c + 1)]);
  ajouter('carre', [0, 1, 2, 3]);
  // Sixains : deux rangées voisines.
  for (let r = 0; r < 11; r++) ajouter('sixain', [0, 1, 2].flatMap((c) => [numero(r, c), numero(r + 1, c)]));
  for (let d = 0; d < 3; d++) ajouter('douzaine', Array.from({ length: 12 }, (_, k) => d * 12 + k + 1), `douzaine-${d + 1}`);
  for (let c = 0; c < 3; c++) ajouter('colonne', Array.from({ length: 12 }, (_, r) => numero(r, c)), `colonne-${c + 1}`);
  const tous = Array.from({ length: 36 }, (_, k) => k + 1);
  const simples: Record<MiseSimple, number[]> = {
    manque: tous.filter((n) => n <= 18),
    passe: tous.filter((n) => n >= 19),
    pair: tous.filter((n) => n % 2 === 0),
    impair: tous.filter((n) => n % 2 === 1),
    rouge: tous.filter((n) => ROUGES.has(n)),
    noir: tous.filter((n) => !ROUGES.has(n)),
  };
  for (const s of SIMPLES) ajouter('simple', simples[s], s);
  return m;
}

/** Toutes les mises possibles, par clé. */
export const MISES_ROULETTE = construire();

/** Ce qui revient au joueur pour une mise (mise comprise) quand le numéro sort : 0 si elle perd. */
export function retourMise(cle: string, montant: number, sorti: number): number {
  const m = MISES_ROULETTE.get(cle);
  if (!m) return 0;
  if (m.numeros.includes(sorti)) return montant * (m.paiement + 1);
  // La partage : sur le zéro, les mises simples rendent la moitié.
  if (sorti === 0 && m.type === 'simple') return Math.floor(montant / 2);
  return 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Vue d'une table (envoyée à chaque joueur)

export interface JetonPoseRoulette {
  cle: string;
  montant: number;
  /** Place du joueur qui a misé. */
  place: string;
}

export interface PlaceVueRoulette {
  id: string;
  nom: string;
  avatar: number;
  bot: boolean;
  moi?: true;
  hote?: true;
  absent?: true;
  /** Total misé ce tour. */
  mise: number;
  /** Résultat du tour (gains moins mises), une fois la bille tombée. */
  resultat: number | null;
}

export interface VueTableRoulette {
  code: string;
  numero: number;
  phase: 'mises' | 'tirage' | 'resultat';
  /** Temps restant de la phase (ms) et sa durée. */
  reste: number | null;
  duree: number | null;
  /** Les mises sont closes (« Rien ne va plus ») avant la fin du temps. */
  closes: boolean;
  places: PlaceVueRoulette[];
  jetons: JetonPoseRoulette[];
  /** Le numéro tiré (pendant que la bille tourne, puis au résultat). */
  tirage: number | null;
  /** Les 12 derniers numéros, du plus récent au plus ancien. */
  historique: number[];
  hote: boolean;
  solde: number;
  /** Mes mises du tour précédent existent (bouton « Refaire »). */
  peutRefaire: boolean;
  messages: { nom: string; texte: string }[];
}
