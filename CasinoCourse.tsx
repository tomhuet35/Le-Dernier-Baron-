/**
 * La Course des Écuries (Salon privé) : des courses de chevaux en direct, communes à tout le salon. On mise sur un
 * cheval « gagnant » (il finit premier) ou « placé » (il finit dans les deux premiers), puis on regarde la course.
 *
 * Le serveur tient les courses et diffuse la vue (« casino_course ») ; à l'arrivée des mises fermées, il envoie le
 * scénario de la course (l'heure d'arrivée et l'allure de chaque cheval). Cet écran la met en scène, calée sur son
 * horloge : la piste défile sous les chevaux, la caméra suit la tête de la course, le décor (les tribunes, Paris la
 * nuit) défile plus lentement. Ce qui bouge à chaque image est écrit directement dans la page par une boucle
 * requestAnimationFrame, sans repasser par React.
 *
 * Visuels : course-fond.webp (tribunes et Paris, en boucle), course-piste.webp (la piste, en boucle),
 * course-cheval-1…6.webp (quatre images de galop par casaque), course-arche.webp (l'arrivée),
 * course-trophee.webp (le podium).
 */
import { useEffect, useRef, useState, type CSSProperties, type MutableRefObject, type RefObject } from 'react';
import type { VueCasino } from '../../shared/casino';
import {
  CASAQUES,
  JETONS_COURSE,
  LONGUEUR_COURSE,
  MAX_COURSE,
  MAX_MISE_COURSE,
  NB_CHEVAUX,
  progression,
  type PhaseCourse,
  type TypeMiseCourse,
  type VueCourse,
} from '../../shared/course';
import type { Appel } from './App';
import { BUTIN_PLUIE, dollars, PluieLingots, useSoldeAnime } from './casinoOutils';
import { socket } from './socket';
import { EN, tr } from './traduction';
import { jouerEffet, mouvementReduit } from './ui';
import './course.css';

