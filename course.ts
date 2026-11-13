/**
 * La Course des Écuries (Salon privé) : des courses de chevaux en direct, communes à tout le salon.
 *
 * Une course : mises (20 s) → départ (les chevaux entrent dans les stalles, 3 s) → la course (15 s environ) →
 * l'arrivée et les gains (8 s). Six chevaux, un par couleur de casaque ; à chaque course, leurs noms et leur forme
 * changent, et leurs cotes avec.
 *
 * - « Gagnant » : le cheval doit finir premier. « Placé » : il doit finir dans les deux premiers (cote plus petite).
 * - Les cotes sont justes : la chance de chaque cheval est connue (sa forme), et la cote vaut 95 % de l'inverse de
 *   cette chance. Quelle que soit la façon de jouer, le jeu rend environ 95 % des mises.
 * - Le serveur tire l'ordre d'arrivée au départ (crypto), puis le scénario de la course (qui mène, qui revient) : tous
 *   les téléphones voient exactement la même course. L'arrivée est jouée d'avance : rien ne peut la changer.
 */

export const NB_CHEVAUX = 6;
/** Couleur de casaque de chaque couloir (et son image : course-cheval-1.webp… -6.webp). */
export const CASAQUES: { nom: [string, string]; couleur: string }[] = [
  { nom: ['Rouge', 'Red'], couleur: '#c4222c' },
  { nom: ['Bleu', 'Blue'], couleur: '#2652c8' },
  { nom: ['Or', 'Gold'], couleur: '#e2aa28' },
  { nom: ['Vert', 'Green'], couleur: '#188a48' },
  { nom: ['Violet', 'Purple'], couleur: '#783ab2' },
  { nom: ['Blanc', 'White'], couleur: '#ece6da' },
];
/** Les noms des chevaux (six sont tirés à chaque course). */
export const NOMS_CHEVAUX = [
  'Éclair de Pigalle',
  'Baron Rouge',
  'Comtesse Noire',
  'Monte-Carlo',
  'Rubis du Soir',
  'Fleur de Lys',
  'Grand Duc',
  'Belle Époque',
  'Champagne',
  'Vent de Montmartre',
  'Lune d’Or',
  'Dame de Pique',
  'Le Marquis',
  'Charleston',
  'Coup de Poker',
  'Joyau du Nil',
  'Étoile du Nord',
  'Prince Noir',
  'Folle Nuit',
  'Gentleman',
];

export type TypeMiseCourse = 'gagnant' | 'place';
export const TYPES_MISE_COURSE: TypeMiseCourse[] = ['gagnant', 'place'];
export const JETONS_COURSE = [1_000, 5_000, 25_000, 100_000, 500_000];
/** 1 000 000 $ au plus sur une même mise (un cheval, gagnant ou placé), 4 000 000 $ au plus par course. */
export const MAX_MISE_COURSE = 1_000_000;
export const MAX_COURSE = 4_000_000;
/** Ce que le jeu rend en moyenne. */
export const RTP_COURSE = 0.95;
/** Longueur de la course (affichage). */
export const LONGUEUR_COURSE = 1200;

export interface DureesCourse {
  mises: number;
  depart: number;
  /** Temps du gagnant : entre min et max. */
  gagnantMin: number;
  gagnantMax: number;
  /** Après le dernier cheval, avant les résultats. */
  apres: number;
  resultat: number;
}
export const DUREES_COURSE: DureesCourse = { mises: 20_000, depart: 3_500, gagnantMin: 13_500, gagnantMax: 15_500, apres: 1_200, resultat: 8_000 };

/** Tirage uniforme dans [0, 1). */
export type Hasard = () => number;

export interface Partant {
  nom: string;
  /** Chance de gagner (la forme du jour), cote gagnant et cote placé. */
  chance: number;
  cote: number;
  place: number;
}

const arrondiCote = (x: number) => Math.max(1.1, Math.floor(x * 10) / 10);

/** Chance de finir dans les deux premiers (chaque place se tire parmi les chevaux restants, selon leurs chances). */
export function chancesPlace(p: number[]): number[] {
  return p.map((pi, i) => pi + p.reduce((s, pj, j) => (j === i ? s : s + (pj * pi) / (1 - pj)), 0));
}

/** Les six partants d'une course : noms tirés au hasard, formes (chances) et cotes. */
export function tirerPartants(h: Hasard): Partant[] {
  const noms = [...NOMS_CHEVAUX];
  for (let i = noms.length - 1; i > 0; i--) {
    const j = Math.floor(h() * (i + 1));
    [noms[i], noms[j]] = [noms[j], noms[i]];
  }
  // Formes : un favori, des outsiders (loi gamma de forme 2, puis au moins 3 % chacun).
  const brut = Array.from({ length: NB_CHEVAUX }, () => -Math.log(Math.max(1e-9, h())) - Math.log(Math.max(1e-9, h())));
  const somme = brut.reduce((s, x) => s + x, 0);
  let p = brut.map((x) => x / somme);
  p = p.map((x) => Math.max(0.03, x));
  const s2 = p.reduce((s, x) => s + x, 0);
  p = p.map((x) => x / s2);
  const q = chancesPlace(p);
  return p.map((chance, i) => ({ nom: noms[i], chance, cote: arrondiCote(RTP_COURSE / chance), place: Math.max(1.05, Math.floor((RTP_COURSE / q[i]) * 100) / 100) }));
}

