/**
 * Le Marché noir : la ruelle derrière l'hôtel, le receleur et sa malle. Quatre articles par jour, payés en rubis (deux
 * cadres d'avatar rares, un objet de collection, une mallette de dollars), et le choix du cadre porté.
 * Le serveur tient l'étal (shared/marche.ts, server/salonCasino.ts).
 */
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import type { VueCasino } from '../../shared/casino';
import { NOMS_CADRES, PRIX_RELANCE, type ArticleMarche, type VueMarche } from '../../shared/marche';
import { NOMS_RARETE, OBJETS } from '../../shared/ventes';
import type { Appel } from './App';
import { Rubis } from './CasinoContrats';
import { CadreAvatar } from './CasinoSocial';
import { dollars } from './casinoOutils';
import { useAttente } from './RouletteDuJour';
import { tr } from './traduction';
import { jouerEffet } from './ui';
import './marche.css';

function Article({ a, avatar, niveau, onAcheter, rubis }: { a: VueMarche['articles'][number]; avatar: number; niveau: number; rubis: number; onAcheter: () => void }) {
  const nom = a.type === 'cadre' ? tr(...NOMS_CADRES[a.cadre]) : a.type === 'objet' ? tr(...OBJETS[a.objet].nom) : tr('Mallette de dollars', 'Briefcase of dollars');
  const sous =
    a.type === 'cadre'
      ? tr('Cadre d’avatar rare', 'Rare avatar frame')
      : a.type === 'objet'
        ? `${tr(...NOMS_RARETE[OBJETS[a.objet].rarete])} · ${tr('pour ton bureau', 'for your office')}`
        : `+${dollars(a.dollars)}`;
  const fini = a.achete || a.possede;
  return (
    <li className={`mn-article ${fini ? 'fini' : ''} ${a.type}`}>
      <div className="mn-visuel">
        {a.type === 'cadre' ? (
          <CadreAvatar avatar={avatar} niveau={niveau} taille={92} sansNiveau special={a.cadre} />
        ) : a.type === 'objet' ? (
          <img src={`/cartes/objet-${a.objet}.webp`} alt="" />
        ) : (
          <img src="/cartes/malle.webp" alt="" />
        )}
      </div>
      <strong>{nom}</strong>
      <small>{sous}</small>
      <button type="button" className="principal mn-acheter" disabled={fini || rubis < a.prix} onClick={onAcheter}>
        {a.possede ? tr('Déjà à toi', 'Already yours') : a.achete ? tr('Acheté', 'Bought') : <Rubis n={a.prix} taille={16} />}
      </button>
    </li>
  );
}

