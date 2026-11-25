/**
 * Le Pickpocket (la roue du Bal) : « Le Vol du collier ». Un vrai casse en plein bal, en photographies de cinéma.
 *
 * L'intro (9 s) : la musique casse sur une fausse note, les lustres vacillent ; le bal figé ; l'éclat du collier au cou
 * de la Comtesse ; le Pickpocket se faufile entre les couples ; le noir total, où seuls brillent les diamants ; la
 * lumière revient : le cou de la Comtesse est nu, et le voleur soulève son chapeau au fond de la salle.
 * Le vol : derrière son guéridon, il pose le collier (le butin est annoncé), les trois hauts-de-forme tombent du ciel,
 * celui du milieu le recouvre, et il les mélange (le bonneteau). Le choix, puis le retournement : la montre et la bague
 * sont les petits butins ; si le collier m'échappe, le voleur salue, collier en main.
 *
 * Le serveur a tiré le butin et les trois chapeaux dès le début du bonus ; il n'envoie le butin qu'au vol, et le contenu
 * des chapeaux qu'au retournement (le mélange est un spectacle : on ne peut pas suivre le collier).
 * L'intro est une suite d'animations CSS calées sur l'horloge de l'étape (--t0) ; la table est placée à chaque image
 * (requestAnimationFrame) d'après la même horloge.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { DUREES_BW, type VueBonusBW, type VueBW } from '../../shared/baronWheel';
import { ValeurMultipliee } from './CasinoBaronExpress';
import { tr } from './traduction';
import { jouerEffet, mouvementReduit, type EffetSonore } from './ui';
import './pickpocket.css';

const IMG = (n: string) => `/cartes/${n}.webp`;

/** Toutes les images du Pickpocket (sans chemin ni extension), préchargées avant le bonus. */
export const IMAGES_PICKPOCKET_NOMS = [
  'ppi-bal',
  'ppi-eclat',
  'ppi-faufile',
  'ppi-noir',
  'ppi-cri',
  'ppb-table',
  'ppb-salut',
  'ppb-chapeau',
  'ppb-collier',
  'ppb-montre',
  'ppb-bague',
  'ppb-diamant',
];

/** Les rapports hauteur / largeur des objets. */
const R = { chapeau: 500 / 520, collier: 855 / 900, montre: 646 / 520, bague: 578 / 520 };
/** La photo du guéridon (1672 × 941) : le plateau, et les trois places des chapeaux (pixels de la photo). */
const TABLE = { w: 1672, h: 941, places: [580, 830, 1080], pose: 800, chapeau: 215 };

// ---------------------------------------------------------------------------------------------------------------
// Le calendrier (millisecondes d'un vol de 6,5 s, d'un retournement de 7 s)

const REF_VOL = DUREES_BW.vol;
const REF_REVELE = DUREES_BW.revelePick;
/** Le vol : le collier tombe sur le plateau, les chapeaux tombent (celui du milieu le couvre), puis le tour. */
const VOL = { collier: 250, pose: 800, chapeaux: [2_000, 2_250, 2_100], chute: 420, melange: 2_950 };
/**
 * Le tour de passe-passe : à chaque passe, deux chapeaux échangent leurs places ; l'un s'envole par-dessus l'autre en
 * tournoyant, l'autre file en dessous. Deux fois, les lustres s'éteignent (noir) : quand la lumière revient, deux
 * chapeaux ont changé de place dans l'obscurité.
 */
