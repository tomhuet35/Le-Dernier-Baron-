/**
 * Deuxième machine à sous du Salon privé : « Les Nuits du Baron » (machine bleu nuit, 243 façons de gagner).
 *
 * Avant l'arrêt des rouleaux, une carte Événement du jeu peut se retourner au centre de l'écran : Descente de police,
 * Casse du siècle, Trahison, Alliance ou Couvre-feu. Les rouleaux s'arrêtent sur la grille « avant » l'événement,
 * l'événement se joue (menottes, butin, cartes mystère, poignée de main, lune), puis la Couronne remplit les 3 cases
 * de son rouleau et les gains s'affichent. 6 Jetons du Baron lancent le bonus Jetons du Baron : les Jetons restent
 * collés, 3 relances, et les jackpots MINI, MINOR, MAJOR et GRAND. Le serveur tire tout ; cet écran ne fait que
 * jouer les animations.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { VueCasino } from '../../shared/casino';
import { MISES_MACHINE } from '../../shared/machineASous';
import {
  BANDES_NUIT,
  FREE_GAMES_NUIT,
  GAIN_JUGES_NUIT,
  GAINS_NUIT,
  JACKPOTS_NUIT,
  JETONS_POUR_BONUS,
  meilleurJackpot,
  PAYANTS_NUIT,
  PIECES_NUIT,
  RELANCES_JETONS,
  type BonusJetons,
  type JackpotNuit,
  type ResultatNuit,
  type SymboleNuit,
  type TypeEvenementNuit,
  type ValeurJeton,
} from '../../shared/machineNuits';
import type { Appel } from './App';
import { dollars, GainDefilant, Jeton, LINGOTS_PALIER, OptionsMachine, palierDe, PluieLingots, useSoldeAnime, useToursAuto } from './casinoOutils';
import { EN, tr } from './traduction';
import { Celebration, Fenetre, jouerEffet, mouvementReduit, type EffetSonore } from './ui';

type TourNuit = ResultatNuit & { mise: number; gratuit: boolean };
/** Une case affichée : son symbole, et ce que porte le Jeton du Baron s'il y en a un. */
type Cellule = { s: SymboleNuit; v?: ValeurJeton };

/** Les cartes Événement du jeu, leur nom, ce qu'elles font, et leur son. */
const EVENEMENTS: Record<TypeEvenementNuit, { carte: string; nom: [string, string]; texte: [string, string]; son: EffetSonore }> = {
  police: { carte: 'evenement_descente_police', nom: ['Descente de police !', 'Police raid!'], texte: ['Un rouleau devient joker, figé pour 3 tours.', 'A reel turns wild, locked for 3 spins.'], son: 'police' },
  casse: { carte: 'evenement_casse_du_siecle', nom: ['Le casse du siècle !', 'Heist of the century!'], texte: ['Une Couronne multiplicatrice remplit un rouleau.', 'A multiplier Crown fills a reel.'], son: 'casse' },
  trahison: { carte: 'evenement_trahison', nom: ['Trahison !', 'Betrayal!'], texte: ['Les cartes mystère se retournent toutes sur le même symbole.', 'Mystery cards all turn into the same symbol.'], son: 'evt_trahison' },
  alliance: { carte: 'evenement_alliance', nom: ['Alliance !', 'Alliance!'], texte: ['Deux rouleaux voisins se soudent.', 'Two neighbouring reels join forces.'], son: 'evt_alliance' },
  couvreFeu: { carte: 'evenement_couvre_feu', nom: ['Couvre-feu !', 'Curfew!'], texte: ['Les petits symboles s’éteignent sur les trois premiers rouleaux.', 'Low symbols vanish from the first three reels.'], son: 'couvre_feu' },
};
const NOMS_JACKPOTS: Record<JackpotNuit, string> = { mini: 'MINI', minor: 'MINOR', major: 'MAJOR', grand: 'GRAND' };

/** Les petits symboles : des lettres Art déco dessinées en code. */
const LETTRES: Partial<Record<SymboleNuit, { fr: string; en: string; couleur: string }>> = {
  as: { fr: 'A', en: 'A', couleur: '#c0281c' },
  roi: { fr: 'R', en: 'K', couleur: '#2f6bff' },
  dame: { fr: 'D', en: 'Q', couleur: '#9a4fd6' },
};
const NOMS: Record<SymboleNuit, [string, string]> = {
  chat: ['Chat noir', 'Black cat'],
  chapeau: ['Haut-de-forme', 'Top hat'],
  champagne: ['Champagne', 'Champagne'],
  as: ['As', 'Ace'],
  roi: ['Roi', 'King'],
  dame: ['Dame', 'Queen'],
  couronne: ['Couronne', 'Crown'],
  juge: ['Juge', 'Judge'],
  mystere: ['Carte mystère', 'Mystery card'],
  jeton: ['Jeton du Baron', 'Baron’s Token'],
};

/** Montant court pour un Jeton ou un jackpot : 500, 25 k, 1,25 M. */
function court(n: number): string {
  const f = (x: number, d: number) => x.toLocaleString(EN ? 'en-US' : 'fr-FR', { maximumFractionDigits: d });
  if (n >= 1_000_000) return `${f(n / 1_000_000, 2)} M`;
  if (n >= 1000) return `${f(n / 1000, 1)} k`;
  return String(Math.round(n));
}
const courtDollars = (n: number) => (EN ? `$${court(n)}` : `${court(n)} $`);

