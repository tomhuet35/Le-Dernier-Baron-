/**
 * Les figurants du salon : des joueurs d'ambiance pour le lancement, pour que les premiers joueurs ne soient pas seuls.
 * Ils apparaissent dans « Les plus riches du salon » et misent dans les shows en direct (Baron Express, Bal, Folle
 * Nuit). Ils ont un profil (consultable comme celui d'un joueur), mais pas de compte : ils n'acceptent aucune demande
 * d'ami (elle reste en attente), donc pas de défis ni d'envois ; leurs gains ne sont versés nulle part (aucune
 * écriture, aucune annonce, aucun record). Leur nombre baisse quand de vrais joueurs sont là.
 *
 * Les couper : la variable d'environnement FIGURANTS=0 (ils sont aussi coupés pendant les tests).
 */

import type { JeuCasino } from '../shared/profilCasino';
import { IDS_OBJETS, OBJETS, PRIX_DOLLARS, type Collection, type IdObjet } from '../shared/ventes';

export const FIGURANTS_ACTIFS = process.env.FIGURANTS !== '0' && !process.env.VITEST && process.env.NODE_ENV !== 'test';

export interface Figurant {
  uid: string;
  nom: string;
  avatar: number;
  /** Solde de départ (le classement le fait onduler doucement, jour après jour). */
  base: number;
  /** Sa grosse mise habituelle (les jetons qu'il pose tournent autour). */
  mise: number;
}

export const FIGURANTS: Figurant[] = [
  { uid: 'fig-1', nom: 'Margaux', avatar: 16, base: 2_850_000_000, mise: 2_000_000 },
  { uid: 'fig-2', nom: 'LeDuc', avatar: 17, base: 1_920_000_000, mise: 1_000_000 },
  { uid: 'fig-3', nom: 'Victoria R.', avatar: 20, base: 1_310_000_000, mise: 500_000 },
  { uid: 'fig-4', nom: 'Antoine75', avatar: 13, base: 640_000_000, mise: 250_000 },
  { uid: 'fig-5', nom: 'LadyJazz', avatar: 14, base: 415_000_000, mise: 100_000 },
  { uid: 'fig-6', nom: 'Hugo B.', avatar: 11, base: 268_000_000, mise: 100_000 },
  { uid: 'fig-7', nom: 'Camille', avatar: 12, base: 152_000_000, mise: 50_000 },
  { uid: 'fig-8', nom: 'Gatsby', avatar: 21, base: 96_000_000, mise: 50_000 },
  { uid: 'fig-9', nom: 'Rosalie', avatar: 18, base: 58_000_000, mise: 25_000 },
  { uid: 'fig-10', nom: 'Max le Flambeur', avatar: 19, base: 31_000_000, mise: 25_000 },
  { uid: 'fig-11', nom: 'Sofia', avatar: 15, base: 17_500_000, mise: 10_000 },
  { uid: 'fig-12', nom: 'Théo', avatar: 10, base: 8_200_000, mise: 5_000 },
];

export const estFigurant = (uid: string) => uid.startsWith('fig-');

const JOUR = 86_400_000;
/** Un petit hasard fixe par figurant (sa « personnalité » : rythme et ampleur de ses hauts et bas). */
const graine = (uid: string) => [...uid].reduce((s, c) => (s * 31 + c.charCodeAt(0)) % 1_000_003, 7) / 1_000_003;

/** Le solde d'un figurant à l'instant t : une lente croissance, et des hauts et des bas d'un jour à l'autre. */
export function soldeFigurant(f: Figurant, t: number): number {
  const g = graine(f.uid);
  const jours = t / JOUR;
  const vague = 1 + 0.18 * Math.sin(jours * (0.7 + g) + g * 40) + 0.07 * Math.sin(jours * (3.1 + 2 * g) + g * 13);
  const croissance = 1 + 0.004 * Math.max(0, jours - 20_784);
  return Math.round((f.base * vague * croissance) / 1000) * 1000;
}

/** Le niveau affiché d'un figurant (cohérent avec sa fortune). */
export const niveauFigurant = (f: Figurant) => Math.max(3, Math.min(160, Math.round(Math.sqrt(f.base / 1_000_000) * 2.2)));

/**
 * Les figurants d'une manche en direct : 2 à 6 selon l'heure (plus le soir), moins quand de vrais joueurs sont là
 * (aucun au-delà de 12 vrais joueurs). `hasard` rend un nombre dans [0, 1).
 */
export function figurantsManche(hasard: () => number, vrais: number, t: number): Figurant[] {
  if (!FIGURANTS_ACTIFS) return [];
  const heure = new Date(t).getUTCHours() + 1;
  const soir = heure >= 18 || heure <= 1 ? 2 : heure >= 9 ? 1 : 0;
  const n = Math.max(0, Math.min(FIGURANTS.length, 2 + soir + Math.floor(hasard() * 3) - Math.floor(vrais / 3)));
  const tas = [...FIGURANTS];
  const choisis: Figurant[] = [];
  while (choisis.length < n && tas.length) choisis.push(tas.splice(Math.floor(hasard() * tas.length), 1)[0]);
  return choisis;
}

/**
 * Le nombre de spectateurs montré d'un show en direct : les vrais, plus une foule qui va et vient (quelques-uns de plus
 * ou de moins toutes les quelques secondes, plus le soir). `cle` distingue les shows (chacun sa foule).
 */
