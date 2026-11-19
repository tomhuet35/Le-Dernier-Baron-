/**
 * Grand Hôtel du Baron, première brique : les Contrats du Salon, l'Album du Baron et les Rubis du Baron.
 * Le serveur tient tout (shared/contrats.ts, server/salonCasino.ts) : ces écrans affichent la vue et envoient les choix.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { formatDollars, type VueCasino } from '../../shared/casino';
import {
  dollarsContrat,
  modeleContrat,
  MORCEAUX_PAGE,
  morceauxDe,
  pageComplete,
  PRIX_CHANGER_CONTRAT,
  PRIX_DEPANNAGE,
  RUBIS_ALBUM,
  RUBIS_CONTRAT,
  RUBIS_GROS_COUP,
  RUBIS_PAGE,
  RUBIS_TOUS_CONTRATS,
  texteContrat,
  type AnnonceContrats,
  type Contrat,
  type VueContrats,
} from '../../shared/contrats';
import { JEUX_CASINO, NOMS_JEUX_CASINO, niveauCasino, type JeuCasino } from '../../shared/profilCasino';
import type { Appel } from './App';
import { dollars } from './casinoOutils';
import { useAttente } from './RouletteDuJour';
import { socket } from './socket';
import { EN, tr } from './traduction';
import { jouerEffet, mouvementReduit } from './ui';
import './contrats.css';

/** La vignette de chaque jeu (une page d'album chacune). */
export const VIGNETTES_ALBUM: Record<JeuCasino, string> = {
  machine: 'bandit',
  nuits: 'nuits',
  blackjack: 'blackjack',
  roulette: 'roulette',
  folleNuit: 'folle-nuit',
  coffres: 'coffres',
  couronne: 'couronne',
  chute: 'chute',
  tickets: 'tickets',
  course: 'course',
  baronWheel: 'roue',
};
const vignette = (j: JeuCasino) => `/cartes/vignette-${VIGNETTES_ALBUM[j]}.webp`;
const texte = (c: { id: string; cible: number }) => tr(...texteContrat(c, formatDollars));
const nomJeu = (j: JeuCasino) => tr(...NOMS_JEUX_CASINO[j]);

/** Les rubis : l'icône et le nombre. */
export function Rubis({ n, taille = 20, className }: { n?: number; taille?: number; className?: string }) {
  return (
    <span className={`ct-rubis ${className ?? ''}`} style={{ '--t': `${taille}px` } as CSSProperties}>
      <img src="/cartes/rubis-icone.webp" alt={tr('Rubis', 'Rubies')} draggable={false} />
      {n !== undefined && <b>{n.toLocaleString(EN ? 'en-US' : 'fr-FR')}</b>}
    </span>
  );
}

/** Dans le salon : les rubis, les Contrats (combien en reste-t-il ?) et l'Album, puis le dépannage si l'on est ruiné. */
export function BoutonsHotel({ vue, appel, onVue, onContrats, onAlbum }: { vue: VueCasino; appel: Appel; onVue: (v: VueCasino) => void; onContrats: () => void; onAlbum: () => void }) {
  const c = vue.contrats;
  if (!c) return null;
  const restants = c.jour.filter((x) => !x.fait).length;
  const pieces = JEUX_CASINO.reduce((s, j) => s + morceauxDe(c.album[j]), 0);
  return (
    <>
      <div className="ct-boutons">
        <button type="button" className="ct-bouton" onClick={onContrats}>
          <img src="/cartes/contrat-icone.webp" alt="" />
          <span>
            <strong>{tr('Contrats', 'Contracts')}</strong>
            <small>{restants ? tr(`${restants} à remplir aujourd’hui`, `${restants} left today`) : tr('Tous remplis !', 'All done!')}</small>
          </span>
          {restants > 0 && <span className="pastille-nombre">{restants}</span>}
        </button>
        <button type="button" className="ct-bouton" onClick={onAlbum}>
          <img src="/cartes/vignette-bandit.webp" alt="" className="ct-bouton-vignette" />
          <span>
            <strong>{tr('Album', 'Album')}</strong>
            <small>
              {pieces}/{JEUX_CASINO.length * MORCEAUX_PAGE} {tr('morceaux', 'pieces')}
            </small>
          </span>
        </button>
        <Rubis n={c.rubis} taille={26} className="ct-rubis-salon" />
      </div>
      {c.depannage && <Depannage c={c} appel={appel} onVue={onVue} />}
    </>
  );
}

