/**
 * La Chute des Écus (Salon privé) : un Plinko. Le joueur lâche un écu d'or en haut d'un mur de clous ; à chaque
 * rangée, l'écu rebondit à gauche ou à droite (une chance sur deux) et finit dans une des cases du bas, qui multiplie
 * la mise.
 *
 * Le joueur choisit sa mise, le nombre de rangées (8 à 16) et le risque. Les cases du milieu (là où l'écu tombe le
 * plus souvent) rendent moins que la mise ; seules celles des côtés font gagner :
 * - faible : le milieu rend de ×0,4 à ×0,9, environ un écu sur quatre gagne, le bord paie jusqu'à ×16 ;
 * - moyen : le milieu rend de ×0,3 à ×0,6, environ un écu sur sept gagne, le bord paie jusqu'à ×110 ;
 * - élevé : le milieu ne rend que ×0,2 ou ×0,3, environ un écu sur quinze gagne, mais le bord paie jusqu'à ×1 000.
 *
 * Le serveur tire le chemin de chaque écu (crypto) au moment du lâcher, débite la mise et crédite le gain d'un bloc :
 * il n'y a jamais de mise « en l'air » à rendre. L'écran ne fait que montrer la chute.
 *
 * Chaque table rend environ 93 % des mises en moyenne (de 92,3 % à 93,4 %) : la Chute est plus dure que les autres jeux
 * du salon (97 %).
 */

export type RisqueChute = 'faible' | 'moyen' | 'eleve';
export const RISQUES_CHUTE: RisqueChute[] = ['faible', 'moyen', 'eleve'];
export const NOMS_RISQUES_CHUTE: Record<RisqueChute, [string, string]> = { faible: ['Faible', 'Low'], moyen: ['Moyen', 'Medium'], eleve: ['Élevé', 'High'] };
export const RANGEES_MIN = 8;
export const RANGEES_MAX = 16;
export const MISES_CHUTE = [1_000, 2_000, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000];
/** Lâchers acceptés par seconde et par joueur (on peut lâcher plusieurs écus à la suite, pas mitrailler). */
export const LACHERS_PAR_SECONDE = 8;

/**
 * Multiplicateurs du bord vers le milieu (la moitié gauche ; la droite est son reflet). Pour n rangées, il y a n + 1
 * cases : la case k (k rebonds à droite) a la chance C(n, k) / 2^n. Aucune case ne rend tout juste la mise.
 */
const DEMI: Record<RisqueChute, Record<number, number[]>> = {
  faible: {
    8: [5.6, 1.9, 1.2, 0.9, 0.4],
    9: [5.6, 3.4, 2.1, 0.9, 0.4],
    10: [8.9, 2.5, 1.3, 1.2, 0.9, 0.4],
    11: [8.4, 4.4, 2.4, 1.7, 0.9, 0.4],
    12: [10, 5.7, 3.4, 1.9, 0.9, 0.7, 0.4],
    13: [8.1, 4.5, 2.7, 1.9, 1.6, 0.9, 0.4],
    14: [7.1, 4.4, 2.9, 2.2, 1.9, 0.9, 0.7, 0.4],
    15: [15, 7.4, 4, 2.4, 1.7, 1.4, 0.9, 0.4],
    16: [16, 8.8, 5.1, 3.1, 2, 1.5, 0.9, 0.7, 0.4],
  },
  moyen: {
    8: [13, 7.1, 0.6, 0.4, 0.3],
    9: [18, 4.2, 2.6, 0.6, 0.3],
    10: [22, 8, 4, 0.6, 0.4, 0.3],
    11: [24, 6.4, 2.9, 2.2, 0.6, 0.3],
    12: [33, 9.2, 4.3, 3.3, 0.6, 0.4, 0.3],
    13: [43, 16, 7.5, 5.3, 0.6, 0.4, 0.3],
    14: [58, 21, 8.3, 3.8, 2.2, 0.6, 0.4, 0.3],
    15: [88, 28, 11, 5.5, 3.9, 0.6, 0.4, 0.3],
    16: [110, 34, 11, 5.2, 2.8, 2.1, 0.6, 0.4, 0.3],
  },
  eleve: {
    8: [29, 7.9, 0.3, 0.2, 0.2],
    9: [43, 16, 0.2, 0.2, 0.2],
    10: [76, 13, 3.7, 0.3, 0.2, 0.2],
    11: [120, 27, 5.9, 0.3, 0.2, 0.2],
    12: [170, 23, 15, 0.3, 0.3, 0.2, 0.2],
    13: [260, 58, 14, 3.1, 0.3, 0.2, 0.2],
    14: [420, 78, 19, 7, 0.3, 0.3, 0.2, 0.2],
    15: [620, 81, 24, 16, 0.3, 0.3, 0.2, 0.2],
    16: [1000, 230, 54, 12, 2.9, 0.3, 0.3, 0.2, 0.2],
  },
};

export const estRisqueChute = (x: unknown): x is RisqueChute => RISQUES_CHUTE.includes(x as RisqueChute);
export const rangeesValides = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= RANGEES_MIN && (n as number) <= RANGEES_MAX;

/** Les n + 1 multiplicateurs des cases, de gauche à droite. */
export function multiplicateursChute(rangees: number, risque: RisqueChute): number[] {
  const demi = DEMI[risque][rangees];
  if (!demi) return [];
  return Array.from({ length: rangees + 1 }, (_, k) => demi[Math.min(k, rangees - k)]);
}

/** Chance de chaque case : C(n, k) / 2^n. */
export function chancesChute(rangees: number): number[] {
  const r: number[] = [];
  let c = 1;
  for (let k = 0; k <= rangees; k++) {
    r.push(c / 2 ** rangees);
    c = (c * (rangees - k)) / (k + 1);
  }
  return r;
}

/** Ce que rend une table en moyenne (0,97 = 97 %). */
export function rtpChute(rangees: number, risque: RisqueChute): number {
  const x = multiplicateursChute(rangees, risque);
  return chancesChute(rangees).reduce((s, p, k) => s + p * x[k], 0);
}

/** Le gain d'une mise à ce multiplicateur (mise rendue comprise), en dollars entiers. */
export const gainChute = (mise: number, x: number) => Math.floor((mise * Math.round(x * 100)) / 100);

/** La case d'arrivée d'un chemin : le nombre de rebonds à droite. */
export const caseDuChemin = (chemin: number[]) => chemin.reduce((s, d) => s + (d ? 1 : 0), 0);

/** Un écu lâché, tel que le serveur l'a joué. */
export interface ResultatChute {
  /** Numéro du lâcher (propre au joueur). */
  id: number;
  mise: number;
  rangees: number;
  risque: RisqueChute;
  /** Un rebond par rangée : 0 à gauche, 1 à droite. */
  chemin: number[];
  /** Case d'arrivée (0 = tout à gauche) et son multiplicateur. */
  case: number;
  x: number;
  /** Ce qui revient au joueur, mise comprise (peut être moins que la mise). */
  gain: number;
}
