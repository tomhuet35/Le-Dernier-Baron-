/**
 * La Fontaine de champagne (la roue du Bal) : un plinko de coupes, au bar du Grand Hôtel. Une pyramide de huit étages
 * sur une table nappée. L'intro « Le Sabrage de minuit » (9 s) : le toast sur la roue, les portes du bar qui s'ouvrent, la
 * pyramide sous le projecteur, l'entrée du maître d'hôtel, le sabrage au ralenti ; puis le bar s'illumine.
 * Le versement : il verse au sommet ; chaque coupe pleine déborde à gauche ou à droite, de coupe en coupe, jusqu'à l'une
 * des huit du bas, qui porte son multiplicateur. Personne ne choisit : tout le monde gagne le même, et l'on trinque.
 * Deux coupes du bas sont des coupes « Double » : si le champagne y finit, tous les multiplicateurs doublent, la
 * pyramide se vide et le maître reverse.
 *
 * Le serveur a tiré le chemin du champagne dès le début du bonus ; il ne l'envoie qu'au versement.
 * Tout est placé d'après la taille de la scène (la pyramide, la table, le maître) et l'horloge de l'étape.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { COUPES_FONTAINE, DUREES_BW, ETAGES_FONTAINE, coupeFinaleFontaine, estDoubleFontaine, gainFontaine, multiFontaine, type VueBonusBW, type VueBW } from '../../shared/baronWheel';
import { ValeurMultipliee } from './CasinoBaronExpress';
import { tr } from './traduction';
import { jouerEffet, type EffetSonore } from './ui';
import './fontaine.css';

const IMG = (n: string) => `/cartes/bw-fc-${n}.webp`;

/** Toutes les images de la Fontaine (sans chemin ni extension), préchargées avant le bonus. */
export const IMAGES_FONTAINE_NOMS = [
  ...['bar-paysage', 'bar-portrait', 'table', 'coupe-vide', 'coupe-pleine', 'maitre', 'eclaboussure'].map((n) => `bw-fc-${n}`),
  ...['portes', 'portes-ouvertes', 'pyramide', 'entree', 'lame', 'pop'].map((n) => `bw-fci-${n}`),
];

/** Les images : leurs proportions, et les points qui comptent (en part de l'image). */
const COUPE = { r: 302 / 240, coupe: 0.42 };
const TABLE = { r: 573 / 1200, plateau: 0.2 };
const MAITRE = { r: 1100 / 520, goulot: [0.981, 0.165] as const };

// ---------------------------------------------------------------------------------------------------------------
// Le calendrier (millisecondes d'une intro de 8 s, d'un versement de 9,5 s)

/** L'intro (9 s) : les plans de cinéma par-dessus la scène, puis le bar s'illumine (les pourcentages de fontaine.css
 * sont des centièmes de 9 s). */
const INTRO = { pop: 6_350, lumiere: 6_900 };
const SONS_INTRO: [number, EffetSonore, number][] = [
  [0, 'fci_toast', 1],
  [1_100, 'fci_portes', 1],
  [2_300, 'fc_ting', 0.6],
  [2_900, 'fc_ting', 0.5],
  [3_800, 'fci_bravo', 0.7],
  [5_300, 'gd_retourne', 0.5],
  [6_350, 'fc_pop', 1],
  [6_700, 'fci_bravo', 1],
];

