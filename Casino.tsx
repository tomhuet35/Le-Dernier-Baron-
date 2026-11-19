/**
 * Salon privé du Baron : le casino des comptes Créateur (chargé à part : les autres joueurs ne le téléchargent pas).
 * Étape 1 : le salon (solde, plus riches, annonces), la roulette du salon (une par jour) et la machine à sous
 * « Le Bandit du Baron ». Tout l'argent est fictif et tenu par le serveur.
 */
import { DOLLARS_PAR_RUBIS, MISES_PLINKO, MULTI_MAX_PLINKO, MULTIPLICATEURS_PLINKO, RANGEES_PLINKO, type MisePlinko } from '../../shared/plinko';
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
import { BandeauFolleNuit, ShowFolleNuit } from './CasinoFolleNuit';
import { JeuFestin } from './CasinoFestin';
import { JeuCouronne } from './CasinoCouronne';
import { JeuChute } from './CasinoChute';
import { JeuTickets } from './CasinoTickets';
import { ChargementJeu } from './ChargementJeu';
import type { JeuACharger } from './ressourcesJeux';
import { JeuCourse } from './CasinoCourse';
import { BandeauOuvertureBW, JeuBaronWheel } from './CasinoBaronWheel';
import { BandeauAffiche, PuceAffiche } from './CasinoAffiche';
import { BarreXp, CadreAvatar, CelebrationNiveau, EcranAmis, EcranDefis, EcranProfil, PuceDefi, texteDefi, texteSocial, type FeteNiveau } from './CasinoSocial';
import { JEUX_CASINO, type JeuCasino, type PositionCasino, type VueDefi } from '../../shared/profilCasino';
import { MachineNuits } from './CasinoNuits';
import { AnnoncesContrats, EcranAlbum, EcranContrats } from './CasinoContrats';
import { AnnoncesVentes, EcranBureau, EcranVentes } from './CasinoBureau';
import { EcranCercles } from './CasinoCercles';
import { EcranBourse } from './CasinoBourse';
import { EcranMarche } from './CasinoMarche';
import { EcranTailleur } from './CasinoTailleur';
import { cadreSpecial, type VueVentes } from '../../shared/ventes';
import { AccueilGroom, AnnoncesHotel, CadeauBienvenue, BandeauHappyHour, CarteDeMembre, EtageFerme, FenetreSemaine, Penthouse } from './CasinoHotel';
import { etage, etageDuJeu, etageOuvert, ETAGES, type CadeauSemaine, type Etage } from '../../shared/hotel';
import { MORCEAUX_PAGE, morceauxDe } from '../../shared/contrats';
import { Depannage, VIGNETTES_ALBUM } from './CasinoContrats';
import './accueil.css';
import './boutique.css';
import { TableRoulette } from './CasinoRoulette';
import type { VueTableRoulette } from '../../shared/rouletteCasino';
import type { EtatCompte } from './Profil';
import { COULEURS_ROUE, DUREE_ROUE_MS, Roue, useAttente, type CaseRoue } from './RouletteDuJour';
import { socket } from './socket';
import { EN, tr } from './traduction';
import { BoutonMusique, Celebration, Fenetre, Garde, jouerEffet, mouvementReduit, musiqueDuCasino, musiqueDuSalon, useCompteur } from './ui';
import { dollars, GainDefilant, Jeton, LINGOTS_PALIER, OptionsMachine, palierDe, PluieLingots, useSoldeAnime, useToursAuto, type Palier } from './casinoOutils';
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


/**
 * La roue illustrée du salon (roue-jour.webp, ou roue-luxe.webp pour la roue de luxe) sur son support doré, avec sa
 * flèche : 8 cases, la case `i` est à `POSITION_CASE[i] × 45°` (sens des aiguilles d'une montre, depuis le haut).
 */
const POSITION_CASE = [1, 2, 3, 4, 5, 6, 7, 0];
export function RoueIllustree({ image, libelles, rotation, tourne, gagnante, petit }: { image: string; libelles: [string, string, string][]; rotation: number; tourne: boolean; gagnante: number | null; petit?: boolean }) {
  return (
    <div className={`rj ${tourne ? 'tourne' : ''} ${petit ? 'petit' : ''}`}>
      <img className="rj-support" src="/cartes/roue-support.webp" alt="" draggable={false} />
      <div className="rj-roue" style={{ transform: `rotate(${rotation}deg)`, transitionDuration: tourne ? `${DUREE_ROUE_MS}ms` : '0ms' }}>
        <img src={`/cartes/${image}.webp`} alt="" draggable={false} />
        {libelles.map(([a, b, icone], i) => (
          <span key={i} className={`rj-case ${gagnante === i ? 'gagnante' : ''} ${a.length > 3 ? 'long' : ''}`} style={{ transform: `rotate(${POSITION_CASE[i] * 45}deg)` }}>
            <b>{a}</b>
            <small>{b}</small>
            <img src={`/cartes/${icone}.webp`} alt="" draggable={false} />
          </span>
        ))}
      </div>
      <img className="rj-fleche" src="/cartes/roue-fleche.webp" alt="" draggable={false} />
    </div>
  );
}
/** L'angle qui amène la case `i` sous la flèche (après quelques tours). */
const angleRoue = (i: number) => 360 * 6 + (360 - POSITION_CASE[i] * 45) + (Math.random() - 0.5) * 45 * 0.6;
/** L'icône de chaque montant de la roue du jour : liasse, mallette, lingot, coffre, couronne pour le gros lot. */
const iconeMontant = (v: number) => (v >= 10_000_000 ? 'couronne' : v >= 3_000_000 ? 'machine-coffre' : v >= 2_000_000 ? 'butin-lingot' : v >= 1_000_000 ? 'bq-dollars-mallette' : 'bq-dollars-liasse');
const LIBELLES_JOUR: [string, string, string][] = CASES_ROUE_SALON.map((v) =>
  v >= 1_000_000 ? [(v / 1_000_000).toLocaleString(EN ? 'en-US' : 'fr-FR'), v === 1_000_000 ? 'MILLION' : 'MILLIONS', iconeMontant(v)] : [(v / 1000).toLocaleString(EN ? 'en-US' : 'fr-FR'), EN ? 'THOUSAND $' : 'MILLE $', iconeMontant(v)],
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
    const cible = angleRoue(i);
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
      <RoueIllustree image="roue-jour" libelles={LIBELLES_JOUR} rotation={rotation} tourne={tourne} gagnante={resultat?.case ?? null} />
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
          titre={resultat.case === CASE_VERTE_SALON ? tr('Le gros lot !', 'The jackpot!') : tr('Gros gain !', 'Big win!')}
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
            jouerEffet('bandit_jackpot');
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
      jouerEffet(grand ? 'bandit_jackpot' : 'bandit_gain');
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
  /** Délai avant le tour automatique suivant (selon le dernier gain), et l'arrêt des tours automatiques. */
  const delaiAuto = useRef(150);
  const arreterAuto = useRef(() => {});
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
      arreterAuto.current();
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
        jouerEffet('bandit_gain');
      } else if (palier === 'enorme' || palier === 'colossal') jouerEffet('bandit_jackpot');
      else if (palier === 'joli') jouerEffet('bandit_gain');
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
      // Tours auto : ils continuent après les fêtes (fermées toutes seules), mais s'arrêtent sur un bonus à jouer
      // (Casse du coffre, Roue du Baron), qui demande au joueur de choisir.
      if (nouvelle.bonus) arreterAuto.current();
      delaiAuto.current = file.length ? 900 : palier === 'gros' ? 2800 : palier === 'joli' ? 1900 : m.gain > 0 ? 1200 : 450;
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
  const tours = useToursAuto({ pret: !enCours && !fete && !bonus && !vue.bonus, gratuits, lancer: () => void lancer(), delai: () => delaiAuto.current, fete: !!fete, fermerFete: () => setFetes((f) => f.slice(1)) });
  arreterAuto.current = tours.arreter;
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
        <button type="button" className="cas-retour" onClick={onRetour} disabled={enCours} aria-label={tr('Retour aux machines', 'Back to the machines')}>
          ‹ {tr('Machines', 'Machines')}
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
          <OptionsMachine
            auto={tours.auto}
            gratuits={gratuits}
            peutJouer={peutJouer}
            onDemarrer={(k) => {
              delaiAuto.current = 100;
              tours.demarrer(k);
            }}
            onArreter={tours.arreter}
            onGains={() => setGains(true)}
          />
          {!peutJouer && !enCours && gratuits === 0 && !vue.bonus && <p className="cas-erreur">{tr('Solde insuffisant : baisse la mise ou tourne la roulette du salon.', 'Not enough money: lower the bet or spin the lounge wheel.')}</p>}
        </div>
      </div>
      {pluie && <PluieLingots key={`pluie-${pluie.id}`} n={pluie.n} />}
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
    if (fete.type === 'free') jouerEffet('bandit_jackpot');
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

const JEUX: { id: 'baronWheel' | 'folleNuit' | 'machines' | 'roulette' | 'blackjack' | 'couronne' | 'festin' | 'chute' | 'course' | 'tickets' | 'poker'; nom: [string, string]; image: string; repli: string }[] = [
  { id: 'baronWheel', nom: ['The Baron’s Wheel', 'The Baron’s Wheel'], image: '/cartes/casino-baron-wheel-affiche.webp', repli: '/cartes/casino-baron-wheel-bandeau-petit.webp' },
  { id: 'folleNuit', nom: ['La Folle Nuit', 'Crazy Night'], image: '/cartes/casino-folle-nuit-affiche.webp', repli: '/cartes/casino-folle-nuit.webp' },
  { id: 'machines', nom: ['Machines à sous', 'Slot machines'], image: '/cartes/casino-machines-affiche.webp', repli: '/cartes/casino-machines.webp' },
  { id: 'roulette', nom: ['Roulette', 'Roulette'], image: '/cartes/casino-roulette.webp', repli: '/cartes/croupier.webp' },
  { id: 'blackjack', nom: ['Blackjack', 'Blackjack'], image: '/cartes/casino-blackjack.webp', repli: '/cartes/billets_05.webp' },
  { id: 'couronne', nom: ['Le Vol de la Couronne', 'The Flight of the Crown'], image: '/cartes/casino-couronne.webp', repli: '/cartes/baron.webp' },
  { id: 'festin', nom: ['Les Coffres du Baron', 'The Baron’s Safes'], image: '/cartes/casino-festin.webp', repli: '/cartes/baron.webp' },
  { id: 'chute', nom: ['La Chute des Écus', 'The Falling Crowns'], image: '/cartes/casino-chute.webp', repli: '/cartes/baron.webp' },
  { id: 'course', nom: ['La Course des Écuries', 'The Stables’ Race'], image: '/cartes/casino-course.webp', repli: '/cartes/baron.webp' },
  { id: 'tickets', nom: ['Les Tickets du Baron', 'The Baron’s Tickets'], image: '/cartes/casino-tickets.webp', repli: '/cartes/casino-machines.webp' },
  { id: 'poker', nom: ['Poker', 'Poker'], image: '/cartes/casino-poker.webp', repli: '/cartes/baron.webp' },
];

