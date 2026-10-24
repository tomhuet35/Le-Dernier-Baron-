/**
 * Langue de l'interface : celle du téléphone au premier lancement (français si le téléphone est en français,
 * anglais sinon), puis celle choisie dans les Réglages. Changer de langue recharge la page.
 */
import { estLangue, titreNiveauTr, type Langue } from '../../shared/langue';

export type { Langue };
const CLE = 'ldb-langue';

function detecter(): Langue {
  try {
    const choisie = localStorage.getItem(CLE);
    if (estLangue(choisie)) return choisie;
  } catch {
    /* stockage indisponible */
  }
  const prefs = typeof navigator === 'undefined' ? [] : navigator.languages?.length ? navigator.languages : [navigator.language];
  return (prefs[0] ?? 'fr').toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

export const LANGUE: Langue = typeof window === 'undefined' ? 'fr' : detecter();
export const EN = LANGUE === 'en';
if (typeof document !== 'undefined') document.documentElement.lang = LANGUE;

/** Le texte dans la langue du joueur. */
export const tr = (fr: string, en: string) => (EN ? en : fr);

/** « 1 victoire », « 3 victoires » / « 1 win », « 3 wins ». */
export function pluriel(n: number, fr: string, en: string, frPluriel = `${fr}s`, enPluriel = `${en}s`): string {
  // Anglais : pluriel dès que ce n'est pas 1 (0 tricks) ; français : pluriel à partir de 2 (0 pli).
  return `${n} ${EN ? (n === 1 ? en : enPluriel) : n > 1 ? frPluriel : fr}`;
}

/** Dates et nombres à la manière du pays. */
export const LOCALE = EN ? 'en-GB' : 'fr-FR';

export const titreNiveau = (n: number) => titreNiveauTr(n, LANGUE);

export function changerLangue(l: Langue) {
  if (l === LANGUE) return;
  try {
    localStorage.setItem(CLE, l);
  } catch {
    /* le choix vaudra pour cette visite seulement */
  }
  location.reload();
}
