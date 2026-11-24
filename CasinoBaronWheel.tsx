/**
 * Le Baron Express (Salon privé ; anciennement The Baron's Wheel) : la roue géante de 30 cases, en direct, et ses cinq bonus (le Choix du Baron,
 * la Course des draisines, la Chaudière, le Wagon-Restaurant et le Rapide de Minuit ; chacun a son propre écran :
 * CasinoDonne.tsx, CasinoDraisines.tsx, CasinoChaudiere.tsx, CasinoRestaurant.tsx et CasinoBaronExpress.tsx).
 *
 * Le serveur tient les manches et diffuse la vue (« casino_bw ») ; il a déjà tiré la case d'arrêt quand la roue part,
 * et toutes les récompenses cachées d'un bonus quand il commence. Cet écran ne fait que montrer : la roue tourne
 * jusqu'à la case tirée (calée sur l'horloge du serveur), les cartes, mallettes et itinéraires ne se retournent qu'une
 * fois que le serveur a révélé ce qu'ils cachent.
 *
 * Visuels : bw-*.webp (roue, cerclage, aiguille, centre, symboles, plaques de jackpot, décors et personnages des bonus).
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject, type ReactNode } from 'react';
import {
  BONUS_BW,
  CASES_BW,
  DEGRES_CASE_BW,
  estBonusBW,
  GAINS_CHIFFRES_BW,
  JACKPOTS_BW,
  JETONS_BW,
  MAX_CASE_BW,
  MAX_MANCHE_BW,
  NB_CASES_BW,
  ROUE_BW,
  VALEUR_JACKPOT_BW,
  type BonusBW,
  type BoostBW,
  type CaseBW,
  type EvenementBW,
  type JackpotBW,
  type JournalBW,
  type RecompenseBW,
  type VueBonusBW,
  type VueBW,
} from '../../shared/baronWheel';
import type { VueCasino } from '../../shared/casino';
import type { Appel } from './App';
import { BUTIN_PLUIE, CHOIX_AUTO, dollars, PluieLingots, useSoldeAnime } from './casinoOutils';
import { socket } from './socket';
import { EN, tr } from './traduction';
import { jouerEffet, mouvementReduit, musiqueDuCasino, useCompteur } from './ui';
import { BonusExpress, IMAGES_EXPRESS_NOMS, ValeurMultipliee } from './CasinoBaronExpress';
import { BonusRestaurant, IMAGES_RESTAURANT_NOMS } from './CasinoRestaurant';
import { BonusChaudiere, IMAGES_CHAUDIERE_NOMS } from './CasinoChaudiere';
import { BonusDonne, IMAGES_DONNE_NOMS } from './CasinoDonne';
import { BonusDraisines, IMAGES_DRAISINES_NOMS } from './CasinoDraisines';
import './baronWheel.css';

const court = (n: number) => (n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${+(n / 1000).toFixed(n % 1000 ? 1 : 0)}k` : String(n));
const imageJeton = (v: number) => (v >= 10_000_000 ? 'or' : v >= 5_000_000 ? 'argent' : v >= 1_000_000 ? 'bleu' : v >= 500_000 ? 'violet' : v >= 100_000 ? 'noir' : v >= 25_000 ? 'vert' : v >= 5_000 ? 'rouge' : 'ivoire');
const fx = (x: number) => `×${x.toLocaleString(EN ? 'en-US' : 'fr-FR', { maximumFractionDigits: 2 })}`;
const CLE_JETON = 'ldb-bw-jeton';

/** Les cases : nom, matière (argent brossé pour les multiples, or brossé pour les bonus, émeraude pour l'Express) à plat et
    déformée en secteur pour la roue, couleur du texte et médaillon des bonus. */
const ARGENT = { fond: '#a7a9ae', texte: '#1d1a1a', matiere: '/cartes/bw-matiere-argent.webp', texture: '/cartes/bw-rs-argent.webp' };
const OR = { fond: '#d4a73c', texte: '#3a1a06', matiere: '/cartes/bw-matiere-or.webp', texture: '/cartes/bw-rs-or.webp' };
export const CASES_VISUELS: Record<CaseBW, { nom: [string, string]; fond: string; texte: string; matiere: string; texture: string; image?: string }> = {
  x1: { nom: ['1X', '1X'], ...ARGENT },
  x2: { nom: ['2X', '2X'], ...ARGENT },
  x5: { nom: ['5X', '5X'], ...ARGENT },
  x10: { nom: ['10X', '10X'], ...ARGENT },
  baron: { nom: ['Baron', 'Baron'], ...OR, image: '/cartes/bw-sym-baron2.webp' },
  course: { nom: ['Course', 'Race'], ...OR, image: '/cartes/bw-sym-course.webp' },
  chaudiere: { nom: ['Chaudière', 'Boiler'], ...OR, image: '/cartes/bw-sym-chaudiere.webp' },
  restaurant: { nom: ['Cloche', 'Cloche'], ...OR, image: '/cartes/bw-sym-restaurant.webp' },
  express: { nom: ['Rapide de Minuit', 'Midnight Flyer'], fond: '#0b6b3a', texte: '#F3E7CF', matiere: '/cartes/bw-matiere-emeraude.webp', texture: '/cartes/bw-rs-emeraude.webp', image: '/cartes/bw-sym-express.webp' },
};
const NOMS_BONUS: Record<BonusBW, [string, string]> = {
  baron: ['Le Choix du Baron', 'The Baron’s Choice'],
  course: ['La Course des draisines', 'The Handcar Race'],
  chaudiere: ['La Chaudière', 'The Boiler'],
  restaurant: ['La Cloche', 'The Cloche'],
  express: ['Le Rapide de Minuit', 'The Midnight Flyer'],
};
const NOMS_JACKPOTS: Record<JackpotBW, string> = { mini: 'MINI', minor: 'MINOR', major: 'MAJOR', grand: 'GRAND' };
const nomCase = (c: CaseBW) => (estBonusBW(c) ? tr(...CASES_VISUELS[c].nom) : fx(GAINS_CHIFFRES_BW[c]));

/**
 * Le nom d'une case de mise, toujours dans son cadre : sur une ligne s'il est court, sinon un mot par ligne ; la taille
 * du texte suit la largeur de la case et le nombre de lettres de sa plus longue ligne (--n).
 */
function NomCase({ texte }: { texte: string }) {
  const long = texte.length > 9 && texte.includes(' ');
  const n = long ? Math.max(...texte.split(' ').map((m) => m.length)) : texte.length;
  return (
    <span className={`bw-case-nom ${long ? 'long' : ''}`} style={{ '--n': n } as CSSProperties}>
      {texte}
    </span>
  );
}

/** Les secondes qui restent avant `fin` (horloge du téléphone), rafraîchies 4 fois par seconde. */
function useSecondes(fin: number | null): number {
  const [, setTic] = useState(0);
  useEffect(() => {
    if (fin === null) return;
    const t = window.setInterval(() => setTic((x) => x + 1), 250);
    return () => window.clearInterval(t);
  }, [fin]);
  return fin === null ? 0 : Math.max(0, Math.ceil((fin - Date.now()) / 1000));
}

/**
 * La barre du temps qui reste (une animation CSS qui part de la part restante). Elle est calée une seule fois par
 * phase (`cle`) : les vues suivantes (une mise, un spectateur de plus) ne la font plus sauter.
 */
