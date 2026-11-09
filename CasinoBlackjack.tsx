/**
 * Blackjack du Salon privé : la table (croupier, sabot, 5 places en arc), les cartes dessinées dans la DA du jeu,
 * les jetons pour miser, les actions, l'assurance et un petit chat de table. Tout est décidé par le serveur ;
 * cet écran affiche la vue reçue (« casino_bj ») et envoie les choix du joueur.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { JETONS_BJ, MISE_MAX_BJ, MISE_MIN_BJ, totalMain, couleurCarte, rangCarte, type ActionBJ, type CarteBJ, type MainVueBJ, type PlaceVueBJ, type VueTableBJ } from '../../shared/blackjack';
import { formatDollars } from '../../shared/casino';
import type { Appel } from './App';
import { EN, tr } from './traduction';
import { jouerEffet } from './ui';

const dollars = (n: number) => formatDollars(n, EN);
const COULEURS = ['♠', '♥', '♦', '♣'];
const RANGS_FR = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'V', 'D', 'R'];
const RANGS_EN = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const JETON_IMAGE: Record<number, string> = { 1_000: 'ivoire', 5_000: 'rouge', 25_000: 'vert', 100_000: 'noir' };
const couleurJeton = (v: number) => (v >= 100_000 ? 'violet' : v >= 50_000 ? 'noir' : v >= 10_000 ? 'vert' : v >= 5_000 ? 'rouge' : 'ivoire');

/** Une carte, dessinée en code : fond crème, filet doré, rang et couleur dans les coins, grand motif au centre. */
export function CarteJeu({ carte, petite, className, style }: { carte: CarteBJ | null; petite?: boolean; className?: string; style?: CSSProperties }) {
  const cls = `bj-carte ${petite ? 'petite' : ''} ${className ?? ''}`;
  if (carte === null) return <img className={`${cls} dos`} src="/cartes/carte-dos-casino.webp" alt={tr('Carte cachée', 'Hidden card')} style={style} draggable={false} />;
  const r = rangCarte(carte);
  const c = couleurCarte(carte);
  const rouge = c === 1 || c === 2;
  const rang = (EN ? RANGS_EN : RANGS_FR)[r];
  const sym = COULEURS[c];
  const figure = r > 10;
  return (
    <svg className={`${cls} ${rouge ? 'rouge' : 'noire'}`} viewBox="0 0 50 70" role="img" aria-label={`${rang}${sym}`} style={style}>
      <rect x="0.6" y="0.6" width="48.8" height="68.8" rx="4.5" className="bj-carte-fond" />
      <rect x="3" y="3" width="44" height="64" rx="3" className="bj-carte-filet" />
      <text x="6.5" y="13" className="bj-carte-rang" textAnchor="middle">
        {rang}
      </text>
      <text x="6.5" y="21.5" className="bj-carte-coin" textAnchor="middle">
        {sym}
      </text>
      <g transform="rotate(180 25 35)">
        <text x="6.5" y="13" className="bj-carte-rang" textAnchor="middle">
          {rang}
        </text>
        <text x="6.5" y="21.5" className="bj-carte-coin" textAnchor="middle">
          {sym}
        </text>
      </g>
      {figure ? (
        <g>
          {/* Les figures : le Roi en baron de la pègre, la Dame en chanteuse de cabaret, le Valet en homme de main. */}
          <image href={`/cartes/figure-${r === 13 ? 'roi' : r === 12 ? 'dame' : 'valet'}.webp`} x="10.5" y="4" width="29" height="62" preserveAspectRatio="xMidYMid slice" />
          <rect x="10.5" y="4" width="29" height="62" rx="1.5" className="bj-carte-cadre-image" />
        </g>
      ) : r === 1 ? (
        <g>
          {Array.from({ length: 12 }, (_, k) => (
            <line key={k} x1="25" y1="35" x2="25" y2="20" className="bj-carte-rayon" transform={`rotate(${k * 30} 25 35)`} />
          ))}
          <text x="25" y="43" className="bj-carte-as" textAnchor="middle">
            {sym}
          </text>
        </g>
      ) : (
        <text x="25" y="42" className="bj-carte-centre" textAnchor="middle">
          {sym}
        </text>
      )}
    </svg>
  );
}

