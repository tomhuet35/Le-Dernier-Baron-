/**
 * Les Chaises musicales (la roue du Bal) : sur la piste du Grand Hôtel, quatre invités dansent autour de trois chaises
 * dorées. L'intro « La Dernière Danse » (9 s) : la roue, l'orchestre, les chaises vues d'en haut, les invités bras dessus
 * bras dessous, la baguette du chef. Le pari : chacun choisit son invité. La musique : trois tours ; à chaque arrêt du
 * chef, c'est la ruée, l'invité resté debout quitte la piste en boudant, et l'on retire une chaise. Le gain dépend du
 * moment où mon invité sort (×2, ×6, ×10), ×30 s'il est le dernier assis.
 *
 * Le serveur a tiré l'ordre de sortie dès le début du bonus ; il ne l'envoie qu'à la musique (les paris sont faits).
 * Les invités tournent sur une ellipse autour des chaises (devant, ils passent au premier plan) ; tout est placé
 * d'après la taille de la scène et l'horloge de l'étape.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { DUREES_BW, GAINS_CHAISES, INVITES_CHAISES, type VueBonusBW, type VueBW } from '../../shared/baronWheel';
import { ValeurMultipliee } from './CasinoBaronExpress';
import { tr } from './traduction';
import { jouerEffet, type EffetSonore } from './ui';
import './chaises.css';

const IMG = (n: string) => `/cartes/bw-cm-${n}.webp`;

/** Toutes les images des Chaises musicales (sans chemin ni extension), préchargées avant le bonus. */
export const IMAGES_CHAISES_NOMS = [
  ...['piste-paysage', 'piste-portrait', 'chaise', 'chef'].map((n) => `bw-cm-${n}`),
  ...INVITES_CHAISES.flatMap((i) => ['danse', 'assis', 'elimine'].map((p) => `bw-cm-${i}-${p}`)),
  ...['orchestre', 'chaises', 'invites', 'baguette'].map((n) => `bw-cmi-${n}`),
];

const NOMS: Record<string, [string, string]> = {
  comtesse: ['La Comtesse', 'The Countess'],
  colonel: ['Le Colonel', 'The Colonel'],
  charleston: ['La Garçonne', 'The Flapper'],
  magnat: ['Le Magnat', 'The Tycoon'],
};

/** Les proportions des images (largeur / hauteur). */
const RATIO: Record<string, number> = {
  chaise: 310 / 520,
  'comtesse-danse': 409 / 700,
  'colonel-danse': 435 / 700,
  'charleston-danse': 383 / 700,
  'magnat-danse': 449 / 700,
  'comtesse-assis': 449 / 700,
  'colonel-assis': 473 / 700,
  'charleston-assis': 446 / 700,
  'magnat-assis': 596 / 700,
  'comtesse-elimine': 409 / 700,
  'colonel-elimine': 380 / 700,
  'charleston-elimine': 315 / 700,
  'magnat-elimine': 389 / 700,
};
/** Les images de danse qui regardent à gauche (on les retourne pour qu'elles regardent toutes à droite). */
const DANSE_A_GAUCHE = new Set(['comtesse']);

// ---------------------------------------------------------------------------------------------------------------
// Le calendrier (un tour de 6 s : la musique, l'arrêt, la ruée, assis, on se relève)

const TOUR = { stop: 3_400, assis: 3_900, releve: 5_300, fin: 6_000 };
const NB_TOURS = INVITES_CHAISES.length - 1;

const borne = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u);
const lisse = (u: number) => {
  const x = borne(u);
  return x * x * (3 - 2 * x);
};

// ---------------------------------------------------------------------------------------------------------------
// La géométrie