export function EcranMarche({ vue, appel, onVue, onRetour }: { vue: VueCasino; appel: Appel; onVue: (v: VueCasino) => void; onRetour: () => void }) {
  const [m, setM] = useState<VueMarche | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [confirme, setConfirme] = useState<number | null>(null);
  const agir = useCallback(
    async (ev: string, data?: unknown) => {
      setErreur(null);
      const r = (await appel(ev, data)) as { ok: boolean; erreur?: string; marche?: VueMarche; casino?: VueCasino };
      if (r.casino) onVue(r.casino);
      if (r.marche) setM(r.marche);
      if (!r.ok) setErreur(r.erreur ?? tr('Le receleur refuse.', 'The fence refuses.'));
      return r.ok;
    },
    [appel, onVue],
  );
  useEffect(() => {
    window.scrollTo(0, 0);
    void agir('casino_marche');
  }, [agir]);
  useEffect(() => {
    if (!erreur) return;
    const t = window.setTimeout(() => setErreur(null), 4000);
    return () => window.clearTimeout(t);
  }, [erreur]);
  const fin = useAttente(m?.fin);
  const rubis = vue.contrats?.rubis ?? 0;
  const niveau = vue.profil?.niveau ?? 1;
  const choisi = m ? (m.cadreChoisi ?? null) : null;
  const article: ArticleMarche | undefined = confirme !== null ? m?.articles[confirme] : undefined;
  return (
    <div className="cas-ecran mn-ecran">
      <header className="cas-barre">
        <button type="button" className="cas-retour" onClick={onRetour}>
          ‹ {tr('Salon', 'Lounge')}
        </button>
        <h1>{tr('Le Marché noir', 'The Black Market')}</h1>
        <Rubis n={rubis} taille={22} className="ct-rubis-barre" />
      </header>
      <section className="mn-ruelle">
        <img className="mn-receleur" src="/cartes/receleur.webp" alt={tr('Le receleur', 'The fence')} />
        <p className="mn-bulle">
          {tr('Psst… Regarde ce que j’ai dans ma malle ce soir. Ça part à minuit.', 'Psst… Look what’s in my trunk tonight. Gone by midnight.')}
          {fin && <small>{tr(`Nouvel arrivage dans ${fin}`, `New stock in ${fin}`)}</small>}
        </p>
      </section>
      {!m ? (
        <p className="discret cs-centre">{tr('Le receleur ouvre sa malle…', 'The fence opens his trunk…')}</p>
      ) : (
        <>
          <ul className="mn-etal">
            {m.articles.map((a, i) => (
              <Article key={`${i}-${a.type}`} a={a} avatar={vue.avatar} niveau={niveau} rubis={rubis} onAcheter={() => setConfirme(i)} />
            ))}
          </ul>
          <button type="button" className="mn-relancer" disabled={!m.relances || rubis < PRIX_RELANCE} onClick={() => void agir('casino_marche_relancer').then((ok) => ok && jouerEffet('melange'))}>
            {tr('Autre chose ?', 'Anything else?')} · <Rubis n={PRIX_RELANCE} taille={14} /> <small>({tr(`encore ${m.relances}`, `${m.relances} left`)})</small>
          </button>
          {m.cadres.length > 0 && (
            <section className="mn-cadres">
              <h2>{tr('Mes cadres', 'My frames')}</h2>
              <ul>
                <li>
                  <button type="button" className={choisi === null ? 'choisi' : ''} onClick={() => void agir('casino_cadre_choisir', { cadre: null })}>
                    <CadreAvatar avatar={vue.avatar} niveau={niveau} taille={58} sansNiveau />
                    <small>{tr('Niveau', 'Level')}</small>
                  </button>
                </li>
                {m.cadres.map((c) => (
                  <li key={c}>
                    <button type="button" className={choisi === c ? 'choisi' : ''} onClick={() => void agir('casino_cadre_choisir', { cadre: c })}>
                      <CadreAvatar avatar={vue.avatar} niveau={niveau} taille={58} sansNiveau special={c} />
                      <small>{NOMS_CADRES[c] ? tr(...NOMS_CADRES[c]) : c}</small>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="cas-mention">{tr('Objets de style et dollars de jeu seulement : rien ici ne fait gagner aux jeux.', 'Style items and play dollars only: nothing here helps you win games.')}</p>
        </>
      )}
      {article && confirme !== null && (
        <div className="voile" role="dialog" aria-modal="true" onClick={() => setConfirme(null)}>
          <div className="fenetre mn-confirme" style={{ '--x': 0 } as CSSProperties} onClick={(e) => e.stopPropagation()}>
            <p>{tr('Marché conclu ?', 'Deal?')}</p>
            <div className="ct-confirme-boutons">
              <button type="button" onClick={() => setConfirme(null)}>
                {tr('Non', 'No')}
              </button>
              <button
                type="button"
                className="principal"
                onClick={() => {
                  const i = confirme;
                  setConfirme(null);
                  void agir('casino_marche_acheter', { index: i }).then((ok) => ok && jouerEffet('machine_pieces'));
                }}
              >
                {tr('Payer', 'Pay')} <Rubis n={article.prix} taille={14} />
              </button>
            </div>
          </div>
        </div>
      )}
      {erreur && <div className="toast">{erreur}</div>}
    </div>
  );
}
