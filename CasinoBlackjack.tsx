/**
 * Blackjack du Salon privé : la table (croupier, sabot, 5 places en arc), les cartes dessinées dans la DA du jeu,
 * les jetons pour miser, les actions, l'assurance et un petit chat de table. Tout est décidé par le serveur ;
 * cet écran affiche la vue reçue (« casino_bj ») et envoie les choix du joueur.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { JETONS_BJ, MISE_MAX_BJ, MISE_MIN_BJ, totalMain, couleurCarte, rangCarte, type ActionBJ, type CarteBJ, type MainVueBJ, type PlaceVueBJ, type VueTableBJ } from '../../shared/blackjack';
import { formatDollars } from '../../shared/casino';
import type { Appel } from './App';
import { FenetreInviter } from './CasinoRoulette';
import { EN, tr } from './traduction';
import { jouerEffet, mouvementReduit } from './ui';
import './blackjack.css';

const dollars = (n: number) => formatDollars(n, EN);
const COULEURS = ['♠', '♥', '♦', '♣'];
const RANGS_FR = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'V', 'D', 'R'];
const RANGS_EN = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const JETON_IMAGE: Record<number, string> = { 1_000: 'jeton-bj-1k', 5_000: 'jeton-bj-5k', 25_000: 'jeton-bj-25k', 100_000: 'jeton-bj-100k' };

/** Une carte, dessinée en code : fond crème, filet doré, rang et couleur dans les coins, grand motif au centre. */
export function CarteJeu({ carte, petite, className, style }: { carte: CarteBJ | null; petite?: boolean; className?: string; style?: CSSProperties }) {
  const cls = `bj-carte ${petite ? 'petite' : ''} ${className ?? ''}`;
  if (carte === null) return <img className={`${cls} dos`} src="/cartes/carte-dos-bj.webp" alt={tr('Carte cachée', 'Hidden card')} style={style} draggable={false} />;
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
          {/* Les figures : un cadre doré, une couronne et la lettre en Art déco. */}
          <rect x="12" y="12" width="26" height="46" rx="2" className="bj-carte-cadre" />
          <path d="M17 26 L19.5 19 L22.5 24 L25 17 L27.5 24 L30.5 19 L33 26 Z" className="bj-carte-couronne" />
          <text x="25" y="44" className="bj-carte-figure" textAnchor="middle">
            {rang}
          </text>
          <text x="25" y="54" className="bj-carte-sym-petit" textAnchor="middle">
            {sym}
          </text>
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

// ---------------------------------------------------------------------------------------------------------------
// La table en perspective : trois décors (vue d'ensemble, vue zoomée sur ma place, téléphone), chacun avec les
// positions de ses cercles de mise, du rack et du sabot (en % de l'image).

type Decor = 'ensemble' | 'zoom' | 'portrait';
interface InfosDecor {
  image: string;
  ratio: number;
  /** Centres des 5 cercles de mise (x %, y %) et leur demi-hauteur (% de la hauteur). */
  places: [number, number][];
  ry: number;
  rack: { x: number; y: number; w: number };
  sabot: { x: number; y: number; w: number };
  croupier: { x: number; y: number };
  /** Largeur d'une carte (% de la largeur de la table). */
  carte: number;
  jeton: number;
}
const DECORS: Record<Decor, InfosDecor> = {
  ensemble: {
    image: '/cartes/bj-table-ensemble.webp',
    ratio: 1536 / 1024,
    places: [
      [16.6, 38.1],
      [32.1, 46.7],
      [50, 50],
      [67.9, 46.7],
      [83.3, 38.1],
    ],
    ry: 6,
    rack: { x: 50, y: 12.4, w: 34 },
    sabot: { x: 80, y: 12, w: 11 },
    croupier: { x: 50, y: 25 },
    carte: 5.2,
    jeton: 5.2,
  },
  zoom: {
    image: '/cartes/bj-table-zoom.webp',
    ratio: 1536 / 1024,
    places: [
      [-30, 40],
      [5.5, 51.3],
      [49.8, 61],
      [94.3, 51.3],
      [130, 40],
    ],
    ry: 12,
    rack: { x: 49.8, y: 9.8, w: 52 },
    sabot: { x: 86, y: 9, w: 14 },
    croupier: { x: 50, y: 23 },
    carte: 9.5,
    jeton: 10,
  },
  portrait: {
    image: '/cartes/bj-table-portrait.webp',
    ratio: 941 / 1672,
    places: [
      [10.1, 51.6],
      [28.4, 57.4],
      [50, 60.4],
      [71.5, 57.4],
      [89.8, 51.6],
    ],
    ry: 4.5,
    rack: { x: 50, y: 25.6, w: 58 },
    sabot: { x: 88, y: 23.2, w: 17 },
    croupier: { x: 50, y: 34.5 },
    carte: 9.6,
    jeton: 10,
  },
};

const CLE_ZOOM = 'bj-zoom';

/** Paysage ou portrait : suit la taille de l'écran. */
function useOrientation(): 'paysage' | 'portrait' {
  const lire = (): 'paysage' | 'portrait' => (typeof window !== 'undefined' && window.innerWidth / Math.max(1, window.innerHeight) >= 1 ? 'paysage' : 'portrait');
  const [o, setO] = useState(lire);
  useEffect(() => {
    const maj = () => setO(lire());
    window.addEventListener('resize', maj);
    return () => window.removeEventListener('resize', maj);
  }, []);
  return o;
}

/** File d'attente des cartes distribuées : elles partent du sabot l'une après l'autre. */
let prochaineDonne = 0;
/** La table (pour trouver le sabot et le rack pendant les animations). */
const sceneRef: { current: HTMLDivElement | null } = { current: null };

function centre(el: Element | null | undefined): { x: number; y: number } | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Une carte posée sur la table : elle arrive du sabot (en tournant), et se retourne si elle était cachée. */
function CarteTable({ carte }: { carte: CarteBJ | null }) {
  const el = useRef<HTMLDivElement>(null);
  const avant = useRef<CarteBJ | null | undefined>(undefined);
  useLayoutEffect(() => {
    const e = el.current;
    if (!e) return;
    if (avant.current === undefined) {
      // Première apparition : distribuée depuis le sabot.
      const s = centre(sceneRef.current?.querySelector('.bj2-sabot'));
      const c = centre(e);
      if (s && c && !mouvementReduit()) {
        const t = performance.now();
        const delai = Math.max(0, prochaineDonne - t);
        prochaineDonne = t + delai + 150;
        e.animate(
          [
            { transform: `translate(${s.x - c.x}px, ${s.y - c.y}px) rotate(-35deg) scale(0.55)`, opacity: 0.2 },
            { opacity: 1, offset: 0.2 },
            { transform: 'translate(0, 0) rotate(0deg) scale(1)', opacity: 1 },
          ],
          { duration: 480, delay: delai, easing: 'cubic-bezier(0.2, 0.75, 0.25, 1)', fill: 'backwards' },
        );
        window.setTimeout(() => jouerEffet('bj_carte', { vitesse: 0.92 + Math.random() * 0.16 }), delai);
      }
    } else if (avant.current === null && carte !== null && !mouvementReduit()) {
      // La carte cachée de la croupière se retourne.
      e.animate([{ transform: 'rotateY(90deg) scale(1.1)' }, { transform: 'rotateY(0deg) scale(1)' }], { duration: 380, easing: 'ease-out' });
    }
    avant.current = carte;
  }, [carte]);
  return (
    <div className="bj2-carte" ref={el}>
      <CarteJeu carte={carte} />
    </div>
  );
}

function Main({ main, active, croupier }: { main: { cartes: (CarteBJ | null)[] } & Omit<Partial<MainVueBJ>, 'cartes'>; active?: boolean; croupier?: boolean }) {
  const visibles = main.cartes.filter((c): c is CarteBJ => c !== null);
  const t = visibles.length ? totalMain(visibles) : null;
  const cache = main.cartes.some((c) => c === null);
  return (
    <div className={`bj-main bj2-main ${active ? 'active' : ''} ${main.issue ? `issue-${main.issue}` : ''}`}>
      <div className="bj2-cartes">
        {main.cartes.map((c, i) => (
          <CarteTable key={i} carte={c} />
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

/** Une pile de jetons (du plus gros au plus petit, 8 jetons au plus à l'écran). */
function jetonsDe(montant: number, f: number): number[] {
  const r: number[] = [];
  let reste = Math.round(montant / f);
  for (const v of [...JETONS_BJ].reverse()) {
    while (reste >= v && r.length < 8) {
      r.push(v);
      reste -= v;
    }
  }
  if (!r.length && montant > 0) r.push(JETONS_BJ[0]);
  return r.reverse();
}

/** Une pile de jetons sur la table ; `depuis` : d'où elle arrive (le joueur, le rack), `vers` : où elle part. */
function Pile({ montant, f, depuis, vers, className }: { montant: number; f: number; depuis?: 'joueur' | 'rack'; vers?: 'rack' | 'joueur'; className?: string }) {
  const el = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const e = el.current;
    if (!e || mouvementReduit()) return;
    const c = centre(e);
    const rack = centre(sceneRef.current?.querySelector('.bj2-rack'));
    if (depuis && c) {
      const d = depuis === 'rack' && rack ? { x: rack.x - c.x, y: rack.y - c.y } : { x: 0, y: window.innerHeight - c.y };
      e.animate([{ transform: `translate(${d.x}px, ${d.y}px) scale(1.3)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 520, delay: depuis === 'rack' ? 250 : 0, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)', fill: 'backwards' });
    }
    if (vers && c) {
      const d = vers === 'rack' && rack ? { x: rack.x - c.x, y: rack.y - c.y } : { x: 0, y: window.innerHeight - c.y };
      e.animate([{ transform: 'none', opacity: 1 }, { transform: `translate(${d.x}px, ${d.y}px) scale(0.7)`, opacity: 0 }], { duration: 600, delay: 650, easing: 'cubic-bezier(0.5, 0, 0.75, 0)', fill: 'forwards' });
    }
  }, [depuis, vers]);
  const jetons = jetonsDe(montant, f);
  return (
    <div className={`bj2-pile ${className ?? ''}`} ref={el} aria-label={dollars(montant)}>
      {jetons.map((j, k) => (
        <img key={k} src={`/cartes/${JETON_IMAGE[j]}.webp`} alt="" draggable={false} style={{ '--k': k } as CSSProperties} />
      ))}
    </div>
  );
}

function Place({ place, pos, tour, phase, f, decor }: { place: PlaceVueBJ; pos: [number, number]; tour: VueTableBJ['tour']; phase: VueTableBJ['phase']; f: number; decor: InfosDecor }) {
  const [x, y] = pos;
  const joue = tour?.place === place.id;
  const mise = place.mains.length ? place.mains.reduce((s, m) => s + m.mise, 0) : place.mise;
  const fin = place.gainTotal !== null && mise > 0;
  const gagne = fin && place.gainTotal! > mise;
  const perdu = fin && place.gainTotal! < mise;
  return (
    <div
      className={`bj2-place ${place.moi ? 'moi' : ''} ${joue ? 'joue' : ''} ${place.absent ? 'absent' : ''}`}
      style={{ left: `${x}%`, top: `${y}%`, '--ry': `${decor.ry}` } as CSSProperties}
    >
      <span className="bj2-halo" aria-hidden="true" />
      {mise > 0 && (place.pret || place.mains.length > 0) && <Pile key={`mise-${place.mains.length ? 'donne' : 'mise'}`} montant={mise} f={f} depuis={place.mains.length ? undefined : 'joueur'} vers={perdu ? 'rack' : undefined} className="mise" />}
      {gagne && <Pile key="gain" montant={place.gainTotal! - mise} f={f} depuis="rack" className="gain" />}
      <div className="bj2-mains">
        {place.mains.map((m, k) => (
          <Main key={k} main={m} active={joue && tour?.main === k} />
        ))}
      </div>
      {fin && (
        <span className={`bj2-bilan ${gagne ? 'gagne' : perdu ? 'perdu' : ''}`}>
          {gagne ? `+${dollars(place.gainTotal! - mise)}` : perdu ? `−${dollars(mise - place.gainTotal!)}` : tr('Rendu', 'Push')}
        </span>
      )}
      <span className="bj2-joueur">
        <img src={`/cartes/avatar-${place.avatar}.webp`} alt="" />
        <span>
          {place.nom || tr('Joueur', 'Player')}
          {place.bot && <small>{tr('Bot', 'Bot')}</small>}
        </span>
        {!place.mains.length && phase === 'mises' && place.pret && place.mise > 0 && <b className="bj2-pret">✓</b>}
      </span>
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
  const [inviter, setInviter] = useState(false);
  const precedente = useRef<VueTableBJ | null>(null);
  const orientation = useOrientation();
  const [zoom, setZoom] = useState(() => {
    try {
      return localStorage.getItem(CLE_ZOOM) === '1';
    } catch {
      return false;
    }
  });
  const basculerZoom = () =>
    setZoom((z) => {
      try {
        localStorage.setItem(CLE_ZOOM, z ? '0' : '1');
      } catch {
        /* rien */
      }
      return !z;
    });
  const monIndex = v.places.findIndex((p) => p.moi);
  // Paysage : la vue zoomée a sa propre image (ma place au centre, mes voisins sur les côtés) ; téléphone : on
  // s'approche de ma place sur la même table.
  const decorId: Decor = orientation === 'portrait' ? 'portrait' : zoom && monIndex >= 0 ? 'zoom' : 'ensemble';
  const d = DECORS[decorId];
  const zoomTel = orientation === 'portrait' && zoom && monIndex >= 0;
  const maPos = monIndex >= 0 ? d.places[monIndex] : null;
  const placesVisibles = v.places
    .map((p, i) => ({ p, pos: (decorId === 'zoom' ? DECORS.zoom.places[i - monIndex + 2] : d.places[i]) as [number, number] | undefined }))
    .filter((x): x is { p: PlaceVueBJ; pos: [number, number] } => !!x.pos && x.pos[0] > -10 && x.pos[0] < 110);

  // Sons : cartes distribuées, sabot remélangé, mon tour, résultat de ma donne.
  useEffect(() => {
    const p = precedente.current;
    precedente.current = v;
    if (!p) return;
    if (v.melange && !p.melange) jouerEffet('melange');
    if (v.actions.length && !p.actions.length) jouerEffet('bj_tour');
    if (v.phase === 'fin' && p.phase !== 'fin' && moi?.gainTotal !== null && moi) {
      const engage = moi.mains.reduce((s, m) => s + m.mise, 0) + moi.assurance;
      if (moi.gainTotal! > engage) jouerEffet(moi.mains.some((m) => m.issue === 'blackjack') ? 'bj_blackjack' : 'bj_gain');
      else if (moi.gainTotal! < engage && engage > 0) jouerEffet('bj_perdu');
    }
    if (v.phase === 'mises' && p.phase !== 'mises') setMise(0);
  }, [v, moi]);

  const envoyer = async (evt: string, data?: unknown) => {
    setErreur(null);
    const r = await appel(evt, data);
    if (!r.ok) setErreur(r.erreur ?? tr('Action impossible.', 'Action not allowed.'));
    return r.ok;
  };
  // Table VIP du Penthouse : jetons et limites multipliés par 10.
  const f = v.vip ? 10 : 1;
  const ajouter = (j: number) => {
    jouerEffet('jeton');
    setMise((m) => Math.min(MISE_MAX_BJ * f, v.solde, m + j));
  };
  const miser = async (montant: number) => {
    if (await envoyer('casino_bj_miser', { montant })) {
      if (montant) setDerniereMise(montant);
      jouerEffet('jeton');
    }
  };
  const tourDe = v.tour ? v.places.find((p) => p.id === v.tour!.place) : null;
  const engage = moi ? moi.mains.reduce((s, m) => s + m.mise, 0) + moi.assurance : 0;
  const coutAction = (a: ActionBJ) => {
    if (a !== 'doubler' && a !== 'separer') return 0;
    const m = moi?.mains[v.tour?.main ?? 0];
    return m?.mise ?? 0;
  };
  const NOMS_ACTIONS: Record<ActionBJ, [string, string]> = { tirer: ['Tirer', 'Hit'], rester: ['Rester', 'Stand'], doubler: ['Doubler', 'Double'], separer: ['Séparer', 'Split'] };

  return (
    <div className="cas-ecran bj-ecran bj2-ecran">
      <header className="cas-barre">
        <button type="button" className="cas-retour" onClick={onQuitter}>
          ‹ {tr('Salon', 'Lounge')}
        </button>
        <span className="bj-code">
          {v.vip ? '★ VIP · ' : ''}{tr('Table', 'Table')} {v.code}
        </span>
        <span className="cas-solde-petit">{dollars(v.solde)}</span>
      </header>

      <div className="bj2-zone">
        <div
          ref={(el) => {
            sceneRef.current = el;
          }}
          className={`bj2-scene decor-${decorId} ${zoomTel ? 'zoom-tel' : ''}`}
          style={
            {
              '--ratio': d.ratio,
              '--carte': `${d.carte}cqw`,
              '--jeton': `${d.jeton}cqw`,
              backgroundImage: `url('${d.image}')`,
              ...(zoomTel && maPos ? { '--ox': `${maPos[0]}%`, '--oy': `${maPos[1]}%` } : {}),
            } as CSSProperties
          }
        >
          <img className="bj2-rack" src="/cartes/bj-rack.webp" alt="" draggable={false} style={{ left: `${d.rack.x}%`, top: `${d.rack.y}%`, width: `${d.rack.w}%` }} />
          <img
            className={`bj2-sabot ${v.melange ? 'melange' : ''}`}
            src="/cartes/bj-sabot.webp"
            alt={tr(`${v.sabot} cartes dans le sabot`, `${v.sabot} cards in the shoe`)}
            draggable={false}
            style={{ left: `${d.sabot.x}%`, top: `${d.sabot.y}%`, width: `${d.sabot.w}%` }}
          />
          <div className="bj2-croupier" style={{ left: `${d.croupier.x}%`, top: `${d.croupier.y}%` }}>
            {v.croupier.length > 0 && <Main key={v.numero} main={{ cartes: v.croupier }} croupier />}
          </div>
          {placesVisibles.map(({ p, pos }) => (
            <Place key={`${p.id}-${v.numero}`} place={p} pos={pos} tour={v.tour} phase={v.phase} f={f} decor={d} />
          ))}
        </div>
        {orientation === 'paysage' || moi ? (
          <button type="button" className={`bj2-vue ${zoom ? 'actif' : ''}`} onClick={() => basculerZoom()} aria-pressed={zoom}>
            {zoom ? tr('Vue d’ensemble', 'Full table') : tr('Zoom sur ma place', 'Zoom on my seat')}
          </button>
        ) : null}
      </div>

      <div className="bj2-panneau">
      <div className="bj-commandes" role="group" aria-label={tr('Tes choix', 'Your choices')}>
        <Minuteur v={v} />
        {v.phase === 'mises' && moi && !moi.pret && (
          <>
            <div className="bj-jetons">
              {JETONS_BJ.map((base) => {
                const j = base * f;
                return (
                <button key={j} type="button" className="bj-jeton" onClick={() => ajouter(j)} disabled={mise + j > MISE_MAX_BJ * f || mise + j > v.solde} aria-label={dollars(j)}>
                  <img src={`/cartes/${JETON_IMAGE[base]}.webp`} alt="" />
                  <span>{j >= 1_000_000 ? `${j / 1_000_000}M` : j >= 1000 ? `${j / 1000}k` : j}</span>
                </button>
                );
              })}
            </div>
            <p className="bj-mise-encours">
              {tr('Ta mise', 'Your bet')} <strong>{dollars(mise)}</strong>
            </p>
            <div className="bj-boutons">
              <button type="button" onClick={() => setMise(0)} disabled={!mise}>
                {tr('Effacer', 'Clear')}
              </button>
              {derniereMise > 0 && !mise && (
                <button type="button" onClick={() => void miser(Math.min(derniereMise, v.solde))} disabled={v.solde < MISE_MIN_BJ * f}>
                  {tr('Même mise', 'Same bet')}
                </button>
              )}
              <button type="button" className="bj-principal" onClick={() => void miser(mise)} disabled={mise < MISE_MIN_BJ * f}>
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

      <div className="bj-hote">
        <button type="button" className="rl-inviter" onClick={() => setInviter(true)}>
          {tr('Inviter un ami', 'Invite a friend')}
        </button>
        {v.hote && (
          <>
            <span>{tr('Bots', 'Bots')}</span>
            <button type="button" onClick={() => void envoyer('casino_bj_bot', { ajouter: false })} disabled={!v.places.some((p) => p.bot)} aria-label={tr('Retirer un bot', 'Remove a bot')}>
              −
            </button>
            <button type="button" onClick={() => void envoyer('casino_bj_bot', { ajouter: true })} disabled={v.places.length >= 5} aria-label={tr('Ajouter un bot', 'Add a bot')}>
              +
            </button>
          </>
        )}
      </div>
      {inviter && <FenetreInviter appel={appel} onFermer={() => setInviter(false)} />}

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
    </div>
  );
}
