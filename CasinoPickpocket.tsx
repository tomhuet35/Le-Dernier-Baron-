/**
 * Le Pickpocket (The Baron's Wheel) : le Bal du Grand Hôtel. Au milieu des couples qui valsent, le Pickpocket subtilise
 * le collier de diamants d'une comtesse (le gros butin, révélé au vol). L'inspecteur arrive : il glisse le collier sous
 * l'un des trois hauts-de-forme d'un guéridon et les mélange à toute vitesse (le bonneteau). Chaque joueur choisit un
 * chapeau ; les deux autres cachent une montre et une bague (les petits butins).
 *
 * Le serveur a tiré le butin et les trois chapeaux dès le début du bonus ; il n'envoie le butin qu'au vol, et le contenu
 * des chapeaux qu'au retournement (le mélange est un spectacle : on ne peut pas suivre le collier). Les étapes :
 * l'intro (le bal), le vol (le bal, puis le bonneteau), le choix, le retournement.
 * Les personnages, le guéridon et les chapeaux sont placés à chaque image (requestAnimationFrame) d'après l'horloge de
 * l'étape ; les panneaux suivent un battement de 10 par seconde.
 */
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { BUTIN_PICKPOCKET, DUREES_BW, PETITES_MALLETTES, type VueBonusBW, type VueBW } from '../../shared/baronWheel';
import { ValeurMultipliee } from './CasinoBaronExpress';
import { PluieLingots } from './casinoOutils';
import { tr } from './traduction';
import { jouerEffet, mouvementReduit } from './ui';
import './pickpocket.css';

const IMG = (n: string) => `/cartes/bw-pp-${n}.webp`;

/** Toutes les images du Bal (sans chemin ni extension), préchargées avant le bonus. */
export const IMAGES_PICKPOCKET_NOMS = [
  'bal-paysage',
  'bal-portrait',
  'pick-faufile',
  'pick-vole',
  'pick-melange',
  'pick-salue',
  'comtesse',
  'couple',
  'inspecteur',
  'gueridon',
  'chapeau',
  'collier',
  'montre',
  'bague',
  'diamants',
  'poursuite',
].map((n) => `bw-pp-${n}`);

/** Les rapports hauteur / largeur des images. */
const R = {
  faufile: 881 / 560,
  vole: 1341 / 560,
  melange: 761 / 760,
  salue: 796 / 760,
  comtesse: 855 / 560,
  couple: 738 / 700,
  inspecteur: 854 / 560,
  gueridon: 535 / 760,
  chapeau: 292 / 360,
};
/** Les deux salles de bal : la taille de l'image et le début du parquet (part de la hauteur). */
const BALS = {
  paysage: { img: 'bal-paysage', w: 1600, h: 900, parquet: 0.63 },
  portrait: { img: 'bal-portrait', w: 1000, h: 1250, parquet: 0.5 },
};

// ---------------------------------------------------------------------------------------------------------------
// Le calendrier (millisecondes d'un vol de 11 s, d'un retournement de 7 s)

const REF_VOL = DUREES_BW.vol;
const REF_REVELE = DUREES_BW.revelePick;
const VOL = { entre: 800, arrive: 3000, vole: 3000, inspecteur: 5000, sifflet: 5300, fuite: 6000, table: 7000, chute: 7150, couvre: 7500, couvert: 7950, melange: 8150 };
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
const DUREES_ECHANGES = ECHANGES.map((_, i) => Math.round(420 - i * 26));
const DEBUTS_ECHANGES = DUREES_ECHANGES.map((_, i) => VOL.melange + DUREES_ECHANGES.slice(0, i).reduce((a, d) => a + d + 25, 0));
/** Le retournement : le premier chapeau des autres, le second, puis le mien ; un chapeau se lève en 450 ms. */
const RET = { premier: 500, second: 1500, mien: 3000, leve: 450 };

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
    const t0 = DEBUTS_ECHANGES[i];
    const q = (s - t0) / DUREES_ECHANGES[i];
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
// La scène

