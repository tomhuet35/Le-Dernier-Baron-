/**
 * Les Coffres du Baron (nom de code : « festin ») : 25 coffres-forts sur la caisse du contrebandier. Dans chacun, le
 * butin (billets, lingots, rubis)… ou un badge de police. Le joueur choisit sa mise et le nombre de badges (1 à 24),
 * puis ouvre les coffres un à un : chaque butin fait monter le multiplicateur ; un badge, et la mise est saisie. Il
 * encaisse quand il veut.
 *
 * Le multiplicateur est juste : après k butins avec b badges, il vaut 97 % de l'inverse de la chance d'en être arrivé
 * là, donc chaque façon de jouer rend 97 % des mises en moyenne (comme les autres jeux du salon).
 */

export type Hasard = (n: number) => number;

export const COFFRES = 25;
export const COLONNES_COFFRES = 5;
export const BADGES_MIN = 1;
export const BADGES_MAX = 24;
/** Nombres de badges proposés d'un geste (on peut aussi choisir n'importe quel nombre de 1 à 24). */
export const BADGES_RAPIDES = [1, 3, 5, 10, 24];
export const MISES_COFFRES = [1_000, 2_000, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000];
/** Ce que le jeu rend en moyenne. */
export const RTP_COFFRES = 0.97;
/** Multiplicateur le plus haut : atteint, la partie s'encaisse d'elle-même. */
export const X_MAX_COFFRES = 25_000;

export type ContenuCoffre = 'butin' | 'police';

/** Multiplicateur après `butins` coffres gagnants avec `badges` badges en jeu (arrondi au centième inférieur). */
export function multiplicateurCoffres(badges: number, butins: number): number {
  if (butins <= 0) return 1;
  let chance = 1;
  for (let i = 0; i < butins; i++) chance *= (COFFRES - badges - i) / (COFFRES - i);
  if (chance <= 0) return 0;
  return Math.min(X_MAX_COFFRES, Math.floor((RTP_COFFRES / chance) * 100 + 1e-9) / 100);
}

/** Les multiplicateurs successifs d'une partie à `badges` badges : après 1 butin, 2 butins… (jusqu'au plafond). */
export function echelleCoffres(badges: number): number[] {
  const r: number[] = [];
  for (let k = 1; k <= COFFRES - badges; k++) {
    const x = multiplicateurCoffres(badges, k);
    r.push(x);
    if (x >= X_MAX_COFFRES) break;
  }
  return r;
}

/** Le gain d'une mise à ce multiplicateur (mise rendue comprise), en dollars entiers. */
export const gainCoffres = (mise: number, x: number) => Math.floor((mise * Math.round(x * 100)) / 100);

/** Place `badges` badges au hasard parmi les 25 coffres (mélange de Fisher-Yates). Renvoie leurs positions. */
export function placerBadges(h: Hasard, badges: number): number[] {
  const cases = Array.from({ length: COFFRES }, (_, i) => i);
  for (let i = COFFRES - 1; i > 0; i--) {
    const j = h(i + 1);
    [cases[i], cases[j]] = [cases[j], cases[i]];
  }
  return cases.slice(0, badges).sort((a, b) => a - b);
}

export const badgesValides = (n: number) => Number.isInteger(n) && n >= BADGES_MIN && n <= BADGES_MAX;

/** La partie vue par le téléphone : les badges restent cachés tant qu'elle n'est pas finie. */
export interface VueCoffres {
  mise: number;
  badges: number;
  /** Pour chaque coffre : null (fermé), « butin » ou « police ». Une fois la partie finie, tous sont dévoilés. */
  coffres: (ContenuCoffre | null)[];
  /** Coffres ouverts par le joueur, dans l'ordre. */
  ouverts: number[];
  etat: 'enCours' | 'perdu' | 'encaisse';
  /** Butins trouvés, multiplicateur atteint et prochain multiplicateur (null s'il n'y a plus de butin). */
  butins: number;
  x: number;
  suivant: number | null;
  /** Ce que rapporterait l'encaissement maintenant (ou le gain final, mise comprise ; 0 si perdu). */
  gain: number;
  /** Coffre du badge qui a fait perdre. */
  perdant: number | null;
}
