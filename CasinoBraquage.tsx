/**
 * Le Braquage (The Baron's Wheel) : une seule perceuse pour tout le salon, et aucun choix. Elle perce la banque
 * sous-sol après sous-sol ; chaque sous-sol atteint vaut son multiple, le même pour tout le monde, jusqu'à ce que
 * l'alarme sonne et que la bande file avec le butin. Au cinquième, le Coffre du Siècle s'ouvre sur un jackpot.
 *
 * Le serveur a tiré le sous-sol où s'arrête la perceuse dès le début du bonus ; il ne l'envoie aux téléphones qu'au
 * départ de la perceuse (étape « descente », dont la durée suit ce tirage). Cet écran met le casse en scène :
 * - l'intro : l'affiche, la perceuse suspendue, l'échelle des butins (multiplicateur de la roue compris) ;
 * - la descente : la banque en coupe (la rue, puis cinq sous-sols séparés par des dalles), la perceuse qui meule
 *   chaque dalle (étincelles, gravats, poussière, secousses) puis la traverse ; la caméra la suit. La perceuse, la
 *   mèche, les chaînes, la caméra, les effets et les gendarmes sont placés à chaque image (requestAnimationFrame) ;
 * - l'alarme : sirène, lumière rouge, gendarmes qui déboulent, la bande hissée par le trou avec le butin ;
 * - le Coffre du Siècle : sa porte s'ouvre, l'or et les joyaux jaillissent, le jackpot apparaît ;
 * - la fin : la voiture de la bande file dans Paris avec le butin de tout le salon.
 * Les sons et les panneaux suivent l'horloge de l'étape (10 fois par seconde).
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { CASSE_BW, ETAGES_BRAQUAGE, perceeCasseBW, VALEUR_JACKPOT_BW, type JackpotBW, type VueBonusBW, type VueBW } from '../../shared/baronWheel';
import { fx, ValeurMultipliee } from './CasinoBaronExpress';
import { PluieLingots } from './casinoOutils';
import { tr } from './traduction';
import { jouerEffet, mouvementReduit } from './ui';
import './braquage.css';

const IMG = (n: string) => `/cartes/bw-br-${n}.webp`;
/** Toutes les images du Braquage (sans chemin ni extension), préchargées avant le bonus. */
export const IMAGES_BRAQUAGE_NOMS = [
  'affiche',
  'surface',
  'perceuse',
  'meche',
  'chaine',
  'dalle',
  'dalle-trou',
  ...[1, 2, 3, 4, 5].map((k) => `etage-${k}`),
  'etincelles',
  'debris2',
  'jauge',
  'plaque',
  'sirene',
  'gendarmes',
  'fuite',
  'porte',
  'diamant',
  'couronne',
  'evade',
].map((n) => `bw-br-${n}`);

/** Les diamants qui jaillissent du Coffre du Siècle : leur place finale autour de la porte (en diamètres de son disque). */
const DIAMANTS: [number, number][] = [
  [-1.12, 0.12],
  [-0.9, -0.36],
  [0, 0.98],
  [0.9, -0.36],
  [1.12, 0.12],
];
/** Les cinq sous-sols de la banque. */
const ETAGES: [string, string][] = [
  ['La salle des billets', 'The banknote room'],
  ['Les coffres particuliers', 'The safe-deposit boxes'],
  ['La chambre des joyaux', 'The jewel chamber'],
  ['La réserve d’or', 'The gold reserve'],
  ['Le Coffre du Siècle', 'The Vault of the Century'],
];
const NB = ETAGES.length;
const NOMS_JACKPOTS: Record<JackpotBW, string> = { mini: 'MINI', minor: 'MINOR', major: 'MAJOR', grand: 'GRAND' };

// ---------------------------------------------------------------------------------------------------------------
// Les images et leurs mesures

/** La perceuse (440 × 692) : ses deux chaînes et son mandrin (part de sa largeur). */
const MACHINE = { w: 440, h: 692, chaines: [0.273, 0.77], mandrin: 0.515, chaine: 0.1045 };
/** La mèche : une tuile de 256 × 271 (deux tours d'hélice) qui se répète en hauteur. */
const MECHE = { w: 256, h: 271 };
/** Un maillon de chaîne : 98 × 85. */
const CHAINE = { w: 98, h: 85 };
/** La dalle : une tuile (927 × 362) ; la dalle percée fait trois tuiles, son trou centré à 49,32 % de sa largeur. */
const DALLE = { tuile: 927 / 362, percee: 2781 / 362, trou: 0.4932 };
/**
 * La porte peinte au fond du Coffre du Siècle : son centre (à 46,3 % de la hauteur de la salle) et sa largeur (52,45 %
 * de la hauteur de la salle, l'image de la salle étant toujours à la hauteur de la salle). La porte qui s'ouvre (760 ×
 * 781) la recouvre exactement : son disque, centré à (49 %, 50 %) de l'image, fait 94 % de sa largeur.
 */
const PORTE_PEINTE = { y: 0.463, largeur: 0.5245 };
const PORTE = { ratio: 781 / 760, cx: 0.49, cy: 0.5, disque: 0.94 };
/** La jauge (292 × 1100) : ses six alvéoles (la rue, puis les cinq sous-sols) et son tube. */
const JAUGE = { ratio: 292 / 1100, alveoles: [0.2409, 0.3436, 0.4445, 0.5486, 0.6514, 0.7541], x: 0.197, d: 0.2, tube: { x: 0.523, l: 0.155, haut: 0.215, bas: 0.778 } };

// ---------------------------------------------------------------------------------------------------------------
// Le calendrier de la descente (millisecondes depuis son début, voir CASSE_BW)