interface Geo {
  W: number;
  H: number;
  portrait: boolean;
  /** Le bal : hauteur des personnages, ligne de leurs pieds. */
  hc: number;
  pied: number;
  /** La table : le guéridon (largeur, haut), le plateau (où posent les chapeaux), les places des chapeaux. */
  gw: number;
  gTop: number;
  plateau: number;
  hw: number;
  places: number[];
}
function mesurer(W: number, H: number): Geo {
  const portrait = H > W * 1.05;
  const hc = portrait ? H * 0.42 : H * 0.6;
  const pied = portrait ? H * 0.9 : H * 0.97;
  const gw = portrait ? Math.min(W * 0.92, H * 0.7) : Math.min(W * 0.62, H * 0.95);
  const plateau = H * (portrait ? 0.66 : 0.74);
  const gTop = plateau - gw * R.gueridon * 0.2;
  const hw = gw * 0.25;
  return { W, H, portrait, hc, pied, gw, gTop, plateau, hw, places: [-1, 0, 1].map((k) => W / 2 + k * gw * 0.3) };
}

/** Place un élément : centré sur x, le bas sur y, de largeur w (miroir : retourné). */
function placer(el: HTMLElement | null, x: number, y: number, w: number, ratio: number, opts: { miroir?: boolean; rot?: number; visible?: boolean; opacite?: number } = {}) {
  if (!el) return;
  const visible = opts.visible ?? true;
  el.style.visibility = visible ? 'visible' : 'hidden';
  if (!visible) return;
  const h = w * ratio;
  el.style.width = `${w}px`;
  el.style.opacity = String(opts.opacite ?? 1);
  el.style.transform = `translate3d(${x - w / 2}px, ${y - h}px, 0)${opts.rot ? ` rotate(${opts.rot}deg)` : ''}${opts.miroir ? ' scaleX(-1)' : ''}`;
}

type Ref<T> = RefObject<T>;
const ref = <T,>(): Ref<T> => ({ current: null });

interface Refs {
  scene: Ref<HTMLDivElement>;
  coupleG: Ref<HTMLImageElement>;
  coupleD: Ref<HTMLImageElement>;
  comtesse: Ref<HTMLImageElement>;
  faufile: Ref<HTMLImageElement>;
  vole: Ref<HTMLImageElement>;
  inspecteur: Ref<HTMLImageElement>;
  eclat: Ref<HTMLImageElement>;
  gueridon: Ref<HTMLImageElement>;
  melange: Ref<HTMLImageElement>;
  salue: Ref<HTMLImageElement>;
  collierChute: Ref<HTMLImageElement>;
  chapeaux: Ref<HTMLButtonElement>[];
  objets: Ref<HTMLImageElement>[];
  valeurs: Ref<HTMLSpanElement>[];
  diamants: Ref<HTMLImageElement>;
  coupe: Ref<HTMLDivElement>;
  poursuite: Ref<HTMLImageElement>;
}

interface Donnees {
  nom: string;
  debut: number;
  echelle: number;
  /** Les objets sous les chapeaux (null : pas encore révélés), l'ordre du retournement. */
  objets: ('collier' | 'montre' | 'bague' | null)[];
  ordre: number[];
  choix: number | null;
}