/** Le menu des machines à sous : on choisit sa machine, puis on y joue. */
const MACHINES: { id: 'machine' | 'nuits'; nom: [string, string]; image: string; texte: [string, string] }[] = [
  {
    id: 'machine',
    nom: ['Le Bandit du Baron', 'The Baron’s Bandit'],
    image: '/cartes/casino-machine.webp',
    texte: ['5 rouleaux, 10 lignes. Casse du coffre, Roue du Baron et free games.', '5 reels, 10 lines. Safe Heist, Baron’s Wheel and free games.'],
  },
  {
    id: 'nuits',
    nom: ['Les Nuits du Baron', 'The Baron’s Nights'],
    image: '/cartes/casino-nuits.webp',
    texte: ['243 façons de gagner. Événements, free games et Jetons du Baron.', '243 ways to win. Events, free games and Baron’s Tokens.'],
  },
];

function ChoixMachines({ vue, onMachine, onRetour }: { vue: VueCasino; onMachine: (m: 'machine' | 'nuits') => void; onRetour: () => void }) {
  const solde = useSoldeAnime(vue.solde);
  return (
    <div className="cas-ecran cas-choix-machines">
      <header className="cas-barre">
        <button type="button" className="cas-retour" onClick={onRetour}>
          ‹ {tr('Salon', 'Lounge')}
        </button>
        <h1>{tr('Machines à sous', 'Slot machines')}</h1>
        <span className="cas-barre-vide" />
      </header>
      <p className="cas-choix-aide">
        <span>{tr('Choisis ta machine', 'Pick your machine')}</span>
        <span className="cas-solde-petit" aria-label={tr('Ton solde', 'Your balance')}>
          {dollars(solde)}
        </span>
      </p>
      <div className="cas-machines">
        {MACHINES.map((m) => (
          <button key={m.id} type="button" className={`cas-carte-machine ${m.id} ${vue.affiche?.jeu === m.id ? 'a-l-affiche' : ''}`} onClick={() => onMachine(m.id)}>
            <img src={m.image} alt="" draggable={false} />
            {vue.affiche?.jeu === m.id && <span className="cas-bientot cas-ruban-affiche">{tr('À l’affiche', 'Featured')}</span>}
            <span className="cas-carte-machine-texte">
              <strong>{tr(...m.nom)}</strong>
              <span>{tr(...m.texte)}</span>
              {m.id === 'machine' ? (
                <em>
                  {tr('Gros lot', 'Jackpot')} : <b>{dollars(vue.grosLot)}</b>
                </em>
              ) : (
                <em className="cas-carte-jackpots">
                  <img src="/cartes/nuits-mini.webp" alt="MINI" />
                  <img src="/cartes/nuits-minor.webp" alt="MINOR" />
                  <img src="/cartes/nuits-major.webp" alt="MAJOR" />
                  <img src="/cartes/nuits-grand.webp" alt="GRAND" />
                </em>
              )}
            </span>
          </button>
        ))}
      </div>
      <p className="cas-mention">{tr('Mise de 1 000 $ à 200 000 $ · tours automatiques de 10 à l’infini', 'Bets from $1,000 to $200,000 · auto spins from 10 to infinity')}</p>
    </div>
  );
}

function Vignette({ jeu, onOuvrir, ruban, affiche }: { jeu: (typeof JEUX)[number]; onOuvrir?: () => void; ruban?: string; affiche?: boolean }) {
  const [src, setSrc] = useState(jeu.image);
  const bientot = !onOuvrir;
  return (
    <button type="button" className={`cas-vignette ${jeu.id} ${bientot ? 'bientot' : ''} ${affiche ? 'a-l-affiche' : ''}`} onClick={onOuvrir} disabled={bientot}>
      <img src={src} alt="" draggable={false} onError={() => setSrc(jeu.repli)} />
      <span className="cas-vignette-nom">{tr(...jeu.nom)}</span>
      {bientot && <span className="cas-bientot">{tr('Bientôt', 'Soon')}</span>}
      {!bientot && affiche && <span className="cas-bientot cas-ruban-affiche">{tr('À l’affiche', 'Featured')}</span>}
      {!bientot && !affiche && ruban && <span className="cas-bientot cas-nouveau">{ruban}</span>}
    </button>
  );
}

/** La vignette du salon qui mène à ce jeu (les deux machines sont derrière la même). */
/** Le ruban d'une vignette de jeu (nouveau, en direct, ouverture…). */
function rubanJeu(id: (typeof JEUX)[number]['id'], vue: VueCasino): string | undefined {
  if (id === 'folleNuit') return vue.folleNuit?.enDirect ? tr('En direct', 'Live') : undefined;
  return (
    id === 'festin'
                ? vue.coffres?.enCours
                  ? tr('En cours', 'In play')
                  : tr('Nouveau', 'New')
                : id === 'couronne'
                  ? vue.couronne?.spectateurs
                    ? tr('En direct', 'Live')
                    : tr('Nouveau', 'New')
                  : id === 'chute' || id === 'tickets'
                    ? tr('Nouveau', 'New')
                    : id === 'baronWheel'
                      ? vue.baronWheel?.ouverture
                        ? tr('Ouverture', 'Opening')
                        : vue.baronWheel?.enDirect && vue.baronWheel.spectateurs
                          ? tr('En direct', 'Live')
                          : tr('Nouveau', 'New')
                    : id === 'course'
                      ? vue.course?.enDirect && vue.course.spectateurs
                        ? tr('En direct', 'Live')
                        : tr('Nouveau', 'New')
                      : undefined
  );
}

const VIGNETTE_DU_JEU: Record<JeuCasino, (typeof JEUX)[number]['id'] | null> = {
  machine: 'machines',
  nuits: 'machines',
  blackjack: 'blackjack',
  roulette: 'roulette',
  folleNuit: 'folleNuit',
  coffres: 'festin',
  couronne: 'couronne',
  chute: 'chute',
  course: 'course',
  baronWheel: 'baronWheel',
  tickets: 'tickets',
};