/** Ruiné : des rubis contre des dollars (une fois par jour, jamais l'inverse). */
export function Depannage({ c, appel, onVue }: { c: VueContrats; appel: Appel; onVue: (v: VueCasino) => void }) {
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const depanner = async () => {
    setOccupe(true);
    const r = (await appel('casino_depannage')) as { ok: boolean; erreur?: string; casino?: VueCasino };
    setOccupe(false);
    if (r.casino) onVue(r.casino);
    if (!r.ok) return setErreur(r.erreur ?? tr('Dépannage impossible.', 'Bailout unavailable.'));
    jouerEffet('machine_pieces');
  };
  return (
    <section className="ct-depannage">
      <img src="/cartes/rubis-coussin.webp" alt="" />
      <div>
        <strong>{tr('Un coup dur ?', 'Down on your luck?')}</strong>
        <small>{tr(`Le Baron te dépanne : ${PRIX_DEPANNAGE} rubis contre ${dollars(c.dollarsDepannage)}, une fois par jour.`, `The Baron bails you out: ${PRIX_DEPANNAGE} rubies for ${dollars(c.dollarsDepannage)}, once a day.`)}</small>
        {erreur && <small className="cas-erreur">{erreur}</small>}
      </div>
      <button type="button" className="principal" disabled={occupe} onClick={() => void depanner()}>
        {tr('Échanger', 'Exchange')}
      </button>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// L'écran des contrats

function Dossier({ c, index, niveau, change, onChanger }: { c: Contrat; index: number; niveau: number; change: boolean; onChanger: (i: number) => void }) {
  const m = modeleContrat(c.id);
  const pct = Math.round((100 * c.progres) / Math.max(1, c.cible));
  const argent = m?.mesure === 'mise' || m?.mesure === 'gain';
  // Le tampon s'abat quand le contrat passe à « fait » sous les yeux du joueur.
  const avant = useRef(c.fait);
  const [tampon, setTampon] = useState(false);
  useEffect(() => {
    if (c.fait && !avant.current) setTampon(true);
    avant.current = c.fait;
  }, [c.fait]);
  return (
    <li className={`ct-dossier ${c.fait ? 'fait' : ''}`} style={{ '--i': index } as CSSProperties}>
      <img className="ct-dossier-icone" src={m?.jeu ? vignette(m.jeu) : '/cartes/contrat-icone.webp'} alt="" />
      <div className="ct-dossier-corps">
        <strong>{texte(c)}</strong>
        <div className="ct-barre" role="progressbar" aria-valuemin={0} aria-valuemax={c.cible} aria-valuenow={c.progres}>
          <i style={{ width: `${pct}%` }} />
        </div>
        <small className="ct-progres">{argent ? `${dollars(c.progres)} / ${dollars(c.cible)}` : `${c.progres} / ${c.cible}`}</small>
        <small className="ct-recompense">
          <Rubis n={RUBIS_CONTRAT} taille={15} /> · {dollars(dollarsContrat(niveau))} · {tr('1 morceau d’album', '1 album piece')}
        </small>
        {!c.fait && change && (
          <button type="button" className="petit ct-changer" onClick={() => onChanger(index)}>
            {tr('Changer', 'Swap')} · <Rubis n={PRIX_CHANGER_CONTRAT} taille={14} />
          </button>
        )}
      </div>
      {c.fait && <img className={`ct-tampon ${tampon && !mouvementReduit() ? 'frappe' : ''}`} src="/cartes/contrat-tampon.webp" alt={tr('Accompli', 'Done')} />}
    </li>
  );
}

function GrosCoup({ c }: { c: Contrat }) {
  const pct = Math.round((100 * c.progres) / Math.max(1, c.cible));
  return (
    <li className={`ct-gros-coup ${c.fait ? 'fait' : ''}`}>
      <span className="ct-gros-coup-texte">
        <strong>{texte(c)}</strong>
        <span className="ct-barre fine">
          <i style={{ width: `${pct}%` }} />
        </span>
      </span>
      <span className="ct-gros-coup-gain">{c.fait ? '✓' : <Rubis n={RUBIS_GROS_COUP} taille={16} />}</span>
    </li>
  );
}

export function EcranContrats({ vue, appel, onVue, onRetour }: { vue: VueCasino; appel: Appel; onVue: (v: VueCasino) => void; onRetour: () => void }) {
  const c = vue.contrats;
  const finJour = useAttente(c?.finJour);
  const finSemaine = useAttente(c?.finSemaine);
  const [erreur, setErreur] = useState<string | null>(null);
  const [confirme, setConfirme] = useState<number | null>(null);
  const niveau = vue.profil?.niveau ?? niveauCasino(0);
  const changer = async (index: number) => {
    setErreur(null);
    setConfirme(null);
    const r = (await appel('casino_contrat_changer', { index })) as { ok: boolean; erreur?: string; casino?: VueCasino };
    if (r.casino) onVue(r.casino);
    if (!r.ok) setErreur(r.erreur ?? tr('Impossible de changer ce contrat.', 'Could not swap this contract.'));
    else jouerEffet('melange');
  };
  if (!c) return null;
  const faits = c.jour.filter((x) => x.fait).length;
  return (
    <div className="cas-ecran ct-ecran ct-contrats">
      <header className="cas-barre">
        <button type="button" className="cas-retour" onClick={onRetour}>
          ‹ {tr('Salon', 'Lounge')}
        </button>
        <h1>{tr('Contrats', 'Contracts')}</h1>
        <Rubis n={c.rubis} taille={22} className="ct-rubis-barre" />
      </header>
      <section className="ct-bureau">
        <p className="ct-intro">{tr('Le Baron a trois affaires pour toi aujourd’hui.', 'The Baron has three jobs for you today.')}</p>
        <ol className="ct-dossiers">
          {c.jour.map((x, i) => (
            <Dossier key={`${x.id}-${i}`} c={x} index={i} niveau={niveau} change={c.changeDispo} onChanger={setConfirme} />
          ))}
        </ol>
        <p className={`ct-bonus ${c.tous ? 'fait' : ''}`}>
          {c.tous ? '✓ ' : `${faits}/${c.jour.length} · `}
          {tr('Les trois remplis :', 'All three done:')} <Rubis n={RUBIS_TOUS_CONTRATS} taille={16} />
        </p>
        {finJour && <p className="ct-fin">{tr(`Nouveaux contrats dans ${finJour}`, `New contracts in ${finJour}`)}</p>}
      </section>
      <section className="ct-semaine">
        <h2>{tr('Les gros coups de la semaine', 'This week’s big jobs')}</h2>
        <ul>
          {c.grosCoups.map((x) => (
            <GrosCoup key={x.id} c={x} />
          ))}
        </ul>
        {finSemaine && <p className="ct-fin">{tr(`Fin lundi, dans ${finSemaine}`, `Ends Monday, in ${finSemaine}`)}</p>}
      </section>
      <p className="cas-mention">
        {tr(
          'Les rubis se gagnent avec les contrats et l’album, jamais aux jeux. Ils ne s’envoient pas et ne s’achètent pas.',
          'Rubies come from contracts and the album, never from the games. They cannot be sent or bought.',
        )}
      </p>
      {erreur && <div className="toast">{erreur}</div>}
      {confirme !== null && c.jour[confirme] && (
        <div className="voile" role="dialog" aria-modal="true" onClick={() => setConfirme(null)}>
          <div className="fenetre ct-confirme" onClick={(e) => e.stopPropagation()}>
            <p>{tr(`Changer « ${texte(c.jour[confirme])} » contre un autre contrat ?`, `Swap “${texte(c.jour[confirme])}” for another contract?`)}</p>
            <p className="discret">{tr(`Coût : ${PRIX_CHANGER_CONTRAT} rubis. Un seul changement par jour.`, `Cost: ${PRIX_CHANGER_CONTRAT} rubies. One swap a day.`)}</p>
            <div className="ct-confirme-boutons">
              <button type="button" onClick={() => setConfirme(null)}>
                {tr('Garder', 'Keep')}
              </button>
              <button type="button" className="principal" disabled={c.rubis < PRIX_CHANGER_CONTRAT} onClick={() => void changer(confirme)}>
                {tr('Changer', 'Swap')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// L'album

/** Une page : la vignette du jeu découpée en 6 morceaux (2 colonnes × 3 rangées), collés dans les cases dorées. */
function PageAlbum({ jeu, masque, nouveau }: { jeu: JeuCasino; masque: number; nouveau?: number | null }) {
  // La page porte le nom du jeu pour les lecteurs d'écran.
  const complete = pageComplete(masque);
  return (
    <div className={`ct-page ${complete ? 'complete' : ''}`} role="img" aria-label={`${nomJeu(jeu)} : ${morceauxDe(masque)}/${MORCEAUX_PAGE}`}>
      {Array.from({ length: MORCEAUX_PAGE }, (_, k) => {
        const colle = !!(masque & (1 << k));
        return (
          <span
            key={k}
            className={`ct-case ${colle ? 'collee' : ''} ${nouveau === k ? 'nouvelle' : ''}`}
            style={{ '--col': k % 2, '--rang': Math.floor(k / 2), backgroundImage: colle ? `url(${vignette(jeu)})` : undefined } as CSSProperties}
          >
            {!colle && <i>{k + 1}</i>}
          </span>
        );
      })}
      {complete && <span className="ct-page-ruban">{tr('Page complète', 'Page complete')}</span>}
    </div>
  );
}

export function EcranAlbum({ vue, onRetour, pageDepart }: { vue: VueCasino; onRetour: () => void; pageDepart?: JeuCasino | null }) {
  const c = vue.contrats;
  const [page, setPage] = useState<number | null>(pageDepart ? JEUX_CASINO.indexOf(pageDepart) : null);
  if (!c) return null;
  const total = JEUX_CASINO.reduce((s, j) => s + morceauxDe(c.album[j]), 0);
  const pages = JEUX_CASINO.filter((j) => pageComplete(c.album[j])).length;
  const tourner = (sens: number) => {
    jouerEffet('carte');
    setPage((p) => ((p ?? 0) + sens + JEUX_CASINO.length) % JEUX_CASINO.length);
  };
  const jeu = page === null ? null : JEUX_CASINO[page];
  return (
    <div className="cas-ecran ct-ecran ct-album">
      <header className="cas-barre">
        <button type="button" className="cas-retour" onClick={page === null ? onRetour : () => setPage(null)}>
          ‹ {page === null ? tr('Salon', 'Lounge') : tr('Couverture', 'Cover')}
        </button>
        <h1>{tr('L’Album du Baron', 'The Baron’s Album')}</h1>
        <Rubis n={c.rubis} taille={22} className="ct-rubis-barre" />
      </header>
      {jeu === null ? (
        <>
          <button type="button" className="ct-couverture" onClick={() => setPage(0)} aria-label={tr('Ouvrir l’album', 'Open the album')}>
            <img src="/cartes/album-couverture.webp" alt="" />
            <span className="ct-couverture-ouvrir">{tr('Ouvrir', 'Open')}</span>
          </button>
          <p className="ct-album-total">
            {tr(`${total} morceaux sur ${JEUX_CASINO.length * MORCEAUX_PAGE}`, `${total} of ${JEUX_CASINO.length * MORCEAUX_PAGE} pieces`)} · {tr(`${pages} pages complètes`, `${pages} pages complete`)}
          </p>
          <ul className="ct-sommaire">
            {JEUX_CASINO.map((j, i) => (
              <li key={j}>
                <button type="button" className={pageComplete(c.album[j]) ? 'complete' : ''} onClick={() => setPage(i)}>
                  <img src={vignette(j)} alt="" style={{ opacity: 0.25 + (0.75 * morceauxDe(c.album[j])) / MORCEAUX_PAGE }} />
                  <small>
                    {morceauxDe(c.album[j])}/{MORCEAUX_PAGE}
                  </small>
                </button>
              </li>
            ))}
          </ul>
          <p className="discret ct-album-aide">
            {tr(
              `Chaque contrat rempli et ta première victoire du jour à chaque jeu collent un morceau. Une page complète : ${RUBIS_PAGE} rubis. L’album entier : ${RUBIS_ALBUM} rubis.`,
              `Each contract you complete and your first win of the day at each game add a piece. A full page: ${RUBIS_PAGE} rubies. The whole album: ${RUBIS_ALBUM} rubies.`,
            )}
          </p>
        </>
      ) : (
        <>
          <h2 className="ct-page-titre">{nomJeu(jeu)}</h2>
          <PageAlbum key={jeu} jeu={jeu} masque={c.album[jeu] ?? 0} />
          <div className="ct-tourner">
            <button type="button" onClick={() => tourner(-1)} aria-label={tr('Page précédente', 'Previous page')}>
              ‹
            </button>
            <span>
              {(page ?? 0) + 1} / {JEUX_CASINO.length}
            </span>
            <button type="button" onClick={() => tourner(1)} aria-label={tr('Page suivante', 'Next page')}>
              ›
            </button>
          </div>
          <p className="discret ct-album-aide">
            {pageComplete(c.album[jeu])
              ? tr('Page complète !', 'Page complete!')
              : tr(`Gagne une partie de ${nomJeu(jeu)} chaque jour pour un morceau de plus.`, `Win a round of ${nomJeu(jeu)} each day for one more piece.`)}
          </p>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Les annonces : contrat rempli (tampon), morceau collé, page complète

/** Écoute le serveur : un bandeau pour chaque contrat rempli ou morceau collé (sans couper le jeu en cours). */
export function AnnoncesContrats({ onOuvrir, onAnnonce }: { onOuvrir: (ecran: 'contrats' | 'album') => void; onAnnonce: () => void }) {
  const surAnnonceRef = useRef(onAnnonce);
  surAnnonceRef.current = onAnnonce;
  const [file, setFile] = useState<{ id: number; a: AnnonceContrats }[]>([]);
  useEffect(() => {
    const surAnnonce = (a: AnnonceContrats) => {
      setFile((f) => [...f, { id: Date.now() + Math.random(), a }]);
      surAnnonceRef.current();
      if (a.contrats.length || a.morceaux.some((m) => m.page)) jouerEffet('roulette_gain');
      else jouerEffet('jeton');
    };
    socket.on('casino_contrats', surAnnonce);
    return () => {
      socket.off('casino_contrats', surAnnonce);
    };
  }, []);
  const tete = file[0];
  useEffect(() => {
    if (!tete) return;
    const t = window.setTimeout(() => setFile((f) => f.slice(1)), tete.a.contrats.length || tete.a.morceaux.some((m) => m.page) ? 4200 : 2600);
    return () => window.clearTimeout(t);
  }, [tete]);
  if (!tete) return null;
  const { a } = tete;
  const contrat = a.contrats[0];
  const page = a.morceaux.find((m) => m.page);
  const morceau = a.morceaux[0];
  const titre = contrat
    ? contrat.semaine
      ? tr('Gros coup réussi !', 'Big job done!')
      : a.tous
        ? tr('Les trois contrats remplis !', 'All three contracts done!')
        : tr('Contrat rempli !', 'Contract done!')
    : page
      ? page.album
        ? tr('Album complet !', 'Album complete!')
        : tr(`Page complète : ${nomJeu(page.jeu)}`, `Page complete: ${nomJeu(page.jeu)}`)
      : morceau
        ? tr(`Nouveau morceau : ${nomJeu(morceau.jeu)}`, `New piece: ${nomJeu(morceau.jeu)}`)
        : tr('Récompense', 'Reward');
  const detail = contrat ? texte(contrat) : '';
  return (
    <button
      type="button"
      key={tete.id}
      className={`ct-annonce ${contrat || page ? 'grande' : ''}`}
      onClick={() => {
        setFile((f) => f.slice(1));
        onOuvrir(contrat ? 'contrats' : 'album');
      }}
    >
      {contrat ? <img className="ct-annonce-tampon" src="/cartes/contrat-tampon.webp" alt="" /> : morceau ? <img className="ct-annonce-vignette" src={vignette(morceau.jeu)} alt="" /> : null}
      <span>
        <strong>{titre}</strong>
        {detail && <small>{detail}</small>}
        <small className="ct-annonce-gains">
          {a.rubis > 0 && <Rubis n={a.rubis} taille={15} />}
          {a.dollars > 0 && <span> +{dollars(a.dollars)}</span>}
          {contrat && morceau && <span> · {tr('1 morceau d’album', '1 album piece')}</span>}
        </small>
      </span>
    </button>
  );
}
