/**
 * Salon privé du Baron : le casino des comptes Créateur (chargé à part : les autres joueurs ne le téléchargent pas).
 * Étape 1 : le salon (solde, plus riches, annonces), la roulette du salon (une par jour) et la machine à sous
 * « Le Bandit du Baron ». Tout l'argent est fictif et tenu par le serveur.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { CASE_VERTE_SALON, CASES_ROUE_SALON, formatDollars, MULTIPLE_GROS_GAIN, type AnnonceCasino, type VueCasino } from '../../shared/casino';
import {
  BANDES,
  GAINS_COFFRES,
  GAINS_LIGNE,
  LIGNES,
  MISES_MACHINE,
  MULTIPLICATEUR_GRATUIT,
  TOURS_GRATUITS,
  type GainLigne,
  type GrilleMachine,
  type SymboleLigne,
  type SymboleMachine,
} from '../../shared/machineASous';
import type { Appel } from './App';
import type { EtatCompte } from './Profil';
import { ANGLE_ROUE, COULEURS_ROUE, DUREE_ROUE_MS, Roue, useAttente, type CaseRoue } from './RouletteDuJour';
import { socket } from './socket';
import { EN, tr } from './traduction';
import { Celebration, Fenetre, jouerEffet, mouvementReduit, useCompteur } from './ui';
import './casino.css';

const dollars = (n: number) => formatDollars(n, EN);

/** Le solde défile jusqu'à sa nouvelle valeur. */
function useSoldeAnime(solde: number): number {
  const [depart, setDepart] = useState(solde);
  const precedent = useRef(solde);
  useEffect(() => {
    setDepart(precedent.current);
    precedent.current = solde;
  }, [solde]);
  return useCompteur(solde, depart, 0, 700);
}

// ---------------------------------------------------------------------------------------------------------------
// Symboles de la machine à sous (dessinés en attendant les images définitives)

const NOMS_SYMBOLES: Record<SymboleMachine, [string, string]> = {
  couronne: ['Couronne', 'Crown'],
  coffre: ['Coffre-fort', 'Safe'],
  sept: ['Sept', 'Seven'],
  lingot: ['Lingot', 'Gold bar'],
  diamant: ['Diamant', 'Diamond'],
  champagne: ['Champagne', 'Champagne'],
  cigare: ['Cigare', 'Cigar'],
  fer: ['Fer à cheval', 'Horseshoe'],
};
const nomSymbole = (s: SymboleMachine) => tr(...NOMS_SYMBOLES[s]);