function Annonce({ annonce }: { annonce: AnnonceCasino }) {
  const texte =
    annonce.jeu === 'defi'
      ? tr(`${annonce.nom} a battu ${annonce.contre ?? '?'} en défi : ${dollars(annonce.gain)} !`, `${annonce.nom} beat ${annonce.contre ?? '?'} in a challenge: ${dollars(annonce.gain)}!`)
      : annonce.jeu === 'roue'
      ? tr(`${annonce.nom} a gagné ${dollars(annonce.gain)} à la roulette du salon !`, `${annonce.nom} won ${dollars(annonce.gain)} on the lounge wheel!`)
      : annonce.jeu === 'roulette'
        ? tr(`${annonce.nom} a gagné ${dollars(annonce.gain)} à la roulette !`, `${annonce.nom} won ${dollars(annonce.gain)} at roulette!`)
      : annonce.jeu === 'nuits' && annonce.jackpot
        ? tr(`${annonce.nom} a décroché le ${annonce.jackpot === 'grand' ? 'GRAND' : 'MAJOR'} des Nuits du Baron : ${dollars(annonce.gain)} !`, `${annonce.nom} hit the ${annonce.jackpot === 'grand' ? 'GRAND' : 'MAJOR'} on the Baron’s Nights: ${dollars(annonce.gain)}!`)
      : annonce.jeu === 'nuits'
        ? tr(`${annonce.nom} a gagné ${dollars(annonce.gain)} aux Nuits du Baron !`, `${annonce.nom} won ${dollars(annonce.gain)} on the Baron’s Nights!`)
      : annonce.jeu === 'coffres'
        ? tr(`${annonce.nom} a raflé ${dollars(annonce.gain)} aux Coffres du Baron !`, `${annonce.nom} grabbed ${dollars(annonce.gain)} from the Baron’s Safes!`)
      : annonce.jeu === 'couronne'
        ? tr(`${annonce.nom} a récupéré ${dollars(annonce.gain)} au Vol de la Couronne !`, `${annonce.nom} cashed out ${dollars(annonce.gain)} on the Flight of the Crown!`)
      : annonce.jeu === 'chute'
        ? tr(`${annonce.nom} a fait tomber ${dollars(annonce.gain)} à la Chute des Écus !`, `${annonce.nom} dropped ${dollars(annonce.gain)} on the Falling Crowns!`)
      : annonce.jeu === 'plinko'
        ? tr(`${annonce.nom} a fait ×1000 au Plinko du Baron : ${dollars(annonce.gain)} !`, `${annonce.nom} hit ×1000 on the Baron’s Plinko: ${dollars(annonce.gain)}!`)
      : annonce.jeu === 'tickets'
        ? tr(`${annonce.nom} a gratté ${dollars(annonce.gain)} aux Tickets du Baron !`, `${annonce.nom} scratched ${dollars(annonce.gain)} on the Baron’s Tickets!`)
      : annonce.jeu === 'baronWheel'
        ? tr(`${annonce.nom} a gagné ${dollars(annonce.gain)} à The Baron’s Wheel !`, `${annonce.nom} won ${dollars(annonce.gain)} on The Baron’s Wheel!`)
      : annonce.jeu === 'course'
        ? tr(`${annonce.nom} a gagné ${dollars(annonce.gain)} à la Course des Écuries !`, `${annonce.nom} won ${dollars(annonce.gain)} at the Stables’ Race!`)
      : annonce.jeu === 'folleNuit'
        ? tr(`${annonce.nom} a gagné ${dollars(annonce.gain)} à la Folle Nuit !`, `${annonce.nom} won ${dollars(annonce.gain)} on the Crazy Night!`)
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
function BandeauCadeau({ cadeau, onRecuperer, onFini }: { cadeau: { montant: number; fin: number }; onRecuperer: () => void; onFini: () => void }) {
  const longue = useAttente(cadeau.fin);
  // Dans la dernière heure, le compte à rebours passe à la seconde (et le bandeau s'en va quand c'est fini).
  const [maintenant, setMaintenant] = useState(() => Date.now());
  const urgent = cadeau.fin - maintenant < 3_600_000;
  useEffect(() => {
    if (!urgent) return;
    const t = window.setInterval(() => setMaintenant(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [urgent]);
  const fini = cadeau.fin <= maintenant;
  // Fini : on redemande la vue au serveur (un autre cadeau peut prendre sa place).
  const finiRef = useRef(onFini);
  finiRef.current = onFini;
  useEffect(() => {
    if (fini) finiRef.current();
  }, [fini]);
  if (fini) return null;
  const s = Math.ceil((cadeau.fin - maintenant) / 1000);
  const reste = urgent ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s` : longue;
  return (
    <section className={`cas-cadeau ${urgent ? 'urgent' : ''}`}>
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
function FenetreTables({ jeu, vip, vue, appel, onTable, onVue, onFermer }: { jeu: JeuTable; vip?: boolean; vue: VueCasino; appel: Appel; onTable: (t: TableActive) => void; onVue: (v: VueCasino) => void; onFermer: () => void }) {
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
  // Les tables VIP (Penthouse) et les tables ordinaires sont listées à part.
  const liste = ((jeu === 'blackjack' ? vue.tables : vue.tablesRoulette) ?? []).filter((t) => !!t.vip === !!vip);
  return (
    <Fenetre titre={`${vip ? '★ VIP · ' : ''}${jeu === 'blackjack' ? 'Blackjack' : tr('Roulette', 'Roulette')}`} onFermer={onFermer}>
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
        <button type="button" className="principal large" onClick={() => void ouvrir('creer', { bots, vip: !!vip })}>
          {tr('Ouvrir une table', 'Open a table')}
        </button>
      </div>
      <p className="discret">
        {vip
          ? jeu === 'blackjack'
            ? tr('Table VIP : mises de 10 000 à 2 500 000 $.', 'VIP table: bets from $10,000 to $2,500,000.')
            : tr('Table VIP : jetons de 10 000 à 5 000 000 $, 10 000 000 $ au plus par tour.', 'VIP table: chips from $10,000 to $5,000,000, $10,000,000 at most per spin.')
          : jeu === 'blackjack'
          ? tr('Mises de 1 000 $ à 10 millions $ (100 millions en VIP). Tes amis créateurs voient ta table ici, et tu peux les inviter depuis la table.', 'Bets from $1,000 to $10 million ($100 million at VIP tables). Your creator friends see your table here, and you can invite them from the table.')
          : tr('Roulette européenne, un seul zéro. Jetons de 1 000 $ à 10 millions $, 10 millions au plus par tour (100 millions en VIP). Invite tes amis créateurs depuis la table.', 'European roulette, single zero. Chips from $1,000 to $10 million, $10 million at most per spin ($100 million at VIP tables). Invite your creator friends from the table.')}
      </p>
      {erreur && <p className="cas-erreur">{erreur}</p>}
    </Fenetre>
  );
}

/** L'étage (donc le niveau) d'une vignette du salon. */
function etageDeVignette(id: (typeof JEUX)[number]['id']): Etage {
  if (id === 'poker') return 'tables';
  return (Object.keys(JEUX_ETAGE) as Etage[]).find((e) => JEUX_ETAGE[e].includes(id)) ?? 'bar';
}
const niveauDuJeu = (id: (typeof JEUX)[number]['id']) => etage(etageDeVignette(id)).niveau;
/** L'ordre des jeux de même niveau dans la grille. */
const ORDRE_JEUX: (typeof JEUX)[number]['id'][] = ['machines', 'tickets', 'festin', 'blackjack', 'roulette', 'baronWheel', 'folleNuit', 'course', 'couronne', 'chute'];

/** Les jeux de chaque étage de l'hôtel (cartes de l'accueil). La Folle Nuit a sa propre carte, sur la scène. */
const JEUX_ETAGE: Record<Etage, (typeof JEUX)[number]['id'][]> = {
  bar: ['machines', 'festin', 'tickets'],
  tables: ['blackjack', 'roulette', 'poker'],
  scene: ['folleNuit', 'baronWheel', 'course', 'couronne', 'chute'],
  penthouse: [],
};

/** Le solde en bref pour la barre du haut : 1,52 Md $, 48,3 M $ (en entier sous le million). */
function dollarsCourt(n: number): string {
  const f = (x: number, u: string, uEn: string) => tr(`${x.toLocaleString('fr-FR', { maximumFractionDigits: x < 10 ? 2 : 1 })} ${u} $`, `$${x.toLocaleString('en-US', { maximumFractionDigits: x < 10 ? 2 : 1 })}${uEn}`);
  if (n >= 1e12) return f(n / 1e12, 'Bn', 'T');
  if (n >= 1e9) return f(n / 1e9, 'Md', 'B');
  if (n >= 1e6) return f(n / 1e6, 'M', 'M');
  return dollars(n);
}

/** Un bouton du dock (en bas de l'accueil) : icône ronde, nom, pastille ou minuterie. */
/** La boutique du salon (barre du haut) : la Roulette, le Marché noir et le Tailleur, réunis. */
/**
 * Les offres en argent réel de la Boutique : maquette, pas encore à vendre (aucun paiement branché).
 * `image` : bq-<image>.webp ; `photo` : une illustration en largeur plutôt qu'un objet détouré.
 */
type OffreBoutique = { id: string; image: string; photo?: boolean; nom: [string, string]; contenu: [string, string][]; prix: string; ruban?: [string, string]; vedette?: boolean; avant?: string };
const RAYONS_OFFRES: { id: string; titre: [string, string]; offres: OffreBoutique[] }[] = [
  {
    id: 'debutant',
    titre: ['Packs débutant', 'Starter packs'],
    offres: [
      { id: 'coffret', image: 'coffret-debutant', photo: true, nom: ['Coffret du débutant', 'Starter box'], contenu: [['100 M $', '$100M'], ['50 rubis', '50 rubies'], ['Tenue « Rayures d’or »', '“Gold stripes” outfit']], prix: '0,99 €', avant: '4,99 €', ruban: ['Une seule fois', 'Once only'], vedette: true },
      { id: 'contrebande', image: 'contrebande', photo: true, nom: ['Caisse de contrebande', 'Smuggler’s crate'], contenu: [['500 M $', '$500M'], ['150 rubis', '150 rubies'], ['Clé du Marché noir', 'Black Market key']], prix: '4,99 €', avant: '14,99 €', ruban: ['−66 %', '−66%'] },
      { id: 'royal', image: 'coffre-royal', photo: true, nom: ['Trésor royal', 'Royal treasure'], contenu: [['5 Md $', '$5B'], ['600 rubis', '600 rubies'], ['Cape royale + cadre Couronne', 'Royal cape + Crown frame']], prix: '19,99 €', avant: '59,99 €', ruban: ['Meilleure offre', 'Best deal'] },
    ],
  },
  {
    id: 'combines',
    titre: ['Rubis + dollars', 'Rubies + dollars'],
    offres: [
      { id: 'bourse', image: 'rubis-bourse', nom: ['Bourse du joueur', 'Player’s purse'], contenu: [['30 rubis', '30 rubies'], ['50 M $', '$50M']], prix: '1,99 €' },
      { id: 'tenues', image: 'tenues-legendaires', photo: true, nom: ['Tenues légendaires', 'Legendary outfits'], contenu: [['2 tenues exclusives', '2 exclusive outfits'], ['200 rubis', '200 rubies'], ['300 M $', '$300M']], prix: '7,99 €', ruban: ['Exclusif', 'Exclusive'] },
      { id: 'grand-coffre', image: 'rubis-tresor', nom: ['Coffre du Baron', 'Baron’s chest'], contenu: [['800 rubis', '800 rubies'], ['3 Md $', '$3B']], prix: '24,99 €', ruban: ['+40 %', '+40%'] },
    ],
  },
  {
    id: 'rubis',
    titre: ['Rubis', 'Rubies'],
    offres: [
      { id: 'r1', image: 'rubis-poignee', nom: ['Poignée de rubis', 'Handful of rubies'], contenu: [['20 rubis', '20 rubies']], prix: '0,99 €' },
      { id: 'r2', image: 'rubis-sac', nom: ['Sac de rubis', 'Bag of rubies'], contenu: [['60 rubis', '60 rubies']], prix: '2,49 €', ruban: ['+20 %', '+20%'] },
      { id: 'r3', image: 'rubis-coffre', nom: ['Coffret de rubis', 'Ruby chest'], contenu: [['150 rubis', '150 rubies']], prix: '4,99 €', ruban: ['Populaire', 'Popular'], vedette: true },
      { id: 'r4', image: 'rubis-grand-coffre', nom: ['Grand coffre', 'Great chest'], contenu: [['400 rubis', '400 rubies']], prix: '9,99 €', ruban: ['+60 %', '+60%'] },
    ],
  },
  {
    id: 'dollars',
    titre: ['Dollars', 'Dollars'],
    offres: [
      { id: 'd1', image: 'dollars-liasse', nom: ['Liasse', 'Bundle'], contenu: [['50 M $', '$50M']], prix: '0,99 €' },
      { id: 'd2', image: 'dollars-mallette', nom: ['Mallette', 'Briefcase'], contenu: [['300 M $', '$300M']], prix: '2,99 €' },
      { id: 'd3', image: 'dollars-coffre-fort', photo: true, nom: ['Coffre-fort', 'Safe'], contenu: [['1 Md $', '$1B']], prix: '4,99 €', ruban: ['Populaire', 'Popular'] },
      { id: 'd4', image: 'dollars-fourgon', photo: true, nom: ['Fourgon blindé', 'Armored truck'], contenu: [['3 Md $', '$3B']], prix: '9,99 €', ruban: ['+50 %', '+50%'] },
      { id: 'd5', image: 'dollars-banque', photo: true, nom: ['La Banque', 'The Bank'], contenu: [['10 Md $', '$10B']], prix: '24,99 €', ruban: ['+100 %', '+100%'] },
      { id: 'd6', image: 'dollars-salle-forte', photo: true, nom: ['Salle forte du Baron', 'Baron’s vault'], contenu: [['25 Md $', '$25B']], prix: '49,99 €', ruban: ['Meilleur prix', 'Best value'], vedette: true },
    ],
  },
  {
    id: 'pass',
    titre: ['Abonnement', 'Subscription'],
    offres: [
      { id: 'premium', image: 'abonnement', photo: true, nom: ['Abonnement Premium', 'Premium subscription'], contenu: [['Chaque jour : 50 M $ + 5 rubis', 'Every day: $50M + 5 rubies'], ['XP +25 %, 2 tours de roue par jour', 'XP +25%, 2 wheel spins a day'], ['Cadre doré exclusif', 'Exclusive golden frame']], prix: '7,99 € / mois', vedette: true },
    ],
  },
];

/** La roue de luxe (payante) : ses 8 cases, dont la case ×25 (qui multiplie par 25 le gros lot de la roue du jour). */
const LIBELLES_LUXE: [string, string, string][] = [
  ['×25', EN ? 'JACKPOT' : 'GROS LOT', 'couronne'],
  ['100', EN ? 'RUBIES' : 'RUBIS', 'bq-rubis-sac'],
  ['1', EN ? 'BILLION $' : 'MILLIARD $', 'bq-dollars-mallette'],
  [EN ? 'OUTFIT' : 'TENUE', EN ? 'LEGENDARY' : 'LÉGENDAIRE', 'bq-tenue'],
  ['500', EN ? 'MILLION $' : 'MILLIONS $', 'bq-dollars-liasse'],
  ['250', EN ? 'RUBIES' : 'RUBIS', 'bq-rubis-coffre'],
  ['×10', EN ? 'JACKPOT' : 'GROS LOT', 'bq-cle'],
  ['2', EN ? 'BILLION $' : 'MILLIARDS $', 'machine-coffre'],
];

function Offre({ o }: { o: OffreBoutique }) {
  return (
    <div className={`bq-offre ${o.photo ? 'photo' : ''} ${o.vedette ? 'vedette' : ''}`}>
      {o.ruban && <span className="bq-ruban">{tr(...o.ruban)}</span>}
      <div className="bq-visuel">
        <img src={`/cartes/bq-${o.image}.webp`} alt="" draggable={false} />
      </div>
      <b>{tr(...o.nom)}</b>
      <ul>
        {o.contenu.map((c, k) => (
          <li key={k}>{tr(...c)}</li>
        ))}
      </ul>
      <span className="bq-prix" aria-disabled="true">
        {o.avant && <s>{o.avant}</s>}
        {o.prix}
        <em>{tr('Bientôt', 'Soon')}</em>
      </span>
    </div>
  );
}

/** Le Plinko du Baron : la bille tombe de clou en clou jusqu'à une case de dollars. */
/** Le plateau (pk-plateau.webp, 1216 × 1293) : les clous dans son triangle de marbre, les cases sur son velours. */
const PL = { largeur: 1216, hauteur: 1293, centre: 608, haut: 395, ecart: 60, pas: 70, entonnoir: 290, cases: 1112 };
const xBille = (droites: number, rangees: number) => PL.centre + (droites - rangees / 2) * PL.pas;
function Plinko({ vue, appel, onVue, onFermer }: { vue: VueCasino; appel: Appel; onVue: (v: VueCasino) => void; onFermer: () => void }) {
  const [mise, setMise] = useState<MisePlinko>(5);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [resultat, setResultat] = useState<{ caseFinale: number; gain: number; multi: number; id: number } | null>(null);
  const [fete, setFete] = useState<{ gain: number; multi: number } | null>(null);
  const [clou, setClou] = useState<string | null>(null);
  const bille = useRef<SVGImageElement>(null);
  const anim = useRef(0);
  useEffect(() => () => cancelAnimationFrame(anim.current), []);
  const rubis = vue.contrats?.rubis ?? 0;

  const lacher = async () => {
    if (occupe) return;
    if (rubis < mise) return setErreur(tr(`Il te faut ${mise} rubis : gagne-les avec les contrats et l’album.`, `You need ${mise} rubies: earn them with contracts and the album.`));
    setOccupe(true);
    setErreur(null);
    setResultat(null);
    const r = (await appel('casino_plinko', { mise })) as { ok: boolean; erreur?: string; chemin?: number[]; caseFinale?: number; multi?: number; gain?: number; casino?: VueCasino };
    if (!r.ok || !r.chemin || r.caseFinale === undefined || !r.casino || r.gain === undefined || r.multi === undefined) {
      setOccupe(false);
      return setErreur(r.erreur ?? tr('La bille est coincée, réessaie.', 'The ball is stuck, try again.'));
    }
    const { chemin, caseFinale, gain, multi } = r;
    const nouvelle = r.casino;
    jouerEffet('jeton');
    // Les points de passage : le haut, puis chaque clou touché, puis la case.
    const points: { x: number; y: number; clou?: string }[] = [{ x: PL.centre, y: PL.entonnoir }];
    let droites = 0;
    for (let k = 0; k < chemin.length; k++) {
      points.push({ x: xBille(droites, k), y: PL.haut + k * PL.ecart - 22, clou: `${k}-${droites}` });
      droites += chemin[k];
    }
    points.push({ x: xBille(droites, RANGEES_PLINKO), y: PL.cases + 46 });
    const dureeSegment = mouvementReduit() ? 1 : 170;
    const debut = performance.now();
    const fin = () => {
      setClou(null);
      setResultat({ caseFinale, gain, multi, id: Date.now() });
      onVue(nouvelle);
      setOccupe(false);
      jouerEffet(multi >= 20 ? 'roulette_gros_lot' : 'machine_pieces');
      if (multi >= 20) setFete({ gain, multi });
    };
    const pas = (t: number) => {
      const e = (t - debut) / dureeSegment;
      const i = Math.min(points.length - 2, Math.floor(e));
      const u = Math.min(1, e - i);
      const a = points[i];
      const b = points[i + 1];
      // Petit saut au-dessus du clou, puis la chute (parabole).
      const x = a.x + (b.x - a.x) * u;
      const y = a.y + (b.y - a.y) * u * u - (i > 0 && i < points.length - 2 ? 26 * 4 * u * (1 - u) : 0);
      bille.current?.setAttribute('x', String(x - 21));
      bille.current?.setAttribute('y', String(y - 21));
      if (u < 0.15 && a.clou && a.clou !== clouCourant) {
        clouCourant = a.clou;
        setClou(a.clou);
        jouerEffet('bj_carte', { vitesse: 1.4 + Math.random() * 0.4, volume: 0.35 });
      }
      if (e >= points.length - 1) return fin();
      anim.current = requestAnimationFrame(pas);
    };
    let clouCourant = '';
    anim.current = requestAnimationFrame(pas);
  };

  return (
    <Fenetre titre={tr('Le Plinko du Baron', 'The Baron’s Plinko')} onFermer={occupe ? undefined : onFermer} large>
      <div className="pk">
        <img className="pk-logo" src="/cartes/pk-logo.webp" alt={tr('Le Plinko du Baron', 'The Baron’s Plinko')} draggable={false} />
        <p className="pk-intro">
          {tr('Jusqu’à', 'Up to')} <strong>{dollarsCourt(mise * DOLLARS_PAR_RUBIS[mise] * MULTI_MAX_PLINKO)}</strong> !
        </p>
        <svg className="pk-plateau" viewBox={`0 0 ${PL.largeur} ${PL.hauteur}`} role="img" aria-label={tr('Plateau du Plinko', 'Plinko board')}>
          <image href="/cartes/pk-plateau.webp" x="0" y="0" width={PL.largeur} height={PL.hauteur} />
          {Array.from({ length: RANGEES_PLINKO }, (_, k) =>
            Array.from({ length: k + 3 }, (_, j) => {
              const x = PL.centre + (j - (k + 2) / 2) * PL.pas;
              const touche = clou === `${k}-${j - 1}` || clou === `${k}-${j}`;
              return <image key={`${k}-${j}`} className={`pk-clou ${touche ? 'touche' : ''}`} href="/cartes/pk-clou.webp" x={x - 13} y={PL.haut + k * PL.ecart - 13} width="26" height="26" />;
            }),
          )}
          {MULTIPLICATEURS_PLINKO.map((m, k) => {
            const x = xBille(k, RANGEES_PLINKO);
            const gagnante = resultat?.caseFinale === k;
            return (
              <g key={`${resultat?.id ?? 0}-${k}`} className={`pk-case m${m >= 100 ? 'max' : m >= 8 ? 'haut' : m >= 2 ? 'moyen' : 'bas'} ${gagnante ? 'gagnante' : ''}`}>
                <image href="/cartes/pk-case.webp" x={x - 34} y={PL.cases + 6} width="68" height="86" preserveAspectRatio="none" />
                <text x={x} y={PL.cases + 58}>{m >= 1000 ? '1K' : m}</text>
                <text className="pk-x" x={x} y={PL.cases + 80}>×</text>
              </g>
            );
          })}
          <image ref={bille} className="pk-bille" href="/cartes/pk-bille.webp" x={PL.centre - 21} y={PL.entonnoir - 60} width="42" height="42" />
        </svg>
        {resultat && resultat.multi >= 100 && <img key={resultat.id} className="pk-explosion" src="/cartes/pk-jackpot.webp" alt="" aria-hidden="true" />}
        <p className="pk-resultat" aria-live="polite">
          {resultat ? (
            <>
              ×{resultat.multi} · <strong>+{dollars(resultat.gain)}</strong>
            </>
          ) : (
            ' '
          )}
        </p>
        <div className="pk-mises" role="radiogroup" aria-label={tr('Mise', 'Bet')}>
          {MISES_PLINKO.map((x) => (
            <button key={x} type="button" role="radio" aria-checked={x === mise} className={x === mise ? 'actif' : ''} disabled={occupe} onClick={() => setMise(x)}>
              <img src="/cartes/rubis-icone.webp" alt="" />
              {x}
              {x > 5 && <small className="pk-bonus">+{Math.round((DOLLARS_PAR_RUBIS[x] / DOLLARS_PAR_RUBIS[5] - 1) * 100)} %</small>}
            </button>
          ))}
        </div>
        <button type="button" className="principal large pk-lacher" disabled={occupe} onClick={() => void lacher()}>
          {occupe ? tr('La bille tombe…', 'The ball is falling…') : tr(`Lâcher la bille · ${mise} rubis`, `Drop the ball · ${mise} rubies`)}
        </button>
        <p className="pk-solde">
          <img src="/cartes/rubis-icone.webp" alt="" /> {tr(`${rubis} rubis`, `${rubis} rubies`)}
        </p>
        {erreur && <p className="cas-erreur">{erreur}</p>}
        <p className="pk-note">{tr('Les rubis se gagnent avec les contrats, l’album et la semaine du Baron.', 'Rubies are earned with contracts, the album and the Baron’s week.')}</p>
      </div>
      {fete && (
        <Celebration
          titre={fete.multi >= MULTI_MAX_PLINKO ? tr('LE GROS LOT !', 'THE JACKPOT!') : tr(`×${fete.multi} !`, `×${fete.multi}!`)}
          etiquette={tr(`Gain : ${dollars(fete.gain)}`, `Win: ${dollars(fete.gain)}`)}
          medaillon={<strong className="celebration-xp cas-medaillon-gain">{dollarsCourt(fete.gain)}</strong>}
          legende={tr('Ajouté à ton solde', 'Added to your balance')}
          onFermer={() => setFete(null)}
        />
      )}
    </Fenetre>
  );
}

function FenetreBoutique(props: { rayon?: string; attenteRoue: string | null; onFermer: () => void; ouvrir: (f: () => void) => void; onRoue: () => void; onMarche: () => void; onTailleur: () => void; onCoffre: () => void }) {
  const { attenteRoue, ouvrir } = props;
  const [rayon, setRayon] = useState(props.rayon && RAYONS_OFFRES.some((x) => x.id === props.rayon) ? props.rayon : 'debutant');
  const offres = useRef<HTMLElement>(null);
  // Ouverte sur un rayon précis : on y descend directement.
  useEffect(() => {
    if (props.rayon) window.setTimeout(() => offres.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 120);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [rotLuxe, setRotLuxe] = useState(0);
  // La roue de luxe tourne doucement, pour donner envie.
  useEffect(() => {
    const t = window.setInterval(() => setRotLuxe((r) => r + 45), 2600);
    return () => window.clearInterval(t);
  }, []);
  const r = RAYONS_OFFRES.find((x) => x.id === rayon) ?? RAYONS_OFFRES[0];
  return (
    <div className="voile bq-voile" role="dialog" aria-modal="true" aria-label={tr('La boutique', 'The shop')} onClick={props.onFermer}>
      <div className="bq" onClick={(e) => e.stopPropagation()}>
        <header className="bq-tete">
          <img src="/cartes/icone-boutique.webp" alt="" />
          <h2>{tr('La Boutique', 'The Shop')}</h2>
          <button type="button" className="fermer" onClick={props.onFermer} aria-label={tr('Fermer', 'Close')}>
            ✕
          </button>
        </header>

        <section className="bq-roues">
          <button type="button" className="bq-roue" onClick={() => ouvrir(props.onRoue)}>
            <RoueIllustree image="roue-jour" libelles={LIBELLES_JOUR} rotation={0} tourne={false} gagnante={null} petit />
            <span className="bq-roue-texte">
              <b>{tr('Roue du jour', 'Daily wheel')}</b>
              <small>{attenteRoue ? tr(`Prochain tour dans ${attenteRoue}`, `Next spin in ${attenteRoue}`) : tr('Gratuite : un tour t’attend !', 'Free: a spin awaits you!')}</small>
              <i className={`bq-bouton ${attenteRoue ? 'gris' : ''}`}>{attenteRoue ? tr('Revenir plus tard', 'Come back later') : tr('Tourner', 'Spin')}</i>
            </span>
            {!attenteRoue && <span className="pastille-nombre">1</span>}
          </button>
          <div className="bq-roue luxe">
            <span className="bq-ruban">{tr('×25 le gros lot', '×25 jackpot')}</span>
            <RoueIllustree image="roue-luxe" libelles={LIBELLES_LUXE} rotation={rotLuxe} tourne={false} gagnante={null} petit />
            <span className="bq-roue-texte">
              <b>{tr('Roue de luxe', 'Luxury wheel')}</b>
              <small>{tr('Jusqu’à 25 fois le gros lot, des rubis, des tenues…', 'Up to 25× the jackpot, rubies, outfits…')}</small>
              <i className="bq-bouton prix" aria-disabled="true">
                2,99 € <em>{tr('Bientôt', 'Soon')}</em>
              </i>
            </span>
          </div>
        </section>

        <button type="button" className="bq-coffre-rubis" onClick={() => ouvrir(props.onCoffre)}>
          <img src="/cartes/rubis-icone.webp" alt="" />
          <span>
            <b>{tr('Le Plinko du Baron', 'The Baron’s Plinko')}</b>
            <small>{tr('Lâche une bille contre des rubis : jusqu’à ×1000, 25 milliards $ !', 'Drop a ball for rubies: up to ×1000, $25 billion!')}</small>
          </span>
          <i className="bq-bouton">
            <img src="/cartes/rubis-icone.webp" alt="" />5
          </i>
        </button>

        <nav className="bq-onglets" ref={offres} aria-label={tr('Rayons', 'Departments')}>
          {RAYONS_OFFRES.map((x) => (
            <button key={x.id} type="button" className={x.id === rayon ? 'actif' : ''} aria-pressed={x.id === rayon} onClick={() => setRayon(x.id)}>
              {tr(...x.titre)}
            </button>
          ))}
        </nav>
        <div className={`bq-offres n${r.offres.length}`}>
          {r.offres.map((o) => (
            <Offre key={o.id} o={o} />
          ))}
        </div>
        <p className="bq-note">{tr('Offres en préparation : les achats ne sont pas encore ouverts.', 'Offers in preparation: purchases are not open yet.')}</p>

        <h3 className="bq-titre">{tr('Les boutiques du salon', 'The lounge shops')}</h3>
        <div className="bq-rayons">
          <button type="button" className="bq-rayon" onClick={() => ouvrir(props.onMarche)}>
            <img src="/cartes/icone-tailleur.webp" alt="" />
            <span>
              <b>{tr('Le Marché noir', 'The Black Market')}</b>
              <small>{tr('L’étal du jour, contre des rubis', 'Today’s stall, for rubies')}</small>
            </span>
          </button>
          <button type="button" className="bq-rayon" onClick={() => ouvrir(props.onTailleur)}>
            <img src="/cartes/icone-tailleur.webp" alt="" />
            <span>
              <b>{tr('Le Tailleur', 'The Tailor')}</b>
              <small>{tr('Les tenues du salon', 'The lounge outfits')}</small>
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

function BoutonDock({ icone, nom, pastille, info, onClick, rond = true }: { icone: ReactNode; nom: string; pastille?: number | string | null; info?: string | null; onClick: () => void; rond?: boolean }) {
  return (
    <button type="button" className="ac-dock-bouton" onClick={onClick}>
      <span className={`ac-dock-icone ${rond ? 'rond' : ''}`}>{icone}</span>
      {!!pastille && <span className="pastille-nombre">{pastille}</span>}
      {info && <span className="ac-dock-info">{info}</span>}
      <span className="ac-dock-nom">{nom}</span>
    </button>
  );
}

/** « À la une » : une seule annonce à la fois (cadeau, dépannage, jeu à l'affiche, spectacle en direct…), qui tourne. */
/** Un élément « À la une » : son illustration de fond et le logo du jeu concerné. */
type ElementUne = { cle: string; contenu: ReactNode; fond?: string; logo?: string };

function ALaUne({ elements }: { elements: ElementUne[] }) {
  const [i, setI] = useState(0);
  const [pause, setPause] = useState(false);
  const n = elements.length;
  useEffect(() => {
    if (n < 2 || pause) return;
    const t = window.setInterval(() => setI((x) => (x + 1) % n), 6500);
    return () => window.clearInterval(t);
  }, [n, pause]);
  if (!n) return null;
  const k = i % n;
  return (
    <section className="ac-une" onPointerDown={() => setPause(true)}>
      <div key={elements[k].cle} className={`ac-une-contenu ${elements[k].fond ? 'illustre' : ''}`} style={elements[k].fond ? ({ '--une-fond': `url('/cartes/une-${elements[k].fond}.webp')` } as CSSProperties) : undefined}>
        {elements[k].logo && <img className="ac-une-logo" src={elements[k].logo} alt="" draggable={false} />}
        {elements[k].contenu}
      </div>
      {n > 1 && (
        <div className="ac-une-points" role="tablist">
          {elements.map((e, j) => (
            <button key={e.cle} type="button" role="tab" aria-selected={j === k} aria-label={String(j + 1)} className={j === k ? 'actif' : ''} onClick={() => (setI(j), setPause(true))} />
          ))}
        </div>
      )}
    </section>
  );
}

/** L'accueil du salon : barre du haut, « À la une », les étages de l'hôtel et leurs jeux, le dock. */
function Accueil({
  vue,
  appel,
  onVue,
  etageActif,
  onEtage,
  onVignette,
  onFolleNuit,
  onBaronWheel,
  onAffiche,
  onRafraichir,
  onCadeau,
  onCadeauFini,
  onRoue,
  onSemaine,
  onContrats,
  onAlbum,
  onVentes,
  onBureau,
  onAmis,
  onDefis,
  onProfil,
  onQuitter,
  onCercles,
  onBourse,
  onVip,
  onMarche,
  onTailleur,
}: {
  onCercles: () => void;
  onBourse: () => void;
  onVip: (j: 'blackjack' | 'roulette') => void;
  onMarche: () => void;
  onTailleur: () => void;
  vue: VueCasino;
  appel: Appel;
  onVue: (v: VueCasino) => void;
  etageActif: Etage;
  onEtage: (e: Etage) => void;
  onVignette: (id: (typeof JEUX)[number]['id']) => void;
  onFolleNuit: () => void;
  onBaronWheel: () => void;
  onAffiche: (j: JeuCasino) => void;
  onRafraichir: () => void;
  onCadeau: () => void;
  onCadeauFini: () => void;
  onRoue: () => void;
  onSemaine: () => void;
  onContrats: () => void;
  onAlbum: () => void;
  onVentes: () => void;
  onBureau: () => void;
  onAmis: () => void;
  onDefis: () => void;
  onProfil: () => void;
  onQuitter: () => void;
}) {
  const solde = useSoldeAnime(vue.solde);
  const attenteRoue = useAttente(vue.roueProchaine);
  const finVentes = useAttente(vue.ventes?.fin);
  const [menu, setMenu] = useState(false);
  const [riches, setRiches] = useState(false);
  // La Boutique ouverte, et sur quel rayon (le « + » des rubis ou des dollars mène droit à leurs offres).
  const [boutique, setBoutique] = useState<string | false>(false);
  const [coffreRubis, setCoffreRubis] = useState(false);
  const niveau = vue.hotel?.niveau ?? vue.profil?.niveau ?? 1;
  const c = vue.contrats;
  const e = etage(etageActif);
  const ouvert = etageOuvert(niveau, etageActif);

  // À la une : seulement ce qui compte maintenant.
  const une: ElementUne[] = [];
  const logoJeu = (j: JeuCasino) => `/cartes/vignette-${VIGNETTES_ALBUM[j]}.webp`;
  if (vue.cadeau) une.push({ cle: `cadeau-${vue.cadeau.fin}`, fond: 'cadeau', logo: '/cartes/logo-appli-casino.webp', contenu: <BandeauCadeau key={vue.cadeau.fin} cadeau={vue.cadeau} onRecuperer={onCadeau} onFini={onCadeauFini} /> });
  if (c?.depannage) une.push({ cle: 'depannage', fond: 'depannage', logo: '/cartes/logo-appli-casino.webp', contenu: <Depannage c={c} appel={appel} onVue={onVue} /> });
  // En tête : l'Happy Hour (toujours annoncée) et le jeu en XP double.
  const hh = vue.hotel?.happyHour;
  if (hh?.enCours) une.unshift({ cle: 'happy', fond: 'happy-hour', logo: '/cartes/logo-appli-casino.webp', contenu: <BandeauHappyHour vue={vue} /> });
  // La Boutique, toujours à la une, juste après l'Happy Hour et le jeu à l'affiche.
  une.push({
    cle: 'boutique',
    fond: 'boutique',
    logo: '/cartes/icone-boutique.webp',
    contenu: (
      <div className="ac-une-boutique">
        <span>
          <small>{tr('Le Grand Hôtel du Baron', 'The Baron’s Grand Hotel')}</small>
          <strong>{tr('La Boutique', 'The Shop')}</strong>
          <em>{tr('Roulette du jour, Marché noir, Tailleur…', 'Daily wheel, Black Market, Tailor…')}</em>
        </span>
        <button type="button" className="principal" onClick={() => setBoutique('debutant')}>
          {tr('Entrer', 'Enter')} ›
        </button>
      </div>
    ),
  });
  if (vue.affiche) une.splice(hh?.enCours ? 1 : 0, 0, { cle: `affiche-${vue.affiche.debut}`, fond: 'affiche', logo: logoJeu(vue.affiche.jeu), contenu: <BandeauAffiche affiche={vue.affiche} onOuvrir={onAffiche} onFin={onRafraichir} /> });
  if (vue.baronWheel?.ouverture) une.push({ cle: 'ouverture-bw', fond: 'ouverture-bw', logo: logoJeu('baronWheel'), contenu: <BandeauOuvertureBW vue={vue} onOuvrir={onBaronWheel} /> });
  if (vue.folleNuit?.enDirect && etageOuvert(niveau, 'scene')) une.push({ cle: 'folle-nuit', fond: 'folle-nuit', logo: logoJeu('folleNuit'), contenu: <BandeauFolleNuit vue={vue} onOuvrir={onFolleNuit} /> });

  {
    const i = une.findIndex((x) => x.cle === 'boutique');
    const [b] = une.splice(i, 1);
    une.splice(une.filter((x) => x.cle === 'happy' || x.cle.startsWith('affiche-')).length, 0, b);
  }
  const restants = c ? c.jour.filter((x) => !x.fait).length : 0;
  const pieces = c ? JEUX_CASINO.reduce((s, j) => s + morceauxDe(c.album[j]), 0) : 0;
  // Les jeux, du premier ouvert au dernier (le poker « bientôt » à la fin), par pages de 6.
  const ordre = JEUX.filter((j) => j.id !== 'poker')
    .map((j, i) => ({ j, i }))
    .sort((x, y) => niveauDuJeu(x.j.id) - niveauDuJeu(y.j.id) || ORDRE_JEUX.indexOf(x.j.id) - ORDRE_JEUX.indexOf(y.j.id) || x.i - y.i)
    .map((x) => x.j);
  ordre.push(...JEUX.filter((j) => j.id === 'poker'));
  const pages: (typeof JEUX)[number][][] = [];
  // Une seule rangée qu'on fait défiler : des cartes plus grandes.
  pages.push(ordre);
  // Happy Hour (tous les jeux) et jeu à l'affiche (XP double) : des flammes au-dessus de la carte.
  const happy = !!vue.hotel?.happyHour.enCours;
  const grille = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const [defile, setDefile] = useState({ gauche: false, droite: true });
  useEffect(() => {
    const g = grille.current;
    if (g) setDefile({ gauche: g.scrollLeft > 8, droite: g.scrollLeft + g.clientWidth < g.scrollWidth - 8 });
  }, []);

  return (
    <div className="ac ac-sans-etages">
      <header className="ac-barre">
        <button type="button" className="ac-moi" onClick={onProfil} aria-label={tr('Mon profil du casino', 'My casino profile')}>
          <CadreAvatar avatar={vue.avatar} niveau={niveau} taille={58} special={cadreSpecial(c?.cadres, c?.cadreChoisi)} sansNiveau />
          <span className="ac-niveau">
            <b>{tr(`Niv. ${niveau}`, `Lvl ${niveau}`)}</b>
            {vue.profil && <BarreXp xp={vue.profil.xp} xpNiveau={vue.profil.xpNiveau} xpSuivant={vue.profil.xpSuivant} fine />}
          </span>
        </button>
        <span className="ac-compteur ac-rubis">
          <img src="/cartes/rubis-icone.webp" alt={tr('Rubis', 'Rubies')} />
          <b>{(c?.rubis ?? 0).toLocaleString(tr('fr-FR', 'en-US'))}</b>
          <button type="button" className="ac-plus" onClick={() => setBoutique('rubis')} aria-label={tr('Obtenir des rubis', 'Get rubies')}>
            <img src="/cartes/bouton-plus.webp" alt="" />
          </button>
        </span>
        <span className="ac-compteur ac-dollars">
          <img src="/cartes/dollars-icone.webp" alt="$" />
          <b title={dollars(solde)}>{dollarsCourt(solde)}</b>
          <button type="button" className="ac-plus" onClick={() => setBoutique('dollars')} aria-label={tr('Obtenir des dollars', 'Get dollars')}>
            <img src="/cartes/bouton-plus.webp" alt="" />
          </button>
        </span>
        <button type="button" className="ac-boutique" onClick={() => setBoutique('debutant')} aria-label={tr('La boutique', 'The shop')}>
          <img src="/cartes/icone-boutique.webp" alt="" />
          <span>{tr('Boutique', 'Shop')}</span>
          {!attenteRoue && <span className="pastille-nombre">1</span>}
        </button>
        <span className="ac-carte-membre" style={{ marginLeft: 'auto' }}>
          <CarteDeMembre vue={vue} />
        </span>
        <button type="button" className="ac-menu" onClick={() => setMenu(true)} aria-label={tr('Menu du salon', 'Lounge menu')}>
          <img src="/cartes/bouton-menu.webp" alt="" />
        </button>
      </header>

      <div className="ac-une-haut">
        <ALaUne elements={une} />
      </div>

      {/* Tous les jeux, en grille de 3 × 2 (pages qu'on fait glisser) ; chacun s'ouvre à son niveau. */}
      <section className="ac-scene ac-grille-zone">
        <button type="button" className="ac-fleche gauche" disabled={!defile.gauche} onClick={() => grille.current?.scrollBy({ left: -grille.current.clientWidth * 0.8, behavior: 'smooth' })} aria-label={tr('Jeux précédents', 'Previous games')}>
          ‹
        </button>
        <button type="button" className="ac-fleche droite" disabled={!defile.droite} onClick={() => grille.current?.scrollBy({ left: grille.current.clientWidth * 0.8, behavior: 'smooth' })} aria-label={tr('Jeux suivants', 'Next games')}>
          ›
        </button>
        <div
          className="ac-grille"
          ref={grille}
          onScroll={(ev) => {
            const g = ev.currentTarget;
            setPage(Math.round(g.scrollLeft / Math.max(1, g.clientWidth)));
            setDefile({ gauche: g.scrollLeft > 8, droite: g.scrollLeft + g.clientWidth < g.scrollWidth - 8 });
          }}
        >
          {pages.map((liste, k) => (
            <div key={k} className="ac-page">
              {k === 0 && une.length > 0 && (
                <div className="ac-une-carte">
                  <ALaUne elements={une} />
                </div>
              )}
              {liste.map((j) => {
                const nv = niveauDuJeu(j.id);
                const o = niveau >= nv;
                return (
                  <div key={j.id} className={`ac-carte ${o ? '' : 'fermee'} ${o && j.id !== 'poker' && (happy || (!!vue.affiche && VIGNETTE_DU_JEU[vue.affiche.jeu] === j.id)) ? 'dore' : ''}`}>
                    {o && j.id !== 'poker' && (happy || (!!vue.affiche && VIGNETTE_DU_JEU[vue.affiche.jeu] === j.id)) && (
                      <span className="ac-reflet" aria-hidden="true" />
                    )}
                    {o && j.id !== 'poker' && (happy || (!!vue.affiche && VIGNETTE_DU_JEU[vue.affiche.jeu] === j.id)) && (
                      <b className="ac-neon-badge">{!!vue.affiche && VIGNETTE_DU_JEU[vue.affiche.jeu] === j.id ? tr('XP ×2', 'XP ×2') : 'Happy Hour'}</b>
                    )}
                    <Vignette
                      jeu={j}
                      affiche={!!vue.affiche && VIGNETTE_DU_JEU[vue.affiche.jeu] === j.id}
                      onOuvrir={j.id === 'poker' ? undefined : o ? () => onVignette(j.id) : () => onEtage(etageDeVignette(j.id))}
                      ruban={o ? rubanJeu(j.id, vue) : undefined}
                    />
                    {o && j.id !== 'poker' && <img className="ac-jouer" src="/cartes/bouton-jouer.webp" alt="" aria-hidden="true" />}
                    {!o && (
                      <span className="ac-cadenas">
                        🔒<small>{tr(`Niveau ${nv}`, `Level ${nv}`)}</small>
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        {pages.length > 1 && (
          <div className="ac-points" role="tablist" aria-label={tr('Pages des jeux', 'Game pages')}>
            {pages.map((_, k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={k === page}
                aria-label={tr(`Page ${k + 1}`, `Page ${k + 1}`)}
                className={k === page ? 'actif' : ''}
                onClick={() => grille.current?.scrollTo({ left: k * grille.current.clientWidth, behavior: 'smooth' })}
              />
            ))}
          </div>
        )}
        <p className="cas-gros-lot ac-gros-lot">
          {tr('Gros lot du Bandit', 'Bandit jackpot')} : <strong>{dollars(vue.grosLot)}</strong>
        </p>
      </section>

      <nav className="ac-dock" aria-label={tr('Le salon', 'The lounge')}>
        <div className="ac-dock-defile">
          <BoutonDock rond={false} icone={<img src="/cartes/icone-semaine.webp" alt="" />} nom={tr('Semaine', 'Week')} pastille={vue.hotel?.semaine.cadeau ? 1 : null} info={vue.hotel ? `${vue.hotel.semaine.pris.length}/7` : null} onClick={onSemaine} />
          <BoutonDock rond={false} icone={<img src="/cartes/icone-contrats.webp" alt="" />} nom={tr('Contrats', 'Contracts')} pastille={restants || null} onClick={onContrats} />
          <BoutonDock rond={false} icone={<img src="/cartes/icone-album.webp" alt="" />} nom={tr('Album', 'Album')} info={`${pieces}/${JEUX_CASINO.length * MORCEAUX_PAGE}`} onClick={onAlbum} />
          <BoutonDock rond={false} icone={<img src="/cartes/icone-ventes.webp" alt="" />} nom={tr('Ventes', 'Auctions')} info={finVentes} onClick={onVentes} />
          <BoutonDock rond={false} icone={<img src="/cartes/icone-bureau.webp" alt="" />} nom={tr('Bureau', 'Office')} info={c ? `${c.objets}/10` : null} onClick={onBureau} />
          <BoutonDock icone={<img src="/cartes/blason-lion.webp" alt="" />} nom={tr('Cercles', 'Circles')} onClick={onCercles} rond={false} />
          <BoutonDock icone={<img src="/cartes/telescripteur.webp" alt="" />} nom={tr('Bourse', 'Exchange')} onClick={onBourse} />
          <BoutonDock icone={<img src="/cartes/icone-amis-dock.webp" alt="" />} nom={tr('Amis', 'Friends')} pastille={vue.profil?.demandes || null} onClick={onAmis} rond={false} />
          <BoutonDock rond={false} icone={<img src="/cartes/icone-defis.webp" alt="" />} nom={tr('Défis', 'Challenges')} pastille={vue.profil?.invitations || null} info={vue.profil?.defi ? tr('En cours', 'Live') : null} onClick={onDefis} />
          <BoutonDock icone={<img src="/cartes/icone-riches.webp" alt="" />} nom={tr('Riches', 'Richest')} onClick={() => setRiches(true)} rond={false} />
        </div>
      </nav>

      {menu && (
        <Fenetre titre={tr('Salon privé', 'Private lounge')} onFermer={() => setMenu(false)}>
          <div className="ac-menu-liste">
            <button type="button" onClick={() => (setMenu(false), onProfil())}>
              <img src="/cartes/icone-profil.webp" alt="" /> {tr('Mon profil', 'My profile')}
            </button>
            <button type="button" onClick={() => (setMenu(false), onAmis())}>
              <img src="/cartes/icone-amis.webp" alt="" /> {tr('Amis', 'Friends')}
            </button>
            <button type="button" onClick={() => (setMenu(false), onDefis())}>
              <img src="/cartes/icone-invitation.webp" alt="" /> {tr('Défis', 'Challenges')}
            </button>
            <button type="button" onClick={() => (setMenu(false), onBureau())}>
              <img src="/cartes/objet-globe.webp" alt="" /> {tr('Mon bureau', 'My office')}
            </button>
            <button type="button" onClick={() => (setMenu(false), setRiches(true))}>
              <img src="/cartes/icone-scores.webp" alt="" /> {tr('Les plus riches', 'Richest players')}
            </button>
            <BoutonMusique />
            <button type="button" className="ac-quitter" onClick={() => (setMenu(false), onQuitter())}>
              ‹ {tr('Quitter le salon', 'Leave the lounge')}
            </button>
          </div>
          <p className="cas-mention">{tr('Argent fictif, sans aucune valeur réelle.', 'Play money, with no real value.')}</p>
        </Fenetre>
      )}
      {boutique && (
        <FenetreBoutique
          rayon={boutique}
          attenteRoue={attenteRoue}
          onFermer={() => setBoutique(false)}
          ouvrir={(f) => {
            setBoutique(false);
            f();
          }}
          onRoue={onRoue}
          onMarche={onMarche}
          onTailleur={onTailleur}
          onCoffre={() => setCoffreRubis(true)}
        />
      )}
      {coffreRubis && <Plinko vue={vue} appel={appel} onVue={onVue} onFermer={() => setCoffreRubis(false)} />}
      {riches && (
        <Fenetre titre={tr('Les plus riches du salon', 'Richest in the lounge')} onFermer={() => setRiches(false)}>
          <section className="cas-riches ac-riches">
            <ol>
              {vue.riches.map((r, i) => (
                <li key={`${i}-${r.nom}`} className={r.moi ? 'moi' : ''}>
                  <span className="cas-riche-rang">{i + 1}</span>
                  <CadreAvatar avatar={r.avatar} niveau={r.niveau ?? 1} taille={34} sansNiveau />
                  <span className="cas-riche-nom">{r.nom || tr('Créateur', 'Creator')}</span>
                  <strong>{dollars(r.solde)}</strong>
                </li>
              ))}
            </ol>
          </section>
        </Fenetre>
      )}
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
  onPret,
}: {
  appel: Appel;
  /** Le salon est ouvert (la page de chargement peut lever le rideau). */
  onPret?: () => void;
  compte: EtatCompte;
  onQuitter: (message?: string) => void;
  /** Invitation d'un ami acceptée : la table à rejoindre dès l'entrée au salon. */
  invitation?: { id: string; jeu: JeuTable; code: string } | null;
  onInvitation?: () => void;
}) {
  const [vue, setVue] = useState<VueCasino | null>(null);
  const [ecran, setEcran] = useState<'salon' | 'machines' | 'machine' | 'nuits' | 'table' | 'folleNuit' | 'festin' | 'couronne' | 'chute' | 'course' | 'baronWheel' | 'tickets' | 'profil' | 'amis' | 'defis' | 'contrats' | 'album' | 'ventes' | 'bureau' | 'cercles' | 'bourse' | 'marche' | 'tailleur'>('salon');
  /** Grand Hôtel : l'étage ouvert, l'étage fermé montré par le Groom, la Semaine du Baron. */
  const [etageActif, setEtageActif] = useState<Etage>('bar');
  const [etageFerme, setEtageFerme] = useState<Etage | null>(null);
  const [semaineOuverte, setSemaineOuverte] = useState(false);
  /** Bureau du Baron : le mien (null) ou celui d'un autre joueur. */
  const [bureauUid, setBureauUid] = useState<string | null>(null);
  /** Profil du casino : le mien (null) ou celui d'un ami ; l'ami présélectionné pour un défi. */
  const [profilUid, setProfilUid] = useState<string | null>(null);
  const [cibleDefi, setCibleDefi] = useState<string | null>(null);
  const [defis, setDefis] = useState<VueDefi[]>([]);
  const [fete, setFete] = useState<FeteNiveau | null>(null);
  const [bienvenue, setBienvenue] = useState<CadeauSemaine | null>(null);
  const [toastSocial, setToastSocial] = useState<{ texte: string; vers: 'amis' | 'defis'; id: number } | null>(null);
  const minuterieToast = useRef(0);
  const moi = compte.uid ?? '';
  /** Chaque (re)entrée au salon : le serveur repart de zéro pour ce téléphone (position, présence). */
  const [entrees, setEntrees] = useState(0);
  const defisRef = useRef<VueDefi[]>([]);
  defisRef.current = defis;
  const [roue, setRoue] = useState(false);
  const [fenetreTables, setFenetreTables] = useState<JeuTable | null>(null);
  const [tablesVip, setTablesVip] = useState(false);
  const [table, setTable] = useState<TableActive | null>(null);
  const tableRef = useRef<{ jeu: JeuTable; code: string } | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [cadeau, setCadeau] = useState<number | null>(null);
  const [annonce, setAnnonce] = useState<AnnonceCasino | null>(null);
  const minuterieAnnonce = useRef(0);
  const entreRef = useRef(false);

  // Le salon est ouvert : la page de chargement lève le rideau.
  const ouvert = !!vue;
  const pretRef = useRef(onPret);
  pretRef.current = onPret;
  useEffect(() => {
    if (ouvert) pretRef.current?.();
  }, [ouvert]);

  // Musique d'ambiance du salon (jazz de cabaret) tant qu'on est au casino.
  useEffect(() => {
    musiqueDuSalon(true);
    return () => musiqueDuSalon(false);
  }, []);

  const entrer = useCallback(async () => {
    for (let essai = 0; essai < 4; essai++) {
      const r = (await appel('casino_entrer')) as { ok: boolean; erreur?: string; casino?: VueCasino; bienvenue?: CadeauSemaine };
      if (r.ok && r.casino) {
        if (r.bienvenue) setBienvenue(r.bienvenue);
        if (!entreRef.current) jouerEffet('casino_entree');
        entreRef.current = true;
        setVue(r.casino);
        setEntrees((n) => n + 1);
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
    // Profil du casino : niveau, amis, envois et défis arrivent en direct.
    const rafraichir = () =>
      void appel('casino_vue').then((r) => {
        const casino = (r as unknown as { casino?: VueCasino }).casino;
        if (r.ok && casino) setVue(casino);
      });
    const montrer = (texte: string, vers: 'amis' | 'defis') => {
      if (!texte) return;
      setToastSocial({ texte, vers, id: Date.now() });
      window.clearTimeout(minuterieToast.current);
      minuterieToast.current = window.setTimeout(() => setToastSocial(null), 5000);
    };
    const surNiveau = (f: Omit<FeteNiveau, 'id'>) => {
      setFete({ ...f, id: Date.now() });
      rafraichir();
    };
    const surSocial = (e: { type: string; nom: string; montant?: number }) => {
      jouerEffet(e.type === 'recu' ? 'machine_pieces' : 'casino_annonce');
      montrer(texteSocial(e), 'amis');
      rafraichir();
    };
    const surSolde = (solde: number) => setVue((v) => (v ? { ...v, solde } : v));
    // Bonus du jeu à l'affiche : montré un peu après (le temps que le coup se termine à l'écran, pour ne rien gâcher).
    const surAffiche = (e: { total: number; debut: number }) =>
      window.setTimeout(() => setVue((v) => (v?.affiche && v.affiche.debut === e.debut ? { ...v, affiche: { ...v.affiche, bonus: Math.max(v.affiche.bonus, e.total) } } : v)), 3000);
    const surDefi = (d: VueDefi) => {
      const avant = defisRef.current.find((x) => x.id === d.id);
      setDefis((l) => [d, ...l.filter((x) => x.id !== d.id)]);
      const texte = texteDefi(d, moi, avant);
      if (texte) {
        jouerEffet(d.etat === 'fini' ? 'roulette_gain' : 'casino_annonce');
        montrer(texte, 'defis');
        rafraichir();
      }
    };
    // Salle des ventes : chaque enchère met les lots à jour chez tout le salon.
    const surVentes = (ventes: VueVentes) => setVue((v) => (v ? { ...v, ventes } : v));
    socket.on('casino_ventes', surVentes);
    socket.on('casino_niveau', surNiveau);
    socket.on('casino_social', surSocial);
    socket.on('casino_solde', surSolde);
    socket.on('casino_affiche', surAffiche);
    socket.on('casino_defi', surDefi);
    return () => {
      socket.off('casino_ventes', surVentes);
      socket.off('casino_niveau', surNiveau);
      socket.off('casino_social', surSocial);
      socket.off('casino_solde', surSolde);
      socket.off('casino_affiche', surAffiche);
      socket.off('casino_defi', surDefi);
      window.clearTimeout(minuterieToast.current);
      socket.off('casino_annonce', surAnnonce);
      socket.off('casino_gros_lot', surGrosLot);
      socket.off('casino_bj', surTable);
      socket.off('casino_rl', surRoulette);
      socket.off('connect', surConnexion);
      window.clearTimeout(minuterieAnnonce.current);
      socket.emit('casino_quitter');
    };
  }, [entrer, appel, moi]);

  // Le défi en cours vu à l'entrée du salon (ensuite, les événements le tiennent à jour).
  const defiVue = vue?.profil?.defi ?? null;
  useEffect(() => {
    if (defiVue && !defisRef.current.some((x) => x.id === defiVue.id)) setDefis((l) => [defiVue, ...l]);
  }, [defiVue]);
  const defiActif = defis.find((d) => d.etat === 'enCours') ?? null;

  // Où je joue, pour que mes amis puissent me rejoindre.
  const position: PositionCasino['ecran'] =
    ecran === 'machine' ? 'machine' : ecran === 'nuits' ? 'nuits' : ecran === 'folleNuit' ? 'folleNuit' : ecran === 'festin' ? 'coffres' : ecran === 'couronne' ? 'couronne' : ecran === 'chute' ? 'chute' : ecran === 'course' ? 'course' : ecran === 'baronWheel' ? 'baronWheel' : ecran === 'tickets' ? 'tickets' : ecran === 'table' && table ? table.jeu : 'salon';
  useEffect(() => {
    if (entrees) socket.emit('casino_position', { ecran: position });
  }, [position, entrees]);
  // Chaque jeu a sa musique et ses sons ; le salon (et ses écrans) garde son jazz de cabaret.
  useEffect(() => musiqueDuCasino(position), [position]);

  /** Relit le salon (solde, jeu à l'affiche…). */
  const rafraichirVue = useCallback(() => {
    void appel('casino_vue').then((r) => {
      const casino = (r as unknown as { casino?: VueCasino }).casino;
      if (r.ok && casino) setVue(casino);
    });
  }, [appel]);
  /** Ouvre un jeu du salon (depuis le bandeau du jeu à l'affiche). */
  const niveauHotel = vue?.hotel?.niveau ?? 1;
  /** Un étage fermé (niveau trop bas) : le Groom l'explique au lieu d'ouvrir. */
  const etageBloque = (j: JeuCasino) => {
    const e = etageDuJeu(j);
    if (etageOuvert(niveauHotel, e)) return false;
    setEtageFerme(e);
    return true;
  };
  /** Un étage de l'accueil ; un second appui sur un étage fermé fait venir le Groom. */
  const ouvrirEtage = (e: Etage) => {
    if (e === etageActif && !etageOuvert(niveauHotel, e)) return setEtageFerme(e);
    setEtageActif(e);
  };
  /** Retour depuis un jeu : à l'accueil, sur l'étage du jeu. */
  const retourEtage = (j: JeuCasino) => {
    setEtageActif(etageDuJeu(j));
    setEcran('salon');
    void appel('casino_vue').then((r) => {
      const casino = (r as unknown as { casino?: VueCasino }).casino;
      if (r.ok && casino) setVue(casino);
    });
  };
  const ouvrirJeu = (j: JeuCasino) => {
    if (etageBloque(j)) return;
    if (j === 'blackjack' || j === 'roulette') return setFenetreTables(j);
    setEcran(j === 'coffres' ? 'festin' : j);
  };

  const ouvrirProfil = (uid: string | null) => {
    setProfilUid(uid);
    setEcran('profil');
  };
  const ouvrirBureau = (uid: string | null) => {
    setBureauUid(uid);
    setEcran('bureau');
  };
  const ouvrirDefis = (cible: string | null = null) => {
    setCibleDefi(cible);
    setEcran('defis');
  };
  const retourSalon = () => {
    setEcran('salon');
    void appel('casino_vue').then((r) => {
      const casino = (r as unknown as { casino?: VueCasino }).casino;
      if (r.ok && casino) setVue(casino);
    });
  };
  /** Rejoindre un ami : son jeu (et sa table, au blackjack ou à la roulette). */
  const rejoindre = async (p: PositionCasino) => {
    if (p.ecran !== 'salon' && etageBloque(p.ecran)) return;
    if ((p.ecran === 'blackjack' || p.ecran === 'roulette') && p.table) {
      if (tableRef.current) await appel(`${EVT_TABLE[tableRef.current.jeu]}_quitter`);
      const r = (await appel(`${EVT_TABLE[p.ecran]}_rejoindre`, { code: p.table })) as { ok: boolean; erreur?: string; table?: VueTableBJ & VueTableRoulette };
      if (r.ok && r.table) return allerTable({ jeu: p.ecran, v: r.table } as TableActive);
      setInfo(r.erreur ?? tr('Cette table est fermée.', 'This table is closed.'));
      window.setTimeout(() => setInfo(null), 4000);
      return;
    }
    setEcran(p.ecran === 'machine' ? 'machine' : p.ecran === 'nuits' ? 'nuits' : p.ecran === 'folleNuit' ? 'folleNuit' : p.ecran === 'coffres' ? 'festin' : p.ecran === 'couronne' ? 'couronne' : p.ecran === 'chute' ? 'chute' : p.ecran === 'course' ? 'course' : p.ecran === 'baronWheel' ? 'baronWheel' : p.ecran === 'tickets' ? 'tickets' : 'salon');
  };

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
    setEtageActif('tables');
    setEcran('salon');
    await appel(`${EVT_TABLE[jeu]}_quitter`);
    const r = (await appel('casino_vue')) as { ok: boolean; casino?: VueCasino };
    if (r.ok && r.casino) setVue(r.casino);
  };
  const recupererCadeau = async () => {
    const r = (await appel('casino_cadeau')) as { ok: boolean; erreur?: string; cadeau?: number; casino?: VueCasino };
    if (r.casino) setVue(r.casino);
    if (!r.ok || !r.casino) {
      if (r.erreur) {
        setInfo(r.erreur);
        window.setTimeout(() => setInfo(null), 4000);
      }
      return;
    }
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
  else if (ecran === 'machines') contenu = <ChoixMachines vue={vue} onMachine={setEcran} onRetour={() => retourEtage('machine')} />;
  else if (ecran === 'machine') contenu = <Machine vue={vue} appel={appel} onVue={setVue} onRetour={() => setEcran('machines')} />;
  else if (ecran === 'nuits') contenu = <MachineNuits vue={vue} appel={appel} onVue={setVue} onRetour={() => setEcran('machines')} />;
  else if (ecran === 'table' && table?.jeu === 'blackjack') contenu = <TableBlackjack v={table.v} appel={appel} onQuitter={() => void quitterTable()} />;
  else if (ecran === 'table' && table?.jeu === 'roulette') contenu = <TableRoulette v={table.v} appel={appel} onQuitter={() => void quitterTable()} />;
  else if (ecran === 'festin')
    contenu = (
      <JeuFestin
        vue={vue}
        appel={appel}
        onVue={setVue}
        onRetour={() => retourEtage('coffres')}
      />
    );
  else if (ecran === 'couronne')
    contenu = (
      <JeuCouronne
        vue={vue}
        appel={appel}
        onVue={setVue}
        onRetour={() => retourEtage('couronne')}
      />
    );
  else if (ecran === 'chute') contenu = <JeuChute vue={vue} appel={appel} onVue={setVue} onRetour={() => retourEtage('chute')} />;
  else if (ecran === 'tickets') contenu = <JeuTickets vue={vue} appel={appel} onVue={setVue} onRetour={() => retourEtage('tickets')} />;
  else if (ecran === 'course') contenu = <JeuCourse vue={vue} appel={appel} onRetour={() => retourEtage('course')} />;
  else if (ecran === 'baronWheel') contenu = <JeuBaronWheel vue={vue} appel={appel} onRetour={() => retourEtage('baronWheel')} />;
  else if (ecran === 'profil')
    contenu = (
      <EcranProfil
        key={profilUid ?? 'moi'}
        uid={profilUid}
        appel={appel}
        vue={vue}
        onVue={setVue}
        onRetour={() => (profilUid ? setEcran('amis') : retourSalon())}
        onRejoindre={(p) => void rejoindre(p)}
        onDefier={(uid) => ouvrirDefis(uid)}
        onBureau={(uid) => ouvrirBureau(uid === moi ? null : uid)}
      />
    );
  else if (ecran === 'amis')
    contenu = <EcranAmis appel={appel} vue={vue} onVue={setVue} onRetour={retourSalon} onProfil={(uid) => ouvrirProfil(uid)} onRejoindre={(p) => void rejoindre(p)} onDefier={(uid) => ouvrirDefis(uid)} />;
  else if (ecran === 'contrats') contenu = <EcranContrats vue={vue} appel={appel} onVue={setVue} onRetour={retourSalon} />;
  else if (ecran === 'album') contenu = <EcranAlbum vue={vue} onRetour={retourSalon} />;
  else if (ecran === 'cercles') contenu = <EcranCercles vue={vue} appel={appel} moi={moi} onVue={setVue} onRetour={retourSalon} />;
  else if (ecran === 'tailleur') contenu = <EcranTailleur vue={vue} appel={appel} onVue={setVue} onRetour={retourSalon} />;
  else if (ecran === 'marche') contenu = <EcranMarche vue={vue} appel={appel} onVue={setVue} onRetour={retourSalon} />;
  else if (ecran === 'bourse') contenu = <EcranBourse vue={vue} appel={appel} onVue={setVue} onRetour={retourSalon} />;
  else if (ecran === 'ventes') contenu = <EcranVentes vue={vue} appel={appel} moi={moi} onVue={setVue} onRetour={retourSalon} onBureau={() => ouvrirBureau(null)} />;
  else if (ecran === 'bureau')
    contenu = <EcranBureau key={bureauUid ?? 'moi'} uid={bureauUid} appel={appel} onRetour={retourSalon} onVentes={() => setEcran('ventes')} onProfil={(uid) => ouvrirProfil(uid === moi ? null : uid)} />;
  else if (ecran === 'defis') contenu = <EcranDefis appel={appel} vue={vue} moi={moi} defis={defis} cible={cibleDefi} onDefis={setDefis} onVue={setVue} onRetour={retourSalon} />;
  else if (ecran === 'folleNuit')
    contenu = (
      <ShowFolleNuit
        appel={appel}
        onRetour={() => retourEtage('folleNuit')}
      />
    );
  else
    contenu = (
      <Accueil
        vue={vue}
        appel={appel}
        onVue={setVue}
        etageActif={etageActif}
        onEtage={ouvrirEtage}
        onVignette={(j) => (j === 'blackjack' || j === 'roulette' ? setFenetreTables(j) : j !== 'poker' && setEcran(j))}
        onFolleNuit={() => setEcran('folleNuit')}
        onBaronWheel={() => setEcran('baronWheel')}
        onAffiche={ouvrirJeu}
        onRafraichir={rafraichirVue}
        onCadeau={() => void recupererCadeau()}
        onCadeauFini={rafraichirVue}
        onRoue={() => setRoue(true)}
        onSemaine={() => setSemaineOuverte(true)}
        onContrats={() => setEcran('contrats')}
        onAlbum={() => setEcran('album')}
        onVentes={() => setEcran('ventes')}
        onBureau={() => ouvrirBureau(null)}
        onAmis={() => setEcran('amis')}
        onDefis={() => ouvrirDefis()}
        onProfil={() => ouvrirProfil(null)}
        onQuitter={() => onQuitter()}
        onCercles={() => setEcran('cercles')}
        onBourse={() => setEcran('bourse')}
        onVip={(j) => (setTablesVip(true), setFenetreTables(j))}
        onMarche={() => setEcran('marche')}
        onTailleur={() => setEcran('tailleur')}
      />
    );
  // Premier lancement d'un jeu dans la visite : son écran de chargement (images, musique, sons), puis le jeu.
  const jeuACharger: JeuACharger | null =
    ecran === 'table' && table
      ? table.jeu
      : ecran === 'machine' || ecran === 'nuits' || ecran === 'folleNuit' || ecran === 'festin' || ecran === 'couronne' || ecran === 'chute' || ecran === 'course' || ecran === 'baronWheel' || ecran === 'tickets'
        ? ecran
        : null;
  if (vue && jeuACharger) contenu = <ChargementJeu key={jeuACharger} jeu={jeuACharger}>{contenu}</ChargementJeu>;
  return (
    <div className="cas">
      <Garde key={ecran} onRetour={retourSalon} libelleRetour={tr('Retour au salon', 'Back to the lounge')}>
        {contenu}
      </Garde>
      {fenetreTables && vue && <FenetreTables key={`${fenetreTables}-${tablesVip}`} jeu={fenetreTables} vip={tablesVip} vue={vue} appel={appel} onTable={allerTable} onVue={setVue} onFermer={() => (setFenetreTables(null), setTablesVip(false))} />}
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
      {defiActif && ecran !== 'defis' && <PuceDefi d={defiActif} moi={moi} onOuvrir={() => ouvrirDefis()} />}
      {vue?.affiche && position === vue.affiche.jeu && <PuceAffiche affiche={vue.affiche} defi={!!defiActif && ecran !== 'defis'} onFin={rafraichirVue} />}
      {toastSocial && (
        <button type="button" key={toastSocial.id} className="toast cs-toast" onClick={() => (setToastSocial(null), toastSocial.vers === 'amis' ? setEcran('amis') : ouvrirDefis())}>
          {toastSocial.texte}
        </button>
      )}
      {etageFerme && vue && <EtageFerme id={etageFerme} niveau={niveauHotel} onFermer={() => setEtageFerme(null)} />}
      {semaineOuverte && vue && <FenetreSemaine vue={vue} appel={appel} onVue={setVue} onFermer={() => setSemaineOuverte(false)} />}
      {vue && ecran === 'salon' && <AccueilGroom />}
      <AnnoncesHotel onAnnonce={rafraichirVue} />
      <AnnoncesVentes
        onAnnonce={rafraichirVue}
        onOuvrir={(e) => {
          if (ecran === 'salon' || ecran === 'ventes' || ecran === 'bureau' || ecran === 'contrats' || ecran === 'album') (e === 'bureau' ? ouvrirBureau(null) : setEcran(e));
        }}
      />
      <AnnoncesContrats
        onAnnonce={rafraichirVue}
        onOuvrir={(e) => {
          // Depuis un jeu, l'annonce se ferme seulement (on ne quitte pas une partie en cours).
          if (ecran === 'salon' || ecran === 'contrats' || ecran === 'album') setEcran(e);
        }}
      />
      {bienvenue && <CadeauBienvenue cadeau={bienvenue} onFermer={() => setBienvenue(null)} />}
      {fete && vue && <CelebrationNiveau key={fete.id} fete={fete} avatar={vue.avatar} onFermer={() => setFete(null)} />}
    </div>
  );
}
