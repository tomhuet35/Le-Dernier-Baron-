/**
 * Sur les toits (Salon privé, au Bar) : le Monte-en-l'air du Baron court sur le toit d'un train de nuit, de wagon en
 * wagon, jusqu'au fourgon blindé. On choisit sa mise et la difficulté (Promenade, Express, Rapide de nuit, Le Baron),
 * puis on saute : chaque saut réussi fait monter le multiplicateur, un tunnel trop bas ou un attelage qui casse fait
 * tout perdre. On encaisse quand on veut ; le fourgon (dixième saut) s'encaisse de lui-même. Le serveur tire chaque saut
 * et tient la partie.
 *
 * La scène : le train vu de profil (les wagons de l'Express, le fourgon, la locomotive), le paysage et la voie qui
 * défilent, la caméra qui suit le coureur. Le coureur, le tunnel, l'attelage et la caméra sont placés à chaque image
 * (requestAnimationFrame) d'après l'action en cours (un saut, sa réussite ou sa chute).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { MULTIPLE_GROS_GAIN, type VueCasino } from '../../shared/casino';
import { echelleToits, MISES_TOITS, NIVEAUX_TOITS, NOMS_NIVEAUX_TOITS, RISQUE_TOITS, SAUTS_TOITS, type NiveauToits, type ObstacleToits, type VueToits } from '../../shared/toits';
import type { Appel } from './App';
import { dollars, dollarsCourt, Jeton, LINGOTS_PALIER, PluieLingots, useSoldeAnime } from './casinoOutils';
import { tr } from './traduction';
import { jouerEffet, mouvementReduit, useCompteur } from './ui';
import './toits.css';

const x2 = (x: number) => `×${x.toLocaleString(tr('fr-FR', 'en-US'), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const CLE_REGLAGES = 'ldb-toits';
const IMG = (n: string) => `/cartes/${n}.webp`;

/** Toutes les images du jeu (préchargées). */
export const IMAGES_TOITS = [
  'tt-court',
  'tt-saut',
  'tt-atterrit',
  'tt-chute',
  'tt-baisse',
  'tt-victoire',
  'tt-fourgon',
  'tt-tunnel',
  'tt-attelage-g',
  'tt-attelage-d',
  'tt-decor-promenade',
  'tt-decor-express',
  'tt-decor-rapide',
  'tt-decor-baron',
  'tt-premier-plan',
  'tt-niv-promenade',
  'tt-niv-express',
  'tt-niv-rapide',
  'tt-niv-baron',
  'bw-ex2-wagon-1',
  'bw-ex2-wagon-2',
  'bw-ex2-wagon-3',
  'bw-ex2-wagon-4',
  'bw-ex2-wagon-5',
  'bw-ex2-loco',
  'bw-ex2-alpes-voie',
];

// ---------------------------------------------------------------------------------------------------------------
// Le train et le coureur (mesures en part de la hauteur d'un wagon, h)

/** Les voitures, de l'arrière à l'avant : dix wagons (0 : le départ), le fourgon (10), la locomotive. */
const VOITURES = [...Array.from({ length: SAUTS_TOITS }, (_, i) => `bw-ex2-wagon-${(i % 5) + 1}`), 'tt-fourgon', 'bw-ex2-loco'];
/** Rapport hauteur / largeur de chaque image, et où se trouve le toit (part de la hauteur, depuis le bas). */
const FORME: Record<string, { ratio: number; toit: number }> = {
  wagon: { ratio: 344 / 1100, toit: 0.95 },
  'tt-fourgon': { ratio: 369 / 1100, toit: 0.76 },
  'bw-ex2-loco': { ratio: 338 / 1100, toit: 0.9 },
};
const forme = (nom: string) => FORME[nom] ?? FORME.wagon;
/** Les poses du coureur : rapport hauteur / largeur, largeur (part de h), et où sont ses pieds (part de sa hauteur). */
const POSES = {
  court: { ratio: 397 / 520, l: 1.05, pieds: 0.97 },
  saut: { ratio: 369 / 560, l: 1.15, pieds: 0.9 },
  atterrit: { ratio: 374 / 520, l: 1.0, pieds: 0.97 },
  chute: { ratio: 377 / 560, l: 1.1, pieds: 0.6 },
  victoire: { ratio: 635 / 420, l: 0.62, pieds: 0.98 },
  baisse: { ratio: 179 / 620, l: 1.55, pieds: 0.97 },
};
type Pose = keyof typeof POSES;
/** La vitesse du train (largeurs d'écran par seconde) selon la difficulté. */
const VITESSE: Record<NiveauToits, number> = { promenade: 0.55, express: 0.9, rapide: 1.3, baron: 1.7 };
/** Le saut : la course jusqu'au bord, le vol, l'atterrissage, la course jusqu'au milieu du wagon suivant. */
const T = { course: 380, vol: 520, pose: 200, suite: 420 };
const DUREE_SAUT = T.course + T.vol + T.pose + T.suite;
/**
 * Le tunnel en coupe (1800 × 582) : l'arche du portail (bas des rails, haut de l'arche), le bord gauche du portail et
 * sa largeur (la partie dessinée devant le train) ; l'arche fait un peu plus qu'un wagon de haut.
 */