interface Passe {
  a: number;
  b: number;
  d: number;
  noir?: boolean;
}
const PASSES: Passe[] = [
  { a: 0, b: 1, d: 520 },
  { a: 1, b: 2, d: 470 },
  { a: 0, b: 2, d: 430 },
  { a: 0, b: 1, d: 420, noir: true },
  { a: 1, b: 2, d: 380 },
  { a: 0, b: 2, d: 340 },
  { a: 1, b: 2, d: 420, noir: true },
];
const DEBUTS_PASSES = PASSES.map((_, i) => VOL.melange + PASSES.slice(0, i).reduce((a, p) => a + p.d + 40, 0));
/** Le noir d'une passe dans l'obscurité : la lumière tombe, puis revient en hoquetant. */
function noirA(s: number) {
  let o = 0;
  PASSES.forEach((p, i) => {
    if (!p.noir) return;
    const q = (s - DEBUTS_PASSES[i]) / p.d;
    if (q <= 0 || q >= 1) return;
    o = Math.max(o, q < 0.22 ? q / 0.22 : q < 0.7 ? 1 : q < 0.78 ? 0.35 : q < 0.84 ? 0.85 : (1 - q) / 0.16);
  });
  return o;
}
/** Les éclats du collier : où scintillent les diamants (en % de l'image du collier). */
const ECLATS: [number, number][] = [
  [50, 32],
  [50, 43],
  [50, 53],
  [50, 64],
  [50, 86],
  [22, 28],
  [78, 28],
  [31, 46],
  [69, 46],
  [38, 60],
  [62, 60],
  [14, 14],
];
/** Le retournement : le premier chapeau des autres, le second, puis le mien ; un chapeau se lève en 450 ms. Si le
 * collier m'a échappé, le voleur salue (salut). */
const RET = { premier: 500, second: 1500, mien: 3000, leve: 450, salut: 4_000 };

const borne = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u);
const lisse = (u: number) => {
  const x = borne(u);
  return x * x * (3 - 2 * x);
};

/** Où est chaque chapeau (place, et la passe en cours) pendant le tour. */
function chapeauxA(s: number): { place: number; vers: number; q: number; haut: boolean; noir: boolean }[] {
  const place = [0, 1, 2];
  const etat = place.map((p) => ({ place: p, vers: p, q: 0, haut: false, noir: false }));
  for (let i = 0; i < PASSES.length; i++) {
    const { a, b, d, noir = false } = PASSES[i];
    const q = (s - DEBUTS_PASSES[i]) / d;
    const ha = place.indexOf(a);
    const hb = place.indexOf(b);
    // Dans le noir, l'échange se fait d'un coup, au cœur de l'obscurité.
    if (q >= 1 || (noir && q >= 0.5)) {
      place[ha] = b;
      place[hb] = a;
      if (q >= 1) continue;
      break;
    }
    if (q > 0 && !noir) {
      etat[ha] = { place: a, vers: b, q, haut: true, noir };
      etat[hb] = { place: b, vers: a, q, haut: false, noir };
    }
    break;
  }
  return etat.map((e, h) => (e.q > 0 ? e : { place: place[h], vers: place[h], q: 0, haut: false, noir: false }));
}

// ---------------------------------------------------------------------------------------------------------------
// La table

/** Où tombe la photo du guéridon : en paysage, elle couvre la scène ; en portrait, elle montre le plateau et les mains
 * (de 18 % à 82 % de sa largeur), le reste est un fond flou de la même photo. */
function cadre(W: number, H: number) {
  const portrait = H > W * 1.05;
  const s = portrait ? W / (TABLE.w * 0.64) : Math.max(W / TABLE.w, H / TABLE.h);
  const w = TABLE.w * s;
  const h = TABLE.h * s;
  const x0 = (W - w) / 2;
  const y0 = portrait ? H * 0.6 - h * 0.62 : (H - h) * 0.75;
  return { s, w, h, x0, y0, portrait, X: (x: number) => x0 + x * s, Y: (y: number) => y0 + y * s };
}

/** Place un élément : centré sur x, le bas sur y, de largeur w. */
function placer(el: HTMLElement | null, x: number, y: number, w: number, ratio: number, opts: { rot?: number; visible?: boolean; opacite?: number } = {}) {
  if (!el) return;
  const visible = opts.visible ?? true;
  el.style.visibility = visible ? 'visible' : 'hidden';
  if (!visible) return;
  const h = w * ratio;
  el.style.width = `${w}px`;
  el.style.opacity = String(opts.opacite ?? 1);
  el.style.transform = `translate3d(${x - w / 2}px, ${y - h}px, 0)${opts.rot ? ` rotate(${opts.rot}deg)` : ''}`;
}

type Ref<T> = RefObject<T>;
const ref = <T,>(): Ref<T> => ({ current: null });