function useScene(d: { current: Donnees }, r: Refs) {
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
      if (!W || !H) return;
      const s = (performance.now() - x.debut) * x.echelle;
      const g = mesurer(W, H);
      const reduit = mouvementReduit();
      const vol = x.nom === 'vol';
      const bal = vol && s < VOL.table;
      const table = (vol && s >= VOL.table) || x.nom === 'mallettes' || x.nom === 'revele';
      el.classList.toggle('pp-table', table);
      const coupe = r.coupe.current;
      if (coupe) coupe.style.opacity = vol && s >= VOL.table - 60 ? String(1 - borne((s - VOL.table) / 500)) : '0';

      // Le bal : les couples valsent, la comtesse danse, le Pickpocket se faufile, vole, s'enfuit ; l'inspecteur arrive.
      const valse = (p: number) => (reduit ? 0 : Math.sin(s / 520 + p));
      placer(r.coupleG.current, W * 0.15 + valse(0) * W * 0.03, g.pied - H * 0.06, g.hc * 0.78 / R.couple, R.couple, { visible: bal, rot: valse(1) * 3 });
      placer(r.coupleD.current, W * 0.85 + valse(2) * W * 0.03, g.pied - H * 0.06, g.hc * 0.78 / R.couple, R.couple, { visible: bal, rot: valse(3) * 3, miroir: true });
      const xComtesse = W * (g.portrait ? 0.68 : 0.62);
      const alerte = s > VOL.sifflet;
      placer(r.comtesse.current, xComtesse + valse(4) * W * 0.012 + (alerte ? Math.sin(s / 40) * 2 : 0), g.pied, g.hc / R.comtesse, R.comtesse, { visible: bal, rot: valse(5) * 2 });
      const xVole = xComtesse - g.hc * (g.portrait ? 0.43 : 0.47);
      const entre = s >= VOL.entre && s < VOL.arrive;
      const fuit = s >= VOL.fuite;
      const xFaufile = entre ? -W * 0.25 + (xVole + W * 0.25) * lisse((s - VOL.entre) / (VOL.arrive - VOL.entre)) : xVole - (xVole + W * 0.35) * borne((s - VOL.fuite) / 900) ** 1.4;
      const bond = reduit ? 0 : Math.abs(Math.sin(s / 140)) * H * 0.012;
      placer(r.faufile.current, xFaufile, g.pied - bond, g.hc / R.faufile, R.faufile, { visible: bal && (entre || fuit), miroir: fuit });
      placer(r.vole.current, xVole, g.pied, g.hc / R.vole, R.vole, { visible: bal && s >= VOL.vole && s < VOL.fuite });
      const xInsp = W * 1.2 - (W * 1.2 - W * (g.portrait ? 0.8 : 0.84)) * lisse((s - VOL.inspecteur) / 900);
      placer(r.inspecteur.current, xInsp, g.pied + H * 0.01, g.hc * 1.02 / R.inspecteur, R.inspecteur, { visible: bal && s >= VOL.inspecteur, miroir: true });
      // L'éclat du collier, au cou de la comtesse.
      const ec = (s - VOL.vole) / 900;
      placer(r.eclat.current, xComtesse - g.hc * 0.06, g.pied - g.hc * 0.62, g.hc * 0.9, 1, { visible: bal && ec > 0 && ec < 1, opacite: Math.sin(Math.PI * borne(ec)), rot: ec * 40 });

      // La table : le guéridon, le Pickpocket derrière, les chapeaux, ce qu'ils cachent.
      const leveA = (k: number) => (x.nom === 'revele' && x.objets[k] ? borne((s - RET[(['premier', 'second', 'mien'] as const)[Math.max(0, x.ordre.indexOf(k))]]) / RET.leve) : 0);
      const finRetour = x.nom === 'revele' && x.choix !== null && leveA(x.ordre[2]) > 0;
      // Le Pickpocket, derrière le guéridon : ses mains posées sur le bord du plateau.
      const appui = g.gTop + g.gw * R.gueridon * 0.05;
      placer(r.melange.current, W / 2, appui, g.gw * 0.5, R.melange, { visible: table && !finRetour });
      placer(r.salue.current, W / 2, appui, g.gw * 0.5, R.salue, { visible: table && finRetour });
      placer(r.gueridon.current, W / 2, g.gTop + g.gw * R.gueridon, g.gw, R.gueridon, { visible: table });
      const hh = g.hw * R.chapeau;
      const melange = vol ? chapeauxA(s) : null;
      r.chapeaux.forEach((rc, k) => {
        let cx = g.places[k];
        let y = g.plateau;
        let rot = 0;
        let echelle = 1;
        if (melange) {
          const m = melange[k];
          const u = lisse(m.q);
          cx = g.places[m.place] + (g.places[m.vers] - g.places[m.place]) * u;
          const arc = Math.sin(Math.PI * u);
          y += m.devant ? arc * hh * 0.12 : -arc * hh * 0.3;
          echelle = m.q > 0 ? (m.devant ? 1 + 0.06 * arc : 1 - 0.08 * arc) : 1;
          // Le chapeau du milieu descend sur le collier.
          if (k === 1) y -= hh * 1.8 * (1 - lisse((s - VOL.couvre) / (VOL.couvert - VOL.couvre)));
          if (rc.current) rc.current.style.zIndex = m.devant ? '6' : '5';
        } else {
          const l = leveA(k);
          y -= hh * 1.05 * Math.sin((Math.PI / 2) * l);
          rot = -14 * l;
          if (rc.current) rc.current.style.zIndex = '5';
        }
        const w = g.hw * echelle;
        placer(rc.current, cx, y, w, R.chapeau, { visible: table, rot });
        // Ce que cache le chapeau, sur le plateau ; et sa valeur, devant.
        const obj = x.objets[k];
        const o = r.objets[k].current;
        const ow = obj === 'collier' ? hh * 0.62 : obj === 'montre' ? hh * 0.58 : g.hw * 0.62;
        const ratio = o && o.naturalWidth ? o.naturalHeight / o.naturalWidth : 1;
        placer(o, g.places[k], g.plateau - hh * 0.04, ow, ratio, { visible: table && !!obj && leveA(k) > 0.05 });
        const v = r.valeurs[k].current;
        if (v) {
          const vu = table && !!obj && leveA(k) > 0.3;
          v.style.visibility = vu ? 'visible' : 'hidden';
          if (vu) v.style.transform = `translate3d(${g.places[k]}px, ${g.plateau + 8}px, 0) translateX(-50%)`;
        }
        // Le retournement : le son de chaque chapeau, l'éclat du collier.
        if (x.nom === 'revele' && obj && leveA(k) > 0 && !joues.has(`l${k}`)) {
          joues.add(`l${k}`);
          if (obj === 'collier') jouerEffet('gd_eclat');
          else jouerEffet('gd_retourne', { vitesse: 0.9 + k * 0.08 });
        }
      });
      // Le collier tombe au milieu de la table, puis disparaît sous le chapeau.
      const ch = (s - VOL.chute) / (VOL.couvre - VOL.chute + 300);
      placer(r.collierChute.current, g.places[1], g.plateau - hh * 0.04 - H * 0.5 * (1 - lisse(ch)), hh * 0.62, 330 / 214, { visible: vol && s >= VOL.chute && s < VOL.couvert });
      // La pluie de diamants et le projecteur, sur le collier retrouvé.
      const kc = x.objets.indexOf('collier');
      const lc = kc >= 0 ? leveA(kc) : 0;
      const tc = kc >= 0 ? s - RET[(['premier', 'second', 'mien'] as const)[Math.max(0, x.ordre.indexOf(kc))]] : -1;
      placer(r.diamants.current, kc >= 0 ? g.places[kc] : 0, g.plateau + g.hw * 0.7, g.hw * 2.6, 1, { visible: lc > 0 && tc < 1400, opacite: 1 - borne((tc - 700) / 700), rot: tc / 30 });
      placer(r.poursuite.current, kc >= 0 ? g.places[kc] : 0, g.plateau + hh * 0.5, g.hw * 2.4, 1, { visible: lc > 0, opacite: Math.min(1, lc * 1.5) * 0.9 });

      // Les sons du vol : la valse, l'éclat du collier, le sifflet, la chute du chapeau, le bonneteau.
      if (vol) {
        const fois = (c: string, debut: number, f: () => void) => {
          if (joues.has(c) || s < debut || s > debut + 700) return;
          joues.add(c);
          f();
        };
        fois('valse', 0, () => jouerEffet('pp_valse'));
        fois('vole', VOL.vole, () => jouerEffet('gd_eclat', { volume: 0.7 }));
        fois('sifflet', VOL.sifflet, () => jouerEffet('br_sifflet'));
        fois('couvre', VOL.couvert - 150, () => jouerEffet('gd_retourne', { vitesse: 0.8 }));
        DEBUTS_ECHANGES.forEach((t0, i) => fois(`e${i}`, t0, () => jouerEffet('pp_glisse', { vitesse: 0.9 + (i % 3) * 0.1 })));
      }
    };
    raf = requestAnimationFrame(image);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [d, r]);
}

