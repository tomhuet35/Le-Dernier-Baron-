/**
 * L'Express du Baron (The Baron's Wheel) : la case unique de la roue. Le Baron braque le train de nuit Paris → Istanbul ;
 * chaque joueur choisit son wagon, et « il n'en restera qu'un ».
 *
 * Le serveur a tout tiré dès le début du bonus (butins de Paris et de Venise, wagons décrochés à chaque embuscade,
 * Coffre du Baron) et ne le révèle qu'au fil du voyage. Cet écran met le voyage en scène :
 * - l'affiche et le Baron, puis le chef de train qui fait choisir les wagons ;
 * - Paris (gare : un coffre sur chaque toit), les Alpes sous la neige (la police à cheval dévie deux wagons sur une voie
 *   de garage), Venise (gare : les coffres de Venise), les Balkans sous l'orage (seconde embuscade), Istanbul (terminus :
 *   le Coffre du Baron s'ouvre pour le seul wagon arrivé) ;
 * - le décor (une peinture par étape, qui défile lentement), la voie (qui raccorde sans couture, au pas du train), le
 *   train, la fumée et les gendarmes sont placés à chaque image par une boucle requestAnimationFrame, sans React ;
 * - entre deux décors, le train passe un tunnel (l'obscurité monte, les lampes défilent) ;
 * - les coffres, les annonces, la météo, les éclairs, les gyrophares, le « CLAC » et les sons suivent l'horloge de
 *   l'étape (10 fois par seconde).
 * Chaque gain s'affiche d'abord tel quel, puis le jeton ×M de la roue plonge dedans et le nombre grimpe jusqu'au total.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { NB_WAGONS, type VueBonusBW, type VueBW } from '../../shared/baronWheel';
import { dollars, PluieLingots } from './casinoOutils';
import { EN, tr } from './traduction';
import { jouerEffet, mouvementReduit } from './ui';
import './baronExpress.css';

/** Pas de « ! » seul en début de ligne. */
const insecable = (t: string) => t.replace(/ ([!?:;])/g, ' $1');
export const fx = (x: number) => `×${x.toLocaleString(EN ? 'en-US' : 'fr-FR', { maximumFractionDigits: 2 })}`;

/** Les cinq wagons : nom et couleurs (celles du tableau et des plaques). */
export const WAGONS_EXPRESS: { nom: [string, string]; couleur: string; texte: string }[] = [
  { nom: ['Émeraude', 'Emerald'], couleur: '#17573a', texte: '#fff1c4' },
  { nom: ['Bordeaux', 'Burgundy'], couleur: '#7a1c2e', texte: '#fff1c4' },
  { nom: ['Saphir', 'Sapphire'], couleur: '#1b2c58', texte: '#fff1c4' },
  { nom: ['Ivoire', 'Ivory'], couleur: '#efe3c8', texte: '#3a1810' },
  { nom: ['Or', 'Gold'], couleur: '#d9aa33', texte: '#2a1704' },
];
const nomWagon = (k: number) => tr(...WAGONS_EXPRESS[k].nom);

// ---------------------------------------------------------------------------------------------------------------
// Les images et leurs mesures

type Decor = 'paris' | 'alpes' | 'venise' | 'balkans' | 'istanbul';
const IMG = (n: string) => `/cartes/bw-ex2-${n}.webp`;
/** Toutes les images de l'Express (sans chemin ni extension), préchargées avant le bonus. */
export const IMAGES_EXPRESS_NOMS = [
  'bw-ex-gare-depart',
  ...['affiche', 'baron', 'chef', 'loco', 'terminus'].map((n) => `bw-ex2-${n}`),
  ...[1, 2, 3, 4, 5].map((k) => `bw-ex2-wagon-${k}`),
  ...(['paris', 'alpes', 'venise', 'balkans', 'istanbul'] as Decor[]).flatMap((d) => [`bw-ex2-${d}`, `bw-ex2-${d}-voie`]),
  'bw-ex-coffre',
  'bw-ex-coffre-ouvert',
  'bw-ex-gendarme',
  ...[1, 2, 3, 4, 5, 6].map((k) => `bw-ex-fumee-${k}`),
];

/** Chaque étape du voyage a son décor. */
const DECOR_ETAPE: Partial<Record<string, Decor>> = { paris: 'paris', tunnel1: 'alpes', venise: 'venise', tunnel2: 'balkans', istanbul: 'istanbul', revele: 'istanbul' };
/**
 * Les décors (2172 × 724) : la voie commence à la rangée `haut` (sa bande se répète tous les `tuile` pixels) ; le rail
 * est à la rangée 652. Sous le décor, la bande de la voie se prolonge de 72 rangées de ballast qui se perd dans l'ombre.
 */
const DECOR = { w: 2172, h: 724, rail: 652, ballast: 72 };
const GEO: Record<Decor, { haut: number; tuile: number }> = {
  paris: { haut: 599, tuile: 1943 },
  alpes: { haut: 610, tuile: 1935 },
  venise: { haut: 607, tuile: 1939 },
  balkans: { haut: 605, tuile: 1907 },
  istanbul: { haut: 600, tuile: 1917 },
};
/** Ce qu'on montre au centre quand le train est arrêté (part de la largeur du décor). */
const REPERE: Record<Decor, number> = { paris: 0.505, alpes: 0.5, venise: 0.43, balkans: 0.6, istanbul: 0.6 };
const LOCO = { w: 1100, h: 338, cheminee: 0.786 };
const WAGON = { w: 1100, h: 344 };
const GENDARME = { w: 683, h: 440 };
const GARES: Record<string, { ville: [string, string]; gare: string }> = {
  paris: { ville: ['PARIS', 'PARIS'], gare: 'Gare de l’Est' },
  venise: { ville: ['VENISE', 'VENICE'], gare: 'Santa Lucia' },
  istanbul: { ville: ['ISTANBUL', 'ISTANBUL'], gare: 'Sirkeci' },
};

// ---------------------------------------------------------------------------------------------------------------
// Le calendrier de chaque étape (millisecondes depuis le début de l'étape)

/** Le train repart 2,2 s avant la fin d'une gare et met 2,4 s à prendre sa vitesse. */
const DEPART = 2200;
const ACCEL = 2400;
const FREIN: Record<string, number> = { venise: 2600, istanbul: 3200 };
/** Les coffres d'une gare : début de la série, et le temps laissé pour lire les butins avant le départ. */
const COFFRES: Record<'paris' | 'venise', number> = { paris: 900, venise: 3100 };
const LECTURE = 900;
/** L'embuscade : la police apparaît, puis chaque wagon visé est dévié (« CLAC ») l'un après l'autre. */
const EMBUSCADE = { alerte: 2300, captures: [5200, 8400], approche: 2700, deviation: 3200, fin: 1500 };
const instantCapture = (i: number) => EMBUSCADE.captures[i] ?? EMBUSCADE.captures[0] + i * 3200;
/** Istanbul : le panneau Terminus, le Coffre du Baron qui arrive et tremble, qui s'ouvre, puis son butin qui monte. */
const ISTANBUL = { terminus: 3300, coffre: 5000, ouverture: 6700, compte: 1900 };
/** Entre deux décors, le train passe un tunnel : l'obscurité monte, les lampes défilent, puis le nouveau décor apparaît. */
const TUNNEL = { duree: 1900, sortie: 1000 };
/** Les éclairs de l'orage des Balkans (deux tombent juste avant les « CLAC »). */
const ECLAIRS = [700, 3400, 5100, 8300, 10_700];

