/**
 * Grand Hôtel du Baron, deuxième brique : la Salle des ventes (3 lots aux enchères par jour) et le Bureau du Baron
 * (les objets gagnés, exposés dans ses vitrines ; « La plus belle collection »). Le serveur tient tout
 * (shared/ventes.ts, server/ventesCasino.ts) : ces écrans affichent la vue et envoient les enchères.
 */
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import type { VueCasino } from '../../shared/casino';
import {
  arrondiHaut,
  CADRES_SPECIAUX,
  IDS_OBJETS,
  NOMS_RARETE,
  OBJETS,
  RUBIS_COLLECTION,
  type AnnonceVente,
  type IdObjet,
  type Monnaie,
  type VueBureau,
  type VueLot,
} from '../../shared/ventes';
import type { Appel } from './App';
import { CadreAvatar } from './CasinoSocial';
import { Rubis } from './CasinoContrats';
import { dollars } from './casinoOutils';
import { useAttente } from './RouletteDuJour';
import { socket } from './socket';
import { tr } from './traduction';
import { jouerEffet } from './ui';
import './bureau.css';

const imageObjet = (o: IdObjet) => `/cartes/objet-${o}.webp`;
const nomObjet = (o: IdObjet) => tr(...OBJETS[o].nom);
const rarete = (o: IdObjet) => tr(...NOMS_RARETE[OBJETS[o].rarete]);

/** Un montant dans sa monnaie (dollars, ou rubis avec leur icône). */
function Montant({ m, n, taille = 16 }: { m: Monnaie; n: number; taille?: number }) {
  return m === 'rubis' ? <Rubis n={n} taille={taille} /> : <span className="bv-dollars">{dollars(n)}</span>;
}

