/**
 * Roulette du Salon privé : le cylindre (la bille tombe sur le numéro tiré par le serveur), le tapis dessiné en SVG
 * (vertical sur téléphone, horizontal sur grand écran) où l'on pose ses jetons, les autres joueurs et leurs mises,
 * l'historique des numéros et un petit chat de table. Tout est décidé par le serveur ; cet écran affiche la vue
 * reçue (« casino_rl ») et envoie les mises.
 *
 * On y trouve aussi la fenêtre « Inviter un ami » des tables du salon (roulette et blackjack).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { formatDollars } from '../../shared/casino';
import { colonneDe, couleurNumero, CYLINDRE, JETONS_ROULETTE, MISES_ROULETTE, rangeeDe, SIMPLES, type JetonPoseRoulette, type MiseSimple, type VueTableRoulette } from '../../shared/rouletteCasino';
import type { Appel } from './App';
import { EN, tr } from './traduction';
import { Celebration, Fenetre, jouerEffet, mouvementReduit } from './ui';

const dollars = (n: number) => formatDollars(n, EN);
/** Montant court écrit sur un jeton : 25k, 1,5M… */
const court = (n: number) => (n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${+(n / 1000).toFixed(n % 1000 ? 1 : 0)}k` : String(n));
const imageJeton = (v: number) => (v >= 500_000 ? 'violet' : v >= 100_000 ? 'noir' : v >= 25_000 ? 'vert' : v >= 5_000 ? 'rouge' : 'ivoire');
const COULEURS = { rouge: '#8e1c14', noir: '#141010', vert: '#0f6b3a' };

// ---------------------------------------------------------------------------------------------------------------
// Inviter un ami créateur à sa table

type AmiCasino = { code: string; nom: string; avatar: number; statut: 'en_ligne' | 'en_partie' | 'hors_ligne' };

export function FenetreInviter({ appel, onFermer }: { appel: Appel; onFermer: () => void }) {
  const [amis, setAmis] = useState<AmiCasino[] | null>(null);
  const [message, setMessage] = useState<{ texte: string; ok: boolean } | null>(null);
  const [envoyes, setEnvoyes] = useState<string[]>([]);
  useEffect(() => {
    void appel('casino_amis').then((r) => setAmis(r.ok ? ((r as unknown as { amis: AmiCasino[] }).amis ?? []) : []));
  }, [appel]);
  const inviter = async (a: AmiCasino) => {
    setMessage(null);
    const r = (await appel('casino_inviter', { code: a.code })) as { ok: boolean; erreur?: string; message?: string };
    setMessage({ texte: r.ok ? (r.message ?? tr('Invitation envoyée !', 'Invitation sent!')) : (r.erreur ?? tr('Invitation impossible.', 'Could not invite.')), ok: r.ok });
    if (r.ok) setEnvoyes((l) => [...l, a.code]);
  };
  return (
    <Fenetre titre={tr('Inviter un ami', 'Invite a friend')} onFermer={onFermer}>
      <p className="discret">{tr('Seuls tes amis créateurs peuvent venir au Salon privé. Ils reçoivent l’invitation dans le jeu.', 'Only your creator friends can come to the private lounge. They get the invitation in the game.')}</p>
      {amis === null ? (
        <p className="discret">{tr('Chargement…', 'Loading…')}</p>
      ) : amis.length ? (
        <ul className="cas-tables rl-amis">
          {amis.map((a) => (
            <li key={a.code}>
              <span className="cas-tables-avatars">
                <img src={`/cartes/avatar-${a.avatar}.webp`} alt="" />
              </span>
              <span className="cas-tables-noms">
                <strong>{a.nom}</strong>
                <small className={`rl-presence ${a.statut}`}>{a.statut === 'en_ligne' ? tr('En ligne', 'Online') : a.statut === 'en_partie' ? tr('En partie', 'In a game') : tr('Hors ligne', 'Offline')}</small>
              </span>
              <button type="button" className="petit" disabled={a.statut === 'hors_ligne' || envoyes.includes(a.code)} onClick={() => void inviter(a)}>
                {envoyes.includes(a.code) ? tr('Invité', 'Invited') : tr('Inviter', 'Invite')}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="discret">{tr('Aucun ami créateur pour l’instant : ajoute-les depuis le menu Amis.', 'No creator friend yet: add them from the Friends menu.')}</p>
      )}
      {message && <p className={message.ok ? 'rl-ok' : 'cas-erreur'}>{message.texte}</p>}
    </Fenetre>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Le tapis

type Sens = 'h' | 'v';
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** Taille d'une case du tapis (unités SVG) : carrée en largeur, plus basse sur téléphone. */
const ECHELLE: Record<Sens, { x: number; y: number }> = { h: { x: 100, y: 112 }, v: { x: 100, y: 58 } };
const NOMS_SIMPLES: Record<MiseSimple, [string, string]> = { manque: ['1 – 18', '1 – 18'], pair: ['PAIR', 'EVEN'], rouge: ['', ''], noir: ['', ''], impair: ['IMPAIR', 'ODD'], passe: ['19 – 36', '19 – 36'] };

/** Case d'un numéro, en unités de la grille (0 : la grande case du zéro). */
function caseNumero(n: number, sens: Sens): Rect {
  if (n === 0) return sens === 'h' ? { x: 0, y: 0, w: 1, h: 3 } : { x: 2, y: 0, w: 3, h: 1 };
  const c = colonneDe(n);
  const r = rangeeDe(n);
  return sens === 'h' ? { x: 1 + r, y: 2 - c, w: 1, h: 1 } : { x: 2 + c, y: 1 + r, w: 1, h: 1 };
}
/** Case d'une mise extérieure (douzaine, colonne, simple). */
function caseExterieure(cle: string, sens: Sens): Rect | null {
  const d = /^douzaine-(\d)$/.exec(cle);
  if (d) {
    const k = Number(d[1]) - 1;
    return sens === 'h' ? { x: 1 + k * 4, y: 3, w: 4, h: 1 } : { x: 1, y: 1 + k * 4, w: 1, h: 4 };
  }
  const c = /^colonne-(\d)$/.exec(cle);
  if (c) {
    const k = Number(c[1]) - 1;
    return sens === 'h' ? { x: 13, y: 2 - k, w: 1, h: 1 } : { x: 2 + k, y: 13, w: 1, h: 1 };
  }
  const i = SIMPLES.indexOf(cle as MiseSimple);
  if (i >= 0) return sens === 'h' ? { x: 1 + i * 2, y: 4, w: 2, h: 1 } : { x: 0, y: 1 + i * 2, w: 1, h: 2 };
  return null;
}
const centre = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** Zones des mises « à cheval » sur les bords et les coins des cases (en unités de la grille), avec le point du jeton. */
interface Zone {
  cle: string;
  x: number;
  y: number;
  forme: 'coin' | 'large' | 'haute';
}
function zonesInterieures(sens: Sens): Zone[] {
  // Vers l'extérieur (le côté des douzaines) et vers le zéro.
  const ext = sens === 'h' ? { x: 0, y: 1 } : { x: -1, y: 0 };
  const zero = sens === 'h' ? { x: -1, y: 0 } : { x: 0, y: -1 };
  const c = (n: number) => centre(caseNumero(n, sens));
  const bordZero = sens === 'h' ? 'haute' : 'large';
  const bordExt = sens === 'h' ? 'large' : 'haute';
  const zones: Zone[] = [];
  for (const m of MISES_ROULETTE.values()) {
    const ns = m.numeros;
    if (m.type === 'cheval') {
      if (ns[0] === 0) {
        const p = c(ns[1]);
        zones.push({ cle: m.cle, x: p.x + zero.x * 0.5, y: p.y + zero.y * 0.5, forme: bordZero });
      } else {
        const a = c(ns[0]);
        const b = c(ns[1]);
        zones.push({ cle: m.cle, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, forme: a.x !== b.x ? 'haute' : 'large' });
      }
    } else if (m.type === 'transversale') {
      if (ns[0] === 0) {
        const a = c(ns[1]);
        const b = c(ns[2]);
        zones.push({ cle: m.cle, x: (a.x + b.x) / 2 + zero.x * 0.5, y: (a.y + b.y) / 2 + zero.y * 0.5, forme: 'coin' });
      } else {
        const p = c(ns[0]);
        zones.push({ cle: m.cle, x: p.x + ext.x * 0.5, y: p.y + ext.y * 0.5, forme: bordExt });
      }
    } else if (m.type === 'carre') {
      if (ns[0] === 0) {
        const p = c(1);
        zones.push({ cle: m.cle, x: p.x + (ext.x + zero.x) * 0.5, y: p.y + (ext.y + zero.y) * 0.5, forme: 'coin' });
      } else {
        const pts = ns.map(c);
        zones.push({ cle: m.cle, x: pts.reduce((s, p) => s + p.x, 0) / 4, y: pts.reduce((s, p) => s + p.y, 0) / 4, forme: 'coin' });
      }
    } else if (m.type === 'sixain') {
      const a = c(ns[0]);
      const b = c(ns[3]);
      zones.push({ cle: m.cle, x: (a.x + b.x) / 2 + ext.x * 0.5, y: (a.y + b.y) / 2 + ext.y * 0.5, forme: 'coin' });
    }
  }
  return zones;
}

/** Point du jeton d'une mise, en unités SVG. */
function pointMise(cle: string, sens: Sens, zones: Map<string, Zone>): { x: number; y: number } {
  const e = ECHELLE[sens];
  const m = MISES_ROULETTE.get(cle);
  let p = { x: 0, y: 0 };
  if (m?.type === 'plein') p = centre(caseNumero(m.numeros[0], sens));
  else {
    const r = caseExterieure(cle, sens);
    const z = zones.get(cle);
    if (r) p = centre(r);
    else if (z) p = z;
  }
  return { x: p.x * e.x, y: p.y * e.y };
}

function Tapis({
  v,
  sens,
  onMiser,
  survol,
  onSurvol,
}: {
  v: VueTableRoulette;
  sens: Sens;
  onMiser: (cle: string) => void;
  survol: string | null;
  onSurvol: (cle: string | null) => void;
}) {
  const e = ECHELLE[sens];
  const [lg, ht] = sens === 'h' ? [14, 5] : [5, 14];
  const zones = useMemo(() => zonesInterieures(sens), [sens]);
  const parCle = useMemo(() => new Map(zones.map((z) => [z.cle, z])), [zones]);
  const R = (r: Rect) => ({ x: r.x * e.x, y: r.y * e.y, width: r.w * e.x, height: r.h * e.y });
  const couverts = new Set(survol ? (MISES_ROULETTE.get(survol)?.numeros ?? []) : []);
  const sorti = v.phase !== 'mises' ? v.tirage : null;
  const resultat = v.phase === 'resultat' && sorti !== null;
  const taille = Math.min(e.x, e.y) * 0.62;
  // Jetons regroupés par case : un par joueur, légèrement décalés.
  const groupes = new Map<string, JetonPoseRoulette[]>();
  for (const j of v.jetons) groupes.set(j.cle, [...(groupes.get(j.cle) ?? []), j]);
  const places = new Map(v.places.map((p) => [p.id, p]));
  const attrs = (cle: string) => ({
    onClick: () => onMiser(cle),
    onPointerEnter: () => onSurvol(cle),
    onPointerLeave: () => onSurvol(null),
  });
  const fermes = v.closes || v.phase !== 'mises';
  return (
    <svg className={`rl-tapis rl-tapis-${sens} ${fermes ? 'ferme' : ''}`} viewBox={`-6 -6 ${lg * e.x + 12} ${ht * e.y + 12}`} role="group" aria-label={tr('Tapis de la roulette', 'Roulette layout')}>
      <defs>
        <clipPath id="rl-rond" clipPathUnits="objectBoundingBox">
          <circle cx="0.5" cy="0.5" r="0.5" />
        </clipPath>
      </defs>
      {/* Les numéros */}
      {Array.from({ length: 37 }, (_, n) => {
        const r = R(caseNumero(n, sens));
        const col = couleurNumero(n);
        const cl = `rl-case ${couverts.has(n) ? 'couverte' : ''} ${sorti === n && resultat ? 'sortie' : ''}`;
        return (
          <g key={n} className={cl} {...attrs(`plein-${n}`)}>
            <rect {...r} className="rl-fond-case" />
            {n === 0 ? (
              <text x={r.x + r.width / 2} y={r.y + r.height / 2} className="rl-num zero">
                0
              </text>
            ) : (
              <>
                <ellipse cx={r.x + r.width / 2} cy={r.y + r.height / 2} rx={Math.min(r.width, r.height) * 0.36} ry={Math.min(r.width, r.height) * 0.36} fill={COULEURS[col]} className="rl-pastille" />
                <text x={r.x + r.width / 2} y={r.y + r.height / 2} className="rl-num">
                  {n}
                </text>
              </>
            )}
          </g>
        );
      })}
      {/* Les mises extérieures */}
      {[...MISES_ROULETTE.values()]
        .filter((m) => m.type === 'douzaine' || m.type === 'colonne' || m.type === 'simple')
        .map((m) => {
          const r = R(caseExterieure(m.cle, sens)!);
          const cx = r.x + r.width / 2;
          const cy = r.y + r.height / 2;
          const gagne = resultat && m.numeros.includes(sorti!);
          let contenu;
          if (m.cle === 'rouge' || m.cle === 'noir') {
            const t = Math.min(r.width, r.height) * 0.34;
            contenu = <path d={`M${cx} ${cy - t} L${cx + t * 1.4} ${cy} L${cx} ${cy + t} L${cx - t * 1.4} ${cy} Z`} fill={COULEURS[m.cle]} className="rl-losange" />;
          } else {
            const texte = m.type === 'douzaine' ? tr(`${m.cle.slice(-1)}${m.cle.endsWith('1') ? 're' : 'e'} 12`, `${m.cle.slice(-1) === '1' ? '1st' : m.cle.slice(-1) === '2' ? '2nd' : '3rd'} 12`) : m.type === 'colonne' ? '2:1' : tr(...NOMS_SIMPLES[m.cle as MiseSimple]);
            const vertical = sens === 'v' && m.type !== 'colonne';
            contenu = (
              <text x={cx} y={cy} className="rl-ext" transform={vertical ? `rotate(-90 ${cx} ${cy})` : undefined}>
                {texte}
              </text>
            );
          }
          return (
            <g key={m.cle} className={`rl-case ext ${survol === m.cle ? 'couverte' : ''} ${gagne ? 'sortie' : ''}`} {...attrs(m.cle)}>
              <rect {...r} className="rl-fond-case" />
              {contenu}
            </g>
          );
        })}
      {/* Les bords et les coins : chevaux, transversales, carrés, sixains (invisibles, au-dessus des cases) */}
      {!fermes &&
        zones.map((z) => {
          const [w, h] = z.forme === 'coin' ? [30, 30] : z.forme === 'large' ? [Math.min(66, e.x * 0.66), 22] : [22, Math.min(66, e.y * 0.66)];
          return <rect key={z.cle} className="rl-zone" x={z.x * e.x - w / 2} y={z.y * e.y - h / 2} width={w} height={h} {...attrs(z.cle)} />;
        })}
      {/* Les jetons posés */}
      {[...groupes.entries()].map(([cle, liste]) => {
        const p = pointMise(cle, sens, parCle);
        const m = MISES_ROULETTE.get(cle);
        const etat = resultat ? (m?.numeros.includes(sorti!) || (sorti === 0 && m?.type === 'simple') ? 'gagne' : 'perd') : '';
        return liste.map((j, k) => {
          const pl = places.get(j.place);
          const x = p.x - taille / 2 + k * taille * 0.14;
          const y = p.y - taille / 2 - k * taille * 0.14;
          return (
            <g key={`${cle}-${j.place}`} className={`rl-jeton ${pl?.moi ? 'moi' : ''} ${etat}`} pointerEvents="none">
              <image href={`/cartes/jeton-${imageJeton(j.montant)}.webp`} x={x} y={y} width={taille} height={taille} />
              <text x={x + taille / 2} y={y + taille / 2} className="rl-jeton-texte" style={{ fontSize: taille * 0.3 }}>
                {court(j.montant)}
              </text>
              {!pl?.moi && pl && <image href={`/cartes/avatar-${pl.avatar}.webp`} x={x + taille * 0.62} y={y + taille * 0.58} width={taille * 0.46} height={taille * 0.46} clipPath="url(#rl-rond)" className="rl-jeton-avatar" />}
            </g>
          );
        });
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Le cylindre

const ANGLE = 360 / 37;
const DUREE_BILLE = 6200;

function arc(r1: number, r2: number, a1: number, a2: number) {
  const p = (r: number, a: number) => [r * Math.sin((a * Math.PI) / 180), -r * Math.cos((a * Math.PI) / 180)];
  const [x1, y1] = p(r2, a1);
  const [x2, y2] = p(r2, a2);
  const [x3, y3] = p(r1, a2);
  const [x4, y4] = p(r1, a1);
  return `M${x1} ${y1} A${r2} ${r2} 0 0 1 ${x2} ${y2} L${x3} ${y3} A${r1} ${r1} 0 0 0 ${x4} ${y4} Z`;
}

function Cylindre({ v }: { v: VueTableRoulette }) {
  const [roue, setRoue] = useState(0);
  const [bille, setBille] = useState<{ angle: number; anime: boolean; tour: number } | null>(null);
  const roueRef = useRef(0);
  const anime = useRef(-1);
  useEffect(() => {
    if (v.tirage === null || anime.current === v.numero) return;
    anime.current = v.numero;
    const i = CYLINDRE.indexOf(v.tirage);
    // Arrivé en plein tour (ou animations réduites) : la bille est déjà dans sa case.
    const lancer = v.phase === 'tirage' && (v.reste ?? 0) > 3000 && !mouvementReduit();
    const finRoue = roueRef.current + (lancer ? 720 + Math.random() * 360 : 0);
    const finBille = finRoue + i * ANGLE + (Math.random() - 0.5) * ANGLE * 0.3;
    roueRef.current = finRoue;
    if (!lancer) {
      setRoue(finRoue);
      setBille({ angle: finBille, anime: false, tour: v.numero });
      return;
    }
    jouerEffet('bille');
    // La bille part à l'opposé et fait 4 tours de plus avant de tomber.
    setBille({ angle: finBille + 360 * 4 + 180, anime: false, tour: v.numero });
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        setRoue(finRoue);
        setBille({ angle: finBille, anime: true, tour: v.numero });
      }),
    );
  }, [v.tirage, v.numero, v.phase, v.reste]);

  const transition = (ms: number, courbe: string) => ({ transition: `transform ${ms}ms ${courbe}` });
  return (
    <svg className="rl-cylindre" viewBox="-112 -112 224 224" aria-label={v.tirage !== null && v.phase === 'resultat' ? tr(`Le ${v.tirage} est sorti`, `${v.tirage} came out`) : tr('Le cylindre', 'The wheel')} role="img">
      <defs>
        <radialGradient id="rl-bois" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#6b3a1a" />
          <stop offset="100%" stopColor="#2a1208" />
        </radialGradient>
        <radialGradient id="rl-or" cx="50%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#fff2c6" />
          <stop offset="55%" stopColor="#d2a85a" />
          <stop offset="100%" stopColor="#7a5418" />
        </radialGradient>
        <radialGradient id="rl-bille" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="70%" stopColor="#e8e2d6" />
          <stop offset="100%" stopColor="#9b9488" />
        </radialGradient>
      </defs>
      <circle r="110" fill="url(#rl-bois)" stroke="#d2a85a" strokeWidth="2" />
      <circle r="100" fill="#1b120c" stroke="#8a6424" strokeWidth="1.2" />
      <g className="rl-roue" style={{ transform: `rotate(${roue}deg)`, ...transition(bille?.anime ? DUREE_BILLE : 0, 'cubic-bezier(0.15, 0.55, 0.25, 1)') }}>
        {CYLINDRE.map((n, i) => {
          const a = i * ANGLE;
          const col = COULEURS[couleurNumero(n)];
          return (
            <g key={n}>
              <path d={arc(72, 88, a - ANGLE / 2, a + ANGLE / 2)} fill={col} stroke="#d2a85a" strokeWidth="0.6" />
              <path d={arc(56, 72, a - ANGLE / 2, a + ANGLE / 2)} fill={col} opacity="0.72" stroke="#e7c27a" strokeWidth="0.8" />
              <text transform={`rotate(${a})`} y="-77.5" className="rl-cyl-num">
                {n}
              </text>
            </g>
          );
        })}
        <circle r="56" fill="url(#rl-bois)" stroke="#d2a85a" strokeWidth="1.4" />
        {[0, 90, 180, 270].map((a) => (
          <g key={a} transform={`rotate(${a})`}>
            <rect x="-2.2" y="-44" width="4.4" height="34" rx="2" fill="url(#rl-or)" />
            <circle cy="-46" r="4.2" fill="url(#rl-or)" />
          </g>
        ))}
        <circle r="13" fill="url(#rl-or)" stroke="#5a3d12" strokeWidth="1" />
        <circle r="5" fill="#fff2c6" />
      </g>
      {bille && (
        <g style={{ transform: `rotate(${bille.angle}deg)`, ...transition(bille.anime ? DUREE_BILLE : 0, 'cubic-bezier(0.1, 0.5, 0.2, 1)') }}>
          <g key={bille.tour} className={`rl-bille ${bille.anime ? 'tombe' : ''}`} style={{ animationDuration: `${DUREE_BILLE}ms` }}>
            <circle r="4.6" fill="url(#rl-bille)" stroke="#5a5048" strokeWidth="0.4" />
          </g>
        </g>
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// L'écran de la table

/** Barre du temps restant (mises). */
function Minuteur({ v }: { v: VueTableRoulette }) {
  const [part, setPart] = useState(1);
  const [secondes, setSecondes] = useState(0);
  useEffect(() => {
    if (v.reste === null || !v.duree || v.phase !== 'mises') return;
    const fin = Date.now() + v.reste;
    const duree = v.duree;
    let id = 0;
    const pas = () => {
      const r = Math.max(0, fin - Date.now());
      setPart(r / duree);
      setSecondes(Math.ceil(r / 1000));
      id = requestAnimationFrame(pas);
    };
    id = requestAnimationFrame(pas);
    return () => cancelAnimationFrame(id);
  }, [v.reste, v.duree, v.numero, v.phase]);
  if (v.phase !== 'mises' || v.reste === null || !v.duree) return null;
  return (
    <>
      <div className="bj-minuteur" aria-hidden="true">
        <span style={{ transform: `scaleX(${part})` }} className={v.closes || part < 0.2 ? 'presse' : ''} />
      </div>
      <span className="rl-secondes">{v.closes ? '' : `${secondes} s`}</span>
    </>
  );
}

function useSens(): Sens {
  const requete = '(min-aspect-ratio: 1/1)';
  const [large, setLarge] = useState(() => typeof window !== 'undefined' && window.matchMedia(requete).matches);
  useEffect(() => {
    const m = window.matchMedia(requete);
    const maj = () => setLarge(m.matches);
    m.addEventListener('change', maj);
    return () => m.removeEventListener('change', maj);
  }, []);
  return large ? 'h' : 'v';
}

const nomCouleur = (n: number) => (n === 0 ? tr('Zéro', 'Zero') : couleurNumero(n) === 'rouge' ? tr('Rouge', 'Red') : tr('Noir', 'Black'));

export function TableRoulette({ v, appel, onQuitter }: { v: VueTableRoulette; appel: Appel; onQuitter: () => void }) {
  const sens = useSens();
  const moi = v.places.find((p) => p.moi);
  const [jeton, setJeton] = useState(JETONS_ROULETTE[1]);
  const [survol, setSurvol] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [inviter, setInviter] = useState(false);
  const [fete, setFete] = useState<number | null>(null);
  const precedente = useRef<VueTableRoulette | null>(null);

  // Sons et fête : le résultat de mon tour.
  useEffect(() => {
    const p = precedente.current;
    precedente.current = v;
    if (!p || !moi) return;
    if (v.phase === 'resultat' && p.phase !== 'resultat' && moi.resultat !== null) {
      if (moi.resultat >= 1_000_000) {
        setFete(moi.resultat);
        jouerEffet('roulette_gros_lot');
      } else if (moi.resultat > 0) jouerEffet('roulette_gain');
      else if (moi.resultat < 0) jouerEffet('echec');
    }
    if (v.phase === 'mises' && p.phase !== 'mises') setErreur(null);
  }, [v, moi]);

  const envoyer = async (evt: string, data?: unknown) => {
    setErreur(null);
    const r = await appel(evt, data);
    if (!r.ok) setErreur(r.erreur ?? tr('Action impossible.', 'Action not allowed.'));
    return r.ok;
  };
  const miser = async (cle: string) => {
    if (v.closes || v.phase !== 'mises') return;
    if (jeton > v.solde) return setErreur(tr('Solde insuffisant pour ce jeton.', 'Not enough money for this chip.'));
    if (await envoyer('casino_rl_miser', { cle, montant: jeton })) jouerEffet('jeton');
  };
  const ouvertes = v.phase === 'mises' && !v.closes;
  const maMise = moi?.mise ?? 0;

  let statut: ReactNode;
  if (v.phase === 'mises') statut = v.closes ? <strong className="rl-annonce ferme">{tr('Rien ne va plus', 'No more bets')}</strong> : <strong className="rl-annonce">{tr('Faites vos jeux', 'Place your bets')}</strong>;
  else if (v.phase === 'tirage') statut = <strong className="rl-annonce">{tr('La bille tourne…', 'The ball is spinning…')}</strong>;
  else
    statut = (
      <span className="rl-sorti">
        <span className={`rl-numero ${couleurNumero(v.tirage ?? 0)}`}>{v.tirage}</span>
        <span>
          <strong>{nomCouleur(v.tirage ?? 0)}</strong>
          {v.tirage ? (
            <small>
              {v.tirage % 2 ? tr('Impair', 'Odd') : tr('Pair', 'Even')} · {v.tirage <= 18 ? tr('Manque', 'Low') : tr('Passe', 'High')}
            </small>
          ) : (
            <small>{tr('Les simples rendent la moitié', 'Even bets return half')}</small>
          )}
        </span>
      </span>
    );

  return (
    <div className={`cas-ecran rl-ecran rl-${sens}`}>
      <header className="cas-barre">
        <button type="button" className="cas-retour" onClick={onQuitter}>
          ‹ {tr('Salon', 'Lounge')}
        </button>
        <span className="bj-code">
          {tr('Roulette', 'Roulette')} · {v.code}
        </span>
        <span className="cas-solde-petit">{dollars(v.solde)}</span>
      </header>

      <div className="rl-plateau">
        <section className="rl-haut">
          <div className="rl-cylindre-zone">
            <Cylindre v={v} />
          </div>
          <div className="rl-infos">
            <div className="rl-statut" role="status">
              {statut}
              <Minuteur v={v} />
            </div>
            {moi && v.phase === 'resultat' && moi.resultat !== null && (
              <p className={`rl-bilan ${moi.resultat > 0 ? 'gagne' : moi.resultat < 0 ? 'perdu' : ''}`}>
                {moi.resultat > 0 ? tr(`Tu gagnes ${dollars(moi.resultat)} !`, `You win ${dollars(moi.resultat)}!`) : moi.resultat < 0 ? tr(`Tu perds ${dollars(-moi.resultat)}.`, `You lose ${dollars(-moi.resultat)}.`) : tr('Ni gagné, ni perdu.', 'Even.')}
              </p>
            )}
            <ol className="rl-historique" aria-label={tr('Derniers numéros', 'Last numbers')}>
              {v.historique.map((n, i) => (
                <li key={`${v.numero}-${i}`} className={couleurNumero(n)}>
                  {n}
                </li>
              ))}
            </ol>
            <ul className="rl-joueurs">
              {v.places.map((p) => (
                <li key={p.id} className={`${p.moi ? 'moi' : ''} ${p.absent ? 'absent' : ''}`}>
                  <img src={`/cartes/avatar-${p.avatar}.webp`} alt="" />
                  <span>
                    <strong>
                      {p.nom || tr('Joueur', 'Player')}
                      {p.bot && <small> {tr('Bot', 'Bot')}</small>}
                    </strong>
                    {p.resultat !== null ? <em className={p.resultat > 0 ? 'gagne' : p.resultat < 0 ? 'perdu' : ''}>{p.resultat > 0 ? `+${dollars(p.resultat)}` : p.resultat < 0 ? `−${dollars(-p.resultat)}` : '='}</em> : <em>{p.mise ? dollars(p.mise) : '—'}</em>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="rl-tapis-zone">
          <Tapis v={v} sens={sens} onMiser={(c) => void miser(c)} survol={survol} onSurvol={setSurvol} />
        </section>

        <section className="rl-commandes" role="group" aria-label={tr('Tes mises', 'Your bets')}>
          <div className="bj-jetons">
            {JETONS_ROULETTE.map((j) => (
              <button key={j} type="button" className={`bj-jeton ${j === jeton ? 'choisi' : ''}`} onClick={() => (setJeton(j), jouerEffet('jeton'))} disabled={j > v.solde && j !== jeton} aria-pressed={j === jeton} aria-label={dollars(j)}>
                <img src={`/cartes/jeton-${imageJeton(j)}.webp`} alt="" />
                <span>{court(j)}</span>
              </button>
            ))}
          </div>
          <p className="bj-mise-encours">
            {tr('Ta mise', 'Your bet')} <strong>{dollars(maMise)}</strong>
            {survol && ouvertes && <small className="rl-aide">{descriptionMise(survol)}</small>}
          </p>
          <div className="bj-boutons">
            <button type="button" onClick={() => void envoyer('casino_rl_annuler')} disabled={!ouvertes || !maMise}>
              {tr('Annuler', 'Undo')}
            </button>
            <button type="button" onClick={() => void envoyer('casino_rl_annuler', { tout: true })} disabled={!ouvertes || !maMise}>
              {tr('Effacer', 'Clear')}
            </button>
            <button type="button" onClick={() => void envoyer('casino_rl_doubler').then((ok) => ok && jouerEffet('jeton'))} disabled={!ouvertes || !maMise}>
              {tr('Doubler', 'Double')}
            </button>
            <button type="button" className="bj-principal" onClick={() => void envoyer('casino_rl_refaire').then((ok) => ok && jouerEffet('jeton'))} disabled={!ouvertes || !!maMise || !v.peutRefaire}>
              {tr('Refaire', 'Rebet')}
            </button>
          </div>
          {erreur && <p className="cas-erreur">{erreur}</p>}
        </section>

        <section className="rl-bas">
          <div className="bj-hote">
            <button type="button" className="rl-inviter" onClick={() => setInviter(true)}>
              {tr('Inviter un ami', 'Invite a friend')}
            </button>
            {v.hote && (
              <>
                <span>{tr('Bots', 'Bots')}</span>
                <button type="button" onClick={() => void envoyer('casino_rl_bot', { ajouter: false })} disabled={!v.places.some((p) => p.bot)} aria-label={tr('Retirer un bot', 'Remove a bot')}>
                  −
                </button>
                <button type="button" onClick={() => void envoyer('casino_rl_bot', { ajouter: true })} disabled={v.places.length >= 5} aria-label={tr('Ajouter un bot', 'Add a bot')}>
                  +
                </button>
              </>
            )}
          </div>
          <form
            className="bj-chat"
            onSubmit={(e) => {
              e.preventDefault();
              if (!message.trim()) return;
              void envoyer('casino_rl_chat', { texte: message });
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
              <input value={message} onChange={(e) => setMessage(e.target.value)} maxLength={120} placeholder={tr('Message à la table…', 'Message to the table…')} aria-label={tr('Message', 'Message')} />
              <button type="submit" disabled={!message.trim()}>
                {tr('Envoyer', 'Send')}
              </button>
            </div>
          </form>
          <p className="cas-mention">{tr('Plein 35 pour 1 · Cheval 17 · Transversale 11 · Carré 8 · Sixain 5 · Douzaine et colonne 2 · Simples 1 (la moitié rendue sur le zéro)', 'Straight 35 to 1 · Split 17 · Street 11 · Corner 8 · Six line 5 · Dozen and column 2 · Even bets 1 (half back on zero)')}</p>
        </section>
      </div>

      {inviter && <FenetreInviter appel={appel} onFermer={() => setInviter(false)} />}
      {fete !== null && (
        <Celebration
          titre={tr('Gros gain !', 'Big win!')}
          etiquette={tr(`Gain : ${dollars(fete)}`, `Win: ${dollars(fete)}`)}
          medaillon={<strong className="celebration-xp cas-medaillon-gain">{dollars(fete)}</strong>}
          legende={tr(`Le ${v.tirage} est sorti`, `${v.tirage} came out`)}
          onFermer={() => setFete(null)}
        />
      )}
    </div>
  );
}

/** Ce que couvre une mise (aide affichée au survol du tapis). */
function descriptionMise(cle: string): string {
  const m = MISES_ROULETTE.get(cle);
  if (!m) return '';
  const noms: Record<string, [string, string]> = {
    plein: ['Plein', 'Straight'],
    cheval: ['Cheval', 'Split'],
    transversale: ['Transversale', 'Street'],
    carre: ['Carré', 'Corner'],
    sixain: ['Sixain', 'Six line'],
    douzaine: ['Douzaine', 'Dozen'],
    colonne: ['Colonne', 'Column'],
    simple: ['Chance simple', 'Even bet'],
  };
  const numeros = m.numeros.length <= 6 ? ` ${m.numeros.join('-')}` : '';
  return `${tr(...noms[m.type])}${numeros} · ${m.paiement} ${tr('pour', 'to')} 1`;
}
