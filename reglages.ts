/**
 * Réglages du joueur, gardés sur ce téléphone (ou cet ordinateur) : volumes, vitesse des ordinateurs, taille des cartes, tapis en grand.
 * Aucun import ici : la musique (ui.tsx) lit ces réglages dès le chargement de la page.
 */
export type Vitesse = 'lente' | 'normale' | 'rapide';
export type TailleCartes = 'normale' | 'grande' | 'tres_grande';
/** Les animations : celles du téléphone (auto), toujours complètes, ou réduites. */
export type Animations = 'auto' | 'completes' | 'reduites';
/** Le rappel de pause (minutes de jeu d'affilée ; 0 : jamais). */
export const PAUSES = [0, 30, 60, 120] as const;
export type Pause = (typeof PAUSES)[number];

export interface Reglages {
  /** 0 à 100 */
  musique: number;
  /** 0 à 100 */
  effets: number;
  vitesse: Vitesse;
  cartes: TailleCartes;
  /** Le tapis s'agrandit pendant le pli (et revient à la vue normale au début de chaque pli). */
  zoomTapis: boolean;
  /** Le téléphone vibre quand c'est au joueur de jouer (Android ; l'iPhone ne le permet pas aux sites). */
  vibration: boolean;
  /** Salon privé : les animations, les pluies de billets et de lingots des gains, le rappel de pause. */
  animations: Animations;
  celebrations: boolean;
  pause: Pause;
}

const CLE = 'ldb-reglages';
const DEFAUT: Reglages = { musique: 100, effets: 100, vitesse: 'normale', cartes: 'normale', zoomTapis: true, vibration: true, animations: 'auto', celebrations: true, pause: 0 };
const borne = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : d);

function charger(): Reglages {
  try {
    const brut = JSON.parse(localStorage.getItem(CLE) ?? '{}') as Partial<Reglages>;
    return {
      musique: borne(brut.musique, DEFAUT.musique),
      effets: borne(brut.effets, DEFAUT.effets),
      vitesse: brut.vitesse === 'lente' || brut.vitesse === 'rapide' ? brut.vitesse : 'normale',
      cartes: brut.cartes === 'grande' || brut.cartes === 'tres_grande' ? brut.cartes : 'normale',
      zoomTapis: brut.zoomTapis !== false,
      vibration: brut.vibration !== false,
      animations: brut.animations === 'completes' || brut.animations === 'reduites' ? brut.animations : 'auto',
      celebrations: brut.celebrations !== false,
      pause: (PAUSES as readonly number[]).includes(brut.pause ?? -1) ? (brut.pause as Pause) : 0,
    };
  } catch {
    return { ...DEFAUT };
  }
}

let actuels: Reglages = typeof window === 'undefined' ? { ...DEFAUT } : charger();
const abonnes = new Set<(r: Reglages) => void>();

function appliquerTaille(r: Reglages) {
  if (typeof document === 'undefined') return;
  if (r.animations === 'auto') delete document.documentElement.dataset.animations;
  else document.documentElement.dataset.animations = r.animations;
  if (r.cartes === 'normale') delete document.documentElement.dataset.cartes;
  else document.documentElement.dataset.cartes = r.cartes;
}
appliquerTaille(actuels);

export function lireReglages(): Reglages {
  return actuels;
}

export function changerReglages(modif: Partial<Reglages>) {
  actuels = { ...actuels, ...modif };
  try {
    localStorage.setItem(CLE, JSON.stringify(actuels));
  } catch {
    /* stockage indisponible : le réglage vaut pour cette visite */
  }
  appliquerTaille(actuels);
  abonnes.forEach((f) => f(actuels));
}

export function abonnerReglages(f: (r: Reglages) => void) {
  abonnes.add(f);
  return () => {
    abonnes.delete(f);
  };
}
