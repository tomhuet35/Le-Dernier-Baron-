/**
 * Le Choix du Baron (The Baron's Wheel) : la Grande Donne. Dans son salon privé, le Baron mélange en virtuose, puis
 * distribue neuf cartes face cachée sur la table de feutre vert ; chaque joueur en choisit une. Au retournement, les
 * autres cartes se retournent en vague, puis la mienne vient au centre et se révèle ; la carte du Baron cache un jackpot.
 *
 * Le serveur a tiré les neuf cartes dès le début du bonus ; il ne les envoie qu'au retournement (les choix sont faits).
 * Les étapes : l'intro (l'affiche et ce que peuvent cacher les cartes), la donne (le mélange, puis la distribution),
 * le choix, le retournement (DONNE_BW). Le décor (table, Baron, cartes) est placé d'après la taille de la scène ; les
 * gestes suivent l'horloge de l'étape (10 fois par seconde), chaque carte passant d'un état au suivant par transition.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { CARTES_BARON, DONNE_BW, NB_CARTES_BARON, VALEUR_JACKPOT_BW, type RecompenseBW, type VueBonusBW, type VueBW } from '../../shared/baronWheel';
import { fx, ValeurMultipliee } from './CasinoBaronExpress';
import { PluieLingots } from './casinoOutils';
import { tr } from './traduction';
import { jouerEffet } from './ui';
import './donne.css';

const IMG = (n: string) => `/cartes/bw-gd-${n}.webp`;

/** Toutes les images de la Grande Donne (sans chemin ni extension), préchargées avant le bonus. */
export const IMAGES_DONNE_NOMS = ['affiche', 'salon-paysage', 'salon-portrait', 'baron-melange', 'baron-donne', 'baron-presente', 'carte-dos', 'carte-face', 'carte-baron', 'eclat', 'paillettes'].map((n) => `bw-gd-${n}`);

const NOMS_JACKPOTS: Record<string, string> = { mini: 'MINI', minor: 'MINOR', major: 'MAJOR', grand: 'GRAND' };

/**
 * Les deux salons : la taille de l'image, la ligne du bord de la table (au fond) et le bas du feutre (parts de la
 * hauteur). La scène les couvre, posés en bas.
 */
const SALONS = {
  paysage: { img: 'salon-paysage', w: 1600, h: 900, bord: 0.59, feutre: 0.85 },
  portrait: { img: 'salon-portrait', w: 1000, h: 1250, bord: 0.535, feutre: 0.86 },
};
/** Les poses du Baron (820 px de large) : leur hauteur, la taille (où la table le coupe) et la main qui donne (parts). */
const POSES = {
  melange: { img: 'baron-melange', ratio: 823 / 820 },
  donne: { img: 'baron-donne', ratio: 863 / 820, main: [0.78, 0.77] as [number, number] },
  presente: { img: 'baron-presente', ratio: 819 / 820 },
};
const TAILLE_BARON = 0.86;
/** Une carte : 2:3. */
const RATIO_CARTE = 1.5;

interface Place {
  x: number;
  y: number;
  rot: number;
}
interface Disposition {
  W: number;
  H: number;
  portrait: boolean;
  salon: (typeof SALONS)['paysage'];
  /** Le bord de la table, à l'écran. */
  bord: number;
  baron: { x: number; y: number; w: number };
  /** La largeur d'une carte et la place de chacune. */
  cw: number;
  places: Place[];
  /** La place de ma carte révélée : au centre, agrandie. */
  centre: { x: number; y: number; echelle: number };
}