function mesurer(W: number, H: number) {
  const portrait = H > W * 1.05;
  const sol = H * (portrait ? 0.7 : 0.8);
  const gh = H * (portrait ? 0.27 : 0.36);
  const ch = gh * 0.56;
  const cw = ch * RATIO.chaise;
  const rx = portrait ? W * 0.36 : Math.min(W * 0.27, H * 0.55);
  const ry = H * (portrait ? 0.07 : 0.075);
  return { W, H, portrait, sol, gh, ch, cw, rx, ry, cx: W / 2 };
}
type Geo = ReturnType<typeof mesurer>;

/** Où est la chaise j quand il en reste n. */
const chaiseX = (g: Geo, j: number, n: number) => g.cx + (j - (n - 1) / 2) * Math.min(g.cw * 1.95, (g.rx * 2) / 3);

/** Un invité qui danse sur l'ellipse : sa position, sa taille, et s'il est devant les chaises. */
function surEllipse(g: Geo, a: number) {
  const s = Math.sin(a);
  return { x: g.cx + g.rx * Math.cos(a), y: g.sol + g.ry * s, k: 0.9 + 0.1 * s, devant: s > -0.15, gauche: s > 0 };
}

interface Pose {
  inv: number;
  img: string;
  x: number;
  y: number;
  h: number;
  devant: boolean;
  miroir: boolean;
  o: number;
}

/** Les poses de tous les invités au temps s de la musique (et les chaises qui restent). */
function scene(g: Geo, ordre: number[], s: number) {
  const r = Math.min(NB_TOURS - 1, Math.floor(s / TOUR.fin));
  const u = s - r * TOUR.fin;
  const restants = INVITES_CHAISES.map((_, i) => i).filter((i) => ordre.indexOf(i) >= r);
  const elimine = ordre[r];
  const assis = restants.filter((i) => i !== elimine);
  const n = NB_TOURS - r; // les chaises de ce tour
  const w = 0.0011; // la vitesse de la ronde (radians par ms)
  const poses: Pose[] = [];
  const angle = (k: number, t: number) => (k * 2 * Math.PI) / restants.length + Math.PI / 2 - w * t;
  // Où dansait chacun à l'arrêt, et quelle chaise il prend.
  restants.forEach((inv, k) => {
    const nom = INVITES_CHAISES[inv];
    const e = surEllipse(g, angle(k, Math.min(u, TOUR.stop)));
    const danse = (x: number, y: number, kk: number, devant: boolean, gauche: boolean, o = 1): Pose => ({
      inv,
      img: `${nom}-danse`,
      x,
      y,
      h: g.gh * kk,
      devant,
      miroir: gauche !== DANSE_A_GAUCHE.has(nom),
      o,
    });
    const j = assis.indexOf(inv);
    const cxj = j >= 0 ? chaiseX(g, j, n) : 0;
    if (u < TOUR.stop) {
      // La ronde ; au début d'un tour (après le premier), on revient des chaises vers l'ellipse.
      const retour = r > 0 ? lisse(u / 600) : 1;
      if (retour < 1) {
        const avant = INVITES_CHAISES.map((_, i) => i).filter((i) => ordre.indexOf(i) >= r - 1 && i !== ordre[r - 1]);
        const jj = avant.indexOf(inv);
        const x0 = chaiseX(g, jj, n + 1);
        poses.push(danse(x0 + (e.x - x0) * retour, g.sol + (e.y - g.sol) * retour, 1, true, e.gauche));
      } else poses.push(danse(e.x, e.y, e.k, e.devant, e.gauche));
    } else if (inv === elimine) {
      // Resté debout : il boude, puis quitte la piste vers la gauche.
      const q = borne((u - TOUR.assis) / 1_700);
      const x = e.x - q * (e.x + g.gh);
      poses.push({ inv, img: `${nom}-elimine`, x, y: e.y, h: g.gh * e.k, devant: true, miroir: false, o: 1 - borne((u - TOUR.assis - 1_200) / 500) });
    } else if (u < TOUR.assis) {
      // La ruée vers la chaise.
      const q = lisse((u - TOUR.stop) / (TOUR.assis - TOUR.stop));
      poses.push(danse(e.x + (cxj - e.x) * q, e.y + (g.sol - e.y) * q, e.k + (1 - e.k) * q, true, cxj < e.x));
    } else if (u < TOUR.releve || r === NB_TOURS - 1) {
      // Assis (l'image de l'invité assis porte sa chaise).
      poses.push({ inv, img: `${nom}-assis`, x: cxj, y: g.sol + g.ch * 0.03, h: g.ch * 1.62, devant: true, miroir: false, o: 1 });
    } else {
      poses.push(danse(cxj, g.sol, 1, true, false));
    }
  });
  // Les chaises : vides pendant la ronde ; on retire la dernière quand tout le monde se relève.
  const chaises: { x: number; o: number }[] = [];
  for (let j = 0; j < n; j++) {
    const prise = u >= TOUR.assis && (u < TOUR.releve || r === NB_TOURS - 1);
    const retiree = r < NB_TOURS - 1 && u >= TOUR.releve && j === n - 1;
    if (!prise) chaises.push({ x: chaiseX(g, j, n), o: retiree ? 1 - borne((u - TOUR.releve) / 400) : 1 });
  }
  return { r, u, poses, chaises, elimine };
}