export function Symbole({ s, className }: { s: SymboleMachine; className?: string }) {
  const cls = `cas-symbole cas-symbole-${s} ${className ?? ''}`;
  if (s === 'couronne') return <img className={cls} src="/cartes/couronne.webp" alt={nomSymbole(s)} draggable={false} />;
  return (
    <svg className={cls} viewBox="0 0 64 64" role="img" aria-label={nomSymbole(s)}>
      <defs>
        <linearGradient id={`or-${s}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff2c6" />
          <stop offset="0.45" stopColor="#e7c27a" />
          <stop offset="1" stopColor="#8a6424" />
        </linearGradient>
      </defs>
      {s === 'coffre' && (
        <g>
          <rect x="9" y="10" width="46" height="44" rx="5" fill="#3a3f47" stroke={`url(#or-${s})`} strokeWidth="3" />
          <rect x="14" y="15" width="36" height="34" rx="3" fill="#272b31" stroke="#5c636d" strokeWidth="1.5" />
          <circle cx="32" cy="32" r="10" fill={`url(#or-${s})`} stroke="#5a3d12" strokeWidth="1.5" />
          <circle cx="32" cy="32" r="4" fill="#272b31" />
          {Array.from({ length: 8 }, (_, k) => (
            <line key={k} x1="32" y1="21" x2="32" y2="23.5" stroke="#5a3d12" strokeWidth="1.4" transform={`rotate(${k * 45} 32 32)`} />
          ))}
          <rect x="45" y="27" width="4" height="10" rx="1.5" fill={`url(#or-${s})`} />
          <rect x="13" y="54" width="7" height="4" fill="#272b31" />
          <rect x="44" y="54" width="7" height="4" fill="#272b31" />
        </g>
      )}
      {s === 'sept' && (
        <g>
          <path d="M14 10 H52 V19 L33 56 H20 L38 21 H14 Z" fill="#b8281d" stroke={`url(#or-${s})`} strokeWidth="3.2" strokeLinejoin="round" />
          <path d="M17 13 H48" stroke="#ff9a8a" strokeWidth="1.4" opacity="0.6" />
        </g>
      )}
      {s === 'lingot' && (
        <g>
          <path d="M8 46 L18 24 H46 L56 46 Z" fill={`url(#or-${s})`} stroke="#6b4a14" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M18 24 L22 32 H42 L46 24" fill="none" stroke="#fff6d8" strokeWidth="1.4" opacity="0.8" />
          <path d="M22 32 L14 46 M42 32 L50 46" stroke="#a87a2a" strokeWidth="1.2" />
          <path d="M24 28 H34" stroke="#fffbe8" strokeWidth="2" strokeLinecap="round" opacity="0.9" />
        </g>
      )}
      {s === 'diamant' && (
        <g strokeLinejoin="round">
          <path d="M10 24 L20 12 H44 L54 24 L32 54 Z" fill="#cfe9f4" stroke={`url(#or-${s})`} strokeWidth="2.6" />
          <path d="M10 24 H54 M20 12 L26 24 L32 12 L38 24 L44 12 M26 24 L32 54 L38 24" fill="none" stroke="#7fb3c8" strokeWidth="1.3" />
          <path d="M20 12 L26 24 L10 24 Z" fill="#ffffff" opacity="0.75" />
          <path d="M38 24 L32 54 L54 24 Z" fill="#9cc7d8" opacity="0.6" />
        </g>
      )}
      {s === 'champagne' && (
        <g>
          <path d="M14 12 H50 Q48 30 32 32 Q16 30 14 12 Z" fill="#f3d68a" stroke={`url(#or-${s})`} strokeWidth="2.4" />
          <path d="M17 17 H47" stroke="#fff6d8" strokeWidth="1.2" />
          <path d="M32 32 V50" stroke={`url(#or-${s})`} strokeWidth="3" />
          <path d="M21 54 Q32 48 43 54 Z" fill={`url(#or-${s})`} stroke="#6b4a14" strokeWidth="1.2" />
          {[
            [24, 22, 1.6],
            [30, 26, 1.3],
            [38, 21, 1.8],
            [41, 8, 1.5],
            [35, 4, 1.2],
          ].map(([x, y, r], k) => (
            <circle key={k} cx={x} cy={y} r={r} fill="#fffbe8" opacity="0.85" />
          ))}
        </g>
      )}
      {s === 'cigare' && (
        <g transform="rotate(-28 32 32)">
          <rect x="8" y="27" width="44" height="11" rx="5.5" fill="#6b3a1e" stroke="#3a1d0c" strokeWidth="1.4" />
          <path d="M12 30 H46" stroke="#8d5530" strokeWidth="1.2" />
          <rect x="16" y="26.5" width="8" height="12" fill="#b8281d" stroke={`url(#or-${s})`} strokeWidth="1.6" />
          <rect x="50" y="28" width="5" height="9" rx="2" fill="#e8662a" />
          <rect x="53" y="28.5" width="3" height="8" rx="1.5" fill="#9a9a9a" />
          <path d="M58 26 Q54 18 60 12 Q64 6 58 0" fill="none" stroke="#d9d0c2" strokeWidth="1.8" strokeLinecap="round" opacity="0.7" />
        </g>
      )}
      {s === 'fer' && (
        <g>
          <path d="M14 12 V34 A18 18 0 0 0 50 34 V12 H40 V34 A8 8 0 0 1 24 34 V12 Z" fill={`url(#or-${s})`} stroke="#6b4a14" strokeWidth="1.8" strokeLinejoin="round" />
          {[
            [19, 18],
            [19, 28],
            [45, 18],
            [45, 28],
            [24, 46],
            [40, 46],
          ].map(([x, y], k) => (
            <circle key={k} cx={x} cy={y} r="1.8" fill="#5a3d12" />
          ))}
        </g>
      )}
    </svg>
  );
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
      const million = i === CASE_VERTE_SALON;
      if (million) setFete(true);
      jouerEffet(million ? 'roulette_gros_lot' : 'roulette_gain');
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
      <Roue cases={CASES_SALON} rotation={rotation} tourne={tourne} gagnante={resultat?.case ?? null} pieces={!!resultat && resultat.case !== CASE_VERTE_SALON} />
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
          titre={tr('Le million !', 'The million!')}
          etiquette={tr('Un million de dollars gagné', 'One million dollars won')}
          medaillon={<strong className="celebration-xp cas-medaillon-gain">{dollars(resultat.gain)}</strong>}
          legende={tr('Ajouté à ton solde', 'Added to your balance')}
          onFermer={() => setFete(false)}
        />
      )}
    </Fenetre>
  );
}

