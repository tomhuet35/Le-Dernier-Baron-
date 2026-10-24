import type React from 'react';
import { useEffect, useState, type FormEvent } from 'react';
import { niveauDepuisXp, progression, TAPIS, XP_NUIT, XP_PARTIE, XP_VICTOIRE, xpPourNiveau, type IdTapis, type Tapis } from '../../shared/niveaux';
import { DESCRIPTION_NIVEAU_BOT, DESCRIPTION_STYLE_BOT, NOM_NIVEAU_BOT, NOM_STYLE_BOT } from '../../shared/robot';
import type { AmiVue, BilanCompte, ListeAmis, ProfilCompte, ProfilPublic, StatutAmi } from '../../shared/types';
import type { Appel } from './App';
import type { Utilisateur } from './connexion';
import { DESCRIPTION_NIVEAU_BOT_EN, DESCRIPTION_STYLE_BOT_EN, NOM_NIVEAU_BOT_EN, NOM_STYLE_BOT_EN, NOM_TAPIS_EN } from '../../shared/langue';
import { EN, LOCALE, pluriel as plurielTr, titreNiveau, tr } from './traduction';
import { ActionsModeration } from './Moderation';
import { Defilant, Fenetre, IconeImage } from './ui';

export type ModuleConnexion = typeof import('./connexion');

/** Tout ce que l'interface sait du compte du joueur sur ce téléphone. */
export interface EtatCompte {
  /** Les comptes sont configurés sur le serveur. */
  actif: boolean;
  /** Firebase a fini de vérifier si quelqu'un est déjà connecté. */
  pret: boolean;
  module: ModuleConnexion | null;
  utilisateur: Utilisateur | null;
  /** Profil confirmé par le serveur (null tant qu'il n'a pas répondu). */
  profil: ProfilCompte | null;
  chargement: boolean;
  rafraichir: () => void;
  /** À appeler juste après une inscription, pour que le serveur prenne le pseudo. */
  apresInscription: () => void;
  /** Profil renvoyé par le serveur après un changement (tapis…). */
  majProfil: (p: ProfilCompte) => void;
}

const victoires = (n: number) => plurielTr(n, 'victoire', 'win');
const nuitsTexte = (n: number) => (EN ? `${n} night${n > 1 ? 's' : ''} won` : `${n} nuit${n > 1 ? 's' : ''} gagnée${n > 1 ? 's' : ''}`);
const rangTexte = (rang: number) => (EN ? `${rang}${rang === 1 ? 'st' : rang === 2 ? 'nd' : rang === 3 ? 'rd' : 'th'}` : rang === 1 ? '1er' : `${rang}e`);
const dateCourte = (d: number) => new Date(d).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' });
/** Nom d'un tapis dans la langue du joueur. */
export const nomTapis = (t: Tapis) => (EN ? (NOM_TAPIS_EN[t.id] ?? t.nom) : t.nom);

/** Médaille du niveau (le titre est toujours écrit dans la langue du joueur). */
export function BadgeNiveau({ niveau, grand }: { niveau: number; titre?: string; grand?: boolean }) {
  const titre = titreNiveau(niveau);
  return (
    <span className={`medaille ${grand ? 'grand' : ''}`} title={tr(`Niveau ${niveau} : ${titre}`, `Level ${niveau}: ${titre}`)}>
      <small>{tr('Niv.', 'Lvl')}</small>
      {niveau}
    </span>
  );
}

export function BarreXp({ xp, compact }: { xp: number; compact?: boolean }) {
  const p = progression(xp);
  return (
    <div className={`barre-xp ${compact ? 'compact' : ''}`}>
      <div className="barre-xp-fond" role="progressbar" aria-label={tr('Expérience', 'Experience')} aria-valuemin={0} aria-valuemax={p.xpPalier} aria-valuenow={p.xpDansNiveau}>
        <span style={{ width: `${Math.round(p.fraction * 100)}%` }} />
      </div>
      <small>
        {compact
          ? `${p.xpDansNiveau} / ${p.xpPalier} XP`
          : tr(`${xp} XP · encore ${xpPourNiveau(p.niveau + 1) - xp} XP pour le niveau ${p.niveau + 1}`, `${xp} XP · ${xpPourNiveau(p.niveau + 1) - xp} XP to level ${p.niveau + 1}`)}
      </small>
    </div>
  );
}

/** Détail de l'expérience gagnée pendant une partie. */
export function detailXp(b: BilanCompte): string {
  if (b.abandon) return tr('Partie quittée avant la fin : aucune XP.', 'Game left before the end: no XP.');
  const morceaux = [tr(`+${XP_PARTIE} partie terminée`, `+${XP_PARTIE} game finished`)];
  if (b.victoire) morceaux.push(tr(`+${XP_VICTOIRE} victoire`, `+${XP_VICTOIRE} win`));
  if (b.nuitsGagnees) morceaux.push(tr(`+${XP_NUIT * b.nuitsGagnees} pour ${nuitsTexte(b.nuitsGagnees)}`, `+${XP_NUIT * b.nuitsGagnees} for ${nuitsTexte(b.nuitsGagnees)}`));
  return morceaux.join(' · ') + (b.xpDouble ? tr(' · ×2 week-end XP double', ' · ×2 double XP weekend') : '');
}

