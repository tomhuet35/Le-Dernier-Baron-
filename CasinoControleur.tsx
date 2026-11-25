/**
 * Le Contrôleur (Le Baron Express) : chacun se cache dans l'un des huit compartiments de la voiture-lits. Le contrôleur
 * parcourt le couloir, lanterne à la main, et les ouvre tous, un à un : celui qu'il débusque garde le palier atteint
 * (plus il a ouvert de portes avant la sienne, plus il gagne) ; le dernier compartiment fermé cache le trésor (le dernier
 * palier et un jackpot). Il feint parfois : il écoute, frappe ou prend la poignée… et repart.
 *
 * Le serveur n'envoie la tournée qu'une fois les choix faits. La scène est un travelling : le couloir (une travée qui se
 * répète, une porte au milieu de chacune) défile et suit le contrôleur ; le haut de l'écran montre le plan de la
 * voiture (les huit compartiments, leur état, où je suis caché) et le palier en cours.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import {
  calendrierControleur,
  DEPART_CT,
  FIN_TOURNEE_CT,
  NB_COMPARTIMENTS,
  ordreControleur,
  PALIERS_CONTROLEUR,
  type FeinteCT,
  type JackpotBW,
  type PassageCT,
  type SegmentCT,
  type VueBonusBW,
  type VueBW,
} from '../../shared/baronWheel';
import { fx } from './CasinoBaronExpress';
import { tr } from './traduction';
import { jouerEffet, mouvementReduit } from './ui';
import './controleur.css';

/** Les images du Contrôleur (sans chemin ni extension), préchargées avant le bonus. */
export const IMAGES_CONTROLEUR_NOMS = [
  'ct-logo',
  'ct-couloir',
  'ct-porte',
  'ct-plaque',
  'ct-porte-vide',
  'ct-porte-fouillee',
  'ct-porte-tresor',
  'ct-marche',
  'ct-frappe',
  'ct-ecoute',
  'ct-poignee',
  'ct-trouve',
  'ct-vide',
  'ct-stupefait',
  'ct-lueur',
  'ct-sifflet',
  // l'intro : le sifflet dans la nuit
  'cti-porte',
  'cti-poignee',
  'cti-controleur',
  'cti-faisceau',
  'bw-rl-decor-paysage',
];
const IMG = (n: string) => `/cartes/${n}.webp`;
const NOMS_JACKPOTS: Record<JackpotBW, string> = { mini: 'MINI', minor: 'MINOR', major: 'MAJOR', grand: 'GRAND' };

// ---------------------------------------------------------------------------------------------------------------
// Le calendrier de la tournée (le même sur tous les écrans : tiré de la tournée du serveur)

type Pose = 'marche' | FeinteCT | 'trouve' | 'vide' | 'stupefait';
type Segment = SegmentCT;
const DEPART = DEPART_CT;
/** Dans une ouverture : il frappe, prend la poignée, la porte s'ouvre, puis il réagit. */
const OUVRE = { poignee: 0.3, porte: 0.45, reaction: 0.52 };

/** Le calendrier partagé, ramené à la durée de l'étape (elle le suit déjà ; seulement si elle était plus courte). */
function calendrier(tournee: PassageCT[], duree: number): { segments: Segment[]; fin: number } {
  const { segments, fin } = calendrierControleur(tournee);
  const f = Math.min(1, Math.max(1, duree) / Math.max(1, fin + FIN_TOURNEE_CT));
  return { segments: segments.map((s) => ({ ...s, t0: s.t0 * f, t1: s.t1 * f })), fin: fin * f };
}

