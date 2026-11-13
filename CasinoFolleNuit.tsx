/**
 * La Folle Nuit : l'écran du show en direct du Salon privé. Une seule roue pour tout le salon : le serveur décide de
 * tout (Top Slot, arrêt de la roue, jeux bonus) et diffuse la vue (« casino_fn ») ; cet écran la met en scène et
 * envoie les mises. Les animations se calent sur le temps qu'il reste à chaque étape : un joueur qui arrive en cours
 * de route voit la suite au bon moment.
 *
 * Visuels : fn-plateau.webp et fn-folle-decor.webp (décors), fn-animateur.webp, fn-logo.webp, fn-roue-jante.webp,
 * fn-roue-moyeu.webp, fn-roue-fleche.webp, fn-velours.webp (texture des cases de la roue), fn-topslot.webp,
 * fn-bonus-{pile,chasse,billes,folle}.webp (emblèmes), fn-case-cadre.webp, fn-billes-fond.webp,
 * fn-fleche-{or,bordeaux,ivoire}.webp, fn-piece-couronne.webp, fn-piece-chapeau.webp, fn-icones.webp (le mur, 4 × 3)
 * et fn-gros-gain.webp.
 *
 * Les roues sont animées image par image (requestAnimationFrame) sur l'horloge du serveur : petit élan, lancer, long
 * freinage, léger dépassement puis retour ; la flèche claque (et le son « tic ») à chaque case qui passe sous elle.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  CASES_FN,
  COLONNES_BILLES,
  COLONNES_CHASSE,
  DECALAGES_FLECHES,
  JETONS_FN,
  RANGEES_BILLES,
  ROUE_FN,
  SEGMENTS_FOLLE,
  estBonus,
  facteurTopSlot,
  type BonusFN,
  type CaseFN,
  type HappyHourFN,
  type SegmentFolle,
  type VueBonusFN,
  type VueFolleNuit,
} from '../../shared/folleNuit';
import type { VueCasino } from '../../shared/casino';
import type { Appel } from './App';
import { CHOIX_AUTO, dollars, LINGOTS_PALIER, PluieLingots } from './casinoOutils';
import { socket } from './socket';
import { tr } from './traduction';
import { jouerEffet, mouvementReduit, useCompteur } from './ui';
import './folleNuit.css';

const court = (n: number) => (n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${+(n / 1000).toFixed(n % 1000 ? 1 : 0)}k` : String(n));
const imageJeton = (v: number) => (v >= 500_000 ? 'violet' : v >= 100_000 ? 'noir' : v >= 25_000 ? 'vert' : v >= 5_000 ? 'rouge' : 'ivoire');

/** Les cases du tapis et de la roue : nom, libellé court et couleur. */
export const CASES: Record<CaseFN, { nom: [string, string]; court: string; couleur: string; texte: string }> = {
  '1': { nom: ['1', '1'], court: '1', couleur: '#c9963d', texte: '#1b120c' },
  '2': { nom: ['2', '2'], court: '2', couleur: '#2f5f8f', texte: '#f6eedc' },
  '5': { nom: ['5', '5'], court: '5', couleur: '#a8355a', texte: '#f6eedc' },
  '10': { nom: ['10', '10'], court: '10', couleur: '#2f7d4f', texte: '#f6eedc' },
  pile: { nom: ['Pile ou face', 'Coin flip'], court: 'PILE', couleur: '#7a1a12', texte: '#f3d48e' },
  chasse: { nom: ['Chasse au butin', 'Loot hunt'], court: 'CHASSE', couleur: '#4e1d5c', texte: '#f3d48e' },
  billes: { nom: ['Planche à billes', 'Ball board'], court: 'BILLES', couleur: '#0f5866', texte: '#f3d48e' },
  folle: { nom: ['Folle Nuit', 'Crazy Night'], court: 'FOLLE', couleur: '#160d0b', texte: '#e9ad5b' },
};
export const nomCase = (c: CaseFN) => tr(...CASES[c].nom);
const FLECHES: { nom: [string, string]; couleur: string; image: string }[] = [
  { nom: ['Or', 'Gold'], couleur: '#e9ad5b', image: 'or' },
  { nom: ['Bordeaux', 'Burgundy'], couleur: '#b3261c', image: 'bordeaux' },
  { nom: ['Ivoire', 'Ivory'], couleur: '#f3e7cf', image: 'ivoire' },
];
const mod = (a: number, n: number) => ((a % n) + n) % n;
/** Petit générateur pseudo-aléatoire : les rouleaux du Top Slot défilent pareil d'un rendu à l'autre. */
function suite(graine: number) {
  let s = (Math.imul(graine + 1, 2654435761) >>> 0) || 1;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}
const SYMBOLES_REPLI = ['♠', '♥', '♦', '♣', '★', '✦', '●', '▲', '■', '◆', '♛', '☾'];

/** Une image du show est-elle en ligne ? (null : on ne sait pas encore). */
function useImage(src: string): boolean | null {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    let vivant = true;
    const i = new Image();
    i.onload = () => vivant && setOk(true);
    i.onerror = () => vivant && setOk(false);
    i.src = src;
    return () => {
      vivant = false;
    };
  }, [src]);
  return ok;
}

/** Fin de l'étape en cours (heure locale), recalée à chaque vue reçue. */
function useEtape(v: VueFolleNuit) {
  const recu = useMemo(() => ({ fin: v.reste === null ? null : Date.now() + v.reste, duree: v.duree ?? 0 }), [v]);
  return recu;
}
function useSecondes(fin: number | null): number {
  const [s, setS] = useState(0);
  useEffect(() => {
    if (fin === null) return;
    const maj = () => setS(Math.max(0, Math.ceil((fin - Date.now()) / 1000)));
    maj();
    const t = window.setInterval(maj, 250);
    return () => window.clearInterval(t);
  }, [fin]);
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// Petits dessins

/** L'emblème d'un bonus (pièce, coffre-fort, planche, étoile). */
function Embleme({ c, className = '' }: { c: BonusFN; className?: string }) {
  return <img className={`fn-embleme ${className}`} src={`/cartes/fn-bonus-${c}.webp`} alt="" draggable={false} />;
}

function arc(cx: number, cy: number, r1: number, r2: number, a1: number, a2: number) {
  const p = (r: number, a: number) => `${(cx + r * Math.cos(a)).toFixed(3)} ${(cy + r * Math.sin(a)).toFixed(3)}`;
  return `M${p(r1, a1)} L${p(r2, a1)} A${r2} ${r2} 0 0 1 ${p(r2, a2)} L${p(r1, a2)} A${r1} ${r1} 0 0 0 ${p(r1, a1)} Z`;
}

// ---------------------------------------------------------------------------------------------------------------
// Le mouvement des roues

/**
 * Angle parcouru à l'instant p (0 → 1) d'un lancer : petit élan en arrière, lancer, long freinage jusqu'à dépasser un
 * peu la case, puis retour en douceur sur l'arrêt (le clapet la repousse).
 */
function profilLancer(p: number, total: number, depasse: number): number {
  const ELAN = 0.06;
  const RETOUR = 0.1;
  const RECUL = 3.5;
  if (p <= 0) return 0;
  if (p < ELAN) return -RECUL * Math.sin(((p / ELAN) * Math.PI) / 2);
  if (p < 1 - RETOUR) {
    const u = (p - ELAN) / (1 - ELAN - RETOUR);
    return -RECUL + (total + depasse + RECUL) * (1 - Math.pow(1 - u, 3.4));
  }
  if (p < 1) {
    const u = (p - (1 - RETOUR)) / RETOUR;
    return total + depasse * (1 - (1 - Math.cos(u * Math.PI)) / 2);
  }
  return total;
}

/**
 * Le clapet : à chaque case qui passe sous la flèche, elle est chassée de côté (puis revient) et on entend « tic ».
 * Renvoie la fonction à appeler à chaque image avec l'angle de la roue.
 */
function clapet(pas: number, fleches: () => (HTMLElement | null)[]) {
  let precedent = performance.now();
  let case_: number | null = null;
  let angle: number | null = null;
  let coup = 0;
  let dernierSon = 0;
  return (a: number) => {
    const t = performance.now();
    const dt = Math.min(64, t - precedent);
    precedent = t;
    const ici = Math.floor(mod(-a, 360) / pas);
    const sens = angle === null ? 0 : Math.sign(a - angle);
    angle = a;
    coup *= Math.exp(-dt / 85);
    if (case_ !== null && ici !== case_) {
      coup = -sens * 14;
      if (t - dernierSon > 55) {
        dernierSon = t;
        jouerEffet('fn_tic');
      }
    }
    case_ = ici;
    for (const f of fleches()) if (f) f.style.transform = `rotate(${coup.toFixed(2)}deg)`;
    return Math.abs(coup) > 0.15;
  };
}

/** L'étape de la vue au moment où elle a commencé (les vues suivantes de la même étape ne relancent rien). */
function useDebutEtape(v: VueFolleNuit, etape: { fin: number | null; duree: number }) {
  const cle = `${v.manche}:${v.phase}`;
  const ref = useRef({ cle: '', fin: null as number | null, duree: 0 });
  if (ref.current.cle !== cle) ref.current = { cle, fin: etape.fin, duree: etape.duree };
  return ref.current;
}

/** État des ampoules de la jante : chenillard lent, rapide pendant le lancer, toutes qui clignotent au résultat. */
type Lumieres = 'attente' | 'tourne' | 'gagne';

/** Centres des 52 ampoules de fn-roue-jante.webp (repère 0 → 1000), dans le sens des aiguilles d'une montre. */
const AMPOULES: [number, number][] = [[580.7, 46.0], [628.1, 57.0], [674.2, 73.2], [717.8, 94.1], [759.3, 118.6], [798.0, 147.4], [832.1, 178.8], [864.0, 214.7], [891.8, 253.3], [915.1, 294.9], [933.9, 337.8], [948.4, 382.1], [958.4, 427.2], [957.2, 570.8], [946.5, 616.3], [931.0, 660.9], [909.9, 704.4], [884.6, 745.9], [855.9, 784.1], [826.0, 817.9], [791.7, 849.0], [754.6, 877.3], [713.8, 901.9], [671.0, 922.7], [625.8, 939.0], [579.3, 950.6], [420.9, 950.3], [374.0, 938.9], [328.3, 922.5], [285.5, 901.6], [244.4, 876.9], [207.6, 848.5], [173.6, 817.7], [143.7, 783.9], [115.4, 745.8], [90.7, 704.2], [69.7, 661.1], [54.1, 616.4], [42.5, 570.7], [42.6, 425.3], [53.2, 379.4], [68.6, 334.8], [88.2, 291.9], [112.4, 249.4], [142.2, 209.4], [175.0, 173.9], [212.1, 141.5], [250.9, 114.6], [292.5, 90.9], [335.5, 71.7], [381.3, 56.6], [428.1, 45.8]];

/**
 * Les ampoules de la jante, chacune à sa place : une sur trois allumée qui avance (chenillard), lent pendant les mises,
 * très rapide pendant le lancer ; au résultat, une sur deux clignote en alternance.
 */
function Ampoules({ etat }: { etat: Lumieres }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg className={`fn-ampoules ${etat} ${mouvementReduit() ? 'fixes' : ''}`} viewBox="0 0 1000 1000" aria-hidden="true">
      <defs>
        <radialGradient id={`${id}-on`}>
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.28" stopColor="#fff4c8" />
          <stop offset="0.5" stopColor="#ffd36a" stopOpacity="0.75" />
          <stop offset="1" stopColor="#ffb53a" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-off`}>
          <stop offset="0" stopColor="#6b3d0e" />
          <stop offset="0.75" stopColor="#4a2a08" stopOpacity="0.9" />
          <stop offset="1" stopColor="#4a2a08" stopOpacity="0" />
        </radialGradient>
      </defs>
      {AMPOULES.map(([x, y], i) => (
        <g key={i} style={{ '--p': (i % 3) / 3, '--q': (i % 2) / 2 } as CSSProperties}>
          <circle className="eteinte" cx={x} cy={y} r="12.5" fill={`url(#${id}-off)`} />
          <circle className="allumee" cx={x} cy={y} r="27" fill={`url(#${id}-on)`} />
        </g>
      ))}
    </svg>
  );
}