/** Encart « Ton compte » de l'accueil et du salon. */
export function CarteCompte({ compte, appel, contexte, pseudo }: { compte: EtatCompte; appel: Appel; contexte: 'accueil' | 'salon'; pseudo: string }) {
  const [fenetre, setFenetre] = useState<'connexion' | 'inscription' | 'profil' | null>(null);
  if (!compte.actif || !compte.pret) return null;
  const fermer = () => setFenetre(null);
  const connexion =
    (fenetre === 'connexion' || fenetre === 'inscription') && compte.module ? (
      <FenetreConnexion module={compte.module} modeInitial={fenetre} pseudoInitial={pseudo} onFermer={fermer} onInscrit={compte.apresInscription} />
    ) : null;

  if (!compte.utilisateur) {
    return (
      <section className="carte-compte" aria-label={tr('Compte joueur', 'Player account')}>
        <p>
          <strong>{tr('👤 Ton compte', '👤 Your account')}</strong>
          <span>
            {contexte === 'salon'
              ? tr('Connecte-toi pour que cette partie compte dans tes victoires.', 'Sign in so this game counts towards your wins.')
              : tr('Garde tes victoires, gagne de l’expérience et monte de niveau.', 'Keep your wins, earn experience and level up.')}
          </span>
        </p>
        <div className="rangee">
          <button type="button" className="petit" onClick={() => setFenetre('connexion')}>
            {tr('Se connecter', 'Sign in')}
          </button>
          <button type="button" className="petit principal" onClick={() => setFenetre('inscription')}>
            {tr('Créer un compte', 'Create an account')}
          </button>
        </div>
        {connexion}
      </section>
    );
  }
  if (!compte.profil) {
    return (
      <section className="carte-compte" aria-label={tr('Compte joueur', 'Player account')}>
        <p className="discret">{compte.chargement ? tr('Connexion à ton compte…', 'Signing in…') : tr('Ton compte n’a pas pu être chargé.', 'Your account could not be loaded.')}</p>
        {!compte.chargement && (
          <div className="rangee">
            <button type="button" className="petit" onClick={compte.rafraichir}>
              {tr('Réessayer', 'Try again')}
            </button>
            <button type="button" className="petit" onClick={() => void compte.module?.deconnecter()}>
              {tr('Se déconnecter', 'Sign out')}
            </button>
          </div>
        )}
      </section>
    );
  }
  if (contexte === 'salon') return null; // dans le salon, le niveau s'affiche dans la liste des joueurs
  const p = compte.profil;
  const prog = progression(p.xp);
  return (
    <section className="carte-compte connecte" aria-label={tr('Compte joueur', 'Player account')}>
      <BadgeNiveau niveau={prog.niveau} grand />
      <div className="carte-compte-texte">
        <strong>{p.nom}</strong>
        <span className="discret">
          {titreNiveau(prog.niveau)} · 🏆 {victoires(p.victoires)}
        </span>
        <BarreXp xp={p.xp} compact />
      </div>
      <button type="button" className="petit" onClick={() => setFenetre('profil')}>
        {tr('Profil', 'Profile')}
      </button>
      {fenetre === 'profil' && <FenetreProfil compte={compte} appel={appel} onFermer={fermer} />}
    </section>
  );
}

