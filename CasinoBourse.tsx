/**
 * La Bourse de 1929 : la corbeille (les six titres, leurs cours et leurs courbes), la une du « Petit Baron », le
 * téléscripteur des nouvelles, le portefeuille, et les ordres d'achat et de vente. Le serveur tient les cours
 * (shared/bourse.ts, server/bourseCasino.ts).
 */
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import type { VueCasino } from '../../shared/casino';
import { ACTIONS, coutPortefeuille, devisAchat, FRAIS, IDS_ACTIONS, MONTANTS_ACHAT, produitVente, valeurPortefeuille, type IdAction, type Nouvelle, type VueBourse } from '../../shared/bourse';
import type { Appel } from './App';
import { dollars } from './casinoOutils';
import { useAttente } from './RouletteDuJour';
import { socket } from './socket';
import { tr } from './traduction';
import { jouerEffet } from './ui';
import './bourse.css';

const imageAction = (a: IdAction) => `/cartes/action-${a}.webp`;
const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toLocaleString(tr('fr-FR', 'en-US'), { maximumFractionDigits: 1, minimumFractionDigits: 1 })} %`;
const court = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toLocaleString(tr('fr-FR', 'en-US'), { maximumFractionDigits: 2 })} Md $` : n >= 1e6 ? `${(n / 1e6).toLocaleString(tr('fr-FR', 'en-US'), { maximumFractionDigits: 2 })} M $` : dollars(n);

