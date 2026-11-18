/**
 * Les Cercles du Salon privé : choisir ou fonder un cercle, puis son salon (blason, membres et rôles, cagnotte,
 * discussion, réglages du président). Le serveur tient tout (shared/cercles.ts, server/cerclesCasino.ts).
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { VueCasino } from '../../shared/casino';
import { BLASONS, MEMBRES_MAX, NOMS_BLASONS, NOMS_ROLES, PRIX_BLASON, PRIX_FONDER, type Blason, type MessageCercle, type VueCercles } from '../../shared/cercles';
import type { Appel } from './App';
import { Rubis } from './CasinoContrats';
import { dollars } from './casinoOutils';
import { useAttente } from './RouletteDuJour';
import { socket } from './socket';
import { tr } from './traduction';
import { jouerEffet } from './ui';
import './cercles.css';

const courtDollars = (n: number) => (n >= 1e9 ? `${(n / 1e9).toLocaleString(tr('fr-FR', 'en-US'), { maximumFractionDigits: 1 })} Md $` : n >= 1e6 ? `${(n / 1e6).toLocaleString(tr('fr-FR', 'en-US'), { maximumFractionDigits: 1 })} M $` : dollars(n));
const imageBlason = (b: Blason) => `/cartes/blason-${b}.webp`;
type Rep = { ok: boolean; erreur?: string; info?: string; cercles?: VueCercles; casino?: VueCasino };

function ChoixBlason({ valeur, onChoix }: { valeur: Blason; onChoix: (b: Blason) => void }) {
  return (
    <div className="ce-blasons" role="radiogroup" aria-label={tr('Blason', 'Crest')}>
      {BLASONS.map((b) => (
        <button key={b} type="button" role="radio" aria-checked={b === valeur} className={b === valeur ? 'choisi' : ''} onClick={() => onChoix(b)} title={tr(...NOMS_BLASONS[b])}>
          <img src={imageBlason(b)} alt={tr(...NOMS_BLASONS[b])} />
        </button>
      ))}
    </div>
  );
}

export function EcranCercles({ vue, appel, moi, onVue, onRetour }: { vue: VueCasino; appel: Appel; moi: string; onVue: (v: VueCasino) => void; onRetour: () => void }) {
  const [v, setV] = useState<VueCercles | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [fonder, setFonder] = useState(false);
  const agir = useCallback(
    async (evenement: string, data?: unknown) => {
      setErreur(null);
      const r = (await appel(evenement, data)) as Rep;
      if (r.casino) onVue(r.casino);
      if (r.cercles) setV(r.cercles);
      if (!r.ok) setErreur(r.erreur ?? tr('Action impossible.', 'Action failed.'));
      if (r.info) setInfo(r.info);
      return r.ok;
    },
    [appel, onVue],
  );
  useEffect(() => {
    window.scrollTo(0, 0);
    void agir('casino_cercles');
    const sur = (x: VueCercles) => setV(x);
    socket.on('casino_cercles', sur);
    return () => {
      socket.off('casino_cercles', sur);
    };
  }, [agir]);
  useEffect(() => {
    if (!erreur && !info) return;
    const t = window.setTimeout(() => (setErreur(null), setInfo(null)), 4500);
    return () => window.clearTimeout(t);
  }, [erreur, info]);

  return (
    <div className="cas-ecran ce-ecran">
      <header className="cas-barre">
        <button type="button" className="cas-retour" onClick={onRetour}>
          ‹ {tr('Salon', 'Lounge')}
        </button>
        <h1>{tr('Les Cercles', 'The Circles')}</h1>
        <Rubis n={vue.contrats?.rubis ?? 0} taille={22} className="ct-rubis-barre" />
      </header>
      {!v ? (
        <p className="discret cs-centre">{tr('Chargement…', 'Loading…')}</p>
      ) : v.mien ? (
        <SalonCercle v={v} moi={moi} agir={agir} />
      ) : (
        <>
          <section className="ce-accueil">
            <img src="/cartes/cercle-salon.webp" alt="" />
            <div>
              <h2>{tr('Rejoins un cercle de jeu', 'Join a gaming circle')}</h2>
              <p>
                {tr(
                  `Jusqu’à ${MEMBRES_MAX} membres, un blason, un salon privé et une discussion. 1 % de vos mises remplit la cagnotte du cercle, tirée au sort chaque lundi entre les membres qui ont joué.`,
                  `Up to ${MEMBRES_MAX} members, a crest, a private lounge and a chat. 1% of your bets fills the circle’s pot, drawn every Monday among members who played.`,
                )}
              </p>
              <button type="button" className="principal" onClick={() => setFonder(true)}>
                {tr('Fonder un cercle', 'Found a circle')} · <Rubis n={PRIX_FONDER} taille={15} />
              </button>
            </div>
          </section>
          {v.demande && (
            <p className="ce-demande">
              {tr('Ta demande d’entrée attend la réponse du président.', 'Your request is waiting for the president’s answer.')}{' '}
              <button type="button" className="petit" onClick={() => void agir('casino_cercle_annuler')}>
                {tr('Annuler', 'Cancel')}
              </button>
            </p>
          )}
          <Classement v={v} onRejoindre={(id) => void agir('casino_cercle_rejoindre', { id })} />
        </>
      )}
      {fonder && <FenetreFonder rubis={vue.contrats?.rubis ?? 0} onFermer={() => setFonder(false)} onFonder={async (d) => (await agir('casino_cercle_fonder', d)) && (setFonder(false), jouerEffet('roulette_gain'))} />}
      {(erreur || info) && <div className="toast">{erreur ?? info}</div>}
    </div>
  );
}

function Classement({ v, onRejoindre }: { v: VueCercles; onRejoindre?: (id: string) => void }) {
  if (!v.classement.length) return <p className="discret cs-centre">{tr('Aucun cercle pour l’instant : fonde le premier !', 'No circle yet: found the first one!')}</p>;
  return (
    <section className="ce-classement">
      <h2>{tr('Les cercles de la semaine', 'This week’s circles')}</h2>
      <ol>
        {v.classement.map((c, i) => (
          <li key={c.id} className={v.mien?.id === c.id ? 'mien' : ''}>
            <span className="ce-rang">{i + 1}</span>
            <img src={imageBlason(c.blason)} alt="" />
            <span className="ce-nom">
              <strong>{c.nom}</strong>
              <small>
                {c.membres}/{MEMBRES_MAX} · {c.ouvert ? tr('ouvert', 'open') : tr('sur invitation', 'invite only')}
              </small>
            </span>
            <span className="ce-mise">
              <b>{courtDollars(c.mise)}</b>
              <small>{tr('misés', 'bet')}</small>
            </span>
            {onRejoindre && c.membres < MEMBRES_MAX && (
              <button type="button" className="petit principal" onClick={() => onRejoindre(c.id)}>
                {c.ouvert ? tr('Entrer', 'Join') : tr('Demander', 'Ask')}
              </button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function FenetreFonder({ rubis, onFermer, onFonder }: { rubis: number; onFermer: () => void; onFonder: (d: { nom: string; blason: Blason; ouvert: boolean }) => void }) {
  const [nom, setNom] = useState('');
  const [blason, setBlason] = useState<Blason>('lion');
  const [ouvert, setOuvert] = useState(true);
  return (
    <div className="voile" role="dialog" aria-modal="true" onClick={onFermer}>
      <div className="fenetre ce-fonder" onClick={(e) => e.stopPropagation()}>
        <h2>{tr('Fonder un cercle', 'Found a circle')}</h2>
        <label>
          {tr('Nom du cercle', 'Circle name')}
          <input value={nom} maxLength={24} onChange={(e) => setNom(e.target.value)} placeholder={tr('Les Corbeaux de minuit', 'The Midnight Ravens')} />
        </label>
        <span>{tr('Blason', 'Crest')}</span>
        <ChoixBlason valeur={blason} onChoix={setBlason} />
        <label className="ce-case">
          <input type="checkbox" checked={!ouvert} onChange={(e) => setOuvert(!e.target.checked)} /> {tr('Sur invitation (le président accepte les demandes)', 'Invite only (the president accepts requests)')}
        </label>
        <div className="ct-confirme-boutons">
          <button type="button" onClick={onFermer}>
            {tr('Annuler', 'Cancel')}
          </button>
          <button type="button" className="principal" disabled={rubis < PRIX_FONDER || nom.trim().length < 3} onClick={() => onFonder({ nom, blason, ouvert })}>
            {tr('Fonder', 'Found')} · <Rubis n={PRIX_FONDER} taille={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

function SalonCercle({ v, moi, agir }: { v: VueCercles; moi: string; agir: (e: string, d?: unknown) => Promise<boolean> }) {
  const c = v.mien!;
  const [onglet, setOnglet] = useState<'salon' | 'discussion' | 'classement'>('salon');
  const [blasonOuvert, setBlasonOuvert] = useState(false);
  const [blason, setBlason] = useState<Blason>(c.blason);
  const fin = useAttente(c.finSemaine);
  const president = c.moi === 'president';
  const gere = c.moi !== 'membre';
  const membres = [...c.membres].sort((a, b) => (a.role === b.role ? b.mise - a.mise : a.role === 'president' ? -1 : b.role === 'president' ? 1 : a.role === 'croupier' ? -1 : 1));
  return (
    <>
      <section className="ce-salon" style={{ '--fond': 'url(/cartes/cercle-salon.webp)' } as CSSProperties}>
        <img className="ce-salon-blason" src={imageBlason(c.blason)} alt={tr(...NOMS_BLASONS[c.blason])} />
        <h2>{c.nom}</h2>
        <p className="ce-salon-infos">
          {c.membres.length}/{MEMBRES_MAX} {tr('membres', 'members')} · {c.ouvert ? tr('ouvert', 'open') : tr('sur invitation', 'invite only')} · {tr(...NOMS_ROLES[c.moi])}
        </p>
        <div className="ce-cagnotte">
          <img src="/cartes/cercle-cagnotte.webp" alt="" />
          <span>
            <small>{tr('Cagnotte du cercle', 'Circle pot')}</small>
            <strong>{dollars(c.cagnotte)}</strong>
            <small>{fin ? tr(`Tirage au sort lundi, dans ${fin}`, `Drawn on Monday, in ${fin}`) : tr('Tirage au sort lundi', 'Drawn on Monday')}</small>
          </span>
        </div>
        {c.dernierTirage && (
          <p className="ce-dernier">
            {tr(`Dernière cagnotte : ${dollars(c.dernierTirage.montant)} pour ${c.dernierTirage.nom}`, `Last pot: ${dollars(c.dernierTirage.montant)} to ${c.dernierTirage.nom}`)}
          </p>
        )}
      </section>
      <nav className="ce-onglets" role="tablist">
        {(['salon', 'discussion', 'classement'] as const).map((o) => (
          <button key={o} type="button" role="tab" aria-selected={onglet === o} className={onglet === o ? 'actif' : ''} onClick={() => setOnglet(o)}>
            {o === 'salon' ? tr('Membres', 'Members') : o === 'discussion' ? tr('Discussion', 'Chat') : tr('Classement', 'Ranking')}
          </button>
        ))}
      </nav>
      {onglet === 'salon' && (
        <>
          {gere && c.demandes.length > 0 && (
            <section className="ce-bloc">
              <h3>{tr('Demandes d’entrée', 'Join requests')}</h3>
              <ul className="ce-membres">
                {c.demandes.map((d) => (
                  <li key={d.uid}>
                    <img src={`/cartes/avatar-${d.avatar}.webp`} alt="" />
                    <span className="ce-nom">
                      <strong>{d.nom}</strong>
                    </span>
                    <button type="button" className="petit principal" onClick={() => void agir('casino_cercle_demande', { uid: d.uid, accepter: true })}>
                      {tr('Accepter', 'Accept')}
                    </button>
                    <button type="button" className="petit" onClick={() => void agir('casino_cercle_demande', { uid: d.uid, accepter: false })}>
                      {tr('Refuser', 'Decline')}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="ce-bloc">
            <h3>{tr('Les membres · mises de la semaine', 'Members · this week’s bets')}</h3>
            <ul className="ce-membres">
              {membres.map((m) => (
                <li key={m.uid} className={m.uid === moi ? 'moi' : ''}>
                  <img src={`/cartes/avatar-${m.avatar}.webp`} alt="" />
                  <span className="ce-nom">
                    <strong>{m.nom || tr('Créateur', 'Creator')}</strong>
                    <small className={`ce-role ${m.role}`}>{tr(...NOMS_ROLES[m.role])}</small>
                  </span>
                  <b className="ce-mise-membre">{dollars(m.mise)}</b>
                  {m.uid !== moi && (president || (c.moi === 'croupier' && m.role === 'membre')) && (
                  <span className="ce-actions">
                  {president && (
                    <button type="button" className="petit" onClick={() => void agir('casino_cercle_croupier', { uid: m.uid })}>
                      {m.role === 'croupier' ? tr('Retirer croupier', 'Unset croupier') : tr('Croupier', 'Croupier')}
                    </button>
                  )}
                  {(president || (c.moi === 'croupier' && m.role === 'membre')) && (
                    <button type="button" className="petit discret" onClick={() => window.confirm(tr(`Exclure ${m.nom} du cercle ?`, `Remove ${m.nom} from the circle?`)) && void agir('casino_cercle_exclure', { uid: m.uid })}>
                      {tr('Exclure', 'Remove')}
                    </button>
                  )}
                  </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
          <section className="ce-bloc ce-reglages">
            {gere && (
              <button type="button" onClick={() => setBlasonOuvert(true)}>
                {tr('Changer de blason', 'Change crest')} · <Rubis n={PRIX_BLASON} taille={14} />
              </button>
            )}
            {president && (
              <button type="button" onClick={() => void agir('casino_cercle_ouvert', { ouvert: !c.ouvert })}>
                {c.ouvert ? tr('Passer sur invitation', 'Make invite only') : tr('Ouvrir à tous', 'Open to all')}
              </button>
            )}
            <button type="button" className="discret" onClick={() => window.confirm(tr('Quitter le cercle ?', 'Leave the circle?')) && void agir('casino_cercle_quitter')}>
              {tr('Quitter le cercle', 'Leave the circle')}
            </button>
          </section>
        </>
      )}
      {onglet === 'discussion' && <Discussion messages={c.messages} moi={moi} agir={agir} />}
      {onglet === 'classement' && <Classement v={v} />}
      {blasonOuvert && (
        <div className="voile" role="dialog" aria-modal="true" onClick={() => setBlasonOuvert(false)}>
          <div className="fenetre ce-fonder" onClick={(e) => e.stopPropagation()}>
            <h2>{tr('Nouveau blason', 'New crest')}</h2>
            <ChoixBlason valeur={blason} onChoix={setBlason} />
            <div className="ct-confirme-boutons">
              <button type="button" onClick={() => setBlasonOuvert(false)}>
                {tr('Annuler', 'Cancel')}
              </button>
              <button type="button" className="principal" disabled={blason === c.blason} onClick={() => void agir('casino_cercle_blason', { blason }).then((ok) => ok && setBlasonOuvert(false))}>
                {tr('Changer', 'Change')} · <Rubis n={PRIX_BLASON} taille={14} />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Discussion({ messages: depart, moi, agir }: { messages: MessageCercle[]; moi: string; agir: (e: string, d?: unknown) => Promise<boolean> }) {
  const [messages, setMessages] = useState(depart);
  const [texte, setTexte] = useState('');
  const fin = useRef<HTMLDivElement | null>(null);
  useEffect(() => setMessages(depart), [depart]);
  useEffect(() => {
    const sur = (m: MessageCercle) => setMessages((l) => (l.some((x) => x.t === m.t && x.uid === m.uid) ? l : [...l, m].slice(-60)));
    socket.on('casino_cercle_message', sur);
    return () => {
      socket.off('casino_cercle_message', sur);
    };
  }, []);
  useEffect(() => fin.current?.scrollIntoView({ block: 'end' }), [messages.length]);
  const envoyer = async () => {
    if (!texte.trim()) return;
    if (await agir('casino_cercle_message', { texte })) setTexte('');
  };
  return (
    <section className="ce-bloc ce-discussion">
      <div className="ce-messages">
        {!messages.length && <p className="discret cs-centre">{tr('Aucun message. Lance la conversation !', 'No messages yet. Start the conversation!')}</p>}
        {messages.map((m) => (
          <div key={`${m.t}-${m.uid}`} className={`ce-message ${m.uid === moi ? 'moi' : ''}`}>
            <img src={`/cartes/avatar-${m.avatar}.webp`} alt="" />
            <span>
              <small>
                {m.nom} · {new Date(m.t).toLocaleTimeString(tr('fr-FR', 'en-GB'), { hour: '2-digit', minute: '2-digit' })}
              </small>
              <p>{m.texte}</p>
            </span>
          </div>
        ))}
        <div ref={fin} />
      </div>
      <form
        className="ce-ecrire"
        onSubmit={(e) => {
          e.preventDefault();
          void envoyer();
        }}
      >
        <input value={texte} maxLength={200} onChange={(e) => setTexte(e.target.value)} placeholder={tr('Écrire au cercle…', 'Write to the circle…')} />
        <button type="submit" className="principal">
          {tr('Envoyer', 'Send')}
        </button>
      </form>
    </section>
  );
}