/** Le Jeton du Baron (image) : sa somme écrite dessus, ou le jeton MINI, MINOR ou MAJOR. */
function JetonNuit({ v, mise }: { v?: ValeurJeton; mise: number }) {
  const jp = v?.jackpot;
  const nom = v ? `${tr(...NOMS.jeton)} : ${jp ? NOMS_JACKPOTS[jp] : dollars(Math.round(v.x * mise))}` : tr(...NOMS.jeton);
  if (jp) return <img className={`cas-symbole nu-jeton ${jp}`} src={`/cartes/nuits-jeton-${jp}.webp`} alt={nom} draggable={false} />;
  const texte = v ? court(v.x * mise) : '';
  return (
    <svg className="cas-symbole nu-jeton" viewBox="0 0 100 100" role="img" aria-label={nom}>
      <image href="/cartes/nuits-jeton.webp" x="0" y="0" width="100" height="100" />
      {texte && (
        <text x="50" y="45" className="nu-jeton-texte" style={{ fontSize: texte.length > 5 ? 16 : texte.length > 4 ? 18 : 22 }}>
          {texte}
        </text>
      )}
      {v && (
        <text x="50" y="65" className="nu-jeton-dollar">
          $
        </text>
      )}
    </svg>
  );
}

/** La plaque d'un jackpot (image). */
function PlaqueJackpot({ j, className }: { j: JackpotNuit; className?: string }) {
  return <img className={`nu-plaque-jackpot ${j} ${className ?? ''}`} src={`/cartes/nuits-${j}.webp`} alt={NOMS_JACKPOTS[j]} draggable={false} />;
}

