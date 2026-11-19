/**
 * Le Grand Hôtel du Baron : l'hôtel en coupe (on appuie sur un étage), la carte de membre, la Semaine du Baron, la happy
 * hour, le Groom et le Penthouse. Le serveur tient tout (shared/hotel.ts, server/salonCasino.ts).
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { VueCasino } from '../../shared/casino';
import { CARTES_MEMBRE, carteMembre, carteSuivante, COFFRE_COMPLET, ETAGES, etageOuvert, type AnnonceHotel, type CadeauSemaine, type Etage } from '../../shared/hotel';
import type { Appel } from './App';
import { Rubis } from './CasinoContrats';
import { dollars } from './casinoOutils';
import { useAttente } from './RouletteDuJour';
import { socket } from './socket';
import { tr } from './traduction';
import { jouerEffet } from './ui';
import './hotel.css';

/** Zones de chaque étage sur l'image de l'hôtel en coupe (hotel-hall.webp, en % de l'image). */
const ZONES: Record<Etage, { top: number; height: number }> = {
  penthouse: { top: 2, height: 19 },
  scene: { top: 22, height: 21 },
  tables: { top: 44, height: 22 },
  bar: { top: 67, height: 24 },
};
const nomEtage = (id: Etage) => tr(...ETAGES.find((e) => e.id === id)!.nom);

// ---------------------------------------------------------------------------------------------------------------
// Le Groom

