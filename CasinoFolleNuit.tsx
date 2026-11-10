/**
 * La Folle Nuit : l'écran du show en direct du Salon privé. Une seule roue pour tout le salon : le serveur décide de
 * tout (Top Slot, arrêt de la roue, jeux bonus) et diffuse la vue (« casino_fn ») ; cet écran la met en scène et
 * envoie les mises. Les animations se calent sur le temps qu'il reste à chaque étape : un joueur qui arrive en cours
 * de route voit la suite au bon moment.
 *
 * Visuels attendus (sinon, un dessin de remplacement) : fn-plateau.webp (décor), fn-animateur.webp (l'animateur),
 * fn-piece-couronne.webp et fn-piece-chapeau.webp (la pièce), fn-icones.webp (les 12 symboles du mur, 4 × 3).
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
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
  type SegmentFolle,
  type VueBonusFN,
  type VueFolleNuit,
} from '../../shared/folleNuit';
import type { VueCasino } from '../../shared/casino';
import type { Appel } from './App';
import { dollars } from './casinoOutils';
import { socket } from './socket';
import { tr } from './traduction';
import { Celebration, jouerEffet, mouvementReduit } from './ui';
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
const FLECHES: { nom: [string, string]; couleur: string }[] = [
  { nom: ['Or', 'Gold'], couleur: '#e9ad5b' },
  { nom: ['Bordeaux', 'Burgundy'], couleur: '#b3261c' },
  { nom: ['Ivoire', 'Ivory'], couleur: '#f3e7cf' },
];
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

function IconeBonus({ c, taille = 10 }: { c: BonusFN; taille?: number }) {
  const s = taille;
  if (c === 'pile')
    return (
      <g>
        <circle r={s * 0.55} fill="#e9ad5b" stroke="#7a4a12" strokeWidth={s * 0.08} />
        <circle r={s * 0.34} fill="none" stroke="#7a4a12" strokeWidth={s * 0.06} />
      </g>
    );
  if (c === 'chasse')
    return (
      <g stroke="#f3d48e" strokeWidth={s * 0.09} fill="none">
        <circle r={s * 0.45} />
        <circle r={s * 0.18} fill="#f3d48e" />
        <path d={`M${-s * 0.65} 0H${-s * 0.3}M${s * 0.3} 0H${s * 0.65}M0 ${-s * 0.65}V${-s * 0.3}M0 ${s * 0.3}V${s * 0.65}`} />
      </g>
    );
  if (c === 'billes')
    return (
      <g fill="#f3d48e">
        <circle cx={-s * 0.32} cy={s * 0.22} r={s * 0.18} />
        <circle cx={s * 0.32} cy={s * 0.22} r={s * 0.18} />
        <circle cy={-s * 0.3} r={s * 0.18} />
      </g>
    );
  const pts = Array.from({ length: 10 }, (_, i) => {
    const r = i % 2 ? s * 0.26 : s * 0.62;
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    return `${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`;
  }).join(' ');
  return <polygon points={pts} fill="#e9ad5b" stroke="#7a1a12" strokeWidth={s * 0.06} />;
}

function arc(cx: number, cy: number, r1: number, r2: number, a1: number, a2: number) {
  const p = (r: number, a: number) => `${(cx + r * Math.cos(a)).toFixed(3)} ${(cy + r * Math.sin(a)).toFixed(3)}`;
  return `M${p(r1, a1)} L${p(r2, a1)} A${r2} ${r2} 0 0 1 ${p(r2, a2)} L${p(r1, a2)} A${r1} ${r1} 0 0 0 ${p(r1, a1)} Z`;
}

// ---------------------------------------------------------------------------------------------------------------
// La grande roue (54 cases)

const PAS = 360 / ROUE_FN.length;

function GrandeRoue({ v, etape }: { v: VueFolleNuit; etape: { fin: number | null; duree: number } }) {
  const [angle, setAngle] = useState(0);
  const [transition, setTransition] = useState('none');
  const angleRef = useRef(0);
  const lance = useRef<number | null>(null);
  useEffect(() => {
    if (v.arret === null || v.phase === 'mises' || v.phase === 'topSlot') return;
    if (lance.current === v.manche) return;
    lance.current = v.manche;
    const cible = -(v.arret + 0.5) * PAS;
    const reste = v.phase === 'roue' && etape.fin ? Math.max(0, etape.fin - Date.now()) : 0;
    const depart = angleRef.current;
    const delta = (((cible - depart) % 360) + 360) % 360;
    const tours = reste > 1500 && !mouvementReduit() ? 360 * 5 : 0;
    const final = depart + tours + delta;
    angleRef.current = final;
    if (tours) {
      jouerEffet('roulette_depart');
      setTransition(`transform ${reste * 0.94}ms cubic-bezier(0.12, 0.6, 0.15, 1)`);
    } else setTransition('none');
    setAngle(final);
  }, [v.arret, v.manche, v.phase, etape.fin]);

  const segments = useMemo(
    () =>
      ROUE_FN.map((c, i) => {
        const a1 = ((i * PAS - 90) * Math.PI) / 180;
        const a2 = (((i + 1) * PAS - 90) * Math.PI) / 180;
        const am = (a1 + a2) / 2;
        const info = CASES[c];
        return (
          <g key={i}>
            <path d={arc(0, 0, 30, 95, a1, a2)} fill={info.couleur} stroke="#e7c27a" strokeWidth="0.5" />
            <g transform={`rotate(${(am * 180) / Math.PI + 90}) translate(0 -80)`}>
              {estBonus(c) ? (
                <IconeBonus c={c} taille={8.5} />
              ) : (
                <text textAnchor="middle" dominantBaseline="central" fontSize={c === '10' ? 8.5 : 10} fontFamily="Limelight, Georgia, serif" fill={info.texte}>
                  {c}
                </text>
              )}
            </g>
            {estBonus(c) && (
              <g transform={`rotate(${(am * 180) / Math.PI + 90}) translate(0 -56)`}>
                <text textAnchor="middle" dominantBaseline="central" fontSize="4.2" fontWeight="800" fill={info.texte} transform="rotate(-90)" letterSpacing="0.3">
                  {info.court}
                </text>
              </g>
            )}
          </g>
        );
      }),
    [],
  );
  const gagnante = v.arret !== null && (v.phase === 'resultat' || v.phase === 'intro');
  return (
    <svg className="fn-roue" viewBox="-100 -108 200 210" role="img" aria-label={tr('La roue de la Folle Nuit', 'The Crazy Night wheel')}>
      <defs>
        <radialGradient id="fn-moyeu" cx="40%" cy="35%" r="70%">
          <stop offset="0" stopColor="#fff1c4" />
          <stop offset="0.5" stopColor="#d2a85a" />
          <stop offset="1" stopColor="#7a4a12" />
        </radialGradient>
      </defs>
      <circle r="99" fill="#2a1a0c" stroke="#e9ad5b" strokeWidth="3" />
      <g style={{ transform: `rotate(${angle}deg)`, transition }}>
        {segments}
        {Array.from({ length: ROUE_FN.length }, (_, i) => {
          const a = ((i * PAS - 90) * Math.PI) / 180;
          return <circle key={i} cx={97 * Math.cos(a)} cy={97 * Math.sin(a)} r="1.3" fill="#fff1c4" />;
        })}
      </g>
      <circle r="30" fill="#160d0b" stroke="#e9ad5b" strokeWidth="1.5" />
      <circle r="24" fill="url(#fn-moyeu)" />
      <text textAnchor="middle" y="-4" fontSize="6.2" fontFamily="Limelight, Georgia, serif" fill="#3a1a08">
        LA FOLLE
      </text>
      <text textAnchor="middle" y="5" fontSize="8.5" fontFamily="Limelight, Georgia, serif" fill="#3a1a08">
        NUIT
      </text>
      <path d="M0 -94 L-7 -107 L7 -107 Z" fill="#e9ad5b" stroke="#5a3d12" strokeWidth="1" className={gagnante ? 'fn-fleche-gagne' : ''} />
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Le Top Slot

function TopSlot({ v }: { v: VueFolleNuit }) {
  const t = v.topSlot;
  const tourne = v.phase === 'topSlot' && !mouvementReduit();
  const montre = !!t && v.phase !== 'mises';
  const touche = t?.touche;
  return (
    <div className={`fn-topslot ${tourne ? 'tourne' : ''} ${montre && touche && !tourne ? 'touche' : ''}`} aria-live="polite">
      <span className="fn-topslot-titre">Top Slot</span>
      <span className="fn-topslot-rouleau">
        {montre ? (
          <span key={`c${v.manche}`} className="fn-topslot-case" style={{ background: CASES[t.affiche.case].couleur, color: CASES[t.affiche.case].texte }}>
            {estBonus(t.affiche.case) ? CASES[t.affiche.case].court : t.affiche.case}
          </span>
        ) : (
          <span className="fn-topslot-case vide">?</span>
        )}
      </span>
      <span className="fn-topslot-rouleau">
        <span key={`x${v.manche}`} className="fn-topslot-x">
          {montre ? `×${t.affiche.x}` : '×?'}
        </span>
      </span>
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
      return v.closes ? tr('Rien ne va plus !', 'No more bets!') : tr('Faites vos jeux ! Le 10… ou la Folle Nuit ?', 'Place your bets! The 10… or the Crazy Night?');
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

function Animateur({ v }: { v: VueFolleNuit }) {
  const image = useImage('/cartes/fn-animateur.webp');
  const ligne = ligneAnimateur(v);
  return (
    <div className="fn-animateur">
      {image ? (
        <img src="/cartes/fn-animateur.webp" alt="" draggable={false} />
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

function BonusPile({ b, v, etape }: { b: Extract<VueBonusFN, { type: 'pile' }>; v: VueFolleNuit; etape: { fin: number | null; duree: number } }) {
  const couronne = useImage('/cartes/fn-piece-couronne.webp');
  const chapeau = useImage('/cartes/fn-piece-chapeau.webp');
  const top = facteurTopSlot(v.topSlot?.touche, 'pile');
  const lancee = b.cote !== null;
  const reste = v.phase === 'jeu' && etape.fin ? Math.max(0, etape.fin - Date.now()) : 0;
  const style = { '--duree': `${Math.max(300, reste * 0.85)}ms`, '--fin': b.cote === 'chapeau' ? '1980deg' : '1800deg' } as CSSProperties;
  return (
    <div className="fn-bonus fn-pile">
      <div className="fn-pile-valeurs">
        <span className={b.cote === 'couronne' && v.phase !== 'jeu' ? 'gagne' : ''}>
          {tr('Couronne', 'Crown')} <strong>×{b.couronne * top}</strong>
        </span>
        <span className={b.cote === 'chapeau' && v.phase !== 'jeu' ? 'gagne' : ''}>
          {tr('Chapeau', 'Hat')} <strong>×{b.chapeau * top}</strong>
        </span>
      </div>
      <div className={`fn-piece ${lancee ? (v.phase === 'jeu' && reste > 400 ? 'lancee' : 'posee') : ''}`} style={style}>
        <div className="fn-piece-face">{couronne ? <img src="/cartes/fn-piece-couronne.webp" alt="" /> : <span>♛</span>}<b>×{b.couronne * top}</b></div>
        <div className="fn-piece-face dos">{chapeau ? <img src="/cartes/fn-piece-chapeau.webp" alt="" /> : <span>🎩</span>}<b>×{b.chapeau * top}</b></div>
      </div>
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

const LARGEUR_COL = 20;
function BonusBilles({ b, v, etape }: { b: Extract<VueBonusFN, { type: 'billes' }>; v: VueFolleNuit; etape: { fin: number | null; duree: number } }) {
  const top = facteurTopSlot(v.topSlot?.touche, 'billes');
  const [bille, setBille] = useState<{ x: number; y: number; k: number } | null>(null);
  const [lancer, setLancer] = useState(0);
  const W = COLONNES_BILLES * LARGEUR_COL;
  const H = (RANGEES_BILLES + 3) * 18;
  const cx = (col: number) => col * LARGEUR_COL + LARGEUR_COL / 2;
  const cy = (r: number) => 14 + (r + 1) * 18;
  useEffect(() => {
    const lancers = b.lancers;
    if (!lancers || v.phase !== 'jeu' || !etape.fin) return;
    const fin = etape.fin;
    const debut = fin - etape.duree;
    const par = etape.duree / lancers.length;
    let id = 0;
    const pas = () => {
      const t = Date.now() - debut;
      const k = Math.min(lancers.length - 1, Math.max(0, Math.floor(t / par)));
      const l = lancers[k];
      const f = Math.min(1, Math.max(0, (t - k * par) / (par * 0.8)));
      // Points de passage : départ au-dessus de la planche, puis une colonne par rangée, puis la case.
      const cols = [l.depart];
      for (const p of l.chemin) cols.push(cols[cols.length - 1] + p);
      const n = cols.length; // rangées 0..n-1
      const pos = f * (n - 1 + 1);
      const i = Math.min(n - 1, Math.floor(pos));
      const u = pos - i;
      const x1 = cx(cols[i]);
      const x2 = cx(cols[Math.min(n - 1, i + 1)]);
      const y1 = i === 0 ? 4 : cy(i - 1);
      const y2 = i + 1 >= n ? cy(RANGEES_BILLES) + 6 : cy(i);
      const e = u * u * (3 - 2 * u);
      setBille({ x: x1 + (x2 - x1) * e, y: y1 + (y2 - y1) * u, k });
      setLancer(k);
      if (Date.now() < fin) id = requestAnimationFrame(pas);
    };
    id = requestAnimationFrame(pas);
    return () => cancelAnimationFrame(id);
  }, [b.lancers, v.phase, etape.fin, etape.duree]);
  const termine = v.phase === 'finBonus' && b.lancers;
  const l = b.lancers ? b.lancers[termine ? b.lancers.length - 1 : lancer] : null;
  const cases = l?.cases ?? b.cases;
  const arrivee = termine ? l!.arrivee : null;
  return (
    <div className="fn-bonus fn-billes">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={tr('La planche à billes', 'The ball board')}>
        <rect x="0" y="0" width={W} height={H} rx="8" fill="#0b2a31" stroke="#e9ad5b" strokeWidth="2" />
        {Array.from({ length: RANGEES_BILLES }, (_, r) =>
          Array.from({ length: COLONNES_BILLES + 1 }, (_, c) => <circle key={`${r}-${c}`} cx={c * LARGEUR_COL + (r % 2 ? LARGEUR_COL / 2 : 0)} cy={cy(r) + 9} r="1.8" fill="#e9ad5b" opacity="0.85" />),
        )}
        {cases.map((x, i) => (
          <g key={i} transform={`translate(${i * LARGEUR_COL} ${cy(RANGEES_BILLES) + 2})`}>
            <rect x="1" y="0" width={LARGEUR_COL - 2} height="26" rx="3" fill={x === 0 ? '#e9ad5b' : arrivee === i ? '#7a1a12' : '#160d0b'} stroke="#e9ad5b" strokeWidth="0.8" />
            <text x={LARGEUR_COL / 2} y="16" textAnchor="middle" fontSize={x === 0 ? 5.2 : 6.4} fontWeight="800" fill={x === 0 ? '#160d0b' : '#f3e7cf'}>
              {x === 0 ? 'DOUBLE' : `×${x * top}`}
            </text>
          </g>
        ))}
        {bille && v.phase === 'jeu' && <circle cx={bille.x} cy={bille.y} r="6" fill="#f3e7cf" stroke="#7a4a12" strokeWidth="1.2" />}
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
  const [angle, setAngle] = useState(0);
  const [transition, setTransition] = useState('none');
  const angleRef = useRef(0);
  useEffect(() => {
    const arrets = b.arrets;
    if (!arrets) return;
    if (v.phase !== 'jeu' || !etape.fin) {
      // Arrivé après la fin : la roue est déjà sur le dernier arrêt.
      const final = -(arrets[arrets.length - 1]) * PAS_FOLLE;
      angleRef.current = final;
      setTransition('none');
      setAngle(final);
      setFaits(arrets.length);
      return;
    }
    const debut = etape.fin - etape.duree;
    const par = etape.duree / arrets.length;
    const minuteries: number[] = [];
    arrets.forEach((a, k) => {
      const quand = debut + k * par - Date.now();
      const lancer = () => {
        setFaits(k);
        const depart = angleRef.current;
        const cible = -a * PAS_FOLLE;
        const delta = (((cible - depart) % 360) + 360) % 360;
        const final = depart + (mouvementReduit() ? 0 : 720) + delta;
        angleRef.current = final;
        setTransition(`transform ${par * 0.75}ms cubic-bezier(0.15, 0.6, 0.2, 1)`);
        setAngle(final);
        jouerEffet('roulette_depart');
        minuteries.push(window.setTimeout(() => setFaits(k + 1), par * 0.78));
      };
      if (quand <= 0 && k < arrets.length - 1 && debut + (k + 1) * par < Date.now()) return; // tour déjà passé
      minuteries.push(window.setTimeout(lancer, Math.max(0, quand)));
    });
    return () => minuteries.forEach((m) => window.clearTimeout(m));
  }, [b.arrets, v.phase, etape.fin, etape.duree]);

  /** Facteur et résultat de chaque flèche, au tour affiché. */
  const etatFleche = (k: number) => {
    const f = b.fleches?.[k];
    if (!f) return { facteur: 1, x: null as number | null };
    if (faits >= f.facteurs.length) return { facteur: f.facteurs[f.facteurs.length - 1] ?? 1, x: f.x as number | null };
    return { facteur: f.facteurs[faits] ?? 1, x: null as number | null };
  };
  const label = (s: SegmentFolle) => (s === 'double' ? 'DOUBLE' : s === 'triple' ? 'TRIPLE' : `×${s}`);
  return (
    <div className="fn-bonus fn-folle">
      <div className="fn-folle-roue">
        <svg viewBox="-100 -112 200 214" role="img" aria-label={tr('La roue géante de la Folle Nuit', 'The giant Crazy Night wheel')}>
          <circle r="99" fill="#160d0b" stroke="#e9ad5b" strokeWidth="3" />
          <g style={{ transform: `rotate(${angle}deg)`, transition }}>
            {b.segments.map((s, i) => {
              const a1 = (((i - 0.5) * PAS_FOLLE - 90) * Math.PI) / 180;
              const a2 = (((i + 0.5) * PAS_FOLLE - 90) * Math.PI) / 180;
              const special = typeof s !== 'number';
              const fond = special ? '#e9ad5b' : i % 2 ? '#7a1a12' : '#2a1410';
              return (
                <g key={i}>
                  <path d={arc(0, 0, 22, 96, a1, a2)} fill={fond} stroke="#e7c27a" strokeWidth="0.35" />
                  <g transform={`rotate(${i * PAS_FOLLE}) translate(0 -70)`}>
                    <text textAnchor="middle" dominantBaseline="central" transform="rotate(-90)" fontSize={special ? 5 : 6} fontWeight="800" fill={special ? '#160d0b' : '#f3e7cf'}>
                      {label(s)}
                    </text>
                  </g>
                </g>
              );
            })}
          </g>
          <circle r="22" fill="#e9ad5b" stroke="#7a4a12" strokeWidth="1.5" />
          <text textAnchor="middle" y="3" fontSize="8" fontFamily="Limelight, Georgia, serif" fill="#3a1a08">
            ★
          </text>
          {DECALAGES_FLECHES.map((d, k) => {
            const e = etatFleche(k);
            return (
              <g key={k} transform={`rotate(${d * PAS_FOLLE})`} className={b.choix === k ? 'fn-fleche-moi' : ''}>
                <path d="M0 -92 L-5.5 -106 L5.5 -106 Z" fill={FLECHES[k].couleur} stroke="#160d0b" strokeWidth="1" />
                {e.facteur > 1 && (
                  <text y="-109" textAnchor="middle" fontSize="6" fontWeight="800" fill={FLECHES[k].couleur}>
                    ×{e.facteur}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="fn-fleches" role="group" aria-label={tr('Les trois flèches', 'The three flappers')}>
        {FLECHES.map((f, k) => {
          const e = etatFleche(k);
          return (
            <button key={k} type="button" className={`fn-fleche ${b.choix === k ? 'moi' : ''}`} style={{ '--couleur': f.couleur } as CSSProperties} disabled={!peutChoisir} onClick={() => onChoix(k)} aria-pressed={b.choix === k}>
              <span className="fn-fleche-pastille" />
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
        <svg viewBox="-12 -12 24 24" aria-hidden="true">
          <IconeBonus c={b.type} taille={20} />
        </svg>
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
                <svg viewBox="-12 -12 24 24" aria-hidden="true">
                  <IconeBonus c={c} taille={18} />
                </svg>
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
  const [fete, setFete] = useState<number | null>(null);
  const plateau = useImage('/cartes/fn-plateau.webp');
  const precedente = useRef<VueFolleNuit | null>(null);

  useEffect(() => {
    let vivant = true;
    const entrer = async () => {
      const r = (await appel('casino_fn_entrer')) as { ok: boolean; erreur?: string; show?: VueFolleNuit };
      if (!vivant) return;
      if (r.ok && r.show) setV(r.show);
      else setErreur(r.erreur ?? tr('Le show est indisponible pour le moment.', 'The show is unavailable right now.'));
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
    if (v.phase === 'intro' && p.phase !== 'intro') jouerEffet('suspense');
    if (v.monGain !== null && p.monGain === null) {
      const mise = Object.values(v.mesMises).reduce((s, x) => s + (x ?? 0), 0);
      if (v.monGain >= 1_000_000 || (mise && v.monGain >= mise * 50)) {
        setFete(v.monGain);
        jouerEffet('roulette_gros_lot');
      } else if (v.monGain > 0) jouerEffet('roulette_gain');
      else if (v.monGain < 0) jouerEffet('echec');
    }
  }, [v]);

  const etape = useEtape(v ?? ({ reste: null, duree: null } as VueFolleNuit));
  const secondes = useSecondes(v?.phase === 'mises' ? etape.fin : null);

  if (!v)
    return (
      <div className="cas-ecran fn-ecran">
        <header className="cas-barre">
          <button type="button" className="cas-retour" onClick={onRetour}>
            ‹ {tr('Salon', 'Lounge')}
          </button>
          <h1>{tr('La Folle Nuit', 'Crazy Night')}</h1>
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
        <span className="fn-sortie-case">{estBonus(sortie) ? CASES[sortie].court : sortie}</span>
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
          {tr('La Folle Nuit', 'Crazy Night')} <span className="fn-direct">{tr('En direct', 'Live')}</span>
        </h1>
        <span className="cas-solde-petit">{dollars(v.solde)}</span>
      </header>

      <div className={`fn-plateau ${plateau ? 'decor' : ''}`}>
        <div className="fn-scene">
          <TopSlot v={v} />
          {enBonus ? <SceneBonus v={v} etape={etape} appel={appel} /> : <GrandeRoue v={v} etape={etape} />}
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
                <span>{estBonus(h.case) ? CASES[h.case].court : h.case}</span>
                {(estBonus(h.case) || h.x > Number(h.case)) && <small>×{h.x}</small>}
              </li>
            ))}
          </ol>
        </div>
      </div>

      <section className="fn-commandes" role="group" aria-label={tr('Tes mises', 'Your bets')}>
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
        </div>
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
          {tr('1 paie 1 pour 1 · 2 paie 2 · 5 paie 5 · 10 paie 10 · les bonus paient leur multiplicateur. Le Top Slot multiplie une case avant chaque tour. Jetons de 1 000 à 500 000 $, 1 000 000 $ au plus par manche.', '1 pays 1 to 1 · 2 pays 2 · 5 pays 5 · 10 pays 10 · bonuses pay their multiplier. The Top Slot boosts one spot before each spin. Chips from $1,000 to $500,000, $1,000,000 at most per round.')}
        </p>
      </section>

      {fete !== null && (
        <Celebration
          titre={tr('Gros gain !', 'Big win!')}
          etiquette={tr(`Gain : ${dollars(fete)}`, `Win: ${dollars(fete)}`)}
          medaillon={<strong className="celebration-xp cas-medaillon-gain">{dollars(fete)}</strong>}
          legende={sortie ? tr(`La Folle Nuit · ${nomCase(sortie)}`, `Crazy Night · ${nomCase(sortie)}`) : tr('La Folle Nuit', 'Crazy Night')}
          onFermer={() => setFete(null)}
        />
      )}
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

/** Le bandeau du show dans le salon : en direct, combien regardent, les derniers résultats. */
export function BandeauFolleNuit({ vue, onOuvrir }: { vue: VueCasino; onOuvrir: () => void }) {
  const fn = vue.folleNuit;
  const vignette = useImage('/cartes/casino-folle-nuit.webp');
  return (
    <button type="button" className="fn-bandeau" onClick={onOuvrir}>
      {vignette ? (
        <img src="/cartes/casino-folle-nuit.webp" alt="" draggable={false} />
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
        <strong>
          {tr('La Folle Nuit', 'Crazy Night')} <span className="fn-direct">{tr('En direct', 'Live')}</span>
        </strong>
        <small>
          {fn?.enDirect
            ? tr(`Le show tourne · ${fn.spectateurs} au show`, `The show is on · ${fn.spectateurs} watching`)
            : tr('La roue géante, le Top Slot et 4 bonus : le show commence dès ton arrivée.', 'The giant wheel, the Top Slot and 4 bonuses: the show starts when you arrive.')}
        </small>
        {!!fn?.historique.length && (
          <span className="fn-bandeau-resultats">
            {fn.historique.map((h, i) => (
              <i key={i} style={{ '--couleur': CASES[h.case].couleur, '--texte': CASES[h.case].texte } as CSSProperties}>
                {estBonus(h.case) ? CASES[h.case].court : h.case}
              </i>
            ))}
          </span>
        )}
      </span>
    </button>
  );
}