function GainDefilant({ gain, delai = 120 }: { gain: number; delai?: number }) {
  const v = useCompteur(gain, 0, delai, 900);
  return <strong className="roulette-xp-gagne">+{dollars(v)}</strong>;
}

// ---------------------------------------------------------------------------------------------------------------
// Machine à sous « Le Bandit du Baron »

interface TourMachine {
  arrets: number[];
  grille: GrilleMachine;
  lignes: GainLigne[];
  coffres: number;
  gain: number;
  gainGrosLot: number;
  toursGagnes: number;
  grosLot: boolean;
  gratuit: boolean;
  mise: number;
}

const DUREES_ROULEAUX = [1100, 1420, 1740, 2060, 2380];
const REMPLISSAGE = [14, 18, 22, 26, 30];

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
        <Symbole s="couronne" /> {tr('La Couronne remplace tous les symboles, sauf le Coffre.', 'The Crown replaces every symbol except the Safe.')}
      </p>
      <p className="cas-gains-note">
        <Symbole s="coffre" />
        {tr(
          `Coffres n’importe où : 3 = ${GAINS_COFFRES[3]} × la mise, 4 = ${GAINS_COFFRES[4]} ×, 5 = ${GAINS_COFFRES[5]} ×. 3 Coffres ou plus : ${TOURS_GRATUITS} tours gratuits, gains ×${MULTIPLICATEUR_GRATUIT}. 5 Coffres sur une ligne : le gros lot du salon.`,
          `Safes anywhere: 3 = ${GAINS_COFFRES[3]} × the bet, 4 = ${GAINS_COFFRES[4]} ×, 5 = ${GAINS_COFFRES[5]} ×. 3 or more Safes: ${TOURS_GRATUITS} free spins, wins ×${MULTIPLICATEUR_GRATUIT}. 5 Safes on a line: the lounge jackpot.`,
        )}
      </p>
    </Fenetre>
  );
}

/** Une colonne de la machine : pendant le tour, une longue bande défile jusqu'aux 3 symboles tirés. */
function Rouleau({ index, symboles, defile, duree, gagnantes }: { index: number; symboles: SymboleMachine[]; defile: boolean; duree: number; gagnantes: Set<number> }) {
  const decalage = symboles.length - 3;
  return (
    <div className="cas-rouleau">
      <div
        className="cas-bande"
        style={{ transform: `translateY(calc(var(--case) * ${defile ? -decalage : 0}))`, transitionDuration: defile ? `${duree}ms` : '0ms' } as CSSProperties}
      >
        {symboles.map((s, k) => (
          <div key={k} className={`cas-case ${!defile && gagnantes.has(index * 3 + k) ? 'gagnante' : ''}`}>
            <Symbole s={s} />
          </div>
        ))}
      </div>
    </div>
  );
}

