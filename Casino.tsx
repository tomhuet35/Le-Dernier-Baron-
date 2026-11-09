/**
 * Salon privé du Baron : le casino des comptes Créateur (chargé à part : les autres joueurs ne le téléchargent pas).
 * Étape 1 : le salon (solde, plus riches, annonces), la roulette du salon (une par jour) et la machine à sous
 * « Le Bandit du Baron ». Tout l'argent est fictif et tenu par le serveur.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  CASE_VERTE_SALON,
  CASES_ROUE_SALON,
  formatDollars,
  GROS_GAIN_ROUE,
  MISE_GROS_LOT_ENTIER,
  MULTIPLE_GROS_GAIN,
  type AnnonceCasino,
  type VueBonusMachine,
  type VueCasino,
} from '../../shared/casino';
import {
  BANDES,
  NB_LIGNES,
  GAINS_COFFRES,
  GAINS_LIGNE,
  LIGNES,
  MISES_MACHINE,
  COUPS_BONUS_CASSE,
  COUPS_DEPART_CASSE,
  FREE_GAMES,
  MULTIPLICATEUR_GRATUIT,
  ROUE_BARON,
  TOURS_GRATUITS,
  type ContenuCasse,
  type GainLigne,
  type GrilleMachine,
  type SymboleLigne,
  type SymboleMachine,
} from '../../shared/machineASous';
import type { VueTableBJ } from '../../shared/blackjack';
import type { Appel } from './App';
import { TableBlackjack } from './CasinoBlackjack';
import { MachineNuits } from './CasinoNuits';
import { TableRoulette } from './CasinoRoulette';
import type { VueTableRoulette } from '../../shared/rouletteCasino';
import type { EtatCompte } from './Profil';
import { ANGLE_ROUE, COULEURS_ROUE, DUREE_ROUE_MS, Roue, useAttente, type CaseRoue } from './RouletteDuJour';
import { socket } from './socket';
import { EN, tr } from './traduction';
import { BoutonMusique, Celebration, Fenetre, jouerEffet, mouvementReduit, musiqueDuSalon, useCompteur } from './ui';
import { dollars, GainDefilant, Jeton, LINGOTS_PALIER, palierDe, PluieLingots, useSoldeAnime, type Palier } from './casinoOutils';
import './casino.css';


// ---------------------------------------------------------------------------------------------------------------
// Symboles de la machine à sous (dessinés en attendant les images définitives)

const NOMS_SYMBOLES: Record<SymboleMachine, [string, string]> = {
  couronne: ['Couronne', 'Crown'],
  coffre: ['Coffre-fort', 'Safe'],
  jeton: ['Jeton Free Game', 'Free Game chip'],
  sept: ['Sept', 'Seven'],
  lingot: ['Lingot', 'Gold bar'],
  diamant: ['Diamant', 'Diamond'],
  champagne: ['Champagne', 'Champagne'],
  cigare: ['Cigare', 'Cigar'],
  fer: ['Fer à cheval', 'Horseshoe'],
};
const nomSymbole = (s: SymboleMachine) => tr(...NOMS_SYMBOLES[s]);

export function Symbole({ s, className }: { s: SymboleMachine; className?: string }) {
  return <img className={`cas-symbole cas-symbole-${s} ${className ?? ''}`} src={`/cartes/machine-${s}.webp`} alt={nomSymbole(s)} draggable={false} />;
}

// ---------------------------------------------------------------------------------------------------------------
// Roulette du salon

const CASES_SALON: CaseRoue[] = CASES_ROUE_SALON.map((v, i) =>
  i === CASE_VERTE_SALON
    ? { fond: COULEURS_ROUE.vert, lignes: ['1', 'MILLION'] }
    : { fond: i % 2 ? COULEURS_ROUE.noir : COULEURS_ROUE.rouge, lignes: [v.toLocaleString(EN ? 'en-US' : 'fr-FR').replace(/\s/g, ' '), '$'], petit: true },
);

function FenetreRoueSalon({ vue, appel, onVue, onFermer }: { vue: VueCasino; appel: Appel; onVue: (v: VueCasino) => void; onFermer: () => void }) {
  const [rotation, setRotation] = useState(0);
  const [tourne, setTourne] = useState(false);
  const [resultat, setResultat] = useState<{ case: number; gain: number } | null>(null);
  const [fete, setFete] = useState(false);
  const minuterie = useRef(0);
  useEffect(() => () => window.clearTimeout(minuterie.current), []);
  const attente = useAttente(vue.roueProchaine);
  const disponible = !attente && !tourne && !resultat;

  const tourner = async () => {
    if (!disponible) return;
    const r = (await appel('casino_roue')) as { ok: boolean; roue?: { case: number; gain: number }; casino?: VueCasino };
    if (!r.ok || !r.roue || !r.casino) return;
    const { case: i, gain } = r.roue;
    const nouvelle = r.casino;
    const cible = 360 * 6 + (360 - (i * ANGLE_ROUE + ANGLE_ROUE / 2)) + (Math.random() - 0.5) * ANGLE_ROUE * 0.6;
    const fin = () => {
      setTourne(false);
      setResultat({ case: i, gain });
      onVue(nouvelle);
      const gros = gain >= GROS_GAIN_ROUE;
      if (gros) setFete(true);
      jouerEffet(gros ? 'roulette_gros_lot' : 'machine_pieces');
    };
    if (mouvementReduit()) {
      setRotation(cible % 360);
      fin();
      return;
    }
    jouerEffet('roulette_depart');
    setTourne(true);
    setRotation(0);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => setRotation(cible)));
    minuterie.current = window.setTimeout(fin, DUREE_ROUE_MS + 150);
  };

  return (
    <Fenetre titre={tr('Roulette du salon', 'Lounge wheel')} onFermer={tourne ? undefined : onFermer} large>
      <Roue cases={CASES_SALON} rotation={rotation} tourne={tourne} gagnante={resultat?.case ?? null} pieces={!!resultat && resultat.gain < GROS_GAIN_ROUE} />
      {resultat ? (
        <div className="roulette-resultat" role="status">
          <div>
            <GainDefilant gain={resultat.gain} />
            <span>{tr('Ajoutés à ton solde.', 'Added to your balance.')}</span>
          </div>
        </div>
      ) : (
        <button type="button" className="principal large bouton-tourner" disabled={!disponible} onClick={() => void tourner()}>
          {tourne ? tr('La roue tourne…', 'Spinning…') : attente ? tr(`Prochain tour dans ${attente}`, `Next spin in ${attente}`) : tr('Tourner la roue', 'Spin the wheel')}
        </button>
      )}
      {fete && resultat && (
        <Celebration
          titre={resultat.case === CASE_VERTE_SALON ? tr('Le million !', 'The million!') : tr('Gros gain !', 'Big win!')}
          etiquette={tr(`Gain : ${dollars(resultat.gain)}`, `Win: ${dollars(resultat.gain)}`)}
          medaillon={<strong className="celebration-xp cas-medaillon-gain">{dollars(resultat.gain)}</strong>}
          legende={tr('Ajouté à ton solde', 'Added to your balance')}
          onFermer={() => setFete(false)}
        />
      )}
    </Fenetre>
  );
}


// ---------------------------------------------------------------------------------------------------------------
// Machine à sous « Le Bandit du Baron »

interface TourMachine {
  arrets: number[];
  grille: GrilleMachine;
  lignes: GainLigne[];
  coffres: number;
  /** Jetons FREE GAME visibles, et free games gagnés. */
  jetons: number;
  freeGames: number;
  gain: number;
  gainGrosLot: number;
  /** 3 Coffres ou plus : le Casse du coffre. */
  casse: boolean;
  /** Une Couronne sur le premier et sur le dernier rouleau : la Roue du Baron. */
  roue: boolean;
  grosLot: boolean;
  gratuit: boolean;
  mise: number;
}

/** Ampoules de l'arche, en % de l'image du haut de la machine : elles scintillent, puis s'emballent. */
const AMPOULES: [number, number][] = [
  [10.74, 27.82], [13.48, 22.38], [17.09, 17.64], [21.88, 13.1], [27.83, 9.17], [34.96, 6.05], [42.38, 4.13], [49.71, 3.02],
  [57.23, 4.13], [64.75, 5.95], [71.97, 9.17], [77.93, 13.1], [82.71, 17.64], [86.13, 22.38], [88.96, 27.82],
];

/** Arrêt du premier rouleau, écart entre deux rouleaux, et temps ajouté au suspense selon sa force (ms). */
const ARRET_PREMIER = 1100;
const ECART_ARRETS = 320;
const EXTRA_SUSPENSE = [0, 700, 1250, 1900];
/** Cases qui défilent par seconde : la bande est d'autant plus longue que le rouleau tourne longtemps. */
const CASES_PAR_SECONDE = 13;

type MotifSuspense = 'coffre' | 'jeton' | 'couronne' | 'ligne' | 'grosLot';
/** Suspense d'un rouleau : sa force (0 à 3, selon la rareté de ce qui peut tomber), sa raison, et les cases qui l'annoncent. */
interface Suspense {
  niveau: 0 | 1 | 2 | 3;
  motif: MotifSuspense | null;
  cases: number[];
}

/** Symbole d'une suite complète (Couronnes comprises) sur les premiers rouleaux, ou null. */
function suiteComplete(suite: SymboleMachine[]): SymboleLigne | null {
  let j = 0;
  while (j < suite.length && suite[j] === 'couronne') j++;
  if (j === suite.length) return 'couronne';
  const base = suite[j];
  if (base === 'coffre' || base === 'jeton') return null;
  return suite.every((x) => x === base || x === 'couronne') ? (base as SymboleLigne) : null;
}

/**
 * Le suspense de chaque rouleau, d'après ceux déjà arrêtés : 2 Coffres (le casse), 2 jetons (les free games), une
 * Couronne sur le premier rouleau (la Roue du Baron, sur le dernier), 5 Coffres alignés (le gros lot), ou une
 * belle ligne presque complète. Plus le gain possible est rare, plus le rouleau ralentit et s'illumine.
 */