/**
 * Au départ, la grue descend la perceuse sur la rue (elle s'y pose à ATTERRIT ms). Puis, à chaque dalle, la mèche la
 * meule pendant GRIND ms, et la perceuse descend à travers le sous-sol percé pendant DESC ms, le temps de le voir.
 */
const ATTERRIT = 1700;
const GRIND = 2800;
const DESC = CASSE_BW.etage - GRIND;
/** La percée de la dalle k (au-dessus du sous-sol k + 1), et le début de son meulage. */
const percee = (k: number) => perceeCasseBW(k + 1);
const meule = (k: number) => percee(k) - GRIND;
/** Arrêtée au sous-sol F (< 5) : l'alarme sonne pendant qu'elle meule la dalle F. */
const alarmeA = (F: number) => perceeCasseBW(F) + CASSE_BW.alarme;
/** Après l'alarme : la sirène, les gendarmes (qui déboulent pendant `course`), la bande qui file. */
const ALARME = { sirene: 300, gendarmes: 900, course: 1900, fuite: 3800 };
/** Au Coffre du Siècle (depuis la percée de la dernière dalle) : la porte, qui tremble, s'ouvre ; le trésor ; le jackpot. */
const SIECLE = { porte: 2300, ouvre: 3900, tresor: 4500, jackpot: 5500 };

const lisse = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const sortie = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : 1 - (1 - u) ** 3);
/** L'avance de la mèche dans la dalle : par à-coups (cinq, toujours vers le bas). */
const avance = (u: number) => Math.min(1, Math.max(0, u + 0.03 * Math.sin(u * Math.PI * 10)));
/** La part de la dalle k déjà meulée à l'instant t (0 à 1). */
const partMeulee = (t: number, k: number) => Math.max(0, Math.min(1, (t - meule(k)) / GRIND));

interface Geo {
  W: number;
  H: number;
  portrait: boolean;
  /** Hauteur d'un sous-sol, épaisseur d'une dalle, hauteur de la rue. */
  R: number;
  S: number;
  Hs: number;
  /** La perceuse (largeur, hauteur), la mèche (largeur, longueur), l'axe de la perceuse. */
  Mw: number;
  Mh: number;
  Bw: number;
  Lb: number;
  cx: number;
  /** Au-dessus de la perceuse posée sur la rue : de quoi la voir sous le titre du bonus. */
  marge: number;
  /** Le bas du Coffre du Siècle, le roc dessous (de quoi y centrer la porte), le centre de la porte. */
  total: number;
  roc: number;
  yPorte: number;
  version: number;
}
const fondMonde = (g: Geo) => g.total + g.roc;
const dalleHaut = (g: Geo, k: number) => g.Hs + k * (g.S + g.R);
const salleHaut = (g: Geo, k: number) => g.Hs + (k - 1) * (g.S + g.R) + g.S;

/** La pointe de la mèche (y du monde) à l'instant t de la descente, la perceuse s'arrêtant au sous-sol F. */
function pointe(t: number, F: number, g: Geo): number {
  const tt = F < NB ? Math.min(t, alarmeA(F)) : t;
  const appro = g.marge + 0.5 * g.Mh;
  if (tt < meule(0)) return dalleHaut(g, 0) - appro * (1 - sortie(Math.max(0, tt) / ATTERRIT));
  for (let k = 0; k < NB; k++) {
    if (tt < percee(k)) return dalleHaut(g, k) + g.S * avance((tt - meule(k)) / GRIND);
    if (k === NB - 1) return dalleHaut(g, k) + g.S + g.R * 0.1 * sortie((tt - percee(k)) / 700);
    if (tt < meule(k + 1)) return dalleHaut(g, k) + g.S + (dalleHaut(g, k + 1) - dalleHaut(g, k) - g.S) * lisse((tt - percee(k)) / DESC);
  }
  return dalleHaut(g, NB - 1) + g.S;
}
/** Le régime de la mèche (0 à 1). */
function regime(t: number, F: number): number {
  if (t < 0) return 0;
  const monte = Math.min(1, t / 900);
  if (F < NB && t >= alarmeA(F)) return Math.max(0, 1 - (t - alarmeA(F)) / 800);
  if (F >= NB && t >= percee(NB - 1) + 700) return Math.max(0, 1 - (t - percee(NB - 1) - 700) / 1000);
  for (let k = 0; k < NB; k++) if (t >= meule(k) && t < percee(k)) return monte;
  return 0.65 * monte;
}
/** La dalle que la mèche meule à l'instant t (ou -1). */
function dalleMeulee(t: number, F: number): number {
  if (F < NB && t >= alarmeA(F)) return -1;
  for (let k = 0; k < NB; k++) if (t >= meule(k) && t < percee(k)) return k;
  return -1;
}

// ---------------------------------------------------------------------------------------------------------------
// La scène animée (boucle requestAnimationFrame)

interface DonneesScene {
  cle: string;
  debut: number;
  /** Le sous-sol où s'arrête la perceuse (null : pas encore connu), et l'étape en cours. */
  F: number | null;
  descente: boolean;
}

interface RefsScene {
  scene: RefObject<HTMLDivElement>;
  monde: RefObject<HTMLDivElement>;
  surface: RefObject<HTMLDivElement>;
  salles: RefObject<HTMLDivElement>[];
  dalles: RefObject<HTMLDivElement>[];
  chaines: RefObject<HTMLDivElement>[];
  machine: RefObject<HTMLImageElement>;
  meche: RefObject<HTMLDivElement>;
  etincelles: RefObject<HTMLImageElement>;
  chaleur: RefObject<HTMLDivElement>;
  debris: RefObject<HTMLImageElement>;
  poussieres: RefObject<HTMLDivElement>[];
  gendarmes: RefObject<HTMLImageElement>;
  sirene: RefObject<HTMLImageElement>;
  siecle: RefObject<HTMLDivElement>;
  roc: RefObject<HTMLDivElement>;
}

