/**
 * Le Bureau du Baron et la Salle des ventes (Grand Hôtel du Baron, deuxième brique).
 *
 * - Salle des ventes : chaque jour, 3 lots aux enchères entre tous les joueurs du salon, jusqu'à minuit (heure de
 *   Paris). Une enchère bloque la somme ; surenchérie, elle est rendue tout de suite. Chaque enchère dépasse la
 *   précédente d'au moins 10 %. À minuit, le meilleur enchérisseur gagne l'objet. Le troisième lot se joue en rubis.
 * - Bureau du Baron : les 10 objets de collection exposés dans ses vitrines. La valeur de la collection (somme des prix
 *   payés, les rubis comptés à la valeur de l'objet) fait le classement « La plus belle collection ». La collection
 *   complète rapporte 100 rubis et le cadre d'avatar « Mécène ».
 *
 * Tout ce fichier est pur : le serveur (server/ventesCasino.ts, server/salonCasino.ts) tient l'argent et les lots.
 */
import { hasardGraine, RUBIS_MAX, type EtatSalonJoueur } from './contrats';

export type IdObjet = 'voiture' | 'tableau' | 'montre' | 'statuette' | 'gramophone' | 'perles' | 'champagne' | 'cigares' | 'globe' | 'piano';
export type Rarete = 'commun' | 'rare' | 'precieux' | 'legendaire';
export type Monnaie = 'dollars' | 'rubis';

export const OBJETS: Record<IdObjet, { nom: [string, string]; rarete: Rarete }> = {
  gramophone: { nom: ['Le gramophone doré', 'The golden gramophone'], rarete: 'commun' },
  cigares: { nom: ['Le coffret de cigares', 'The cigar box'], rarete: 'commun' },
  globe: { nom: ['Le globe ancien', 'The antique globe'], rarete: 'commun' },
  champagne: { nom: ['Le champagne Maison Baron 1928', 'Maison Baron 1928 champagne'], rarete: 'rare' },
  montre: { nom: ['La montre à gousset', 'The pocket watch'], rarete: 'rare' },
  perles: { nom: ['Le collier de perles', 'The pearl necklace'], rarete: 'rare' },
  statuette: { nom: ['La danseuse de bronze', 'The bronze dancer'], rarete: 'precieux' },
  tableau: { nom: ['Le portrait art déco', 'The art deco portrait'], rarete: 'precieux' },
  piano: { nom: ['Le piano à queue', 'The grand piano'], rarete: 'legendaire' },
  voiture: { nom: ['La décapotable de collection', 'The vintage convertible'], rarete: 'legendaire' },
};
/** L'ordre des vitrines du bureau (des plus rares aux plus courants). */
export const IDS_OBJETS: IdObjet[] = ['voiture', 'piano', 'tableau', 'statuette', 'perles', 'montre', 'champagne', 'globe', 'cigares', 'gramophone'];
export const estObjet = (x: unknown): x is IdObjet => IDS_OBJETS.includes(x as IdObjet);

export const NOMS_RARETE: Record<Rarete, [string, string]> = {
  commun: ['Commun', 'Common'],
  rare: ['Rare', 'Rare'],
  precieux: ['Précieux', 'Precious'],
  legendaire: ['Légendaire', 'Legendary'],
};
/** Mise de départ selon la rareté, en dollars et en rubis. */
export const PRIX_DOLLARS: Record<Rarete, number> = { commun: 10_000_000, rare: 100_000_000, precieux: 1_000_000_000, legendaire: 10_000_000_000 };
export const PRIX_RUBIS: Record<Rarete, number> = { commun: 15, rare: 40, precieux: 100, legendaire: 250 };
/** Chances qu'un lot soit de cette rareté (sur 100). */
const POIDS_RARETE: [Rarete, number][] = [
  ['commun', 45],
  ['rare', 30],
  ['precieux', 18],
  ['legendaire', 7],
];
export const LOTS_PAR_JOUR = 3;
/** Le lot qui se joue en rubis (le troisième). */
export const LOT_EN_RUBIS = 2;
/** Chaque enchère dépasse la précédente d'au moins 10 %. */
export const HAUSSE_MIN = 0.1;
/** Une enchère ne peut pas dépasser 100 fois le minimum (garde-fou contre une faute de frappe). */
export const ENCHERE_MAX_FOIS = 100;
/** La collection complète : ses rubis. */
export const RUBIS_COLLECTION = 100;

// ---------------------------------------------------------------------------------------------------------------
// Les lots

export interface EnchereLot {
  uid: string;
  nom: string;
  avatar: number;
  montant: number;
}

export interface Lot {
  objet: IdObjet;
  monnaie: Monnaie;
  prixDepart: number;
  meilleure: EnchereLot | null;
  /** Nombre d'enchères posées. */
  encheres: number;
}

export interface EtatVentes {
  /** Le jour (heure de Paris) des lots en cours. */
  jour: string;
  lots: Lot[];
}

