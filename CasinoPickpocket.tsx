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
import { PluieLingots } from './casinoOutils';
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
  'bw-pp-diamants',
  'bw-pp-poursuite',
];

/** Les rapports hauteur / largeur des objets. */
const R = { chapeau: 500 / 520, collier: 855 / 900, montre: 646 / 520, bague: 578 / 520 };
/** La photo du guéridon (1672 × 941) : le plateau, et les trois places des chapeaux (pixels de la photo). */
const TABLE = { w: 1672, h: 941, places: [580, 830, 1080], pose: 800, chapeau: 215 };

// ---------------------------------------------------------------------------------------------------------------
// Le calendrier (millisecondes d'un vol de 6,5 s, d'un retournement de 7 s)

const REF_VOL = DUREES_BW.vol;
const REF_REVELE = DUREES_BW.revelePick;
/** Le vol : le collier tombe sur le plateau, les chapeaux tombent (celui du milieu le couvre), puis le bonneteau. */
const VOL = { collier: 250, pose: 800, chapeaux: [2_200, 2_450, 2_300], chute: 420, melange: 3_150 };
/** Le bonneteau : les échanges de chapeaux (deux places) et leur durée, de plus en plus rapides. */
const ECHANGES: [number, number][] = [
  [0, 1],
  [1, 2],
  [0, 2],
  [0, 1],
  [1, 2],
  [0, 2],
  [0, 1],
  [1, 2],
];
const DUREES_ECHANGES = ECHANGES.map((_, i) => Math.round(400 - i * 24));
const DEBUTS_ECHANGES = DUREES_ECHANGES.map((_, i) => VOL.melange + DUREES_ECHANGES.slice(0, i).reduce((a, d) => a + d + 25, 0));
/** Le retournement : le premier chapeau des autres, le second, puis le mien ; un chapeau se lève en 450 ms. Si le
 * collier m'a échappé, le voleur salue (salut). */
const RET = { premier: 500, second: 1500, mien: 3000, leve: 450, salut: 4_000 };

const borne = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u);
const lisse = (u: number) => {
  const x = borne(u);
  return x * x * (3 - 2 * x);
};

/** Où est chaque chapeau (place, et le déplacement en cours) pendant le bonneteau. */
function chapeauxA(s: number): { place: number; vers: number; q: number; devant: boolean }[] {
  const place = [0, 1, 2];
  const etat = place.map((p) => ({ place: p, vers: p, q: 0, devant: false }));
  for (let i = 0; i < ECHANGES.length; i++) {
    const [a, b] = ECHANGES[i];
    const q = (s - DEBUTS_ECHANGES[i]) / DUREES_ECHANGES[i];
    const ha = place.indexOf(a);
    const hb = place.indexOf(b);
    if (q >= 1) {
      place[ha] = b;
      place[hb] = a;
      continue;
    }
    if (q > 0) {
      etat[ha] = { place: a, vers: b, q, devant: true };
      etat[hb] = { place: b, vers: a, q, devant: false };
    }
    break;
  }
  return etat.map((e, h) => (e.q > 0 ? e : { place: place[h], vers: place[h], q: 0, devant: false }));
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
  diamants: Ref<HTMLImageElement>;
  poursuite: Ref<HTMLImageElement>;
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
          y += m.devant ? arc * hh * 0.1 : -arc * hh * 0.28;
          echelle = m.q > 0 ? (m.devant ? 1 + 0.07 * arc : 1 - 0.08 * arc) : 1;
          // Les chapeaux tombent du ciel, avec un petit rebond.
          const q = (s - VOL.chapeaux[k]) / VOL.chute;
          visible = q > 0;
          if (q < 1) y -= H * 0.9 * (1 - q) ** 2;
          else if (q < 1.6) y -= Math.sin(Math.PI * ((q - 1) / 0.6)) * hh * 0.08;
          if (rc.current) rc.current.style.zIndex = m.devant ? '6' : '5';
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
      // Le collier tombe au milieu du plateau ; le chapeau du milieu le recouvre.
      const qc = (s - VOL.collier) / (VOL.pose - VOL.collier);
      placer(r.collier.current, places[1], pose - hh * 0.02 - H * 0.6 * (1 - lisse(qc)), hw * 0.95, R.collier, { visible: vol && qc > 0 && s < VOL.chapeaux[1] + VOL.chute - 30 });
      // La pluie de diamants et le projecteur, sur le collier retrouvé (ou posé).
      const lc = kc >= 0 ? leveA(kc) : 0;
      const tc = kc >= 0 ? s - RET[(['premier', 'second', 'mien'] as const)[Math.max(0, x.ordre.indexOf(kc))]] : -1;
      const tp = vol ? s - VOL.pose : -1;
      const eclat = vol ? tp > 0 && tp < 1400 : lc > 0 && tc < 1400;
      const te = vol ? tp : tc;
      placer(r.diamants.current, places[vol ? 1 : Math.max(0, kc)], pose + hw * 0.55, hw * 2.4, 1, { visible: eclat, opacite: 1 - borne((te - 700) / 700), rot: te / 30 });
      placer(r.poursuite.current, places[Math.max(0, kc)], pose + hh * 0.4, hw * 2.2, 1, { visible: lc > 0 && salut < 1, opacite: Math.min(1, lc * 1.5) * 0.85 * (1 - salut) });

      // Les sons du vol : la musique reprend, le collier tombe, le bonneteau.
      if (vol) {
        fois('valse', 0, () => jouerEffet('pp_valse', { volume: 0.6 }));
        fois('pose', VOL.pose - 80, () => jouerEffet('ppi_clic', { volume: 0.9 }));
        DEBUTS_ECHANGES.forEach((t0, i) => fois(`e${i}`, t0, () => jouerEffet('pp_glisse', { vitesse: 0.9 + (i % 3) * 0.1 })));
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
        <img src={IMG('ppi-eclat')} alt="" draggable={false} />
        <img className="ppi-etoile" src={IMG('bw-pp-diamants')} alt="" draggable={false} />
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
      diamants: ref(),
      poursuite: ref(),
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
          <img className="pp-poursuite" ref={r.poursuite} src={IMG('bw-pp-poursuite')} alt="" draggable={false} />
          <img className="pp-objet collier" ref={r.collier} src={IMG('ppb-collier')} alt="" draggable={false} />
          {[0, 1, 2].map((k) => (
            <img key={`o${k}`} className={`pp-objet ${objets[k] ?? ''}`} ref={r.objets[k]} src={IMG(`ppb-${objets[k] ?? 'montre'}`)} alt="" draggable={false} />
          ))}
          <img className="pp-lumiere diamants" ref={r.diamants} src={IMG('bw-pp-diamants')} alt="" draggable={false} />
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
          {mienRevele && choix !== null && objets[choix] === 'collier' && <PluieLingots n={portrait ? 10 : 16} objets={['billet', 'lingot', 'billet']} />}
        </>
      )}
    </div>
  );
}
