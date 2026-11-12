/**
 * Les Coffres du Baron (nom de code « festin ») : 25 coffres-forts sur la caisse du contrebandier. Dans chacun, le
 * butin… ou un badge de police. On choisit sa mise et le nombre de badges, on ouvre les coffres : chaque butin fait
 * monter le multiplicateur, un badge fait tout perdre. On encaisse quand on veut. Le serveur place les badges et tient
 * la partie ; l'écran ne voit le contenu d'un coffre qu'une fois ouvert.
 *
 * Visuels : festin-coffre.webp, festin-butin.webp, festin-police.webp (détourés) et festin-table.webp (la caisse) ;
 * à l'encaissement tombent butin-billet.webp, butin-rubis.webp et butin-lingot.webp.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { MULTIPLE_GROS_GAIN, type VueCasino } from '../../shared/casino';
import { BADGES_MAX, BADGES_MIN, BADGES_RAPIDES, COFFRES, echelleCoffres, MISES_COFFRES, type ContenuCoffre, type VueCoffres } from '../../shared/festin';
import type { Appel } from './App';
import { BUTIN_PLUIE, dollars, Jeton, LINGOTS_PALIER, PluieLingots, useSoldeAnime } from './casinoOutils';
import { tr } from './traduction';
import { jouerEffet, mouvementReduit, useCompteur } from './ui';
import './festin.css';

const x2 = (x: number) => `×${x.toLocaleString(tr('fr-FR', 'en-US'), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const CLE_REGLAGES = 'ldb-coffres';
const IMAGE: Record<ContenuCoffre | 'coffre', string> = {
  coffre: '/cartes/festin-coffre.webp',
  butin: '/cartes/festin-butin.webp',
  police: '/cartes/festin-police.webp',
};

function lireReglages(): { mise: number; badges: number } {
  try {
    const r = JSON.parse(localStorage.getItem(CLE_REGLAGES) ?? '{}') as { mise?: number; badges?: number };
    const mise = MISES_COFFRES.includes(r.mise ?? 0) ? r.mise! : 10_000;
    const badges = Number.isInteger(r.badges) && r.badges! >= BADGES_MIN && r.badges! <= BADGES_MAX ? r.badges! : 3;
    return { mise, badges };
  } catch {
    return { mise: 10_000, badges: 3 };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Un coffre

function Coffre({
  i,
  contenu,
  ouvert,
  fini,
  perdant,
  attente,
  peutOuvrir,
  onOuvrir,
}: {
  i: number;
  contenu: ContenuCoffre | null;
  ouvert: boolean;
  fini: boolean;
  perdant: boolean;
  attente: boolean;
  peutOuvrir: boolean;
  onOuvrir: (i: number) => void;
}) {
  const devoile = !!contenu;
  const classe = ['fe-case', devoile ? `devoilee ${contenu}` : 'fermee', ouvert ? 'choisie' : fini && devoile ? 'reste' : '', perdant ? 'perdante' : '', attente ? 'attente' : ''].join(' ');
  return (
    <button
      type="button"
      className={classe}
      style={{ '--retard': `${(Math.floor(i / 5) + (i % 5)) * 45}ms` } as CSSProperties}
      disabled={!peutOuvrir || devoile}
      onClick={() => onOuvrir(i)}
      aria-label={contenu === 'butin' ? tr('Butin', 'Loot') : contenu === 'police' ? tr('Police', 'Police') : tr(`Coffre ${i + 1}`, `Safe ${i + 1}`)}
    >
      {devoile && (
        <span className="fe-contenu">
          <img src={IMAGE[contenu]} alt="" draggable={false} />
        </span>
      )}
      <span className="fe-porte">
        <img src={IMAGE.coffre} alt="" draggable={false} />
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// La somme encaissée, en grand

function AnnonceCoffres({ montant, x, gros }: { montant: number; x: number; gros: boolean }) {
  const valeur = useCompteur(montant, Math.round(montant / 20), 0, gros ? 1600 : 900);
  return (
    <div className={`fe-gain ${gros ? 'gros' : ''}`} aria-live="polite">
      <span>{gros ? tr('Gros butin !', 'Big loot!') : tr('Encaissé !', 'Cashed out!')}</span>
      <em>{x2(x)}</em>
      <strong>+{dollars(valeur)}</strong>
      <small>{tr('ajoutés à ton solde', 'added to your balance')}</small>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// L'écran

export function JeuFestin({ vue, appel, onVue, onRetour }: { vue: VueCasino; appel: Appel; onVue: (v: VueCasino) => void; onRetour: () => void }) {
  const [partie, setPartie] = useState<VueCoffres | null>(null);
  const [reglages, setReglages] = useState(lireReglages);
  const [attente, setAttente] = useState<number | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [annonce, setAnnonce] = useState<{ montant: number; x: number; gros: boolean; id: number } | null>(null);
  const [pluie, setPluie] = useState<{ n: number; id: number } | null>(null);
  /** Le gain qui vient d'arriver sur le solde (affiché sous le solde, en haut à droite). */
  const [credit, setCredit] = useState<{ montant: number; id: number } | null>(null);
  /** Numéro de la partie lancée : les coffres repartent de zéro à chaque partie. */
  const [numero, setNumero] = useState(0);
  const minuteries = useRef<number[]>([]);
  const vueRef = useRef(vue);
  vueRef.current = vue;
  const solde = useSoldeAnime(vue.solde);
  const plusTard = (f: () => void, ms: number) => minuteries.current.push(window.setTimeout(f, ms));
  useEffect(() => () => minuteries.current.forEach((m) => window.clearTimeout(m)), []);

  // On arrive du salon (souvent descendu jusqu'aux vignettes) : l'écran s'ouvre en haut, la caisse en entier.
  useEffect(() => window.scrollTo(0, 0), []);

  // Une partie en cours attend peut-être le joueur.
  useEffect(() => {
    void appel('casino_coffres_vue').then((r) => {
      const c = (r as unknown as { coffres?: VueCoffres | null }).coffres;
      if (r.ok && c?.etat === 'enCours') setPartie(c);
    });
  }, [appel]);

  useEffect(() => {
    try {
      localStorage.setItem(CLE_REGLAGES, JSON.stringify(reglages));
    } catch {
      /* préférence non gardée */
    }
  }, [reglages]);

  const enCours = partie?.etat === 'enCours';
  const fini = !!partie && !enCours;
  const badges = partie ? partie.badges : reglages.badges;
  const echelle = useMemo(() => echelleCoffres(badges), [badges]);
  const majSolde = (s: unknown) => {
    if (typeof s === 'number') onVue({ ...vueRef.current, solde: s, coffres: { enCours: false } });
  };

  const fin = (c: VueCoffres) => {
    if (c.etat === 'perdu') {
      jouerEffet('cf_police');
      plusTard(() => jouerEffet('cf_perdu'), 500);
      return;
    }
    const gros = c.gain >= MULTIPLE_GROS_GAIN * c.mise || c.gain >= 1_000_000;
    jouerEffet(gros ? 'cf_gros' : 'cf_encaisse');
    setAnnonce({ montant: c.gain, x: c.x, gros, id: Date.now() });
    plusTard(() => setAnnonce(null), gros ? 3600 : 2400);
    setCredit({ montant: c.gain, id: Date.now() });
    plusTard(() => setCredit(null), 2600);
    // Chaque butin encaissé fait pleuvoir billets, rubis et lingots : plus le gain est gros, plus il en tombe.
    if (!mouvementReduit()) {
      const n = c.gain >= 50 * MULTIPLE_GROS_GAIN * c.mise ? LINGOTS_PALIER.colossal : gros ? LINGOTS_PALIER.enorme : c.x >= 10 ? LINGOTS_PALIER.gros : 20;
      setPluie({ n, id: Date.now() });
      if (gros) plusTard(() => jouerEffet('lingots_pluie'), 250);
      plusTard(() => setPluie(null), 4400);
    }
  };

  const lancer = async () => {
    if (envoi) return;
    if (reglages.mise > vue.solde) return setErreur(tr('Solde insuffisant pour cette mise.', 'Not enough money for this bet.'));
    setEnvoi(true);
    setErreur(null);
    setAnnonce(null);
    const r = await appel('casino_coffres_lancer', reglages);
    setEnvoi(false);
    if (!r.ok) return setErreur(r.erreur ?? tr('Action impossible.', 'Action not allowed.'));
    const x = r as unknown as { coffres: VueCoffres; solde: number };
    jouerEffet('jeton');
    setNumero((n) => n + 1);
    setPartie(x.coffres);
    onVue({ ...vueRef.current, solde: x.solde, coffres: { enCours: true } });
  };

  const ouvrir = async (i: number) => {
    if (!enCours || attente !== null) return;
    setAttente(i);
    setErreur(null);
    jouerEffet('cf_ouvre');
    const r = await appel('casino_coffres_ouvrir', { index: i });
    // La porte s'entrouvre (le coffre tremble) avant de montrer ce qu'il y a dedans.
    await new Promise((ok) => window.setTimeout(ok, mouvementReduit() ? 0 : 420));
    setAttente(null);
    if (!r.ok) return setErreur(r.erreur ?? tr('Action impossible.', 'Action not allowed.'));
    const x = r as unknown as { coffres: VueCoffres; solde: number };
    setPartie(x.coffres);
    if (x.coffres.coffres[i] === 'butin') jouerEffet('cf_butin');
    if (x.coffres.etat !== 'enCours') {
      majSolde(x.solde);
      fin(x.coffres);
    }
  };

  const auHasard = () => {
    if (!partie) return;
    const fermes = partie.coffres.map((c, i) => (c === null ? i : -1)).filter((i) => i >= 0);
    if (fermes.length) void ouvrir(fermes[Math.floor(Math.random() * fermes.length)]);
  };

  const encaisser = async () => {
    if (!enCours || envoi || attente !== null) return;
    setEnvoi(true);
    const r = await appel('casino_coffres_encaisser');
    setEnvoi(false);
    if (!r.ok) return setErreur(r.erreur ?? tr('Action impossible.', 'Action not allowed.'));
    const x = r as unknown as { coffres: VueCoffres; solde: number };
    setPartie(x.coffres);
    majSolde(x.solde);
    fin(x.coffres);
  };

  const changerMise = (d: number) => {
    const i = MISES_COFFRES.indexOf(reglages.mise) + d;
    if (i < 0 || i >= MISES_COFFRES.length) return;
    jouerEffet('jeton');
    setReglages((r) => ({ ...r, mise: MISES_COFFRES[i] }));
  };
  const changerBadges = (n: number) => {
    const v = Math.min(BADGES_MAX, Math.max(BADGES_MIN, n));
    if (v === reglages.badges) return;
    jouerEffet('selection');
    setReglages((r) => ({ ...r, badges: v }));
  };

  // L'échelle des multiplicateurs suit la partie (le prochain palier reste au centre).
  const bande = useRef<HTMLOListElement>(null);
  const atteint = partie ? partie.butins : 0;
  useLayoutEffect(() => {
    const b = bande.current;
    const cible = b?.children[Math.min(echelle.length - 1, atteint)] as HTMLElement | undefined;
    if (b && cible) b.scrollTo({ left: cible.offsetLeft - b.clientWidth / 2 + cible.clientWidth / 2, behavior: mouvementReduit() ? 'auto' : 'smooth' });
  }, [atteint, echelle]);

  const contenus = partie ? partie.coffres : Array<null>(COFFRES).fill(null);
  const peutOuvrir = enCours && attente === null && !envoi;
  const message = !partie
    ? tr('Choisis ta mise et le nombre de badges de police, puis lance le casse.', 'Pick your bet and the number of police badges, then start the heist.')
    : enCours
      ? partie.butins
        ? tr(`${partie.butins} butin${partie.butins > 1 ? 's' : ''} ! Encore un coffre… ou tu encaisses ?`, `${partie.butins} loot${partie.butins > 1 ? 's' : ''}! One more safe… or cash out?`)
        : tr('Ouvre un coffre : le butin, ou la police ?', 'Open a safe: the loot, or the police?')
      : partie.etat === 'perdu'
        ? tr('La police ! Le butin est saisi…', 'The police! The loot is seized…')
        : tr(`Butin encaissé : ${dollars(partie.gain)} !`, `Loot cashed out: ${dollars(partie.gain)}!`);

  return (
    <div className={`cas-ecran fe-ecran ${enCours ? 'en-cours' : ''}`} data-etat={partie?.etat ?? 'pret'}>
      <header className="cas-barre">
        <button type="button" className="cas-retour" onClick={onRetour}>
          ‹ {tr('Salon', 'Lounge')}
        </button>
        <h1 className="fe-titre">
          <span>{tr('Les Coffres', 'The Baron’s')}</span> <span>{tr('du Baron', 'Safes')}</span>
        </h1>
        <span className={`cas-solde-petit fe-solde ${credit ? 'credite' : ''}`}>
          {dollars(solde)}
          {credit && (
            <b key={credit.id} className="fe-credit">
              +{dollars(credit.montant)}
            </b>
          )}
        </span>
      </header>

      <section className="fe-table">
        <span className="fe-gyrophare" aria-hidden="true" />
        <div className="fe-grille" role="group" aria-label={tr('Les coffres-forts', 'The safes')}>
          {contenus.map((c, i) => (
            <Coffre
              key={`${numero}-${i}`}
              i={i}
              contenu={c}
              ouvert={!!partie?.ouverts.includes(i)}
              fini={fini}
              perdant={partie?.perdant === i}
              attente={attente === i}
              peutOuvrir={peutOuvrir}
              onOuvrir={(k) => void ouvrir(k)}
            />
          ))}
        </div>
      </section>

      <section className="fe-commandes" aria-label={tr('Ta partie', 'Your game')}>
        <div className="fe-compteur">
          <div>
            <small>{tr('Multiplicateur', 'Multiplier')}</small>
            <strong className={enCours && partie!.butins ? 'monte' : ''} key={`x${partie?.butins ?? 0}`}>
              {x2(partie && (enCours || partie.etat === 'encaisse') ? partie.x : 1)}
            </strong>
          </div>
          <div>
            <small>{tr('Prochain butin', 'Next loot')}</small>
            <strong className="suivant">{enCours ? (partie!.suivant ? x2(partie!.suivant) : '—') : x2(echelle[0])}</strong>
          </div>
          <div>
            <small>{tr('Badges de police', 'Police badges')}</small>
            <strong className="badges">{badges}</strong>
          </div>
        </div>

        <ol className="fe-echelle" ref={bande} aria-label={tr('Les multiplicateurs', 'Multipliers')}>
          {echelle.map((x, k) => (
            <li key={k} className={k < atteint ? 'atteint' : k === atteint && enCours ? 'prochain' : ''}>
              <small>{k + 1}</small>
              {x2(x)}
            </li>
          ))}
        </ol>

        <p className={`fe-message ${partie?.etat ?? ''}`} role="status">
          {message}
        </p>

        {enCours ? (
          <div className="fe-actions">
            <button type="button" className="fe-encaisser" onClick={() => void encaisser()} disabled={!partie!.butins || envoi || attente !== null}>
              <span>{tr('Encaisser', 'Cash out')}</span>
              <strong>{dollars(partie!.gain || partie!.mise)}</strong>
            </button>
            <button type="button" className="fe-hasard" onClick={auHasard} disabled={!peutOuvrir}>
              {tr('Au hasard', 'Random')}
            </button>
            <p className="discret fe-mise-cours">
              {tr('Mise', 'Bet')} <strong>{dollars(partie!.mise)}</strong> · {tr(`${partie!.butins} / ${COFFRES - partie!.badges} butins`, `${partie!.butins} / ${COFFRES - partie!.badges} loots`)}
            </p>
          </div>
        ) : (
          <div className="fe-reglages">
            <div className="cas-mise" aria-label={tr('Mise', 'Bet')}>
              <button type="button" onClick={() => changerMise(-1)} disabled={reglages.mise === MISES_COFFRES[0]} aria-label={tr('Baisser la mise', 'Lower the bet')}>
                −
              </button>
              <span className="cas-mise-valeur">
                <Jeton valeur={reglages.mise} />
                <span>
                  <small>{tr('Mise', 'Bet')}</small>
                  <strong>{dollars(reglages.mise)}</strong>
                </span>
              </span>
              <button type="button" onClick={() => changerMise(1)} disabled={reglages.mise === MISES_COFFRES[MISES_COFFRES.length - 1]} aria-label={tr('Augmenter la mise', 'Raise the bet')}>
                +
              </button>
            </div>
            <div className="fe-choix-badges" role="group" aria-label={tr('Nombre de badges de police', 'Number of police badges')}>
              <span className="fe-choix-badges-titre">
                <img src={IMAGE.police} alt="" draggable={false} />
                {tr('Police', 'Police')}
              </span>
              <button type="button" className="fe-pas" onClick={() => changerBadges(reglages.badges - 1)} disabled={reglages.badges <= BADGES_MIN} aria-label={tr('Moins de badges', 'Fewer badges')}>
                −
              </button>
              <strong className="fe-nb-badges">{reglages.badges}</strong>
              <button type="button" className="fe-pas" onClick={() => changerBadges(reglages.badges + 1)} disabled={reglages.badges >= BADGES_MAX} aria-label={tr('Plus de badges', 'More badges')}>
                +
              </button>
              <span className="fe-rapides">
                {BADGES_RAPIDES.map((n) => (
                  <button key={n} type="button" className={n === reglages.badges ? 'choisi' : ''} onClick={() => changerBadges(n)} aria-pressed={n === reglages.badges}>
                    {n}
                  </button>
                ))}
              </span>
            </div>
            <button type="button" className="cas-tourner fe-lancer" onClick={() => void lancer()} disabled={envoi || reglages.mise > vue.solde}>
              <span>{fini ? tr('Nouveau casse', 'New heist') : tr('Lancer le casse', 'Start the heist')}</span>
            </button>
          </div>
        )}
        {erreur && <p className="cas-erreur">{erreur}</p>}
        <p className="cas-mention">
          {tr(
            '25 coffres, de 1 à 24 badges de police. Chaque butin fait monter le multiplicateur ; la police, et la mise est saisie. Mise de 1 000 à 500 000 $, jusqu’à ×25 000.',
            '25 safes, 1 to 24 police badges. Each loot raises the multiplier; the police, and the bet is seized. Bets from $1,000 to $500,000, up to ×25,000.',
          )}
        </p>
      </section>

      {pluie && <PluieLingots key={`pluie-${pluie.id}`} n={pluie.n} objets={BUTIN_PLUIE} />}
      {annonce && <AnnonceCoffres key={`annonce-${annonce.id}`} montant={annonce.montant} x={annonce.x} gros={annonce.gros} />}
    </div>
  );
}