function planSuspense(g: GrilleMachine): Suspense[] {
  return g.map((_, r) => {
    let s: Suspense = { niveau: 0, motif: null, cases: [] };
    if (r === 0) return s;
    const plus = (niveau: number, motif: MotifSuspense, cases: number[]) => {
      if (niveau > s.niveau) s = { niveau: niveau as Suspense['niveau'], motif, cases };
    };
    const casesDe = (x: SymboleMachine, jusqua = r) => g.slice(0, jusqua).flatMap((col, k) => col.flatMap((y, rang) => (y === x ? [k * 3 + rang] : [])));
    const coffres = casesDe('coffre');
    const jetons = casesDe('jeton');
    if (coffres.length === 2) plus(2, 'coffre', coffres);
    else if (coffres.length === 3) plus(1, 'coffre', coffres);
    else if (coffres.length >= 4) plus(2, 'coffre', coffres);
    if (jetons.length === 2) plus(2, 'jeton', jetons);
    else if (jetons.length === 3) plus(1, 'jeton', jetons);
    else if (jetons.length >= 4) plus(2, 'jeton', jetons);
    if (r === 4 && g[0].includes('couronne')) plus(3, 'couronne', casesDe('couronne', 1));
    if (r >= 3)
      LIGNES.forEach((rangs) => {
        const suite = rangs.slice(0, r).map((rang, k) => g[k][rang]);
        const cases = rangs.slice(0, r).map((rang, k) => k * 3 + rang);
        if (suite.every((x) => x === 'coffre')) return plus(3, 'grosLot', cases);
        const sym = suiteComplete(suite);
        if (!sym) return;
        if (r === 4) plus(sym === 'couronne' ? 3 : sym === 'sept' ? 2 : sym === 'lingot' || sym === 'diamant' ? 1 : 0, 'ligne', cases);
        else if (sym === 'couronne' || sym === 'sept') plus(1, 'ligne', cases);
      });
    return s;
  });
}

/** Moment où chaque rouleau s'arrête (ms) : les rouleaux à suspense tournent plus longtemps, les suivants attendent. */
function horairesArrets(plan: Suspense[]): number[] {
  const t: number[] = [];
  plan.forEach((s, r) => t.push((r ? t[r - 1] + ECART_ARRETS : ARRET_PREMIER) + EXTRA_SUSPENSE[s.niveau]));
  return t;
}

