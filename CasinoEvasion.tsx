/**
 * L'Évasion (Le Baron Express) : la course à trois. Trois voitures quittent la banque, une par itinéraire
 * (le Boulevard, les Ruelles, les Souterrains) ; chaque joueur monte dans l'une d'elles. Plus l'itinéraire est risqué,
 * plus le butin est gros… si la voiture échappe à la police.
 *
 * Le serveur a tiré l'issue des trois voitures dès le début du bonus ; il ne l'envoie aux téléphones qu'au départ de
 * la poursuite (les choix sont faits). Cet écran met la course en scène :
 * - l'intro : l'affiche, les trois voitures et ce que rapporte chacune (multiplicateur de la roue compris) ;
 * - le choix : trois cartes, une par voiture ;
 * - la poursuite (COURSE_BW) : le départ des trois voitures côte à côte, la police aux trousses ; elles se séparent,
 *   chacune vers son itinéraire, et la caméra ne suit plus que la mienne (sinon la plus choisie), plein écran, dans
 *   ses décors ; à la sortie de Paris, un barrage de police l'arrête… ou elle saute le pont-levis par-dessus le barrage.
 *   Les décors, la chaussée, les voitures et leurs roues et les effets sont placés à chaque image
 *   (requestAnimationFrame) ; les panneaux suivent l'horloge de l'étape (10 fois par seconde) ;
 * - la fin : l'image de l'évasion (ou de l'arrestation) de ma voiture, et le bilan des trois.
 */
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { COURSE_BW, DUREES_BW, ITINERAIRES_BW, ROUTES_BW, type RouteBW, type VueBonusBW, type VueBW } from '../../shared/baronWheel';
import { fx, ValeurMultipliee } from './CasinoBaronExpress';
import { PluieLingots } from './casinoOutils';
import { tr } from './traduction';
import { jouerEffet, mouvementReduit } from './ui';
import './evasion.css';

const IMG = (n: string) => `/cartes/bw-ev-${n}.webp`;

/** Les décors de chaque itinéraire (deux chacun) et le pont du dénouement. */
const DECORS: Record<RouteBW, [string, string]> = {
  boulevard: ['boulevard-1', 'boulevard-2'],
  ruelles: ['ruelles-1', 'ruelles-2'],
  souterrains: ['souterrains-1', 'souterrains-2'],
};

/** Toutes les images de l'Évasion (sans chemin ni extension), préchargées avant le bonus. */
export const IMAGES_EVASION_NOMS = [
  'affiche',
  ...ROUTES_BW.flatMap((r) => [...DECORS[r], `route-${r}`, `voiture-${r}`]),
  'seine',
  'saut',
  'barrage',
  'roue',
  'police',
  'roue-police',
  'fumee',
  'gyrophare',
  'etincelles',
  'jauge',
  'fin-evade2',
  'fin-arrete',
].map((n) => `bw-ev-${n}`);

export const NOMS_ROUTES: Record<RouteBW, { nom: [string, string]; risque: [string, string]; voiture: [string, string] }> = {
  boulevard: { nom: ['Le Boulevard', 'The Boulevard'], risque: ['Risque faible', 'Low risk'], voiture: ['La berline bordeaux', 'The claret saloon'] },
  ruelles: { nom: ['Les Ruelles', 'The Alleys'], risque: ['Risque moyen', 'Medium risk'], voiture: ['Le roadster émeraude', 'The emerald roadster'] },
  souterrains: { nom: ['Les Souterrains', 'The Tunnels'], risque: ['Risque élevé', 'High risk'], voiture: ['Le fourgon noir et or', 'The black-and-gold van'] },
};

// ---------------------------------------------------------------------------------------------------------------
// Les images et leurs mesures

interface Vehicule {
  img: string;
  roue: string;
  /** Hauteur / largeur de la carrosserie. */
  ratio: number;
  /** Les roues : centre (parts de la largeur et de la hauteur de la carrosserie) et rayon (part de la largeur). */
  roues: [number, number, number][];
  /** Le bas des roues (le sol), en hauteurs de carrosserie depuis son haut. */
  sol: number;
}
const VOITURES: Record<RouteBW, Vehicule> = {
  boulevard: { img: 'voiture-boulevard', roue: 'roue', ratio: 298 / 1000, roues: [[0.1755, 0.9606, 0.0718], [0.8285, 0.9601, 0.0727]], sol: 1.2 },
  ruelles: { img: 'voiture-ruelles', roue: 'roue', ratio: 311 / 1000, roues: [[0.1775, 0.9871, 0.0802], [0.839, 0.9815, 0.0815]], sol: 1.24 },
  souterrains: { img: 'voiture-souterrains', roue: 'roue', ratio: 323 / 1000, roues: [[0.1855, 0.963, 0.071], [0.8525, 0.9724, 0.076]], sol: 1.2 },
};
const POLICE: Vehicule & { gyro: [number, number] } = { img: 'police', roue: 'roue-police', ratio: 332 / 1000, roues: [[0.196, 0.9816, 0.0756], [0.848, 0.9761, 0.0748]], sol: 1.2, gyro: [0.469, 0.077] };
/** La ligne où la chaussée commence dans chaque décor (part de sa hauteur), et où roulent les voitures sur la chaussée. */
const LIGNE_DECOR: Record<string, number> = { 'boulevard-1': 0.79, 'boulevard-2': 0.8, 'ruelles-1': 0.84, 'ruelles-2': 0.835, 'souterrains-1': 0.75, 'souterrains-2': 0.75, seine: 0.8 };
const SOL_ROUTE: Record<RouteBW, number> = { boulevard: 0.72, ruelles: 0.7, souterrains: 0.76 };
/** La chaussée : une tuile de 1117 × 400 qui se répète. */
const TUILE = 1117 / 400;
/** Le barrage (900 × 456) : sa hauteur en hauteurs de carrosserie. */
const BARRAGE = { ratio: 456 / 900, h: 1.75 };

