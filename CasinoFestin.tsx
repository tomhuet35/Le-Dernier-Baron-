/**
 * Le Festin du Baron : 25 cloches d'argent sur la table du banquet. Sous chacune, un poulet rôti… ou les os que le
 * Baron a laissés. On choisit sa mise et le nombre d'os, on soulève les cloches : chaque poulet fait monter le
 * multiplicateur, un os fait tout perdre. On encaisse quand on veut. Le serveur place les os et tient la partie ;
 * l'écran ne voit le contenu d'une cloche qu'une fois soulevée.
 *
 * Visuels facultatifs (sinon, les dessins ci-dessous) : festin-cloche.webp, festin-poulet.webp, festin-os.webp
 * (fond vert retiré) et festin-table.webp (la nappe du banquet).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { MULTIPLE_GROS_GAIN, type VueCasino } from '../../shared/casino';
import { CASES_FESTIN, echelleFestin, MISES_FESTIN, OS_MAX, OS_MIN, OS_RAPIDES, type VueFestin } from '../../shared/festin';
import type { Appel } from './App';
import { dollars, Jeton, LINGOTS_PALIER, PluieLingots, useSoldeAnime } from './casinoOutils';
import { tr } from './traduction';
import { jouerEffet, mouvementReduit, useCompteur } from './ui';
import './festin.css';

const x2 = (x: number) => `×${x.toLocaleString(tr('fr-FR', 'en-US'), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const CLE_REGLAGES = 'ldb-festin';

function lireReglages(): { mise: number; os: number } {
  try {
    const r = JSON.parse(localStorage.getItem(CLE_REGLAGES) ?? '{}') as { mise?: number; os?: number };
    return { mise: MISES_FESTIN.includes(r.mise ?? 0) ? r.mise! : 10_000, os: Number.isInteger(r.os) && r.os! >= OS_MIN && r.os! <= OS_MAX ? r.os! : 3 };
  } catch {
    return { mise: 10_000, os: 3 };
  }
}

/** Une image du jeu est-elle en ligne ? (null : on ne sait pas encore). */
function useImage(src: string): boolean | null {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    let vivant = true;
    const i = new Image();
    i.onload = () => vivant && setOk(true);
    i.onerror = () => vivant && setOk(false);
    i.src = src;
    return () => {
      vivant = false;
    };
  }, [src]);
  return ok;
}

// ---------------------------------------------------------------------------------------------------------------
// Les dessins du banquet

/** Les dégradés communs (définis une fois dans la page). */
function Degrades() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <linearGradient id="fe-argent" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#8d9097" />
          <stop offset="0.18" stopColor="#f4f5f7" />
          <stop offset="0.38" stopColor="#c9ccd2" />
          <stop offset="0.7" stopColor="#7d8189" />
          <stop offset="1" stopColor="#3d4047" />
        </linearGradient>
        <radialGradient id="fe-reflet" cx="30%" cy="28%" r="55%">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="0.35" stopColor="#ffffff" stopOpacity="0.25" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="fe-or" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff1c4" />
          <stop offset="0.45" stopColor="#e9ad5b" />
          <stop offset="1" stopColor="#7a4a12" />
        </linearGradient>
        <radialGradient id="fe-assiette" cx="50%" cy="40%" r="60%">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.7" stopColor="#efe6d6" />
          <stop offset="1" stopColor="#b9a98c" />
        </radialGradient>
        <radialGradient id="fe-roti" cx="38%" cy="30%" r="75%">
          <stop offset="0" stopColor="#ffd98a" />
          <stop offset="0.35" stopColor="#e39a3b" />
          <stop offset="0.75" stopColor="#a8571b" />
          <stop offset="1" stopColor="#5e2a0c" />
        </radialGradient>
        <linearGradient id="fe-os" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fffaf0" />
          <stop offset="0.6" stopColor="#e8dcc2" />
          <stop offset="1" stopColor="#a8987a" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function Assiette() {
  return (
    <g>
      <ellipse cx="50" cy="80" rx="46" ry="14" fill="rgba(0,0,0,0.45)" />
      <ellipse cx="50" cy="77" rx="45" ry="14" fill="url(#fe-or)" />
      <ellipse cx="50" cy="76" rx="40" ry="11.5" fill="url(#fe-assiette)" />
      <ellipse cx="50" cy="76" rx="30" ry="8" fill="none" stroke="#d8c6a0" strokeWidth="0.8" />
    </g>
  );
}

