/**
 * La Chute des Écus (Salon privé) : un Plinko. On lâche un écu d'or du distributeur ; il rebondit de clou en clou
 * jusqu'à une case du bas, qui multiplie la mise. Mise, nombre de rangées (8 à 16) et risque (faible, moyen, élevé)
 * se choisissent avant de lâcher ; on peut lâcher plusieurs écus à la suite, ou en automatique.
 *
 * Le serveur joue chaque lâcher d'un bloc (mise débitée, chemin tiré, gain crédité) et renvoie le chemin : l'écran ne
 * fait que montrer la chute. Le solde affiché attend que l'écu touche le fond pour monter.
 *
 * Visuels : chute-plateau.webp (le cadre), chute-distributeur.webp, chute-clou.webp, chute-ecu.webp, chute-case.webp
 * (détourés), et les décors chute-fond-paysage.webp / chute-fond-portrait.webp.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { MULTIPLE_GROS_GAIN, type VueCasino } from '../../shared/casino';
import { estRisqueChute, MISES_CHUTE, multiplicateursChute, NOMS_RISQUES_CHUTE, RANGEES_MAX, RANGEES_MIN, RISQUES_CHUTE, type ResultatChute, type RisqueChute } from '../../shared/chute';
import type { Appel } from './App';
import { BUTIN_PLUIE, dollars, Jeton, LINGOTS_PALIER, PluieLingots, useSoldeAnime } from './casinoOutils';
import { tr } from './traduction';
import { jouerEffet, mouvementReduit, useCompteur } from './ui';
import './chute.css';

const CLE_REGLAGES = 'ldb-chute';
/** Le cadre du plateau : 1000 × 1328 (l'intérieur bleu nuit va de 7 % à 93 % en largeur). */
const RATIO = 1328 / 1000;
const AUTO = [10, 25, 50, 100];
/** Écart minimal entre deux lâchers à la main (le serveur en accepte 8 par seconde). */
const ECART_LACHERS = 140;

const virgule = (x: number, d = 1) => x.toLocaleString(tr('fr-FR', 'en-US'), { maximumFractionDigits: d });
/** « ×0,2 », « ×26 », « ×1 000 ». */
const fx = (x: number) => `×${virgule(x, 2)}`;
/** Étiquette courte d'une case (la place manque à 16 rangées sur téléphone). */
const court = (x: number, serre: boolean) => (x >= 1000 && serre ? '1k' : virgule(x, 1));