function Barre({ v, cle }: { v: VueBW; cle: string }) {
  const calage = useRef<{ cle: string; part: number; reste: number } | null>(null);
  if (v.reste === null || !v.duree) return null;
  if (calage.current?.cle !== cle) calage.current = { cle, part: Math.min(1, v.reste / v.duree), reste: v.reste };
  const { part, reste } = calage.current;
  return (
    <span className="bw-barre" aria-hidden="true">
      <i key={cle} style={{ '--part': part, animationDuration: `${reste}ms` } as CSSProperties} />
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// La roue

/** Un secteur de la roue (centre 0,0, angles en degrés depuis le haut, sens des aiguilles d'une montre). */
function secteur(r1: number, r2: number, a1: number, a2: number) {
  const p = (r: number, a: number) => `${(r * Math.sin((a * Math.PI) / 180)).toFixed(2)} ${(-r * Math.cos((a * Math.PI) / 180)).toFixed(2)}`;
  return `M${p(r1, a1)} L${p(r2, a1)} A${r2} ${r2} 0 0 1 ${p(r2, a2)} L${p(r1, a2)} A${r1} ${r1} 0 0 0 ${p(r1, a1)} Z`;
}
/**
 * Le tour : la roue file, puis la finale au ralenti (le dernier quart du tour, environ 2 s) où elle ne passe plus que
 * quelques cases, de plus en plus lentement. Rend la part de l'angle parcourue (0 à 1) et la vitesse (part par unité de u).
 */
const FINALE = 0.75;
const CASES_FINALE = 3.5;
function courseTour(u: number, total: number): { part: number; vitesse: number } {
  const d = Math.min(CASES_FINALE * DEGRES_CASE_BW, total * 0.1);
  const b = 6 * d;
  const a = total - d - b;
  if (u < FINALE) {
    const p = u / FINALE;
    return { part: (a * (1 - (1 - p) ** 4) + b * p) / total, vitesse: (a * 4 * (1 - p) ** 3 + b) / FINALE / total };
  }
  const w = Math.min(1, (u - FINALE) / (1 - FINALE));
  return { part: (total - d + d * (1 - (1 - w) ** 2)) / total, vitesse: (2 * d * (1 - w)) / (1 - FINALE) / total };
}
const lisseBW = (u: number) => {
  const x = u <= 0 ? 0 : u >= 1 ? 1 : u;
  return x * x * (3 - 2 * x);
};

/** Les lanternes des piliers du décor prennent la couleur de la case sous le sifflet, puis de la case gagnante. */
const LUMIERES: Record<CaseBW, string> = {
  x1: '#e8f0ff',
  x2: '#e8f0ff',
  x5: '#e8f0ff',
  x10: '#e8f0ff',
  baron: '#ffd774',
  course: '#ffd774',
  chaudiere: '#ffd774',
  restaurant: '#ffd774',
  express: '#2ee38c',
};

interface HorlogesRoue {
  v: VueBW | null;
  /** Départ du tour (performance.now()). */
  debut: number | null;
  numero: number;
}

/**
 * La roue motrice (Le Baron Express) : le moyeu tourne avec le disque ; son maneton entraîne la bielle, dont l'autre
 * bout tient la crosse, qui coulisse dans la glissière horizontale (à droite du moyeu). Les mesures sont en part de la largeur de la roue.
 */
const MOTRICE = {
  /** Le maneton : sa distance au centre, son angle (degrés, sens horaire depuis la droite) quand la roue est à 0. */
  maneton: 0.099,
  angle: -23.3,
  /** La bielle : d'un œil à l'autre ; l'image (900 × 218) a ses œils à 94 et 834 px. */
  bielle: 0.3,
  /** La crosse (au bout de la bielle) : sa largeur ; elle coulisse dans la glissière. */
  crosse: 0.14,
  oeil: 94 / 900,
  /** Une bouffée de vapeur par demi-tour de roue. */
  bouffee: 180,
};
const NB_BOUFFEES = 8;

/** Le billet de train d'un multiplicateur : 2ᵉ classe, 1ʳᵉ classe (×25), billet du Baron (×50 et plus). */
const rangBillet = (x: number) => (x >= 50 ? 'baron' : x >= 25 ? '1re' : '2e');

/** Une case de la roue : son panneau de laque, son chiffre gravé ou son médaillon. */
function CaseRoue({ i }: { i: number }) {
  const c = ROUE_BW[i];
  const a1 = i * DEGRES_CASE_BW;
  const a2 = a1 + DEGRES_CASE_BW;
  const milieu = a1 + DEGRES_CASE_BW / 2;
  const vis = CASES_VISUELS[c];
  return (
    <g className={`bw-secteur ${c}`}>
      <path d={secteur(118, 362, a1, a2)} fill={vis.fond} />
      <image href={vis.texture} x={-38} y={-363} width={76} height={246} transform={`rotate(${milieu})`} preserveAspectRatio="none" />
      <path d={secteur(118, 362, a1, a2)} className="bw-reflet" />
      {vis.image ? (
        <image href={vis.image} x={-34} y={-318} width={68} height={69} transform={`rotate(${milieu})`} />
      ) : (
        <text transform={`rotate(${milieu}) translate(0 -262) rotate(-90)`} fill="url(#bw-or-grave)" className={`bw-chiffre ${c}`} textAnchor="middle" dominantBaseline="central">
          {fx(GAINS_CHIFFRES_BW[c as 'x1'])}
        </text>
      )}
    </g>
  );
}

function Roue({ v, horloges, lampes, aiguille }: { v: VueBW; horloges: MutableRefObject<HorlogesRoue>; lampes: MutableRefObject<(HTMLDivElement | null)[]>; aiguille?: MutableRefObject<HTMLImageElement | null> }) {
  const disque = useRef<HTMLDivElement>(null);
  const frole = useRef<SVGPathElement>(null);
  const roue = useRef<HTMLDivElement>(null);
  const bielle = useRef<HTMLImageElement>(null);
  const crosse = useRef<HTMLImageElement>(null);
  const bouffees = useRef<(HTMLImageElement | null)[]>([]);
  const boosts = v.multiplicateurs ?? [];

  useEffect(() => {
    let raf = 0;
    let derniere = -1;
    let dernierTic = 0;
    let phasePrec = '';
    let arretT: number | null = null;
    let froleT = -1e9;
    let flash = -1e9;
    let pression = 0.12;
    let pressionNumero = -1;
    // La vapeur : chaque bouffée part d'un côté du bas de la roue (date de départ, côté) ; un souffle par bouffée.
    const vapeur: { t: number; cote: number; force: number }[] = [];
    let derniereBouffee: number | null = null;
    const dessiner = () => {
      raf = requestAnimationFrame(dessiner);
      const h = horloges.current;
      const x = h.v;
      if (!x || !disque.current) return;
      let a = x.angle;
      let vitesse = 0;
      let u = 0;
      const now = performance.now();
      const reduit = mouvementReduit();
      if (x.phase === 'tour' && x.tour && h.debut !== null) {
        u = Math.min(1, (now - h.debut) / x.tour.duree);
        const c = courseTour(u, x.tour.arrivee - x.tour.depart);
        a = x.tour.depart + (x.tour.arrivee - x.tour.depart) * c.part;
        vitesse = c.vitesse;
      }
      disque.current.style.transform = `rotate(${a}deg)`;
      // L'arrêt : le sifflet de la locomotive et un grand jet de vapeur ; la caméra revient.
      if (phasePrec === 'tour' && x.phase !== 'tour' && x.arret !== null) {
        arretT = now;
        for (const cote of [-1, 1, -1, 1]) {
          vapeur.push({ t: now + (cote > 0 ? 120 : 0), cote, force: 1 });
          if (vapeur.length > NB_BOUFFEES) vapeur.shift();
        }
        window.setTimeout(() => jouerEffet('bw_sifflet', { volume: 0.8 }), 180);
      }
      if (x.phase === 'mises') arretT = null;
      phasePrec = x.phase;
      // La caméra : pendant la finale, elle s'approche du sifflet ; après l'arrêt, elle recule.
      const R = roue.current;
      if (R) {
        const z = reduit ? 0 : x.phase === 'tour' ? lisseBW((u - FINALE + 0.04) / 0.1) : arretT !== null ? 1 - lisseBW((now - arretT - 900) / 700) : 0;
        R.style.transform = z > 0.001 ? `scale(${1 + 0.32 * z})` : '';
      }
      const W = roue.current?.clientWidth ?? 0;
      const b = bielle.current;
      if (W && b) {
        const th = ((MOTRICE.angle + a) * Math.PI) / 180;
        const r = MOTRICE.maneton * W;
        const L = MOTRICE.bielle * W;
        const px = W / 2 + r * Math.cos(th);
        const py = W / 2 + r * Math.sin(th);
        const qx = px + Math.sqrt(L * L - (py - W / 2) ** 2);
        const phi = Math.atan2(W / 2 - py, qx - px);
        const lb = (L * 900) / 740;
        b.style.width = `${lb}px`;
        b.style.transform = `translate3d(${px - MOTRICE.oeil * lb}px, ${py - (lb * 218) / 900 / 2}px, 0) rotate(${phi}rad)`;
        const c = crosse.current;
        if (c) {
          const cw = MOTRICE.crosse * W;
          c.style.width = `${cw}px`;
          c.style.transform = `translate3d(${qx - cw / 2}px, ${W / 2 - (cw * 135) / 300 / 2}px, 0)`;
        }
      }
      // La vapeur : une bouffée par demi-tour pendant le tour, de plus en plus espacées.
      const t = performance.now();
      if (x.phase === 'tour' && vitesse > 0.02) {
        const etape = Math.floor(a / MOTRICE.bouffee);
        if (derniereBouffee === null) derniereBouffee = etape;
        else if (etape !== derniereBouffee && (!vapeur.length || t - vapeur[vapeur.length - 1].t > 110)) {
          derniereBouffee = etape;
          vapeur.push({ t, cote: vapeur.length % 2 ? 1 : -1, force: Math.min(1, 0.35 + vitesse / 3) });
          if (vapeur.length > NB_BOUFFEES) vapeur.shift();
          jouerEffet('bw_vapeur', { volume: 0.35 + 0.5 * Math.min(1, vitesse / 3), vitesse: 0.9 + Math.random() * 0.2 });
        }
      } else derniereBouffee = null;
      bouffees.current.forEach((el, k) => {
        if (!el) return;
        const bf = vapeur[k];
        const u = bf ? (t - bf.t) / 1500 : 1;
        if (!bf || u >= 1 || u < 0 || !W) {
          el.style.opacity = '0';
          return;
        }
        const e = 1 - (1 - u) ** 2;
        const w = W * (0.16 + 0.3 * e) * (0.6 + 0.4 * bf.force);
        const cx = W / 2 + bf.cote * W * (0.28 + 0.3 * e);
        const cy = W * (0.97 - 0.22 * e);
        el.style.width = `${w}px`;
        el.style.opacity = String(Math.min(1, u * 6) * (1 - u) * 0.85 * bf.force);
        el.style.transform = `translate3d(${cx - w / 2}px, ${cy - w * 0.46}px, 0) scaleX(${bf.cote})`;
      });
      // Le cliquet de l'aiguille, à chaque case qui passe ; pendant la finale, un « clac » franc à chaque case, et le
      // bonus que la roue frôle s'allume un instant.
      const sous = Math.floor((((-a % 360) + 360) % 360) / DEGRES_CASE_BW);
      const finale = x.phase === 'tour' && u >= FINALE - 0.02;
      if (sous !== derniere) {
        const t = performance.now();
        if (derniere >= 0 && x.phase === 'tour' && t - dernierTic > 45) {
          dernierTic = t;
          flash = t;
          if (finale) jouerEffet('bw_tic', { volume: 1, vitesse: 0.8 });
          else jouerEffet('bw_tic', { volume: 0.45 + 0.55 * Math.min(1, 1 - vitesse / 4 + 0.2), vitesse: 0.9 + Math.random() * 0.2 });
          if (finale && estBonusBW(ROUE_BW[sous]) && sous !== x.arret) {
            froleT = t;
            frole.current?.setAttribute('d', secteur(118, 362, sous * DEGRES_CASE_BW, (sous + 1) * DEGRES_CASE_BW));
            jouerEffet('gd_eclat', { volume: 0.3 });
          }
        }
        derniere = sous;
      }
      if (frole.current) frole.current.style.opacity = String(Math.max(0, 1 - (now - froleT) / 520));
      // Le manomètre : la pression monte pendant le tour ; dans la finale, si la roue passe près d'un bonus, l'aiguille
      // s'affole dans le rouge et la vapeur siffle.
      const ai = aiguille?.current;
      if (ai) {
        let cible = 0.12 + 0.02 * Math.sin(now / 900);
        let tremble = 0.004;
        if (x.phase === 'multiplicateurs') cible = 0.3;
        else if (x.phase === 'tour') {
          cible = 0.3 + 0.5 * Math.min(1, u / 0.45);
          tremble = 0.012;
          if (finale) {
            const proche = estBonusBW(ROUE_BW[sous]) || estBonusBW(ROUE_BW[(sous + 1) % NB_CASES_BW]) || estBonusBW(ROUE_BW[(sous + NB_CASES_BW - 1) % NB_CASES_BW]);
            cible = proche ? 0.95 : 0.74;
            tremble = proche ? 0.035 : 0.012;
            if (proche && pressionNumero !== x.numero) {
              pressionNumero = x.numero;
              jouerEffet('bw_pression');
            }
          }
        } else if (x.phase === 'bonus' || x.phase === 'resultat') cible = 0.22;
        pression += (cible - pression) * (x.phase === 'tour' ? 0.08 : 0.035);
        const p = Math.max(0, Math.min(1.02, pression + (reduit ? 0 : (Math.random() - 0.5) * 2 * tremble)));
        ai.style.transform = `rotate(${-124 + 248 * p}deg)`;
      }
      // Les lanternes des piliers : la couleur de la case sous le sifflet, un éclat à chaque case ; à l'arrêt, elles
      // clignotent à la couleur de la case gagnante, puis restent allumées.
      const caseLampe = x.phase === 'tour' ? ROUE_BW[sous] : x.arret !== null && (x.phase === 'bonus' || x.phase === 'resultat') ? ROUE_BW[x.arret] : null;
      lampes.current.forEach((l, k) => {
        if (!l) return;
        let force = 0.45;
        let couleur = '#ffc46a';
        if (caseLampe) {
          couleur = LUMIERES[caseLampe];
          if (x.phase === 'tour') force = 0.55 + 0.45 * Math.max(0, 1 - (now - flash) / 160);
          else {
            const e = arretT !== null ? now - arretT : 9999;
            force = e < 3200 && !reduit ? (Math.floor(e / 220 + k) % 2 ? 1 : 0.15) : 0.85 + 0.15 * Math.sin(now / 300);
          }
        } else force = 0.4 + 0.08 * Math.sin(now / 700 + k * 2);
        l.style.setProperty('--lampe', couleur);
        l.style.opacity = String(force);
      });
    };
    raf = requestAnimationFrame(dessiner);
    return () => cancelAnimationFrame(raf);
  }, [horloges, lampes, aiguille]);

  const cases = useMemo(() => ROUE_BW.map((c, i) => <CaseRoue key={i} i={i} />), []);

  return (
    <div className={`bw-roue ${v.phase}`} ref={roue}>
      <div className="bw-roue-halo" aria-hidden="true" />
      <i className="bw-rl-rails" aria-hidden="true" />
      <div className="bw-disque" ref={disque}>
        <svg viewBox="-370 -370 740 740" aria-hidden="true">
          <defs>
            {/* Les chiffres gravés en or, en relief. */}
            <linearGradient id="bw-or-grave" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#fff3c4" />
              <stop offset="0.45" stopColor="#f0c45e" />
              <stop offset="0.55" stopColor="#c88a2a" />
              <stop offset="1" stopColor="#ffe08a" />
            </linearGradient>
          </defs>
          <circle r="366" fill="#1a0f08" />
          {cases}
          {ROUE_BW.map((_, i) => (
            <line key={i} x1="0" y1="-118" x2="0" y2="-363" transform={`rotate(${i * DEGRES_CASE_BW})`} className="bw-filet" />
          ))}
          {/* Les multiplicateurs du Top Slot : un filet doré autour des cases multipliées, qui s'allume quand le rouleau
              s'arrête (le second tirage d'un Double départ plus tard). */}
          {boosts.map((b, k) => {
            const a1 = b.i * DEGRES_CASE_BW;
            const rang = Math.max(0, (v.topSlot ?? []).findIndex((t) => t.c === ROUE_BW[b.i]));
            return (
              <g
                key={`${v.numero}-${b.i}`}
                className={`bw-boost ${b.x >= 25 ? 'enorme' : b.x >= 10 ? 'gros' : ''}`}
                style={{ '--k': k, '--d': `${(rang ? ARRET_TOP_SLOT.second : ARRET_TOP_SLOT.premier)}ms` } as CSSProperties}
              >
                <path className="bw-boost-lisere" d={secteur(122, 358, a1 + 0.35, a1 + DEGRES_CASE_BW - 0.35)} />
              </g>
            );
          })}
          <path ref={frole} className="bw-frole" d="M0 0" />
          <circle r="120" className="bw-anneau" />
        </svg>
        <img className="bw-rl-moyeu" src="/cartes/bw-rl-moyeu.webp" alt="" draggable={false} />
      </div>
      <img className="bw-rl-jante" src="/cartes/bw-rl-jante.webp" alt="" draggable={false} />
      <img className="bw-rl-glissiere" src="/cartes/bw-rl-glissiere.webp" alt="" draggable={false} />
      <img className="bw-rl-crosse" ref={crosse} src="/cartes/bw-rl-crosse.webp" alt="" draggable={false} />
      <img className="bw-rl-bielle" ref={bielle} src="/cartes/bw-rl-bielle.webp" alt="" draggable={false} />
      {Array.from({ length: NB_BOUFFEES }, (_, k) => (
        <img
          key={k}
          className="bw-rl-vapeur"
          ref={(el) => {
            bouffees.current[k] = el;
          }}
          src="/cartes/bw-rl-vapeur.webp"
          alt=""
          draggable={false}
        />
      ))}
      <img className="bw-aiguille" src="/cartes/bw-rl-sifflet.webp" alt="" draggable={false} />
    </div>
  );
}

/**
 * Les lanternes des piliers du décor (position dans l'image du décor, et rayon du halo) : celles du bas des piliers, et
 * celles des chapiteaux des arches ; on n'allume que celles qui sont visibles dans le plateau.
 */
const LANTERNES = {
  paysage: { w: 1600, h: 900, pos: 0.7, lampes: [[137, 345, 110], [1472, 345, 110], [316, 236, 80], [1279, 236, 80]] },
  portrait: { w: 1000, h: 1250, pos: 0.7, lampes: [[73, 488, 85], [926, 488, 85], [180, 312, 70], [821, 312, 70]] },
};
export function LampesDecor({ lampes }: { lampes: MutableRefObject<(HTMLDivElement | null)[]> }) {
  const boite = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = boite.current?.parentElement;
    if (!el) return;
    const placer = () => {
      const W = el.clientWidth;
      const H = el.clientHeight;
      const d = window.matchMedia('(max-width: 699px)').matches ? LANTERNES.portrait : LANTERNES.paysage;
      const sc = Math.max(W / d.w, H / d.h);
      const ox = (W - d.w * sc) * 0.5;
      const oy = (H - d.h * sc) * d.pos;
      d.lampes.forEach(([x, y, rr], k) => {
        const l = lampes.current[k];
        if (!l) return;
        const r = rr * sc;
        const cx = ox + x * sc;
        const cy = oy + y * sc;
        l.style.width = l.style.height = `${2 * r}px`;
        l.style.transform = `translate3d(${cx - r}px, ${cy - r}px, 0)`;
        l.style.display = cx < 4 || cx > W - 4 || cy < 4 || cy > H - 4 ? 'none' : '';
      });
    };
    placer();
    const ro = new ResizeObserver(placer);
    ro.observe(el);
    return () => ro.disconnect();
  }, [lampes]);
  return (
    <div className="bw-lampes" ref={boite} aria-hidden="true">
      {[0, 1, 2, 3].map((k) => (
        <div
          key={k}
          className="bw-lampe"
          ref={(el) => {
            lampes.current[k] = el;
          }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Les jackpots, l'historique, le journal

// ---------------------------------------------------------------------------------------------------------------
// Le cadre des départs (l'historique) et le Top Slot

/** Le cadre « Départs » : les derniers résultats, le plus récent à gauche. */
export function TableauDeparts({ historique, onJournal }: { historique: VueBW['historique']; onJournal: () => void }) {
  return (
    <section className="bw-tableau" aria-label={tr('Les derniers résultats', 'Latest results')}>
      <header>
        <strong>{tr('Départs', 'Departures')}</strong>
        <button type="button" className="bw-bouton-journal" onClick={onJournal}>
          {tr('Historique', 'History')}
        </button>
      </header>
      <ol className="bw-historique">
        {historique.map((h, k) => (
          <li key={`${historique.length}-${k}-${h.c}`}>
            <Pastille c={h.c} x={h.x} />
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Quand les rouleaux du Top Slot s'arrêtent (ms après la fermeture des mises) : le premier tirage, le second (Double départ). */
const ARRET_TOP_SLOT = { case: 1700, premier: 2400, pause: 900, second: 5100 };
const NB_DEFILE = 24;

/** Une ligne d'un rouleau : la case (sa plaque rivetée, à sa couleur) ou le multiplicateur (plaque noire, ×N gravé en or). */
function ElementTopSlot({ c, x }: { c?: CaseBW; x?: number }) {
  if (x !== undefined)
    return (
      <span className="bw-ts-x">
        <img src="/cartes/bw-ts-plaque-x.webp" alt="" draggable={false} />
        <b className="bw-or">×{x}</b>
      </span>
    );
  if (!c) return <span className="bw-ts-case vide">—</span>;
  const vis = CASES_VISUELS[c];
  return (
    <span className={`bw-ts-case ${c} ${estBonusBW(c) ? 'bonus' : ''}`} style={{ '--fond': vis.fond, '--texte': vis.texte, '--matiere': `url(${vis.matiere})` } as CSSProperties}>
      <i className="bw-ts-fond" />
      <img className="bw-ts-cadre-case" src="/cartes/bw-ts-plaque.webp" alt="" draggable={false} />
      <span className="bw-ts-contenu">
        {vis.image ? <img src={vis.image} alt="" draggable={false} /> : <strong className="bw-or">{fx(GAINS_CHIFFRES_BW[c as 'x1'])}</strong>}
        {vis.image && <em>{tr(...NOMS_BONUS[c as BonusBW])}</em>}
      </span>
    </span>
  );
}

const MULTIS_TOP_SLOT = [2, 3, 5, 10, 20, 50, 100, 200];
/** Un rouleau qui défile puis s'arrête sur `fin` au bout de `duree` ms (immédiatement si `duree` vaut 0). */
function Rouleau({ fin, duree, type }: { fin: { c?: CaseBW; x?: number }; duree: number; type: 'case' | 'x' }) {
  const [bande] = useState(() =>
    Array.from({ length: NB_DEFILE }, () => (type === 'case' ? { c: CASES_BW[Math.floor(Math.random() * CASES_BW.length)] } : { x: MULTIS_TOP_SLOT[Math.floor(Math.random() * MULTIS_TOP_SLOT.length)] })),
  );
  const [parti, setParti] = useState(duree === 0);
  useEffect(() => {
    if (duree === 0) return;
    const r = requestAnimationFrame(() => requestAnimationFrame(() => setParti(true)));
    // Le cliquetis du rouleau, de plus en plus espacé, puis le claquement de l'arrêt.
    const ids: number[] = [];
    let t = 0;
    for (let k = 0; t < duree - 120; k++) {
      t += 45 + 260 * (t / duree) ** 2.2;
      ids.push(window.setTimeout(() => jouerEffet('bw_palette', { vitesse: 0.85 + Math.random() * 0.3, volume: 0.6 }), t));
    }
    ids.push(window.setTimeout(() => jouerEffet('bw_poincon', { volume: 0.5, vitesse: 1.3 }), duree));
    return () => {
      cancelAnimationFrame(r);
      ids.forEach((i) => window.clearTimeout(i));
    };
  }, [duree]);
  const elements = duree === 0 ? [fin] : [...bande, fin];
  return (
    <span className="bw-rouleau">
      <span className="bw-bande" style={{ transform: parti && duree ? `translateY(${-(elements.length - 1) * 100}%)` : undefined, transitionDuration: `${duree}ms` }}>
        {elements.map((e, k) => (
          <span key={k} className="bw-ts-ligne">
            <ElementTopSlot {...e} />
          </span>
        ))}
      </span>
    </span>
  );
}

/**
 * Le Top Slot, au-dessus de la roue : à la fermeture des mises, ses deux rouleaux défilent et s'arrêtent sur une case
 * et un multiplicateur (deux fois au Double départ). Il garde le tirage jusqu'à la manche suivante.
 */
export function TopSlot({ v }: { v: VueBW }) {
  const t = v.phase === 'mises' ? null : v.topSlot;
  const double = !!t && t.length > 1;
  // La roue s'est arrêtée sur la case tirée : son multiplicateur s'illumine.
  const gagne = (c: CaseBW) => (v.phase === 'bonus' || v.phase === 'resultat') && v.arret !== null && ROUE_BW[v.arret] === c;
  // Depuis combien de temps les mises sont fermées : on ne fait défiler les rouleaux que si l'on a vu le tirage commencer.
  const [depart] = useState(() => ({ numero: v.numero, ecoule: v.phase === 'multiplicateurs' && v.duree !== null && v.reste !== null ? v.duree - v.reste : Infinity }));
  const anime = !mouvementReduit() && depart.numero === v.numero ? depart.ecoule < 400 : !mouvementReduit() && v.phase === 'multiplicateurs';
  const [etape, setEtape] = useState(0);
  useEffect(() => {
    setEtape(0);
    if (!t) return;
    if (!anime) {
      setEtape(3);
      return;
    }
    const ids = [window.setTimeout(() => setEtape(1), ARRET_TOP_SLOT.premier)];
    if (double) {
      ids.push(window.setTimeout(() => setEtape(2), ARRET_TOP_SLOT.premier + ARRET_TOP_SLOT.pause));
      ids.push(window.setTimeout(() => setEtape(3), ARRET_TOP_SLOT.second));
    } else ids.push(window.setTimeout(() => setEtape(3), ARRET_TOP_SLOT.premier + 100));
    return () => ids.forEach((i) => window.clearTimeout(i));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.numero, !!t]);

  const plaque = !t ? tr('Top Slot', 'Top Slot') : double && etape >= 1 ? tr('Double départ !', 'Double departure!') : tr('Top Slot', 'Top Slot');
  // Ce que montrent les fenêtres : les rouleaux qui défilent, ou le tirage arrêté (deux lignes au Double départ).
  let gauche: ReactNode;
  let droite: ReactNode;
  if (!t) {
    gauche = <span className="bw-ts-attente">{tr('Faites vos jeux', 'Place your bets')}</span>;
    droite = <span className="bw-ts-attente">×?</span>;
  } else if (etape === 3 || !anime) {
    gauche = (
      <span className={`bw-ts-fixe n${t.length}`}>
        {t.map((x) => (
          <span key={x.c} className={`bw-ts-ligne ${gagne(x.c) ? 'gagne' : ''}`}>
            <ElementTopSlot c={x.c} />
          </span>
        ))}
      </span>
    );
    droite = (
      <span className={`bw-ts-fixe n${t.length}`}>
        {t.map((x) => (
          <span key={x.c} className={`bw-ts-ligne ${gagne(x.c) ? 'gagne' : ''}`}>
            <ElementTopSlot x={x.x} />
          </span>
        ))}
      </span>
    );
  } else {
    const k = etape >= 2 ? 1 : 0;
    gauche = <Rouleau key={`g${v.numero}-${k}`} fin={{ c: t[k].c }} duree={k ? ARRET_TOP_SLOT.case : ARRET_TOP_SLOT.case} type="case" />;
    droite = <Rouleau key={`d${v.numero}-${k}`} fin={{ x: t[k].x }} duree={k ? ARRET_TOP_SLOT.second - ARRET_TOP_SLOT.premier - ARRET_TOP_SLOT.pause : ARRET_TOP_SLOT.premier} type="x" />;
  }
  return (
    <section className={`bw-topslot ${t ? 'tire' : ''} ${double && etape >= 1 ? 'double' : ''}`} aria-label={tr('Top Slot', 'Top Slot')} aria-live="polite">
      <img className="bw-ts-cadre" src="/cartes/bw-topslot.webp" alt="" draggable={false} />
      <span className="bw-ts-plaque">{plaque}</span>
      <span className="bw-ts-fenetre gauche">{gauche}</span>
      <span className="bw-ts-fenetre droite">{droite}</span>
      {t && (etape === 3 || !anime) && (
        <span className="bw-sr">{t.map((x) => `${nomCase(x.c)} ×${x.x}`).join(', ')}</span>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Le manomètre, le contrôleur, les gros gains, les événements

/** Le manomètre de la locomotive, à côté de la roue : la roue pilote son aiguille. */
export function Manometre({ aiguille }: { aiguille: MutableRefObject<HTMLImageElement | null> }) {
  return (
    <div className="bw-mano" aria-hidden="true">
      <img className="bw-mano-cadran" src="/cartes/bw-mano-cadran.webp" alt="" draggable={false} />
      <img className="bw-mano-aiguille" ref={aiguille} src="/cartes/bw-mano-aiguille.webp" alt="" draggable={false} />
    </div>
  );
}

/** Les paliers des gros gains (en multiples de la mise) et leur nom. */
const PALIERS_GAIN: { x: number; nom: [string, string] }[] = [
  { x: 50, nom: ['Grand Voyage', 'Grand Voyage'] },
  { x: 200, nom: ['Train de Luxe', 'Luxury Train'] },
  { x: 1000, nom: ['Orient-Express', 'Orient Express'] },
];
export const palierGainBW = (gain: number, mise: number) => (mise <= 0 ? 0 : PALIERS_GAIN.filter((p) => gain >= p.x * mise).length);

function GainQuiDefile({ gain }: { gain: number }) {
  const v = useCompteur(gain, 0, 500, 2600);
  return <b>+{dollars(v)}</b>;
}

export function PalierGain({ n, gain, onFermer }: { n: number; gain: number; onFermer: () => void }) {
  const p = PALIERS_GAIN[n - 1];
  return (
    <div className={`bw-palier p${n}`} role="status" onClick={onFermer}>
      <div className="bw-fete-rayons" aria-hidden="true" />
      <span className="bw-palier-plaque">
        <img src={`/cartes/bw-palier-${n}.webp`} alt="" draggable={false} />
        <strong>{tr(...p.nom)}</strong>
      </span>
      <GainQuiDefile gain={gain} />
    </div>
  );
}

const EVENEMENTS: Record<EvenementBW, { nom: [string, string]; effet: [string, string]; image: string }> = {
  pointe: { nom: ['Heure de pointe', 'Rush hour'], effet: ['Top Slot : au moins ×5 à chaque manche', 'Top Slot: at least ×5 every round'], image: '/cartes/bw-evt-pointe.webp' },
  depart: { nom: ['Grand Départ', 'Grand Departure'], effet: ['XP ×2 sur la roue', 'XP ×2 on the wheel'], image: '/cartes/bw-evt-depart.webp' },
};
const minutes = (ms: number) => Math.max(1, Math.ceil(ms / 60_000));

/** Les événements de la gare en cours, ou le prochain s'il commence dans l'heure. */
export function BandeauEvenements({ v }: { v: VueBW }) {
  const en = v.evenements ?? [];
  if (!en.length && !v.prochain) return null;
  return (
    <div className="bw-evenements">
      {en.map((e) => (
        <p key={e.type} className={`bw-evenement ${e.type}`} role="status">
          <img src={EVENEMENTS[e.type].image} alt="" draggable={false} />
          <span>
            <strong>{tr(...EVENEMENTS[e.type].nom)}</strong>
            <small>{tr(...EVENEMENTS[e.type].effet)}</small>
          </span>
          <em>{tr(`encore ${minutes(e.reste)} min`, `${minutes(e.reste)} min left`)}</em>
        </p>
      ))}
      {!en.length && v.prochain && (
        <p className={`bw-evenement bientot ${v.prochain.type}`} role="status">
          <img src={EVENEMENTS[v.prochain.type].image} alt="" draggable={false} />
          <span>
            <strong>{tr(...EVENEMENTS[v.prochain.type].nom)}</strong>
            <small>{tr(...EVENEMENTS[v.prochain.type].effet)}</small>
          </span>
          <em>{tr(`dans ${minutes(v.prochain.dans)} min`, `in ${minutes(v.prochain.dans)} min`)}</em>
        </p>
      )}
    </div>
  );
}

/** Le plus gros gain du jour sur la roue. */
export function Compteurs({ v }: { v: VueBW }) {
  if (!v.record) return null;
  return (
    <div className="bw-compteurs">
      {v.record && (
        <span className="bw-compteur record" title={tr('Le plus gros gain du jour', 'Biggest win today')}>
          <img src={`/cartes/avatar-${v.record.avatar}.webp`} alt="" draggable={false} />
          <span>
            <small>{tr('Record du jour', 'Today’s best')}</small>
            <b>
              {v.record.nom} · {court(v.record.gain)}
            </b>
          </span>
        </span>
      )}
    </div>
  );
}


/** Après un bonus : les trois plus gros gains de la manche. */
export function Podium({ v }: { v: VueBW }) {
  const top = v.joueurs.filter((j) => (j.gain ?? 0) > 0).slice(0, 3);
  if (!top.length || !v.bonus) return null;
  return (
    <section className="bw-podium" aria-label={tr('Les plus gros gains du bonus', 'Biggest bonus wins')}>
      <h3>{tr(`Les gagnants · ${NOMS_BONUS[v.bonus.type][0]}`, `Winners · ${NOMS_BONUS[v.bonus.type][1]}`)}</h3>
      <ol>
        {top.map((j, k) => (
          <li key={k} className={`${j.moi ? 'moi' : ''} rang${k + 1}`} style={{ '--k': k } as CSSProperties}>
            <em>{k + 1}</em>
            <img src={`/cartes/avatar-${j.avatar}.webp`} alt="" draggable={false} />
            <span>{j.nom}</span>
            <strong>+{dollars(j.gain ?? 0)}</strong>
          </li>
        ))}
      </ol>
    </section>
  );
}


function Pastille({ c, x }: { c: CaseBW; x?: number }) {
  const vis = CASES_VISUELS[c];
  return (
    <span className={`bw-pastille ${c} ${x ? 'multipliee' : ''}`} style={{ '--fond': vis.fond, '--texte': vis.texte, '--matiere': `url(${vis.matiere})` } as CSSProperties} title={nomCase(c)}>
      {vis.image ? <img src={vis.image} alt={nomCase(c)} /> : fx(GAINS_CHIFFRES_BW[c as 'x1'])}
      {x ? <i>×{x}</i> : null}
    </span>
  );
}


function Journal({ appel, onFermer }: { appel: Appel; onFermer: () => void }) {
  const [j, setJ] = useState<JournalBW | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  useEffect(() => {
    void appel('casino_bw_journal').then((r) => {
      const x = r as unknown as { ok: boolean; journal?: JournalBW; erreur?: string };
      if (x.ok && x.journal) setJ(x.journal);
      else setErreur(x.erreur ?? tr('Historique indisponible.', 'History unavailable.'));
    });
  }, [appel]);
  const heure = (t: number) => new Date(t).toLocaleTimeString(EN ? 'en-GB' : 'fr-FR', { hour: '2-digit', minute: '2-digit' });
  return (
    <div className="bw-fenetre" role="dialog" aria-modal="true" aria-label={tr('Historique', 'History')} onClick={onFermer}>
      <div className="bw-fenetre-boite" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>{tr('Historique et statistiques', 'History and statistics')}</h2>
          <button type="button" onClick={onFermer} aria-label={tr('Fermer', 'Close')}>
            ✕
          </button>
        </header>
        {!j ? (
          <p className="discret">{erreur ?? tr('Chargement…', 'Loading…')}</p>
        ) : (
          <>
            <section className="bw-stats">
              <div>
                <small>{tr('Mes manches', 'My rounds')}</small>
                <strong>{j.moi.manches}</strong>
              </div>
              <div>
                <small>{tr('Misé', 'Bet')}</small>
                <strong>{dollars(j.moi.mise)}</strong>
              </div>
              <div>
                <small>{tr('Gagné', 'Won')}</small>
                <strong>{dollars(j.moi.gain)}</strong>
              </div>
              <div>
                <small>{tr('Résultat', 'Net')}</small>
                <strong className={j.moi.gain - j.moi.mise >= 0 ? 'plus' : 'moins'}>
                  {j.moi.gain - j.moi.mise >= 0 ? '+' : '−'}
                  {dollars(Math.abs(j.moi.gain - j.moi.mise))}
                </strong>
              </div>
            </section>
            <section className="bw-stats salon">
              <div>
                <small>{tr('Manches du salon', 'Lounge rounds')}</small>
                <strong>{j.salon.manches}</strong>
              </div>
              {BONUS_BW.map((b) => (
                <div key={b}>
                  <small>
                    <Pastille c={b} /> {tr(...CASES_VISUELS[b].nom)}
                  </small>
                  <strong>{j.salon.cases[b]}</strong>
                </div>
              ))}
              <div>
                <small>{tr('Jackpots', 'Jackpots')}</small>
                <strong>{JACKPOTS_BW.reduce((s, k) => s + j.salon.jackpots[k], 0)}</strong>
              </div>
            </section>
            <h3>{tr('Mes 20 dernières manches', 'My last 20 rounds')}</h3>
            {j.manches.length ? (
              <ol className="bw-journal">
                {j.manches.map((m) => (
                  <li key={m.numero}>
                    <span>{heure(m.t)}</span>
                    <Pastille c={m.c} />
                    <span>{dollars(m.mise)}</span>
                    <strong className={m.gain - m.mise >= 0 ? 'plus' : 'moins'}>
                      {m.gain - m.mise >= 0 ? '+' : '−'}
                      {dollars(Math.abs(m.gain - m.mise))}
                      {m.jackpot && <em>{NOMS_JACKPOTS[m.jackpot]}</em>}
                    </strong>
                    <span className="bw-journal-solde">{dollars(m.solde)}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="discret">{tr('Tu n’as pas encore joué de manche.', 'You have not played a round yet.')}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Le préchargement des mini-jeux : toutes leurs images, en fond dès l'arrivée à la roue, et l'écran de chargement
// au début de chaque bonus (le temps que tout soit prêt, pour tout le monde).

const plaques = ['mini', 'minor', 'major', 'grand'].map((j) => `bw-plaque-${j}`);
const IMAGES_BONUS_BW: Record<BonusBW, string[]> = Object.fromEntries(
  Object.entries({
    baron: ['bw-sym-baron2', ...IMAGES_DONNE_NOMS, ...plaques],
    course: ['bw-sym-course', ...IMAGES_DRAISINES_NOMS],
    chaudiere: ['bw-sym-chaudiere', ...IMAGES_CHAUDIERE_NOMS],
    restaurant: ['bw-sym-restaurant', ...IMAGES_RESTAURANT_NOMS],
    express: ['bw-sym-express', ...IMAGES_EXPRESS_NOMS],
  }).map(([t, noms]) => [t, noms.map((n) => `/cartes/${n}.webp`)]),
) as Record<BonusBW, string[]>;

const imagesChargees = new Map<string, Promise<void>>();
/** Les images chargées restent ici : décodées, elles s'affichent aussitôt, sans clignoter. */
const imagesGardees: HTMLImageElement[] = [];
function chargerImage(src: string): Promise<void> {
  let p = imagesChargees.get(src);
  if (!p) {
    p = new Promise<void>((ok) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => void img.decode().then(ok, ok);
      // Une image en erreur ne bloque pas le jeu ; elle sera redemandée la prochaine fois.
      img.onerror = () => (imagesChargees.delete(src), ok());
      img.src = src;
      imagesGardees.push(img);
    });
    imagesChargees.set(src, p);
  }
  return p;
}
/** En fond, deux images à la fois : d'abord les bonus les plus fréquents. */
let prechargementLance = false;
function prechargerLesBonus() {
  if (prechargementLance) return;
  prechargementLance = true;
  const file = [...new Set((['baron', 'restaurant', 'course', 'chaudiere', 'express'] as BonusBW[]).flatMap((t) => IMAGES_BONUS_BW[t]))];
  let i = 0;
  const suivante = (): Promise<void> => (i < file.length ? chargerImage(file[i++]).then(suivante) : Promise.resolve());
  void suivante();
  void suivante();
}
/** La part des images d'un mini-jeu déjà prêtes (0 à 1). */
function useChargement(type: BonusBW): number {
  const [prets, setPrets] = useState(0);
  useEffect(() => {
    let vivant = true;
    let n = 0;
    setPrets(0);
    for (const src of IMAGES_BONUS_BW[type]) void chargerImage(src).then(() => vivant && setPrets(++n));
    return () => {
      vivant = false;
    };
  }, [type]);
  return Math.min(1, prets / IMAGES_BONUS_BW[type].length);
}

/** L'écran de chargement d'un mini-jeu. */
function EcranChargement({ b, part }: { b: VueBonusBW; part: number }) {
  return (
    <div className={`bw-chargement ${b.type}`} role="status" aria-live="polite">
      <img className="bw-chargement-symbole" src={CASES_VISUELS[b.type].image} alt="" draggable={false} />
      <small>{tr('Mini-jeu', 'Mini-game')}</small>
      <strong>{tr(...NOMS_BONUS[b.type])}</strong>
      {b.multiplicateur > 1 && <em className="bw-bonus-multi">×{b.multiplicateur}</em>}
      <span className="bw-chargement-barre" aria-hidden="true">
        <i style={{ transform: `scaleX(${Math.max(0.04, part)})` }} />
      </span>
      <span className="bw-chargement-etat">{part < 1 ? tr(`Chargement… ${Math.round(part * 100)} %`, `Loading… ${Math.round(part * 100)}%`) : tr('Prêt\u00a0!', 'Ready!')}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Les bonus

interface PropsBonus {
  v: VueBW;
  b: VueBonusBW;
  /** Nom de l'étape en cours, rang de choix de l'étape (ou -1), et choisir. */
  nom: string;
  rang: number;
  ouvert: boolean;
  choisir: (o: number) => void;
}

const etiquetteRecompense = (r: RecompenseBW) => (r.jackpot ? NOMS_JACKPOTS[r.jackpot] : fx(r.x));


const TEXTES_ETAPES: Record<string, [string, string]> = {
  intro: ['', ''],
  donne: ['Le Baron mélange et distribue…', 'The Baron shuffles and deals…'],
  cartes: ['Choisis ta carte parmi les neuf', 'Pick your card among the nine'],
  vol: ['', ''],
  mallettes: ['Où est le collier ? Choisis un chapeau', 'Where is the necklace? Pick a hat'],
  route: ['La police arrive ! Choisis ta voiture', 'The police are coming! Pick your car'],
  poursuite: ['La course-poursuite\u00a0!', 'The car chase!'],
  wagons: ['Choisis ton wagon : un seul arrivera à Istanbul\u00a0!', 'Pick your carriage: only one will reach Istanbul!'],
  aiguille: ['À gauche ou à droite ? Tire le levier\u00a0!', 'Left or right? Pull the lever!'],
  cloches: ['Choisis ta cloche : le plat dessous fait ton gain', 'Pick your cloche: the dish beneath is your win'],
  grille: ['Choisis ta draisine : sa cote si elle gagne, ×2 sinon', 'Pick your handcar: its odds if it wins, ×2 otherwise'],
  revele: ['', ''],
};

function SceneBonus({ v, appel, onErreur }: { v: VueBW; appel: Appel; onErreur: (e: string | null) => void }) {
  const b = v.bonus as VueBonusBW;
  const e = b.etapes[b.etape];
  const nom = v.phase === 'resultat' ? 'revele' : e.nom;
  const rang = e.choix ? b.etapes.slice(0, b.etape).filter((x) => x.choix > 0).length : -1;
  const ouvert = v.phase === 'bonus' && rang >= 0 && b.mise > 0 && b.mesChoix[rang] === null;
  const choisir = (o: number) => {
    if (!ouvert) return;
    jouerEffet(b.type === 'baron' ? 'bw_carte' : 'jeton');
    void appel('casino_bw_choisir', { etape: b.etape, choix: o }).then((r) => onErreur(r.ok ? null : (r.erreur ?? tr('Choix impossible.', 'Choice not allowed.'))));
  };
  const props: PropsBonus = { v, b, nom, rang, ouvert, choisir };
  const texte = TEXTES_ETAPES[nom]?.[EN ? 1 : 0] ?? '';
  const r = b.resultat;
  // L'écran de chargement : toute l'étape de chargement, et au-delà tant que les images de l'intro manquent.
  const part = useChargement(b.type);
  const charge = nom === 'chargement' || (nom === 'intro' && part < 1);
  if (charge)
    return (
      <div className={`bw-bonus ${b.type}`}>
        <EcranChargement b={b} part={part} />
      </div>
    );
  return (
    <div className={`bw-bonus ${b.type}`}>
      {b.type === 'baron' && <BonusDonne v={v} b={b} nom={nom} ouvert={ouvert} choisir={choisir} />}
      {b.type === 'course' && <BonusDraisines v={v} b={b} nom={nom} ouvert={ouvert} choisir={choisir} />}
      {b.type === 'chaudiere' && (
        <BonusChaudiere
          v={v}
          b={b}
          nom={nom}
          onSiffler={() =>
            appel('casino_bw_siffler', {}).then((r) => {
              onErreur(r.ok ? null : (r.erreur ?? tr('Trop tard pour siffler.', 'Too late to whistle.')));
              return r.ok;
            })
          }
        />
      )}
      {b.type === 'restaurant' && <BonusRestaurant v={v} b={b} nom={nom} ouvert={ouvert} choisir={choisir} />}
      {b.type === 'express' && <BonusExpress v={v} b={b} nom={nom} ouvert={ouvert} choisir={choisir} />}
      <div className="bw-bonus-titre">
        <img src={CASES_VISUELS[b.type].image} alt="" />
        <strong>{tr(...NOMS_BONUS[b.type])}</strong>
        {b.multiplicateur > 1 && <em className="bw-bonus-multi">×{b.multiplicateur}</em>}
      </div>
      {b.multiplicateur > 1 && nom === 'intro' && (
        <div className="bw-bonus-annonce-multi" role="status">
          <small>{tr('Multiplicateur de la roue', 'Wheel multiplier')}</small>
          <strong>×{b.multiplicateur}</strong>
          <span>{tr('Tous les gains de ce bonus sont multipliés\u00a0!', 'Every win in this bonus is multiplied!')}</span>
        </div>
      )}
      {nom !== 'revele' && nom !== 'intro' && (b.type !== 'restaurant' || nom === 'cloches') && (b.type !== 'express' || nom === 'wagons') && b.type !== 'chaudiere' && (b.type !== 'baron' || nom === 'cartes') && (b.type !== 'course' || nom === 'grille') && (
        <div className="bw-bonus-consigne">
          <span>{texte}</span>
          {rang >= 0 && (b.mise > 0 ? b.mesChoix[rang] !== null ? <small>{tr('Choix fait : on attend les autres…', 'Done: waiting for the others…')}</small> : <small>{tr(`Ta mise : ${dollars(b.mise)}`, `Your bet: ${dollars(b.mise)}`)}</small> : <small>{tr('Tu regardes : tu n’as pas misé sur ce bonus.', 'Watching: you did not bet on this bonus.')}</small>)}
          {v.phase === 'bonus' && <Barre v={v} cle={`${v.numero}-${b.etape}`} />}
        </div>
      )}
      {nom === 'revele' && b.mise > 0 && r && (
        <div className={`bw-bonus-resultat ${r.gain > 0 ? 'gagne' : 'perdu'} ${r.jackpot ? 'jackpot' : ''}`} role="status">
          {r.jackpot && (
            <span className="bw-resultat-plaque">
              <img src={`/cartes/bw-plaque-${r.jackpot}.webp`} alt="" />
              <b>{NOMS_JACKPOTS[r.jackpot]}</b>
            </span>
          )}
          <small>{r.jackpot ? `JACKPOT ${NOMS_JACKPOTS[r.jackpot]}` : b.type === 'chaudiere' ? (r.evade ? tr('Sifflé à temps\u00a0!', 'Whistled in time!') : tr('La chaudière a explosé\u00a0!', 'The boiler blew up!')) : b.type === 'express' ? (r.evade ? tr('Ton wagon est arrivé à Istanbul\u00a0!', 'Your carriage reached Istanbul!') : tr('Wagon décroché : il garde son butin', 'Carriage uncoupled: it keeps its loot')) : b.type === 'course' ? (r.evade ? tr('Ta draisine a gagné\u00a0!', 'Your handcar won!') : tr('Prime d’arrivée', 'Finish bonus')) : tr('Ta récompense', 'Your reward')}</small>
          <strong>{r.gain > 0 ? `${fx(r.x)} · +${dollars(r.gain)}` : tr('Pas de butin cette fois', 'No loot this time')}</strong>
          {r.gain > 0 && !r.jackpot && b.multiplicateur > 1 && <em>{tr(`${fx(r.x / b.multiplicateur)} × ${b.multiplicateur} (multiplicateur de la roue)`, `${fx(r.x / b.multiplicateur)} × ${b.multiplicateur} (wheel multiplier)`)}</em>}
        </div>
      )}
      {nom === 'revele' && !b.mise && <div className="bw-bonus-resultat spectateur">{tr('Mise sur ce bonus à la prochaine manche pour jouer\u00a0!', 'Bet on this bonus next round to play!')}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// L'écran

export function JeuBaronWheel({ vue, appel, onRetour }: { vue: VueCasino; appel: Appel; onRetour: () => void }) {
  const [v, setV] = useState<VueBW | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [journal, setJournal] = useState(false);
  const [jeton, setJeton] = useState<number>(() => {
    try {
      const x = Number(localStorage.getItem(CLE_JETON));
      return JETONS_BW.includes(x) ? x : JETONS_BW[1];
    } catch {
      return JETONS_BW[1];
    }
  });
  const [pluie, setPluie] = useState<{ n: number; id: number } | null>(null);
  /** Mode automatique : mes mises rejouées à chaque manche, pour un nombre de manches choisi. */
  const [auto, setAuto] = useState({ actif: false, restants: 0 });
  const [choixAuto, setChoixAuto] = useState(false);
  const autoRef = useRef(auto);
  autoRef.current = auto;
  const autoManche = useRef(-1);
  const minuterieAuto = useRef(0);
  useEffect(() => () => window.clearTimeout(minuterieAuto.current), []);
  const [credit, setCredit] = useState<{ montant: number; id: number } | null>(null);
  const [fete, setFete] = useState<{ jackpot: JackpotBW; gain: number; id: number } | null>(null);
  const [palier, setPalier] = useState<{ n: number; gain: number; id: number } | null>(null);
  const aiguille = useRef<HTMLImageElement | null>(null);
  const minuteries = useRef<number[]>([]);
  const plusTard = (f: () => void, ms: number) => minuteries.current.push(window.setTimeout(f, ms));
  useEffect(() => () => minuteries.current.forEach((m) => window.clearTimeout(m)), []);
  const solde = useSoldeAnime(v?.solde ?? vue.solde);
  const horloges = useRef<HorlogesRoue>({ v: null, debut: null, numero: -1 });
  const lampes = useRef<(HTMLDivElement | null)[]>([]);

  const [finPhase, setFinPhase] = useState<number | null>(null);
  const clePhase = useRef('');

  useEffect(() => window.scrollTo(0, 0), []);
  // Les images des mini-jeux se chargent en fond pendant qu'on mise : le bonus s'affiche ensuite sans attendre.
  useEffect(() => {
    const t = window.setTimeout(prechargerLesBonus, 1500);
    return () => window.clearTimeout(t);
  }, []);
  // Le Rapide de Minuit a sa propre musique, le temps du voyage.
  const enExpress = v?.bonus?.type === 'express' && (v.phase === 'bonus' || v.phase === 'resultat');
  useEffect(() => {
    if (!enExpress) return;
    musiqueDuCasino('express');
    return () => musiqueDuCasino('baronWheel');
  }, [enExpress]);
  useEffect(() => {
    try {
      localStorage.setItem(CLE_JETON, String(jeton));
    } catch {
      /* préférence non gardée */
    }
  }, [jeton]);

  useEffect(() => {
    let vivant = true;
    const entrer = async (essai = 0): Promise<void> => {
      const r = (await appel('casino_bw_entrer')) as { ok: boolean; erreur?: string; roue?: VueBW };
      if (!vivant) return;
      if (r.ok && r.roue) {
        setErreur(null);
        return setV(r.roue);
      }
      if (essai < 5) return void window.setTimeout(() => void entrer(essai + 1), 1200);
      setErreur(r.erreur ?? tr('La roue est indisponible pour le moment.', 'The wheel is unavailable right now.'));
    };
    void entrer();
    const surVue = (x: VueBW) => setV(x);
    const surConnexion = () => window.setTimeout(() => void entrer(), 2600);
    socket.on('casino_bw', surVue);
    socket.on('connect', surConnexion);
    return () => {
      vivant = false;
      socket.off('casino_bw', surVue);
      socket.off('connect', surConnexion);
      socket.emit('casino_bw_quitter');
    };
  }, [appel]);

  // Chaque vue recale l'horloge de la roue, et lance les sons et les fêtes des changements de phase.
  const precedente = useRef<VueBW | null>(null);
  useEffect(() => {
    if (!v) return;
    const h = horloges.current;
    const maintenant = performance.now();
    if (v.numero !== h.numero || v.phase !== 'tour') h.debut = null;
    if (v.tour) {
      const estime = maintenant - v.tour.ecoule;
      h.debut = h.debut === null ? estime : Math.min(h.debut, estime);
    }
    h.numero = v.numero;
    h.v = v;
    // La fin de la phase, calée une fois par phase : on garde l'estimation la plus tôt (la moins retardée par le
    // réseau), pour que le compte à rebours ne saute pas à chaque vue.
    const cle = `${v.numero}-${v.phase}-${v.bonus?.etape ?? ''}`;
    const fin = v.reste === null ? null : Date.now() + v.reste;
    const changePhase = clePhase.current !== cle;
    clePhase.current = cle;
    setFinPhase((avant) => (fin === null ? null : changePhase || avant === null ? fin : Math.min(avant, fin)));

    const avant = precedente.current;
    precedente.current = v;
    if (!avant) return;
    const etapeNom = (x: VueBW) => (x.bonus ? x.bonus.etapes[x.bonus.etape].nom : '');
    const change = avant.numero !== v.numero || avant.phase !== v.phase || etapeNom(avant) !== etapeNom(v);
    if (!change) return;
    if (v.phase === 'multiplicateurs') jouerEffet('bw_cloche');
    // Arrêt sur une case multipliée : son multiplicateur s'illumine au Top Slot.
    if (avant.phase === 'tour' && v.phase === 'resultat' && v.arret !== null && (v.multiplicateurs?.find((b) => b.i === v.arret)?.x ?? 1) > 1) plusTard(() => jouerEffet('bw_multi'), 300);
    if (v.phase === 'tour') {
      jouerEffet('bw_lancer');
      jouerEffet('bw_sifflet');
    }
    if (avant.phase === 'tour' && v.phase !== 'tour') jouerEffet('bw_arret');
    if (v.phase === 'bonus' && v.bonus) {
      const n = etapeNom(v);
      // L'Express et le Wagon-Restaurant jouent leurs propres sons.
      if (n === 'intro' && v.bonus.type !== 'express' && v.bonus.type !== 'restaurant') jouerEffet(v.bonus.type === 'baron' ? 'bw_baron' : v.bonus.type === 'course' ? 'course_appel' : 'ex_sifflet');
      if (n === 'revele') {
        if (v.bonus.type === 'baron') jouerEffet('bw_carte');
      }
    }
    if (v.phase === 'resultat' && avant.phase !== 'resultat' && v.bilan && v.bilan.mise > 0) {
      const { mise, gain } = v.bilan;
      const jp = v.bonus?.resultat?.jackpot;
      if (gain > 0) {
        setCredit({ montant: gain, id: Date.now() });
        plusTard(() => setCredit(null), 2700);
      }
      const np = palierGainBW(gain, mise);
      if (jp) {
        jouerEffet('bw_jackpot');
        setFete({ jackpot: jp, gain, id: Date.now() });
        plusTard(() => setFete(null), 5200);
      } else if (np > 0) {
        jouerEffet(np >= 3 ? 'bw_jackpot' : 'bw_gros');
        const id = Date.now();
        // Après le poinçon du contrôleur s'il y en a un.
        const attente = (v.multiplicateurs?.find((b) => b.i === v.arret)?.x ?? 1) > 1 && !mouvementReduit() ? 1500 : 300;
        plusTard(() => setPalier({ n: np, gain, id }), attente);
        plusTard(() => setPalier((p) => (p?.id === id ? null : p)), attente + 5200);
      } else if (gain >= 10 * mise && gain >= 500_000) jouerEffet('bw_gros');
      else if (gain > 0) jouerEffet('bw_gain');
      else jouerEffet('bw_perdu');
      if ((jp || gain >= 10 * mise) && gain > 0 && !mouvementReduit()) {
        setPluie({ n: jp || gain >= 1000 * mise ? 64 : gain >= 50 * mise ? 46 : 28, id: Date.now() });
        plusTard(() => setPluie(null), 3800);
      }
    }
  }, [v]);

  // Mode automatique : dès que les mises ouvrent, on rejoue celles de la manche d'avant (sauf si j'ai déjà misé).
  useEffect(() => {
    if (!v || !auto.actif || v.phase !== 'mises' || (v.reste ?? 0) < 1500 || autoManche.current === v.numero) return;
    autoManche.current = v.numero;
    if (Object.values(v.mesMises).some((x) => x)) return;
    if (!v.peutRefaire) {
      setAuto({ actif: false, restants: 0 });
      return;
    }
    window.clearTimeout(minuterieAuto.current);
    minuterieAuto.current = window.setTimeout(async () => {
      if (!autoRef.current.actif) return;
      const r = await appel('casino_bw_refaire');
      if (r.ok) {
        jouerEffet('jeton');
        setAuto((a) => (a.actif ? { actif: a.restants - 1 > 0, restants: a.restants - 1 } : a));
      } else {
        setAuto({ actif: false, restants: 0 });
        setErreur(tr(`Mode auto arrêté : ${r.erreur ?? 'mise impossible.'}`, `Auto play stopped: ${r.erreur ?? 'bet not allowed.'}`));
      }
    }, 650);
  }, [v, auto.actif, appel]);

  const secondes = useSecondes(v?.phase === 'mises' ? finPhase : null);
  const ouvertes = !!v && v.phase === 'mises' && (v.reste ?? 0) > 0;
  const maMise = v ? Object.values(v.mesMises).reduce((s: number, x) => s + (x ?? 0), 0) : 0;
  const envoyer = async (evt: string, data?: unknown) => {
    setErreur(null);
    const r = await appel(evt, data);
    if (!r.ok) setErreur(r.erreur ?? tr('Action impossible.', 'Action not allowed.'));
    return r.ok;
  };
  const miser = async (c: CaseBW) => {
    if (!v || !ouvertes) return;
    if (jeton > v.solde) return setErreur(tr('Solde insuffisant pour ce jeton.', 'Not enough money for this chip.'));
    if (await envoyer('casino_bw_miser', { case: c, montant: jeton })) jouerEffet('jeton');
  };

  let statut: ReactNode = tr('La roue se prépare…', 'The wheel is getting ready…');
  const multiArret = v ? (v.multiplicateurs?.find((b) => b.i === v.arret)?.x ?? 1) : 1;
  if (v) {
    const c = v.arret !== null ? ROUE_BW[v.arret] : null;
    if (v.phase === 'mises') statut = <strong>{tr(`Faites vos jeux · ${secondes} s`, `Place your bets · ${secondes} s`)}</strong>;
    else if (v.phase === 'multiplicateurs')
      statut = (
        <>
          <strong className="bw-statut-multi">{tr('Rien ne va plus\u00a0!', 'No more bets!')}</strong>
        </>
      );
    else if (v.phase === 'tour')
      statut = (
        <>
          <strong>{tr('La roue tourne…', 'The wheel is spinning…')}</strong>
        </>
      );
    // La Chaudière : le bouton sifflet a sa place juste au-dessus des mises (voir plus bas), pas de texte ici.
    else if (c === 'chaudiere' && v.phase === 'bonus') statut = null;
    else if (c && v.phase === 'bonus') statut = <strong>{tr(`Bonus : ${tr(...NOMS_BONUS[c as BonusBW])}\u00a0!`, `Bonus: ${tr(...NOMS_BONUS[c as BonusBW])}!`)}</strong>;
    else if (c)
      statut = (
        <strong className="bw-statut-resultat">
          <Pastille c={c} x={multiArret > 1 ? multiArret : undefined} />
          {estBonusBW(c) ? tr(...NOMS_BONUS[c]) : tr(`La case ${CASES_VISUELS[c].nom[0]} paie ${fx(GAINS_CHIFFRES_BW[c] * multiArret)}`, `${CASES_VISUELS[c].nom[1]} pays ${fx(GAINS_CHIFFRES_BW[c] * multiArret)}`)}
          {multiArret > 1 ? <em>{tr(`Multiplicateur ×${multiArret}\u00a0!`, `Multiplier ×${multiArret}!`)}</em> : null}
        </strong>
      );
  }
  const enBonus = !!v?.bonus && (v.phase === 'bonus' || v.phase === 'resultat');
  const gagnante = v && v.arret !== null && v.phase === 'resultat' ? ROUE_BW[v.arret] : null;

  return (
    <div className={`cas-ecran bw-ecran ${enBonus ? 'en-bonus' : ''}`} data-phase={v?.phase ?? 'mises'}>
      <header className="cas-barre">
        <button type="button" className="cas-retour" onClick={onRetour}>
          ‹ {tr('Salon', 'Lounge')}
        </button>
        <h1 className="bw-titre">
          <img src="/cartes/bw-logo.webp" alt="Le Baron Express" draggable={false} />
        </h1>
        <span className={`cas-solde-petit bw-solde ${credit ? 'credite' : ''}`}>
          {dollars(solde)}
          {credit && (
            <b key={credit.id} className="bw-credit">
              +{dollars(credit.montant)}
            </b>
          )}
        </span>
      </header>

      {v && <BandeauEvenements v={v} />}
      {v?.ouverture ? (
        <p className="bw-ouverture" role="status">
          <strong>{tr('Grande ouverture', 'Grand opening')}</strong>
          <span>{tr('XP ×2 sur la roue', 'XP ×2 on the wheel')}</span>
        </p>
      ) : null}

      <div className="bw-droite">

      <TableauDeparts historique={v?.historique ?? []} onJournal={() => setJournal(true)} />
      {v && <Compteurs v={v} />}
      </div>

      <div className="bw-gauche">
      {v && !enBonus && <TopSlot v={v} />}
      <div className="bw-plateau">
        {v && !enBonus && <LampesDecor lampes={lampes} />}
        {v && (enBonus ? <SceneBonus v={v} appel={appel} onErreur={setErreur} /> : <Roue v={v} horloges={horloges} lampes={lampes} aiguille={aiguille} />)}
        {v && !enBonus && <Manometre aiguille={aiguille} />}
        {!v && <div className="chargement">{erreur ?? tr('La roue arrive…', 'The wheel is coming…')}</div>}
        <span className="bw-direct">
          {tr('En direct', 'Live')}
          {v ? ` · ${v.spectateurs}` : ''}
        </span>
      </div>

      <div className="bw-statut" role="status">
        {statut}
        {v?.phase === 'mises' && <Barre v={v} cle={`m${v.numero}`} />}
      </div>

      {v && v.phase === 'resultat' && v.bonus && <Podium v={v} />}

      {v?.bilan && v.bilan.mise > 0 && (
        <div className={`bw-bilan ${v.bilan.gain > v.bilan.mise ? 'gagne' : v.bilan.gain > 0 ? 'rendu' : 'perdu'}`}>
          <span>
            <small>{tr('Mises', 'Bets')}</small>
            {dollars(v.bilan.mise)}
          </span>
          <span>
            <small>{tr('Gains', 'Winnings')}</small>
            {dollars(v.bilan.gain)}
          </span>
          <span>
            <small>{tr('Résultat', 'Net')}</small>
            {v.bilan.gain - v.bilan.mise >= 0 ? '+' : '−'}
            {dollars(Math.abs(v.bilan.gain - v.bilan.mise))}
          </span>
          <span>
            <small>{tr('Solde', 'Balance')}</small>
            {dollars(v.solde)}
          </span>
        </div>
      )}

      </div>

      <div className="bw-droite bas">
      {/* La Chaudière : le bouton sifflet (le bonus l'y installe), entre le jeu et les mises ; il disparaît ensuite et
          les mises reprennent leur place. */}
      {v?.phase === 'bonus' && v.arret !== null && ROUE_BW[v.arret] === 'chaudiere' && <div id="ch-commande" className="ch-commande" />}
      <section className="bw-commandes" role="group" aria-label={tr('Tes mises', 'Your bets')}>
        <div className="bw-tapis">
          {CASES_BW.map((c) => {
            const vis = CASES_VISUELS[c];
            const m = v?.mesMises[c] ?? 0;
            const multis = [...new Set((v?.multiplicateurs ?? []).filter((b) => ROUE_BW[b.i] === c).map((b) => b.x))];
            return (
              <button key={c} type="button" className={`bw-case ${c} ${m ? 'misee' : ''} ${gagnante === c ? 'gagnante' : ''} ${multis.length ? 'multipliee' : ''}`} style={{ '--fond': vis.fond, '--texte': vis.texte, '--matiere': `url(${vis.matiere})` } as CSSProperties} onClick={() => void miser(c)} disabled={!ouvertes} aria-label={`${tr(...vis.nom)} ${m ? dollars(m) : ''}`}>
                {vis.image ? <img src={vis.image} alt="" draggable={false} /> : <strong>{fx(GAINS_CHIFFRES_BW[c as 'x1'])}</strong>}
                <NomCase texte={estBonusBW(c) ? tr(...vis.nom) : tr(`case ${vis.nom[0]}`, `${vis.nom[1]} spot`)} />
                {multis.length > 0 && (
                  <span className="bw-case-multi">
                    {[...multis]
                      .sort((a, b) => b - a)
                      .map((x, k) => (
                        <b key={k} className={`bw-billet b-${rangBillet(x)}`}>
                          ×{x}
                        </b>
                      ))}
                  </span>
                )}
                {c === 'express' && <small className="bw-case-sous">{tr('Case unique · ×10 à ×10 000', 'One spot · ×10 to ×10,000')}</small>}
                {m > 0 && (
                  <span className="bw-case-mise">
                    <img src={`/cartes/jeton-${imageJeton(m)}.webp`} alt="" />
                    {court(m)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="bj-jetons">
          {JETONS_BW.map((j) => (
            <button key={j} type="button" className={`bj-jeton ${j === jeton ? 'choisi' : ''}`} onClick={() => (setJeton(j), jouerEffet('jeton'))} disabled={!!v && j > v.solde && j !== jeton} aria-pressed={j === jeton} aria-label={dollars(j)}>
              <img src={`/cartes/jeton-${imageJeton(j)}.webp`} alt="" />
              <span>{court(j)}</span>
            </button>
          ))}
        </div>
        <p className="bj-mise-encours bw-mise">
          {tr('Ta mise', 'Your bet')} <strong>{dollars(maMise)}</strong>
          <small>{MAX_CASE_BW === MAX_MANCHE_BW ? tr(`Au plus ${court(MAX_MANCHE_BW)} par case et par manche`, `At most ${court(MAX_MANCHE_BW)} per spot and per round`) : tr(`Au plus ${court(MAX_CASE_BW)} par case, ${court(MAX_MANCHE_BW)} par manche`, `At most ${court(MAX_CASE_BW)} per spot, ${court(MAX_MANCHE_BW)} per round`)}</small>
        </p>
        {choixAuto && !auto.actif ? (
          <div className="bj-boutons bw-auto-choix" role="group" aria-label={tr('Mode automatique', 'Auto play')}>
            <span>{tr('Rejouer mes mises pendant', 'Repeat my bets for')}</span>
            {CHOIX_AUTO.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => {
                  jouerEffet('jeton');
                  setChoixAuto(false);
                  autoManche.current = -1;
                  setAuto({ actif: true, restants: n });
                }}
              >
                {n === Infinity ? '∞' : n}
              </button>
            ))}
            <button type="button" className="bw-auto-fermer" onClick={() => setChoixAuto(false)} aria-label={tr('Fermer', 'Close')}>
              ✕
            </button>
          </div>
        ) : (
          <div className="bj-boutons">
            <button type="button" onClick={() => void envoyer('casino_bw_annuler')} disabled={!ouvertes || !maMise}>
              {tr('Annuler', 'Undo')}
            </button>
            <button type="button" onClick={() => void envoyer('casino_bw_annuler', { tout: true })} disabled={!ouvertes || !maMise}>
              {tr('Effacer', 'Clear')}
            </button>
            <button type="button" onClick={() => void envoyer('casino_bw_doubler').then((ok) => ok && jouerEffet('jeton'))} disabled={!ouvertes || !maMise}>
              {tr('Doubler', 'Double')}
            </button>
            <button type="button" className="bj-principal" onClick={() => void envoyer('casino_bw_refaire').then((ok) => ok && jouerEffet('jeton'))} disabled={!ouvertes || !!maMise || !v?.peutRefaire}>
              {tr('Répéter', 'Repeat')}
            </button>
            {auto.actif ? (
              <button type="button" className="bw-auto actif" onClick={() => setAuto({ actif: false, restants: 0 })} aria-label={tr('Arrêter le mode automatique', 'Stop auto play')}>
                Stop · {auto.restants === Infinity ? '∞' : auto.restants}
              </button>
            ) : (
              <button type="button" className="bw-auto" onClick={() => setChoixAuto(true)} disabled={!maMise && !v?.peutRefaire}>
                Auto ▾
              </button>
            )}
          </div>
        )}
        {auto.actif && <p className="bw-auto-etat">{auto.restants === Infinity ? tr('Mode auto : tes mises sont rejouées à chaque manche.', 'Auto play: your bets are repeated every round.') : tr(`Mode auto : encore ${auto.restants} manche${auto.restants > 1 ? 's' : ''}.`, `Auto play: ${auto.restants} more round${auto.restants > 1 ? 's' : ''}.`)}</p>}
        {erreur && v && <p className="cas-erreur">{erreur}</p>}
      </section>

      <aside className="bw-joueurs" aria-label={tr('Cette manche', 'This round')}>
        <h2>
          {tr('Cette manche', 'This round')}
          {v ? <small> · {tr(`manche n° ${v.numero}`, `round #${v.numero}`)}</small> : null}
        </h2>
        {v?.joueurs.length ? (
          <ol>
            {v.joueurs.map((j, k) => (
              <li key={k} className={`${j.moi ? 'moi' : ''} ${j.gain ? 'gagne' : ''}`}>
                <img src={`/cartes/avatar-${j.avatar}.webp`} alt="" />
                <span className="bw-joueur-nom">{j.nom}</span>
                <span className="bw-joueur-mise">{dollars(j.mise)}</span>
                <strong>
                  {j.jackpot && <em>{NOMS_JACKPOTS[j.jackpot]}</em>}
                  {j.gain === null ? '—' : j.gain > 0 ? `+${dollars(j.gain)}` : tr('perdu', 'lost')}
                </strong>
              </li>
            ))}
          </ol>
        ) : (
          <p className="discret">{tr('Personne n’a encore misé sur cette manche.', 'Nobody has bet on this round yet.')}</p>
        )}
        <p className="cas-mention">
          {tr(
            '30 cases, toutes avec la même chance : 9 cases 1X (paient ×2), 6 cases 2X (×3), 4 cases 5X (×5), 2 cases 10X (×10), 8 cases bonus : Baron (2), Course des draisines (2), Chaudière (2) et Cloche (2), et la case unique du Rapide de Minuit : chaque wagon gagne au moins ×10 et le seul qui arrive à Istanbul ouvre le Coffre du Baron (×50 à ×10 000). Au Choix du Baron, le Baron distribue neuf cartes (×5 à ×250) ; la carte du Baron cache un jackpot. À la Course des draisines, chacun choisit l’une des quatre draisines d’après sa cote (×12 à ×902) : la gagnante paie sa cote, les autres ×2. À la Chaudière, la pression monte de ×10 à ×1 000 : tire le sifflet avant qu’elle explose (sans sifflet, il part tout seul à ×20). À la Cloche, chacun choisit l’une des six cloches : le plat dessous paie de ×3 (velouté) à ×500 (le Plat du Baron), et la cloche que le Baron dore compte double. Une fois les mises fermées, le Top Slot tire une case et un multiplicateur de ×2 à ×200 : toutes les cases de ce type sur la roue sont multipliées, bonus compris. Les jackpots (MINI ×25 à GRAND ×500) sont des récompenses fixes cachées dans le Choix du Baron. Jetons de 1 000 à 10 000 000 $ : 30 000 000 $ au plus par case et par manche. Heure de pointe, chaque soir de 19 h à 20 h : le Top Slot donne toujours au moins ×5. Grand Départ, le samedi et le dimanche de 18 h à 22 h : l’XP compte double sur la roue.',
            '30 spots, all equally likely: 9 1X spots (pay ×2), 6 2X (×3), 4 5X (×5), 2 10X (×10), 8 bonus spots: Baron (2), Handcar Race (2), Boiler (2) and Cloche (2), and the one-of-a-kind Midnight Flyer spot: every carriage wins at least ×10 and the only one reaching Istanbul opens the Baron’s Safe (×50 to ×10,000). In the Baron’s Choice, the Baron deals nine cards (×5 to ×250); the Baron’s card hides a jackpot. In the Handcar Race, everyone picks one of four handcars by its odds (×12 to ×902): the winner pays its odds, the others ×2. In the Boiler, the pressure climbs from ×10 to ×1,000: pull the whistle before it blows (no whistle: it goes off by itself at ×20). In the Cloche, everyone picks one of six cloches: the dish beneath pays from ×3 (velouté) to ×500 (the Baron’s Dish), and the cloche the Baron gilds counts double. Once bets close, the Top Slot draws a spot and a ×2 to ×200 multiplier: every spot of that kind on the wheel is multiplied, bonuses included. The jackpots (MINI ×25 to GRAND ×500) are fixed rewards hidden in the Baron’s Choice. Chips from $1,000 to $10,000,000: $30,000,000 at most per spot and per round. Rush hour, every evening from 7 to 8 pm (Paris time): the Top Slot always gives at least ×5. Grand Departure, Saturday and Sunday from 6 to 10 pm: XP counts double on the wheel.',
          )}
        </p>
      </aside>
      </div>

      {journal && <Journal appel={appel} onFermer={() => setJournal(false)} />}
      {fete && (
        <div className={`bw-fete ${fete.jackpot}`} key={fete.id} role="status" onClick={() => setFete(null)}>
          <div className="bw-fete-rayons" aria-hidden="true" />
          <small>JACKPOT</small>
          <span className="bw-fete-plaque">
            <img src={`/cartes/bw-plaque-${fete.jackpot}.webp`} alt="" />
            <strong>{NOMS_JACKPOTS[fete.jackpot]}</strong>
          </span>
          <b>+{dollars(fete.gain)}</b>
        </div>
      )}
      {palier && <PalierGain key={palier.id} n={palier.n} gain={palier.gain} onFermer={() => setPalier(null)} />}
      {pluie && <PluieLingots key={`pluie-${pluie.id}`} n={pluie.n} objets={BUTIN_PLUIE} />}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Dans le salon : le bandeau de la grande ouverture

/** « 6 j 23 h », « 5 h 12 », « 34 min ». */
function dureeOuverture(ms: number): string {
  const m = Math.max(1, Math.ceil(ms / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h >= 24) return tr(`${Math.floor(h / 24)} j ${h % 24} h`, `${Math.floor(h / 24)} d ${h % 24} h`);
  return `${h} h ${String(m % 60).padStart(2, '0')}`;
}

export function BandeauOuvertureBW({ vue, onOuvrir }: { vue: VueCasino; onOuvrir: () => void }) {
  const reste = vue.baronWheel?.ouverture ?? null;
  const fin = useMemo(() => (reste === null ? null : Date.now() + reste), [reste]);
  const [, setTic] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTic((x) => x + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);
  if (fin === null || fin <= Date.now()) return null;
  return (
    <button type="button" className="bw-bandeau-ouverture" onClick={onOuvrir}>
      <img src="/cartes/bw-logo.webp" alt="Le Baron Express" draggable={false} />
      <span>
        <em>{tr('Grande ouverture', 'Grand opening')}</em>
        <strong>{tr('La nouvelle roue géante du Baron est ouverte\u00a0!', 'The Baron’s new giant wheel is open!')}</strong>
        <small>{tr('XP ×2 sur la roue · cadeau d’ouverture à récupérer en haut du salon', 'XP ×2 on the wheel · opening gift to collect at the top of the lounge')}</small>
        <i>{tr(`Encore ${dureeOuverture(fin - Date.now())}`, `${dureeOuverture(fin - Date.now())} left`)}</i>
      </span>
    </button>
  );
}

