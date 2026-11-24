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
import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { NB_COMPARTIMENTS, ordreControleur, PALIERS_CONTROLEUR, type FeinteCT, type JackpotBW, type PassageCT, type VueBonusBW, type VueBW } from '../../shared/baronWheel';
import { fx } from './CasinoBaronExpress';
import { tr } from './traduction';
import { jouerEffet, mouvementReduit } from './ui';
import './controleur.css';

/** Les images du Contrôleur (sans chemin ni extension), préchargées avant le bonus. */
export const IMAGES_CONTROLEUR_NOMS = [
  'ct-logo',
  'ct-couloir',
  'ct-porte',
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
];
const IMG = (n: string) => `/cartes/${n}.webp`;
const NOMS_JACKPOTS: Record<JackpotBW, string> = { mini: 'MINI', minor: 'MINOR', major: 'MAJOR', grand: 'GRAND' };

// ---------------------------------------------------------------------------------------------------------------
// Le calendrier de la tournée (le même sur tous les écrans : tiré de la tournée du serveur)

type Pose = 'marche' | FeinteCT | 'trouve' | 'vide' | 'stupefait';
interface Segment {
  t0: number;
  t1: number;
  type: 'marche' | 'ouvre' | 'feinte';
  porte: number;
  /** marche : d'où il part et où il va (en travées ; la porte k est au milieu de la travée k). */
  de: number;
  vers: number;
  /** ouvre : la place de cette porte dans l'ordre d'ouverture. */
  i: number;
  feinte: FeinteCT | null;
}
/** Où il se tient : devant la porte, un peu à gauche (il la regarde) ; à côté, une fois ouverte (elle se voit). */
const DEVANT = -0.3;
const DEPART = -1.1;
/** Dans une ouverture : il frappe, prend la poignée, la porte s'ouvre, puis il réagit. */
const OUVRE = { poignee: 0.3, porte: 0.45, reaction: 0.52 };

function calendrier(tournee: PassageCT[], duree: number): { segments: Segment[]; fin: number } {
  const brut: Segment[] = [];
  let t = 0;
  let x = DEPART;
  let i = 0;
  for (const p of tournee) {
    const cible = p.porte + 0.5 + DEVANT;
    const d = Math.abs(cible - x);
    if (d > 0.01) {
      const dt = 180 + 330 * d;
      brut.push({ t0: t, t1: t + dt, type: 'marche', porte: p.porte, de: x, vers: cible, i: -1, feinte: null });
      t += dt;
      x = cible;
    }
    // Plus il avance, plus il prend son temps : la tension monte.
    const dt = p.feinte ? 1150 : 1250 + 110 * i;
    brut.push({ t0: t, t1: t + dt, type: p.feinte ? 'feinte' : 'ouvre', porte: p.porte, de: x, vers: x, i: p.feinte ? -1 : i, feinte: p.feinte });
    t += dt;
    if (!p.feinte) i += 1;
  }
  // Ramené à la durée de l'étape (si la tournée est trop longue).
  const f = Math.min(1, Math.max(1, duree - 500) / Math.max(1, t));
  return { segments: brut.map((s) => ({ ...s, t0: s.t0 * f, t1: s.t1 * f })), fin: t * f };
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

export function BonusControleur({ v, b, nom, ouvert, choisir }: { v: VueBW; b: VueBonusBW; nom: string; ouvert: boolean; choisir: (o: number) => void }) {
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
  const dureeTournee = (enTournee ? v.duree : null) ?? b.etapes.find((e) => e.nom === 'tournee')?.duree ?? 17_000;
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
  const donnees = useRef({ nom, debut: 0, segs: cal.segments, occupe });
  donnees.current = { nom, debut: horloge.current.debut, segs: cal.segments, occupe };
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
      } else cible = NB_COMPARTIMENTS / 2 + (NB_COMPARTIMENTS / 2 - visibles / 2 + 0.15) * Math.sin(tt / 2600 - Math.PI / 2);
      cible = bornes(cible);
      cam = Number.isNaN(cam) ? cible : cam + (cible - cam) * (1 - Math.exp(-dt * 0.012));
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
  const mienOuverte = mien !== null && ouverte(mien);

  return (
    <div className={`ct ${nom}`} ref={refs.scene}>
      <div className="ct-plafond" />
      <div className="ct-couloir">
        <div className="ct-piste" ref={refs.piste}>
          {Array.from({ length: NB_COMPARTIMENTS }, (_, k) => {
            const ov = ouverte(k);
            const vue = k === tresor ? 'tresor' : occupe(k) ? 'fouillee' : 'vide';
            const i = ordre.indexOf(k);
            return (
              <div key={k} className={`ct-porte ${ov ? 'ouverte' : ''} ${feinteEnCours === k ? 'tremble' : ''} ${mien === k ? 'mienne' : ''} ${ov && k === tresor ? 'tresor' : ''}`} style={{ '--k': k } as CSSProperties}>
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

      {nom === 'intro' && <img className="ct-logo" src={IMG('ct-logo')} alt={tr('Le Contrôleur', 'The Conductor')} draggable={false} />}

      {/* Le plan de la voiture : les huit compartiments, et le palier en cours pour ceux qui restent cachés. */}
      {(enTournee || fini) && (
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
                <li key={k} className={`${ov ? (k === tresor ? 'tresor' : occupe(k) ? 'trouve' : 'vide') : ''} ${mien === k ? 'mien' : ''} ${seg?.porte === k && !ov ? 'vise' : ''}`}>
                  <b>{k + 1}</b>
                  <small>{ov ? (k === tresor ? '★' : fx(PALIERS_CONTROLEUR[i] * M)) : mien === k ? tr('toi', 'you') : salon[k] ? `${salon[k]}` : ''}</small>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {/* Le choix du compartiment : les huit portes, et ce que vaut chaque rang d'ouverture. */}
      {nom === 'compartiments' && (
        <div className="ct-choix">
          <div className="ct-grille" role="group" aria-label={tr('Choisis ton compartiment', 'Pick your compartment')}>
            {Array.from({ length: NB_COMPARTIMENTS }, (_, k) => (
              <button key={k} type="button" className={`${mien === k ? 'choisi' : ''} ${mien !== null && mien !== k ? 'autre' : ''}`} onClick={() => choisir(k)} disabled={!ouvert}>
                <span>N°</span>
                <strong>{k + 1}</strong>
                {(salon[k] ?? 0) > 0 && <i>{salon[k]}</i>}
              </button>
            ))}
          </div>
          <ol className="ct-echelle" aria-label={tr('Les paliers', 'The levels')}>
            {PALIERS_CONTROLEUR.map((x, i) => (
              <li key={i} className={i === NB_COMPARTIMENTS - 1 ? 'tresor' : ''}>
                <small>{i === NB_COMPARTIMENTS - 1 ? tr('Dernière', 'Last') : `${i + 1}${tr(i ? 'e' : 're', ['st', 'nd', 'rd'][i] ?? 'th')}`}</small>
                <b>{fx(x * M)}</b>
                {i === NB_COMPARTIMENTS - 1 && <em>+ Jackpot</em>}
              </li>
            ))}
          </ol>
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
