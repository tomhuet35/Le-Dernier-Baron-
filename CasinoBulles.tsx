/**
 * Les Bulles du Baron : la machine en cascade. Le serveur tire tout le tour (cascades et tours gratuits) ;
 * ici on le rejoue : les symboles tombent, les gagnants éclatent comme des bulles, le multiplicateur grimpe.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { COLONNES_BULLES, LIGNES_BULLES, MISES_BULLES, MIN_GROUPE, GAINS_BULLES, type EtapeBulles, type GrilleBulles, type ResultatBulles, type SymboleBulles } from '../../shared/bulles';
import type { VueCasino } from '../../shared/casino';
import type { Appel } from './App';
import { dollars, dollarsCourt, Jeton } from './casinoOutils';
import { tr } from './traduction';
import { jouerEffet } from './ui';
import './bulles.css';

const CLE_MISE = 'baron-bulles-mise';
const pause = (ms: number) => new Promise((ok) => window.setTimeout(ok, ms));
const ORDRE: SymboleBulles[] = ['couronne', 'rubis', 'perle', 'bouteille', 'coupe', 'fraise', 'bouchon'];

/** De combien de rangées chaque case est tombée pour arriver là (après l'éclatement des gagnantes). */
function chutes(avant: EtapeBulles | null): number[][] {
  if (!avant || !avant.eclats.length) return Array.from({ length: COLONNES_BULLES }, (_, c) => Array.from({ length: LIGNES_BULLES }, () => LIGNES_BULLES + c * 0.35));
  const out = new Set(avant.eclats);
  return Array.from({ length: COLONNES_BULLES }, (_, c) => {
    const gardees = Array.from({ length: LIGNES_BULLES }, (_, l) => l).filter((l) => !out.has(`${c}-${l}`));
    const enleves = LIGNES_BULLES - gardees.length;
    return Array.from({ length: LIGNES_BULLES }, (_, l) => (l < enleves ? enleves : l - gardees[l - enleves]));
  });
}

const grilleDepart = (): GrilleBulles => Array.from({ length: COLONNES_BULLES }, (_, c) => Array.from({ length: LIGNES_BULLES }, (_, l) => ORDRE[(c * 3 + l * 2) % ORDRE.length]));

interface Ecran {
  grille: GrilleBulles;
  eclats: string[];
  chute: number[][];
  cle: number;
  multi: number;
}

