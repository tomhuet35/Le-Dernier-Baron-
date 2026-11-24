/**
 * Les Bulles du Baron : la machine en cascade. Le serveur tire tout le tour (cascades et tours gratuits) ;
 * ici on le rejoue : les symboles tombent, les gagnants éclatent comme des bulles, le multiplicateur grimpe.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { COLONNES_BULLES, LIGNES_BULLES, MISES_BULLES, MIN_GROUPE, GAINS_BULLES, MULTIS_CASCADE, type EtapeBulles, type GrilleBulles, type ResultatBulles, type SymboleBulles } from '../../shared/bulles';
import type { VueCasino } from '../../shared/casino';
import type { Appel } from './App';
import { dollars, dollarsCourt, SoldeJeu } from './casinoOutils';
import { tr } from './traduction';
import { jouerEffet } from './ui';
import './bulles.css';

const CLE_MISE = 'baron-bulles-mise';
const pause = (ms: number) => new Promise((ok) => window.setTimeout(ok, ms));
/** Les paliers montrés sur l'échelle (au-dessus de ×1). */
const ECHELLE = [...new Set(MULTIS_CASCADE)].filter((m) => m > 1).slice(-6);
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
  const [annonceBonus, setAnnonceBonus] = useState(false);
  /** La soirée du joueur sur cette machine (depuis qu'il est entré). */
  const [soiree, setSoiree] = useState({ tours: 0, mise: 0, gain: 0, meilleur: 0, cascades: 0, bonus: 0, derniers: [] as { gain: number; x: number }[] });
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
      return setErreur(r.erreur ?? tr('Pas de réponse de la machine : vérifie ta connexion et réessaie.', 'No answer from the machine: check your connection and try again.'));
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
      setAnnonceBonus(true);
      await pause(2200);
      setAnnonceBonus(false);
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
    const cascades = Math.max(0, ...[b.tour, ...b.gratuits].map((t) => t.etapes.filter((e) => e.eclats.length).length));
    setSoiree((x) => ({
      tours: x.tours + 1,
      mise: x.mise + b.mise,
      gain: x.gain + b.gain,
      meilleur: Math.max(x.meilleur, b.gain),
      cascades: Math.max(x.cascades, cascades),
      bonus: x.bonus + (b.gratuits.length ? 1 : 0),
      derniers: b.gain > 0 ? [{ gain: b.gain, x: Math.round((b.gain / b.mise) * 10) / 10 }, ...x.derniers].slice(0, 6) : x.derniers,
    }));
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
      <div className="bl-bulles-deco" aria-hidden="true">
        {Array.from({ length: 14 }, (_, k) => (
          <i key={k} style={{ '--x': `${(k * 37) % 100}%`, '--d': `${7 + (k % 5) * 1.6}s`, '--r': `${-((k * 1.3) % 9)}s`, '--t': `${10 + (k % 4) * 8}px` } as CSSProperties} />
        ))}
      </div>
      <header className="cas-barre">
        <button type="button" className="cas-retour" onClick={onRetour} disabled={occupe}>
          ‹ {tr('Machines', 'Slots')}
        </button>
        <img className="bl-logo" src="/cartes/bl-logo.webp" alt={'The Baron’s Bubbles'} draggable={false} />
        <SoldeJeu solde={solde} />
        <span className="cas-solde-petit">{dollars(solde)}</span>
      </header>

      <section className="bl-scene">
        <aside className="bl-panneau bl-carte" aria-label={tr('Carte des gains', 'Pay card')}>
          <h2>{tr('La Carte des Gains', 'The Pay Card')}</h2>
          <p className="bl-panneau-aide">{tr(`À ta mise de ${dollarsCourt(mise)}`, `At your ${dollarsCourt(mise)} bet`)}</p>
          <div className="bl-carte-tete">
            <span />
            <span>8-9</span>
            <span>10-11</span>
            <span>12+</span>
          </div>
          {ORDRE.map((sy) => (
            <div key={sy} className="bl-carte-ligne">
              <img src={`/cartes/bl-${sy}.webp`} alt={sy} />
              {GAINS_BULLES[sy].map((g, k) => (
                <span key={k}>{dollarsCourt(Math.round(g * mise))}</span>
              ))}
            </div>
          ))}
          <p className="bl-carte-special">
            <img src="/cartes/bl-joker.webp" alt="" /> {tr('remplace tout', 'replaces all')}
          </p>
          <p className="bl-carte-special">
            <img src="/cartes/bl-bonus.webp" alt="" /> {tr('× 4 : 10 tours gratuits', '× 4: 10 free spins')}
          </p>
        </aside>
        <div className="bl-centre">
        <div className="bl-echelle" aria-label={tr(`Multiplicateur ×${ecran.multi}`, `Multiplier ×${ecran.multi}`)}>
          <img src="/cartes/bl-echelle.webp" alt="" draggable={false} />
          {ECHELLE.map((m, k) => (
            <b key={m} className={ecran.multi >= m ? 'allume' : ''} style={{ left: `${20.5 + k * 11.75}%` }}>
              ×{m}
            </b>
          ))}
        </div>
        <div className="bl-machine">
          <img className="bl-cadre" src="/cartes/bl-cadre.webp" alt="" draggable={false} />
          <img className="bl-cadre-tel" src="/cartes/bl-cadre-tel.webp" alt="" draggable={false} />
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
            {flottant && (
              <strong key={flottant.cle} className="bl-flottant" aria-hidden="true">
                {flottant.texte}
              </strong>
            )}
            {gratuit && (
              <div className="bl-gratuits">
                <img src="/cartes/bl-ruban.webp" alt="" draggable={false} />
                <span>
                  {tr('Tour gratuit', 'Free spin')} {gratuit.n}/{gratuit.total}
                </span>
              </div>
            )}
          </div>
        </div>
        </div>
        <aside className="bl-panneau bl-soiree" aria-label={tr('Ta soirée', 'Your evening')}>
          <h2>{tr('Ta Soirée', 'Your Evening')}</h2>
          <dl>
            <dt>{tr('Tours', 'Spins')}</dt>
            <dd>{soiree.tours}</dd>
            <dt>{tr('Misé', 'Bet')}</dt>
            <dd>{dollarsCourt(soiree.mise)}</dd>
            <dt>{tr('Gagné', 'Won')}</dt>
            <dd className="or">{dollarsCourt(soiree.gain)}</dd>
            <dt>{tr('Meilleur gain', 'Best win')}</dt>
            <dd>{dollarsCourt(soiree.meilleur)}</dd>
            <dt>{tr('Cascades d’affilée', 'Cascades in a row')}</dt>
            <dd>{soiree.cascades}</dd>
            <dt>{tr('Tours gratuits', 'Free spins')}</dt>
            <dd>{soiree.bonus}</dd>
          </dl>
          <h3>{tr('Derniers gains', 'Latest wins')}</h3>
          {soiree.derniers.length ? (
            <ul>
              {soiree.derniers.map((d, k) => (
                <li key={`${soiree.tours}-${k}`}>
                  <b>+{dollarsCourt(d.gain)}</b> <small>×{d.x}</small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="bl-panneau-aide">{tr('Fais éclater tes premières bulles !', 'Pop your first bubbles!')}</p>
          )}
        </aside>
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
            <span>{tr(`${MIN_GROUPE} symboles identiques : ils éclatent !`, `${MIN_GROUPE}+ matching symbols pop!`)}</span>
          )}
        </div>
        <div className="bl-commandes">
          <button type="button" className="bl-pas" onClick={() => setMise(MISES_BULLES[Math.max(0, i - 1)])} disabled={occupe || i <= 0} aria-label={tr('Baisser la mise', 'Lower the bet')}>
            <img src="/cartes/bl-moins.webp" alt="" draggable={false} />
          </button>
          <div className="bl-mise">
            <img className="bl-jeton" src="/cartes/bl-jeton.webp" alt="" draggable={false} />
            <span>
              <small>{tr('Mise', 'Bet')}</small>
              <b>{dollarsCourt(mise)}</b>
            </span>
          </div>
          <button type="button" className="bl-pas" onClick={() => setMise(MISES_BULLES[Math.min(MISES_BULLES.length - 1, i + 1)])} disabled={occupe || i >= MISES_BULLES.length - 1} aria-label={tr('Monter la mise', 'Raise the bet')}>
            <img src="/cartes/bl-plus.webp" alt="" draggable={false} />
          </button>
          <button type="button" className="bl-tourner" onClick={() => void tourner()} disabled={occupe}>
            <span>{tr('Tourner', 'Spin')}</span>
          </button>
          <button type="button" className="bl-table-bouton" onClick={() => setTable((x) => !x)} aria-label={tr('Table des gains', 'Pay table')}>
            <img src="/cartes/bl-info.webp" alt="" draggable={false} />
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

      {annonceBonus && (
        <div className="bl-annonce-bonus" aria-live="assertive">
          <img src="/cartes/bl-bonus-annonce.webp" alt="" />
          <strong>{tr('10 tours gratuits !', '10 free spins!')}</strong>
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