function Machine({ vue, appel, onVue, onRetour }: { vue: VueCasino; appel: Appel; onVue: (v: VueCasino) => void; onRetour: () => void }) {
  const [mise, setMise] = useState(() => {
    const m = MISES_MACHINE.filter((x) => x <= Math.max(MISES_MACHINE[0], vue.solde / 20));
    return m[m.length - 1] ?? MISES_MACHINE[0];
  });
  const [grille, setGrille] = useState<GrilleMachine>(() => BANDES.map((b, r) => [0, 1, 2].map((k) => b[(r * 7 + k) % b.length])));
  const [bandes, setBandes] = useState<SymboleMachine[][] | null>(null);
  const [defile, setDefile] = useState(false);
  const [tour, setTour] = useState<TourMachine | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [auto, setAuto] = useState(0);
  const [soldeAffiche, setSoldeAffiche] = useState(vue.solde);
  const [fete, setFete] = useState<'gros' | 'grosLot' | 'bonus' | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [gains, setGains] = useState(false);
  const minuteries = useRef<number[]>([]);
  const autoRef = useRef(0);
  autoRef.current = auto;
  useEffect(() => () => minuteries.current.forEach((t) => window.clearTimeout(t)), []);
  useEffect(() => {
    if (!enCours) setSoldeAffiche(vue.solde);
  }, [vue.solde, enCours]);
  const solde = useSoldeAnime(soldeAffiche);
  const gratuits = vue.toursGratuits;
  const peutJouer = !enCours && (gratuits > 0 || vue.solde >= mise);

  const lancer = useCallback(async () => {
    if (enCours) return;
    setErreur(null);
    jouerEffet('machine_levier');
    setEnCours(true);
    const r = (await appel('casino_machine', { mise })) as { ok: boolean; erreur?: string; machine?: TourMachine; casino?: VueCasino };
    if (!r.ok || !r.machine || !r.casino) {
      setEnCours(false);
      setAuto(0);
      setErreur(r.erreur ?? tr('La machine est indisponible.', 'The machine is unavailable.'));
      return;
    }
    const m = r.machine;
    const nouvelle = r.casino;
    if (!m.gratuit) setSoldeAffiche((s) => s - m.mise);
    setTour(null);
    const reduit = mouvementReduit();
    const fin = () => {
      setDefile(false);
      setBandes(null);
      setGrille(m.grille);
      setTour(m);
      setEnCours(false);
      onVue(nouvelle);
      setSoldeAffiche(nouvelle.solde);
      const grand = m.grosLot || m.gain >= MULTIPLE_GROS_GAIN * m.mise;
      if (m.grosLot) setFete('grosLot');
      else if (grand) setFete('gros');
      else if (m.toursGagnes) setFete('bonus');
      if (grand || m.toursGagnes) jouerEffet('roulette_gros_lot');
      else if (m.gain > 0) jouerEffet('roulette_gain');
      // Tours auto : on continue, sauf après un gros gain.
      if (autoRef.current > 0) {
        if (grand) setAuto(0);
        else {
          const t = window.setTimeout(() => {
            setAuto((a) => Math.max(0, a - 1));
            if (autoRef.current > 1) void lancerRef.current?.();
          }, m.gain > 0 ? 1100 : 450);
          minuteries.current.push(t);
        }
      }
    };
    if (reduit) {
      fin();
      return;
    }
    // Chaque rouleau : les 3 symboles visibles, une bande de passage, puis les 3 symboles tirés.
    const longues = grille.map((visibles, r) => {
      const b = BANDES[r];
      const passage = Array.from({ length: REMPLISSAGE[r] }, () => b[Math.floor(Math.random() * b.length)]);
      return [...visibles, ...passage, ...m.grille[r]];
    });
    setBandes(longues);
    setDefile(false);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => setDefile(true)));
    DUREES_ROULEAUX.forEach((d) => minuteries.current.push(window.setTimeout(() => jouerEffet('machine_arret'), d - 40)));
    minuteries.current.push(window.setTimeout(fin, DUREES_ROULEAUX[4] + 120));
  }, [appel, enCours, grille, mise, onVue]);
  const lancerRef = useRef<typeof lancer | null>(null);
  lancerRef.current = lancer;

  // Cases gagnantes (rouleau × 3 + rangée) et lignes à tracer.
  const gagnantes = new Set<number>();
  for (const l of tour?.lignes ?? []) for (let r = 0; r < l.nombre; r++) gagnantes.add(r * 3 + LIGNES[l.ligne][r]);
  if (tour && tour.coffres >= 3) tour.grille.forEach((col, r) => col.forEach((s, k) => s === 'coffre' && gagnantes.add(r * 3 + k)));
  const changerMise = (sens: number) => {
    const i = MISES_MACHINE.indexOf(mise);
    setMise(MISES_MACHINE[Math.min(MISES_MACHINE.length - 1, Math.max(0, i + sens))]);
  };
  const libelleBouton = enCours ? tr('En jeu…', 'Spinning…') : gratuits > 0 ? tr(`Tour gratuit (${gratuits})`, `Free spin (${gratuits})`) : tr('Tourner', 'Spin');

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
      <div className="cas-machine">
        <div className="cas-fronton">
          <span className="cas-ampoules" aria-hidden="true" />
          <h2>{tr('Le Bandit du Baron', 'The Baron’s Bandit')}</h2>
          <p>
            {tr('Gros lot du salon', 'Lounge jackpot')} <strong>{dollars(vue.grosLot)}</strong>
          </p>
        </div>
        <div className={`cas-fenetre ${gratuits > 0 || tour?.gratuit ? 'gratuit' : ''}`}>
          <div className="cas-rouleaux">
            {(bandes ?? grille).map((col, r) => (
              <Rouleau key={r} index={r} symboles={col} defile={defile} duree={DUREES_ROULEAUX[r]} gagnantes={gagnantes} />
            ))}
          </div>
          {tour && !enCours && tour.lignes.length > 0 && (
            <svg className="cas-lignes" viewBox="0 0 5 3" preserveAspectRatio="none" aria-hidden="true">
              {tour.lignes.map((l) => (
                <polyline key={l.ligne} points={LIGNES[l.ligne].map((rang, r) => `${r + 0.5},${rang + 0.5}`).join(' ')} />
              ))}
            </svg>
          )}
        </div>
        <div className="cas-resultat" role="status">
          {tour && !enCours ? (
            tour.gain > 0 ? (
              <>
                <GainDefilant key={tour.arrets.join('-')} gain={tour.gain} delai={0} />
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
              </>
            ) : (
              <span className="discret">{tr('Pas de chance cette fois.', 'No luck this time.')}</span>
            )
          ) : gratuits > 0 ? (
            <span className="cas-gratuits">{tr(`${gratuits} tours gratuits, gains ×${MULTIPLICATEUR_GRATUIT}`, `${gratuits} free spins, wins ×${MULTIPLICATEUR_GRATUIT}`)}</span>
          ) : (
            <span className="discret">{tr('10 lignes · la Couronne remplace tout', '10 lines · the Crown replaces everything')}</span>
          )}
          {erreur && <span className="cas-erreur">{erreur}</span>}
        </div>
        <div className="cas-commandes">
          <div className="cas-mise" aria-label={tr('Mise', 'Bet')}>
            <button type="button" onClick={() => changerMise(-1)} disabled={enCours || gratuits > 0 || mise === MISES_MACHINE[0]} aria-label={tr('Baisser la mise', 'Lower the bet')}>
              −
            </button>
            <span>
              <small>{gratuits > 0 ? tr('Mise du bonus', 'Bonus bet') : tr('Mise', 'Bet')}</small>
              <strong>{dollars(gratuits > 0 ? vue.miseGratuite : mise)}</strong>
            </span>
            <button type="button" onClick={() => changerMise(1)} disabled={enCours || gratuits > 0 || mise === MISES_MACHINE[MISES_MACHINE.length - 1]} aria-label={tr('Augmenter la mise', 'Raise the bet')}>
              +
            </button>
          </div>
          <button type="button" className="cas-tourner" disabled={!peutJouer} onClick={() => void lancer()}>
            {libelleBouton}
          </button>
          <div className="cas-options">
            <button
              type="button"
              className={auto ? 'actif' : ''}
              disabled={!auto && !peutJouer}
              onClick={() => {
                if (auto) return setAuto(0);
                setAuto(10);
                void lancer();
              }}
            >
              {auto ? tr(`Arrêter (${auto})`, `Stop (${auto})`) : tr('Auto ×10', 'Auto ×10')}
            </button>
            <button type="button" onClick={() => setGains(true)}>
              {tr('Gains', 'Paytable')}
            </button>
          </div>
          {!peutJouer && !enCours && gratuits === 0 && <p className="cas-erreur">{tr('Solde insuffisant : baisse la mise ou tourne la roulette du salon.', 'Not enough money: lower the bet or spin the lounge wheel.')}</p>}
        </div>
      </div>
      {gains && <TableDesGains onFermer={() => setGains(false)} />}
      {fete && tour && (
        <Celebration
          titre={fete === 'grosLot' ? tr('Gros lot du salon !', 'Lounge jackpot!') : fete === 'bonus' ? tr('Tours gratuits !', 'Free spins!') : tr('Gros gain !', 'Big win!')}
          etiquette={fete === 'bonus' ? tr(`${TOURS_GRATUITS} tours gratuits`, `${TOURS_GRATUITS} free spins`) : tr(`Gain : ${dollars(tour.gain)}`, `Win: ${dollars(tour.gain)}`)}
          medaillon={
            fete === 'bonus' ? (
              <div className="cas-medaillon-bonus">
                <Symbole s="coffre" />
                <strong>×{MULTIPLICATEUR_GRATUIT}</strong>
              </div>
            ) : (
              <strong className="celebration-xp cas-medaillon-gain">{dollars(tour.gain)}</strong>
            )
          }
          legende={fete === 'bonus' ? tr(`${TOURS_GRATUITS} tours, gains doublés`, `${TOURS_GRATUITS} spins, double wins`) : tr('Ajouté à ton solde', 'Added to your balance')}
          onFermer={() => setFete(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Le salon

const JEUX: { id: 'machine' | 'roulette' | 'blackjack' | 'poker'; nom: [string, string]; image: string; repli: string }[] = [
  { id: 'machine', nom: ['Machine à sous', 'Slot machine'], image: '/cartes/casino-machine.webp', repli: '/cartes/evenement_casse_du_siecle.webp' },
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
      ? tr(`${annonce.nom} a gagné le million à la roulette du salon !`, `${annonce.nom} won the million on the lounge wheel!`)
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

function Salon({ vue, onRoue, onMachine, onQuitter }: { vue: VueCasino; onRoue: () => void; onMachine: () => void; onQuitter: () => void }) {
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
          <small>{attente ? tr(`Prochain tour dans ${attente}`, `Next spin in ${attente}`) : tr('100 000 $ ou le million !', '$100,000 or the million!')}</small>
        </span>
        {!attente && <span className="pastille-nombre">1</span>}
      </button>
      <div className="cas-jeux">
        {JEUX.map((j) => (
          <Vignette key={j.id} jeu={j} onOuvrir={j.id === 'machine' ? onMachine : undefined} />
        ))}
      </div>
      <p className="cas-gros-lot">
        {tr('Gros lot de la machine à sous', 'Slot machine jackpot')} : <strong>{dollars(vue.grosLot)}</strong>
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
      <p className="cas-mention">{tr('Argent fictif, sans aucune valeur réelle.', 'Play money, with no real value.')}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------

export default function Casino({ appel, compte, onQuitter }: { appel: Appel; compte: EtatCompte; onQuitter: (message?: string) => void }) {
  const [vue, setVue] = useState<VueCasino | null>(null);
  const [ecran, setEcran] = useState<'salon' | 'machine'>('salon');
  const [roue, setRoue] = useState(false);
  const [annonce, setAnnonce] = useState<AnnonceCasino | null>(null);
  const minuterieAnnonce = useRef(0);

  const entrer = useCallback(async () => {
    for (let essai = 0; essai < 4; essai++) {
      const r = (await appel('casino_entrer')) as { ok: boolean; erreur?: string; casino?: VueCasino };
      if (r.ok && r.casino) return setVue(r.casino);
      await new Promise((ok) => window.setTimeout(ok, 1200));
    }
    onQuitter(tr('Le salon est indisponible pour le moment.', 'The lounge is unavailable right now.'));
  }, [appel, onQuitter]);

  useEffect(() => {
    void entrer();
    const surAnnonce = (a: AnnonceCasino) => {
      setAnnonce(a);
      window.clearTimeout(minuterieAnnonce.current);
      minuterieAnnonce.current = window.setTimeout(() => setAnnonce(null), 6000);
    };
    const surGrosLot = (g: number) => setVue((v) => (v ? { ...v, grosLot: g } : v));
    // Après une coupure, on revient au salon (le compte se représente d'abord au serveur).
    const surConnexion = () => window.setTimeout(() => void entrer(), 1500);
    socket.on('casino_annonce', surAnnonce);
    socket.on('casino_gros_lot', surGrosLot);
    socket.on('connect', surConnexion);
    return () => {
      socket.off('casino_annonce', surAnnonce);
      socket.off('casino_gros_lot', surGrosLot);
      socket.off('connect', surConnexion);
      window.clearTimeout(minuterieAnnonce.current);
      socket.emit('casino_quitter');
    };
  }, [entrer]);

  let contenu: ReactNode;
  if (!vue) contenu = <div className="chargement">{tr('Ouverture du salon…', 'Opening the lounge…')}</div>;
  else if (ecran === 'machine') contenu = <Machine vue={vue} appel={appel} onVue={setVue} onRetour={() => setEcran('salon')} />;
  else contenu = <Salon vue={vue} onRoue={() => setRoue(true)} onMachine={() => setEcran('machine')} onQuitter={() => onQuitter()} />;
  return (
    <div className="cas">
      {contenu}
      {annonce && <Annonce annonce={annonce} />}
      {roue && vue && <FenetreRoueSalon vue={vue} appel={appel} onVue={setVue} onFermer={() => setRoue(false)} />}
    </div>
  );
}