/** Dans le salon : la Salle des ventes (fin des enchères) et le Bureau (objets de la collection). */
export function BoutonsVentes({ vue, onVentes, onBureau }: { vue: VueCasino; onVentes: () => void; onBureau: () => void }) {
  const fin = useAttente(vue.ventes?.fin);
  if (!vue.ventes || !vue.contrats) return null;
  return (
    <div className="bv-boutons">
      <button type="button" className="ct-bouton" onClick={onVentes}>
        <img src="/cartes/marteau-encheres.webp" alt="" />
        <span>
          <strong>{tr('Salle des ventes', 'Auction house')}</strong>
          <small>{fin ? tr(`${vue.ventes.lots.length} lots · fin dans ${fin}`, `${vue.ventes.lots.length} lots · ends in ${fin}`) : tr('3 lots du jour', 'Today’s 3 lots')}</small>
        </span>
      </button>
      <button type="button" className="ct-bouton" onClick={onBureau}>
        <img src="/cartes/objet-globe.webp" alt="" />
        <span>
          <strong>{tr('Mon bureau', 'My office')}</strong>
          <small>{tr(`${vue.contrats.objets}/${IDS_OBJETS.length} objets`, `${vue.contrats.objets}/${IDS_OBJETS.length} items`)}</small>
        </span>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// La Salle des ventes

function propositions(l: VueLot): number[] {
  const m = l.minimum;
  const r = l.monnaie === 'rubis' ? (x: number) => Math.ceil(x) : arrondiHaut;
  return [...new Set([m, r(m * 1.25), r(m * 1.5)])];
}

function CarteLot({ l, moi, solde, rubis, onEncherir }: { l: VueLot; moi: string; solde: number; rubis: number; onEncherir: (l: VueLot) => void }) {
  const enTete = l.meilleure?.uid === moi;
  const peut = (l.monnaie === 'rubis' ? rubis : solde) >= l.minimum;
  return (
    <li className={`bv-lot rarete-${OBJETS[l.objet].rarete} ${enTete ? 'en-tete' : ''}`} style={{ '--i': l.index } as CSSProperties}>
      <div className="bv-socle">
        <img src={imageObjet(l.objet)} alt={nomObjet(l.objet)} />
      </div>
      <div className="bv-infos">
        <span className="bv-rarete">
          {tr(`Lot ${l.index + 1}`, `Lot ${l.index + 1}`)} · {rarete(l.objet)} {l.monnaie === 'rubis' && <>· {tr('en rubis', 'in rubies')}</>}
        </span>
        <strong className="bv-nom">{nomObjet(l.objet)}</strong>
        {l.meilleure ? (
          <span className="bv-meilleure">
            <img src={`/cartes/avatar-${l.meilleure.avatar}.webp`} alt="" />
            <span>{enTete ? tr('Toi', 'You') : l.meilleure.nom || tr('Créateur', 'Creator')}</span>
            <Montant m={l.monnaie} n={l.meilleure.montant} />
          </span>
        ) : (
          <span className="bv-depart">
            {tr('Mise de départ', 'Starting bid')} : <Montant m={l.monnaie} n={l.prixDepart} />
          </span>
        )}
        <small className="discret">{l.encheres ? tr(`${l.encheres} enchère${l.encheres > 1 ? 's' : ''}`, `${l.encheres} bid${l.encheres > 1 ? 's' : ''}`) : tr('Aucune enchère', 'No bids yet')}</small>
        {enTete ? (
          <span className="bv-tete">{tr('Tu es en tête !', 'You’re in the lead!')}</span>
        ) : (
          <button type="button" className="principal bv-encherir" disabled={!peut} onClick={() => onEncherir(l)}>
            {tr('Enchérir', 'Bid')} · <Montant m={l.monnaie} n={l.minimum} taille={15} />
          </button>
        )}
      </div>
    </li>
  );
}

export function EcranVentes({ vue, appel, moi, onVue, onRetour, onBureau }: { vue: VueCasino; appel: Appel; moi: string; onVue: (v: VueCasino) => void; onRetour: () => void; onBureau: () => void }) {
  const v = vue.ventes;
  const fin = useAttente(v?.fin);
  const [choix, setChoix] = useState<VueLot | null>(null);
  const [montant, setMontant] = useState(0);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const rubis = vue.contrats?.rubis ?? 0;
  const ouvrir = (l: VueLot) => {
    setErreur(null);
    setChoix(l);
    setMontant(l.minimum);
  };
  // Le lot choisi suit les enchères des autres (le minimum peut monter pendant qu'on hésite).
  const lotActuel = choix ? (v?.lots.find((x) => x.index === choix.index) ?? null) : null;
  useEffect(() => {
    if (lotActuel && montant < lotActuel.minimum) setMontant(lotActuel.minimum);
  }, [lotActuel, montant]);
  const valider = async () => {
    if (!lotActuel) return;
    setOccupe(true);
    const r = (await appel('casino_encherir', { index: lotActuel.index, montant })) as { ok: boolean; erreur?: string; casino?: VueCasino };
    setOccupe(false);
    if (r.casino) onVue(r.casino);
    if (!r.ok) return setErreur(r.erreur ?? tr('Enchère impossible.', 'Bid failed.'));
    jouerEffet('jeton');
    setChoix(null);
  };
  if (!v) return null;
  return (
    <div className="cas-ecran bv-ecran bv-ventes">
      <header className="cas-barre">
        <button type="button" className="cas-retour" onClick={onRetour}>
          ‹ {tr('Salon', 'Lounge')}
        </button>
        <h1>{tr('Salle des ventes', 'Auction house')}</h1>
        <Rubis n={rubis} taille={22} className="ct-rubis-barre" />
      </header>
      <section className="bv-scene">
        <img src="/cartes/salle-des-ventes.webp" alt="" />
        <p>
          <img src="/cartes/marteau-encheres.webp" alt="" />
          {fin ? tr(`Adjugé à minuit · encore ${fin}`, `Sold at midnight · ${fin} left`) : tr('Adjugé à minuit', 'Sold at midnight')}
        </p>
      </section>
      <ol className="bv-lots">
        {v.lots.map((l) => (
          <CarteLot key={`${l.index}-${l.objet}`} l={l} moi={moi} solde={vue.solde} rubis={rubis} onEncherir={ouvrir} />
        ))}
      </ol>
      <p className="discret bv-aide">
        {tr(
          'Ton enchère est bloquée jusqu’à minuit. Si quelqu’un surenchérit, elle t’est rendue aussitôt. À minuit, la meilleure enchère emporte l’objet, qui rejoint ton bureau.',
          'Your bid is held until midnight. If someone outbids you, it comes straight back. At midnight, the highest bid takes the item to your office.',
        )}
      </p>
      <button type="button" className="bv-lien" onClick={onBureau}>
        {tr('Voir mon bureau', 'See my office')} ›
      </button>
      {lotActuel && (
        <div className="voile" role="dialog" aria-modal="true" onClick={() => setChoix(null)}>
          <div className="fenetre bv-fenetre" onClick={(e) => e.stopPropagation()}>
            <img className="bv-fenetre-objet" src={imageObjet(lotActuel.objet)} alt="" />
            <h2>{nomObjet(lotActuel.objet)}</h2>
            <p className="discret">{tr('Choisis ton enchère :', 'Pick your bid:')}</p>
            <div className="bv-choix">
              {propositions(lotActuel).map((x) => (
                <button key={x} type="button" className={x === montant ? 'choisi' : ''} disabled={(lotActuel.monnaie === 'rubis' ? rubis : vue.solde) < x} onClick={() => setMontant(x)}>
                  <Montant m={lotActuel.monnaie} n={x} />
                </button>
              ))}
            </div>
            {erreur && <p className="cas-erreur">{erreur}</p>}
            <div className="ct-confirme-boutons">
              <button type="button" onClick={() => setChoix(null)}>
                {tr('Annuler', 'Cancel')}
              </button>
              <button type="button" className="principal" disabled={occupe} onClick={() => void valider()}>
                {tr('Enchérir', 'Bid')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Le Bureau du Baron

export function EcranBureau({ uid, appel, onRetour, onVentes, onProfil }: { uid: string | null; appel: Appel; onRetour: () => void; onVentes: () => void; onProfil: (uid: string) => void }) {
  const [b, setB] = useState<VueBureau | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const charger = useCallback(async () => {
    const r = (await appel('casino_bureau', uid ? { uid } : {})) as { ok: boolean; erreur?: string; bureau?: VueBureau };
    if (r.ok && r.bureau) setB(r.bureau);
    else setErreur(r.erreur ?? tr('Bureau indisponible.', 'Office unavailable.'));
  }, [appel, uid]);
  useEffect(() => {
    window.scrollTo(0, 0);
    void charger();
  }, [charger]);
  return (
    <div className="cas-ecran bv-ecran bv-bureau">
      <header className="cas-barre">
        <button type="button" className="cas-retour" onClick={onRetour}>
          ‹ {tr('Retour', 'Back')}
        </button>
        <h1>{b && !b.moi ? tr('Son bureau', 'Their office') : tr('Mon bureau', 'My office')}</h1>
        <span className="cas-barre-vide" />
      </header>
      {!b ? (
        <p className="discret cs-centre">{erreur ?? tr('Chargement…', 'Loading…')}</p>
      ) : (
        <>
          <section className="bv-entete">
            <img className="bv-entete-fond" src="/cartes/bureau-baron.webp" alt="" />
            <div className="bv-entete-qui">
              <CadreAvatar avatar={b.avatar} niveau={b.niveau} taille={64} special={b.cadre} />
              <span>
                <strong>{b.moi ? tr('Ton bureau', 'Your office') : tr(`Le bureau de ${b.nom || 'Créateur'}`, `${b.nom || 'Creator'}’s office`)}</strong>
                <small>
                  {tr('Valeur de la collection', 'Collection value')} : <b>{dollars(b.valeur)}</b>
                </small>
                {b.cadre && <small className="bv-cadre-nom">{tr(...CADRES_SPECIAUX[b.cadre])}</small>}
              </span>
            </div>
          </section>
          <ul className="bv-vitrines">
            {IDS_OBJETS.map((o, k) => {
              const piece = b.collection[o];
              return (
                <li key={o} className={`bv-vitrine rarete-${OBJETS[o].rarete} ${piece ? 'pleine' : 'vide'}`} style={{ '--i': k } as CSSProperties}>
                  <img src={imageObjet(o)} alt={piece ? nomObjet(o) : ''} />
                  <strong>{piece ? nomObjet(o) : '???'}</strong>
                  <small>
                    {rarete(o)}
                    {piece && piece.n > 1 && ` · ×${piece.n}`}
                  </small>
                </li>
              );
            })}
          </ul>
          {b.moi && (
            <>
              <p className="discret bv-aide">
                {tr(`Gagne les 10 objets à la Salle des ventes : ${RUBIS_COLLECTION} rubis et le cadre Mécène.`, `Win all 10 items at the auction house: ${RUBIS_COLLECTION} rubies and the Patron frame.`)}
              </p>
              <button type="button" className="principal large" onClick={onVentes}>
                {tr('Aller à la Salle des ventes', 'Go to the auction house')}
              </button>
            </>
          )}
          {b.classement.length > 0 && (
            <section className="cas-riches">
              <h2>{tr('La plus belle collection', 'Finest collection')}</h2>
              <ol>
                {b.classement.map((c, i) => (
                  <li key={c.uid} className={c.uid === b.uid ? 'moi' : ''}>
                    <span className="cas-riche-rang">{i + 1}</span>
                    <button type="button" className="bv-classement-qui" onClick={() => onProfil(c.uid)}>
                      <CadreAvatar avatar={c.avatar} niveau={1} taille={34} sansNiveau special={c.cadre} />
                      <span className="cas-riche-nom">{c.nom || tr('Créateur', 'Creator')}</span>
                    </button>
                    <strong>
                      {dollars(c.valeur)} <small className="discret">· {c.objets}/10</small>
                    </strong>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Les annonces : surenchéri, objet gagné

export function AnnoncesVentes({ onOuvrir, onAnnonce }: { onOuvrir: (e: 'ventes' | 'bureau') => void; onAnnonce: () => void }) {
  const [a, setA] = useState<{ id: number; a: AnnonceVente } | null>(null);
  useEffect(() => {
    const sur = (x: AnnonceVente) => {
      setA({ id: Date.now(), a: x });
      jouerEffet(x.type === 'gagne' ? 'roulette_gros_lot' : 'casino_annonce');
      onAnnonce();
    };
    socket.on('casino_vente', sur);
    return () => {
      socket.off('casino_vente', sur);
    };
  }, [onAnnonce]);
  useEffect(() => {
    if (!a) return;
    const t = window.setTimeout(() => setA(null), 5000);
    return () => window.clearTimeout(t);
  }, [a]);
  if (!a) return null;
  const x = a.a;
  return (
    <button
      type="button"
      key={a.id}
      className={`ct-annonce ${x.type === 'gagne' ? 'grande' : ''}`}
      onClick={() => {
        setA(null);
        onOuvrir(x.type === 'gagne' ? 'bureau' : 'ventes');
      }}
    >
      <img className="ct-annonce-vignette" src={imageObjet(x.objet)} alt="" />
      <span>
        <strong>{x.type === 'gagne' ? (x.complete ? tr('Collection complète !', 'Collection complete!') : tr('Adjugé ! L’objet est à toi', 'Sold! The item is yours')) : tr('Tu as été surenchéri !', 'You’ve been outbid!')}</strong>
        <small>
          {x.type === 'gagne'
            ? tr(`${nomObjet(x.objet)} rejoint ton bureau.`, `${nomObjet(x.objet)} joins your office.`)
            : tr(`${x.par} a surenchéri sur ${nomObjet(x.objet)}. Ta mise t’est rendue.`, `${x.par} outbid you on ${nomObjet(x.objet)}. Your bid is returned.`)}
        </small>
      </span>
    </button>
  );
}