export function FenetreConnexion(props: {
  module: ModuleConnexion;
  modeInitial: 'connexion' | 'inscription';
  pseudoInitial: string;
  onFermer: () => void;
  onInscrit: () => void;
  /** Phrase d'explication en haut de la fenêtre (ex. « Crée un compte pour ajouter des amis »). */
  intro?: string;
}) {
  const { module } = props;
  const [mode, setMode] = useState<'connexion' | 'inscription' | 'oubli'>(props.modeInitial);
  const [pseudo, setPseudo] = useState(props.pseudoInitial);
  const [email, setEmail] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const changer = (m: typeof mode) => {
    setMode(m);
    setErreur(null);
    setInfo(null);
  };
  const valider = async (e: FormEvent) => {
    e.preventDefault();
    setErreur(null);
    setInfo(null);
    if (mode === 'inscription' && !pseudo.trim()) return setErreur(tr('Choisis un pseudo.', 'Choose a nickname.'));
    setOccupe(true);
    try {
      if (mode === 'inscription') {
        await module.inscrire(email, motDePasse, pseudo);
        props.onInscrit();
        props.onFermer();
      } else if (mode === 'connexion') {
        await module.connecter(email, motDePasse);
        props.onFermer();
      } else {
        await module.reinitialiser(email);
        setInfo(
          tr(
            `Si un compte existe pour ${email.trim()}, un e-mail vient d’être envoyé avec un lien pour choisir un nouveau mot de passe (pense à regarder les spams).`,
            `If an account exists for ${email.trim()}, an e-mail has been sent with a link to choose a new password (check your spam folder).`,
          ),
        );
      }
    } catch (err) {
      setErreur(module.messageErreur(err));
    } finally {
      setOccupe(false);
    }
  };
  const google = async () => {
    setErreur(null);
    try {
      await module.connecterGoogle();
      props.onFermer();
    } catch (err) {
      setErreur(module.messageErreur(err));
    }
  };
  const titres = {
    connexion: tr('Connexion', 'Sign in'),
    inscription: tr('Créer un compte', 'Create an account'),
    oubli: tr('Mot de passe oublié', 'Forgot password'),
  };
  return (
    <Fenetre titre={titres[mode]} onFermer={props.onFermer}>
      {props.intro && <p className="intro-compte">{props.intro}</p>}
      {mode !== 'oubli' && (
        <div className="onglets" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'connexion'} className={mode === 'connexion' ? 'actif' : ''} onClick={() => changer('connexion')}>
            {tr('J’ai un compte', 'I have an account')}
          </button>
          <button type="button" role="tab" aria-selected={mode === 'inscription'} className={mode === 'inscription' ? 'actif' : ''} onClick={() => changer('inscription')}>
            {tr('Nouveau compte', 'New account')}
          </button>
        </div>
      )}
      <form className="form-compte" onSubmit={valider}>
        {mode === 'inscription' && (
          <>
            <label htmlFor="compte-pseudo">{tr('Pseudo', 'Nickname')}</label>
            <input id="compte-pseudo" value={pseudo} maxLength={16} autoComplete="nickname" placeholder={tr('Ex. Lucas', 'e.g. Alex')} onChange={(e) => setPseudo(e.target.value)} />
          </>
        )}
        <label htmlFor="compte-email">{tr('Adresse e-mail', 'E-mail address')}</label>
        <input
          id="compte-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder={tr('prenom@gmail.com', 'name@gmail.com')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        {mode !== 'oubli' && (
          <>
            <label htmlFor="compte-mdp">
              {tr('Mot de passe', 'Password')}
              {mode === 'inscription' ? tr(' (6 caractères minimum)', ' (at least 6 characters)') : ''}
            </label>
            <input
              id="compte-mdp"
              type="password"
              autoComplete={mode === 'inscription' ? 'new-password' : 'current-password'}
              minLength={6}
              value={motDePasse}
              onChange={(e) => setMotDePasse(e.target.value)}
              required
            />
          </>
        )}
        {erreur && (
          <p className="message-erreur" role="alert">
            {erreur}
          </p>
        )}
        {info && (
          <p className="message-info" role="status">
            {info}
          </p>
        )}
        <button type="submit" className="principal large" disabled={occupe}>
          {occupe
            ? tr('Un instant…', 'One moment…')
            : mode === 'inscription'
              ? tr('Créer mon compte', 'Create my account')
              : mode === 'connexion'
                ? tr('Se connecter', 'Sign in')
                : tr('Recevoir le lien', 'Send me the link')}
        </button>
      </form>
      {mode !== 'oubli' && (
        <>
          <div className="separateur">{tr('ou', 'or')}</div>
          <button type="button" className="large" onClick={google}>
            {tr('Continuer avec Google', 'Continue with Google')}
          </button>
        </>
      )}
      {mode === 'connexion' && (
        <button type="button" className="lien-discret" onClick={() => changer('oubli')}>
          {tr('Mot de passe oublié ?', 'Forgot your password?')}
        </button>
      )}
      {mode === 'oubli' && (
        <button type="button" className="lien-discret" onClick={() => changer('connexion')}>
          {tr('Retour à la connexion', 'Back to sign in')}
        </button>
      )}
      <p className="discret">
        {tr(
          'Ton adresse e-mail n’est jamais montrée aux autres joueurs : ils voient seulement ton pseudo et ton niveau.',
          'Your e-mail address is never shown to other players: they only see your nickname and level.',
        )}
      </p>
      {mode === 'inscription' && (
        <p className="discret">
          {tr('En créant un compte, tu acceptes que tes données de jeu soient utilisées comme expliqué dans la page ', 'By creating an account, you agree that your game data is used as explained on the ')}
          <a href="/confidentialite" target="_blank" rel="noopener" className="lien-confidentialite">
            {tr('Confidentialité', 'Privacy page')}
          </a>
          .
        </p>
      )}
    </Fenetre>
  );
}