/** Ce que fait le contrôleur à l'instant t : sa position (en travées), sa pose, son sens. */
function etatControleur(segs: Segment[], t: number, occupe: (k: number) => boolean): { x: number; pose: Pose; gauche: boolean; seg: Segment | null } {
  if (!segs.length) return { x: DEPART, pose: 'marche', gauche: false, seg: null };
  const s = segs.find((x) => t < x.t1) ?? segs[segs.length - 1];
  const u = Math.min(1, Math.max(0, (t - s.t0) / Math.max(1, s.t1 - s.t0)));
  if (s.type === 'marche') return { x: s.de + (s.vers - s.de) * u, pose: 'marche', gauche: s.vers < s.de, seg: s };
  if (s.type === 'feinte') return { x: s.de, pose: u < 0.82 ? (s.feinte as FeinteCT) : 'marche', gauche: false, seg: s };
  let pose: Pose = u < OUVRE.poignee ? 'frappe' : u < OUVRE.reaction ? 'poignee' : s.i === NB_COMPARTIMENTS - 1 ? 'stupefait' : occupe(s.porte) ? 'trouve' : 'vide';
  // Après l'ouverture, il recule pour laisser voir le compartiment.
  const x = u < OUVRE.reaction ? s.de : s.de - 0.3 * Math.min(1, (u - OUVRE.reaction) / 0.15);
  if (t >= s.t1 && s === segs[segs.length - 1]) pose = s.i === NB_COMPARTIMENTS - 1 ? 'stupefait' : pose;
  return { x, pose, gauche: false, seg: s };
}

// ---------------------------------------------------------------------------------------------------------------
// Le bonus

