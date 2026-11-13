/**
 * L'Express du Baron (The Baron's Wheel) : la case unique de la roue. Le Baron braque le train de nuit Paris–Istanbul ;
 * chaque joueur choisit son wagon, et « il n'en restera qu'un ».
 *
 * Le serveur a tout tiré dès le début du bonus (butins de Paris et de Venise, wagons décrochés dans chaque tunnel,
 * Coffre du Baron) et ne le révèle qu'au fil du voyage. Cet écran met le voyage en scène, calé sur l'horloge de
 * chaque étape :
 * - la position du train, la caméra (qui glisse le long des wagons et recule dans les tunnels), le décor qui défile,
 *   la gare qui arrive et repart, la fumée de la locomotive et le gendarme à cheval sont écrits à chaque image par une
 *   boucle requestAnimationFrame, sans repasser par React ;
 * - les coffres, le tableau des wagons, les annonces, les sons suivent l'horloge de l'étape (10 fois par seconde).
 *
 * Visuels : bw-ex-*.webp (gares, décors, locomotive, 5 wagons, fumée, coffres, gendarme, arrivée).
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { NB_WAGONS, type VueBonusBW, type VueBW } from '../../shared/baronWheel';
import { dollars } from './casinoOutils';
import { EN, tr } from './traduction';
import { jouerEffet, mouvementReduit } from './ui';
import './baronExpress.css';

/** Pas de « ! » seul en début de ligne. */
const insecable = (t: string) => t.replace(/ ([!?:;])/g, '\u00a0$1');
const fx = (x: number) => `×${x.toLocaleString(EN ? 'en-US' : 'fr-FR', { maximumFractionDigits: 2 })}`;

/** Les cinq wagons : nom et couleurs (celles du tableau). */
export const WAGONS_EXPRESS: { nom: [string, string]; couleur: string; texte: string }[] = [
  { nom: ['Ébène', 'Ebony'], couleur: '#2a2119', texte: '#ffd774' },
  { nom: ['Bordeaux', 'Burgundy'], couleur: '#7a1c2e', texte: '#fff1c4' },
  { nom: ['Saphir', 'Sapphire'], couleur: '#1b2c58', texte: '#fff1c4' },
  { nom: ['Ivoire', 'Ivory'], couleur: '#efe3c8', texte: '#3a1810' },
  { nom: ['Rubis', 'Ruby'], couleur: '#b3261c', texte: '#fff1c4' },
];
const nomWagon = (k: number) => tr(...WAGONS_EXPRESS[k].nom);

// Les dimensions des images (le train est à la même échelle partout).
const LOCO = { w: 877, h: 230 };
const WAGON = { w: 901, h: 228 };
const GARE = { w: 980, h: 318 };
const GENDARME = { w: 683, h: 440 };
/** La bande de décor (doublée en miroir) : sa largeur vaut 6 fois sa hauteur ; les rails y sont à 90,5 %. */
const BANDE = { ratio: 6, rail: 0.905, quai: 0.83 };

// ---------------------------------------------------------------------------------------------------------------
// Le calendrier de chaque étape (millisecondes depuis le début de l'étape)

/** Coffres : départ de la série (Paris : train déjà arrêté ; Venise : après le freinage), et l'écart entre deux. */
const COFFRES = { paris: 700, venise: 1800, pas: 480, pose: 380 };
const FREINAGE = { venise: 1500, istanbul: 1800 };
/** Le train repart 1,3 s avant la fin d'une gare. */
const DEPART_AVANT_FIN = 1300;
const TUNNEL = { police: 500, decroche: 2400, fuite: 4000 };
const ISTANBUL = { panorama: 1900, coffre: 2900 };

const DECORS: Record<string, string> = { paris: 'paris', tunnel1: 'tunnel', alpes: 'alpes', venise: 'venise', tunnel2: 'tunnel', istanbul: 'istanbul' };
const estVoyage = (nom: string) => nom in DECORS;
const estGare = (nom: string) => nom === 'paris' || nom === 'venise' || nom === 'istanbul';
const tunnelDe = (nom: string) => (nom === 'tunnel1' ? 0 : nom === 'tunnel2' ? 1 : -1);