function Poulet() {
  return (
    <g className="fe-poulet">
      <Assiette />
      {/* Garniture : persil et tomates cerises. */}
      <g>
        <ellipse cx="22" cy="74" rx="7" ry="3.2" fill="#3e7a2c" transform="rotate(-18 22 74)" />
        <ellipse cx="78" cy="74" rx="7" ry="3.2" fill="#4b8a33" transform="rotate(16 78 74)" />
        <circle cx="27" cy="77" r="3.4" fill="#c4271a" />
        <circle cx="74" cy="78" r="3.2" fill="#b3221a" />
        <circle cx="26" cy="76" r="1" fill="#ff8a7a" />
      </g>
      {/* Le corps doré. */}
      <path d="M24 70 C22 54 36 44 52 44 C68 44 80 54 77 68 C75 77 62 80 50 80 C37 80 26 78 24 70 Z" fill="url(#fe-roti)" stroke="#5e2a0c" strokeWidth="0.9" />
      <path d="M34 56 C40 50 50 48 60 50" fill="none" stroke="#ffe3a6" strokeWidth="2.2" strokeLinecap="round" opacity="0.75" />
      <path d="M40 66 C46 62 56 62 62 65" fill="none" stroke="#7a3a12" strokeWidth="1" opacity="0.5" />
      {/* Les cuisses et leurs manchettes de papier. */}
      <g>
        <path d="M30 66 C24 60 22 52 26 47 C30 43 37 47 38 54 C39 60 36 66 30 66 Z" fill="url(#fe-roti)" stroke="#5e2a0c" strokeWidth="0.8" />
        <path d="M27 48 L21 37" stroke="url(#fe-os)" strokeWidth="4" strokeLinecap="round" />
        <path d="M17.5 36 l2 -4 l2 3 l2 -4 l2 3 l2 -3 l0.5 4 Z" fill="#fffaf0" stroke="#c9b998" strokeWidth="0.5" />
      </g>
      <g>
        <path d="M70 66 C76 60 78 52 74 47 C70 43 63 47 62 54 C61 60 64 66 70 66 Z" fill="url(#fe-roti)" stroke="#5e2a0c" strokeWidth="0.8" />
        <path d="M73 48 L79 37" stroke="url(#fe-os)" strokeWidth="4" strokeLinecap="round" />
        <path d="M74.5 37 l1 -4 l2 3 l2 -4 l2 3 l2 -2 l-1 4 Z" fill="#fffaf0" stroke="#c9b998" strokeWidth="0.5" />
      </g>
      {/* La vapeur. */}
      <g className="fe-vapeur" fill="none" stroke="#fff6e4" strokeWidth="1.8" strokeLinecap="round">
        <path d="M40 40 C36 34 44 30 40 24" />
        <path d="M51 38 C47 31 55 27 51 20" />
        <path d="M62 40 C58 34 66 30 62 24" />
      </g>
    </g>
  );
}

