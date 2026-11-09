/**
 * Classement de la semaine : le meilleur score de chaque joueur, du lundi 0 h au dimanche minuit (heure de Paris).
 * Les 3 premiers portent la couronne d'or, d'argent ou de bronze à côté de leur nom, partout dans le jeu, et les 10
 * premiers gagnent de l'XP chaque lundi (500, 300, 200, puis 100).
 */
import { useEffect, useState } from 'react';
import { xpRecompenseSemaine } from '../../shared/niveaux';
import type { EntreeClassementVue, MeneurSemaine, RecompenseSemaine, VueClassement } from '../../shared/types';
import type { Appel } from './App';
import { BadgeNiveau } from './Profil';
import { EN, LOCALE, tr } from './traduction';
import { Celebration, Couronne, CouronneRang, Fenetre, jouerEffet, useCompteur } from './ui';

const nomAffiche = (nom: string | null) => nom ?? tr('Joueur', 'Player');
const rangTexte = (rang: number) => (EN ? `${rang}${rang === 1 ? 'st' : rang === 2 ? 'nd' : rang === 3 ? 'rd' : 'th'}` : rang === 1 ? '1er' : `${rang}e`);

/** « du lun. 2 au dim. 8 nov. » */
function datesSemaine(debut: number, fin: number): string {
  const jour = (t: number) => new Date(t).toLocaleDateString(LOCALE, { timeZone: 'Europe/Paris', weekday: 'short', day: 'numeric', month: 'short' });
  return tr(`du ${jour(debut)} au ${jour(fin - 1)}`, `${jour(debut)} to ${jour(fin - 1)}`);
}