interface Refs {
  scene: Ref<HTMLDivElement>;
  photo: Ref<HTMLDivElement>;
  collier: Ref<HTMLImageElement>;
  chapeaux: Ref<HTMLButtonElement>[];
  objets: Ref<HTMLImageElement>[];
  valeurs: Ref<HTMLSpanElement>[];
  eclats: Ref<HTMLDivElement>;
  faisceau: Ref<HTMLDivElement>;
  noir: Ref<HTMLDivElement>;
}

type Objet = 'collier' | 'montre' | 'bague';
interface Donnees {
  nom: string;
  debut: number;
  echelle: number;
  /** Les objets sous les chapeaux (null : pas encore révélés), l'ordre du retournement. */
  objets: (Objet | null)[];
  ordre: number[];
  choix: number | null;
}

function useTable(d: { current: Donnees }, r: Refs) {
  useEffect(() => {
    const el = r.scene.current;
    if (!el) return;
    const t = { W: 0, H: 0 };
    const ro = new ResizeObserver(() => {
      t.W = el.clientWidth;
      t.H = el.clientHeight;
    });
    ro.observe(el);
    t.W = el.clientWidth;
    t.H = el.clientHeight;
    const joues = new Set<string>();
    let raf = 0;
    const image = () => {
      raf = requestAnimationFrame(image);
      const { W, H } = t;
      const x = d.current;
      if (!W || !H || x.nom === 'intro') return;
      const s = (performance.now() - x.debut) * x.echelle;
      const c = cadre(W, H);
      const ph = r.photo.current;
      if (ph) {
        ph.style.width = `${c.w}px`;
        ph.style.height = `${c.h}px`;
        ph.style.transform = `translate3d(${c.x0}px, ${c.y0}px, 0)`;
        ph.classList.toggle('portrait', c.portrait);
      }
      const vol = x.nom === 'vol';
      const places = TABLE.places.map(c.X);
      const pose = c.Y(TABLE.pose);
      const hw = TABLE.chapeau * c.s;
      const hh = hw * R.chapeau;

      const fois = (cle: string, debut: number, f: () => void) => {
        if (joues.has(cle) || s < debut || s > debut + 700) return;
        joues.add(cle);
        f();
      };

      const leveA = (k: number) => (x.nom === 'revele' && x.objets[k] ? borne((s - RET[(['premier', 'second', 'mien'] as const)[Math.max(0, x.ordre.indexOf(k))]]) / RET.leve) : 0);
      const kc = x.objets.indexOf('collier');
      const salut = x.nom === 'revele' && x.choix !== null && kc >= 0 && kc !== x.choix ? lisse((s - RET.salut) / 700) : 0;
      el.style.setProperty('--salut', String(salut));

      const melange = vol ? chapeauxA(s) : null;
      r.chapeaux.forEach((rc, k) => {
        let cx = places[k];
        let y = pose;
        let rot = 0;
        let echelle = 1;
        let visible = true;
        if (melange) {
          const m = melange[k];
          const u = lisse(m.q);
          cx = places[m.place] + (places[m.vers] - places[m.place]) * u;
          const arc = Math.sin(Math.PI * u);
          // L'un s'envole par-dessus en tournoyant, l'autre file en dessous.
          if (m.q > 0) {
            y -= m.haut ? arc * hh * 1.5 : arc * hh * 0.3;
            rot = m.haut ? 360 * u : -12 * arc;
            echelle = m.haut ? 1 + 0.14 * arc : 1 - 0.06 * arc;
          }
          // Les chapeaux tombent du ciel, avec un petit rebond.
          const q = (s - VOL.chapeaux[k]) / VOL.chute;
          visible = q > 0;
          if (q < 1) y -= H * 0.9 * (1 - q) ** 2;
          else if (q < 1.6) y -= Math.sin(Math.PI * ((q - 1) / 0.6)) * hh * 0.08;
          if (rc.current) rc.current.style.zIndex = m.haut ? '6' : '5';
        } else {
          const l = leveA(k);
          y -= hh * 1.1 * Math.sin((Math.PI / 2) * l);
          rot = -14 * l;
          if (rc.current) rc.current.style.zIndex = '5';
        }
        placer(rc.current, cx, y, hw * echelle, R.chapeau, { visible, rot, opacite: 1 - salut });
        // Ce que cache le chapeau, sur le plateau ; et sa valeur, devant.
        const obj = x.objets[k];
        const o = r.objets[k].current;
        const ow = obj === 'collier' ? hw * 0.95 : obj === 'montre' ? hw * 0.6 : hw * 0.62;
        placer(o, places[k], pose - hh * 0.02, ow, obj ? R[obj] : 1, { visible: !!obj && leveA(k) > 0.05, opacite: 1 - salut });
        const v = r.valeurs[k].current;
        if (v) {
          const vu = !!obj && leveA(k) > 0.3;
          v.style.visibility = vu ? 'visible' : 'hidden';
          if (vu) v.style.transform = `translate3d(${places[k]}px, ${pose + hh * 0.08}px, 0) translateX(-50%)`;
        }
        // Le retournement : le son de chaque chapeau, l'éclat du collier.
        if (x.nom === 'revele' && obj && leveA(k) > 0 && !joues.has(`l${k}`)) {
          joues.add(`l${k}`);
          if (obj === 'collier') jouerEffet('gd_eclat');
          else jouerEffet('gd_retourne', { vitesse: 0.9 + k * 0.08 });
        }
        if (vol) fois(`c${k}`, VOL.chapeaux[k] + VOL.chute - 60, () => jouerEffet('gd_retourne', { vitesse: 0.75 + k * 0.05, volume: 0.8 }));
      });
      // Le noir des passes dans l'obscurité.
      const nr = r.noir.current;
      if (nr) nr.style.opacity = vol ? String(noirA(s)) : '0';
      // Le collier tombe au milieu du plateau ; le chapeau du milieu le recouvre.
      const qc = (s - VOL.collier) / (VOL.pose - VOL.collier);
      placer(r.collier.current, places[1], pose - hh * 0.02 - H * 0.6 * (1 - lisse(qc)), hw * 0.95, R.collier, { visible: vol && qc > 0 && s < VOL.chapeaux[1] + VOL.chute - 30 });
      // Les éclats : les diamants du collier scintillent, posé sur le plateau puis retrouvé.
      const lc = kc >= 0 ? leveA(kc) : 0;
      const posee = vol && s >= VOL.pose && s < VOL.chapeaux[1] + VOL.chute - 30;
      placer(r.eclats.current, places[vol ? 1 : Math.max(0, kc)], pose - hh * 0.02, hw * 0.95, R.collier, { visible: posee || (lc > 0.1 && salut < 1), opacite: 1 - salut });
      // Le projecteur : la salle s'assombrit, un faisceau tombe du plafond sur le collier retrouvé.
      const pj = lc > 0 ? Math.min(1, lc * 1.4) * (1 - salut) : 0;
      el.style.setProperty('--pj', String(pj));
      el.style.setProperty('--px', `${places[Math.max(0, kc)]}px`);
      el.style.setProperty('--py', `${pose - hh * 0.35}px`);
      el.style.setProperty('--pr', `${hw * 1.25}px`);
      const fa = r.faisceau.current;
      if (fa) {
        fa.style.visibility = pj > 0 ? 'visible' : 'hidden';
        fa.style.width = `${hw * 4}px`;
        fa.style.setProperty('--fa', `${((Math.atan((hw * 1.3) / (pose + hh * 0.15)) * 180) / Math.PI).toFixed(1)}deg`);
        fa.style.height = `${pose + hh * 0.15}px`;
        fa.style.transform = `translate3d(${places[Math.max(0, kc)] - hw * 2}px, 0, 0)`;
      }

      // Les sons du vol : la musique reprend, le collier tombe, le bonneteau.
      if (vol) {
        fois('valse', 0, () => jouerEffet('pp_valse', { volume: 0.6 }));
        fois('pose', VOL.pose - 80, () => jouerEffet('ppi_clic', { volume: 0.9 }));
        PASSES.forEach((p, i) => {
          const t0 = DEBUTS_PASSES[i];
          if (p.noir) {
            fois(`n${i}`, t0, () => jouerEffet('cti_noir', { volume: 0.55 }));
            fois(`g${i}`, t0 + p.d * 0.72, () => jouerEffet('ppi_gresille', { volume: 0.35 }));
          } else {
            fois(`e${i}`, t0, () => jouerEffet('pp_glisse', { vitesse: 1.15 + (i % 3) * 0.1 }));
            fois(`p${i}`, t0 + p.d - 40, () => jouerEffet('gd_retourne', { vitesse: 1.1 + (i % 2) * 0.1, volume: 0.5 }));
          }
        });
      }
      if (salut > 0) fois('salut', RET.salut, () => jouerEffet('ppi_pizz', { volume: 0.7 }));
    };
    raf = requestAnimationFrame(image);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [d, r]);
}

// ---------------------------------------------------------------------------------------------------------------
// L'intro (9 s) : les cinq plans, et la roue au début (si on la passe).

const SONS_INTRO: [number, EffetSonore, number][] = [
  [0, 'ppi_fausse', 1],
  [650, 'ppi_gresille', 0.8],
  [1_350, 'ppi_rumeur', 0.8],
  [1_500, 'ppi_gresille', 0.45],
  [2_950, 'gd_eclat', 0.8],
  [3_800, 'ppi_pizz', 1],
  [5_600, 'cti_noir', 0.7],
  [6_050, 'ppi_clic', 1],
  [6_700, 'ppi_cri', 1],
];

/** Les éclats du plan B (l'image du cou de la Comtesse) : position en % de l'image, et l'ordre d'allumage (0 à 1). */
const ECLATS_INTRO: [number, number, number][] = [
  [52.5, 62, 0],
  [51.5, 67.5, 0.15],
  [52, 73.5, 0.3],
  [55.5, 92, 0.55],
  [34, 51, 0.1],
  [58, 51, 0.4],
  [44, 70, 0.25],
  [39.5, 64, 0.5],
  [61, 66, 0.7],
  [40, 26, 0.85],
];

function IntroVol({ t0, roue }: { t0: number; roue?: ReactNode }) {
  const reduit = mouvementReduit();
  useEffect(() => {
    const ids = SONS_INTRO.filter(([x]) => x >= t0 && !reduit).map(([x, son, volume]) => window.setTimeout(() => jouerEffet(son, { volume }), x - t0));
    return () => ids.forEach((i) => window.clearTimeout(i));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="ppi" aria-hidden="true">
      {/* 0. La roue : la musique s'arrête, les lumières s'éteignent, le lustre vacille. */}
      <div className="ppi-roue">{roue}</div>
      {/* A. Le bal figé, sous les lustres qui vacillent. */}
      <div className="ppi-plan a">
        <img src={IMG('ppi-bal')} alt="" draggable={false} />
      </div>
      {/* B. L'éclat du collier. */}
      <div className="ppi-plan b">
        <div className="ppi-cam">
          <img src={IMG('ppi-eclat')} alt="" draggable={false} />
          {ECLATS_INTRO.map(([ex, ey, d], i) => (
            <i key={i} className="ppi-eclat" style={{ left: `calc(50% + ${((ex - 50) * 1.777).toFixed(1)}cqh)`, top: `${ey}%`, '--d': `${d}` } as CSSProperties} />
          ))}
        </div>
      </div>
      {/* C. Le Pickpocket se faufile (panoramique). */}
      <div className="ppi-plan c">
        <img src={IMG('ppi-faufile')} alt="" draggable={false} />
      </div>
      {/* D. Le noir total : seuls brillent les diamants, puis ils filent dans l'obscurité. */}
      <div className="ppi-plan d">
        <img src={IMG('ppi-noir')} alt="" draggable={false} />
        <i className="ppi-traine" />
      </div>
      {/* E. La lumière revient : le cou nu, le voleur au fond. */}
      <div className="ppi-plan e">
        <img src={IMG('ppi-cri')} alt="" draggable={false} />
      </div>
      <i className="ppi-vacille" />
      <i className="ppi-flash" />
      <i className="ppi-vignette" />
    </div>
  );
}

/** La pluie de diamants : les pierres du collier et des reflets dorés tombent en tournoyant (positions fixes, tirées
 * d'une suite pseudo-aléatoire pour ne pas changer à chaque rendu). */
function PluieDiamants({ n }: { n: number }) {
  const g = (i: number, k: number) => {
    const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  return (
    <div className="pp-pluie" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <img
          key={`d${i}`}
          src={IMG('ppb-diamant')}
          alt=""
          draggable={false}
          style={{ left: `${g(i, 1) * 100}%`, width: `${18 + g(i, 2) * 30}px`, animationDuration: `${1.9 + g(i, 3) * 1.6}s`, animationDelay: `${g(i, 4) * 1.4}s`, '--tour': `${(g(i, 5) - 0.5) * 900}deg`, '--derive': `${(g(i, 6) - 0.5) * 12}cqw` } as CSSProperties}
        />
      ))}
      {Array.from({ length: Math.round(n * 0.8) }, (_, i) => (
        <i key={`b${i}`} style={{ left: `${g(i, 7) * 100}%`, width: `${6 + g(i, 8) * 22}px`, animationDuration: `${2.6 + g(i, 9) * 2}s`, animationDelay: `${g(i, 10) * 1.6}s`, '--derive': `${(g(i, 11) - 0.5) * 8}cqw` } as CSSProperties} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Le bonus

export function BonusPickpocket({ v, b, nom, ouvert, choisir, roue }: { v: VueBW; b: VueBonusBW; nom: string; ouvert: boolean; choisir: (o: number) => void; roue?: ReactNode }) {
  const M = Math.max(1, b.multiplicateur);
  const choix = b.mesChoix[0];
  const salon = b.choixSalon[0] ?? [0, 0, 0];
  const max = Math.max(...salon);
  const suivi = choix ?? (max > 0 ? salon.indexOf(max) : 1);
  const mallettes = b.mallettes ?? [null, null, null];
  const revele = mallettes.every((x) => x !== null);

  // L'horloge de l'étape (recalée sur le serveur) ; au résultat, tout est déjà retourné.
  const cle = `${v.numero}-${b.etape}`;
  const horloge = useRef({ cle: '', debut: 0 });
  const t = performance.now();
  if (v.phase === 'resultat') {
    if (horloge.current.cle !== cle) horloge.current = { cle, debut: t - 60_000 };
  } else {
    const estime = t - ((v.duree ?? 0) - (v.reste ?? 0));
    if (horloge.current.cle !== cle) horloge.current = { cle, debut: estime };
    else horloge.current.debut = Math.min(horloge.current.debut, estime);
  }
  const [maintenant, setMaintenant] = useState(() => performance.now());
  useEffect(() => {
    const id = window.setInterval(() => setMaintenant(performance.now()), 100);
    return () => window.clearInterval(id);
  }, []);
  const echelle = v.phase === 'bonus' && v.duree ? (nom === 'vol' ? REF_VOL / v.duree : nom === 'revele' ? REF_REVELE / v.duree : 1) : 1;
  const s = (maintenant - horloge.current.debut) * echelle;
  const t0Intro = useMemo(() => (nom === 'intro' ? Math.max(0, (v.duree ?? 0) - (v.reste ?? 0)) : 0), [cle]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ce que cache chaque chapeau : le collier (le butin), la montre et la bague (les deux petits).
  let petits = 0;
  const objets = mallettes.map((x) => (x === null ? null : x === b.butin ? 'collier' : petits++ === 0 ? 'montre' : 'bague')) as Donnees['objets'];
  const ordre = [...[0, 1, 2].filter((k) => k !== suivi), suivi];

  const donnees = useRef<Donnees>({ nom, debut: 0, echelle: 1, objets, ordre, choix });
  donnees.current = { nom, debut: horloge.current.debut, echelle, objets, ordre, choix };
  const refs = useRef<Refs | null>(null);
  if (!refs.current)
    refs.current = {
      scene: ref(),
      photo: ref(),
      collier: ref(),
      chapeaux: [ref(), ref(), ref()],
      objets: [ref(), ref(), ref()],
      valeurs: [ref(), ref(), ref()],
      eclats: ref(),
      faisceau: ref(),
      noir: ref(),
    };
  const r = refs.current;
  useTable(donnees, r);

  const portrait = !!r.scene.current && r.scene.current.clientHeight > r.scene.current.clientWidth * 1.05;
  const mienRevele = revele && choix !== null && s >= RET.mien;

  return (
    <div className={`pp pp-e-${nom}`} ref={r.scene} style={nom === 'intro' ? ({ '--t0': `${-t0Intro}ms` } as CSSProperties) : undefined}>
      {nom === 'intro' ? (
        <IntroVol t0={t0Intro} roue={roue} />
      ) : (
        <>
          <div className="pp-flou" style={{ backgroundImage: `url(${IMG('ppb-table')})` }} />
          <div className="pp-photo" ref={r.photo}>
            <img className="table" src={IMG('ppb-table')} alt="" draggable={false} />
            <img className="salut" src={IMG('ppb-salut')} alt="" draggable={false} />
          </div>
          <div className="pp-projo" aria-hidden="true" />
          <div className="pp-faisceau" ref={r.faisceau} aria-hidden="true">
            {Array.from({ length: 9 }, (_, i) => (
              <i key={i} style={{ left: `${30 + ((i * 37) % 40)}%`, animationDelay: `${-i * 0.7}s`, animationDuration: `${4 + (i % 3)}s` } as CSSProperties} />
            ))}
          </div>
          <img className="pp-objet collier" ref={r.collier} src={IMG('ppb-collier')} alt="" draggable={false} />
          {[0, 1, 2].map((k) => (
            <img key={`o${k}`} className={`pp-objet ${objets[k] ?? ''}`} ref={r.objets[k]} src={IMG(`ppb-${objets[k] ?? 'montre'}`)} alt="" draggable={false} />
          ))}
          <div className="pp-eclats" ref={r.eclats} aria-hidden="true">
            {ECLATS.map(([ex, ey], i) => (
              <i key={i} style={{ left: `${ex}%`, top: `${ey}%`, animationDelay: `${-((i * 0.37) % 1.6)}s` } as CSSProperties} />
            ))}
          </div>
          {[0, 1, 2].map((k) => (
            <button
              key={`c${k}`}
              type="button"
              className={`pp-chapeau ${choix === k ? 'choisi' : ''} ${choix !== null && choix !== k && nom === 'mallettes' ? 'autre' : ''}`}
              ref={r.chapeaux[k]}
              onClick={() => choisir(k)}
              disabled={nom !== 'mallettes' || !ouvert || choix !== null}
              aria-label={tr(`Chapeau ${k + 1}`, `Hat ${k + 1}`)}
            >
              <img src={IMG('ppb-chapeau')} alt="" draggable={false} />
              {nom === 'mallettes' && salon[k] ? <i className="pp-nb">{salon[k]}</i> : null}
              {nom === 'mallettes' && choix === k && <em className="pp-toi">{tr('Toi', 'You')}</em>}
            </button>
          ))}
          {[0, 1, 2].map((k) => (
            <span key={`v${k}`} className={`pp-valeur ${objets[k] ?? ''} ${choix === k ? 'mienne' : ''}`} ref={r.valeurs[k]}>
              {mallettes[k] !== null && <ValeurMultipliee x={mallettes[k] as number} m={M} rapide={k !== suivi} son={k === choix} />}
            </span>
          ))}

          {/* Le butin : le collier de la Comtesse, posé sur le guéridon. */}
          {nom === 'vol' && b.butin != null && s >= VOL.pose + 100 && s < VOL.melange + 200 && (
            <div className="pp-butin" role="status">
              <img src={IMG('ppb-collier')} alt="" draggable={false} />
              <span>
                <small>{tr('Le collier de la Comtesse', 'The Countess’s necklace')}</small>
                <strong>
                  <ValeurMultipliee x={b.butin} m={M} son />
                </strong>
              </span>
            </div>
          )}
          {nom === 'vol' && s >= VOL.melange + 200 && (
            <div className="pp-annonce" role="status" key="bonneteau">
              <strong>{tr('Sous quel chapeau ?', 'Under which hat?')}</strong>
            </div>
          )}
          <div className="pp-noir" ref={r.noir} aria-hidden="true" />
          {mienRevele && choix !== null && objets[choix] === 'collier' && <PluieDiamants n={portrait ? 18 : 32} />}
        </>
      )}
    </div>
  );
}
