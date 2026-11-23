/**
 * L'Aiguillage (Le Baron Express) : le train part de Paris avec ×1 au compteur, passe trois aiguillages et arrive à
 * l'un des quatre terminus (Rome, Venise, Istanbul, Vienne). Le serveur a tiré tout le réseau dès le début du bonus :
 * il envoie dès le départ les primes des gares éclairées et les multiplicateurs des terminus ; une gare sous bâche n'est
 * révélée qu'au passage du train à son niveau.
 *
 * L'écran met le voyage en scène :
 * - l'intro : l'affiche et son titre, l'aiguilleur dans son poste, puis la carte de l'Europe et ce que vaut chaque
 *   terminus ce soir ;
 * - chaque aiguillage (le choix) : la bifurcation en plein écran, la gare de gauche et celle de droite (éclairée : sa
 *   prime ; sous bâche : « ? »), le meilleur multiplicateur encore possible de chaque côté, le conseil de l'aiguilleur
 *   et le levier, qui bascule du côté choisi ; la carte en petit dans un coin ;
 * - chaque trajet : le train file sur la voie de nuit, puis la caméra plonge sur la carte et suit le train jusqu'à la
 *   gare ; la bâche tombe (ou les travaux barrent la voie) et la prime s'ajoute au compteur ;
 * - le terminus : le médaillon de la ville, les feux d'artifice et le calcul du gain.
 * Le joueur qui n'a pas misé suit le train de l'aiguilleur (ses conseils).
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  conseilAiguillage,
  esperanceTable,
  NB_AIGUILLAGES,
  PRIMES_BACHEES,
  TERMINUS_AIGUILLAGE,
  type TerminusAiguillage,
  type TirageAiguillageBW,
  type VueBonusBW,
  type VueBW,
} from '../../shared/baronWheel';
import { fx } from './CasinoBaronExpress';
import { tr } from './traduction';
import { jouerEffet, mouvementReduit } from './ui';
import './aiguillage.css';

const IMG = (n: string) => `/cartes/ai-${n}.webp`;

/** Les médaillons des villes (Rome et Istanbul attendent le leur : le médaillon d'aiguillage en attendant). */
const MEDAILLONS: Record<TerminusAiguillage | 'paris', string> = {
  paris: 'med-paris',
  rome: 'med-rome',
  venise: 'med-venise',
  istanbul: 'med-istanbul',
  vienne: 'med-vienne',
};

/** Toutes les images de l'Aiguillage (sans chemin ni extension), préchargées avant le bonus. */
export const IMAGES_AIGUILLAGE_NOMS = [
  'affiche',
  'logo',
  'poste',
  'carte',
  'bifurcation',
  'voie',
  'levier',
  'signal',
  'gare',
  'gare-bache',
  'travaux',
  'train-cote',
  'noeud',
  'med-paris',
  'med-venise',
  'med-vienne',
  'med-istanbul',
  'med-rome',
  'train-34',
  'vapeur-face',
  'compteur',
  'plaque-prime',
  'etincelles',
  'feux',
  'aiguilleur',
  'aiguilleur-joie',
].map((n) => (n === 'vapeur-face' ? 'bw-vapeur-face' : `ai-${n}`));

// ---------------------------------------------------------------------------------------------------------------
// Le réseau sur la carte (coordonnées en pixels de l'image de la carte, 1672 × 941)

const CARTE = { w: 1672, h: 941 };
type Point = [number, number];
/** POSITIONS[l][k] : la gare (l, k) ; le niveau 0, c'est Paris ; le niveau 3, les terminus. */
const POSITIONS: Point[][] = [
  [[560, 428]],
  [
    [650, 562],
    [770, 420],
  ],
  [
    [815, 642],
    [862, 545],
    [952, 420],
  ],
  [
    [935, 748],
    [990, 618],
    [1335, 662],
    [1108, 450],
  ],
];
const NOMS_GARES: [string, string][][] = [
  [['Paris', 'Paris']],
  [
    ['Dijon', 'Dijon'],
    ['Strasbourg', 'Strasbourg'],
  ],
  [
    ['Milan', 'Milan'],
    ['Zurich', 'Zurich'],
    ['Munich', 'Munich'],
  ],
  [
    ['Rome', 'Rome'],
    ['Venise', 'Venice'],
    ['Istanbul', 'Istanbul'],
    ['Vienne', 'Vienna'],
  ],
];