const court = (n: number) => (n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${+(n / 1000).toFixed(n % 1000 ? 1 : 0)}k` : String(n));
const imageJeton = (v: number) => (v >= 500_000 ? 'violet' : v >= 100_000 ? 'noir' : v >= 25_000 ? 'vert' : v >= 5_000 ? 'rouge' : 'ivoire');
const cote = (x: number, decimales: number) => `×${x.toLocaleString(EN ? 'en-US' : 'fr-FR', { minimumFractionDigits: decimales, maximumFractionDigits: decimales })}`;
const CLE_JETON = 'ldb-course-jeton';
/** « Casaque bleue », « Blue silks ». */
const CASAQUES_FR = ['rouge', 'bleue', 'or', 'verte', 'violette', 'blanche'];
const nomCasaque = (c: number) => tr(`Casaque ${CASAQUES_FR[c]}`, `${CASAQUES[c].nom[1]} silks`);
/** La couleur de la casaque, et celle du numéro dessus (foncé sur l'or et le blanc). */
const couleurs = (c: number) => ({ '--casaque': CASAQUES[c].couleur, '--texte': c === 2 || c === 5 ? '#1b120c' : '#fff' }) as CSSProperties;

/** Ce qu'une mise rapporte une fois l'arrivée connue (mise comprise ; 0 si elle est perdue). */
function gainDe(v: VueCourse, cheval: number, type: TypeMiseCourse, montant: number): number {
  const ordre = v.scenario?.ordre;
  if (!ordre) return 0;
  const p = v.partants[cheval];
  if (type === 'gagnant') return ordre[0] === cheval ? Math.floor((montant * Math.round(p.cote * 100)) / 100) : 0;
  return ordre[0] === cheval || ordre[1] === cheval ? Math.floor((montant * Math.round(p.place * 100)) / 100) : 0;
}

// ---------------------------------------------------------------------------------------------------------------
// La scène

/** Les horloges de la scène, recalées à chaque vue sur celle du serveur (en millisecondes de performance.now()). */
interface Horloges {
  v: VueCourse | null;
  numero: number;
  /** Le départ de la course, et la fin de la phase en cours (mises, départ, résultats). */
  depart: number | null;
  fin: number | null;
  clePhase: string;
}

interface RefsScene {
  scene: RefObject<HTMLDivElement>;
  fond: RefObject<HTMLDivElement>;
  piste: RefObject<HTMLDivElement>;
  depart: RefObject<HTMLDivElement>;
  ligne: RefObject<HTMLDivElement>;
  arche: RefObject<HTMLImageElement>;
  poteaux: RefObject<HTMLDivElement>[];
  chevaux: RefObject<HTMLDivElement>[];
  sprites: RefObject<HTMLDivElement>[];
  points: RefObject<HTMLElement>[];
  distance: RefObject<HTMLElement>;
  compte: RefObject<HTMLElement>;
  barre: RefObject<HTMLElement>;
}

/** Les poteaux de distance le long de la corde (mètres avant l'arrivée). */
const POTEAUX = [1000, 800, 600, 400, 200];
/** Proportions d'une image du cheval (quatre images de galop côte à côte dans le fichier). */
const RATIO_CHEVAL = 230 / 146;

/**
 * La géométrie de la scène, en pixels, pour une largeur donnée. Tout est proportionnel à la hauteur de la scène, sauf
 * la longueur de la course (10 largeurs d'écran : la piste défile vite sous les chevaux, et le peloton tient dans
 * l'écran la plupart du temps).
 */
function geometrie(W: number) {
  // Plus haute que large sur téléphone (les chevaux restent grands), plus panoramique sur grand écran.
  const H = Math.round(Math.min(W * (0.74 - 0.24 * Math.min(1, Math.max(0, (W - 400) / 500))), 500));
  const yPiste = 0.36 * H;
  const hPiste = 0.64 * H;
  const hFond = (yPiste + 0.05 * H) / 0.78;
  const L = 10 * W;
  /** Le couloir c (0 au fond, 5 devant) : où posent les sabots, et la taille du cheval. */
  const sol = (c: number) => H * (0.645 + c * 0.051);
  const hCheval = (c: number) => 0.24 * H * (0.86 + c * 0.028);
  const hArche = 0.56 * H;
  return {
    W,
    H,
    yPiste,
    hPiste,
    hFond,
    /** Largeur d'un motif de la piste et du décor (ils se répètent). */
    motifPiste: (hPiste * 1500) / 540,
    motifFond: (hFond * 2700) / 450,
    L,
    sol,
    hCheval,
    hArche,
    lArche: (hArche * 720) / 501,
    xMin: -0.62 * W,
    xMax: L - 0.74 * W,
  };
}
type Geo = ReturnType<typeof geometrie>;

function useSceneCourse(h: MutableRefObject<Horloges>, refs: RefsScene, surArrivee: (numero: number) => void) {
  const surArriveeRef = useRef(surArrivee);
  surArriveeRef.current = surArrivee;
  useEffect(() => {
    let geo: Geo | null = null;
    const scene = refs.scene.current;
    if (!scene) return;

    // La taille de la scène suit sa largeur (calculée ici : aspect-ratio est capricieux sur les vieux Safari).
    const mesurer = () => {
      const W = scene.clientWidth;
      if (!W) return;
      geo = geometrie(W);
      const g = geo;
      scene.style.height = `${g.H}px`;
      const fond = refs.fond.current;
      // Le décor et la piste sont plus larges que la scène d'un motif : on les fait glisser (transform), sans repeindre.
      if (fond) {
        fond.style.height = `${g.hFond}px`;
        fond.style.width = `${Math.ceil(W + g.motifFond + 2)}px`;
        fond.style.backgroundSize = `auto ${g.hFond}px`;
      }
      const piste = refs.piste.current;
      if (piste) {
        piste.style.top = `${g.yPiste}px`;
        piste.style.height = `${g.hPiste}px`;
        piste.style.width = `${Math.ceil(W + g.motifPiste + 2)}px`;
        piste.style.backgroundSize = `auto ${g.hPiste}px`;
      }
      const haut = g.yPiste + 0.38 * g.hPiste;
      const bas = g.yPiste + 0.86 * g.hPiste;
      for (const el of [refs.depart.current, refs.ligne.current]) {
        if (!el) continue;
        el.style.top = `${haut}px`;
        el.style.height = `${bas - haut}px`;
        el.style.width = `${Math.max(6, 0.03 * g.H)}px`;
      }
      const arche = refs.arche.current;
      if (arche) {
        arche.style.height = `${g.hArche}px`;
        arche.style.width = `${g.lArche}px`;
        arche.style.top = `${haut + 0.02 * g.H - g.hArche}px`;
      }
      for (const p of refs.poteaux) {
        if (!p.current) continue;
        p.current.style.top = `${haut - 0.085 * g.H}px`;
        p.current.style.fontSize = `${Math.max(9, 0.042 * g.H)}px`;
      }
      refs.chevaux.forEach((r, c) => {
        if (!r.current) return;
        const hc = g.hCheval(c);
        r.current.style.width = `${hc * RATIO_CHEVAL}px`;
        r.current.style.height = `${hc}px`;
        r.current.style.fontSize = `${Math.max(9, hc * 0.17)}px`;
      });
    };
    mesurer();
    const ro = new ResizeObserver(mesurer);
    ro.observe(scene);

    const dernierTexte = { distance: '', compte: '' };
    const sons = { numero: -1, depart: false, foule: false, sabots: 0, arrivee: false };
    let raf = 0;
    const dessiner = () => {
      raf = requestAnimationFrame(dessiner);
      const g = geo;
      const H = h.current;
      const v = H.v;
      if (!g || !v) return;
      const maintenant = performance.now();
      const enCourse = (v.phase === 'course' || v.phase === 'resultat') && !!v.scenario && H.depart !== null;
      const t = enCourse ? maintenant - (H.depart as number) : 0;
      const s = enCourse ? v.scenario : null;

      // Où en est chaque cheval (0 au départ, 1 à l'arrivée ; au-delà, il ralentit après le poteau).
      const parts = Array.from({ length: NB_CHEVAUX }, (_, c) => (s ? progression(s, c, t) : 0));
      const tete = Math.max(...parts);
      const xTete = tete * g.L;
      const xQueue = Math.min(...parts) * g.L;
      // La caméra cadre le peloton (le milieu entre la tête et le dernier), sans jamais perdre la tête : elle reste
      // entre 60 % et 88 % de la largeur. Elle s'arrête quand l'arrivée est en vue.
      const centre = (xTete + xQueue) / 2 - 0.5 * g.W;
      const camera = Math.min(g.xMax, Math.max(g.xMin, Math.min(xTete - 0.6 * g.W, Math.max(xTete - 0.88 * g.W, centre))));

      // Le décor : la piste défile avec la caméra, les tribunes plus lentement.
      const modulo = (x: number, m: number) => ((x % m) + m) % m;
      if (refs.piste.current) refs.piste.current.style.transform = `translate3d(${-modulo(camera, g.motifPiste)}px, 0, 0)`;
      if (refs.fond.current) refs.fond.current.style.transform = `translate3d(${-modulo((camera - g.xMin) * 0.1, g.motifFond)}px, 0, 0)`;
      const placer = (el: HTMLElement | null, xMonde: number, largeur: number) => {
        if (!el) return;
        const x = xMonde - camera;
        const visible = x > -largeur - 40 && x < g.W + largeur + 40;
        el.style.visibility = visible ? 'visible' : 'hidden';
        if (visible) el.style.transform = `translate3d(${x}px, 0, 0)`;
      };
      placer(refs.depart.current, 0, 20);
      placer(refs.ligne.current, g.L, 20);
      placer(refs.arche.current, g.L - g.lArche / 2, g.lArche);
      refs.poteaux.forEach((p, k) => placer(p.current, g.L * (1 - POTEAUX[k] / LONGUEUR_COURSE), 60));

      // Les chevaux : position, image du galop (elle avance avec la distance), léger rebond.
      const calme = mouvementReduit();
      refs.chevaux.forEach((r, c) => {
        const el = r.current;
        const sp = refs.sprites[c].current;
        if (!el || !sp) return;
        const hc = g.hCheval(c);
        const wc = hc * RATIO_CHEVAL;
        const nez = parts[c] * g.L - camera;
        const x = nez - wc * 0.97;
        const pas = 0.36 * wc;
        const enGalop = enCourse && t > 0;
        const d = parts[c] * g.L;
        const image = enGalop ? Math.floor(d / pas + c * 1.3) % 4 : (c % 2) * 2;
        const rebond = enGalop && !calme ? -Math.abs(Math.sin(((d / pas + c * 1.3) * Math.PI) / 2)) * 0.03 * hc : 0;
        el.style.transform = `translate3d(${x}px, ${g.sol(c) - hc + rebond}px, 0)`;
        sp.style.backgroundPositionX = `${(image * 100) / 3}%`;
      });

      // La petite carte de la course et la distance qui reste à la tête.
      refs.points.forEach((p, c) => {
        if (p.current) p.current.style.left = `${Math.min(1, parts[c]) * 100}%`;
      });
      const reste = enCourse ? Math.max(0, Math.ceil(((1 - tete) * LONGUEUR_COURSE) / 10) * 10) : LONGUEUR_COURSE;
      const texteDistance = reste > 0 ? `${reste} m` : tr('Arrivée', 'Finish');
      if (refs.distance.current && texteDistance !== dernierTexte.distance) refs.distance.current.textContent = dernierTexte.distance = texteDistance;

      // Le compte à rebours des mises (et du départ).
      if ((v.phase === 'mises' || v.phase === 'depart') && H.fin !== null) {
        const ms = Math.max(0, H.fin - maintenant);
        const texte = String(Math.ceil(ms / 1000));
        if (refs.compte.current && texte !== dernierTexte.compte) refs.compte.current.textContent = dernierTexte.compte = texte;
        if (refs.barre.current && v.duree) refs.barre.current.style.transform = `scaleX(${Math.min(1, ms / v.duree)})`;
      }

      // Les sons : les stalles s'ouvrent, le galop, la foule dans la dernière ligne droite.
      if (sons.numero !== v.numero) Object.assign(sons, { numero: v.numero, depart: false, foule: false, sabots: 0, arrivee: false });
      if (enCourse && s) {
        const premier = s.arrivees[s.ordre[0]];
        const dernier = Math.max(...s.arrivees);
        if (!sons.depart && t < 1500) {
          sons.depart = true;
          jouerEffet('course_depart');
        }
        if (t < dernier + 400 && maintenant >= sons.sabots) {
          sons.sabots = maintenant + 1900;
          jouerEffet('course_sabots', { volume: t > premier ? 0.6 : 0.75 + 0.25 * Math.min(1, tete) });
        }
        if (!sons.foule && tete > 0.8 && t < premier + 1500) {
          sons.foule = true;
          jouerEffet('course_foule');
        }
        if (!sons.arrivee && t >= premier) {
          sons.arrivee = true;
          surArriveeRef.current(v.numero);
        }
      }
    };
    raf = requestAnimationFrame(dessiner);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);
}

/** Le podium, à l'arrivée : les trois premiers, et ce que j'ai gagné. */
function Podium({ v }: { v: VueCourse }) {
  const ordre = v.scenario?.ordre ?? [];
  const miseTotale = v.mesMises.reduce((s, m) => s + m.montant, 0);
  return (
    <div className="crs-podium" role="status">
      <img className="crs-trophee" src="/cartes/course-trophee.webp" alt="" draggable={false} />
      <div className="crs-podium-texte">
        <ol>
          {ordre.slice(0, 3).map((c, rang) => (
            <li key={c} className={`rang-${rang + 1}`} style={couleurs(c)}>
              <span className="crs-rang">{rang + 1}</span>
              <span className="crs-pastille">{c + 1}</span>
              <span className="crs-podium-nom">{v.partants[c].nom}</span>
              {rang === 0 && <b>{cote(v.partants[c].cote, 1)}</b>}
            </li>
          ))}
        </ol>
        {miseTotale > 0 && v.monGain !== null && (
          <p className={`crs-bilan ${v.monGain > 0 ? 'gagne' : 'perdu'}`}>
            {v.monGain > 0 ? tr(`Tu gagnes ${dollars(v.monGain)} !`, `You win ${dollars(v.monGain)}!`) : tr('Pas cette fois…', 'Not this time…')}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// L'écran

export function JeuCourse({ vue, appel, onRetour }: { vue: VueCasino; appel: Appel; onRetour: () => void }) {
  const [v, setV] = useState<VueCourse | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [jeton, setJeton] = useState<number>(() => {
    try {
      const x = Number(localStorage.getItem(CLE_JETON));
      return JETONS_COURSE.includes(x) ? x : JETONS_COURSE[1];
    } catch {
      return JETONS_COURSE[1];
    }
  });
  /** La tête vient de passer le poteau (numéro de la course) : on annonce le vainqueur. */
  const [arrivee, setArrivee] = useState(-1);
  const [pluie, setPluie] = useState<{ n: number; id: number } | null>(null);
  const [credit, setCredit] = useState<{ montant: number; id: number } | null>(null);
  const minuteries = useRef<number[]>([]);
  const plusTard = (f: () => void, ms: number) => minuteries.current.push(window.setTimeout(f, ms));
  useEffect(() => () => minuteries.current.forEach((m) => window.clearTimeout(m)), []);
  const solde = useSoldeAnime(v?.solde ?? vue.solde);

  const horloges = useRef<Horloges>({ v: null, numero: -1, depart: null, fin: null, clePhase: '' });
  const refs: RefsScene = {
    scene: useRef<HTMLDivElement>(null),
    fond: useRef<HTMLDivElement>(null),
    piste: useRef<HTMLDivElement>(null),
    depart: useRef<HTMLDivElement>(null),
    ligne: useRef<HTMLDivElement>(null),
    arche: useRef<HTMLImageElement>(null),
    poteaux: [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)],
    chevaux: [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)],
    sprites: [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)],
    points: [useRef<HTMLElement>(null), useRef<HTMLElement>(null), useRef<HTMLElement>(null), useRef<HTMLElement>(null), useRef<HTMLElement>(null), useRef<HTMLElement>(null)],
    distance: useRef<HTMLElement>(null),
    compte: useRef<HTMLElement>(null),
    barre: useRef<HTMLElement>(null),
  };
  useSceneCourse(horloges, refs, setArrivee);

  // On arrive du salon : l'écran s'ouvre en haut.
  useEffect(() => window.scrollTo(0, 0), []);
  useEffect(() => {
    try {
      localStorage.setItem(CLE_JETON, String(jeton));
    } catch {
      /* préférence non gardée */
    }
  }, [jeton]);

  useEffect(() => {
    let vivant = true;
    // Après une coupure, le salon peut mettre quelques secondes à se rouvrir : on réessaie avant d'afficher l'erreur.
    const entrer = async (essai = 0): Promise<void> => {
      const r = (await appel('casino_course_entrer')) as { ok: boolean; erreur?: string; course?: VueCourse };
      if (!vivant) return;
      if (r.ok && r.course) {
        setErreur(null);
        return setV(r.course);
      }
      if (essai < 5) return void window.setTimeout(() => void entrer(essai + 1), 1200);
      setErreur(r.erreur ?? tr('La course est indisponible pour le moment.', 'The race is unavailable right now.'));
    };
    void entrer();
    const surVue = (x: VueCourse) => setV(x);
    const surConnexion = () => window.setTimeout(() => void entrer(), 2600);
    socket.on('casino_course', surVue);
    socket.on('connect', surConnexion);
    return () => {
      vivant = false;
      socket.off('casino_course', surVue);
      socket.off('connect', surConnexion);
      socket.emit('casino_course_quitter');
    };
  }, [appel]);

  // Chaque vue recale les horloges de la scène sur celle du serveur (on garde l'estimation la plus tôt : la moins
  // retardée par le réseau).
  const precedente = useRef<VueCourse | null>(null);
  useEffect(() => {
    if (!v) return;
    const h = horloges.current;
    const maintenant = performance.now();
    if (v.numero !== h.numero) {
      h.numero = v.numero;
      h.depart = null;
    }
    if (v.ecoule !== null) {
      const estime = maintenant - v.ecoule;
      h.depart = h.depart === null ? estime : Math.min(h.depart, estime);
    }
    const cle = `${v.numero}-${v.phase}`;
    if (v.reste === null) h.fin = null;
    else {
      const fin = maintenant + v.reste;
      h.fin = h.clePhase === cle && h.fin !== null ? Math.min(h.fin, fin) : fin;
    }
    h.clePhase = cle;
    h.v = v;

    const avant = precedente.current;
    precedente.current = v;
    // Les sons et les fêtes des changements de phase (pas à la première vue : on arrive en cours de route).
    if (!avant || (avant.numero === v.numero && avant.phase === v.phase)) return;
    if (v.phase === 'depart') jouerEffet('course_appel');
    if (v.phase === 'resultat' && avant.numero === v.numero) {
      const mise = v.mesMises.reduce((s, m) => s + m.montant, 0);
      if (mise > 0 && v.monGain !== null) {
        if (v.monGain > 0) {
          setCredit({ montant: v.monGain, id: Date.now() });
          plusTard(() => setCredit(null), 2700);
          const gros = v.monGain >= 10 * mise && v.monGain >= 500_000;
          jouerEffet(gros ? 'course_gros' : 'course_gain');
          if (gros && !mouvementReduit()) {
            setPluie({ n: v.monGain >= 25 * mise ? 48 : 30, id: Date.now() });
            plusTard(() => setPluie(null), 3800);
          }
        } else jouerEffet('course_perdu');
      }
    }
  }, [v]);

  const phase: PhaseCourse = v?.phase ?? 'mises';
  const ouvertes = !!v && v.phase === 'mises' && (v.reste ?? 0) > 0;
  const maMise = v ? v.mesMises.reduce((s, m) => s + m.montant, 0) : 0;
  const mesChevaux = new Set(v?.mesMises.map((m) => m.cheval) ?? []);
  const ordre = v?.scenario?.ordre ?? null;
  const favori = v ? v.partants.reduce((b, p, c) => (p.cote < v.partants[b].cote ? c : b), 0) : -1;
  const vainqueurVu = !!v && !!ordre && (v.phase === 'resultat' || arrivee === v.numero);
  const photo = !!v?.scenario && v.scenario.arrivees[v.scenario.ordre[1]] - v.scenario.arrivees[v.scenario.ordre[0]] < 110;

  const envoyer = async (evt: string, data?: unknown) => {
    setErreur(null);
    const r = await appel(evt, data);
    if (!r.ok) setErreur(r.erreur ?? tr('Action impossible.', 'Action not allowed.'));
    return r.ok;
  };
  const miser = async (cheval: number, type: TypeMiseCourse) => {
    if (!v || !ouvertes) return;
    if (jeton > v.solde) return setErreur(tr('Solde insuffisant pour ce jeton.', 'Not enough money for this chip.'));
    if (await envoyer('casino_course_miser', { cheval, type, montant: jeton })) jouerEffet('jeton');
  };
  const miseSur = (cheval: number, type: TypeMiseCourse) => (v?.mesMises ?? []).reduce((s, m) => (m.cheval === cheval && m.type === type ? s + m.montant : s), 0);

  return (
    <div className="cas-ecran crs-ecran" data-phase={phase}>
      <header className="cas-barre">
        <button type="button" className="cas-retour" onClick={onRetour}>
          ‹ {tr('Salon', 'Lounge')}
        </button>
        <h1 className="crs-titre">
          <span>{tr('La Course', 'The Stables’')}</span> <span>{tr('des Écuries', 'Race')}</span>
        </h1>
        <span className={`cas-solde-petit crs-solde ${credit ? 'credite' : ''}`}>
          {dollars(solde)}
          {credit && (
            <b key={credit.id} className="crs-credit">
              +{dollars(credit.montant)}
            </b>
          )}
        </span>
      </header>

      <ol className="crs-historique" aria-label={tr('Les derniers gagnants', 'Latest winners')}>
        {(v?.historique ?? []).map((x, k) => (
          <li key={`${v?.numero}-${k}`} style={couleurs(x.cheval)} title={x.nom}>
            <span className="crs-pastille">{x.cheval + 1}</span>
            {cote(x.cote, 1)}
          </li>
        ))}
      </ol>

      <div className={`crs-scene ${phase}`} ref={refs.scene}>
        <div className="crs-fond" ref={refs.fond} />
        <div className="crs-piste" ref={refs.piste} />
        {POTEAUX.map((m, k) => (
          <div key={m} className="crs-poteau" ref={refs.poteaux[k]}>
            {m}
          </div>
        ))}
        <img className="crs-arche" ref={refs.arche} src="/cartes/course-arche.webp" alt="" draggable={false} />
        <div className="crs-trait depart" ref={refs.depart} />
        <div className="crs-trait arrivee" ref={refs.ligne} />
        {CASAQUES.map((_, c) => (
          <div key={c} className={`crs-cheval ${mesChevaux.has(c) ? 'mien' : ''} ${ordre && vainqueurVu && ordre[0] === c ? 'premier' : ''}`} ref={refs.chevaux[c]} style={{ zIndex: 10 + c, ...couleurs(c) }}>
            <div className="crs-sprite" ref={refs.sprites[c]} style={{ backgroundImage: `url(/cartes/course-cheval-${c + 1}.webp)` }} />
            <span className="crs-dossard" style={{ left: `${30 + c * 8}%` }}>
              {c + 1}
            </span>
          </div>
        ))}

        <span className="crs-direct">
          {tr('En direct', 'Live')}
          {v ? ` · ${v.spectateurs}` : ''}
        </span>
        <div className="crs-carte" aria-hidden="true">
          <strong ref={refs.distance}>{LONGUEUR_COURSE} m</strong>
          <span className="crs-carte-piste">
            {CASAQUES.map((k, c) => (
              <i key={c} ref={refs.points[c]} style={{ background: k.couleur, zIndex: mesChevaux.has(c) ? 2 : 1 }} className={mesChevaux.has(c) ? 'mien' : ''} />
            ))}
          </span>
        </div>

        <div className="crs-centre" aria-live="off">
          <div className="crs-attente">
            <small>{phase === 'depart' ? tr('Les mises sont fermées · départ dans', 'Bets are closed · off in') : tr(`Course n° ${v?.numero ?? 1} · départ dans`, `Race #${v?.numero ?? 1} · off in`)}</small>
            <strong ref={refs.compte}>20</strong>
            <span className="crs-barre">
              <i ref={refs.barre} />
            </span>
          </div>
          {phase === 'course' && !vainqueurVu && <strong className="crs-parti">{tr('C’est parti !', 'They’re off!')}</strong>}
          {phase === 'course' && vainqueurVu && ordre && (
            <span className="crs-vainqueur" style={couleurs(ordre[0])}>
              {photo && <small>{tr('Photo-finish !', 'Photo finish!')}</small>}
              <span className="crs-pastille">{ordre[0] + 1}</span>
              {v?.partants[ordre[0]].nom}
            </span>
          )}
        </div>
        {phase === 'course' && vainqueurVu && photo && <div className="crs-flash" />}
        {v && phase === 'resultat' && v.scenario && <Podium v={v} />}
      </div>

      <section className="crs-commandes" role="group" aria-label={tr('Tes mises', 'Your bets')}>
        <div className="crs-tableau-tete">
          <span>{tr('Partants', 'Runners')}</span>
          <span>{tr('Gagnant', 'Win')}</span>
          <span>{tr('Placé', 'Place')}</span>
        </div>
        <ol className="crs-tableau">
          {v?.partants.map((p, c) => {
            const gagnant = miseSur(c, 'gagnant');
            const place = miseSur(c, 'place');
            const rang = ordre && phase === 'resultat' ? ordre.indexOf(c) : -1;
            const paye = (type: TypeMiseCourse, m: number) => (v && phase === 'resultat' && m > 0 ? gainDe(v, c, type, m) : 0);
            return (
              <li key={c} className={`crs-partant ${rang === 0 ? 'premier' : rang === 1 ? 'deuxieme' : ''} ${mesChevaux.has(c) ? 'mien' : ''}`} style={couleurs(c)}>
                <span className="crs-pastille">{c + 1}</span>
                <span className="crs-partant-nom">
                  <strong>{p.nom}</strong>
                  <small>
                    <span className="crs-casaque">{nomCasaque(c)}</span>
                    {c === favori && <em>{tr('Favori', 'Favourite')}</em>}
                  </small>
                </span>
                {(['gagnant', 'place'] as TypeMiseCourse[]).map((type) => {
                  const m = type === 'gagnant' ? gagnant : place;
                  const g = paye(type, m);
                  return (
                    <button
                      key={type}
                      type="button"
                      className={`crs-cote ${type} ${m ? 'misee' : ''} ${g > 0 ? 'gagnee' : ''}`}
                      onClick={() => void miser(c, type)}
                      disabled={!ouvertes}
                      aria-label={tr(`${p.nom}, ${type === 'gagnant' ? 'gagnant' : 'placé'} ${cote(type === 'gagnant' ? p.cote : p.place, 2)}`, `${p.nom}, ${type === 'gagnant' ? 'win' : 'place'} ${cote(type === 'gagnant' ? p.cote : p.place, 2)}`)}
                    >
                      <b>{type === 'gagnant' ? cote(p.cote, 1) : cote(p.place, 2)}</b>
                      {m > 0 && <em>{g > 0 ? `+${court(g)}` : court(m)}</em>}
                    </button>
                  );
                })}
              </li>
            );
          })}
        </ol>
        <p className="crs-regle">{tr('Gagnant : il finit premier. Placé : il finit premier ou deuxième.', 'Win: it finishes first. Place: it finishes first or second.')}</p>
        <div className="bj-jetons">
          {JETONS_COURSE.map((j) => (
            <button key={j} type="button" className={`bj-jeton ${j === jeton ? 'choisi' : ''}`} onClick={() => (setJeton(j), jouerEffet('jeton'))} disabled={!!v && j > v.solde && j !== jeton} aria-pressed={j === jeton} aria-label={dollars(j)}>
              <img src={`/cartes/jeton-${imageJeton(j)}.webp`} alt="" />
              <span>{court(j)}</span>
            </button>
          ))}
        </div>
        <p className="bj-mise-encours crs-mise">
          {tr('Ta mise', 'Your bet')} <strong>{dollars(maMise)}</strong>
          <small>{tr(`Au plus ${court(MAX_MISE_COURSE)} par mise, ${court(MAX_COURSE)} par course`, `At most ${court(MAX_MISE_COURSE)} per bet, ${court(MAX_COURSE)} per race`)}</small>
        </p>
        <div className="bj-boutons">
          <button type="button" onClick={() => void envoyer('casino_course_annuler')} disabled={!ouvertes || !maMise}>
            {tr('Annuler', 'Undo')}
          </button>
          <button type="button" onClick={() => void envoyer('casino_course_annuler', { tout: true })} disabled={!ouvertes || !maMise}>
            {tr('Effacer', 'Clear')}
          </button>
          <button type="button" onClick={() => void envoyer('casino_course_doubler').then((ok) => ok && jouerEffet('jeton'))} disabled={!ouvertes || !maMise}>
            {tr('Doubler', 'Double')}
          </button>
          <button type="button" className="bj-principal" onClick={() => void envoyer('casino_course_refaire').then((ok) => ok && jouerEffet('jeton'))} disabled={!ouvertes || !!maMise || !v?.peutRefaire}>
            {tr('Refaire', 'Rebet')}
          </button>
        </div>
        {erreur && <p className="cas-erreur">{erreur}</p>}
      </section>

      <aside className="crs-joueurs" aria-label={tr('Cette course', 'This race')}>
        <h2>
          {tr('Cette course', 'This race')}
          {v ? <small> · {tr(`${v.spectateurs} au champ de courses`, `${v.spectateurs} at the track`)}</small> : null}
        </h2>
        {v?.joueurs.length ? (
          <ol>
            {v.joueurs.map((j, k) => (
              <li key={k} className={`${j.moi ? 'moi' : ''} ${j.gain ? 'gagne' : ''}`}>
                <img src={`/cartes/avatar-${j.avatar}.webp`} alt="" />
                <span className="crs-joueur-nom">{j.nom}</span>
                <span className="crs-joueur-mise">{dollars(j.mise)}</span>
                <strong>{j.gain === null ? '—' : j.gain > 0 ? `+${dollars(j.gain)}` : tr('perdu', 'lost')}</strong>
              </li>
            ))}
          </ol>
        ) : (
          <p className="discret">{tr('Personne n’a encore misé sur cette course.', 'Nobody has bet on this race yet.')}</p>
        )}
        <p className="cas-mention">
          {tr(
            'Une course toutes les 45 secondes environ, six chevaux. Les cotes suivent la forme du jour de chaque cheval ; le jeu rend 95 % des mises en moyenne. De 1 000 à 1 000 000 $ par mise, 4 000 000 $ au plus par course.',
            'A race about every 45 seconds, six horses. Odds follow each horse’s form of the day; the game returns 95% of bets on average. $1,000 to $1,000,000 per bet, $4,000,000 at most per race.',
          )}
        </p>
      </aside>

      {pluie && <PluieLingots key={`pluie-${pluie.id}`} n={pluie.n} objets={BUTIN_PLUIE} />}
    </div>
  );
}
