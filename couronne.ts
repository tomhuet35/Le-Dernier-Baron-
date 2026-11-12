/**
 * Le Vol de la Couronne (Salon privé) : la couronne du Baron s'envole au-dessus des toits, et le multiplicateur monte
 * avec elle. On récupère sa mise × le multiplicateur quand on veut… avant que la pie voleuse ne fonde sur la couronne.
 *
 * Les manches sont communes à tout le salon et se jouent en direct : quelques secondes pour miser (deux mises au
 * plus), puis l'envol. Le serveur tire le point où la pie frappe au moment de l'envol, et lui seul décide.
 *
 * Le jeu est juste : la chance que la couronne dépasse ×x vaut 97 % / x. Quelle que soit la façon de jouer, il rend
 * 97 % des mises en moyenne, comme les autres jeux du salon.
 */

/** Ce que le jeu rend en moyenne. */
export const RTP_COURONNE = 0.97;
/** Plus haut multiplicateur : la couronne atteint les étoiles, et toutes les mises encore en vol y sont payées. */
export const X_MAX_COURONNE = 10_000;
/** Vitesse de montée : le multiplicateur vaut e^(k·t), t en millisecondes depuis l'envol (×2 en 7,7 s, ×10 en 25,6 s). */
export const K_COURONNE = 0.00009;
export const MISES_COURONNE = [1_000, 2_000, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000];
/** Deux mises par manche au plus. */
export const MISES_PAR_MANCHE = 2;
/** Récupération automatique : de ×1,01 au plafond ; paliers proposés par les boutons − / +. */
export const AUTO_MIN = 1.01;
export const PALIERS_AUTO = [1.1, 1.2, 1.3, 1.5, 1.75, 2, 2.5, 3, 4, 5, 7.5, 10, 15, 20, 30, 50, 75, 100, 200, 500, 1000];

export interface DureesCouronne {
  /** Mises ouvertes avant l'envol. */
  mises: number;
  /** Après le passage de la pie, avant les mises suivantes. */
  pause: number;
  /** Cadence des récupérations automatiques pendant le vol. */
  pas: number;
}
export const DUREES_COURONNE: DureesCouronne = { mises: 7_000, pause: 4_000, pas: 50 };

/** Multiplicateur exact, t ms après l'envol. */
export const multiplicateurExact = (t: number, k = K_COURONNE) => Math.exp(k * Math.max(0, t));
/** Multiplicateur affiché et payé : arrondi au centième inférieur. */
export const multiplicateurCouronne = (t: number, k = K_COURONNE) => Math.min(X_MAX_COURONNE, Math.floor(multiplicateurExact(t, k) * 100 + 1e-9) / 100);
/** Instant (ms après l'envol) où le multiplicateur atteint x. */
export const tempsDuMultiplicateur = (x: number, k = K_COURONNE) => Math.log(Math.max(1, x)) / k;

/**
 * Le point où la pie frappe, à partir d'un nombre au hasard u dans [0, 1) : 97 % / (1 − u), arrondi au centième
 * inférieur. En dessous de ×1,01 (environ 4 fois sur 100), la pie frappe dès l'envol (×1,00).
 */
export function tirerVol(u: number): number {
  const r = RTP_COURONNE / (1 - u);
  if (r < 1) return 1;
  return Math.min(X_MAX_COURONNE, Math.floor(r * 100 + 1e-9) / 100);
}

/** Le gain d'une mise récupérée à ce multiplicateur (mise rendue comprise), en dollars entiers. */
export const gainCouronne = (mise: number, x: number) => Math.floor((mise * Math.round(x * 100)) / 100);

/** Un multiplicateur de récupération automatique valable (au centième). */
export const autoValide = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= AUTO_MIN && x <= X_MAX_COURONNE && Math.abs(x * 100 - Math.round(x * 100)) < 1e-6;

export type PhaseCouronne = 'mises' | 'vol' | 'volee';

/** Une de mes mises de la manche. */
export interface MiseCouronne {
  mise: number;
  /** Récupération automatique à ce multiplicateur (ou null). */
  auto: number | null;
  /** En vol, récupérée, ou volée par la pie. */
  etat: 'enVol' | 'recuperee' | 'volee';
  /** Multiplicateur et gain de la récupération. */
  x: number | null;
  gain: number;
}

export interface JoueurCouronne {
  nom: string;
  avatar: number;
  mise: number;
  /** Meilleure récupération de la manche (multiplicateur), ou null. */
  x: number | null;
  gain: number;
  /** La pie a emporté toutes ses mises. */
  vole: boolean;
  moi?: true;
}

/** Ce que reçoivent les téléphones qui regardent la couronne. */
export interface VueCouronne {
  manche: number;
  phase: PhaseCouronne;
  /** Mises : temps restant avant l'envol ; volée : avant les mises suivantes (ms). */
  reste: number | null;
  duree: number | null;
  /** Vol : temps écoulé depuis l'envol ; volée : depuis le passage de la pie (ms). */
  ecoule: number | null;
  /** Vitesse de montée (voir K_COURONNE). */
  k: number;
  /** Volée : le multiplicateur où la pie a frappé. */
  x: number | null;
  /** Les derniers envols, du plus récent au plus ancien. */
  historique: number[];
  /** Mes deux mises (null : pas de mise). */
  mesMises: (MiseCouronne | null)[];
  joueurs: JoueurCouronne[];
  spectateurs: number;
  solde: number;
}