/** Vitesse du train (part de la vitesse de croisière) à l'instant τ de l'étape. */
function allure(nom: string, tau: number, D: number): number {
  const repart = (t0: number) => (tau < t0 ? 0 : Math.min(1, (tau - t0) / 1200));
  switch (nom) {
    case 'paris':
      return repart(D - DEPART_AVANT_FIN);
    case 'tunnel1':
    case 'tunnel2':
      return 1.25;
    case 'alpes':
      return 1;
    case 'venise':
      return tau < FREINAGE.venise ? 1 - tau / FREINAGE.venise : repart(D - DEPART_AVANT_FIN);
    case 'istanbul':
      return tau < FREINAGE.istanbul ? 1 - tau / FREINAGE.istanbul : 0;
    default:
      return 0;
  }
}
/** Distance de freinage (en durée × vitesse de croisière / 2) : la gare s'arrête pile derrière le train. */
const freinage = (nom: string) => (nom === 'venise' ? FREINAGE.venise : nom === 'istanbul' ? FREINAGE.istanbul : 0) / 2;

interface EtatVoyage {
  /** Les wagons encore attachés (dans l'ordre derrière la locomotive), décrochés à l'instant, et décrochés avant. */
  attaches: number[];
  enTrainDeTomber: number[];
  partis: number[];
}
/** Qui est encore attaché au train à l'instant τ de l'étape `nom`. */
function etatVoyage(ex: NonNullable<VueBonusBW['express']>, nom: string, tau: number, ordre: string[]): EtatVoyage {
  const ici = ordre.indexOf(nom);
  const attaches: number[] = [];
  const enTrainDeTomber: number[] = [];
  const partis: number[] = [];
  for (let k = 0; k < NB_WAGONS; k++) {
    const d = ex.decroches[k];
    if (d === null) {
      attaches.push(k);
      continue;
    }
    const iTunnel = ordre.indexOf(d === 0 ? 'tunnel1' : 'tunnel2');
    if (ici > iTunnel) partis.push(k);
    else if (ici === iTunnel && tau >= TUNNEL.decroche) enTrainDeTomber.push(k);
    else attaches.push(k);
  }
  return { attaches, enTrainDeTomber, partis };
}

// ---------------------------------------------------------------------------------------------------------------
// La scène animée (boucle requestAnimationFrame)

interface DonneesScene {
  b: VueBonusBW;
  nom: string;
  debut: number;
  duree: number;
  focus: number;
  ordre: string[];
}

interface RefsScene {
  scene: RefObject<HTMLDivElement>;
  bande: RefObject<HTMLDivElement>;
  gare: RefObject<HTMLImageElement>;
  loco: RefObject<HTMLDivElement>;
  wagons: RefObject<HTMLDivElement>[];
  fumees: RefObject<HTMLImageElement>[];
  gendarme: RefObject<HTMLImageElement>;
}