/** La courbe d'un titre (les dernières séances). */
function Courbe({ points, hausse }: { points: number[]; hausse: boolean }) {
  if (points.length < 2) return <svg className="bo-courbe" viewBox="0 0 100 30" />;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const e = max - min || 1;
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${((i / (points.length - 1)) * 100).toFixed(2)} ${(28 - ((p - min) / e) * 26).toFixed(2)}`).join(' ');
  return (
    <svg className={`bo-courbe ${hausse ? 'hausse' : 'baisse'}`} viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
      <path d={`${d} L100 30 L0 30 Z`} className="bo-aire" />
      <path d={d} className="bo-ligne" />
    </svg>
  );
}

function Une({ n }: { n: Nouvelle | undefined }) {
  if (!n) return null;
  const marche = n.type === 'krach' || n.type === 'envolee';
  return (
    <section className={`bo-une ${n.type}`}>
      {marche ? (
        <img src={n.type === 'krach' ? '/cartes/journal-krach.webp' : '/cartes/journal-hausse.webp'} alt="" />
      ) : (
        <img src={imageAction(n.action!)} alt="" className="bo-une-titre" />
      )}
      <span>
        <small>
          {tr('Le Petit Baron', 'Le Petit Baron')} · {new Date(n.t).toLocaleTimeString(tr('fr-FR', 'en-GB'), { hour: '2-digit', minute: '2-digit' })}
        </small>
        <strong>{tr(...n.titre)}</strong>
        <b className={n.variation >= 0 ? 'hausse' : 'baisse'}>
          {n.action ? ACTIONS[n.action].nom : tr('Tout le marché', 'The whole market')} {pct(n.variation)}
        </b>
      </span>
    </section>
  );
}

export function EcranBourse({ vue, appel, onVue, onRetour }: { vue: VueCasino; appel: Appel; onVue: (v: VueCasino) => void; onRetour: () => void }) {
  const [b, setB] = useState<VueBourse | null>(null);
  const [choix, setChoix] = useState<IdAction | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [eclair, setEclair] = useState<Nouvelle | null>(null);
  const charger = useCallback(async () => {
    const r = (await appel('casino_bourse')) as { ok: boolean; bourse?: VueBourse; erreur?: string };
    if (r.ok && r.bourse) setB(r.bourse);
    else setErreur(r.erreur ?? tr('La Bourse est fermée pour le moment.', 'The exchange is closed right now.'));
  }, [appel]);
  useEffect(() => {
    window.scrollTo(0, 0);
    void charger();
    // Chaque séance : les nouveaux cours (et la nouvelle du jour) arrivent ; on relit les courbes.
    const sur = (x: { nouvelle: Nouvelle | null }) => {
      if (x.nouvelle) {
        setEclair(x.nouvelle);
        jouerEffet(x.nouvelle.type === 'krach' ? 'sirene' : 'casino_annonce');
      }
      void charger();
    };
    socket.on('casino_bourse_seance', sur);
    return () => {
      socket.off('casino_bourse_seance', sur);
    };
  }, [charger]);
  useEffect(() => {
    if (!eclair) return;
    const t = window.setTimeout(() => setEclair(null), 6000);
    return () => window.clearTimeout(t);
  }, [eclair]);
  useEffect(() => {
    if (!erreur) return;
    const t = window.setTimeout(() => setErreur(null), 4000);
    return () => window.clearTimeout(t);
  }, [erreur]);
  const prochaine = useAttente(b?.prochaine);
  const ordre = async (data: Record<string, unknown>) => {
    const r = (await appel('casino_bourse_ordre', data)) as { ok: boolean; erreur?: string; bourse?: VueBourse; casino?: VueCasino };
    if (r.casino) onVue(r.casino);
    if (r.bourse) setB(r.bourse);
    if (!r.ok) return setErreur(r.erreur ?? tr('Ordre refusé.', 'Order rejected.'));
    jouerEffet(data.sens === 'achat' ? 'jeton' : 'machine_pieces');
  };

  const valeur = b ? valeurPortefeuille(b.portefeuille, b.cours) : 0;
  const cout = b ? coutPortefeuille(b.portefeuille) : 0;
  return (
    <div className="cas-ecran bo-ecran">
      <header className="cas-barre">
        <button type="button" className="cas-retour" onClick={onRetour}>
          ‹ {tr('Salon', 'Lounge')}
        </button>
        <h1>{tr('La Bourse de 1929', 'The 1929 Exchange')}</h1>
        <span className="cas-solde-petit">{dollars(vue.solde)}</span>
      </header>
      {!b ? (
        <p className="discret cs-centre">{erreur ?? tr('Ouverture de la corbeille…', 'Opening the trading floor…')}</p>
      ) : (
        <>
          <div className="bo-telescripteur" aria-label={tr('Téléscripteur', 'Ticker')}>
            <img src="/cartes/telescripteur.webp" alt="" />
            <div className="bo-ruban">
              <span>
                {IDS_ACTIONS.map((a) => {
                  const v = b.cours[a] / b.ouverture[a] - 1;
                  return (
                    <i key={a} className={v >= 0 ? 'hausse' : 'baisse'}>
                      {ACTIONS[a].court} {court(b.cours[a])} {v >= 0 ? '▲' : '▼'} {pct(v)}
                    </i>
                  );
                })}
              </span>
            </div>
          </div>
          <Une n={b.nouvelles[0]} />
          <section className="bo-portefeuille">
            <span>
              <small>{tr('Mon portefeuille', 'My portfolio')}</small>
              <strong>{court(valeur)}</strong>
            </span>
            <span>
              <small>{tr('Plus-value', 'Gain')}</small>
              <strong className={valeur - cout >= 0 ? 'hausse' : 'baisse'}>
                {valeur - cout >= 0 ? '+' : '−'}
                {court(Math.abs(valeur - cout))}
              </strong>
            </span>
            <span>
              <small>{tr('Prochaine séance', 'Next session')}</small>
              <strong>{prochaine ?? tr('maintenant', 'now')}</strong>
            </span>
          </section>
          <ul className="bo-titres">
            {IDS_ACTIONS.map((a, i) => {
              const v = b.cours[a] / b.ouverture[a] - 1;
              const ligne = b.portefeuille[a];
              return (
                <li key={a} style={{ '--i': i } as CSSProperties}>
                  <button type="button" className={`bo-titre ${choix === a ? 'choisi' : ''}`} onClick={() => setChoix(a)}>
                    <img src={imageAction(a)} alt="" />
                    <span className="bo-titre-nom">
                      <strong>{ACTIONS[a].nom}</strong>
                      <small>{ligne ? tr(`${ligne.n.toLocaleString('fr-FR')} actions · ${court(ligne.n * b.cours[a])}`, `${ligne.n.toLocaleString('en-US')} shares · ${court(ligne.n * b.cours[a])}`) : ACTIONS[a].court}</small>
                    </span>
                    <Courbe points={b.historique[a]} hausse={v >= 0} />
                    <span className="bo-titre-cours">
                      <b>{court(b.cours[a])}</b>
                      <small className={v >= 0 ? 'hausse' : 'baisse'}>{pct(v)}</small>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {b.nouvelles.length > 1 && (
            <section className="bo-nouvelles">
              <h2>{tr('Les dernières nouvelles', 'Latest news')}</h2>
              <ul>
                {b.nouvelles.slice(1, 8).map((n) => (
                  <li key={n.t}>
                    <small>{new Date(n.t).toLocaleTimeString(tr('fr-FR', 'en-GB'), { hour: '2-digit', minute: '2-digit' })}</small> {tr(...n.titre)}{' '}
                    <b className={n.variation >= 0 ? 'hausse' : 'baisse'}>{pct(n.variation)}</b>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="cas-mention">
            {tr(
              `Sociétés et cours fictifs. Une séance toutes les 5 minutes ; ${FRAIS * 100} % de courtage à l’achat et à la vente.`,
              `Fictional companies and prices. A session every 5 minutes; ${FRAIS * 100}% brokerage fee on each trade.`,
            )}
          </p>
          {choix && <FenetreOrdre a={choix} b={b} solde={vue.solde} onOrdre={ordre} onFermer={() => setChoix(null)} />}
        </>
      )}
      {eclair && (
        <div className={`bo-eclair ${eclair.type}`} role="status" onClick={() => setEclair(null)}>
          {(eclair.type === 'krach' || eclair.type === 'envolee') && <img src={eclair.type === 'krach' ? '/cartes/journal-krach.webp' : '/cartes/journal-hausse.webp'} alt="" />}
          <strong>{tr(...eclair.titre)}</strong>
        </div>
      )}
      {erreur && b && <div className="toast">{erreur}</div>}
    </div>
  );
}

function FenetreOrdre({ a, b, solde, onOrdre, onFermer }: { a: IdAction; b: VueBourse; solde: number; onOrdre: (d: Record<string, unknown>) => Promise<void>; onFermer: () => void }) {
  const cours = b.cours[a];
  const ligne = b.portefeuille[a];
  const [occupe, setOccupe] = useState(false);
  const envoyer = async (d: Record<string, unknown>) => {
    setOccupe(true);
    await onOrdre(d);
    setOccupe(false);
  };
  return (
    <div className="voile" role="dialog" aria-modal="true" onClick={onFermer}>
      <div className="fenetre bo-ordre" onClick={(e) => e.stopPropagation()}>
        <img className="bo-ordre-titre" src={imageAction(a)} alt={ACTIONS[a].nom} />
        <p className="bo-ordre-cours">
          {tr('Cours', 'Price')} : <b>{dollars(cours)}</b>
          {ligne && (
            <>
              {' '}
              · {tr('Tu as', 'You own')} <b>{ligne.n.toLocaleString(tr('fr-FR', 'en-US'))}</b> {tr('actions', 'shares')} ({tr('revient', 'cost')} {court(ligne.cout)})
            </>
          )}
        </p>
        <h3>{tr('Acheter pour', 'Buy for')}</h3>
        <div className="bo-boutons">
          {MONTANTS_ACHAT.map((m) => {
            const d = devisAchat(cours, Math.min(m, solde));
            return (
              <button key={m} type="button" className="principal" disabled={occupe || d.n <= 0 || solde < m * 0.5} onClick={() => void envoyer({ action: a, sens: 'achat', montant: m })}>
                {court(m)}
                <small>{d.n.toLocaleString(tr('fr-FR', 'en-US'))} act.</small>
              </button>
            );
          })}
        </div>
        {ligne && (
          <>
            <h3>{tr('Vendre', 'Sell')}</h3>
            <div className="bo-boutons">
              {[0.25, 0.5, 1].map((p) => {
                const n = p === 1 ? ligne.n : Math.max(1, Math.floor(ligne.n * p));
                return (
                  <button key={p} type="button" disabled={occupe} onClick={() => void envoyer({ action: a, sens: 'vente', part: p })}>
                    {p === 1 ? tr('Tout', 'All') : p === 0.5 ? tr('La moitié', 'Half') : tr('Un quart', 'A quarter')}
                    <small>+{court(produitVente(cours, n))}</small>
                  </button>
                );
              })}
            </div>
          </>
        )}
        <button type="button" className="bo-fermer" onClick={onFermer}>
          {tr('Fermer', 'Close')}
        </button>
      </div>
    </div>
  );
}