const lisse = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const estEmbuscade = (nom: string) => nom === 'tunnel1' || nom === 'tunnel2';
const tunnelDe = (nom: string) => (nom === 'tunnel1' ? 0 : nom === 'tunnel2' ? 1 : -1);
const estArret = (nom: string) => nom === 'paris' || nom === 'venise' || nom === 'istanbul' || nom === 'revele';

/** Vitesse du train (part de la vitesse de croisière) à l'instant τ de l'étape. */
function allure(nom: string, tau: number, D: number): number {
  const repart = lisse((tau - (D - DEPART)) / ACCEL);
  switch (nom) {
    case 'paris':
      return repart;
    case 'tunnel1':
    case 'tunnel2':
      return 1;
    case 'venise':
      return tau < FREIN.venise ? 1 - tau / FREIN.venise : repart;
    case 'istanbul':
      return tau < FREIN.istanbul ? 1 - tau / FREIN.istanbul : 0;
    default:
      return 0;
  }
}
/** Le chemin parcouru depuis le début de l'étape (en durée × vitesse de croisière), calculé exactement. */
function parcours(nom: string, tau: number, D: number): number {
  const t = Math.max(0, tau);
  // Le départ : ∫ lisse = ACCEL × (x³ − x⁴/2), puis à pleine vitesse.
  const depart = () => {
    const x = (t - (D - DEPART)) / ACCEL;
    if (x <= 0) return 0;
    return x >= 1 ? ACCEL * 0.5 + (t - (D - DEPART) - ACCEL) : ACCEL * (x ** 3 - x ** 4 / 2);
  };
  const freinage = (F: number) => (t < F ? t - (t * t) / (2 * F) : F / 2);
  switch (nom) {
    case 'paris':
      return depart();
    case 'tunnel1':
    case 'tunnel2':
      return t;
    case 'venise':
      return freinage(FREIN.venise) + depart();
    case 'istanbul':
      return freinage(FREIN.istanbul);
    default:
      return 0;
  }
}
/** Le chemin du freinage : la gare s'arrête pile devant la locomotive. */
const distanceArret = (nom: string) => (FREIN[nom] ?? 0) / 2;

/** L'écart entre deux coffres d'une gare : ils s'ouvrent l'un après l'autre sur toute la durée de l'arrêt. */
function pasCoffres(gare: 'paris' | 'venise', n: number, D: number): number {
  const libre = D - COFFRES[gare] - DEPART - LECTURE;
  return Math.max(500, Math.min(1500, libre / Math.max(1, n)));
}
/** Le coffre se pose sur le toit un peu avant de s'ouvrir. */
const posePour = (pas: number) => Math.min(600, pas * 0.45);

type Express = NonNullable<VueBonusBW['express']>;
/** Les wagons visés par la police dans l'embuscade t, dans l'ordre où elle les dévie (du fond du train vers l'avant). */
function cibles(ex: Express, t: number): number[] {
  const avant = Array.from({ length: NB_WAGONS }, (_, k) => k).filter((k) => ex.decroches[k] === null || (ex.decroches[k] as number) >= t);
  return avant.filter((k) => ex.decroches[k] === t).sort((a, b) => avant.indexOf(b) - avant.indexOf(a));
}

interface EtatVoyage {
  /** Les wagons encore attachés (dans l'ordre derrière la locomotive), déviés à l'instant (et quand), et partis avant. */
  attaches: number[];
  devies: { k: number; t0: number }[];
  partis: number[];
}
function etatVoyage(ex: Express, nom: string, tau: number, ordre: string[]): EtatVoyage {
  const ici = ordre.indexOf(nom);
  const attaches: number[] = [];
  const devies: { k: number; t0: number }[] = [];
  const partis: number[] = [];
  for (let k = 0; k < NB_WAGONS; k++) {
    const d = ex.decroches[k];
    if (d === null) {
      attaches.push(k);
      continue;
    }
    const iTunnel = ordre.indexOf(d === 0 ? 'tunnel1' : 'tunnel2');
    if (ici > iTunnel) {
      partis.push(k);
      continue;
    }
    if (ici === iTunnel) {
      const t0 = instantCapture(Math.max(0, cibles(ex, d).indexOf(k)));
      if (tau >= t0) {
        devies.push({ k, t0 });
        continue;
      }
    }
    attaches.push(k);
  }
  return { attaches, devies, partis };
}

// ---------------------------------------------------------------------------------------------------------------
// Un gain du bonus, multiplicateur de la roue compris

/** Le temps de la transformation : le jeton ×M se pose, plonge dans le nombre, qui grimpe jusqu'au total. */
const MULTI = { pose: 450, compte: 800, duree: 650 };
const MULTI_RAPIDE = { pose: 300, compte: 520, duree: 430 };
const arrondiCompte = (v: number, fin: number) => (Number.isInteger(fin) ? Math.round(v) : Math.round(v * 10) / 10);
type PhaseValeur = 'base' | 'fusion' | 'compte' | 'final';

/**
 * Un gain révélé, multiplicateur de la roue compris : le multiple de base s'affiche (en vert), le jeton ×M de la roue
 * (beige et marron) se pose à côté, plonge dedans, et le nombre grimpe sous nos yeux jusqu'au total (×5 → ×15).
 * Sans multiplicateur, le gain s'affiche simplement.
 */
export function ValeurMultipliee({ x, m, son = false, prefixe = '', rapide = false }: { x: number; m: number; son?: boolean; prefixe?: string; rapide?: boolean }) {
  const direct = m <= 1 || mouvementReduit();
  const [phase, setPhase] = useState<PhaseValeur>(direct ? 'final' : 'base');
  const [vu, setVu] = useState(direct ? x * m : x);
  useEffect(() => {
    if (m <= 1 || mouvementReduit()) {
      setPhase('final');
      setVu(x * m);
      return;
    }
    setPhase('base');
    setVu(x);
    const T = rapide ? MULTI_RAPIDE : MULTI;
    let raf = 0;
    const fusion = window.setTimeout(() => setPhase('fusion'), T.pose);
    const compte = window.setTimeout(() => {
      setPhase('compte');
      if (son) jouerEffet('bw_multi', { volume: 0.5, vitesse: 1.15 });
      const debut = performance.now();
      const pas = () => {
        const u = Math.min(1, (performance.now() - debut) / T.duree);
        setVu(u < 1 ? x + (x * m - x) * (1 - (1 - u) ** 3) : x * m);
        if (u < 1) raf = requestAnimationFrame(pas);
        else setPhase('final');
      };
      raf = requestAnimationFrame(pas);
    }, T.compte);
    return () => {
      window.clearTimeout(fusion);
      window.clearTimeout(compte);
      cancelAnimationFrame(raf);
    };
  }, [x, m, son, rapide]);
  return (
    <span className={`bw-valeur ${m > 1 ? `multi ${phase}` : ''} ${rapide ? 'rapide' : ''}`} style={{ '--n': (prefixe + fx(x * m)).length } as CSSProperties}>
      {prefixe + fx(phase === 'final' ? vu : arrondiCompte(vu, x * m))}
      {(phase === 'base' || phase === 'fusion') && <i className="bw-valeur-jeton">×{m}</i>}
    </span>
  );
}

/**
 * Un total (multiplicateur de la roue déjà compris) qui grimpe jusqu'à sa nouvelle valeur, au moment où le gain
 * qui l'augmente finit sa propre transformation.
 */