/** Le Groom qui parle : une bulle et une pose (accueil, courrier, explique, bravo). */
export function Groom({ pose, children, onFermer, action }: { pose: 'accueil' | 'courrier' | 'explique' | 'bravo'; children: ReactNode; onFermer: () => void; action?: ReactNode }) {
  return (
    <div className="voile ht-groom-voile" role="dialog" aria-modal="true" onClick={onFermer}>
      <div className="ht-groom" onClick={(e) => e.stopPropagation()}>
        <img className={`ht-groom-image pose-${pose}`} src={`/cartes/groom-${pose}.webp`} alt={tr('Le Groom', 'The Bellboy')} />
        <div className="ht-bulle">
          {children}
          <div className="ht-bulle-boutons">
            {action}
            <button type="button" className={action ? '' : 'principal'} onClick={onFermer}>
              {action ? tr('Plus tard', 'Later') : tr('Merci !', 'Thanks!')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const CLE_ACCUEIL = 'baron-groom-accueil';
/** Le premier passage à l'hôtel : le Groom accueille le joueur (une fois par téléphone). */
/** Le cadeau de bienvenue du compte, remis par le Groom à la première entrée au salon. */
export function CadeauBienvenue({ cadeau, onFermer }: { cadeau: CadeauSemaine; onFermer: () => void }) {
  return (
    <Groom pose="bravo" onFermer={onFermer}>
      <strong>{tr('Bienvenue parmi les membres !', 'Welcome among the members!')}</strong>
      <p>{tr('Le Baron t’offre ton cadeau de bienvenue :', 'The Baron offers you your welcome gift:')}</p>
      <Gain c={cadeau} />
      <button type="button" className="principal" onClick={onFermer}>
        {tr('Merci, Baron !', 'Thank you, Baron!')}
      </button>
    </Groom>
  );
}

export function AccueilGroom() {
  const [ouvert, setOuvert] = useState(() => {
    try {
      return !localStorage.getItem(CLE_ACCUEIL);
    } catch {
      return false;
    }
  });
  if (!ouvert) return null;
  const fermer = () => {
    try {
      localStorage.setItem(CLE_ACCUEIL, '1');
    } catch {
      /* stockage indisponible : il reviendra la prochaine fois */
    }
    setOuvert(false);
  };
  return (
    <Groom pose="accueil" onFermer={fermer}>
      <strong>{tr('Bienvenue au Grand Hôtel du Baron !', 'Welcome to the Baron’s Grand Hotel!')}</strong>
      <p>
        {tr(
          'Je suis le Groom. Chaque étage a ses jeux : le bar et ses machines au rez-de-chaussée, les tables au 1er, les spectacles au 2e, et tout en haut le Penthouse. Les étages s’ouvrent avec ton niveau.',
          'I’m the Bellboy. Each floor has its games: the bar and its slots on the ground floor, the tables on the 1st, the shows on the 2nd, and the Penthouse at the top. Floors open as you level up.',
        )}
      </p>
    </Groom>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// L'hôtel en coupe

export function HotelVue({ vue, onEtage }: { vue: VueCasino; onEtage: (e: Etage) => void }) {
  const niveau = vue.hotel?.niveau ?? 1;
  const [choisi, setChoisi] = useState<Etage | null>(null);
  const monter = (e: Etage) => {
    setChoisi(e);
    jouerEffet('clic');
    window.setTimeout(() => {
      setChoisi(null);
      onEtage(e);
    }, 450);
  };
  return (
    <section className="ht-hotel">
      <h2>{tr('Le Grand Hôtel du Baron', 'The Baron’s Grand Hotel')}</h2>
      <div className="ht-coupe">
        <img src="/cartes/hotel-hall.webp" alt="" draggable={false} />
        {ETAGES.map((e) => {
          const ouvert = etageOuvert(niveau, e.id);
          return (
            <button
              key={e.id}
              type="button"
              className={`ht-zone ${ouvert ? '' : 'fermee'} ${choisi === e.id ? 'choisie' : ''}`}
              style={{ top: `${ZONES[e.id].top}%`, height: `${ZONES[e.id].height}%` } as CSSProperties}
              onClick={() => monter(e.id)}
              aria-label={`${tr(...e.numero)} · ${tr(...e.nom)}${ouvert ? '' : ` · ${tr(`niveau ${e.niveau}`, `level ${e.niveau}`)}`}`}
            >
              {!ouvert && <span className="ht-cadenas">🔒 {tr(`Niv. ${e.niveau}`, `Lvl ${e.niveau}`)}</span>}
            </button>
          );
        })}
      </div>
      <ol className="ht-ascenseur">
        {[...ETAGES].reverse().map((e) => {
          const ouvert = etageOuvert(niveau, e.id);
          return (
            <li key={e.id}>
              <button type="button" className={`ht-etage ${ouvert ? '' : 'fermee'}`} onClick={() => monter(e.id)}>
                <img src={e.image} alt="" />
                <span>
                  <small>{tr(...e.numero)}</small>
                  <strong>{tr(...e.nom)}</strong>
                  <small>{ouvert ? (e.jeux.length ? tr(`${e.jeux.length} jeux`, `${e.jeux.length} games`) : tr('Salon VIP', 'VIP lounge')) : tr(`Ouvre au niveau ${e.niveau}`, `Opens at level ${e.niveau}`)}</small>
                </span>
                <b aria-hidden="true">{ouvert ? '›' : '🔒'}</b>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Un étage fermé : le Groom explique. */
export function EtageFerme({ id, niveau, onFermer }: { id: Etage; niveau: number; onFermer: () => void }) {
  const e = ETAGES.find((x) => x.id === id)!;
  return (
    <Groom pose="explique" onFermer={onFermer}>
      <strong>{tr(`${tr(...e.nom)} : ouverture au niveau ${e.niveau}`, `${tr(...e.nom)}: opens at level ${e.niveau}`)}</strong>
      <p>
        {tr(
          `Désolé, cet étage est réservé aux membres de niveau ${e.niveau}. Tu es au niveau ${niveau} : encore ${e.niveau - niveau} niveau${e.niveau - niveau > 1 ? 'x' : ''}, et je t’y emmène !`,
          `Sorry, this floor is for level ${e.niveau} members. You’re level ${niveau}: ${e.niveau - niveau} more level${e.niveau - niveau > 1 ? 's' : ''} and I’ll take you up!`,
        )}
      </p>
    </Groom>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// La carte de membre

export function CarteDeMembre({ vue }: { vue: VueCasino }) {
  const [ouverte, setOuverte] = useState(false);
  if (!vue.hotel) return null;
  const niveau = vue.hotel.niveau;
  const c = carteMembre(niveau);
  const suivante = carteSuivante(niveau);
  const avantages = (id: string): string[] => {
    const carte = CARTES_MEMBRE.find((x) => x.id === id)!;
    const l = [tr(`Roulette du salon ×${String(carte.roue).replace('.', ',')}`, `Lounge wheel ×${carte.roue}`)];
    if (carte.niveau >= 40) l.push(tr('Accès au Penthouse', 'Penthouse access'));
    if (id === 'noire') l.push(tr('Ristourne du Baron : 5 % des pertes de la semaine rendues le lundi', 'Baron’s Rebate: 5% of the week’s losses back on Monday'));
    return l;
  };
  return (
    <>
      <button type="button" className="ht-carte-bouton" onClick={() => setOuverte(true)} aria-label={tr(...c.nom)}>
        <img src={`/cartes/carte-membre-${c.id}.webp`} alt="" />
      </button>
      {ouverte &&
        // Dans le corps de la page : la barre du haut (où est la carte) ne doit pas enfermer la fenêtre.
        createPortal(
        <div className="voile" role="dialog" aria-modal="true" onClick={() => setOuverte(false)}>
          <div className="fenetre ht-carte-fenetre" onClick={(e) => e.stopPropagation()}>
            <img className="ht-carte-grande" src={`/cartes/carte-membre-${c.id}.webp`} alt={tr(...c.nom)} />
            <h2>{tr(...c.nom)}</h2>
            <ul>
              {avantages(c.id).map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
            {suivante && (
              <p className="discret">
                {tr(`Au niveau ${suivante.niveau}, ta carte devient ${tr(...suivante.nom).toLowerCase()} :`, `At level ${suivante.niveau}, your card becomes ${tr(...suivante.nom)}:`)} {avantages(suivante.id).join(' · ')}
              </p>
            )}
            <button type="button" className="principal" onClick={() => setOuverte(false)}>
              {tr('Fermer', 'Close')}
            </button>
          </div>
        </div>,
          document.body,
        )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// La Semaine du Baron

const JOURS: [string, string][] = [
  ['Lundi', 'Monday'],
  ['Mardi', 'Tuesday'],
  ['Mercredi', 'Wednesday'],
  ['Jeudi', 'Thursday'],
  ['Vendredi', 'Friday'],
  ['Samedi', 'Saturday'],
  ['Dimanche', 'Sunday'],
];
/** Les 7 cases du calendrier (semaine-fond.webp, en % de l'image). */
const CASES_CALENDRIER: { left: number; top: number; width: number; height: number }[] = [
  { left: 11.9, top: 27.7, width: 18.9, height: 15.3 },
  { left: 32.2, top: 27.7, width: 18.8, height: 15.3 },
  { left: 52.4, top: 27.7, width: 18.7, height: 15.3 },
  { left: 72.6, top: 27.7, width: 17.7, height: 15.3 },
  { left: 15.6, top: 48.5, width: 22.7, height: 15.3 },
  { left: 40.2, top: 48.5, width: 22.8, height: 15.3 },
  { left: 64.9, top: 48.5, width: 22.7, height: 15.3 },
];

function Gain({ c }: { c: CadeauSemaine }) {
  return (
    <span className="ht-gain">
      <Rubis n={c.rubis} taille={16} /> <span>+{dollars(c.dollars)}</span>
    </span>
  );
}

export function BandeauSemaine({ vue, onOuvrir }: { vue: VueCasino; onOuvrir: () => void }) {
  const s = vue.hotel?.semaine;
  if (!s) return null;
  return (
    <button type="button" className={`ht-bandeau ht-semaine ${s.cadeau ? 'pret' : ''}`} onClick={onOuvrir}>
      <img src="/cartes/telegramme.webp" alt="" />
      <span>
        <strong>{tr('La Semaine du Baron', 'The Baron’s Week')}</strong>
        <small>{s.cadeau ? tr('Un télégramme t’attend !', 'A telegram awaits you!') : tr(`${s.pris.length}/7 cette semaine · reviens demain`, `${s.pris.length}/7 this week · come back tomorrow`)}</small>
      </span>
      {s.cadeau && <span className="pastille-nombre">1</span>}
    </button>
  );
}

export function FenetreSemaine({ vue, appel, onVue, onFermer }: { vue: VueCasino; appel: Appel; onVue: (v: VueCasino) => void; onFermer: () => void }) {
  const s = vue.hotel?.semaine;
  const [recu, setRecu] = useState<{ cadeau: CadeauSemaine; jour: number } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  if (!s) return null;
  const ouvrir = async () => {
    setOccupe(true);
    const r = (await appel('casino_semaine')) as { ok: boolean; erreur?: string; cadeau?: CadeauSemaine; jour?: number; casino?: VueCasino };
    setOccupe(false);
    if (r.casino) onVue(r.casino);
    if (!r.ok || !r.cadeau) return setErreur(r.erreur ?? tr('Télégramme indisponible.', 'Telegram unavailable.'));
    setRecu({ cadeau: r.cadeau, jour: r.jour ?? s.jour });
    jouerEffet(r.jour === 6 ? 'roulette_gros_lot' : 'machine_pieces');
  };
  return (
    <div className="voile" role="dialog" aria-modal="true" aria-label={tr('La Semaine du Baron', 'The Baron’s Week')} onClick={onFermer}>
      <div className="ht-semaine-fenetre" onClick={(e) => e.stopPropagation()}>
        <div className="ht-calendrier">
          <img src="/cartes/semaine-fond.webp" alt="" />
          {CASES_CALENDRIER.map((c, j) => {
            const pris = s.pris.includes(j);
            const auj = j === s.jour;
            return (
              <span
                key={j}
                className={`ht-case ${pris ? 'prise' : ''} ${auj ? 'aujourdhui' : ''} ${j < s.jour && !pris ? 'manquee' : ''}`}
                style={{ left: `${c.left}%`, top: `${c.top}%`, width: `${c.width}%`, height: `${c.height}%` } as CSSProperties}
                aria-label={`${tr(...JOURS[j])}${pris ? ` : ${tr('pris', 'claimed')}` : ''}`}
              >
                {j === 6 ? <img src="/cartes/coffre-jour7.webp" alt="" /> : pris ? <b>✓</b> : <img src="/cartes/telegramme.webp" alt="" />}
              </span>
            );
          })}
        </div>
        <div className="ht-semaine-bas">
          {recu ? (
            <>
              <strong>{recu.jour === 6 ? tr('Le coffre du dimanche !', 'The Sunday chest!') : tr(`Télégramme du ${tr(...JOURS[recu.jour]).toLowerCase()}`, `${tr(...JOURS[recu.jour])}’s telegram`)}</strong>
              <Gain c={recu.cadeau} />
            </>
          ) : s.cadeau ? (
            <>
              <img className="ht-groom-mini" src="/cartes/groom-courrier.webp" alt="" />
              <span>
                <strong>{s.jour === 6 ? tr('Le coffre du dimanche est arrivé !', 'The Sunday chest has arrived!') : tr('Un télégramme pour toi !', 'A telegram for you!')}</strong>
                <Gain c={s.cadeau} />
              </span>
              <button type="button" className="principal" disabled={occupe} onClick={() => void ouvrir()}>
                {tr('Ouvrir', 'Open')}
              </button>
            </>
          ) : (
            <p className="discret">{tr('Le télégramme du jour est ouvert. Reviens demain !', 'Today’s telegram is open. Come back tomorrow!')}</p>
          )}
          {erreur && <p className="cas-erreur">{erreur}</p>}
          <p className="discret ht-semaine-regle">
            {tr(
              `Un télégramme par jour, du lundi au dimanche. Le dimanche, le coffre vaut ${COFFRE_COMPLET.rubis} rubis si tu as ouvert les six autres.`,
              `One telegram a day, Monday to Sunday. On Sunday, the chest is worth ${COFFRE_COMPLET.rubis} rubies if you opened the other six.`,
            )}
          </p>
          <button type="button" onClick={onFermer}>
            {tr('Fermer', 'Close')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// La happy hour

export function BandeauHappyHour({ vue }: { vue: VueCasino }) {
  const h = vue.hotel?.happyHour;
  const [maintenant, setMaintenant] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setMaintenant(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const avant = useAttente(h?.debut);
  const pendant = useAttente(h?.fin);
  if (!h) return null;
  const enCours = maintenant >= h.debut && maintenant < h.fin;
  if (!enCours && h.debut - maintenant > 3 * 3_600_000) return null;
  return (
    <div className={`ht-bandeau ht-happy ${enCours ? 'en-cours' : ''}`} role="status">
      <span className="ht-happy-x2">×2</span>
      <span>
        <strong>{tr('Happy hour', 'Happy hour')}</strong>
        <small>{enCours ? tr(`XP doublée sur toutes les mises · encore ${pendant}`, `Double XP on every bet · ${pendant} left`) : tr(`XP doublée de 21 h à 22 h · dans ${avant}`, `Double XP from 9 to 10 pm · in ${avant}`)}</small>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Le Penthouse

export function Penthouse({ vue, appel, onVue, onVip }: { vue: VueCasino; appel: Appel; onVue: (v: VueCasino) => void; onVip?: (j: 'blackjack' | 'roulette') => void }) {
  const [recu, setRecu] = useState<CadeauSemaine | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const champagne = vue.hotel?.champagne ?? null;
  const servir = async () => {
    const r = (await appel('casino_champagne')) as { ok: boolean; erreur?: string; cadeau?: CadeauSemaine; casino?: VueCasino };
    if (r.casino) onVue(r.casino);
    if (!r.ok || !r.cadeau) return setErreur(r.erreur ?? tr('Champagne indisponible.', 'Champagne unavailable.'));
    setRecu(r.cadeau);
    jouerEffet('roulette_gain');
  };
  return (
    <div className="ht-penthouse">
      <section className="ht-champagne">
        <img src="/cartes/objet-champagne.webp" alt="" />
        <span>
          <strong>{tr('Le champagne du Penthouse', 'Penthouse champagne')}</strong>
          {recu ? <Gain c={recu} /> : champagne ? <Gain c={champagne} /> : <small>{tr('Servi aujourd’hui · reviens demain', 'Served today · come back tomorrow')}</small>}
          {erreur && <small className="cas-erreur">{erreur}</small>}
        </span>
        {champagne && !recu && (
          <button type="button" className="principal" onClick={() => void servir()}>
            {tr('Trinquer', 'Cheers')}
          </button>
        )}
      </section>
      <section className="ht-vip">
        <strong>★ {tr('Les tables VIP', 'The VIP tables')}</strong>
        <p className="discret">{tr('Blackjack et roulette aux mises dix fois plus hautes, entre membres du Penthouse.', 'Blackjack and roulette with ten times higher stakes, among Penthouse members.')}</p>
        <div className="ht-vip-boutons">
          <button type="button" className="ht-vip-table" onClick={() => onVip?.('blackjack')}>
            <img src="/cartes/casino-blackjack.webp" alt="" />
            <span>Blackjack VIP</span>
          </button>
          <button type="button" className="ht-vip-table" onClick={() => onVip?.('roulette')}>
            <img src="/cartes/casino-roulette.webp" alt="" />
            <span>{tr('Roulette VIP', 'VIP Roulette')}</span>
          </button>
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Les annonces : la Ristourne du lundi

export function AnnoncesHotel({ onAnnonce }: { onAnnonce: () => void }) {
  const [a, setA] = useState<AnnonceHotel | null>(null);
  useEffect(() => {
    const sur = (x: AnnonceHotel) => {
      setA(x);
      jouerEffet('machine_pieces');
      onAnnonce();
    };
    socket.on('casino_hotel', sur);
    return () => {
      socket.off('casino_hotel', sur);
    };
  }, [onAnnonce]);
  if (!a) return null;
  return (
    <Groom pose="bravo" onFermer={() => setA(null)}>
      <strong>{tr('La Ristourne du Baron', 'The Baron’s Rebate')}</strong>
      <p>
        {tr(`Membre noir : le Baron te rend 5 % de tes pertes de la semaine dernière, soit ${dollars(a.montant)}.`, `Black member: the Baron returns 5% of last week’s losses, that’s ${dollars(a.montant)}.`)}
      </p>
    </Groom>
  );
}

export { nomEtage };
