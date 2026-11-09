/**
 * Deuxième machine à sous du Salon privé : « Les Nuits du Baron » (machine bleu nuit, 243 façons de gagner).
 *
 * Avant l'arrêt des rouleaux, une carte Événement du jeu peut se retourner au centre de l'écran : Descente de police,
 * Casse du siècle, Trahison, Alliance ou Couvre-feu. Les rouleaux s'arrêtent sur la grille « avant » l'événement,
 * l'événement se joue (menottes, butin, cartes mystère, poignée de main, lune), puis les Couronnes couvrent leurs
 * rouleaux et les gains s'affichent. Le serveur tire tout ; cet écran ne fait que jouer les animations.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { VueCasino } from '../../shared/casino';
import { MISES_MACHINE } from '../../shared/machineASous';
import { BANDES_NUIT, FREE_GAMES_NUIT, GAIN_JUGES_NUIT, GAINS_NUIT, PAYANTS_NUIT, PIECES_NUIT, type ResultatNuit, type SymboleNuit, type TypeEvenementNuit } from '../../shared/machineNuits';
import type { Appel } from './App';
import { dollars, GainDefilant, Jeton, LINGOTS_PALIER, palierDe, PluieLingots, useSoldeAnime } from './casinoOutils';
import { EN, tr } from './traduction';
import { Celebration, Fenetre, jouerEffet, mouvementReduit, type EffetSonore } from './ui';

type TourNuit = ResultatNuit & { mise: number; gratuit: boolean };

/** Les cartes Événement du jeu, leur nom, ce qu'elles font, et leur son. */
const EVENEMENTS: Record<TypeEvenementNuit, { carte: string; nom: [string, string]; texte: [string, string]; son: EffetSonore }> = {
  police: { carte: 'evenement_descente_police', nom: ['Descente de police !', 'Police raid!'], texte: ['Des rouleaux deviennent joker, figés pour 3 tours.', 'Reels turn wild, locked for 3 spins.'], son: 'police' },
  casse: { carte: 'evenement_casse_du_siecle', nom: ['Le casse du siècle !', 'Heist of the century!'], texte: ['Une Couronne multiplicatrice couvre un rouleau.', 'A multiplier Crown covers a reel.'], son: 'casse' },
  trahison: { carte: 'evenement_trahison', nom: ['Trahison !', 'Betrayal!'], texte: ['Les cartes mystère se retournent toutes sur le même symbole.', 'Mystery cards all turn into the same symbol.'], son: 'evt_trahison' },
  alliance: { carte: 'evenement_alliance', nom: ['Alliance !', 'Alliance!'], texte: ['Deux rouleaux voisins se soudent.', 'Two neighbouring reels join forces.'], son: 'evt_alliance' },
  couvreFeu: { carte: 'evenement_couvre_feu', nom: ['Couvre-feu !', 'Curfew!'], texte: ['Les petits symboles s’éteignent sur les trois premiers rouleaux.', 'Low symbols vanish from the first three reels.'], son: 'couvre_feu' },
};