/** L'ordre d'arrivée : le premier est tiré selon les chances, puis le deuxième parmi les autres, etc. */
export function tirerArrivee(chances: number[], h: Hasard): number[] {
  const restants = chances.map((c, i) => ({ c, i }));
  const ordre: number[] = [];
  while (restants.length) {
    const total = restants.reduce((s, r) => s + r.c, 0);
    let x = h() * total;
    let k = 0;
    while (k < restants.length - 1 && x >= restants[k].c) {
      x -= restants[k].c;
      k++;
    }
    ordre.push(restants[k].i);
    restants.splice(k, 1);
  }
  return ordre;
}

/** Le scénario : l'heure d'arrivée de chaque cheval (ms après le départ) et sa progression à 10 points de sa course. */
export interface ScenarioCourse {
  ordre: number[];
  arrivees: number[];
  /** Pour chaque cheval, 11 points : la part de la course faite à 0 %, 10 %, … 100 % de son temps. */
  points: number[][];
}

export function scenarioCourse(ordre: number[], h: Hasard, d: DureesCourse = DUREES_COURSE): ScenarioCourse {
  const arrivees = Array<number>(NB_CHEVAUX).fill(0);
  let t = d.gagnantMin + h() * (d.gagnantMax - d.gagnantMin);
  ordre.forEach((c, rang) => {
    arrivees[c] = Math.round(t);
    // Des arrivées serrées, parfois d'un souffle (le peloton tient en une seconde environ).
    t += rang === 0 ? 40 + h() * 260 : 60 + h() * 320;
  });
  const points = arrivees.map(() => {
    // Le style du cheval : il part vite et faiblit (< 1), ou il garde des forces pour la fin (> 1).
    const style = 0.9 + h() * 0.22;
    const pts = [0];
    for (let k = 1; k < 10; k++) {
      const f = k / 10;
      const bruit = (h() * 2 - 1) * 0.012;
      pts.push(Math.min(0.985, Math.max(pts[k - 1] + 0.035, f ** style + bruit)));
    }
    pts.push(1);
    return pts.map((x) => Math.round(x * 10_000) / 10_000);
  });
  return { ordre, arrivees, points };
}

/** Où en est un cheval (part de la course faite) t ms après le départ ; au-delà de l'arrivée, il ralentit. */
export function progression(s: ScenarioCourse, cheval: number, t: number): number {
  const T = s.arrivees[cheval];
  const pts = s.points[cheval];
  if (t <= 0) return 0;
  if (t >= T) {
    // Passé le poteau, le cheval ralentit en 2,5 s jusqu'au petit trot.
    const vFin = (pts[10] - pts[9]) / (T / 10);
    const a = t - T;
    const tau = 2500;
    if (a < tau) return 1 + vFin * (a - (0.7 * a * a) / (2 * tau));
    return 1 + vFin * (tau - 0.35 * tau) + vFin * 0.3 * (a - tau);
  }
  const u = (t / T) * 10;
  const k = Math.min(9, Math.floor(u));
  const f = u - k;
  // Interpolation douce entre les points (Catmull-Rom, sans reculer).
  const p0 = pts[Math.max(0, k - 1)];
  const p1 = pts[k];
  const p2 = pts[k + 1];
  const p3 = pts[Math.min(10, k + 2)];
  const v = 0.5 * (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f);
  return Math.min(p2, Math.max(p1, v));
}

export interface MiseCourse {
  cheval: number;
  type: TypeMiseCourse;
  montant: number;
}

/** Ce qu'une mise rapporte une fois la course finie (mise comprise ; 0 si elle est perdue). */
export function gainMiseCourse(m: MiseCourse, partants: Partant[], ordre: number[]): number {
  const p = partants[m.cheval];
  if (m.type === 'gagnant') return ordre[0] === m.cheval ? Math.floor((m.montant * Math.round(p.cote * 100)) / 100) : 0;
  return ordre[0] === m.cheval || ordre[1] === m.cheval ? Math.floor((m.montant * Math.round(p.place * 100)) / 100) : 0;
}

export type PhaseCourse = 'mises' | 'depart' | 'course' | 'resultat';

export interface JoueurCourse {
  nom: string;
  avatar: number;
  mise: number;
  /** Gain de la course (mise comprise), une fois l'arrivée jugée. */
  gain: number | null;
  moi?: true;
}

export interface VueCourse {
  numero: number;
  phase: PhaseCourse;
  /** Millisecondes avant la fin de la phase (mises, départ, résultats), et sa durée. */
  reste: number | null;
  duree: number | null;
  partants: { nom: string; cote: number; place: number }[];
  /** Pendant la course et après : le scénario, et le temps écoulé depuis le départ. */
  scenario: ScenarioCourse | null;
  ecoule: number | null;
  mesMises: MiseCourse[];
  /** Les mises de la course précédente (pour « Refaire »). */
  peutRefaire: boolean;
  /** Après l'arrivée : ce que j'ai gagné (mise comprise). */
  monGain: number | null;
  joueurs: JoueurCourse[];
  /** Les derniers gagnants : couloir, nom, cote. */
  historique: { cheval: number; nom: string; cote: number }[];
  spectateurs: number;
  solde: number;
}