/** Tapis de jeu : récompenses de niveau, choisies depuis le profil. */
function ChoixTapis({ compte, appel }: { compte: EtatCompte; appel: Appel }) {
  const [occupe, setOccupe] = useState(false);
  const [apercu, setApercu] = useState<Tapis | null>(null);
  const p = compte.profil;
  if (!p) return null;
  const niveau = niveauDepuisXp(p.xp);
  const choisir = async (id: IdTapis) => {
    if (id === p.tapis || occupe) return;
    setOccupe(true);
    const r = await appel('tapis', { tapis: id });
    setOccupe(false);
    if (r.ok && r.profil) compte.majProfil(r.profil as ProfilCompte);
  };
  return (
    <>
      <h3 className="profil-sous-titre">{tr('Tapis de jeu', 'Table felt')}</h3>
      <Defilant className="tapis-choix" role="radiogroup" libelle={tr('Tapis de jeu', 'Table felt')} actif={TAPIS.findIndex((t) => t.id === p.tapis)}>
        {TAPIS.map((t) => {
          const ouvert = niveau >= t.niveau;
          const pose = p.tapis === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={pose}
              aria-label={ouvert ? undefined : tr(`${nomTapis(t)} : voir l'aperçu (se débloque au niveau ${t.niveau})`, `${nomTapis(t)}: preview (unlocks at level ${t.niveau})`)}
              className={`tapis-option ${pose ? 'pose' : ''} ${ouvert ? '' : 'verrouille'}`}
              onClick={() => (ouvert ? void choisir(t.id) : setApercu(t))}
            >
              <span className="tapis-image">
                <img src={`/cartes/miniature-tapis-${t.id}.webp`} alt="" />
                {!ouvert && (
                  <span className="tapis-cadenas" aria-hidden="true">
                    🔒<small>{tr('Aperçu', 'Preview')}</small>
                  </span>
                )}
              </span>
              <span className="tapis-nom">{nomTapis(t)}</span>
              <small>{ouvert ? (pose ? tr('✓ Sur ta table', '✓ On your table') : tr('Choisir', 'Choose')) : tr(`Niveau ${t.niveau}`, `Level ${t.niveau}`)}</small>
            </button>
          );
        })}
      </Defilant>
      {apercu && <ApercuTapis tapis={apercu} niveau={niveau} onFermer={() => setApercu(null)} />}
    </>
  );
}

/** Aperçu en grand d'un tapis pas encore débloqué, tel qu'il sera posé sur la table. */
function ApercuTapis({ tapis, niveau, onFermer }: { tapis: Tapis; niveau: number; onFermer: () => void }) {
  const reste = tapis.niveau - niveau;
  return (
    <Fenetre titre={nomTapis(tapis)} onFermer={onFermer}>
      <div className={`centre tapis-${tapis.id} tapis-apercu`} aria-hidden="true" />
      <p className="tapis-apercu-info">
        <span>
          {tr('🔒 Se débloque au ', '🔒 Unlocks at ')}
          <strong>{tr(`niveau ${tapis.niveau}`, `level ${tapis.niveau}`)}</strong>
        </span>
        <small>
          {tr(
            `Tu es niveau ${niveau} : encore ${reste} niveau${reste > 1 ? 'x' : ''} à gagner.`,
            `You are level ${niveau}: ${reste} more level${reste > 1 ? 's' : ''} to go.`,
          )}
        </small>
      </p>
      <button type="button" onClick={onFermer}>
        {tr('Fermer', 'Close')}
      </button>
    </Fenetre>
  );
}

export function FenetreProfil({ compte, appel, onFermer }: { compte: EtatCompte; appel: Appel; onFermer: () => void }) {
  const [confirmer, setConfirmer] = useState(false);
  const [occupe, setOccupe] = useState(false);
  const { rafraichir } = compte;
  useEffect(() => {
    rafraichir();
  }, [rafraichir]);
  const p = compte.profil;
  if (!p) return null;
  const prog = progression(p.xp);
  const taux = p.parties ? `${Math.round((100 * p.victoires) / p.parties)} %` : '–';
  const deconnecter = async () => {
    await compte.module?.deconnecter();
    onFermer();
  };
  const supprimer = async () => {
    setOccupe(true);
    const r = await appel('supprimer_compte');
    setOccupe(false);
    if (r.ok) {
      await compte.module?.deconnecter();
      onFermer();
    }
  };
  const stats = grilleStats(p);
  return (
    <Fenetre titre={tr('Mon profil', 'My profile')} onFermer={onFermer} large>
      <div className="profil-tete">
        <BadgeNiveau niveau={prog.niveau} grand />
        <div>
          <strong>{p.nom}</strong>
          <span className="titre-niveau">{titreNiveau(prog.niveau)}</span>
          {p.email && <small className="discret">{p.email}</small>}
        </div>
      </div>
      <BarreXp xp={p.xp} />
      <div className="stats-grille">
        {stats.map(([valeur, libelle]) => (
          <div key={libelle} className="stat">
            <strong>{valeur}</strong>
            <span>{libelle}</span>
          </div>
        ))}
      </div>
      <ChoixTapis compte={compte} appel={appel} />
      <details className="gains-xp">
        <summary>{tr('Comment gagner de l’expérience ?', 'How do I earn experience?')}</summary>
        <ul>
          <li>{tr(`Victoire de la partie (Dernier Baron) : +${XP_VICTOIRE} XP`, `Winning the game (Last Baron): +${XP_VICTOIRE} XP`)}</li>
          <li>{tr(`Nuit gagnée (meilleur score de la nuit) : +${XP_NUIT} XP`, `Night won (best score of the night): +${XP_NUIT} XP`)}</li>
          <li>{tr(`Partie terminée : +${XP_PARTIE} XP`, `Game finished: +${XP_PARTIE} XP`)}</li>
        </ul>
        <p className="discret">
          {tr(
            'Les parties de test avec des robots ne comptent pas. Une partie quittée avant la fin ne rapporte aucune XP.',
            'Test games with robots do not count. A game left before the end earns no XP.',
          )}
        </p>
      </details>
      <h3 className="profil-sous-titre">{tr('Dernières parties', 'Recent games')}</h3>
      {p.historique.length ? (
        <Historique entrees={p.historique} detaille />
      ) : (
        <p className="discret">{tr('Aucune partie enregistrée pour l’instant : termine une partie avec tes amis pour la voir ici.', 'No games recorded yet: finish a game with your friends to see it here.')}</p>
      )}
      <p className="reglages-liens">
        <a href="/confidentialite" target="_blank" rel="noopener">
          {tr('Tes données et la confidentialité', 'Your data and privacy')}
        </a>
      </p>
      <div className="rangee profil-actions">
        <button type="button" onClick={deconnecter}>
          {tr('Se déconnecter', 'Sign out')}
        </button>
        <button type="button" className="lien-discret" onClick={() => setConfirmer(true)}>
          {tr('Supprimer mon compte', 'Delete my account')}
        </button>
      </div>
      {confirmer && (
        <div className="confirmation" role="alertdialog" aria-label={tr('Supprimer le compte', 'Delete the account')}>
          <p>{tr('Supprimer définitivement ton compte, tes victoires et ton historique ? C’est irréversible.', 'Permanently delete your account, wins and history? This cannot be undone.')}</p>
          <div className="rangee">
            <button type="button" className="danger" disabled={occupe} onClick={supprimer}>
              {tr('Oui, supprimer', 'Yes, delete')}
            </button>
            <button type="button" onClick={() => setConfirmer(false)}>
              {tr('Annuler', 'Cancel')}
            </button>
          </div>
        </div>
      )}
    </Fenetre>
  );
}