function SymboleNuitImage({ s }: { s: SymboleNuit }) {
  const l = LETTRES[s];
  if (l)
    return (
      <svg className="cas-symbole nu-lettre" viewBox="0 0 100 100" role="img" aria-label={tr(...NOMS[s])}>
        <defs>
          <linearGradient id={`nu-l-${s}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff6dc" />
            <stop offset="0.5" stopColor={l.couleur} />
            <stop offset="1" stopColor="#150c22" />
          </linearGradient>
        </defs>
        <text x="50" y="54" fill={`url(#nu-l-${s})`} style={{ fontSize: l.fr.length > 1 ? 54 : 72 }}>
          {EN ? l.en : l.fr}
        </text>
      </svg>
    );
  const src = s === 'champagne' ? '/cartes/machine-champagne.webp' : s === 'couronne' ? '/cartes/machine-couronne.webp' : `/cartes/machine2-${s}.webp`;
  return <img className="cas-symbole" src={src} alt={tr(...NOMS[s])} draggable={false} />;
}

function CaseSymbole({ c, mise }: { c: Cellule; mise: number }) {
  return c.s === 'jeton' ? <JetonNuit v={c.v} mise={mise} /> : <SymboleNuitImage s={c.s} />;
}

/** Ampoules bleues de l'arche, en % de l'image du haut de la machine. */
const AMPOULES: [number, number][] = [
  [25.0, 25.33], [25.68, 21.66], [26.76, 18.46], [28.12, 15.73], [29.69, 13.18], [31.64, 10.73], [34.18, 8.47], [36.91, 6.59], [39.94, 5.08], [43.16, 3.95], [46.48, 3.39], [49.8, 3.11],
  [53.22, 3.3], [56.54, 3.95], [59.67, 5.08], [62.7, 6.59], [65.43, 8.57], [67.87, 10.73], [69.92, 13.18], [71.58, 15.73], [72.95, 18.46], [74.02, 21.66], [74.71, 25.33],
];
const ARRET_PREMIER = 1100;
const ECART_ARRETS = 320;
/** La carte Événement se retourne pendant que les rouleaux tournent : ils s'arrêtent après elle. */
const DUREE_CARTE = 2100;
const EXTRA_SUSPENSE = 1300;
const CASES_PAR_SECONDE = 13;
/** Ce que portent les Jetons qui défilent (pour le décor : le serveur a déjà tiré les vrais). */
const VALEURS_DECOR: ValeurJeton[] = [{ x: 1 }, { x: 2 }, { x: 0.5 }, { x: 3 }, { x: 1 }, { x: 5 }, { x: JACKPOTS_NUIT.mini, jackpot: 'mini' }, { x: 2 }, { x: 0.5 }, { x: JACKPOTS_NUIT.minor, jackpot: 'minor' }];
const decor = (r: number, k: number) => VALEURS_DECOR[(r * 7 + k * 3) % VALEURS_DECOR.length];

function TableNuits({ mise, onFermer }: { mise: number; onFermer: () => void }) {
  const piece = mise / PIECES_NUIT;
  return (
    <Fenetre titre={tr('Les Nuits du Baron', 'The Baron’s Nights')} onFermer={onFermer}>
      <p className="discret">{tr(`243 façons de gagner : un symbole sur des rouleaux qui se suivent depuis la gauche, à n’importe quelle hauteur. Gains pour une façon, à ${dollars(mise)} de mise :`, `243 ways to win: a symbol on adjacent reels from the left, at any height. Wins for one way, at a ${dollars(mise)} bet:`)}</p>
      <table className="cas-gains nu-gains">
        <thead>
          <tr>
            <th />
            <th>×3</th>
            <th>×4</th>
            <th>×5</th>
          </tr>
        </thead>
        <tbody>
          {PAYANTS_NUIT.map((s) => (
            <tr key={s}>
              <td>
                <span className="nu-gains-symbole">
                  <SymboleNuitImage s={s} />
                </span>
                <span>{tr(...NOMS[s])}</span>
              </td>
              {GAINS_NUIT[s].map((g, k) => (
                <td key={k}>{dollars(Math.round(g * piece))}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="cas-gains-note">
        <img className="cas-symbole" src="/cartes/machine-couronne.webp" alt="" />
        {tr('La Couronne (rouleaux 2 à 4) remplit les 3 cases de son rouleau : il devient joker.', 'The Crown (reels 2 to 4) fills the 3 cells of its reel: it turns wild.')}
      </p>
      <p className="cas-gains-note">
        <img className="cas-symbole" src="/cartes/machine2-juge.webp" alt="" />
        {tr(`3 Juges : ${GAIN_JUGES_NUIT} fois la mise et ${FREE_GAMES_NUIT} free games, avec un événement à chaque tour. 3 nouveaux Juges en rajoutent ${FREE_GAMES_NUIT}.`, `3 Judges: ${GAIN_JUGES_NUIT} times the bet and ${FREE_GAMES_NUIT} free games, with an event on every spin. 3 new Judges add ${FREE_GAMES_NUIT} more.`)}
      </p>
      <h3 className="cas-gains-titre">{tr('Les Jetons du Baron et les jackpots', 'The Baron’s Tokens and the jackpots')}</h3>
      <p className="cas-gains-note">
        <span className="nu-gains-jeton">
          <JetonNuit v={{ x: 2 }} mise={mise} />
        </span>
        <span>
          {tr(
            `Chaque Jeton porte une somme ou un jackpot. ${JETONS_POUR_BONUS} Jetons lancent le bonus : les Jetons restent collés et tu as ${RELANCES_JETONS} relances, remises à ${RELANCES_JETONS} à chaque nouveau Jeton. À la fin, tous les Jetons paient. Les 15 cases remplies : le GRAND !`,
            `Each Token carries an amount or a jackpot. ${JETONS_POUR_BONUS} Tokens start the bonus: they stick and you get ${RELANCES_JETONS} respins, reset to ${RELANCES_JETONS} with every new Token. At the end, every Token pays. All 15 cells filled: the GRAND!`,
          )}
        </span>
      </p>
      <div className="nu-gains-jackpots">
        {(['grand', 'major', 'minor', 'mini'] as JackpotNuit[]).map((j) => (
          <span key={j} className={`nu-gains-jackpot ${j}`}>
            <PlaqueJackpot j={j} />
            <span>
              <strong>{dollars(JACKPOTS_NUIT[j] * mise)}</strong>
              <small>{tr(`${JACKPOTS_NUIT[j]} fois la mise`, `${JACKPOTS_NUIT[j]} times the bet`)}</small>
            </span>
          </span>
        ))}
      </div>
      <h3 className="cas-gains-titre">{tr('Les événements', 'The events')}</h3>
      {(Object.keys(EVENEMENTS) as TypeEvenementNuit[]).map((e) => (
        <p key={e} className="cas-gains-note">
          <img className="nu-gains-carte" src={`/cartes/${EVENEMENTS[e].carte}.webp`} alt="" />
          <span>
            <strong>{tr(...EVENEMENTS[e].nom)}</strong> {tr(...EVENEMENTS[e].texte)}
            {e === 'casse' && tr(' (×2 ou ×3)', ' (×2 or ×3)')}
            {e === 'police' && tr(' La mise ne change pas pendant ces tours (en free games, la police ne fige que le tour en cours).', ' The bet stays the same during these spins (in free games, the police only locks the current spin).')}
          </span>
        </p>
      ))}
      <p className="cas-gains-note discret">{tr('Un événement tombe environ une fois tous les 15 tours. Environ un tour sur deux paie.', 'An event happens about once every 15 spins. About one spin in two pays.')}</p>
    </Fenetre>
  );
}

function RouleauNuit({
  index,
  cellules,
  defile,
  duree,
  gagnantes,
  retournees,
  suspense,
  sauvage,
  gagne,
  multiple,
  menottes,
  mise,
}: {
  index: number;
  cellules: Cellule[];
  defile: boolean;
  duree: number;
  gagnantes: Set<number>;
  retournees: Set<number>;
  suspense: boolean;
  /** Rouleau joker : la Couronne remplit ses 3 cases. */
  sauvage: boolean;
  gagne: boolean;
  multiple?: number;
  menottes: boolean;
  mise: number;
}) {
  const decalage = cellules.length - 3;
  const couronnes = sauvage && !defile;
  return (
    <div className={`cas-rouleau ${suspense ? 'suspense sus-2 sus-coffre' : ''} ${couronnes ? 'sauvage' : ''}`}>
      <div
        className="cas-bande"
        style={{
          transform: `translateY(calc(var(--case) * ${defile ? -decalage : 0}))`,
          transitionDuration: defile ? `${duree}ms` : '0ms',
          ...(suspense ? { transitionTimingFunction: 'cubic-bezier(0.1, 0.62, 0.18, 1)' } : {}),
        }}
      >
        {couronnes
          ? [0, 1, 2].map((k) => (
              <div key={`couronne-${k}`} className={`cas-case nu-case-couronne ${gagne ? 'gagnante' : ''}`} style={{ '--rang': k } as CSSProperties}>
                <img className="cas-symbole" src="/cartes/machine-couronne.webp" alt={tr('Couronne', 'Crown')} draggable={false} />
              </div>
            ))
          : cellules.map((c, k) => {
              const n = index * 3 + k;
              return (
                <div key={`${k}-${retournees.has(n) ? c.s : ''}`} className={`cas-case ${!defile && gagnantes.has(n) ? 'gagnante' : ''} ${!defile && retournees.has(n) && k < 3 ? 'nu-retourne' : ''}`}>
                  <CaseSymbole c={c} mise={mise} />
                </div>
              );
            })}
      </div>
      {couronnes && multiple ? <strong className="nu-multiple">×{multiple}</strong> : null}
      {couronnes && menottes ? <img className="nu-menottes" src="/cartes/evt-menottes.webp" alt="" draggable={false} /> : null}
    </div>
  );
}

/** Le bonus Jetons du Baron en cours : les Jetons collés, les relances, puis le compte des Jetons un à un. */
interface EtatBonus {
  mise: number;
  valeurs: Record<number, ValeurJeton>;
  nouvelles: number[];
  restantes: number;
  roule: boolean;
  grand: boolean;
  /** Jetons déjà comptés, celui qu'on compte, et le total compté. */
  comptes: number[];
  compte: number | null;
  total: number;
}

type FeteNuit =
  | { type: 'gain'; gain: number; colossal: boolean }
  | { type: 'free'; n: number; relance: boolean; mise: number }
  | { type: 'finFree'; total: number }
  | { type: 'jetons'; gain: number; jackpot: JackpotNuit | null; mise: number };

export function MachineNuits({ vue, appel, onVue, onRetour }: { vue: VueCasino; appel: Appel; onVue: (v: VueCasino) => void; onRetour: () => void }) {
  const [mise, setMise] = useState(() => {
    const m = MISES_MACHINE.filter((x) => x <= Math.max(MISES_MACHINE[0], vue.solde / 20));
    return m[m.length - 1] ?? MISES_MACHINE[0];
  });
  const [grille, setGrille] = useState<SymboleNuit[][]>(() => BANDES_NUIT.map((b, r) => [0, 1, 2].map((k) => b[(r * 5 + k) % b.length])));
  const [valeurs, setValeurs] = useState<Record<number, ValeurJeton>>(() => Object.fromEntries(Array.from({ length: 15 }, (_, c) => [c, decor(Math.floor(c / 3), c % 3)])));
  const [valeursFin, setValeursFin] = useState<Record<number, ValeurJeton>>({});
  const [miseJetons, setMiseJetons] = useState(mise);
  const [bandes, setBandes] = useState<SymboleNuit[][] | null>(null);
  const [defile, setDefile] = useState(false);
  const [durees, setDurees] = useState<number[]>([1100, 1420, 1740, 2060, 2380]);
  const [enCours, setEnCours] = useState(false);
  const [carte, setCarte] = useState<TypeEvenementNuit | null>(null);
  const [effet, setEffet] = useState<ResultatNuit['evenement']>(null);
  const [sauvages, setSauvages] = useState<number[]>(() => vue.nuits.collantes?.rouleaux ?? []);
  const [multiples, setMultiples] = useState<Record<number, number>>({});
  const [retournees, setRetournees] = useState<Set<number>>(new Set());
  const [suspense, setSuspense] = useState<{ rouleau: number; texte: string } | null>(null);
  const [tour, setTour] = useState<TourNuit | null>(null);
  const [gainAffiche, setGainAffiche] = useState(0);
  const [bonus, setBonus] = useState<EtatBonus | null>(null);
  const [soldeAffiche, setSoldeAffiche] = useState(vue.solde);
  const [fetes, setFetes] = useState<FeteNuit[]>([]);
  const [pluie, setPluie] = useState<{ n: number; id: number } | null>(null);
  const [banniere, setBanniere] = useState<{ texte: string; id: number; classe?: string; jackpot?: JackpotNuit; montant?: number } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [gains, setGains] = useState(false);
  const totalFree = useRef(0);
  const minuteries = useRef<number[]>([]);
  const plusTard = (f: () => void, ms: number) => minuteries.current.push(window.setTimeout(f, ms));
  /** Délai avant le tour automatique suivant (selon le dernier gain), et l'arrêt des tours automatiques. */
  const delaiAuto = useRef(150);
  const arreterAuto = useRef(() => {});
  const vueRef = useRef(vue);
  vueRef.current = vue;
  useEffect(() => () => minuteries.current.forEach((t) => window.clearTimeout(t)), []);
  useEffect(() => {
    if (!enCours) setSoldeAffiche(vue.solde);
  }, [vue.solde, enCours]);
  const solde = useSoldeAnime(soldeAffiche);
  const n = vue.nuits;
  const gratuits = n.gratuits;
  const miseBloquee = gratuits > 0 ? n.miseGratuite : (n.collantes?.mise ?? null);
  const miseTour = miseBloquee ?? mise;
  const peutJouer = !enCours && (gratuits > 0 || vue.solde >= miseTour);

  const lancer = useCallback(async () => {
    if (enCours) return;
    setErreur(null);
    jouerEffet('machine_levier');
    setEnCours(true);
    const figes = vueRef.current.nuits.collantes?.rouleaux ?? [];
    const r = (await appel('casino_nuits', { mise })) as { ok: boolean; erreur?: string; nuits?: TourNuit; casino?: VueCasino };
    if (!r.ok || !r.nuits || !r.casino) {
      setEnCours(false);
      arreterAuto.current();
      setErreur(r.erreur ?? tr('La machine est indisponible.', 'The machine is unavailable.'));
      return;
    }
    const m = r.nuits;
    const nouvelle = r.casino;
    const b = m.bonusJetons;
    const gainLignes = m.gain - (b?.gain ?? 0);
    if (!m.gratuit) setSoldeAffiche((s) => s - m.mise);
    setTour(null);
    setPluie(null);
    setBanniere(null);
    setEffet(null);
    setBonus(null);
    setRetournees(new Set());
    setMultiples({});
    setSauvages(figes);
    setMiseJetons(m.mise);
    const reduit = mouvementReduit();
    const evt = m.evenement;

    // La fin du tour : fêtes (gros gain, Jetons, free games), lingots, solde, et le tour automatique suivant.
    const terminer = () => {
      setBonus(null);
      setEnCours(false);
      setGainAffiche(m.gain);
      onVue(nouvelle);
      setSoldeAffiche(nouvelle.solde);
      const palier = palierDe(m.gain, m.mise);
      const file: FeteNuit[] = [];
      if (b) file.push({ type: 'jetons', gain: b.gain, jackpot: meilleurJackpot(b), mise: m.mise });
      else if (palier === 'enorme' || palier === 'colossal') file.push({ type: 'gain', gain: m.gain, colossal: palier === 'colossal' });
      if (b) jouerEffet(palier === 'enorme' || palier === 'colossal' ? 'roulette_gros_lot' : 'roulette_gain');
      if (LINGOTS_PALIER[palier] && !reduit) {
        setPluie({ n: LINGOTS_PALIER[palier], id: Date.now() });
        plusTard(() => jouerEffet('lingots_pluie'), 250);
        plusTard(() => setPluie(null), 3600);
      }
      if (m.gratuit) totalFree.current += m.gain;
      else totalFree.current = 0;
      if (m.freeGames) file.push({ type: 'free', n: m.freeGames, relance: m.gratuit, mise: m.mise });
      else if (m.gratuit && nouvelle.nuits.gratuits === 0) {
        if (totalFree.current > 0) file.push({ type: 'finFree', total: totalFree.current });
        totalFree.current = 0;
      }
      if (file.length) setFetes((f) => [...f, ...file]);
      delaiAuto.current = file.length ? 900 : palier === 'gros' ? 2800 : palier === 'joli' ? 1900 : m.gain > 0 ? 1200 : 500;
    };

    // Le bonus Jetons du Baron, rejoué relance par relance, puis le compte des Jetons.
    const jouerBonus = (bj: BonusJetons) => {
      setSoldeAffiche(nouvelle.solde - bj.gain);
      setBanniere({ texte: tr('Jetons du Baron !', 'Baron’s Tokens!'), id: Date.now(), classe: 'jetons' });
      jouerEffet('revelation');
      setBonus({ mise: m.mise, valeurs: { ...bj.depart }, nouvelles: Object.keys(bj.depart).map(Number), restantes: RELANCES_JETONS, roule: false, grand: false, comptes: [], compte: null, total: 0 });
      let t = 1900;
      for (const rel of bj.relances) {
        const nv = Object.keys(rel.nouvelles).map(Number);
        plusTard(() => {
          setBonus((x) => x && { ...x, roule: true, nouvelles: [] });
          jouerEffet('roulette_tic');
        }, t);
        plusTard(() => {
          setBonus((x) => x && { ...x, roule: false, valeurs: { ...x.valeurs, ...rel.nouvelles }, nouvelles: nv, restantes: rel.restantes });
          jouerEffet(nv.length ? 'jeton' : 'machine_arret');
          if (nv.some((c) => rel.nouvelles[c].jackpot)) jouerEffet('roulette_gain');
        }, t + 620);
        t += nv.length ? 1250 : 1000;
      }
      if (bj.grand) {
        plusTard(() => {
          setBonus((x) => x && { ...x, grand: true });
          setBanniere({ texte: 'GRAND !', id: Date.now(), classe: 'grand', jackpot: 'grand', montant: JACKPOTS_NUIT.grand * m.mise });
          jouerEffet('roulette_gros_lot');
        }, t + 200);
        t += 2600;
      }
      // Le compte : chaque Jeton s'allume et s'ajoute au total, les jackpots ont leur bannière.
      t += 500;
      let total = 0;
      for (const c of Object.keys(bj.valeurs).map(Number).sort((a, z) => a - z)) {
        const v = bj.valeurs[c];
        total += v.x * m.mise;
        const somme = Math.round(total);
        plusTard(() => {
          setBonus((x) => x && { ...x, compte: c, comptes: [...x.comptes, c], total: somme });
          jouerEffet(v.jackpot ? 'roulette_gain' : 'jeton');
          if (v.jackpot) setBanniere({ texte: `${NOMS_JACKPOTS[v.jackpot]} !`, id: Date.now() + c, classe: v.jackpot, jackpot: v.jackpot, montant: v.x * m.mise });
        }, t);
        t += v.jackpot ? 1200 : 240;
      }
      plusTard(() => setBonus((x) => x && { ...x, compte: null, total: bj.gain }), t);
      plusTard(() => {
        setBanniere(null);
        terminer();
      }, t + 1100);
    };

    // Après l'arrêt et l'événement : les Couronnes remplissent leurs rouleaux, puis les gains des lignes.
    const montrerLignes = () => {
      setTour(m);
      setEffet(null);
      setGainAffiche(gainLignes);
      const palier = palierDe(gainLignes, m.mise);
      if (palier === 'gros') {
        setBanniere({ texte: tr('Gros gain !', 'Big win!'), id: Date.now() });
        jouerEffet('roulette_gain');
      } else if (palier === 'enorme' || palier === 'colossal') jouerEffet('roulette_gros_lot');
      else if (palier === 'joli') jouerEffet('roulette_gain');
      else if (palier === 'petit') jouerEffet('machine_pieces');
      if (b && !reduit) plusTard(() => jouerBonus(b), gainLignes > 0 || m.freeGames ? 1600 : 700);
      else terminer();
    };
    const apresArret = () => {
      setDefile(false);
      setBandes(null);
      setSuspense(null);
      setGrille(m.avant);
      setValeurs(m.jetonsAvant);
      if (m.juges >= 3) jouerEffet('juge');
      if (!evt) {
        const nouvelles = m.sauvages.filter((x) => !figes.includes(x));
        setSauvages(m.sauvages);
        if (nouvelles.length && !reduit) {
          jouerEffet('roulette_tic');
          plusTard(montrerLignes, 700);
        } else montrerLignes();
        return;
      }
      // L'événement : son effet, puis la grille transformée.
      setEffet(evt);
      const avantRevelation = reduit ? 0 : evt.type === 'couvreFeu' ? 900 : evt.type === 'trahison' ? 500 : 700;
      plusTard(() => {
        if (evt.type === 'trahison' || evt.type === 'couvreFeu') setRetournees(new Set(evt.cases));
        if (evt.type === 'alliance') setRetournees(new Set([0, 1, 2].map((k) => evt.vers * 3 + k)));
        if (evt.type === 'casse') setMultiples({ [evt.rouleau]: evt.multiple });
        if (evt.type === 'trahison' || evt.type === 'couvreFeu' || evt.type === 'alliance') jouerEffet('carte');
        setGrille(m.grille);
        setValeurs({ ...m.jetonsAvant, ...m.jetons });
        setSauvages(m.sauvages);
      }, avantRevelation);
      plusTard(montrerLignes, reduit ? 0 : avantRevelation + 1100);
    };
    if (reduit) {
      setGrille(m.grille);
      return apresArret();
    }
    // Les rouleaux : ceux que la police a figés ne tournent pas. Le dernier rouleau ralentit quand il peut
    // apporter le troisième Juge (rouleaux 1 et 3) ou le sixième Jeton du Baron.
    const jetonsVus = m.avant.slice(0, 4).reduce((t, col, k) => t + (figes.includes(k) ? 0 : col.filter((x) => x === 'jeton').length), 0);
    const susJuges = m.avant[0].includes('juge') && m.avant[2].includes('juge');
    const susJetons = jetonsVus >= JETONS_POUR_BONUS - 2 && jetonsVus < JETONS_POUR_BONUS;
    const susp = susJuges || susJetons ? 4 : null;
    const base = (evt ? DUREE_CARTE : 0) + ARRET_PREMIER;
    const t = [0, 1, 2, 3, 4].map((k) => base + k * ECART_ARRETS + (susp !== null && k >= susp ? EXTRA_SUSPENSE : 0));
    const longues = grille.map((visibles, k) => {
      if (figes.includes(k)) return m.avant[k];
      const bande = BANDES_NUIT[k];
      const passage = Array.from({ length: Math.round((t[k] / 1000) * CASES_PAR_SECONDE) }, () => bande[Math.floor(Math.random() * bande.length)]);
      return [...visibles, ...passage, ...m.avant[k]];
    });
    setDurees(t);
    setValeursFin(m.jetonsAvant);
    setBandes(longues);
    setDefile(false);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => setDefile(true)));
    if (evt) {
      plusTard(() => {
        setCarte(evt.type);
        jouerEffet('evenement');
      }, 250);
      plusTard(() => jouerEffet(EVENEMENTS[evt.type].son), 1150);
      plusTard(() => setCarte(null), 250 + DUREE_CARTE - 200);
    }
    t.forEach((d, k) =>
      plusTard(() => {
        if (!figes.includes(k)) jouerEffet('machine_arret');
        if (susp !== null && k === susp - 1) {
          setSuspense({ rouleau: susp, texte: susJuges ? tr('Un troisième Juge ?', 'A third Judge?') : tr('Le sixième Jeton ?', 'The sixth Token?') });
          jouerEffet('suspense');
        }
      }, d - 40),
    );
    plusTard(apresArret, t[4] + 120);
  }, [appel, enCours, grille, mise, onVue]);
  const fete = fetes[0] ?? null;
  const tours = useToursAuto({ pret: !enCours && !fete, gratuits, lancer: () => void lancer(), delai: () => delaiAuto.current, fete: !!fete, fermerFete: () => setFetes((f) => f.slice(1)) });
  arreterAuto.current = tours.arreter;

  // Cases gagnantes : les symboles de chaque gain sur ses rouleaux, et les Juges.
  const gagnantes = new Set<number>();
  if (tour && !bonus) {
    for (const g of tour.gains)
      for (let k = 0; k < g.longueur; k++)
        tour.grille[k].forEach((s, rang) => {
          if (s === g.symbole) gagnantes.add(k * 3 + rang);
        });
    if (tour.juges >= 3) tour.grille.forEach((col, k) => !tour.sauvages.includes(k) && col.forEach((s, rang) => s === 'juge' && gagnantes.add(k * 3 + rang)));
  }
  // Les cases de chaque rouleau, avec ce que portent les Jetons.
  const cellules = (bandes ?? grille).map((col, r) =>
    col.map((s, k): Cellule => {
      if (s !== 'jeton') return { s };
      if (!bandes || k < 3) return { s, v: valeurs[r * 3 + k] ?? decor(r, k) };
      if (k >= col.length - 3) return { s, v: valeursFin[r * 3 + k - (col.length - 3)] ?? decor(r, k) };
      return { s, v: decor(r, k) };
    }),
  );
  const palier = tour ? palierDe(gainAffiche, tour.mise) : 'aucun';
  const etatMachine = suspense !== null ? 'suspense sus-2 sus-coffre' : bonus ? 'tourne nu-bonus-actif' : enCours ? 'tourne' : tour && palier !== 'aucun' ? `gagne palier-${palier}` : '';
  const changerMise = (sens: number) => {
    const i = MISES_MACHINE.indexOf(mise);
    jouerEffet('jeton');
    setMise(MISES_MACHINE[Math.min(MISES_MACHINE.length - 1, Math.max(0, i + sens))]);
  };
  const plaque = bonus
    ? tr(`Relances : ${'●'.repeat(bonus.restantes)}${'○'.repeat(RELANCES_JETONS - bonus.restantes)}`, `Respins: ${'●'.repeat(bonus.restantes)}${'○'.repeat(RELANCES_JETONS - bonus.restantes)}`)
    : gratuits > 0
      ? tr(`Free games : ${gratuits}`, `Free games: ${gratuits}`)
      : n.collantes
        ? tr(`Police : encore ${n.collantes.restants} tour${n.collantes.restants > 1 ? 's' : ''}`, `Police: ${n.collantes.restants} more spin${n.collantes.restants > 1 ? 's' : ''}`)
        : tr('Les Nuits du Baron', 'The Baron’s Nights');
  const collantesActuelles = new Set(n.collantes?.rouleaux ?? []);
  // Les jackpots en jeu (à la mise du tour), allumés quand le bonus les a fait tomber.
  const miseJackpots = bonus?.mise ?? miseTour;
  const jackpotsAllumes = new Set<JackpotNuit>(bonus ? [...Object.values(bonus.valeurs).flatMap((v) => (v.jackpot ? [v.jackpot] : [])), ...(bonus.grand ? (['grand'] as JackpotNuit[]) : [])] : []);

  return (
    <div className="cas-ecran cas-machine-ecran nuits">
      <header className="cas-barre">
        <button type="button" className="cas-retour" onClick={onRetour} disabled={enCours} aria-label={tr('Retour aux machines', 'Back to the machines')}>
          ‹ {tr('Machines', 'Machines')}
        </button>
        <span className="cas-solde-petit" aria-label={tr('Ton solde', 'Your balance')}>
          {dollars(solde)}
        </span>
      </header>
      <div className={`cab nuits ${etatMachine} ${gratuits > 0 || tour?.gratuit ? 'gratuit' : ''} ${effet ? `nu-effet nu-fx-${effet.type}` : ''}`}>
        <div className="cab-haut">
          <img className="cab-image" src="/cartes/machine2-haut.webp" alt="" draggable={false} />
          <span className="cab-ampoules" aria-hidden="true">
            {AMPOULES.map(([x, y], i) => (
              <i key={i} style={{ left: `${x}%`, top: `${y}%`, '--i': i } as CSSProperties} />
            ))}
          </span>
          <span className="cab-lanterne gauche" aria-hidden="true" />
          <span className="cab-lanterne droite" aria-hidden="true" />
          {/* Les jackpots, à la place du titre : GRAND en grand, puis MAJOR, MINOR et MINI */}
          <div className="cab-titre nu-jackpots" aria-label={tr('Jackpots', 'Jackpots')}>
            {(['mini', 'minor', 'major', 'grand'] as JackpotNuit[]).map((j) => (
              <span key={j} className={`nu-jp ${j} ${jackpotsAllumes.has(j) ? 'allume' : ''}`}>
                <PlaqueJackpot j={j} />
                <span>{courtDollars(JACKPOTS_NUIT[j] * miseJackpots)}</span>
              </span>
            ))}
          </div>
          <p className="cab-gros-lot nu-plaque">{plaque}</p>
          <div className="cab-rouleaux">
            {cellules.map((col, k) => (
              <RouleauNuit
                key={k}
                index={k}
                cellules={col}
                defile={defile && !(sauvages.includes(k) && (bandes?.[k]?.length ?? 0) === 3)}
                duree={durees[k]}
                gagnantes={gagnantes}
                retournees={retournees}
                suspense={suspense?.rouleau === k}
                sauvage={sauvages.includes(k)}
                gagne={!!tour && !bonus && tour.gains.some((g) => g.longueur > k)}
                multiple={multiples[k]}
                menottes={collantesActuelles.has(k) || (effet?.type === 'police' && effet.rouleaux.includes(k))}
                mise={miseJetons}
              />
            ))}
            {effet?.type === 'casse' && <img className="nu-butin" src="/cartes/evt-butin.webp" alt="" draggable={false} style={{ '--k': effet.rouleau } as CSSProperties} />}
            {effet?.type === 'alliance' && <img className="nu-alliance" src="/cartes/evt-alliance.webp" alt="" draggable={false} style={{ '--k': effet.de } as CSSProperties} />}
            {effet?.type === 'couvreFeu' && (
              <>
                <span className="nu-nuit" aria-hidden="true" />
                <img className="nu-lune" src="/cartes/evt-lune.webp" alt="" draggable={false} />
              </>
            )}
            {/* Le bonus Jetons du Baron : 15 cases, les Jetons restent collés */}
            {bonus && (
              <div className={`nu-bonus ${bonus.roule ? 'roule' : ''} ${bonus.grand ? 'grand' : ''}`} aria-label={tr('Bonus Jetons du Baron', 'Baron’s Tokens bonus')}>
                {Array.from({ length: 15 }, (_, c) => {
                  const v = bonus.valeurs[c];
                  return (
                    <div key={c} className={`nu-bonus-case ${v ? 'pleine' : ''} ${bonus.nouvelles.includes(c) ? 'nouvelle' : ''} ${bonus.compte === c ? 'compte' : ''} ${bonus.comptes.includes(c) && bonus.compte !== c ? 'comptee' : ''}`}>
                      {v && <JetonNuit v={v} mise={bonus.mise} />}
                    </div>
                  );
                })}
              </div>
            )}
            {banniere?.jackpot ? (
              <div key={banniere.id} className={`nu-banniere-jackpot ${banniere.jackpot}`} role="status" aria-label={banniere.texte}>
                <PlaqueJackpot j={banniere.jackpot} />
                {banniere.montant !== undefined && <strong>{dollars(banniere.montant)}</strong>}
              </div>
            ) : (
              banniere && (
                <div key={banniere.id} className={`cab-banniere ${banniere.classe ? `nu-banniere ${banniere.classe}` : ''}`} role="status">
                  {banniere.texte}
                </div>
              )
            )}
          </div>
        </div>
        <div className="cab-bas">
          <div className="cas-resultat" role="status">
            {bonus ? (
              <>
                <strong className="nu-bonus-titre">{tr('Jetons du Baron', 'Baron’s Tokens')}</strong>
                <span className="nu-bonus-total">{bonus.comptes.length ? dollars(bonus.total) : tr(`${Object.keys(bonus.valeurs).length} Jetons sur 15`, `${Object.keys(bonus.valeurs).length} Tokens out of 15`)}</span>
              </>
            ) : tour?.bonusJetons && enCours ? (
              <>
                {gainAffiche > 0 && <GainDefilant key={`${tour.arrets.join('-')}-${gainAffiche}`} gain={gainAffiche} delai={0} duree={900} />}
                <strong className="nu-bonus-titre">{tr(`${Object.keys(tour.bonusJetons.depart).length} Jetons du Baron !`, `${Object.keys(tour.bonusJetons.depart).length} Baron’s Tokens!`)}</strong>
              </>
            ) : tour ? (
              gainAffiche > 0 || tour.freeGames ? (
                <>
                  {gainAffiche > 0 && <GainDefilant key={`${tour.arrets.join('-')}-${gainAffiche}`} gain={gainAffiche} delai={0} duree={palier === 'petit' ? 700 : palier === 'joli' ? 1300 : 2000} />}
                  {tour.freeGames > 0 && <strong className="cas-bonus-annonce">{tr(`${tour.freeGames} free games !`, `${tour.freeGames} free games!`)}</strong>}
                  {tour.bonusJetons && !enCours ? (
                    <span className="nu-lignes-gain">{tr(`Jetons du Baron : ${dollars(tour.bonusJetons.gain)}`, `Baron’s Tokens: ${dollars(tour.bonusJetons.gain)}`)}</span>
                  ) : (
                    tour.gains.length > 0 && (
                      <span className="nu-lignes-gain">
                        {tour.gains
                          .slice(0, 2)
                          .map((g) => `${g.longueur} × ${tr(...NOMS[g.symbole])}${g.voies > 1 ? ` (${g.voies} ${tr('façons', 'ways')})` : ''}${g.multiple > 1 ? ` ×${g.multiple}` : ''}`)
                          .join(' · ')}
                      </span>
                    )
                  )}
                </>
              ) : (
                <span className="discret">{tr('Pas de chance cette fois.', 'No luck this time.')}</span>
              )
            ) : effet ? (
              <strong className="cas-suspense-texte sus-coffre">{tr(...EVENEMENTS[effet.type].nom)}</strong>
            ) : suspense !== null ? (
              <strong className="cas-suspense-texte sus-coffre">{suspense.texte}</strong>
            ) : (
              <span className="discret">{tr(`${JETONS_POUR_BONUS} Jetons du Baron lancent les jackpots`, `${JETONS_POUR_BONUS} Baron’s Tokens start the jackpots`)}</span>
            )}
            {erreur && <span className="cas-erreur">{erreur}</span>}
          </div>
          {gratuits > 0 ? (
            <div className="cas-free nu-free" aria-label="Free games">
              <img src="/cartes/machine2-juge.webp" alt="" draggable={false} />
              <span>
                <strong>{tr(`${gratuits} free games`, `${gratuits} free games`)}</strong>
                <small>{tr(`Mise ${dollars(n.miseGratuite)} · un événement par tour`, `Bet ${dollars(n.miseGratuite)} · an event every spin`)}</small>
              </span>
            </div>
          ) : (
            <div className="cas-mise" aria-label={tr('Mise', 'Bet')}>
              <button type="button" onClick={() => changerMise(-1)} disabled={enCours || miseBloquee !== null || mise === MISES_MACHINE[0]} aria-label={tr('Baisser la mise', 'Lower the bet')}>
                −
              </button>
              <span className="cas-mise-valeur">
                <Jeton valeur={miseTour} />
                <span>
                  <small>{miseBloquee !== null ? tr('Mise bloquée', 'Locked bet') : tr('Mise', 'Bet')}</small>
                  <strong>{dollars(miseTour)}</strong>
                </span>
              </span>
              <button type="button" onClick={() => changerMise(1)} disabled={enCours || miseBloquee !== null || mise === MISES_MACHINE[MISES_MACHINE.length - 1]} aria-label={tr('Augmenter la mise', 'Raise the bet')}>
                +
              </button>
            </div>
          )}
          <button type="button" className={`cas-tourner ${gratuits > 0 ? 'free' : ''}`} disabled={!peutJouer} onClick={() => void lancer()}>
            <span>{bonus ? tr('Bonus…', 'Bonus…') : enCours ? tr('En jeu…', 'Spinning…') : gratuits > 0 ? 'Free game' : tr('Tourner', 'Spin')}</span>
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
          {!peutJouer && !enCours && gratuits === 0 && <p className="cas-erreur">{tr('Solde insuffisant : baisse la mise ou tourne la roulette du salon.', 'Not enough money: lower the bet or spin the lounge wheel.')}</p>}
        </div>
      </div>

      {/* La carte Événement se retourne au centre de l'écran */}
      {carte && (
        <div className={`nu-carte-evenement nu-fx-${carte}`} role="status" aria-label={tr(...EVENEMENTS[carte].nom)}>
          <div className="nu-carte">
            <img className="nu-carte-dos" src="/dos.webp" alt="" draggable={false} />
            <img className="nu-carte-face" src={`/cartes/${EVENEMENTS[carte].carte}.webp`} alt="" draggable={false} />
          </div>
          <p>
            <strong>{tr(...EVENEMENTS[carte].nom)}</strong>
            <span>{tr(...EVENEMENTS[carte].texte)}</span>
          </p>
        </div>
      )}
      {pluie && <PluieLingots key={pluie.id} n={pluie.n} />}
      {gains && <TableNuits mise={miseTour} onFermer={() => setGains(false)} />}
      {fete && (
        <Celebration
          key={fetes.length}
          titre={
            fete.type === 'jetons'
              ? fete.jackpot
                ? `${NOMS_JACKPOTS[fete.jackpot]} !`
                : tr('Jetons du Baron !', 'Baron’s Tokens!')
              : fete.type === 'free'
                ? fete.relance
                  ? tr('Free games en plus !', 'Extra free games!')
                  : tr('Free games !', 'Free games!')
                : fete.type === 'finFree'
                  ? tr('Free games terminés', 'Free games over')
                  : fete.colossal
                    ? tr('Gain colossal !', 'Colossal win!')
                    : tr('Énorme gain !', 'Huge win!')
          }
          etiquette={fete.type === 'free' ? tr(`${fete.n} free games`, `${fete.n} free games`) : tr(`Gain : ${dollars(fete.type === 'finFree' ? fete.total : fete.gain)}`, `Win: ${dollars(fete.type === 'finFree' ? fete.total : fete.gain)}`)}
          medaillon={
            fete.type === 'free' ? (
              <div className="cas-medaillon-free">
                <img src="/cartes/machine2-juge-grand.webp" alt="" draggable={false} />
                <strong>{fete.relance ? `+${fete.n}` : fete.n}</strong>
              </div>
            ) : fete.type === 'jetons' && fete.jackpot ? (
              <div className={`nu-medaillon-jackpot ${fete.jackpot}`}>
                <PlaqueJackpot j={fete.jackpot} />
                <strong>{dollars(JACKPOTS_NUIT[fete.jackpot] * fete.mise)}</strong>
              </div>
            ) : (
              <strong className="celebration-xp cas-medaillon-gain">{dollars(fete.type === 'finFree' ? fete.total : fete.gain)}</strong>
            )
          }
          legende={
            fete.type === 'free'
              ? tr(`Un événement à chaque tour, à ${dollars(fete.mise)}`, `An event every spin, at ${dollars(fete.mise)}`)
              : fete.type === 'finFree'
                ? tr('Gagnés pendant les free games', 'Won during the free games')
                : fete.type === 'jetons'
                  ? tr(`Tous les Jetons du Baron : ${dollars(fete.gain)}`, `All the Baron’s Tokens: ${dollars(fete.gain)}`)
                  : tr('Ajouté à ton solde', 'Added to your balance')
          }
          onFermer={() => setFetes((f) => f.slice(1))}
        />
      )}
    </div>
  );
}