function Compteur({ valeur, retard = MULTI_RAPIDE.compte }: { valeur: number; retard?: number }) {
  const [vu, setVu] = useState(valeur);
  const depuis = useRef(valeur);
  useEffect(() => {
    const de = depuis.current;
    depuis.current = valeur;
    if (de === valeur || mouvementReduit()) {
      setVu(valeur);
      return;
    }
    let raf = 0;
    const t = window.setTimeout(() => {
      const debut = performance.now();
      const pas = () => {
        const u = Math.min(1, (performance.now() - debut) / 900);
        setVu(u < 1 ? arrondiCompte(de + (valeur - de) * (1 - (1 - u) ** 3), valeur) : valeur);
        if (u < 1) raf = requestAnimationFrame(pas);
      };
      raf = requestAnimationFrame(pas);
    }, retard);
    return () => {
      window.clearTimeout(t);
      cancelAnimationFrame(raf);
    };
  }, [valeur, retard]);
  if (!vu) return <>—</>;
  return (
    <span className={`bw-valeur total ${vu !== valeur ? 'compte' : ''}`} style={{ '--n': fx(valeur).length } as CSSProperties}>
      {fx(vu)}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// La scène animée (boucle requestAnimationFrame)

interface DonneesScene {
  b: VueBonusBW;
  nom: string;
  /** L'identité de l'étape (manche, étape, phase) : stable, contrairement à son début recalé. */
  cle: string;
  debut: number;
  duree: number;
  focus: number;
  ordre: string[];
  decor: Decor | null;
  couches: (Decor | null)[];
  actif: number;
}

interface RefsScene {
  scene: RefObject<HTMLDivElement>;
  fonds: RefObject<HTMLDivElement>[];
  voies: RefObject<HTMLDivElement>[];
  panneau: RefObject<HTMLDivElement>;
  loco: RefObject<HTMLDivElement>;
  wagons: RefObject<HTMLDivElement>[];
  fumees: RefObject<HTMLImageElement>[];
  gendarmes: RefObject<HTMLImageElement>[];
  garage: RefObject<HTMLDivElement>;
}

function useSceneTrain(donnees: { current: DonneesScene | null }, refs: RefsScene) {
  useEffect(() => {
    const scene = refs.scene.current;
    if (!scene) return;
    const g = { W: 0, H: 0, portrait: false, P: 0, hW: 0, wL: 0, hL: 0, step: 0, yRail: 0, Hd: 0, Wd: 0, ech: 0, vmax: 0, xL: 0, gH: 0, gW: 0, version: 0 };
    const mesurer = () => {
      const W = scene.clientWidth;
      const H = scene.clientHeight;
      if (!W || !H) return;
      g.W = W;
      g.H = H;
      // En hauteur (téléphone), un wagon occupe les trois quarts de l'écran ; en largeur, un bon tiers.
      g.portrait = H > W * 1.05;
      g.P = g.portrait ? W * 0.74 : Math.min(W * 0.36, H * 0.6);
      g.hW = (g.P * WAGON.h) / WAGON.w;
      g.wL = (g.P * LOCO.w) / WAGON.w;
      g.hL = (g.wL * LOCO.h) / LOCO.w;
      g.step = g.P * 0.985;
      g.yRail = H * (g.portrait ? 0.85 : 0.86);
      g.Hd = (g.yRail * DECOR.h) / DECOR.rail;
      g.ech = g.Hd / DECOR.h;
      g.Wd = g.Hd * (DECOR.w / DECOR.h);
      g.vmax = (g.P * 1.1) / 1000;
      g.xL = -g.wL;
      g.gH = g.hW * 1.32;
      g.gW = (g.gH * GENDARME.w) / GENDARME.h;
      g.version++;
      scene.style.setProperty('--p', `${g.P}px`);
      scene.style.setProperty('--hw', `${g.hW}px`);
      if (refs.loco.current) {
        refs.loco.current.style.width = `${g.wL}px`;
        refs.loco.current.style.height = `${g.hL}px`;
      }
      for (const r of refs.wagons) {
        if (!r.current) continue;
        r.current.style.width = `${g.P}px`;
        r.current.style.height = `${g.hW}px`;
      }
      for (const r of refs.gendarmes) if (r.current) r.current.style.width = `${g.gW}px`;
      for (const r of refs.fumees) if (r.current) r.current.style.width = `${g.P * 0.42}px`;
      st.reperes = '';
    };

    const st = {
      off: 0,
      off0: 0,
      C: Number.NaN,
      Cs: 0,
      cle: '',
      reperes: '',
      base: 0,
      k: 0,
      sArret: 0,
      bgX: 0,
      decor: null as Decor | null,
      x: Array<number>(NB_WAGONS).fill(Number.NaN),
      chute: Array<number>(NB_WAGONS).fill(Number.NaN),
      dernier: performance.now(),
      prochaineFumee: 0,
      fumees: [] as { t0: number; x0: number; vx: number; n: number; el: number }[],
      prochainEl: 0,
    };
    mesurer();
    const ro = new ResizeObserver(mesurer);
    ro.observe(scene);

    const slotX = (s: number) => g.xL - (s + 1) * g.step;
    /** Une seule fois par élément et par mesure : la taille d'une couche (décor ou voie). */
    const dimensionner = (el: HTMLElement, cle: string, f: () => void) => {
      const c = `${cle}-${g.version}`;
      if (el.dataset.t === c) return;
      el.dataset.t = c;
      f();
    };
    let raf = 0;
    const image = () => {
      raf = requestAnimationFrame(image);
      const d = donnees.current;
      const maintenant = performance.now();
      const dt = Math.min(64, maintenant - st.dernier);
      st.dernier = maintenant;
      if (!d || !g.W || !d.b.express || !d.decor) return;
      const ex = d.b.express;
      const nom = d.nom;
      const D = d.duree;
      const tau = maintenant - d.debut;
      const decor = d.decor;
      const reduit = mouvementReduit();

      // Une nouvelle étape : le chemin repart de là où on en est ; le décor se recale (même décor : il reste en place).
      const cle = d.cle;
      if (cle !== st.cle) {
        const memeDecor = st.cle !== '' && st.decor === decor;
        st.cle = cle;
        st.off0 = st.off;
        st.Cs = Number.isNaN(st.C) ? 0 : st.C;
        st.chute.fill(Number.NaN);
        st.reperes = memeDecor ? 'garder' : '';
        st.decor = decor;
      }
      if (st.reperes !== `${cle}-${g.version}`) {
        const marge = Math.max(0, g.Wd - g.W);
        if (st.reperes === 'garder') {
          st.base = st.bgX;
          st.k = 0;
          st.sArret = 0;
          st.Cs = Number.isNaN(st.C) ? 0 : st.C;
        } else if (estEmbuscade(nom)) {
          // Toute l'embuscade traverse le décor, de sa gauche à sa droite.
          st.base = -0.04 * marge;
          st.k = (0.92 * marge) / Math.max(1, g.vmax * D);
          st.sArret = 0;
        } else {
          st.base = g.W / 2 - REPERE[decor] * g.Wd;
          st.k = 0.16;
          st.sArret = g.vmax * distanceArret(nom);
        }
        st.reperes = `${cle}-${g.version}`;
      }
      const v = allure(nom, tau, D) * g.vmax;
      const s = g.vmax * parcours(nom, tau, D);
      st.off = st.off0 + s;

      // Qui est attaché, et où : les wagons restants se resserrent derrière la locomotive.
      const etat = etatVoyage(ex, nom, tau, d.ordre);
      etat.attaches.forEach((k, rang) => {
        const cible = slotX(rang);
        st.x[k] = Number.isNaN(st.x[k]) ? cible : st.x[k] + (cible - st.x[k]) * (1 - Math.exp(-dt * 0.0026));
      });
      const devie: Record<number, { dy: number; sc: number; rot: number; fini: boolean }> = {};
      const acc = (2 * (g.W + 2 * g.P)) / EMBUSCADE.deviation ** 2;
      for (const { k, t0 } of etat.devies) {
        const u = tau - t0;
        if (Number.isNaN(st.chute[k])) st.chute[k] = Number.isNaN(st.x[k]) ? slotX(etat.attaches.length) : st.x[k];
        // Dévié sur la voie de garage : il descend vers nous, freine et s'éloigne vers l'arrière.
        st.x[k] = st.chute[k] - 0.5 * acc * u * u;
        const w = lisse(u / 700);
        devie[k] = { dy: g.hW * 0.36 * w, sc: 1 + 0.06 * w, rot: -2.2 * Math.sin(Math.PI * Math.min(1, u / 700)), fini: u > EMBUSCADE.deviation };
      }

      // La caméra : elle suit mon wagon, glisse le long du train pendant les coffres, suit la police pendant l'embuscade.
      const centre = (k: number) => st.x[k] + g.P / 2;
      const centreLoco = g.xL + g.wL / 2;
      const att = etat.attaches;
      const focus = att.includes(d.focus) ? d.focus : -1;
      let cibleC = focus >= 0 ? centre(focus) : att.length ? centre(att[Math.floor((att.length - 1) / 2)]) : centreLoco;
      let rapide = false;
      if (nom === 'paris' || nom === 'venise') {
        const n = att.length;
        const pas = pasCoffres(nom, n, D);
        const t0 = COFFRES[nom];
        // La caméra se pose sur chaque wagon le temps de son coffre (il s'ouvre à t0 + pas × (rang + 1)), et file au
        // suivant un peu avant qu'il ne s'ouvre.
        if (n && tau < t0 + pas * (n + 0.6)) {
          const r = Math.floor((tau - t0 + 60 + 450) / pas) - 1;
          cibleC = r < 0 ? centreLoco : centre(att[Math.min(n - 1, r)]);
          rapide = true;
        }
      } else if (estEmbuscade(nom)) {
        const cs = cibles(ex, tunnelDe(nom));
        if (cs.length && tau >= instantCapture(0) - EMBUSCADE.approche && tau < instantCapture(cs.length - 1) + EMBUSCADE.fin) {
          let i = 0;
          while (i + 1 < cs.length && tau >= instantCapture(i) + 1300) i++;
          const k = cs[i];
          // Pendant que le wagon dévié s'éloigne, la caméra reste là où il a été décroché.
          cibleC = (Number.isNaN(st.chute[k]) ? st.x[k] : st.chute[k]) + g.P / 2;
        }
      } else if (nom === 'istanbul' || nom === 'revele') {
        const gk = ex.gagnant ?? att[0];
        const cg = gk !== undefined && gk !== null && !Number.isNaN(st.x[gk]) ? centre(gk) : centreLoco;
        // En largeur, le wagon gagnant à gauche et le Coffre du Baron à droite.
        cibleC = g.portrait ? cg : cg + g.W * 0.17;
      }
      if (Number.isNaN(cibleC)) cibleC = centreLoco;
      st.C = Number.isNaN(st.C) ? cibleC : st.C + (cibleC - st.C) * (1 - Math.exp(-dt * (rapide ? 0.005 : 0.0022)));
      const C = st.C;
      const ecran = (wx: number) => g.W / 2 + (wx - C);

      // Le décor : il glisse lentement (parallaxe) ; la voie défile au pas du train et raccorde sans couture.
      st.bgX = Math.min(0, Math.max(g.W - g.Wd, st.base - st.k * (s - st.sArret) - 0.12 * (C - st.Cs)));
      d.couches.forEach((dc, i) => {
        if (!dc) return;
        const fond = refs.fonds[i]?.current;
        const voie = refs.voies[i]?.current;
        if (fond) {
          dimensionner(fond, dc, () => {
            fond.style.width = `${g.Wd}px`;
            fond.style.height = `${g.Hd}px`;
          });
          if (i === d.actif) fond.style.transform = `translate3d(${st.bgX}px, 0, 0)`;
        }
        if (voie) {
          const hautV = g.ech * GEO[dc].haut;
          dimensionner(voie, dc, () => {
            voie.style.top = `${hautV}px`;
            voie.style.height = `${g.H - hautV + 2}px`;
            voie.style.backgroundSize = `auto ${g.ech * (DECOR.h - GEO[dc].haut + DECOR.ballast)}px`;
          });
          const tuile = GEO[dc].tuile * g.ech;
          const u0 = st.off + C - g.W / 2;
          voie.style.backgroundPosition = `${-(((u0 % tuile) + tuile) % tuile)}px 0`;
        }
      });

      // Le panneau de la gare : il arrive avec le décor, s'arrête au-dessus de la locomotive, repart.
      const panneau = refs.panneau.current;
      if (panneau) {
        const xs = centreLoco + (st.sArret - s);
        panneau.style.transform = `translate3d(${ecran(xs) - panneau.offsetWidth / 2}px, ${g.yRail - g.hL * 0.12 - panneau.offsetHeight}px, 0)`;
      }

      // Le train : la locomotive et les wagons (un petit roulis quand il roule).
      const bouge = v > 0.01 && !reduit;
      const roulis = (k: number) => (bouge ? Math.sin(maintenant * 0.024 + k * 1.9) * 1.1 : 0);
      if (refs.loco.current) refs.loco.current.style.transform = `translate3d(${ecran(g.xL)}px, ${g.yRail - g.hL + 2 + roulis(9)}px, 0)`;
      refs.wagons.forEach((r, k) => {
        const el = r.current;
        if (!el) return;
        const dv = devie[k];
        const cache = etat.partis.includes(k) || Number.isNaN(st.x[k]) || (dv?.fini ?? false);
        el.style.visibility = cache ? 'hidden' : 'visible';
        if (cache) return;
        el.style.zIndex = dv ? '4' : '';
        el.style.transform = dv
          ? `translate3d(${ecran(st.x[k])}px, ${g.yRail - g.hW + 2 + dv.dy}px, 0) scale(${dv.sc}) rotate(${dv.rot}deg)`
          : `translate3d(${ecran(st.x[k])}px, ${g.yRail - g.hW + 2 + roulis(k)}px, 0)`;
      });

      // La voie de garage : elle apparaît quand on actionne l'aiguillage, le temps que le wagon dévié s'en aille.
      const garage = refs.garage.current;
      if (garage) {
        let o = 0;
        if (estEmbuscade(nom))
          cibles(ex, tunnelDe(nom)).forEach((_, i) => {
            const t0 = instantCapture(i);
            o = Math.max(o, Math.min(lisse((tau - (t0 - 450)) / 350), 1 - lisse((tau - (t0 + EMBUSCADE.deviation - 400)) / 400)));
          });
        garage.style.opacity = String(o);
        garage.style.transform = `translate3d(0, ${g.yRail + g.hW * 0.36 - 1}px, 0)`;
      }

      // La fumée de la locomotive : des bouffées qui grossissent, montent, restent en arrière et s'effacent.
      const cheminee = g.xL + g.wL * LOCO.cheminee;
      if (maintenant >= st.prochaineFumee && !reduit) {
        st.prochaineFumee = maintenant + (v > 0.2 * g.vmax ? 230 : 640);
        st.fumees.push({ t0: maintenant, x0: cheminee, vx: v * 0.92 + g.vmax * 0.05, n: Math.floor(Math.random() * 6), el: st.prochainEl });
        st.prochainEl = (st.prochainEl + 1) % refs.fumees.length;
        if (st.fumees.length > refs.fumees.length) st.fumees.shift();
      }
      const vie = 2300;
      refs.fumees.forEach((r) => r.current && (r.current.style.opacity = '0'));
      for (const f of st.fumees) {
        const el = refs.fumees[f.el].current;
        const a = maintenant - f.t0;
        if (!el || a > vie) continue;
        const u = a / vie;
        const sc = 0.3 + 1.15 * u;
        const wx = f.x0 - f.vx * a;
        const hy = g.hL * 0.98 + g.hW * 1.5 * u;
        if (el.dataset.n !== String(f.n)) {
          el.dataset.n = String(f.n);
          el.src = `/cartes/bw-ex-fumee-${f.n + 1}.webp`;
        }
        el.style.opacity = String(0.8 * (1 - u) * Math.min(1, a / 140));
        // L'image traîne vers la droite : retournée, la traînée part derrière le train.
        el.style.transform = `translate3d(${ecran(wx) + el.offsetWidth * sc * 0.5}px, ${g.yRail - hy - el.offsetHeight * sc}px, 0) scale(${-sc}, ${sc})`;
      }

      // Les gendarmes à cheval : chacun rattrape son wagon, le dévie, puis l'escorte sur la voie de garage.
      const cs = estEmbuscade(nom) ? cibles(ex, tunnelDe(nom)) : [];
      refs.gendarmes.forEach((r, i) => {
        const el = r.current;
        if (!el) return;
        const k = cs[i];
        const T = instantCapture(i);
        const debutG = T - EMBUSCADE.approche;
        if (k === undefined || tau < debutG || tau > T + EMBUSCADE.deviation || Number.isNaN(st.x[k])) {
          el.style.visibility = 'hidden';
          return;
        }
        el.style.visibility = 'visible';
        // Il galope contre l'arrière du wagon : le « CLAC » (à l'avant) et le tampon (au milieu) restent bien visibles.
        const pres = st.x[k] - g.gW * 0.58;
        const gauche = C - g.W / 2 - g.gW * 1.05;
        const wx = tau < T - 250 ? gauche + (pres - gauche) * lisse((tau - debutG) / (EMBUSCADE.approche - 250)) : pres;
        const galop = reduit ? 0 : Math.sin(maintenant * 0.026 + i * 2);
        el.style.transform = `translate3d(${ecran(wx)}px, ${g.yRail + g.hW * 0.62 - g.gH + galop * g.gH * 0.025}px, 0) rotate(${galop * 1.2}deg)`;
      });
    };
    raf = requestAnimationFrame(image);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [donnees, refs]);
}

/** Les deux couches du décor : la nouvelle arrive en fondu par-dessus l'ancienne (qui reste figée dessous). */
function useCouches(decor: Decor | null) {
  const r = useRef<{ couches: (Decor | null)[]; actif: number; vu: Decor | null }>({ couches: [null, null], actif: 0, vu: null });
  const c = r.current;
  if (decor !== c.vu) {
    if (decor) {
      if (c.vu === null) {
        c.couches = [decor, null];
        c.actif = 0;
      } else {
        const autre = c.actif === 0 ? 1 : 0;
        c.couches = c.actif === 0 ? [c.couches[0], decor] : [decor, c.couches[1]];
        c.actif = autre;
      }
    }
    c.vu = decor;
  }
  return c;
}

/** Une référence d'élément, créée une seule fois pour toute la vie du bonus. */
const nouvelleRef = <T,>(): RefObject<T> => ({ current: null });

// ---------------------------------------------------------------------------------------------------------------
// La météo

function Neige({ couche }: { couche: 'loin' | 'pres' }) {
  const flocons = useMemo(
    () =>
      Array.from({ length: couche === 'loin' ? 34 : 14 }, (_, k) => ({
        x: (k * 37 + (couche === 'loin' ? 7 : 53)) % 100,
        d: (couche === 'loin' ? 5.5 : 3.2) + ((k * 13) % 7) * 0.45,
        r: -((k * 1.37) % 7),
        s: couche === 'loin' ? 2 + (k % 3) : 4 + (k % 4) * 1.6,
      })),
    [couche],
  );
  return (
    <div className={`bwx-neige ${couche}`} aria-hidden="true">
      {flocons.map((f, k) => (
        <i key={k} style={{ '--x': `${f.x}%`, '--d': `${f.d}s`, '--r': `${f.r}s`, '--s': `${f.s}px` } as CSSProperties} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Le bonus

export function BonusExpress({ v, b, nom, ouvert, choisir }: { v: VueBW; b: VueBonusBW; nom: string; ouvert: boolean; choisir: (o: number) => void }) {
  const ex = b.express;
  const ordre = useMemo(() => b.etapes.map((e) => e.nom as string), [b.etapes]);
  const mien = b.mesChoix[0] ?? null;
  const salon = b.choixSalon[0] ?? [];
  const plusChoisi = salon.length ? salon.indexOf(Math.max(...salon)) : 0;
  const focus = mien ?? (plusChoisi >= 0 ? plusChoisi : 0);
  const M = Math.max(1, b.multiplicateur);

  // L'horloge de l'étape (recalée sur le serveur) et un battement de 10 par seconde pour React.
  const cleEtape = `${v.numero}-${b.etape}-${v.phase}`;
  const horloge = useRef({ cle: '', debut: 0 });
  const estime = performance.now() - ((v.duree ?? 0) - (v.reste ?? 0));
  if (horloge.current.cle !== cleEtape) horloge.current = { cle: cleEtape, debut: estime };
  else horloge.current.debut = Math.min(horloge.current.debut, estime);
  const [maintenant, setMaintenant] = useState(() => performance.now());
  useEffect(() => {
    const t = window.setInterval(() => setMaintenant(performance.now()), 100);
    return () => window.clearInterval(t);
  }, []);
  const tau = maintenant - horloge.current.debut;
  const D = v.duree ?? 6000;

  const decor = ex ? (DECOR_ETAPE[nom] ?? null) : null;
  const couches = useCouches(decor);
  // Un tunnel quand le décor change d'une étape à l'autre (pas au départ de Paris).
  const decorAvant = ordre.indexOf(nom) > 0 ? (DECOR_ETAPE[ordre[ordre.indexOf(nom) - 1]] ?? null) : null;
  const tunnel = !!decor && !!decorAvant && decorAvant !== decor;
  const dansTunnel = tunnel && tau < TUNNEL.sortie + 150;
  const donnees = useRef<DonneesScene | null>(null);
  donnees.current = { b, nom, cle: cleEtape, debut: horloge.current.debut, duree: D, focus, ordre, decor, couches: [...couches.couches], actif: couches.actif };
  const refsScene = useRef<RefsScene | null>(null);
  if (!refsScene.current)
    refsScene.current = {
      scene: nouvelleRef(),
      fonds: [nouvelleRef(), nouvelleRef()],
      voies: [nouvelleRef(), nouvelleRef()],
      panneau: nouvelleRef(),
      loco: nouvelleRef(),
      wagons: Array.from({ length: NB_WAGONS }, () => nouvelleRef<HTMLDivElement>()),
      fumees: Array.from({ length: 12 }, () => nouvelleRef<HTMLImageElement>()),
      gendarmes: [nouvelleRef(), nouvelleRef()],
      garage: nouvelleRef(),
    };
  const refs = refsScene.current;
  useSceneTrain(donnees, refs);

  const ici = ordre.indexOf(nom);
  const passee = (n: string) => v.phase === 'resultat' || ici > ordre.indexOf(n);
  const etat = ex ? etatVoyage(ex, nom, tau, ordre) : { attaches: [0, 1, 2, 3, 4], devies: [], partis: [] };
  const t = tunnelDe(nom);
  const cs = ex && t >= 0 ? cibles(ex, t) : [];

  /** Le coffre d'un wagon à la gare `g` : posé, ouvert ? (rang : sa place derrière la locomotive). */
  const coffre = (g: 'paris' | 'venise', k: number) => {
    if (passee(g)) return 'ouvert';
    if (nom !== g || !ex) return null;
    const rang = etat.attaches.indexOf(k);
    if (rang < 0) return null;
    const pas = pasCoffres(g, etat.attaches.length, D);
    const t0 = COFFRES[g] + pas * (rang + 1) - 60;
    return tau >= t0 ? 'ouvert' : tau >= t0 - posePour(pas) ? 'pose' : null;
  };
  /** L'instant (dans l'étape) où la police dévie le wagon k, s'il est visé maintenant. */
  const captureDe = (k: number) => {
    const i = cs.indexOf(k);
    return i >= 0 ? instantCapture(i) : null;
  };
  const decrocheVu = (k: number) => {
    const d = ex?.decroches[k];
    if (d === null || d === undefined) return false;
    const tn = d === 0 ? 'tunnel1' : 'tunnel2';
    if (passee(tn)) return true;
    const tc = nom === tn ? captureDe(k) : null;
    return tc !== null && tau >= tc;
  };
  const coffreBaronOuvert = !!ex && ex.gagnant !== null && (passee('istanbul') || (nom === 'istanbul' && tau >= ISTANBUL.ouverture));
  /** Le butin d'un wagon tel qu'on le voit à l'instant (sans le multiplicateur de la roue). */
  const butinVu = (k: number) => {
    if (!ex) return 0;
    let s = 0;
    if (coffre('paris', k) === 'ouvert') s += ex.paris[k] ?? 0;
    if (ex.venise[k] !== null && coffre('venise', k) === 'ouvert') s += ex.venise[k] ?? 0;
    if (coffreBaronOuvert && ex.gagnant === k && (nom !== 'istanbul' || tau >= ISTANBUL.ouverture + ISTANBUL.compte)) s += ex.coffre ?? 0;
    return s;
  };
  const gagnant = ex?.gagnant ?? null;

  // Les effets du moment : gyrophares, éclairs, secousse du « CLAC ».
  const gyrophare = t >= 0 && cs.length > 0 && tau >= EMBUSCADE.alerte && tau < instantCapture(cs.length - 1) + 1600;
  const eclair = decor === 'balkans' && t >= 0 ? ECLAIRS.findIndex((e) => tau >= e && tau < e + 420) : -1;
  const secousse = t >= 0 && cs.some((_, i) => tau >= instantCapture(i) && tau < instantCapture(i) + 380) && !mouvementReduit();

  // Les sons du voyage.
  const joues = useRef(new Set<string>());
  const prochainTchou = useRef(0);
  useEffect(() => {
    const fois = (cle: string, f: () => void) => {
      const c = `${cleEtape}-${cle}`;
      if (joues.current.has(c)) return;
      joues.current.add(c);
      f();
    };
    if (v.phase !== 'bonus') return;
    if (nom === 'intro') {
      if (tau > 300) fois('sifflet', () => jouerEffet('ex_sifflet'));
      if (tau > 1100) fois('vapeur', () => jouerEffet('ex_vapeur', { volume: 0.8 }));
    }
    if ((nom === 'paris' || nom === 'venise') && tau >= D - DEPART) {
      fois('depart', () => jouerEffet('ex_sifflet', { volume: 0.75 }));
      if (tau >= D - DEPART + 250) fois('vapeurDepart', () => jouerEffet('ex_vapeur'));
    }
    if (nom === 'venise' || nom === 'istanbul') fois('freins', () => jouerEffet('ex_freins'));
    if (nom === 'istanbul' && tau >= FREIN.istanbul) fois('vapeurArret', () => jouerEffet('ex_vapeur'));
    if ((nom === 'paris' || nom === 'venise') && ex) {
      const pas = pasCoffres(nom, etat.attaches.length, D);
      etat.attaches.forEach((k, rang) => {
        const t0 = COFFRES[nom] + pas * (rang + 1) - 60;
        if (tau >= t0) fois(`coffre${k}`, () => jouerEffet('ex_coffre', { volume: k === mien ? 1 : 0.5, vitesse: 0.92 + rang * 0.04 }));
      });
    }
    if (tunnel && tau < TUNNEL.duree) fois('tunnel', () => jouerEffet('ex_vent', { volume: 0.55, vitesse: 1.4 }));
    if (nom === 'tunnel1' && tau >= TUNNEL.sortie) fois('vent', () => jouerEffet('ex_vent', { volume: 0.8 }));
    if (decor === 'balkans' && t >= 0) ECLAIRS.forEach((e, j) => tau >= e + 220 && fois(`tonnerre${j}`, () => jouerEffet('ex_tonnerre', { volume: j % 2 ? 0.75 : 1, vitesse: 0.9 + (j % 3) * 0.08 })));
    if (t >= 0 && cs.length) {
      if (tau >= EMBUSCADE.alerte) fois('police', () => jouerEffet('ex_police'));
      cs.forEach((k, i) => {
        const T = instantCapture(i);
        if (tau >= T - EMBUSCADE.approche + 150) fois(`galop${i}`, () => jouerEffet('ex_galop', { volume: 0.9 }));
        if (tau >= T - EMBUSCADE.approche + 1500) fois(`galopBis${i}`, () => jouerEffet('ex_galop', { volume: 0.75 }));
        if (tau >= T) {
          fois(`clac${i}`, () => {
            jouerEffet('ex_decroche');
            jouerEffet('bw_menottes', { volume: k === mien ? 1 : 0.7 });
          });
        }
        if (tau >= T + 300) fois(`crissement${i}`, () => jouerEffet('ex_freins', { volume: 0.55, vitesse: 1.2 }));
      });
    }
    if (nom === 'istanbul') {
      if (tau >= ISTANBUL.terminus) fois('arrivee', () => jouerEffet('ex_arrivee'));
      if (tau >= ISTANBUL.terminus + 400) fois('foule', () => jouerEffet('ex_foule', { volume: 0.7 }));
      if (tau >= ISTANBUL.terminus + 900) fois('feux1', () => jouerEffet('ex_feux', { volume: 0.7 }));
      if (tau >= ISTANBUL.terminus + 5200) fois('feux2', () => jouerEffet('ex_feux', { volume: 0.6 }));
      if (tau >= ISTANBUL.coffre) fois('cadran', () => jouerEffet('ex_cadran'));
      if (tau >= ISTANBUL.ouverture) fois('coffreBaron', () => jouerEffet('bw_coffre'));
      if (gagnant !== null && gagnant === mien && tau >= ISTANBUL.ouverture + ISTANBUL.compte) fois('lingots', () => jouerEffet('lingots_pluie'));
    }
    // Le tchou-tchou tant que le train roule (moins souvent : le train va son train).
    const roule = !!decor && allure(nom, tau, D) > 0.3;
    if (roule && maintenant >= prochainTchou.current) {
      prochainTchou.current = maintenant + 2400;
      jouerEffet('ex_tchou', { volume: 0.6 });
    }
  });

  // L'annonce de l'étape.
  let annonce: { titre: string; sous?: string; ton?: string } | null = null;
  if (nom === 'paris') annonce = tau < COFFRES.paris + 500 ? { titre: tr('Gare de Paris', 'Paris station'), sous: tr('Un coffre sur chaque wagon !', 'A safe on every carriage!') } : tau >= D - DEPART ? { titre: tr('En voiture !', 'All aboard!'), ton: 'petit' } : null;
  else if (t >= 0) {
    const n = cs.length;
    const fin = n ? instantCapture(n - 1) + EMBUSCADE.fin : 0;
    const enCours = cs.findIndex((_, i) => tau >= instantCapture(i) && tau < instantCapture(i) + 1700);
    if (tau < EMBUSCADE.alerte) annonce = t === 0 ? { titre: tr('Les Alpes', 'The Alps'), sous: tr('La neige tombe sur le viaduc…', 'Snow falls on the viaduct…') } : { titre: tr('Les Balkans', 'The Balkans'), sous: tr('L’orage gronde…', 'The storm is raging…') };
    else if (n && tau < instantCapture(0) - 300) annonce = { titre: tr('La police à cheval !', 'The mounted police!'), sous: tr(`${n} wagon${n > 1 ? 's' : ''} vont être décrochés…`, `${n} carriage${n > 1 ? 's' : ''} about to be uncoupled…`), ton: 'police' };
    else if (enCours >= 0) annonce = { titre: tr(`${nomWagon(cs[enCours])} décroché !`, `${nomWagon(cs[enCours])} uncoupled!`), sous: cs[enCours] === mien ? tr('Ton wagon quitte le train… il garde son butin', 'Your carriage leaves the train… it keeps its loot') : undefined, ton: 'police' };
    else if (tau >= fin)
      annonce = {
        titre: t === 0 ? tr('Plus que 3 wagons !', '3 carriages left!') : tr('Il n’en reste qu’un !', 'Only one left!'),
        sous: mien !== null && etat.attaches.includes(mien) ? tr('Ton wagon tient bon !', 'Your carriage holds on!') : undefined,
        ton: 'petit',
      };
  } else if (nom === 'venise') annonce = tau < COFFRES.venise + 300 ? { titre: tr('Gare de Venise', 'Venice station'), sous: tr('Les coffres de Venise !', 'The Venice safes!') } : tau >= D - DEPART ? { titre: tr('Cap sur les Balkans !', 'On to the Balkans!'), ton: 'petit' } : null;
  else if (nom === 'istanbul') annonce = tau < ISTANBUL.terminus ? { titre: tr('Istanbul !', 'Istanbul!'), sous: tr('Le terminus du voyage', 'The end of the line') } : null;
  // Dans le tunnel, on attend la sortie pour annoncer le nouveau décor.
  if (dansTunnel) annonce = null;

  const istanbulScene = nom === 'istanbul' || nom === 'revele';
  const arrivee = (nom === 'istanbul' && tau >= ISTANBUL.terminus) || nom === 'revele';
  const coffreVisible = (nom === 'istanbul' && tau >= ISTANBUL.coffre) || nom === 'revele';
  /** Le butin du Coffre du Baron monte de ×0 à sa valeur, puis le multiplicateur de la roue s'y applique. */
  const compte = (() => {
    if (nom === 'revele' || mouvementReduit()) return 1;
    return Math.min(1, Math.max(0, (tau - ISTANBUL.ouverture) / ISTANBUL.compte));
  })();
  const gare = estArret(nom) && decor ? GARES[nom === 'revele' ? 'istanbul' : nom] : null;

  return (
    <div className={`bwx ${nom} ${decor ?? ''}`} ref={refs.scene}>
      {(nom === 'intro' || nom === 'wagons') && <div className="bwx-depart" />}

      <div className={`bwx-monde ${secousse ? 'secousse' : ''} ${dansTunnel ? 'dans-tunnel' : ''}`}>
        {decor &&
          couches.couches.map((dc, i) =>
            dc ? (
              <div key={`couche-${i}-${dc}`} className={`bwx-couche ${couches.actif === i ? 'actif' : 'ancien'} ${couches.couches[1 - i] ? 'apres-tunnel' : ''}`}>
                <div className={`bwx-fond ${eclair >= 0 && couches.actif === i ? 'eclaire' : ''}`} ref={refs.fonds[i]} style={{ backgroundImage: `url(${IMG(dc)})` }} />
                <div className="bwx-voie" ref={refs.voies[i]} style={{ backgroundImage: `url(${IMG(`${dc}-voie`)})` }} />
              </div>
            ) : null,
          )}
        {decor === 'alpes' && <Neige couche="loin" />}
        {decor === 'balkans' && <div className="bwx-pluie loin" aria-hidden="true" />}
        {tunnel && tau < TUNNEL.duree && (
          <div className="bwx-tunnel" key={`tunnel-${nom}`} aria-hidden="true">
            <i />
          </div>
        )}

        <div className={`bwx-train ${decor ? '' : 'cache'}`} aria-hidden="true">
          {gare && (
            <div className="bwx-panneau" ref={refs.panneau}>
              <span className="bwx-panneau-plaque">
                <strong>{tr(...gare.ville)}</strong>
                <small>{gare.gare}</small>
              </span>
            </div>
          )}
          <div className="bwx-garage" ref={refs.garage} />
          {[4, 3, 2, 1, 0].map((k) => {
            const cp = coffre('paris', k);
            const cv = ex?.venise[k] !== null && nom === 'venise' ? coffre('venise', k) : null;
            const c = nom === 'paris' ? cp : nom === 'venise' ? cv : null;
            const valeur = nom === 'paris' ? ex?.paris[k] : ex?.venise[k];
            const tc = captureDe(k);
            const dep = tc === null ? -1 : tau - tc;
            return (
              <div key={k} className={`bwx-wagon ${k === mien ? 'mien' : ''} ${dep >= 0 ? 'devie' : ''}`} ref={refs.wagons[k]}>
                <img src={IMG(`wagon-${k + 1}`)} alt="" draggable={false} />
                <span className="bwx-plaque" style={{ '--couleur': WAGONS_EXPRESS[k].couleur, '--texte': WAGONS_EXPRESS[k].texte } as CSSProperties}>
                  {k === mien ? '★ ' : ''}
                  {nomWagon(k)}
                </span>
                {tc !== null && dep < 0 && dep > -1500 && <span className="bwx-vise" />}
                {dep >= 0 && dep < 950 && (
                  <span className="bwx-clac">
                    <i />
                    <b>CLAC !</b>
                  </span>
                )}
                {dep >= 700 && <span className="bwx-tampon">{tr('Décroché', 'Uncoupled')}</span>}
                {dep >= 0 && dep < 1600 && <span className="bwx-etincelles" />}
                {c && (
                  <span className={`bwx-coffre ${c}`}>
                    <img src={c === 'ouvert' ? '/cartes/bw-ex-coffre-ouvert.webp' : '/cartes/bw-ex-coffre.webp'} alt="" draggable={false} />
                    {c === 'ouvert' && valeur != null && (
                      <b className={valeur * M >= 250 ? 'gros enorme' : valeur * M >= 50 ? 'gros' : ''}>
                        <ValeurMultipliee x={valeur} m={M} son={k === mien} rapide />
                      </b>
                    )}
                  </span>
                )}
              </div>
            );
          })}
          <div className="bwx-loco" ref={refs.loco}>
            <img src={IMG('loco')} alt="" draggable={false} />
            <i className="bwx-phare" />
            <i className="bwx-lanterne" />
          </div>
          {refs.gendarmes.map((r, i) => (
            <img key={`g${i}`} className="bwx-gendarme" ref={r} src="/cartes/bw-ex-gendarme.webp" alt="" draggable={false} />
          ))}
          {refs.fumees.map((r, k) => (
            <img key={k} className="bwx-fumee" ref={r} src="/cartes/bw-ex-fumee-1.webp" alt="" draggable={false} />
          ))}
        </div>

        {decor === 'alpes' && <Neige couche="pres" />}
        {decor === 'balkans' && <div className="bwx-pluie pres" aria-hidden="true" />}
        {eclair >= 0 && <div className="bwx-eclair" key={`eclair-${eclair}`} />}
      </div>
      {gyrophare && <div className="bwx-gyro" aria-hidden="true" />}

      {istanbulScene && arrivee && (
        <div className="bwx-fete" aria-hidden="true">
          {Array.from({ length: 7 }, (_, k) => (
            <i key={k} className="bwx-feu" style={{ '--k': k } as CSSProperties} />
          ))}
          {Array.from({ length: 26 }, (_, k) => (
            <i key={`c${k}`} className="bwx-confetti" style={{ '--k': k, '--x': `${(k * 37) % 100}%` } as CSSProperties} />
          ))}
        </div>
      )}

      {nom === 'intro' && (
        <div className="bwx-intro">
          <div className="bwx-affiche">
            <img src={IMG('affiche')} alt="" draggable={false} />
            <strong className="bwx-affiche-titre">{tr('L’Express du Baron', 'The Baron Express')}</strong>
            <i className="bwx-affiche-reflet" />
          </div>
          <img className="bwx-baron" src={IMG('baron')} alt="" draggable={false} />
          <div className="bwx-accroche">
            <span>Paris → Istanbul</span>
            <em>{tr('5 wagons au départ… un seul arrivera !', '5 carriages leave… only one will arrive!')}</em>
          </div>
          <div className="bwx-vapeurs" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((k) => (
              <img key={k} src={`/cartes/bw-ex-fumee-${k + 1}.webp`} alt="" style={{ '--k': k } as CSSProperties} />
            ))}
          </div>
        </div>
      )}

      {nom === 'wagons' && (
        <>
          <div className="bwx-chef" aria-hidden="true">
            <img src={IMG('chef')} alt="" draggable={false} />
            <p className="bwx-bulle">{tr('En voiture ! Choisissez votre wagon : un seul arrivera à Istanbul.', 'All aboard! Pick your carriage: only one will reach Istanbul.')}</p>
          </div>
          <div className="bwx-choix" role="group" aria-label={tr('Choisis ton wagon', 'Pick your carriage')}>
            {WAGONS_EXPRESS.map((w, k) => (
              <button key={k} type="button" className={`bwx-choix-wagon ${mien === k ? 'choisi' : ''} ${mien !== null && mien !== k ? 'autre' : ''}`} onClick={() => choisir(k)} disabled={!ouvert} style={{ '--couleur': w.couleur, '--texte': w.texte } as CSSProperties}>
                <img src={IMG(`wagon-${k + 1}`)} alt="" draggable={false} />
                <span>{tr(...w.nom)}</span>
                {salon[k] ? <i>{salon[k]}</i> : null}
              </button>
            ))}
          </div>
        </>
      )}

      {annonce && (
        <div className={`bwx-annonce ${annonce.ton ?? ''}`} key={`${nom}-${annonce.titre}`} role="status">
          <strong>{insecable(annonce.titre)}</strong>
          {annonce.sous && <span>{insecable(annonce.sous)}</span>}
        </div>
      )}

      {arrivee && (
        <div className="bwx-arrivee">
          <div className="bwx-terminus">
            <img src={IMG('terminus')} alt="" draggable={false} />
            <span className="bwx-terminus-texte">
              <strong>Terminus</strong>
              <small>Istanbul · Sirkeci</small>
            </span>
          </div>
          {gagnant !== null && !(coffreVisible && nom === 'istanbul') && (
            <p className="bwx-gagnant" style={{ '--couleur': WAGONS_EXPRESS[gagnant].couleur, '--texte': WAGONS_EXPRESS[gagnant].texte } as CSSProperties}>
              {gagnant === mien ? tr('★ Ton wagon arrive à Istanbul !', '★ Your carriage reaches Istanbul!') : tr(`Le wagon ${nomWagon(gagnant)} arrive à Istanbul !`, `The ${nomWagon(gagnant)} carriage reaches Istanbul!`)}
            </p>
          )}
        </div>
      )}
      {coffreVisible && gagnant !== null && nom === 'istanbul' && (
        <div className="bwx-coffre-baron" style={{ '--couleur': WAGONS_EXPRESS[gagnant].couleur, '--texte': WAGONS_EXPRESS[gagnant].texte } as CSSProperties}>
          <small>{gagnant === mien ? tr('★ Ton wagon arrive à Istanbul !', '★ Your carriage reaches Istanbul!') : tr(`Le wagon ${nomWagon(gagnant)} arrive à Istanbul !`, `The ${nomWagon(gagnant)} carriage reaches Istanbul!`)}</small>
          <img src={coffreBaronOuvert ? '/cartes/bw-ex-coffre-ouvert.webp' : '/cartes/bw-ex-coffre.webp'} alt="" draggable={false} className={coffreBaronOuvert ? 'ouvert' : ''} />
          <strong className={(ex?.coffre ?? 0) * M >= 1000 && coffreBaronOuvert ? 'enorme' : ''}>
            {coffreBaronOuvert && ex?.coffre != null ? (
              <>
                {tr('Coffre du Baron', 'The Baron’s Safe')} {compte < 1 ? <span className="bw-valeur">{fx(Math.round(ex.coffre * (1 - (1 - compte) ** 3)))}</span> : <ValeurMultipliee x={ex.coffre} m={M} son />}
                {'\u00a0!'}
              </>
            ) : (
              tr('Le Coffre du Baron…', 'The Baron’s Safe…')
            )}
          </strong>
        </div>
      )}
      {gagnant !== null && gagnant === mien && coffreBaronOuvert && compte >= 1 && nom === 'istanbul' && <PluieLingots n={36} />}

      {nom !== 'intro' && nom !== 'wagons' && !arrivee && (
        <ol className="bwx-tableau" aria-label={tr('Les wagons', 'The carriages')}>
          {WAGONS_EXPRESS.map((w, k) => {
            const tombe = decrocheVu(k);
            const arrive = coffreBaronOuvert && gagnant === k;
            const butin = butinVu(k);
            return (
              <li key={k} className={`${k === mien ? 'mien' : ''} ${tombe ? 'tombe' : ''} ${arrive ? 'arrive' : ''}`} style={{ '--couleur': w.couleur, '--texte': w.texte } as CSSProperties}>
                <span className="bwx-tableau-nom">
                  {k === mien ? '★ ' : ''}
                  {tr(...w.nom)}
                </span>
                <strong>
                  <Compteur valeur={butin * M} />
                </strong>
                <small>{arrive ? tr('Arrivé !', 'Arrived!') : tombe ? tr('Décroché', 'Uncoupled') : salon[k] ? tr(`${salon[k]} joueur${salon[k] > 1 ? 's' : ''}`, `${salon[k]} player${salon[k] > 1 ? 's' : ''}`) : tr('En route', 'On board')}</small>
                {k === mien && b.mise > 0 && butin > 0 && <em>{dollars(Math.floor(b.mise * butin * M))}</em>}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