// ---------------------------------------------------------------------------------------------------------------
// Le calendrier de la poursuite (millisecondes d'une poursuite de 24 s, voir COURSE_BW)

const REF = DUREES_BW.poursuite;
const { depart: DEPART, separe: SEPARE, issue: ISSUE } = COURSE_BW;
/** Le début du plan de ma voiture (après la séparation), le changement de décor au milieu. */
const DEBUT_PLAN = DEPART + SEPARE;
const CHANGE_DECOR = (DEBUT_PLAN + ISSUE) / 2;
/** Le barrage (depuis le début de l'issue) : le freinage, l'arrêt. */
const FREIN = { debut: 150, arret: 1000 };
/** Le saut (depuis son début) : la montée sur le pont-levis, le vol, l'atterrissage, la sortie ; le tampon dure. */
const SAUT = { montee: 700, vol: 1000, sortie: 600, tampon: 1400 };

interface Calendrier {
  /** Le début de l'issue de chaque voiture : son arrêt au barrage, ou son saut (seule celle suivie se voit). */
  issue: number[];
  /** La fin de l'arrestation ; le début du plan du saut (Infini si la voiture suivie est arrêtée). */
  finArrets: number;
  saut: number;
  camera: [number, number][];
}
/** Le calendrier de la fin, d'après l'issue de la voiture suivie (inconnue : elle s'échappe). */
function calendrier(issues: boolean[] | null, suivi: number): Calendrier {
  const evade = !issues || issues[suivi];
  const issue = [ISSUE, ISSUE, ISSUE];
  if (evade) issue[suivi] = ISSUE + 400;
  return {
    issue,
    finArrets: evade ? ISSUE : ISSUE + FREIN.arret + 1100,
    saut: evade ? ISSUE : Number.POSITIVE_INFINITY,
    // La caméra s'arrête avec la voiture arrêtée.
    camera: evade
      ? [
          [0, 0.3],
          [1200, 1],
        ]
      : [
          [0, 0.3],
          [1200, 1],
          [ISSUE + FREIN.debut, 1],
          [ISSUE + FREIN.arret, 0],
        ],
  };
}
/** Le moment où l'issue d'une voiture se voit (elle pile, ou elle atterrit sur l'autre rive). */
const finIssue = (c: Calendrier, k: number, evade: boolean) => c.issue[k] + (evade ? SAUT.montee + SAUT.vol : FREIN.arret);

type Acte = 'depart' | 'separe' | 'plan' | 'saut';
const acteA = (s: number, c: Calendrier): { acte: Acte } => ({ acte: s < DEPART ? 'depart' : s < DEBUT_PLAN ? 'separe' : s < c.saut ? 'plan' : 'saut' });

const borne = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u);
const lisse = (u: number) => {
  const x = borne(u);
  return x * x * (3 - 2 * x);
};
const sortie = (u: number) => 1 - (1 - borne(u)) ** 3;

/** L'intégrale (en secondes) d'une vitesse donnée par points [instant, vitesse], linéaire entre eux, de 0 à s. */
function integrale(points: [number, number][], s: number): number {
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const [a, fa] = points[i];
    const [b, fb] = i + 1 < points.length ? points[i + 1] : [Number.POSITIVE_INFINITY, fa];
    if (s <= a) break;
    const fin = Math.min(s, b);
    const fFin = b === Number.POSITIVE_INFINITY ? fa : fa + ((fb - fa) * (fin - a)) / (b - a);
    total += ((fa + fFin) / 2) * (fin - a);
  }
  return total / 1000;
}
/** La vitesse donnée par points à l'instant s. */
function vitesseA(P: [number, number][], s: number): number {
  if (s <= P[0][0]) return P[0][1];
  for (let i = 0; i + 1 < P.length; i++) if (s < P[i + 1][0]) return P[i][1] + ((P[i + 1][1] - P[i][1]) * (s - P[i][0])) / (P[i + 1][0] - P[i][0]);
  return P[P.length - 1][1];
}
/** Le freinage d'une voiture arrêtée au barrage (1 : elle roule, 0 : arrêtée). */
const frein = (s: number, i: number) => 1 - lisse((s - i - FREIN.debut) / (FREIN.arret - FREIN.debut));
/** Le chemin parcouru par une voiture (en secondes à pleine vitesse) : celui de la caméra, sauf quand elle freine. */
function cheminVoiture(s: number, c: Calendrier, k: number, evade: boolean): number {
  const i0 = c.issue[k] + FREIN.debut;
  if (evade || s <= i0) return integrale(c.camera, s);
  const fin = Math.min(s, c.issue[k] + FREIN.arret);
  const n = 24;
  let total = integrale(c.camera, i0);
  for (let j = 0; j < n; j++) {
    const a = i0 + ((fin - i0) * j) / n;
    const b = i0 + ((fin - i0) * (j + 1)) / n;
    const m = (a + b) / 2;
    total += ((b - a) / 1000) * vitesseA(c.camera, m) * frein(m, c.issue[k]);
  }
  return total;
}
/** La scène commune (le départ, le dénouement) : une seule chaussée à trois voies, les voitures côte à côte en profondeur. */
const COMMUN = { route: 0.6, sols: [0.3, 0.58, 0.86], echelles: [0.7, 0.85, 1], x: [0.5, 0.57, 0.64] };
/**
 * Le plan du saut, sur le décor du pont-levis (2172 × 724, vu jusqu'à une part `vu` de sa largeur, posé en bas de
 * l'écran) : le pied et le bout du pont-levis, le quai (parts de la largeur et de la hauteur du décor) ; l'atterrissage,
 * sur le quai d'en face (part de la largeur de l'écran) ; la largeur d'une voiture (part de celle du décor).
 */
const PONT = { pied: [0.076, 0.615], bout: [0.412, 0.131], quai: 0.93, atterrit: 0.84, voiture: 0.13 };
const vuPont = (portrait: boolean) => (portrait ? 0.62 : 1);

