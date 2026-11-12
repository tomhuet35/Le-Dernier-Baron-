/**
 * Le profil du casino (Salon privé), à part du jeu de cartes : avatar encadré selon le niveau, écran de profil, amis
 * du casino (demandes, où ils jouent, envois d'argent), défis 1 contre 1, la puce du défi en cours et la fête d'un
 * nouveau niveau. Le serveur tient tout : ces écrans ne font que montrer et demander.
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import type { VueCasino } from '../../shared/casino';
import {
  CADRES_CASINO,
  cadreCasino,
  DOLLARS_PAR_XP,
  DUREES_DEFI,
  JEUX_CASINO,
  MISES_DEFI,
  MONTANTS_ENVOI,
  NOMS_JEUX_CASINO,
  resultatDefi,
  titreCasino,
  type EntreeJournalCasino,
  type JeuDefi,
  type JoueurCasino,
  type PositionCasino,
  type ProfilCasino,
  type VueAmisCasino,
  type VueDefi,
} from '../../shared/profilCasino';
import type { Appel } from './App';
import { dollars } from './casinoOutils';
import { socket } from './socket';
import { tr } from './traduction';
import { Celebration, Fenetre, jouerEffet } from './ui';
import './casinoSocial.css';

const nomJeu = (j: JeuDefi | PositionCasino['ecran']) => (j === 'tous' ? tr('Tous les jeux', 'All games') : j === 'salon' ? tr('Au salon', 'In the lounge') : tr(...NOMS_JEUX_CASINO[j]));
const titre = (niveau: number) => tr(...titreCasino(niveau));
/** « 1,2 M $ », « 350 k $ » : les sommes des défis, en court. */
function court(n: number): string {
  const s = n < 0 ? '−' : n > 0 ? '+' : '';
  const v = Math.abs(n);
  const f = (x: number, u: string) => `${s}${x.toLocaleString(tr('fr-FR', 'en-US'), { maximumFractionDigits: x < 10 ? 1 : 0 })} ${u}`;
  return v >= 1e9 ? f(v / 1e9, tr('Md $', 'B $')) : v >= 1e6 ? f(v / 1e6, 'M $') : v >= 1e3 ? f(v / 1e3, 'k $') : `${s}${v} $`;
}
const minutes = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
/** Une réponse du serveur, avec ses champs. */
type Rep<T> = { ok: boolean; erreur?: string; casino?: VueCasino } & Partial<T>;

/** Un compte à rebours calé sur « reste » (ms au moment de la réception). */
function useReste(reste: number | null, cle: unknown): number | null {
  const [fin, setFin] = useState<number | null>(null);
  const [, setTic] = useState(0);
  useEffect(() => setFin(reste === null ? null : Date.now() + reste), [reste, cle]);
  useEffect(() => {
    if (fin === null) return;
    const t = window.setInterval(() => setTic((x) => x + 1), 500);
    return () => window.clearInterval(t);
  }, [fin]);
  return fin === null ? null : Math.max(0, fin - Date.now());
}

// ---------------------------------------------------------------------------------------------------------------
// L'avatar encadré

export function CadreAvatar({ avatar, niveau, taille = 48, sansNiveau, className }: { avatar: number; niveau: number; taille?: number; sansNiveau?: boolean; className?: string }) {
  return (
    <span className={`cs-avatar cadre-${cadreCasino(niveau)} ${className ?? ''}`} style={{ '--taille': `${taille}px` } as CSSProperties}>
      <img src={`/cartes/avatar-${avatar}.webp`} alt="" draggable={false} />
      {!sansNiveau && <b className="cs-niveau">{niveau}</b>}
    </span>
  );
}

