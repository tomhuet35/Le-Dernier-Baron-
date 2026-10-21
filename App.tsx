import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_JOUEURS, MIN_JOUEURS } from '../../shared/config';
import type { VueSalon } from '../../shared/types';
import { socket } from './socket';
import { Table } from './Table';

type Reponse = { ok: boolean; erreur?: string; code?: string; jeton?: string; joueurId?: string };
export type Appel = (evenement: string, data?: unknown) => Promise<Reponse>;

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

export function App() {
  const [salon, setSalon] = useState<VueSalon | null>(null);
  const [connecte, setConnecte] = useState(socket.connected);
  const [message, setMessage] = useState<string | null>(null);
  const [reprise, setReprise] = useState(!!lire(CLE_SESSION));

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
    const surDeconnexion = () => setConnecte(false);
    const surExclu = () => {
      oublier();
      setMessage("L'hôte t'a retiré du salon.");
    };
    socket.on('connect', reprendre);
    socket.on('disconnect', surDeconnexion);
    socket.on('salon', surSalon);
    socket.on('exclu', surExclu);
    if (socket.connected) reprendre();
    return () => {
      socket.off('connect', reprendre);
      socket.off('disconnect', surDeconnexion);
      socket.off('salon', surSalon);
      socket.off('exclu', surExclu);
    };
  }, [oublier]);

  useEffect(() => {
    if (!message) return;
    const t = window.setTimeout(() => setMessage(null), 3500);
    return () => window.clearTimeout(t);
  }, [message]);

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

  let ecran;
  if (salon?.partie) ecran = <Table salon={salon} appel={appel} quitter={quitter} />;
  else if (salon) ecran = <Lobby salon={salon} appel={appel} quitter={quitter} />;
  else if (reprise) ecran = <div className="chargement">Connexion à la partie…</div>;
  else ecran = <Accueil appel={appel} />;

  return (
    <>
      {ecran}
      {salon && <Chat salon={salon} appel={appel} />}
      {!connecte && <div className="bandeau-reseau">Connexion perdue. Reconnexion en cours…</div>}
      {message && (
        <div className="toast" role="status" onClick={() => setMessage(null)}>
          {message}
        </div>
      )}
    </>
  );
}

function Accueil({ appel }: { appel: Appel }) {
  const [nom, setNom] = useState(lire(CLE_NOM) ?? '');
  const [code, setCode] = useState((parametres.get('salon') ?? '').toUpperCase());
  const [occupe, setOccupe] = useState(false);
  const invite = !!parametres.get('salon');
  const valider = async (evenement: 'creer' | 'rejoindre') => {
    ecrire(CLE_NOM, nom.trim());
    setOccupe(true);
    await appel(evenement, { nom, code, modeTest: parametres.has('test') });
    setOccupe(false);
  };
  return (
    <main className="accueil">
      <img className="accueil-boite" src="/boite.webp" alt="Boîte du jeu Le Dernier Baron" />
      <p className="accroche">Huit nuits. Une seule couronne. Jeu de plis pour 3 à 6 joueurs.</p>
      <form className="accueil-form" onSubmit={(e) => e.preventDefault()}>
        <label htmlFor="pseudo">Ton pseudo</label>
        <input id="pseudo" value={nom} maxLength={16} autoComplete="nickname" placeholder="Ex. Lucas" onChange={(e) => setNom(e.target.value)} />
        {!invite && (
          <button type="button" className="principal" disabled={!nom.trim() || occupe} onClick={() => valider('creer')}>
            Créer une partie
          </button>
        )}
        <div className="separateur">{invite ? 'Tu es invité dans le salon' : 'ou rejoindre une partie'}</div>
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
        <button type="button" className={invite ? 'principal' : ''} disabled={!nom.trim() || code.length !== 4 || occupe} onClick={() => valider('rejoindre')}>
          Rejoindre
        </button>
      </form>
    </main>
  );
}

