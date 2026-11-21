/**
 * La Grande Évasion (The Baron's Wheel) : la course à trois. Trois voitures quittent la banque, une par itinéraire
 * (le Boulevard, les Ruelles, les Souterrains) ; chaque joueur monte dans l'une d'elles. Plus l'itinéraire est risqué,
 * plus le butin est gros… si la voiture échappe à la police.
 *
 * Le serveur a tiré l'issue des trois voitures dès le début du bonus ; il ne l'envoie aux téléphones qu'au départ de
 * la poursuite (les choix sont faits). Cet écran met la course en scène :
 * - l'intro : l'affiche, les trois voitures et ce que rapporte chacune (multiplicateur de la roue compris) ;
 * - le choix : trois cartes, une par voiture ;
 * - la poursuite (COURSE_BW) : le départ des trois voitures, la police aux trousses (trois pistes l'une sous
 *   l'autre) ; puis la caméra suit chaque voiture à son tour, plein écran, dans ses décors, où elle saute les
 *   obstacles ; enfin le dénouement, voiture après voiture : le saut par-dessus la Seine, ou le barrage de police.
 *   Les décors, la chaussée, les voitures et leurs roues, les obstacles et les effets sont placés à chaque image
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
/** Les deux obstacles de chaque itinéraire : l'image, sa hauteur (en hauteurs de carrosserie), son rapport hauteur / largeur. */
const OBSTACLES: Record<RouteBW, { img: string; h: number; ratio: number }[]> = {
  boulevard: [
    { img: 'obstacle-fiacre', h: 1.15, ratio: 482 / 760 },
    { img: 'obstacle-kiosque', h: 1.3, ratio: 607 / 600 },
  ],
  ruelles: [
    { img: 'obstacle-charrette', h: 1.1, ratio: 513 / 760 },
    { img: 'obstacle-chevalet', h: 1.3, ratio: 642 / 600 },
  ],
  souterrains: [
    { img: 'obstacle-wagonnet', h: 1.05, ratio: 485 / 760 },
    { img: 'obstacle-eboulement', h: 1.35, ratio: 598 / 600 },
  ],
};

