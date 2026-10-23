import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MAX_JOUEURS, MIN_JOUEURS } from '../../shared/config';
import { tapisActif, type IdTapis } from '../../shared/niveaux';
import type { Invitation, ListeAmis, ProfilCompte, ProfilPublic, VueSalon } from '../../shared/types';
import type { ConfigComptes, Utilisateur } from './connexion';
import { NIVEAUX_BOT, NOM_NIVEAU_BOT, NOM_STYLE_BOT, STYLES_BOT } from '../../shared/robot';
import {
  BadgeNiveau,
  CarteCompte,
  FenetreAmis,
  FenetreConnexion,
  FenetreProfil,
  FicheJoueur,
  SectionInviterAmis,
  type EtatCompte,
  type ModuleConnexion,
} from './Profil';
import { socket } from './socket';
import { Table } from './Table';
import { FenetreRegles } from './Regles';
import { AVATARS } from './textes';
import { BoutonMusique, Chat, Defilant, Fenetre, IconeImage, IconeMusique, jouerEffet, useMusique } from './ui';

type Reponse = {
  ok: boolean;
  erreur?: string;
  message?: string;
  resultat?: string;
  code?: string;
  jeton?: string;
  joueurId?: string;
  profil?: ProfilCompte | ProfilPublic | null;
  liste?: ListeAmis | null;
};
export type Appel = (evenement: string, data?: unknown) => Promise<Reponse>;
export type EnLigne = { joueurs: number; enAttente: number };

/** Ce dont les écrans ont besoin pour les amis. */
export interface EtatAmis {
  liste: ListeAmis | null;
  recharger: () => void;
  inviter: (code: string) => void;
}

/** Envoi au serveur sans message d'erreur à l'écran (pour les échanges automatiques du compte). */
function demander(evenement: string, data?: unknown): Promise<Reponse> {
  return new Promise((ok) => {
    if (!socket.connected) return ok({ ok: false });
    socket.timeout(8000).emit(evenement, data ?? {}, (err: unknown, r: Reponse) => ok(err ? { ok: false, erreur: 'Le serveur ne répond pas.' } : r));
  });
}

const CLE_SESSION = 'ldb-session';
const CLE_NOM = 'ldb-nom';
function lire(cle: string): string | null {
  try {
    return localStorage.getItem(cle);
  } catch {
    return null;
  }
}
function ecrire(cle: string, valeur: string | null) {
  try {
    if (valeur === null) localStorage.removeItem(cle);
    else localStorage.setItem(cle, valeur);
  } catch {
    /* stockage indisponible : la reconnexion automatique ne marchera simplement pas */
  }
}
const parametres = new URLSearchParams(location.search);
/** Code du salon présent dans l'adresse (lien d'invitation), relu à chaque fois : il disparaît quand on quitte une partie. */
const salonDansAdresse = () => new URLSearchParams(location.search).get('salon');