/** Fiche d'un joueur de la table : on l'ouvre en touchant son avatar. */
/** Fiche d'un joueur : à la table (joueurId) ou depuis la liste d'amis (code ami, même hors ligne). */
export function FicheJoueur(props: { joueurId?: string; code?: string; statut?: string; salonCode?: string; moi?: boolean; appel: Appel; onFermer: () => void }) {
  const { joueurId, code, statut, salonCode, appel, onFermer } = props;
  const [profil, setProfil] = useState<ProfilPublic | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  useEffect(() => {
    let annule = false;
    void (code ? appel('profil_ami', { code }) : appel('profil_joueur', { joueurId })).then((r) => {
      if (annule) return;
      if (r.ok && r.profil) setProfil(r.profil as ProfilPublic);
      else setErreur(r.erreur ?? tr('Profil indisponible.', 'Profile unavailable.'));
    });
    return () => {
      annule = true;
    };
  }, [appel, joueurId, code]);
  return (
    <Fenetre titre={profil?.nom ?? tr('Profil', 'Profile')} onFermer={onFermer} large={profil?.type === 'compte'}>
      {!profil && !erreur && <p className="discret">{tr('Chargement…', 'Loading…')}</p>}
      {erreur && <p className="discret">{erreur}</p>}
      {profil && (
        <div className="fiche-tete">
          <img className="fiche-avatar" src={`/cartes/avatar-${profil.avatar}.webp`} alt="" />
          <div>
            <strong>{profil.nom}</strong>
            {profil.type === 'compte' && <span className="titre-niveau">{titreNiveau(progression(profil.xp).niveau)}</span>}
            {statut && <span className="discret">{statut}</span>}
            {profil.type === 'bot' && <span className="discret">{tr('🤖 Joueur ordinateur', '🤖 Computer player')}</span>}
            {profil.type === 'invite' && <span className="discret">{tr('Joue en invité', 'Playing as a guest')}</span>}
          </div>
          {profil.type === 'compte' && <BadgeNiveau niveau={progression(profil.xp).niveau} grand />}
        </div>
      )}
      {profil?.type === 'invite' && <p>{tr('Ce joueur n’a pas de compte : ses victoires ne sont pas enregistrées.', 'This player has no account: their wins are not recorded.')}</p>}
      {profil?.type === 'bot' && (
        <div className="fiche-bot">
          <p>
            <strong>{tr(`Niveau : ${NOM_NIVEAU_BOT[profil.niveau]}`, `Level: ${NOM_NIVEAU_BOT_EN[profil.niveau]}`)}</strong>
            <span>{EN ? DESCRIPTION_NIVEAU_BOT_EN[profil.niveau] : DESCRIPTION_NIVEAU_BOT[profil.niveau]}</span>
          </p>
          <p>
            <strong>{tr(`Style : ${NOM_STYLE_BOT[profil.style]}`, `Style: ${NOM_STYLE_BOT_EN[profil.style]}`)}</strong>
            <span>{EN ? DESCRIPTION_STYLE_BOT_EN[profil.style] : DESCRIPTION_STYLE_BOT[profil.style]}</span>
          </p>
        </div>
      )}
      {/* Joueur humain de la table : couper son chat, le signaler */}
      {profil && profil.type !== 'bot' && salonCode && joueurId && !(profil.type === 'compte' && profil.relation === 'moi') && !props.moi && (
        <ActionsModeration code={salonCode} joueurId={joueurId} nom={profil.nom} appel={appel} />
      )}
      {profil?.type === 'compte' && profil.relation && profil.relation !== 'moi' && (
        <BoutonAmiJoueur
          relation={profil.relation}
          onAjouter={async () => {
            const r = code ? await appel('ajouter_ami', { code }) : await appel('ajouter_ami_joueur', { joueurId });
            if (r.ok && r.resultat) setProfil({ ...profil, relation: r.resultat === 'amis' || r.resultat === 'deja_amis' ? 'ami' : 'demande_envoyee' });
          }}
        />
      )}
      {profil?.type === 'compte' && (
        <>
          <BarreXp xp={profil.xp} />
          <div className="stats-grille">
            {grilleStats(profil).map(([valeur, libelle]) => (
              <div key={libelle} className="stat">
                <strong>{valeur}</strong>
                <span>{libelle}</span>
              </div>
            ))}
          </div>
          {profil.historique.length > 0 && (
            <>
              <h3 className="profil-sous-titre">{tr('Dernières parties', 'Recent games')}</h3>
              <Historique entrees={profil.historique} />
            </>
          )}
        </>
      )}
    </Fenetre>
  );
}

