/**
 * Le Wagon-Restaurant (Le Baron Express) : le chef pose six cloches d'argent sur la table de la voiture-restaurant ;
 * chacun choisit la sienne d'après le menu. Au service, le Baron passe parfois dorer une cloche (son plat compte
 * double), puis le chef soulève les cloches une à une, de la moins chère à la plus chère : le meilleur pour la fin.
 *
 * Le serveur n'envoie les plats (et la cloche dorée, et l'ordre du service) qu'au service, quand plus personne ne peut
 * choisir. La salle garde ses proportions (cadre « cover ») : en largeur, une longue table et six cloches ; en hauteur
 * (téléphone), deux tables de trois.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { MENU_RESTAURANT, NB_CLOCHES, PLATS_RESTAURANT, type PlatBW, type VueBonusBW, type VueBW } from '../../shared/baronWheel';
import { fx } from './CasinoBaronExpress';
import { tr } from './traduction';
import { jouerEffet, mouvementReduit } from './ui';
import './restaurant.css';

/** Les images du Wagon-Restaurant (sans chemin ni extension), préchargées avant le bonus. */
export const IMAGES_RESTAURANT_NOMS = [
  'wr-logo',
  'wr-salle',
  'wr-salle-portrait',
  'wr-cloche',
  'wr-cloche-or',
  'wr-chef',
  'wr-cuisine',
  'wr-cuisine-portrait',
  'wr-chef-cuisine',
  'wr-chef-ravi',
  'wr-baron',
  'wr-menu',
  'wr-eclat',
  'wr-vapeur',
  ...PLATS_RESTAURANT.map((p) => `wr-plat-${p}`),
];
const IMG = (n: string) => `/cartes/${n}.webp`;

const NOMS_PLATS: Record<PlatBW, [string, string]> = {
  veloute: ['Velouté', 'Velouté'],
  coq: ['Coq au vin', 'Coq au vin'],
  homard: ['Homard Thermidor', 'Lobster Thermidor'],
  caviar: ['Caviar impérial', 'Imperial caviar'],
  piece: ['Pièce montée', 'Croquembouche'],
  faisan: ['Faisan royal', 'Royal pheasant'],
  baron: ['Le Plat du Baron', 'The Baron’s Dish'],
};
/** Les plats chauds fument quand on soulève leur cloche. */
const CHAUDS: PlatBW[] = ['veloute', 'coq', 'homard', 'faisan'];

/**
 * La place de chaque cloche dans la salle (part du cadre) : en largeur, six sur la longue table ; en hauteur, trois sur
 * chacune des deux tables. x : le centre ; y : le bas (l'assiette posée sur la nappe) ; w : la largeur.
 */
const PLACES_LARGE = Array.from({ length: NB_CLOCHES }, (_, k) => ({ x: 16.7 + 13.33 * k, y: 82, w: 13 }));
const PLACES_HAUT = Array.from({ length: NB_CLOCHES }, (_, k) => ({ x: 20 + 30 * (k % 3), y: k < 3 ? 58.5 : 80, w: 28 }));

/** Le service (ms dans l'étape) : le Baron passe, puis le chef soulève une cloche toutes les 1,15 s. */
const BARON = { arrive: 500, dore: 1600, part: 2900 };
const PAS = 1150;
const debutService = (double: number | null) => (double !== null ? 3300 : 900);

/**
 * Le Baron, debout derrière la table, penché sur la cloche k : l'image est rognée à la lisière de la nappe (TABLES : la
 * hauteur du dessus de table, en part du cadre). Sa main (à 20 % de la largeur de l'image) arrive au-dessus de la cloche ;
 * il vient du côté où il y a de la place, et sort de derrière la table.
 */
const TABLES = { large: 74.5, haut: [53.8, 75.2] };
const RATIO_BARON = 500 / 941;
function BaronDerriere({ k }: { k: number }) {
  const pl = PLACES_LARGE[k];
  const ph = PLACES_HAUT[k];
  // En largeur (cadre 2:1) : 68 % de la hauteur, la tête vers 24 %.
  const hL = 68;
  const wL = (hL * RATIO_BARON) / 2;
  const sensL = k >= 3 ? -1 : 1;
  const cxL = pl.x + sensL * (wL / 2 - wL * 0.2);
  // En hauteur (cadre 2:3) : 40 % de la hauteur, la main un peu au-dessus de la cloche.
  const ligneH = k < 3 ? TABLES.haut[0] : TABLES.haut[1];
  const hH = 40;
  const wH = hH * RATIO_BARON * 1.5;
  const sensH = k % 3 === 2 ? -1 : 1;
  const cxH = ph.x + sensH * (wH / 2 - wH * 0.2);
  const hautH = ph.y - 18 - hH * 0.25;
  const style = {
    '--ligne-l': `${TABLES.large}%`,
    '--x-l': `${cxL}%`,
    '--top-l': `${(24 / TABLES.large) * 100}%`,
    '--h-l': `${(hL / TABLES.large) * 100}%`,
    '--sens-l': sensL,
    '--ligne-h': `${ligneH}%`,
    '--x-h': `${cxH}%`,
    '--top-h': `${(hautH / ligneH) * 100}%`,
    '--h-h': `${(hH / ligneH) * 100}%`,
    '--sens-h': sensH,
  } as CSSProperties;
  return (
    <div className="wr-baron-zone" style={style} aria-hidden="true">
      <img className="wr-baron" src={IMG('wr-baron')} alt="" draggable={false} />
    </div>
  );
}