const tirerRarete = (hasard: (n: number) => number): Rarete => {
  let x = hasard(100);
  for (const [r, p] of POIDS_RARETE) {
    if (x < p) return r;
    x -= p;
  }
  return 'commun';
};

/** Les 3 lots d'un jour (toujours les mêmes pour un même jour) : trois objets différents, le dernier en rubis. */
export function lotsDuJour(jour: string): Lot[] {
  const hasard = hasardGraine(`ventes|${jour}`);
  const lots: Lot[] = [];
  for (let essai = 0; lots.length < LOTS_PAR_JOUR && essai < 100; essai++) {
    const rarete = tirerRarete(hasard);
    const choix = IDS_OBJETS.filter((o) => OBJETS[o].rarete === rarete && !lots.some((l) => l.objet === o));
    if (!choix.length) continue;
    const objet = choix[hasard(choix.length)];
    const monnaie: Monnaie = lots.length === LOT_EN_RUBIS ? 'rubis' : 'dollars';
    lots.push({ objet, monnaie, prixDepart: monnaie === 'rubis' ? PRIX_RUBIS[rarete] : PRIX_DOLLARS[rarete], meilleure: null, encheres: 0 });
  }
  return lots;
}

/** Arrondit vers le haut à 3 chiffres significatifs (1 234 567 → 1 240 000). */
export function arrondiHaut(n: number): number {
  if (n <= 1000) return Math.ceil(n);
  const pas = 10 ** (Math.floor(Math.log10(n)) - 2);
  return Math.ceil(n / pas) * pas;
}

/** La plus petite enchère acceptée sur un lot. */
export function enchereMinimale(lot: Lot): number {
  if (!lot.meilleure) return lot.prixDepart;
  const m = lot.meilleure.montant;
  return lot.monnaie === 'rubis' ? Math.max(m + 1, Math.ceil(m * (1 + HAUSSE_MIN))) : arrondiHaut(m * (1 + HAUSSE_MIN));
}

/** Ce que vaut un objet gagné, en dollars (les rubis comptent au prix de départ en dollars de sa rareté). */
export function valeurEnDollars(lot: { objet: IdObjet; monnaie: Monnaie }, montant: number): number {
  if (lot.monnaie === 'dollars') return montant;
  const r = OBJETS[lot.objet].rarete;
  return Math.round((montant * PRIX_DOLLARS[r]) / PRIX_RUBIS[r]);
}

export type ResultatEnchere = 'ok' | 'introuvable' | 'deja' | 'minimum' | 'trop' | 'solde';

/**
 * Pose une enchère (l'état doit être celui du jour). debiter(monnaie, montant) prend la somme au joueur (false si elle
 * manque) ; la précédente meilleure enchère est renvoyée pour être rendue.
 */
export function encherir(
  etat: EtatVentes,
  index: number,
  qui: Omit<EnchereLot, 'montant'>,
  montant: number,
  debiter: (monnaie: Monnaie, montant: number) => boolean,
): { resultat: ResultatEnchere; rendue?: EnchereLot } {
  const lot = etat.lots[index];
  if (!lot) return { resultat: 'introuvable' };
  if (lot.meilleure?.uid === qui.uid) return { resultat: 'deja' };
  const min = enchereMinimale(lot);
  if (!Number.isSafeInteger(montant) || montant < min) return { resultat: 'minimum' };
  if (montant > min * ENCHERE_MAX_FOIS) return { resultat: 'trop' };
  if (!debiter(lot.monnaie, montant)) return { resultat: 'solde' };
  const rendue = lot.meilleure ?? undefined;
  lot.meilleure = { ...qui, montant };
  lot.encheres += 1;
  return { resultat: 'ok', rendue };
}

// ---------------------------------------------------------------------------------------------------------------
// La collection (gardée avec l'état du salon du joueur)

export interface PieceCollection {
  /** Exemplaires possédés, et valeur totale payée (en dollars). */
  n: number;
  valeur: number;
}
export type Collection = Partial<Record<IdObjet, PieceCollection>>;

export const valeurCollection = (c: Collection | undefined) => IDS_OBJETS.reduce((s, o) => s + (c?.[o]?.valeur ?? 0), 0);
export const objetsDifferents = (c: Collection | undefined) => IDS_OBJETS.filter((o) => (c?.[o]?.n ?? 0) > 0).length;

/** Ajoute un objet gagné ; la collection complète (une première fois) rapporte ses rubis et le cadre « Mécène ». */
export function ajouterObjet(e: EtatSalonJoueur, objet: IdObjet, valeur: number): { complete: boolean } {
  const avant = e.collection[objet] ?? { n: 0, valeur: 0 };
  e.collection = { ...e.collection, [objet]: { n: avant.n + 1, valeur: avant.valeur + Math.max(0, Math.round(valeur)) } };
  if (!e.collectionComplete && objetsDifferents(e.collection) === IDS_OBJETS.length) {
    e.collectionComplete = true;
    e.rubis = Math.min(RUBIS_MAX, e.rubis + RUBIS_COLLECTION);
    if (!e.cadres.includes('mecene')) e.cadres = [...e.cadres, 'mecene'];
    return { complete: true };
  }
  return { complete: false };
}