function useSceneTrain(donnees: { current: DonneesScene | null }, refs: RefsScene) {
  useEffect(() => {
    const scene = refs.scene.current;
    if (!scene) return;
    let W = 0;
    let H = 0;
    const g = { P: 0, step: 0, hW: 0, hL: 0, wL: 0, xL: 0, stripH: 0, Yb: 0, vmax: 0, portrait: false };
    const mesurer = () => {
      W = scene.clientWidth;
      H = scene.clientHeight;
      if (!W || !H) return;
      // En hauteur (téléphone), un wagon occupe tout l'écran : le décor garde ses proportions avec le train.
      g.portrait = H > W * 1.05;
      g.P = W * (g.portrait ? 0.98 : 0.5);
      g.step = g.P * 0.985;
      g.hW = (g.P * WAGON.h) / WAGON.w;
      g.wL = (g.P * LOCO.w) / WAGON.w;
      g.hL = (g.wL * LOCO.h) / LOCO.w;
      g.xL = -g.wL;
      g.stripH = H;
      g.Yb = H - g.stripH * (1 - BANDE.rail);
      g.vmax = (W * 1.15) / 1000;
      scene.style.setProperty('--p', `${g.P}px`);
      if (refs.loco.current) {
        refs.loco.current.style.width = `${g.wL}px`;
        refs.loco.current.style.height = `${g.hL}px`;
      }
      for (const r of refs.wagons) {
        if (!r.current) continue;
        r.current.style.width = `${g.P}px`;
        r.current.style.height = `${g.hW}px`;
      }
      if (refs.gare.current) refs.gare.current.style.width = `${g.P * 2.3}px`;
      if (refs.gendarme.current) refs.gendarme.current.style.height = `${g.hW * 1.55}px`;
      for (const r of refs.fumees) if (r.current) r.current.style.width = `${g.P * 0.42}px`;
    };
    mesurer();
    const ro = new ResizeObserver(mesurer);
    ro.observe(scene);

    const st = {
      off: 0,
      C: Number.NaN,
      z: 1,
      x: Array<number>(NB_WAGONS).fill(Number.NaN),
      chute: Array<number>(NB_WAGONS).fill(Number.NaN),
      cle: '',
      off0: 0,
      dernier: performance.now(),
      prochaineFumee: 0,
      fumees: [] as { t0: number; x0: number; vx: number; n: number; el: number }[],
      prochainEl: 0,
    };
    const slotX = (s: number) => g.xL - (s + 1) * g.step;
    const ease = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
    let raf = 0;
    const image = () => {
      raf = requestAnimationFrame(image);
      const d = donnees.current;
      const maintenant = performance.now();
      const dt = Math.min(64, maintenant - st.dernier);
      st.dernier = maintenant;
      if (!d || !W || !d.b.express || !estVoyage(d.nom)) return;
      const ex = d.b.express;
      const tau = maintenant - d.debut;
      const D = d.duree;
      const nom = d.nom;
      const cle = `${nom}-${Math.round(d.debut)}`;
      if (cle !== st.cle) {
        st.cle = cle;
        st.off0 = st.off;
        mesurer(); // la gare et le gendarme viennent d'apparaître
        st.chute.fill(Number.NaN);
      }
      const v = allure(nom, tau, D) * g.vmax;
      st.off += v * dt;

      // Qui est attaché, et où : les wagons restants se resserrent derrière la locomotive.
      const etat = etatVoyage(ex, nom, tau, d.ordre);
      etat.attaches.forEach((k, rang) => {
        const cible = slotX(rang);
        st.x[k] = Number.isNaN(st.x[k]) ? cible : st.x[k] + (cible - st.x[k]) * (1 - Math.exp(-dt * 0.0025));
      });
      for (const k of etat.enTrainDeTomber) {
        if (Number.isNaN(st.chute[k])) st.chute[k] = Number.isNaN(st.x[k]) ? slotX(k) : st.x[k];
        const s = Math.max(0, tau - TUNNEL.decroche) / 2600;
        // Décroché, le wagon freine : il recule par rapport au train (et s'efface).
        st.x[k] = st.chute[k] - 1.6 * g.P * s * s;
      }

      // La caméra : elle suit mon wagon, glisse le long du train pendant les coffres, recule dans les tunnels.
      const centre = (k: number) => st.x[k] + g.P / 2;
      const centreLoco = g.xL + g.wL * 0.45;
      const focus = etat.attaches.includes(d.focus) ? d.focus : (etat.attaches[0] ?? -1);
      let cibleC = focus >= 0 ? centre(focus) : centreLoco;
      let cibleZ = 1;
      if (nom === 'paris' || nom === 'venise') {
        const t0 = nom === 'paris' ? COFFRES.paris : COFFRES.venise;
        const n = etat.attaches.length;
        const u = (tau - t0) / (COFFRES.pas * n);
        if (u >= -0.3 && u <= 1.15) cibleC = centreLoco + (centre(etat.attaches[n - 1]) - centreLoco) * Math.max(0, Math.min(1, u));
      } else if (tunnelDe(nom) >= 0) {
        // La caméra recule sur les wagons que la police va décrocher, puis revient sur ce qui reste du train.
        const zMin = g.portrait ? 0.42 : 0.55;
        const tombent = ex.decroches.map((x, k) => (x === tunnelDe(nom) ? k : -1)).filter((k) => k >= 0 && !Number.isNaN(st.x[k]));
        if (tau < TUNNEL.decroche + 500 && tombent.length) {
          if (tau > 350) cibleZ = zMin;
          cibleC = tombent.reduce((s, k) => s + centre(k), 0) / tombent.length;
        } else if (etat.attaches.length) {
          const n = etat.attaches.length;
          if (tau < D - 700) cibleZ = Math.max(zMin, Math.min(1, (0.92 * W) / (n * g.step)));
          cibleC = etat.attaches.reduce((s, k) => s + centre(k), 0) / n;
        }
      } else if (nom === 'istanbul') cibleC = centreLoco - g.P * 0.4;
      const lissage = 1 - Math.exp(-dt * 0.0028);
      st.C = Number.isNaN(st.C) ? cibleC : st.C + (cibleC - st.C) * lissage;
      st.z += (cibleZ - st.z) * (1 - Math.exp(-dt * 0.003));
      const z = st.z;
      const C = st.C;
      const ecran = (wx: number) => W / 2 + (wx - C) * z;

      // Le décor : la bande défile (rails sous les roues), plus haut quand la caméra recule.
      const bande = refs.bande.current;
      if (bande) {
        const hz = g.stripH * z;
        const periode = BANDE.ratio * g.stripH;
        const u0 = -W / 2 / z + C + st.off;
        bande.style.top = `${g.Yb - BANDE.rail * hz}px`;
        bande.style.height = `${hz}px`;
        bande.style.backgroundSize = `auto ${hz}px`;
        bande.style.backgroundPositionX = `${-(((u0 % periode) + periode) % periode) * z}px`;
      }

      // La gare : elle arrive avec le décor, s'arrête derrière le train, repart.
      const gare = refs.gare.current;
      if (gare) {
        const n = Math.max(1, etat.attaches.length);
        const milieu = (g.xL + slotX(n - 1) + g.P) / 2;
        const xg = milieu + (st.off0 + freinage(nom) * g.vmax - st.off);
        const gw = g.P * 2.3;
        const gh = (gw * GARE.h) / GARE.w;
        gare.style.transform = `translate3d(${ecran(xg - gw / 2)}px, ${g.Yb - (BANDE.rail - BANDE.quai) * g.stripH * z - gh * z}px, 0) scale(${z})`;
      }

      // Le train : la locomotive et les wagons (un petit roulis quand il roule).
      const bouge = v > 0.01 && !mouvementReduit();
      const roulis = (k: number) => (bouge ? Math.sin(maintenant * 0.028 + k * 1.9) * 1.3 : 0);
      if (refs.loco.current) refs.loco.current.style.transform = `translate3d(${ecran(g.xL)}px, ${g.Yb - g.hL * z + roulis(9)}px, 0) scale(${z})`;
      refs.wagons.forEach((r, k) => {
        const el = r.current;
        if (!el) return;
        const parti = etat.partis.includes(k);
        el.style.visibility = parti ? 'hidden' : 'visible';
        if (parti || Number.isNaN(st.x[k])) return;
        const tombe = etat.enTrainDeTomber.includes(k);
        const s = tombe ? Math.max(0, tau - TUNNEL.decroche) : 0;
        el.style.opacity = tombe ? String(Math.max(0, 1 - s / 2600)) : '1';
        el.style.transform = `translate3d(${ecran(st.x[k])}px, ${g.Yb - g.hW * z + (tombe ? 0 : roulis(k))}px, 0) scale(${z})${tombe ? ` rotate(${-Math.min(4, s / 300)}deg)` : ''}`;
      });

      // La fumée de la locomotive : des bouffées qui grossissent, reculent et s'effacent.
      const cheminee = g.xL + g.wL * 0.86;
      if (maintenant >= st.prochaineFumee && !mouvementReduit()) {
        st.prochaineFumee = maintenant + (v > 0.2 * g.vmax ? 170 : 520);
        st.fumees.push({ t0: maintenant, x0: cheminee, vx: v * 0.8 + g.vmax * 0.06, n: Math.floor(Math.random() * 6), el: st.prochainEl });
        st.prochainEl = (st.prochainEl + 1) % refs.fumees.length;
        if (st.fumees.length > refs.fumees.length) st.fumees.shift();
      }
      const vie = 1800;
      refs.fumees.forEach((r) => r.current && (r.current.style.opacity = '0'));
      for (const f of st.fumees) {
        const el = refs.fumees[f.el].current;
        const a = maintenant - f.t0;
        if (!el || a > vie) continue;
        const u = a / vie;
        const sc = z * (0.35 + 1.1 * u);
        const wx = f.x0 - f.vx * a;
        const hy = g.hL * 0.9 + g.hW * 1.4 * u;
        if (el.dataset.n !== String(f.n)) {
          el.dataset.n = String(f.n);
          el.src = `/cartes/bw-ex-fumee-${f.n + 1}.webp`;
        }
        el.style.opacity = String(0.85 * (1 - u) * Math.min(1, a / 120));
        // L'image traîne vers la droite : retournée, la traînée part derrière le train.
        el.style.transform = `translate3d(${ecran(wx) + el.offsetWidth * sc * 0.5}px, ${g.Yb - hy * z - el.offsetHeight * sc}px, 0) scale(${-sc}, ${sc})`;
      }

      // Le gendarme à cheval : il rattrape le train, décroche les wagons, puis se laisse distancer.
      const gd = refs.gendarme.current;
      if (gd) {
        const t = tunnelDe(nom);
        const cibles = ex.decroches.map((x, k) => (x === t ? k : -1)).filter((k) => k >= 0);
        const cible = cibles.length ? cibles.reduce((s, k) => s + centre(k), 0) / cibles.length : C;
        const hh = g.hW * 1.55;
        const hw = (hh * GENDARME.w) / GENDARME.h;
        const gauche = C - W / 2 / z - hw * 1.2;
        const pres = cible - hw * 0.62;
        let wx = gauche;
        if (tau < TUNNEL.police) wx = gauche;
        else if (tau < TUNNEL.decroche - 200) wx = gauche + (pres - gauche) * ease((tau - TUNNEL.police) / (TUNNEL.decroche - 200 - TUNNEL.police));
        else if (tau < TUNNEL.decroche + 400) wx = pres;
        else wx = pres + (gauche - pres) * ease((tau - TUNNEL.decroche - 400) / (TUNNEL.fuite - TUNNEL.decroche - 400));
        const galop = mouvementReduit() ? 0 : Math.sin(maintenant * 0.03);
        gd.style.transform = `translate3d(${ecran(wx)}px, ${g.Yb + g.stripH * 0.04 * z - hh * z + galop * 3}px, 0) scale(${z}) rotate(${galop * 2}deg)`;
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
// Le bonus

export function BonusExpress({ v, b, nom, ouvert, choisir }: { v: VueBW; b: VueBonusBW; nom: string; ouvert: boolean; choisir: (o: number) => void }) {
  const ex = b.express;
  const ordre = useMemo(() => b.etapes.map((e) => e.nom as string), [b.etapes]);
  const mien = b.mesChoix[0] ?? null;
  const salon = b.choixSalon[0] ?? [];
  const plusChoisi = salon.length ? salon.indexOf(Math.max(...salon)) : 0;
  const focus = mien ?? (plusChoisi >= 0 ? plusChoisi : 0);

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

  // Les décors du voyage, chargés dès le départ : chaque étape s'enchaîne sans image vide.
  useEffect(() => {
    for (const f of ['paris', 'tunnel', 'alpes', 'venise', 'istanbul', 'gare', 'arrivee', 'coffre', 'coffre-ouvert', 'gendarme', 'loco', 'fumee-1', 'fumee-2', 'fumee-3', 'fumee-4', 'fumee-5', 'fumee-6']) new Image().src = `/cartes/bw-ex-${f}.webp`;
  }, []);
  const donnees = useRef<DonneesScene | null>(null);
  donnees.current = { b, nom, debut: horloge.current.debut, duree: D, focus, ordre };
  const refs: RefsScene = {
    scene: useRef<HTMLDivElement>(null),
    bande: useRef<HTMLDivElement>(null),
    gare: useRef<HTMLImageElement>(null),
    loco: useRef<HTMLDivElement>(null),
    wagons: [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)],
    fumees: Array.from({ length: 12 }, () => useRef<HTMLImageElement>(null)), // eslint-disable-line react-hooks/rules-of-hooks
    gendarme: useRef<HTMLImageElement>(null),
  };
  const refsStables = useRef(refs);
  useSceneTrain(donnees, refsStables.current);

  const ici = ordre.indexOf(nom);
  const passee = (n: string) => v.phase === 'resultat' || ici > ordre.indexOf(n);
  const etat = ex ? etatVoyage(ex, nom, tau, ordre) : { attaches: [0, 1, 2, 3, 4], enTrainDeTomber: [], partis: [] };

  /** Le coffre d'un wagon à la gare `g` : posé, ouvert ? (rang : sa place derrière la locomotive). */
  const coffre = (g: 'paris' | 'venise', k: number) => {
    if (passee(g)) return 'ouvert';
    if (nom !== g || !ex) return null;
    const rang = etat.attaches.indexOf(k);
    if (rang < 0) return null;
    const t = (g === 'paris' ? COFFRES.paris : COFFRES.venise) + COFFRES.pas * (rang + 1) - 60;
    return tau >= t ? 'ouvert' : tau >= t - COFFRES.pose ? 'pose' : null;
  };
  const decrocheVu = (k: number) => {
    const d = ex?.decroches[k];
    if (d === null || d === undefined) return false;
    const t = d === 0 ? 'tunnel1' : 'tunnel2';
    return passee(t) || (nom === t && tau >= TUNNEL.decroche);
  };
  const coffreBaronOuvert = !!ex && ex.gagnant !== null && (passee('istanbul') || (nom === 'istanbul' && tau >= ISTANBUL.coffre));
  /** Le butin d'un wagon tel qu'on le voit à l'instant. */
  const butinVu = (k: number) => {
    if (!ex) return 0;
    let s = 0;
    if (coffre('paris', k) === 'ouvert') s += ex.paris[k] ?? 0;
    if (ex.venise[k] !== null && coffre('venise', k) === 'ouvert') s += ex.venise[k] ?? 0;
    if (coffreBaronOuvert && ex.gagnant === k) s += ex.coffre ?? 0;
    return s;
  };

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
    if (nom === 'intro' && tau > 250) fois('sifflet', () => jouerEffet('ex_sifflet'));
    if ((nom === 'paris' || nom === 'venise') && tau >= D - DEPART_AVANT_FIN) fois('depart', () => jouerEffet('ex_sifflet', { volume: 0.7 }));
    if ((nom === 'venise' || nom === 'istanbul') && tau >= 0) fois('freins', () => jouerEffet('ex_freins'));
    if (nom === 'paris' || nom === 'venise') {
      etat.attaches.forEach((k, rang) => {
        const t = (nom === 'paris' ? COFFRES.paris : COFFRES.venise) + COFFRES.pas * (rang + 1) - 60;
        if (tau >= t) fois(`coffre${k}`, () => jouerEffet('ex_coffre', { volume: k === mien ? 1 : 0.55, vitesse: 0.92 + rang * 0.04 }));
      });
    }
    if (tunnelDe(nom) >= 0) {
      fois('tunnel', () => jouerEffet('ex_tunnel'));
      if (tau >= TUNNEL.police) fois('police', () => jouerEffet('ex_police'));
      if (tau >= TUNNEL.decroche) fois('decroche', () => jouerEffet('ex_decroche'));
    }
    if (nom === 'istanbul' && tau >= ISTANBUL.panorama) fois('arrivee', () => jouerEffet('ex_arrivee'));
    if (nom === 'istanbul' && tau >= ISTANBUL.coffre) fois('coffreBaron', () => jouerEffet('ex_coffre'));
    // Le tchou-tchou tant que le train roule.
    const roule = estVoyage(nom) && allure(nom, tau, D) > 0.3;
    if (roule && maintenant >= prochainTchou.current) {
      prochainTchou.current = maintenant + 1900;
      jouerEffet('ex_tchou', { volume: tunnelDe(nom) >= 0 ? 0.9 : 0.7 });
    }
  });

  // L'annonce de l'étape.
  let annonce: { titre: string; sous?: string; ton?: string } | null = null;
  const tombes = (t: number) => (ex ? ex.decroches.map((d, k) => (d === t ? k : -1)).filter((k) => k >= 0) : []);
  if (nom === 'paris') annonce = tau < COFFRES.paris + 400 ? { titre: tr('Gare de Paris', 'Paris station'), sous: tr('Le butin de départ !', 'The starting loot!') } : tau >= D - DEPART_AVANT_FIN ? { titre: tr('En voiture !', 'All aboard!'), ton: 'petit' } : null;
  else if (tunnelDe(nom) >= 0) {
    const t = tunnelDe(nom);
    const noms = tombes(t).map(nomWagon).join(tr(' et ', ' and '));
    annonce =
      tau < TUNNEL.decroche
        ? { titre: t === 0 ? tr('Tunnel du Simplon', 'Simplon Tunnel') : tr('Tunnel des Balkans', 'Balkan Tunnel'), sous: tr('La police à cheval !', 'The mounted police!'), ton: 'police' }
        : { titre: tr(`${noms} décrochés !`, `${noms} uncoupled!`), sous: t === 0 ? tr('Plus que 3 wagons', '3 carriages left') : tr('Il n’en reste qu’un !', 'Only one left!'), ton: 'police' };
  } else if (nom === 'alpes') annonce = { titre: tr('Les Alpes', 'The Alps'), sous: tr('Cap sur Venise', 'Heading for Venice') };
  else if (nom === 'venise') annonce = tau < COFFRES.venise + 300 ? { titre: tr('Gare de Venise', 'Venice station'), sous: tr('Les coffres de Venise !', 'The Venice safes!') } : tau >= D - DEPART_AVANT_FIN ? { titre: tr('Dernière ligne droite !', 'Final stretch!'), ton: 'petit' } : null;
  else if (nom === 'istanbul') annonce = tau < ISTANBUL.panorama ? { titre: tr('Istanbul !', 'Istanbul!') } : null;

  const panorama = (nom === 'istanbul' && tau >= ISTANBUL.panorama) || nom === 'revele';
  const gagnant = ex?.gagnant ?? null;
  const voyage = estVoyage(nom);

  return (
    <div className={`bwx ${nom} ${panorama ? 'panorama' : ''}`} ref={refs.scene}>
      {(nom === 'intro' || nom === 'wagons') && <div className="bwx-depart" />}
      {voyage && <div className={`bwx-bande ${DECORS[nom]}`} ref={refs.bande} style={{ backgroundImage: `url(/cartes/bw-ex-${DECORS[nom]}.webp)` }} />}
      {voyage && <div className="bwx-volet" key={`volet-${nom}`} />}
      {voyage && estGare(nom) && <img className="bwx-gare" ref={refs.gare} src="/cartes/bw-ex-gare.webp" alt="" draggable={false} />}
      {voyage && tunnelDe(nom) >= 0 && <div className="bwx-noir" key={`noir-${nom}`} />}

      <div className={`bwx-train ${voyage ? '' : 'cache'}`} aria-hidden="true">
        {refs.fumees.map((r, k) => (
          <img key={k} className="bwx-fumee" ref={r} src="/cartes/bw-ex-fumee-1.webp" alt="" draggable={false} />
        ))}
        {[4, 3, 2, 1, 0].map((k) => {
          const cp = coffre('paris', k);
          const cv = ex?.venise[k] !== null && nom === 'venise' ? coffre('venise', k) : null;
          const c = nom === 'paris' ? cp : nom === 'venise' ? cv : null;
          const valeur = nom === 'paris' ? ex?.paris[k] : ex?.venise[k];
          return (
            <div key={k} className={`bwx-wagon ${k === mien ? 'mien' : ''}`} ref={refs.wagons[k]}>
              <img src={`/cartes/bw-ex-wagon-${k + 1}.webp`} alt="" draggable={false} />
              <span className="bwx-plaque" style={{ '--couleur': WAGONS_EXPRESS[k].couleur, '--texte': WAGONS_EXPRESS[k].texte } as CSSProperties}>
                {k === mien ? '★ ' : ''}
                {nomWagon(k)}
              </span>
              {c && (
                <span className={`bwx-coffre ${c}`}>
                  <img src={c === 'ouvert' ? '/cartes/bw-ex-coffre-ouvert.webp' : '/cartes/bw-ex-coffre.webp'} alt="" draggable={false} />
                  {c === 'ouvert' && valeur != null && <b className={valeur >= 50 ? 'gros' : ''}>+{fx(valeur)}</b>}
                </span>
              )}
            </div>
          );
        })}
        <div className="bwx-loco" ref={refs.loco}>
          <img src="/cartes/bw-ex-loco.webp" alt="" draggable={false} />
        </div>
        {tunnelDe(nom) >= 0 && <img className="bwx-gendarme" ref={refs.gendarme} src="/cartes/bw-ex-gendarme.webp" alt="" draggable={false} />}
      </div>

      {panorama && (
        <div className="bwx-arrivee" aria-hidden="true">
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
          <img className="bwx-baron" src="/cartes/bw-ex-baron.webp" alt="" draggable={false} />
          <div className="bwx-titre-intro">
            <small>{tr('La case unique de la roue', 'The wheel’s one-of-a-kind spot')}</small>
            <strong>{tr('L’Express du Baron', 'The Baron Express')}</strong>
            <span>Paris → Istanbul</span>
            <em>{tr('5 wagons au départ… un seul arrivera !', '5 carriages leave… only one will arrive!')}</em>
          </div>
        </div>
      )}

      {nom === 'wagons' && (
        <div className="bwx-choix" role="group" aria-label={tr('Choisis ton wagon', 'Pick your carriage')}>
          {WAGONS_EXPRESS.map((w, k) => (
            <button key={k} type="button" className={`bwx-choix-wagon ${mien === k ? 'choisi' : ''} ${mien !== null && mien !== k ? 'autre' : ''}`} onClick={() => choisir(k)} disabled={!ouvert} style={{ '--couleur': w.couleur, '--texte': w.texte } as CSSProperties}>
              <img src={`/cartes/bw-ex-wagon-${k + 1}.webp`} alt="" draggable={false} />
              <span>{tr(...w.nom)}</span>
              {salon[k] ? <i>{salon[k]}</i> : null}
            </button>
          ))}
        </div>
      )}

      {annonce && (
        <div className={`bwx-annonce ${annonce.ton ?? ''}`} key={`${nom}-${annonce.titre}`} role="status">
          <strong>{insecable(annonce.titre)}</strong>
          {annonce.sous && <span>{insecable(annonce.sous)}</span>}
        </div>
      )}

      {nom === 'istanbul' && panorama && gagnant !== null && (
        <div className="bwx-coffre-baron" style={{ '--couleur': WAGONS_EXPRESS[gagnant].couleur, '--texte': WAGONS_EXPRESS[gagnant].texte } as CSSProperties}>
          <small>{tr(`Le wagon ${nomWagon(gagnant)} arrive à Istanbul !`, `The ${nomWagon(gagnant)} carriage reaches Istanbul!`)}</small>
          <img src={coffreBaronOuvert ? '/cartes/bw-ex-coffre-ouvert.webp' : '/cartes/bw-ex-coffre.webp'} alt="" draggable={false} className={coffreBaronOuvert ? 'ouvert' : ''} />
          <strong>{coffreBaronOuvert && ex?.coffre != null ? tr(`Coffre du Baron ${fx(ex.coffre)}\u00a0!`, `The Baron’s Safe ${fx(ex.coffre)}!`) : tr('Le Coffre du Baron…', 'The Baron’s Safe…')}</strong>
        </div>
      )}

      {nom !== 'intro' && nom !== 'wagons' && (
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
                <strong key={butin}>{butin ? fx(butin) : '—'}</strong>
                <small>{arrive ? tr('Arrivé !', 'Arrived!') : tombe ? tr('Décroché', 'Uncoupled') : salon[k] ? tr(`${salon[k]} joueur${salon[k] > 1 ? 's' : ''}`, `${salon[k]} player${salon[k] > 1 ? 's' : ''}`) : tr('En route', 'On board')}</small>
                {k === mien && b.mise > 0 && butin > 0 && <em>{dollars(Math.floor(b.mise * butin * b.multiplicateur))}</em>}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
