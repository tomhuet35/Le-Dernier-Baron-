/**
 * Le Festin du Baron (Salon privé) : 25 cloches d'argent sur la table du banquet. Sous chacune, un poulet rôti… ou
 * les os que le Baron a laissés. Le joueur choisit sa mise et le nombre d'os (1 à 24), puis soulève les cloches une à
 * une : chaque poulet fait monter le multiplicateur ; un os, et la mise est perdue. Il encaisse quand il veut.
 *
 * Le multiplicateur est juste : après k poulets avec b os, il vaut 97 % de l'inverse de la chance d'en être arrivé là,
 * donc chaque façon de jouer rend 97 % des mises en moyenne (comme les autres jeux du salon).
 */

export type Hasard = (n: number) => number;

export const CASES_FESTIN = 25;
export const COLONNES_FESTIN = 5;
export const OS_MIN = 1;
export const OS_MAX = 24;
/** Nombres d'os proposés d'un geste (on peut aussi choisir n'importe quel nombre de 1 à 24). */
export const OS_RAPIDES = [1, 3, 5, 10, 24];
export const MISES_FESTIN = [1_000, 2_000, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000];
/** Ce que le jeu rend en moyenne. */
export const RTP_FESTIN = 0.97;
/** Multiplicateur le plus haut : atteint, la partie s'encaisse d'elle-même (le Baron est rassasié). */
export const X_MAX_FESTIN = 25_000;

export type ContenuCloche = 'poulet' | 'os';

/** Multiplicateur après `poulets` cloches gagnantes avec `os` os sur la table (arrondi au centième inférieur). */
export function multiplicateurFestin(os: number, poulets: number): number {
  if (poulets <= 0) return 1;
  let chance = 1;
  for (let i = 0; i < poulets; i++) chance *= (CASES_FESTIN - os - i) / (CASES_FESTIN - i);
  if (chance <= 0) return 0;
  return Math.min(X_MAX_FESTIN, Math.floor((RTP_FESTIN / chance) * 100 + 1e-9) / 100);
}

/** Les multiplicateurs successifs d'une partie à `os` os : après 1 poulet, 2 poulets… jusqu'au dernier (ou au plafond). */
export function echelleFestin(os: number): number[] {
  const r: number[] = [];
  for (let k = 1; k <= CASES_FESTIN - os; k++) {
    const x = multiplicateurFestin(os, k);
    r.push(x);
    if (x >= X_MAX_FESTIN) break;
  }
  return r;
}

/** Le gain d'une mise à ce multiplicateur (mise rendue comprise), en dollars entiers. */
export const gainFestin = (mise: number, x: number) => Math.floor((mise * Math.round(x * 100)) / 100);

/** Place `os` os au hasard parmi les 25 cloches (mélange de Fisher-Yates). Renvoie leurs positions. */
export function placerOs(h: Hasard, os: number): number[] {
  const cases = Array.from({ length: CASES_FESTIN }, (_, i) => i);
  for (let i = CASES_FESTIN - 1; i > 0; i--) {
    const j = h(i + 1);
    [cases[i], cases[j]] = [cases[j], cases[i]];
  }
  return cases.slice(0, os).sort((a, b) => a - b);
}

export const osValides = (os: number) => Number.isInteger(os) && os >= OS_MIN && os <= OS_MAX;

/** La partie vue par le téléphone : les os restent cachés tant qu'elle n'est pas finie. */
export interface VueFestin {
  mise: number;
  os: number;
  /** Pour chaque cloche : null (fermée), « poulet » ou « os ». Une fois la partie finie, toutes sont dévoilées. */
  cloches: (ContenuCloche | null)[];
  /** Cloches soulevées par le joueur, dans l'ordre. */
  ouvertes: number[];
  etat: 'enCours' | 'perdu' | 'encaisse';
  /** Poulets trouvés, multiplicateur atteint et prochain multiplicateur (null s'il n'y a plus de poulet). */
  poulets: number;
  x: number;
  suivant: number | null;
  /** Ce que rapporterait l'encaissement maintenant (ou le gain final, mise comprise ; 0 si perdu). */
  gain: number;
  /** Cloche de l'os qui a fait perdre. */
  perdante: number | null;
}
