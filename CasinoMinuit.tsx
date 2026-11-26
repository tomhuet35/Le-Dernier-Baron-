/**
 * La Roue de Minuit (le Bal masqué : la case unique et le grand final de la roue du Bal). Au penthouse du Grand Hôtel,
 * une roue géante de 32 cases et trois masques-pointeurs (Argent, Or, Rubis).
 *
 * L'intro « Minuit au penthouse » (10 s) : la roue du Bal, puis la caméra monte le long de la façade de l'hôtel au son
 * des coups de minuit, arrive au penthouse de verre, y entre, et le Baron masqué ordonne à la roue de tourner.
 * Le choix : chacun choisit son masque. Les tours : la roue tourne, chaque masque lit sa case ; « Double » ou « Triple »
 * multiplie toutes les cases de ce masque et la roue repart (tant qu'un masque attend).
 *
 * Le serveur a tiré les arrêts de la roue dès le début du bonus ; il ne les envoie qu'aux tours (les masques sont
 * choisis). Tout est placé d'après la taille de la scène et l'horloge de l'étape.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { CASES_MINUIT, DUREES_BW, NB_CASES_MINUIT, POINTEURS_MINUIT, caseMinuit, parcoursMinuit, type VueBonusBW, type VueBW } from '../../shared/baronWheel';
import { ValeurMultipliee } from './CasinoBaronExpress';
import { tr } from './traduction';
import { jouerEffet, type EffetSonore } from './ui';
import './minuit.css';

const IMG = (n: string) => `/cartes/bw-rm-${n}.webp`;

/** Toutes les images de la Roue de Minuit (sans chemin ni extension), préchargées avant le bonus. */
export const IMAGES_MINUIT_NOMS = [
  ...['penthouse-paysage', 'penthouse-portrait', 'jante', 'moyeu', 'nuit', 'pointeur-argent', 'pointeur-or', 'pointeur-rubis'].map((n) => `bw-rm-${n}`),
  ...['facade', 'dehors', 'entree', 'baron'].map((n) => `bw-rmi-${n}`),
];

const MASQUES = ['argent', 'or', 'rubis'] as const;
const NOMS_MASQUES: [string, string][] = [
  ['Argent', 'Silver'],
  ['Or', 'Gold'],
  ['Rubis', 'Ruby'],
];
/** Les images : la jante (1000 × 1014, son trou fait 64,4 % de sa largeur), un pointeur (225 × 500). */
const JANTE = { r: 1014 / 1000, trou: 0.644 };
const POINTEUR = 225 / 500;
const A = 360 / NB_CASES_MINUIT;

// ---------------------------------------------------------------------------------------------------------------
// Le calendrier d'un tour (7 s) : la roue tourne 5 s, puis les masques lisent leur case.

const TOUR = { arret: 5_000, effet: 5_250, double: 5_700 };

const borne = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u);
/** La roue lancée fort, qui ralentit longuement. */
const freine = (u: number) => 1 - (1 - borne(u)) ** 3.2;

/** La rotation de la roue après chaque tour : toujours plus de trois tours complets, et la case r sous le masque du milieu. */
function rotations(tours: number[]): number[] {
  const rots: number[] = [];
  let rot = 0;
  for (const r of tours) {
    const delta = (((rot + r * A) % 360) + 360) % 360;
    rot = rot - 3 * 360 - delta;
    rots.push(rot);
  }
  return rots;
}

// ---------------------------------------------------------------------------------------------------------------
// La roue (un SVG de 1000 unités : la jante fait 500 de rayon, son trou 322)

const R_SEG = 330;
const R_MOYEU = 150;
function secteur(a0: number, a1: number, r0 = R_MOYEU, r1 = R_SEG) {
  const p = (r: number, a: number) => [r * Math.sin((a * Math.PI) / 180), -r * Math.cos((a * Math.PI) / 180)].map((x) => x.toFixed(2)).join(' ');
  return `M${p(r1, a0)} A${r1} ${r1} 0 0 1 ${p(r1, a1)} L${p(r0, a1)} A${r0} ${r0} 0 0 0 ${p(r0, a0)}Z`;
}