function Lobby({ salon, appel, quitter }: { salon: VueSalon; appel: Appel; quitter: () => void }) {
  const estHote = salon.hoteId === salon.moi;
  const lien = `${location.origin}/?salon=${salon.code}`;
  const [copie, setCopie] = useState(false);
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
      <h1>Le Dernier Baron</h1>
      <section className="lobby-code">
        <span className="etiquette">Code du salon</span>
        <strong>{salon.code}</strong>
        <input id="lien" readOnly value={lien} onFocus={(e) => e.target.select()} aria-label="Lien d'invitation" />
        <button type="button" onClick={partager}>
          {copie ? 'Lien copié' : 'Partager le lien'}
        </button>
      </section>
      <section className="lobby-joueurs">
        <h2>
          Joueurs ({n}/{MAX_JOUEURS})
        </h2>
        <ol>
          {salon.joueurs.map((j) => (
            <li key={j.id}>
              <span>
                {j.nom}
                {j.id === salon.moi && ' (toi)'}
              </span>
              <span className="badges">
                {j.id === salon.hoteId && <span className="badge or">Hôte</span>}
                {j.robot && <span className="badge">Robot</span>}
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
        <p className="discret">Les places sont jouées dans cet ordre : chacun joue après celui du dessus.</p>
      </section>
      {estHote ? (
        <section className="lobby-actions">
          <button type="button" className="principal" disabled={n < MIN_JOUEURS || n > MAX_JOUEURS} onClick={() => appel('lancer')}>
            {n < MIN_JOUEURS ? `Encore ${MIN_JOUEURS - n} joueur${MIN_JOUEURS - n > 1 ? 's' : ''} pour lancer` : 'Lancer la partie'}
          </button>
          <button type="button" onClick={() => appel('melanger')} disabled={n < 2}>
            Mélanger les places
          </button>
          {salon.modeTest && (
            <button type="button" onClick={() => appel('ajouter_robot')} disabled={n >= MAX_JOUEURS}>
              Ajouter un robot (test)
            </button>
          )}
        </section>
      ) : (
        <p className="attente">En attente du lancement par l'hôte…</p>
      )}
      <button type="button" className="lien-discret" onClick={quitter}>
        Quitter le salon
      </button>
    </main>
  );
}

/** Discussion entre les joueurs du salon : bouton flottant avec le nombre de messages non lus. */
function Chat({ salon, appel }: { salon: VueSalon; appel: Appel }) {
  const [ouvert, setOuvert] = useState(false);
  const [texte, setTexte] = useState('');
  const [vu, setVu] = useState(0);
  const fin = useRef<HTMLDivElement | null>(null);
  const messages = salon.messages ?? [];
  const dernier = messages.length ? messages[messages.length - 1].n : 0;
  const nonLus = ouvert ? 0 : messages.filter((m) => m.n > vu && m.auteurId !== salon.moi).length;
  useEffect(() => {
    if (ouvert) {
      setVu(dernier);
      fin.current?.scrollIntoView({ block: 'end' });
    }
  }, [ouvert, dernier]);
  const envoyer = async () => {
    if (!texte.trim()) return;
    const r = await appel('chat', { texte });
    if (r.ok) setTexte('');
  };
  return (
    <>
      <button type="button" className="chat-bouton" onClick={() => setOuvert(!ouvert)} aria-label={ouvert ? 'Fermer la discussion' : 'Ouvrir la discussion'}>
        💬{nonLus > 0 && <span className="chat-pastille">{nonLus}</span>}
      </button>
      {ouvert && (
        <div className="chat-panneau" role="dialog" aria-label="Discussion">
          <div className="chat-tete">
            <strong>Discussion</strong>
            <button type="button" className="fermer" onClick={() => setOuvert(false)} aria-label="Fermer">
              ×
            </button>
          </div>
          <div className="chat-messages">
            {messages.length === 0 && <p className="discret">Pas encore de message. Dis bonjour à la table !</p>}
            {messages.map((m) => (
              <p key={m.n} className={m.auteurId === salon.moi ? 'moi' : ''}>
                <span className="chat-auteur">{m.auteurId === salon.moi ? 'Toi' : m.nom}</span>
                {m.texte}
              </p>
            ))}
            <div ref={fin} />
          </div>
          <form
            className="chat-saisie"
            onSubmit={(e) => {
              e.preventDefault();
              void envoyer();
            }}
          >
            <input id="chat-texte" value={texte} maxLength={200} placeholder="Écris un message…" autoComplete="off" onChange={(e) => setTexte(e.target.value)} />
            <button type="submit" className="principal" disabled={!texte.trim()}>
              Envoyer
            </button>
          </form>
        </div>
      )}
    </>
  );
}