// ---------------------------------------------------------------------------------------------------------------
// Le bonus

export function BonusPickpocket({ v, b, nom, ouvert, choisir }: { v: VueBW; b: VueBonusBW; nom: string; ouvert: boolean; choisir: (o: number) => void }) {
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
      coupleG: ref(),
      coupleD: ref(),
      comtesse: ref(),
      faufile: ref(),
      vole: ref(),
      inspecteur: ref(),
      eclat: ref(),
      gueridon: ref(),
      melange: ref(),
      salue: ref(),
      collierChute: ref(),
      chapeaux: [ref(), ref(), ref()],
      objets: [ref(), ref(), ref()],
      valeurs: [ref(), ref(), ref()],
      diamants: ref(),
      coupe: ref(),
      poursuite: ref(),
    };
  const r = refs.current;
  useScene(donnees, r);

  const portrait = !!r.scene.current && r.scene.current.clientHeight > r.scene.current.clientWidth * 1.05;
  const salle = portrait ? BALS.portrait : BALS.paysage;
  const butin = BUTIN_PICKPOCKET.map(([x]) => x);
  const petitsGains = PETITES_MALLETTES.map(([x]) => x);
  const mienRevele = revele && choix !== null && s >= RET.mien;

  return (
    <div className={`pp pp-e-${nom}`} ref={r.scene}>
      <div className="pp-bal" style={{ backgroundImage: `url(${IMG(salle.img)})` }} />
      <img className="pp-perso couple" ref={r.coupleG} src={IMG('couple')} alt="" draggable={false} />
      <img className="pp-perso couple" ref={r.coupleD} src={IMG('couple')} alt="" draggable={false} />
      <img className="pp-perso" ref={r.comtesse} src={IMG('comtesse')} alt="" draggable={false} />
      <img className="pp-perso" ref={r.inspecteur} src={IMG('inspecteur')} alt="" draggable={false} />
      <img className="pp-perso pick" ref={r.faufile} src={IMG('pick-faufile')} alt="" draggable={false} />
      <img className="pp-perso pick" ref={r.vole} src={IMG('pick-vole')} alt="" draggable={false} />
      <img className="pp-lumiere" ref={r.eclat} src={IMG('diamants')} alt="" draggable={false} />

      <img className="pp-perso table" ref={r.melange} src={IMG('pick-melange')} alt="" draggable={false} />
      <img className="pp-perso table" ref={r.salue} src={IMG('pick-salue')} alt="" draggable={false} />
      <img className="pp-gueridon" ref={r.gueridon} src={IMG('gueridon')} alt="" draggable={false} />
      <img className="pp-poursuite" ref={r.poursuite} src={IMG('poursuite')} alt="" draggable={false} />
      <img className="pp-objet" ref={r.collierChute} src={IMG('collier')} alt="" draggable={false} />
      {[0, 1, 2].map((k) => (
        <img key={`o${k}`} className={`pp-objet ${objets[k] ?? ''}`} ref={r.objets[k]} src={IMG(objets[k] ?? 'montre')} alt="" draggable={false} />
      ))}
      <img className="pp-lumiere diamants" ref={r.diamants} src={IMG('diamants')} alt="" draggable={false} />
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
          <img src={IMG('chapeau')} alt="" draggable={false} />
          {nom === 'mallettes' && salon[k] ? <i className="pp-nb">{salon[k]}</i> : null}
          {nom === 'mallettes' && choix === k && <em className="pp-toi">{tr('Toi', 'You')}</em>}
        </button>
      ))}
      {[0, 1, 2].map((k) => (
        <span key={`v${k}`} className={`pp-valeur ${objets[k] ?? ''} ${choix === k ? 'mienne' : ''}`} ref={r.valeurs[k]}>
          {mallettes[k] !== null && <ValeurMultipliee x={mallettes[k] as number} m={M} rapide={k !== suivi} son={k === choix} />}
        </span>
      ))}

      {/* Le butin volé, annoncé au milieu du bal. */}
      {nom === 'vol' && b.butin != null && s >= VOL.vole + 200 && s < VOL.sifflet && (
        <div className="pp-butin" role="status">
          <img src={IMG('collier')} alt="" draggable={false} />
          <span>
            <small>{tr('Il vole le collier !', 'He steals the necklace!')}</small>
            <strong>
              <ValeurMultipliee x={b.butin} m={M} son />
            </strong>
          </span>
        </div>
      )}
      {nom === 'vol' && s >= VOL.sifflet && s < VOL.table && (
        <div className="pp-annonce haut" role="status" key="inspecteur">
          <strong>{tr('L’inspecteur !', 'The inspector!')}</strong>
        </div>
      )}
      {nom === 'vol' && s >= VOL.table && (
        <div className="pp-annonce bas" role="status" key="bonneteau">
          <strong>{tr('Sous quel chapeau ?', 'Under which hat?')}</strong>
        </div>
      )}
      <div className="pp-coupe" ref={r.coupe} aria-hidden="true" />


      {mienRevele && choix !== null && objets[choix] === 'collier' && <PluieLingots n={portrait ? 10 : 16} objets={['billet', 'lingot', 'billet']} />}
    </div>
  );
}
