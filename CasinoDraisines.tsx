/**
 * La Course des draisines (Le Baron Express) : quatre draisines (Rubis, Saphir, Émeraude, Or) sur quatre voies
 * parallèles. Chacun choisit la sienne d'après sa cote ; au coup de pistolet du Baron, les équipages pompent : des
 * dépassements, parfois une draisine qui déraille, puis le sprint final jusqu'au poteau d'arrivée. La gagnante paie sa
 * cote, les autres la prime d'arrivée (×2).
 *
 * Le serveur envoie les cotes dès la grille, puis l'issue (la gagnante, celle qui déraille, la graine) au départ, quand
 * plus personne ne peut changer de draisine : la course est un scénario tiré de cette graine, le même sur tous les
 * écrans. La scène est vue de profil, en travelling : les voies sont étagées en profondeur (la plus lointaine en haut,
 * plus petite), le décor défile plus lentement que les voies, la foule du premier plan plus vite.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { NB_DRAISINES, PRIME_COURSE_BW, type VueBonusBW, type VueBW } from '../../shared/baronWheel';
import { fx } from './CasinoBaronExpress';
import { tr } from './traduction';
import { jouerEffet, mouvementReduit } from './ui';
import './draisines.css';

/** Les quatre équipages, dans l'ordre des voies (de la plus lointaine à la plus proche). */
export const EQUIPAGES = [
  { cle: 'rubis', nom: ['Rubis', 'Ruby'] as [string, string], couleur: '#9b1b2c', texte: '#ffe9b0' },
  { cle: 'saphir', nom: ['Saphir', 'Sapphire'] as [string, string], couleur: '#1d3577', texte: '#eaf0ff' },
  { cle: 'emeraude', nom: ['Émeraude', 'Emerald'] as [string, string], couleur: '#0c6236', texte: '#eaf7ea' },
  { cle: 'or', nom: ['Or', 'Gold'] as [string, string], couleur: '#c99a3a', texte: '#2a1405' },
];

/** Les images de la Course (sans chemin ni extension), préchargées avant le bonus. */
export const IMAGES_DRAISINES_NOMS = [
  'dr-logo',
  'dr-panorama',
  'dr-voie',
  'dr-foule',
  'dr-mat-depart',
  'dr-poteau-arrivee',
  'dr-baron-pret',
  'dr-baron-tir',
  'dr-coup-feu',
  'dr-poussiere',
  'dr-etincelles',
  'dr-photo',
  'dr-trophee',
  ...EQUIPAGES.flatMap((e) => [`dr-${e.cle}-a`, `dr-${e.cle}-b`, `dr-${e.cle}-chute`, `dr-pilotes-${e.cle}`]),
];
const IMG = (n: string) => `/cartes/${n}.webp`;

// ---------------------------------------------------------------------------------------------------------------
// Le scénario de la course (le même sur tous les écrans : tiré de la graine du serveur)

/** La longueur de la piste, en longueurs de draisine (celle de la voie la plus proche). */
const LONGUEUR = 16;
/** Le calendrier de l'étape de course (ms) : les quatre feux, le coup de pistolet, l'arrivée de la gagnante. */
const FEUX = [400, 800, 1200, 1600];
const DEPART = 2000;
const ARRIVEE = 10_600;
/** La part de la course où les draisines prennent leur vitesse. */
const ELAN = 0.12;

