/**
 * Le Plinko du Baron (Boutique) : on paie en rubis, une bille tombe à travers 12 rangées de clous et finit dans une
 * des 13 cases du bas. Les cases des bords sont rares et énormes. Les gains sont en dollars, jamais en rubis (règle du
 * salon : les rubis ne viennent jamais du jeu).
 *
 * Gain = mise (en rubis) × 400 000 $ (450 000 $ à 15 rubis, 500 000 $ à 50) × le multiplicateur de la case : un
 * rubis rapporte en moyenne 1,8 à 2,3 M $, moins
 * que 1 rubis acheté en dollars (20 rubis ou 50 M $ pour 0,99 €) — acheter des dollars reste toujours plus sûr.
 */
export const RANGEES_PLINKO = 12;
export const MISES_PLINKO = [5, 15, 50] as const;
export type MisePlinko = (typeof MISES_PLINKO)[number];
export const estMisePlinko = (x: unknown): x is MisePlinko => MISES_PLINKO.includes(x as MisePlinko);
/** Dollars par rubis misé, pour un multiplicateur de 1 : plus la mise est grosse, plus chaque rubis vaut cher. */
export const DOLLARS_PAR_RUBIS: Record<MisePlinko, number> = { 5: 400_000, 15: 450_000, 50: 500_000 };
/** Les 13 cases, de gauche à droite. */
export const MULTIPLICATEURS_PLINKO = [1000, 100, 20, 8, 4, 2, 1, 2, 4, 8, 20, 100, 1000];
export const MULTI_MAX_PLINKO = 1000;

/** Fait tomber la bille : 12 rebonds (0 à gauche, 1 à droite) ; la case est le nombre de rebonds à droite. */
export function lacherBille(mise: MisePlinko, hasard: () => number): { chemin: number[]; caseFinale: number; multi: number; gain: number } {
  const chemin: number[] = [];
  for (let k = 0; k < RANGEES_PLINKO; k++) chemin.push(hasard() < 0.5 ? 0 : 1);
  const caseFinale = chemin.reduce((s, x) => s + x, 0);
  const multi = MULTIPLICATEURS_PLINKO[caseFinale];
  return { chemin, caseFinale, multi, gain: mise * DOLLARS_PAR_RUBIS[mise] * multi };
}

/** Ce que rapporte un rubis en moyenne (en dollars). */
export function moyenneParRubis(mise: MisePlinko = 5): number {
  const n = RANGEES_PLINKO;
  let c = 1;
  let s = 0;
  for (let k = 0; k <= n; k++) {
    s += (c / 2 ** n) * MULTIPLICATEURS_PLINKO[k];
    c = (c * (n - k)) / (k + 1);
  }
  return s * DOLLARS_PAR_RUBIS[mise];
}