/** Les six chiffres du profil (le sien ou celui d'un autre joueur). */
function grilleStats(p: { victoires: number; parties: number; nuitsGagnees: number; annoncesReussies: number; meilleurScore: number | null }): [string | number, string][] {
  const taux = p.parties ? `${Math.round((100 * p.victoires) / p.parties)} %` : '–';
  return [
    [p.victoires, EN ? (p.victoires > 1 ? 'Wins' : 'Win') : p.victoires > 1 ? 'Victoires' : 'Victoire'],
    [p.parties, EN ? (p.parties > 1 ? 'Games' : 'Game') : p.parties > 1 ? 'Parties' : 'Partie'],
    [taux, tr('Taux de victoire', 'Win rate')],
    [p.nuitsGagnees, EN ? (p.nuitsGagnees > 1 ? 'Nights won' : 'Night won') : p.nuitsGagnees > 1 ? 'Nuits gagnées' : 'Nuit gagnée'],
    [p.annoncesReussies, EN ? (p.annoncesReussies > 1 ? 'Bids made' : 'Bid made') : p.annoncesReussies > 1 ? 'Annonces réussies' : 'Annonce réussie'],
    [p.meilleurScore ?? '–', tr('Meilleur score', 'Best score')],
  ];
}

/** Dernières parties d'un compte. */
function Historique({ entrees, detaille }: { entrees: import('../../shared/types').EntreeHistorique[]; detaille?: boolean }) {
  return (
    <ol className="historique">
      {entrees.map((e) => (
        <li key={`${e.date}-${e.score}`} className={e.victoire ? 'gagnee' : e.abandon ? 'abandon' : ''}>
          <span className="h-rang">{e.victoire ? '♛' : e.abandon ? '⚑' : rangTexte(e.rang)}</span>
          <span className="h-texte">
            <strong>
              {e.abandon
                ? tr('Partie quittée', 'Game left')
                : e.victoire
                  ? tr('Victoire', 'Win')
                  : tr(`${rangTexte(e.rang)} sur ${e.nbJoueurs}`, `${rangTexte(e.rang)} of ${e.nbJoueurs}`)}{' '}
              · {e.score} pts
            </strong>
            <small>
              {dateCourte(e.date)}
              {detaille && e.adversaires.length ? tr(` · contre ${e.adversaires.join(', ')}`, ` · vs ${e.adversaires.join(', ')}`) : ''}
              {detaille && e.nuitsGagnees ? ` · ${nuitsTexte(e.nuitsGagnees)}` : ''}
            </small>
          </span>
          <span className="h-xp">+{e.xp} XP</span>
        </li>
      ))}
    </ol>
  );
}

function BoutonAmiJoueur({ relation, onAjouter }: { relation: 'ami' | 'demande_envoyee' | 'demande_recue' | 'aucune'; onAjouter: () => void }) {
  if (relation === 'ami') return <p className="relation-ami">{tr('✓ Vous êtes amis', '✓ You are friends')}</p>;
  if (relation === 'demande_envoyee') return <p className="relation-ami discret">{tr('Demande d’ami envoyée', 'Friend request sent')}</p>;
  return (
    <button type="button" className="principal large bouton-ajout-ami" onClick={onAjouter}>
      <IconeImage nom="amis" repli="👥" className="icone-bouton" />
      {relation === 'demande_recue' ? tr('Accepter sa demande d’ami', 'Accept their friend request') : tr('Ajouter en ami', 'Add as friend')}
    </button>
  );
}

