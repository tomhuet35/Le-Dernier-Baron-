import type React from 'react';
import { useEffect, useState, type FormEvent } from 'react';
import { niveauDepuisXp, progression, TAPIS, XP_NUIT, XP_PARTIE, XP_VICTOIRE, xpPourNiveau, type IdTapis, type Tapis } from '../../shared/niveaux';
import { DESCRIPTION_NIVEAU_BOT, DESCRIPTION_STYLE_BOT, NOM_NIVEAU_BOT, NOM_STYLE_BOT } from '../../shared/robot';
import type { AmiVue, BilanCompte, ListeAmis, ProfilCompte, ProfilPublic, StatutAmi } from '../../shared/types';
import type { Appel } from './App';
import type { Utilisateur } from './connexion';
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

const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`;
const nuitsTexte = (n: number) => `${n} nuit${n > 1 ? 's' : ''} gagnée${n > 1 ? 's' : ''}`;
const rangTexte = (rang: number) => (rang === 1 ? '1er' : `${rang}e`);

export function BadgeNiveau({ niveau, titre, grand }: { niveau: number; titre?: string; grand?: boolean }) {
  return (
    <span className={`medaille ${grand ? 'grand' : ''}`} title={titre ? `Niveau ${niveau} : ${titre}` : `Niveau ${niveau}`}>
      <small>Niv.</small>
      {niveau}
    </span>
  );
}

export function BarreXp({ xp, compact }: { xp: number; compact?: boolean }) {
  const p = progression(xp);
  return (
    <div className={`barre-xp ${compact ? 'compact' : ''}`}>
      <div className="barre-xp-fond" role="progressbar" aria-label="Expérience" aria-valuemin={0} aria-valuemax={p.xpPalier} aria-valuenow={p.xpDansNiveau}>
        <span style={{ width: `${Math.round(p.fraction * 100)}%` }} />
      </div>
      <small>
        {compact
          ? `${p.xpDansNiveau} / ${p.xpPalier} XP`
          : `${xp} XP · encore ${xpPourNiveau(p.niveau + 1) - xp} XP pour le niveau ${p.niveau + 1}`}
      </small>
    </div>
  );
}

/** Détail de l'expérience gagnée pendant une partie. */
export function detailXp(b: BilanCompte): string {
  const morceaux = [`+${XP_PARTIE} partie terminée`];
  if (b.victoire) morceaux.push(`+${XP_VICTOIRE} victoire`);
  if (b.nuitsGagnees) morceaux.push(`+${XP_NUIT * b.nuitsGagnees} pour ${nuitsTexte(b.nuitsGagnees)}`);
  return morceaux.join(' · ');
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
      <section className="carte-compte" aria-label="Compte joueur">
        <p>
          <strong>👤 Ton compte</strong>
          <span>{contexte === 'salon' ? 'Connecte-toi pour que cette partie compte dans tes victoires.' : 'Garde tes victoires, gagne de l’expérience et monte de niveau.'}</span>
        </p>
        <div className="rangee">
          <button type="button" className="petit" onClick={() => setFenetre('connexion')}>
            Se connecter
          </button>
          <button type="button" className="petit principal" onClick={() => setFenetre('inscription')}>
            Créer un compte
          </button>
        </div>
        {connexion}
      </section>
    );
  }
  if (!compte.profil) {
    return (
      <section className="carte-compte" aria-label="Compte joueur">
        <p className="discret">{compte.chargement ? 'Connexion à ton compte…' : 'Ton compte n’a pas pu être chargé.'}</p>
        {!compte.chargement && (
          <div className="rangee">
            <button type="button" className="petit" onClick={compte.rafraichir}>
              Réessayer
            </button>
            <button type="button" className="petit" onClick={() => void compte.module?.deconnecter()}>
              Se déconnecter
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
    <section className="carte-compte connecte" aria-label="Compte joueur">
      <BadgeNiveau niveau={prog.niveau} titre={prog.titre} grand />
      <div className="carte-compte-texte">
        <strong>{p.nom}</strong>
        <span className="discret">
          {prog.titre} · 🏆 {pluriel(p.victoires, 'victoire')}
        </span>
        <BarreXp xp={p.xp} compact />
      </div>
      <button type="button" className="petit" onClick={() => setFenetre('profil')}>
        Profil
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
    if (mode === 'inscription' && !pseudo.trim()) return setErreur('Choisis un pseudo.');
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
        setInfo(`Si un compte existe pour ${email.trim()}, un e-mail vient d’être envoyé avec un lien pour choisir un nouveau mot de passe (pense à regarder les spams).`);
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
  const titres = { connexion: 'Connexion', inscription: 'Créer un compte', oubli: 'Mot de passe oublié' };
  return (
    <Fenetre titre={titres[mode]} onFermer={props.onFermer}>
      {props.intro && <p className="intro-compte">{props.intro}</p>}
      {mode !== 'oubli' && (
        <div className="onglets" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'connexion'} className={mode === 'connexion' ? 'actif' : ''} onClick={() => changer('connexion')}>
            J’ai un compte
          </button>
          <button type="button" role="tab" aria-selected={mode === 'inscription'} className={mode === 'inscription' ? 'actif' : ''} onClick={() => changer('inscription')}>
            Nouveau compte
          </button>
        </div>
      )}
      <form className="form-compte" onSubmit={valider}>
        {mode === 'inscription' && (
          <>
            <label htmlFor="compte-pseudo">Pseudo</label>
            <input id="compte-pseudo" value={pseudo} maxLength={16} autoComplete="nickname" placeholder="Ex. Lucas" onChange={(e) => setPseudo(e.target.value)} />
          </>
        )}
        <label htmlFor="compte-email">Adresse e-mail</label>
        <input
          id="compte-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="prenom@gmail.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        {mode !== 'oubli' && (
          <>
            <label htmlFor="compte-mdp">Mot de passe{mode === 'inscription' ? ' (6 caractères minimum)' : ''}</label>
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
          {occupe ? 'Un instant…' : mode === 'inscription' ? 'Créer mon compte' : mode === 'connexion' ? 'Se connecter' : 'Recevoir le lien'}
        </button>
      </form>
      {mode !== 'oubli' && (
        <>
          <div className="separateur">ou</div>
          <button type="button" className="large" onClick={google}>
            Continuer avec Google
          </button>
        </>
      )}
      {mode === 'connexion' && (
        <button type="button" className="lien-discret" onClick={() => changer('oubli')}>
          Mot de passe oublié ?
        </button>
      )}
      {mode === 'oubli' && (
        <button type="button" className="lien-discret" onClick={() => changer('connexion')}>
          Retour à la connexion
        </button>
      )}
      <p className="discret">Ton adresse e-mail n’est jamais montrée aux autres joueurs : ils voient seulement ton pseudo et ton niveau.</p>
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
      <h3 className="profil-sous-titre">Tapis de jeu</h3>
      <Defilant className="tapis-choix" role="radiogroup" libelle="Tapis de jeu" actif={TAPIS.findIndex((t) => t.id === p.tapis)}>
        {TAPIS.map((t) => {
          const ouvert = niveau >= t.niveau;
          const pose = p.tapis === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={pose}
              aria-label={ouvert ? undefined : `${t.nom} : voir l'aperçu (se débloque au niveau ${t.niveau})`}
              className={`tapis-option ${pose ? 'pose' : ''} ${ouvert ? '' : 'verrouille'}`}
              onClick={() => (ouvert ? void choisir(t.id) : setApercu(t))}
            >
              <span className="tapis-image">
                <img src={`/cartes/miniature-tapis-${t.id}.webp`} alt="" />
                {!ouvert && (
                  <span className="tapis-cadenas" aria-hidden="true">
                    🔒<small>Aperçu</small>
                  </span>
                )}
              </span>
              <span className="tapis-nom">{t.nom}</span>
              <small>{ouvert ? (pose ? '✓ Sur ta table' : 'Choisir') : `Niveau ${t.niveau}`}</small>
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
    <Fenetre titre={tapis.nom} onFermer={onFermer}>
      <div className={`centre tapis-${tapis.id} tapis-apercu`} aria-hidden="true" />
      <p className="tapis-apercu-info">
        <span>
          🔒 Se débloque au <strong>niveau {tapis.niveau}</strong>
        </span>
        <small>
          Tu es niveau {niveau} : encore {reste} niveau{reste > 1 ? 'x' : ''} à gagner.
        </small>
      </p>
      <button type="button" onClick={onFermer}>
        Fermer
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
  const stats: [string | number, string][] = [
    [p.victoires, p.victoires > 1 ? 'Victoires' : 'Victoire'],
    [p.parties, p.parties > 1 ? 'Parties' : 'Partie'],
    [taux, 'Taux de victoire'],
    [p.nuitsGagnees, p.nuitsGagnees > 1 ? 'Nuits gagnées' : 'Nuit gagnée'],
    [p.annoncesReussies, p.annoncesReussies > 1 ? 'Annonces réussies' : 'Annonce réussie'],
    [p.meilleurScore ?? '–', 'Meilleur score'],
  ];
  return (
    <Fenetre titre="Mon profil" onFermer={onFermer} large>
      <div className="profil-tete">
        <BadgeNiveau niveau={prog.niveau} titre={prog.titre} grand />
        <div>
          <strong>{p.nom}</strong>
          <span className="titre-niveau">{prog.titre}</span>
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
        <summary>Comment gagner de l’expérience ?</summary>
        <ul>
          <li>Victoire de la partie (Dernier Baron) : +{XP_VICTOIRE} XP</li>
          <li>Nuit gagnée (meilleur score de la nuit) : +{XP_NUIT} XP</li>
          <li>Partie terminée : +{XP_PARTIE} XP</li>
        </ul>
        <p className="discret">Les parties de test avec des robots ne comptent pas.</p>
      </details>
      <h3 className="profil-sous-titre">Dernières parties</h3>
      {p.historique.length ? (
        <ol className="historique">
          {p.historique.map((e) => (
            <li key={`${e.date}-${e.score}`} className={e.victoire ? 'gagnee' : ''}>
              <span className="h-rang">{e.victoire ? '♛' : rangTexte(e.rang)}</span>
              <span className="h-texte">
                <strong>
                  {e.victoire ? 'Victoire' : `${rangTexte(e.rang)} sur ${e.nbJoueurs}`} · {e.score} pts
                </strong>
                <small>
                  {new Date(e.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                  {e.adversaires.length ? ` · contre ${e.adversaires.join(', ')}` : ''}
                  {e.nuitsGagnees ? ` · ${nuitsTexte(e.nuitsGagnees)}` : ''}
                </small>
              </span>
              <span className="h-xp">+{e.xp} XP</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="discret">Aucune partie enregistrée pour l’instant : termine une partie avec tes amis pour la voir ici.</p>
      )}
      <div className="rangee profil-actions">
        <button type="button" onClick={deconnecter}>
          Se déconnecter
        </button>
        <button type="button" className="lien-discret" onClick={() => setConfirmer(true)}>
          Supprimer mon compte
        </button>
      </div>
      {confirmer && (
        <div className="confirmation" role="alertdialog" aria-label="Supprimer le compte">
          <p>Supprimer définitivement ton compte, tes victoires et ton historique ? C’est irréversible.</p>
          <div className="rangee">
            <button type="button" className="danger" disabled={occupe} onClick={supprimer}>
              Oui, supprimer
            </button>
            <button type="button" onClick={() => setConfirmer(false)}>
              Annuler
            </button>
          </div>
        </div>
      )}
    </Fenetre>
  );
}

/** Fiche d'un joueur de la table : on l'ouvre en touchant son avatar. */
export function FicheJoueur({ joueurId, appel, onFermer }: { joueurId: string; appel: Appel; onFermer: () => void }) {
  const [profil, setProfil] = useState<ProfilPublic | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  useEffect(() => {
    let annule = false;
    void appel('profil_joueur', { joueurId }).then((r) => {
      if (annule) return;
      if (r.ok && r.profil) setProfil(r.profil as ProfilPublic);
      else setErreur(r.erreur ?? 'Profil indisponible.');
    });
    return () => {
      annule = true;
    };
  }, [appel, joueurId]);
  return (
    <Fenetre titre={profil?.nom ?? 'Profil'} onFermer={onFermer} large={profil?.type === 'compte'}>
      {!profil && !erreur && <p className="discret">Chargement…</p>}
      {erreur && <p className="discret">{erreur}</p>}
      {profil && (
        <div className="fiche-tete">
          <img className="fiche-avatar" src={`/cartes/avatar-${profil.avatar}.webp`} alt="" />
          <div>
            <strong>{profil.nom}</strong>
            {profil.type === 'compte' && <span className="titre-niveau">{progression(profil.xp).titre}</span>}
            {profil.type === 'bot' && <span className="discret">🤖 Joueur ordinateur</span>}
            {profil.type === 'invite' && <span className="discret">Joue en invité</span>}
          </div>
          {profil.type === 'compte' && <BadgeNiveau niveau={progression(profil.xp).niveau} titre={progression(profil.xp).titre} grand />}
        </div>
      )}
      {profil?.type === 'invite' && <p>Ce joueur n’a pas de compte : ses victoires ne sont pas enregistrées.</p>}
      {profil?.type === 'bot' && (
        <div className="fiche-bot">
          <p>
            <strong>Niveau : {NOM_NIVEAU_BOT[profil.niveau]}</strong>
            <span>{DESCRIPTION_NIVEAU_BOT[profil.niveau]}</span>
          </p>
          <p>
            <strong>Style : {NOM_STYLE_BOT[profil.style]}</strong>
            <span>{DESCRIPTION_STYLE_BOT[profil.style]}</span>
          </p>
        </div>
      )}
      {profil?.type === 'compte' && profil.relation && profil.relation !== 'moi' && (
        <BoutonAmiJoueur
          relation={profil.relation}
          onAjouter={async () => {
            const r = await appel('ajouter_ami_joueur', { joueurId });
            if (r.ok && r.resultat) setProfil({ ...profil, relation: r.resultat === 'amis' || r.resultat === 'deja_amis' ? 'ami' : 'demande_envoyee' });
          }}
        />
      )}
      {profil?.type === 'compte' && (
        <>
          <BarreXp xp={profil.xp} />
          <div className="stats-grille">
            {(
              [
                [profil.victoires, profil.victoires > 1 ? 'Victoires' : 'Victoire'],
                [profil.parties, profil.parties > 1 ? 'Parties' : 'Partie'],
                [profil.parties ? `${Math.round((100 * profil.victoires) / profil.parties)} %` : '–', 'Taux de victoire'],
                [profil.nuitsGagnees, profil.nuitsGagnees > 1 ? 'Nuits gagnées' : 'Nuit gagnée'],
                [profil.annoncesReussies, profil.annoncesReussies > 1 ? 'Annonces réussies' : 'Annonce réussie'],
                [profil.meilleurScore ?? '–', 'Meilleur score'],
              ] as [string | number, string][]
            ).map(([valeur, libelle]) => (
              <div key={libelle} className="stat">
                <strong>{valeur}</strong>
                <span>{libelle}</span>
              </div>
            ))}
          </div>
          {profil.historique.length > 0 && (
            <>
              <h3 className="profil-sous-titre">Dernières parties</h3>
              <ol className="historique">
                {profil.historique.map((e) => (
                  <li key={`${e.date}-${e.score}`} className={e.victoire ? 'gagnee' : ''}>
                    <span className="h-rang">{e.victoire ? '♛' : rangTexte(e.rang)}</span>
                    <span className="h-texte">
                      <strong>
                        {e.victoire ? 'Victoire' : `${rangTexte(e.rang)} sur ${e.nbJoueurs}`} · {e.score} pts
                      </strong>
                      <small>{new Date(e.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</small>
                    </span>
                    <span className="h-xp">+{e.xp} XP</span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </>
      )}
    </Fenetre>
  );
}

function BoutonAmiJoueur({ relation, onAjouter }: { relation: 'ami' | 'demande_envoyee' | 'demande_recue' | 'aucune'; onAjouter: () => void }) {
  if (relation === 'ami') return <p className="relation-ami">✓ Vous êtes amis</p>;
  if (relation === 'demande_envoyee') return <p className="relation-ami discret">Demande d’ami envoyée</p>;
  return (
    <button type="button" className="principal large bouton-ajout-ami" onClick={onAjouter}>
      <IconeImage nom="amis" repli="👥" className="icone-bouton" />
      {relation === 'demande_recue' ? 'Accepter sa demande d’ami' : 'Ajouter en ami'}
    </button>
  );
}

const TEXTE_STATUT: Record<StatutAmi, string> = { en_ligne: 'En ligne', en_partie: 'En partie', hors_ligne: 'Hors ligne' };

function LigneAmi({ ami, children }: { ami: AmiVue; children?: React.ReactNode }) {
  return (
    <li className={`ligne-ami statut-${ami.statut}`}>
      <span className="ligne-ami-avatar">
        <img src={`/cartes/avatar-${ami.avatar}.webp`} alt="" />
        <span className={`point ${ami.statut === 'hors_ligne' ? 'hors-ligne' : 'en-ligne'}`} />
      </span>
      <span className="ligne-ami-texte">
        <strong>
          {ami.nom} <BadgeNiveau niveau={ami.niveau} titre={ami.titre} />
        </strong>
        <small>
          {TEXTE_STATUT[ami.statut]} · 🏆 {pluriel(ami.victoires, 'victoire')}
        </small>
      </span>
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
    const texte = `Ajoute-moi en ami sur Le Dernier Baron : mon code est ${liste.monCode} (${location.origin})`;
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
    <Fenetre titre="Amis" onFermer={props.onFermer} large>
      {!liste ? (
        <p className="discret">Chargement…</p>
      ) : (
        <>
          <section className="mon-code">
            <span className="etiquette">Ton code ami</span>
            <strong>{liste.monCode}</strong>
            <button type="button" className="petit" onClick={partager}>
              {copie ? 'Code copié' : 'Partager mon code'}
            </button>
          </section>
          <form className="ajout-ami" onSubmit={ajouter}>
            <label htmlFor="code-ami">Ajouter un ami avec son code</label>
            <div className="ajout-ami-ligne">
              <input
                id="code-ami"
                value={code}
                maxLength={10}
                autoCapitalize="characters"
                autoComplete="off"
                placeholder="Ex. K7M2QX"
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              />
              <button type="submit" className="principal" disabled={code.length < 6}>
                Ajouter
              </button>
            </div>
            <small className="discret">Tu peux aussi toucher l’avatar d’un joueur pendant une partie pour l’ajouter.</small>
          </form>
          {liste.recues.length > 0 && (
            <section>
              <h3 className="profil-sous-titre">Demandes reçues ({liste.recues.length})</h3>
              <ul className="liste-amis">
                {liste.recues.map((a) => (
                  <LigneAmi key={a.code} ami={a}>
                    <button type="button" className="petit principal" onClick={() => agir('repondre_ami', { code: a.code, accepter: true })}>
                      Accepter
                    </button>
                    <button type="button" className="petit" onClick={() => agir('repondre_ami', { code: a.code, accepter: false })}>
                      Refuser
                    </button>
                  </LigneAmi>
                ))}
              </ul>
            </section>
          )}
          <section>
            <h3 className="profil-sous-titre">Mes amis ({liste.amis.length})</h3>
            {liste.amis.length === 0 ? (
              <p className="discret">Pas encore d’amis : partage ton code ou ajoute celui d’un ami.</p>
            ) : (
              <ul className="liste-amis">
                {liste.amis.map((a) => (
                  <LigneAmi key={a.code} ami={a}>
                    {aRetirer === a.code ? (
                      <>
                        <button type="button" className="petit danger" onClick={() => agir('retirer_ami', { code: a.code })}>
                          Retirer
                        </button>
                        <button type="button" className="petit" onClick={() => setARetirer(null)}>
                          Garder
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="petit principal bouton-inviter"
                          disabled={a.statut !== 'en_ligne'}
                          title={a.statut === 'en_ligne' ? 'Inviter dans ta partie privée' : TEXTE_STATUT[a.statut]}
                          onClick={() => inviter(a.code)}
                        >
                          <IconeImage nom="invitation" repli="✉️" className="icone-mini" />
                          Inviter
                        </button>
                        <button type="button" className="petit fermer-ami" aria-label={`Retirer ${a.nom} de mes amis`} onClick={() => setARetirer(a.code)}>
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
              <h3 className="profil-sous-titre">Demandes envoyées</h3>
              <ul className="liste-amis">
                {liste.envoyees.map((a) => (
                  <LigneAmi key={a.code} ami={a}>
                    <button type="button" className="petit" onClick={() => agir('retirer_ami', { code: a.code })}>
                      Annuler
                    </button>
                  </LigneAmi>
                ))}
              </ul>
            </section>
          )}
          <p className="discret">« Inviter » ouvre une partie privée si tu n’en as pas encore, puis envoie l’invitation à ton ami en ligne.</p>
        </>
      )}
    </Fenetre>
  );
}

/** Dans le salon d'une partie privée : inviter ses amis en ligne. */
export function SectionInviterAmis({ liste, inviter, ouvrirAmis }: { liste: ListeAmis | null; inviter: (code: string) => void; ouvrirAmis: () => void }) {
  if (!liste) return null;
  const enLigne = liste.amis.filter((a) => a.statut === 'en_ligne' && !a.avecMoi);
  return (
    <section className="inviter-amis">
      <h2>
        <IconeImage nom="invitation" repli="✉️" className="icone-titre" />
        Inviter des amis
      </h2>
      {enLigne.length ? (
        <ul className="liste-amis">
          {enLigne.map((a) => (
            <LigneAmi key={a.code} ami={a}>
              <button type="button" className="petit principal" onClick={() => inviter(a.code)}>
                Inviter
              </button>
            </LigneAmi>
          ))}
        </ul>
      ) : (
        <p className="discret">
          {!liste.amis.length
            ? 'Ajoute des amis pour les inviter ici.'
            : liste.amis.some((a) => a.avecMoi && a.statut !== 'hors_ligne')
              ? 'Tes amis en ligne sont déjà à ta table.'
              : 'Aucun ami en ligne pour le moment : partage le lien du salon.'}
        </p>
      )}
      <button type="button" className="lien-discret" onClick={ouvrirAmis}>
        Gérer mes amis
      </button>
    </section>
  );
}