/** Toutes les images de la Grande Évasion (sans chemin ni extension), préchargées avant le bonus. */
export const IMAGES_EVASION_NOMS = [
  'affiche',
  ...ROUTES_BW.flatMap((r) => [...DECORS[r], `route-${r}`, `voiture-${r}`, ...OBSTACLES[r].map((o) => o.img)]),
  'seine',
  'barrage',
  'roue',
  'police',
  'roue-police',
  'fumee',
  'gyrophare',
  'etincelles',
  'jauge',
  'fin-evade',
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
// Le calendrier de la poursuite (millisecondes d'une poursuite de 21 s, voir COURSE_BW)

const REF = DUREES_BW.poursuite;
const { depart: DEPART, plan: PLAN, denouement: DENOUEMENT, issue: ISSUE } = COURSE_BW;
/** La fin des plans : la caméra revient sur les trois pistes, qui débouchent sur la Seine. */
const FIN_PLANS = DEPART + 3 * PLAN;
const debutPlan = (k: number) => DEPART + k * PLAN;
/** Dans un plan : le passage de chaque obstacle sous la voiture, le changement de décor. */
const OBST = [1350, 2950];
const CHANGE_DECOR = 2000;
const debutIssue = (k: number) => DENOUEMENT + k * ISSUE;
/** L'issue (depuis son début) : le saut (la voiture accélère, s'élance, s'envole) ; le barrage (le freinage, l'arrêt). */
const SAUT = { elan: 300, vol: 1150, tampon: 700 };
const FREIN = { debut: 150, arret: 1050 };

type Acte = 'depart' | 'plan' | 'denouement';
const acteA = (s: number): { acte: Acte; plan: number } =>
  s < DEPART ? { acte: 'depart', plan: -1 } : s < FIN_PLANS ? { acte: 'plan', plan: Math.floor((s - DEPART) / PLAN) } : { acte: 'denouement', plan: -1 };

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
/** La vitesse de la caméra : le démarrage, la course, puis elle ralentit pendant le dénouement et s'arrête à la fin. */
const VITESSE_CAMERA: [number, number][] = [
  [0, 0.3],
  [1200, 1],
  [FIN_PLANS, 1],
  [DENOUEMENT + 400, 0.4],
  [debutIssue(2), 0.2],
  [debutIssue(2) + 1200, 0],
];
/** Le freinage d'une voiture arrêtée au barrage (1 : elle roule, 0 : arrêtée). */
const frein = (s: number, k: number) => 1 - lisse((s - debutIssue(k) - FREIN.debut) / (FREIN.arret - FREIN.debut));
/** Le chemin parcouru par une voiture (en secondes à pleine vitesse) : celui de la caméra, sauf quand elle freine. */
function cheminVoiture(s: number, k: number, evade: boolean): number {
  const i0 = debutIssue(k) + FREIN.debut;
  if (evade || s <= i0) return integrale(VITESSE_CAMERA, s);
  const fin = Math.min(s, debutIssue(k) + FREIN.arret);
  const n = 24;
  let total = integrale(VITESSE_CAMERA, i0);
  for (let j = 0; j < n; j++) {
    const a = i0 + ((fin - i0) * j) / n;
    const b = i0 + ((fin - i0) * (j + 1)) / n;
    const m = (a + b) / 2;
    total += ((b - a) / 1000) * vitesseA(m) * frein(m, k);
  }
  return total;
}
/** La vitesse de la caméra à l'instant s. */
function vitesseA(s: number): number {
  const P = VITESSE_CAMERA;
  if (s <= P[0][0]) return P[0][1];
  for (let i = 0; i + 1 < P.length; i++) if (s < P[i + 1][0]) return P[i][1] + ((P[i + 1][1] - P[i][1]) * (s - P[i][0])) / (P[i + 1][0] - P[i][0]);
  return P[P.length - 1][1];
}
/** La scène commune (le départ, le dénouement) : une seule chaussée à trois voies, les voitures côte à côte en profondeur. */
const COMMUN = { route: 0.6, sols: [0.3, 0.58, 0.86], echelles: [0.7, 0.85, 1], x: [0.5, 0.57, 0.64] };
/** L'écart entre la police et la voiture (en largeurs de voiture), qui varie pendant la course. */
function ecart(s: number, k: number, evade: boolean): number {
  let g = 0.5 + 0.22 * Math.sin(s / 820 + k * 2.1) + 0.08 * Math.sin(s / 310 + k);
  // Au départ, la police surgit de la gauche.
  if (s < 2200) g += 3.2 * (1 - sortie((s - 500 - k * 120) / 1500));
  const i = debutIssue(k);
  if (s > i) {
    if (evade) g += 3 * borne((s - i - 100) / 1300) ** 2;
    else g = g + (0.06 - g) * lisse((s - i) / FREIN.arret);
  }
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
  obstacles: RefObject<HTMLImageElement>[];
  barrage: RefObject<HTMLImageElement>;
  voiture: RefsVehicule;
  police: RefsVehicule;
}
const nouvelleRef = <T,>(): RefObject<T> => ({ current: null });
const refsVehicule = (): RefsVehicule => ({ el: nouvelleRef(), roues: [nouvelleRef(), nouvelleRef()], fumee: nouvelleRef(), etincelles: nouvelleRef() });

interface DonneesScene {
  cle: string;
  debut: number;
  /** Le rapport entre la poursuite de 21 s et celle du serveur. */
  echelle: number;
  issues: boolean[] | null;
  poursuite: boolean;
}

function useSceneCourse(donnees: { current: DonneesScene | null }, scene: RefObject<HTMLDivElement>, pistes: RefsPiste[]) {
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
    const derniers = pistes.map(() => ({ cle: '', fracas: [false, false] }));

    let raf = 0;
    const image = () => {
      raf = requestAnimationFrame(image);
      const d = donnees.current;
      const { W: w, H: h } = taille;
      if (!d || !d.poursuite || !w || !h) return;
      const s = (performance.now() - d.debut) * d.echelle;
      const { acte, plan } = acteA(s);
      const reduit = mouvementReduit();
      const portrait = h > w * 1.05;
      const plein = acte === 'plan';
      const camera = integrale(VITESSE_CAMERA, s);

      pistes.forEach((p, k) => {
        const route = ROUTES_BW[k];
        const evade = d.issues?.[k] ?? true;
        const piste = p.el.current;
        if (!piste) return;
        // En plan, seule la piste suivie se voit ; dans la scène commune, la première porte le décor et la chaussée.
        const visible = !plein || plan === k;
        const decor = plein || k === 0;
        const cle = `${d.cle}-${acte}-${plan}-${taille.version}`;
        const change = derniers[k].cle !== cle;
        if (change) {
          derniers[k].cle = cle;
          piste.style.visibility = visible ? 'visible' : 'hidden';
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
        const uVoiture = v * cheminVoiture(s, k, evade);

        // Les décors : le premier, le second (à mi-plan), puis le pont sur la Seine ; chacun défile lentement.
        const p0 = debutPlan(k);
        const fenetres: [number, number, number][] = [
          [0, p0 + CHANGE_DECOR + 400, 1 - borne((s - p0 - CHANGE_DECOR + 400) / 800)],
          [p0 + CHANGE_DECOR - 400, FIN_PLANS + 400, borne((s - p0 - CHANGE_DECOR + 400) / 800) * (1 - borne((s - FIN_PLANS) / 400))],
          [FIN_PLANS, debutIssue(2) + 2000, borne((s - FIN_PLANS) / 400)],
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
          const x = -(Dw - w) * (0.05 + 0.9 * lisse((s - a) / (b - a)));
          dec.style.opacity = String(op);
          dec.style.width = `${Dw}px`;
          dec.style.height = `${Dh}px`;
          dec.style.transform = `translate3d(${x}px, ${top}px, 0)`;
        });

        // La chaussée qui défile (les pavés du quai pour le dénouement, l'avenue au départ).
        const chaussee = p.route.current;
        if (chaussee) {
          if (change) {
            chaussee.style.visibility = decor ? 'visible' : 'hidden';
            chaussee.style.backgroundImage = `url(${IMG(`route-${plein ? route : acte === 'denouement' ? 'ruelles' : 'boulevard'}`)})`;
          }
          const tw = Bh * TUILE;
          chaussee.style.top = `${yRoute}px`;
          chaussee.style.height = `${Bh}px`;
          chaussee.style.width = `${w + tw * 2}px`;
          chaussee.style.backgroundSize = `${tw}px ${Bh}px`;
          chaussee.style.transform = `translate3d(${-(((u % tw) + tw) % tw)}px, 0, 0)`;
        }

        // Les obstacles du plan : ils arrivent de la droite, sur la chaussée, et passent sous la voiture qui les saute.
        const sauts: { x: number; l: number; h: number }[] = [];
        p.obstacles.forEach((r, j) => {
          const o = r.current;
          if (!o) return;
          const ob = OBSTACLES[route][j];
          const oh = Ch * ob.h;
          const ow = oh / ob.ratio;
          const x = xC + (v * (p0 + OBST[j] - s)) / 1000;
          const vu = plein && x > -ow && x < w + ow;
          o.style.visibility = vu ? 'visible' : 'hidden';
          if (!vu) return;
          sauts.push({ x, l: ow, h: oh });
          // Pulvérisé au passage de la voiture : il bascule et s'efface.
          const choc = borne((xC - x) / (Cw * 0.9));
          o.style.width = `${ow}px`;
          o.style.opacity = String(1 - choc * 0.75);
          o.style.transform = `translate3d(${x - ow / 2}px, ${yG - oh * 0.97}px, 0) rotate(${choc * 14}deg)`;
          if (choc > 0.05 && !derniers[k].fracas[j]) {
            derniers[k].fracas[j] = true;
            jouerEffet('ev_fracas', { vitesse: 0.92 + j * 0.12 });
          }
          if (choc === 0) derniers[k].fracas[j] = false;
        });

        // Le saut d'un véhicule au-dessus des obstacles proches (hauteur, inclinaison, et l'atterrissage).
        const sautDe = (xv: number) => {
          for (const o of sauts) {
            const demi = ((Cw + o.l) / 2) * 1.08;
            const dd = o.x - xv;
            if (Math.abs(dd) < demi) {
              const q = (demi - dd) / (2 * demi);
              return { y: -(o.h * 1.02 + Ch * 0.08) * Math.sin(q * Math.PI), rot: -9 * Math.sin(q * Math.PI * 2), q };
            }
          }
          return { y: 0, rot: 0, q: -1 };
        };

        // La voiture : son entrée au départ, ses sauts, le barrage, ou l'envol au-dessus de la Seine.
        const iK = debutIssue(k);
        let xv = xC + (uVoiture - u);
        let yv = 0;
        let rot = 0;
        let quitte = false;
        if (s < DEPART) xv = -Cw + (xC + Cw) * sortie((s - (2 - k) * 180) / 1500);
        const saut = sautDe(xv);
        yv += saut.y;
        rot += saut.rot;
        const envol = acte === 'denouement' && evade && s > iK + SAUT.elan;
        if (envol) {
          const q = borne((s - iK - SAUT.elan) / SAUT.vol);
          xv += q * q * w * 0.8 + q * Cw * 0.5;
          yv -= Math.sin(Math.min(q, 0.85) * Math.PI * 0.75) * h * (plein ? 0.6 : 0.5) + q * h * 0.25;
          rot -= 10 * Math.sin(q * Math.PI * 0.8);
          quitte = q >= 1;
        }
        // Les secousses de la route (pas pour une voiture arrêtée).
        const roule = evade || s < iK + FREIN.arret;
        if (!reduit && roule) yv += Math.sin(s / 47 + k) * Ch * 0.012;
        const freine = acte === 'denouement' && !evade && s > iK + FREIN.debut && s < iK + FREIN.arret + 150;
        if (freine) rot += 2.2 * Math.sin(borne((s - iK - FREIN.debut) / 900) * Math.PI);
        placerVehicule(p.voiture, V, xv, yG + yv, Cw, rot, uVoiture, quitte);
        const fumee = p.voiture.fumee.current;
        if (fumee) fumee.style.opacity = String(quitte || !roule ? 0 : freine ? 0.95 : 0.35 + 0.15 * Math.sin(s / 90));
        const etincelles = p.voiture.etincelles.current;
        if (etincelles) etincelles.style.opacity = String(freine ? 0.6 + 0.4 * Math.sin(s / 40) : saut.q > 0.82 ? 1 - (saut.q - 0.82) / 0.18 : 0);

        // La police, à quelques longueurs ; elle saute aussi, et freine quand la voiture lui échappe.
        const g = ecart(s, k, evade);
        const xp = (envol ? xC : xv) - Cw * (1.04 + g);
        const sp = sautDe(xp);
        const freinePolice = acte === 'denouement' && s > iK && s < iK + 1300;
        placerVehicule(p.police, POLICE, xp, yG + sp.y + (reduit || !roule ? 0 : Math.sin(s / 53 + k * 3) * Ch * 0.012), Cw, sp.rot + (freinePolice ? 1.5 : 0), evade ? u : uVoiture, false);
        const fp = p.police.fumee.current;
        if (fp) fp.style.opacity = String(!roule ? 0 : freinePolice ? 0.85 : 0.25);

        // Le barrage, posé sur la chaussée : la voiture pile juste devant.
        const barrage = p.barrage.current;
        if (barrage) {
          const vu = acte === 'denouement' && !evade && s > iK - 900;
          barrage.style.visibility = vu ? 'visible' : 'hidden';
          if (vu) {
            const bh = Ch * BARRAGE.h;
            const bw = bh / BARRAGE.ratio;
            const arret = v * cheminVoiture(iK + FREIN.arret + 10, k, false);
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
  }, [donnees, scene, pistes]);
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

function AutoDom({ V, r, police = false }: { V: Vehicule; r: RefsVehicule; police?: boolean }) {
  return (
    <span className={`eva-auto ${police ? 'police' : ''}`} ref={r.el} style={{ '--ratio': V.ratio } as CSSProperties}>
      <img className="eva-auto-fumee" ref={r.fumee} src={IMG('fumee')} alt="" draggable={false} />
      {V.roues.map(([cx, cy, rr], i) => (
        <img
          key={i}
          className="eva-roue"
          ref={r.roues[i]}
          src={IMG(V.roue)}
          alt=""
          draggable={false}
          style={{ left: `${(cx - rr) * 100}%`, top: `${(cy - rr / V.ratio) * 100}%`, width: `${rr * 200}%` }}
        />
      ))}
      <img className="eva-caisse" src={IMG(V.img)} alt="" draggable={false} />
      {police && <img className="eva-gyro" src={IMG('gyrophare')} alt="" draggable={false} style={{ left: `${POLICE.gyro[0] * 100}%`, top: `${POLICE.gyro[1] * 100}%` }} />}
      <img className="eva-auto-etincelles" ref={r.etincelles} src={IMG('etincelles')} alt="" draggable={false} />
    </span>
  );
}

/** La jauge de distance : la police à gauche, la liberté à droite ; les trois voitures entre les deux. */
function Jauge({ s, issues, mien, plan }: { s: number; issues: boolean[] | null; mien: number | null; plan: number }) {
  return (
    <div className="eva-jauge" aria-hidden="true">
      <img src={IMG('jauge')} alt="" draggable={false} />
      <span className="eva-jauge-canal">
        {ROUTES_BW.map((r, k) => {
          const g = ecart(s, k, issues?.[k] ?? true);
          const pos = Math.min(0.9, Math.max(0.1, 0.18 + g * 0.55 + (s - DEPART) / (FIN_PLANS - DEPART) * 0.2));
          return (
            <img
              key={r}
              className={`eva-jauge-auto ${mien === k ? 'mien' : ''} ${plan === k ? 'suivie' : ''}`}
              src={IMG(`voiture-${r}`)}
              alt=""
              draggable={false}
              style={{ left: `${pos * 100}%`, '--k': k } as CSSProperties}
            />
          );
        })}
      </span>
    </div>
  );
}

function Gerbe({ style }: { style: CSSProperties }) {
  return (
    <span className="eva-gerbe" aria-hidden="true" style={style}>
      {Array.from({ length: 10 }, (_, i) => (
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
  const { acte, plan } = acteA(s);

  const donnees = useRef<DonneesScene | null>(null);
  donnees.current = { cle: cleEtape, debut: horloge.current.debut, echelle, issues, poursuite };
  const scene = useRef<HTMLDivElement>(null);
  const pistesRef = useRef<RefsPiste[] | null>(null);
  if (!pistesRef.current)
    pistesRef.current = ROUTES_BW.map(() => ({
      el: nouvelleRef(),
      decors: [nouvelleRef(), nouvelleRef(), nouvelleRef()],
      route: nouvelleRef(),
      obstacles: [nouvelleRef(), nouvelleRef()],
      barrage: nouvelleRef(),
      voiture: refsVehicule(),
      police: refsVehicule(),
    }));
  const pistes = pistesRef.current;
  useSceneCourse(donnees, scene, pistes);

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
    for (let k = 0; k < 3; k++) {
      if (entre(debutPlan(k), 800)) fois(`passage${k}`, () => jouerEffet('ev_passage', { vitesse: 0.94 + k * 0.06 }));
      if (!issues) continue;
      const i = debutIssue(k);
      const ton = k === choix ? 1 : 0.6;
      if (issues[k]) {
        if (entre(i + SAUT.elan - 200, 700)) fois(`saut${k}`, () => jouerEffet('ev_saut', { volume: ton }));
        if (entre(i + SAUT.tampon, 900)) fois(`foule${k}`, () => jouerEffet('course_foule', { volume: 0.55 * ton }));
      } else {
        if (entre(i + FREIN.debut, 600)) fois(`frein${k}`, () => jouerEffet('ex_freins', { volume: 0.8 * ton }));
        if (entre(i + FREIN.arret, 900)) fois(`sifflet${k}`, () => jouerEffet('br_sifflet', { volume: ton }));
      }
    }
    if (entre(FIN_PLANS, 1000)) fois('sirene2', () => jouerEffet('bw_sirene', { volume: 0.6 }));
  });

  // Les annonces du moment.
  let annonce: { titre: string; sous?: string } | null = null;
  if (poursuite) {
    if (s > 300 && s < DEPART - 300) annonce = { titre: tr('Trois voitures, trois itinéraires !', 'Three cars, three routes!'), sous: tr('La police est à leurs trousses…', 'The police are on their tail…') };
    else if (s >= FIN_PLANS && s < DENOUEMENT + 200) annonce = { titre: tr('Le pont… ou le barrage ?', 'The bridge… or the roadblock?'), sous: tr('Le dénouement, voiture après voiture', 'The outcome, car after car') };
  }

  const routes = ROUTES_BW.map((r, k) => ({ r, k, it: ITINERAIRES_BW[r] }));
  const gains = (r: RouteBW) => ITINERAIRES_BW[r].gains.map(([x]) => x);
  const issueMienne = b.routes?.[suivi] ?? null;

  return (
    <div className={`eva ${nom} ${poursuite ? acte : ''}`} ref={scene}>
      {/* La course : trois pistes (l'une sous l'autre, ou une seule en plein écran pendant son plan). */}
      <div className={`eva-course ${poursuite ? '' : 'cache'}`} aria-hidden="true">
        {pistes.map((p, k) => {
          const r = ROUTES_BW[k];
          return (
            <div key={r} className={`eva-piste ${r}`} ref={p.el}>
              {[...DECORS[r], 'seine'].map((d, i) => (
                <div key={d} className="eva-decor" ref={p.decors[i]} style={{ backgroundImage: `url(${IMG(d)})` }} />
              ))}
              <div className="eva-route" ref={p.route} />
              {OBSTACLES[r].map((o, j) => (
                <img key={o.img} className="eva-obstacle" ref={p.obstacles[j]} src={IMG(o.img)} alt="" draggable={false} />
              ))}
              <AutoDom V={POLICE} r={p.police} police />
              <AutoDom V={VOITURES[r]} r={p.voiture} />
              <img className="eva-barrage" ref={p.barrage} src={IMG('barrage')} alt="" draggable={false} />
            </div>
          );
        })}
        <div className="eva-vitesse" />
        {/* Au dénouement : les pièces d'or au départ du saut, les gyrophares au barrage. */}
        {poursuite &&
          issues &&
          acte === 'denouement' &&
          ROUTES_BW.map((r, k) => {
            const t = s - debutIssue(k);
            if (issues[k] && t > SAUT.elan && t < SAUT.elan + 1400)
              return <Gerbe key={r} style={{ left: `${COMMUN.x[k] * 100}%`, top: `${(COMMUN.route + (1 - COMMUN.route) * COMMUN.sols[k]) * 100 - 12}%` }} />;
            if (!issues[k] && t > FREIN.arret - 100 && t < FREIN.arret + 1800) return <i key={r} className="eva-gyro-flash" />;
            return null;
          })}
      </div>

      {/* Les plaques : celle de la voiture suivie (en plan), ou les trois, avec leur issue (le départ, le dénouement). */}
      {poursuite && (
        <div className={`eva-plaques ${acte}`}>
          {ROUTES_BW.map((r, k) => {
            if (acte === 'plan' && plan !== k) return null;
            const resolue = !!issues && acte === 'denouement' && s >= debutIssue(k) + (issues[k] ? SAUT.tampon : FREIN.arret);
            return (
              <span key={`${r}-${acte}`} className={`eva-plaque ${choix === k ? 'mienne' : ''} ${resolue ? (issues?.[k] ? 'evadee' : 'arretee') : ''}`}>
                <i className={`eva-pastille ${r}`} />
                <strong>{tr(...NOMS_ROUTES[r].nom)}</strong>
                {resolue ? (
                  <b>{issues?.[k] ? fx((b.routes?.[k]?.x ?? 0) * M) : tr('arrêtée', 'caught')}</b>
                ) : (
                  <small>{tr(`arrestation ${Math.round(ITINERAIRES_BW[r].arrestation * 100)} %`, `${Math.round(ITINERAIRES_BW[r].arrestation * 100)}% arrest`)}</small>
                )}
                {choix === k && <em>{tr('Toi', 'You')}</em>}
              </span>
            );
          })}
        </div>
      )}
      {/* Le tampon de la dernière issue, le temps de la lire. */}
      {poursuite &&
        issues &&
        acte === 'denouement' &&
        ROUTES_BW.map((r, k) => {
          const t = s - debutIssue(k) - (issues[k] ? SAUT.tampon : FREIN.arret);
          if (t < 0 || t > 1500) return null;
          return (
            <span key={r} className={`eva-tampon ${issues[k] ? 'evadee' : 'arretee'} ${choix === k ? 'mienne' : ''}`} role="status">
              <small>
                {tr(...NOMS_ROUTES[r].nom)}
                {choix === k ? tr(' · ta voiture', ' · your car') : ''}
              </small>
              <b>{issues[k] ? tr('Évadée !', 'Escaped!') : tr('Arrêtée !', 'Caught!')}</b>
              {issues[k] && <em>{fx((b.routes?.[k]?.x ?? 0) * M)}</em>}
            </span>
          );
        })}
      {poursuite && acte === 'plan' && <div className="eva-coupe" key={`coupe${plan}`} aria-hidden="true" />}
      {poursuite && acte === 'denouement' && s < FIN_PLANS + 500 && <div className="eva-coupe" aria-hidden="true" />}
      {poursuite && acte === 'plan' && <Jauge s={s} issues={issues} mien={choix} plan={plan} />}

      {annonce && (
        <div className="eva-annonce" key={annonce.titre} role="status">
          <strong>{annonce.titre}</strong>
          {annonce.sous && <span>{annonce.sous}</span>}
        </div>
      )}

      {nom === 'intro' && (
        <div className="eva-intro">
          <div className="eva-affiche">
            <img src={IMG('affiche')} alt="" draggable={false} />
            <svg className="eva-affiche-titre" viewBox="0 0 1000 200" role="img" aria-label={tr('La Grande Évasion', 'The Great Escape')}>
              <text x="500" y="64" textAnchor="middle" dominantBaseline="middle" textLength="520" lengthAdjust="spacingAndGlyphs" className="petit">
                {tr('LA GRANDE', 'THE GREAT')}
              </text>
              <text x="500" y="146" textAnchor="middle" dominantBaseline="middle" textLength="780" lengthAdjust="spacingAndGlyphs">
                {tr('ÉVASION', 'ESCAPE')}
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
                  <img src={IMG(`voiture-${r}`)} alt="" draggable={false} />
                  <span className="eva-liste-nom">
                    <strong>{tr(...NOMS_ROUTES[r].nom)}</strong>
                    <small>{tr(`Arrestation ${Math.round(it.arrestation * 100)} %`, `${Math.round(it.arrestation * 100)}% arrest`)}</small>
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
              <img className="eva-carte-auto" src={IMG(`voiture-${r}`)} alt="" draggable={false} />
              <span className="eva-carte-texte">
                <strong>{tr(...NOMS_ROUTES[r].nom)}</strong>
                <small>
                  {tr(...NOMS_ROUTES[r].risque)} · {tr(`arrestation ${Math.round(it.arrestation * 100)} %`, `${Math.round(it.arrestation * 100)}% arrest`)}
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
          <div className="eva-fin-image" style={{ backgroundImage: `url(${IMG(issueMienne?.evade ? 'fin-evade' : 'fin-arrete')})` }} />
          <ul className="eva-bilan" aria-label={tr('Les trois voitures', 'The three cars')}>
            {routes.map(({ r, k }) => {
              const x = b.routes?.[k];
              return (
                <li key={r} className={`${x?.evade ? 'evadee' : 'arretee'} ${choix === k ? 'mienne' : ''}`} style={{ '--k': k } as CSSProperties}>
                  <img src={IMG(`voiture-${r}`)} alt="" draggable={false} />
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