const TEXTE_STATUT: Record<StatutAmi, string> = EN
  ? { en_ligne: 'Online', en_partie: 'In a game', hors_ligne: 'Offline' }
  : { en_ligne: 'En ligne', en_partie: 'En partie', hors_ligne: 'Hors ligne' };
/** Ami qu'on peut inviter maintenant : en ligne, ou hors ligne avec les notifications activées. */
const invitable = (a: AmiVue) => a.statut === 'en_ligne' || (a.statut === 'hors_ligne' && !!a.notifiable);

function LigneAmi({ ami, onVoir, children }: { ami: AmiVue; onVoir?: () => void; children?: React.ReactNode }) {
  return (
    <li className={`ligne-ami statut-${ami.statut}`}>
      <button type="button" className="ligne-ami-voir" onClick={onVoir} disabled={!onVoir} aria-label={tr(`Voir le profil de ${ami.nom}`, `View ${ami.nom}’s profile`)}>
        <span className="ligne-ami-avatar">
          <img src={`/cartes/avatar-${ami.avatar}.webp`} alt="" />
          <span className={`point ${ami.statut === 'hors_ligne' ? 'hors-ligne' : 'en-ligne'}`} />
        </span>
        <span className="ligne-ami-texte">
          <strong>
            {ami.nom} <BadgeNiveau niveau={ami.niveau} />
          </strong>
          <small>
            {TEXTE_STATUT[ami.statut]}
            {ami.statut === 'hors_ligne' && ami.notifiable ? tr(' · 🔔 joignable', ' · 🔔 reachable') : ''} · 🏆 {victoires(ami.victoires)}
          </small>
        </span>
      </button>
      <span className="ligne-ami-actions">{children}</span>
    </li>
  );
}