/** Les petits symboles : des lettres Art déco dessinées en code. */
const LETTRES: Partial<Record<SymboleNuit, { fr: string; en: string; couleur: string }>> = {
  as: { fr: 'A', en: 'A', couleur: '#c0281c' },
  roi: { fr: 'R', en: 'K', couleur: '#2f6bff' },
  dame: { fr: 'D', en: 'Q', couleur: '#9a4fd6' },
  valet: { fr: 'V', en: 'J', couleur: '#1fae64' },
  dix: { fr: '10', en: '10', couleur: '#e0901c' },
};
const NOMS: Record<SymboleNuit, [string, string]> = {
  chat: ['Chat noir', 'Black cat'],
  chapeau: ['Haut-de-forme', 'Top hat'],
  champagne: ['Champagne', 'Champagne'],
  as: ['As', 'Ace'],
  roi: ['Roi', 'King'],
  dame: ['Dame', 'Queen'],
  valet: ['Valet', 'Jack'],
  dix: ['Dix', 'Ten'],
  couronne: ['Couronne', 'Crown'],
  juge: ['Juge', 'Judge'],
  mystere: ['Carte mystère', 'Mystery card'],
};

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
        {tr('La Couronne (rouleaux 2 à 4) couvre tout son rouleau : il devient joker.', 'The Crown (reels 2 to 4) covers its whole reel: it turns wild.')}
      </p>
      <p className="cas-gains-note">
        <img className="cas-symbole" src="/cartes/machine2-juge.webp" alt="" />
        {tr(`3 Juges : ${GAIN_JUGES_NUIT} fois la mise et ${FREE_GAMES_NUIT} free games, avec un événement à chaque tour. 3 nouveaux Juges en rajoutent ${FREE_GAMES_NUIT}.`, `3 Judges: ${GAIN_JUGES_NUIT} times the bet and ${FREE_GAMES_NUIT} free games, with an event on every spin. 3 new Judges add ${FREE_GAMES_NUIT} more.`)}
      </p>
      <h3 className="cas-gains-titre">{tr('Les événements', 'The events')}</h3>
      {(Object.keys(EVENEMENTS) as TypeEvenementNuit[]).map((e) => (
        <p key={e} className="cas-gains-note">
          <img className="nu-gains-carte" src={`/cartes/${EVENEMENTS[e].carte}.webp`} alt="" />
          <span>
            <strong>{tr(...EVENEMENTS[e].nom)}</strong> {tr(...EVENEMENTS[e].texte)}
            {e === 'casse' && tr(' (×2 à ×5)', ' (×2 to ×5)')}
            {e === 'police' && tr(' La mise ne change pas pendant ces tours.', ' The bet stays the same during these spins.')}
          </span>
        </p>
      ))}
      <p className="cas-gains-note discret">{tr('Un événement tombe environ une fois tous les 20 tours.', 'An event happens about once every 20 spins.')}</p>
    </Fenetre>
  );
}