const TUNNEL = { w: 1800, h: 582, rails: 515, arche: 363, face: 52, portail: 290, hauteurArche: 1.1 };
/** La chute : le moment du choc (tunnel) ou du décrochage, la chute elle-même. */
const CHUTE = { choc: T.course + T.vol * 0.45, decroche: T.course - 180, duree: 1100 };

interface Geo {
  W: number;
  H: number;
  h: number;
  ww: number;
  pas: number;
  /** Le bas des roues. */
  sol: number;
}
function mesurer(W: number, H: number): Geo {
  const h = Math.min(H * 0.27, W * 0.33);
  const ww = h / FORME.wagon.ratio;
  return { W, H, h, ww, pas: ww + h * 0.2, sol: H * 0.86 };
}
const xVoiture = (g: Geo, i: number) => i * g.pas;
const yToit = (g: Geo, i: number) => {
  const f = forme(VOITURES[i]);
  return g.sol - g.ww * f.ratio * f.toit;
};
/** Où se tient le coureur sur le wagon i (vers l'avant), où il prend son élan, où il atterrit. */
const xArret = (g: Geo, i: number) => xVoiture(g, i) + g.ww * 0.68;
const xBord = (g: Geo, i: number) => xVoiture(g, i) + g.ww - g.h * 0.2;
const xPose = (g: Geo, i: number) => xVoiture(g, i + 1) + g.h * 0.45;

const borne = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u);
const lisse = (u: number) => {
  const x = borne(u);
  return x * x * (3 - 2 * x);
};

/** L'action en cours : un saut (de k à k + 1), son issue (inconnue tant que le serveur n'a pas répondu). */
interface Action {
  k: number;
  debut: number;
  issue: 'ok' | ObstacleToits | null;
  /** Quand l'issue est arrivée après le bord : le temps passé à attendre au bord. */
  attente: number;
}

interface Refs {
  scene: { current: HTMLDivElement | null };
  monde: { current: HTMLDivElement | null };
  ciel: { current: HTMLDivElement | null };
  premier: { current: HTMLDivElement | null };
  voie: { current: HTMLDivElement | null };
  voitures: { current: HTMLImageElement | null }[];
  plaques: { current: HTMLSpanElement | null }[];
  poses: Record<Pose, { current: HTMLImageElement | null }>;
  tunnel: { current: HTMLImageElement | null };
  portail: { current: HTMLDivElement | null };
  attelageG: { current: HTMLImageElement | null };
  attelageD: { current: HTMLImageElement | null };
}
const ref = <T,>() => ({ current: null as T | null });

interface Etat {
  sauts: number;
  niveau: NiveauToits;
  fini: 'perdu' | 'encaisse' | null;
  action: Action | null;
  /** Avant la partie : il attend, allongé sur le toit du dernier wagon. */
  pret: boolean;
}