export function JeuBulles({ vue, appel, onVue, onRetour }: { vue: VueCasino; appel: Appel; onVue: (v: VueCasino) => void; onRetour: () => void }) {
  const [mise, setMise] = useState(() => {
    const m = Number(localStorage.getItem(CLE_MISE));
    return MISES_BULLES.includes(m) ? m : MISES_BULLES[2];
  });
  const [ecran, setEcran] = useState<Ecran>({ grille: grilleDepart(), eclats: [], chute: chutes(null), cle: 0, multi: 1 });
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [gainTour, setGainTour] = useState(0);
  const [bandeau, setBandeau] = useState<string | null>(null);
  const [gratuit, setGratuit] = useState<{ n: number; total: number } | null>(null);
  const [fete, setFete] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  /** Le gain d'une cascade, qui s'envole au-dessus de la grille. */
  const [flottant, setFlottant] = useState<{ cle: number; texte: string } | null>(null);
  const [fini, setFini] = useState<number | null>(null);
  /** Ce que le tour a crédité, pas encore montré au solde (on le montre à la fin de l'animation). */
  const [masque, setMasque] = useState(0);
  const vueRef = useRef(vue);
  vueRef.current = vue;
  const cle = useRef(1);
  const vivant = useRef(true);
  useEffect(() => () => void (vivant.current = false), []);

  useEffect(() => {
    try {
      localStorage.setItem(CLE_MISE, String(mise));
    } catch {
      /* rien */
    }
  }, [mise]);

  const rejouer = async (etapes: EtapeBulles[], cumul: { v: number }) => {
    let avant: EtapeBulles | null = null;
    for (const e of etapes) {
      if (!vivant.current) return;
      setEcran({ grille: e.grille, eclats: [], chute: chutes(avant), cle: cle.current++, multi: e.multi });
      jouerEffet('machine_arret');
      await pause(avant ? 520 : 900);
      if (!e.eclats.length) break;
      setEcran((x) => ({ ...x, eclats: e.eclats }));
      jouerEffet('machine_pieces');
      cumul.v += e.gain;
      setGainTour(cumul.v);
      setBandeau(tr(`Cascade ×${e.multi}`, `Cascade ×${e.multi}`));
      setFlottant({ cle: cle.current++, texte: `+${dollarsCourt(e.gain)}` });
      await pause(900);
      avant = e;
    }
  };

  const tourner = async () => {
    if (occupe) return;
    if (mise > vue.solde) return setErreur(tr('Solde insuffisant pour cette mise.', 'Not enough money for this bet.'));
    setOccupe(true);
    setErreur(null);
    setGainTour(0);
    setBandeau(null);
    setGratuit(null);
    setFini(null);
    setFlottant(null);
    jouerEffet('machine_levier');
    const r = (await appel('casino_bulles', { mise })) as { ok: boolean; erreur?: string; bulles?: ResultatBulles & { mise: number }; casino?: VueCasino };
    if (!r.ok || !r.bulles) {
      setOccupe(false);
      if (r.casino) onVue(r.casino);
      return setErreur(r.erreur ?? tr('Tour impossible.', 'Spin failed.'));
    }
    const b = r.bulles;
    // Le solde affiché : mise retirée tout de suite, gain montré à la fin.
    setMasque(b.gain);
    if (r.casino) onVue(r.casino);
    const cumul = { v: 0 };
    await rejouer(b.tour.etapes, cumul);
    if (b.gratuits.length && vivant.current) {
      setBandeau(tr('4 Bulles Bonus : tours gratuits !', '4 Bonus Bubbles: free spins!'));
      jouerEffet('lingots_pluie');
      await pause(1600);
      for (let i = 0; i < b.gratuits.length && vivant.current; i++) {
        setGratuit({ n: i + 1, total: b.gratuits.length });
        await rejouer(b.gratuits[i].etapes, cumul);
        await pause(250);
      }
    }
    if (!vivant.current) return;
    setGainTour(b.gain);
    setMasque(0);
    setBandeau(null);
    setFini(b.gain);
    if (b.gain >= 20 * b.mise) {
      setFete(b.gain);
      jouerEffet('lingots_pluie');
      window.setTimeout(() => vivant.current && setFete(null), 3200);
    }
    setGratuit(null);
    setOccupe(false);
  };

  const i = MISES_BULLES.indexOf(mise);
  const eclats = new Set(ecran.eclats);
  const solde = vue.solde - masque;

  return (
    <div className="cas-ecran bl-ecran">
      <header className="cas-barre">
        <button type="button" className="cas-retour" onClick={onRetour} disabled={occupe}>
          ‹ {tr('Machines', 'Slots')}
        </button>
        <img className="bl-logo" src="/cartes/bl-logo.webp" alt={tr('Les Bulles du Baron', 'The Baron’s Bubbles')} draggable={false} />
        <span className="cas-solde-petit">{dollars(solde)}</span>
      </header>

      <section className="bl-scene">
        <div className="bl-machine">
          <img className="bl-cadre" src="/cartes/bl-cadre.webp" alt="" draggable={false} />
          <div className="bl-fenetre">
            <div className="bl-grille" key={ecran.cle}>
              {ecran.grille.map((col, c) =>
                col.map((s, l) => (
                  <div
                    key={`${c}-${l}`}
                    className={`bl-case ${eclats.has(`${c}-${l}`) ? 'eclate' : ''} ${s === 'bonus' || s === 'joker' ? 'speciale' : ''}`}
                    style={{ gridColumn: c + 1, gridRow: l + 1, '--chute': ecran.chute[c][l], '--col': c } as CSSProperties}
                  >
                    <img src={`/cartes/bl-${s}.webp`} alt={s} draggable={false} />
                    {eclats.has(`${c}-${l}`) && <img className="bl-eclat" src="/cartes/bl-eclat.webp" alt="" aria-hidden="true" />}
                  </div>
                )),
              )}
            </div>
            <div className="bl-multi" aria-label={tr(`Multiplicateur ×${ecran.multi}`, `Multiplier ×${ecran.multi}`)}>
              <img src="/cartes/bl-badge.webp" alt="" draggable={false} />
              <b key={ecran.multi}>×{ecran.multi}</b>
            </div>
            {flottant && (
              <strong key={flottant.cle} className="bl-flottant" aria-hidden="true">
                {flottant.texte}
              </strong>
            )}
            {gratuit && (
              <div className="bl-gratuits">
                {tr('Tour gratuit', 'Free spin')} {gratuit.n}/{gratuit.total}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Le socle de la machine (même habillage que le Bandit) : le résultat, la mise et le bouton. */}
      <div className="bl-socle">
        <div className="bl-resultat" aria-live="polite">
          {occupe ? (
            gainTour > 0 ? (
              <>
                <strong className="bl-gain">+{dollars(gainTour)}</strong>
                {bandeau && <span>{bandeau}</span>}
              </>
            ) : (
              <span>{bandeau ?? tr('Les bulles montent…', 'Bubbles rising…')}</span>
            )
          ) : fini !== null ? (
            fini > 0 ? (
              <>
                <strong className="bl-gain">+{dollars(fini)}</strong>
                <span>{tr(`soit ×${Math.round((fini / mise) * 10) / 10} la mise`, `that's ×${Math.round((fini / mise) * 10) / 10} the bet`)}</span>
              </>
            ) : (
              <span>{tr('Pas de chance cette fois.', 'No luck this time.')}</span>
            )
          ) : (
            <span>{tr(`${MIN_GROUPE} symboles identiques ou plus, n'importe où : ils éclatent !`, `${MIN_GROUPE}+ matching symbols anywhere pop!`)}</span>
          )}
        </div>
        <div className="bl-commandes">
          <button type="button" className="bl-pas" onClick={() => setMise(MISES_BULLES[Math.max(0, i - 1)])} disabled={occupe || i <= 0} aria-label={tr('Baisser la mise', 'Lower the bet')}>
            −
          </button>
          <div className="bl-mise">
            <Jeton valeur={mise} />
            <span>
              <small>{tr('Mise', 'Bet')}</small>
              <b>{dollarsCourt(mise)}</b>
            </span>
          </div>
          <button type="button" className="bl-pas" onClick={() => setMise(MISES_BULLES[Math.min(MISES_BULLES.length - 1, i + 1)])} disabled={occupe || i >= MISES_BULLES.length - 1} aria-label={tr('Monter la mise', 'Raise the bet')}>
            +
          </button>
          <button type="button" className="bl-tourner" onClick={() => void tourner()} disabled={occupe}>
            <span>{tr('Tourner', 'Spin')}</span>
          </button>
          <button type="button" className="bl-table-bouton" onClick={() => setTable((x) => !x)} aria-label={tr('Table des gains', 'Pay table')}>
            i
          </button>
        </div>
      </div>
      {erreur && <p className="erreur">{erreur}</p>}

      {table && (
        <div className="voile" onClick={() => setTable(false)}>
          <div className="fenetre bl-table" onClick={(e) => e.stopPropagation()}>
            <h2>{tr('Table des gains', 'Pay table')}</h2>
            <p>{tr(`Pour ${MIN_GROUPE}-9, 10-11 et 12+ symboles, à ta mise de ${dollars(mise)} :`, `For ${MIN_GROUPE}-9, 10-11 and 12+ symbols, at your ${dollars(mise)} bet:`)}</p>
            <ul>
              {ORDRE.map((s) => (
                <li key={s}>
                  <img src={`/cartes/bl-${s}.webp`} alt={s} />
                  {GAINS_BULLES[s].map((g, k) => (
                    <span key={k}>{dollarsCourt(Math.round(g * mise))}</span>
                  ))}
                </li>
              ))}
            </ul>
            <p>
              <img src="/cartes/bl-joker.webp" alt="" className="bl-mini" /> {tr('La Bulle B remplace tous les symboles.', 'The B Bubble replaces every symbol.')}
              <br />
              <img src="/cartes/bl-bonus.webp" alt="" className="bl-mini" /> {tr('4 Bulles Bonus : 10 tours gratuits, le multiplicateur ne redescend plus.', '4 Bonus Bubbles: 10 free spins, the multiplier never drops.')}
              <br />
              {tr('Chaque cascade fait monter le multiplicateur : ×1, ×1, ×2, ×2, ×3, ×5, ×8, ×10, ×15.', 'Each cascade raises the multiplier: ×1, ×1, ×2, ×2, ×3, ×5, ×8, ×10, ×15.')}
            </p>
            <button type="button" className="principal" onClick={() => setTable(false)}>
              {tr('Fermer', 'Close')}
            </button>
          </div>
        </div>
      )}

      {fete !== null && (
        <div className="bl-fete" aria-live="assertive">
          <img src="/cartes/bl-jackpot.webp" alt="" />
          <strong>{dollars(fete)}</strong>
        </div>
      )}
    </div>
  );
}