export function spectateursAffiches(vrais: number, t: number, cle: string): number {
  if (!FIGURANTS_ACTIFS) return vrais;
  const g = graine(cle) * 100;
  const heure = new Date(t).getUTCHours() + 1;
  const soir = heure >= 18 || heure <= 1 ? 6 : heure >= 9 ? 3 : 1;
  const instant = Math.floor(t / 4_000);
  const bruit = Math.floor(graine(`${cle}-${instant}`) * 4) - 1;
  const foule = soir + 4 + 3 * Math.sin(t / 47_000 + g) + 2 * Math.sin(t / 13_000 + 2 * g) + bruit;
  return vrais + Math.max(1, Math.round(foule));
}

/** Une mise de figurant : autour de sa mise habituelle (×1/4 à ×2), arrondie à un jeton courant. */
export function miseFigurant(f: Figurant, hasard: () => number): number {
  const brut = f.mise * [0.25, 0.5, 1, 1, 2][Math.floor(hasard() * 5)];
  const jetons = [1_000, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 2_000_000, 5_000_000];
  return jetons.reduce((m, j) => (Math.abs(j - brut) < Math.abs(m - brut) ? j : m), jetons[0]);
}

/** Les cases d'un figurant : 1 à 3, tirées dans la liste (les chiffres plus souvent que les bonus). */
export function casesFigurant<C extends string>(hasard: () => number, chiffres: C[], bonus: C[]): C[] {
  const n = 1 + Math.floor(hasard() * 3);
  const choix = new Set<C>();
  for (let k = 0; k < n * 3 && choix.size < n; k++) {
    const l = hasard() < 0.65 ? chiffres : bonus;
    if (l.length) choix.add(l[Math.floor(hasard() * l.length)]);
  }
  return [...choix];
}

/** Un figurant est-il « en ligne » ? Par périodes de 20 minutes, un peu moins d'une fois sur deux (plus le soir). */
export function figurantEnLigne(f: Figurant, t: number): boolean {
  const heure = new Date(t).getUTCHours() + 1;
  const seuil = heure >= 18 || heure <= 1 ? 0.6 : heure >= 9 ? 0.4 : 0.15;
  return graine(`${f.uid}-${Math.floor(t / 1_200_000)}`) < seuil;
}

/** Le profil d'un figurant : cohérent avec son niveau et sa fortune (mises, gains, jeux préférés, date d'arrivée). */
export function profilFigurant(f: Figurant, t: number) {
  const g = graine(f.uid);
  const n = niveauFigurant(f);
  const mise = (500 * (n - 1) * n + Math.round(g * 400 * n)) * 1_000;
  const preferes: JeuCasino[] = (['baronWheel', 'roulette', 'blackjack', 'machine', 'folleNuit', 'couronne', 'chute', 'coffres'] as JeuCasino[]).filter((_, k) => graine(`${f.uid}-jeu-${k}`) < 0.55);
  const jeux: Partial<Record<JeuCasino, { mise: number; gain: number }>> = {};
  const parts = preferes.map((_, k) => 1 + graine(`${f.uid}-part-${k}`) * 3);
  const somme = parts.reduce((a, b) => a + b, 0) || 1;
  preferes.forEach((j, k) => {
    const m = Math.round((mise * parts[k]) / somme / 1000) * 1000;
    jeux[j] = { mise: m, gain: Math.round((m * (0.88 + graine(`${f.uid}-g-${k}`) * 0.11)) / 1000) * 1000 };
  });
  const gagne = Object.values(jeux).reduce((s, x) => s + (x?.gain ?? 0), 0);
  return {
    nom: f.nom,
    avatar: f.avatar,
    niveau: n,
    solde: soldeFigurant(f, t),
    mise,
    gagne,
    plusGrosGain: Math.round((f.mise * (150 + g * 900)) / 1000) * 1000,
    jeux,
    defis: { gagnes: 0, perdus: 0, nuls: 0 },
    depuis: Date.UTC(2026, 10, 27) - Math.round((3 + g * 25) * JOUR),
  };
}

/** Les objets de départ d'un figurant (son Bureau) : ce que sa fortune lui a permis d'acheter, au prix des enchères. */
export function collectionBaseFigurant(f: Figurant): Collection {
  const c: Collection = {};
  let budget = f.base * 0.5;
  const ordre = [...IDS_OBJETS].sort((a, b) => graine(`${f.uid}-${a}`) - graine(`${f.uid}-${b}`));
  for (const o of ordre) {
    const prix = Math.round(PRIX_DOLLARS[OBJETS[o].rarete] * (1.1 + graine(`${f.uid}-prix-${o}`) * 1.4));
    if (prix > budget || graine(`${f.uid}-veut-${o}`) < 0.3) continue;
    c[o] = { n: 1, valeur: prix };
    budget -= prix;
  }
  return c;
}

/** Ajoute une collection à une autre (objets gagnés aux enchères). */
export function fusionnerCollections(a: Collection, b: Collection | undefined): Collection {
  const c: Collection = { ...a };
  for (const [o, x] of Object.entries(b ?? {}) as [IdObjet, { n: number; valeur: number }][]) {
    const avant = c[o] ?? { n: 0, valeur: 0 };
    c[o] = { n: avant.n + x.n, valeur: avant.valeur + x.valeur };
  }
  return c;
}

/**
 * Une enchère de figurant sur un lot en dollars : le plafond qu'il s'accorde (selon sa fortune et le lot du jour), ou
 * null s'il ne s'y intéresse pas. Ils ne misent jamais sur le lot en rubis, et laissent la dernière demi-heure aux
 * joueurs.
 */
export function plafondFigurant(f: Figurant, prixDepart: number, jour: string, objet: string, t: number): number | null {
  const g = graine(`${f.uid}-${jour}-${objet}`);
  if (g < 0.45) return null;
  const plafond = Math.min(prixDepart * (1.3 + g * 2.2), soldeFigurant(f, t) * 0.45);
  return plafond >= prixDepart ? plafond : null;
}
