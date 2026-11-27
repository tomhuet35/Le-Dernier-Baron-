/**
 * L'écran de chargement d'un jeu du casino : au premier lancement du jeu dans la visite, on charge toutes ses images,
 * sa musique et ses sons (ressourcesJeux.ts) avant de l'ouvrir, pour qu'il tourne ensuite sans à-coups. Les fois
 * suivantes, le jeu s'ouvre tout de suite.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { NOMS_JEUX_CASINO, type JeuCasino } from '../../shared/profilCasino';
import { VIGNETTES_ALBUM } from './CasinoContrats';
import { RESSOURCES_JEUX, type JeuACharger } from './ressourcesJeux';
import { tr } from './traduction';
import './chargementJeu.css';

/** Le plus court qu'on montre l'écran (pas de clignement) et le plus long qu'on attend (le jeu s'ouvre quand même). */
const DUREE_MIN_MS = 900;
const DUREE_MAX_MS = 15_000;

const NOM_DU_JEU: Record<JeuACharger, JeuCasino> = {
  machine: 'machine',
  nuits: 'nuits',
  bulles: 'machine',
  folleNuit: 'folleNuit',
  festin: 'coffres',
  couronne: 'couronne',
  chute: 'chute',
  course: 'course',
  baronWheel: 'baronWheel',
  balWheel: 'baronWheel',
  tickets: 'tickets',
  toits: 'toits',
  blackjack: 'blackjack',
  roulette: 'roulette',
};

/** Les jeux qui ont un logo dessiné : il remplace la vignette et le nom pendant le chargement. */
const LOGOS: Partial<Record<JeuACharger, [string, string]>> = {
  bulles: ['/cartes/bl-logo.webp', 'The Baron’s Bubbles'],
  folleNuit: ['/cartes/fn-logo.webp', 'La Folle Nuit'],
  baronWheel: ['/cartes/bw-logo.webp', 'Le Baron Express'],
  balWheel: ['/cartes/bal-logo.webp', 'Le Bal du Grand Hôtel'],
  machine: ['/cartes/lg-gh.webp', 'The Golden Heist'],
  blackjack: ['/cartes/lg-bj.webp', 'Blackjack'],
  roulette: ['/cartes/lg-rl.webp', 'Roulette'],
  tickets: ['/cartes/lg-tk.webp', 'Les Tickets du Baron'],
  festin: ['/cartes/lg-cf.webp', 'Les Coffres du Baron'],
  chute: ['/cartes/lg-cdc.webp', 'La Chute des Écus'],
  toits: ['/cartes/lg-tt.webp', 'Sur les toits'],
  couronne: ['/cartes/lg-cv.webp', 'Le Vol de la Couronne'],
};

const PHRASES: [string, string][] = [
  ['On prépare la table…', 'Setting up the table…'],
  ['Le croupier ajuste son nœud papillon…', 'The dealer straightens his bow tie…'],
  ['On astique les jetons…', 'Polishing the chips…'],
  ['L’orchestre attaque le premier morceau…', 'The band strikes up…'],
  ['Le Baron vous attend…', 'The Baron is waiting for you…'],
];

/** Jeux déjà chargés pendant cette visite. */
const charges = new Set<JeuACharger>();

function charger(src: string): Promise<void> {
  if (src.endsWith('.mp3')) {
    return fetch(src)
      .then((r) => r.arrayBuffer())
      .then(
        () => undefined,
        () => undefined,
      );
  }
  return new Promise((ok) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      // Décodée d'avance : pas de saccade au premier affichage.
      void img.decode?.().catch(() => undefined).then(() => ok());
      if (!img.decode) ok();
    };
    img.onerror = () => ok();
    img.src = src;
  });
}

export function ChargementJeu({ jeu, children }: { jeu: JeuACharger; children: ReactNode }) {
  const liste = RESSOURCES_JEUX[jeu];
  const [pret, setPret] = useState(() => charges.has(jeu) || liste.length === 0);
  const [faits, setFaits] = useState(0);
  const [phrase, setPhrase] = useState(0);

  useEffect(() => {
    if (pret) return;
    let fini = false;
    const debut = Date.now();
    let i = 0;
    let n = 0;
    const ouvrier = async () => {
      while (i < liste.length && !fini) {
        await charger(liste[i++]);
        if (!fini) setFaits(++n);
      }
    };
    const leLogo = LOGOS[jeu];
    if (leLogo) void charger(leLogo[0]);
    const tout = Promise.all(Array.from({ length: 6 }, ouvrier));
    const limite = new Promise((ok) => window.setTimeout(ok, DUREE_MAX_MS));
    void Promise.race([tout, limite]).then(async () => {
      const reste = DUREE_MIN_MS - (Date.now() - debut);
      if (reste > 0) await new Promise((ok) => window.setTimeout(ok, reste));
      if (fini) return;
      charges.add(jeu);
      setPret(true);
    });
    const t = window.setInterval(() => setPhrase((p) => (p + 1) % PHRASES.length), 2200);
    return () => {
      fini = true;
      window.clearInterval(t);
    };
  }, [jeu, liste, pret]);

  if (pret) return <>{children}</>;
  const id = NOM_DU_JEU[jeu];
  // Les Bulles du Baron ont leur propre affiche et leur nom (le jeu compte comme une machine à sous).
  const bulles = jeu === 'bulles';
  const logo = LOGOS[jeu];
  const part = liste.length ? Math.round((faits / liste.length) * 100) : 100;
  return (
    <div className="chj" role="status" aria-live="polite" style={bulles ? { background: "linear-gradient(180deg, rgba(10,2,4,.4), rgba(10,2,4,.85)), url('/cartes/bl-chargement.webp') center / cover no-repeat" } : undefined}>
      <div className="chj-rayons" aria-hidden="true" />
      {logo ? (
        <h1 className="chj-titre">
          <img className="chj-logo" src={logo[0]} alt={logo[1]} draggable={false} />
        </h1>
      ) : (
        <>
          <img className="chj-vignette" src={`/cartes/vignette-${VIGNETTES_ALBUM[id]}.webp`} alt="" draggable={false} />
          <h1 className="chj-nom">{tr(...NOMS_JEUX_CASINO[id])}</h1>
        </>
      )}
      <div className="chj-barre" aria-label={tr(`Chargement : ${part} %`, `Loading: ${part}%`)}>
        <span style={{ width: `${part}%` }} />
      </div>
      <p className="chj-phrase">
        {tr(...PHRASES[phrase])} <b>{part} %</b>
      </p>
    </div>
  );
}