/** La barre d'XP vers le niveau suivant. */
export function BarreXp({ xp, xpNiveau, xpSuivant, fine }: { xp: number; xpNiveau: number; xpSuivant: number | null; fine?: boolean }) {
  const part = xpSuivant === null ? 1 : Math.min(1, Math.max(0, (xp - xpNiveau) / Math.max(1, xpSuivant - xpNiveau)));
  return (
    <span className={`cs-barre-xp ${fine ? 'fine' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(part * 100)}>
      <i style={{ width: `${part * 100}%` }} />
    </span>
  );
}

function Statut({ j }: { j: { enLigne: boolean; ou: PositionCasino | null } }) {
  if (!j.enLigne) return <span className="cs-statut">{tr('Hors ligne', 'Offline')}</span>;
  return (
    <span className="cs-statut en-ligne">
      <i />
      {j.ou && j.ou.ecran !== 'salon' ? tr(`Joue à : ${nomJeu(j.ou.ecran)}`, `Playing: ${nomJeu(j.ou.ecran)}`) : tr('Au salon', 'In the lounge')}
    </span>
  );
}

const peutRejoindre = (j: { enLigne: boolean; ou: PositionCasino | null }) => j.enLigne && !!j.ou && j.ou.ecran !== 'salon';

// ---------------------------------------------------------------------------------------------------------------
// Envoyer de l'argent à un ami

export function FenetreEnvoi({ ami, appel, solde, onVue, onFermer }: { ami: { uid: string; nom: string }; appel: Appel; solde: number; onVue: (v: VueCasino) => void; onFermer: () => void }) {
  const [restants, setRestants] = useState<number | null>(null);
  const [montant, setMontant] = useState<number | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [message, setMessage] = useState<{ texte: string; ok: boolean } | null>(null);
  useEffect(() => {
    void appel('casino_mes_amis').then((r) => {
      const x = r as Rep<{ amis: VueAmisCasino }>;
      if (x.ok && x.amis) setRestants(x.amis.envoisRestants);
    });
  }, [appel]);
  const envoyer = async () => {
    if (montant === null || envoi) return;
    setEnvoi(true);
    const r = (await appel('casino_envoyer', { uid: ami.uid, montant })) as Rep<{ envoisRestants: number }>;
    setEnvoi(false);
    if (r.casino) onVue(r.casino);
    if (!r.ok) return setMessage({ texte: r.erreur ?? tr('Envoi impossible.', 'Transfer failed.'), ok: false });
    jouerEffet('machine_pieces');
    setRestants(r.envoisRestants ?? null);
    setMessage({ texte: tr(`${dollars(montant)} envoyés à ${ami.nom} !`, `${dollars(montant)} sent to ${ami.nom}!`), ok: true });
    setMontant(null);
  };
  return (
    <Fenetre titre={tr(`Envoyer de l’argent à ${ami.nom}`, `Send money to ${ami.nom}`)} onFermer={onFermer}>
      <div className="cs-envoi">
        <div className="cs-choix">
          {MONTANTS_ENVOI.map((m) => (
            <button key={m} type="button" className={m === montant ? 'choisi' : ''} disabled={m > solde || (restants !== null && m > restants)} onClick={() => setMontant(m)}>
              {court(m).replace('+', '')}
            </button>
          ))}
        </div>
        <p className="discret">
          {restants === null
            ? '…'
            : tr(`Tu peux encore envoyer ${dollars(restants)} aujourd’hui (50 M $ par jour au plus).`, `You can still send ${dollars(restants)} today ($50M a day at most).`)}
        </p>
        <button type="button" className="principal large" disabled={montant === null || envoi} onClick={() => void envoyer()}>
          {montant === null ? tr('Choisis une somme', 'Pick an amount') : tr(`Envoyer ${dollars(montant)}`, `Send ${dollars(montant)}`)}
        </button>
        {message && <p className={message.ok ? 'cs-ok' : 'cas-erreur'}>{message.texte}</p>}
      </div>
    </Fenetre>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Le profil

function ligneJournal(e: EntreeJournalCasino): { texte: string; montant: number | null } {
  switch (e.type) {
    case 'niveau':
      return { texte: tr(`Niveau ${e.niveau} atteint`, `Reached level ${e.niveau}`), montant: e.montant };
    case 'envoi':
      return { texte: tr(`Envoyé à ${e.nom}`, `Sent to ${e.nom}`), montant: -e.montant };
    case 'recu':
      return { texte: tr(`Reçu de ${e.nom}`, `Received from ${e.nom}`), montant: e.montant };
    default:
      return {
        texte:
          e.resultat === 'gagne' ? tr(`Défi gagné contre ${e.nom}`, `Challenge won against ${e.nom}`) : e.resultat === 'perdu' ? tr(`Défi perdu contre ${e.nom}`, `Challenge lost against ${e.nom}`) : tr(`Défi nul contre ${e.nom}`, `Challenge tied with ${e.nom}`),
        montant: e.resultat === 'nul' ? null : e.resultat === 'gagne' ? e.montant : -e.montant,
      };
  }
}

export function EcranProfil({
  uid,
  appel,
  vue,
  onVue,
  onRetour,
  onRejoindre,
  onDefier,
}: {
  uid: string | null;
  appel: Appel;
  vue: VueCasino;
  onVue: (v: VueCasino) => void;
  onRetour: () => void;
  onRejoindre: (p: PositionCasino) => void;
  onDefier: (uid: string) => void;
}) {
  const [p, setP] = useState<ProfilCasino | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const charger = useCallback(async () => {
    const r = (await appel('casino_profil', uid ? { uid } : {})) as Rep<{ profil: ProfilCasino }>;
    if (r.ok && r.profil) setP(r.profil);
    else setErreur(r.erreur ?? tr('Profil indisponible.', 'Profile unavailable.'));
  }, [appel, uid]);
  useEffect(() => {
    window.scrollTo(0, 0);
    void charger();
  }, [charger]);
  // Mon profil suit mon solde et mon XP (une mise, un gain, un niveau).
  useEffect(() => {
    if (p?.relation === 'moi') void charger();
    // On ne recharge que quand le salon change, pas à chaque rendu.
  }, [vue.solde, vue.profil?.xp]); // eslint-disable-line react-hooks/exhaustive-deps

  const lien = async (action: 'demander' | 'accepter' | 'refuser' | 'retirer') => {
    if (!p) return;
    const r = (await appel('casino_ami', { uid: p.uid, action })) as Rep<{ resultat: string }>;
    if (r.casino) onVue(r.casino);
    if (!r.ok) return setErreur(r.erreur ?? tr('Demande impossible.', 'Request failed.'));
    jouerEffet('selection');
    void charger();
  };

  const moi = p?.relation === 'moi';
  const jeux = p ? JEUX_CASINO.filter((j) => (p.jeux[j]?.mise ?? 0) > 0).sort((a, b) => (p.jeux[b]?.mise ?? 0) - (p.jeux[a]?.mise ?? 0)) : [];
  const maxMise = p && jeux.length ? (p.jeux[jeux[0]]?.mise ?? 1) : 1;
  const prochainCadre = p ? CADRES_CASINO.find((c) => c.niveau > p.niveau) : undefined;
  const bilan = p ? p.gagne - p.mise : 0;
  return (
    <div className="cas-ecran cs-ecran">
      <header className="cas-barre">
        <button type="button" className="cas-retour" onClick={onRetour}>
          ‹ {tr('Retour', 'Back')}
        </button>
        <h1>{moi || !p ? tr('Mon profil', 'My profile') : tr('Profil', 'Profile')}</h1>
        <span className="cas-solde-petit">{dollars(vue.solde)}</span>
      </header>
      {!p ? (
        <p className="discret cs-centre">{erreur ?? tr('Chargement…', 'Loading…')}</p>
      ) : (
        <>
          <section className={`cs-carte-profil cadre-fond-${cadreCasino(p.niveau)}`}>
            <CadreAvatar avatar={p.avatar} niveau={p.niveau} taille={108} />
            <div className="cs-identite">
              <h2>{p.nom || tr('Créateur', 'Creator')}</h2>
              <p className="cs-titre-casino">{titre(p.niveau)}</p>
              <Statut j={p} />
              <p className="discret">{tr(`Au salon depuis le ${new Date(p.depuis).toLocaleDateString('fr-FR')}`, `In the lounge since ${new Date(p.depuis).toLocaleDateString('en-GB')}`)}</p>
            </div>
          </section>

          <section className="cs-progression">
            <div className="cs-progression-tete">
              <strong>{tr(`Niveau ${p.niveau}`, `Level ${p.niveau}`)}</strong>
              <span>{p.xpSuivant === null ? tr('Niveau maximum !', 'Top level!') : `${p.xp.toLocaleString(tr('fr-FR', 'en-US'))} / ${p.xpSuivant.toLocaleString(tr('fr-FR', 'en-US'))} XP`}</span>
            </div>
            <BarreXp xp={p.xp} xpNiveau={p.xpNiveau} xpSuivant={p.xpSuivant} />
            {p.xpSuivant !== null && p.bonusSuivant !== null && (
              <p className="discret">
                {tr(
                  `Encore ${dollars((p.xpSuivant - p.xp) * DOLLARS_PAR_XP)} à miser pour le niveau ${p.niveau + 1} : ${dollars(p.bonusSuivant)} de bonus.`,
                  `${dollars((p.xpSuivant - p.xp) * DOLLARS_PAR_XP)} more to bet for level ${p.niveau + 1}: ${dollars(p.bonusSuivant)} bonus.`,
                )}
                {prochainCadre && ` ${tr(`Cadre ${tr(...prochainCadre.nom)} au niveau ${prochainCadre.niveau}.`, `${tr(...prochainCadre.nom)} frame at level ${prochainCadre.niveau}.`)}`}
              </p>
            )}
            <p className="discret">{tr('1 XP pour 1 000 $ misés, dans tous les jeux du salon.', '1 XP per $1,000 bet, in every lounge game.')}</p>
          </section>

          {!moi && (
            <section className="cs-actions">
              {p.relation === 'ami' && (
                <>
                  {peutRejoindre(p) && (
                    <button type="button" className="principal" onClick={() => onRejoindre(p.ou!)}>
                      {tr('Rejoindre', 'Join')}
                    </button>
                  )}
                  <button type="button" onClick={() => setEnvoi(true)}>
                    {tr('Envoyer de l’argent', 'Send money')}
                  </button>
                  <button type="button" onClick={() => onDefier(p.uid)}>
                    {tr('Défier', 'Challenge')}
                  </button>
                  <button type="button" className="discret" onClick={() => void lien('retirer')}>
                    {tr('Retirer des amis', 'Remove friend')}
                  </button>
                </>
              )}
              {p.relation === 'aucune' && (
                <button type="button" className="principal" onClick={() => void lien('demander')}>
                  {tr('Ajouter en ami', 'Add friend')}
                </button>
              )}
              {p.relation === 'demande_recue' && (
                <>
                  <button type="button" className="principal" onClick={() => void lien('accepter')}>
                    {tr('Accepter la demande', 'Accept request')}
                  </button>
                  <button type="button" onClick={() => void lien('refuser')}>
                    {tr('Refuser', 'Decline')}
                  </button>
                </>
              )}
              {p.relation === 'demande_envoyee' && (
                <button type="button" onClick={() => void lien('retirer')}>
                  {tr('Annuler la demande', 'Cancel request')}
                </button>
              )}
            </section>
          )}
          {erreur && <p className="cas-erreur">{erreur}</p>}

          <section className="cs-stats">
            <div>
              <small>{tr('Solde', 'Balance')}</small>
              <strong>{dollars(p.solde)}</strong>
            </div>
            <div>
              <small>{tr('Plus gros gain', 'Biggest win')}</small>
              <strong>{dollars(p.plusGrosGain)}</strong>
            </div>
            <div>
              <small>{tr('Total misé', 'Total bet')}</small>
              <strong>{dollars(p.mise)}</strong>
            </div>
            <div>
              <small>{tr('Total gagné', 'Total won')}</small>
              <strong>{dollars(p.gagne)}</strong>
            </div>
            <div>
              <small>{tr('Bilan', 'Net')}</small>
              <strong className={bilan >= 0 ? 'positif' : 'negatif'}>{court(bilan)}</strong>
            </div>
            <div>
              <small>{tr('Défis', 'Challenges')}</small>
              <strong>
                {p.defis.gagnes} – {p.defis.perdus}
                {p.defis.nuls ? ` – ${p.defis.nuls}` : ''}
              </strong>
            </div>
          </section>

          <section className="cs-bloc">
            <h3>{tr('Jeux préférés', 'Favourite games')}</h3>
            {jeux.length ? (
              <ul className="cs-jeux">
                {jeux.map((j) => (
                  <li key={j}>
                    <span>{nomJeu(j)}</span>
                    <i style={{ '--part': `${Math.max(3, ((p.jeux[j]?.mise ?? 0) / maxMise) * 100)}%` } as CSSProperties} />
                    <small>{court(p.jeux[j]?.mise ?? 0).replace('+', '')}</small>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="discret">{tr('Pas encore de mise depuis l’arrivée des niveaux.', 'No bets yet since levels arrived.')}</p>
            )}
          </section>

          <section className="cs-bloc">
            <h3>{tr('Cadres et titres', 'Frames and titles')}</h3>
            <ul className="cs-cadres">
              {CADRES_CASINO.map((c) => (
                <li key={c.id} className={p.niveau >= c.niveau ? 'gagne' : ''}>
                  <CadreAvatar avatar={p.avatar} niveau={c.niveau} taille={46} sansNiveau />
                  <strong>{tr(...c.nom)}</strong>
                  <small>{tr(`Niv. ${c.niveau}`, `Lvl ${c.niveau}`)}</small>
                  <small className="cs-cadre-titre">{titre(c.niveau)}</small>
                </li>
              ))}
            </ul>
          </section>

          {moi && (
            <section className="cs-bloc">
              <h3>{tr('Activité récente', 'Recent activity')}</h3>
              {p.journal?.length ? (
                <ul className="cs-journal">
                  {p.journal.map((e, i) => {
                    const l = ligneJournal(e);
                    return (
                      <li key={i}>
                        <span>{l.texte}</span>
                        {l.montant !== null && <strong className={l.montant >= 0 ? 'positif' : 'negatif'}>{court(l.montant)}</strong>}
                        <small>{new Date(e.t).toLocaleString(tr('fr-FR', 'en-GB'), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="discret">{tr('Rien pour l’instant.', 'Nothing yet.')}</p>
              )}
            </section>
          )}
        </>
      )}
      {envoi && p && <FenetreEnvoi ami={p} appel={appel} solde={vue.solde} onVue={onVue} onFermer={() => (setEnvoi(false), void charger())} />}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Les amis

function LigneJoueur({ j, onProfil, children }: { j: JoueurCasino; onProfil: (uid: string) => void; children?: ReactNode }) {
  return (
    <li className="cs-joueur">
      <button type="button" className="cs-joueur-fiche" onClick={() => onProfil(j.uid)}>
        <CadreAvatar avatar={j.avatar} niveau={j.niveau} taille={46} />
        <span className="cs-joueur-info">
          <strong>{j.nom || tr('Créateur', 'Creator')}</strong>
          <small>{tr(`Niv. ${j.niveau} · ${titre(j.niveau)}`, `Lvl ${j.niveau} · ${titre(j.niveau)}`)}</small>
          <Statut j={j} />
        </span>
      </button>
      {children && <span className="cs-joueur-actions">{children}</span>}
    </li>
  );
}

export function EcranAmis({
  appel,
  vue,
  onVue,
  onRetour,
  onProfil,
  onRejoindre,
  onDefier,
}: {
  appel: Appel;
  vue: VueCasino;
  onVue: (v: VueCasino) => void;
  onRetour: () => void;
  onProfil: (uid: string) => void;
  onRejoindre: (p: PositionCasino) => void;
  onDefier: (uid: string) => void;
}) {
  const [amis, setAmis] = useState<VueAmisCasino | null>(null);
  const [envoi, setEnvoi] = useState<JoueurCasino | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const charger = useCallback(async () => {
    const r = (await appel('casino_mes_amis')) as Rep<{ amis: VueAmisCasino }>;
    if (r.ok && r.amis) setAmis(r.amis);
  }, [appel]);
  useEffect(() => {
    window.scrollTo(0, 0);
    void charger();
    // Les amis bougent (en ligne, d'un jeu à l'autre) : la liste se rafraîchit, et tout de suite après une demande.
    const t = window.setInterval(() => void charger(), 8000);
    const maj = () => void charger();
    socket.on('casino_amis_maj', maj);
    return () => {
      window.clearInterval(t);
      socket.off('casino_amis_maj', maj);
    };
  }, [charger]);
  const lien = async (uid: string, action: 'demander' | 'accepter' | 'refuser' | 'retirer') => {
    const r = (await appel('casino_ami', { uid, action })) as Rep<{ resultat: string; amis: VueAmisCasino }>;
    if (r.casino) onVue(r.casino);
    if (r.amis) setAmis(r.amis);
    if (!r.ok) return setMessage(r.erreur ?? tr('Demande impossible.', 'Request failed.'));
    jouerEffet('selection');
    setMessage(
      r.resultat === 'envoyee'
        ? tr('Demande envoyée !', 'Request sent!')
        : r.resultat === 'amis'
          ? tr('Vous êtes maintenant amis !', 'You are now friends!')
          : r.resultat === 'deja_envoyee'
            ? tr('Demande déjà envoyée.', 'Request already sent.')
            : null,
    );
  };
  return (
    <div className="cas-ecran cs-ecran">
      <header className="cas-barre">
        <button type="button" className="cas-retour" onClick={onRetour}>
          ‹ {tr('Salon', 'Lounge')}
        </button>
        <h1>{tr('Mes amis', 'My friends')}</h1>
        <span className="cas-solde-petit">{dollars(vue.solde)}</span>
      </header>
      <p className="discret cs-centre">{tr('Tes amis du casino, à part de ceux du jeu de cartes.', 'Your casino friends, separate from your card-game friends.')}</p>
      {message && <p className="cs-ok cs-centre">{message}</p>}
      {!amis ? (
        <p className="discret cs-centre">{tr('Chargement…', 'Loading…')}</p>
      ) : (
        <>
          {amis.recues.length > 0 && (
            <section className="cs-bloc cs-bloc-demandes">
              <h3>{tr('Demandes reçues', 'Friend requests')}</h3>
              <ul className="cs-liste">
                {amis.recues.map((j) => (
                  <LigneJoueur key={j.uid} j={j} onProfil={onProfil}>
                    <button type="button" className="principal petit" onClick={() => void lien(j.uid, 'accepter')}>
                      {tr('Accepter', 'Accept')}
                    </button>
                    <button type="button" className="petit" onClick={() => void lien(j.uid, 'refuser')}>
                      {tr('Refuser', 'Decline')}
                    </button>
                  </LigneJoueur>
                ))}
              </ul>
            </section>
          )}
          <section className="cs-bloc">
            <h3>
              {tr('Mes amis', 'My friends')} <small>({amis.amis.length})</small>
            </h3>
            {amis.amis.length ? (
              <ul className="cs-liste">
                {amis.amis.map((j) => (
                  <LigneJoueur key={j.uid} j={j} onProfil={onProfil}>
                    {peutRejoindre(j) && (
                      <button type="button" className="principal petit" onClick={() => onRejoindre(j.ou!)}>
                        {tr('Rejoindre', 'Join')}
                      </button>
                    )}
                    <button type="button" className="petit" onClick={() => setEnvoi(j)} aria-label={tr(`Envoyer de l’argent à ${j.nom}`, `Send money to ${j.nom}`)}>
                      $
                    </button>
                    <button type="button" className="petit" onClick={() => onDefier(j.uid)}>
                      {tr('Défier', 'Challenge')}
                    </button>
                  </LigneJoueur>
                ))}
              </ul>
            ) : (
              <p className="discret">{tr('Pas encore d’ami au casino : ajoute des joueurs du salon ci-dessous.', 'No casino friends yet: add lounge players below.')}</p>
            )}
          </section>
          {amis.envoyees.length > 0 && (
            <section className="cs-bloc">
              <h3>{tr('Demandes envoyées', 'Sent requests')}</h3>
              <ul className="cs-liste">
                {amis.envoyees.map((j) => (
                  <LigneJoueur key={j.uid} j={j} onProfil={onProfil}>
                    <button type="button" className="petit" onClick={() => void lien(j.uid, 'retirer')}>
                      {tr('Annuler', 'Cancel')}
                    </button>
                  </LigneJoueur>
                ))}
              </ul>
            </section>
          )}
          <section className="cs-bloc">
            <h3>{tr('Joueurs du salon', 'Lounge players')}</h3>
            {amis.autres.length ? (
              <ul className="cs-liste">
                {amis.autres.map((j) => (
                  <LigneJoueur key={j.uid} j={j} onProfil={onProfil}>
                    <button type="button" className="petit" onClick={() => void lien(j.uid, 'demander')}>
                      {tr('Ajouter', 'Add')}
                    </button>
                  </LigneJoueur>
                ))}
              </ul>
            ) : (
              <p className="discret">{tr('Tous les joueurs du salon sont déjà tes amis.', 'All lounge players are already your friends.')}</p>
            )}
          </section>
        </>
      )}
      {envoi && <FenetreEnvoi ami={envoi} appel={appel} solde={vue.solde} onVue={onVue} onFermer={() => (setEnvoi(null), void charger())} />}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Les défis

/** La carte d'un défi (en attente, en cours ou fini), vue par moi. */
function CarteDefi({ d, moi, children }: { d: VueDefi; moi: string; children?: ReactNode }) {
  const reste = useReste(d.reste, d);
  const jeSuisDe = d.de.uid === moi;
  const lui = jeSuisDe ? d.vers : d.de;
  const mien = jeSuisDe ? d.scores.de : d.scores.vers;
  const sien = jeSuisDe ? d.scores.vers : d.scores.de;
  const r = resultatDefi(d, moi);
  const etat =
    d.etat === 'attente'
      ? jeSuisDe
        ? tr(`En attente de ${lui.nom}`, `Waiting for ${lui.nom}`)
        : tr(`${lui.nom} te défie !`, `${lui.nom} challenges you!`)
      : d.etat === 'enCours'
        ? tr('En cours', 'In progress')
        : d.etat === 'fini'
          ? r === 'gagne'
            ? tr('Gagné !', 'Won!')
            : r === 'perdu'
              ? tr('Perdu', 'Lost')
              : tr('Égalité', 'Tie')
          : d.etat === 'refuse'
            ? tr('Refusé', 'Declined')
            : d.etat === 'expire'
              ? tr('Expiré', 'Expired')
              : tr('Annulé', 'Cancelled');
  return (
    <li className={`cs-defi etat-${d.etat} ${r ? `res-${r}` : ''}`}>
      <div className="cs-defi-tete">
        <CadreAvatar avatar={lui.avatar} niveau={1} taille={40} sansNiveau />
        <span className="cs-defi-info">
          <em>{etat}</em>
          <strong>{tr(`Contre ${lui.nom}`, `Against ${lui.nom}`)}</strong>
          <small>
            {nomJeu(d.jeu)} · {d.duree / 60_000} min · {d.mise ? tr(`${dollars(d.mise)} chacun`, `${dollars(d.mise)} each`) : tr('Pour l’honneur', 'For honour')}
          </small>
        </span>
      </div>
      {(d.etat === 'enCours' || d.etat === 'fini') && (
        <div className="cs-defi-scores">
          <span className={mien > sien ? 'devant' : ''}>
            <small>{tr('Toi', 'You')}</small>
            <strong>{court(mien)}</strong>
          </span>
          {d.etat === 'enCours' && reste !== null && <b className="cs-defi-temps">{minutes(reste)}</b>}
          <span className={sien > mien ? 'devant' : ''}>
            <small>{lui.nom}</small>
            <strong>{court(sien)}</strong>
          </span>
        </div>
      )}
      {d.etat === 'attente' && reste !== null && <p className="discret">{tr(`L’invitation expire dans ${minutes(reste)}.`, `The invitation expires in ${minutes(reste)}.`)}</p>}
      {d.etat === 'fini' && d.mise > 0 && r !== 'nul' && <p className={r === 'gagne' ? 'cs-ok' : 'discret'}>{r === 'gagne' ? tr(`+${dollars(2 * d.mise)} pour toi !`, `+${dollars(2 * d.mise)} for you!`) : tr(`${lui.nom} remporte ${dollars(2 * d.mise)}.`, `${lui.nom} takes ${dollars(2 * d.mise)}.`)}</p>}
      {children && <div className="cs-defi-actions">{children}</div>}
    </li>
  );
}

export function EcranDefis({
  appel,
  vue,
  moi,
  defis,
  cible,
  onDefis,
  onVue,
  onRetour,
}: {
  appel: Appel;
  vue: VueCasino;
  moi: string;
  defis: VueDefi[];
  cible: string | null;
  onDefis: (d: VueDefi[]) => void;
  onVue: (v: VueCasino) => void;
  onRetour: () => void;
}) {
  const [amis, setAmis] = useState<JoueurCasino[] | null>(null);
  const [choix, setChoix] = useState<{ uid: string | null; jeu: JeuDefi; duree: number; mise: number }>({ uid: cible, jeu: 'tous', duree: DUREES_DEFI[2], mise: 1_000_000 });
  const [envoi, setEnvoi] = useState(false);
  const [message, setMessage] = useState<{ texte: string; ok: boolean } | null>(null);
  useEffect(() => {
    window.scrollTo(0, 0);
    void appel('casino_defis').then((r) => {
      const x = r as Rep<{ defis: VueDefi[] }>;
      if (x.ok && x.defis) onDefis(x.defis);
    });
    void appel('casino_mes_amis').then((r) => {
      const x = r as Rep<{ amis: VueAmisCasino }>;
      if (x.ok && x.amis) {
        setAmis(x.amis.amis);
        setChoix((c) => ({ ...c, uid: c.uid ?? x.amis!.amis[0]?.uid ?? null }));
      }
    });
  }, [appel, onDefis]);

  const agir = async (evenement: string, data: unknown, ok: string) => {
    if (envoi) return;
    setEnvoi(true);
    const r = (await appel(evenement, data)) as Rep<{ defi: VueDefi }>;
    setEnvoi(false);
    if (r.casino) onVue(r.casino);
    if (!r.ok) return setMessage({ texte: r.erreur ?? tr('Action impossible.', 'Action not allowed.'), ok: false });
    jouerEffet('selection');
    setMessage({ texte: ok, ok: true });
  };
  const ouverts = defis.filter((d) => d.etat === 'attente' || d.etat === 'enCours');
  const enCours = ouverts.find((d) => d.etat === 'enCours');
  const recues = ouverts.filter((d) => d.etat === 'attente' && d.vers.uid === moi);
  const envoyees = ouverts.filter((d) => d.etat === 'attente' && d.de.uid === moi);
  const finis = defis.filter((d) => d.etat !== 'attente' && d.etat !== 'enCours');
  const ami = amis?.find((a) => a.uid === choix.uid);
  return (
    <div className="cas-ecran cs-ecran">
      <header className="cas-barre">
        <button type="button" className="cas-retour" onClick={onRetour}>
          ‹ {tr('Salon', 'Lounge')}
        </button>
        <h1>{tr('Défis', 'Challenges')}</h1>
        <span className="cas-solde-petit">{dollars(vue.solde)}</span>
      </header>
      {message && <p className={`cs-centre ${message.ok ? 'cs-ok' : 'cas-erreur'}`}>{message.texte}</p>}

      {enCours && (
        <section className="cs-bloc">
          <h3>{tr('Défi en cours', 'Challenge in progress')}</h3>
          <ul className="cs-defis">
            <CarteDefi d={enCours} moi={moi} />
          </ul>
        </section>
      )}

      {recues.length > 0 && (
        <section className="cs-bloc cs-bloc-demandes">
          <h3>{tr('On te défie', 'You are challenged')}</h3>
          <ul className="cs-defis">
            {recues.map((d) => (
              <CarteDefi key={d.id} d={d} moi={moi}>
                <button type="button" className="principal" disabled={envoi} onClick={() => void agir('casino_defi_repondre', { id: d.id, accepter: true }, tr('Défi accepté : à toi de jouer !', 'Challenge accepted: your turn to play!'))}>
                  {d.mise ? tr(`Accepter (${court(d.mise).replace('+', '')})`, `Accept (${court(d.mise).replace('+', '')})`) : tr('Accepter', 'Accept')}
                </button>
                <button type="button" disabled={envoi} onClick={() => void agir('casino_defi_repondre', { id: d.id, accepter: false }, tr('Défi refusé.', 'Challenge declined.'))}>
                  {tr('Refuser', 'Decline')}
                </button>
              </CarteDefi>
            ))}
          </ul>
        </section>
      )}

      <section className="cs-bloc cs-lancer">
        <h3>{tr('Lancer un défi', 'Start a challenge')}</h3>
        {amis === null ? (
          <p className="discret">{tr('Chargement…', 'Loading…')}</p>
        ) : !amis.length ? (
          <p className="discret">{tr('Ajoute d’abord des amis au casino pour les défier.', 'Add casino friends first to challenge them.')}</p>
        ) : (
          <>
            <small className="cs-etiquette">{tr('Contre', 'Against')}</small>
            <div className="cs-choix cs-choix-amis">
              {amis.map((a) => (
                <button key={a.uid} type="button" className={a.uid === choix.uid ? 'choisi' : ''} onClick={() => setChoix((c) => ({ ...c, uid: a.uid }))}>
                  <CadreAvatar avatar={a.avatar} niveau={a.niveau} taille={30} sansNiveau />
                  {a.nom}
                  {a.enLigne && <i className="cs-point" />}
                </button>
              ))}
            </div>
            <small className="cs-etiquette">{tr('Jeu', 'Game')}</small>
            <div className="cs-choix">
              {(['tous', ...JEUX_CASINO] as JeuDefi[]).map((j) => (
                <button key={j} type="button" className={j === choix.jeu ? 'choisi' : ''} onClick={() => setChoix((c) => ({ ...c, jeu: j }))}>
                  {nomJeu(j)}
                </button>
              ))}
            </div>
            <small className="cs-etiquette">{tr('Durée', 'Duration')}</small>
            <div className="cs-choix">
              {DUREES_DEFI.map((d) => (
                <button key={d} type="button" className={d === choix.duree ? 'choisi' : ''} onClick={() => setChoix((c) => ({ ...c, duree: d }))}>
                  {d / 60_000} min
                </button>
              ))}
            </div>
            <small className="cs-etiquette">{tr('Mise de chacun', 'Stake each')}</small>
            <div className="cs-choix">
              {MISES_DEFI.map((m) => (
                <button key={m} type="button" className={m === choix.mise ? 'choisi' : ''} disabled={m > vue.solde} onClick={() => setChoix((c) => ({ ...c, mise: m }))}>
                  {m ? court(m).replace('+', '') : tr('Pour l’honneur', 'For honour')}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="cas-tourner cs-defier"
              disabled={!ami || envoi}
              onClick={() =>
                void agir('casino_defi_lancer', { uid: choix.uid, jeu: choix.jeu, duree: choix.duree, mise: choix.mise }, tr(`Défi envoyé à ${ami?.nom ?? ''} !`, `Challenge sent to ${ami?.nom ?? ''}!`))
              }
            >
              <span>{ami ? tr(`Défier ${ami.nom}`, `Challenge ${ami.nom}`) : tr('Choisis un ami', 'Pick a friend')}</span>
            </button>
          </>
        )}
        <p className="cas-mention">
          {tr(
            'Pendant le défi, chacun joue de son côté au jeu choisi. Le meilleur bilan (gains − mises) remporte les deux mises ; égalité : chacun récupère la sienne. Une invitation reste ouverte 10 minutes ; sans réponse, ta mise revient.',
            'During the challenge, each player plays on their own at the chosen game. The best net result (wins − bets) takes both stakes; a tie gives each stake back. An invitation stays open 10 minutes; without an answer, your stake comes back.',
          )}
        </p>
      </section>

      {envoyees.length > 0 && (
        <section className="cs-bloc">
          <h3>{tr('Défis envoyés', 'Sent challenges')}</h3>
          <ul className="cs-defis">
            {envoyees.map((d) => (
              <CarteDefi key={d.id} d={d} moi={moi}>
                <button type="button" disabled={envoi} onClick={() => void agir('casino_defi_annuler', { id: d.id }, tr('Défi annulé : ta mise est rendue.', 'Challenge cancelled: your stake is back.'))}>
                  {tr('Annuler', 'Cancel')}
                </button>
              </CarteDefi>
            ))}
          </ul>
        </section>
      )}

      {finis.length > 0 && (
        <section className="cs-bloc">
          <h3>{tr('Derniers défis', 'Recent challenges')}</h3>
          <ul className="cs-defis">
            {finis.map((d) => (
              <CarteDefi key={d.id} d={d} moi={moi} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Partout au casino : la puce du défi en cours, la fête d'un nouveau niveau

export function PuceDefi({ d, moi, onOuvrir }: { d: VueDefi; moi: string; onOuvrir: () => void }) {
  const reste = useReste(d.reste, d);
  const jeSuisDe = d.de.uid === moi;
  const lui = jeSuisDe ? d.vers : d.de;
  const mien = jeSuisDe ? d.scores.de : d.scores.vers;
  const sien = jeSuisDe ? d.scores.vers : d.scores.de;
  return (
    <button type="button" className={`cs-puce-defi ${mien > sien ? 'devant' : mien < sien ? 'derriere' : ''}`} onClick={onOuvrir} aria-label={tr(`Défi contre ${lui.nom}`, `Challenge against ${lui.nom}`)}>
      <b>⚔</b>
      <span className="cs-puce-info">
        <small>
          {lui.nom} · {nomJeu(d.jeu)}
        </small>
        <strong>
          {court(mien)} <em>/</em> {court(sien)}
        </strong>
      </span>
      {reste !== null && <i>{minutes(reste)}</i>}
    </button>
  );
}

export interface FeteNiveau {
  niveau: number;
  avant: number;
  bonus: number;
  id: number;
}

export function CelebrationNiveau({ fete, avatar, onFermer }: { fete: FeteNiveau; avatar: number; onFermer: () => void }) {
  const nouveauTitre = Math.floor(fete.niveau / 10) > Math.floor(fete.avant / 10);
  const cadre = useMemo(() => CADRES_CASINO.find((c) => c.niveau > fete.avant && c.niveau <= fete.niveau), [fete]);
  useEffect(() => {
    jouerEffet('roulette_gros_lot');
  }, []);
  return (
    <Celebration
      titre={tr(`Niveau ${fete.niveau} !`, `Level ${fete.niveau}!`)}
      etiquette={tr(`Niveau ${fete.niveau} du casino`, `Casino level ${fete.niveau}`)}
      medaillon={<CadreAvatar avatar={avatar} niveau={fete.niveau} taille={150} className="cs-fete" />}
      legende={[
        fete.bonus > 0 ? `+${dollars(fete.bonus)}` : null,
        nouveauTitre ? tr(`Nouveau titre : ${titre(fete.niveau)}`, `New title: ${titre(fete.niveau)}`) : null,
        cadre ? tr(`Nouveau cadre : ${tr(...cadre.nom)}`, `New frame: ${tr(...cadre.nom)}`) : null,
      ]
        .filter(Boolean)
        .join(' · ') || titre(fete.niveau)}
      onFermer={onFermer}
    />
  );
}

/** Ce qu'un événement social devient à l'écran (bandeau en haut). */
export function texteSocial(e: { type: string; nom: string; montant?: number }): string {
  if (e.type === 'demande') return tr(`${e.nom} veut être ton ami au casino`, `${e.nom} wants to be your casino friend`);
  if (e.type === 'ami') return tr(`${e.nom} et toi êtes maintenant amis`, `${e.nom} and you are now friends`);
  if (e.type === 'recu') return tr(`${e.nom} t’a envoyé ${dollars(e.montant ?? 0)} !`, `${e.nom} sent you ${dollars(e.montant ?? 0)}!`);
  return '';
}

/** Ce qu'un changement de défi devient à l'écran (null : rien à dire). */
export function texteDefi(d: VueDefi, moi: string, avant: VueDefi | undefined): string | null {
  if (avant?.etat === d.etat) return null;
  const jeSuisDe = d.de.uid === moi;
  const lui = jeSuisDe ? d.vers.nom : d.de.nom;
  if (d.etat === 'attente' && !jeSuisDe) return tr(`${lui} te défie${d.mise ? ` : ${dollars(d.mise)}` : ''} !`, `${lui} challenges you${d.mise ? `: ${dollars(d.mise)}` : ''}!`);
  if (d.etat === 'enCours' && jeSuisDe) return tr(`${lui} relève ton défi : c’est parti !`, `${lui} accepts your challenge: go!`);
  if (d.etat === 'refuse' && jeSuisDe) return tr(`${lui} a refusé ton défi : ta mise est rendue.`, `${lui} declined your challenge: your stake is back.`);
  if (d.etat === 'expire' && jeSuisDe) return tr(`${lui} n’a pas répondu : ta mise est rendue.`, `${lui} did not answer: your stake is back.`);
  if (d.etat === 'annule' && !jeSuisDe) return tr(`${lui} a annulé son défi.`, `${lui} cancelled the challenge.`);
  if (d.etat === 'fini') {
    const r = resultatDefi(d, moi);
    return r === 'gagne'
      ? tr(`Défi gagné contre ${lui}${d.mise ? ` : +${dollars(2 * d.mise)}` : ''} !`, `Challenge won against ${lui}${d.mise ? `: +${dollars(2 * d.mise)}` : ''}!`)
      : r === 'perdu'
        ? tr(`Défi perdu contre ${lui}.`, `Challenge lost against ${lui}.`)
        : tr(`Égalité contre ${lui} : chacun récupère sa mise.`, `Tie with ${lui}: each stake comes back.`);
  }
  return null;
}