// ---------------------------------------------------------------------------------------------------------------
// L'intro « La Dernière Danse »

const SONS_INTRO: [number, EffetSonore, number][] = [
  [0, 'cm_roulement', 1],
  [1_100, 'cm_musique', 0.8],
  [3_000, 'cm_ruee', 0.6],
  [4_700, 'fci_bravo', 0.6],
  [6_900, 'cm_stop', 0.7],
];

function IntroDerniereDanse({ t0, roue }: { t0: number; roue?: ReactNode }) {
  useEffect(() => {
    const ids = SONS_INTRO.filter(([x]) => x >= t0).map(([x, son, volume]) => window.setTimeout(() => jouerEffet(son, { volume }), x - t0));
    return () => ids.forEach((i) => window.clearTimeout(i));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const img = (n: string) => `url(/cartes/bw-cmi-${n}.webp)`;
  return (
    <div className="cmi" aria-hidden="true" style={{ '--t0': `${-t0}ms` } as CSSProperties}>
      <div className="cmi-plan cmi-la-roue">{roue}</div>
      <div className="cmi-plan orchestre">
        <i className="cmi-photo" style={{ backgroundImage: img('orchestre') }} />
      </div>
      <div className="cmi-plan chaises">
        <i className="cmi-photo" style={{ backgroundImage: img('chaises') }} />
      </div>
      <div className="cmi-plan invites">
        <i className="cmi-photo" style={{ backgroundImage: img('invites') }} />
      </div>
      <div className="cmi-plan baguette">
        <i className="cmi-photo" style={{ backgroundImage: img('baguette') }} />
      </div>
      <i className="cmi-flash" />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Le bonus

export function BonusChaises({ v, b, nom, ouvert, choisir, roue }: { v: VueBW; b: VueBonusBW; nom: string; ouvert: boolean; choisir: (o: number) => void; roue?: ReactNode }) {
  const M = Math.max(1, b.multiplicateur);
  const choix = b.mesChoix[0];
  const salon = b.choixSalon[0] ?? INVITES_CHAISES.map(() => 0);
  const ordre = b.chaises?.ordre ?? null;

  // L'horloge de l'étape (recalée sur le serveur) ; au résultat, la musique est finie.
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
  const ref = nom === 'intro' ? DUREES_BW.introChaises : nom === 'musique' ? DUREES_BW.musique : 0;
  const echelle = v.phase === 'bonus' && v.duree && ref ? ref / v.duree : 1;
  const s = (maintenant - horloge.current.debut) * echelle;
  const t0Intro = useRef({ cle: '', t0: 0 });
  if (t0Intro.current.cle !== cle) t0Intro.current = { cle, t0: nom === 'intro' ? Math.max(0, (v.duree ?? 0) - (v.reste ?? 0)) * echelle : 0 };

  // La taille de la scène.
  const el = useRef<HTMLDivElement>(null);
  const [taille, setTaille] = useState({ W: 0, H: 0 });
  useEffect(() => {
    const e = el.current;
    if (!e) return;
    const ro = new ResizeObserver(() => setTaille({ W: e.clientWidth, H: e.clientHeight }));
    ro.observe(e);
    setTaille({ W: e.clientWidth, H: e.clientHeight });
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
  if (!W || !H) return <div className="cm" ref={el} />;
  const g = mesurer(W, H);
  const musique = (nom === 'musique' || nom === 'revele') && !!ordre;
  const sm = nom === 'revele' ? 1e9 : s;
  const sc = musique ? scene(g, ordre!, Math.min(sm, NB_TOURS * TOUR.fin - 1)) : null;
  const fini = musique && sm >= (NB_TOURS - 1) * TOUR.fin + TOUR.assis + 300;

  if (nom === 'musique' && ordre) {
    for (let r = 0; r < NB_TOURS; r++) {
      const t0 = r * TOUR.fin;
      fois(`m${r}`, t0, () => jouerEffet('cm_musique'));
      fois(`s${r}`, t0 + TOUR.stop, () => jouerEffet('cm_stop'));
      fois(`r${r}`, t0 + TOUR.stop + 50, () => jouerEffet('cm_ruee'));
      fois(`o${r}`, t0 + TOUR.assis + 100, () => jouerEffet(r === NB_TOURS - 1 ? 'fci_bravo' : 'cm_ouf'));
    }
  }

  // Mon gain assuré : il monte à chaque tour que mon invité survit.
  const mien = choix ?? null;
  const sortis = sc ? (sc.u >= TOUR.assis ? sc.r + 1 : sc.r) : 0;
  const rangMien = ordre && mien !== null ? ordre.indexOf(mien) : -1;
  const encore = rangMien >= sortis;
  const assure = mien === null || !ordre ? null : encore ? (sortis >= NB_TOURS ? GAINS_CHAISES[NB_TOURS] : GAINS_CHAISES[sortis]) : GAINS_CHAISES[rangMien];

  // Le chef : il lève la baguette à chaque arrêt.
  const stopChef = sc ? sc.u >= TOUR.stop && sc.u < TOUR.stop + 700 : false;

  // Les invités alignés pour le pari.
  const pari = nom === 'pari' || nom === 'intro';
  const ligne = INVITES_CHAISES.map((nomInv, i) => ({ nomInv, i, x: g.W / 2 + (i - 1.5) * Math.min(g.W * 0.23, g.gh * 0.75) }));

  const style = (p: { x: number; y: number; h: number; img: string; miroir?: boolean; o?: number }, z: number): CSSProperties => {
    const w = p.h * (RATIO[p.img] ?? 0.6);
    return { width: w, height: p.h, left: p.x - w / 2, top: p.y - p.h, zIndex: z, opacity: p.o ?? 1, transform: p.miroir ? 'scaleX(-1)' : undefined };
  };

  return (
    <div className={`cm cm-e-${nom} ${g.portrait ? 'portrait' : ''}`} ref={el}>
      <div className="cm-piste" style={{ backgroundImage: `url(${IMG(g.portrait ? 'piste-portrait' : 'piste-paysage')})` }} />
      <img className={`cm-chef ${stopChef ? 'stop' : ''}`} src={IMG('chef')} alt="" draggable={false} style={{ height: g.gh * 0.8, left: g.portrait ? W * 0.02 : W * 0.06, top: g.sol - g.gh * 1.15 }} />

      {/* Le pari : les quatre invités alignés, chacun un bouton. */}
      {pari &&
        ligne.map(({ nomInv, i, x }) => {
          const p = { x, y: g.sol + g.ry, h: g.gh, img: `${nomInv}-danse`, miroir: DANSE_A_GAUCHE.has(nomInv) };
          return (
            <button
              key={nomInv}
              type="button"
              className={`cm-invite ${choix === i ? 'mien' : ''} ${choix !== null && choix !== i ? 'autre' : ''}`}
              style={{ left: x - g.gh * 0.32, top: p.y - g.gh, width: g.gh * 0.64, height: g.gh }}
              onClick={() => choisir(i)}
              disabled={nom !== 'pari' || !ouvert || choix !== null}
              aria-label={tr(NOMS[nomInv][0], NOMS[nomInv][1])}
            >
              <img src={IMG(p.img)} alt="" draggable={false} style={{ transform: p.miroir ? 'scaleX(-1)' : undefined }} />
              <span className="cm-nom">{tr(NOMS[nomInv][0], NOMS[nomInv][1])}</span>
              {salon[i] ? <i className="cm-nb">{salon[i]}</i> : null}
              {choix === i && <em className="cm-toi">{tr('Toi', 'You')}</em>}
            </button>
          );
        })}

      {/* La musique : les chaises, puis les invités (devant ou derrière les chaises). */}
      {sc &&
        sc.chaises.map((c, j) => (
          <img key={`c${j}`} className="cm-chaise" src={IMG('chaise')} alt="" draggable={false} style={style({ x: c.x, y: g.sol, h: g.ch, img: 'chaise', o: c.o }, 20)} />
        ))}
      {sc &&
        sc.poses.map((p) => (
          <div key={`i${p.inv}`} className={`cm-danseur ${p.inv === mien ? 'mien' : ''} ${p.img.endsWith('assis') && fini ? 'gagnant' : ''}`} style={style(p, p.devant ? 30 + Math.round(p.y) : 10)}>
            <img src={IMG(p.img)} alt="" draggable={false} />
            {p.inv === mien && <em className="cm-toi" style={{ transform: p.miroir ? 'translate(-50%, -100%) scaleX(-1)' : undefined }}>{tr('Toi', 'You')}</em>}
          </div>
        ))}

      {/* Le barème, et mon gain assuré. */}
      {(nom === 'pari' || musique) && (
        <div className="cm-bareme">
          {GAINS_CHAISES.map((x, k) => (
            <span key={k} className={`${rangMien === k && (fini || sortis > k) ? 'mien' : ''} ${k === NB_TOURS ? 'gros' : ''}`}>
              <small>{k === NB_TOURS ? tr('Dernier assis', 'Last seated') : tr(`Sort ${k + 1}${k ? 'e' : 'er'}`, `Out ${['1st', '2nd', '3rd'][k]}`)}</small>
              <b>×{x}</b>
            </span>
          ))}
        </div>
      )}
      {musique && assure !== null && !fini && (
        <div className={`cm-assure ${encore ? '' : 'sorti'}`} key={`a${sortis}`}>
          <small>{encore ? tr('Ton invité danse encore', 'Your guest is still dancing') : tr('Ton invité est sorti', 'Your guest is out')}</small>
          <b>×{assure}</b>
        </div>
      )}
      {nom === 'pari' && (
        <div className="cm-annonce" role="status">
          <strong>{choix === null ? tr('Choisis ton invité', 'Pick your guest') : tr('Que la musique commence !', 'Let the music play!')}</strong>
        </div>
      )}
      {fini && ordre && (
        <div className="cm-resultat" role="status">
          <small>{tr(`${NOMS[INVITES_CHAISES[ordre[NB_TOURS]]][0]} reste assis${ordre[NB_TOURS] === 0 || ordre[NB_TOURS] === 2 ? 'e' : ''} !`, `${NOMS[INVITES_CHAISES[ordre[NB_TOURS]]][1]} stays seated!`)}</small>
          {mien !== null && (
            <strong>
              <ValeurMultipliee x={GAINS_CHAISES[ordre.indexOf(mien)]} m={M} son />
            </strong>
          )}
        </div>
      )}

      {nom === 'intro' && <IntroDerniereDanse key={cle} t0={t0Intro.current.t0} roue={roue} />}
    </div>
  );
}
