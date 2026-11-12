/**
 * La Chute des Écus (Salon privé) : un Plinko. Le joueur lâche un écu d'or en haut d'un mur de clous ; à chaque
 * rangée, l'écu rebondit à gauche ou à droite (une chance sur deux) et finit dans une des cases du bas, qui multiplie
 * la mise.
 *
 * Le joueur choisit sa mise, le nombre de rangées (8 à 16) et le risque :
 * - faible : presque toutes les cases rendent la mise ou un peu plus, le bord paie jusqu'à ×16 ;
 * - moyen : le milieu reprend un peu, le bord paie jusqu'à ×110 ;
 * - élevé : le milieu ne rend que ×0,2, mais le bord paie jusqu'à ×1 000 (16 rangées).
 *
 * Le serveur tire le chemin de chaque écu (crypto) au moment du lâcher, débite la mise et crédite le gain d'un bloc :
 * il n'y a jamais de mise « en l'air » à rendre. L'écran ne fait que montrer la chute.
 *
 * Chaque table rend environ 97 % des mises en moyenne (de 96,7 % à 97,2 %), comme les autres jeux du salon.
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
 * cases : la case k (k écus partis à droite) a la chance C(n, k) / 2^n.
 */
const DEMI: Record<RisqueChute, Record<number, number[]>> = {
  faible: {
    8: [5.6, 2.1, 1, 1, 0.5],
    9: [5.6, 1.8, 1.5, 1, 0.7],
    10: [8.9, 2.9, 1.2, 1.1, 1, 0.5],
    11: [8.4, 3, 1.8, 1.2, 1, 0.7],
    12: [10, 2.9, 1.4, 1.3, 1.1, 1, 0.5],
    13: [8.1, 3.8, 2.9, 1.9, 1.1, 0.9, 0.7],
    14: [7.1, 3.8, 1.7, 1.3, 1.2, 1.1, 1, 0.5],
    15: [15, 7.7, 2.9, 1.9, 1.3, 1.1, 1, 0.7],
    16: [16, 8.8, 1.9, 1.4, 1.4, 1.2, 1.1, 1, 0.4],
  },
  moyen: {
    8: [13, 3, 1.2, 0.7, 0.4],
    9: [18, 3.8, 1.6, 0.9, 0.5],
    10: [22, 4.9, 1.8, 1.4, 0.6, 0.4],
    11: [24, 5.7, 3, 1.7, 0.7, 0.5],
    12: [33, 10, 3.9, 1.9, 1.1, 0.6, 0.3],
    13: [43, 13, 5.9, 3, 1.2, 0.7, 0.4],
    14: [58, 15, 6.7, 3.9, 1.8, 1, 0.5, 0.2],
    15: [88, 17, 11, 4.9, 2.8, 1.3, 0.5, 0.3],
    16: [110, 41, 9.9, 5, 3, 1.5, 1, 0.5, 0.2],
  },
  eleve: {
    8: [29, 4, 1.4, 0.3, 0.2],
    9: [43, 6.8, 1.9, 0.6, 0.2],
    10: [76, 9.4, 2.9, 0.9, 0.3, 0.2],
    11: [120, 14, 5.1, 1.3, 0.4, 0.2],
    12: [170, 24, 7.8, 1.9, 0.7, 0.2, 0.2],
    13: [260, 35, 11, 3.8, 1, 0.2, 0.2],
    14: [420, 54, 18, 4.9, 1.8, 0.3, 0.2, 0.2],
    15: [620, 80, 26, 7.9, 2.9, 0.5, 0.2, 0.2],
    16: [1000, 130, 26, 8.9, 3.9, 1.9, 0.2, 0.2, 0.2],
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