function RouleauNuit({
  index,
  symboles,
  defile,
  duree,
  gagnantes,
  retournees,
  suspense,
}: {
  index: number;
  symboles: SymboleNuit[];
  defile: boolean;
  duree: number;
  gagnantes: Set<number>;
  retournees: Set<number>;
  suspense: boolean;
}) {
  const decalage = symboles.length - 3;
  return (
    <div className={`cas-rouleau ${suspense ? 'suspense sus-2 sus-coffre' : ''}`}>
      <div
        className="cas-bande"
        style={{
          transform: `translateY(calc(var(--case) * ${defile ? -decalage : 0}))`,
          transitionDuration: defile ? `${duree}ms` : '0ms',
          ...(suspense ? { transitionTimingFunction: 'cubic-bezier(0.1, 0.62, 0.18, 1)' } : {}),
        }}
      >
        {symboles.map((s, k) => {
          const c = index * 3 + k;
          return (
            <div key={`${k}-${retournees.has(c) ? s : ''}`} className={`cas-case ${!defile && gagnantes.has(c) ? 'gagnante' : ''} ${!defile && retournees.has(c) && k < 3 ? 'nu-retourne' : ''}`}>
              <SymboleNuitImage s={s} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

type FeteNuit = { type: 'gain'; gain: number; colossal: boolean } | { type: 'free'; n: number; relance: boolean; mise: number } | { type: 'finFree'; total: number };

export function MachineNuits({ vue, appel, onVue, onRetour }: { vue: VueCasino; appel: Appel; onVue: (v: VueCasino) => void; onRetour: () => void }) {
  const [mise, setMise] = useState(() => {
    const m = MISES_MACHINE.filter((x) => x <= Math.max(MISES_MACHINE[0], vue.solde / 20));
    return m[m.length - 1] ?? MISES_MACHINE[0];
  });
  const [grille, setGrille] = useState<SymboleNuit[][]>(() => BANDES_NUIT.map((b, r) => [0, 1, 2].map((k) => b[(r * 5 + k) % b.length])));
  const [bandes, setBandes] = useState<SymboleNuit[][] | null>(null);
  const [defile, setDefile] = useState(false);
  const [durees, setDurees] = useState<number[]>([1100, 1420, 1740, 2060, 2380]);
  const [enCours, setEnCours] = useState(false);
  const [carte, setCarte] = useState<TypeEvenementNuit | null>(null);
  const [effet, setEffet] = useState<ResultatNuit['evenement']>(null);
  const [sauvages, setSauvages] = useState<number[]>(() => vue.nuits.collantes?.rouleaux ?? []);
  const [multiples, setMultiples] = useState<Record<number, number>>({});
  const [retournees, setRetournees] = useState<Set<number>>(new Set());
  const [suspense, setSuspense] = useState<number | null>(null);
  const [tour, setTour] = useState<TourNuit | null>(null);
  const [auto, setAuto] = useState(0);
  const [soldeAffiche, setSoldeAffiche] = useState(vue.solde);
  const [fetes, setFetes] = useState<FeteNuit[]>([]);
  const [pluie, setPluie] = useState<{ n: number; id: number } | null>(null);
  const [banniere, setBanniere] = useState<{ texte: string; id: number } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [gains, setGains] = useState(false);
  const totalFree = useRef(0);
  const minuteries = useRef<number[]>([]);
  const plusTard = (f: () => void, ms: number) => minuteries.current.push(window.setTimeout(f, ms));
  const autoRef = useRef(0);
  autoRef.current = auto;
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
      setAuto(0);
      setErreur(r.erreur ?? tr('La machine est indisponible.', 'The machine is unavailable.'));
      return;
    }
    const m = r.nuits;
    const nouvelle = r.casino;
    if (!m.gratuit) setSoldeAffiche((s) => s - m.mise);
    setTour(null);
    setPluie(null);
    setBanniere(null);
    setEffet(null);
    setRetournees(new Set());
    setMultiples({});
    setSauvages(figes);
    const reduit = mouvementReduit();
    const evt = m.evenement;

    // Après l'arrêt : l'événement se joue, les Couronnes couvrent leurs rouleaux, puis les gains.
    const montrerGains = () => {
      setTour(m);
      setEnCours(false);
      setEffet(null);
      onVue(nouvelle);
      setSoldeAffiche(nouvelle.solde);
      const palier = palierDe(m.gain, m.mise);
      const file: FeteNuit[] = [];
      if (palier === 'enorme' || palier === 'colossal') file.push({ type: 'gain', gain: m.gain, colossal: palier === 'colossal' });
      if (palier === 'gros') {
        setBanniere({ texte: tr('Gros gain !', 'Big win!'), id: Date.now() });
        jouerEffet('roulette_gain');
      } else if (palier === 'enorme' || palier === 'colossal') jouerEffet('roulette_gros_lot');
      else if (palier === 'joli') jouerEffet('roulette_gain');
      else if (palier === 'petit') jouerEffet('machine_pieces');
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
      if (autoRef.current > 0) {
        if (file.length) setAuto(0);
        else
          plusTard(
            () => {
              setAuto((a) => Math.max(0, a - 1));
              if (autoRef.current > 1) void lancerRef.current?.();
            },
            palier === 'gros' ? 2800 : palier === 'joli' ? 1900 : m.gain > 0 ? 1200 : 500,
          );
      }
    };
    const apresArret = () => {
      setDefile(false);
      setBandes(null);
      setSuspense(null);
      setGrille(m.avant);
      if (m.juges >= 3) jouerEffet('juge');
      if (!evt) {
        const nouvelles = m.sauvages.filter((x) => !figes.includes(x));
        setSauvages(m.sauvages);
        if (nouvelles.length && !reduit) {
          jouerEffet('roulette_tic');
          plusTard(montrerGains, 700);
        } else montrerGains();
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
        setSauvages(m.sauvages);
      }, avantRevelation);
      plusTard(montrerGains, reduit ? 0 : avantRevelation + 1100);
    };
    if (reduit) {
      setGrille(m.grille);
      return apresArret();
    }
    // Les rouleaux : ceux que la police a figés ne tournent pas. Avec deux Juges sur les rouleaux 1 et 3, le
    // dernier rouleau ralentit (les free games sont peut-être là).
    const susp = m.avant[0].includes('juge') && m.avant[2].includes('juge') ? 4 : null;
    const base = (evt ? DUREE_CARTE : 0) + ARRET_PREMIER;
    const t = [0, 1, 2, 3, 4].map((k) => base + k * ECART_ARRETS + (susp !== null && k >= susp ? EXTRA_SUSPENSE : 0));
    const longues = grille.map((visibles, k) => {
      if (figes.includes(k)) return m.avant[k];
      const b = BANDES_NUIT[k];
      const passage = Array.from({ length: Math.round((t[k] / 1000) * CASES_PAR_SECONDE) }, () => b[Math.floor(Math.random() * b.length)]);
      return [...visibles, ...passage, ...m.avant[k]];
    });
    setDurees(t);
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
          setSuspense(susp);
          jouerEffet('suspense');
        }
      }, d - 40),
    );
    plusTard(apresArret, t[4] + 120);
  }, [appel, enCours, grille, mise, onVue]);
  const lancerRef = useRef<typeof lancer | null>(null);
  lancerRef.current = lancer;

  // Cases gagnantes : les symboles de chaque gain sur ses rouleaux (tout le rouleau s'il est joker), et les Juges.
  const gagnantes = new Set<number>();
  if (tour) {
    for (const g of tour.gains)
      for (let k = 0; k < g.longueur; k++)
        tour.grille[k].forEach((s, rang) => {
          if (tour.sauvages.includes(k) || s === g.symbole) gagnantes.add(k * 3 + rang);
        });
    if (tour.juges >= 3) tour.grille.forEach((col, k) => col.forEach((s, rang) => s === 'juge' && gagnantes.add(k * 3 + rang)));
  }
  const fete = fetes[0] ?? null;
  const palier = tour ? palierDe(tour.gain, tour.mise) : 'aucun';
  const etatMachine = suspense !== null ? 'suspense sus-2 sus-coffre' : enCours ? 'tourne' : tour && palier !== 'aucun' ? `gagne palier-${palier}` : '';
  const changerMise = (sens: number) => {
    const i = MISES_MACHINE.indexOf(mise);
    jouerEffet('jeton');
    setMise(MISES_MACHINE[Math.min(MISES_MACHINE.length - 1, Math.max(0, i + sens))]);
  };
  const plaque = gratuits > 0 ? tr(`Free games : ${gratuits}`, `Free games: ${gratuits}`) : n.collantes ? tr(`Police : encore ${n.collantes.restants} tour${n.collantes.restants > 1 ? 's' : ''}`, `Police: ${n.collantes.restants} more spin${n.collantes.restants > 1 ? 's' : ''}`) : tr('243 façons de gagner', '243 ways to win');
  const collantesActuelles = new Set(n.collantes?.rouleaux ?? []);

  return (
    <div className="cas-ecran cas-machine-ecran nuits">
      <header className="cas-barre">
        <button type="button" className="cas-retour" onClick={onRetour} disabled={enCours} aria-label={tr('Retour au salon', 'Back to the lounge')}>
          ‹ {tr('Salon', 'Lounge')}
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
          <h2 className="cab-titre">{tr('Les Nuits du Baron', 'The Baron’s Nights')}</h2>
          <p className="cab-gros-lot nu-plaque">{plaque}</p>
          <div className="cab-rouleaux">
            {(bandes ?? grille).map((col, k) => (
              <RouleauNuit key={k} index={k} symboles={col} defile={defile && !(sauvages.includes(k) && (bandes?.[k]?.length ?? 0) === 3)} duree={durees[k]} gagnantes={gagnantes} retournees={retournees} suspense={suspense === k} />
            ))}
            {/* Les rouleaux couverts par la Couronne (et les menottes de la police) */}
            {sauvages.map((k) => (
              <div key={`c${k}`} className={`nu-couronne ${collantesActuelles.has(k) || effet?.type === 'police' ? 'figee' : ''} ${tour && !enCours && tour.gains.some((g) => g.longueur > k) ? 'gagnante' : ''}`} style={{ '--k': k } as CSSProperties} aria-hidden="true">
                <img src="/cartes/machine2-couronne-geante.webp" alt="" draggable={false} />
                {multiples[k] && <strong className="nu-multiple">×{multiples[k]}</strong>}
                {(collantesActuelles.has(k) || (effet?.type === 'police' && effet.rouleaux.includes(k))) && <img className="nu-menottes" src="/cartes/evt-menottes.webp" alt="" draggable={false} />}
              </div>
            ))}
            {effet?.type === 'casse' && (
              <img className="nu-butin" src="/cartes/evt-butin.webp" alt="" draggable={false} style={{ '--k': effet.rouleau } as CSSProperties} />
            )}
            {effet?.type === 'alliance' && <img className="nu-alliance" src="/cartes/evt-alliance.webp" alt="" draggable={false} style={{ '--k': effet.de } as CSSProperties} />}
            {effet?.type === 'couvreFeu' && (
              <>
                <span className="nu-nuit" aria-hidden="true" />
                <img className="nu-lune" src="/cartes/evt-lune.webp" alt="" draggable={false} />
              </>
            )}
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
              tour.gain > 0 || tour.freeGames ? (
                <>
                  {tour.gain > 0 && <GainDefilant key={tour.arrets.join('-')} gain={tour.gain} delai={0} duree={palier === 'petit' ? 700 : palier === 'joli' ? 1300 : 2000} />}
                  {tour.freeGames > 0 && <strong className="cas-bonus-annonce">{tr(`${tour.freeGames} free games !`, `${tour.freeGames} free games!`)}</strong>}
                  {tour.gains.length > 0 && (
                    <span className="nu-lignes-gain">
                      {tour.gains
                        .slice(0, 2)
                        .map((g) => `${g.longueur} × ${tr(...NOMS[g.symbole])}${g.voies > 1 ? ` (${g.voies} ${tr('façons', 'ways')})` : ''}${g.multiple > 1 ? ` ×${g.multiple}` : ''}`)
                        .join(' · ')}
                    </span>
                  )}
                </>
              ) : (
                <span className="discret">{tr('Pas de chance cette fois.', 'No luck this time.')}</span>
              )
            ) : effet ? (
              <strong className="cas-suspense-texte sus-coffre">{tr(...EVENEMENTS[effet.type].nom)}</strong>
            ) : suspense !== null ? (
              <strong className="cas-suspense-texte sus-coffre">{tr('Un troisième Juge ?', 'A third Judge?')}</strong>
            ) : (
              <span className="discret">{tr('La Couronne couvre tout son rouleau', 'The Crown covers its whole reel')}</span>
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
            <span>{enCours ? tr('En jeu…', 'Spinning…') : gratuits > 0 ? 'Free game' : tr('Tourner', 'Spin')}</span>
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
          titre={fete.type === 'free' ? (fete.relance ? tr('Free games en plus !', 'Extra free games!') : tr('Free games !', 'Free games!')) : fete.type === 'finFree' ? tr('Free games terminés', 'Free games over') : fete.colossal ? tr('Gain colossal !', 'Colossal win!') : tr('Énorme gain !', 'Huge win!')}
          etiquette={fete.type === 'free' ? tr(`${fete.n} free games`, `${fete.n} free games`) : tr(`Gain : ${dollars(fete.type === 'finFree' ? fete.total : fete.gain)}`, `Win: ${dollars(fete.type === 'finFree' ? fete.total : fete.gain)}`)}
          medaillon={
            fete.type === 'free' ? (
              <div className="cas-medaillon-free">
                <img src="/cartes/machine2-juge-grand.webp" alt="" draggable={false} />
                <strong>{fete.relance ? `+${fete.n}` : fete.n}</strong>
              </div>
            ) : (
              <strong className="celebration-xp cas-medaillon-gain">{dollars(fete.type === 'finFree' ? fete.total : fete.gain)}</strong>
            )
          }
          legende={fete.type === 'free' ? tr(`Un événement à chaque tour, à ${dollars(fete.mise)}`, `An event every spin, at ${dollars(fete.mise)}`) : fete.type === 'finFree' ? tr('Gagnés pendant les free games', 'Won during the free games') : tr('Ajouté à ton solde', 'Added to your balance')}
          onFermer={() => setFetes((f) => f.slice(1))}
        />
      )}
    </div>
  );
}