/** Cadres d'avatar spéciaux (au-dessus de ceux des niveaux) : gagnés (collectionneur, mécène) ou achetés au Marché noir. */
export type CadreSpecial = string;
export const CADRES_SPECIAUX: Record<CadreSpecial, [string, string]> = {
  collectionneur: ['Collectionneur', 'Collector'],
  mecene: ['Mécène', 'Patron'],
};
/** Le cadre spécial porté : celui que le joueur a choisi, sinon le plus beau gagné, sinon le premier acheté. */
export const cadreSpecial = (cadres: readonly string[] | undefined, choisi?: string | null): CadreSpecial | null =>
  choisi && cadres?.includes(choisi) ? choisi : cadres?.includes('mecene') ? 'mecene' : cadres?.includes('collectionneur') ? 'collectionneur' : (cadres?.[0] ?? null);

export function normaliserCollection(v: unknown): Collection {
  const c: Collection = {};
  if (!v || typeof v !== 'object') return c;
  for (const [o, p] of Object.entries(v as Record<string, unknown>)) {
    if (!estObjet(o) || !p || typeof p !== 'object') continue;
    const x = p as Record<string, unknown>;
    const n = typeof x.n === 'number' && Number.isFinite(x.n) ? Math.max(0, Math.floor(x.n)) : 0;
    const valeur = typeof x.valeur === 'number' && Number.isFinite(x.valeur) ? Math.max(0, Math.floor(x.valeur)) : 0;
    if (n > 0) c[o] = { n, valeur };
  }
  return c;
}

/** Relit l'état des ventes (gardé avec les réglages du serveur). */
export function normaliserEtatVentes(brut: unknown): EtatVentes {
  const vide: EtatVentes = { jour: '', lots: [] };
  if (!brut || typeof brut !== 'object') return vide;
  const b = brut as Record<string, unknown>;
  if (typeof b.jour !== 'string' || !Array.isArray(b.lots)) return vide;
  const lots: Lot[] = [];
  for (const l of b.lots) {
    if (!l || typeof l !== 'object') continue;
    const x = l as Record<string, unknown>;
    if (!estObjet(x.objet) || (x.monnaie !== 'dollars' && x.monnaie !== 'rubis') || typeof x.prixDepart !== 'number') continue;
    const m = x.meilleure as Record<string, unknown> | null | undefined;
    const meilleure =
      m && typeof m === 'object' && typeof m.uid === 'string' && typeof m.montant === 'number' && m.montant > 0
        ? { uid: m.uid, nom: typeof m.nom === 'string' ? m.nom.slice(0, 40) : '', avatar: typeof m.avatar === 'number' ? m.avatar : 1, montant: Math.floor(m.montant) }
        : null;
    lots.push({ objet: x.objet, monnaie: x.monnaie, prixDepart: Math.max(1, Math.floor(x.prixDepart)), meilleure, encheres: typeof x.encheres === 'number' ? Math.max(0, Math.floor(x.encheres)) : 0 });
  }
  return { jour: b.jour.slice(0, 20), lots };
}

// ---------------------------------------------------------------------------------------------------------------
// Vues (téléphone)

export interface VueLot {
  index: number;
  objet: IdObjet;
  monnaie: Monnaie;
  prixDepart: number;
  minimum: number;
  meilleure: EnchereLot | null;
  encheres: number;
}
export interface VueVentes {
  lots: VueLot[];
  /** Fin des enchères (minuit, heure de Paris). */
  fin: number;
}
export const vueVentes = (e: EtatVentes, fin: number): VueVentes => ({
  lots: e.lots.map((l, index) => ({ index, objet: l.objet, monnaie: l.monnaie, prixDepart: l.prixDepart, minimum: enchereMinimale(l), meilleure: l.meilleure, encheres: l.encheres })),
  fin,
});

export interface CollectionneurSalon {
  uid: string;
  nom: string;
  avatar: number;
  valeur: number;
  objets: number;
  cadre: CadreSpecial | null;
}

export interface VueBureau {
  uid: string;
  nom: string;
  avatar: number;
  niveau: number;
  collection: Collection;
  valeur: number;
  cadre: CadreSpecial | null;
  moi: boolean;
  /** La plus belle collection du salon (les 10 premiers). */
  classement: CollectionneurSalon[];
}

/** Ce que le serveur envoie au téléphone : surenchéri, objet gagné, collection complète. */
export type AnnonceVente =
  | { type: 'surenchere'; objet: IdObjet; par: string; monnaie: Monnaie; rendu: number }
  | { type: 'gagne'; objet: IdObjet; montant: number; monnaie: Monnaie; complete: boolean };