/** Les plans de l'intro, par-dessus la scène : la roue, les portes qui s'ouvrent, la pyramide, l'entrée, la lame. */
function IntroSabrage({ t0, roue }: { t0: number; roue?: ReactNode }) {
  useEffect(() => {
    const ids = SONS_INTRO.filter(([x]) => x >= t0).map(([x, son, volume]) => window.setTimeout(() => jouerEffet(son, { volume }), x - t0));
    return () => ids.forEach((i) => window.clearTimeout(i));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const img = (n: string) => `url(/cartes/bw-fci-${n}.webp)`;
  return (
    <div className="fci" aria-hidden="true" style={{ '--t0': `${-t0}ms` } as CSSProperties}>
      <div className="fci-plan fci-la-roue">{roue}</div>
      <div className="fci-plan portes">
        <i className="fci-photo ouvertes" style={{ backgroundImage: img('portes-ouvertes') }} />
        <i className="fci-photo fermees" style={{ backgroundImage: img('portes') }} />
        <i className="fci-fente" />
      </div>
      <div className="fci-plan pyramide">
        <i className="fci-photo" style={{ backgroundImage: img('pyramide') }} />
      </div>
      <div className="fci-plan entree">
        <i className="fci-photo" style={{ backgroundImage: img('entree') }} />
      </div>
      <div className="fci-plan lame">
        <i className="fci-photo" style={{ backgroundImage: img('lame') }} />
        <i className="fci-photo pop" style={{ backgroundImage: img('pop') }} />
      </div>
      <i className="fci-flash" />
    </div>
  );
}
/** Le versement : le filet du magnum, la coupe du sommet, puis une coupe par étage ; la dernière, plus lente. */
const VERSE = { filet: 200, sommet: 500, etages: [1_350, 2_200, 3_000, 3_800, 4_600, 5_500, 6_500], remplir: 700, dernier: 1_000 };
const FIN_VERSE = VERSE.etages[6] + VERSE.dernier;
/** Un versement dure DUREES_BW.versement ; après une coupe Double : l'annonce, les multiplicateurs qui doublent, puis
 * la pyramide qui se vide avant le versement suivant. */
const DOUBLE = { annonce: FIN_VERSE + 150, double: FIN_VERSE + 700, vide: FIN_VERSE + 1_300, fin: FIN_VERSE + 1_850 };

const borne = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u);
const lisse = (u: number) => {
  const x = borne(u);
  return x * x * (3 - 2 * x);
};

// ---------------------------------------------------------------------------------------------------------------
// La géométrie

function mesurer(W: number, H: number) {
  const portrait = H > W * 1.05;
  // La table : le bas de sa nappe sort de l'écran, son plateau reste bien visible.
  const tw = portrait ? W * 1.02 : Math.min(W * 0.56, H * 0.95);
  const th = tw * TABLE.r;
  const sol = H + th * (portrait ? 0.25 : 0.35);
  const plateau = sol - th + th * TABLE.plateau;
  const haut = H * (portrait ? 0.2 : 0.17);
  const pas = 0.85;
  // La coupe : assez petite pour que la pyramide tienne entre le haut et le plateau, et en largeur.
  const cw = Math.min((plateau - haut) / ((ETAGES_FONTAINE - 1) * pas * COUPE.r + COUPE.r), (W * 0.94) / (ETAGES_FONTAINE * 0.98));
  const ch = cw * COUPE.r;
  const pied = (r: number) => plateau - (ETAGES_FONTAINE - 1 - r) * ch * pas;
  const x = (r: number, i: number) => W / 2 + (i - r / 2) * cw * 0.98;
  return { W, H, portrait, sol, tw, th, plateau, cw, ch, pied, x };
}
type Geo = ReturnType<typeof mesurer>;

/** Le centre de la coupe d'une coupe (là où tombe le champagne), et son bord (là où il déborde). */
const coupeA = (g: Geo, r: number, i: number) => ({ x: g.x(r, i), y: g.pied(r) - g.ch * (1 - COUPE.coupe * 0.55) });
const bordA = (g: Geo, r: number, i: number, cote: number) => ({ x: g.x(r, i) + (cote ? 1 : -1) * g.cw * 0.47, y: g.pied(r) - g.ch * 0.97 });
/** Le goulot du magnum, à gauche de la coupe du sommet et un peu au-dessus. */
const goulotA = (g: Geo) => ({ x: g.x(0, 0) - g.cw * 1.3, y: g.pied(0) - g.ch * 1.4 });

// ---------------------------------------------------------------------------------------------------------------
// Le bonus

export function BonusFontaine({ v, b, nom, roue }: { v: VueBW; b: VueBonusBW; nom: string; roue?: ReactNode }) {
  const M = Math.max(1, b.multiplicateur);
  const versements = b.fontaine?.versements ?? null;
  const nbV = versements?.length ?? 1;

  // L'horloge de l'étape (recalée sur le serveur) ; au résultat, tout est déjà versé.
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
    const id = window.setInterval(() => setMaintenant(performance.now()), 40);
    return () => window.clearInterval(id);
  }, []);
  const ref = nom === 'intro' ? DUREES_BW.introFontaine : nom === 'versement' ? DUREES_BW.versement * nbV : 0;
  const echelle = v.phase === 'bonus' && v.duree && ref ? ref / v.duree : 1;
  const s = (maintenant - horloge.current.debut) * echelle;

  // Le point de départ de l'intro (fixé une fois : on peut arriver en cours de route).
  const t0IntroRef = useRef({ cle: '', t0: 0 });
  if (t0IntroRef.current.cle !== cle) t0IntroRef.current = { cle, t0: nom === 'intro' ? Math.max(0, (v.duree ?? 0) - (v.reste ?? 0)) * echelle : 0 };

  // La taille de la scène.
  const scene = useRef<HTMLDivElement>(null);
  const [taille, setTaille] = useState({ W: 0, H: 0 });
  useEffect(() => {
    const el = scene.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setTaille({ W: el.clientWidth, H: el.clientHeight }));
    ro.observe(el);
    setTaille({ W: el.clientWidth, H: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Les sons, une fois chacun.
  const joues = useRef(new Set<string>());
  const fois = (c: string, debut: number, f: () => void) => {
    const k = `${cle}:${c}`;
    if (joues.current.has(k) || s < debut || s > debut + 800) return;
    joues.current.add(k);
    f();
  };

  const { W, H } = taille;
  if (!W || !H) return <div className="fc" ref={scene} />;
  const g = mesurer(W, H);
  const intro = nom === 'intro';
  const verse = nom === 'versement' || nom === 'revele';
  const svTotal = nom === 'revele' ? 1e9 : nom === 'versement' ? s : -1;
  // Le versement en cours (n), et le temps depuis son début.
  const n = verse && versements ? Math.min(nbV - 1, Math.max(0, Math.floor(svTotal / DUREES_BW.versement))) : 0;
  const sv = verse ? (nom === 'revele' ? 60_000 : svTotal - n * DUREES_BW.versement) : -1;
  const chemin = versements ? versements[n] : null;

  // Le chemin : la coupe remplie à chaque étage, et quand elle commence à se remplir.
  const indices = chemin ? chemin.reduce<number[]>((a, d) => [...a, a[a.length - 1] + d], [0]) : null;
  const debutEtage = (r: number) => (r === 0 ? VERSE.sommet : VERSE.etages[r - 1]);
  const dureeEtage = (r: number) => (r === ETAGES_FONTAINE - 1 ? VERSE.dernier : VERSE.remplir);
  const plein = (r: number) => (indices && verse ? borne((sv - debutEtage(r)) / dureeEtage(r)) : 0);
  const finale = chemin ? coupeFinaleFontaine(chemin) : null;
  const relance = finale !== null && estDoubleFontaine(finale) && n < nbV - 1;
  const arrive = verse && sv >= FIN_VERSE && !relance;
  // Après une coupe Double : les multiplicateurs passent au versement suivant, la pyramide se vide.
  const nAffiche = relance && sv >= DOUBLE.double ? n + 1 : n;
  const vidange = relance ? borne((sv - DOUBLE.vide) / 500) : 0;

  // Les sons.
  if (nom === 'versement' && indices) {
    const at = (c: string, t0: number, f: () => void) => fois(`${n}:${c}`, n * DUREES_BW.versement + t0, f);
    at('verse', VERSE.filet, () => jouerEffet('fc_verse'));
    at('verse2', VERSE.filet + 1_500, () => jouerEffet('fc_verse', { volume: 0.4 }));
    for (let r = 0; r < ETAGES_FONTAINE; r++) at(`t${r}`, debutEtage(r) + dureeEtage(r) - 120, () => jouerEffet('fc_ting', { vitesse: 0.85 + r * 0.06, volume: r === ETAGES_FONTAINE - 1 ? 0.9 : 0.55 }));
    if (relance) {
      at('double', DOUBLE.annonce, () => jouerEffet('gd_eclat'));
      at('doublent', DOUBLE.double, () => jouerEffet('fc_pop', { vitesse: 1.3, volume: 0.6 }));
    } else at('fin', FIN_VERSE + 100, () => jouerEffet('fc_trinque'));
  }

  // L'intro : sous les plans, le bar s'illumine en cascade quand la lumière revient.
  const lumiere = intro ? lisse((s - INTRO.lumiere) / 1_100) : 1;
  const mVerse = 1;
  const t0Intro = t0IntroRef.current.t0;

  // Le maître qui verse, sur son grand escabeau posé au sol : son goulot au-dessus de la coupe du sommet.
  const gl = goulotA(g);
  const hm = (H * (g.portrait ? 0.985 : 0.975) - gl.y) / (1 - MAITRE.goulot[1]);
  const wm = hm / MAITRE.r;
  const maitreStyle: CSSProperties = { width: wm, left: gl.x - MAITRE.goulot[0] * wm, top: gl.y - MAITRE.goulot[1] * hm, opacity: mVerse };

  // Les filets de champagne : du magnum au sommet, puis de coupe en coupe.
  const filets: { d: string; p: number; k: string }[] = [];
  if (indices && verse && vidange === 0) {
    const c0 = coupeA(g, 0, 0);
    filets.push({ k: 'm', p: borne((sv - VERSE.filet) / 300), d: `M${gl.x} ${gl.y} Q${gl.x + g.cw * 1.1} ${gl.y - g.ch * 0.25} ${c0.x} ${c0.y}` });
    for (let r = 1; r < ETAGES_FONTAINE; r++) {
      const cote = chemin![r - 1];
      const a = bordA(g, r - 1, indices[r - 1], cote);
      const z = coupeA(g, r, indices[r]);
      const p = borne((sv - (debutEtage(r) - 220)) / 220);
      if (p > 0) filets.push({ k: `e${r}`, p, d: `M${a.x} ${a.y} Q${a.x + (cote ? 1 : -1) * g.cw * 0.25} ${a.y - g.ch * 0.05} ${z.x + (cote ? -1 : 1) * g.cw * 0.12} ${z.y}` });
    }
  }

  const bas = ETAGES_FONTAINE - 1;

  return (
    <div className={`fc fc-e-${nom} ${g.portrait ? 'portrait' : ''} ${arrive ? 'arrive' : ''}`} ref={scene}>
      <div className="fc-bar" style={{ backgroundImage: `url(${IMG(g.portrait ? 'bar-portrait' : 'bar-paysage')})`, filter: `brightness(${0.25 + 0.55 * lumiere})` }} />
      <i className="fc-lumiere" style={{ opacity: lumiere }} />

      {/* Le maître qui verse, derrière la pyramide. */}
      {mVerse > 0 && <img className="fc-maitre" src={IMG('maitre')} alt="" draggable={false} style={maitreStyle} />}

      <img className="fc-table" src={IMG('table')} alt="" draggable={false} style={{ width: g.tw, left: (W - g.tw) / 2, top: g.sol - g.th }} />

      {/* La pyramide : chaque coupe vide, et par-dessus la même pleine, découverte du fond vers le bord. */}
      {Array.from({ length: ETAGES_FONTAINE }, (_, r) =>
        Array.from({ length: r + 1 }, (_, i) => {
          const f = indices && indices[r] === i ? plein(r) : 0;
          const derniere = r === bas && f >= 1 && (arrive || (relance && sv < DOUBLE.vide));
          return (
            <span key={`${r}-${i}`} className={`fc-coupe ${f > 0 ? 'remplie' : ''} ${derniere ? 'gagnante' : ''}`} style={{ width: g.cw, left: g.x(r, i) - g.cw / 2, top: g.pied(r) - g.ch, zIndex: 10 + r }}>
              <img src={IMG('coupe-vide')} alt="" draggable={false} />
              {f > 0 && <img className="pleine" src={IMG('coupe-pleine')} alt="" draggable={false} style={{ opacity: 1 - vidange, clipPath: `inset(${(2 + (1 - f) * (COUPE.coupe - 0.02) * 100).toFixed(1)}% 0 0 0)` }} />}
              {f >= 1 && r < bas && vidange === 0 && <img className="fc-deborde" src={IMG('eclaboussure')} alt="" draggable={false} style={{ transform: chemin![r] ? undefined : 'scaleX(-1)' }} />}
            </span>
          );
        }),
      )}

      {/* Les filets de champagne. */}
      {filets.length > 0 && (
        <svg className="fc-filets" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
          <defs>
            <linearGradient id="fc-or" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#fff3c4" />
              <stop offset="0.5" stopColor="#f2c55a" />
              <stop offset="1" stopColor="#d99a2b" />
            </linearGradient>
          </defs>
          {filets.map((f) => (
            <g key={f.k}>
              <path d={f.d} pathLength={1} className="fc-filet" style={{ strokeWidth: Math.max(2, g.cw * (f.k === 'm' ? 0.11 : 0.07)), strokeDasharray: `${f.p} 1` }} />
              <path d={f.d} pathLength={1} className="fc-bulles" style={{ strokeWidth: Math.max(1, g.cw * 0.03), opacity: f.p }} />
            </g>
          ))}
        </svg>
      )}

      {/* Le multiplicateur de chacune des huit coupes du bas, sur le bord de la nappe. */}
      {COUPES_FONTAINE.map((_, i) => {
        const x = multiFontaine(i, nAffiche);
        const touchee = finale === i && (arrive || (relance && sv >= FIN_VERSE && sv < DOUBLE.vide));
        return (
          <span
            key={`${i}-${nAffiche}`}
            className={`fc-multi ${x === 'double' ? 'double' : x >= 100 ? 'gros' : ''} ${nAffiche > 0 && x !== 'double' ? 'doublee' : ''} ${touchee ? 'gagne' : ''}`}
            style={{ left: g.x(bas, i), top: g.plateau + g.ch * 0.08, '--fd': `${Math.min(15, g.cw * 0.25).toFixed(1)}px` } as CSSProperties}
          >
            {x === 'double' ? tr('Double', 'Double') : `×${x}`}
          </span>
        );
      })}
      {/* Les doubles déjà gagnés : un médaillon ×2, ×4… au-dessus de la pyramide. */}
      {verse && nAffiche > 0 && (
        <div className="fc-cumul" key={`c${nAffiche}`} style={{ top: g.pied(0) - g.ch * 2.1 }}>
          ×{2 ** nAffiche}
        </div>
      )}
      {relance && sv >= DOUBLE.annonce && sv < DOUBLE.vide + 300 && (
        <div className="fc-annonce-double" role="status">
          <strong>{tr('Double !', 'Double!')}</strong>
          <small>{tr('Tous les multiplicateurs doublent, on reverse !', 'All multipliers double, pour again!')}</small>
        </div>
      )}

      {/* L'intro : les plans de cinéma, par-dessus la scène. */}
      {intro && <IntroSabrage key={cle} t0={t0Intro} roue={roue} />}


      {/* Le résultat : la coupe où finit le champagne, le même gain pour tous. */}
      {arrive && versements && (
        <div className="fc-resultat" role="status">
          <small>{tr('À votre santé !', 'Cheers!')}</small>
          <strong>
            <ValeurMultipliee x={gainFontaine(versements)} m={M} son />
          </strong>
        </div>
      )}
    </div>
  );
}