export function BonusRestaurant({ v, b, nom, ouvert, choisir }: { v: VueBW; b: VueBonusBW; nom: string; ouvert: boolean; choisir: (o: number) => void }) {
  const r = b.restaurant;
  const mien = b.mesChoix[0] ?? null;
  const salon = b.choixSalon[0] ?? [];
  const M = Math.max(1, b.multiplicateur);

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

  const plats = r?.plats ?? null;
  const double = r?.double ?? null;
  const ordre = r?.ordre ?? null;
  const service = nom === 'service';
  const fini = nom === 'revele';
  /** L'instant (dans le service) où le chef soulève la cloche k. */
  const leveeA = (k: number) => (ordre ? debutService(double) + ordre.indexOf(k) * PAS : Infinity);
  const levee = (k: number) => fini || (service && tau >= leveeA(k));
  const doree = (k: number) => k === double && (fini || (service && tau >= BARON.dore));
  const valeur = (k: number) => (plats ? MENU_RESTAURANT[plats[k]] * (k === double ? 2 : 1) : 0);
  const baronLa = service && double !== null && tau >= BARON.arrive && tau < BARON.part + 500;

  // Les sons du service.
  const joues = useRef(new Set<string>());
  useEffect(() => {
    const fois = (k: string, f: () => void) => {
      const id = `${cle}-${k}`;
      if (joues.current.has(id)) return;
      joues.current.add(id);
      f();
    };
    if (v.phase !== 'bonus') return;
    if (nom === 'intro' && tau > 150) fois('cloches', () => jouerEffet('wr_cloche', { volume: 0.5, vitesse: 1.15 }));
    if (!service || !plats) return;
    if (double !== null && tau >= BARON.dore && tau < BARON.dore + 800) fois('baron', () => jouerEffet('gd_eclat', { volume: 0.9 }));
    for (let k = 0; k < NB_CLOCHES; k++) {
      const t0 = leveeA(k);
      if (tau >= t0 && tau < t0 + 900)
        fois(`levee${k}`, () => {
          jouerEffet('wr_cloche', { vitesse: 0.95 + 0.05 * (ordre?.indexOf(k) ?? 0) });
          if (valeur(k) >= 50) jouerEffet('bw_gros', { volume: 0.8 });
          else if (k === mien) jouerEffet('course_gain', { volume: 0.7 });
        });
    }
  });

  // L'annonce du moment.
  let annonce: { titre: string; sous?: string; ton?: string } | null = null;
  if (service && double !== null && tau >= BARON.arrive && tau < BARON.part + 300)
    annonce = { titre: tr('Le Baron passe à table !', 'The Baron drops by!'), sous: tr('Sa cloche dorée compte double', 'His golden cloche counts double'), ton: 'baron' };
  else if (service && plats && mien !== null && tau >= leveeA(mien) && tau < leveeA(mien) + 1800)
    annonce = {
      titre: tr(`Ton plat : ${NOMS_PLATS[plats[mien]][0]}`, `Your dish: ${NOMS_PLATS[plats[mien]][1]}`),
      sous: `${fx(valeur(mien) * M)}${mien === double ? tr(' (cloche dorée ×2)', ' (golden cloche ×2)') : ''}`,
      ton: valeur(mien) >= 50 ? 'gros' : '',
    };

  const reduit = mouvementReduit();
  const ravi = fini && mien !== null && plats !== null && valeur(mien) >= 25;
  const choix = nom === 'cloches';

  return (
    <div className={`wr ${nom}`}>
      <div className="wr-cadre">
        <img className="wr-salle large" src={IMG('wr-salle')} alt="" draggable={false} />
        <img className="wr-salle haut" src={IMG('wr-salle-portrait')} alt="" draggable={false} />
        {/* Le Baron se penche au-dessus de la cloche qu'il dore, debout derrière la table : la nappe cache ses jambes. */}
        {baronLa && double !== null && <BaronDerriere k={double} />}
        {Array.from({ length: NB_CLOCHES }, (_, k) => {
          const pl = PLACES_LARGE[k];
          const ph = PLACES_HAUT[k];
          const lv = levee(k);
          const plat = plats?.[k] ?? null;
          const x = valeur(k);
          return (
            <button
              key={k}
              type="button"
              className={`wr-place ${lv ? 'levee' : ''} ${doree(k) ? 'doree' : ''} ${mien === k ? 'mienne' : ''} ${fini && mien !== null && mien !== k ? 'autre' : ''} ${x >= 50 ? 'gros' : ''}`}
              style={{ '--xl': `${pl.x}%`, '--yl': `${pl.y}%`, '--wl': `${pl.w}%`, '--xh': `${ph.x}%`, '--yh': `${ph.y}%`, '--wh': `${ph.w}%`, '--k': k } as CSSProperties}
              onClick={() => choisir(k)}
              disabled={!choix || !ouvert}
              aria-label={tr(`Cloche ${k + 1}`, `Cloche ${k + 1}`)}
            >
              {lv && x >= 50 && !reduit && <img className="wr-eclat" src={IMG('wr-eclat')} alt="" draggable={false} />}
              {plat && <img className="wr-plat" src={IMG(`wr-plat-${plat}`)} alt="" draggable={false} />}
              {lv && plat && CHAUDS.includes(plat) && !reduit && <img className="wr-fumee" src={IMG('wr-vapeur')} alt="" draggable={false} />}
              <span className="wr-cloche">
                <img className="argent" src={IMG('wr-cloche')} alt="" draggable={false} />
                <img className="or" src={IMG('wr-cloche-or')} alt="" draggable={false} />
              </span>
              {doree(k) && <b className="wr-double">×2</b>}
              {lv && plat && (
                <span className="wr-etiquette">
                  <small>{tr(...NOMS_PLATS[plat])}</small>
                  <strong>{fx(x * M)}</strong>
                </span>
              )}
              {!lv && mien === k && <i className="wr-mien">★</i>}
              {choix && salon[k] ? <i className="wr-nb">{salon[k]}</i> : null}
            </button>
          );
        })}
      </div>

      {nom === 'intro' && <img className="wr-logo" src={IMG('wr-logo')} alt={tr('La Cloche', 'The Cloche')} draggable={false} />}
      {/* En cuisine : le chef prépare le plat vedette de la manche (le plus cher des six cloches). */}
      {nom === 'intro' && r?.vedette && (
        <div className="wr-cuisine" aria-live="polite">
          <img className="wr-cuisine-fond large" src={IMG('wr-cuisine')} alt="" draggable={false} />
          <img className="wr-cuisine-fond haut" src={IMG('wr-cuisine-portrait')} alt="" draggable={false} />
          <img className="wr-cuisine-chef" src={IMG('wr-chef-cuisine')} alt="" draggable={false} />
          <img className={`wr-cuisine-plat ${r.vedette}`} src={IMG(`wr-plat-${r.vedette}`)} alt="" draggable={false} />
          {!reduit && <img className="wr-cuisine-vapeur" src={IMG('wr-vapeur')} alt="" draggable={false} />}
          <div className="wr-cuisine-titre">
            <small>{tr('Ce soir, le chef prépare', 'Tonight, the chef is cooking')}</small>
            <strong>{tr(...NOMS_PLATS[r.vedette])}</strong>
            <b>{fx(MENU_RESTAURANT[r.vedette] * M)}</b>
            <small>{tr('Il est sous l’une des six cloches…', 'It is under one of the six cloches…')}</small>
          </div>
        </div>
      )}
      {/* Il se met du côté opposé à ma cloche, pour ne pas la cacher. */}
      {ravi && mien !== null && <img className={`wr-chef ravi ${mien >= 3 ? 'gauche-l' : ''} ${mien % 3 === 2 ? 'gauche-h' : ''}`} src={IMG('wr-chef-ravi')} alt="" draggable={false} />}

      {/* Le menu : chaque plat et ce qu'il paie (multiplicateur de la roue compris). */}
      {choix && (
        <div className="wr-menu" aria-label={tr('Le menu', 'The menu')}>
          <strong>{tr('Menu', 'Menu')}</strong>
          <ol>
            {[...PLATS_RESTAURANT].reverse().map((p) => (
              <li key={p} className={`${p === 'baron' ? 'baron' : ''} ${p === r?.vedette ? 'vedette' : ''}`}>
                <span>
                  {p === r?.vedette ? '★ ' : ''}
                  {tr(...NOMS_PLATS[p])}
                </span>
                <b>{fx(MENU_RESTAURANT[p] * M)}</b>
              </li>
            ))}
          </ol>
          <em>{tr('Cloche dorée par le Baron : ×2', 'Cloche gilded by the Baron: ×2')}</em>
        </div>
      )}

      {annonce && (
        <div className={`wr-annonce ${annonce.ton ?? ''}`} key={annonce.titre} role="status">
          <strong>{annonce.titre}</strong>
          {annonce.sous && <span>{annonce.sous}</span>}
        </div>
      )}
    </div>
  );
}