function Jante({ lumieres }: { lumieres: Lumieres }) {
  return (
    <>
      <span className="fn-roue-ombre" />
      <img className="fn-roue-jante" src="/cartes/fn-roue-jante.webp" alt="" draggable={false} />
      <Ampoules etat={lumieres} />
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// La grande roue (54 cases)

const PAS = 360 / ROUE_FN.length;
/** Où la roue s'arrête dans la case (le même sur tous les écrans) : jamais pile au milieu. */
const decalageArret = (manche: number) => ((mod(manche * 7919, 101) / 101) - 0.5) * 0.56;
/** Dernier angle de la grande roue : elle repart d'où elle s'est arrêtée, même après un bonus. */
let angleRoue = 0;

function GrandeRoue({ v, etape }: { v: VueFolleNuit; etape: { fin: number | null; duree: number } }) {
  const disque = useRef<HTMLDivElement>(null);
  const fleche = useRef<HTMLImageElement>(null);
  const debut = useDebutEtape(v, etape);
  const cle = `${v.manche}:${v.phase}`;
  useEffect(() => {
    const d = disque.current;
    if (!d) return;
    const poser = (a: number) => {
      angleRoue = a;
      d.style.transform = `rotate(${a}deg)`;
    };
    if (v.arret === null || v.phase === 'mises' || v.phase === 'topSlot') return poser(angleRoue);
    const cible = -(v.arret + 0.5 + decalageArret(v.manche)) * PAS;
    if (v.phase !== 'roue' || !debut.fin || mouvementReduit()) return poser(cible);
    const t0 = debut.fin - debut.duree;
    const duree = debut.duree * 0.94;
    const depart = angleRoue;
    const total = 360 * 5 + mod(cible - depart, 360);
    const tic = clapet(PAS, () => [fleche.current]);
    if (Date.now() - t0 < 600) jouerEffet('fn_depart');
    let id = 0;
    const image = () => {
      const p = (Date.now() - t0) / duree;
      const a = depart + profilLancer(p, total, PAS * 0.42);
      poser(a);
      const bouge = tic(a);
      if (p < 1 || bouge) id = requestAnimationFrame(image);
    };
    id = requestAnimationFrame(image);
    return () => {
      cancelAnimationFrame(id);
      if (fleche.current) fleche.current.style.transform = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle, v.arret]);

  const segments = useMemo(
    () =>
      ROUE_FN.map((c, i) => {
        const a1 = ((i * PAS - 90) * Math.PI) / 180;
        const a2 = (((i + 1) * PAS - 90) * Math.PI) / 180;
        const am = (((a1 + a2) / 2) * 180) / Math.PI + 90;
        const info = CASES[c];
        return (
          <g key={i}>
            <path d={arc(0, 0, 29, 100, a1, a2)} fill={info.couleur} stroke="#e7c27a" strokeWidth="0.55" />
            <g transform={`rotate(${am}) translate(0 -85)`}>
              {estBonus(c) ? (
                <image href={`/cartes/fn-bonus-${c}.webp`} x="-7.5" y="-7.5" width="15" height="15" />
              ) : (
                <text textAnchor="middle" dominantBaseline="central" fontSize={c === '10' ? 10 : 12.5} fontFamily="Limelight, Georgia, serif" fill={info.texte} stroke="rgba(0,0,0,0.35)" strokeWidth="0.4">
                  {c}
                </text>
              )}
            </g>
            {estBonus(c) && (
              <g transform={`rotate(${am}) translate(0 -58)`}>
                <text textAnchor="middle" dominantBaseline="central" fontSize="5.2" fontWeight="800" fill={info.texte} transform="rotate(-90)" letterSpacing="0.35">
                  {info.court}
                </text>
              </g>
            )}
          </g>
        );
      }),
    [],
  );
  const gagnante = v.arret !== null && (v.phase === 'resultat' || v.phase === 'intro') ? v.arret : null;
  const lumieres: Lumieres = v.phase === 'roue' ? 'tourne' : gagnante !== null ? 'gagne' : 'attente';
  return (
    <div className={`fn-roue ${lumieres}`} role="img" aria-label={tr('La roue de la Folle Nuit', 'The Crazy Night wheel')}>
      <div className="fn-roue-disque" ref={disque}>
        <svg viewBox="-100 -100 200 200" aria-hidden="true">
          {segments}
          {gagnante !== null && <path className="fn-case-gagnante" d={arc(0, 0, 29, 100, ((gagnante * PAS - 90) * Math.PI) / 180, (((gagnante + 1) * PAS - 90) * Math.PI) / 180)} />}
        </svg>
        <span className="fn-roue-velours" />
      </div>
      <Jante lumieres={lumieres} />
      <img className="fn-roue-moyeu" src="/cartes/fn-roue-moyeu.webp" alt="" draggable={false} />
      <img className="fn-roue-fleche" ref={fleche} src="/cartes/fn-roue-fleche.webp" alt="" draggable={false} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Le Top Slot : deux vrais rouleaux (les cases, les multiplicateurs) qui défilent et s'arrêtent l'un après l'autre.

const X_ROULEAU = [2, 3, 4, 5, 7, 10, 15, 20, 25, 50];
const X_ROULEAU_HAPPY = [10, 15, 20, 25, 50, 75, 100];

function Rouleau({ items, debut, arret, rate }: { items: ReactNode[]; debut: number | null; arret: number; rate: boolean }) {
  const bande = useRef<HTMLSpanElement>(null);
  const n = items.length;
  // Raté : le rouleau s'arrête entre deux cases, hors de la ligne.
  const finY = -((n - 1 - (rate ? 0.5 : 0)) / n) * 100;
  useLayoutEffect(() => {
    const el = bande.current;
    if (!el) return;
    el.style.transform = `translateY(${finY}%)`;
    if (debut === null || typeof el.animate !== 'function') return;
    const ecoule = Date.now() - debut;
    if (ecoule >= arret) return;
    const options: KeyframeAnimationOptions = { duration: arret, fill: 'both' };
    const defile = el.animate([{ transform: 'translateY(0%)' }, { transform: `translateY(${finY}%)` }], { ...options, easing: 'cubic-bezier(0.12, 0.55, 0.22, 1.07)' });
    const flou = el.animate([{ filter: 'blur(0px)' }, { filter: 'blur(2.4px)', offset: 0.08 }, { filter: 'blur(1.6px)', offset: 0.7 }, { filter: 'blur(0px)' }], options);
    defile.currentTime = ecoule;
    flou.currentTime = ecoule;
    const son = window.setTimeout(() => jouerEffet('machine_arret'), arret - ecoule);
    return () => {
      defile.cancel();
      flou.cancel();
      window.clearTimeout(son);
    };
  }, [debut, arret, finY, n]);
  return (
    <span className="fn-ts-bande" ref={bande} style={{ '--n': n } as CSSProperties}>
      {items.map((x, i) => (
        <span key={i} className="fn-ts-item">
          {x}
        </span>
      ))}
    </span>
  );
}

function ItemCase({ c }: { c: CaseFN }) {
  return (
    <span className={`fn-ts-case ${estBonus(c) ? 'bonus' : ''}`} style={{ background: CASES[c].couleur, color: CASES[c].texte }}>
      {estBonus(c) ? <Embleme c={c} /> : c}
    </span>
  );
}

function TopSlot({ v, etape }: { v: VueFolleNuit; etape: { fin: number | null; duree: number } }) {
  const t = v.topSlot;
  const montre = !!t && v.phase !== 'mises';
  const e = useDebutEtape(v, etape);
  const debut = v.phase === 'topSlot' && e.fin && !mouvementReduit() ? e.fin - e.duree : null;
  const duree = e.duree || 3200;
  const arrets = [Math.round(duree * 0.55), Math.round(duree * 0.83)];
  const [fini, setFini] = useState(true);
  useEffect(() => {
    if (debut === null) return setFini(true);
    const ecoule = Date.now() - debut;
    if (ecoule < 500) jouerEffet('machine_levier');
    if (ecoule >= arrets[1]) return setFini(true);
    setFini(false);
    const m = window.setTimeout(() => setFini(true), arrets[1] - ecoule + 150);
    return () => window.clearTimeout(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debut]);
  const bandes = useMemo(() => {
    if (!t) return null;
    const h = suite(v.manche);
    const cases: ReactNode[] = Array.from({ length: 18 }, (_, i) => <ItemCase key={i} c={CASES_FN[Math.floor(h() * CASES_FN.length)]} />);
    const valeurs = v.happyHour?.active ? X_ROULEAU_HAPPY : X_ROULEAU;
    const xs: ReactNode[] = Array.from({ length: 22 }, (_, i) => <span key={i} className="fn-ts-x">×{valeurs[Math.floor(h() * valeurs.length)]}</span>);
    cases.push(<ItemCase key="fin" c={t.affiche.case} />, <ItemCase key="apres" c={CASES_FN[Math.floor(h() * CASES_FN.length)]} />);
    xs.push(<span key="fin" className="fn-ts-x">×{t.affiche.x}</span>);
    return { cases, xs };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, v.manche]);
  const touche = montre && fini && !!t?.touche;
  const rate = montre && !t?.touche;
  const vide = [<span key="v" className="fn-ts-vide">?</span>];
  return (
    <div className={`fn-topslot ${touche ? 'touche' : ''} ${rate && fini ? 'rate' : ''} ${v.happyHour?.active ? 'happy' : ''}`} aria-live="polite" aria-label={montre && t ? (t.touche ? `Top Slot : ×${t.touche.x} ${nomCase(t.touche.case)}` : 'Top Slot') : 'Top Slot'}>
      <span className="fn-topslot-fenetre g">
        {/* Le rouleau des cases a une case de plus après l'arrêt : un raté s'arrête entre les deux. */}
        {montre && bandes ? <Rouleau items={bandes.cases.slice(0, rate ? bandes.cases.length : bandes.cases.length - 1)} debut={debut} arret={arrets[0]} rate={rate} /> : <Rouleau items={vide} debut={null} arret={0} rate={false} />}
      </span>
      <span className="fn-topslot-fenetre d">{montre && bandes ? <Rouleau items={bandes.xs} debut={debut} arret={arrets[1]} rate={false} /> : <Rouleau items={vide} debut={null} arret={0} rate={false} />}</span>
      <img className="fn-topslot-cadre" src="/cartes/fn-topslot.webp" alt="" draggable={false} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// L'animateur

function ligneAnimateur(v: VueFolleNuit): string {
  const b = v.bonus;
  const top = v.topSlot?.touche;
  const c = v.arret !== null ? ROUE_FN[v.arret] : null;
  switch (v.phase) {
    case 'mises':
      if (v.closes) return tr('Rien ne va plus !', 'No more bets!');
      return v.happyHour?.active ? tr('C’est la Happy Hour ! Le Top Slot donne de ×10 à ×100 !', 'It’s Happy Hour! The Top Slot gives ×10 to ×100!') : tr('Faites vos jeux ! Le 10… ou la Folle Nuit ?', 'Place your bets! The 10… or the Crazy Night?');
    case 'topSlot':
      return top ? tr(`Top Slot : ×${top.x} sur ${nomCase(top.case)} !`, `Top Slot: ×${top.x} on ${nomCase(top.case)}!`) : tr('Le Top Slot tourne…', 'The Top Slot is spinning…');
    case 'roue':
      return tr('Et la roue tourne…', 'And the wheel spins…');
    case 'resultat':
      return c ? tr(`C’est le ${c} !${top && top.case === c ? ` Avec le ×${top.x} du Top Slot !` : ''}`, `It’s ${c}!${top && top.case === c ? ` With the Top Slot ×${top.x}!` : ''}`) : '';
    case 'intro':
      return c ? tr(`Bonus ! ${nomCase(c)} !`, `Bonus! ${nomCase(c)}!`) : '';
    case 'choix':
      return b?.type === 'chasse' ? tr('Visez une case sur le mur !', 'Pick a spot on the wall!') : tr('Choisissez votre flèche : Or, Bordeaux ou Ivoire !', 'Pick your flapper: Gold, Burgundy or Ivory!');
    case 'jeu':
      return b?.type === 'pile' ? tr('La pièce est lancée…', 'The coin is flipped…') : b?.type === 'billes' ? tr('La bille tombe…', 'The ball drops…') : b?.type === 'folle' ? tr('La roue géante tourne !', 'The giant wheel spins!') : tr('On découvre le mur…', 'Revealing the wall…');
    case 'finBonus':
      return tr('Quelle nuit ! Les gains arrivent.', 'What a night! Here come the wins.');
  }
  return '';
}

/** Toutes les 30 minutes (à l'heure et à la demie), l'animateur et la croupière se relaient au micro. */
const RELAIS_PRESENTATEUR = 30 * 60_000;
function useRelais(): number {
  const [tranche, setTranche] = useState(() => Math.floor(Date.now() / RELAIS_PRESENTATEUR));
  useEffect(() => {
    const t = window.setTimeout(() => setTranche(Math.floor(Date.now() / RELAIS_PRESENTATEUR)), (tranche + 1) * RELAIS_PRESENTATEUR - Date.now() + 200);
    return () => window.clearTimeout(t);
  }, [tranche]);
  return tranche;
}

/** Qui présente : l'animateur ou la croupière selon la demi-heure, et la croupière blonde pour la roue de la Folle Nuit. */
function presentateur(v: VueFolleNuit, tranche: number): string {
  if (v.bonus?.type === 'folle' && ['intro', 'choix', 'jeu', 'finBonus'].includes(v.phase)) return '/cartes/fn-croupiere-blonde.webp';
  return tranche % 2 ? '/cartes/fn-croupiere.webp' : '/cartes/fn-animateur.webp';
}

function Animateur({ v }: { v: VueFolleNuit }) {
  const src = presentateur(v, useRelais());
  const image = useImage(src);
  const ligne = ligneAnimateur(v);
  return (
    <div className="fn-animateur">
      {image ? (
        <img key={src} className="fn-presentateur" src={src} alt="" draggable={false} />
      ) : (
        <svg viewBox="0 0 60 90" aria-hidden="true" className="fn-animateur-repli">
          <path d="M18 14 Q30 2 42 14 L40 20 L20 20 Z" fill="#160d0b" />
          <rect x="16" y="18" width="28" height="4" rx="2" fill="#160d0b" />
          <circle cx="30" cy="30" r="9" fill="#e8c9a3" />
          <path d="M14 88 L16 50 Q30 40 44 50 L46 88 Z" fill="#7a1a12" />
          <path d="M26 44 L30 50 L34 44 Z" fill="#e9ad5b" />
          <path d="M44 52 L56 38" stroke="#7a1a12" strokeWidth="6" strokeLinecap="round" />
          <circle cx="56" cy="37" r="3.4" fill="#f3e7cf" />
        </svg>
      )}
      {ligne && (
        <p key={ligne} className="fn-bulle">
          {ligne}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Les jeux bonus

/** Couches de la tranche de la pièce (son épaisseur, vue de profil quand elle tourne). */
const TRANCHE_PIECE = 14;

/**
 * Pile ou face : une vraie pièce (deux faces et une tranche dorée) posée sur son lanceur. Elle se ramasse, part en
 * l'air en tournant sur elle-même, retombe, rebondit un peu en vacillant, puis montre le côté gagnant. Le mouvement
 * suit l'horloge du serveur : un joueur qui arrive en cours de lancer la voit au bon endroit.
 */
function BonusPile({ b, v, etape }: { b: Extract<VueBonusFN, { type: 'pile' }>; v: VueFolleNuit; etape: { fin: number | null; duree: number } }) {
  const couronne = useImage('/cartes/fn-piece-couronne.webp');
  const chapeau = useImage('/cartes/fn-piece-chapeau.webp');
  const top = facteurTopSlot(v.topSlot?.touche, 'pile');
  const piece = useRef<HTMLDivElement>(null);
  const ombre = useRef<HTMLSpanElement>(null);
  const [posee, setPosee] = useState(v.phase === 'finBonus');
  const debut = useDebutEtape(v, etape);
  const cle = `${v.manche}:${v.phase}`;
  useEffect(() => {
    const el = piece.current;
    const sol = ombre.current;
    if (!el || !sol) return;
    const finale = b.cote === 'chapeau' ? 180 : 0;
    /** y : hauteur (en % de la pièce), a : rotation (degrés), s : échelle (la pièce grandit en montant vers nous). */
    const poser = (y: number, a: number, s: number) => {
      el.style.transform = `translateY(${(-y).toFixed(2)}%) rotateX(${a.toFixed(2)}deg) scale(${s.toFixed(3)})`;
      const k = Math.min(1, y / 110);
      sol.style.transform = `translateX(-50%) scale(${(1 - 0.6 * k).toFixed(3)})`;
      sol.style.opacity = (0.6 - 0.4 * k).toFixed(2);
    };
    if (v.phase !== 'jeu' || !b.cote || !debut.fin || mouvementReduit()) {
      poser(0, b.cote ? finale : 0, 1);
      setPosee(!!b.cote);
      return;
    }
    setPosee(false);
    const t0 = debut.fin - debut.duree;
    const D = debut.duree;
    const DEPART = 0.12;
    const VOL = 0.58;
    const REBOND = 0.1;
    const tours = 360 * 7 + finale;
    let id = 0;
    let lancee = false;
    let tombee = false;
    const image = () => {
      const p = (Date.now() - t0) / D;
      if (p < DEPART) {
        // Sur le lanceur : la pièce se ramasse avant de partir.
        poser(0, 0, 1 - 0.07 * Math.sin((p / DEPART) * Math.PI));
      } else if (p < DEPART + VOL) {
        if (!lancee) {
          lancee = true;
          if (p < DEPART + 0.05) jouerEffet('machine_levier');
        }
        const u = (p - DEPART) / VOL;
        const y = 110 * 4 * u * (1 - u);
        poser(y, tours * u, 1 + 0.2 * (y / 110));
      } else if (p < DEPART + VOL + REBOND) {
        if (!tombee) {
          tombee = true;
          jouerEffet('machine_pieces');
        }
        const u = (p - DEPART - VOL) / REBOND;
        poser(16 * Math.abs(Math.sin(u * Math.PI * 2)) * (1 - u), tours + 16 * Math.sin(u * Math.PI * 5) * (1 - u), 1);
      } else {
        poser(0, tours, 1);
        setPosee(true);
        return;
      }
      id = requestAnimationFrame(image);
    };
    id = requestAnimationFrame(image);
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle, b.cote]);
  const gagne = (c: 'couronne' | 'chapeau') => (posee && b.cote === c ? 'gagne' : '');
  return (
    <div className="fn-bonus fn-pile">
      <div className="fn-pile-valeurs">
        <span className={gagne('couronne')}>
          {tr('Couronne', 'Crown')} <strong>×{b.couronne * top}</strong>
        </span>
        <span className={gagne('chapeau')}>
          {tr('Chapeau', 'Hat')} <strong>×{b.chapeau * top}</strong>
        </span>
      </div>
      <div className={`fn-lanceur ${posee && b.cote ? 'posee' : ''}`}>
        <span className="fn-lanceur-socle" />
        <span className="fn-lanceur-ombre" ref={ombre} />
        <div className="fn-piece3d" ref={piece}>
          {Array.from({ length: TRANCHE_PIECE }, (_, k) => (
            <i key={k} className="fn-piece-tranche" style={{ transform: `translateZ(${((k - (TRANCHE_PIECE - 1) / 2) * 1.15).toFixed(2)}px)` }} />
          ))}
          <div className="fn-piece-face avant">
            {couronne ? <img src="/cartes/fn-piece-couronne.webp" alt="" draggable={false} /> : <span>♛</span>}
            <b>×{b.couronne * top}</b>
          </div>
          <div className="fn-piece-face arriere">
            {chapeau ? <img src="/cartes/fn-piece-chapeau.webp" alt="" draggable={false} /> : <span>🎩</span>}
            <b>×{b.chapeau * top}</b>
          </div>
        </div>
      </div>
      {posee && b.cote && (
        <p className="fn-bonus-aide gros">
          {b.cote === 'couronne' ? tr('Couronne !', 'Crown!') : tr('Chapeau !', 'Hat!')} ×{(b.cote === 'couronne' ? b.couronne : b.chapeau) * top}
        </p>
      )}
      {top > 1 && <p className="fn-bonus-top">{tr(`Top Slot ×${top} sur Pile ou face !`, `Top Slot ×${top} on Coin flip!`)}</p>}
    </div>
  );
}

function BonusChasse({ b, v, peutChoisir, onChoix }: { b: Extract<VueBonusFN, { type: 'chasse' }>; v: VueFolleNuit; peutChoisir: boolean; onChoix: (i: number) => void }) {
  const sprite = useImage('/cartes/fn-icones.webp');
  const top = facteurTopSlot(v.topSlot?.touche, 'chasse');
  const meilleur = b.valeurs ? Math.max(...b.valeurs) : null;
  return (
    <div className="fn-bonus fn-chasse">
      <div className="fn-mur" style={{ gridTemplateColumns: `repeat(${COLONNES_CHASSE}, minmax(0, 1fr))` }}>
        {b.symboles.map((s, i) => {
          const val = b.valeurs?.[i];
          const moi = b.choix === i;
          return (
            <button
              key={i}
              type="button"
              className={`fn-mur-case ${moi ? 'moi' : ''} ${val !== undefined ? 'devoile' : ''} ${val !== undefined && val === meilleur ? 'meilleur' : ''}`}
              style={{ animationDelay: `${(i % COLONNES_CHASSE) * 28 + Math.floor(i / COLONNES_CHASSE) * 60}ms` }}
              disabled={!peutChoisir}
              onClick={() => onChoix(i)}
              aria-label={val !== undefined ? `×${val * top}` : tr(`Case ${i + 1}`, `Spot ${i + 1}`)}
            >
              {val !== undefined ? (
                <span className="fn-mur-x">×{val * top}</span>
              ) : sprite ? (
                <span className="fn-mur-icone" style={{ backgroundPosition: `${(s % 4) * 33.333}% ${Math.floor(s / 4) * 50}%` }} />
              ) : (
                <span className="fn-mur-repli">{SYMBOLES_REPLI[s]}</span>
              )}
            </button>
          );
        })}
      </div>
      {v.phase === 'choix' || v.phase === 'intro' ? (
        <p className="fn-bonus-aide">{peutChoisir ? (b.choix === null ? tr('Touche une case : ton multiplicateur est caché derrière.', 'Tap a spot: your multiplier is hidden behind it.') : tr('Case choisie ! Tu peux encore changer.', 'Spot chosen! You can still change it.')) : tr('Seuls ceux qui ont misé sur la Chasse choisissent une case.', 'Only those who bet on the Loot hunt pick a spot.')}</p>
      ) : b.valeurs && b.choix !== null ? (
        <p className="fn-bonus-aide">{tr(`Ta case : ×${b.valeurs[b.choix] * top}`, `Your spot: ×${b.valeurs[b.choix] * top}`)}</p>
      ) : null}
      {top > 1 && <p className="fn-bonus-top">{tr(`Top Slot ×${top} sur la Chasse !`, `Top Slot ×${top} on the Loot hunt!`)}</p>}
    </div>
  );
}

/** Géométrie de la planche, sur le fond fn-billes-fond.webp (600 × 480) : l'intérieur bleu canard du cadre doré. */
const BILLES = { W: 600, H: 480, x0: 26, larg: 34.25, y0: 98, rang: 25, caseY: 404, caseH: 40 };
function BonusBilles({ b, v, etape }: { b: Extract<VueBonusFN, { type: 'billes' }>; v: VueFolleNuit; etape: { fin: number | null; duree: number } }) {
  const top = facteurTopSlot(v.topSlot?.touche, 'billes');
  const [bille, setBille] = useState<{ x: number; y: number; k: number } | null>(null);
  const [lancer, setLancer] = useState(0);
  const debut = useDebutEtape(v, etape);
  const cle = `${v.manche}:${v.phase}`;
  const { W, H, x0, larg, y0, rang, caseY, caseH } = BILLES;
  const cx = (col: number) => x0 + col * larg + larg / 2;
  const cy = (r: number) => y0 + r * rang;
  useEffect(() => {
    const lancers = b.lancers;
    if (!lancers || v.phase !== 'jeu' || !debut.fin) return;
    const fin = debut.fin;
    const t0 = fin - debut.duree;
    const par = debut.duree / lancers.length;
    let id = 0;
    let segment = -1;
    let pose = -1;
    const image = () => {
      const t = Date.now() - t0;
      const k = Math.min(lancers.length - 1, Math.max(0, Math.floor(t / par)));
      const l = lancers[k];
      const f = Math.min(1, Math.max(0, (t - k * par) / (par * 0.8)));
      // Points de passage : départ au-dessus de la planche, puis une colonne par rangée, puis la case.
      const cols = [l.depart];
      for (const p of l.chemin) cols.push(cols[cols.length - 1] + p);
      const n = cols.length;
      const pos = f * n;
      const i = Math.min(n - 1, Math.floor(pos));
      const u = Math.min(1, pos - i);
      const x1 = cx(cols[i]);
      const x2 = cx(cols[Math.min(n - 1, i + 1)]);
      const y1 = i === 0 ? y0 - rang : cy(i - 1);
      const y2 = i + 1 >= n ? caseY + caseH / 2 : cy(i);
      // La bille rebondit sur le clou (petit saut), retombe en accélérant et glisse de côté.
      const saut = i === 0 ? 0 : rang * 0.45 * 4 * u * (1 - u);
      const glisse = u * u * (3 - 2 * u);
      setBille({ x: x1 + (x2 - x1) * glisse, y: y1 + (y2 - y1) * u * u - saut, k });
      setLancer(k);
      const s = k * 100 + i;
      if (s !== segment && f < 1) {
        segment = s;
        if (i > 0) jouerEffet('roulette_tic');
      }
      if (f >= 1 && pose !== k) {
        pose = k;
        jouerEffet('machine_arret');
      }
      if (Date.now() < fin) id = requestAnimationFrame(image);
    };
    id = requestAnimationFrame(image);
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle, b.lancers]);
  const termine = v.phase === 'finBonus' && b.lancers;
  const l = b.lancers ? b.lancers[termine ? b.lancers.length - 1 : lancer] : null;
  const cases = l?.cases ?? b.cases;
  const arrivee = termine ? l!.arrivee : null;
  return (
    <div className="fn-bonus fn-billes">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={tr('La planche à billes', 'The ball board')}>
        <defs>
          <radialGradient id="fn-clou" cx="35%" cy="30%" r="70%">
            <stop offset="0" stopColor="#fff6d2" />
            <stop offset="0.45" stopColor="#e9ad5b" />
            <stop offset="1" stopColor="#6b4210" />
          </radialGradient>
          <radialGradient id="fn-bille" cx="35%" cy="30%" r="75%">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.3" stopColor="#ffe9a8" />
            <stop offset="0.75" stopColor="#d79a35" />
            <stop offset="1" stopColor="#6b4210" />
          </radialGradient>
        </defs>
        <image href="/cartes/fn-billes-fond.webp" x="0" y="0" width={W} height={H} preserveAspectRatio="none" />
        {Array.from({ length: RANGEES_BILLES }, (_, r) =>
          Array.from({ length: COLONNES_BILLES + 1 }, (_, c) => <circle key={`${r}-${c}`} cx={x0 + c * larg + (r % 2 ? larg / 2 : 0)} cy={cy(r) + rang / 2} r="3.4" fill="url(#fn-clou)" />),
        )}
        {cases.map((x, i) => {
          const dbl = x === 0;
          const ici = arrivee === i;
          return (
            <g key={i} transform={`translate(${x0 + i * larg} ${caseY})`} className={ici ? 'fn-billes-arrivee' : ''}>
              <rect x="1.5" y="0" width={larg - 3} height={caseH} rx="5" fill={dbl ? '#e9ad5b' : ici ? '#8e1c14' : 'rgba(10, 8, 6, 0.82)'} stroke="#e9ad5b" strokeWidth="1.2" />
              <text x={larg / 2} y={caseH / 2 + 1} textAnchor="middle" dominantBaseline="central" fontSize={dbl ? 6.4 : x * top >= 100 ? 8.5 : 10} fontWeight="800" fill={dbl ? '#160d0b' : '#f3e7cf'}>
                {dbl ? 'DOUBLE' : `×${x * top}`}
              </text>
            </g>
          );
        })}
        {bille && v.phase === 'jeu' && (
          <g>
            <ellipse cx={bille.x + 2} cy={bille.y + 9} rx="7" ry="2.4" fill="rgba(0,0,0,0.35)" />
            <circle cx={bille.x} cy={bille.y} r="8.5" fill="url(#fn-bille)" stroke="#6b4210" strokeWidth="0.8" />
          </g>
        )}
      </svg>
      {b.lancers && b.lancers.length > 1 && <p className="fn-bonus-aide">{tr(`Lancer ${Math.min(lancer, b.lancers.length - 1) + 1} sur ${b.lancers.length} : chaque DOUBLE double toute la planche.`, `Drop ${Math.min(lancer, b.lancers.length - 1) + 1} of ${b.lancers.length}: each DOUBLE doubles the whole board.`)}</p>}
      {b.x !== null && <p className="fn-bonus-aide gros">×{b.x * top}</p>}
      {top > 1 && <p className="fn-bonus-top">{tr(`Top Slot ×${top} sur la Planche !`, `Top Slot ×${top} on the Ball board!`)}</p>}
    </div>
  );
}

const PAS_FOLLE = 360 / SEGMENTS_FOLLE;
function BonusFolle({ b, v, etape, peutChoisir, onChoix }: { b: Extract<VueBonusFN, { type: 'folle' }>; v: VueFolleNuit; etape: { fin: number | null; duree: number }; peutChoisir: boolean; onChoix: (i: number) => void }) {
  const top = facteurTopSlot(v.topSlot?.touche, 'folle');
  /** Tours de roue terminés (le multiplicateur de chaque flèche en dépend). */
  const [faits, setFaits] = useState(0);
  const [tourne, setTourne] = useState(false);
  const disque = useRef<HTMLDivElement>(null);
  const fleches = useRef<(HTMLImageElement | null)[]>([]);
  const debut = useDebutEtape(v, etape);
  const cle = `${v.manche}:${v.phase}`;
  useEffect(() => {
    const d = disque.current;
    if (!d) return;
    const poser = (a: number) => (d.style.transform = `rotate(${a}deg)`);
    const arrets = b.arrets;
    if (!arrets) {
      poser(0);
      setFaits(0);
      return;
    }
    // Angles d'arrêt successifs, les mêmes sur tous les écrans : deux tours au moins, puis la case.
    const A: number[] = [];
    let a = 0;
    for (const s of arrets) {
      a = a + 720 + mod(-s * PAS_FOLLE - a, 360);
      A.push(a);
    }
    if (v.phase !== 'jeu' || !debut.fin || mouvementReduit()) {
      poser(A[A.length - 1]);
      setFaits(arrets.length);
      setTourne(false);
      return;
    }
    const t0 = debut.fin - debut.duree;
    const fin = debut.fin;
    const par = debut.duree / arrets.length;
    const tic = clapet(PAS_FOLLE, () => fleches.current);
    let id = 0;
    let tour = -1;
    let fait = -1;
    let enMouvement: boolean | null = null;
    const image = () => {
      const t = Date.now() - t0;
      const k = Math.min(arrets.length - 1, Math.max(0, Math.floor(t / par)));
      const p = (t - k * par) / (par * 0.75);
      const depart = k ? A[k - 1] : 0;
      const ang = depart + profilLancer(p, A[k] - depart, PAS_FOLLE * 0.4);
      poser(ang);
      tic(ang);
      if (k !== tour) {
        tour = k;
        if (p < 0.08) jouerEffet('fn_depart');
      }
      const f = t >= k * par + par * 0.78 ? k + 1 : k;
      if (f !== fait) setFaits((fait = f));
      const m = p > 0 && p < 1;
      if (m !== enMouvement) setTourne((enMouvement = m));
      if (Date.now() < fin) id = requestAnimationFrame(image);
    };
    id = requestAnimationFrame(image);
    return () => {
      cancelAnimationFrame(id);
      for (const f of fleches.current) if (f) f.style.transform = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle, b.arrets]);

  /** Facteur et résultat de chaque flèche, au tour affiché. */
  const etatFleche = (k: number) => {
    const f = b.fleches?.[k];
    if (!f) return { facteur: 1, x: null as number | null };
    if (faits >= f.facteurs.length) return { facteur: f.facteurs[f.facteurs.length - 1] ?? 1, x: f.x as number | null };
    return { facteur: f.facteurs[faits] ?? 1, x: null as number | null };
  };
  const label = (s: SegmentFolle) => (s === 'double' ? 'DOUBLE' : s === 'triple' ? 'TRIPLE' : `×${s}`);
  const segments = useMemo(
    () =>
      b.segments.map((s, i) => {
        const a1 = (((i - 0.5) * PAS_FOLLE - 90) * Math.PI) / 180;
        const a2 = (((i + 0.5) * PAS_FOLLE - 90) * Math.PI) / 180;
        const special = typeof s !== 'number';
        const fond = special ? '#e9ad5b' : typeof s === 'number' && s >= 100 ? '#4e1d5c' : i % 2 ? '#7a1a12' : '#24120e';
        return (
          <g key={i}>
            <path d={arc(0, 0, 25, 100, a1, a2)} fill={fond} stroke="#e7c27a" strokeWidth="0.4" />
            <g transform={`rotate(${i * PAS_FOLLE}) translate(0 -70)`}>
              <text textAnchor="middle" dominantBaseline="central" transform="rotate(-90)" fontSize={special ? 6 : 7.2} fontWeight="800" fill={special ? '#160d0b' : '#f3e7cf'} letterSpacing="0.2">
                {label(s)}
              </text>
            </g>
          </g>
        );
      }),
    [b.segments],
  );
  const lumieres: Lumieres = tourne ? 'tourne' : v.phase === 'finBonus' ? 'gagne' : 'attente';
  return (
    <div className="fn-bonus fn-folle">
      <div className={`fn-roue fn-roue-folle ${lumieres}`} role="img" aria-label={tr('La roue géante de la Folle Nuit', 'The giant Crazy Night wheel')}>
        <div className="fn-roue-disque" ref={disque}>
          <svg viewBox="-100 -100 200 200" aria-hidden="true">
            {segments}
          </svg>
          <span className="fn-roue-velours" />
        </div>
        <Jante lumieres={lumieres} />
        <span className="fn-roue-moyeu-folle">
          <Embleme c="folle" />
        </span>
        {/* La croupière blonde présente la roue géante, au pied de la roue comme l'animateur pour la grande. */}
        <img className="fn-roue-hote fn-presentateur" src="/cartes/fn-croupiere-blonde.webp" alt="" draggable={false} />
        {DECALAGES_FLECHES.map((d, k) => {
          const e = etatFleche(k);
          return (
            <span key={k} className={`fn-roue-bras ${b.choix === k ? 'moi' : ''}`} style={{ transform: `rotate(${d * PAS_FOLLE}deg)` }}>
              <img
                className="fn-roue-fleche"
                ref={(el) => {
                  fleches.current[k] = el;
                }}
                src={`/cartes/fn-fleche-${FLECHES[k].image}.webp`}
                alt=""
                draggable={false}
              />
              {e.facteur > 1 && <b className="fn-bras-x">×{e.facteur}</b>}
            </span>
          );
        })}
      </div>
      <div className="fn-fleches" role="group" aria-label={tr('Les trois flèches', 'The three flappers')}>
        {FLECHES.map((f, k) => {
          const e = etatFleche(k);
          return (
            <button key={k} type="button" className={`fn-fleche ${b.choix === k ? 'moi' : ''}`} style={{ '--couleur': f.couleur } as CSSProperties} disabled={!peutChoisir} onClick={() => onChoix(k)} aria-pressed={b.choix === k}>
              <img className="fn-fleche-pastille" src={`/cartes/fn-fleche-${f.image}.webp`} alt="" draggable={false} />
              <strong>{tr(...f.nom)}</strong>
              <small>{e.x !== null ? `×${e.x * top}` : e.facteur > 1 ? `×${e.facteur} …` : b.choix === k ? tr('Ta flèche', 'Your flapper') : ''}</small>
            </button>
          );
        })}
      </div>
      {(v.phase === 'choix' || v.phase === 'intro') && <p className="fn-bonus-aide">{peutChoisir ? tr('Choisis ta flèche. DOUBLE ou TRIPLE : tes multiplicateurs grimpent et la roue repart !', 'Pick your flapper. DOUBLE or TRIPLE: your multipliers climb and the wheel spins again!') : tr('Seuls ceux qui ont misé sur la Folle Nuit choisissent une flèche.', 'Only those who bet on the Crazy Night pick a flapper.')}</p>}
      {top > 1 && <p className="fn-bonus-top">{tr(`Top Slot ×${top} sur la Folle Nuit !`, `Top Slot ×${top} on the Crazy Night!`)}</p>}
    </div>
  );
}

/** Ce qu'on prépare pendant le chargement de chaque mini-jeu. */
const CHARGEMENT: Record<BonusFN, [string, string]> = {
  pile: ['On prépare la pièce', 'Getting the coin ready'],
  chasse: ['On installe le mur du butin', 'Setting up the loot wall'],
  billes: ['On plante les clous de la planche', 'Setting the pegs'],
  folle: ['On allume la roue géante', 'Lighting up the giant wheel'],
};

/**
 * Le chargement d'un mini-jeu (pendant l'« intro ») : rayons de lumière, l'emblème du bonus qui arrive, son nom, une
 * barre qui se remplit jusqu'au début du jeu. Il s'efface en fondu quand le jeu commence.
 */
function ChargementBonus({ v, etape }: { v: VueFolleNuit; etape: { fin: number | null; duree: number } }) {
  const actif = v.phase === 'intro' && !!v.bonus;
  const [visible, setVisible] = useState(actif);
  const type = useRef<BonusFN | null>(null);
  if (actif && v.bonus) type.current = v.bonus.type;
  const debut = useDebutEtape(v, etape);
  const duree = useMemo(() => (actif && debut.fin ? Math.max(400, debut.fin - Date.now()) : 3000), [actif, debut]);
  useEffect(() => {
    if (actif) return setVisible(true);
    const t = window.setTimeout(() => setVisible(false), 500);
    return () => window.clearTimeout(t);
  }, [actif]);
  const c = type.current;
  if (!visible || !c) return null;
  const mise = v.mesMises[c] ?? 0;
  return (
    <div className={`fn-chargement fn-chargement-${c} ${actif ? '' : 'sort'}`} role="status">
      <span className="fn-chargement-rayons" />
      <span className="fn-chargement-etincelles" aria-hidden="true">
        {Array.from({ length: 14 }, (_, k) => (
          <i key={k} style={{ '--a': `${k * 25.7}deg`, '--d': `${(k % 5) * 0.22}s` } as CSSProperties} />
        ))}
      </span>
      <Embleme c={c} className="fn-chargement-embleme" />
      <p className="fn-chargement-bonus">{tr('Bonus !', 'Bonus!')}</p>
      <h2>{nomCase(c)}</h2>
      <div className="fn-chargement-barre">
        <span style={{ animationDuration: `${duree}ms` }} />
      </div>
      <p className="fn-chargement-texte">{tr(...CHARGEMENT[c])}</p>
      <small>{mise ? tr(`Tu joues ce bonus · ${dollars(mise)}`, `You're in this bonus · ${dollars(mise)}`) : tr('Tu regardes ce bonus', 'You are watching this bonus')}</small>
    </div>
  );
}

/** La somme gagnée, en grand au milieu de l'écran (elle défile jusqu'au total), par-dessus la pluie de lingots. */
function AnnonceGain({ montant, gros }: { montant: number; gros: boolean }) {
  const valeur = useCompteur(montant, Math.round(montant / 20), 0, gros ? 1700 : 900);
  return (
    <div className={`fn-gain ${gros ? 'gros' : ''}`} aria-live="polite">
      <span>{gros ? tr('Gros gain !', 'Big win!') : tr('Gagné !', 'You win!')}</span>
      <strong>+{dollars(valeur)}</strong>
    </div>
  );
}

function SceneBonus({ v, etape, appel }: { v: VueFolleNuit; etape: { fin: number | null; duree: number }; appel: Appel }) {
  const b = v.bonus!;
  const c = v.arret !== null ? ROUE_FN[v.arret] : null;
  const aMise = !!c && !!v.mesMises[c];
  const peutChoisir = aMise && (v.phase === 'intro' || v.phase === 'choix');
  const secondes = useSecondes(v.phase === 'choix' ? etape.fin : null);
  const choisir = (i: number) => {
    jouerEffet('selection');
    void appel('casino_fn_choix', { index: i });
  };
  let jeu: ReactNode;
  if (b.type === 'pile') jeu = <BonusPile b={b} v={v} etape={etape} />;
  else if (b.type === 'chasse') jeu = <BonusChasse b={b} v={v} peutChoisir={peutChoisir} onChoix={choisir} />;
  else if (b.type === 'billes') jeu = <BonusBilles b={b} v={v} etape={etape} />;
  else jeu = <BonusFolle b={b} v={v} etape={etape} peutChoisir={peutChoisir} onChoix={choisir} />;
  return (
    <section className={`fn-scene-bonus fn-bonus-${b.type}`}>
      <header>
        <Embleme c={b.type} />
        <h2>{nomCase(b.type)}</h2>
        {v.phase === 'choix' && <span className="fn-bonus-temps">{secondes} s</span>}
        {!aMise && <small>{tr('Tu regardes', 'Watching')}</small>}
      </header>
      {jeu}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Le tapis des mises

/** Temps restant lisible : « 34 min », « 2 h 15 », « 6 j 8 h ». */
function duree(ms: number): string {
  const m = Math.max(1, Math.ceil(ms / 60_000));
  if (m < 60) return `${m} min`;
  if (m >= 24 * 60) {
    const h = Math.floor(m / 60);
    return tr(`${Math.floor(h / 24)} j${h % 24 ? ` ${h % 24} h` : ''}`, `${Math.floor(h / 24)} d${h % 24 ? ` ${h % 24} h` : ''}`);
  }
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, '0')}` : ''}`;
}

/** La Happy Hour : en cours (Top Slot ×10 à ×100, compte à rebours), ou l'heure de la prochaine. */
function BandeauHappyHour({ hh }: { hh: HappyHourFN | undefined }) {
  const cible = useMemo(() => (hh ? Date.now() + hh.reste : null), [hh]);
  const [, setTic] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTic((x) => x + 1), 15_000);
    return () => window.clearInterval(t);
  }, []);
  if (!hh || cible === null) return null;
  const reste = Math.max(0, cible - Date.now());
  if (hh.active)
    return (
      <p className="fn-happy actif" role="status">
        <strong>{hh.speciale ? tr('Happy Hour non-stop', 'Non-stop Happy Hour') : 'Happy Hour'}</strong>
        <span>{tr(`Top Slot ×10 à ×100 à chaque manche · encore ${duree(reste)}`, `Top Slot ×10 to ×100 every round · ${duree(reste)} left`)}</span>
      </p>
    );
  return (
    <p className="fn-happy">
      <strong>Happy Hour</strong>
      <span>
        {hh.speciale
          ? tr(`non-stop, jour et nuit : Top Slot ×10 à ×100 · dans ${duree(reste)}`, `non-stop, day and night: Top Slot ×10 to ×100 · in ${duree(reste)}`)
          : tr(`de 11 h à 12 h : Top Slot ×10 à ×100 · dans ${duree(reste)}`, `11 am to noon: Top Slot ×10 to ×100 · in ${duree(reste)}`)}
      </span>
    </p>
  );
}

function Tapis({ v, ouvertes, onMiser }: { v: VueFolleNuit; ouvertes: boolean; onMiser: (c: CaseFN) => void }) {
  const top = v.topSlot?.touche;
  const sortie = v.arret !== null && (v.phase === 'resultat' || v.phase === 'finBonus' || v.phase === 'intro' || v.phase === 'choix' || v.phase === 'jeu') ? ROUE_FN[v.arret] : null;
  return (
    <div className="fn-tapis" role="group" aria-label={tr('Les cases où miser', 'Betting spots')}>
      {CASES_FN.map((c) => {
        const info = CASES[c];
        const mise = v.mesMises[c] ?? 0;
        const boost = top && top.case === c && v.phase !== 'mises' && v.phase !== 'topSlot' ? top.x : null;
        return (
          <button
            key={c}
            type="button"
            className={`fn-case ${estBonus(c) ? 'bonus' : 'nombre'} ${sortie === c ? 'sortie' : ''} ${mise ? 'misee' : ''}`}
            style={{ '--couleur': info.couleur, '--texte': info.texte } as CSSProperties}
            disabled={!ouvertes}
            onClick={() => onMiser(c)}
            aria-label={`${nomCase(c)}${mise ? ` · ${dollars(mise)}` : ''}`}
          >
            {estBonus(c) ? (
              <>
                <Embleme c={c} />
                <span className="fn-case-nom">{nomCase(c)}</span>
              </>
            ) : (
              <span className="fn-case-chiffre">{c}</span>
            )}
            {boost && <span className="fn-case-boost">×{boost}</span>}
            {mise > 0 && (
              <span className="fn-case-mise">
                <img src={`/cartes/jeton-${imageJeton(mise)}.webp`} alt="" />
                {court(mise)}
              </span>
            )}
            {!!v.misesSalon[c] && v.misesSalon[c] !== mise && <span className="fn-case-salon">{court(v.misesSalon[c]!)}</span>}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// L'écran

export function ShowFolleNuit({ appel, onRetour }: { appel: Appel; onRetour: () => void }) {
  const [v, setV] = useState<VueFolleNuit | null>(null);
  const [jeton, setJeton] = useState(JETONS_FN[1]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  /** Gros gain : une pluie de lingots sur tout l'écran ; et pour chaque gain, la somme en grand. */
  const [pluie, setPluie] = useState<{ n: number; id: number } | null>(null);
  const [annonce, setAnnonce] = useState<{ montant: number; gros: boolean; id: number } | null>(null);
  const minuteriePluie = useRef(0);
  const minuterieAnnonce = useRef(0);
  useEffect(
    () => () => {
      window.clearTimeout(minuteriePluie.current);
      window.clearTimeout(minuterieAnnonce.current);
    },
    [],
  );
  const plateau = useImage('/cartes/fn-plateau.webp');
  const precedente = useRef<VueFolleNuit | null>(null);
  /** Mode automatique : mes mises de la manche d'avant, rejouées à chaque manche (10 à 100, ou sans fin). */
  const [auto, setAuto] = useState({ actif: false, restants: 0 });
  const [choixAuto, setChoixAuto] = useState(false);
  const autoRef = useRef(auto);
  autoRef.current = auto;
  const autoManche = useRef(-1);
  const minuterieAuto = useRef(0);
  useEffect(() => () => window.clearTimeout(minuterieAuto.current), []);

  useEffect(() => {
    let vivant = true;
    // Après une coupure, le salon peut mettre quelques secondes à se rouvrir : on réessaie avant d'afficher l'erreur.
    const entrer = async (essai = 0): Promise<void> => {
      const r = (await appel('casino_fn_entrer')) as { ok: boolean; erreur?: string; show?: VueFolleNuit };
      if (!vivant) return;
      if (r.ok && r.show) {
        setErreur(null);
        return setV(r.show);
      }
      if (essai < 5) return void window.setTimeout(() => void entrer(essai + 1), 1200);
      setErreur(r.erreur ?? tr('Le show est indisponible pour le moment.', 'The show is unavailable right now.'));
    };
    void entrer();
    const surVue = (x: VueFolleNuit) => setV(x);
    // Après une coupure, le salon se rouvre d'abord (Casino.tsx), puis on revient au show.
    const surConnexion = () => window.setTimeout(() => void entrer(), 2600);
    socket.on('casino_fn', surVue);
    socket.on('connect', surConnexion);
    return () => {
      vivant = false;
      socket.off('casino_fn', surVue);
      socket.off('connect', surConnexion);
      socket.emit('casino_fn_quitter');
    };
  }, [appel]);

  // Sons et fête : le résultat de ma manche.
  useEffect(() => {
    const p = precedente.current;
    precedente.current = v;
    if (!v || !p) return;
    if (v.phase === 'mises' && p.phase !== 'mises') setErreur(null);
    if (v.phase === 'intro' && p.phase !== 'intro') jouerEffet('fn_intro');
    if (v.monGain !== null && p.monGain === null) {
      const mise = Object.values(v.mesMises).reduce((s, x) => s + (x ?? 0), 0);
      const gros = v.monGain >= 1_000_000 || (!!mise && v.monGain >= mise * 50);
      if (v.monGain > 0) {
        setAnnonce({ montant: v.monGain, gros, id: Date.now() });
        window.clearTimeout(minuterieAnnonce.current);
        minuterieAnnonce.current = window.setTimeout(() => setAnnonce(null), gros ? 4300 : 2900);
      }
      if (gros) {
        jouerEffet('fn_fanfare');
        if (!mouvementReduit()) {
          const n = v.monGain >= 50_000_000 ? LINGOTS_PALIER.colossal : v.monGain >= 5_000_000 ? LINGOTS_PALIER.enorme : LINGOTS_PALIER.gros;
          setPluie({ n, id: Date.now() });
          window.setTimeout(() => jouerEffet('lingots_pluie'), 250);
          window.clearTimeout(minuteriePluie.current);
          minuteriePluie.current = window.setTimeout(() => setPluie(null), 3800);
        }
      } else if (v.monGain > 0) jouerEffet('fn_gain');
      else if (v.monGain < 0) jouerEffet('fn_perdu');
    }
  }, [v]);

  // Mode automatique : dès que les mises ouvrent, on rejoue celles de la manche d'avant (sauf si j'ai déjà misé).
  useEffect(() => {
    if (!v || !auto.actif || v.phase !== 'mises' || v.closes || autoManche.current === v.manche) return;
    autoManche.current = v.manche;
    if (Object.values(v.mesMises).some((x) => x)) return;
    if (!v.peutRefaire) {
      setAuto({ actif: false, restants: 0 });
      return;
    }
    window.clearTimeout(minuterieAuto.current);
    minuterieAuto.current = window.setTimeout(async () => {
      if (!autoRef.current.actif) return;
      const r = await appel('casino_fn_refaire');
      if (r.ok) {
        jouerEffet('jeton');
        setAuto((a) => (a.actif ? { actif: a.restants - 1 > 0, restants: a.restants - 1 } : a));
      } else {
        setAuto({ actif: false, restants: 0 });
        setErreur(tr(`Mode auto arrêté : ${r.erreur ?? 'mise impossible.'}`, `Auto play stopped: ${r.erreur ?? 'bet not allowed.'}`));
      }
    }, 650);
  }, [v, auto.actif, appel]);

  const etape = useEtape(v ?? ({ reste: null, duree: null } as VueFolleNuit));
  const secondes = useSecondes(v?.phase === 'mises' ? etape.fin : null);

  if (!v)
    return (
      <div className="cas-ecran fn-ecran">
        <header className="cas-barre">
          <button type="button" className="cas-retour" onClick={onRetour}>
            ‹ {tr('Salon', 'Lounge')}
          </button>
          <h1 className="fn-titre">
            <img className="fn-logo" src="/cartes/fn-logo.webp" alt={tr('La Folle Nuit', 'Crazy Night')} draggable={false} />
          </h1>
          <span className="cas-barre-vide" />
        </header>
        <div className="chargement">{erreur ?? tr('Le show commence…', 'The show is starting…')}</div>
      </div>
    );

  const ouvertes = v.phase === 'mises' && !v.closes;
  const maMise = Object.values(v.mesMises).reduce((s, x) => s + (x ?? 0), 0);
  const envoyer = async (evt: string, data?: unknown) => {
    setErreur(null);
    const r = await appel(evt, data);
    if (!r.ok) setErreur(r.erreur ?? tr('Action impossible.', 'Action not allowed.'));
    return r.ok;
  };
  const miser = async (c: CaseFN) => {
    if (!ouvertes) return;
    if (jeton > v.solde) return setErreur(tr('Solde insuffisant pour ce jeton.', 'Not enough money for this chip.'));
    if (await envoyer('casino_fn_miser', { case: c, montant: jeton })) jouerEffet('jeton');
  };
  const enBonus = !!v.bonus && (v.phase === 'intro' || v.phase === 'choix' || v.phase === 'jeu' || v.phase === 'finBonus');
  const sortie = v.arret !== null && !['mises', 'topSlot', 'roue'].includes(v.phase) ? ROUE_FN[v.arret] : null;

  let statut: ReactNode;
  if (v.phase === 'mises') statut = v.closes ? <strong className="fn-annonce ferme">{tr('Rien ne va plus', 'No more bets')}</strong> : <strong className="fn-annonce">{tr(`Faites vos jeux · ${secondes} s`, `Place your bets · ${secondes} s`)}</strong>;
  else if (v.phase === 'topSlot') statut = <strong className="fn-annonce">Top Slot…</strong>;
  else if (v.phase === 'roue') statut = <strong className="fn-annonce">{tr('La roue tourne…', 'The wheel is spinning…')}</strong>;
  else if (sortie)
    statut = (
      <span className="fn-sortie" style={{ '--couleur': CASES[sortie].couleur, '--texte': CASES[sortie].texte } as CSSProperties}>
        <span className="fn-sortie-case">{estBonus(sortie) ? <Embleme c={sortie} /> : sortie}</span>
        <strong>{estBonus(sortie) ? nomCase(sortie) : tr(`Le ${sortie} paie ${Number(sortie) * facteurTopSlot(v.topSlot?.touche, sortie)} pour 1`, `${sortie} pays ${Number(sortie) * facteurTopSlot(v.topSlot?.touche, sortie)} to 1`)}</strong>
      </span>
    );

  return (
    <div className={`cas-ecran fn-ecran ${enBonus ? 'en-bonus' : ''}`} data-phase={v.phase}>
      <header className="cas-barre">
        <button type="button" className="cas-retour" onClick={onRetour}>
          ‹ {tr('Salon', 'Lounge')}
        </button>
        <h1 className="fn-titre">
          <img className="fn-logo" src="/cartes/fn-logo.webp" alt={tr('La Folle Nuit', 'Crazy Night')} draggable={false} />
          <span className="fn-direct">{tr('En direct', 'Live')}</span>
          {v.happyHour?.active && <span className="fn-happy-pastille">Happy Hour</span>}
        </h1>
        <span className="cas-solde-petit">{dollars(v.solde)}</span>
      </header>

      <div className={`fn-plateau ${plateau ? 'decor' : ''} ${enBonus && v.bonus?.type === 'folle' ? 'decor-folle' : ''}`}>
        <div className="fn-scene">
          <TopSlot v={v} etape={etape} />
          {enBonus ? <SceneBonus v={v} etape={etape} appel={appel} /> : <GrandeRoue v={v} etape={etape} />}
          <ChargementBonus v={v} etape={etape} />
          <Animateur v={v} />
        </div>
        <div className="fn-infos">
          <div className="fn-statut" role="status">
            {statut}
            {v.phase === 'mises' && v.duree && v.reste !== null && <Barre fin={etape.fin} duree={v.duree} presse={v.closes} />}
          </div>
          {v.monGain !== null && (
            <p className={`fn-bilan ${v.monGain > 0 ? 'gagne' : v.monGain < 0 ? 'perdu' : ''}`}>
              {v.monGain > 0 ? tr(`Tu gagnes ${dollars(v.monGain)} !`, `You win ${dollars(v.monGain)}!`) : v.monGain < 0 ? tr(`Tu perds ${dollars(-v.monGain)}.`, `You lose ${dollars(-v.monGain)}.`) : tr('Ni gagné, ni perdu.', 'Even.')}
            </p>
          )}
          <ol className="fn-historique" aria-label={tr('Derniers résultats', 'Last results')}>
            {v.historique.map((h, i) => (
              <li key={`${v.manche}-${i}`} style={{ '--couleur': CASES[h.case].couleur, '--texte': CASES[h.case].texte } as CSSProperties} title={nomCase(h.case)}>
                {estBonus(h.case) ? <Embleme c={h.case} /> : <span>{h.case}</span>}
                {(estBonus(h.case) || h.x > Number(h.case)) && <small>×{h.x}</small>}
              </li>
            ))}
          </ol>
        </div>
      </div>

      <section className="fn-commandes" role="group" aria-label={tr('Tes mises', 'Your bets')}>
        <BandeauHappyHour hh={v.happyHour} />
        <Tapis v={v} ouvertes={ouvertes} onMiser={(c) => void miser(c)} />
        <div className="bj-jetons">
          {JETONS_FN.map((j) => (
            <button key={j} type="button" className={`bj-jeton ${j === jeton ? 'choisi' : ''}`} onClick={() => (setJeton(j), jouerEffet('jeton'))} disabled={j > v.solde && j !== jeton} aria-pressed={j === jeton} aria-label={dollars(j)}>
              <img src={`/cartes/jeton-${imageJeton(j)}.webp`} alt="" />
              <span>{court(j)}</span>
            </button>
          ))}
        </div>
        <p className="bj-mise-encours">
          {tr('Ta mise', 'Your bet')} <strong>{dollars(maMise)}</strong>
        </p>
        {choixAuto && !auto.actif ? (
          <div className="bj-boutons fn-auto-choix" role="group" aria-label={tr('Mode automatique', 'Auto play')}>
            <span>{tr('Rejouer mes mises', 'Repeat my bets')}</span>
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
            <button type="button" className="fn-auto-fermer" onClick={() => setChoixAuto(false)} aria-label={tr('Fermer', 'Close')}>
              ✕
            </button>
          </div>
        ) : (
          <div className="bj-boutons">
            <button type="button" onClick={() => void envoyer('casino_fn_annuler')} disabled={!ouvertes || !maMise}>
              {tr('Annuler', 'Undo')}
            </button>
            <button type="button" onClick={() => void envoyer('casino_fn_annuler', { tout: true })} disabled={!ouvertes || !maMise}>
              {tr('Effacer', 'Clear')}
            </button>
            <button type="button" onClick={() => void envoyer('casino_fn_doubler').then((ok) => ok && jouerEffet('jeton'))} disabled={!ouvertes || !maMise}>
              {tr('Doubler', 'Double')}
            </button>
            <button type="button" className="bj-principal" onClick={() => void envoyer('casino_fn_refaire').then((ok) => ok && jouerEffet('jeton'))} disabled={!ouvertes || !!maMise || !v.peutRefaire}>
              {tr('Refaire', 'Rebet')}
            </button>
            {auto.actif ? (
              <button type="button" className="fn-auto actif" onClick={() => setAuto({ actif: false, restants: 0 })} aria-label={tr('Arrêter le mode automatique', 'Stop auto play')}>
                {tr('Stop', 'Stop')} · {auto.restants === Infinity ? '∞' : auto.restants}
              </button>
            ) : (
              <button type="button" className="fn-auto" onClick={() => setChoixAuto(true)} disabled={!maMise && !v.peutRefaire}>
                {tr('Auto ▾', 'Auto ▾')}
              </button>
            )}
          </div>
        )}
        {auto.actif && <p className="fn-auto-etat">{auto.restants === Infinity ? tr('Mode auto : tes mises sont rejouées à chaque manche.', 'Auto play: your bets are repeated every round.') : tr(`Mode auto : encore ${auto.restants} manche${auto.restants > 1 ? 's' : ''}.`, `Auto play: ${auto.restants} more round${auto.restants > 1 ? 's' : ''}.`)}</p>}
        {erreur && <p className="cas-erreur">{erreur}</p>}
      </section>

      <section className="fn-bas">
        <div className="fn-joueurs">
          <h2>
            {tr('Dans le salon', 'In the lounge')} <small>{tr(`${v.spectateurs} au show`, `${v.spectateurs} watching`)}</small>
          </h2>
          {v.joueurs.length ? (
            <ul>
              {v.joueurs.map((j, i) => (
                <li key={`${i}-${j.nom}`} className={j.moi ? 'moi' : ''}>
                  <img src={`/cartes/avatar-${j.avatar}.webp`} alt="" />
                  <span>{j.nom || tr('Créateur', 'Creator')}</span>
                  {j.gain !== null ? <em className={j.gain > 0 ? 'gagne' : j.gain < 0 ? 'perdu' : ''}>{j.gain > 0 ? `+${dollars(j.gain)}` : j.gain < 0 ? `−${dollars(-j.gain)}` : '='}</em> : <em>{dollars(j.mise)}</em>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="discret">{tr('Personne n’a encore misé cette manche.', 'Nobody has bet this round yet.')}</p>
          )}
        </div>
        <form
          className="bj-chat"
          onSubmit={(e) => {
            e.preventDefault();
            if (!message.trim()) return;
            void envoyer('casino_fn_chat', { texte: message });
            setMessage('');
          }}
        >
          <ul>
            {v.messages.slice(-4).map((m, i) => (
              <li key={`${v.messages.length}-${i}`}>
                <strong>{m.nom}</strong> {m.texte}
              </li>
            ))}
          </ul>
          <div>
            <input value={message} onChange={(e) => setMessage(e.target.value)} maxLength={120} placeholder={tr('Message au show…', 'Message to the show…')} aria-label={tr('Message', 'Message')} />
            <button type="submit" disabled={!message.trim()}>
              {tr('Envoyer', 'Send')}
            </button>
          </div>
        </form>
        <p className="cas-mention">
          {v.happyHour?.active && v.happyHour.speciale
            ? tr('1 paie 1 pour 1 · 2 paie 2 · 5 paie 5 · 10 paie 10 · les bonus paient leur multiplicateur. Happy Hour non-stop, jour et nuit : le Top Slot multiplie une case à chaque manche de ×10 à ×100. Jetons de 1 000 à 500 000 $ : 1 000 000 $ au plus par case, 4 000 000 $ au plus par manche.', '1 pays 1 to 1 · 2 pays 2 · 5 pays 5 · 10 pays 10 · bonuses pay their multiplier. Non-stop Happy Hour, day and night: the Top Slot boosts one spot every round from ×10 to ×100. Chips from $1,000 to $500,000: $1,000,000 at most per spot, $4,000,000 at most per round.')
            : tr('1 paie 1 pour 1 · 2 paie 2 · 5 paie 5 · 10 paie 10 · les bonus paient leur multiplicateur. Le Top Slot multiplie une case à chaque manche (×2 à ×50) ; Happy Hour de 11 h à 12 h : ×10 à ×100. Jetons de 1 000 à 500 000 $ : 1 000 000 $ au plus par case, 4 000 000 $ au plus par manche.', '1 pays 1 to 1 · 2 pays 2 · 5 pays 5 · 10 pays 10 · bonuses pay their multiplier. The Top Slot boosts one spot every round (×2 to ×50); Happy Hour from 11 am to noon: ×10 to ×100. Chips from $1,000 to $500,000: $1,000,000 at most per spot, $4,000,000 at most per round.')}
        </p>
      </section>

      {pluie && <PluieLingots key={`pluie-${pluie.id}`} n={pluie.n} />}
      {annonce && <AnnonceGain key={`annonce-${annonce.id}`} montant={annonce.montant} gros={annonce.gros} />}
    </div>
  );
}

function Barre({ fin, duree, presse }: { fin: number | null; duree: number; presse: boolean }) {
  const [part, setPart] = useState(1);
  useEffect(() => {
    if (fin === null) return;
    let id = 0;
    const pas = () => {
      setPart(Math.max(0, fin - Date.now()) / duree);
      id = requestAnimationFrame(pas);
    };
    id = requestAnimationFrame(pas);
    return () => cancelAnimationFrame(id);
  }, [fin, duree]);
  return (
    <div className="bj-minuteur" aria-hidden="true">
      <span style={{ transform: `scaleX(${part})` }} className={presse || part < 0.2 ? 'presse' : ''} />
    </div>
  );
}

/**
 * Le bandeau du show dans le salon : l'affiche (le logo et les deux présentateurs), en direct, combien regardent, les
 * derniers résultats. Sans l'affiche, une petite roue et le logo.
 */
export function BandeauFolleNuit({ vue, onOuvrir }: { vue: VueCasino; onOuvrir: () => void }) {
  const fn = vue.folleNuit;
  // Tant qu'on ne sait pas, on prévoit l'affiche (pas de saut de mise en page) ; sans elle, la petite roue.
  const affiche = useImage('/cartes/casino-folle-nuit.webp') !== false;
  const pastilles = (
    <>
      <span className="fn-direct">{tr('En direct', 'Live')}</span>
      {fn?.happyHour?.active && <span className="fn-happy-pastille">Happy Hour</span>}
    </>
  );
  return (
    <button type="button" className={`fn-bandeau ${affiche ? 'affiche' : ''}`} onClick={onOuvrir}>
      {affiche ? (
        <span className="fn-bandeau-affiche">
          <img src="/cartes/casino-folle-nuit.webp" alt={tr('La Folle Nuit', 'Crazy Night')} draggable={false} />
          <span className="fn-bandeau-pastilles">{pastilles}</span>
        </span>
      ) : (
        <svg viewBox="-50 -50 100 100" aria-hidden="true" className="fn-bandeau-roue">
          {ROUE_FN.map((c, i) => {
            const a1 = ((i * PAS - 90) * Math.PI) / 180;
            const a2 = (((i + 1) * PAS - 90) * Math.PI) / 180;
            return <path key={i} d={arc(0, 0, 12, 46, a1, a2)} fill={CASES[c].couleur} stroke="#e7c27a" strokeWidth="0.4" />;
          })}
          <circle r="12" fill="#e9ad5b" />
          <path d="M0 -44 L-5 -52 L5 -52 Z" fill="#e9ad5b" />
        </svg>
      )}
      <span className="fn-bandeau-texte">
        {!affiche && (
          <strong>
            <img className="fn-logo" src="/cartes/fn-logo.webp" alt={tr('La Folle Nuit', 'Crazy Night')} draggable={false} />
            {pastilles}
          </strong>
        )}
        <small>
          {fn?.happyHour?.active
            ? fn.happyHour.speciale
              ? tr('Happy Hour non-stop toute la semaine : le Top Slot donne de ×10 à ×100 à chaque manche !', 'Non-stop Happy Hour all week: the Top Slot gives ×10 to ×100 every round!')
              : tr('Happy Hour jusqu’à 12 h : le Top Slot donne de ×10 à ×100 à chaque manche !', 'Happy Hour until noon: the Top Slot gives ×10 to ×100 every round!')
            : fn?.enDirect
            ? tr(`Le show tourne · ${fn.spectateurs} au show`, `The show is on · ${fn.spectateurs} watching`)
            : tr('La roue géante, le Top Slot et 4 bonus : le show commence dès ton arrivée.', 'The giant wheel, the Top Slot and 4 bonuses: the show starts when you arrive.')}
        </small>
        {!!fn?.historique.length && (
          <span className="fn-bandeau-resultats">
            {fn.historique.map((h, i) => (
              <i key={i} style={{ '--couleur': CASES[h.case].couleur, '--texte': CASES[h.case].texte } as CSSProperties}>
                {estBonus(h.case) ? <Embleme c={h.case} /> : h.case}
              </i>
            ))}
          </span>
        )}
      </span>
    </button>
  );
}