/** Temps restant avant la fin de la semaine, remis à jour chaque minute. */
function useFinDans(fin: number | undefined): string {
  const [maintenant, setMaintenant] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setMaintenant(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  if (!fin) return '';
  const reste = Math.max(0, fin - maintenant);
  const j = Math.floor(reste / 86_400_000);
  const h = Math.floor((reste % 86_400_000) / 3_600_000);
  const min = Math.max(1, Math.ceil((reste % 3_600_000) / 60_000));
  if (j > 0) return tr(`Fin dans ${j} j ${h} h`, `Ends in ${j} d ${h} h`);
  if (h > 0) return tr(`Fin dans ${h} h ${min} min`, `Ends in ${h} h ${min} min`);
  return tr(`Fin dans ${min} min`, `Ends in ${min} min`);
}

function Podium({ entrees }: { entrees: EntreeClassementVue[] }) {
  const top = entrees.slice(0, 3);
  // 2e à gauche, 1er au centre, 3e à droite.
  const ordre = top.length === 3 ? [top[1], top[0], top[2]] : top.length === 2 ? [top[1], top[0]] : top;
  return (
    <div className={`semaine-podium n-${top.length}`}>
      {ordre.map((e) => (
        <div key={`${e.rang}-${e.nom}`} className={`semaine-place place-${e.rang} ${e.moi ? 'moi' : ''}`}>
          <Couronne rang={e.rang as 1 | 2 | 3} className="semaine-couronne" />
          <img className="semaine-avatar" src={`/cartes/avatar-${e.avatar}.webp`} alt="" draggable={false} />
          <strong>{nomAffiche(e.nom)}</strong>
          <span className="semaine-score">{e.score} pts</span>
          <BadgeNiveau niveau={e.niveau} />
          {xpRecompenseSemaine(e.rang) > 0 && <span className="semaine-gain">+{xpRecompenseSemaine(e.rang)} XP</span>}
        </div>
      ))}
    </div>
  );
}

function Liste({ entrees }: { entrees: EntreeClassementVue[] }) {
  if (entrees.length <= 3) return null;
  return (
    <ol className="semaine-liste">
      {entrees.slice(3).map((e) => (
        <li key={`${e.rang}-${e.nom}`} className={e.moi ? 'moi' : ''}>
          <span className="semaine-rang">{e.rang}</span>
          <img className="mini-avatar" src={`/cartes/avatar-${e.avatar}.webp`} alt="" draggable={false} />
          <span className="semaine-nom">
            {nomAffiche(e.nom)}
            {e.moi && <small>{tr(' (toi)', ' (you)')}</small>}
          </span>
          <BadgeNiveau niveau={e.niveau} />
          <span className="semaine-fin">
            <strong className="semaine-score">{e.score}</strong>
            {xpRecompenseSemaine(e.rang) > 0 && <small className="semaine-gain-ligne">+{xpRecompenseSemaine(e.rang)} XP</small>}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function FenetreClassement({ appel, onFermer, connecte }: { appel: Appel; onFermer: () => void; connecte: boolean }) {
  const [vue, setVue] = useState<VueClassement | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [onglet, setOnglet] = useState<'semaine' | 'precedente'>('semaine');
  useEffect(() => {
    let annule = false;
    void appel('classement').then((r) => {
      if (annule) return;
      if (r.ok && r.classement) setVue(r.classement);
      else setErreur(r.erreur ?? tr('Classement indisponible pour le moment.', 'Ranking unavailable right now.'));
    });
    return () => {
      annule = true;
    };
  }, [appel]);
  const finDans = useFinDans(vue?.semaine.fin);
  const cette = vue?.semaine;
  const avant = vue?.precedente;
  const entrees = onglet === 'semaine' ? (cette?.entrees ?? []) : (avant?.entrees ?? []);
  const moi = onglet === 'semaine' ? cette?.moi : null;
  return (
    <Fenetre titre={tr('Classement', 'Weekly ranking')} onFermer={onFermer} large>
      {!vue && !erreur && <p className="discret">{tr('Chargement…', 'Loading…')}</p>}
      {erreur && <p className="discret">{erreur}</p>}
      {vue && (
        <>
          <div className="segments" role="tablist" aria-label={tr('Semaine', 'Week')}>
            <button type="button" role="tab" aria-selected={onglet === 'semaine'} className={onglet === 'semaine' ? 'choisi' : ''} onClick={() => setOnglet('semaine')}>
              {tr('Cette semaine', 'This week')}
            </button>
            <button type="button" role="tab" aria-selected={onglet === 'precedente'} className={onglet === 'precedente' ? 'choisi' : ''} onClick={() => setOnglet('precedente')}>
              {tr('Semaine dernière', 'Last week')}
            </button>
          </div>
          <p className="semaine-dates">
            {onglet === 'semaine' && cette ? (
              <>
                {datesSemaine(cette.debut, cette.fin)} · <strong>{finDans}</strong>
              </>
            ) : avant ? (
              datesSemaine(avant.debut, avant.fin)
            ) : (
              ''
            )}
          </p>
          {entrees.length === 0 ? (
            <div className="semaine-vide">
              <Couronne className="semaine-vide-couronne" />
              <p>
                {onglet === 'semaine'
                  ? tr('Aucun score pour l’instant cette semaine : la couronne et 500 XP t’attendent !', 'No scores yet this week: the crown and 500 XP are waiting for you!')
                  : tr('Personne n’a joué la semaine dernière.', 'Nobody played last week.')}
              </p>
            </div>
          ) : (
            <>
              <Podium entrees={entrees} />
              <Liste entrees={entrees} />
            </>
          )}
          {moi && moi.rang > entrees.length && (
            <p className="semaine-moi">
              {tr('Toi :', 'You:')} <strong>{rangTexte(moi.rang)}</strong> · {moi.score} pts
            </p>
          )}
          {onglet === 'semaine' && cette && cette.total > entrees.length && (
            <p className="discret">{tr(`${cette.total} joueurs classés cette semaine.`, `${cette.total} players ranked this week.`)}</p>
          )}
          {onglet === 'semaine' && !moi && (
            <p className="semaine-astuce">
              {connecte
                ? tr('Termine une partie à au moins 2 joueurs humains pour entrer au classement.', 'Finish a game with at least 2 human players to enter the ranking.')
                : tr('Connecte-toi à ton compte pour entrer au classement.', 'Sign in to your account to enter the ranking.')}
            </p>
          )}
          <p className="discret semaine-regles">
            {tr(
              'Ton meilleur score de la semaine compte, en parties jouées jusqu’au bout avec au moins 2 joueurs humains. Les 3 premiers portent la couronne d’or, d’argent ou de bronze à côté de leur nom. Tout repart à zéro le lundi à 0 h (heure de Paris) : les 10 premiers gagnent alors de l’XP (500 pour le 1er, 300 pour le 2e, 200 pour le 3e, puis 100 jusqu’au 10e), ajoutée à leur première connexion de la semaine suivante.',
              'Your best score of the week counts, in games played to the end with at least 2 human players. The top 3 wear the gold, silver or bronze crown next to their name. Everything resets on Monday at midnight (Paris time): the top 10 then earn XP (500 for 1st, 300 for 2nd, 200 for 3rd, then 100 down to 10th), added the first time they sign in the following week.',
            )}
          </p>
        </>
      )}
    </Fenetre>
  );
}

/** Lundi : récompense du classement de la semaine dernière, fêtée en plein écran (l'XP monte dans le médaillon). */
export function CelebrationRecompense({ recompense, onFermer }: { recompense: RecompenseSemaine; onFermer: () => void }) {
  const { rang, xp, niveau, niveauAvant } = recompense;
  const valeur = useCompteur(xp, 0, 1000, 900);
  useEffect(() => {
    jouerEffet(rang <= 3 ? 'roulette_gros_lot' : 'roulette_gain');
    if (niveau <= niveauAvant) return;
    const t = window.setTimeout(() => jouerEffet('niveau'), 2300);
    return () => window.clearTimeout(t);
  }, [rang, niveau, niveauAvant]);
  return (
    <Celebration
      titre={tr(`${rangTexte(rang)} de la semaine\u00a0!`, `${rangTexte(rang)} of the week!`)}
      etiquette={tr(`Récompense du classement de la semaine : ${xp} XP`, `Weekly ranking reward: ${xp} XP`)}
      medaillon={
        <div className={`celebration-recompense rang-${Math.min(rang, 4)}`}>
          {rang <= 3 ? <Couronne rang={rang as 1 | 2 | 3} className="celebration-recompense-couronne" /> : <span className="celebration-recompense-rang">{rangTexte(rang)}</span>}
          <strong>+{valeur}</strong>
          <small>XP</small>
        </div>
      }
      legende={niveau > niveauAvant ? tr(`Niveau ${niveau} atteint\u00a0!`, `Level ${niveau} reached!`) : tr('Récompense du classement', 'Ranking reward')}
      onFermer={onFermer}
    />
  );
}

/** Haut de l'accueil : petite pastille du Baron de la semaine (touche pour voir tout le classement). */
export function BanniereBaron({ baron, onOuvrir }: { baron: MeneurSemaine | null; onOuvrir: () => void }) {
  const titre = baron?.semaine === 'precedente' ? tr('Semaine dernière', 'Last week') : tr('Baron de la semaine', 'Baron of the week');
  const resume = baron ? `${titre} : ${nomAffiche(baron.nom)}, ${baron.score} pts` : tr('Baron de la semaine : la couronne est à prendre', 'Baron of the week: the crown is up for grabs');
  return (
    <button
      type="button"
      className={`banniere-baron ${baron ? '' : 'vide'}`}
      onClick={onOuvrir}
      aria-label={`${resume}. ${tr('Voir le classement', 'See the ranking')}`}
      title={tr('Voir le classement de la semaine', 'See the weekly ranking')}
    >
      <Couronne className="banniere-couronne" />
      <span className="banniere-texte">
        <small>{titre}</small>
        {baron ? (
          <strong>
            <span className="banniere-nom">{nomAffiche(baron.nom)}</span>
            <span className="banniere-score">{baron.score} pts</span>
          </strong>
        ) : (
          <strong>{tr('À prendre !', 'Up for grabs!')}</strong>
        )}
      </span>
    </button>
  );
}

export { CouronneRang };