function useScene(etat: { current: Etat }, r: Refs) {
  useEffect(() => {
    const el = r.scene.current;
    if (!el) return;
    const t = { W: el.clientWidth, H: el.clientHeight };
    const ro = new ResizeObserver(() => {
      t.W = el.clientWidth;
      t.H = el.clientHeight;
    });
    ro.observe(el);
    let raf = 0;
    let camera: number | null = null;
    let parcours = 0;
    let avant = performance.now();
    const image = () => {
      raf = requestAnimationFrame(image);
      const { W, H } = t;
      if (!W || !H) return;
      const e = etat.current;
      const g = mesurer(W, H);
      const now = performance.now();
      const dt = Math.min(100, now - avant);
      avant = now;
      const reduit = mouvementReduit();
      parcours += (dt / 1000) * VITESSE[e.niveau] * W * (reduit ? 0.3 : 1);

      // Le coureur : sa place, sa pose (selon l'action en cours).
      let pose: Pose = e.fini === 'encaisse' ? 'victoire' : e.pret ? 'baisse' : 'atterrit';
      let k = e.sauts;
      let rx = xArret(g, k);
      let ry = yToit(g, k);
      let rot = 0;
      let visible = e.fini !== 'perdu';
      let decalage = 0;
      let tunnelX: number | null = null;
      let attelage = 0;
      const a = e.action;
      if (a) {
        k = a.k;
        let s = now - a.debut;
        // Au bord, il attend la réponse du serveur (en courant sur place).
        if (a.issue === null) s = Math.min(s, T.course);
        else s -= a.attente;
        const sv = s - T.course;
        if (s < T.course) {
          const u = s / T.course;
          rx = xArret(g, k) + (xBord(g, k) - xArret(g, k)) * u;
          ry = yToit(g, k) - (reduit ? 0 : Math.abs(Math.sin(now / 90)) * g.h * 0.04);
          pose = 'court';
        } else {
          const u = sv / T.vol;
          const x0 = xBord(g, k);
          const x1 = xPose(g, k);
          const y0 = yToit(g, k);
          const y1 = yToit(g, k + 1);
          const vol = (uu: number) => ({ x: x0 + (x1 - x0) * uu, y: y0 + (y1 - y0) * uu - Math.sin(Math.PI * uu) * g.h * 0.6 });
          if (a.issue === 'tunnel') {
            const uc = (CHUTE.choc - T.course) / T.vol;
            if (u < uc) ({ x: rx, y: ry } = vol(u)), (pose = 'saut');
            else {
              const p = vol(uc);
              const q = (s - CHUTE.choc) / CHUTE.duree;
              rx = p.x - g.h * 2.2 * lisse(q * 1.4);
              ry = p.y + (H * 1.2) * q * q - g.h * 0.4 * Math.sin(Math.PI * borne(q * 2));
              rot = -50 * q;
              pose = 'chute';
              visible = q < 1;
            }
            // Le tunnel arrive de la droite et le heurte au moment du choc.
            const p = vol(uc);
            const sc = (g.h * TUNNEL.hauteurArche) / (TUNNEL.rails - TUNNEL.arche);
            tunnelX = p.x + g.h * 0.3 - TUNNEL.face * sc + (CHUTE.choc - s) * ((W * 1.3) / 1000);
          } else if (a.issue === 'attelage') {
            ({ x: rx, y: ry } = vol(Math.min(u, 0.75)));
            pose = 'saut';
            if (u > 0.75) {
              const q = (u - 0.75) * (T.vol / CHUTE.duree);
              rx += g.h * 0.6 * q;
              ry += H * 1.1 * q * q * 2.4;
              rot = 30 * q;
              pose = 'chute';
              visible = q < 1;
            }
          } else if (u < 1) {
            ({ x: rx, y: ry } = vol(u));
            pose = 'saut';
          } else if (sv < T.vol + T.pose) {
            rx = x1;
            ry = y1;
            pose = 'atterrit';
          } else {
            const q = borne((sv - T.vol - T.pose) / T.suite);
            rx = x1 + (xArret(g, k + 1) - x1) * q;
            ry = y1 - (reduit ? 0 : Math.abs(Math.sin(now / 90)) * g.h * 0.04) * (q < 1 ? 1 : 0);
            pose = q < 1 ? 'court' : 'atterrit';
          }
        }
        // L'attelage cède : l'avant du train s'éloigne.
        if (a.issue === 'attelage') {
          const q = Math.max(0, s - CHUTE.decroche) / 1000;
          attelage = Math.min(1, q * 4);
          decalage = g.h * 4 * q * q + g.h * 0.6 * q;
        }
      }

      // La caméra suit le coureur (sans quitter le train).
      const cible = Math.max(-W * 0.05, Math.min(rx - W * 0.42, xVoiture(g, VOITURES.length - 1) + g.ww - W * 0.9));
      if (camera === null) camera = cible;
      camera += (cible - camera) * Math.min(1, dt / (a && a.issue !== 'tunnel' && a.issue !== 'attelage' ? 160 : 260));
      const m = r.monde.current;
      if (m) m.style.transform = `translate3d(${-camera}px, 0, 0)`;
      // Le décor (au-dessus de la voie), le premier plan qui file derrière le train.
      // Le bas du décor est derrière les wagons (à mi-hauteur) : son paysage se voit au-dessus des toits.
      const horizon = g.sol - g.h * 0.1;
      const ciel = r.ciel.current;
      if (ciel) {
        ciel.style.height = `${g.sol - g.h * 0.5}px`;
        ciel.style.backgroundPosition = `${-(parcours * 0.06 + camera * 0.08)}px 100%`;
      }
      const premier = r.premier.current;
      if (premier) {
        premier.style.top = `${horizon - g.h * 1.45}px`;
        premier.style.height = `${g.h * 1.5}px`;
        premier.style.backgroundPosition = `${-(parcours * 0.45 + camera * 0.5)}px 100%`;
      }
      const voie = r.voie.current;
      if (voie) {
        voie.style.top = `${g.sol - g.h * 0.12}px`;
        voie.style.height = `${g.h * 0.42}px`;
        voie.style.backgroundPosition = `${-(parcours + camera)}px 0`;
      }

      // Le train, ses plaques ; l'avant s'éloigne si l'attelage casse.
      r.voitures.forEach((rv, i) => {
        const v = rv.current;
        if (!v) return;
        const f = forme(VOITURES[i]);
        const hv = g.ww * f.ratio;
        const dx = a?.issue === 'attelage' && i > (a?.k ?? 0) ? decalage : 0;
        const bob = reduit ? 0 : Math.sin(now / 130 + i * 1.7) * g.h * 0.008;
        v.style.width = `${g.ww}px`;
        v.style.transform = `translate3d(${xVoiture(g, i) + dx}px, ${g.sol - hv + bob}px, 0)`;
        const pl = r.plaques[i]?.current;
        // Une plaque coupée par le bord de la scène ne se montre pas (elle apparaît en entrant).
        const xc = xVoiture(g, i) + g.ww / 2 + dx - (camera ?? 0);
        const demi = g.h * (i === SAUTS_TOITS ? 0.6 : 0.45);
        if (pl) pl.style.opacity = String(borne(Math.min(xc - demi, W - xc - demi) / (g.h * 0.3)));
        if (pl) pl.style.transform = `translate3d(${xVoiture(g, i) + g.ww / 2 + dx}px, ${yToit(g, i) - g.h * (i === SAUTS_TOITS ? 1.45 : 1.25)}px, 0) translate(-50%, -100%)`;
      });
      // L'attelage qui casse, entre le wagon k et le suivant : chaque moitié part avec son wagon.
      const ag = r.attelageG.current;
      const ad = r.attelageD.current;
      if (ag && ad) {
        const vu = attelage > 0 ? '1' : '0';
        ag.style.opacity = ad.style.opacity = vu;
        const ah = g.h * 0.5;
        const aw = (ah * 286) / 248;
        const xg = xVoiture(g, a?.k ?? 0) + g.ww;
        const xd = xVoiture(g, (a?.k ?? 0) + 1) + decalage;
        const y = g.sol - g.h * 0.2 - ah / 2;
        ag.style.width = ad.style.width = `${aw}px`;
        ag.style.transform = `translate3d(${xg - aw * 0.35}px, ${y}px, 0) rotate(${8 * attelage}deg)`;
        ad.style.transform = `translate3d(${xd - aw * 0.65}px, ${y}px, 0)`;
      }
      // Le tunnel en coupe : la galerie derrière le train, le portail devant lui.
      const tu = r.tunnel.current;
      const po = r.portail.current;
      if (tu && po) {
        const vu = tunnelX !== null && tunnelX < camera + W * 1.2;
        tu.style.visibility = po.style.visibility = vu ? 'visible' : 'hidden';
        if (vu && tunnelX !== null) {
          const sc = (g.h * TUNNEL.hauteurArche) / (TUNNEL.rails - TUNNEL.arche);
          const tw = TUNNEL.w * sc;
          const th = TUNNEL.h * sc;
          const y = g.sol - TUNNEL.rails * sc;
          tu.style.width = `${tw}px`;
          tu.style.transform = `translate3d(${tunnelX}px, ${y}px, 0)`;
          po.style.width = `${TUNNEL.portail * sc}px`;
          po.style.height = `${th}px`;
          po.style.backgroundSize = `${tw}px ${th}px`;
          po.style.transform = `translate3d(${tunnelX}px, ${y}px, 0)`;
        }
      }
      // Le coureur.
      (Object.keys(POSES) as Pose[]).forEach((p) => {
        const im = r.poses[p].current;
        if (!im) return;
        const vu = visible && p === pose;
        im.style.visibility = vu ? 'visible' : 'hidden';
        if (!vu) return;
        const P = POSES[p];
        const w = g.h * P.l;
        const hp = w * P.ratio;
        im.style.width = `${w}px`;
        im.style.transform = `translate3d(${rx - w / 2}px, ${ry - hp * P.pieds}px, 0) rotate(${rot}deg)`;
      });
    };
    raf = requestAnimationFrame(image);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [etat, r]);
}

// ---------------------------------------------------------------------------------------------------------------
// L'écran

function lireReglages(): { mise: number; niveau: NiveauToits } {
  try {
    const r = JSON.parse(localStorage.getItem(CLE_REGLAGES) ?? '{}') as { mise?: number; niveau?: NiveauToits };
    return { mise: MISES_TOITS.includes(r.mise ?? 0) ? r.mise! : 10_000, niveau: r.niveau && NIVEAUX_TOITS.includes(r.niveau) ? r.niveau : 'express' };
  } catch {
    return { mise: 10_000, niveau: 'express' };
  }
}

function AnnonceToits({ montant, x, gros, fourgon }: { montant: number; x: number; gros: boolean; fourgon: boolean }) {
  const valeur = useCompteur(montant, Math.round(montant / 20), 0, gros ? 1600 : 900);
  return (
    <div className={`tt-gain ${gros ? 'gros' : ''}`} aria-live="polite">
      <span>{fourgon ? tr('Le fourgon blindé !', 'The armored van!') : gros ? tr('Quel butin !', 'What a haul!') : tr('Encaissé !', 'Cashed out!')}</span>
      <em>{x2(x)}</em>
      <strong>+{dollars(valeur)}</strong>
      <small>{tr('ajoutés à ton solde', 'added to your balance')}</small>
    </div>
  );
}

export function JeuToits({ vue, appel, onVue, onRetour }: { vue: VueCasino; appel: Appel; onVue: (v: VueCasino) => void; onRetour: () => void }) {
  const [partie, setPartie] = useState<VueToits | null>(null);
  const [reglages, setReglages] = useState(lireReglages);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [annonce, setAnnonce] = useState<{ montant: number; x: number; gros: boolean; fourgon: boolean; id: number } | null>(null);
  const [pluie, setPluie] = useState<{ n: number; id: number } | null>(null);
  const [credit, setCredit] = useState<{ montant: number; id: number } | null>(null);
  const [chute, setChute] = useState<ObstacleToits | null>(null);
  /** Le saut joue son animation : les boutons attendent. */
  const [enSaut, setEnSaut] = useState(false);
  const minuteries = useRef<number[]>([]);
  const vueRef = useRef(vue);
  vueRef.current = vue;
  const solde = useSoldeAnime(vue.solde);
  const plusTard = (f: () => void, ms: number) => minuteries.current.push(window.setTimeout(f, ms));
  useEffect(() => () => minuteries.current.forEach((m) => window.clearTimeout(m)), []);
  useEffect(() => window.scrollTo(0, 0), []);

  // La scène (ce que lit l'animation à chaque image).
  const etat = useRef<Etat>({ sauts: 0, niveau: reglages.niveau, fini: null, action: null, pret: true });
  const refs = useRef<Refs | null>(null);
  if (!refs.current)
    refs.current = {
      scene: ref(),
      monde: ref(),
      ciel: ref(),
      premier: ref(),
      voie: ref(),
      voitures: VOITURES.map(() => ref()),
      plaques: VOITURES.map(() => ref()),
      poses: { court: ref(), saut: ref(), atterrit: ref(), chute: ref(), victoire: ref(), baisse: ref() },
      tunnel: ref(),
      portail: ref(),
      attelageG: ref(),
      attelageD: ref(),
    };
  const r = refs.current;
  useScene(etat, r);

  // Une partie en cours attend peut-être le joueur.
  useEffect(() => {
    void appel('casino_toits_vue').then((x) => {
      const p = (x as unknown as { toits?: VueToits | null }).toits;
      if (x.ok && p?.etat === 'enCours') {
        setPartie(p);
        etat.current = { sauts: p.sauts, niveau: p.niveau, fini: null, action: null, pret: false };
      }
    });
  }, [appel]);

  useEffect(() => {
    try {
      localStorage.setItem(CLE_REGLAGES, JSON.stringify(reglages));
    } catch {
      /* préférence non gardée */
    }
  }, [reglages]);

  const enCours = partie?.etat === 'enCours';
  const niveau = partie ? partie.niveau : reglages.niveau;
  const echelle = useMemo(() => echelleToits(niveau), [niveau]);
  if (!partie && !etat.current.action) etat.current.niveau = reglages.niveau;

  // L'orage du Baron (celui des Balkans du Rapide de Minuit) : un éclair, puis le tonnerre, toutes les 6 à 11 s.
  const [eclair, setEclair] = useState(0);
  useEffect(() => {
    if (niveau !== 'baron') return;
    let id = 0;
    const suivant = () => {
      id = window.setTimeout(() => {
        setEclair((n) => n + 1);
        window.setTimeout(() => setEclair((n) => -Math.abs(n)), 600);
        window.setTimeout(() => jouerEffet('ex_tonnerre', { volume: 0.4 }), 250);
        suivant();
      }, 6_000 + Math.random() * 5_000);
    };
    id = window.setTimeout(() => {
      setEclair(1);
      window.setTimeout(() => setEclair(-1), 600);
      suivant();
    }, 1_500);
    return () => window.clearTimeout(id);
  }, [niveau]);

  const majSolde = (s: unknown, encore: boolean) => {
    if (typeof s === 'number') onVue({ ...vueRef.current, solde: s, toits: { enCours: encore } });
  };

  const fin = (p: VueToits) => {
    if (p.etat === 'perdu') {
      setChute(p.obstacle);
      jouerEffet(p.obstacle === 'attelage' ? 'ex_decroche' : 'ex_tunnel');
      plusTard(() => jouerEffet('cf_perdu'), 900);
      return;
    }
    const gros = p.gain >= MULTIPLE_GROS_GAIN * p.mise || p.gain >= 1_000_000;
    jouerEffet(gros ? 'cf_gros' : 'cf_encaisse');
    setAnnonce({ montant: p.gain, x: p.x, gros, fourgon: p.sauts >= SAUTS_TOITS, id: Date.now() });
    plusTard(() => setAnnonce(null), gros ? 3600 : 2400);
    setCredit({ montant: p.gain, id: Date.now() });
    plusTard(() => setCredit(null), 2600);
    if (!mouvementReduit()) {
      const n = p.gain >= 50 * MULTIPLE_GROS_GAIN * p.mise ? LINGOTS_PALIER.colossal : gros ? LINGOTS_PALIER.enorme : p.x >= 10 ? LINGOTS_PALIER.gros : 20;
      setPluie({ n, id: Date.now() });
      if (gros) plusTard(() => jouerEffet('lingots_pluie'), 250);
      plusTard(() => setPluie(null), 4400);
    }
  };

  const lancer = async () => {
    if (envoi) return;
    if (reglages.mise > vue.solde) return setErreur(tr('Solde insuffisant pour cette mise.', 'Not enough money for this bet.'));
    setEnvoi(true);
    setErreur(null);
    setAnnonce(null);
    setChute(null);
    const x = await appel('casino_toits_lancer', reglages);
    setEnvoi(false);
    if (!x.ok) return setErreur(x.erreur ?? tr('Action impossible.', 'Action not allowed.'));
    const p = (x as unknown as { toits: VueToits; solde: number }).toits;
    jouerEffet('jeton');
    jouerEffet('ex_sifflet', { volume: 0.5 });
    setPartie(p);
    etat.current = { sauts: 0, niveau: p.niveau, fini: null, action: null, pret: false };
    majSolde((x as unknown as { solde: number }).solde, true);
  };

  const sauter = async () => {
    if (!enCours || envoi || enSaut) return;
    setEnvoi(true);
    setEnSaut(true);
    setErreur(null);
    const action: Action = { k: partie!.sauts, debut: performance.now(), issue: null, attente: 0 };
    etat.current = { ...etat.current, action };
    jouerEffet('tt_pas');
    const x = await appel('casino_toits_sauter');
    setEnvoi(false);
    if (!x.ok) {
      etat.current = { ...etat.current, action: null };
      setEnSaut(false);
      return setErreur(x.erreur ?? tr('Action impossible.', 'Action not allowed.'));
    }
    const res = x as unknown as { toits: VueToits; solde: number };
    const p = res.toits;
    const ecoule = performance.now() - action.debut;
    action.attente = Math.max(0, ecoule - T.course);
    action.issue = p.etat === 'perdu' ? (p.obstacle ?? 'attelage') : 'ok';
    const depart = Math.max(0, T.course - ecoule);
    plusTard(() => jouerEffet('tt_saut'), depart);
    if (p.etat === 'perdu') {
      plusTard(() => {
        etat.current = { sauts: p.sauts, niveau: p.niveau, fini: 'perdu', action, pret: false };
        setEnSaut(false);
      }, depart + T.vol + CHUTE.duree);
      plusTard(() => {
        setPartie(p);
        majSolde(res.solde, false);
        fin(p);
      }, depart + (p.obstacle === 'tunnel' ? CHUTE.choc - T.course : T.vol * 0.75));
      return;
    }
    plusTard(() => jouerEffet('tt_atterrit'), depart + T.vol);
    plusTard(() => {
      setPartie(p);
      if (p.etat === 'encaisse') {
        majSolde(res.solde, false);
        fin(p);
      }
    }, depart + T.vol + T.pose);
    plusTard(() => {
      etat.current = { sauts: p.sauts, niveau: p.niveau, fini: p.etat === 'encaisse' ? 'encaisse' : null, action: null, pret: false };
      setEnSaut(false);
    }, depart + DUREE_SAUT - T.course);
  };

  const encaisser = async () => {
    if (!enCours || envoi || enSaut) return;
    setEnvoi(true);
    const x = await appel('casino_toits_encaisser');
    setEnvoi(false);
    if (!x.ok) return setErreur(x.erreur ?? tr('Action impossible.', 'Action not allowed.'));
    const res = x as unknown as { toits: VueToits; solde: number };
    setPartie(res.toits);
    etat.current = { ...etat.current, fini: 'encaisse' };
    majSolde(res.solde, false);
    fin(res.toits);
  };

  const changerMise = (d: number) => {
    const i = MISES_TOITS.indexOf(reglages.mise) + d;
    if (i < 0 || i >= MISES_TOITS.length) return;
    jouerEffet('jeton');
    setReglages((x) => ({ ...x, mise: MISES_TOITS[i] }));
  };
  const choisirNiveau = (n: NiveauToits) => {
    if (n === reglages.niveau) return;
    jouerEffet('selection');
    setReglages((x) => ({ ...x, niveau: n }));
    if (!enCours) {
      setChute(null);
      etat.current = { sauts: 0, niveau: n, fini: null, action: null, pret: true };
    }
  };

  const sauts = partie?.sauts ?? 0;
  const message = !partie
    ? tr('Choisis ta mise et la difficulté, puis monte sur le toit du train.', 'Pick your bet and the difficulty, then climb onto the train’s roof.')
    : enCours
      ? enSaut
        ? tr('Il s’élance…', 'He leaps…')
        : sauts
          ? tr(`${sauts} wagon${sauts > 1 ? 's' : ''} ! Encore un saut… ou tu encaisses ?`, `${sauts} carriage${sauts > 1 ? 's' : ''}! One more jump… or cash out?`)
          : tr('Saute sur le wagon suivant !', 'Jump to the next carriage!')
      : partie.etat === 'perdu'
        ? chute === 'tunnel'
          ? tr('Le tunnel ! Il est fauché par la voûte…', 'The tunnel! He’s swept off by the arch…')
          : tr('L’attelage a cédé ! Il tombe entre les wagons…', 'The coupling broke! He falls between the carriages…')
        : partie.sauts >= SAUTS_TOITS
          ? tr(`Le fourgon blindé est à lui : ${dollars(partie.gain)} !`, `The armored van is his: ${dollars(partie.gain)}!`)
          : tr(`Butin encaissé : ${dollars(partie.gain)} !`, `Loot cashed out: ${dollars(partie.gain)}!`);

  return (
    <div className={`cas-ecran tt-ecran ${enCours ? 'en-cours' : ''}`} data-etat={partie?.etat ?? 'pret'}>
      <header className="cas-barre">
        <button type="button" className="cas-retour" onClick={onRetour}>
          ‹ {tr('Salon', 'Lounge')}
        </button>
        <h1 className="tt-titre">{tr('Sur les toits', 'On the Rooftops')}</h1>
        <span className={`cas-solde-petit tt-solde ${credit ? 'credite' : ''}`}>
          {dollars(solde)}
          {credit && (
            <b key={credit.id} className="tt-credit">
              +{dollars(credit.montant)}
            </b>
          )}
        </span>
      </header>

      <section className={`tt-scene ${niveau}`} ref={r.scene} aria-label={tr('Le train', 'The train')}>
        <div className={`tt-ciel ${eclair > 0 ? 'eclaire' : ''}`} ref={r.ciel} style={{ backgroundImage: `url(${IMG(`tt-decor-${niveau}`)})` }} />
        <div className="tt-premier" ref={r.premier} />
        {niveau === 'baron' && <div className="tt-pluie loin" aria-hidden="true" />}
        <div className="tt-voie" ref={r.voie} />
        <div className="tt-monde" ref={r.monde}>
          {VOITURES.map((v, i) => (
            <img key={`v${i}`} className={`tt-voiture ${i === SAUTS_TOITS ? 'fourgon' : ''}`} ref={r.voitures[i]} src={IMG(v)} alt="" draggable={false} />
          ))}
          <img className="tt-tunnel" ref={r.tunnel} src={IMG('tt-tunnel')} alt="" draggable={false} />
          <img className="tt-attelage" ref={r.attelageG} src={IMG('tt-attelage-g')} alt="" draggable={false} />
          <img className="tt-attelage" ref={r.attelageD} src={IMG('tt-attelage-d')} alt="" draggable={false} />
          {VOITURES.slice(1, SAUTS_TOITS + 1).map((_, j) => {
            const i = j + 1;
            return (
              <span key={`p${i}`} className={`tt-plaque ${i <= sauts && partie?.etat !== 'perdu' ? 'atteinte' : ''} ${enCours && i === sauts + 1 ? 'prochaine' : ''} ${i === SAUTS_TOITS ? 'fourgon' : ''}`} ref={r.plaques[i]}>
                {x2(echelle[j])}
              </span>
            );
          })}
          {(Object.keys(POSES) as Pose[]).map((p) => (
            <img key={p} className={`tt-coureur ${p}`} ref={r.poses[p]} src={IMG(`tt-${p}`)} alt="" draggable={false} />
          ))}
          <div className="tt-portail" ref={r.portail} />
        </div>
        {niveau === 'baron' && <div className="tt-pluie pres" aria-hidden="true" />}
        {eclair > 0 && <div className="tt-eclair" key={`eclair-${eclair}`} aria-hidden="true" />}
        <span className="tt-niveau-puce">
          <img src={IMG(`tt-niv-${niveau}`)} alt="" draggable={false} />
          {tr(...NOMS_NIVEAUX_TOITS[niveau])}
        </span>
        {partie?.etat === 'perdu' && (
          <span className="tt-tampon" role="status" key="perdu">
            {chute === 'tunnel' ? tr('Fauché par le tunnel !', 'Hit by the tunnel!') : tr('L’attelage a cédé !', 'The coupling broke!')}
          </span>
        )}
      </section>

      <section className="tt-commandes" aria-label={tr('Ta partie', 'Your game')}>
        <div className="tt-compteur">
          <div>
            <small>{tr('Multiplicateur', 'Multiplier')}</small>
            <strong className={enCours && sauts ? 'monte' : ''} key={`x${sauts}`}>
              {x2(partie && partie.etat !== 'perdu' ? partie.x : 1)}
            </strong>
          </div>
          <div>
            <small>{tr('Prochain saut', 'Next jump')}</small>
            <strong className="suivant">{enCours ? (partie!.suivant ? x2(partie!.suivant) : '—') : x2(echelle[0])}</strong>
          </div>
          <div>
            <small>{tr('Chute', 'Fall')}</small>
            <strong className="risque">{Math.round(RISQUE_TOITS[niveau] * 100)} %</strong>
          </div>
        </div>

        <p className={`tt-message ${partie?.etat ?? ''}`} role="status">
          {message}
        </p>

        {enCours ? (
          <div className="tt-actions">
            <button type="button" className="tt-encaisser" onClick={() => void encaisser()} disabled={!sauts || envoi || enSaut}>
              <span>{tr('Encaisser', 'Cash out')}</span>
              <strong>{dollars(partie!.gain || partie!.mise)}</strong>
            </button>
            <button type="button" className="cas-tourner tt-sauter" onClick={() => void sauter()} disabled={envoi || enSaut}>
              <span>{tr('Sauter', 'Jump')}</span>
              {partie!.suivant && <small>{x2(partie!.suivant)}</small>}
            </button>
            <p className="discret tt-mise-cours">
              {tr('Mise', 'Bet')} <strong>{dollars(partie!.mise)}</strong> · {tr(`wagon ${sauts} / ${SAUTS_TOITS}`, `carriage ${sauts} / ${SAUTS_TOITS}`)}
            </p>
          </div>
        ) : (
          <div className="tt-reglages">
            <div className="tt-niveaux" role="radiogroup" aria-label={tr('Difficulté', 'Difficulty')}>
              {NIVEAUX_TOITS.map((n) => (
                <button key={n} type="button" role="radio" aria-checked={n === reglages.niveau} className={`tt-niveau ${n} ${n === reglages.niveau ? 'choisi' : ''}`} onClick={() => choisirNiveau(n)} disabled={enSaut}>
                  <img src={IMG(`tt-niv-${n}`)} alt="" draggable={false} />
                  <strong>{tr(...NOMS_NIVEAUX_TOITS[n])}</strong>
                  <small>
                    {tr(`chute ${Math.round(RISQUE_TOITS[n] * 100)} %`, `${Math.round(RISQUE_TOITS[n] * 100)}% fall`)} · {x2(echelleToits(n)[SAUTS_TOITS - 1])}
                  </small>
                </button>
              ))}
            </div>
            <div className="cas-mise" aria-label={tr('Mise', 'Bet')}>
              <button type="button" onClick={() => changerMise(-1)} disabled={reglages.mise === MISES_TOITS[0]} aria-label={tr('Baisser la mise', 'Lower the bet')}>
                −
              </button>
              <span className="cas-mise-valeur">
                <Jeton valeur={reglages.mise} />
                <span>
                  <small>{tr('Mise', 'Bet')}</small>
                  <strong>{dollarsCourt(reglages.mise)}</strong>
                </span>
              </span>
              <button type="button" onClick={() => changerMise(1)} disabled={reglages.mise === MISES_TOITS[MISES_TOITS.length - 1]} aria-label={tr('Augmenter la mise', 'Raise the bet')}>
                +
              </button>
            </div>
            <button type="button" className="cas-tourner tt-lancer" onClick={() => void lancer()} disabled={envoi || enSaut || reglages.mise > vue.solde}>
              <span>{partie ? tr('Remonter sur le toit', 'Climb back up') : tr('Monter sur le toit', 'Climb onto the roof')}</span>
            </button>
          </div>
        )}
        {erreur && <p className="cas-erreur">{erreur}</p>}
        <p className="cas-mention">
          {tr(
            '10 sauts jusqu’au fourgon blindé. Chaque saut réussi fait monter le multiplicateur ; une chute, et la mise est perdue. Mise de 1 000 à 10 000 000 $, jusqu’à ×319,80 (Le Baron).',
            '10 jumps to the armored van. Each successful jump raises the multiplier; a fall, and the bet is lost. Bets from $1,000 to $10,000,000, up to ×319.80 (The Baron).',
          )}
        </p>
      </section>

      {pluie && <PluieLingots key={`pluie-${pluie.id}`} n={pluie.n} objets={['billet', 'lingot-butin', 'billet']} />}
      {annonce && <AnnonceToits key={`annonce-${annonce.id}`} montant={annonce.montant} x={annonce.x} gros={annonce.gros} fourgon={annonce.fourgon} />}
    </div>
  );
}