/** L'écart entre la police et la voiture (en largeurs de voiture), qui varie pendant la course. */
function ecart(s: number, k: number, evade: boolean, c: Calendrier): number {
  let g = 0.5 + 0.22 * Math.sin(s / 820 + k * 2.1) + 0.08 * Math.sin(s / 310 + k);
  // Au départ, la police surgit de la gauche.
  if (s < 2200) g += 3.2 * (1 - sortie((s - 500 - k * 120) / 1500));
  if (!evade && s > c.issue[k]) g = g + (0.06 - g) * lisse((s - c.issue[k]) / FREIN.arret);
  return g;
}

// ---------------------------------------------------------------------------------------------------------------
// La scène animée

interface RefsVehicule {
  el: RefObject<HTMLSpanElement>;
  roues: RefObject<HTMLImageElement>[];
  fumee: RefObject<HTMLImageElement>;
  etincelles: RefObject<HTMLImageElement>;
}
interface RefsPiste {
  el: RefObject<HTMLDivElement>;
  decors: RefObject<HTMLDivElement>[];
  route: RefObject<HTMLDivElement>;
  barrage: RefObject<HTMLImageElement>;
  voiture: RefsVehicule;
  police: RefsVehicule;
  /** La même voiture, dans le plan du saut. */
  sauteur: RefsVehicule;
}
interface RefsSaut {
  el: RefObject<HTMLDivElement>;
  decor: RefObject<HTMLDivElement>;
  barrage: RefObject<HTMLImageElement>;
  police: RefsVehicule;
}
const nouvelleRef = <T,>(): RefObject<T> => ({ current: null });
const refsVehicule = (): RefsVehicule => ({ el: nouvelleRef(), roues: [nouvelleRef(), nouvelleRef()], fumee: nouvelleRef(), etincelles: nouvelleRef() });

interface DonneesScene {
  cle: string;
  debut: number;
  /** Le rapport entre la poursuite de 24 s et celle du serveur. */
  echelle: number;
  issues: boolean[] | null;
  poursuite: boolean;
  /** La voiture que l'écran suit après la séparation (la mienne, sinon la plus choisie). */
  suivi: number;
}