function Os() {
  /** Un os : la tige et ses deux nœuds, cerclés de brun pour bien se lire sur l'assiette blanche. */
  const osLong = (x1: number, y1: number, x2: number, y2: number) => {
    const a = Math.atan2(y2 - y1, x2 - x1);
    const nx = -Math.sin(a) * 3.8;
    const ny = Math.cos(a) * 3.8;
    const bouts = [
      [x1, y1],
      [x2, y2],
    ];
    return (
      <g>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#5e4a2e" strokeWidth="8.4" strokeLinecap="round" />
        {bouts.map(([x, y], k) => (
          <g key={k} fill="#5e4a2e">
            <circle cx={x + nx} cy={y + ny} r="6" />
            <circle cx={x - nx} cy={y - ny} r="6" />
          </g>
        ))}
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="url(#fe-os)" strokeWidth="6" strokeLinecap="round" />
        {bouts.map(([x, y], k) => (
          <g key={k} fill="url(#fe-os)">
            <circle cx={x + nx} cy={y + ny} r="4.8" />
            <circle cx={x - nx} cy={y - ny} r="4.8" />
          </g>
        ))}
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#ffffff" strokeWidth="1.4" strokeLinecap="round" opacity="0.7" transform="translate(-0.8 -1.2)" />
      </g>
    );
  };
  const cote = (d: string, w: number) => (
    <g key={d}>
      <path d={d} stroke="#5e4a2e" strokeWidth={w + 2} />
      <path d={d} stroke="url(#fe-os)" strokeWidth={w} />
    </g>
  );
  return (
    <g className="fe-os">
      <Assiette />
      {/* Ce qu'il reste du poulet : la carcasse, et deux os croisés par-dessus. */}
      <ellipse cx="50" cy="73" rx="24" ry="5" fill="rgba(110, 70, 30, 0.25)" />
      <g fill="none" strokeLinecap="round">
        {cote('M28 73 C28 50 72 50 72 73', 4)}
        {cote('M35 73 C35 57 65 57 65 73', 3.6)}
        {cote('M42 73 C42 63 58 63 58 73', 3.2)}
        {cote('M50 52 L50 74', 3.6)}
      </g>
      {osLong(22, 68, 66, 40)}
      {osLong(78, 68, 34, 40)}
      <g fill="#b98a4a">
        <circle cx="24" cy="80" r="1.4" />
        <circle cx="70" cy="81" r="1.2" />
        <circle cx="60" cy="79" r="1" />
      </g>
    </g>
  );
}

