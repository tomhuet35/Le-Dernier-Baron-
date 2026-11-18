/**
 * Le Tailleur du Baron : la boutique de tenues du salon. Chaque tenue est un personnage complet, acheté une fois
 * (en dollars ou en rubis), puis porté au salon à la place du personnage habituel. Le serveur tient tout
 * (shared/tailleur.ts, server/salonCasino.ts).
 */
import { useState, type CSSProperties } from 'react';
import type { VueCasino } from '../../shared/casino';
import { NOMS_GAMMES, TENUES, type Gamme, type Tenue } from '../../shared/tailleur';
import type { Appel } from './App';
import { Rubis } from './CasinoContrats';
import { dollars } from './casinoOutils';
import { tr } from './traduction';
import { jouerEffet } from './ui';
import './tailleur.css';

const court = (n: number) => (n >= 1e9 ? `${n / 1e9} Md $` : n >= 1e6 ? `${n / 1e6} M $` : dollars(n));

export function EcranTailleur({ vue, appel, onVue, onRetour }: { vue: VueCasino; appel: Appel; onVue: (v: VueCasino) => void; onRetour: () => void }) {
  const c = vue.contrats;
  const [essai, setEssai] = useState<Tenue | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const possede = c?.tenues ?? [];
  const porte = c?.tenue ?? null;
  const rubis = c?.rubis ?? 0;
  const agir = async (ev: string, data: unknown) => {
    setErreur(null);
    setOccupe(true);
    const r = (await appel(ev, data)) as { ok: boolean; erreur?: string; casino?: VueCasino };
    setOccupe(false);
    if (r.casino) onVue(r.casino);
    if (!r.ok) setErreur(r.erreur ?? tr('Le tailleur ne peut pas.', 'The tailor can’t.'));
    return r.ok;
  };
  const peutPayer = (t: Tenue) => (t.monnaie === 'rubis' ? rubis >= t.prix : vue.solde >= t.prix);
  const Prix = ({ t }: { t: Tenue }) => (t.monnaie === 'rubis' ? <Rubis n={t.prix} taille={16} /> : <b className="tl-dollars">{court(t.prix)}</b>);
  return (
    <div className="cas-ecran tl-ecran">
      <header className="cas-barre">
        <button type="button" className="cas-retour" onClick={onRetour}>
          ‹ {tr('Salon', 'Lounge')}
        </button>
        <h1>{tr('Le Tailleur', 'The Tailor')}</h1>
        <Rubis n={rubis} taille={22} className="ct-rubis-barre" />
      </header>
      <section className="tl-accueil">
        <img className="tl-tailleur" src="/cartes/tailleur.webp" alt={tr('Le tailleur', 'The tailor')} />
        <div className="tl-bulle">
          <p>{tr('Bienvenue ! Une tenue sur mesure, et tout le salon vous reconnaîtra.', 'Welcome! A tailored outfit, and the whole lounge will know you.')}</p>
          <div className="tl-portee">
            <img src={`/cartes/avatar-${vue.avatar}.webp`} alt="" />
            <span>
              <small>{tr('Tu portes', 'You’re wearing')}</small>
              <strong>{porte ? tr(...TENUES.find((t) => t.n === porte)!.nom) : tr('Ton personnage habituel', 'Your usual character')}</strong>
            </span>
          </div>
          {porte && (
            <button type="button" className="petit" disabled={occupe} onClick={() => void agir('casino_tailleur_porter', { n: null })}>
              {tr('Reprendre mon personnage', 'Back to my character')}
            </button>
          )}
        </div>
      </section>
      {(['ville', 'soiree', 'prestige'] as Gamme[]).map((g) => (
        <section key={g} className={`tl-gamme ${g}`}>
          <h2>{tr(...NOMS_GAMMES[g])}</h2>
          <ul>
            {TENUES.filter((t) => t.gamme === g).map((t, i) => {
              const a = possede.includes(t.n);
              const portee = porte === t.n;
              return (
                <li key={t.n} style={{ '--i': i } as CSSProperties}>
                  <button type="button" className={`tl-tenue ${a ? 'possedee' : ''} ${portee ? 'portee' : ''} ${t.n === 20 ? 'baronne' : ''}`} onClick={() => setEssai(t)}>
                    <img src={`/cartes/avatar-${t.n}.webp`} alt="" />
                    <strong>{tr(...t.nom)}</strong>
                    <span className="tl-etiquette">{portee ? tr('Portée', 'Worn') : a ? tr('À toi', 'Yours') : <Prix t={t} />}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <p className="cas-mention">{tr('Les tenues se portent au salon du casino. Elles ne changent rien aux jeux.', 'Outfits are worn in the casino lounge. They change nothing in the games.')}</p>
      {essai && (
        <div className="voile" role="dialog" aria-modal="true" onClick={() => setEssai(null)}>
          <div className="fenetre tl-essai" onClick={(e) => e.stopPropagation()}>
            <div className="tl-miroir">
              <img src={`/cartes/avatar-${essai.n}.webp`} alt={tr(...essai.nom)} />
            </div>
            <h2>{tr(...essai.nom)}</h2>
            <p className="discret">{tr(...NOMS_GAMMES[essai.gamme])}</p>
            {erreur && <p className="cas-erreur">{erreur}</p>}
            <div className="ct-confirme-boutons">
              <button type="button" onClick={() => setEssai(null)}>
                {tr('Fermer', 'Close')}
              </button>
              {possede.includes(essai.n) ? (
                <button type="button" className="principal" disabled={occupe || porte === essai.n} onClick={() => void agir('casino_tailleur_porter', { n: essai.n }).then((ok) => ok && setEssai(null))}>
                  {porte === essai.n ? tr('Déjà portée', 'Already worn') : tr('Porter', 'Wear')}
                </button>
              ) : (
                <button
                  type="button"
                  className="principal"
                  disabled={occupe || !peutPayer(essai)}
                  onClick={() =>
                    void agir('casino_tailleur_acheter', { n: essai.n }).then((ok) => {
                      if (ok) {
                        jouerEffet('roulette_gain');
                        setEssai(null);
                      }
                    })
                  }
                >
                  {tr('Acheter et porter', 'Buy and wear')} · <Prix t={essai} />
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {erreur && !essai && <div className="toast">{erreur}</div>}
    </div>
  );
}
