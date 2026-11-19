/**
 * Le Coffre-fort aux rubis (Boutique) : on paie en rubis, on choisit un coffre parmi trois, et il cache des dollars,
 * jusqu'au gros lot. Les rubis ne s'y gagnent jamais (règle du salon : ils ne viennent jamais du jeu).
 *
 * Trois mises : 5, 15 ou 50 rubis. Les gains sont en millions de dollars, × la mise.
 */
export const MISES_COFFRE_RUBIS = [5, 15, 50] as const;
export type MiseCoffreRubis = (typeof MISES_COFFRE_RUBIS)[number];
export const estMiseCoffreRubis = (x: unknown): x is MiseCoffreRubis => MISES_COFFRE_RUBIS.includes(x as MiseCoffreRubis);

/** Les lots pour 5 rubis (dollars) et leur chance ; × 3 pour 15 rubis, × 10 pour 50 rubis. */
export const LOTS_COFFRE_RUBIS: { gain: number; p: number }[] = [
  { gain: 5_000_000, p: 0.4 },
  { gain: 10_000_000, p: 0.3 },
  { gain: 25_000_000, p: 0.17 },
  { gain: 50_000_000, p: 0.08 },
  { gain: 100_000_000, p: 0.04 },
  { gain: 1_000_000_000, p: 0.01 },
];
export const GROS_LOT_COFFRE_RUBIS = LOTS_COFFRE_RUBIS[LOTS_COFFRE_RUBIS.length - 1].gain;

export const echelleCoffreRubis = (mise: MiseCoffreRubis) => mise / 5;

/** Tire le lot du coffre choisi et ce que cachaient les deux autres (pour les montrer). `u()` : réel de 0 à 1. */
export function ouvrirCoffreRubis(mise: MiseCoffreRubis, u: () => number): { gain: number; autres: [number, number] } {
  const k = echelleCoffreRubis(mise);
  const tirer = () => {
    let r = u();
    for (const l of LOTS_COFFRE_RUBIS) {
      if (r < l.p) return l.gain * k;
      r -= l.p;
    }
    return LOTS_COFFRE_RUBIS[0].gain * k;
  };
  return { gain: tirer(), autres: [tirer(), tirer()] };
}