const nouvelleRef = <T,>(): RefObject<T> => ({ current: null });

function useSceneCasse(donnees: { current: DonneesScene | null }, refs: RefsScene) {
  useEffect(() => {
    const scene = refs.scene.current;
    if (!scene) return;
    const g: Geo = { W: 0, H: 0, portrait: false, R: 0, S: 0, Hs: 0, Mw: 0, Mh: 0, Bw: 0, Lb: 0, cx: 0, marge: 0, total: 0, roc: 0, yPorte: 0, version: 0 };
    const st = { cam: Number.NaN, cle: '', tourne: 0, dernier: performance.now(), percees: [false, false, false, false, false] };

    const mesurer = () => {
      const W = scene.clientWidth;
      const H = scene.clientHeight;
      if (!W || !H) return;
      g.W = W;
      g.H = H;
      g.portrait = H > W * 1.05;
      // En largeur, un sous-sol occupe toute la largeur ; en hauteur (téléphone), il déborde un peu des deux côtés.
      g.R = g.portrait ? W * 0.66 : (W * 900) / 1600;
      g.S = W * (g.portrait ? 0.14 : 0.11);
      g.Mw = W * (g.portrait ? 0.2 : 0.11);
      g.Mh = (g.Mw * MACHINE.h) / MACHINE.w;
      g.Bw = g.Mw * 0.26;
      g.Lb = W * (g.portrait ? 0.24 : 0.17);
      // La rue : de quoi y suspendre la perceuse au départ, posée sous le titre du bonus (plus bas sur téléphone).
      g.marge = W * (g.portrait ? 0.26 : 0.06);
      g.Hs = g.Lb + g.Mh + g.marge;
      g.cx = W / 2;
      g.total = g.Hs + NB * (g.S + g.R);
      g.roc = H * 0.6;
      g.yPorte = salleHaut(g, NB) + PORTE_PEINTE.y * g.R;
      g.version++;
      scene.style.setProperty('--bw', `${g.Bw}px`);
      const surface = refs.surface.current;
      if (surface) surface.style.height = `${g.Hs}px`;
      refs.salles.forEach((r, i) => {
        const el = r.current;
        if (!el) return;
        el.style.top = `${salleHaut(g, i + 1)}px`;
        el.style.height = `${g.R}px`;
      });
      refs.dalles.forEach((r, k) => {
        const el = r.current;
        if (!el) return;
        el.style.top = `${dalleHaut(g, k)}px`;
        el.style.height = `${g.S}px`;
        el.dataset.version = '';
      });
      // La porte du Coffre du Siècle, posée sur la porte peinte ; le roc sous la salle.
      const siecle = refs.siecle.current;
      if (siecle) {
        const pw = (PORTE_PEINTE.largeur * g.R) / PORTE.disque;
        const ph = pw * PORTE.ratio;
        siecle.style.left = `${g.cx - PORTE.cx * pw}px`;
        siecle.style.top = `${g.yPorte - PORTE.cy * ph}px`;
        siecle.style.width = `${pw}px`;
        siecle.style.height = `${ph}px`;
        scene.style.setProperty('--pd', `${PORTE.disque * pw}px`);
      }
      const roc = refs.roc.current;
      if (roc) {
        roc.style.top = `${g.total}px`;
        roc.style.height = `${g.roc}px`;
        roc.style.backgroundSize = `auto ${g.S}px`;
      }
      const machine = refs.machine.current;
      if (machine) machine.style.width = `${g.Mw}px`;
      const meche = refs.meche.current;
      if (meche) {
        meche.style.width = `${g.Bw}px`;
        meche.style.height = `${g.Lb + g.Mh * 0.04}px`;
        meche.style.backgroundSize = `100% auto`;
      }
      const lc = (g.Mw * MACHINE.chaine * CHAINE.h) / CHAINE.w;
      refs.chaines.forEach((r) => {
        const el = r.current;
        if (!el) return;
        el.style.width = `${g.Mw * MACHINE.chaine}px`;
        el.style.backgroundSize = `100% ${lc}px`;
      });
      const etincelles = refs.etincelles.current;
      if (etincelles) etincelles.style.width = `${W * (g.portrait ? 0.42 : 0.22)}px`;
      const debris = refs.debris.current;
      if (debris) debris.style.width = `${W * (g.portrait ? 0.42 : 0.22)}px`;
      const chaleur = refs.chaleur.current;
      if (chaleur) {
        chaleur.style.width = `${g.Bw * 4}px`;
        chaleur.style.height = `${g.Bw * 2.2}px`;
      }
      refs.poussieres.forEach((r) => {
        const el = r.current;
        if (!el) return;
        el.style.width = `${W * (g.portrait ? 0.5 : 0.3)}px`;
        el.style.height = `${W * (g.portrait ? 0.32 : 0.19)}px`;
      });
      const gendarmes = refs.gendarmes.current;
      if (gendarmes) gendarmes.style.height = `${g.R * (g.portrait ? 0.44 : 0.52)}px`;
      const sirene = refs.sirene.current;
      if (sirene) sirene.style.width = `${W * (g.portrait ? 0.17 : 0.09)}px`;
    };
    mesurer();
    const ro = new ResizeObserver(mesurer);
    ro.observe(scene);

    let raf = 0;
    const image = () => {
      raf = requestAnimationFrame(image);
      const d = donnees.current;
      const maintenant = performance.now();
      const dt = Math.min(64, maintenant - st.dernier);
      st.dernier = maintenant;
      if (!d || !g.W || !d.descente || d.F === null) return;
      const F = d.F;
      const t = maintenant - d.debut;
      const reduit = mouvementReduit();
      if (d.cle !== st.cle) {
        st.cle = d.cle;
        st.cam = Number.NaN;
        st.percees = [false, false, false, false, false];
      }

      // La perceuse : la pointe de la mèche, le mandrin au-dessus, la machine au-dessus du mandrin.
      const y = pointe(t, F, g);
      const mandrin = y - g.Lb;
      const haut = mandrin - g.Mh;
      const meulee = dalleMeulee(t, F);
      // Plus la mèche s'enfonce dans la dalle, plus tout tremble.
      const um = meulee >= 0 ? partMeulee(t, meulee) : 0;
      const vib = reduit || meulee < 0 ? 0 : (Math.random() - 0.5) * 2.4 * (1 + um);

      // Les secousses : la mèche qui meule, la dalle qui cède.
      let secousse = meulee >= 0 && !reduit ? (Math.random() - 0.5) * 2 * (1 + 1.5 * um) : 0;
      for (let k = 0; k < NB; k++) {
        const u = t - percee(k);
        if (k < F && u >= 0 && u < 420 && !reduit) secousse += Math.sin(u * 0.09) * 8 * Math.exp(-u / 140);
      }
      if (F >= NB && !reduit) {
        const u = t - percee(NB - 1) - SIECLE.ouvre;
        if (u >= 0 && u < 600) secousse += Math.sin(u * 0.07) * 6 * Math.exp(-u / 200);
      }

      // La caméra : elle suit la pointe ; à l'alarme, elle cadre le sous-sol ; au Coffre du Siècle, le fond.
      let cible = y - g.H * (g.portrait ? 0.62 : 0.6);
      if (F < NB && t >= alarmeA(F)) cible = salleHaut(g, F) + g.R / 2 - g.H / 2 + (g.portrait ? g.H * 0.06 : 0);
      if (F >= NB && t >= percee(NB - 1)) cible = g.yPorte - g.H * (g.portrait ? 0.5 : 0.53);
      cible = Math.max(0, Math.min(fondMonde(g) - g.H, cible));
      st.cam = Number.isNaN(st.cam) ? cible : st.cam + (cible - st.cam) * (1 - Math.exp(-dt * 0.006));
      const monde = refs.monde.current;
      if (monde) monde.style.transform = `translate3d(0, ${(-st.cam + secousse).toFixed(1)}px, 0)`;

      const machine = refs.machine.current;
      if (machine) machine.style.transform = `translate3d(${g.cx - g.Mw * MACHINE.mandrin + vib}px, ${haut}px, 0)`;
      const meche = refs.meche.current;
      if (meche) {
        st.tourne += (regime(t, F) * dt * ((g.Bw * MECHE.h) / MECHE.w)) / 95;
        meche.style.transform = `translate3d(${g.cx - g.Bw / 2 + vib}px, ${mandrin - g.Mh * 0.04}px, 0)`;
        meche.style.backgroundPosition = `0 ${st.tourne.toFixed(1)}px`;
      }
      refs.chaines.forEach((r, i) => {
        const el = r.current;
        if (!el) return;
        const hc = Math.max(0, haut + g.Mh * 0.06);
        el.style.height = `${hc}px`;
        el.style.transform = `translate3d(${g.cx - g.Mw * MACHINE.mandrin + g.Mw * MACHINE.chaines[i] - (g.Mw * MACHINE.chaine) / 2 + vib}px, 0, 0)`;
      });

      // Les dalles : intactes, puis percées (le trou dans l'axe de la perceuse).
      const largeurPercee = DALLE.percee * g.S;
      const x0 = g.cx - DALLE.trou * largeurPercee;
      refs.dalles.forEach((r, k) => {
        const el = r.current;
        if (!el) return;
        const perceeK = k < F && t >= percee(k);
        const etat = `${perceeK ? 'p' : 'i'}-${g.version}`;
        if (el.dataset.version === etat) return;
        el.dataset.version = etat;
        el.style.backgroundImage = `url(${IMG(perceeK ? 'dalle-trou' : 'dalle')})`;
        el.style.backgroundSize = `auto ${g.S}px`;
        el.style.backgroundPosition = `${x0}px 0`;
      });

      // Les étincelles à la pointe de la mèche, tant qu'elle meule.
      const etincelles = refs.etincelles.current;
      if (etincelles) {
        if (meulee < 0 || reduit) etincelles.style.opacity = '0';
        else {
          const s = (0.72 + 0.5 * um) * (0.8 + Math.random() * 0.4);
          const w = etincelles.offsetWidth;
          etincelles.style.opacity = String(0.75 + Math.random() * 0.25);
          etincelles.style.transform = `translate3d(${g.cx - w / 2}px, ${y - w * 0.5}px, 0) rotate(${(Math.random() - 0.5) * 50}deg) scale(${s})`;
        }
      }
      // La chaleur au point de contact : le métal rougit à mesure que la mèche s'enfonce.
      const chaleur = refs.chaleur.current;
      if (chaleur) {
        if (meulee < 0) chaleur.style.opacity = '0';
        else {
          const w = chaleur.offsetWidth;
          const h = chaleur.offsetHeight;
          chaleur.style.opacity = String((0.3 + 0.7 * um) * (reduit ? 1 : 0.88 + Math.random() * 0.12));
          chaleur.style.transform = `translate3d(${g.cx - w / 2}px, ${y - h * 0.45}px, 0) scale(${0.55 + 0.6 * um})`;
        }
      }
      // Les gravats et la poussière de la dernière percée.
      let derniere = -1;
      for (let k = 0; k < Math.min(F, NB); k++) if (t >= percee(k)) derniere = k;
      const debris = refs.debris.current;
      if (debris) {
        const u = derniere >= 0 ? t - percee(derniere) : -1;
        if (u < 0 || u > 1400 || reduit) debris.style.opacity = '0';
        else {
          // La dalle percée éclate : ses blocs (encore rougis par la mèche) tombent dans le sous-sol.
          const w = debris.offsetWidth;
          const h = debris.offsetHeight;
          const yb = dalleHaut(g, derniere) + g.S * 0.2 - h * 0.12 + g.R * 0.42 * (u / 1400) ** 1.6;
          debris.style.opacity = String(Math.min(1, u / 120, 2.2 - u / 640));
          debris.style.transform = `translate3d(${g.cx - w / 2}px, ${yb}px, 0) scale(${0.8 + u / 2200}) rotate(${(u / 1400) * 6}deg)`;
        }
      }
      refs.poussieres.forEach((r, i) => {
        const el = r.current;
        if (!el) return;
        const u = derniere >= 0 ? t - percee(derniere) - i * 90 : -1;
        if (u < 0 || u > 1800 || reduit) {
          el.style.opacity = '0';
          return;
        }
        const w = el.offsetWidth;
        const sens = i === 0 ? -1 : i === 1 ? 1 : 0;
        const x = g.cx - w / 2 + sens * w * 0.38 * sortie(u / 1500);
        const yp = dalleHaut(g, derniere) + g.S * 0.75 - el.offsetHeight / 2 + g.R * 0.12 * sortie(u / 1500);
        el.style.opacity = String(0.85 * Math.min(1, u / 150) * (1 - lisse((u - 700) / 1100)));
        el.style.transform = `translate3d(${x}px, ${yp}px, 0) scale(${0.55 + 0.75 * sortie(u / 1400)})`;
      });

      // L'alarme : la sirène sur le mur du sous-sol, les gendarmes qui déboulent jusqu'à la perceuse.
      const ta = F < NB ? alarmeA(F) : Number.POSITIVE_INFINITY;
      const sirene = refs.sirene.current;
      if (sirene) {
        if (t < ta + ALARME.sirene) sirene.style.visibility = 'hidden';
        else {
          sirene.style.visibility = 'visible';
          sirene.style.transform = `translate3d(${g.W * (g.portrait ? 0.04 : 0.06)}px, ${salleHaut(g, F) + g.R * 0.06}px, 0)`;
        }
      }
      const gendarmes = refs.gendarmes.current;
      if (gendarmes) {
        const u = t - ta - ALARME.gendarmes;
        if (u < 0) gendarmes.style.visibility = 'hidden';
        else {
          gendarmes.style.visibility = 'visible';
          const w = gendarmes.offsetWidth;
          const depart = g.W + w * 0.05;
          const arret = g.cx + g.Mw * 0.45;
          const x = depart + (arret - depart) * sortie(u / ALARME.course);
          const pas = reduit || u > ALARME.course + 300 ? 0 : Math.abs(Math.sin(u * 0.022)) * g.R * 0.025;
          gendarmes.style.transform = `translate3d(${x}px, ${salleHaut(g, F) + g.R * 0.97 - gendarmes.offsetHeight - pas}px, 0)`;
        }
      }
    };
    raf = requestAnimationFrame(image);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [donnees, refs]);
}

// ---------------------------------------------------------------------------------------------------------------
// Les panneaux

/** La jauge de profondeur : la rue, puis les cinq sous-sols (leurs multiples, roue comprise) ; le tube se remplit d'or. */
function Jauge({ M, acquis, perce, rate, niveau, jackpot }: { M: number; acquis: number; perce: number; rate: number; niveau: number; jackpot: JackpotBW | null }) {
  const a = JAUGE.alveoles;
  const k = Math.max(0, Math.min(NB, niveau));
  const i = Math.floor(k);
  const yNiveau = i >= NB ? a[NB] : a[i] + (a[i + 1] - a[i]) * (k - i);
  const remplissage = Math.max(0, Math.min(1, (yNiveau - JAUGE.tube.haut) / (JAUGE.tube.bas - JAUGE.tube.haut)));
  return (
    <div className="brq-jauge" aria-hidden="true">
      <img src={IMG('jauge')} alt="" draggable={false} />
      <i className="brq-jauge-or" style={{ left: `${JAUGE.tube.x * 100}%`, width: `${JAUGE.tube.l * 100}%`, top: `${JAUGE.tube.haut * 100}%`, height: `${(JAUGE.tube.bas - JAUGE.tube.haut) * remplissage * 100}%` }} />
      {a.map((y, n) => {
        const etat = n === 0 ? 'rue' : n <= acquis ? 'acquis' : n === rate ? 'rate' : n === perce ? 'perce' : '';
        const valeur = n === 0 ? null : ETAGES_BRAQUAGE[n - 1] * M;
        return (
          <span key={n} className={`brq-alveole ${etat}`} style={{ top: `${y * 100}%`, left: `${JAUGE.x * 100}%`, width: `${JAUGE.d * 100}%` }}>
            {n === 0 ? (
              <img src="/cartes/bw-sym-braquage2.webp" alt="" draggable={false} />
            ) : (
              <svg viewBox="0 0 100 100">
                <text x="50" y="57" textAnchor="middle" dominantBaseline="middle" textLength={String(valeur).length >= 3 ? 86 : undefined} lengthAdjust="spacingAndGlyphs">
                  {n === rate ? '✕' : `×${valeur}`}
                </text>
              </svg>
            )}
            {n === NB && jackpot && n <= acquis && <b className="brq-alveole-jp">{NOMS_JACKPOTS[jackpot]}</b>}
          </span>
        );
      })}
    </div>
  );
}

/** Le panneau du sous-sol atteint : son nom, et le butin du salon (le multiple, multiplicateur de la roue compris). */
function Plaque({ k, M, part }: { k: number; M: number; part: boolean }) {
  const nomSalle = tr(...ETAGES[k - 1]);
  const etiquette = nomSalle.toLocaleUpperCase('fr-FR');
  return (
    <div className={`brq-plaque ${part ? 'part' : ''}`} key={k} role="status">
      <img src={IMG('plaque')} alt="" draggable={false} />
      <span className="brq-plaque-texte">
        {/* Le nom de la salle tient toujours sur la plaque : trop long, il se resserre. */}
        <svg className="brq-plaque-nom" viewBox="0 0 600 60" role="img" aria-label={nomSalle}>
          <text x="300" y="44" textAnchor="middle" {...(etiquette.length > 21 ? { textLength: 590, lengthAdjust: 'spacingAndGlyphs' as const } : {})}>
            {etiquette}
          </text>
        </svg>
        <strong>
          <ValeurMultipliee x={ETAGES_BRAQUAGE[k - 1]} m={M} son rapide />
        </strong>
      </span>
    </div>
  );
}

/** Des éclats d'or qui scintillent sur le butin d'un sous-sol (positions fixes par sous-sol). */
function Scintillements({ k }: { k: number }) {
  const points = useMemo(() => Array.from({ length: 9 }, (_, i) => ({ x: (i * 37 + k * 17) % 86 + 7, y: ((i * 53 + k * 29) % 50) + 38, d: ((i * 0.37 + k * 0.19) % 1.4) + 0.3 })), [k]);
  return (
    <span className="brq-scintille" aria-hidden="true">
      {points.map((p, i) => (
        <i key={i} style={{ left: `${p.x}%`, top: `${p.y}%`, animationDelay: `${p.d}s` } as CSSProperties} />
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Le bonus

export function BonusBraquage({ v, b, nom }: { v: VueBW; b: VueBonusBW; nom: string }) {
  const M = Math.max(1, b.multiplicateur);
  const F = b.casse?.etage ?? null;
  const jackpot = b.casse?.jackpot ?? null;

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
  const t = maintenant - horloge.current.debut;

  const descente = nom === 'descente' && F !== null;
  const donnees = useRef<DonneesScene | null>(null);
  donnees.current = { cle: cleEtape, debut: horloge.current.debut, F, descente };
  const refsScene = useRef<RefsScene | null>(null);
  if (!refsScene.current)
    refsScene.current = {
      scene: nouvelleRef(),
      monde: nouvelleRef(),
      surface: nouvelleRef(),
      salles: Array.from({ length: NB }, () => nouvelleRef<HTMLDivElement>()),
      dalles: Array.from({ length: NB }, () => nouvelleRef<HTMLDivElement>()),
      chaines: [nouvelleRef(), nouvelleRef()],
      machine: nouvelleRef(),
      meche: nouvelleRef(),
      etincelles: nouvelleRef(),
      chaleur: nouvelleRef(),
      debris: nouvelleRef(),
      poussieres: [nouvelleRef(), nouvelleRef(), nouvelleRef()],
      gendarmes: nouvelleRef(),
      sirene: nouvelleRef(),
      siecle: nouvelleRef(),
      roc: nouvelleRef(),
    };
  const refs = refsScene.current;
  useSceneCasse(donnees, refs);

  // Où en est le casse.
  const Fe = F ?? NB;
  const acquis = descente ? [1, 2, 3, 4, 5].filter((k) => k <= Fe && t >= perceeCasseBW(k) + CASSE_BW.acquis).length : nom === 'revele' ? Fe : 0;
  const ta = descente && Fe < NB ? alarmeA(Fe) : Number.POSITIVE_INFINITY;
  const alarme = descente && t >= ta;
  const fuite = alarme && t >= ta + ALARME.fuite;
  const meulee = descente ? dalleMeulee(t, Fe) : -1;
  const tb5 = percee(NB - 1);
  const siecle = descente && Fe >= NB && t >= tb5;
  const ts = t - tb5;
  /** La profondeur (en sous-sols, de 0 à 5) pour le tube de la jauge. */
  const niveau = (() => {
    if (!descente) return nom === 'revele' ? Fe : 0;
    let n = 0;
    for (let k = 0; k < NB; k++) {
      if (k >= Fe && Fe < NB) break;
      if (t >= percee(k)) n = k + 1;
      else if (t >= meule(k)) n = k + 0.6 * ((t - meule(k)) / GRIND);
    }
    return n;
  })();
  const total = ETAGES_BRAQUAGE[Fe - 1] * M + (jackpot ? VALEUR_JACKPOT_BW[jackpot] : 0);

  // Les sons du casse.
  const joues = useRef(new Set<string>());
  // La fin se joue sur deux étapes (la révélation, puis les résultats) : ses sons ne se jouent qu'une fois.
  const cleSon = nom === 'revele' ? `${v.numero}-revele` : cleEtape;
  useEffect(() => {
    const fois = (cle: string, f: () => void) => {
      const c = `${cleSon}-${cle}`;
      if (joues.current.has(c)) return;
      joues.current.add(c);
      f();
    };
    if (v.phase !== 'bonus' && nom !== 'revele') return;
    if (nom === 'intro' && v.phase === 'bonus' && t > 200) fois('intro', () => jouerEffet('bw_coffre', { volume: 0.6, vitesse: 0.85 }));
    // Chaque son a sa fenêtre : un téléphone qui revient d'un autre onglet ne les joue pas tous d'un coup.
    const entre = (debut: number, marge: number) => t >= debut && t < debut + marge;
    if (descente) {
      if (entre(0, 1500)) fois('moteur', () => jouerEffet('br_moteur'));
      for (let k = 0; k < NB; k++) {
        if (k > Fe) break;
        // La dalle de l'alarme : la mèche cale vite (le court crissement) ; une dalle percée : le long, qui monte.
        const calee = Fe < NB && k === Fe;
        if (entre(meule(k), 500)) fois(`meule${k}`, () => jouerEffet(calee ? 'br_meule' : 'br_meule_long', { vitesse: 0.96 + k * 0.04 }));
        if (calee) break;
        if (entre(percee(k), 600)) fois(`percee${k}`, () => jouerEffet('br_percee', { vitesse: 1.05 - k * 0.05 }));
        // La perceuse redescend dans le sous-sol percé : son moteur reprend jusqu'à la dalle suivante.
        if (k < NB - 1 && entre(percee(k) + 300, 700)) fois(`moteur${k}`, () => jouerEffet('br_moteur', { volume: 0.45, vitesse: 1 + k * 0.04 }));
      }
      if (alarme) {
        if (entre(ta, 1500)) fois('alarme', () => jouerEffet('br_alarme'));
        if (entre(ta + ALARME.gendarmes, 1500)) fois('sifflet', () => jouerEffet('br_sifflet'));
        if (entre(ta + ALARME.fuite, 1500)) fois('fuite', () => jouerEffet('bw_sirene', { volume: 0.8 }));
      }
      if (siecle) {
        if (entre(tb5 + SIECLE.porte, 1000)) fois('cadran', () => jouerEffet('bw_cadran'));
        if (entre(tb5 + SIECLE.ouvre, 1000)) fois('porte', () => jouerEffet('bw_coffre'));
        if (entre(tb5 + SIECLE.tresor, 1500)) fois('tresor', () => jouerEffet('lingots_pluie'));
        if (entre(tb5 + SIECLE.jackpot, 2500)) fois('jackpot', () => jouerEffet('bw_jackpot'));
      }
    }
    if (nom === 'revele') fois('evade', () => jouerEffet('bw_evade'));
  });

  // L'annonce du moment.
  let annonce: { titre: string; sous?: string; ton?: string } | null = null;
  if (descente) {
    if (t < meule(0) + 600) annonce = { titre: tr('Le casse commence !', 'The heist begins!'), sous: tr('Une seule perceuse pour tout le salon', 'One drill for the whole room'), ton: 'bas' };
    else if (alarme && !fuite) annonce = { titre: tr('ALERTE !', 'ALARM!'), sous: tr('Les gendarmes déboulent…', 'The police burst in…'), ton: 'alarme' };
  }

  const salleVue = (k: number) => descente && (k <= acquis + 1 || alarme);
  const etatSiecle = !siecle || ts < SIECLE.porte ? 'attend' : ts < SIECLE.ouvre ? 'ferme' : 'ouvert';

  return (
    <div className={`brq ${nom} ${alarme ? 'alarme' : ''} ${siecle ? 'siecle' : ''}`} ref={refs.scene}>
      {/* La banque en coupe : la rue, les dalles, les sous-sols ; la perceuse au milieu. */}
      <div className={`brq-monde ${descente ? '' : 'cache'}`} ref={refs.monde} aria-hidden="true">
        <div className="brq-surface" ref={refs.surface} style={{ backgroundImage: `url(${IMG('surface')})` }} />
        <div className="brq-roc" ref={refs.roc} style={{ backgroundImage: `url(${IMG('dalle')})` }} />
        {refs.salles.map((r, i) => (
          <div key={`s${i}`} className={`brq-salle ${i + 1 <= acquis ? 'acquise' : ''}`} ref={r} style={{ backgroundImage: `url(${IMG(`etage-${i + 1}`)})` }}>
            {salleVue(i + 1) && i + 1 <= acquis && <Scintillements k={i + 1} />}
          </div>
        ))}
        {/* Le Coffre du Siècle : sa porte recouvre la porte peinte ; elle tremble, s'ouvre sur l'or, le jackpot jaillit. */}
        <div className={`brq-siecle ${etatSiecle}`} ref={refs.siecle}>
          <i className="brq-siecle-rayons" />
          <i className="brq-siecle-lumiere" />
          <img className="brq-porte" src={IMG('porte')} alt="" draggable={false} />
          {siecle && ts >= SIECLE.tresor && (
            <span className="brq-tresor">
              <img src={IMG('couronne')} alt="" className="couronne" draggable={false} />
              {[0, 1, 2, 3, 4].map((k) => (
                <img key={k} src={IMG('diamant')} alt="" className="diamant" style={{ '--k': k, '--dx': DIAMANTS[k][0], '--dy': DIAMANTS[k][1] } as CSSProperties} draggable={false} />
              ))}
            </span>
          )}
        </div>
        {refs.chaines.map((r, i) => (
          <div key={`c${i}`} className="brq-chaine" ref={r} style={{ backgroundImage: `url(${IMG('chaine')})` }} />
        ))}
        <div className={`brq-meche ${meulee >= 0 ? 'meule' : ''}`} ref={refs.meche} style={{ backgroundImage: `url(${IMG('meche')})` }} />
        <img className="brq-machine" ref={refs.machine} src={IMG('perceuse')} alt="" draggable={false} />
        {refs.dalles.map((r, k) => (
          <div key={`d${k}`} className="brq-dalle" ref={r} />
        ))}
        {refs.poussieres.map((r, i) => (
          <div key={`p${i}`} className="brq-poussiere" ref={r} />
        ))}
        <img className="brq-debris" ref={refs.debris} src={IMG('debris2')} alt="" draggable={false} />
        <div className="brq-chaleur" ref={refs.chaleur} />
        <img className="brq-etincelles" ref={refs.etincelles} src={IMG('etincelles')} alt="" draggable={false} />
        <img className={`brq-sirene ${alarme ? 'sonne' : ''}`} ref={refs.sirene} src={IMG('sirene')} alt="" draggable={false} />
        <img className="brq-gendarmes" ref={refs.gendarmes} src={IMG('gendarmes')} alt="" draggable={false} />
      </div>

      {/* Les éclairs de la percée, la lumière rouge de l'alarme. */}
      {descente &&
        [0, 1, 2, 3, 4].map((k) => (k < Fe && t >= percee(k) && t < percee(k) + 500 ? <div key={`f${k}`} className="brq-flash" aria-hidden="true" /> : null))}
      {alarme && <div className="brq-rouge" aria-hidden="true" />}

      {nom === 'intro' && (
        <div className="brq-intro">
          <div className="brq-affiche">
            <img src={IMG('affiche')} alt="" draggable={false} />
            <svg className="brq-affiche-titre" viewBox="0 0 1000 140" role="img" aria-label={tr('Le Braquage', 'The Big Heist')}>
              <text x="500" y="84" textAnchor="middle" dominantBaseline="middle" textLength="760" lengthAdjust="spacingAndGlyphs">
                {tr('LE BRAQUAGE', 'THE BIG HEIST')}
              </text>
            </svg>
            <i className="brq-affiche-reflet" />
            {M > 1 && (
              <span className="brq-multi" role="status">
                <small>{tr('Multiplicateur de la roue', 'Wheel multiplier')}</small>
                <strong>×{M}</strong>
              </span>
            )}
          </div>
          <div className="brq-infos">
          <div className="brq-accroche">
            <strong>{tr('Une seule perceuse pour tout le salon', 'One drill for the whole room')}</strong>
            <span>{tr('Plus elle descend, plus le butin grossit… jusqu’à l’alarme !', 'The deeper it goes, the bigger the loot… until the alarm!')}</span>
          </div>
          <ol className="brq-echelle" aria-label={tr('Les sous-sols', 'The basements')}>
            {ETAGES.map((n, k) => (
              <li key={k} style={{ '--k': k } as CSSProperties} className={k === NB - 1 ? 'siecle' : ''}>
                <small>
                  {k === NB - 1 ? (
                    <>
                      <span className="long">{tr('Coffre du Siècle', 'Vault of the Century')}</span>
                      <span className="court">{tr('Sous-sol 5', 'Basement 5')}</span>
                    </>
                  ) : (
                    tr(`Sous-sol ${k + 1}`, `Basement ${k + 1}`)
                  )}
                </small>
                <b>
                  <ValeurMultipliee x={ETAGES_BRAQUAGE[k]} m={M} />
                </b>
                {k === NB - 1 && <em>+ JACKPOT</em>}
                <span className="brq-echelle-nom">{tr(...n)}</span>
              </li>
            ))}
          </ol>
          </div>
        </div>
      )}

      {descente && (
        <Jauge
          M={M}
          acquis={acquis}
          perce={meulee >= 0 ? meulee + 1 : -1}
          rate={alarme ? Fe + 1 : -1}
          niveau={niveau}
          jackpot={siecle && ts >= SIECLE.jackpot ? jackpot : null}
        />
      )}
      {descente && acquis > 0 && !fuite && <Plaque k={acquis} M={M} part={siecle && ts >= SIECLE.tresor} />}

      {annonce && (
        <div className={`brq-annonce ${annonce.ton ?? ''}`} key={annonce.titre} role="status">
          <strong>{annonce.titre}</strong>
          {annonce.sous && <span>{annonce.sous}</span>}
        </div>
      )}

      {/* L'alarme : la bande hissée par le trou, avec le butin. */}
      {fuite && (
        <div className="brq-fuite" role="status">
          <div className="brq-fuite-cadre">
            <img src={IMG('fuite')} alt="" draggable={false} />
          </div>
          <p>
            <strong>{tr('La bande file avec le butin !', 'The gang escapes with the loot!')}</strong>
            <span>
              {tr(`Sous-sol ${Fe} · `, `Basement ${Fe} · `)}
              <b>{fx(ETAGES_BRAQUAGE[Fe - 1] * M)}</b>
              {tr(' pour tout le salon', ' for the whole room')}
            </span>
          </p>
        </div>
      )}

      {/* Le Coffre du Siècle ouvert : la salle s'assombrit autour de la porte, l'or pleut. */}
      {siecle && ts >= SIECLE.ouvre && <div className="brq-voile" aria-hidden="true" />}
      {siecle && ts >= SIECLE.tresor && <PluieLingots n={22} />}
      {siecle && jackpot && ts >= SIECLE.jackpot && (
        <div className="brq-jackpot" role="status">
          <span className="brq-jackpot-plaque">
            <img src={`/cartes/bw-plaque-${jackpot}.webp`} alt="" draggable={false} />
            <b>{NOMS_JACKPOTS[jackpot]}</b>
          </span>
          <strong>
            {fx(ETAGES_BRAQUAGE[NB - 1] * M)} + {fx(VALEUR_JACKPOT_BW[jackpot])}
          </strong>
          <small>{tr('Le Coffre du Siècle cachait le jackpot !', 'The Vault of the Century hid the jackpot!')}</small>
        </div>
      )}

      {/* La fin : la voiture de la bande file dans Paris. */}
      {nom === 'revele' && F !== null && (
        <div className="brq-fin">
          <div className="brq-fin-image" style={{ backgroundImage: `url(${IMG('evade')})` }} />
          <div className="brq-fin-butin" role="status">
            <small>{F >= NB ? tr('Le casse du siècle !', 'The heist of the century!') : tr('La bande s’est fait la belle !', 'The gang got away!')}</small>
            <strong>{fx(total)}</strong>
            <span>
              {tr(`Sous-sol ${F} : ${fx(ETAGES_BRAQUAGE[F - 1])}`, `Basement ${F}: ${fx(ETAGES_BRAQUAGE[F - 1])}`)}
              {M > 1 ? tr(` · roue ×${M}`, ` · wheel ×${M}`) : ''}
              {jackpot ? ` · JACKPOT ${NOMS_JACKPOTS[jackpot]} ${fx(VALEUR_JACKPOT_BW[jackpot])}` : ''}
            </span>
          </div>
          <PluieLingots n={22} objets={['billet', 'billet', 'lingot']} />
        </div>
      )}
    </div>
  );
}