export function App() {
  const [salon, setSalon] = useState<VueSalon | null>(null);
  const [connecte, setConnecte] = useState(socket.connected);
  const [message, setMessage] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [reprise, setReprise] = useState(!!lire(CLE_SESSION));
  const [enLigne, setEnLigne] = useState<EnLigne | null>(null);

  const oublier = useCallback(() => {
    ecrire(CLE_SESSION, null);
    setSalon(null);
    history.replaceState(null, '', '/');
  }, []);

  useEffect(() => {
    const reprendre = () => {
      setConnecte(true);
      const brut = lire(CLE_SESSION);
      if (!brut) return setReprise(false);
      try {
        socket.emit('reprendre', JSON.parse(brut), (r: Reponse) => {
          if (!r.ok) oublier();
          setReprise(false);
        });
      } catch {
        oublier();
        setReprise(false);
      }
    };
    const surSalon = (v: VueSalon) => setSalon(v);
    const surEnLigne = (e: EnLigne) => setEnLigne(e);
    const surDeconnexion = () => setConnecte(false);
    const surExclu = () => {
      oublier();
      setMessage("L'hôte t'a retiré du salon.");
    };
    socket.on('connect', reprendre);
    socket.on('disconnect', surDeconnexion);
    socket.on('salon', surSalon);
    socket.on('exclu', surExclu);
    socket.on('en_ligne', surEnLigne);
    if (socket.connected) reprendre();
    return () => {
      socket.off('connect', reprendre);
      socket.off('disconnect', surDeconnexion);
      socket.off('salon', surSalon);
      socket.off('exclu', surExclu);
      socket.off('en_ligne', surEnLigne);
    };
  }, [oublier]);

  useEffect(() => {
    if (!message) return;
    jouerEffet('erreur');
    const t = window.setTimeout(() => setMessage(null), 3500);
    return () => window.clearTimeout(t);
  }, [message]);
  useEffect(() => {
    if (!info) return;
    const t = window.setTimeout(() => setInfo(null), 3000);
    return () => window.clearTimeout(t);
  }, [info]);

  const appel: Appel = useCallback(
    (evenement, data) =>
      new Promise((ok) => {
        if (!socket.connected) {
          setMessage('Connexion perdue, nouvelle tentative…');
          return ok({ ok: false });
        }
        socket.timeout(8000).emit(evenement, data ?? {}, (err: unknown, r: Reponse) => {
          if (err) {
            setMessage('Le serveur ne répond pas.');
            return ok({ ok: false });
          }
          if (!r.ok && r.erreur) setMessage(r.erreur);
          if (r.ok && r.message) setInfo(r.message);
          if (r.ok && r.code && r.jeton) {
            ecrire(CLE_SESSION, JSON.stringify({ code: r.code, jeton: r.jeton }));
            history.replaceState(null, '', `/?salon=${r.code}${parametres.has('test') ? '&test=1' : ''}`);
          }
          ok(r);
        });
      }),
    [],
  );

  const quitter = async () => {
    await appel('quitter');
    oublier();
  };

  // ----- Compte joueur (Firebase), seulement si le serveur l'a configuré -----
  const [module, setModule] = useState<ModuleConnexion | null>(null);
  const [pret, setPret] = useState(false);
  const [utilisateur, setUtilisateur] = useState<Utilisateur | null>(null);
  const [profil, setProfil] = useState<ProfilCompte | null>(null);
  const [chargement, setChargement] = useState(false);
  const moduleRef = useRef<ModuleConnexion | null>(null);
  const utilisateurRef = useRef<Utilisateur | null>(null);

  /** Présente le compte connecté au serveur (à chaque connexion du téléphone ou changement de compte). */
  const identifier = useCallback(async () => {
    const m = moduleRef.current;
    if (!m || !socket.connected) return;
    if (!utilisateurRef.current) {
      setProfil(null);
      await demander('identifier', { jeton: '' });
      return;
    }
    setChargement(true);
    const jeton = await m.jeton().catch(() => null);
    const r = jeton ? await demander('identifier', { jeton }) : { ok: false, erreur: 'Session expirée : reconnecte-toi à ton compte.' };
    setChargement(false);
    if (r.ok) setProfil((r.profil as ProfilCompte | null | undefined) ?? null);
    else if (r.erreur && r.erreur !== 'Patiente une seconde.') setMessage(r.erreur);
  }, []);

  const rafraichir = useCallback(async () => {
    if (!utilisateurRef.current) return;
    const r = await demander('profil');
    if (r.ok && r.profil) setProfil(r.profil as ProfilCompte);
    else if (!r.ok) void identifier();
  }, [identifier]);

  useEffect(() => {
    let arreter: (() => void) | null = null;
    let annule = false;
    fetch('/api/config')
      .then((r) => (r.ok ? r.json() : null))
      .then(async (config: ConfigComptes | null) => {
        if (!config?.firebase || annule) return;
        const m = await import('./connexion');
        if (annule) return;
        m.demarrer(config);
        moduleRef.current = m;
        setModule(m);
        arreter = m.suivre((u) => {
          utilisateurRef.current = u;
          setUtilisateur(u);
          setPret(true);
          void identifier();
        });
      })
      .catch(() => undefined);
    socket.on('connect', identifier);
    return () => {
      annule = true;
      arreter?.();
      socket.off('connect', identifier);
    };
  }, [identifier]);

  // Retour à l'accueil ou victoires enregistrées : le profil est remis à jour.
  const etatEnregistrement = salon?.enregistrement?.etat;
  const dansUnSalon = !!salon;
  useEffect(() => {
    if (etatEnregistrement === 'fait' || !dansUnSalon) void rafraichir();
  }, [etatEnregistrement, dansUnSalon, rafraichir]);

  // ----- Amis et invitations -----
  const [listeAmis, setListeAmis] = useState<ListeAmis | null>(null);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const connectePourAmis = !!profil;
  const chargerAmis = useCallback(async () => {
    if (!utilisateurRef.current) return setListeAmis(null);
    const r = await demander('amis');
    if (r.ok && r.liste) setListeAmis(r.liste);
  }, []);
  useEffect(() => {
    if (connectePourAmis) void chargerAmis();
    else setListeAmis(null);
  }, [connectePourAmis, chargerAmis]);
  useEffect(() => {
    const surMaj = () => void chargerAmis();
    const surInvitation = (inv: Invitation) => {
      jouerEffet('invitation');
      setInvitations((l) => [...l.filter((x) => x.code !== inv.code), inv]);
    };
    socket.on('amis_maj', surMaj);
    socket.on('invitation', surInvitation);
    return () => {
      socket.off('amis_maj', surMaj);
      socket.off('invitation', surInvitation);
    };
  }, [chargerAmis]);
  // Nouvelle demande d'ami reçue : petite notification sonore.
  const demandesConnues = useRef<number | null>(null);
  const nbDemandes = listeAmis?.recues.length ?? null;
  useEffect(() => {
    const avant = demandesConnues.current;
    demandesConnues.current = nbDemandes;
    if (avant !== null && nbDemandes !== null && nbDemandes > avant) jouerEffet('ami');
  }, [nbDemandes]);
  // Une invitation expire au bout de 2 minutes.
  useEffect(() => {
    if (!invitations.length) return;
    const t = window.setInterval(() => setInvitations((l) => l.filter((x) => Date.now() - x.heure < 120_000)), 5000);
    return () => window.clearInterval(t);
  }, [invitations.length]);

  const pseudo = () => (lire(CLE_NOM) || profil?.nom || 'Joueur').slice(0, 16);
  const salonRef = useRef<VueSalon | null>(null);
  salonRef.current = salon;
  const inviter = useCallback(
    async (code: string) => {
      const s = salonRef.current;
      // Pas encore de partie privée : on en ouvre une, puis on invite.
      if (!s || s.publique || s.partie) {
        const r = await appel('creer', { nom: (lire(CLE_NOM) || profil?.nom || 'Joueur').slice(0, 16) });
        if (!r.ok) return;
      }
      await appel('inviter', { code });
    },
    [appel, profil?.nom],
  );
  const rejoindreInvitation = async (inv: Invitation) => {
    setInvitations((l) => l.filter((x) => x.id !== inv.id));
    await appel('rejoindre', { code: inv.code, nom: pseudo() });
  };
  // Fonctions stables : sinon chaque nouvelle liste relancerait un chargement, sans fin.
  const rechargerAmis = useCallback(() => void chargerAmis(), [chargerAmis]);
  const inviterAmi = useCallback((c: string) => void inviter(c), [inviter]);
  const amis: EtatAmis = useMemo(() => ({ liste: listeAmis, recharger: rechargerAmis, inviter: inviterAmi }), [listeAmis, rechargerAmis, inviterAmi]);
  const enPartie = !!salon?.partie && salon.partie.phase !== 'FIN_DE_PARTIE';

  // Son de lancement : quand on passe du salon (ou d'une fin de partie) à une nouvelle partie,
  // jamais quand on revient dans une partie déjà en cours après avoir rechargé la page.
  const etatPrecedent = useRef<string>('aucun');
  const partie = salon?.partie ?? null;
  const etatActuel = !salon ? 'aucun' : !partie ? 'salon' : partie.phase;
  useEffect(() => {
    const avant = etatPrecedent.current;
    etatPrecedent.current = etatActuel;
    const nouvellePartie = (avant === 'salon' || avant === 'FIN_DE_PARTIE') && etatActuel !== 'salon' && etatActuel !== 'aucun' && etatActuel !== 'FIN_DE_PARTIE';
    if (nouvellePartie) jouerEffet('lancement');
  }, [etatActuel]);

  // Récompense de niveau : le joueur pose un tapis débloqué (le serveur vérifie le niveau).
  const poserTapis = useCallback(
    async (tapis: IdTapis) => {
      const r = await appel('tapis', { tapis });
      if (r.ok && r.profil) setProfil(r.profil as ProfilCompte);
      return r.ok;
    },
    [appel],
  );

  const compte: EtatCompte = useMemo(
    () => ({
      actif: !!module,
      pret,
      module,
      utilisateur,
      profil,
      chargement,
      rafraichir: () => void rafraichir(),
      apresInscription: () => window.setTimeout(() => void identifier(), 900),
      majProfil: setProfil,
    }),
    [module, pret, utilisateur, profil, chargement, rafraichir, identifier],
  );

  let ecran;
  if (salon?.partie) ecran = <Table salon={salon} appel={appel} quitter={quitter} tapis={tapisActif(profil?.tapis, profil?.xp ?? 0)} poserTapis={poserTapis} />;
  else if (salon) ecran = <Lobby salon={salon} appel={appel} quitter={quitter} compte={compte} amis={amis} />;
  else if (reprise) ecran = <div className="chargement">Connexion à la partie…</div>;
  else ecran = <Accueil appel={appel} compte={compte} enLigne={enLigne} amis={amis} />;

  return (
    <>
      {ecran}
      {salon && !salon.partie && <Chat salon={salon} appel={appel} />}
      {!connecte && <div className="bandeau-reseau">Connexion perdue. Reconnexion en cours…</div>}
      {!enPartie && invitations.length > 0 && (
        <div className="invitations" role="status">
          {invitations.map((inv) => (
            <div key={inv.id} className="invitation">
              <IconeImage nom="invitation" repli="✉️" className="invitation-icone" />
              <p>
                <strong>{inv.de}</strong> t’invite à sa partie privée.
              </p>
              <div className="rangee">
                <button type="button" className="petit principal" onClick={() => void rejoindreInvitation(inv)}>
                  Rejoindre
                </button>
                <button type="button" className="petit" onClick={() => setInvitations((l) => l.filter((x) => x.id !== inv.id))}>
                  Plus tard
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {message && (
        <div className="toast" role="status" onClick={() => setMessage(null)}>
          {message}
        </div>
      )}
      {info && !message && (
        <div className="toast info" role="status" onClick={() => setInfo(null)}>
          {info}
        </div>
      )}
    </>
  );
}

function Accueil({ appel, compte, enLigne, amis }: { appel: Appel; compte: EtatCompte; enLigne: EnLigne | null; amis: EtatAmis }) {
  const [vue, setVue] = useState<'menu' | 'jouer'>(salonDansAdresse() ? 'jouer' : 'menu');
  const [fenetre, setFenetre] = useState<'menu' | 'profil' | 'amis' | 'regles' | 'connexion' | 'inscription' | null>(null);
  const [intro, setIntro] = useState<string | undefined>(undefined);
  const [musiqueActive, basculerMusique] = useMusique();
  const demandes = amis.liste?.recues.length ?? 0;
  const fermer = () => {
    setFenetre(null);
    setIntro(undefined);
  };
  /** Profil et Amis demandent un compte : sinon on propose de se connecter. */
  const ouvrirAvecCompte = (cible: 'profil' | 'amis', texte: string) => {
    if (compte.utilisateur && compte.profil) return setFenetre(cible);
    if (!compte.actif) return setFenetre(null);
    setIntro(texte);
    setFenetre('connexion');
  };
  const fenetres = (
    <>
      {fenetre === 'menu' && (
        <Fenetre titre="Menu" onFermer={fermer}>
          <div className="menu-liste">
            <button type="button" className="menu-entree" onClick={() => ouvrirAvecCompte('profil', 'Connecte-toi pour voir ton profil, tes victoires et ton niveau.')}>
              <IconeImage nom="profil" repli="👤" className="menu-icone" />
              <span>Profil</span>
            </button>
            <button type="button" className="menu-entree" onClick={() => ouvrirAvecCompte('amis', 'Crée un compte (gratuit) pour ajouter tes amis et les inviter à jouer.')}>
              <IconeImage nom="amis" repli="👥" className="menu-icone" />
              <span>Amis</span>
              {demandes > 0 && <span className="pastille-nombre">{demandes}</span>}
            </button>
            <button type="button" className="menu-entree" onClick={() => setFenetre('regles')}>
              <IconeImage nom="regles-rond" repli="📜" className="menu-icone" />
              <span>Règles</span>
            </button>
            <button type="button" className="menu-entree" onClick={basculerMusique} aria-pressed={musiqueActive}>
              <IconeMusique active={musiqueActive} />
              <span>{musiqueActive ? 'Son activé' : 'Son coupé'}</span>
            </button>
          </div>
          {!compte.actif && <p className="discret">Les comptes joueurs ne sont pas activés sur ce serveur.</p>}
        </Fenetre>
      )}
      {fenetre === 'profil' && <FenetreProfil compte={compte} appel={appel} onFermer={fermer} />}
      {fenetre === 'amis' && <FenetreAmis liste={amis.liste} appel={appel} recharger={amis.recharger} inviter={amis.inviter} onFermer={fermer} />}
      {fenetre === 'regles' && <FenetreRegles onFermer={fermer} />}
      {(fenetre === 'connexion' || fenetre === 'inscription') && compte.module && (
        <FenetreConnexion
          module={compte.module}
          modeInitial={intro ? 'inscription' : fenetre}
          pseudoInitial={lire(CLE_NOM) ?? ''}
          onFermer={fermer}
          onInscrit={compte.apresInscription}
          intro={intro}
        />
      )}
    </>
  );
  if (vue === 'jouer') return <PageJouer appel={appel} compte={compte} enLigne={enLigne} retour={() => setVue('menu')} />;
  return (
    <main className="accueil menu-principal">
      <div className="menu-haut">
        <p className="en-ligne-info">
          <span className="point en-ligne" aria-hidden="true" />
          {enLigne ? `${enLigne.joueurs} en ligne` : '…'}
        </p>
        <button type="button" className="bouton-menu" onClick={() => setFenetre('menu')} aria-label="Menu : profil, amis, règles et son">
          <IconeImage nom="menu" repli="⋯" className="bouton-menu-icone" />
          {demandes > 0 && <span className="pastille-nombre">{demandes}</span>}
        </button>
      </div>
      <h1 className="accueil-logo">
        <img src="/cartes/logo.webp" alt="Le Dernier Baron" width={900} height={450} />
      </h1>
      <p className="accroche">Huit nuits. Une seule couronne. Jeu de plis pour 3 à 6 joueurs.</p>
      <button
        type="button"
        className="bouton-jouer"
        onClick={() => {
          jouerEffet('jouer');
          setVue('jouer');
        }}
      >
        Jouer
      </button>
      <CarteCompte compte={compte} appel={appel} contexte="accueil" pseudo={lire(CLE_NOM) ?? ''} />
      {fenetres}
    </main>
  );
}

/** Page « Jouer » : partie en ligne, partie privée ou code d'un salon. */
function PageJouer({ appel, compte, enLigne, retour }: { appel: Appel; compte: EtatCompte; enLigne: EnLigne | null; retour: () => void }) {
  const [nom, setNom] = useState(lire(CLE_NOM) ?? '');
  // Avec un compte, le pseudo est proposé automatiquement (sans écraser un pseudo tapé à la main).
  const nomCompte = compte.profil?.nom;
  const nomPropose = useRef<string | null>(null);
  useEffect(() => {
    if (!nomCompte) return;
    const propose = nomCompte.slice(0, 16);
    setNom((n) => (!n.trim() || n === nomPropose.current ? propose : n));
    nomPropose.current = propose;
  }, [nomCompte]);
  const [code, setCode] = useState((salonDansAdresse() ?? '').toUpperCase());
  const [occupe, setOccupe] = useState(false);
  const invite = !!salonDansAdresse();
  const valider = async (evenement: 'creer' | 'rejoindre' | 'jouer_public') => {
    ecrire(CLE_NOM, nom.trim());
    setOccupe(true);
    await appel(evenement, { nom, code, modeTest: parametres.has('test') });
    setOccupe(false);
  };
  return (
    <main className="accueil page-jouer">
      <div className="menu-haut">
        <button type="button" className="bouton-retour" onClick={retour}>
          ← Menu
        </button>
        <h1 className="titre-page">Jouer</h1>
        <span className="menu-haut-vide" />
      </div>
      <form className="accueil-form" onSubmit={(e) => e.preventDefault()}>
        <label htmlFor="pseudo">Ton pseudo</label>
        <input id="pseudo" value={nom} maxLength={16} autoComplete="nickname" placeholder="Ex. Lucas" onChange={(e) => setNom(e.target.value)} />
        {!invite && (
          <>
            <button type="button" className="bouton-plaque" disabled={!nom.trim() || occupe} onClick={() => valider('jouer_public')}>
              <span>Jouer en ligne</span>
              <small>
                <span className="point en-ligne" aria-hidden="true" />
                {enLigne ? `${enLigne.joueurs} joueur${enLigne.joueurs > 1 ? 's' : ''} en ligne` : 'Connexion…'}
              </small>
            </button>
            <button type="button" className="bouton-plaque sombre" disabled={!nom.trim() || occupe} onClick={() => valider('creer')}>
              <span>Partie privée</span>
            </button>
          </>
        )}
        <div className="separateur">{invite ? 'Tu es invité dans le salon' : 'ou rejoindre une partie privée'}</div>
        <label htmlFor="code">Code du salon</label>
        <input
          id="code"
          value={code}
          maxLength={4}
          autoCapitalize="characters"
          placeholder="ABCD"
          className="code-saisie"
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
        />
        <button type="button" className={`bouton-plaque petite ${invite ? '' : 'sombre'}`} disabled={!nom.trim() || code.length !== 4 || occupe} onClick={() => valider('rejoindre')}>
          <span>Rejoindre</span>
        </button>
      </form>
    </main>
  );
}

/** Secondes restantes avant le lancement automatique d'une partie publique. */
function useSecondesAvant(ms: number | null): number | null {
  const [fin, setFin] = useState<number | null>(null);
  const [, setTic] = useState(0);
  useEffect(() => setFin(ms === null ? null : Date.now() + ms), [ms]);
  useEffect(() => {
    if (fin === null) return;
    const t = window.setInterval(() => setTic((x) => x + 1), 250);
    return () => window.clearInterval(t);
  }, [fin]);
  return fin === null ? null : Math.max(0, Math.ceil((fin - Date.now()) / 1000));
}

function Lobby({ salon, appel, quitter, compte, amis }: { salon: VueSalon; appel: Appel; quitter: () => void; compte: EtatCompte; amis: EtatAmis }) {
  const [fenetreAmis, setFenetreAmis] = useState(false);
  // Quand quelqu'un arrive ou part, la liste « Inviter des amis » se met à jour.
  const { recharger } = amis;
  const nbJoueurs = salon.joueurs.length;
  useEffect(() => {
    if (compte.profil) recharger();
  }, [nbJoueurs, recharger, compte.profil]);
  // Quelqu'un arrive à la table (joueur ou ordinateur) : on frappe à la porte.
  const nbAvant = useRef<number | null>(null);
  useEffect(() => {
    const avant = nbAvant.current;
    nbAvant.current = nbJoueurs;
    if (avant !== null && nbJoueurs > avant) jouerEffet('arrivee');
  }, [nbJoueurs]);
  const estHote = salon.hoteId === salon.moi && !salon.publique;
  const lien = `${location.origin}/?salon=${salon.code}`;
  const [copie, setCopie] = useState(false);
  const [fiche, setFiche] = useState<string | null>(null);
  const [niveauBot, setNiveauBot] = useState('hasard');
  const [styleBot, setStyleBot] = useState('hasard');
  const secondes = useSecondesAvant(salon.departDans);
  const n = salon.joueurs.length;
  const partager = async () => {
    try {
      if (navigator.share) await navigator.share({ title: 'Le Dernier Baron', text: `Rejoins ma partie (code ${salon.code})`, url: lien });
      else {
        await navigator.clipboard.writeText(lien);
        setCopie(true);
      }
    } catch {
      (document.getElementById('lien') as HTMLInputElement | null)?.select();
    }
  };
  return (
    <main className="lobby">
      <h1>{salon.publique ? 'Partie en ligne' : 'Partie privée'}</h1>
      {salon.publique ? (
        <section className="lobby-depart" aria-live="polite">
          <span className="etiquette">La partie commence dans</span>
          <strong>{secondes ?? '…'} s</strong>
          <p className="discret">
            En attente de joueurs du monde entier ({salon.joueurs.length}/{MAX_JOUEURS}). Au lancement, les places libres sont prises par des joueurs
            ordinateur.
          </p>
        </section>
      ) : (
        <section className="lobby-code">
          <span className="etiquette">Code du salon</span>
          <strong>{salon.code}</strong>
          <input id="lien" readOnly value={lien} onFocus={(e) => e.target.select()} aria-label="Lien d'invitation" />
          <button type="button" onClick={partager}>
            {copie ? 'Lien copié' : 'Partager le lien'}
          </button>
        </section>
      )}
      <section className="lobby-avatars">
        <h2>Ton personnage</h2>
        <Defilant className="avatars-defilant" libelle="Personnages" actif={(salon.joueurs.find((j) => j.id === salon.moi)?.avatar ?? 1) - 1}>
          {AVATARS.map((nomPerso, i) => {
            const n = i + 1;
            const pris = salon.joueurs.find((j) => j.avatar === n);
            const lemien = pris?.id === salon.moi;
            return (
              <button
                key={n}
                type="button"
                className={`avatar-choix ${lemien ? 'choisi' : ''}`}
                disabled={!!pris && !lemien}
                aria-pressed={lemien}
                onClick={() => appel('avatar', { avatar: n })}
              >
                <img src={`/cartes/avatar-${n}.webp`} alt="" />
                <span>{nomPerso}</span>
                {pris && !lemien && <small>{pris.nom}</small>}
              </button>
            );
          })}
        </Defilant>
      </section>
      <section className="lobby-joueurs">
        <h2>
          Joueurs ({n}/{MAX_JOUEURS})
        </h2>
        <ol>
          {salon.joueurs.map((j) => (
            <li key={j.id}>
              <button type="button" className="lobby-nom" onClick={() => setFiche(j.id)} aria-label={`Voir le profil de ${j.nom}`}>
                <img className="mini-avatar" src={`/cartes/avatar-${j.avatar}.webp`} alt="" />
                <span className="lobby-nom-texte">
                  {j.nom}
                  {j.id === salon.moi && ' (toi)'}
                </span>
              </button>
              <span className="badges">
                {j.compte && <BadgeNiveau niveau={j.compte.niveau} titre={j.compte.titre} />}
                {j.id === salon.hoteId && !salon.publique && <span className="badge or">Hôte</span>}
                {j.bot && <span className="badge">🤖 {NOM_NIVEAU_BOT[j.bot.niveau]}</span>}
                {!j.connecte && <span className="badge rouge">Hors ligne</span>}
                {estHote && j.id !== salon.moi && (
                  <button type="button" className="petit" onClick={() => appel('retirer', { joueurId: j.id })} aria-label={`Retirer ${j.nom}`}>
                    Retirer
                  </button>
                )}
              </span>
            </li>
          ))}
        </ol>
        <p className="discret">Touche un joueur pour voir son profil. Les places sont jouées dans cet ordre.</p>
      </section>
      {!salon.publique && compte.profil && <SectionInviterAmis liste={amis.liste} inviter={amis.inviter} ouvrirAmis={() => setFenetreAmis(true)} />}
      <CarteCompte compte={compte} appel={appel} contexte="salon" pseudo={salon.joueurs.find((j) => j.id === salon.moi)?.nom ?? ''} />
      {estHote ? (
        <section className="lobby-actions">
          <button type="button" className="principal" disabled={n < MIN_JOUEURS || n > MAX_JOUEURS} onClick={() => appel('lancer')}>
            {n < MIN_JOUEURS ? `Encore ${MIN_JOUEURS - n} joueur${MIN_JOUEURS - n > 1 ? 's' : ''} pour lancer` : 'Lancer la partie'}
          </button>
          <div className="ajout-bot">
            <span className="etiquette">Ajouter un joueur ordinateur</span>
            <div className="ajout-bot-choix">
              <select value={niveauBot} onChange={(e) => setNiveauBot(e.target.value)} aria-label="Niveau du joueur ordinateur">
                <option value="hasard">Niveau au hasard</option>
                {NIVEAUX_BOT.map((nv) => (
                  <option key={nv} value={nv}>
                    {NOM_NIVEAU_BOT[nv]}
                  </option>
                ))}
              </select>
              <select value={styleBot} onChange={(e) => setStyleBot(e.target.value)} aria-label="Style du joueur ordinateur">
                <option value="hasard">Style au hasard</option>
                {STYLES_BOT.map((st) => (
                  <option key={st} value={st}>
                    {NOM_STYLE_BOT[st]}
                  </option>
                ))}
              </select>
            </div>
            <button type="button" onClick={() => appel('ajouter_bot', { niveau: niveauBot, style: styleBot })} disabled={n >= MAX_JOUEURS}>
              🤖 Ajouter un ordinateur
            </button>
            <small className="discret">Une partie ne compte dans les victoires qu’avec au moins 2 joueurs humains.</small>
          </div>
          <button type="button" onClick={() => appel('melanger')} disabled={n < 2}>
            Mélanger les places
          </button>
        </section>
      ) : (
        !salon.publique && <p className="attente">En attente du lancement par l'hôte…</p>
      )}
      <BoutonRegles />
      <button type="button" className="lien-discret" onClick={quitter}>
        Quitter {salon.publique ? 'la file d’attente' : 'le salon'}
      </button>
      <BoutonMusique />
      {fiche && <FicheJoueur joueurId={fiche} appel={appel} onFermer={() => setFiche(null)} />}
      {fenetreAmis && <FenetreAmis liste={amis.liste} appel={appel} recharger={amis.recharger} inviter={amis.inviter} onFermer={() => setFenetreAmis(false)} />}
    </main>
  );
}

/** Bouton « Règles du jeu » du salon. */
function BoutonRegles() {
  const [ouvert, setOuvert] = useState(false);
  return (
    <>
      <button type="button" className="bouton-regles" onClick={() => setOuvert(true)}>
        <img className="icone-bouton" src="/cartes/icone-regles.webp" alt="" draggable={false} />
        Règles du jeu
      </button>
      {ouvert && <FenetreRegles onFermer={() => setOuvert(false)} />}
    </>
  );
}