function Cases({ facteur }: { facteur: number }) {
  return (
    <svg className="rm-cases" viewBox="-500 -500 1000 1000" aria-hidden="true">
      <defs>
        <pattern id="rm-nuit" patternUnits="userSpaceOnUse" width="220" height="220">
          <image href={IMG('nuit')} width="220" height="220" />
        </pattern>
        <linearGradient id="rm-or" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff0b8" />
          <stop offset="0.5" stopColor="#e2a93c" />
          <stop offset="1" stopColor="#9a5d12" />
        </linearGradient>
        <linearGradient id="rm-rubis" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e0323e" />
          <stop offset="1" stopColor="#5a0410" />
        </linearGradient>
      </defs>
      <circle r={R_SEG + 4} fill="#0a0a1c" />
      {CASES_MINUIT.map((c, i) => {
        const a = i * A;
        const special = typeof c !== 'number';
        const gros = typeof c === 'number' && c >= 40;
        const fond = special ? (c === 'triple' ? '#2a0410' : 'url(#rm-rubis)') : gros ? 'url(#rm-or)' : 'url(#rm-nuit)';
        const texte = special ? (c === 'double' ? tr('DOUBLE', 'DOUBLE') : tr('TRIPLE', 'TRIPLE')) : `×${(c * facteur).toLocaleString('fr-FR')}`;
        return (
          <g key={i}>
            <path d={secteur(a - A / 2, a + A / 2)} fill={fond} />
            {!special && !gros && i % 2 === 0 && <path d={secteur(a - A / 2, a + A / 2)} fill="rgba(120, 150, 255, 0.07)" />}
            {c === 'triple' && <path d={secteur(a - A / 2, a + A / 2, R_SEG - 26, R_SEG)} fill="url(#rm-or)" />}
            <text
              className={`rm-txt ${special ? 'special' : gros ? 'gros' : ''}`}
              transform={`rotate(${a}) translate(0 ${-(R_MOYEU + R_SEG) / 2 - 12}) rotate(-90)`}
              textAnchor="middle"
              dominantBaseline="central"
              style={{ fontSize: special ? 21 : texte.length > 5 ? 22 : 30 }}
            >
              {texte}
            </text>
          </g>
        );
      })}
      {CASES_MINUIT.map((_, i) => (
        <line key={`f${i}`} x1="0" y1={-R_MOYEU} x2="0" y2={-R_SEG} transform={`rotate(${i * A + A / 2})`} className="rm-filet" />
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// L'intro « Minuit au penthouse » (10 s : les pourcentages de minuit.css sont des centièmes de 10 s)

const SONS_INTRO: [number, EffetSonore, number][] = [
  [700, 'exi_minuit', 1],
  [3_300, 'exi_minuit', 0.8],
  [5_000, 'fci_portes', 0.7],
  [6_500, 'fci_portes', 1],
  [8_000, 'fci_bravo', 1],
  [9_500, 'rm_double', 0.8],
];

function IntroMinuit({ t0, roue }: { t0: number; roue?: ReactNode }) {
  useEffect(() => {
    const ids = SONS_INTRO.filter(([x]) => x >= t0).map(([x, son, volume]) => window.setTimeout(() => jouerEffet(son, { volume }), x - t0));
    return () => ids.forEach((i) => window.clearTimeout(i));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const img = (n: string) => `url(/cartes/bw-rmi-${n}.webp)`;
  return (
    <div className="rmi" aria-hidden="true" style={{ '--t0': `${-t0}ms` } as CSSProperties}>
      <div className="rmi-plan rmi-la-roue">{roue}</div>
      <div className="rmi-plan facade">
        <i className="rmi-photo" style={{ backgroundImage: img('facade') }} />
        <i className="rmi-coups" />
      </div>
      <div className="rmi-plan dehors">
        <i className="rmi-photo" style={{ backgroundImage: img('dehors') }} />
      </div>
      <div className="rmi-plan entree">
        <i className="rmi-photo" style={{ backgroundImage: img('entree') }} />
      </div>
      <div className="rmi-plan baron">
        <i className="rmi-photo" style={{ backgroundImage: img('baron') }} />
      </div>
      <i className="rmi-flash" />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Le bonus

export function BonusMinuit({ v, b, nom, ouvert, choisir, roue }: { v: VueBW; b: VueBonusBW; nom: string; ouvert: boolean; choisir: (o: number) => void; roue?: ReactNode }) {
  const M = Math.max(1, b.multiplicateur);
  const choix = b.mesChoix[0];
  const salon = b.choixSalon[0] ?? [0, 0, 0];
  const tours = b.minuit?.tours ?? null;
  const nbT = tours?.length ?? 1;

  // L'horloge de l'étape (recalée sur le serveur) ; au résultat, tout est joué.
  const cle = `${v.numero}-${b.etape}`;
  const horloge = useRef({ cle: '', debut: 0 });
  const t = performance.now();
  if (v.phase === 'resultat') {
    if (horloge.current.cle !== cle) horloge.current = { cle, debut: t - 600_000 };
  } else {
    const estime = t - ((v.duree ?? 0) - (v.reste ?? 0));
    if (horloge.current.cle !== cle) horloge.current = { cle, debut: estime };
    else horloge.current.debut = Math.min(horloge.current.debut, estime);
  }
  const [maintenant, setMaintenant] = useState(() => performance.now());
  useEffect(() => {
    const id = window.setInterval(() => setMaintenant(performance.now()), 33);
    return () => window.clearInterval(id);
  }, []);
  const ref = nom === 'intro' ? DUREES_BW.introMinuit : nom === 'tours' ? DUREES_BW.tourMinuit * nbT : 0;
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
    if (joues.current.has(k) || s < debut || s > debut + 900) return;
    joues.current.add(k);
    f();
  };

  const { W, H } = taille;
  if (!W || !H) return <div className="rm" ref={el} />;
  const portrait = H > W * 1.05;
  const Dw = portrait ? Math.min(W * 0.92, H * 0.54) : Math.min(H * 0.74, W * 0.6);
  const cx = W / 2;
  const cy = portrait ? H * 0.56 : H * 0.57;
  const rTip = (Dw / 2) * JANTE.trou * 0.95;
  const hp = Dw * 0.3;

  // Le tour en cours et la rotation de la roue.
  const joue = (nom === 'tours' || nom === 'revele') && !!tours;
  const st = nom === 'revele' ? 1e9 : s;
  const k = joue ? Math.min(nbT - 1, Math.max(0, Math.floor(st / DUREES_BW.tourMinuit))) : 0;
  const u = joue ? (nom === 'revele' ? 1e9 : st - k * DUREES_BW.tourMinuit) : -1;
  const rots = tours ? rotations(tours) : [];
  const rot = joue ? (k ? rots[k - 1] : 0) + ((rots[k] ?? 0) - (k ? rots[k - 1] : 0)) * freine(u / TOUR.arret) : 0;
  const pose = joue && u >= TOUR.arret;

  // Chaque masque : son parcours, et où il en est.
  const etats = MASQUES.map((_, p) => {
    const pc = tours ? parcoursMinuit(tours, p) : { facteurs: [1], fin: null, gain: 0 };
    const finiA = pc.fin === null ? nbT - 1 : pc.fin;
    const fini = joue && (k > finiA || (k === finiA && pose));
    const actif = joue && (pc.fin === null || k <= pc.fin);
    const caseIci = tours && joue ? caseMinuit(tours[k], p) : null;
    const multiplie = actif && pose && u >= TOUR.double && caseIci !== null && typeof caseIci !== 'number';
    const facteur = joue ? (pc.facteurs[Math.min(k, pc.facteurs.length - 1)] ?? 1) * (multiplie ? (caseIci === 'double' ? 2 : 3) : 1) : 1;
    return { pc, fini, actif, caseIci, facteur, multiplie };
  });
  const moi = choix ?? 1;
  const mien = etats[moi];
  const finJeu = joue && etats.every((e) => e.fini);

  // Les sons des tours.
  if (nom === 'tours' && tours) {
    for (let j = 0; j < nbT; j++) {
      const t0 = j * DUREES_BW.tourMinuit;
      fois(`r${j}`, t0, () => jouerEffet('rm_roule'));
      const c = caseMinuit(tours[j], moi);
      const monActif = mien.pc.fin === null || j <= mien.pc.fin;
      if (monActif && typeof c !== 'number') fois(`d${j}`, t0 + TOUR.effet, () => jouerEffet('rm_double'));
      else if (monActif) fois(`g${j}`, t0 + TOUR.effet, () => jouerEffet(typeof c === 'number' && c >= 40 ? 'fci_bravo' : 'gd_eclat'));
    }
  }

  // Les pointeurs : à -45°, 0°, +45° autour du haut de la roue.
  const angle = (p: number) => POINTEURS_MINUIT[p] * A;
  const choisirOuvert = nom === 'masques' && ouvert && choix === null;

  return (
    <div className={`rm rm-e-${nom} ${portrait ? 'portrait' : ''}`} ref={el}>
      <div className="rm-salle" style={{ backgroundImage: `url(${IMG(portrait ? 'penthouse-portrait' : 'penthouse-paysage')})` }} />
      <i className="rm-halo" style={{ left: cx, top: cy, width: Dw * 1.5, height: Dw * 1.5 }} />

      <div className="rm-roue" style={{ left: cx - Dw / 2, top: cy - Dw / 2, width: Dw, height: Dw }}>
        <div className="rm-tourne" style={{ transform: `rotate(${rot}deg)` }}>
          <Cases key={mien.facteur} facteur={mien.facteur} />
          <img className="rm-moyeu" src={IMG('moyeu')} alt="" draggable={false} />
        </div>
        {/* Les cases lues par les masques, quand la roue s'est posée. */}
        <svg className="rm-lues" viewBox="-500 -500 1000 1000" aria-hidden="true">
          {etats.map((e, p) =>
            e.actif && pose && !(e.pc.fin !== null && k > e.pc.fin) ? (
              <path key={p} d={secteur(angle(p) - A / 2, angle(p) + A / 2)} className={`rm-lue ${p === moi ? 'mienne' : ''} ${typeof e.caseIci === 'number' ? '' : 'speciale'}`} />
            ) : null,
          )}
        </svg>
        <img className="rm-jante" src={IMG('jante')} alt="" draggable={false} style={{ height: Dw * JANTE.r, top: (Dw - Dw * JANTE.r) / 2 }} />
      </div>

      {/* Les trois masques-pointeurs (les boutons du choix). */}
      {MASQUES.map((m, p) => {
        const e = etats[p];
        const a = (angle(p) * Math.PI) / 180;
        const bx = cx + Math.sin(a) * (rTip + hp + 14);
        const by = cy - Math.cos(a) * (rTip + hp + 14);
        return (
          <div key={m}>
            <button
              type="button"
              className={`rm-pointeur ${p === choix ? 'mien' : ''} ${choix !== null && p !== choix && nom === 'masques' ? 'autre' : ''} ${e.fini ? 'fini' : ''}`}
              style={{ left: cx - (hp * POINTEUR) / 2, top: cy - rTip - hp, width: hp * POINTEUR, height: hp, transformOrigin: `50% ${hp + rTip}px`, transform: `rotate(${angle(p)}deg)` }}
              onClick={() => choisir(p)}
              disabled={!choisirOuvert}
              aria-label={tr(`Masque ${NOMS_MASQUES[p][0]}`, `${NOMS_MASQUES[p][1]} mask`)}
            >
              <img src={IMG(`pointeur-${m}`)} alt="" draggable={false} />
            </button>
            <div className={`rm-badge ${p === choix ? 'mien' : ''} ${e.fini ? 'fini' : e.facteur > 1 ? 'multiplie' : ''}`} style={{ left: bx, top: by }} key={`${p}-${e.fini}-${e.facteur}`}>
              {nom === 'masques' || nom === 'intro' ? (
                <>
                  {tr(NOMS_MASQUES[p][0], NOMS_MASQUES[p][1])}
                  {salon[p] ? <i className="rm-nb">{salon[p]}</i> : null}
                </>
              ) : e.fini ? (
                `×${e.pc.gain.toLocaleString('fr-FR')}`
              ) : e.facteur > 1 ? (
                `×${e.facteur} ${tr('partout', 'all')}`
              ) : (
                tr(NOMS_MASQUES[p][0], NOMS_MASQUES[p][1])
              )}
              {p === choix && <em className="rm-toi">{tr('Toi', 'You')}</em>}
            </div>
          </div>
        );
      })}

      {/* Double ou Triple pour mon masque : l'annonce, et toutes mes cases se multiplient. */}
      {mien.actif && pose && typeof mien.caseIci !== 'number' && mien.caseIci !== null && u < DUREES_BW.tourMinuit - 200 && (
        <div className="rm-annonce-double" role="status" key={`d${k}`}>
          <strong>{mien.caseIci === 'double' ? tr('Double !', 'Double!') : tr('Triple !', 'Triple!')}</strong>
          <small>{tr(`Toutes tes cases ×${mien.caseIci === 'double' ? 2 : 3}, la roue repart !`, `All your segments ×${mien.caseIci === 'double' ? 2 : 3}, spin again!`)}</small>
        </div>
      )}
      {nom === 'masques' && (
        <div className="rm-annonce" role="status">
          <strong>{choix === null ? tr('Choisis ton masque', 'Pick your mask') : tr('Minuit va sonner…', 'Midnight is coming…')}</strong>
        </div>
      )}
      {finJeu && (
        <div className="rm-resultat" role="status">
          <small>{choix !== null ? tr(`Ton masque ${NOMS_MASQUES[moi][0]} gagne`, `Your ${NOMS_MASQUES[moi][1]} mask wins`) : tr('Minuit a sonné', 'Midnight has struck')}</small>
          <strong>
            <ValeurMultipliee x={mien.pc.gain} m={M} son />
          </strong>
        </div>
      )}

      {nom === 'intro' && <IntroMinuit key={cle} t0={t0Intro.current.t0} roue={roue} />}
    </div>
  );
}