export function BonusControleur({ v, b, nom, ouvert, choisir, roue }: { v: VueBW; b: VueBonusBW; nom: string; ouvert: boolean; choisir: (o: number) => void; roue?: ReactNode }) {
  const c = b.controleur;
  const tournee = c?.tournee ?? null;
  const mien = b.mesChoix[0] ?? null;
  const salon = b.choixSalon[0] ?? [];
  const M = Math.max(1, b.multiplicateur);
  const occupe = (k: number) => (salon[k] ?? 0) > 0 || mien === k;

  // L'horloge de l'étape (recalée sur le serveur) et un battement de 10 par seconde.
  const cle = `${v.numero}-${b.etape}-${v.phase}`;
  const horloge = useRef({ cle: '', debut: 0 });
  const estime = performance.now() - ((v.duree ?? 0) - (v.reste ?? 0));
  if (horloge.current.cle !== cle) horloge.current = { cle, debut: estime };
  else horloge.current.debut = Math.min(horloge.current.debut, estime);
  const [maintenant, setMaintenant] = useState(() => performance.now());
  useEffect(() => {
    const id = window.setInterval(() => setMaintenant(performance.now()), 100);
    return () => window.clearInterval(id);
  }, []);
  const tau = maintenant - horloge.current.debut;

  const enTournee = nom === 'tournee';
  const fini = nom === 'revele';
  const dureeTournee = (enTournee ? v.duree : null) || b.etapes.find((e) => e.nom === 'tournee')?.duree || Infinity;
  const cal = useMemo(() => (tournee ? calendrier(tournee, dureeTournee) : { segments: [], fin: 0 }), [tournee, dureeTournee]);
  const ordre = useMemo(() => (tournee ? ordreControleur(tournee) : []), [tournee]);
  /** Le temps de tournée (pendant la révélation : la tournée est finie). */
  const t = enTournee ? tau : fini ? cal.fin + 1 : -1;
  /** L'instant où la porte k s'ouvre. */
  const ouvreA = (k: number) => {
    const s = cal.segments.find((x) => x.type === 'ouvre' && x.porte === k);
    return s ? s.t0 + (s.t1 - s.t0) * OUVRE.porte : Infinity;
  };
  const ouverte = (k: number) => t >= ouvreA(k);
  const nOuvertes = ordre.filter((k) => ouverte(k)).length;
  const etat = etatControleur(cal.segments, Math.max(0, t), occupe);
  const feinteEnCours = etat.seg?.type === 'feinte' && etat.pose !== 'marche' ? etat.seg.porte : null;
  const tresor = ordre[NB_COMPARTIMENTS - 1] ?? null;

  // La scène : le couloir défile et suit le contrôleur (image par image).
  const refs = useRef({ scene: { current: null } as RefObject<HTMLDivElement>, piste: { current: null } as RefObject<HTMLDivElement>, ctrl: { current: null } as RefObject<HTMLDivElement> }).current;
  const donnees = useRef({ nom, debut: 0, segs: cal.segments, occupe, mien });
  donnees.current = { nom, debut: horloge.current.debut, segs: cal.segments, occupe, mien };
  useEffect(() => {
    const scene = refs.scene.current;
    if (!scene) return;
    const g = { W: 0, H: 0, P: 0, hc: 0 };
    const mesurer = () => {
      g.W = scene.clientWidth;
      g.H = scene.clientHeight;
      const portrait = g.H > g.W * 1.05;
      // Le couloir en bas de la scène ; une travée (une porte) : sa hauteur × 0,875.
      g.hc = portrait ? Math.min(g.H * 0.62, g.W * 0.82) : Math.min(g.H * 0.8, g.W * 0.5);
      g.P = g.hc * 0.875;
      scene.style.setProperty('--hc', `${g.hc}px`);
      scene.style.setProperty('--travee', `${g.P}px`);
    };
    mesurer();
    const ro = new ResizeObserver(mesurer);
    ro.observe(scene);
    let cam = Number.NaN;
    let avant = performance.now();
    let raf = 0;
    const image = () => {
      raf = requestAnimationFrame(image);
      const d = donnees.current;
      const n = performance.now();
      const dt = Math.min(250, n - avant);
      avant = n;
      if (!g.W) return;
      const tt = n - d.debut;
      const visibles = g.W / g.P;
      // Le mur continue au-delà des portes : la caméra peut suivre le contrôleur jusqu'au bout du couloir.
      const bornes = (x: number) => Math.min(NB_COMPARTIMENTS + 0.4, Math.max(-0.4, x));
      let cible: number;
      let e: ReturnType<typeof etatControleur> | null = null;
      if (d.nom === 'tournee' || d.nom === 'revele') {
        e = etatControleur(d.segs, d.nom === 'revele' ? 1e9 : Math.max(0, tt), d.occupe);
        cible = e.x + (e.gauche ? -0.3 : 0.25); // un peu d'avance dans le sens de la marche
      } else if (d.nom === 'compartiments' && d.mien !== null) cible = d.mien + 0.5; // ma cachette, en attendant qu'il arrive
      else cible = NB_COMPARTIMENTS / 2 + (NB_COMPARTIMENTS / 2 - visibles / 2 + 0.15) * Math.sin(tt / 4200 - Math.PI / 2);
      cible = bornes(cible);
      cam = Number.isNaN(cam) ? cible : cam + (cible - cam) * (1 - Math.exp(-dt * (d.nom === 'compartiments' ? 0.005 : 0.012)));
      const piste = refs.piste.current;
      if (piste) piste.style.transform = `translate3d(${g.W / 2 - cam * g.P}px, 0, 0)`;
      const ctrl = refs.ctrl.current;
      if (ctrl && e) {
        const pas = e.pose === 'marche' && !mouvementReduit() ? Math.abs(Math.sin(tt / 140)) * g.hc * 0.012 : 0;
        ctrl.style.transform = `translate3d(${e.x * g.P}px, ${-pas}px, 0)`;
        ctrl.dataset.pose = e.pose;
        ctrl.dataset.gauche = e.gauche ? '1' : '';
      }
    };
    raf = requestAnimationFrame(image);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [refs]);

  // Les sons de la tournée.
  const joues = useRef(new Set<string>());
  useEffect(() => {
    const fois = (k: string, f: () => void) => {
      const id = `${cle}-${k}`;
      if (joues.current.has(id)) return;
      joues.current.add(id);
      f();
    };
    if (v.phase !== 'bonus' || !enTournee) return;
    cal.segments.forEach((s, n) => {
      if (s.type === 'marche' || t < s.t0) return;
      if (s.type === 'feinte') {
        if (s.feinte === 'frappe' && t < s.t0 + 600) fois(`f${n}`, () => jouerEffet('ct_toc', { volume: 0.5 }));
        return;
      }
      const dt = s.t1 - s.t0;
      if (t < s.t0 + dt * 0.3) fois(`toc${n}`, () => jouerEffet('ct_toc'));
      if (t >= s.t0 + dt * OUVRE.porte && t < s.t1) {
        fois(`porte${n}`, () => jouerEffet('ct_porte'));
        if (s.i === NB_COMPARTIMENTS - 1) fois(`tresor${n}`, () => jouerEffet('gd_eclat', { volume: 0.9 }));
        else if (occupe(s.porte)) fois(`siffle${n}`, () => jouerEffet('bw_sifflet', { volume: 0.7 }));
      }
    });
  });

  // L'annonce du moment.
  let annonce: { titre: string; sous?: string; ton?: string } | null = null;
  const seg = etat.seg;
  if (enTournee && seg?.type === 'ouvre' && t >= ouvreA(seg.porte) && t < seg.t1 + 300) {
    const k = seg.porte;
    const x = PALIERS_CONTROLEUR[seg.i];
    if (seg.i === NB_COMPARTIMENTS - 1)
      annonce = {
        titre: tr(`Le trésor du n° ${k + 1} !`, `The treasure of no. ${k + 1}!`),
        sous: `${fx(x * M)}${c?.jackpot ? ` + JACKPOT ${NOMS_JACKPOTS[c.jackpot]}` : ''}`,
        ton: 'tresor',
      };
    else if (mien === k) annonce = { titre: tr('Démasqué !', 'Caught!'), sous: tr(`Tu gardes ${fx(x * M)}`, `You keep ${fx(x * M)}`), ton: 'mien' };
    else if (occupe(k)) annonce = { titre: tr(`N° ${k + 1} : ${salon[k]} débusqué${salon[k] > 1 ? 's' : ''} !`, `No. ${k + 1}: ${salon[k]} caught!`), sous: fx(x * M) };
    else annonce = { titre: tr(`N° ${k + 1} : personne`, `No. ${k + 1}: nobody`), ton: 'petit' };
  } else if (enTournee && feinteEnCours !== null && feinteEnCours === mien) annonce = { titre: tr('Il est devant ta porte…', 'He’s at your door…'), ton: 'peur' };
  else if (enTournee && seg?.type === 'marche' && mien !== null && !ouverte(mien)) {
    // Juste après une feinte devant ma porte : ouf.
    const avant = cal.segments[cal.segments.indexOf(seg) - 1];
    if (avant?.type === 'feinte' && avant.porte === mien) annonce = { titre: tr('Ouf !', 'Phew!'), ton: 'ouf' };
  }

  const palier = PALIERS_CONTROLEUR[Math.min(nOuvertes, NB_COMPARTIMENTS - 1)];
  const enChoix = nom === 'compartiments';
  // (dans le couloir, les portes ne se choisissent plus : le choix a son écran, les huit portes)
  const peutChoisir = false;
  const t0Intro = useMemo(() => (nom === 'intro' ? Math.max(0, (v.duree ?? 0) - (v.reste ?? 0)) : 0), [cle]); // eslint-disable-line react-hooks/exhaustive-deps
  const mienOuverte = mien !== null && ouverte(mien);

  return (
    <div className={`ct ${nom}`} ref={refs.scene} style={nom === 'intro' ? ({ '--t0': `${-t0Intro}ms` } as CSSProperties) : undefined}>
      <div className="ct-plafond" />
      <div className="ct-couloir">
        <div className="ct-piste" ref={refs.piste}>
          {Array.from({ length: NB_COMPARTIMENTS }, (_, k) => {
            const ov = ouverte(k);
            const vue = k === tresor ? 'tresor' : occupe(k) ? 'fouillee' : 'vide';
            const i = ordre.indexOf(k);
            return (
              <div
                key={k}
                className={`ct-porte ${ov ? 'ouverte' : ''} ${feinteEnCours === k ? 'tremble' : ''} ${mien === k ? 'mienne' : ''} ${ov && k === tresor ? 'tresor' : ''} ${peutChoisir ? 'choix' : ''} ${enTournee && seg?.porte === k && !ov ? 'vise' : ''}`}
                style={{ '--k': k } as CSSProperties}
                {...(peutChoisir
                  ? { role: 'button', tabIndex: 0, 'aria-label': tr(`Compartiment ${k + 1}`, `Compartment ${k + 1}`), onClick: () => choisir(k), onKeyDown: (e: { key: string }) => (e.key === 'Enter' || e.key === ' ') && choisir(k) }
                  : {})}
              >
                {ov && <img className="ct-interieur" src={IMG(`ct-porte-${vue}`)} alt="" draggable={false} />}
                {ov && k === tresor && !mouvementReduit() && <img className="ct-lueur" src={IMG('ct-lueur')} alt="" draggable={false} />}
                <img className="ct-battant" src={IMG('ct-porte')} alt="" draggable={false} />
                <b className="ct-numero">{k + 1}</b>
                {!ov && (mien === k || (salon[k] ?? 0) > 0) && (
                  <span className="ct-caches">
                    {mien === k && <i>★</i>}
                    {(salon[k] ?? 0) > 0 && <small>{salon[k]}</small>}
                  </span>
                )}
                {ov && i >= 0 && <span className="ct-gain">{i === NB_COMPARTIMENTS - 1 ? tr('Trésor', 'Treasure') : fx(PALIERS_CONTROLEUR[i] * M)}</span>}
              </div>
            );
          })}
          {(enTournee || fini) && (
            <div className="ct-controleur" ref={refs.ctrl} data-pose="marche">
              {(['marche', 'frappe', 'ecoute', 'poignee', 'trouve', 'vide', 'stupefait'] as Pose[]).map((p) => (
                <img key={p} className={p} src={IMG(`ct-${p}`)} alt="" draggable={false} />
              ))}
              {etat.pose === 'trouve' && !mouvementReduit() && <img className="ct-coup-sifflet" src={IMG('ct-sifflet')} alt="" draggable={false} />}
            </div>
          )}
        </div>
      </div>

      {/* L'intro : « Le sifflet dans la nuit ». */}
      {nom === 'intro' && <IntroControleur t0={t0Intro} roue={roue} />}

      {/* Le choix : les huit portes de la voiture-lits sur le même écran (deux rangées de quatre) ; la mienne s'entoure
          d'une lueur jaune. */}
      {enChoix && (
        <div className="ct-portes-choix" role="group" aria-label={tr('Choisis ton compartiment', 'Pick your compartment')}>
          <div className="ct-portes-grille">
            {Array.from({ length: NB_COMPARTIMENTS }, (_, k) => (
              <button
                key={k}
                type="button"
                className={`ct-porte-choix ${mien === k ? 'mienne' : ''} ${mien !== null && mien !== k ? 'autre' : ''}`}
                style={{ '--k': k } as CSSProperties}
                onClick={() => choisir(k)}
                disabled={!ouvert}
                aria-pressed={mien === k}
                aria-label={tr(`Compartiment ${k + 1}`, `Compartment ${k + 1}`)}
              >
                <i className="ct-lueur-choix" />
                <img src={IMG('ct-porte')} alt="" draggable={false} />
                <b className="ct-numero">{k + 1}</b>
                {(mien === k || (salon[k] ?? 0) > 0) && (
                  <span className="ct-caches">
                    {mien === k && <i>★</i>}
                    {(salon[k] ?? 0) > 0 && <small>{salon[k]}</small>}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Le plan de la voiture pendant la tournée : les huit compartiments, leur état, et le palier en cours. */}
      {(enTournee || fini) && (
        <div className="ct-haut">
          <div className="ct-plan" aria-label={tr('Plan de la voiture', 'Car plan')}>
            <div className="ct-palier">
              {mienOuverte || nOuvertes >= NB_COMPARTIMENTS ? (
                <small>{tr('Portes ouvertes', 'Doors opened')} {nOuvertes}/8</small>
              ) : (
                <>
                  <small>{mien !== null ? tr('Toujours caché', 'Still hidden') : tr('Palier', 'Level')}</small>
                  <strong key={palier}>{fx(palier * M)}</strong>
                </>
              )}
            </div>
            <ol>
              {Array.from({ length: NB_COMPARTIMENTS }, (_, k) => {
                const ov = ouverte(k);
                const i = ordre.indexOf(k);
                return (
                  <li key={k} className={`${ov ? (k === tresor ? 'tresor' : occupe(k) ? 'trouve' : 'vide') : ''} ${mien === k ? 'mien' : ''} ${seg?.porte === k && !ov && enTournee ? 'vise' : ''}`}>
                    <b>{k + 1}</b>
                    <small>{ov ? (k === tresor ? '★' : fx(PALIERS_CONTROLEUR[i] * M)) : mien === k ? tr('toi', 'you') : salon[k] ? `${salon[k]}` : ''}</small>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      )}

      {annonce && (
        <div className={`ct-annonce ${annonce.ton ?? ''}`} key={annonce.titre} role="status">
          <strong>{annonce.titre}</strong>
          {annonce.sous && <span>{annonce.sous}</span>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// L'intro (7,3 s) : « Le sifflet dans la nuit ». La roue est encore là ; ses lumières vacillent et s'éteignent d'un coup.
// Dans le noir, un sifflet ; le faisceau d'une lanterne balaie l'écran et n'éclaire que ce qu'il touche : une porte de
// compartiment, une poignée qui tourne, le contrôleur sous sa casquette, sifflet aux lèvres. Puis sa lanterne l'éclaire
// tout entier, l'image s'assombrit : « Cachez-vous ! », et les huit portes du choix apparaissent devant lui.

const INTRO_CT = { noir: 900, sifflet: 1_250, porte: 1_500, poignee: 3_050, controleur: 4_600, lumiere: 6_300 };

function IntroControleur({ t0, roue }: { t0: number; roue?: ReactNode }) {
  const reduit = mouvementReduit();
  useEffect(() => {
    if (reduit) return;
    const sons: [number, () => void][] = [
      [INTRO_CT.noir, () => jouerEffet('cti_noir', { volume: 1 })],
      [INTRO_CT.sifflet, () => jouerEffet('bw_sifflet', { volume: 1, vitesse: 1.15 })],
      [INTRO_CT.poignee + 650, () => jouerEffet('cti_grince', { volume: 0.9 })],
      [INTRO_CT.controleur + 750, () => jouerEffet('bw_sifflet', { volume: 1, vitesse: 1.25 })],
      [INTRO_CT.lumiere + 100, () => jouerEffet('gd_eclat', { volume: 0.55 })],
    ];
    const ids = sons.filter(([x]) => x >= t0).map(([x, f]) => window.setTimeout(f, x - t0));
    return () => ids.forEach((i) => window.clearTimeout(i));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="cti" aria-hidden="true">
      <div className="cti-roue-plan">{roue && <div className="cti-roue">{roue}</div>}</div>
      {(['porte', 'poignee', 'controleur'] as const).map((n) => (
        <div key={n} className={`cti-plan ${n}`}>
          <div className="cti-cadre">
            <img className="cti-sombre" src={IMG(`cti-${n}`)} alt="" draggable={false} />
            <img className="cti-eclaire" src={IMG(`cti-${n}`)} alt="" draggable={false} />
          </div>
          <img className="cti-faisceau" src={IMG('cti-faisceau')} alt="" draggable={false} />
        </div>
      ))}
      <i className="cti-lumiere" />
      <p className="cti-cri">{tr('Cachez-vous !', 'Hide!')}</p>
    </div>
  );
}