function useSceneCourse(donnees: { current: DonneesScene | null }, scene: RefObject<HTMLDivElement>, pistes: RefsPiste[], saut: RefsSaut) {
  useEffect(() => {
    const el = scene.current;
    if (!el) return;
    const taille = { W: 0, H: 0, version: 0 };
    const mesurer = () => {
      taille.W = el.clientWidth;
      taille.H = el.clientHeight;
      taille.version++;
    };
    mesurer();
    const ro = new ResizeObserver(mesurer);
    ro.observe(el);
    const derniers = pistes.map(() => ({ cle: '' }));
    let cleSaut = '';

    let raf = 0;
    const image = () => {
      raf = requestAnimationFrame(image);
      const d = donnees.current;
      const { W: w, H: h } = taille;
      if (!d || !d.poursuite || !w || !h) return;
      const s = (performance.now() - d.debut) * d.echelle;
      const cal = calendrier(d.issues, d.suivi);
      const { acte } = acteA(s, cal);
      const reduit = mouvementReduit();
      const portrait = h > w * 1.05;
      const plein = acte === 'plan';
      const camera = integrale(cal.camera, s);

      // Le plan du saut : le pont-levis, les voitures qui s'échappent à la suite, la police qui pile en bas.
      const ps = saut.el.current;
      const cs = `${d.cle}-${acte}-${taille.version}`;
      if (ps && cs !== cleSaut) {
        cleSaut = cs;
        ps.style.visibility = 'visible';
        ps.style.display = acte === 'saut' ? '' : 'none';
      }
      if (acte === 'saut') {
        const vu = vuPont(portrait);
        const Dw = w / vu;
        const Dh = Dw / 3;
        const top = h - Dh;
        const pt = (x: number, y: number) => [x * Dw, top + y * Dh];
        const decor = saut.decor.current;
        if (decor) {
          decor.style.width = `${Dw}px`;
          decor.style.height = `${Dh}px`;
          decor.style.transform = `translate3d(0, ${top}px, 0)`;
        }
        const Cw = Dw * PONT.voiture * (portrait ? 1 : 1.15);
        const [bx, by] = pt(PONT.pied[0], PONT.pied[1]);
        const [tx, ty] = pt(PONT.bout[0], PONT.bout[1]);
        const [, yQuai] = pt(0, PONT.quai);
        const xAtt = w * (portrait ? 0.93 : PONT.atterrit);
        const angle = (Math.atan2(by - ty, tx - bx) * 180) / Math.PI;
        // Le départ de la montée : sur le prolongement du pont-levis, hors de l'écran à gauche.
        const x0 = bx - (tx - bx) * 0.75;
        const y0 = by + (by - ty) * 0.75;
        pistes.forEach((p, k) => {
          const V = VOITURES[ROUTES_BW[k]];
          const evade = d.issues?.[k] ?? true;
          if (!evade || k !== d.suivi) return placerVehicule(p.sauteur, V, 0, 0, Cw, 0, 0, true);
          const t = s - cal.issue[k];
          if (t < 0 || t > SAUT.montee + SAUT.vol + SAUT.sortie) return placerVehicule(p.sauteur, V, 0, 0, Cw, 0, 0, true);
          let x: number;
          let y: number;
          let rot: number;
          if (t < SAUT.montee) {
            const q = (t / SAUT.montee) ** 1.25;
            x = x0 + (tx - x0) * q;
            y = y0 + (ty - y0) * q;
            rot = -angle;
          } else if (t < SAUT.montee + SAUT.vol) {
            const q = (t - SAUT.montee) / SAUT.vol;
            x = tx + (xAtt - tx) * q;
            y = ty + (yQuai - ty) * q * q - Dh * 0.3 * Math.sin(q * Math.PI) * (1 - q * 0.35);
            rot = -angle + (angle + 10) * lisse(q / 0.8) - 10 * lisse((q - 0.85) / 0.15);
          } else {
            const q = (t - SAUT.montee - SAUT.vol) / SAUT.sortie;
            x = xAtt + (w + Cw - xAtt) * q * q;
            y = yQuai - Math.sin(Math.min(1, q * 3) * Math.PI) * Cw * 0.06;
            rot = 0;
          }
          placerVehicule(p.sauteur, V, x, y, Cw, rot, t * Cw * 0.004, false);
          const fumee = p.sauteur.fumee.current;
          if (fumee) fumee.style.opacity = String(t < SAUT.montee ? 0.6 : t > SAUT.montee + SAUT.vol ? 0.8 : 0.15);
          const et = p.sauteur.etincelles.current;
          if (et) et.style.opacity = String(t > SAUT.montee + SAUT.vol && t < SAUT.montee + SAUT.vol + 350 ? 1 : 0);
        });
        // Le barrage de police, sur le quai entre le pont-levis et l'atterrissage : les voitures le survolent.
        const barrage = saut.barrage.current;
        if (barrage) {
          const bh = Cw * (portrait ? 0.8 : 0.95);
          const bw = bh / BARRAGE.ratio;
          const xb = tx + (xAtt - tx) * (portrait ? 0.42 : 0.5);
          barrage.style.width = `${bw}px`;
          barrage.style.transform = `translate3d(${xb - bw / 2}px, ${yQuai + Dh * 0.03 - bh * 0.96}px, 0)`;
        }
        // La police arrive par le quai et pile au pied du pont-levis.
        const tp = s - cal.saut;
        const xp = -Cw + (w * 0.2 + Cw) * sortie(tp / 1400);
        placerVehicule(saut.police, POLICE, xp, yQuai + Dh * 0.03, Cw * 1.05, tp > 900 && tp < 1500 ? 2 : 0, xp, false);
        const fp = saut.police.fumee.current;
        if (fp) fp.style.opacity = String(tp > 800 && tp < 1700 ? 0.9 : 0);
      }

      pistes.forEach((p, k) => {
        const route = ROUTES_BW[k];
        const evade = d.issues?.[k] ?? true;
        const piste = p.el.current;
        if (!piste) return;
        // En plan, seule la piste suivie se voit ; dans la scène commune, la première porte le décor et la chaussée.
        const visible = acte !== 'saut' && (!plein || k === d.suivi);
        const decor = plein || k === 0;
        const cle = `${d.cle}-${acte}-${d.suivi}-${taille.version}`;
        const change = derniers[k].cle !== cle;
        if (change) {
          derniers[k].cle = cle;
          // display (pas visibility) : les voitures se déclarent visibles elles-mêmes, ce qui passerait outre un parent caché.
          piste.style.visibility = 'visible';
          piste.style.display = visible ? '' : 'none';
        }
        if (!visible) return;

        // Les mesures : la chaussée, la voiture (largeur Cw, carrosserie Ch), sa place, sa vitesse.
        const yRoute = h * (plein ? 0.72 : COMMUN.route);
        const Bh = h - yRoute;
        const yG = yRoute + Bh * (plein ? SOL_ROUTE[route] : COMMUN.sols[k]);
        const V = VOITURES[route];
        const base = plein ? (portrait ? w * 0.5 : Math.min(w * 0.38, h * 0.9)) : portrait ? w * 0.42 : Math.min(w * 0.3, h * 0.5);
        const Cw = base * (plein ? 1 : COMMUN.echelles[k]);
        const Ch = Cw * V.ratio;
        const v = base * 3.2;
        const xC = w * (plein ? (portrait ? 0.68 : 0.6) : COMMUN.x[k]);
        const u = v * camera;
        const uVoiture = v * cheminVoiture(s, cal, k, evade);
        const iK = cal.issue[k];

        // Les décors : le premier, puis le second (à mi-plan) ; chacun défile lentement.
        // (Dans la scène commune, le premier décor du Boulevard ; en plan, ceux de la voiture suivie.)
        const fenetres: [number, number, number][] = [
          [0, CHANGE_DECOR + 400, 1 - borne((s - CHANGE_DECOR + 400) / 800)],
          [CHANGE_DECOR - 400, ISSUE + 1500, borne((s - CHANGE_DECOR + 400) / 800)],
          [0, 1, 0],
        ];
        p.decors.forEach((r, i) => {
          const dec = r.current;
          if (!dec) return;
          const [a, b, op] = fenetres[i];
          if (op <= 0 || !decor) {
            dec.style.opacity = '0';
            return;
          }
          const nom = i < 2 ? DECORS[route][i] : 'seine';
          const rd = LIGNE_DECOR[nom];
          const Dh = Math.max(yRoute / rd, (w * 1.15) / 3);
          const Dw = Dh * 3;
          const top = yRoute - rd * Dh;
          // Le quai : la caméra longe la rive, le pont-levis reste devant (il ne défile qu'à moitié).
          const part = i < 2 ? 0.9 : 0.45;
          const x = -(Dw - w) * (0.05 + part * lisse((s - a) / (b - a)));
          dec.style.opacity = String(op);
          dec.style.width = `${Dw}px`;
          dec.style.height = `${Dh}px`;
          dec.style.transform = `translate3d(${x}px, ${top}px, 0)`;
        });

        // La chaussée qui défile (l'avenue dans la scène commune).
        const chaussee = p.route.current;
        if (chaussee) {
          if (change) {
            chaussee.style.visibility = decor ? 'visible' : 'hidden';
            chaussee.style.backgroundImage = `url(${IMG(`route-${plein ? route : 'boulevard'}`)})`;
          }
          const tw = Bh * TUILE;
          chaussee.style.top = `${yRoute}px`;
          chaussee.style.height = `${Bh}px`;
          chaussee.style.width = `${w + tw * 2}px`;
          chaussee.style.backgroundSize = `${tw}px ${Bh}px`;
          chaussee.style.transform = `translate3d(${-(((u % tw) + tw) % tw)}px, 0, 0)`;
        }

        // La voiture : son entrée au départ, le barrage.
        let xv = xC + (uVoiture - u);
        let yv = 0;
        let rot = 0;
        if (s < DEPART) xv = -Cw + (xC + Cw) * sortie((s - (2 - k) * 180) / 1500);
        // La séparation : les deux autres voitures prennent leur itinéraire (l'une file devant, l'autre bifurque).
        if (acte === 'separe' && k !== d.suivi) {
          const m = [0, 1, 2].filter((j) => j !== d.suivi).indexOf(k);
          const q = sortie((s - DEPART - m * 300) / 1200);
          xv += m === 0 ? w * 1.3 * q : -w * 1.2 * q * q;
          yv += m === 0 ? -Bh * 0.25 * q : Bh * 0.2 * q;
        }
        // Les secousses de la route (pas pour une voiture arrêtée).
        const roule = evade || s < iK + FREIN.arret;
        if (!reduit && roule) yv += Math.sin(s / 47 + k) * Ch * 0.012;
        const freine = !evade && acte === 'plan' && s > iK + FREIN.debut && s < iK + FREIN.arret + 150;
        if (freine) rot += 2.2 * Math.sin(borne((s - iK - FREIN.debut) / 850) * Math.PI);
        placerVehicule(p.voiture, V, xv, yG + yv, Cw, rot, uVoiture, false);
        const fumee = p.voiture.fumee.current;
        if (fumee) fumee.style.opacity = String(!roule ? 0 : freine ? 0.95 : 0.35 + 0.15 * Math.sin(s / 90));
        const etincelles = p.voiture.etincelles.current;
        if (etincelles) etincelles.style.opacity = String(freine ? 0.6 + 0.4 * Math.sin(s / 40) : 0);

        // La police, à quelques longueurs.
        const g = ecart(s, k, evade, cal);
        const xp = xv - Cw * (1.04 + g);
        const freinePolice = !evade && acte === 'plan' && s > iK && s < iK + 1200;
        placerVehicule(p.police, POLICE, xp, yG + (reduit || !roule ? 0 : Math.sin(s / 53 + k * 3) * Ch * 0.012), Cw, freinePolice ? 1.5 : 0, uVoiture, false);
        const fp = p.police.fumee.current;
        if (fp) fp.style.opacity = String(!roule ? 0 : freinePolice ? 0.85 : 0.25);

        // Le barrage, posé sur la chaussée : la voiture pile juste devant.
        const barrage = p.barrage.current;
        if (barrage) {
          const vu = acte === 'plan' && !evade && s > iK - 900;
          barrage.style.visibility = vu ? 'visible' : 'hidden';
          if (vu) {
            const bh = Ch * BARRAGE.h;
            const bw = bh / BARRAGE.ratio;
            const arret = v * cheminVoiture(iK + FREIN.arret + 10, cal, k, false);
            const x = xC + Cw * 0.56 + (arret - u);
            barrage.style.width = `${bw}px`;
            barrage.style.transform = `translate3d(${x}px, ${yG - bh * 0.96}px, 0)`;
          }
        }
      });
    };
    raf = requestAnimationFrame(image);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [donnees, scene, pistes, saut]);
}

/** Place un véhicule : le bas de ses roues sur `ySol`, centré sur `x`, de largeur `Cw` ; ses roues tournent avec la route. */
function placerVehicule(r: RefsVehicule, V: Vehicule, x: number, ySol: number, Cw: number, rot: number, u: number, cache: boolean) {
  const el = r.el.current;
  if (!el) return;
  el.style.visibility = cache ? 'hidden' : 'visible';
  if (cache) return;
  el.style.width = `${Cw}px`;
  const Ch = Cw * V.ratio;
  el.style.transform = `translate3d(${x - Cw / 2}px, ${ySol - V.sol * Ch}px, 0) rotate(${rot}deg)`;
  r.roues.forEach((rr, i) => {
    const roue = rr.current;
    if (!roue) return;
    roue.style.transform = `rotate(${((u / (V.roues[i][2] * Cw)) * 180) / Math.PI}deg)`;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Les morceaux de l'écran

const roueStyle = (V: Vehicule, [cx, cy, rr]: [number, number, number]): CSSProperties => ({ left: `${(cx - rr) * 100}%`, top: `${(cy - rr / V.ratio) * 100}%`, width: `${rr * 200}%` });

function AutoDom({ V, r, police = false }: { V: Vehicule; r: RefsVehicule; police?: boolean }) {
  return (
    <span className={`eva-auto ${police ? 'police' : ''}`} ref={r.el}>
      <img className="eva-auto-fumee" ref={r.fumee} src={IMG('fumee')} alt="" draggable={false} />
      {V.roues.map((roue, i) => (
        <img key={i} className="eva-roue" ref={r.roues[i]} src={IMG(V.roue)} alt="" draggable={false} style={roueStyle(V, roue)} />
      ))}
      <img className="eva-caisse" src={IMG(V.img)} alt="" draggable={false} />
      {police && <img className="eva-gyro" src={IMG('gyrophare')} alt="" draggable={false} style={{ left: `${POLICE.gyro[0] * 100}%`, top: `${POLICE.gyro[1] * 100}%` }} />}
      <img className="eva-auto-etincelles" ref={r.etincelles} src={IMG('etincelles')} alt="" draggable={false} />
    </span>
  );
}

/** Une voiture immobile (cartes, listes, jauge), avec ses roues ; `roule` : ses roues tournent. */
function Voiture({ route, className = '', roule = false, style }: { route: RouteBW; className?: string; roule?: boolean; style?: CSSProperties }) {
  const V = VOITURES[route];
  return (
    <span className={`eva-voiture ${roule ? 'roule' : ''} ${className}`} style={style}>
      {V.roues.map((roue, i) => (
        <img key={i} className="eva-voiture-roue" src={IMG(V.roue)} alt="" draggable={false} style={roueStyle(V, roue)} />
      ))}
      <img className="eva-voiture-caisse" src={IMG(V.img)} alt="" draggable={false} />
    </span>
  );
}

/** La jauge de distance : la police à gauche, la liberté à droite ; les trois voitures entre les deux. */
function Jauge({ s, issues, mien, plan, c }: { s: number; issues: boolean[] | null; mien: number | null; plan: number; c: Calendrier }) {
  return (
    <div className="eva-jauge" aria-hidden="true">
      <img src={IMG('jauge')} alt="" draggable={false} />
      <span className="eva-jauge-canal">
        {ROUTES_BW.map((r, k) => {
          // En plan, seule la voiture suivie : les autres ne se voient pas.
          if (k !== plan) return null;
          const g = ecart(s, k, issues?.[k] ?? true, c);
          const pos = Math.min(0.9, Math.max(0.1, 0.18 + g * 0.55 + ((s - DEBUT_PLAN) / (ISSUE - DEBUT_PLAN)) * 0.2));
          return <Voiture key={r} route={r} className={`eva-jauge-auto ${mien === k ? 'mien' : ''} ${plan === k ? 'suivie' : ''}`} style={{ left: `${pos * 100}%`, '--k': k } as CSSProperties} />;
        })}
      </span>
    </div>
  );
}

function Gerbe({ style }: { style: CSSProperties }) {
  return (
    <span className="eva-gerbe" aria-hidden="true" style={style}>
      {Array.from({ length: 12 }, (_, i) => (
        <img key={i} src="/cartes/jeton-or.webp" alt="" draggable={false} style={{ '--i': i } as CSSProperties} />
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Le bonus

export function BonusEvasion({ v, b, nom, ouvert, choisir }: { v: VueBW; b: VueBonusBW; nom: string; ouvert: boolean; choisir: (o: number) => void }) {
  const M = Math.max(1, b.multiplicateur);
  const choix = b.mesChoix[0];
  const salon = b.choixSalon[0] ?? [0, 0, 0];
  // La voiture que l'écran suit : la mienne, sinon la plus choisie du salon.
  const suivi = choix ?? (Math.max(...salon) > 0 ? salon.indexOf(Math.max(...salon)) : 0);
  const issues = b.routes && b.routes.every((x) => x) ? b.routes.map((x) => !!x?.evade) : null;
  const cal = calendrier(issues, suivi);

  // L'horloge de l'étape (recalée sur le serveur) et un battement de 10 par seconde pour React.
  const cleEtape = `${v.numero}-${b.etape}-${v.phase}`;
  const horloge = useRef({ cle: '', debut: 0 });
  const estime = performance.now() - ((v.duree ?? 0) - (v.reste ?? 0));
  if (horloge.current.cle !== cleEtape) horloge.current = { cle: cleEtape, debut: estime };
  else horloge.current.debut = Math.min(horloge.current.debut, estime);
  const [maintenant, setMaintenant] = useState(() => performance.now());
  useEffect(() => {
    const id = window.setInterval(() => setMaintenant(performance.now()), 100);
    return () => window.clearInterval(id);
  }, []);
  const poursuite = nom === 'poursuite' && v.phase === 'bonus';
  const echelle = poursuite && v.duree ? REF / v.duree : 1;
  const s = (maintenant - horloge.current.debut) * echelle;
  const { acte } = acteA(s, cal);
  const tous = acte === 'depart' || acte === 'separe';

  const donnees = useRef<DonneesScene | null>(null);
  donnees.current = { cle: cleEtape, debut: horloge.current.debut, echelle, issues, poursuite, suivi };
  const scene = useRef<HTMLDivElement>(null);
  const pistesRef = useRef<RefsPiste[] | null>(null);
  if (!pistesRef.current)
    pistesRef.current = ROUTES_BW.map(() => ({
      el: nouvelleRef(),
      decors: [nouvelleRef(), nouvelleRef(), nouvelleRef()],
      route: nouvelleRef(),
      barrage: nouvelleRef(),
      voiture: refsVehicule(),
      police: refsVehicule(),
      sauteur: refsVehicule(),
    }));
  const pistes = pistesRef.current;
  const sautRef = useRef<RefsSaut | null>(null);
  if (!sautRef.current) sautRef.current = { el: nouvelleRef(), decor: nouvelleRef(), barrage: nouvelleRef(), police: refsVehicule() };
  useSceneCourse(donnees, scene, pistes, sautRef.current);

  // Les sons de la course.
  const joues = useRef(new Set<string>());
  useEffect(() => {
    if (!poursuite) return;
    const fois = (cle: string, f: () => void) => {
      const c = `${cleEtape}-${cle}`;
      if (joues.current.has(c)) return;
      joues.current.add(c);
      f();
    };
    // Chaque son a sa fenêtre : un téléphone qui revient d'un autre onglet ne les joue pas tous d'un coup.
    const entre = (debut: number, marge: number) => s >= debut && s < debut + marge;
    if (entre(0, 1500)) fois('moteur', () => jouerEffet('ev_moteur'));
    if (entre(500, 1500)) fois('sirene', () => jouerEffet('bw_sirene', { volume: 0.75 }));
    if (entre(DEPART + 100, 800)) fois('separe', () => jouerEffet('ev_passage', { vitesse: 1.05 }));
    if (entre(DEBUT_PLAN, 800)) fois('passage', () => jouerEffet('ev_passage', { vitesse: 0.96 }));
    if (entre(ISSUE - 2200, 1000)) fois('sirene2', () => jouerEffet('bw_sirene', { volume: 0.6 }));
    if (issues) {
      const k = suivi;
      const i = cal.issue[k];
      if (issues[k]) {
        if (entre(i + 100, 700)) fois('saut', () => jouerEffet('ev_saut'));
        if (entre(i + SAUT.montee + SAUT.vol, 900)) fois('foule', () => jouerEffet('course_foule', { volume: 0.6 }));
      } else {
        if (entre(i + FREIN.debut, 600)) fois('frein', () => jouerEffet('ex_freins', { volume: 0.8 }));
        if (entre(i + FREIN.arret, 900)) fois('sifflet', () => jouerEffet('br_sifflet'));
      }
    }
    if (entre(cal.saut, 1000)) fois('feux', () => jouerEffet('ex_feux', { volume: 0.7 }));
  });

  // Les annonces du moment.
  let annonce: { titre: string; sous?: string; haut?: boolean } | null = null;
  if (poursuite) {
    if (s > 300 && s < DEPART - 300) annonce = { titre: tr('Trois voitures, trois itinéraires !', 'Three cars, three routes!'), sous: tr('La police est à leurs trousses…', 'The police are on their tail…') };
    else if (acte === 'separe' && s > DEPART + 150) annonce = { titre: tr('Les voitures se séparent !', 'The cars split up!'), sous: choix !== null ? tr(`Suis ta voiture : ${tr(...NOMS_ROUTES[ROUTES_BW[suivi]].nom)}`, `Follow your car: ${tr(...NOMS_ROUTES[ROUTES_BW[suivi]].nom)}`) : tr(`La caméra suit : ${tr(...NOMS_ROUTES[ROUTES_BW[suivi]].nom)}`, `Following: ${tr(...NOMS_ROUTES[ROUTES_BW[suivi]].nom)}`) };
    else if (s >= ISSUE - 2200 && s < ISSUE - 300) annonce = { titre: tr('La sortie de Paris…', 'The way out of Paris…'), sous: tr('Libre… ou barrée par la police ?', 'Clear… or blocked by the police?') };
    else if (acte === 'saut' && s < cal.saut + 1050) annonce = { titre: tr('Le pont-levis !', 'The drawbridge!'), sous: tr('La voiture saute par-dessus le barrage', 'The car jumps over the roadblock'), haut: true };
  }

  const routes = ROUTES_BW.map((r, k) => ({ r, k, it: ITINERAIRES_BW[r] }));
  const gains = (r: RouteBW) => ITINERAIRES_BW[r].gains.map(([x]) => x);
  const issueMienne = b.routes?.[suivi] ?? null;
  /** Où l'issue d'une voiture se voit : le pont-levis (plan du saut), ou le barrage. */
  const resolue = (k: number) => !!issues && s >= finIssue(cal, k, issues[k]);
  const enHauteur = !!scene.current && scene.current.clientHeight > scene.current.clientWidth * 1.05;

  return (
    <div className={`eva ${nom} ${poursuite ? acte : ''}`} ref={scene}>
      {/* La course : trois pistes (une seule en plein écran pendant son plan ; sinon superposées, en profondeur). */}
      <div className={`eva-course ${poursuite ? '' : 'cache'}`} aria-hidden="true">
        {pistes.map((p, k) => {
          const r = ROUTES_BW[k];
          return (
            <div key={r} className={`eva-piste ${r}`} ref={p.el}>
              {[...DECORS[r], 'seine'].map((d, i) => (
                <div key={d} className="eva-decor" ref={p.decors[i]} style={{ backgroundImage: `url(${IMG(d)})` }} />
              ))}
              <div className="eva-route" ref={p.route} />
              <AutoDom V={POLICE} r={p.police} police />
              <AutoDom V={VOITURES[r]} r={p.voiture} />
              <img className="eva-barrage" ref={p.barrage} src={IMG('barrage')} alt="" draggable={false} />
            </div>
          );
        })}
        {/* Le plan du saut : le pont-levis, et les voitures qui s'échappent, l'une après l'autre. */}
        <div className="eva-saut" ref={sautRef.current.el}>
          <div className="eva-decor" ref={sautRef.current.decor} style={{ backgroundImage: `url(${IMG('saut')})`, opacity: 1 }} />
          <img className="eva-barrage saut" ref={sautRef.current.barrage} src={IMG('barrage')} alt="" draggable={false} />
          <i className="eva-gyro-flash saut" />
          <AutoDom V={POLICE} r={sautRef.current.police} police />
          {pistes.map((p, k) => (
            <AutoDom key={k} V={VOITURES[ROUTES_BW[k]]} r={p.sauteur} />
          ))}
        </div>
        <div className="eva-vitesse" />
        {/* Les pièces d'or au bout du pont-levis, les gyrophares au barrage. */}
        {poursuite &&
          issues &&
          ROUTES_BW.map((r, k) => {
            const t = s - cal.issue[k];
            if (k !== suivi) return null;
            if (issues[k] && acte === 'saut' && t > SAUT.montee - 100 && t < SAUT.montee + 1300) return <Gerbe key={r} style={{ left: `${(PONT.bout[0] / vuPont(enHauteur)) * 100}%`, top: `calc(100% - ${((1 - PONT.bout[1]) * 100) / (3 * vuPont(enHauteur))}cqw)` }} />;
            if (!issues[k] && acte === 'plan' && t > FREIN.arret - 100 && t < FREIN.arret + 1600) return <i key={r} className="eva-gyro-flash" />;
            return null;
          })}
      </div>

      {/* Les plaques : celle de la voiture suivie (en plan), ou les trois, avec leur issue. */}
      {poursuite && (
        <div className={`eva-plaques ${tous ? acte : 'plan'}`}>
          {ROUTES_BW.map((r, k) => {
            if (!tous && k !== suivi) return null;
            const fait = !tous && resolue(k);
            return (
              <span key={`${r}-${tous ? 'tous' : 'plan'}`} className={`eva-plaque ${choix === k ? 'mienne' : ''} ${fait ? (issues?.[k] ? 'evadee' : 'arretee') : ''}`}>
                <i className={`eva-pastille ${r}`} />
                <strong>{tr(...NOMS_ROUTES[r].nom)}</strong>
                {fait ? (
                  <b>{issues?.[k] ? fx((b.routes?.[k]?.x ?? 0) * M) : tr('arrêtée', 'caught')}</b>
                ) : (
                  <small>{tr(`arrestation ${Math.round(ITINERAIRES_BW[r].arrestation * 100)} %`, `${Math.round(ITINERAIRES_BW[r].arrestation * 100)}% arrest`)}</small>
                )}
                {choix === k && <em>{tr('Toi', 'You')}</em>}
              </span>
            );
          })}
        </div>
      )}
      {/* Le tampon de chaque issue, le temps de le lire. */}
      {poursuite &&
        issues &&
        ROUTES_BW.map((r, k) => {
          const t = s - finIssue(cal, k, issues[k]);
          if (k !== suivi || t < 0 || t > SAUT.tampon) return null;
          return (
            <span key={r} className={`eva-tampon ${issues[k] ? 'evadee' : 'arretee'} ${choix === k ? 'mienne' : ''} ${acte === 'saut' ? 'saut' : ''}`} role="status">
              <small>
                {tr(...NOMS_ROUTES[r].nom)}
                {choix === k ? tr(' · ta voiture', ' · your car') : ''}
              </small>
              <b>{issues[k] ? tr('Évadée !', 'Escaped!') : tr('Arrêtée !', 'Caught!')}</b>
              {issues[k] && <em>{fx((b.routes?.[k]?.x ?? 0) * M)}</em>}
            </span>
          );
        })}
      {poursuite && acte === 'plan' && s < DEBUT_PLAN + 500 && <div className="eva-coupe" key="plan" aria-hidden="true" />}
      {poursuite && acte === 'saut' && s < cal.saut + 500 && <div className="eva-coupe" key="saut" aria-hidden="true" />}
      {poursuite && acte === 'plan' && <Jauge s={s} issues={issues} mien={choix} plan={suivi} c={cal} />}

      {annonce && (
        <div className={`eva-annonce ${annonce.haut ? 'haut' : ''}`} key={annonce.titre} role="status">
          <strong>{annonce.titre}</strong>
          {annonce.sous && <span>{annonce.sous}</span>}
        </div>
      )}

      {nom === 'intro' && (
        <div className="eva-intro">
          <div className="eva-affiche">
            <img src={IMG('affiche')} alt="" draggable={false} />
            <svg className="eva-affiche-titre" viewBox="0 0 1000 200" role="img" aria-label={tr('Évasion', 'The Escape')}>
              <text x="500" y="108" textAnchor="middle" dominantBaseline="middle" textLength="760" lengthAdjust="spacingAndGlyphs">
                {tr('ÉVASION', 'THE ESCAPE')}
              </text>
            </svg>
            <i className="eva-affiche-reflet" />
            {M > 1 && (
              <span className="eva-multi" role="status">
                <small>{tr('Multiplicateur de la roue', 'Wheel multiplier')}</small>
                <strong>×{M}</strong>
              </span>
            )}
          </div>
          <div className="eva-infos">
            <div className="eva-accroche">
              <strong>{tr('Trois voitures, une seule chance', 'Three cars, one chance')}</strong>
              <span>{tr('Monte dans l’une d’elles : plus l’itinéraire est risqué, plus le butin est gros… si la police ne t’arrête pas !', 'Jump into one: the riskier the route, the bigger the loot… if the police don’t catch you!')}</span>
            </div>
            <ol className="eva-liste">
              {routes.map(({ r, k, it }) => (
                <li key={r} className={r} style={{ '--k': k } as CSSProperties}>
                  <Voiture route={r} className="eva-liste-auto" roule />
                  <span className="eva-liste-nom">
                    <strong>{tr(...NOMS_ROUTES[r].nom)}</strong>
                    <small>{tr(`Arrestation ${Math.round(it.arrestation * 100)} %`, `${Math.round(it.arrestation * 100)}% arrest`)}</small>
                  </span>
                  <b>
                    <ValeurMultipliee x={Math.min(...gains(r))} m={M} rapide /> → <ValeurMultipliee x={Math.max(...gains(r))} m={M} rapide />
                  </b>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}

      {nom === 'route' && (
        <div className="eva-choix">
          {routes.map(({ r, k, it }) => (
            <button key={r} type="button" className={`eva-carte ${r} ${choix === k ? 'choisie' : ''} ${choix !== null && choix !== k ? 'autre' : ''}`} style={{ '--k': k } as CSSProperties} onClick={() => choisir(k)} disabled={!ouvert || choix !== null}>
              <span className="eva-carte-decor" style={{ backgroundImage: `url(${IMG(DECORS[r][0])})` }} />
              <Voiture route={r} className="eva-carte-auto" roule />
              <span className="eva-carte-texte">
                <strong>{tr(...NOMS_ROUTES[r].nom)}</strong>
                <small>
                  {tr(...NOMS_ROUTES[r].risque)} · {tr(`arrestation ${Math.round(it.arrestation * 100)} %`, `${Math.round(it.arrestation * 100)}% arrest`)}
                </small>
                <em>
                  <ValeurMultipliee x={Math.min(...gains(r))} m={M} rapide /> → <ValeurMultipliee x={Math.max(...gains(r))} m={M} rapide />
                </em>
              </span>
              {salon[k] ? <i className="eva-nb">{salon[k]}</i> : null}
            </button>
          ))}
        </div>
      )}

      {nom === 'revele' && b.routes && (
        <div className={`eva-fin ${issueMienne?.evade ? 'evade' : 'arrete'}`}>
          <div className="eva-fin-image" style={{ backgroundImage: `url(${IMG(issueMienne?.evade ? 'fin-evade2' : 'fin-arrete')})` }} />
          <ul className="eva-bilan" aria-label={tr('Les trois voitures', 'The three cars')}>
            {routes.map(({ r, k }) => {
              const x = b.routes?.[k];
              return (
                <li key={r} className={`${x?.evade ? 'evadee' : 'arretee'} ${choix === k ? 'mienne' : ''}`} style={{ '--k': k } as CSSProperties}>
                  <Voiture route={r} className="eva-bilan-auto" />
                  <span>{tr(...NOMS_ROUTES[r].nom)}</span>
                  <strong>{x?.evade ? <ValeurMultipliee x={x.x} m={M} son={choix === k} /> : tr('Arrêtée', 'Caught')}</strong>
                </li>
              );
            })}
          </ul>
          {issueMienne?.evade && <PluieLingots n={20} objets={['billet', 'billet', 'lingot']} />}
        </div>
      )}
    </div>
  );
}