function hasard(graine: number) {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Scenario {
  /** L'instant (ms après le départ) où chaque draisine passe la ligne. */
  arrivees: number[];
  /** L'instant du déraillement (ms après le départ), s'il y en a un. */
  chute: number | null;
  deraille: number | null;
  gagnant: number;
  /** Photo-finish : la deuxième passe la ligne moins de 0,2 s après la gagnante. */
  photo: boolean;
  /** La position (en longueurs de draisine, l'avant de la draisine) à l'instant t (ms après le départ). */
  position: (i: number, t: number) => number;
  /** La vitesse (longueurs par seconde) à l'instant t. */
  vitesse: (i: number, t: number) => number;
}

/** L'avancée normalisée (0 au départ, 1 à l'arrivée) : une prise d'élan, puis la pleine vitesse ; au-delà, elle roule sur son élan. */
function avancee(u: number): number {
  const k = 1 - ELAN / 2;
  if (u <= 0) return 0;
  if (u < ELAN) return (u * u) / (2 * ELAN) / k;
  if (u <= 1) return (u - ELAN / 2) / k;
  return 1 + ((1 - Math.exp(-(u - 1) / 0.06)) * 0.06) / k;
}

function scenarioCourse(c: { cotes: number[]; gagnant: number; deraille: number | null; graine: number }): Scenario {
  const r = hasard(c.graine);
  const n = c.cotes.length;
  // Les écarts à l'arrivée : la deuxième de très près (photo-finish) une fois sur trois, puis les suivantes.
  const autres = Array.from({ length: n }, (_, k) => k).filter((k) => k !== c.gagnant && k !== c.deraille);
  for (let i = autres.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [autres[i], autres[j]] = [autres[j], autres[i]];
  }
  const photo = r() < 0.35;
  let ecart = photo ? 60 + r() * 110 : 230 + r() * 380;
  const arrivees = Array(n).fill(ARRIVEE);
  for (const k of autres) {
    arrivees[k] = ARRIVEE + ecart;
    ecart += 160 + r() * 480;
  }
  if (c.deraille !== null) arrivees[c.deraille] = ARRIVEE + 900 + r() * 600;
  // Les à-coups de chaque équipage : trois ondes, nulles au départ et à l'arrivée (l'ordre d'arrivée ne bouge pas),
  // qui font les dépassements au milieu.
  const ondes = Array.from({ length: n }, () => [1, 2, 3].map((f) => ({ f: f * (0.7 + 0.6 * r()), ph: r() * Math.PI * 2, a: (0.5 / f) * (0.6 + 0.8 * r()) })));
  const chute = c.deraille !== null ? ARRIVEE * (0.35 + 0.3 * r()) : null;
  const brut = (i: number, t: number) => {
    const u = t / arrivees[i];
    const enveloppe = u <= 0 || u >= 1 ? 0 : Math.sin(Math.PI * u) ** 1.5;
    let bruit = 0;
    for (const o of ondes[i]) bruit += o.a * Math.sin(Math.PI * 2 * o.f * u + o.ph);
    // La gagnante se fait attendre : elle traîne au milieu de la course, puis remonte tout le monde au sprint.
    const retard = i === c.gagnant && u > 0 && u < 1 ? -0.55 * Math.sin(Math.PI * Math.min(1, u * 1.15)) ** 2 : 0;
    return LONGUEUR * avancee(u) + 0.75 * enveloppe * bruit + retard;
  };
  const position = (i: number, t: number) => {
    if (chute !== null && i === c.deraille && t > chute) {
      // Elle sort de la voie : elle glisse encore un peu, puis s'arrête.
      const v = (brut(i, chute + 30) - brut(i, chute - 30)) / 60;
      return brut(i, chute) + v * 320 * (1 - Math.exp(-(t - chute) / 320));
    }
    return Math.max(0, brut(i, t));
  };
  const vitesse = (i: number, t: number) => Math.max(0, (position(i, t + 40) - position(i, t - 40)) / 0.08);
  return { arrivees, chute, deraille: c.deraille, gagnant: c.gagnant, photo, position, vitesse };
}

// ---------------------------------------------------------------------------------------------------------------
// La scène (mise à jour image par image, sans passer par React)

interface DonneesCourse {
  nom: string;
  /** Le début de l'étape (horloge locale, recalée sur le serveur). */
  debut: number;
  scenario: Scenario | null;
  mien: number | null;
}
interface RefsCourse {
  scene: RefObject<HTMLDivElement>;
  ciel: RefObject<HTMLDivElement>;
  foule: RefObject<HTMLDivElement>;
  mat: RefObject<HTMLDivElement>;
  baron: RefObject<HTMLDivElement>;
  poteau: RefObject<HTMLDivElement>;
  voies: RefObject<HTMLDivElement>[];
  departs: RefObject<HTMLDivElement>[];
  arrivees: RefObject<HTMLDivElement>[];
  draisines: RefObject<HTMLDivElement>[];
  jetons: RefObject<HTMLSpanElement>[];
}
const nouvelleRef = <T,>(): RefObject<T> => ({ current: null });

/** La profondeur de chaque voie : son échelle et la hauteur de son rail (part de la hauteur de la scène). */
const ECHELLES = [0.62, 0.74, 0.87, 1];
const RAILS = [0.6, 0.69, 0.79, 0.9];
/** La voie (image vue de dessus, écrasée en hauteur) : la file de rail proche est à 68 % de sa hauteur. */
const VOIE = { ratio: 1100 / 192, etirement: 1.6, rail: 0.68 };
const lisse = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

function useSceneCourse(donnees: { current: DonneesCourse }, refs: RefsCourse) {
  useEffect(() => {
    const scene = refs.scene.current;
    if (!scene) return;
    const g = { W: 0, H: 0, u: 0 };
    const mesurer = () => {
      g.W = scene.clientWidth;
      g.H = scene.clientHeight;
      const portrait = g.H > g.W * 1.05;
      // Une draisine (sa longueur) : assez petite pour que les quatre voies restent lisibles l'une derrière l'autre.
      g.u = portrait ? g.W * 0.4 : Math.min(g.W * 0.2, g.H * 0.3);
      scene.style.setProperty('--u', `${g.u}px`);
    };
    mesurer();
    const ro = new ResizeObserver(mesurer);
    ro.observe(scene);
    const st = { cam: Number.NaN, phases: [0, 0, 0, 0], dernier: performance.now() };
    let raf = 0;
    const image = () => {
      raf = requestAnimationFrame(image);
      const d = donnees.current;
      const maintenant = performance.now();
      const dt = Math.min(64, maintenant - st.dernier);
      st.dernier = maintenant;
      if (!g.W) return;
      const tau = maintenant - d.debut;
      const reduit = mouvementReduit();
      const sc = d.scenario;
      const enCourse = d.nom === 'sprint' || d.nom === 'revele';
      // Le temps de course (ms après le coup de pistolet) : pendant la révélation, la course est finie.
      const t = d.nom === 'sprint' ? tau - DEPART : d.nom === 'revele' ? 20_000 : -1;
      const pos = (i: number) => (sc && enCourse ? sc.position(i, Math.max(0, t)) : 0);

      // La caméra : la grille au départ, puis la tête de la course (la draisine sortie de la voie ne compte plus).
      const Vw = g.W / g.u;
      let cible = -0.6;
      if (d.nom === 'intro') cible = -2.4 + 1.8 * lisse(tau / 2600);
      if (sc && enCourse && t > 0) {
        let tete = 0;
        for (let i = 0; i < NB_DRAISINES; i++) if (i !== sc.deraille || sc.chute === null || t < sc.chute) tete = Math.max(tete, pos(i));
        cible = Math.min(LONGUEUR + 0.35, Math.max(-0.6, tete - 0.5 - 0.16 * Vw));
      }
      st.cam = Number.isNaN(st.cam) || d.nom === 'intro' ? cible : st.cam + (cible - st.cam) * (1 - Math.exp(-dt * 0.004));
      const cam = st.cam;
      const ecran = (x: number, k: number) => g.W / 2 + (x - cam) * g.u * ECHELLES[k];

      // Le décor lointain et la foule du premier plan (parallaxe).
      if (refs.ciel.current) refs.ciel.current.style.backgroundPosition = `${-(cam + 3) * g.u * 0.1}px 0`;
      if (refs.foule.current) refs.foule.current.style.backgroundPosition = `${-cam * g.u * 1.12}px 0`;

      // Les voies, les lignes de départ et d'arrivée sur chacune.
      for (let k = 0; k < NB_DRAISINES; k++) {
        const s = ECHELLES[k];
        const yR = RAILS[k] * g.H;
        const th = g.u * s * 0.16;
        const voie = refs.voies[k].current;
        if (voie) {
          voie.style.top = `${yR - VOIE.rail * th}px`;
          voie.style.height = `${th}px`;
          const tuile = th * VOIE.ratio * VOIE.etirement;
          voie.style.backgroundSize = `${tuile}px ${th}px`;
          voie.style.backgroundPosition = `${-(((cam * g.u * s) % tuile) + tuile) % tuile}px 0`;
        }
        for (const [r, x] of [
          [refs.departs[k], 0],
          [refs.arrivees[k], LONGUEUR],
        ] as const) {
          const el = r.current;
          if (!el) continue;
          el.style.transform = `translate3d(${ecran(x, k) - th * 0.12}px, ${yR - VOIE.rail * th}px, 0)`;
          el.style.width = `${th * 0.24}px`;
          el.style.height = `${th}px`;
        }
      }

      // Le mât de départ, le Baron sur son podium et le poteau d'arrivée, derrière la voie la plus lointaine.
      const yFond = RAILS[0] * g.H - g.u * ECHELLES[0] * 0.16 * VOIE.rail;
      // (Leur largeur se calcule d'après leurs proportions : la lire forcerait une mise en page à chaque image.)
      const place = (el: HTMLDivElement | null, x: number, h: number, ratio: number, ancre: number) => {
        if (!el) return;
        el.style.height = `${h}px`;
        el.style.transform = `translate3d(${ecran(x, 0) - ancre * h * ratio}px, ${yFond - h}px, 0)`;
      };
      place(refs.mat.current, 0.5, g.H * 0.36, 451 / 1504, 0.5);
      place(refs.baron.current, -1.3, g.H * 0.34, 600 / 1235, 0.5);
      place(refs.poteau.current, LONGUEUR, g.H * 0.4, 600 / 1050, 0.25);

      // Les draisines : elles pompent au rythme de leur vitesse ; celle qui déraille bascule, puis disparaît.
      for (let i = 0; i < NB_DRAISINES; i++) {
        const el = refs.draisines[i].current;
        if (!el) continue;
        const s = ECHELLES[i];
        const w = g.u * s;
        const x = pos(i);
        const v = sc && enCourse ? sc.vitesse(i, Math.max(0, t)) : 0;
        const tombee = !!sc && enCourse && sc.deraille === i && sc.chute !== null && t > sc.chute;
        st.phases[i] += (dt / 1000) * (d.nom === 'grille' || d.nom === 'intro' ? 0.6 : 0.8 + 1.6 * v);
        const pose = reduit ? 0 : Math.floor(st.phases[i]) % 2;
        el.dataset.pose = tombee ? 'chute' : pose ? 'b' : 'a';
        el.style.setProperty('--vitesse', String(Math.min(1, v / 2)));
        const roulis = reduit || tombee ? 0 : Math.sin(maintenant * 0.02 + i * 1.7) * w * 0.004 * (0.3 + Math.min(1, v));
        el.style.width = `${w}px`;
        el.style.transform = `translate3d(${ecran(x, i) - w}px, ${RAILS[i] * g.H - w * 0.5 + roulis}px, 0)`;
        el.style.opacity = tombee && t - (sc?.chute ?? 0) > 1400 ? String(Math.max(0, 1 - (t - (sc?.chute ?? 0) - 1400) / 500)) : '1';
        // Le jeton sur la frise du classement.
        const j = refs.jetons[i].current;
        if (j) j.style.left = `${Math.min(100, Math.max(0, (x / LONGUEUR) * 100))}%`;
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

export function BonusDraisines({ v, b, nom, ouvert, choisir }: { v: VueBW; b: VueBonusBW; nom: string; ouvert: boolean; choisir: (o: number) => void }) {
  const c = b.course;
  const cotes = c?.cotes ?? [0, 0, 0, 0];
  const mien = b.mesChoix[0] ?? null;
  const salon = b.choixSalon[0] ?? [];
  const M = Math.max(1, b.multiplicateur);

  // L'horloge de l'étape (recalée sur le serveur) et un battement de 10 par seconde pour React.
  const cle = `${v.numero}-${b.etape}-${v.phase}`;
  const horloge = useRef({ cle: '', debut: 0 });
  const estime = performance.now() - ((v.duree ?? 0) - (v.reste ?? 0));
  if (horloge.current.cle !== cle) horloge.current = { cle, debut: estime };
  else horloge.current.debut = Math.min(horloge.current.debut, estime);
  const [maintenant, setMaintenant] = useState(() => performance.now());
  useEffect(() => {
    const id = window.setInterval(() => setMaintenant(performance.now()), 100);
    return () => window.clearInterval(id);
  }, []);
  const tau = maintenant - horloge.current.debut;
  const t = nom === 'sprint' ? tau - DEPART : nom === 'revele' ? 20_000 : -1;

  const sc = useMemo(
    () => (c && c.gagnant !== null && c.graine !== null ? scenarioCourse({ cotes: c.cotes, gagnant: c.gagnant, deraille: c.deraille, graine: c.graine }) : null),
    [c?.gagnant, c?.graine, c?.deraille, c?.cotes.join(',')],
  );

  const donnees = useRef<DonneesCourse>({ nom, debut: 0, scenario: null, mien });
  donnees.current = { nom, debut: horloge.current.debut, scenario: sc, mien };
  const refsScene = useRef<RefsCourse | null>(null);
  if (!refsScene.current)
    refsScene.current = {
      scene: nouvelleRef(),
      ciel: nouvelleRef(),
      foule: nouvelleRef(),
      mat: nouvelleRef(),
      baron: nouvelleRef(),
      poteau: nouvelleRef(),
      voies: EQUIPAGES.map(() => nouvelleRef<HTMLDivElement>()),
      departs: EQUIPAGES.map(() => nouvelleRef<HTMLDivElement>()),
      arrivees: EQUIPAGES.map(() => nouvelleRef<HTMLDivElement>()),
      draisines: EQUIPAGES.map(() => nouvelleRef<HTMLDivElement>()),
      jetons: EQUIPAGES.map(() => nouvelleRef<HTMLSpanElement>()),
    };
  const refs = refsScene.current;
  useSceneCourse(donnees, refs);

  // Ce qui se passe à l'instant.
  const feux = nom === 'sprint' ? FEUX.filter((f) => tau >= f).length : 0;
  const parti = nom === 'revele' || (nom === 'sprint' && tau >= DEPART);
  const vert = nom === 'sprint' && tau >= DEPART && tau < DEPART + 2500;
  const tir = nom === 'sprint' && tau >= DEPART - 60 && tau < DEPART + 1400;
  const chuteVue = !!sc && sc.chute !== null && t >= sc.chute;
  const arriveeGagnant = !!sc && t >= sc.arrivees[sc.gagnant];
  const photoFinish = !!sc && sc.photo && nom === 'sprint' && t >= sc.arrivees[sc.gagnant] && t < sc.arrivees[sc.gagnant] + 1300;
  const sprintFinal = !!sc && nom === 'sprint' && t >= ARRIVEE - 2600 && t < ARRIVEE - 600;
  const g = sc?.gagnant ?? null;

  // Les sons de la course.
  const joues = useRef(new Set<string>());
  const prochainRail = useRef(0);
  useEffect(() => {
    const fois = (k: string, f: () => void) => {
      const id = `${cle}-${k}`;
      if (joues.current.has(id)) return;
      joues.current.add(id);
      f();
    };
    if (v.phase !== 'bonus') return;
    if (nom === 'intro' && tau > 200) fois('foule', () => jouerEffet('course_foule', { volume: 0.55 }));
    if (nom !== 'sprint') return;
    FEUX.forEach((f, k) => tau >= f && tau < f + 400 && fois(`feu${k}`, () => jouerEffet('dr_feu', { vitesse: 1 + k * 0.04 })));
    if (tau >= DEPART && tau < DEPART + 600) fois('pistolet', () => jouerEffet('dr_pistolet'));
    if (tau >= DEPART + 150 && tau < DEPART + 900) fois('clameur', () => jouerEffet('course_foule', { volume: 0.7 }));
    if (sc) {
      if (t > 0 && t < ARRIVEE + 900 && maintenant >= prochainRail.current) {
        prochainRail.current = maintenant + 1950;
        jouerEffet('dr_rail', { volume: 0.55 + 0.2 * Math.min(1, t / ARRIVEE) });
      }
      if (sc.chute !== null && t >= sc.chute && t < sc.chute + 800)
        fois('chute', () => {
          jouerEffet('ev_fracas', { volume: 0.9 });
          jouerEffet('ex_freins', { volume: 0.6, vitesse: 1.3 });
        });
      if (t >= ARRIVEE - 2600 && t < ARRIVEE - 1800) fois('sprint', () => jouerEffet('course_appel', { volume: 0.6 }));
      if (t >= ARRIVEE && t < ARRIVEE + 900) {
        fois('arrivee', () => jouerEffet(mien !== null && mien === sc.gagnant ? 'course_gain' : 'course_foule', { volume: 0.8 }));
        if (sc.photo) fois('flash', () => jouerEffet('dr_flash'));
      }
    }
  });

  // L'annonce du moment.
  let annonce: { titre: string; sous?: string; ton?: string } | null = null;
  if (nom === 'sprint' && tau >= DEPART && tau < DEPART + 1300) annonce = { titre: tr('Partez !', 'Go!'), ton: 'depart' };
  else if (sc && chuteVue && sc.chute !== null && t < sc.chute + 1800 && sc.deraille !== null)
    annonce = { titre: tr(`${EQUIPAGES[sc.deraille].nom[0]} déraille !`, `${EQUIPAGES[sc.deraille].nom[1]} derails!`), sous: sc.deraille === mien ? tr('Ta draisine sort de la voie… prime d’arrivée ×2', 'Your handcar is off the rails… finish bonus ×2') : undefined, ton: 'chute' };
  else if (sprintFinal) annonce = { titre: tr('Sprint final !', 'Final sprint!'), ton: 'petit' };
  else if (photoFinish) annonce = { titre: tr('Photo-finish !', 'Photo finish!'), ton: 'photo' };
  else if (sc && g !== null && nom === 'sprint' && arriveeGagnant)
    annonce = {
      titre: tr(`${EQUIPAGES[g].nom[0]} l’emporte !`, `${EQUIPAGES[g].nom[1]} wins!`),
      sous: mien === g ? tr(`Ta draisine gagne : ${fx(cotes[g] * M)}`, `Your handcar wins: ${fx(cotes[g] * M)}`) : mien !== null ? tr(`Prime d’arrivée : ${fx(PRIME_COURSE_BW * M)}`, `Finish bonus: ${fx(PRIME_COURSE_BW * M)}`) : undefined,
      ton: 'victoire',
    };

  return (
    <div className={`dr ${nom} ${photoFinish ? 'photo' : ''}`} ref={refs.scene}>
      <div className="dr-ciel" ref={refs.ciel} />
      <div className="dr-objet dr-poteau" ref={refs.poteau}>
        <img src={IMG('dr-poteau-arrivee')} alt="" draggable={false} />
      </div>
      <div className={`dr-objet dr-mat ${vert ? 'vert' : ''}`} ref={refs.mat} style={{ '--feux': feux } as CSSProperties}>
        <img src={IMG('dr-mat-depart')} alt="" draggable={false} />
        {FEUX.map((_, k) => (
          <i key={k} className={`dr-feu ${k < feux ? 'allume' : ''}`} style={{ top: `${[22.8, 33.2, 43.8, 54.3][k]}%` }} />
        ))}
      </div>
      <div className={`dr-objet dr-baron ${tir ? 'tir' : ''} ${parti ? 'parti' : ''}`} ref={refs.baron}>
        <img className="pret" src={IMG('dr-baron-pret')} alt="" draggable={false} />
        <img className="tire" src={IMG('dr-baron-tir')} alt="" draggable={false} />
        {tir && <img className="dr-coup-feu" src={IMG('dr-coup-feu')} alt="" draggable={false} />}
      </div>

      {EQUIPAGES.map((e, k) => (
        <div key={e.cle} className="dr-couloir" style={{ zIndex: 2 + k * 2 } as CSSProperties}>
          <div className="dr-voie" ref={refs.voies[k]} />
          <div className="dr-ligne depart" ref={refs.departs[k]} />
          <div className="dr-ligne arrivee" ref={refs.arrivees[k]} />
          <div className={`dr-draisine ${mien === k ? 'mienne' : ''} ${g === k && arriveeGagnant ? 'gagnante' : ''}`} ref={refs.draisines[k]} data-pose="a">
            <img className="dr-poussiere" src={IMG('dr-poussiere')} alt="" draggable={false} />
            <img className="a" src={IMG(`dr-${e.cle}-a`)} alt="" draggable={false} />
            <img className="b" src={IMG(`dr-${e.cle}-b`)} alt="" draggable={false} />
            <img className="chute" src={IMG(`dr-${e.cle}-chute`)} alt="" draggable={false} />
            {g === k && sprintFinal && <img className="dr-etincelles" src={IMG('dr-etincelles')} alt="" draggable={false} />}
            <span className="dr-plaque" style={{ '--couleur': e.couleur, '--texte': e.texte } as CSSProperties}>
              {mien === k ? '★ ' : ''}
              {tr(...e.nom)}
              <b>{fx(cotes[k])}</b>
            </span>
          </div>
        </div>
      ))}
      <div className="dr-foule" ref={refs.foule} />

      {/* La frise du classement : chaque draisine vers le poteau d'arrivée. */}
      {(nom === 'sprint' || nom === 'revele') && (
        <div className="dr-frise" aria-hidden="true">
          {EQUIPAGES.map((e, k) => (
            <span key={e.cle} ref={refs.jetons[k]} className={`${mien === k ? 'mien' : ''} ${sc?.deraille === k && chuteVue ? 'tombe' : ''}`} style={{ '--couleur': e.couleur } as CSSProperties} />
          ))}
        </div>
      )}

      {nom === 'intro' && <img className="dr-logo" src={IMG('dr-logo')} alt={tr('La Course des draisines', 'The Handcar Race')} draggable={false} />}

      {nom === 'grille' && (
        <div className="dr-choix" role="group" aria-label={tr('Choisis ta draisine', 'Pick your handcar')}>
          {EQUIPAGES.map((e, k) => (
            <button key={e.cle} type="button" className={`dr-carte ${mien === k ? 'choisie' : ''} ${mien !== null && mien !== k ? 'autre' : ''}`} onClick={() => choisir(k)} disabled={!ouvert} style={{ '--couleur': e.couleur, '--texte': e.texte } as CSSProperties}>
              <img src={IMG(`dr-pilotes-${e.cle}`)} alt="" draggable={false} />
              <span className="dr-carte-nom">{tr(...e.nom)}</span>
              <strong className="dr-carte-cote">{fx(cotes[k] * M)}</strong>
              {salon[k] ? <i>{salon[k]}</i> : null}
            </button>
          ))}
        </div>
      )}

      {annonce && (
        <div className={`dr-annonce ${annonce.ton ?? ''}`} key={annonce.titre} role="status">
          <strong>{annonce.titre}</strong>
          {annonce.sous && <span>{annonce.sous}</span>}
        </div>
      )}

      {photoFinish && <div className="dr-flash" aria-hidden="true" />}
      {photoFinish && <img className="dr-cadre-photo" src={IMG('dr-photo')} alt="" draggable={false} />}

      {nom === 'revele' && g !== null && (
        <div className="dr-podium" role="status">
          <div className="dr-podium-photo">
            <img className="dr-podium-pilotes" src={IMG(`dr-pilotes-${EQUIPAGES[g].cle}`)} alt="" draggable={false} />
            <img className="dr-podium-cadre" src={IMG('dr-photo')} alt="" draggable={false} />
          </div>
          <img className="dr-trophee" src={IMG('dr-trophee')} alt="" draggable={false} />
          <span className="dr-podium-titre" style={{ '--couleur': EQUIPAGES[g].couleur, '--texte': EQUIPAGES[g].texte } as CSSProperties}>
            {tr(`${EQUIPAGES[g].nom[0]} gagne la course`, `${EQUIPAGES[g].nom[1]} wins the race`)} · {fx(cotes[g] * M)}
          </span>
        </div>
      )}
    </div>
  );
}