interface Reglages {
  mise: number;
  rangees: number;
  risque: RisqueChute;
}
function lireReglages(): Reglages {
  try {
    const r = JSON.parse(localStorage.getItem(CLE_REGLAGES) ?? '{}') as Partial<Reglages>;
    return {
      mise: MISES_CHUTE.includes(r.mise ?? 0) ? r.mise! : 10_000,
      rangees: Number.isInteger(r.rangees) && r.rangees! >= RANGEES_MIN && r.rangees! <= RANGEES_MAX ? r.rangees! : 12,
      risque: estRisqueChute(r.risque) ? r.risque : 'moyen',
    };
  } catch {
    return { mise: 10_000, rangees: 12, risque: 'moyen' };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Géométrie du plateau, en largeurs de plateau (W = 1) : rien ne bouge si l'écran change de taille pendant une chute.

interface Geo {
  n: number;
  /** Écart entre deux clous d'une rangée, et entre deux rangées. */
  s: number;
  v: number;
  cx: number;
  /** Hauteur de la première rangée, bec du distributeur. */
  y0: number;
  bec: number;
  /** Rayons de l'écu et d'un clou. */
  rb: number;
  rp: number;
  /** Cases : centre vertical, largeur et hauteur d'une case. */
  yCase: number;
  wCase: number;
  hCase: number;
  distrib: { x: number; y: number; w: number; h: number };
}

function geometrie(n: number): Geo {
  const gauche = 0.07;
  const droite = 0.93;
  const s = (droite - gauche) / (n + 2);
  const dw = 0.2;
  const dh = (dw * 483) / 640;
  const dy = 0.17;
  const bec = dy + dh * 0.9;
  // La case est un peu étirée en hauteur (l'image est très large) pour que son multiplicateur reste lisible.
  const wCase = s * 1.12;
  const hCase = wCase * 0.8;
  const bas = 1.205;
  const v = Math.min(1.15 * s, (bas - hCase - bec) / (n - 1 + 0.9 + 0.62));
  const y0 = bec + 0.9 * v;
  return {
    n,
    s,
    v,
    cx: 0.5,
    y0,
    bec,
    rb: 0.34 * s,
    rp: 0.13 * s,
    yCase: y0 + (n - 1) * v + 0.62 * v + hCase / 2,
    wCase,
    hCase,
    distrib: { x: 0.5 - dw / 2, y: dy, w: dw, h: dh },
  };
}

const xClou = (g: Geo, r: number, i: number) => g.cx + (i - (r + 2) / 2) * g.s;
const yRangee = (g: Geo, r: number) => g.y0 + r * g.v;
const xCase = (g: Geo, k: number) => g.cx + (k - g.n / 2) * g.s;

/** Un tronçon de la chute : d'un point à l'autre en `d` secondes, avec un petit rebond vers le haut au départ. */
interface Troncon {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  d: number;
  saut: number;
  /** Ce qu'on touche au bout : le clou (rangée, index) ou la case. */
  fin: { clou: [number, number] } | { case: number };
}

function trajet(g: Geo, chemin: number[]): Troncon[] {
  const contact = g.rb + g.rp;
  const t: Troncon[] = [];
  const parRangee = 0.125 + (RANGEES_MAX - g.n) * 0.005;
  let x = g.cx;
  let y = g.bec;
  let droite = 0;
  for (let r = 0; r < g.n; r++) {
    const nx = g.cx + (droite - r / 2) * g.s;
    const ny = yRangee(g, r) - contact;
    t.push({ x0: x, y0: y, x1: nx, y1: ny, d: r === 0 ? 0.24 : parRangee * (0.92 + Math.random() * 0.16), saut: r === 0 ? 0 : 0.32 * g.v, fin: { clou: [r, droite + 1] } });
    x = nx;
    y = ny;
    droite += chemin[r] ? 1 : 0;
  }
  t.push({ x0: x, y0: y, x1: xCase(g, droite), y1: g.yCase - g.hCase * 0.12, d: parRangee * 1.25, saut: 0.3 * g.v, fin: { case: droite } });
  return t;
}

/** Couleur d'une case selon son multiplicateur : bronze (moins que la mise), or, puis rubis pour les gros. */
function teinte(x: number, max: number): { fond: string; texte: string } {
  if (x < 1) return { fond: 'linear-gradient(180deg, #5b3a2a, #2e1a12)', texte: '#e8cfa6' };
  const t = Math.min(1, Math.log(x) / Math.log(Math.max(2, max)));
  const melange = (a: number[], b: number[], u: number) => a.map((v, i) => Math.round(v + (b[i] - v) * u));
  const or = [233, 173, 91];
  const ambre = [226, 118, 40];
  const rubis = [196, 28, 52];
  const c = t < 0.5 ? melange(or, ambre, t / 0.5) : melange(ambre, rubis, (t - 0.5) / 0.5);
  const clair = c.map((v) => Math.min(255, v + 40));
  return { fond: `linear-gradient(180deg, rgb(${clair.join(',')}), rgb(${c.join(',')}))`, texte: t < 0.45 ? '#2a1608' : '#fff4e2' };
}

// ---------------------------------------------------------------------------------------------------------------
// Le gain en grand (joli ou gros gain)

function AnnonceChute({ montant, x, gros }: { montant: number; x: number; gros: boolean }) {
  const valeur = useCompteur(montant, Math.round(montant / 20), 0, gros ? 1600 : 900);
  return (
    <div className={`cdc-gain ${gros ? 'gros' : ''}`} aria-live="polite">
      <span>{gros ? tr('Pluie d’écus !', 'Coin shower!') : tr('Belle chute !', 'Nice drop!')}</span>
      <em>{fx(x)}</em>
      <strong>+{dollars(valeur)}</strong>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// L'écran

interface EcuEnVol {
  r: ResultatChute;
  troncons: Troncon[];
  debut: number;
  /** Tronçon en cours (les clous déjà touchés ont sonné). */
  etape: number;
  angle: number;
  sens: number;
}

export function JeuChute({ vue, appel, onVue, onRetour }: { vue: VueCasino; appel: Appel; onVue: (v: VueCasino) => void; onRetour: () => void }) {
  const [reglages, setReglages] = useState(lireReglages);
  const [erreur, setErreur] = useState<string | null>(null);
  /** Écus à l'écran (leurs gains ne sont pas encore montrés dans le solde). */
  const [ecus, setEcus] = useState<{ id: number; gain: number }[]>([]);
  const [historique, setHistorique] = useState<{ id: number; x: number; gain: number; mise: number }[]>([]);
  const [annonce, setAnnonce] = useState<{ montant: number; x: number; gros: boolean; id: number } | null>(null);
  const [pluie, setPluie] = useState<{ n: number; id: number } | null>(null);
  /** Ce que l'écu a vraiment fait gagner ou perdre (gain − mise), affiché sous le solde. */
  const [credit, setCredit] = useState<{ montant: number; id: number } | null>(null);
  const [auto, setAuto] = useState<{ actif: boolean; restants: number }>({ actif: false, restants: 0 });
  const [choixAuto, setChoixAuto] = useState(false);
  const [envois, setEnvois] = useState(0);
  const [taille, setTaille] = useState(0);
  const vueRef = useRef(vue);
  vueRef.current = vue;
  const scene = useRef<HTMLDivElement>(null);
  const plateau = useRef<HTMLDivElement>(null);
  const distributeur = useRef<HTMLImageElement>(null);
  const clous = useRef(new Map<string, HTMLImageElement>());
  const cases = useRef(new Map<number, HTMLDivElement>());
  const elements = useRef(new Map<number, HTMLImageElement>());
  const enVol = useRef(new Map<number, EcuEnVol>());
  const boucle = useRef(0);
  const dernierLacher = useRef(0);
  const dernierTic = useRef(0);
  const minuteries = useRef<number[]>([]);
  const plusTard = (f: () => void, ms: number) => minuteries.current.push(window.setTimeout(f, ms));

  const g = useMemo(() => geometrie(reglages.rangees), [reglages.rangees]);
  const xs = useMemo(() => multiplicateursChute(reglages.rangees, reglages.risque), [reglages.rangees, reglages.risque]);
  const xMax = Math.max(...xs);

  // Le gain des écus encore en l'air n'est pas encore « arrivé » sur le solde.
  const attente = ecus.reduce((s, e) => s + e.gain, 0);
  const solde = useSoldeAnime(Math.max(0, vue.solde - attente));

  useEffect(() => window.scrollTo(0, 0), []);
  useEffect(
    () => () => {
      minuteries.current.forEach((m) => window.clearTimeout(m));
      cancelAnimationFrame(boucle.current);
    },
    [],
  );
  useEffect(() => {
    try {
      localStorage.setItem(CLE_REGLAGES, JSON.stringify(reglages));
    } catch {
      /* préférence non gardée */
    }
  }, [reglages]);

  // La taille du plateau : le plus grand possible dans la scène, sans déformer le cadre. Calculée ici (et non en CSS)
  // parce que les écus et les clous se placent au pixel près.
  useLayoutEffect(() => {
    const el = scene.current;
    if (!el) return;
    const mesurer = () => {
      const cs = getComputedStyle(el);
      const l = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const h = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      setTaille(Math.max(120, Math.floor(Math.min(l, h / RATIO))));
    };
    mesurer();
    const ro = new ResizeObserver(mesurer);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const W = taille;
  const tailleRef = useRef(W);
  tailleRef.current = W;

  // ---------- L'animation des écus (une seule boucle pour tous) ----------

  const toucherClou = (r: number, i: number, son: boolean) => {
    const el = clous.current.get(`${r}-${i}`);
    el?.animate?.([{ transform: 'translate(-50%, -50%) scale(1.9)', filter: 'brightness(1.9) drop-shadow(0 0 6px #ffd27a)' }, { transform: 'translate(-50%, -50%) scale(1)', filter: 'none' }], { duration: 260, easing: 'ease-out' });
    const t = performance.now();
    if (son && t - dernierTic.current > 32) {
      dernierTic.current = t;
      jouerEffet('chute_clou', { vitesse: 0.85 + Math.random() * 0.35 + (r / RANGEES_MAX) * 0.25, volume: 0.8 + Math.random() * 0.3 });
    }
  };

  const arriver = useCallback((e: EcuEnVol) => {
    const { r } = e;
    const c = cases.current.get(r.case);
    c?.animate?.([{ transform: 'translateY(0)' }, { transform: 'translateY(22%)' }, { transform: 'translateY(0)' }], { duration: 320, easing: 'cubic-bezier(0.3, 1.6, 0.5, 1)' });
    c?.classList.remove('touchee');
    void c?.offsetWidth;
    c?.classList.add('touchee');
    setEcus((l) => l.filter((x) => x.id !== r.id));
    setHistorique((h) => [{ id: r.id, x: r.x, gain: r.gain, mise: r.mise }, ...h].slice(0, 12));
    const gros = r.gain >= MULTIPLE_GROS_GAIN * r.mise || r.gain >= 1_000_000;
    if (r.x < 1) jouerEffet('chute_case_bas', { vitesse: 0.95 + Math.random() * 0.1 });
    else jouerEffet(gros ? 'chute_gros' : 'chute_case', { vitesse: gros ? 1 : Math.min(1.35, 0.9 + Math.log10(r.x + 1) * 0.35) });
    if (r.gain !== r.mise) setCredit({ montant: r.gain - r.mise, id: r.id });
    if (r.x >= 10 || gros) {
      setAnnonce({ montant: r.gain, x: r.x, gros, id: r.id });
      plusTard(() => setAnnonce((a) => (a?.id === r.id ? null : a)), gros ? 3600 : 2200);
      if (!mouvementReduit()) {
        setPluie({ n: gros ? LINGOTS_PALIER.enorme : LINGOTS_PALIER.joli + 6, id: r.id });
        plusTard(() => setPluie((p) => (p?.id === r.id ? null : p)), 4400);
      }
      if (gros) plusTard(() => jouerEffet('lingots_pluie'), 250);
    }
  }, []);

  const animer = useCallback(() => {
    const maintenant = performance.now();
    const Wpx = tailleRef.current;
    for (const [id, e] of enVol.current) {
      const el = elements.current.get(id);
      let t = (maintenant - e.debut) / 1000;
      let k = 0;
      while (k < e.troncons.length && t > e.troncons[k].d) {
        t -= e.troncons[k].d;
        k++;
      }
      // Les clous touchés depuis la dernière image (au retour d'un onglet caché : sans le vacarme).
      const sauts = k - e.etape;
      for (let j = e.etape; j < Math.min(k, e.troncons.length); j++) {
        const fin = e.troncons[j].fin;
        if ('clou' in fin) {
          toucherClou(fin.clou[0], fin.clou[1], sauts <= 2);
          e.sens = e.r.chemin[fin.clou[0]] ? 1 : -1;
        }
      }
      e.etape = Math.max(e.etape, k);
      if (k >= e.troncons.length) {
        enVol.current.delete(id);
        arriver(e);
        continue;
      }
      const tr0 = e.troncons[k];
      const u = Math.min(1, t / tr0.d);
      const x = tr0.x0 + (tr0.x1 - tr0.x0) * u;
      // Chute avec un petit rebond : on monte un peu, puis la pesanteur l'emporte.
      const y = tr0.y0 + (tr0.y1 - tr0.y0) * u * u - tr0.saut * u * (1 - u) * 1.6;
      e.angle += e.sens * 9;
      if (el) el.style.transform = `translate(${x * Wpx}px, ${y * Wpx}px) translate(-50%, -50%) rotate(${e.angle}deg)`;
    }
    boucle.current = enVol.current.size ? requestAnimationFrame(animer) : 0;
  }, [arriver]);

  const lancerBoucle = () => {
    if (!boucle.current) boucle.current = requestAnimationFrame(animer);
  };

  // ---------- Lâcher un écu ----------

  const enCoursRef = useRef(0);
  const reglagesRef = useRef(reglages);
  reglagesRef.current = reglages;
  /** Lâche un écu : « parti », « attente » (trop tôt après le précédent, rien n'est joué) ou « refuse ». */
  const lacher = useCallback(async (): Promise<'parti' | 'attente' | 'refuse'> => {
    const t = performance.now();
    if (t - dernierLacher.current < ECART_LACHERS || enCoursRef.current >= 3) return 'attente';
    const r0 = reglagesRef.current;
    if (r0.mise > vueRef.current.solde) {
      setErreur(tr('Solde insuffisant pour cette mise.', 'Not enough money for this bet.'));
      return 'refuse';
    }
    dernierLacher.current = t;
    enCoursRef.current++;
    setEnvois((n) => n + 1);
    setErreur(null);
    const rep = await appel('casino_chute_lacher', r0);
    enCoursRef.current--;
    setEnvois((n) => n - 1);
    if (!rep.ok) {
      setErreur(rep.erreur ?? tr('Action impossible.', 'Action not allowed.'));
      return 'refuse';
    }
    const { chute, solde, credite } = rep as unknown as { chute: ResultatChute; solde: number; credite?: number };
    jouerEffet('chute_lacher', { vitesse: 0.95 + Math.random() * 0.1 });
    distributeur.current?.animate?.([{ transform: 'scale(1)' }, { transform: 'scale(1.06, 0.94)' }, { transform: 'scale(1)' }], { duration: 220, easing: 'ease-out' });
    onVue({ ...vueRef.current, solde });
    const geo = geometrie(chute.rangees);
    if (mouvementReduit()) {
      setHistorique((h) => [{ id: chute.id, x: chute.x, gain: chute.gain, mise: chute.mise }, ...h].slice(0, 12));
      if (chute.gain !== chute.mise) setCredit({ montant: chute.gain - chute.mise, id: chute.id });
      jouerEffet(chute.x < 1 ? 'chute_case_bas' : 'chute_case');
      return 'parti';
    }
    setEcus((l) => [...l, { id: chute.id, gain: credite ?? chute.gain }]);
    enVol.current.set(chute.id, { r: chute, troncons: trajet(geo, chute.chemin), debut: performance.now(), etape: 0, angle: Math.random() * 360, sens: 1 });
    lancerBoucle();
    return 'parti';
  }, [appel, onVue]);

  // ---------- Lâchers automatiques ----------

  useEffect(() => {
    if (!auto.actif) return;
    if (auto.restants <= 0) {
      setAuto({ actif: false, restants: 0 });
      return;
    }
    const m = window.setTimeout(() => {
      void lacher().then((r) =>
        setAuto((a) => (!a.actif ? a : r === 'refuse' ? { actif: false, restants: 0 } : r === 'attente' ? { ...a } : { actif: a.restants - 1 > 0, restants: a.restants - 1 })),
      );
    }, 420);
    return () => window.clearTimeout(m);
  }, [auto, lacher]);

  // ---------- Réglages ----------

  const enJeu = ecus.length > 0 || envois > 0 || auto.actif;
  const changerMise = (d: number) => {
    const i = MISES_CHUTE.indexOf(reglages.mise) + d;
    if (i < 0 || i >= MISES_CHUTE.length || auto.actif) return;
    jouerEffet('jeton');
    setReglages((r) => ({ ...r, mise: MISES_CHUTE[i] }));
  };
  const changerRangees = (d: number) => {
    const n = Math.min(RANGEES_MAX, Math.max(RANGEES_MIN, reglages.rangees + d));
    if (n === reglages.rangees || enJeu) return;
    jouerEffet('selection');
    setReglages((r) => ({ ...r, rangees: n }));
  };
  const changerRisque = (risque: RisqueChute) => {
    if (risque === reglages.risque || enJeu) return;
    jouerEffet('selection');
    setReglages((r) => ({ ...r, risque }));
  };

  // ---------- Rendu ----------

  const px = (u: number) => `${u * W}px`;
  const serre = g.s * W < 26;
  const rangees = Array.from({ length: g.n }, (_, r) => r);
  const derniers = historique.slice(0, 8);

  return (
    <div className="cas-ecran cdc-ecran">
      <header className="cas-barre">
        <button type="button" className="cas-retour" onClick={onRetour}>
          ‹ {tr('Salon', 'Lounge')}
        </button>
        <h1 className="cdc-titre">
          <span>{tr('La Chute', 'The Falling')}</span> <span>{tr('des Écus', 'Crowns')}</span>
        </h1>
        <span className={`cas-solde-petit cdc-solde ${credit && credit.montant > 0 ? 'credite' : ''}`}>
          {dollars(solde)}
          {credit && (
            <b key={credit.id} className={`cdc-credit ${credit.montant < 0 ? 'perte' : ''}`}>
              {credit.montant > 0 ? '+' : '−'}
              {dollars(Math.abs(credit.montant))}
            </b>
          )}
        </span>
      </header>

      <section className="cdc-scene" ref={scene}>
        {W > 0 && (
          <div className="cdc-plateau" ref={plateau} style={{ width: W, height: Math.round(W * RATIO) } as CSSProperties} role="img" aria-label={tr(`Plateau de ${g.n} rangées de clous`, `Board with ${g.n} rows of pegs`)}>
            <img
              ref={distributeur}
              className="cdc-distributeur"
              src="/cartes/chute-distributeur.webp"
              alt=""
              draggable={false}
              style={{ left: px(g.distrib.x), top: px(g.distrib.y), width: px(g.distrib.w) }}
            />
            {rangees.map((r) =>
              Array.from({ length: r + 3 }, (_, i) => (
                <img
                  key={`${g.n}-${r}-${i}`}
                  ref={(el) => {
                    if (el) clous.current.set(`${r}-${i}`, el);
                    else clous.current.delete(`${r}-${i}`);
                  }}
                  className="cdc-clou"
                  src="/cartes/chute-clou.webp"
                  alt=""
                  draggable={false}
                  style={{ left: px(xClou(g, r, i)), top: px(yRangee(g, r)), width: px(g.rp * 2.15) }}
                />
              )),
            )}
            {xs.map((x, k) => {
              const c = teinte(x, xMax);
              return (
                <div
                  key={`${g.n}-${reglages.risque}-${k}`}
                  ref={(el) => {
                    if (el) cases.current.set(k, el);
                    else cases.current.delete(k);
                  }}
                  className="cdc-case"
                  style={{ left: px(xCase(g, k) - g.wCase / 2), top: px(g.yCase - g.hCase / 2), width: px(g.wCase), height: px(g.hCase), '--fond': c.fond, '--texte': c.texte, fontSize: `${Math.max(7, g.s * W * (serre ? 0.44 : 0.34))}px` } as CSSProperties}
                >
                  <span className="cdc-case-x">{court(x, serre)}</span>
                </div>
              );
            })}
            {ecus.map((e) => (
              <img
                key={e.id}
                ref={(el) => {
                  if (el) elements.current.set(e.id, el);
                  else elements.current.delete(e.id);
                }}
                className="cdc-ecu"
                src="/cartes/chute-ecu.webp"
                alt=""
                draggable={false}
                style={{ width: px(g.rb * 2), transform: `translate(${px(g.cx)}, ${px(g.bec)}) translate(-50%, -50%)` }}
              />
            ))}
          </div>
        )}
      </section>

      <section className="cdc-commandes" aria-label={tr('Tes réglages', 'Your settings')}>
        <ol className="cdc-historique" aria-label={tr('Dernières chutes', 'Last drops')}>
          {derniers.length === 0 && <li className="vide">{tr('Lâche ton premier écu !', 'Drop your first coin!')}</li>}
          {derniers.map((h) => {
            const c = teinte(h.x, xMax);
            return (
              <li key={h.id} style={{ '--fond': c.fond, '--texte': c.texte } as CSSProperties}>
                {fx(h.x)}
              </li>
            );
          })}
        </ol>
        <div className="cas-mise" aria-label={tr('Mise', 'Bet')}>
          <button type="button" onClick={() => changerMise(-1)} disabled={reglages.mise === MISES_CHUTE[0] || auto.actif} aria-label={tr('Baisser la mise', 'Lower the bet')}>
            −
          </button>
          <span className="cas-mise-valeur">
            <Jeton valeur={reglages.mise} />
            <span>
              <small>{tr('Mise par écu', 'Bet per coin')}</small>
              <strong>{dollars(reglages.mise)}</strong>
            </span>
          </span>
          <button type="button" onClick={() => changerMise(1)} disabled={reglages.mise === MISES_CHUTE[MISES_CHUTE.length - 1] || auto.actif} aria-label={tr('Augmenter la mise', 'Raise the bet')}>
            +
          </button>
        </div>

        <div className="cdc-risques" role="group" aria-label={tr('Risque', 'Risk')}>
          <small>{tr('Risque', 'Risk')}</small>
          {RISQUES_CHUTE.map((r) => (
            <button key={r} type="button" className={`${r} ${r === reglages.risque ? 'choisi' : ''}`} onClick={() => changerRisque(r)} aria-pressed={r === reglages.risque} disabled={enJeu && r !== reglages.risque}>
              {tr(...NOMS_RISQUES_CHUTE[r])}
            </button>
          ))}
        </div>

        <div className="cdc-rangees" role="group" aria-label={tr('Rangées de clous', 'Rows of pegs')}>
          <small>{tr('Rangées', 'Rows')}</small>
          <button type="button" className="cdc-pas" onClick={() => changerRangees(-1)} disabled={enJeu || reglages.rangees <= RANGEES_MIN} aria-label={tr('Moins de rangées', 'Fewer rows')}>
            −
          </button>
          <strong>{reglages.rangees}</strong>
          <button type="button" className="cdc-pas" onClick={() => changerRangees(1)} disabled={enJeu || reglages.rangees >= RANGEES_MAX} aria-label={tr('Plus de rangées', 'More rows')}>
            +
          </button>
          <span className="cdc-max">
            {tr('jusqu’à', 'up to')} <b>{fx(xMax)}</b>
          </span>
        </div>

        {auto.actif ? (
          <button type="button" className="cas-tourner cdc-lacher arret" onClick={() => setAuto({ actif: false, restants: 0 })}>
            <span>{tr(`Arrêter (${auto.restants})`, `Stop (${auto.restants})`)}</span>
          </button>
        ) : (
          <button type="button" className="cas-tourner cdc-lacher" onClick={() => void lacher()} disabled={reglages.mise > vue.solde}>
            <span>{tr('Lâcher un écu', 'Drop a coin')}</span>
          </button>
        )}

        <div className="cas-options cdc-options">
          {choixAuto && !auto.actif ? (
            <>
              {AUTO.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => {
                    setChoixAuto(false);
                    setAuto({ actif: true, restants: n });
                  }}
                  disabled={reglages.mise > vue.solde}
                >
                  {n}
                </button>
              ))}
              <button type="button" onClick={() => setChoixAuto(false)} aria-label={tr('Fermer', 'Close')}>
                ✕
              </button>
            </>
          ) : (
            <button type="button" className={auto.actif ? 'actif' : ''} onClick={() => (auto.actif ? setAuto({ actif: false, restants: 0 }) : setChoixAuto(true))}>
              {auto.actif ? tr('Auto en cours', 'Auto running') : tr('Auto', 'Auto')}
            </button>
          )}
        </div>

        {erreur && <p className="cas-erreur">{erreur}</p>}
        <p className="cas-mention">
          {tr(
            'L’écu rebondit au hasard à chaque clou et tombe dans une case : ta mise × son multiplicateur. Le milieu, où il tombe le plus souvent, rend moins que la mise ; seuls les côtés font gagner. Plus de risque : des bords plus riches (jusqu’à ×1 000) et un milieu plus maigre (×0,2). Mise de 1 000 à 500 000 $ par écu.',
            'The coin bounces at random off each peg and lands in a slot: your bet × its multiplier. The middle, where it lands most often, pays back less than the bet; only the sides win. More risk: richer edges (up to ×1,000) and a leaner middle (×0.2). Bets from $1,000 to $500,000 per coin.',
          )}
        </p>
      </section>

      {pluie && <PluieLingots key={`pluie-${pluie.id}`} n={pluie.n} objets={BUTIN_PLUIE} />}
      {annonce && <AnnonceChute key={`annonce-${annonce.id}`} montant={annonce.montant} x={annonce.x} gros={annonce.gros} />}
    </div>
  );
}