/** Dispose le salon, le Baron et les neuf cartes dans une scène W × H (en éventail, sur une ou plusieurs rangées). */
function disposer(W: number, H: number): Disposition {
  const portrait = H > W * 1.05;
  const salon = portrait ? SALONS.portrait : SALONS.paysage;
  const e = Math.max(W / salon.w, H / salon.h);
  const dh = salon.h * e;
  const oy = H - dh;
  const bord = oy + salon.bord * dh;
  const feutre = oy + salon.feutre * dh;
  // Le titre du bonus (plus bas sur téléphone).
  const haut = W <= 640 ? 90 : 52;
  // Le Baron : sa taille passe juste sous le bord de la table, sa tête sous le titre.
  const bh = (bord + H * 0.04 - haut) / TAILLE_BARON;
  const baron = { x: W / 2, y: haut, w: Math.min(bh / POSES.donne.ratio, W * 0.95) };
  // Les cartes : sur la table (et un peu devant le Baron), au-dessus de la consigne.
  const zHaut = bord - H * (portrait ? 0.13 : 0.08);
  const zBas = Math.min(feutre, H - (portrait ? 80 : 78));
  const zH = zBas - zHaut;
  const gap = Math.max(5, W * 0.008);
  let best = { rangees: 1, cw: 0 };
  for (const rangees of [1, 2, 3]) {
    const n = Math.ceil(NB_CARTES_BARON / rangees);
    const cw = Math.min((W * 0.94 - (n - 1) * gap) / n, (zH - (rangees - 1) * gap * 1.5) / rangees / RATIO_CARTE);
    if (cw > best.cw * 1.04) best = { rangees, cw };
  }
  const { rangees, cw } = best;
  const ch = cw * RATIO_CARTE;
  const places: Place[] = [];
  const parRangee = Math.ceil(NB_CARTES_BARON / rangees);
  const yTop = zHaut + (zH - (rangees * ch + (rangees - 1) * gap * 1.5)) / 2;
  for (let r = 0, k = 0; r < rangees; r++) {
    const n = Math.min(parRangee, NB_CARTES_BARON - k);
    const larg = n * cw + (n - 1) * gap;
    for (let i = 0; i < n; i++, k++) {
      const c = i - (n - 1) / 2;
      // L'éventail : les cartes des bords tournent et descendent un peu.
      places.push({ x: W / 2 - larg / 2 + i * (cw + gap) + cw / 2, y: yTop + r * (ch + gap * 1.5) + ch / 2 + c * c * ch * 0.012, rot: c * (rangees > 1 ? 2 : 2.6) });
    }
  }
  const hc = Math.min(H * 0.44, W * 0.42 * RATIO_CARTE);
  return { W, H, portrait, salon, bord, baron, cw, places, centre: { x: W / 2, y: Math.max(haut + hc / 2 + 50, H * 0.44), echelle: hc / ch } };
}

// ---------------------------------------------------------------------------------------------------------------
// Les morceaux

/** La face d'une carte : son multiple, ou la carte du Baron (un jackpot). */
function Face({ r, m, son, vue }: { r: RecompenseBW | null; m: number; son: boolean; vue: boolean }) {
  if (!r) return <span className="gd-face" />;
  if (r.jackpot)
    return (
      <span className="gd-face baron">
        <img src={IMG('carte-baron')} alt="" draggable={false} />
        <b>
          <small>JACKPOT</small>
          <strong>{NOMS_JACKPOTS[r.jackpot]}</strong>
        </b>
      </span>
    );
  return (
    <span className="gd-face">
      <img src={IMG('carte-face')} alt="" draggable={false} />
      <b style={{ '--n': fx(r.x * m).length } as CSSProperties}>{vue ? <ValeurMultipliee x={r.x} m={m} son={son} rapide={!son} /> : fx(r.x)}</b>
    </span>
  );
}