function Main({ main, petite, active, croupier }: { main: { cartes: (CarteBJ | null)[] } & Omit<Partial<MainVueBJ>, 'cartes'>; petite?: boolean; active?: boolean; croupier?: boolean }) {
  const visibles = main.cartes.filter((c): c is CarteBJ => c !== null);
  const t = visibles.length ? totalMain(visibles) : null;
  const cache = main.cartes.some((c) => c === null);
  return (
    <div className={`bj-main ${petite ? 'petite' : ''} ${active ? 'active' : ''} ${main.issue ? `issue-${main.issue}` : ''}`}>
      <div className="bj-cartes">
        {main.cartes.map((c, i) => (
          <CarteJeu key={`${i}-${c === null ? 'dos' : 'face'}`} carte={c} petite={petite} className={croupier && i === 1 && c !== null ? 'retournee' : ''} />
        ))}
      </div>
      {t && (
        <span className={`bj-total ${t.total > 21 ? 'saute' : t.total === 21 ? 'vingt-et-un' : ''}`}>
          {cache ? `${t.total}…` : t.souple && t.total < 21 && !croupier && !main.issue ? `${t.total - 10}/${t.total}` : t.total}
        </span>
      )}
      {main.issue && <Issue main={main as MainVueBJ} />}
    </div>
  );
}

function Issue({ main }: { main: MainVueBJ }) {
  const textes: Record<string, [string, string]> = {
    blackjack: ['Blackjack !', 'Blackjack!'],
    gagne: ['Gagné', 'Won'],
    egalite: ['Égalité', 'Push'],
    perdu: ['Perdu', 'Lost'],
    saute: ['Sauté', 'Bust'],
  };
  return <span className={`bj-issue ${main.issue}`}>{tr(...textes[main.issue!])}</span>;
}

/** Les places, en arc devant le croupier (5 au plus) : sur téléphone, puis sur la grande table (tablette, ordinateur). */
const POSITIONS = [
  [11, 64],
  [29, 77],
  [50, 82],
  [71, 77],
  [89, 64],
];
const POSITIONS_LARGES = [
  [17, 47],
  [32, 63],
  [50, 70],
  [68, 63],
  [83, 47],
];

function Place({ place, index, tour }: { place: PlaceVueBJ; index: number; tour: VueTableBJ['tour'] }) {
  const [x, y] = POSITIONS[index] ?? POSITIONS[2];
  const [xl, yl] = POSITIONS_LARGES[index] ?? POSITIONS_LARGES[2];
  const joue = tour?.place === place.id;
  const mise = place.mains.length ? place.mains.reduce((s, m) => s + m.mise, 0) : place.mise;
  return (
    <div className={`bj-place ${place.moi ? 'moi' : ''} ${joue ? 'joue' : ''} ${place.absent ? 'absent' : ''}`} style={{ '--x': `${x}%`, '--y': `${y}%`, '--xl': `${xl}%`, '--yl': `${yl}%` } as CSSProperties}>
      <div className="bj-place-mains">
        {place.mains.map((m, k) => (
          <Main key={k} main={m} petite active={joue && tour?.main === k} />
        ))}
      </div>
      {place.gainTotal !== null && mise > 0 ? (
        <span className={`bj-place-mise bilan ${place.gainTotal > mise ? 'gagne' : place.gainTotal < mise ? 'perdu' : ''}`}>
          {place.gainTotal > mise ? `+${dollars(place.gainTotal - mise)}` : place.gainTotal < mise ? `−${dollars(mise - place.gainTotal)}` : tr('Rendu', 'Push')}
        </span>
      ) : (
        mise > 0 && (
          <span className="bj-place-mise">
            <img src={`/cartes/jeton-${couleurJeton(mise)}.webp`} alt="" />
            {dollars(mise)}
          </span>
        )
      )}
      <span className="bj-place-joueur">
        <img src={`/cartes/avatar-${place.avatar}.webp`} alt="" />
        <span>
          {place.nom || tr('Joueur', 'Player')}
          {place.bot && <small>{tr('Bot', 'Bot')}</small>}
        </span>
      </span>
      {!place.mains.length && place.pret && place.mise > 0 && <span className="bj-place-pret">✓</span>}
    </div>
  );
}

