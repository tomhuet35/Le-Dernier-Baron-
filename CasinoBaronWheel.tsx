/**
 * The Baron's Wheel (Salon privé) : la roue géante de 40 cases, en direct, et ses quatre bonus (le Choix du Baron, le
 * Pickpocket, la Grande Évasion, le Braquage).
 *
 * Le serveur tient les manches et diffuse la vue (« casino_bw ») ; il a déjà tiré la case d'arrêt quand la roue part,
 * et toutes les récompenses cachées d'un bonus quand il commence. Cet écran ne fait que montrer : la roue tourne
 * jusqu'à la case tirée (calée sur l'horloge du serveur), les cartes, mallettes, itinéraires et compartiments ne se
 * retournent qu'une fois que le serveur a révélé ce qu'ils cachent.
 *
 * Visuels : bw-*.webp (roue, cerclage, aiguille, centre, symboles, plaques de jackpot, décors et personnages des bonus).
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject, type ReactNode } from 'react';
import {
  BONUS_BW,
  CASES_BW,
  DEGRES_CASE_BW,
  estBonusBW,
  GAINS_CHIFFRES_BW,
  ITINERAIRES_BW,
  JACKPOTS_BW,
  JETONS_BW,
  MAX_CASE_BW,
  MAX_MANCHE_BW,
  ROUE_BW,
  ROUTES_BW,
  VALEUR_JACKPOT_BW,
  type BonusBW,
  type BoostBW,
  type CaseBW,
  type JackpotBW,
  type JournalBW,
  type RecompenseBW,
  type RouteBW,
  type VueBonusBW,
  type VueBW,
} from '../../shared/baronWheel';
import type { VueCasino } from '../../shared/casino';
import type { Appel } from './App';
import { BUTIN_PLUIE, CHOIX_AUTO, dollars, PluieLingots, useSoldeAnime } from './casinoOutils';
import { socket } from './socket';
import { EN, tr } from './traduction';
import { jouerEffet, mouvementReduit } from './ui';
import './baronWheel.css';

const court = (n: number) => (n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${+(n / 1000).toFixed(n % 1000 ? 1 : 0)}k` : String(n));
const imageJeton = (v: number) => (v >= 500_000 ? 'violet' : v >= 100_000 ? 'noir' : v >= 25_000 ? 'vert' : v >= 5_000 ? 'rouge' : 'ivoire');
const fx = (x: number) => `×${x.toLocaleString(EN ? 'en-US' : 'fr-FR', { maximumFractionDigits: 2 })}`;
const CLE_JETON = 'ldb-bw-jeton';

/** Les cases : nom, couleurs de la roue et du tapis. */
export const CASES_VISUELS: Record<CaseBW, { nom: [string, string]; fond: string; texte: string; image?: string }> = {
  x1: { nom: ['1X', '1X'], fond: '#671D2B', texte: '#F3E7CF' },
  x2: { nom: ['2X', '2X'], fond: '#1b2c58', texte: '#F3E7CF' },
  x5: { nom: ['5X', '5X'], fond: '#D6A84B', texte: '#1b120c' },
  x10: { nom: ['10X', '10X'], fond: '#f6d77a', texte: '#3a1810' },
  baron: { nom: ['Baron', 'Baron'], fond: '#0d0b0b', texte: '#F3E7CF', image: '/cartes/bw-sym-baron.webp' },
  pickpocket: { nom: ['Pickpocket', 'Pickpocket'], fond: '#7a1c2e', texte: '#F3E7CF', image: '/cartes/bw-sym-pickpocket.webp' },
  evasion: { nom: ['Grande Évasion', 'Great Escape'], fond: '#132552', texte: '#F3E7CF', image: '/cartes/bw-sym-evasion.webp' },
  braquage: { nom: ['Braquage', 'Big Heist'], fond: '#a3241c', texte: '#F3E7CF', image: '/cartes/bw-sym-braquage.webp' },
};
const NOMS_BONUS: Record<BonusBW, [string, string]> = {
  baron: ['Le Choix du Baron', 'The Baron’s Choice'],
  pickpocket: ['Le Grand Vol', 'The Big Theft'],
  evasion: ['La Grande Évasion', 'The Great Escape'],
  braquage: ['Le Braquage', 'The Big Heist'],
};
const NOMS_ROUTES: Record<RouteBW, { nom: [string, string]; risque: [string, string] }> = {
  boulevard: { nom: ['Le Boulevard', 'The Boulevard'], risque: ['Risque faible', 'Low risk'] },
  ruelles: { nom: ['Les Ruelles', 'The Alleys'], risque: ['Risque moyen', 'Medium risk'] },
  souterrains: { nom: ['Les Souterrains', 'The Tunnels'], risque: ['Risque élevé', 'High risk'] },
};
const NOMS_JACKPOTS: Record<JackpotBW, string> = { mini: 'MINI', minor: 'MINOR', major: 'MAJOR', grand: 'GRAND' };
const nomCase = (c: CaseBW) => (estBonusBW(c) ? tr(...CASES_VISUELS[c].nom) : fx(GAINS_CHIFFRES_BW[c]));

/** Les secondes qui restent avant `fin` (horloge du téléphone), rafraîchies 4 fois par seconde. */
function useSecondes(fin: number | null): number {
  const [, setTic] = useState(0);
  useEffect(() => {
    if (fin === null) return;
    const t = window.setInterval(() => setTic((x) => x + 1), 250);
    return () => window.clearInterval(t);
  }, [fin]);
  return fin === null ? 0 : Math.max(0, Math.ceil((fin - Date.now()) / 1000));
}