/** Liste d'amis : code ami à partager, ajout par code, demandes reçues et envoyées, invitations. */
export function FenetreAmis(props: {
  liste: ListeAmis | null;
  appel: Appel;
  recharger: () => void;
  inviter: (code: string) => void;
  onFermer: () => void;
}) {
  const { liste, appel, recharger, inviter } = props;
  const [code, setCode] = useState('');
  const [copie, setCopie] = useState(false);
  const [aRetirer, setARetirer] = useState<string | null>(null);
  const [fiche, setFiche] = useState<AmiVue | null>(null);
  useEffect(() => {
    recharger();
    const t = window.setInterval(recharger, 20_000);
    return () => window.clearInterval(t);
  }, [recharger]);
  const agir = async (evenement: string, data: unknown) => {
    await appel(evenement, data);
    recharger();
  };
  const ajouter = async (e: FormEvent) => {
    e.preventDefault();
    if (code.trim().length < 6) return;
    const r = await appel('ajouter_ami', { code });
    if (r.ok) setCode('');
    recharger();
  };
  const partager = async () => {
    if (!liste) return;
    const texte = tr(`Ajoute-moi en ami sur Le Dernier Baron : mon code est ${liste.monCode} (${location.origin})`, `Add me as a friend on Le Dernier Baron: my code is ${liste.monCode} (${location.origin})`);
    try {
      if (navigator.share) await navigator.share({ title: 'Le Dernier Baron', text: texte });
      else {
        await navigator.clipboard.writeText(liste.monCode);
        setCopie(true);
      }
    } catch {
      /* partage annulé */
    }
  };
  return (
    <Fenetre titre={tr('Amis', 'Friends')} onFermer={props.onFermer} large>
      {!liste ? (
        <p className="discret">{tr('Chargement…', 'Loading…')}</p>
      ) : (
        <>
          <section className="mon-code">
            <span className="etiquette">{tr('Ton code ami', 'Your friend code')}</span>
            <strong>{liste.monCode}</strong>
            <button type="button" className="petit" onClick={partager}>
              {copie ? tr('Code copié', 'Code copied') : tr('Partager mon code', 'Share my code')}
            </button>
          </section>
          <form className="ajout-ami" onSubmit={ajouter}>
            <label htmlFor="code-ami">{tr('Ajouter un ami avec son code', 'Add a friend with their code')}</label>
            <div className="ajout-ami-ligne">
              <input
                id="code-ami"
                value={code}
                maxLength={10}
                autoCapitalize="characters"
                autoComplete="off"
                placeholder={tr('Ex. K7M2QX', 'e.g. K7M2QX')}
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              />
              <button type="submit" className="principal" disabled={code.length < 6}>
                {tr('Ajouter', 'Add')}
              </button>
            </div>
            <small className="discret">{tr('Tu peux aussi toucher l’avatar d’un joueur pendant une partie pour l’ajouter.', 'You can also tap a player’s avatar during a game to add them.')}</small>
          </form>
          {liste.recues.length > 0 && (
            <section>
              <h3 className="profil-sous-titre">
                {tr('Demandes reçues', 'Requests received')} ({liste.recues.length})
              </h3>
              <ul className="liste-amis">
                {liste.recues.map((a) => (
                  <LigneAmi key={a.code} ami={a} onVoir={() => setFiche(a)}>
                    <button type="button" className="petit principal" onClick={() => agir('repondre_ami', { code: a.code, accepter: true })}>
                      {tr('Accepter', 'Accept')}
                    </button>
                    <button type="button" className="petit" onClick={() => agir('repondre_ami', { code: a.code, accepter: false })}>
                      {tr('Refuser', 'Decline')}
                    </button>
                  </LigneAmi>
                ))}
              </ul>
            </section>
          )}
          <section>
            <h3 className="profil-sous-titre">
              {tr('Mes amis', 'My friends')} ({liste.amis.length})
            </h3>
            {liste.amis.length === 0 ? (
              <p className="discret">{tr('Pas encore d’amis : partage ton code ou ajoute celui d’un ami.', 'No friends yet: share your code or add a friend’s.')}</p>
            ) : (
              <ul className="liste-amis">
                {liste.amis.map((a) => (
                  <LigneAmi key={a.code} ami={a} onVoir={() => setFiche(a)}>
                    {aRetirer === a.code ? (
                      <>
                        <button type="button" className="petit danger" onClick={() => agir('retirer_ami', { code: a.code })}>
                          {tr('Retirer', 'Remove')}
                        </button>
                        <button type="button" className="petit" onClick={() => setARetirer(null)}>
                          {tr('Garder', 'Keep')}
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="petit principal bouton-inviter"
                          disabled={!invitable(a)}
                          title={
                            a.statut === 'en_ligne'
                              ? tr('Inviter dans ta partie privée', 'Invite to your private game')
                              : invitable(a)
                                ? tr('Hors ligne : il recevra une notification', 'Offline: they will get a notification')
                                : TEXTE_STATUT[a.statut]
                          }
                          onClick={() => inviter(a.code)}
                        >
                          <IconeImage nom="invitation" repli="✉️" className="icone-mini" />
                          {tr('Inviter', 'Invite')}
                        </button>
                        <button type="button" className="petit fermer-ami" aria-label={tr(`Retirer ${a.nom} de mes amis`, `Remove ${a.nom} from my friends`)} onClick={() => setARetirer(a.code)}>
                          ×
                        </button>
                      </>
                    )}
                  </LigneAmi>
                ))}
              </ul>
            )}
          </section>
          {liste.envoyees.length > 0 && (
            <section>
              <h3 className="profil-sous-titre">{tr('Demandes envoyées', 'Requests sent')}</h3>
              <ul className="liste-amis">
                {liste.envoyees.map((a) => (
                  <LigneAmi key={a.code} ami={a} onVoir={() => setFiche(a)}>
                    <button type="button" className="petit" onClick={() => agir('retirer_ami', { code: a.code })}>
                      {tr('Annuler', 'Cancel')}
                    </button>
                  </LigneAmi>
                ))}
              </ul>
            </section>
          )}
          <p className="discret">
            {tr(
              'Touche un ami pour voir son profil, même s’il est hors ligne. « Inviter » ouvre une partie privée si tu n’en as pas encore, puis envoie l’invitation à ton ami : dans le jeu s’il est en ligne, par notification s’il est hors ligne et les a activées (🔔).',
              '“Invite” opens a private game if you don’t have one yet, then sends the invitation: in the game if your friend is online, or by notification if they are offline and have turned notifications on (🔔). Tap a friend to see their profile, even offline.',
            )}
          </p>
        </>
      )}
      {fiche && <FicheJoueur code={fiche.code} statut={TEXTE_STATUT[fiche.statut]} appel={appel} onFermer={() => setFiche(null)} />}
    </Fenetre>
  );
}

/** Dans le salon d'une partie privée : inviter ses amis en ligne. */
export function SectionInviterAmis({ liste, inviter, ouvrirAmis }: { liste: ListeAmis | null; inviter: (code: string) => void; ouvrirAmis: () => void }) {
  if (!liste) return null;
  const enLigne = liste.amis.filter((a) => invitable(a) && !a.avecMoi);
  return (
    <section className="inviter-amis">
      <h2>
        <IconeImage nom="invitation" repli="✉️" className="icone-titre" />
        {tr('Inviter des amis', 'Invite friends')}
      </h2>
      {enLigne.length ? (
        <ul className="liste-amis">
          {enLigne.map((a) => (
            <LigneAmi key={a.code} ami={a}>
              <button type="button" className="petit principal" onClick={() => inviter(a.code)}>
                {tr('Inviter', 'Invite')}
              </button>
            </LigneAmi>
          ))}
        </ul>
      ) : (
        <p className="discret">
          {!liste.amis.length
            ? tr('Ajoute des amis pour les inviter ici.', 'Add friends to invite them here.')
            : liste.amis.some((a) => a.avecMoi && a.statut !== 'hors_ligne')
              ? tr('Tes amis en ligne sont déjà à ta table.', 'Your online friends are already at your table.')
              : tr('Aucun ami en ligne pour le moment : partage le lien du salon.', 'No friends online right now: share the room link.')}
        </p>
      )}
      <button type="button" className="lien-discret" onClick={ouvrirAmis}>
        {tr('Gérer mes amis', 'Manage my friends')}
      </button>
    </section>
  );
}