/** Barre du temps restant (mises, assurance, décision). */
function Minuteur({ v }: { v: VueTableBJ }) {
  const [part, setPart] = useState(1);
  useEffect(() => {
    if (v.reste === null || !v.duree) return;
    const fin = Date.now() + v.reste;
    const duree = v.duree;
    let id = 0;
    const pas = () => {
      setPart(Math.max(0, (fin - Date.now()) / duree));
      id = requestAnimationFrame(pas);
    };
    id = requestAnimationFrame(pas);
    return () => cancelAnimationFrame(id);
  }, [v.reste, v.duree, v.numero, v.phase, v.tour?.place, v.tour?.main]);
  if (v.reste === null || !v.duree) return null;
  return (
    <div className="bj-minuteur" aria-hidden="true">
      <span style={{ transform: `scaleX(${part})` }} className={part < 0.25 ? 'presse' : ''} />
    </div>
  );
}

export function TableBlackjack({ v, appel, onQuitter }: { v: VueTableBJ; appel: Appel; onQuitter: () => void }) {
  const moi = v.places.find((p) => p.moi);
  const [mise, setMise] = useState(0);
  const [derniereMise, setDerniereMise] = useState(0);
  const [message, setMessage] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const precedente = useRef<VueTableBJ | null>(null);

  // Sons : cartes distribuées, sabot remélangé, mon tour, résultat de ma donne.
  useEffect(() => {
    const p = precedente.current;
    precedente.current = v;
    if (!p) return;
    const compter = (x: VueTableBJ) => x.croupier.filter((c) => c !== null).length + x.places.reduce((s, pl) => s + pl.mains.reduce((t, m) => t + m.cartes.length, 0), 0);
    const nouvelles = compter(v) - (p.numero === v.numero ? compter(p) : 0);
    if (v.melange && !p.melange) jouerEffet('melange');
    else if (nouvelles > 0) jouerEffet('carte');
    if (v.actions.length && !p.actions.length) jouerEffet('tour');
    if (v.phase === 'fin' && p.phase !== 'fin' && moi?.gainTotal !== null && moi) {
      const engage = moi.mains.reduce((s, m) => s + m.mise, 0) + moi.assurance;
      if (moi.gainTotal! > engage) jouerEffet(moi.mains.some((m) => m.issue === 'blackjack') ? 'roulette_gain' : 'machine_pieces');
      else if (moi.gainTotal! < engage && engage > 0) jouerEffet('echec');
    }
    if (v.phase === 'mises' && p.phase !== 'mises') setMise(0);
  }, [v, moi]);

  const envoyer = async (evt: string, data?: unknown) => {
    setErreur(null);
    const r = await appel(evt, data);
    if (!r.ok) setErreur(r.erreur ?? tr('Action impossible.', 'Action not allowed.'));
    return r.ok;
  };
  const ajouter = (j: number) => {
    jouerEffet('jeton');
    setMise((m) => Math.min(MISE_MAX_BJ, v.solde, m + j));
  };
  const miser = async (montant: number) => {
    if (await envoyer('casino_bj_miser', { montant })) {
      if (montant) setDerniereMise(montant);
      jouerEffet('jeton');
    }
  };
  const enJeu = moi && moi.mains.length > 0;
  const tourDe = v.tour ? v.places.find((p) => p.id === v.tour!.place) : null;
  const engage = moi ? moi.mains.reduce((s, m) => s + m.mise, 0) + moi.assurance : 0;
  const coutAction = (a: ActionBJ) => {
    if (a !== 'doubler' && a !== 'separer') return 0;
    const m = moi?.mains[v.tour?.main ?? 0];
    return m?.mise ?? 0;
  };
  const NOMS_ACTIONS: Record<ActionBJ, [string, string]> = { tirer: ['Tirer', 'Hit'], rester: ['Rester', 'Stand'], doubler: ['Doubler', 'Double'], separer: ['Séparer', 'Split'] };

  return (
    <div className="cas-ecran bj-ecran">
      <header className="cas-barre">
        <button type="button" className="cas-retour" onClick={onQuitter}>
          ‹ {tr('Salon', 'Lounge')}
        </button>
        <span className="bj-code">
          {tr('Table', 'Table')} {v.code}
        </span>
        <span className="cas-solde-petit">{dollars(v.solde)}</span>
      </header>

      <div className="bj-table">
        <div className="bj-croupier">
          <span className="bj-croupier-nom">
            <img src="/cartes/croupiere-blackjack.webp" alt="" />
            {tr('La croupière', 'The dealer')}
          </span>
          {v.croupier.length > 0 ? <Main main={{ cartes: v.croupier }} croupier /> : <div className="bj-croupier-vide" />}
        </div>
        <div className="bj-sabot" title={tr(`${v.sabot} cartes dans le sabot`, `${v.sabot} cards in the shoe`)}>
          <img src="/cartes/sabot-blackjack.webp" alt="" />
        </div>
        <svg className="bj-arc" viewBox="0 0 400 200" aria-hidden="true">
          <path id="bj-arc-1" d="M30 52 Q200 150 370 52" fill="none" />
          <path id="bj-arc-2" d="M58 80 Q200 172 342 80" fill="none" />
          <text>
            <textPath href="#bj-arc-1" startOffset="50%" textAnchor="middle">
              {tr('LE BLACKJACK PAIE 3 POUR 2', 'BLACKJACK PAYS 3 TO 2')}
            </textPath>
          </text>
          <text className="petit">
            <textPath href="#bj-arc-2" startOffset="50%" textAnchor="middle">
              {tr('La croupière reste sur 17 · Assurance 2 pour 1', 'Dealer stands on 17 · Insurance pays 2 to 1')}
            </textPath>
          </text>
        </svg>
        {v.places.map((p, i) => (
          <Place key={p.id} place={p} index={i} tour={v.tour} />
        ))}
      </div>

      {enJeu && (
        <div className="bj-mes-mains">
          {moi!.mains.map((m, k) => (
            <Main key={k} main={m} active={v.tour?.place === moi!.id && v.tour.main === k} />
          ))}
        </div>
      )}

      <div className="bj-commandes" role="group" aria-label={tr('Tes choix', 'Your choices')}>
        <Minuteur v={v} />
        {v.phase === 'mises' && moi && !moi.pret && (
          <>
            <div className="bj-jetons">
              {JETONS_BJ.map((j) => (
                <button key={j} type="button" className="bj-jeton" onClick={() => ajouter(j)} disabled={mise + j > MISE_MAX_BJ || mise + j > v.solde} aria-label={dollars(j)}>
                  <img src={`/cartes/jeton-${JETON_IMAGE[j]}.webp`} alt="" />
                  <span>{j >= 1000 ? `${j / 1000}k` : j}</span>
                </button>
              ))}
            </div>
            <p className="bj-mise-encours">
              {tr('Ta mise', 'Your bet')} <strong>{dollars(mise)}</strong>
            </p>
            <div className="bj-boutons">
              <button type="button" onClick={() => setMise(0)} disabled={!mise}>
                {tr('Effacer', 'Clear')}
              </button>
              {derniereMise > 0 && !mise && (
                <button type="button" onClick={() => void miser(Math.min(derniereMise, v.solde))} disabled={v.solde < MISE_MIN_BJ}>
                  {tr('Même mise', 'Same bet')}
                </button>
              )}
              <button type="button" className="bj-principal" onClick={() => void miser(mise)} disabled={mise < MISE_MIN_BJ}>
                {tr('Miser', 'Bet')}
              </button>
              <button type="button" onClick={() => void miser(0)}>
                {tr('Passer', 'Sit out')}
              </button>
            </div>
          </>
        )}
        {v.phase === 'mises' && moi?.pret && (
          <p className="bj-attente">{moi.mise ? tr(`Mise posée : ${dollars(moi.mise)}. Les autres misent…`, `Bet placed: ${dollars(moi.mise)}. Others are betting…`) : tr('Tu passes cette donne.', 'You sit out this hand.')}</p>
        )}
        {v.assurance && (
          <div className="bj-assurance">
            <p>{tr(`La croupière montre un As. Assurance pour ${dollars(Math.floor((moi?.mains[0]?.mise ?? 0) / 2))} ?`, `The dealer shows an Ace. Insurance for ${dollars(Math.floor((moi?.mains[0]?.mise ?? 0) / 2))}?`)}</p>
            <div className="bj-boutons">
              <button type="button" onClick={() => void envoyer('casino_bj_assurance', { oui: false })}>
                {tr('Non merci', 'No thanks')}
              </button>
              <button type="button" className="bj-principal" onClick={() => void envoyer('casino_bj_assurance', { oui: true })}>
                {tr('Assurer', 'Insure')}
              </button>
            </div>
          </div>
        )}
        {v.actions.length > 0 && (
          <div className="bj-actions">
            {(['tirer', 'rester', 'doubler', 'separer'] as ActionBJ[]).map((a) => (
              <button
                key={a}
                type="button"
                className={`bj-action ${a}`}
                disabled={!v.actions.includes(a) || coutAction(a) > v.solde}
                onClick={() => {
                  if (coutAction(a)) jouerEffet('jeton');
                  void envoyer('casino_bj_action', { type: a });
                }}
              >
                {tr(...NOMS_ACTIONS[a])}
                {coutAction(a) > 0 && v.actions.includes(a) && <small>+{dollars(coutAction(a))}</small>}
              </button>
            ))}
          </div>
        )}
        {v.phase === 'joueurs' && !v.actions.length && tourDe && <p className="bj-attente">{tr(`${tourDe.nom} joue…`, `${tourDe.nom} is playing…`)}</p>}
        {v.phase === 'assurance' && !v.assurance && <p className="bj-attente">{tr('Les joueurs choisissent l’assurance…', 'Players are choosing insurance…')}</p>}
        {v.phase === 'croupier' && <p className="bj-attente">{tr('La croupière joue…', 'The dealer is playing…')}</p>}
        {v.phase === 'fin' && moi && moi.gainTotal !== null && (
          <p className={`bj-bilan ${moi.gainTotal > engage ? 'gagne' : moi.gainTotal < engage ? 'perdu' : ''}`}>
            {moi.gainTotal > engage
              ? tr(`Tu gagnes ${dollars(moi.gainTotal - engage)} !`, `You win ${dollars(moi.gainTotal - engage)}!`)
              : moi.gainTotal < engage
                ? tr(`Tu perds ${dollars(engage - moi.gainTotal)}.`, `You lose ${dollars(engage - moi.gainTotal)}.`)
                : tr('Égalité : ta mise t’est rendue.', 'Push: your bet is returned.')}
          </p>
        )}
        {v.phase === 'fin' && (!moi || moi.gainTotal === null) && <p className="bj-attente">{tr('Fin de la donne.', 'End of the hand.')}</p>}
        {erreur && <p className="cas-erreur">{erreur}</p>}
      </div>

      {v.hote && (
        <div className="bj-hote">
          <span>{tr('Bots à la table', 'Bots at the table')}</span>
          <button type="button" onClick={() => void envoyer('casino_bj_bot', { ajouter: false })} disabled={!v.places.some((p) => p.bot)} aria-label={tr('Retirer un bot', 'Remove a bot')}>
            −
          </button>
          <button type="button" onClick={() => void envoyer('casino_bj_bot', { ajouter: true })} disabled={v.places.length >= 5} aria-label={tr('Ajouter un bot', 'Add a bot')}>
            +
          </button>
        </div>
      )}

      <form
        className="bj-chat"
        onSubmit={(e) => {
          e.preventDefault();
          if (!message.trim()) return;
          void envoyer('casino_bj_chat', { texte: message });
          setMessage('');
        }}
      >
        <ul>
          {v.messages.slice(-4).map((m, i) => (
            <li key={`${v.messages.length}-${i}`}>
              <strong>{m.nom}</strong> {m.texte}
            </li>
          ))}
        </ul>
        <div>
          <input value={message} onChange={(e) => setMessage(e.target.value)} maxLength={120} placeholder={tr('Message à la table…', 'Message to the table…')} aria-label={tr('Message', 'Message')} />
          <button type="submit" disabled={!message.trim()}>
            {tr('Envoyer', 'Send')}
          </button>
        </div>
      </form>
    </div>
  );
}