function Cloche() {
  return (
    <g className="fe-cloche-dome">
      <path d="M11 76 C11 42 28 24 50 24 C72 24 89 42 89 76 Z" fill="url(#fe-argent)" stroke="#3d4047" strokeWidth="0.9" />
      <path d="M11 76 C11 42 28 24 50 24 C72 24 89 42 89 76 Z" fill="url(#fe-reflet)" />
      {/* Gravure Art déco : un éventail sur le dôme. */}
      <g stroke="#e9ad5b" strokeWidth="0.8" opacity="0.75" fill="none">
        <path d="M50 66 L50 34" />
        <path d="M50 66 L38 37" />
        <path d="M50 66 L62 37" />
        <path d="M50 66 L28 45" />
        <path d="M50 66 L72 45" />
        <path d="M36 66 A14 14 0 0 1 64 66" />
      </g>
      <ellipse cx="50" cy="76" rx="40" ry="5.5" fill="url(#fe-or)" stroke="#7a4a12" strokeWidth="0.7" />
      <rect x="47" y="15" width="6" height="10" rx="2" fill="url(#fe-or)" />
      <circle cx="50" cy="14" r="5.5" fill="url(#fe-or)" stroke="#7a4a12" strokeWidth="0.7" />
      <circle cx="48.3" cy="12.4" r="1.6" fill="#fff6d8" />
    </g>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Une cloche

function CaseFestin({
  i,
  contenu,
  ouverte,
  fini,
  perdante,
  attente,
  images,
  peutOuvrir,
  onOuvrir,
}: {
  i: number;
  contenu: 'poulet' | 'os' | null;
  ouverte: boolean;
  fini: boolean;
  perdante: boolean;
  attente: boolean;
  images: { cloche: boolean; poulet: boolean; os: boolean };
  peutOuvrir: boolean;
  onOuvrir: (i: number) => void;
}) {
  const devoilee = !!contenu;
  const classe = ['fe-case', devoilee ? `devoilee ${contenu}` : 'fermee', ouverte ? 'choisie' : fini && devoilee ? 'reste' : '', perdante ? 'perdante' : '', attente ? 'attente' : ''].join(' ');
  const ligne = Math.floor(i / 5);
  const colonne = i % 5;
  return (
    <button
      type="button"
      className={classe}
      style={{ '--retard': `${(ligne + colonne) * 45}ms` } as CSSProperties}
      disabled={!peutOuvrir || devoilee}
      onClick={() => onOuvrir(i)}
      aria-label={contenu === 'poulet' ? tr('Poulet', 'Chicken') : contenu === 'os' ? tr('Os', 'Bones') : tr(`Cloche ${i + 1}`, `Cloche ${i + 1}`)}
    >
      {devoilee && (
        <span className="fe-contenu">
          {contenu === 'poulet' ? (
            images.poulet ? <img src="/cartes/festin-poulet.webp" alt="" draggable={false} /> : <svg viewBox="0 0 100 100"><Poulet /></svg>
          ) : images.os ? (
            <img src="/cartes/festin-os.webp" alt="" draggable={false} />
          ) : (
            <svg viewBox="0 0 100 100">
              <Os />
            </svg>
          )}
        </span>
      )}
      <span className="fe-dome">
        {images.cloche ? (
          <img src="/cartes/festin-cloche.webp" alt="" draggable={false} />
        ) : (
          <svg viewBox="0 0 100 100">
            <Assiette />
            <Cloche />
          </svg>
        )}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// La somme encaissée, en grand

function AnnonceFestin({ montant, gros }: { montant: number; gros: boolean }) {
  const valeur = useCompteur(montant, Math.round(montant / 20), 0, gros ? 1600 : 900);
  return (
    <div className={`fe-gain ${gros ? 'gros' : ''}`} aria-live="polite">
      <span>{gros ? tr('Festin royal !', 'Royal feast!') : tr('Encaissé !', 'Cashed out!')}</span>
      <strong>+{dollars(valeur)}</strong>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// L'écran

export function JeuFestin({ vue, appel, onVue, onRetour }: { vue: VueCasino; appel: Appel; onVue: (v: VueCasino) => void; onRetour: () => void }) {
  const [partie, setPartie] = useState<VueFestin | null>(null);
  const [reglages, setReglages] = useState(lireReglages);
  const [attente, setAttente] = useState<number | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [annonce, setAnnonce] = useState<{ montant: number; gros: boolean; id: number } | null>(null);
  const [pluie, setPluie] = useState<{ n: number; id: number } | null>(null);
  /** Numéro du festin servi : les cloches repartent de zéro à chaque partie. */
  const [numero, setNumero] = useState(0);
  const minuteries = useRef<number[]>([]);
  const vueRef = useRef(vue);
  vueRef.current = vue;
  const solde = useSoldeAnime(vue.solde);
  const images = {
    cloche: useImage('/cartes/festin-cloche.webp') === true,
    poulet: useImage('/cartes/festin-poulet.webp') === true,
    os: useImage('/cartes/festin-os.webp') === true,
  };
  const table = useImage('/cartes/festin-table.webp') === true;
  const plusTard = (f: () => void, ms: number) => minuteries.current.push(window.setTimeout(f, ms));
  useEffect(() => () => minuteries.current.forEach((m) => window.clearTimeout(m)), []);

  // Une partie en cours attend peut-être le joueur.
  useEffect(() => {
    void appel('casino_festin_vue').then((r) => {
      const f = (r as unknown as { festin?: VueFestin | null }).festin;
      if (r.ok && f?.etat === 'enCours') setPartie(f);
    });
  }, [appel]);

  useEffect(() => {
    try {
      localStorage.setItem(CLE_REGLAGES, JSON.stringify(reglages));
    } catch {
      /* préférence non gardée */
    }
  }, [reglages]);

  const enCours = partie?.etat === 'enCours';
  const fini = !!partie && !enCours;
  const os = enCours || fini ? partie!.os : reglages.os;
  const echelle = useMemo(() => echelleFestin(os), [os]);
  const majSolde = (s: unknown) => {
    if (typeof s === 'number') onVue({ ...vueRef.current, solde: s, festin: { enCours: false } });
  };

  const fin = (f: VueFestin) => {
    if (f.etat === 'perdu') {
      jouerEffet('echec');
      return;
    }
    const gros = f.gain >= MULTIPLE_GROS_GAIN * f.mise || f.gain >= 1_000_000;
    jouerEffet(gros ? 'roulette_gros_lot' : 'roulette_gain');
    plusTard(() => jouerEffet('machine_pieces'), 200);
    setAnnonce({ montant: f.gain, gros, id: Date.now() });
    plusTard(() => setAnnonce(null), gros ? 3600 : 2400);
    if (gros && !mouvementReduit()) {
      setPluie({ n: f.gain >= 50 * MULTIPLE_GROS_GAIN * f.mise ? LINGOTS_PALIER.colossal : LINGOTS_PALIER.enorme, id: Date.now() });
      plusTard(() => jouerEffet('lingots_pluie'), 250);
      plusTard(() => setPluie(null), 3800);
    }
  };

  const servir = async () => {
    if (envoi) return;
    if (reglages.mise > vue.solde) return setErreur(tr('Solde insuffisant pour cette mise.', 'Not enough money for this bet.'));
    setEnvoi(true);
    setErreur(null);
    setAnnonce(null);
    const r = await appel('casino_festin_servir', reglages);
    setEnvoi(false);
    if (!r.ok) return setErreur(r.erreur ?? tr('Action impossible.', 'Action not allowed.'));
    const x = r as unknown as { festin: VueFestin; solde: number };
    jouerEffet('jeton');
    setNumero((n) => n + 1);
    setPartie(x.festin);
    onVue({ ...vueRef.current, solde: x.solde, festin: { enCours: true } });
  };

  const ouvrir = async (i: number) => {
    if (!enCours || attente !== null) return;
    setAttente(i);
    setErreur(null);
    jouerEffet('tic');
    const r = await appel('casino_festin_ouvrir', { index: i });
    // La cloche se soulève un peu avant de montrer ce qu'il y a dessous.
    await new Promise((ok) => window.setTimeout(ok, mouvementReduit() ? 0 : 260));
    setAttente(null);
    if (!r.ok) return setErreur(r.erreur ?? tr('Action impossible.', 'Action not allowed.'));
    const x = r as unknown as { festin: VueFestin; solde: number };
    setPartie(x.festin);
    if (x.festin.cloches[i] === 'poulet') jouerEffet('reussite');
    if (x.festin.etat !== 'enCours') {
      majSolde(x.solde);
      fin(x.festin);
    }
  };

  const auHasard = () => {
    if (!partie) return;
    const fermees = partie.cloches.map((c, i) => (c === null ? i : -1)).filter((i) => i >= 0);
    if (fermees.length) void ouvrir(fermees[Math.floor(Math.random() * fermees.length)]);
  };

  const encaisser = async () => {
    if (!enCours || envoi || attente !== null) return;
    setEnvoi(true);
    const r = await appel('casino_festin_encaisser');
    setEnvoi(false);
    if (!r.ok) return setErreur(r.erreur ?? tr('Action impossible.', 'Action not allowed.'));
    const x = r as unknown as { festin: VueFestin; solde: number };
    setPartie(x.festin);
    majSolde(x.solde);
    fin(x.festin);
  };

  const changerMise = (d: number) => {
    const i = MISES_FESTIN.indexOf(reglages.mise) + d;
    if (i < 0 || i >= MISES_FESTIN.length) return;
    jouerEffet('jeton');
    setReglages((r) => ({ ...r, mise: MISES_FESTIN[i] }));
  };
  const changerOs = (n: number) => {
    const v = Math.min(OS_MAX, Math.max(OS_MIN, n));
    if (v === reglages.os) return;
    jouerEffet('selection');
    setReglages((r) => ({ ...r, os: v }));
  };

  // L'échelle des multiplicateurs suit la partie (le prochain palier reste au centre).
  const bande = useRef<HTMLOListElement>(null);
  const atteint = partie && (enCours || fini) ? partie.poulets : 0;
  useLayoutEffect(() => {
    const b = bande.current;
    const cible = b?.children[Math.min(echelle.length - 1, atteint)] as HTMLElement | undefined;
    if (b && cible) b.scrollTo({ left: cible.offsetLeft - b.clientWidth / 2 + cible.clientWidth / 2, behavior: mouvementReduit() ? 'auto' : 'smooth' });
  }, [atteint, echelle]);

  const cloches = partie && (enCours || fini) ? partie.cloches : Array<null>(CASES_FESTIN).fill(null);
  const peutOuvrir = enCours && attente === null && !envoi;
  const message = !partie
    ? tr('Choisis ta mise et le nombre d’os, puis fais servir le festin.', 'Pick your bet and the number of bones, then serve the feast.')
    : enCours
      ? partie.poulets
        ? tr(`${partie.poulets} poulet${partie.poulets > 1 ? 's' : ''} ! Encore une cloche… ou tu encaisses ?`, `${partie.poulets} chicken${partie.poulets > 1 ? 's' : ''}! One more cloche… or cash out?`)
        : tr('Soulève une cloche : un poulet, ou les os du Baron ?', 'Lift a cloche: a chicken, or the Baron’s bones?')
      : partie.etat === 'perdu'
        ? tr('Des os ! Le Baron a tout mangé…', 'Bones! The Baron ate everything…')
        : tr(`Festin encaissé : ${dollars(partie.gain)} !`, `Feast cashed out: ${dollars(partie.gain)}!`);

  return (
    <div className={`cas-ecran fe-ecran ${enCours ? 'en-cours' : ''}`} data-etat={partie?.etat ?? 'pret'}>
      <Degrades />
      <header className="cas-barre">
        <button type="button" className="cas-retour" onClick={onRetour}>
          ‹ {tr('Salon', 'Lounge')}
        </button>
        <h1 className="fe-titre">
          <span>{tr('Le Festin', 'The Baron’s')}</span> <span>{tr('du Baron', 'Feast')}</span>
        </h1>
        <span className="cas-solde-petit">{dollars(solde)}</span>
      </header>

      <section className={`fe-table ${table ? 'decor' : ''}`}>
        <div className="fe-grille" role="group" aria-label={tr('Les cloches du banquet', 'The banquet cloches')}>
          {cloches.map((c, i) => (
            <CaseFestin
              key={`${numero}-${i}`}
              i={i}
              contenu={c}
              ouverte={!!partie?.ouvertes.includes(i)}
              fini={fini}
              perdante={partie?.perdante === i}
              attente={attente === i}
              images={images}
              peutOuvrir={peutOuvrir}
              onOuvrir={(k) => void ouvrir(k)}
            />
          ))}
        </div>
      </section>

      <section className="fe-commandes" aria-label={tr('Ta partie', 'Your game')}>
        <div className="fe-compteur">
          <div>
            <small>{tr('Multiplicateur', 'Multiplier')}</small>
            <strong className={enCours && partie!.poulets ? 'monte' : ''} key={`x${partie?.poulets ?? 0}`}>
              {x2(partie && (enCours || partie.etat === 'encaisse') ? partie.x : 1)}
            </strong>
          </div>
          <div>
            <small>{tr('Prochain poulet', 'Next chicken')}</small>
            <strong className="suivant">{enCours ? (partie!.suivant ? x2(partie!.suivant) : '—') : x2(echelle[0])}</strong>
          </div>
          <div>
            <small>{tr('Os sur la table', 'Bones on the table')}</small>
            <strong className="os">{os}</strong>
          </div>
        </div>

        <ol className="fe-echelle" ref={bande} aria-label={tr('Les multiplicateurs', 'Multipliers')}>
          {echelle.map((x, k) => (
            <li key={k} className={k < atteint ? 'atteint' : k === atteint && enCours ? 'prochain' : ''}>
              <small>{k + 1}</small>
              {x2(x)}
            </li>
          ))}
        </ol>

        <p className={`fe-message ${partie?.etat ?? ''}`} role="status">
          {message}
        </p>

        {enCours ? (
          <div className="fe-actions">
            <button type="button" className="fe-encaisser" onClick={() => void encaisser()} disabled={!partie!.poulets || envoi || attente !== null}>
              <span>{tr('Encaisser', 'Cash out')}</span>
              <strong>{dollars(partie!.gain || partie!.mise)}</strong>
            </button>
            <button type="button" className="fe-hasard" onClick={auHasard} disabled={!peutOuvrir}>
              {tr('Au hasard', 'Random')}
            </button>
            <p className="discret fe-mise-cours">
              {tr('Mise', 'Bet')} <strong>{dollars(partie!.mise)}</strong> · {tr(`${partie!.poulets} / ${CASES_FESTIN - partie!.os} poulets`, `${partie!.poulets} / ${CASES_FESTIN - partie!.os} chickens`)}
            </p>
          </div>
        ) : (
          <div className="fe-reglages">
            <div className="cas-mise" aria-label={tr('Mise', 'Bet')}>
              <button type="button" onClick={() => changerMise(-1)} disabled={reglages.mise === MISES_FESTIN[0]} aria-label={tr('Baisser la mise', 'Lower the bet')}>
                −
              </button>
              <span className="cas-mise-valeur">
                <Jeton valeur={reglages.mise} />
                <span>
                  <small>{tr('Mise', 'Bet')}</small>
                  <strong>{dollars(reglages.mise)}</strong>
                </span>
              </span>
              <button type="button" onClick={() => changerMise(1)} disabled={reglages.mise === MISES_FESTIN[MISES_FESTIN.length - 1]} aria-label={tr('Augmenter la mise', 'Raise the bet')}>
                +
              </button>
            </div>
            <div className="fe-choix-os" role="group" aria-label={tr('Nombre d’os', 'Number of bones')}>
              <span className="fe-choix-os-titre">
                <svg viewBox="0 0 100 100" aria-hidden="true">
                  <Os />
                </svg>
                {tr('Os', 'Bones')}
              </span>
              <button type="button" className="fe-pas" onClick={() => changerOs(reglages.os - 1)} disabled={reglages.os <= OS_MIN} aria-label={tr('Moins d’os', 'Fewer bones')}>
                −
              </button>
              <strong className="fe-nb-os">{reglages.os}</strong>
              <button type="button" className="fe-pas" onClick={() => changerOs(reglages.os + 1)} disabled={reglages.os >= OS_MAX} aria-label={tr('Plus d’os', 'More bones')}>
                +
              </button>
              <span className="fe-rapides">
                {OS_RAPIDES.map((n) => (
                  <button key={n} type="button" className={n === reglages.os ? 'choisi' : ''} onClick={() => changerOs(n)} aria-pressed={n === reglages.os}>
                    {n}
                  </button>
                ))}
              </span>
            </div>
            <button type="button" className="cas-tourner fe-servir" onClick={() => void servir()} disabled={envoi || reglages.mise > vue.solde}>
              <span>{fini ? tr('Resservir', 'Serve again') : tr('Servir le festin', 'Serve the feast')}</span>
            </button>
          </div>
        )}
        {erreur && <p className="cas-erreur">{erreur}</p>}
        <p className="cas-mention">
          {tr(
            '25 cloches, de 1 à 24 os. Chaque poulet fait monter le multiplicateur ; un os et la mise est perdue. Mise de 1 000 à 500 000 $, jusqu’à ×25 000.',
            '25 cloches, 1 to 24 bones. Each chicken raises the multiplier; one bone and the bet is lost. Bets from $1,000 to $500,000, up to ×25,000.',
          )}
        </p>
      </section>

      {pluie && <PluieLingots key={pluie.id} n={pluie.n} />}
      {annonce && <AnnonceFestin key={annonce.id} montant={annonce.montant} gros={annonce.gros} />}
    </div>
  );
}

/** Le dessin du festin (cloche soulevée sur un poulet), pour l'aperçu du salon tant qu'il n'a pas d'image. */
export function DessinFestin() {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <Degrades />
      <Poulet />
      <g transform="translate(0 -26) rotate(-14 50 50)">
        <Cloche />
      </g>
    </svg>
  );
}