/** La barre du temps qui reste (une animation CSS qui part de la part restante). */
function Barre({ v, cle }: { v: VueBW; cle: string }) {
  if (v.reste === null || !v.duree) return null;
  const part = Math.min(1, v.reste / v.duree);
  return (
    <span className="bw-barre" aria-hidden="true">
      <i key={cle} style={{ '--part': part, animationDuration: `${v.reste}ms` } as CSSProperties} />
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// La roue

/** Un secteur de la roue (centre 0,0, angles en degrés depuis le haut, sens des aiguilles d'une montre). */
function secteur(r1: number, r2: number, a1: number, a2: number) {
  const p = (r: number, a: number) => `${(r * Math.sin((a * Math.PI) / 180)).toFixed(2)} ${(-r * Math.cos((a * Math.PI) / 180)).toFixed(2)}`;
  return `M${p(r1, a1)} L${p(r2, a1)} A${r2} ${r2} 0 0 1 ${p(r2, a2)} L${p(r1, a2)} A${r1} ${r1} 0 0 0 ${p(r1, a1)} Z`;
}
const facile = (u: number) => 1 - (1 - u) ** 4;

interface HorlogesRoue {
  v: VueBW | null;
  /** Départ du tour (performance.now()). */
  debut: number | null;
  numero: number;
}

function Roue({ v, horloges }: { v: VueBW; horloges: MutableRefObject<HorlogesRoue> }) {
  const disque = useRef<HTMLDivElement>(null);
  const gagnante = v.phase === 'bonus' || v.phase === 'resultat' ? v.arret : null;
  const boosts = v.multiplicateurs ?? [];

  useEffect(() => {
    let raf = 0;
    let derniere = -1;
    let dernierTic = 0;
    const dessiner = () => {
      raf = requestAnimationFrame(dessiner);
      const h = horloges.current;
      const x = h.v;
      if (!x || !disque.current) return;
      let a = x.angle;
      let vitesse = 0;
      if (x.phase === 'tour' && x.tour && h.debut !== null) {
        const u = Math.min(1, (performance.now() - h.debut) / x.tour.duree);
        a = x.tour.depart + (x.tour.arrivee - x.tour.depart) * facile(u);
        vitesse = 4 * (1 - u) ** 3;
      }
      disque.current.style.transform = `rotate(${a}deg)`;
      // Le cliquet de l'aiguille, à chaque case qui passe.
      const sous = Math.floor((((-a % 360) + 360) % 360) / DEGRES_CASE_BW);
      if (sous !== derniere) {
        const t = performance.now();
        if (derniere >= 0 && x.phase === 'tour' && t - dernierTic > 45) {
          dernierTic = t;
          jouerEffet('bw_tic', { volume: 0.45 + 0.55 * Math.min(1, 1 - vitesse / 4 + 0.2), vitesse: 0.9 + Math.random() * 0.2 });
        }
        derniere = sous;
      }
    };
    raf = requestAnimationFrame(dessiner);
    return () => cancelAnimationFrame(raf);
  }, [horloges]);

  const cases = useMemo(
    () =>
      ROUE_BW.map((c, i) => {
        const a1 = i * DEGRES_CASE_BW;
        const a2 = a1 + DEGRES_CASE_BW;
        const milieu = a1 + DEGRES_CASE_BW / 2;
        const vis = CASES_VISUELS[c];
        return (
          <g key={i} className={`bw-secteur ${c}`}>
            <path d={secteur(118, 362, a1, a2)} fill={vis.fond} />
            <path d={secteur(118, 362, a1, a2)} className="bw-reflet" />
            {vis.image ? (
              <image href={vis.image} x={-27} y={-327} width={54} height={55} transform={`rotate(${milieu})`} />
            ) : (
              <text transform={`rotate(${milieu}) translate(0 -262) rotate(-90)`} fill={vis.texte} className={`bw-chiffre ${c}`} textAnchor="middle" dominantBaseline="central">
                {fx(GAINS_CHIFFRES_BW[c as 'x1'])}
              </text>
            )}
          </g>
        );
      }),
    [],
  );

  return (
    <div className={`bw-roue ${v.phase}`}>
      <div className="bw-roue-halo" aria-hidden="true" />
      <div className="bw-disque" ref={disque}>
        <svg viewBox="-370 -370 740 740" aria-hidden="true">
          <circle r="366" fill="#1a0f08" />
          {cases}
          {ROUE_BW.map((_, i) => (
            <line key={i} x1="0" y1="-118" x2="0" y2="-363" transform={`rotate(${i * DEGRES_CASE_BW})`} className="bw-filet" />
          ))}
          {boosts.map((b, k) => (
            <g key={`${v.numero}-${b.i}`} className={`bw-boost ${b.dore ? 'dore' : ''} ${b.x >= 25 ? 'enorme' : b.x >= 10 ? 'gros' : ''}`} style={{ '--k': k } as CSSProperties}>
              <path d={secteur(118, 362, b.i * DEGRES_CASE_BW, (b.i + 1) * DEGRES_CASE_BW)} />
              <g transform={`rotate(${b.i * DEGRES_CASE_BW + DEGRES_CASE_BW / 2}) translate(0 -168)`}>
                <g className="bw-boost-medaille">
                  <circle r="42" />
                  <text textAnchor="middle" dominantBaseline="central">
                    ×{b.x}
                  </text>
                </g>
              </g>
            </g>
          ))}
          {gagnante !== null && <path className="bw-gagnante" d={secteur(118, 362, gagnante * DEGRES_CASE_BW, (gagnante + 1) * DEGRES_CASE_BW)} />}
          <circle r="120" className="bw-anneau" />
        </svg>
      </div>
      <img className="bw-cerclage" src="/cartes/bw-cerclage.webp" alt="" draggable={false} />
      <img className="bw-centre" src="/cartes/bw-centre.webp" alt="" draggable={false} />
      <img className="bw-aiguille" src="/cartes/bw-aiguille.webp" alt="" draggable={false} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Les jackpots, l'historique, le journal

function Jackpots() {
  return (
    <div className="bw-jackpots" aria-label={tr('Les jackpots', 'The jackpots')}>
      {JACKPOTS_BW.map((j) => (
        <div key={j} className={`bw-jackpot ${j}`}>
          <img src={`/cartes/bw-plaque-${j}.webp`} alt="" draggable={false} />
          <span>
            <small>{NOMS_JACKPOTS[j]}</small>
            <strong>{fx(VALEUR_JACKPOT_BW[j])}</strong>
          </span>
        </div>
      ))}
    </div>
  );
}

function Pastille({ c, x }: { c: CaseBW; x?: number }) {
  const vis = CASES_VISUELS[c];
  return (
    <span className={`bw-pastille ${c} ${x ? 'multipliee' : ''}`} style={{ '--fond': vis.fond, '--texte': vis.texte } as CSSProperties} title={nomCase(c)}>
      {vis.image ? <img src={vis.image} alt={nomCase(c)} /> : fx(GAINS_CHIFFRES_BW[c as 'x1'])}
      {x ? <i>×{x}</i> : null}
    </span>
  );
}

/** Les multiplicateurs de la manche, en clair : « ×10 sur un 5X · ×3 sur le Baron… ». */
function ListeMultiplicateurs({ boosts }: { boosts: BoostBW[] }) {
  return (
    <span className="bw-liste-multi">
      {boosts.map((b) => (
        <span key={b.i} className={`bw-multi ${b.dore ? 'dore' : ''} ${b.x >= 25 ? 'enorme' : b.x >= 10 ? 'gros' : ''}`}>
          <b>×{b.x}</b>
          <Pastille c={ROUE_BW[b.i]} />
        </span>
      ))}
    </span>
  );
}

function Journal({ appel, onFermer }: { appel: Appel; onFermer: () => void }) {
  const [j, setJ] = useState<JournalBW | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  useEffect(() => {
    void appel('casino_bw_journal').then((r) => {
      const x = r as unknown as { ok: boolean; journal?: JournalBW; erreur?: string };
      if (x.ok && x.journal) setJ(x.journal);
      else setErreur(x.erreur ?? tr('Historique indisponible.', 'History unavailable.'));
    });
  }, [appel]);
  const heure = (t: number) => new Date(t).toLocaleTimeString(EN ? 'en-GB' : 'fr-FR', { hour: '2-digit', minute: '2-digit' });
  return (
    <div className="bw-fenetre" role="dialog" aria-modal="true" aria-label={tr('Historique', 'History')} onClick={onFermer}>
      <div className="bw-fenetre-boite" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>{tr('Historique et statistiques', 'History and statistics')}</h2>
          <button type="button" onClick={onFermer} aria-label={tr('Fermer', 'Close')}>
            ✕
          </button>
        </header>
        {!j ? (
          <p className="discret">{erreur ?? tr('Chargement…', 'Loading…')}</p>
        ) : (
          <>
            <section className="bw-stats">
              <div>
                <small>{tr('Mes manches', 'My rounds')}</small>
                <strong>{j.moi.manches}</strong>
              </div>
              <div>
                <small>{tr('Misé', 'Bet')}</small>
                <strong>{dollars(j.moi.mise)}</strong>
              </div>
              <div>
                <small>{tr('Gagné', 'Won')}</small>
                <strong>{dollars(j.moi.gain)}</strong>
              </div>
              <div>
                <small>{tr('Résultat', 'Net')}</small>
                <strong className={j.moi.gain - j.moi.mise >= 0 ? 'plus' : 'moins'}>
                  {j.moi.gain - j.moi.mise >= 0 ? '+' : '−'}
                  {dollars(Math.abs(j.moi.gain - j.moi.mise))}
                </strong>
              </div>
            </section>
            <section className="bw-stats salon">
              <div>
                <small>{tr('Manches du salon', 'Lounge rounds')}</small>
                <strong>{j.salon.manches}</strong>
              </div>
              {BONUS_BW.map((b) => (
                <div key={b}>
                  <small>
                    <Pastille c={b} /> {tr(...CASES_VISUELS[b].nom)}
                  </small>
                  <strong>{j.salon.cases[b]}</strong>
                </div>
              ))}
              <div>
                <small>{tr('Jackpots', 'Jackpots')}</small>
                <strong>{JACKPOTS_BW.reduce((s, k) => s + j.salon.jackpots[k], 0)}</strong>
              </div>
            </section>
            <h3>{tr('Mes 20 dernières manches', 'My last 20 rounds')}</h3>
            {j.manches.length ? (
              <ol className="bw-journal">
                {j.manches.map((m) => (
                  <li key={m.numero}>
                    <span>{heure(m.t)}</span>
                    <Pastille c={m.c} />
                    <span>{dollars(m.mise)}</span>
                    <strong className={m.gain - m.mise >= 0 ? 'plus' : 'moins'}>
                      {m.gain - m.mise >= 0 ? '+' : '−'}
                      {dollars(Math.abs(m.gain - m.mise))}
                      {m.jackpot && <em>{NOMS_JACKPOTS[m.jackpot]}</em>}
                    </strong>
                    <span className="bw-journal-solde">{dollars(m.solde)}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="discret">{tr('Tu n’as pas encore joué de manche.', 'You have not played a round yet.')}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Les bonus

interface PropsBonus {
  v: VueBW;
  b: VueBonusBW;
  /** Nom de l'étape en cours, rang de choix de l'étape (ou -1), et choisir. */
  nom: string;
  rang: number;
  ouvert: boolean;
  choisir: (o: number) => void;
}

const etiquetteRecompense = (r: RecompenseBW) => (r.jackpot ? NOMS_JACKPOTS[r.jackpot] : fx(r.x));

/** LE CHOIX DU BARON : les rideaux s'ouvrent, le Baron présente trois cartes dorées. */
function BonusBaron({ b, nom, ouvert, choisir }: PropsBonus) {
  const choix = b.mesChoix[0];
  const revele = nom === 'revele' || !!b.cartes?.[0];
  return (
    <div className={`bw-scene bw-baron ${nom}`}>
      <div className="bw-rideaux" aria-hidden="true">
        <img className="gauche" src="/cartes/bw-rideau.webp" alt="" />
        <img className="droite" src="/cartes/bw-rideau.webp" alt="" />
      </div>
      <img className="bw-perso-baron" src="/cartes/bw-baron.webp" alt="" draggable={false} />
      <div className="bw-cartes">
        {[0, 1, 2].map((k) => {
          const r = b.cartes?.[k] ?? null;
          return (
            <button
              key={k}
              type="button"
              className={`bw-carte ${choix === k ? 'choisie' : ''} ${revele && r ? 'retournee' : ''} ${r?.jackpot ? 'jackpot' : ''}`}
              style={{ '--retard': `${choix === k ? 0 : 500 + k * 220}ms` } as CSSProperties}
              onClick={() => choisir(k)}
              disabled={!ouvert || choix !== null}
              aria-label={tr(`Carte ${k + 1}`, `Card ${k + 1}`)}
            >
              <span className="bw-carte-dos">
                <img src="/cartes/bw-carte-dos.webp" alt="" draggable={false} />
              </span>
              <span className="bw-carte-face">
                <img src="/cartes/bw-carte-face.webp" alt="" draggable={false} />
                {r && (
                  <b>
                    {r.jackpot && <small>JACKPOT</small>}
                    {etiquetteRecompense(r)}
                    {r.jackpot && <small>{fx(r.x)}</small>}
                  </b>
                )}
              </span>
              {b.choixSalon[0]?.[k] ? <i className="bw-nb-choix">{b.choixSalon[0][k]}</i> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** THE BIG THEFT : le Pickpocket vole un gros multiplicateur et le cache dans l'une des trois mallettes. */
function BonusPickpocket({ b, nom, ouvert, choisir }: PropsBonus) {
  const choix = b.mesChoix[0];
  const revele = nom === 'revele' || !!b.mallettes?.[0];
  return (
    <div className={`bw-scene bw-pick ${nom}`}>
      <img className="bw-perso-pick" src="/cartes/bw-pickpocket.webp" alt="" draggable={false} />
      {b.butin != null && !revele && (
        <div className="bw-butin" aria-live="polite">
          <small>{tr('Il vole', 'He steals')}</small>
          <strong>{fx(b.butin)}</strong>
        </div>
      )}
      <div className={`bw-mallettes ${nom === 'vol' ? 'melange' : ''}`}>
        {[0, 1, 2].map((k) => {
          const x = b.mallettes?.[k] ?? null;
          const estButin = revele && x !== null && x === b.butin;
          return (
            <button key={k} type="button" className={`bw-mallette ${choix === k ? 'choisie' : ''} ${revele ? 'ouverte' : ''} ${estButin ? 'butin' : ''}`} style={{ '--k': k } as CSSProperties} onClick={() => choisir(k)} disabled={!ouvert || choix !== null} aria-label={tr(`Mallette ${k + 1}`, `Briefcase ${k + 1}`)}>
              <img src={revele ? '/cartes/bw-mallette-ouverte.webp' : '/cartes/bw-mallette.webp'} alt="" draggable={false} />
              {revele && x !== null && (
                <b>
                  {estButin && <small>{tr('Le butin', 'The loot')}</small>}
                  {fx(x)}
                </b>
              )}
              {b.choixSalon[0]?.[k] ? <i className="bw-nb-choix">{b.choixSalon[0][k]}</i> : null}
            </button>
          );
        })}
        {nom === 'vol' && <span className="bw-fumee" aria-hidden="true" />}
      </div>
    </div>
  );
}

/** La voiture du Baron, et la police à ses trousses (gyrophare). */
function Voitures() {
  return (
    <>
      <span className="bw-voiture police">
        <img src="/cartes/bw-voiture-police.webp" alt="" draggable={false} />
        <i className="bw-gyro" />
      </span>
      <span className="bw-voiture baron">
        <img src="/cartes/bw-voiture-baron.webp" alt="" draggable={false} />
        <i className="bw-fumee-pot" />
      </span>
    </>
  );
}

/** LA GRANDE ÉVASION : trois itinéraires, puis la course-poursuite dans Paris. */
function BonusEvasion({ b, nom, ouvert, choisir, v }: PropsBonus) {
  const choix = b.mesChoix[0];
  // Ce que l'écran suit : mon itinéraire, sinon le plus choisi du salon.
  const salon = b.choixSalon[0] ?? [0, 0, 0];
  const suivi = choix ?? salon.indexOf(Math.max(...salon));
  const route = ROUTES_BW[suivi < 0 ? 0 : suivi];
  const issue = b.routes?.[ROUTES_BW.indexOf(route)] ?? null;
  const enRoute = nom === 'poursuite' || nom === 'revele';
  return (
    <div className={`bw-scene bw-evasion ${nom} ${enRoute ? route : ''} ${issue ? (issue.evade ? 'evade' : 'arrete') : ''}`} style={enRoute ? ({ '--duree': `${v.duree ?? 9000}ms` } as CSSProperties) : undefined}>
      {enRoute ? (
        <div className="bw-defile" aria-hidden="true">
          <div className="bw-route-fond">
            <img src={`/cartes/bw-route-${route}.webp`} alt="" draggable={false} />
            <img src={`/cartes/bw-route-${route}.webp`} alt="" draggable={false} />
          </div>
          {[1, 2, 3, 4].map((k) => (
            <img key={k} className={`bw-obstacle o${k}`} src={`/cartes/bw-obstacle-${k}.webp`} alt="" draggable={false} />
          ))}
          <Voitures />
        </div>
      ) : (
        <div className="bw-depart" aria-hidden="true">
          <Voitures />
        </div>
      )}
      {nom === 'route' && (
        <div className="bw-routes">
          {ROUTES_BW.map((r, k) => {
            const it = ITINERAIRES_BW[r];
            const gains = it.gains.map(([x]) => x);
            return (
              <button key={r} type="button" className={`bw-route ${r} ${choix === k ? 'choisie' : ''}`} onClick={() => choisir(k)} disabled={!ouvert || choix !== null}>
                <span className="bw-route-vignette" style={{ backgroundImage: `url(/cartes/bw-route-${r}.webp)` }} />
                <strong>{tr(...NOMS_ROUTES[r].nom)}</strong>
                <small>
                  {tr(...NOMS_ROUTES[r].risque)} · {tr(`arrestation ${Math.round(it.arrestation * 100)} %`, `${Math.round(it.arrestation * 100)}% arrest`)}
                </small>
                <em>
                  {fx(Math.min(...gains))} → {fx(Math.max(...gains))}
                </em>
                {b.choixSalon[0]?.[k] ? <i className="bw-nb-choix">{b.choixSalon[0][k]}</i> : null}
              </button>
            );
          })}
        </div>
      )}
      {nom === 'revele' && issue && (
        <div className={`bw-issue ${issue.evade ? 'evade' : 'arrete'}`}>
          <img src={issue.evade ? '/cartes/bw-baron-evade.webp' : '/cartes/bw-gendarme.webp'} alt="" draggable={false} />
        </div>
      )}
      {nom === 'revele' && b.routes && (
        <ul className="bw-routes-bilan">
          {ROUTES_BW.map((r, k) => {
            const x = b.routes?.[k];
            return (
              <li key={r} className={`${x?.evade ? 'evade' : 'arrete'} ${choix === k ? 'mien' : ''}`}>
                <span>{tr(...NOMS_ROUTES[r].nom)}</span>
                <strong>{x?.evade ? fx(x.x) : tr('arrêté', 'caught')}</strong>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Trois combinaisons pour la première serrure (les mêmes pour tout le salon). */
function combinaisons(numero: number): string[] {
  let s = (numero * 2654435761) >>> 0;
  const n = () => {
    s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
    return String(s % 100).padStart(2, '0');
  };
  return [0, 1, 2].map(() => `${n()}-${n()}-${n()}`);
}

/** Le cadran du mécanisme : il tourne ; on l'arrête au jugé sur l'une des 8 zones cachées. */
function Cadran({ b, nom, ouvert, choisir, rang }: PropsBonus & { rang: number }) {
  const disque = useRef<HTMLDivElement>(null);
  const angle = useRef(Math.random() * 360);
  const choix = b.mesChoix[1];
  const tourne = nom === 'mecanisme' && choix === null;
  useEffect(() => {
    if (!tourne) return;
    let raf = 0;
    let t0 = performance.now();
    const f = (t: number) => {
      raf = requestAnimationFrame(f);
      angle.current = (angle.current + ((t - t0) / 1000) * 150) % 360;
      t0 = t;
      if (disque.current) disque.current.style.transform = `rotate(${angle.current}deg)`;
    };
    raf = requestAnimationFrame(f);
    return () => cancelAnimationFrame(raf);
  }, [tourne]);
  // Choisi (par moi ou par le serveur) : le cadran se pose au milieu de la zone.
  useEffect(() => {
    if (choix === null || !disque.current) return;
    const cible = -(choix * 45 + 22.5);
    angle.current = cible;
    disque.current.style.transform = `rotate(${cible}deg)`;
  }, [choix]);
  const arreter = () => {
    if (!ouvert || choix !== null) return;
    // La zone sous le repère (en haut) : celle qui a tourné jusque-là.
    const a = (((-angle.current % 360) + 360) % 360) / 45;
    choisir(Math.floor(a) % 8);
  };
  const zones = b.meca ?? Array(8).fill(null);
  return (
    <div className={`bw-cadran-bloc ${nom === 'mecanisme' || nom === 'mecaRevele' ? 'visible' : ''}`}>
      <span className="bw-repere" aria-hidden="true">
        ▼
      </span>
      <div className="bw-cadran" ref={disque} onClick={nom === 'mecanisme' ? arreter : undefined}>
        <svg viewBox="-100 -100 200 200" aria-hidden="true">
          {zones.map((z, k) => (
            <g key={k}>
              <path d={secteur(70, 98, k * 45, (k + 1) * 45)} className={`bw-zone ${z === null ? 'cachee' : `x${z}`} ${choix === k && z !== null ? 'mienne' : ''}`} />
              <text transform={`rotate(${k * 45 + 22.5}) translate(0 -84)`} textAnchor="middle" dominantBaseline="central">
                {z === null ? '?' : `×${z}`}
              </text>
            </g>
          ))}
        </svg>
        <img src="/cartes/bw-cadran.webp" alt="" draggable={false} />
      </div>
      {nom === 'mecanisme' && rang >= 0 && (
        <button type="button" className="bw-principal bw-arreter" onClick={arreter} disabled={!ouvert || choix !== null}>
          {choix === null ? tr('Arrêter le cadran', 'Stop the dial') : tr('Cadran arrêté', 'Dial stopped')}
        </button>
      )}
    </div>
  );
}

/** THE VAULT : le code, le mécanisme, le coffre. */
function BonusBraquage(p: PropsBonus) {
  const { b, nom, ouvert, choisir, v } = p;
  const codes = useMemo(() => combinaisons(v.numero), [v.numero]);
  const ouvertCoffre = nom === 'coffre' || nom === 'revele';
  return (
    <div className={`bw-scene bw-braquage ${nom}`}>
      <img className={`bw-porte ${ouvertCoffre ? 'ouverte' : ''}`} src="/cartes/bw-porte-coffre.webp" alt="" draggable={false} />
      {(nom === 'code' || nom === 'codeRevele') && (
        <div className="bw-codes">
          {codes.map((c, k) => {
            const x = b.code?.[k] ?? null;
            return (
              <button key={k} type="button" className={`bw-code ${b.mesChoix[0] === k ? 'choisie' : ''} ${x !== null ? `x${x}` : ''}`} onClick={() => choisir(k)} disabled={!ouvert || b.mesChoix[0] !== null}>
                <strong>{c}</strong>
                {x !== null && <small>{x === 2 ? tr('Parfaite ×2', 'Perfect ×2') : tr('Bonne ×1', 'Good ×1')}</small>}
              </button>
            );
          })}
        </div>
      )}
      {(nom === 'mecanisme' || nom === 'mecaRevele') && <Cadran {...p} rang={p.rang} />}
      {ouvertCoffre && (
        <div className="bw-compartiments">
          {[0, 1, 2, 3].map((k) => {
            const r = b.coffre?.[k] ?? null;
            return (
              <button key={k} type="button" className={`bw-compartiment ${b.mesChoix[2] === k ? 'choisie' : ''} ${r ? 'ouvert' : ''} ${r?.jackpot ? 'jackpot' : ''}`} onClick={() => choisir(k)} disabled={!ouvert || b.mesChoix[2] !== null}>
                <img src={r ? '/cartes/bw-compartiment-ouvert.webp' : '/cartes/bw-compartiment.webp'} alt="" draggable={false} />
                {r && <b>{etiquetteRecompense(r)}</b>}
              </button>
            );
          })}
        </div>
      )}
      <ol className="bw-serrures" aria-label={tr('Les trois serrures', 'The three locks')}>
        <li className={b.code?.some((x) => x !== null) ? 'faite' : nom === 'code' ? 'en-cours' : ''}>
          {tr('Code', 'Code')} {b.mesChoix[0] !== null && b.code?.[b.mesChoix[0]] ? <b>×{b.code[b.mesChoix[0]]}</b> : null}
        </li>
        <li className={b.meca?.some((x) => x !== null) ? 'faite' : nom === 'mecanisme' ? 'en-cours' : ''}>
          {tr('Mécanisme', 'Mechanism')} {b.mesChoix[1] !== null && b.meca?.[b.mesChoix[1]] ? <b>×{b.meca[b.mesChoix[1]]}</b> : null}
        </li>
        <li className={b.coffre?.some((x) => x !== null) ? 'faite' : nom === 'coffre' ? 'en-cours' : ''}>{tr('Coffre', 'Vault')}</li>
      </ol>
    </div>
  );
}

const TEXTES_ETAPES: Record<string, [string, string]> = {
  intro: ['', ''],
  cartes: ['Choisis une carte dorée', 'Pick a golden card'],
  vol: ['Le Pickpocket cache le butin dans l’une des mallettes…', 'The Pickpocket hides the loot in one of the briefcases…'],
  mallettes: ['Où est le butin ? Choisis une mallette', 'Where is the loot? Pick a briefcase'],
  route: ['La police arrive ! Choisis ton itinéraire', 'The police are coming! Pick your route'],
  poursuite: ['La course-poursuite !', 'The car chase!'],
  code: ['Serrure 1 : choisis la combinaison', 'Lock 1: pick the combination'],
  codeRevele: ['La première serrure cède…', 'The first lock gives way…'],
  mecanisme: ['Serrure 2 : arrête le cadran au bon moment', 'Lock 2: stop the dial at the right moment'],
  mecaRevele: ['Le mécanisme tourne…', 'The mechanism turns…'],
  coffre: ['Serrure 3 : choisis un compartiment', 'Lock 3: pick a compartment'],
  revele: ['', ''],
};

function SceneBonus({ v, appel, onErreur }: { v: VueBW; appel: Appel; onErreur: (e: string | null) => void }) {
  const b = v.bonus as VueBonusBW;
  const e = b.etapes[b.etape];
  const nom = v.phase === 'resultat' ? 'revele' : e.nom;
  const rang = e.choix ? b.etapes.slice(0, b.etape).filter((x) => x.choix > 0).length : -1;
  const ouvert = v.phase === 'bonus' && rang >= 0 && b.mise > 0 && b.mesChoix[rang] === null;
  const choisir = (o: number) => {
    if (!ouvert) return;
    jouerEffet(b.type === 'baron' ? 'bw_carte' : 'jeton');
    void appel('casino_bw_choisir', { etape: b.etape, choix: o }).then((r) => onErreur(r.ok ? null : (r.erreur ?? tr('Choix impossible.', 'Choice not allowed.'))));
  };
  const props: PropsBonus = { v, b, nom, rang, ouvert, choisir };
  const texte = TEXTES_ETAPES[nom]?.[EN ? 1 : 0] ?? '';
  const r = b.resultat;
  return (
    <div className={`bw-bonus ${b.type}`}>
      {b.type === 'baron' && <BonusBaron {...props} />}
      {b.type === 'pickpocket' && <BonusPickpocket {...props} />}
      {b.type === 'evasion' && <BonusEvasion {...props} />}
      {b.type === 'braquage' && <BonusBraquage {...props} />}
      <div className="bw-bonus-titre">
        <img src={CASES_VISUELS[b.type].image} alt="" />
        <strong>{tr(...NOMS_BONUS[b.type])}</strong>
        {b.multiplicateur > 1 && <em className="bw-bonus-multi">×{b.multiplicateur}</em>}
      </div>
      {b.multiplicateur > 1 && nom === 'intro' && (
        <div className="bw-bonus-annonce-multi" role="status">
          <small>{tr('Multiplicateur de la roue', 'Wheel multiplier')}</small>
          <strong>×{b.multiplicateur}</strong>
          <span>{tr('Tous les gains de ce bonus sont multipliés !', 'Every win in this bonus is multiplied!')}</span>
        </div>
      )}
      {nom !== 'revele' && nom !== 'intro' && (
        <div className="bw-bonus-consigne">
          <span>{texte}</span>
          {rang >= 0 && (b.mise > 0 ? b.mesChoix[rang] !== null ? <small>{tr('Choix fait : on attend les autres…', 'Done: waiting for the others…')}</small> : <small>{tr(`Ta mise : ${dollars(b.mise)}`, `Your bet: ${dollars(b.mise)}`)}</small> : <small>{tr('Tu regardes : tu n’as pas misé sur ce bonus.', 'Watching: you did not bet on this bonus.')}</small>)}
          {v.phase === 'bonus' && <Barre v={v} cle={`${v.numero}-${b.etape}`} />}
        </div>
      )}
      {nom === 'revele' && b.mise > 0 && r && (
        <div className={`bw-bonus-resultat ${r.gain > 0 ? 'gagne' : 'perdu'} ${r.jackpot ? 'jackpot' : ''}`} role="status">
          {r.jackpot && <img src={`/cartes/bw-plaque-${r.jackpot}.webp`} alt="" />}
          <small>{r.jackpot ? `JACKPOT ${NOMS_JACKPOTS[r.jackpot]}` : b.type === 'evasion' ? (r.evade ? tr('Évadé !', 'Escaped!') : tr('Arrêté !', 'Caught!')) : tr('Ta récompense', 'Your reward')}</small>
          <strong>{r.gain > 0 ? `${fx(r.x)} · +${dollars(r.gain)}` : tr('Pas de butin cette fois', 'No loot this time')}</strong>
          {r.gain > 0 && !r.jackpot && b.multiplicateur > 1 && <em>{tr(`${fx(r.x / b.multiplicateur)} × ${b.multiplicateur} (multiplicateur de la roue)`, `${fx(r.x / b.multiplicateur)} × ${b.multiplicateur} (wheel multiplier)`)}</em>}
        </div>
      )}
      {nom === 'revele' && !b.mise && <div className="bw-bonus-resultat spectateur">{tr('Mise sur ce bonus à la prochaine manche pour jouer !', 'Bet on this bonus next round to play!')}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// L'écran

export function JeuBaronWheel({ vue, appel, onRetour }: { vue: VueCasino; appel: Appel; onRetour: () => void }) {
  const [v, setV] = useState<VueBW | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [journal, setJournal] = useState(false);
  const [jeton, setJeton] = useState<number>(() => {
    try {
      const x = Number(localStorage.getItem(CLE_JETON));
      return JETONS_BW.includes(x) ? x : JETONS_BW[1];
    } catch {
      return JETONS_BW[1];
    }
  });
  const [pluie, setPluie] = useState<{ n: number; id: number } | null>(null);
  /** Mode automatique : mes mises rejouées à chaque manche, pour un nombre de manches choisi. */
  const [auto, setAuto] = useState({ actif: false, restants: 0 });
  const [choixAuto, setChoixAuto] = useState(false);
  const autoRef = useRef(auto);
  autoRef.current = auto;
  const autoManche = useRef(-1);
  const minuterieAuto = useRef(0);
  useEffect(() => () => window.clearTimeout(minuterieAuto.current), []);
  const [credit, setCredit] = useState<{ montant: number; id: number } | null>(null);
  const [fete, setFete] = useState<{ jackpot: JackpotBW; gain: number; id: number } | null>(null);
  const minuteries = useRef<number[]>([]);
  const plusTard = (f: () => void, ms: number) => minuteries.current.push(window.setTimeout(f, ms));
  useEffect(() => () => minuteries.current.forEach((m) => window.clearTimeout(m)), []);
  const solde = useSoldeAnime(v?.solde ?? vue.solde);
  const horloges = useRef<HorlogesRoue>({ v: null, debut: null, numero: -1 });
  const [finPhase, setFinPhase] = useState<number | null>(null);

  useEffect(() => window.scrollTo(0, 0), []);
  useEffect(() => {
    try {
      localStorage.setItem(CLE_JETON, String(jeton));
    } catch {
      /* préférence non gardée */
    }
  }, [jeton]);

  useEffect(() => {
    let vivant = true;
    const entrer = async (essai = 0): Promise<void> => {
      const r = (await appel('casino_bw_entrer')) as { ok: boolean; erreur?: string; roue?: VueBW };
      if (!vivant) return;
      if (r.ok && r.roue) {
        setErreur(null);
        return setV(r.roue);
      }
      if (essai < 5) return void window.setTimeout(() => void entrer(essai + 1), 1200);
      setErreur(r.erreur ?? tr('La roue est indisponible pour le moment.', 'The wheel is unavailable right now.'));
    };
    void entrer();
    const surVue = (x: VueBW) => setV(x);
    const surConnexion = () => window.setTimeout(() => void entrer(), 2600);
    socket.on('casino_bw', surVue);
    socket.on('connect', surConnexion);
    return () => {
      vivant = false;
      socket.off('casino_bw', surVue);
      socket.off('connect', surConnexion);
      socket.emit('casino_bw_quitter');
    };
  }, [appel]);

  // Chaque vue recale l'horloge de la roue, et lance les sons et les fêtes des changements de phase.
  const precedente = useRef<VueBW | null>(null);
  useEffect(() => {
    if (!v) return;
    const h = horloges.current;
    const maintenant = performance.now();
    if (v.numero !== h.numero || v.phase !== 'tour') h.debut = null;
    if (v.tour) {
      const estime = maintenant - v.tour.ecoule;
      h.debut = h.debut === null ? estime : Math.min(h.debut, estime);
    }
    h.numero = v.numero;
    h.v = v;
    setFinPhase(v.reste === null ? null : Date.now() + v.reste);

    const avant = precedente.current;
    precedente.current = v;
    if (!avant) return;
    const etapeNom = (x: VueBW) => (x.bonus ? x.bonus.etapes[x.bonus.etape].nom : '');
    const change = avant.numero !== v.numero || avant.phase !== v.phase || etapeNom(avant) !== etapeNom(v);
    if (!change) return;
    if (v.phase === 'multiplicateurs') jouerEffet('bw_multi');
    if (v.phase === 'tour') jouerEffet('bw_lancer');
    if (avant.phase === 'tour' && v.phase !== 'tour') jouerEffet('bw_arret');
    if (v.phase === 'bonus' && v.bonus) {
      const n = etapeNom(v);
      if (n === 'intro') jouerEffet(v.bonus.type === 'baron' ? 'bw_baron' : v.bonus.type === 'pickpocket' ? 'bw_vol' : v.bonus.type === 'evasion' ? 'bw_sirene' : 'bw_coffre');
      if (n === 'poursuite') jouerEffet('bw_sirene');
      if (n === 'codeRevele' || n === 'mecaRevele') jouerEffet('bw_cadran');
      if (n === 'coffre') jouerEffet('bw_coffre');
      if (n === 'revele') {
        if (v.bonus.type === 'baron') jouerEffet('bw_carte');
        if (v.bonus.type === 'evasion') {
          const c = v.bonus.mesChoix[0];
          const r = c !== null ? v.bonus.routes?.[c] : null;
          if (r) jouerEffet(r.evade ? 'bw_evade' : 'bw_menottes');
        }
      }
    }
    if (v.phase === 'resultat' && avant.phase !== 'resultat' && v.bilan && v.bilan.mise > 0) {
      const { mise, gain } = v.bilan;
      const jp = v.bonus?.resultat?.jackpot;
      if (gain > 0) {
        setCredit({ montant: gain, id: Date.now() });
        plusTard(() => setCredit(null), 2700);
      }
      if (jp) {
        jouerEffet('bw_jackpot');
        setFete({ jackpot: jp, gain, id: Date.now() });
        plusTard(() => setFete(null), 5200);
      } else if (gain >= 10 * mise && gain >= 500_000) jouerEffet('bw_gros');
      else if (gain > 0) jouerEffet('bw_gain');
      else jouerEffet('bw_perdu');
      if ((jp || gain >= 10 * mise) && gain > 0 && !mouvementReduit()) {
        setPluie({ n: jp ? 60 : gain >= 50 * mise ? 46 : 28, id: Date.now() });
        plusTard(() => setPluie(null), 3800);
      }
    }
  }, [v]);

  // Mode automatique : dès que les mises ouvrent, on rejoue celles de la manche d'avant (sauf si j'ai déjà misé).
  useEffect(() => {
    if (!v || !auto.actif || v.phase !== 'mises' || (v.reste ?? 0) < 1500 || autoManche.current === v.numero) return;
    autoManche.current = v.numero;
    if (Object.values(v.mesMises).some((x) => x)) return;
    if (!v.peutRefaire) {
      setAuto({ actif: false, restants: 0 });
      return;
    }
    window.clearTimeout(minuterieAuto.current);
    minuterieAuto.current = window.setTimeout(async () => {
      if (!autoRef.current.actif) return;
      const r = await appel('casino_bw_refaire');
      if (r.ok) {
        jouerEffet('jeton');
        setAuto((a) => (a.actif ? { actif: a.restants - 1 > 0, restants: a.restants - 1 } : a));
      } else {
        setAuto({ actif: false, restants: 0 });
        setErreur(tr(`Mode auto arrêté : ${r.erreur ?? 'mise impossible.'}`, `Auto play stopped: ${r.erreur ?? 'bet not allowed.'}`));
      }
    }, 650);
  }, [v, auto.actif, appel]);

  const secondes = useSecondes(v?.phase === 'mises' ? finPhase : null);
  const ouvertes = !!v && v.phase === 'mises' && (v.reste ?? 0) > 0;
  const maMise = v ? Object.values(v.mesMises).reduce((s: number, x) => s + (x ?? 0), 0) : 0;
  const envoyer = async (evt: string, data?: unknown) => {
    setErreur(null);
    const r = await appel(evt, data);
    if (!r.ok) setErreur(r.erreur ?? tr('Action impossible.', 'Action not allowed.'));
    return r.ok;
  };
  const miser = async (c: CaseBW) => {
    if (!v || !ouvertes) return;
    if (jeton > v.solde) return setErreur(tr('Solde insuffisant pour ce jeton.', 'Not enough money for this chip.'));
    if (await envoyer('casino_bw_miser', { case: c, montant: jeton })) jouerEffet('jeton');
  };

  let statut: ReactNode = tr('La roue se prépare…', 'The wheel is getting ready…');
  const multiArret = v ? (v.multiplicateurs?.find((b) => b.i === v.arret)?.x ?? 1) : 1;
  if (v) {
    const c = v.arret !== null ? ROUE_BW[v.arret] : null;
    if (v.phase === 'mises') statut = <strong>{tr(`Faites vos jeux · ${secondes} s`, `Place your bets · ${secondes} s`)}</strong>;
    else if (v.phase === 'multiplicateurs')
      statut = (
        <>
          <strong className="bw-statut-multi">{tr('Rien ne va plus : les multiplicateurs !', 'No more bets: the multipliers!')}</strong>
          {v.multiplicateurs && <ListeMultiplicateurs boosts={v.multiplicateurs} />}
        </>
      );
    else if (v.phase === 'tour')
      statut = (
        <>
          <strong>{tr('La roue tourne…', 'The wheel is spinning…')}</strong>
          {v.multiplicateurs && <ListeMultiplicateurs boosts={v.multiplicateurs} />}
        </>
      );
    else if (c && v.phase === 'bonus') statut = <strong>{tr(`Bonus : ${tr(...NOMS_BONUS[c as BonusBW])} !`, `Bonus: ${tr(...NOMS_BONUS[c as BonusBW])}!`)}</strong>;
    else if (c)
      statut = (
        <strong className="bw-statut-resultat">
          <Pastille c={c} x={multiArret > 1 ? multiArret : undefined} />
          {estBonusBW(c) ? tr(...NOMS_BONUS[c]) : tr(`La case ${CASES_VISUELS[c].nom[0]} paie ${fx(GAINS_CHIFFRES_BW[c] * multiArret)}`, `${CASES_VISUELS[c].nom[1]} pays ${fx(GAINS_CHIFFRES_BW[c] * multiArret)}`)}
          {multiArret > 1 ? <em>{tr(`Multiplicateur ×${multiArret} !`, `Multiplier ×${multiArret}!`)}</em> : null}
        </strong>
      );
  }
  const enBonus = !!v?.bonus && (v.phase === 'bonus' || v.phase === 'resultat');
  const gagnante = v && v.arret !== null && v.phase === 'resultat' ? ROUE_BW[v.arret] : null;

  return (
    <div className={`cas-ecran bw-ecran ${enBonus ? 'en-bonus' : ''}`} data-phase={v?.phase ?? 'mises'}>
      <header className="cas-barre">
        <button type="button" className="cas-retour" onClick={onRetour}>
          ‹ {tr('Salon', 'Lounge')}
        </button>
        <h1 className="bw-titre">
          <img src="/cartes/bw-logo.webp" alt="The Baron’s Wheel" draggable={false} />
        </h1>
        <span className={`cas-solde-petit bw-solde ${credit ? 'credite' : ''}`}>
          {dollars(solde)}
          {credit && (
            <b key={credit.id} className="bw-credit">
              +{dollars(credit.montant)}
            </b>
          )}
        </span>
      </header>

      {v?.ouverture ? (
        <p className="bw-ouverture" role="status">
          <strong>{tr('Grande ouverture', 'Grand opening')}</strong>
          <span>{tr('Un multiplicateur doré ×2 en plus à chaque manche · XP ×2 sur la roue', 'An extra golden ×2 multiplier every round · XP ×2 on the wheel')}</span>
        </p>
      ) : null}

      <div className="bw-droite">
      <Jackpots />

      <div className="bw-ligne-historique">
        <ol className="bw-historique" aria-label={tr('Les derniers résultats', 'Latest results')}>
          {(v?.historique ?? []).map((h, k) => (
            <li key={`${v?.numero}-${k}`}>
              <Pastille c={h.c} x={h.x} />
            </li>
          ))}
        </ol>
        <button type="button" className="bw-bouton-journal" onClick={() => setJournal(true)}>
          {tr('Historique', 'History')}
        </button>
      </div>
      </div>

      <div className="bw-gauche">
      <div className="bw-plateau">
        {v && (enBonus ? <SceneBonus v={v} appel={appel} onErreur={setErreur} /> : <Roue v={v} horloges={horloges} />)}
        {!v && <div className="chargement">{erreur ?? tr('La roue arrive…', 'The wheel is coming…')}</div>}
        <span className="bw-direct">
          {tr('En direct', 'Live')}
          {v ? ` · ${v.spectateurs}` : ''}
        </span>
      </div>

      <div className="bw-statut" role="status">
        {statut}
        {v?.phase === 'mises' && <Barre v={v} cle={`m${v.numero}`} />}
      </div>

      {v?.bilan && v.bilan.mise > 0 && (
        <div className={`bw-bilan ${v.bilan.gain > v.bilan.mise ? 'gagne' : v.bilan.gain > 0 ? 'rendu' : 'perdu'}`}>
          <span>
            <small>{tr('Mises', 'Bets')}</small>
            {dollars(v.bilan.mise)}
          </span>
          <span>
            <small>{tr('Gains', 'Winnings')}</small>
            {dollars(v.bilan.gain)}
          </span>
          <span>
            <small>{tr('Résultat', 'Net')}</small>
            {v.bilan.gain - v.bilan.mise >= 0 ? '+' : '−'}
            {dollars(Math.abs(v.bilan.gain - v.bilan.mise))}
          </span>
          <span>
            <small>{tr('Solde', 'Balance')}</small>
            {dollars(v.solde)}
          </span>
        </div>
      )}

      </div>

      <div className="bw-droite bas">
      <section className="bw-commandes" role="group" aria-label={tr('Tes mises', 'Your bets')}>
        <div className="bw-tapis">
          {CASES_BW.map((c) => {
            const vis = CASES_VISUELS[c];
            const m = v?.mesMises[c] ?? 0;
            const multis = (v?.multiplicateurs ?? []).filter((b) => ROUE_BW[b.i] === c).map((b) => b.x);
            return (
              <button key={c} type="button" className={`bw-case ${c} ${m ? 'misee' : ''} ${gagnante === c ? 'gagnante' : ''} ${multis.length ? 'multipliee' : ''}`} style={{ '--fond': vis.fond, '--texte': vis.texte } as CSSProperties} onClick={() => void miser(c)} disabled={!ouvertes} aria-label={`${tr(...vis.nom)} ${m ? dollars(m) : ''}`}>
                {vis.image ? <img src={vis.image} alt="" draggable={false} /> : <strong>{fx(GAINS_CHIFFRES_BW[c as 'x1'])}</strong>}
                <span className="bw-case-nom">{estBonusBW(c) ? tr(...vis.nom) : tr(`case ${vis.nom[0]}`, `${vis.nom[1]} spot`)}</span>
                {m > 0 && (
                  <span className="bw-case-mise">
                    <img src={`/cartes/jeton-${imageJeton(m)}.webp`} alt="" />
                    {court(m)}
                  </span>
                )}
                {multis.length > 0 && <span className="bw-case-multi">{multis.map((x) => `×${x}`).join(' ')}</span>}
              </button>
            );
          })}
        </div>
        <div className="bj-jetons">
          {JETONS_BW.map((j) => (
            <button key={j} type="button" className={`bj-jeton ${j === jeton ? 'choisi' : ''}`} onClick={() => (setJeton(j), jouerEffet('jeton'))} disabled={!!v && j > v.solde && j !== jeton} aria-pressed={j === jeton} aria-label={dollars(j)}>
              <img src={`/cartes/jeton-${imageJeton(j)}.webp`} alt="" />
              <span>{court(j)}</span>
            </button>
          ))}
        </div>
        <p className="bj-mise-encours bw-mise">
          {tr('Ta mise', 'Your bet')} <strong>{dollars(maMise)}</strong>
          <small>{tr(`Au plus ${court(MAX_CASE_BW)} par case, ${court(MAX_MANCHE_BW)} par manche`, `At most ${court(MAX_CASE_BW)} per spot, ${court(MAX_MANCHE_BW)} per round`)}</small>
        </p>
        {choixAuto && !auto.actif ? (
          <div className="bj-boutons bw-auto-choix" role="group" aria-label={tr('Mode automatique', 'Auto play')}>
            <span>{tr('Rejouer mes mises pendant', 'Repeat my bets for')}</span>
            {CHOIX_AUTO.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => {
                  jouerEffet('jeton');
                  setChoixAuto(false);
                  autoManche.current = -1;
                  setAuto({ actif: true, restants: n });
                }}
              >
                {n === Infinity ? '∞' : n}
              </button>
            ))}
            <button type="button" className="bw-auto-fermer" onClick={() => setChoixAuto(false)} aria-label={tr('Fermer', 'Close')}>
              ✕
            </button>
          </div>
        ) : (
          <div className="bj-boutons">
            <button type="button" onClick={() => void envoyer('casino_bw_annuler')} disabled={!ouvertes || !maMise}>
              {tr('Annuler', 'Undo')}
            </button>
            <button type="button" onClick={() => void envoyer('casino_bw_annuler', { tout: true })} disabled={!ouvertes || !maMise}>
              {tr('Effacer', 'Clear')}
            </button>
            <button type="button" onClick={() => void envoyer('casino_bw_doubler').then((ok) => ok && jouerEffet('jeton'))} disabled={!ouvertes || !maMise}>
              {tr('Doubler', 'Double')}
            </button>
            <button type="button" className="bj-principal" onClick={() => void envoyer('casino_bw_refaire').then((ok) => ok && jouerEffet('jeton'))} disabled={!ouvertes || !!maMise || !v?.peutRefaire}>
              {tr('Répéter', 'Repeat')}
            </button>
            {auto.actif ? (
              <button type="button" className="bw-auto actif" onClick={() => setAuto({ actif: false, restants: 0 })} aria-label={tr('Arrêter le mode automatique', 'Stop auto play')}>
                Stop · {auto.restants === Infinity ? '∞' : auto.restants}
              </button>
            ) : (
              <button type="button" className="bw-auto" onClick={() => setChoixAuto(true)} disabled={!maMise && !v?.peutRefaire}>
                Auto ▾
              </button>
            )}
          </div>
        )}
        {auto.actif && <p className="bw-auto-etat">{auto.restants === Infinity ? tr('Mode auto : tes mises sont rejouées à chaque manche.', 'Auto play: your bets are repeated every round.') : tr(`Mode auto : encore ${auto.restants} manche${auto.restants > 1 ? 's' : ''}.`, `Auto play: ${auto.restants} more round${auto.restants > 1 ? 's' : ''}.`)}</p>}
        {erreur && v && <p className="cas-erreur">{erreur}</p>}
      </section>

      <aside className="bw-joueurs" aria-label={tr('Cette manche', 'This round')}>
        <h2>
          {tr('Cette manche', 'This round')}
          {v ? <small> · {tr(`manche n° ${v.numero}`, `round #${v.numero}`)}</small> : null}
        </h2>
        {v?.joueurs.length ? (
          <ol>
            {v.joueurs.map((j, k) => (
              <li key={k} className={`${j.moi ? 'moi' : ''} ${j.gain ? 'gagne' : ''}`}>
                <img src={`/cartes/avatar-${j.avatar}.webp`} alt="" />
                <span className="bw-joueur-nom">{j.nom}</span>
                <span className="bw-joueur-mise">{dollars(j.mise)}</span>
                <strong>
                  {j.jackpot && <em>{NOMS_JACKPOTS[j.jackpot]}</em>}
                  {j.gain === null ? '—' : j.gain > 0 ? `+${dollars(j.gain)}` : tr('perdu', 'lost')}
                </strong>
              </li>
            ))}
          </ol>
        ) : (
          <p className="discret">{tr('Personne n’a encore misé sur cette manche.', 'Nobody has bet on this round yet.')}</p>
        )}
        <p className="cas-mention">
          {tr(
            '40 cases, toutes avec la même chance : 12 cases 1X (paient ×2,5), 9 cases 2X (×3,3), 6 cases 5X (×5), 3 cases 10X (×10), et 10 cases bonus : Baron (3), Pickpocket (2), Grande Évasion (2), Braquage (3), qui paient de ×5 à ×500. Une fois les mises fermées, 3 cases reçoivent un multiplicateur de ×2 à ×50. Chaque mise rend environ 95 % en moyenne ; les jackpots (MINI ×25 à GRAND ×500) sont des récompenses fixes cachées dans le Baron et le Braquage.',
            '40 spots, all equally likely: 12 1X spots (pay ×2.5), 9 2X (×3.3), 6 5X (×5), 3 10X (×10), and 10 bonus spots: Baron (3), Pickpocket (2), Great Escape (2), Big Heist (3), paying ×5 to ×500. Once bets close, 3 spots get a ×2 to ×50 multiplier. Every bet returns about 95% on average; the jackpots (MINI ×25 to GRAND ×500) are fixed rewards hidden in the Baron and the Big Heist.',
          )}
        </p>
      </aside>
      </div>

      {journal && <Journal appel={appel} onFermer={() => setJournal(false)} />}
      {fete && (
        <div className={`bw-fete ${fete.jackpot}`} key={fete.id} role="status" onClick={() => setFete(null)}>
          <div className="bw-fete-rayons" aria-hidden="true" />
          <small>JACKPOT</small>
          <span className="bw-fete-plaque">
            <img src={`/cartes/bw-plaque-${fete.jackpot}.webp`} alt="" />
            <strong>{NOMS_JACKPOTS[fete.jackpot]}</strong>
          </span>
          <b>+{dollars(fete.gain)}</b>
        </div>
      )}
      {pluie && <PluieLingots key={`pluie-${pluie.id}`} n={pluie.n} objets={BUTIN_PLUIE} />}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Dans le salon : le bandeau de la grande ouverture

/** « 6 j 23 h », « 5 h 12 », « 34 min ». */
function dureeOuverture(ms: number): string {
  const m = Math.max(1, Math.ceil(ms / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h >= 24) return tr(`${Math.floor(h / 24)} j ${h % 24} h`, `${Math.floor(h / 24)} d ${h % 24} h`);
  return `${h} h ${String(m % 60).padStart(2, '0')}`;
}

export function BandeauOuvertureBW({ vue, onOuvrir }: { vue: VueCasino; onOuvrir: () => void }) {
  const reste = vue.baronWheel?.ouverture ?? null;
  const fin = useMemo(() => (reste === null ? null : Date.now() + reste), [reste]);
  const [, setTic] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTic((x) => x + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);
  if (fin === null || fin <= Date.now()) return null;
  return (
    <button type="button" className="bw-bandeau-ouverture" onClick={onOuvrir}>
      <img src="/cartes/bw-logo.webp" alt="The Baron’s Wheel" draggable={false} />
      <span>
        <em>{tr('Grande ouverture', 'Grand opening')}</em>
        <strong>{tr('La nouvelle roue géante du Baron est ouverte !', 'The Baron’s new giant wheel is open!')}</strong>
        <small>{tr('Un multiplicateur doré ×2 en plus à chaque manche · XP ×2 sur la roue · cadeau d’ouverture à récupérer en haut du salon', 'An extra golden ×2 multiplier every round · XP ×2 on the wheel · opening gift to collect at the top of the lounge')}</small>
        <i>{tr(`Encore ${dureeOuverture(fin - Date.now())}`, `${dureeOuverture(fin - Date.now())} left`)}</i>
      </span>
    </button>
  );
}