/** La voie entre deux gares : une courbe douce (bombée vers le haut), en coordonnées de la carte. */
function voie(a: Point, b: Point): { c: Point; d: string } {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const L = Math.hypot(dx, dy);
  const s = dx >= 0 ? 1 : -1;
  const c: Point = [(a[0] + b[0]) / 2 + (dy / L) * 0.14 * L * s, (a[1] + b[1]) / 2 - (dx / L) * 0.14 * L * s];
  return { c, d: `M${a[0]} ${a[1]} Q${c[0]} ${c[1]} ${b[0]} ${b[1]}` };
}
function surVoie(a: Point, b: Point, u: number): { p: Point; angle: number } {
  const { c } = voie(a, b);
  const v = 1 - u;
  const p: Point = [v * v * a[0] + 2 * v * u * c[0] + u * u * b[0], v * v * a[1] + 2 * v * u * c[1] + u * u * b[1]];
  const t: Point = [2 * v * (c[0] - a[0]) + 2 * u * (b[0] - c[0]), 2 * v * (c[1] - a[1]) + 2 * u * (b[1] - c[1])];
  return { p, angle: (Math.atan2(t[1], t[0]) * 180) / Math.PI };
}

const MU = esperanceTable(PRIMES_BACHEES);
/** Le tirage tel que l'écran le connaît (une gare sous bâche encore cachée vaut sa moyenne) : pour les conseils. */
function tirageVu(a: NonNullable<VueBonusBW['aiguillage']>): TirageAiguillageBW {
  return { type: 'aiguillage', terminus: a.terminus, eclairees: a.eclairees, gares: a.gares.map((n) => n.map((x) => x ?? MU)) };
}
const fmtPrime = (x: number) => `+${fx(x)}`;

// ---------------------------------------------------------------------------------------------------------------
// L'horloge de l'étape (recalée sur le serveur) et un battement de 10 par seconde

function useHorloge(v: VueBW, cle: string): number {
  const horloge = useRef({ cle: '', debut: 0 });
  const estime = performance.now() - ((v.duree ?? 0) - (v.reste ?? 0));
  if (horloge.current.cle !== cle) horloge.current = { cle, debut: estime };
  else horloge.current.debut = Math.min(horloge.current.debut, estime);
  const [maintenant, setMaintenant] = useState(() => performance.now());
  useEffect(() => {
    const id = window.setInterval(() => setMaintenant(performance.now()), 100);
    return () => window.clearInterval(id);
  }, []);
  return Math.max(0, maintenant - horloge.current.debut);
}

// ---------------------------------------------------------------------------------------------------------------
// La carte : le réseau, les gares, les terminus et le train ; la caméra cadre ce qu'on lui demande

interface EtatCarte {
  /** Le chemin du train (les choix, 0 ou 1) et jusqu'où il est arrivé : niveau atteint, et la part du trajet en cours. */
  chemin: number[];
  niveau: number;
  avance: number;
  /** Les niveaux dont les gares sous bâche sont dévoilées à l'écran. */
  devoiles: number;
}