/** Les cartes qui volent d'une main à l'autre pendant le mélange. */
function Melange({ d }: { d: Disposition }) {
  const { x, y, w } = d.baron;
  const h = w * POSES.melange.ratio;
  // L'arc du mélange dans l'image du Baron : de la main levée (gauche) à la main basse (droite).
  const pt = (u: number, v: number) => [x - w / 2 + u * w, y + v * h];
  const [a, b, c] = [pt(0.16, 0.27), pt(0.42, 0.42), pt(0.74, 0.73)];
  return (
    <span className="gd-melange" aria-hidden="true">
      {Array.from({ length: 8 }, (_, i) => (
        <img
          key={i}
          src={IMG('carte-dos')}
          alt=""
          draggable={false}
          style={{ width: w * 0.09, '--i': i, '--ax': `${a[0]}px`, '--ay': `${a[1]}px`, '--bx': `${b[0]}px`, '--by': `${b[1] - h * 0.08}px`, '--cx': `${c[0]}px`, '--cy': `${c[1]}px` } as CSSProperties}
        />
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Le bonus

export function BonusDonne({ v, b, nom, ouvert, choisir }: { v: VueBW; b: VueBonusBW; nom: string; ouvert: boolean; choisir: (o: number) => void }) {
  const M = Math.max(1, b.multiplicateur);
  const choix = b.mesChoix[0];
  const salonChoix = b.choixSalon[0] ?? [];
  // La carte que l'écran suit : la mienne, sinon la plus choisie du salon.
  const max = Math.max(0, ...salonChoix);
  const suivie = choix ?? (max > 0 ? salonChoix.indexOf(max) : Math.floor(NB_CARTES_BARON / 2));
  const cartes = b.cartes ?? [];

  // La taille de la scène.
  const scene = useRef<HTMLDivElement>(null);
  const [taille, setTaille] = useState({ W: 0, H: 0 });
  useLayoutEffect(() => {
    const el = scene.current;
    if (!el) return;
    const mesurer = () => setTaille((t) => (t.W === el.clientWidth && t.H === el.clientHeight ? t : { W: el.clientWidth, H: el.clientHeight }));
    mesurer();
    const ro = new ResizeObserver(mesurer);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const d = taille.W ? disposer(taille.W, taille.H) : null;

  // L'horloge de l'étape (recalée sur le serveur), qui continue pendant le résultat ; un battement de 10 par seconde.
  const cle = `${v.numero}-${b.etape}`;
  const horloge = useRef({ cle: '', debut: 0 });
  const maintenantRef = performance.now();
  if (v.phase === 'resultat') {
    if (horloge.current.cle !== cle) horloge.current = { cle, debut: maintenantRef - 60_000 };
  } else {
    const estime = maintenantRef - ((v.duree ?? 0) - (v.reste ?? 0));
    if (horloge.current.cle !== cle) horloge.current = { cle, debut: estime };
    else horloge.current.debut = Math.min(horloge.current.debut, estime);
  }
  const [maintenant, setMaintenant] = useState(() => performance.now());
  useEffect(() => {
    const id = window.setInterval(() => setMaintenant(performance.now()), 100);
    return () => window.clearInterval(id);
  }, []);
  const s = Math.max(0, maintenant - horloge.current.debut);

  // Le calendrier : la donne (le mélange, puis une carte toutes les 290 ms), le retournement (la vague, puis la mienne).
  const enDonne = nom === 'donne';
  const envolee = (k: number) => nom === 'cartes' || nom === 'revele' || (enDonne && s >= DONNE_BW.melange + k * DONNE_BW.carte);
  const autres = Array.from({ length: NB_CARTES_BARON }, (_, k) => k).filter((k) => k !== suivie);
  const revele = nom === 'revele' && cartes.length > 0 && cartes.every((c) => c);
  const tRetourne = (k: number) => (k === suivie ? DONNE_BW.mienne : DONNE_BW.vague + autres.indexOf(k) * DONNE_BW.pas);
  const retournee = (k: number) => revele && s >= tRetourne(k);
  const auCentre = revele && s >= DONNE_BW.centre;
  const pose = enDonne && s < DONNE_BW.melange ? 'melange' : enDonne ? 'donne' : 'presente';

  // Les sons.
  const joues = useRef(new Set<string>());
  useEffect(() => {
    if (v.phase !== 'bonus') return;
    const fois = (c: string, f: () => void) => {
      const k = `${cle}-${c}`;
      if (joues.current.has(k)) return;
      joues.current.add(k);
      f();
    };
    const entre = (debut: number, marge: number) => s >= debut && s < debut + marge;
    if (enDonne) {
      if (entre(150, 900)) fois('battage', () => jouerEffet('gd_battage'));
      for (let k = 0; k < NB_CARTES_BARON; k++) if (entre(DONNE_BW.melange + k * DONNE_BW.carte, 400)) fois(`donne${k}`, () => jouerEffet('bj_carte', { vitesse: 0.95 + (k % 3) * 0.05 }));
    }
    if (revele) {
      for (const k of autres) if (entre(tRetourne(k), 400)) fois(`retourne${k}`, () => (cartes[k]?.jackpot ? jouerEffet('gd_eclat', { volume: 0.7 }) : jouerEffet('gd_retourne', { vitesse: 0.9 + (k % 4) * 0.06 })));
      if (entre(DONNE_BW.mienne, 600)) fois('mienne', () => jouerEffet('gd_eclat'));
    }
  });

  const gains = CARTES_BARON.filter(([x]) => x !== 'jackpot').map(([x]) => x as number);
  const style = d ? ({ '--cw': `${d.cw}px` } as CSSProperties) : undefined;
  const salonStyle = d ? ({ backgroundImage: `url(${IMG(d.salon.img)})` } as CSSProperties) : undefined;

  return (
    <div className={`gd gd-e-${nom} ${d?.portrait ? 'portrait' : ''}`} ref={scene} style={style}>
      {d && (
        <>
          <div className="gd-salon" style={salonStyle} />
          <img
            key={pose}
            className={`gd-baron ${pose}`}
            src={IMG(POSES[pose].img)}
            alt=""
            draggable={false}
            style={{ left: d.baron.x - d.baron.w / 2, top: d.baron.y, width: d.baron.w }}
          />
          {/* Le devant de la table, par-dessus le Baron : il le coupe à la taille. */}
          <div className="gd-salon devant" style={{ ...salonStyle, clipPath: `inset(${d.bord}px 0 0 0)` }} />
          {pose === 'melange' && <Melange d={d} />}
          <div className={`gd-table ${revele ? 'gd-revele' : ''} ${auCentre ? 'gd-centre' : ''}`}>
            {(nom === 'donne' || nom === 'cartes' || nom === 'revele') &&
              d.places.map((p, k) => {
                const main = POSES.donne.main;
                const mx = d.baron.x - d.baron.w / 2 + main[0] * d.baron.w;
                const my = d.baron.y + main[1] * d.baron.w * POSES.donne.ratio;
                const centre = auCentre && k === suivie;
                const t = centre
                  ? `translate(${d.centre.x - d.cw / 2}px, ${d.centre.y - (d.cw * RATIO_CARTE) / 2}px) scale(${d.centre.echelle})`
                  : envolee(k)
                    ? `translate(${p.x - d.cw / 2}px, ${p.y - (d.cw * RATIO_CARTE) / 2}px) rotate(${p.rot}deg)`
                    : `translate(${mx - d.cw / 2}px, ${my - (d.cw * RATIO_CARTE) / 2}px) rotate(-160deg) scale(0.45)`;
                const r = cartes[k] ?? null;
                const nb = salonChoix[k] ?? 0;
                return (
                  <button
                    key={k}
                    type="button"
                    className={`gd-carte ${envolee(k) ? 'envolee' : ''} ${choix === k ? 'choisie' : ''} ${choix !== null && choix !== k ? 'autre' : ''} ${retournee(k) ? 'retournee' : ''} ${r?.jackpot && retournee(k) ? 'jackpot' : ''} ${k === suivie ? 'suivie' : ''} ${centre ? 'au-centre' : ''}`}
                    style={{ transform: t } as CSSProperties}
                    onClick={() => choisir(k)}
                    disabled={!ouvert || choix !== null}
                    aria-label={tr(`Carte ${k + 1}`, `Card ${k + 1}`)}
                  >
                    {retournee(k) && (r?.jackpot || centre) && <img className="gd-eclat" src={IMG('eclat')} alt="" draggable={false} />}
                    <span className="gd-carte-int">
                      <span className="gd-dos">
                        <img src={IMG('carte-dos')} alt="" draggable={false} />
                      </span>
                      <Face r={r} m={M} son={k === suivie && choix !== null} vue={retournee(k)} />
                    </span>
                    {centre && <img className="gd-paillettes" src={IMG('paillettes')} alt="" draggable={false} />}
                    {nb > 0 && !retournee(k) && !centre && <i className="gd-nb">{nb}</i>}
                    {choix === k && !auCentre && <em className="gd-toi">{tr('Toi', 'You')}</em>}
                  </button>
                );
              })}
          </div>
        </>
      )}

      {nom === 'donne' && s > 200 && s < DONNE_BW.melange - 200 && (
        <div className="gd-annonce bas" role="status">
          <strong>{tr('Le Baron mélange…', 'The Baron shuffles…')}</strong>
        </div>
      )}
      {auCentre && (
        <div className="gd-annonce haut" role="status" key="mienne">
          <strong>{choix !== null ? tr('Ta carte !', 'Your card!') : tr('La carte du salon', 'The room’s card')}</strong>
        </div>
      )}

      {nom === 'intro' && (
        <div className="gd-intro">
          <div className="gd-affiche">
            <img src={IMG('affiche')} alt="" draggable={false} />
            <svg className="gd-affiche-titre" viewBox="0 0 1000 200" role="img" aria-label={tr('Le Choix du Baron', 'The Baron’s Choice')}>
              <text x="500" y="62" textAnchor="middle" dominantBaseline="middle" textLength="560" lengthAdjust="spacingAndGlyphs" className="petit">
                {tr('LA GRANDE DONNE', 'THE GRAND DEAL')}
              </text>
              <text x="500" y="142" textAnchor="middle" dominantBaseline="middle" textLength="820" lengthAdjust="spacingAndGlyphs">
                {tr('LE CHOIX DU BARON', 'THE BARON’S CHOICE')}
              </text>
            </svg>
            <i className="gd-affiche-reflet" />
            {M > 1 && (
              <span className="gd-multi" role="status">
                <small>{tr('Multiplicateur de la roue', 'Wheel multiplier')}</small>
                <strong>×{M}</strong>
              </span>
            )}
          </div>
        </div>
      )}

      {nom === 'revele' && auCentre && revele && cartes[suivie] && (cartes[suivie]?.jackpot || (cartes[suivie]?.x ?? 0) >= 25) && choix !== null && s >= DONNE_BW.mienne + 400 && (
        <PluieLingots n={d?.portrait ? 10 : 16} objets={['billet', 'lingot', 'billet']} />
      )}
    </div>
  );
}