function TableDesGains({ onFermer }: { onFermer: () => void }) {
  const ordre: SymboleLigne[] = ['couronne', 'sept', 'lingot', 'diamant', 'champagne', 'cigare', 'fer'];
  return (
    <Fenetre titre={tr('Table des gains', 'Paytable')} onFermer={onFermer}>
      <p className="discret">{tr('Multiples de la mise d’une ligne (la mise du tour est répartie sur 10 lignes), de gauche à droite.', 'Multiples of the line bet (the spin bet is split over 10 lines), from left to right.')}</p>
      <table className="cas-gains">
        <thead>
          <tr>
            <th />
            <th>×3</th>
            <th>×4</th>
            <th>×5</th>
          </tr>
        </thead>
        <tbody>
          {ordre.map((s) => (
            <tr key={s}>
              <td>
                <Symbole s={s} />
                <span>{nomSymbole(s)}</span>
              </td>
              {GAINS_LIGNE[s].map((g, k) => (
                <td key={k}>{g}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="cas-gains-note">
        <Symbole s="couronne" /> {tr('La Couronne remplace tous les symboles, sauf le Coffre et le jeton FREE GAME.', 'The Crown replaces every symbol except the Safe and the FREE GAME chip.')}
      </p>
      <p className="cas-gains-note">
        <Symbole s="coffre" />
        {tr(
          `Coffres n’importe où : 3 = ${GAINS_COFFRES[3]} × la mise, 4 = ${GAINS_COFFRES[4]} ×, 5 = ${GAINS_COFFRES[5]} ×. 5 Coffres sur une ligne : le gros lot du salon.`,
          `Safes anywhere: 3 = ${GAINS_COFFRES[3]} × the bet, 4 = ${GAINS_COFFRES[4]} ×, 5 = ${GAINS_COFFRES[5]} ×. 5 Safes on a line: the lounge jackpot.`,
        )}
      </p>
      <h3 className="cas-gains-titre">Free games</h3>
      <p className="cas-gains-note">
        <Symbole s="jeton" />
        {tr(
          `Jetons FREE GAME n’importe où : 3 = ${FREE_GAMES[3]} free games, 4 = ${FREE_GAMES[4]}, 5 = ${FREE_GAMES[5]}. Pendant les free games, tous les gains comptent ×${MULTIPLICATEUR_GRATUIT}, et 3 nouveaux jetons en rajoutent. La Couronne ne remplace pas le jeton.`,
          `FREE GAME chips anywhere: 3 = ${FREE_GAMES[3]} free games, 4 = ${FREE_GAMES[4]}, 5 = ${FREE_GAMES[5]}. During free games every win counts ×${MULTIPLICATEUR_GRATUIT}, and 3 new chips add more. The Crown does not replace the chip.`,
        )}
      </p>
      <h3 className="cas-gains-titre">{tr('Le Casse du coffre', 'The Safe Heist')}</h3>
      <p className="cas-gains-note">
        <Symbole s="coffre" />
        {tr(
          `3 Coffres ou plus lancent le casse : 12 coffres-forts fermés et ${COUPS_DEPART_CASSE} coups. Chaque coffre ouvert coûte un coup et cache une liasse de billets, un lingot (le butin passe à ×2, puis ×3), des outils (+${COUPS_BONUS_CASSE} coups)… ou la sirène de police, qui arrête le casse. Tu repars toujours avec le butin.`,
          `3 or more Safes start the heist: 12 closed safes and ${COUPS_DEPART_CASSE} moves. Each safe you open costs a move and hides a bundle of bills, a gold bar (the loot goes ×2, then ×3), tools (+${COUPS_BONUS_CASSE} moves)… or the police siren, which ends the heist. You always leave with the loot.`,
        )}
      </p>
      <h3 className="cas-gains-titre">{tr('La Roue du Baron', 'The Baron’s Wheel')}</h3>
      <p className="cas-gains-note">
        <Symbole s="couronne" />
        {tr(
          `Une Couronne sur le premier et sur le dernier rouleau lance la roue : ×10, ×25, ×50 ou ×100 la mise, ${TOURS_GRATUITS} tours gratuits (gains ×${MULTIPLICATEUR_GRATUIT}), ou la case verte du gros lot du salon.`,
          `A Crown on the first and on the last reel spins the wheel: ×10, ×25, ×50 or ×100 the bet, ${TOURS_GRATUITS} free spins (wins ×${MULTIPLICATEUR_GRATUIT}), or the green lounge jackpot slot.`,
        )}
      </p>
      <p className="cas-gains-note discret">
        {tr(
          `Gros lot : en entier à partir de ${dollars(MISE_GROS_LOT_ENTIER)} de mise ; en dessous, une part proportionnelle à la mise.`,
          `Jackpot: paid in full from a ${dollars(MISE_GROS_LOT_ENTIER)} bet; below that, a share in proportion to the bet.`,
        )}
      </p>
    </Fenetre>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Bonus de la machine : le Casse du coffre et la Roue du Baron

/** Images des bonus : l'image définitive dès qu'elle est en ligne, un dessin de remplacement en attendant. */
const IMAGES_BONUS = ['casse-coffre-ferme', 'casse-coffre-ouvert', 'casse-billets', 'casse-outils', 'casse-sirene', 'roue-baron'] as const;
type ImageBonus = (typeof IMAGES_BONUS)[number];
const imagesVerifiees = new Map<string, Promise<boolean>>();
function verifierImage(nom: string): Promise<boolean> {
  let p = imagesVerifiees.get(nom);
  if (!p) {
    p = new Promise<boolean>((ok) => {
      const img = new Image();
      img.onload = () => ok(img.naturalWidth > 0);
      img.onerror = () => ok(false);
      img.src = `/cartes/${nom}.webp`;
    });
    imagesVerifiees.set(nom, p);
  }
  return p;
}
const prechargerImagesBonus = () => IMAGES_BONUS.forEach((n) => void verifierImage(n));
function useImagesBonus(): Partial<Record<ImageBonus, boolean>> {
  const [dispo, setDispo] = useState<Partial<Record<ImageBonus, boolean>>>({});
  useEffect(() => {
    let vivant = true;
    for (const n of IMAGES_BONUS) void verifierImage(n).then((ok) => vivant && setDispo((d) => ({ ...d, [n]: ok })));
    return () => {
      vivant = false;
    };
  }, []);
  return dispo;
}

function DessinBillets() {
  return (
    <svg className="casse-dessin" viewBox="0 0 100 100" aria-hidden="true">
      <rect x="9" y="27" width="82" height="46" rx="4" fill="#163821" stroke="#9c7a3a" strokeWidth="2" transform="rotate(-13 50 50)" />
      <g transform="rotate(-3 50 50)">
        <rect x="5" y="26" width="90" height="50" rx="4" fill="#2b5c37" stroke="#e7c27a" strokeWidth="2.4" />
        <rect x="11" y="32" width="78" height="38" rx="2" fill="none" stroke="#86b582" strokeWidth="1.2" />
        <circle cx="64" cy="51" r="14" fill="#1f4a2b" stroke="#e7c27a" strokeWidth="2" />
        <text x="64" y="59" textAnchor="middle" fontSize="23" fill="#f3dca4" fontFamily="Georgia, serif">
          $
        </text>
        <rect x="24" y="23" width="14" height="56" rx="1.5" fill="#d2a85a" stroke="#8a6424" strokeWidth="1.4" />
      </g>
    </svg>
  );
}
function DessinOutils() {
  return (
    <svg className="casse-dessin" viewBox="0 0 100 100" aria-hidden="true">
      <path d="M20 88 L74 24 Q80 16 88 20 Q95 24 90 32" fill="none" stroke="#2a2420" strokeWidth="13" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 88 L74 24 Q80 16 88 20 Q95 24 90 32" fill="none" stroke="#c3c7cd" strokeWidth="8.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 88 L10 85 M20 88 L18 97" stroke="#c3c7cd" strokeWidth="6.5" strokeLinecap="round" />
      <circle cx="30" cy="31" r="22" fill="#1b120c" stroke="#e7c27a" strokeWidth="2.6" />
      <text x="30" y="39.5" textAnchor="middle" fontSize="24" fill="#f3dca4" fontFamily="Georgia, serif">
        +{COUPS_BONUS_CASSE}
      </text>
    </svg>
  );
}
function DessinSirene() {
  return (
    <svg className="casse-dessin casse-dessin-sirene" viewBox="0 0 100 100" aria-hidden="true">
      <path className="casse-rayons" d="M50 3 V15 M15 14 L24 23 M85 14 L76 23 M3 46 H15 M97 46 H85" stroke="#ff5a44" strokeWidth="5.5" strokeLinecap="round" />
      <path d="M24 74 V50 Q24 24 50 24 Q76 24 76 50 V74 Z" fill="#b8231a" stroke="#e7c27a" strokeWidth="2.6" />
      <path d="M34 52 Q34 36 46 32" fill="none" stroke="#ffc2b2" strokeWidth="5" strokeLinecap="round" />
      <rect x="14" y="74" width="72" height="14" rx="3" fill="#1b120c" stroke="#e7c27a" strokeWidth="2.6" />
    </svg>
  );
}

/** Ce que cache un coffre ouvert : le dessin, et ce qu'il rapporte. */
function ContenuCoffre({ c, mise, dispo, multiple }: { c: ContenuCasse; mise: number; dispo: Partial<Record<ImageBonus, boolean>>; multiple?: number }) {
  const image = (nom: ImageBonus, repli: ReactNode) => (dispo[nom] ? <img className="casse-dessin" src={`/cartes/${nom}.webp`} alt="" draggable={false} /> : repli);
  const [dessin, etiquette] =
    c.type === 'billets'
      ? [image('casse-billets', <DessinBillets />), `+${dollars(c.valeur * mise)}`]
      : c.type === 'lingot'
        ? [<img key="l" className="casse-dessin" src="/cartes/machine-lingot.webp" alt="" draggable={false} />, multiple ? `×${multiple}` : tr('Butin ×+1', 'Loot ×+1')]
        : c.type === 'coups'
          ? [image('casse-outils', <DessinOutils />), tr(`+${COUPS_BONUS_CASSE} coups`, `+${COUPS_BONUS_CASSE} moves`)]
          : [image('casse-sirene', <DessinSirene />), tr('Sirène !', 'Siren!')];
  return (
    <>
      {dessin}
      <span className="casse-etiquette">{etiquette}</span>
    </>
  );
}

type BonusCasse = Extract<VueBonusMachine, { type: 'casse' }>;
type ReponseCasse = BonusCasse & { fini: boolean; sirene: boolean; gain: number; tout?: ContenuCasse[] };

function messageCasse(c: ContenuCasse, e: BonusCasse, mise: number): string {
  if (c.type === 'billets') return tr(`Une liasse : ${dollars(c.valeur * mise)} de plus dans le sac.`, `A bundle: ${dollars(c.valeur * mise)} more in the bag.`);
  if (c.type === 'lingot') return tr(`Un lingot d’or : le butin vaut maintenant ×${e.multiplicateur}.`, `A gold bar: the loot is now worth ×${e.multiplicateur}.`);
  if (c.type === 'coups') return tr(`Les outils du perceur : +${COUPS_BONUS_CASSE} coups !`, `The safecracker’s tools: +${COUPS_BONUS_CASSE} moves!`);
  return tr('La sirène ! La police débarque.', 'The siren! The police are coming.');
}

/** Le Casse du coffre : 12 coffres-forts, un coup par coffre ouvert, jusqu'à la sirène (ou au dernier coup). */
function CasseDuCoffre({ bonus, appel, onVue, onFermer }: { bonus: BonusCasse; appel: Appel; onVue: (v: VueCasino) => void; onFermer: () => void }) {
  const dispo = useImagesBonus();
  const mise = bonus.mise;
  const [etat, setEtat] = useState<BonusCasse>(bonus);
  const [ouvrant, setOuvrant] = useState<number | null>(null);
  // Le multiplicateur atteint par chaque lingot ouvert (affiché dans son coffre).
  const [multiples, setMultiples] = useState<Record<number, number>>({});
  const [message, setMessage] = useState(() =>
    bonus.ouverts.some(Boolean) ? tr('Le casse reprend. Choisis un coffre.', 'The heist resumes. Pick a safe.') : tr('Choisis un coffre. Gare à la sirène !', 'Pick a safe. Watch out for the siren!'),
  );
  const [fin, setFin] = useState<{ gain: number; sirene: boolean; tout: ContenuCasse[] } | null>(null);
  const [alerte, setAlerte] = useState(false);
  const [fete, setFete] = useState(false);
  const minuteries = useRef<number[]>([]);
  useEffect(() => () => minuteries.current.forEach((t) => window.clearTimeout(t)), []);
  const plusTard = (f: () => void, ms: number) => minuteries.current.push(window.setTimeout(f, ms));

  const ouvrir = async (i: number) => {
    if (ouvrant !== null || fin || etat.ouverts[i]) return;
    setOuvrant(i);
    jouerEffet('coffre_ouvre');
    const r = (await appel('casino_casse', { index: i })) as { ok: boolean; erreur?: string; contenu?: ContenuCasse; casse?: ReponseCasse; casino?: VueCasino };
    if (!r.ok || !r.contenu || !r.casse || !r.casino) {
      setOuvrant(null);
      setMessage(r.erreur ?? tr('Le coffre résiste… réessaie.', 'The safe resists… try again.'));
      return;
    }
    const { contenu, casse } = r;
    const nouvelle = r.casino;
    // La porte tremble pendant que le cadran tourne, puis s'ouvre sur le contenu.
    plusTard(() => {
      setEtat(casse);
      setOuvrant(null);
      if (contenu.type === 'lingot') setMultiples((m) => ({ ...m, [i]: casse.multiplicateur }));
      setMessage(messageCasse(contenu, casse, mise));
      jouerEffet(contenu.type === 'billets' ? 'billets' : contenu.type === 'lingot' ? 'lingots' : contenu.type === 'coups' ? 'deblocage' : 'sirene');
      if (contenu.type === 'sirene') setAlerte(true);
      if (!casse.fini) return onVue(nouvelle);
      plusTard(
        () => {
          setFin({ gain: casse.gain, sirene: casse.sirene, tout: casse.tout ?? [] });
          onVue(nouvelle);
          if (casse.gain >= MULTIPLE_GROS_GAIN * mise) {
            setFete(true);
            jouerEffet('roulette_gros_lot');
          } else if (casse.gain > 0) jouerEffet('machine_pieces');
        },
        contenu.type === 'sirene' ? 1600 : 800,
      );
    }, mouvementReduit() ? 0 : 520);
  };

  return (
    <div className={`cas-bonus casse ${alerte ? 'alerte' : ''}`} role="dialog" aria-label={tr('Le Casse du coffre', 'The Safe Heist')}>
      <div className="cas-bonus-contenu">
        <header className="cas-bonus-tete">
          <h2>{tr('Le Casse du coffre', 'The Safe Heist')}</h2>
          <span>{tr(`Mise du bonus : ${dollars(mise)}`, `Bonus bet: ${dollars(mise)}`)}</span>
        </header>
        <div className="casse-etat">
          <div>
            <small>{tr('Coups', 'Moves')}</small>
            <strong key={`c${etat.coups}`}>{etat.coups}</strong>
          </div>
          <div>
            <small>{tr('Butin', 'Loot')}</small>
            <strong key={`b${etat.butin}`}>{dollars(etat.butin * mise)}</strong>
          </div>
          <div>
            <small>{tr('Multiplicateur', 'Multiplier')}</small>
            <strong key={`m${etat.multiplicateur}`}>×{etat.multiplicateur}</strong>
          </div>
        </div>
        <div className="casse-grille">
          {etat.ouverts.map((c, i) => {
            const vu = c ?? (fin ? fin.tout[i] : null);
            return (
              <button
                key={i}
                type="button"
                data-son="aucun"
                className={`casse-coffre ${c ? 'ouvert' : ''} ${!c && vu ? 'revele' : ''} ${ouvrant === i ? 'ouvre' : ''} ${c?.type === 'sirene' ? 'sirene' : ''}`}
                disabled={!!c || !!fin || ouvrant !== null}
                onClick={() => void ouvrir(i)}
                aria-label={c ? tr(`Coffre ${i + 1} : ouvert`, `Safe ${i + 1}: open`) : tr(`Ouvrir le coffre ${i + 1}`, `Open safe ${i + 1}`)}
              >
                <span className={`casse-interieur ${dispo['casse-coffre-ouvert'] ? 'image' : ''}`}>{vu && <ContenuCoffre c={vu} mise={mise} dispo={dispo} multiple={multiples[i]} />}</span>
                <img className="casse-porte" src={dispo['casse-coffre-ferme'] ? '/cartes/casse-coffre-ferme.webp' : '/cartes/machine-coffre.webp'} alt="" draggable={false} />
              </button>
            );
          })}
        </div>
        {fin ? (
          <div className="casse-fin" role="status">
            <p>{fin.sirene ? tr('La police débarque ! Tu files avec le butin.', 'The police are here! You run off with the loot.') : tr('Plus de coups : tu files avec le butin.', 'No moves left: you run off with the loot.')}</p>
            {fin.gain > 0 ? (
              <>
                <GainDefilant gain={fin.gain} />
                {etat.multiplicateur > 1 && (
                  <small>
                    {dollars(etat.butin * mise)} × {etat.multiplicateur}
                  </small>
                )}
              </>
            ) : (
              <strong className="casse-vide">{tr('Les poches vides…', 'Empty pockets…')}</strong>
            )}
            <button type="button" className="principal large" onClick={onFermer}>
              {fin.gain > 0 ? tr('Encaisser', 'Cash in') : tr('Retour à la machine', 'Back to the machine')}
            </button>
          </div>
        ) : (
          <p className="casse-message" role="status">
            {message}
          </p>
        )}
      </div>
      {fete && fin && (
        <Celebration
          titre={tr('Le casse du siècle !', 'The heist of the century!')}
          etiquette={tr(`Gain : ${dollars(fin.gain)}`, `Win: ${dollars(fin.gain)}`)}
          medaillon={<strong className="celebration-xp cas-medaillon-gain">{dollars(fin.gain)}</strong>}
          legende={tr('Ajouté à ton solde', 'Added to your balance')}
          onFermer={() => setFete(false)}
        />
      )}
    </div>
  );
}

/** Les 12 cases de la Roue du Baron (rouge sang et noir, la case verte du gros lot, la case dorée des tours gratuits). */
const CASES_BARON: CaseRoue[] = ROUE_BARON.map((c, i) =>
  c.type === 'grosLot'
    ? { fond: COULEURS_ROUE.vert, lignes: [tr('GROS', 'JACK'), tr('LOT', 'POT')], petit: true }
    : c.type === 'tours'
      ? { fond: '#6a4914', lignes: [String(c.n), tr('TOURS', 'SPINS')], petit: true }
      : { fond: i % 2 ? COULEURS_ROUE.noir : COULEURS_ROUE.rouge, lignes: [`×${c.x}`, tr('MISE', 'BET')], petit: true },
);

/** La Roue du Baron : le serveur tire la case ; la roue tourne ici jusqu'à elle. */
function RoueDuBaron({ mise, appel, onVue, onFermer }: { mise: number; appel: Appel; onVue: (v: VueCasino) => void; onFermer: () => void }) {
  const dispo = useImagesBonus();
  const [rotation, setRotation] = useState(0);
  const [tourne, setTourne] = useState(false);
  const [resultat, setResultat] = useState<{ case: number; gain: number; tours: number; grosLot: boolean } | null>(null);
  const [fete, setFete] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const minuterie = useRef(0);
  useEffect(() => () => window.clearTimeout(minuterie.current), []);
  const angle = 360 / CASES_BARON.length;

  const lancer = async () => {
    if (tourne || resultat) return;
    setErreur(null);
    const r = (await appel('casino_roue_baron')) as { ok: boolean; erreur?: string; roueBaron?: { case: number; gain: number; tours: number; grosLot: boolean }; casino?: VueCasino };
    if (!r.ok || !r.roueBaron || !r.casino) return setErreur(r.erreur ?? tr('La roue est bloquée… réessaie.', 'The wheel is stuck… try again.'));
    const res = r.roueBaron;
    const nouvelle = r.casino;
    const cible = 360 * 7 + (360 - (res.case * angle + angle / 2)) + (Math.random() - 0.5) * angle * 0.6;
    const fin = () => {
      setTourne(false);
      setResultat(res);
      onVue(nouvelle);
      const grand = res.grosLot || res.tours > 0 || res.gain >= MULTIPLE_GROS_GAIN * mise;
      if (grand) setFete(true);
      jouerEffet(grand ? 'roulette_gros_lot' : 'roulette_gain');
    };
    if (mouvementReduit()) {
      setRotation(cible % 360);
      return fin();
    }
    jouerEffet('roulette_depart');
    setTourne(true);
    setRotation(0);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => setRotation(cible)));
    minuterie.current = window.setTimeout(fin, DUREE_ROUE_MS + 150);
  };

  const c = resultat ? ROUE_BARON[resultat.case] : null;
  return (
    <div className="cas-bonus roue-baron" role="dialog" aria-label={tr('La Roue du Baron', 'The Baron’s Wheel')}>
      <div className="cas-bonus-contenu">
        <header className="cas-bonus-tete">
          <img src={dispo['roue-baron'] ? '/cartes/roue-baron.webp' : '/cartes/machine-couronne.webp'} alt="" draggable={false} />
          <h2>{tr('La Roue du Baron', 'The Baron’s Wheel')}</h2>
          <span>{tr(`Mise du bonus : ${dollars(mise)}`, `Bonus bet: ${dollars(mise)}`)}</span>
        </header>
        <Roue cases={CASES_BARON} rotation={rotation} tourne={tourne} gagnante={resultat?.case ?? null} pieces={!!resultat && !fete && resultat.gain > 0} />
        {resultat && c ? (
          <>
            <div className="roulette-resultat" role="status">
              <div>
                {c.type === 'tours' ? (
                  <strong className="roulette-xp-gagne">{tr(`${resultat.tours} tours gratuits`, `${resultat.tours} free spins`)}</strong>
                ) : (
                  <GainDefilant gain={resultat.gain} />
                )}
                <span>
                  {c.type === 'tours'
                    ? tr(`Gains ×${MULTIPLICATEUR_GRATUIT}, à ${dollars(mise)} le tour.`, `Wins ×${MULTIPLICATEUR_GRATUIT}, at ${dollars(mise)} a spin.`)
                    : c.type === 'grosLot'
                      ? tr('Le gros lot du salon !', 'The lounge jackpot!')
                      : tr(`×${c.x} la mise, ajoutés à ton solde.`, `×${c.x} the bet, added to your balance.`)}
                </span>
              </div>
            </div>
            <button type="button" className="principal large" onClick={onFermer}>
              {c.type === 'tours' ? tr('Jouer les tours gratuits', 'Play the free spins') : tr('Retour à la machine', 'Back to the machine')}
            </button>
          </>
        ) : (
          <button type="button" className="principal large bouton-tourner" disabled={tourne} onClick={() => void lancer()}>
            {tourne ? tr('La roue tourne…', 'Spinning…') : tr('Lancer la roue', 'Spin the wheel')}
          </button>
        )}
        {erreur && <p className="cas-erreur">{erreur}</p>}
      </div>
      {fete && resultat && c && (
        <Celebration
          titre={c.type === 'grosLot' ? tr('Gros lot du salon !', 'Lounge jackpot!') : c.type === 'tours' ? tr('Tours gratuits !', 'Free spins!') : tr(`×${c.type === 'multiple' ? c.x : ''} la mise !`, `×${c.type === 'multiple' ? c.x : ''} the bet!`)}
          etiquette={c.type === 'tours' ? tr(`${resultat.tours} tours gratuits`, `${resultat.tours} free spins`) : tr(`Gain : ${dollars(resultat.gain)}`, `Win: ${dollars(resultat.gain)}`)}
          medaillon={
            c.type === 'tours' ? (
              <div className="cas-medaillon-bonus">
                <Symbole s="couronne" />
                <strong>{resultat.tours}</strong>
              </div>
            ) : (
              <strong className="celebration-xp cas-medaillon-gain">{dollars(resultat.gain)}</strong>
            )
          }
          legende={c.type === 'tours' ? tr(`${resultat.tours} tours, gains doublés`, `${resultat.tours} spins, double wins`) : tr('Ajouté à ton solde', 'Added to your balance')}
          onFermer={() => setFete(false)}
        />
      )}
    </div>
  );
}

/** Une colonne de la machine : pendant le tour, une longue bande défile jusqu'aux 3 symboles tirés. */
function Rouleau({
  index,
  symboles,
  defile,
  duree,
  gagnantes,
  annonce,
  suspense,
}: {
  index: number;
  symboles: SymboleMachine[];
  defile: boolean;
  duree: number;
  gagnantes: Set<number>;
  /** Cases qui annoncent le suspense (elles battent pendant que le rouleau suivant ralentit). */
  annonce: Set<number>;
  /** Suspense en cours sur ce rouleau (il tourne encore, les précédents sont arrêtés). */
  suspense: Suspense | null;
}) {
  const decalage = symboles.length - 3;
  return (
    <div className={`cas-rouleau ${suspense ? `suspense sus-${suspense.niveau} sus-${suspense.motif}` : ''}`}>
      <div
        className="cas-bande"
        style={{
          transform: `translateY(calc(var(--case) * ${defile ? -decalage : 0}))`,
          transitionDuration: defile ? `${duree}ms` : '0ms',
          // Un rouleau à suspense ralentit longuement avant de s'arrêter.
          ...(suspense ? { transitionTimingFunction: 'cubic-bezier(0.1, 0.62, 0.18, 1)' } : {}),
        }}
      >
        {symboles.map((s, k) => {
          const c = index * 3 + k;
          return (
            <div key={k} className={`cas-case ${!defile && gagnantes.has(c) ? 'gagnante' : ''} ${annonce.has(c) && k < 3 ? 'annonce' : ''}`}>
              <Symbole s={s} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Les lignes gagnantes arrivent une à une, chacune avec ce qu'elle rapporte. */
function LignesGagnantes({ tour }: { tour: TourMachine }) {
  const ordre = [...tour.lignes].sort((a, b) => b.multiple - a.multiple);
  const pas = Math.min(650, 2600 / Math.max(1, ordre.length));
  const mult = tour.gratuit ? MULTIPLICATEUR_GRATUIT : 1;
  return (
    <>
      {/* Repère aux proportions des rouleaux (environ 2 de large pour 1 de haut) : le trait garde la même épaisseur partout. */}
      <svg className="cas-lignes" viewBox="0 0 500 242" preserveAspectRatio="none" aria-hidden="true">
        {ordre.map((l, i) => (
          <polyline key={l.ligne} pathLength={1} style={{ animationDelay: `${i * pas}ms` }} points={LIGNES[l.ligne].map((rang, r) => `${(r + 0.5) * 100},${((rang + 0.5) * 242) / 3}`).join(' ')} />
        ))}
      </svg>
      {ordre.slice(0, 6).map((l, i) => (
        <span
          key={l.ligne}
          className="cas-ligne-gain"
          style={{ left: `${((l.nombre - 0.5) / 5) * 100}%`, top: `${((LIGNES[l.ligne][l.nombre - 1] + 0.5) / 3) * 100}%`, animationDelay: `${i * pas + 250}ms` }}
        >
          +{dollars((l.multiple * tour.mise * mult) / NB_LIGNES)}
        </span>
      ))}
    </>
  );
}

type FeteMachine = { type: 'gain'; palier: Palier | 'grosLot'; gain: number } | { type: 'free'; n: number; relance: boolean; mise: number } | { type: 'finFree'; total: number };

function Machine({ vue, appel, onVue, onRetour }: { vue: VueCasino; appel: Appel; onVue: (v: VueCasino) => void; onRetour: () => void }) {
  const [mise, setMise] = useState(() => {
    const m = MISES_MACHINE.filter((x) => x <= Math.max(MISES_MACHINE[0], vue.solde / 20));
    return m[m.length - 1] ?? MISES_MACHINE[0];
  });
  const [grille, setGrille] = useState<GrilleMachine>(() => BANDES.map((b, r) => [0, 1, 2].map((k) => b[(r * 7 + k) % b.length])));
  const [bandes, setBandes] = useState<SymboleMachine[][] | null>(null);
  const [defile, setDefile] = useState(false);
  const [durees, setDurees] = useState<number[]>(() => horairesArrets(planSuspense(BANDES.map(() => ['fer', 'fer', 'fer']))));
  const [plan, setPlan] = useState<Suspense[] | null>(null);
  // Rouleaux déjà arrêtés pendant le tour (pour savoir lequel est en suspense).
  const [arretes, setArretes] = useState(5);
  const [tour, setTour] = useState<TourMachine | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [auto, setAuto] = useState(0);
  const [soldeAffiche, setSoldeAffiche] = useState(vue.solde);
  const [fetes, setFetes] = useState<FeteMachine[]>([]);
  const [pluie, setPluie] = useState<{ n: number; id: number } | null>(null);
  const [banniere, setBanniere] = useState<{ texte: string; id: number } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [gains, setGains] = useState(false);
  // Bonus à jouer (casse ou roue) : repris tel quel en revenant à la machine.
  const [bonus, setBonus] = useState<VueBonusMachine | null>(vue.bonus);
  const vueRef = useRef(vue);
  vueRef.current = vue;
  // Gains cumulés pendant une série de free games.
  const totalFree = useRef(0);
  const minuteries = useRef<number[]>([]);
  const plusTard = (f: () => void, ms: number) => minuteries.current.push(window.setTimeout(f, ms));
  const autoRef = useRef(0);
  autoRef.current = auto;
  useEffect(() => () => minuteries.current.forEach((t) => window.clearTimeout(t)), []);
  useEffect(prechargerImagesBonus, []);
  useEffect(() => {
    if (!enCours) setSoldeAffiche(vue.solde);
  }, [vue.solde, enCours]);
  const solde = useSoldeAnime(soldeAffiche);
  const gratuits = vue.toursGratuits;
  const peutJouer = !enCours && !vue.bonus && (gratuits > 0 || vue.solde >= mise);

  const lancer = useCallback(async () => {
    if (enCours) return;
    setErreur(null);
    jouerEffet('machine_levier');
    setEnCours(true);
    const r = (await appel('casino_machine', { mise })) as { ok: boolean; erreur?: string; machine?: TourMachine; casino?: VueCasino };
    if (!r.ok || !r.machine || !r.casino) {
      setEnCours(false);
      setAuto(0);
      // Un bonus attendait (téléphone resté sur une ancienne version, coupure…) : on le rouvre.
      if (r.casino) {
        onVue(r.casino);
        if (r.casino.bonus) return setBonus(r.casino.bonus);
      }
      setErreur(r.erreur ?? tr('La machine est indisponible.', 'The machine is unavailable.'));
      return;
    }
    const m = r.machine;
    const nouvelle = r.casino;
    if (!m.gratuit) setSoldeAffiche((s) => s - m.mise);
    setTour(null);
    setPluie(null);
    setBanniere(null);
    const reduit = mouvementReduit();
    const p = planSuspense(m.grille);
    const t = horairesArrets(p);

    const fin = () => {
      setDefile(false);
      setBandes(null);
      setPlan(null);
      setArretes(5);
      setGrille(m.grille);
      setTour(m);
      setEnCours(false);
      onVue(nouvelle);
      setSoldeAffiche(nouvelle.solde);
      // L'animation grandit avec la rareté du gain.
      const palier = m.grosLot ? 'colossal' : palierDe(m.gain, m.mise);
      const file: FeteMachine[] = [];
      if (m.grosLot) file.push({ type: 'gain', palier: 'grosLot', gain: m.gain });
      else if (palier === 'enorme' || palier === 'colossal') file.push({ type: 'gain', palier, gain: m.gain });
      if (palier === 'gros') {
        setBanniere({ texte: tr('Gros gain !', 'Big win!'), id: Date.now() });
        jouerEffet('roulette_gain');
      } else if (palier === 'enorme' || palier === 'colossal') jouerEffet('roulette_gros_lot');
      else if (palier === 'joli') jouerEffet('roulette_gain');
      else if (palier === 'petit') jouerEffet('machine_pieces');
      if (LINGOTS_PALIER[palier] && !reduit) {
        setPluie({ n: LINGOTS_PALIER[palier], id: Date.now() });
        plusTard(() => jouerEffet('lingots_pluie'), 250);
        plusTard(() => setPluie(null), 3600);
      }
      // Free games : gagnés (ou relancés) avec 3 jetons ou plus ; à la fin de la série, le total gagné.
      if (m.gratuit) totalFree.current += m.gain;
      else totalFree.current = 0;
      if (m.freeGames) file.push({ type: 'free', n: m.freeGames, relance: m.gratuit, mise: m.mise });
      else if (m.gratuit && nouvelle.toursGratuits === 0 && !nouvelle.bonus) {
        if (totalFree.current > 0) file.push({ type: 'finFree', total: totalFree.current });
        totalFree.current = 0;
      }
      if (file.length) setFetes((f) => [...f, ...file]);
      // Casse ou roue : les symboles brillent un instant, puis le bonus s'ouvre par-dessus la machine.
      if (nouvelle.bonus) {
        jouerEffet('casino_annonce');
        plusTard(() => setBonus(vueRef.current.bonus), reduit ? 0 : 1300);
      }
      // Tours auto : on continue, sauf après un grand moment (célébration, bonus, free games gagnés).
      if (autoRef.current > 0) {
        if (file.length || nouvelle.bonus) setAuto(0);
        else
          plusTard(
            () => {
              setAuto((a) => Math.max(0, a - 1));
              if (autoRef.current > 1) void lancerRef.current?.();
            },
            palier === 'gros' ? 2800 : palier === 'joli' ? 1900 : m.gain > 0 ? 1200 : 450,
          );
      }
    };
    if (reduit) return fin();
    // Chaque rouleau : les 3 symboles visibles, une bande de passage (plus longue s'il y a du suspense), puis les 3 tirés.
    const longues = grille.map((visibles, r) => {
      const b = BANDES[r];
      const passage = Array.from({ length: Math.round((t[r] / 1000) * CASES_PAR_SECONDE) }, () => b[Math.floor(Math.random() * b.length)]);
      return [...visibles, ...passage, ...m.grille[r]];
    });
    setDurees(t);
    setPlan(p);
    setArretes(0);
    setBandes(longues);
    setDefile(false);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => setDefile(true)));
    t.forEach((d, r) =>
      plusTard(() => {
        jouerEffet('machine_arret');
        setArretes(r + 1);
        // Le rouleau suivant entre en suspense : son de tension selon la force.
        const s = p[r + 1];
        if (s?.niveau) jouerEffet(s.niveau >= 3 ? 'suspense_fort' : 'suspense');
      }, d - 40),
    );
    plusTard(fin, t[4] + 120);
  }, [appel, enCours, grille, mise, onVue]);
  const lancerRef = useRef<typeof lancer | null>(null);
  lancerRef.current = lancer;

  // Cases gagnantes (rouleau × 3 + rangée).
  const gagnantes = new Set<number>();
  for (const l of tour?.lignes ?? []) for (let r = 0; r < l.nombre; r++) gagnantes.add(r * 3 + LIGNES[l.ligne][r]);
  if (tour && tour.coffres >= 3) tour.grille.forEach((col, r) => col.forEach((s, k) => s === 'coffre' && gagnantes.add(r * 3 + k)));
  if (tour && tour.jetons >= 3) tour.grille.forEach((col, r) => col.forEach((s, k) => s === 'jeton' && gagnantes.add(r * 3 + k)));
  if (tour?.roue) [0, 4].forEach((r) => tour.grille[r].forEach((s, k) => s === 'couronne' && gagnantes.add(r * 3 + k)));
  // Suspense en cours : le premier rouleau qui tourne encore, et les cases qui l'annoncent.
  const enSuspense = enCours && plan && arretes < 5 && plan[arretes]?.niveau ? plan[arretes] : null;
  const annonce = new Set(enSuspense?.cases ?? []);
  const fete = fetes[0] ?? null;
  const palier = tour ? (tour.grosLot ? 'colossal' : palierDe(tour.gain, tour.mise)) : 'aucun';
  const etatMachine = enSuspense ? `suspense sus-${enSuspense.niveau} sus-${enSuspense.motif}` : enCours ? 'tourne' : tour && palier !== 'aucun' ? `gagne palier-${palier}` : '';

  const changerMise = (sens: number) => {
    const i = MISES_MACHINE.indexOf(mise);
    jouerEffet('jeton');
    setMise(MISES_MACHINE[Math.min(MISES_MACHINE.length - 1, Math.max(0, i + sens))]);
  };
  const libelleBouton = enCours ? tr('En jeu…', 'Spinning…') : gratuits > 0 ? 'Free game' : tr('Tourner', 'Spin');

  return (
    <div className="cas-ecran cas-machine-ecran">
      <header className="cas-barre">
        <button type="button" className="cas-retour" onClick={onRetour} disabled={enCours} aria-label={tr('Retour au salon', 'Back to the lounge')}>
          ‹ {tr('Salon', 'Lounge')}
        </button>
        <span className="cas-solde-petit" aria-label={tr('Ton solde', 'Your balance')}>
          {dollars(solde)}
        </span>
      </header>
      <div className={`cab ${etatMachine} ${gratuits > 0 || tour?.gratuit ? 'gratuit' : ''}`}>
        <div className="cab-haut">
          <img className="cab-image" src="/cartes/machine-haut.webp" alt="" draggable={false} />
          <span className="cab-ampoules" aria-hidden="true">
            {AMPOULES.map(([x, y], i) => (
              <i key={i} style={{ left: `${x}%`, top: `${y}%`, '--i': i } as CSSProperties} />
            ))}
          </span>
          <span className="cab-lanterne gauche" aria-hidden="true" />
          <span className="cab-lanterne droite" aria-hidden="true" />
          <h2 className="cab-titre">{tr('Le Bandit du Baron', 'The Baron’s Bandit')}</h2>
          <p className="cab-gros-lot">
            {tr('Gros lot', 'Jackpot')} <strong>{dollars(vue.grosLot)}</strong>
          </p>
          <div className="cab-rouleaux">
            {(bandes ?? grille).map((col, r) => (
              <Rouleau
                key={r}
                index={r}
                symboles={col}
                defile={defile}
                duree={durees[r]}
                gagnantes={gagnantes}
                annonce={annonce}
                suspense={enSuspense && arretes === r ? enSuspense : null}
              />
            ))}
            {tour && !enCours && tour.lignes.length > 0 && <LignesGagnantes key={tour.arrets.join('-')} tour={tour} />}
            {banniere && (
              <div key={banniere.id} className="cab-banniere" role="status">
                {banniere.texte}
              </div>
            )}
          </div>
        </div>
        <div className="cab-bas">
          <div className="cas-resultat" role="status">
            {tour && !enCours ? (
              tour.gain > 0 || tour.casse || tour.roue || tour.freeGames ? (
                <>
                  {tour.gain > 0 && <GainDefilant key={tour.arrets.join('-')} gain={tour.gain} delai={0} duree={palier === 'petit' ? 700 : palier === 'joli' ? 1300 : 2000} />}
                  {(tour.casse || tour.roue || tour.freeGames > 0) && (
                    <strong className="cas-bonus-annonce">
                      {[
                        ...(tour.freeGames ? [tr(`${tour.freeGames} free games !`, `${tour.freeGames} free games!`)] : []),
                        ...(tour.casse ? [tr('Le Casse du coffre !', 'The Safe Heist!')] : []),
                        ...(tour.roue ? [tr('La Roue du Baron !', 'The Baron’s Wheel!')] : []),
                      ].join(' · ')}
                    </strong>
                  )}
                  {tour.gain > 0 && (
                    <span>
                      {[
                        ...tour.lignes.slice(0, 2).map((l) => `${l.nombre} × ${nomSymbole(l.symbole)}`),
                        ...(tour.lignes.length > 2 ? [tr(`${tour.lignes.length} lignes`, `${tour.lignes.length} lines`)] : []),
                        ...(tour.coffres >= 3 ? [`${tour.coffres} × ${nomSymbole('coffre')}`] : []),
                      ]
                        .filter((x, i, t) => t.indexOf(x) === i)
                        .join(' · ')}
                      {tour.gratuit && ` (×${MULTIPLICATEUR_GRATUIT})`}
                    </span>
                  )}
                </>
              ) : (
                <span className="discret">{tr('Pas de chance cette fois.', 'No luck this time.')}</span>
              )
            ) : enSuspense ? (
              <strong className={`cas-suspense-texte sus-${enSuspense.motif}`}>
                {enSuspense.motif === 'coffre'
                  ? tr('Encore un Coffre…', 'One more Safe…')
                  : enSuspense.motif === 'jeton'
                    ? tr('Encore un jeton…', 'One more chip…')
                    : enSuspense.motif === 'couronne'
                      ? tr('La Roue du Baron ?', 'The Baron’s Wheel?')
                      : enSuspense.motif === 'grosLot'
                        ? tr('Le gros lot ?!', 'The jackpot?!')
                        : tr('Allez…', 'Come on…')}
              </strong>
            ) : (
              <span className="discret">{tr('10 lignes · la Couronne remplace tout', '10 lines · the Crown replaces everything')}</span>
            )}
            {erreur && <span className="cas-erreur">{erreur}</span>}
          </div>
          {gratuits > 0 ? (
            <div className="cas-free" aria-label="Free games">
              <img src="/cartes/free-games.webp" alt="" draggable={false} />
              <span>
                <strong>{tr(`${gratuits} free games`, `${gratuits} free games`)}</strong>
                <small>
                  {tr(`Gains ×${MULTIPLICATEUR_GRATUIT} · mise ${dollars(vue.miseGratuite)}`, `Wins ×${MULTIPLICATEUR_GRATUIT} · bet ${dollars(vue.miseGratuite)}`)}
                </small>
              </span>
            </div>
          ) : (
            <div className="cas-mise" aria-label={tr('Mise', 'Bet')}>
              <button type="button" onClick={() => changerMise(-1)} disabled={enCours || mise === MISES_MACHINE[0]} aria-label={tr('Baisser la mise', 'Lower the bet')}>
                −
              </button>
              <span className="cas-mise-valeur">
                <Jeton valeur={mise} />
                <span>
                  <small>{tr('Mise', 'Bet')}</small>
                  <strong>{dollars(mise)}</strong>
                </span>
              </span>
              <button type="button" onClick={() => changerMise(1)} disabled={enCours || mise === MISES_MACHINE[MISES_MACHINE.length - 1]} aria-label={tr('Augmenter la mise', 'Raise the bet')}>
                +
              </button>
            </div>
          )}
          <button type="button" className={`cas-tourner ${gratuits > 0 ? 'free' : ''}`} disabled={!peutJouer} onClick={() => void lancer()}>
            <span>{libelleBouton}</span>
          </button>
          <div className="cas-options">
            <button
              type="button"
              className={auto ? 'actif' : ''}
              disabled={!auto && !peutJouer}
              onClick={() => {
                if (auto) return setAuto(0);
                setAuto(gratuits > 0 ? gratuits : 10);
                void lancer();
              }}
            >
              {auto ? tr(`Arrêter (${auto})`, `Stop (${auto})`) : gratuits > 0 ? tr('Tout jouer', 'Play all') : tr('Auto ×10', 'Auto ×10')}
            </button>
            <button type="button" onClick={() => setGains(true)}>
              {tr('Gains', 'Paytable')}
            </button>
          </div>
          {!peutJouer && !enCours && gratuits === 0 && !vue.bonus && <p className="cas-erreur">{tr('Solde insuffisant : baisse la mise ou tourne la roulette du salon.', 'Not enough money: lower the bet or spin the lounge wheel.')}</p>}
        </div>
      </div>
      {pluie && <PluieLingots key={pluie.id} n={pluie.n} />}
      {gains && <TableDesGains onFermer={() => setGains(false)} />}
      {bonus &&
        !enCours &&
        !fete &&
        (bonus.type === 'casse' ? (
          <CasseDuCoffre bonus={bonus} appel={appel} onVue={onVue} onFermer={() => setBonus(vueRef.current.bonus)} />
        ) : (
          <RoueDuBaron mise={bonus.mise} appel={appel} onVue={onVue} onFermer={() => setBonus(vueRef.current.bonus)} />
        ))}
      {fete && <FenetreFete key={fetes.length} fete={fete} onFermer={() => setFetes((f) => f.slice(1))} />}
    </div>
  );
}

/** Les grands moments de la machine : énorme gain, gros lot, free games gagnés, et le total d'une série de free games. */
function FenetreFete({ fete, onFermer }: { fete: FeteMachine; onFermer: () => void }) {
  useEffect(() => {
    if (fete.type === 'free') jouerEffet('roulette_gros_lot');
  }, [fete]);
  if (fete.type === 'free')
    return (
      <Celebration
        titre={fete.relance ? tr('Free games en plus !', 'Extra free games!') : tr('Free games !', 'Free games!')}
        etiquette={tr(`${fete.n} free games`, `${fete.n} free games`)}
        medaillon={
          <div className="cas-medaillon-free">
            <img src="/cartes/free-games.webp" alt="" draggable={false} />
            <strong>{fete.relance ? `+${fete.n}` : fete.n}</strong>
          </div>
        }
        legende={tr(`Gains ×${MULTIPLICATEUR_GRATUIT}, à ${dollars(fete.mise)} le tour`, `Wins ×${MULTIPLICATEUR_GRATUIT}, at ${dollars(fete.mise)} a spin`)}
        onFermer={onFermer}
      />
    );
  if (fete.type === 'finFree')
    return (
      <Celebration
        titre={tr('Free games terminés', 'Free games over')}
        etiquette={tr(`Gagné : ${dollars(fete.total)}`, `Won: ${dollars(fete.total)}`)}
        medaillon={<strong className="celebration-xp cas-medaillon-gain">{dollars(fete.total)}</strong>}
        legende={tr('Gagnés pendant les free games', 'Won during the free games')}
        onFermer={onFermer}
      />
    );
  return (
    <Celebration
      titre={fete.palier === 'grosLot' ? tr('Gros lot du salon !', 'Lounge jackpot!') : fete.palier === 'colossal' ? tr('Gain colossal !', 'Colossal win!') : tr('Énorme gain !', 'Huge win!')}
      etiquette={tr(`Gain : ${dollars(fete.gain)}`, `Win: ${dollars(fete.gain)}`)}
      medaillon={<strong className="celebration-xp cas-medaillon-gain">{dollars(fete.gain)}</strong>}
      legende={tr('Ajouté à ton solde', 'Added to your balance')}
      onFermer={onFermer}
    />
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Le salon

const JEUX: { id: 'machine' | 'nuits' | 'roulette' | 'blackjack' | 'poker'; nom: [string, string]; image: string; repli: string }[] = [
  { id: 'machine', nom: ['Le Bandit du Baron', 'The Baron’s Bandit'], image: '/cartes/casino-machine.webp', repli: '/cartes/evenement_casse_du_siecle.webp' },
  { id: 'nuits', nom: ['Les Nuits du Baron', 'The Baron’s Nights'], image: '/cartes/casino-nuits.webp', repli: '/cartes/evenement_couvre_feu.webp' },
  { id: 'roulette', nom: ['Roulette', 'Roulette'], image: '/cartes/casino-roulette.webp', repli: '/cartes/croupier.webp' },
  { id: 'blackjack', nom: ['Blackjack', 'Blackjack'], image: '/cartes/casino-blackjack.webp', repli: '/cartes/billets_05.webp' },
  { id: 'poker', nom: ['Poker', 'Poker'], image: '/cartes/casino-poker.webp', repli: '/cartes/baron.webp' },
];

function Vignette({ jeu, onOuvrir }: { jeu: (typeof JEUX)[number]; onOuvrir?: () => void }) {
  const [src, setSrc] = useState(jeu.image);
  const bientot = !onOuvrir;
  return (
    <button type="button" className={`cas-vignette ${bientot ? 'bientot' : ''}`} onClick={onOuvrir} disabled={bientot}>
      <img src={src} alt="" draggable={false} onError={() => setSrc(jeu.repli)} />
      <span className="cas-vignette-nom">{tr(...jeu.nom)}</span>
      {bientot && <span className="cas-bientot">{tr('Bientôt', 'Soon')}</span>}
    </button>
  );
}

function Annonce({ annonce }: { annonce: AnnonceCasino }) {
  const texte =
    annonce.jeu === 'roue'
      ? tr(`${annonce.nom} a gagné ${dollars(annonce.gain)} à la roulette du salon !`, `${annonce.nom} won ${dollars(annonce.gain)} on the lounge wheel!`)
      : annonce.jeu === 'roulette'
        ? tr(`${annonce.nom} a gagné ${dollars(annonce.gain)} à la roulette !`, `${annonce.nom} won ${dollars(annonce.gain)} at roulette!`)
      : annonce.jeu === 'nuits'
        ? tr(`${annonce.nom} a gagné ${dollars(annonce.gain)} aux Nuits du Baron !`, `${annonce.nom} won ${dollars(annonce.gain)} on the Baron’s Nights!`)
      : annonce.jeu === 'casse'
        ? tr(`${annonce.nom} a raflé ${dollars(annonce.gain)} au Casse du coffre !`, `${annonce.nom} grabbed ${dollars(annonce.gain)} in the Safe Heist!`)
        : annonce.jeu === 'roueBaron' && !annonce.grosLot
          ? tr(`${annonce.nom} a gagné ${dollars(annonce.gain)} à la Roue du Baron !`, `${annonce.nom} won ${dollars(annonce.gain)} on the Baron’s Wheel!`)
          : annonce.grosLot
        ? tr(`${annonce.nom} a décroché le gros lot : ${dollars(annonce.gain)} !`, `${annonce.nom} hit the jackpot: ${dollars(annonce.gain)}!`)
        : tr(`${annonce.nom} a gagné ${dollars(annonce.gain)} à la machine à sous !`, `${annonce.nom} won ${dollars(annonce.gain)} on the slot machine!`);
  return (
    <div className="cas-annonce" role="status">
      <img src="/cartes/couronne.webp" alt="" />
      <span>{texte}</span>
    </div>
  );
}

/** Cadeau du Baron : la somme à récupérer, et le temps qu'il reste. */
function BandeauCadeau({ cadeau, onRecuperer }: { cadeau: { montant: number; fin: number }; onRecuperer: () => void }) {
  const reste = useAttente(cadeau.fin);
  return (
    <section className="cas-cadeau">
      <img src="/cartes/machine-coffre.webp" alt="" />
      <div>
        <small>{tr('Cadeau du Baron', 'The Baron’s gift')}</small>
        <strong>{dollars(cadeau.montant)}</strong>
        {reste && <span>{tr(`À récupérer : encore ${reste}`, `To claim: ${reste} left`)}</span>}
      </div>
      <button type="button" className="cas-cadeau-bouton" onClick={onRecuperer}>
        {tr('Récupérer', 'Claim')}
      </button>
    </section>
  );
}

type JeuTable = 'blackjack' | 'roulette';
type TableActive = { jeu: 'blackjack'; v: VueTableBJ } | { jeu: 'roulette'; v: VueTableRoulette };
const EVT_TABLE: Record<JeuTable, string> = { blackjack: 'casino_bj', roulette: 'casino_rl' };

/** Les tables ouvertes d'un jeu (blackjack ou roulette) : en rejoindre une, ou en ouvrir une nouvelle (avec des bots). */
function FenetreTables({ jeu, vue, appel, onTable, onVue, onFermer }: { jeu: JeuTable; vue: VueCasino; appel: Appel; onTable: (t: TableActive) => void; onVue: (v: VueCasino) => void; onFermer: () => void }) {
  const [bots, setBots] = useState(2);
  const [erreur, setErreur] = useState<string | null>(null);
  useEffect(() => {
    const t = window.setInterval(() => {
      void appel('casino_vue').then((r) => {
        const casino = (r as unknown as { casino?: VueCasino }).casino;
        if (r.ok && casino) onVue(casino);
      });
    }, 3000);
    return () => window.clearInterval(t);
  }, [appel, onVue]);
  const ouvrir = async (action: 'creer' | 'rejoindre', data: unknown) => {
    setErreur(null);
    const r = (await appel(`${EVT_TABLE[jeu]}_${action}`, data)) as { ok: boolean; erreur?: string; table?: VueTableBJ & VueTableRoulette };
    if (r.ok && r.table) onTable({ jeu, v: r.table } as TableActive);
    else setErreur(r.erreur ?? tr('Table indisponible.', 'Table unavailable.'));
  };
  const liste = (jeu === 'blackjack' ? vue.tables : vue.tablesRoulette) ?? [];
  return (
    <Fenetre titre={jeu === 'blackjack' ? 'Blackjack' : tr('Roulette', 'Roulette')} onFermer={onFermer}>
      {liste.length > 0 ? (
        <ul className="cas-tables">
          {liste.map((t) => (
            <li key={t.code}>
              <span className="cas-tables-avatars">
                {t.joueurs.map((j, i) => (
                  <img key={i} src={`/cartes/avatar-${j.avatar}.webp`} alt="" title={j.nom} />
                ))}
              </span>
              <span className="cas-tables-noms">
                <strong>
                  {tr('Table', 'Table')} {t.code}
                </strong>
                <small>
                  {t.joueurs
                    .filter((j) => !j.bot)
                    .map((j) => j.nom)
                    .join(', ')}{' '}
                  · {t.joueurs.length}/{t.max}
                </small>
              </span>
              <button type="button" className="petit" disabled={t.joueurs.length >= t.max} onClick={() => void ouvrir('rejoindre', { code: t.code })}>
                {tr('Rejoindre', 'Join')}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="discret">{tr('Aucune table ouverte pour l’instant.', 'No open table right now.')}</p>
      )}
      <div className="cas-nouvelle-table">
        <span>{tr('Bots à ta table', 'Bots at your table')}</span>
        <div className="cas-mise">
          <button type="button" onClick={() => setBots((b) => Math.max(0, b - 1))} disabled={bots === 0} aria-label={tr('Moins de bots', 'Fewer bots')}>
            −
          </button>
          <strong>{bots}</strong>
          <button type="button" onClick={() => setBots((b) => Math.min(4, b + 1))} disabled={bots === 4} aria-label={tr('Plus de bots', 'More bots')}>
            +
          </button>
        </div>
        <button type="button" className="principal large" onClick={() => void ouvrir('creer', { bots })}>
          {tr('Ouvrir une table', 'Open a table')}
        </button>
      </div>
      <p className="discret">
        {jeu === 'blackjack'
          ? tr('Mises de 1 000 à 250 000 $. Tes amis créateurs voient ta table ici, et tu peux les inviter depuis la table.', 'Bets from $1,000 to $250,000. Your creator friends see your table here, and you can invite them from the table.')
          : tr('Roulette européenne, un seul zéro. Jetons de 1 000 à 500 000 $, 1 000 000 $ au plus par tour. Invite tes amis créateurs depuis la table.', 'European roulette, single zero. Chips from $1,000 to $500,000, $1,000,000 at most per spin. Invite your creator friends from the table.')}
      </p>
      {erreur && <p className="cas-erreur">{erreur}</p>}
    </Fenetre>
  );
}

function Salon({
  vue,
  onRoue,
  onMachine,
  onNuits,
  onBlackjack,
  onRoulette,
  onCadeau,
  onQuitter,
}: {
  vue: VueCasino;
  onRoue: () => void;
  onMachine: () => void;
  onNuits: () => void;
  onBlackjack: () => void;
  onRoulette: () => void;
  onCadeau: () => void;
  onQuitter: () => void;
}) {
  const solde = useSoldeAnime(vue.solde);
  const attente = useAttente(vue.roueProchaine);
  return (
    <div className="cas-ecran cas-salon">
      <header className="cas-barre">
        <button type="button" className="cas-retour" onClick={onQuitter}>
          ‹ {tr('Quitter', 'Leave')}
        </button>
        <h1>{tr('Salon privé', 'Private lounge')}</h1>
        <span className="cas-barre-vide" />
      </header>
      <section className="cas-tresor">
        <img className="cas-tresor-avatar" src={`/cartes/avatar-${vue.avatar}.webp`} alt="" />
        <div>
          <small>{tr('Ton solde', 'Your balance')}</small>
          <strong className="cas-solde">{dollars(solde)}</strong>
        </div>
      </section>
      {vue.cadeau && <BandeauCadeau cadeau={vue.cadeau} onRecuperer={onCadeau} />}
      <button type="button" className={`cas-bouton-roue ${attente ? '' : 'prete'}`} onClick={onRoue}>
        <svg className="bouton-roulette-icone" viewBox="0 0 40 40" aria-hidden="true">
          <circle cx="20" cy="20" r="19.5" fill="#d2a85a" />
          <circle cx="20" cy="20" r="17" fill="#1b120c" />
          {CASES_ROUE_SALON.map((_, i) => {
            const a1 = ((i * 45 - 90) * Math.PI) / 180;
            const a2 = (((i + 1) * 45 - 90) * Math.PI) / 180;
            const c = i === CASE_VERTE_SALON ? COULEURS_ROUE.vert : i % 2 ? COULEURS_ROUE.noir : COULEURS_ROUE.rouge;
            return <path key={i} d={`M20 20 L${20 + 16 * Math.cos(a1)} ${20 + 16 * Math.sin(a1)} A16 16 0 0 1 ${20 + 16 * Math.cos(a2)} ${20 + 16 * Math.sin(a2)} Z`} fill={c} stroke="#e7c27a" strokeWidth="0.6" />;
          })}
          <circle cx="20" cy="20" r="5" fill="#d2a85a" />
        </svg>
        <span>
          <strong>{tr('Roulette du salon', 'Lounge wheel')}</strong>
          <small>{attente ? tr(`Prochain tour dans ${attente}`, `Next spin in ${attente}`) : tr('Jusqu’à 1 million de dollars !', 'Up to one million dollars!')}</small>
        </span>
        {!attente && <span className="pastille-nombre">1</span>}
      </button>
      <div className="cas-jeux">
        {JEUX.map((j) => (
          <Vignette key={j.id} jeu={j} onOuvrir={j.id === 'machine' ? onMachine : j.id === 'nuits' ? onNuits : j.id === 'blackjack' ? onBlackjack : j.id === 'roulette' ? onRoulette : undefined} />
        ))}
      </div>
      <p className="cas-gros-lot">
        {tr('Gros lot du Bandit du Baron', 'Baron’s Bandit jackpot')} : <strong>{dollars(vue.grosLot)}</strong>
      </p>
      {vue.riches.length > 0 && (
        <section className="cas-riches">
          <h2>{tr('Les plus riches du salon', 'Richest in the lounge')}</h2>
          <ol>
            {vue.riches.map((r, i) => (
              <li key={`${i}-${r.nom}`} className={r.moi ? 'moi' : ''}>
                <span className="cas-riche-rang">{i + 1}</span>
                <img src={`/cartes/avatar-${r.avatar}.webp`} alt="" />
                <span className="cas-riche-nom">{r.nom || tr('Créateur', 'Creator')}</span>
                <strong>{dollars(r.solde)}</strong>
              </li>
            ))}
          </ol>
        </section>
      )}
      <div className="cas-pied">
        <BoutonMusique />
      </div>
      <p className="cas-mention">{tr('Argent fictif, sans aucune valeur réelle.', 'Play money, with no real value.')}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------

export default function Casino({
  appel,
  compte,
  onQuitter,
  invitation,
  onInvitation,
}: {
  appel: Appel;
  compte: EtatCompte;
  onQuitter: (message?: string) => void;
  /** Invitation d'un ami acceptée : la table à rejoindre dès l'entrée au salon. */
  invitation?: { id: string; jeu: JeuTable; code: string } | null;
  onInvitation?: () => void;
}) {
  const [vue, setVue] = useState<VueCasino | null>(null);
  const [ecran, setEcran] = useState<'salon' | 'machine' | 'nuits' | 'table'>('salon');
  const [roue, setRoue] = useState(false);
  const [fenetreTables, setFenetreTables] = useState<JeuTable | null>(null);
  const [table, setTable] = useState<TableActive | null>(null);
  const tableRef = useRef<{ jeu: JeuTable; code: string } | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [cadeau, setCadeau] = useState<number | null>(null);
  const [annonce, setAnnonce] = useState<AnnonceCasino | null>(null);
  const minuterieAnnonce = useRef(0);
  const entreRef = useRef(false);

  // Musique d'ambiance du salon (jazz de cabaret) tant qu'on est au casino.
  useEffect(() => {
    musiqueDuSalon(true);
    return () => musiqueDuSalon(false);
  }, []);

  const entrer = useCallback(async () => {
    for (let essai = 0; essai < 4; essai++) {
      const r = (await appel('casino_entrer')) as { ok: boolean; erreur?: string; casino?: VueCasino };
      if (r.ok && r.casino) {
        if (!entreRef.current) jouerEffet('casino_entree');
        entreRef.current = true;
        setVue(r.casino);
        // Retour après une coupure : on reprend sa place à la table.
        if (tableRef.current) {
          const { jeu, code } = tableRef.current;
          const t = (await appel(`${EVT_TABLE[jeu]}_rejoindre`, { code })) as { ok: boolean; table?: VueTableBJ & VueTableRoulette };
          if (t.ok && t.table) setTable({ jeu, v: t.table } as TableActive);
          else {
            tableRef.current = null;
            setTable(null);
            setEcran('salon');
          }
        }
        return;
      }
      await new Promise((ok) => window.setTimeout(ok, 1200));
    }
    onQuitter(tr('Le salon est indisponible pour le moment.', 'The lounge is unavailable right now.'));
  }, [appel, onQuitter]);

  useEffect(() => {
    void entrer();
    const surAnnonce = (a: AnnonceCasino) => {
      setAnnonce(a);
      jouerEffet('casino_annonce');
      window.clearTimeout(minuterieAnnonce.current);
      minuterieAnnonce.current = window.setTimeout(() => setAnnonce(null), 6000);
    };
    const surGrosLot = (g: number) => setVue((v) => (v ? { ...v, grosLot: g } : v));
    const surTable = (t: VueTableBJ) => {
      if (tableRef.current?.jeu === 'blackjack' && t.code === tableRef.current.code) setTable({ jeu: 'blackjack', v: t });
    };
    const surRoulette = (t: VueTableRoulette) => {
      if (tableRef.current?.jeu === 'roulette' && t.code === tableRef.current.code) setTable({ jeu: 'roulette', v: t });
    };
    socket.on('casino_bj', surTable);
    socket.on('casino_rl', surRoulette);
    // Après une coupure, on revient au salon (le compte se représente d'abord au serveur).
    const surConnexion = () => window.setTimeout(() => void entrer(), 1500);
    socket.on('casino_annonce', surAnnonce);
    socket.on('casino_gros_lot', surGrosLot);
    socket.on('connect', surConnexion);
    return () => {
      socket.off('casino_annonce', surAnnonce);
      socket.off('casino_gros_lot', surGrosLot);
      socket.off('casino_bj', surTable);
      socket.off('casino_rl', surRoulette);
      socket.off('connect', surConnexion);
      window.clearTimeout(minuterieAnnonce.current);
      socket.emit('casino_quitter');
    };
  }, [entrer]);

  const allerTable = (t: TableActive) => {
    tableRef.current = { jeu: t.jeu, code: t.v.code };
    setTable(t);
    setFenetreTables(null);
    setEcran('table');
  };
  const quitterTable = async () => {
    const jeu = tableRef.current?.jeu ?? 'blackjack';
    tableRef.current = null;
    setTable(null);
    setEcran('salon');
    await appel(`${EVT_TABLE[jeu]}_quitter`);
    const r = (await appel('casino_vue')) as { ok: boolean; casino?: VueCasino };
    if (r.ok && r.casino) setVue(r.casino);
  };
  const recupererCadeau = async () => {
    const r = (await appel('casino_cadeau')) as { ok: boolean; cadeau?: number; casino?: VueCasino };
    if (!r.ok || !r.casino) return;
    setVue(r.casino);
    setCadeau(r.cadeau ?? 0);
    jouerEffet('roulette_gros_lot');
  };

  // Invitation d'un ami acceptée : on rejoint sa table dès que le salon est ouvert.
  const invitationVue = useRef<string | null>(null);
  useEffect(() => {
    if (!vue || !invitation || invitationVue.current === invitation.id) return;
    invitationVue.current = invitation.id;
    onInvitation?.();
    void (async () => {
      if (tableRef.current) await appel(`${EVT_TABLE[tableRef.current.jeu]}_quitter`);
      const r = (await appel(`${EVT_TABLE[invitation.jeu]}_rejoindre`, { code: invitation.code })) as { ok: boolean; erreur?: string; table?: VueTableBJ & VueTableRoulette };
      if (r.ok && r.table) allerTable({ jeu: invitation.jeu, v: r.table } as TableActive);
      else {
        setInfo(r.erreur ?? tr('Cette table est fermée.', 'This table is closed.'));
        window.setTimeout(() => setInfo(null), 4000);
      }
    })();
    // allerTable ne change rien d'autre que l'état : pas besoin de le suivre.
  }, [vue, invitation, appel, onInvitation]);

  let contenu: ReactNode;
  if (!vue) contenu = <div className="chargement">{tr('Ouverture du salon…', 'Opening the lounge…')}</div>;
  else if (ecran === 'machine') contenu = <Machine vue={vue} appel={appel} onVue={setVue} onRetour={() => setEcran('salon')} />;
  else if (ecran === 'nuits') contenu = <MachineNuits vue={vue} appel={appel} onVue={setVue} onRetour={() => setEcran('salon')} />;
  else if (ecran === 'table' && table?.jeu === 'blackjack') contenu = <TableBlackjack v={table.v} appel={appel} onQuitter={() => void quitterTable()} />;
  else if (ecran === 'table' && table?.jeu === 'roulette') contenu = <TableRoulette v={table.v} appel={appel} onQuitter={() => void quitterTable()} />;
  else
    contenu = (
      <Salon
        vue={vue}
        onRoue={() => setRoue(true)}
        onMachine={() => setEcran('machine')}
        onNuits={() => setEcran('nuits')}
        onBlackjack={() => setFenetreTables('blackjack')}
        onRoulette={() => setFenetreTables('roulette')}
        onCadeau={() => void recupererCadeau()}
        onQuitter={() => onQuitter()}
      />
    );
  return (
    <div className="cas">
      {contenu}
      {fenetreTables && vue && <FenetreTables key={fenetreTables} jeu={fenetreTables} vue={vue} appel={appel} onTable={allerTable} onVue={setVue} onFermer={() => setFenetreTables(null)} />}
      {info && <div className="toast">{info}</div>}
      {cadeau !== null && (
        <Celebration
          titre={tr('Cadeau du Baron !', 'The Baron’s gift!')}
          etiquette={tr(`Cadeau : ${dollars(cadeau)}`, `Gift: ${dollars(cadeau)}`)}
          medaillon={<strong className="celebration-xp cas-medaillon-gain">{dollars(cadeau)}</strong>}
          legende={tr('Ajouté à ton solde', 'Added to your balance')}
          onFermer={() => setCadeau(null)}
        />
      )}
      {annonce && <Annonce annonce={annonce} />}
      {roue && vue && <FenetreRoueSalon vue={vue} appel={appel} onVue={setVue} onFermer={() => setRoue(false)} />}
    </div>
  );
}