function Carte({ a, etat, camera, mini = false }: { a: NonNullable<VueBonusBW['aiguillage']>; etat: EtatCarte; camera: { x: number; y: number; z: number }; mini?: boolean }) {
  const boite = useRef<HTMLDivElement>(null);
  const [taille, setTaille] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = boite.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setTaille({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // La caméra : l'échelle qui couvre la boîte, fois le zoom, centrée sur le point demandé sans montrer le bord.
  // Sur un écran plus haut que la carte (un téléphone), la carte tient en largeur : on voit toute l'Europe, de bord à
  // bord, sur un fond de la même carte, floutée.
  const base = taille.w ? (taille.w / taille.h < CARTE.w / CARTE.h ? taille.w / CARTE.w : Math.max(taille.w / CARTE.w, taille.h / CARTE.h)) : 0;
  const S = base * camera.z;
  const cadrer = (boite: number, monde: number, c: number) => (monde * S <= boite ? (boite - monde * S) / 2 : Math.min(0, Math.max(boite - monde * S, boite / 2 - c * S)));
  const tx = cadrer(taille.w, CARTE.w, camera.x);
  const ty = cadrer(taille.h, CARTE.h, camera.y);

  const { chemin, niveau, avance, devoiles } = etat;
  const positions = [0];
  chemin.forEach((c, l) => positions.push(positions[l] + c));
  const kDe = (l: number) => positions[l];
  // Le train : sur la voie de (niveau, k) vers (niveau + 1, k'), à la part `avance`.
  let train: { p: Point; angle: number } = { p: POSITIONS[0][0], angle: 20 };
  if (niveau < chemin.length && avance > 0) train = surVoie(POSITIONS[niveau][kDe(niveau)], POSITIONS[niveau + 1][kDe(niveau + 1)], avance);
  else {
    const l = Math.min(niveau, chemin.length);
    const p = POSITIONS[l][kDe(l)];
    const prec = l > 0 ? surVoie(POSITIONS[l - 1][kDe(l - 1)], p, 1) : { angle: 20 };
    train = { p, angle: prec.angle };
  }
  const k = kDe(Math.min(niveau, chemin.length));
  // Ce qui reste atteignable depuis la gare où le train se trouve.
  const atteignable = (l: number, kk: number) => l >= niveau && kk >= k && kk <= k + (l - niveau);

  const voies: { d: string; etat: string; cle: string }[] = [];
  for (let l = 0; l < NB_AIGUILLAGES; l++)
    for (let kk = 0; kk <= l; kk++)
      for (const c of [0, 1]) {
        const parcourue = l < chemin.length && kDe(l) === kk && chemin[l] === c && (l < niveau || (l === niveau && avance > 0));
        const possible = atteignable(l, kk) && atteignable(l + 1, kk + c);
        voies.push({ d: voie(POSITIONS[l][kk], POSITIONS[l + 1][kk + c]).d, etat: parcourue ? 'parcourue' : possible ? 'possible' : 'fermee', cle: `${l}-${kk}-${c}` });
      }

  return (
    <div className={`ai-carte ${mini ? 'mini' : ''}`} ref={boite}>
      {!mini && <img className="ai-carte-flou" src={IMG('carte')} alt="" draggable={false} />}
      <div className="ai-monde" style={{ width: CARTE.w, height: CARTE.h, transform: `translate(${tx}px, ${ty}px) scale(${S || 0.0001})` }}>
        <img className="ai-carte-fond" src={IMG('carte')} alt="" draggable={false} />
        <svg className="ai-voies" viewBox={`0 0 ${CARTE.w} ${CARTE.h}`} aria-hidden="true">
          {voies.map((x) => (
            <g key={x.cle} className={`ai-voie ${x.etat}`}>
              <path d={x.d} className="dessous" />
              <path d={x.d} className="rail" />
              <path d={x.d} className="traverses" />
            </g>
          ))}
        </svg>
        {/* Paris, la gare de départ */}
        <span className="ai-ville depart" style={{ left: POSITIONS[0][0][0], top: POSITIONS[0][0][1] }}>
          <img src={IMG(MEDAILLONS.paris)} alt="" draggable={false} />
          <b>Paris</b>
        </span>
        {/* Les gares des deux premiers niveaux */}
        {[1, 2].map((l) =>
          POSITIONS[l].map((pos, kk) => {
            const eclairee = a.eclairees[l - 1][kk];
            const vue = eclairee || l <= devoiles;
            const x = a.gares[l - 1][kk];
            const travaux = vue && !eclairee && x === 0;
            return (
              <span key={`${l}-${kk}`} className={`ai-gare ${eclairee ? 'eclairee' : 'bachee'} ${vue ? 'vue' : ''} ${atteignable(l, kk) ? '' : 'loin'} ${kDe(l) === kk && l <= niveau ? 'passee' : ''}`} style={{ left: pos[0], top: pos[1] }}>
                <img className="ai-gare-img" src={IMG(travaux ? 'travaux' : eclairee || vue ? 'gare' : 'gare-bache')} alt="" draggable={false} />
                {!eclairee && vue && !travaux && <img className="ai-bache-tombe" src={IMG('gare-bache')} alt="" draggable={false} />}
                <span className="ai-plaque">
                  <img src={IMG('plaque-prime')} alt="" draggable={false} />
                  <b>{vue && x !== null ? fmtPrime(x) : '?'}</b>
                </span>
                <i>{tr(...NOMS_GARES[l][kk])}</i>
              </span>
            );
          }),
        )}
        {/* Les terminus : leur médaillon, leur multiplicateur et leur prime */}
        {TERMINUS_AIGUILLAGE.map((ville, kk) => {
          const pos = POSITIONS[3][kk];
          const eclairee = a.eclairees[2][kk];
          const vue = eclairee || devoiles >= 3;
          const x = a.gares[2][kk];
          const max = Math.max(...a.terminus);
          return (
            <span key={ville} className={`ai-ville terminus ${atteignable(3, kk) ? '' : 'loin'} ${a.terminus[kk] === max ? 'meilleur' : ''} ${niveau >= 3 && kDe(3) === kk ? 'arrivee' : ''}`} style={{ left: pos[0], top: pos[1] }}>
              <img src={IMG(MEDAILLONS[ville])} alt="" draggable={false} />
              <b>{tr(...NOMS_GARES[3][kk])}</b>
              <em className="ai-multi-terminus">{fx(a.terminus[kk])}</em>
              <span className={`ai-prime-terminus ${eclairee ? 'eclairee' : 'bachee'}`}>{vue && x !== null ? fmtPrime(x) : '+?'}</span>
            </span>
          );
        })}
        {/* Le train */}
        <span className="ai-train" style={{ left: train.p[0], top: train.p[1], transform: `translate(-50%, -88%) rotate(${train.angle}deg)` }}>
          <i className="ai-train-phare" />
          <img src={IMG('train-cote')} alt="" draggable={false} />
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Le compteur du train

function Compteur({ valeur, multi }: { valeur: number; multi?: number }) {
  return (
    <div className="ai-compteur" aria-label={tr(`Compteur ${fx(valeur)}`, `Counter ${fx(valeur)}`)}>
      <img src={IMG('compteur')} alt="" draggable={false} />
      <b key={valeur}>{fx(valeur)}</b>
      {multi !== undefined && <small>{tr(`au terminus ${fx(multi)}`, `at terminus ${fx(multi)}`)}</small>}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// L'écran du mini-jeu

export function BonusAiguillage({ v, b, nom, ouvert, choisir }: { v: VueBW; b: VueBonusBW; nom: string; ouvert: boolean; choisir: (o: number) => void }) {
  const a = b.aiguillage;
  const cle = `${v.numero}-${b.etape}-${v.phase}`;
  const t = useHorloge(v, cle);
  const duree = v.duree ?? 1;
  // Le rang de l'aiguillage en cours (ou du dernier trajet) : combien d'étapes « aiguille » avant celle-ci.
  const avant = b.etapes.slice(0, b.etape).filter((e) => e.nom === 'aiguille').length;
  const vu = useMemo(() => (a ? tirageVu(a) : null), [a]);
  // Le chemin du train : mes choix, sinon ceux de l'aiguilleur (le joueur qui n'a pas misé suit son train).
  const chemin: number[] = [];
  if (vu)
    for (let r = 0; r < NB_AIGUILLAGES; r++) {
      const c = b.mesChoix[r];
      if (c !== null && c !== undefined) chemin.push(c);
      else if (r < avant || (r === avant && nom === 'trajet')) chemin.push(conseilAiguillage(vu, chemin));
      else break;
    }
  const fin = nom === 'terminus' || nom === 'revele' || v.phase === 'resultat';
  // Où en est le train : pendant un trajet, il part à 45 % de l'étape (après la voie de nuit) et arrive à 85 %.
  const trajet = nom === 'trajet';
  const u = trajet ? Math.min(1, Math.max(0, (t / duree - 0.45) / 0.38)) : 0;
  const niveau = fin ? NB_AIGUILLAGES : trajet ? avant - 1 : avant;
  const arrive = trajet && u >= 1;
  const devoiles = fin ? NB_AIGUILLAGES : trajet ? avant - 1 + (arrive ? 1 : 0) : avant;
  const etat: EtatCarte = { chemin, niveau: arrive ? niveau + 1 : niveau, avance: arrive ? 0 : u, devoiles };
  const positions = [0];
  chemin.forEach((c, l) => positions.push(positions[l] + c));
  // Le compteur : ×1, plus les primes des gares où le train est déjà arrivé.
  const arrivees = fin ? NB_AIGUILLAGES : etat.niveau;
  let compteur = 1;
  if (a) for (let l = 1; l <= Math.min(arrivees, chemin.length); l++) compteur += a.gares[l - 1][positions[l]] ?? 0;

  // Les sons : le sifflet et le grondement au départ de chaque trajet, la prime à l'arrivée en gare.
  const reduit = mouvementReduit();
  const sonne = useRef('');
  useEffect(() => {
    if (!a || sonne.current === `${cle}-${arrive}`) return;
    sonne.current = `${cle}-${arrive}`;
    if (trajet && !arrive) {
      jouerEffet('ex_tchou', { volume: 0.7 });
      window.setTimeout(() => jouerEffet('bw_train_passe', { volume: 0.8 }), 300);
    }
    if (trajet && arrive && chemin.length > avant - 1) {
      const l = avant;
      const x = a.gares[l - 1][positions[l]];
      jouerEffet('ex_freins', { volume: 0.6 });
      if (x !== null) window.setTimeout(() => jouerEffet(x === 0 ? 'bw_perdu' : x >= 5 ? 'bw_gros' : 'jeton', { volume: 0.9 }), 350);
    }
    if (nom === 'terminus') {
      jouerEffet('ex_arrivee');
      window.setTimeout(() => jouerEffet('ex_feux'), 900);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle, arrive, !!a]);

  if (!a || !vu) return <div className="ai" />;

  // --- L'intro : l'affiche, le poste de l'aiguilleur, puis la carte et ce que vaut chaque terminus ce soir.
  if (nom === 'intro') {
    const tt = reduit ? 9_000 : t;
    const acte = tt < 2_800 ? 'affiche' : tt < 6_300 ? 'poste' : 'carte';
    return (
      <div className={`ai intro ${acte}`}>
        {acte === 'affiche' && (
          <div className="ai-affiche">
            <img className="ai-affiche-fond" src={IMG('affiche')} alt="" draggable={false} />
            <img className="ai-logo" src={IMG('logo')} alt={tr('L’Aiguillage', 'The Switch')} draggable={false} />
          </div>
        )}
        {acte === 'poste' && (
          <div className="ai-poste">
            <img className="ai-poste-fond" src={IMG('poste')} alt="" draggable={false} />
            <img className="ai-aiguilleur" src={IMG('aiguilleur')} alt="" draggable={false} />
            <p className="ai-bulle">{tr('Trois aiguillages jusqu’au terminus : à toi de choisir la voie !', 'Three switches to the terminus: you pick the track!')}</p>
          </div>
        )}
        {acte === 'carte' && (
          <>
            <Carte a={a} etat={etat} camera={{ x: 950, y: 585, z: 1.35 }} />
            <p className="ai-annonce">{tr('Ce soir : ', 'Tonight: ')}{TERMINUS_AIGUILLAGE.map((x, k) => `${tr(...NOMS_GARES[3][k])} ${fx(a.terminus[k])}`).join(' · ')}</p>
          </>
        )}
      </div>
    );
  }

  // --- Un aiguillage : la bifurcation, les deux gares, le levier ; la carte en petit.
  if (nom === 'aiguille') {
    const r = avant;
    const k = positions[r] ?? 0;
    const mon = b.mesChoix[r];
    const conseil = conseilAiguillage(vu, chemin.slice(0, r));
    const reste = NB_AIGUILLAGES - r - 1;
    const cotes = [0, 1].map((c) => {
      const kk = k + c;
      const eclairee = a.eclairees[r][kk];
      const x = a.gares[r][kk];
      const meilleur = Math.max(...a.terminus.slice(kk, kk + reste + 1));
      return { c, kk, eclairee, x, meilleur, terminus: r === NB_AIGUILLAGES - 1 };
    });
    const multiTerminus = Math.max(...a.terminus.slice(k, k + NB_AIGUILLAGES - r + 1));
    return (
      <div className={`ai aiguille ${mon !== null && mon !== undefined ? `choisi-${mon}` : ''}`}>
        <img className="ai-bifurcation" src={IMG('bifurcation')} alt="" draggable={false} />
        <img className="ai-signal gauche" src={IMG('signal')} alt="" draggable={false} />
        <img className="ai-signal droite" src={IMG('signal')} alt="" draggable={false} />
        <i className={`ai-feu gauche ${mon === 0 ? 'vert' : mon === 1 ? 'rouge' : ''}`} />
        <i className={`ai-feu droite ${mon === 1 ? 'vert' : mon === 0 ? 'rouge' : ''}`} />
        <p className="ai-numero">{tr(`Aiguillage ${r + 1} / ${NB_AIGUILLAGES}`, `Switch ${r + 1} / ${NB_AIGUILLAGES}`)}</p>
        {cotes.map((x) => (
          <button
            key={x.c}
            type="button"
            className={`ai-choix ${x.c ? 'droite' : 'gauche'} ${x.eclairee ? 'eclairee' : 'bachee'} ${mon === x.c ? 'pris' : mon !== null && mon !== undefined ? 'laisse' : ''}`}
            onClick={() => {
              if (!ouvert) return;
              jouerEffet('bw_poincon', { vitesse: 0.6, volume: 0.8 });
              jouerEffet('bw_vapeur', { volume: 0.5 });
              choisir(x.c);
            }}
            disabled={!ouvert}
          >
            {x.c === conseil && <em className="ai-conseil">{tr('Conseil de l’aiguilleur', 'Signalman’s tip')}</em>}
            <span className="ai-choix-sens">{x.c ? tr('À droite', 'Right') : tr('À gauche', 'Left')}</span>
            {x.terminus ? <img className="ai-choix-gare med" src={IMG(MEDAILLONS[TERMINUS_AIGUILLAGE[x.kk]])} alt="" draggable={false} /> : <img className="ai-choix-gare" src={IMG(x.eclairee ? 'gare' : 'gare-bache')} alt="" draggable={false} />}
            <strong>{tr(...NOMS_GARES[r + 1][x.kk])}</strong>
            <span className="ai-plaque">
              <img src={IMG('plaque-prime')} alt="" draggable={false} />
              <b>{x.eclairee && x.x !== null ? fmtPrime(x.x) : '?'}</b>
            </span>
            <small>{x.terminus ? tr(`Terminus ${fx(x.meilleur)}`, `Terminus ${fx(x.meilleur)}`) : tr(`jusqu’à ${fx(x.meilleur)} au terminus`, `up to ${fx(x.meilleur)} at the end`)}</small>
          </button>
        ))}
        <img className={`ai-levier ${mon === 0 ? 'gauche' : mon === 1 ? 'droite' : ''}`} src={IMG('levier')} alt="" draggable={false} />
        <div className="ai-mini">
          <Carte a={a} etat={etat} camera={{ x: 950, y: 585, z: 1.9 }} mini />
        </div>
        <Compteur valeur={compteur} multi={multiTerminus} />
      </div>
    );
  }

  // --- Le terminus et la révélation : la ville, les feux d'artifice et le calcul.
  if (fin) {
    const kk = positions[NB_AIGUILLAGES] ?? 0;
    const ville = TERMINUS_AIGUILLAGE[kk];
    const m = a.terminus[kk];
    return (
      <div className={`ai terminus ${nom}`}>
        <Carte a={a} etat={etat} camera={{ x: POSITIONS[3][kk][0], y: POSITIONS[3][kk][1], z: 1.6 }} />
        <div className="ai-arrivee">
          <img className="ai-feux un" src={IMG('feux')} alt="" draggable={false} />
          <img className="ai-feux deux" src={IMG('feux')} alt="" draggable={false} />
          <img className="ai-medaillon" src={IMG(MEDAILLONS[ville])} alt="" draggable={false} />
          <strong className="ai-ville-nom">{tr(...NOMS_GARES[3][kk])}</strong>
          <p className="ai-calcul">
            <span>{fx(compteur)}</span> × <span>{m.toLocaleString(tr('fr-FR', 'en-US'))}</span> = <b>{fx(compteur * m)}</b>
          </p>
          <img className="ai-aiguilleur-joie" src={IMG('aiguilleur-joie')} alt="" draggable={false} />
        </div>
      </div>
    );
  }

  // --- Un trajet : la voie de nuit (le train file), puis la carte : la caméra suit le train jusqu'à la gare.
  const l = avant - 1;
  const de = POSITIONS[l][positions[l] ?? 0];
  const vers = POSITIONS[l + 1][positions[l + 1] ?? 0];
  const nuit = !reduit && t / duree < 0.45;
  const cam = { x: (de[0] + vers[0]) / 2 + (vers[0] - de[0]) * 0.3 * u, y: (de[1] + vers[1]) / 2 + (vers[1] - de[1]) * 0.3 * u, z: 2.1 };
  const xArrivee = a.gares[l]?.[positions[l + 1] ?? 0];
  return (
    <div className={`ai trajet ${nuit ? 'nuit' : 'jour'}`}>
      {nuit ? (
        <div className="ai-voie-nuit" style={{ '--d': `${duree * 0.45}ms` } as CSSProperties}>
          {/* Le décor garde ses proportions (il couvre l'écran) : le train roule exactement sur son rail. */}
          <div className="ai-voie-cadre">
            <img className="ai-voie-fond" src={IMG('voie')} alt="" draggable={false} />
            {/* Le train de trois quarts, sur sa propre voie : il fonce vers nous, le paysage défile derrière. */}
            <span className="ai-train-34">
              <img src={IMG('train-34')} alt="" draggable={false} />
              <img className="ai-fumee" src="/cartes/bw-vapeur-face.webp" alt="" draggable={false} />
              <img className="ai-etincelles" src={IMG('etincelles')} alt="" draggable={false} />
            </span>
          </div>
        </div>
      ) : (
        <>
          <Carte a={a} etat={etat} camera={cam} />
          {arrive && xArrivee !== null && xArrivee !== undefined && (
            <p className={`ai-prime-gagnee ${xArrivee === 0 ? 'travaux' : xArrivee >= 5 ? 'grosse' : ''}`} role="status">
              {xArrivee === 0 ? tr('Travaux sur la voie : +×0', 'Works on the line: +×0') : `${tr(...NOMS_GARES[l + 1][positions[l + 1] ?? 0])} ${fmtPrime(xArrivee)}`}
            </p>
          )}
        </>
      )}
      <Compteur valeur={compteur} />
    </div>
  );
}
