/**
 * Le Marché noir (Grand Hôtel du Baron) : dans la ruelle derrière l'hôtel, le receleur propose chaque jour 4 articles,
 * payés en rubis. Ils changent à minuit (heure de Paris) ; on peut relancer l'étal pour 5 rubis (3 fois par jour).
 *
 * - Deux cadres d'avatar rares (on choisit ensuite celui qu'on porte) ;
 * - un objet de collection pour le Bureau du Baron (compté à la valeur de sa rareté) ;
 * - une mallette de dollars (rubis → dollars seulement : jamais l'inverse).
 *
 * Rien de ce qui s'achète ici ne fait gagner aux jeux : ce sont des objets de style, et des dollars de jeu.
 */
import { hasardGraine, type EtatSalonJoueur } from './contrats';
import { echelleNiveau } from './contrats';
import { IDS_OBJETS, OBJETS, PRIX_DOLLARS, PRIX_RUBIS, type IdObjet } from './ventes';

export const RELANCES_MAX = 3;
export const PRIX_RELANCE = 5;

/** Les cadres rares du receleur (les cadres « collectionneur » et « mecene » se gagnent, ils ne s'achètent pas). */
export const CADRES_MARCHE = ['nuit', 'jazz', 'diamant', 'prohibition', 'velours', 'neon'] as const;
export type CadreMarche = (typeof CADRES_MARCHE)[number];
export const NOMS_CADRES_MARCHE: Record<CadreMarche, [string, string]> = {
  nuit: ['Nuit étoilée', 'Starry night'],
  jazz: ['Club de jazz', 'Jazz club'],
  diamant: ['Diamant noir', 'Black diamond'],
  prohibition: ['Prohibition', 'Prohibition'],
  velours: ['Velours rouge', 'Red velvet'],
  neon: ['Néon doré', 'Golden neon'],
};
export const PRIX_CADRE = 40;
/** Le nom d'un cadre spécial (gagné ou acheté). */
export const NOMS_CADRES: Record<string, [string, string]> = {
  collectionneur: ['Collectionneur', 'Collector'],
  mecene: ['Mécène', 'Patron'],
  ...NOMS_CADRES_MARCHE,
};

export type ArticleMarche = { type: 'cadre'; cadre: CadreMarche; prix: number } | { type: 'objet'; objet: IdObjet; prix: number } | { type: 'mallette'; dollars: number; prix: number };

export interface EtatMarche {
  jour: string;
  relances: number;
  /** Les articles achetés dans l'étal du jour (index). */
  achats: number[];
}
export const etatMarcheVide = (): EtatMarche => ({ jour: '', relances: 0, achats: [] });

/** L'étal d'un joueur pour le jour et la relance donnés (toujours le même : il se recalcule). */
export function etal(uid: string, jour: string, relances: number, niveau: number): ArticleMarche[] {
  const h = hasardGraine(`marche|${uid}|${jour}|${relances}`);
  const cadres = [...CADRES_MARCHE];
  const a1 = cadres.splice(h(cadres.length), 1)[0];
  const a2 = cadres.splice(h(cadres.length), 1)[0];
  // Un objet : rarement légendaire. Prix : 2,5 fois sa mise de départ en rubis (plus cher qu'aux enchères, mais sans attendre).
  const x = h(100);
  const rarete = x < 40 ? 'commun' : x < 72 ? 'rare' : x < 93 ? 'precieux' : 'legendaire';
  const choix = IDS_OBJETS.filter((o) => OBJETS[o].rarete === rarete);
  const objet = choix[h(choix.length)];
  return [
    { type: 'cadre', cadre: a1, prix: PRIX_CADRE },
    { type: 'cadre', cadre: a2, prix: PRIX_CADRE },
    { type: 'objet', objet, prix: Math.round(PRIX_RUBIS[OBJETS[objet].rarete] * 2.5) },
    { type: 'mallette', dollars: 5_000_000 * echelleNiveau(niveau), prix: 8 },
  ];
}

/** Un objet acheté au receleur compte, dans la collection, à la mise de départ en dollars de sa rareté. */
export const valeurObjetMarche = (o: IdObjet) => PRIX_DOLLARS[OBJETS[o].rarete];

/** Nouveau jour : l'étal repart (relances et achats remis à zéro). */
export function rafraichirMarche(e: EtatSalonJoueur, jour: string): boolean {
  if (e.marche.jour === jour) return false;
  e.marche = { jour, relances: 0, achats: [] };
  return true;
}

export function normaliserMarche(v: unknown): EtatMarche {
  if (!v || typeof v !== 'object') return etatMarcheVide();
  const m = v as Record<string, unknown>;
  return {
    jour: typeof m.jour === 'string' ? m.jour.slice(0, 12) : '',
    relances: typeof m.relances === 'number' ? Math.max(0, Math.min(RELANCES_MAX, Math.floor(m.relances))) : 0,
    achats: Array.isArray(m.achats) ? [...new Set(m.achats.filter((x): x is number => Number.isInteger(x) && x >= 0 && x < 4))] : [],
  };
}

export interface VueMarche {
  articles: (ArticleMarche & { achete: boolean; possede: boolean })[];
  relances: number;
  /** Fin de l'étal (minuit). */
  fin: number;
  /** Les cadres spéciaux du joueur, et celui qu'il porte. */
  cadres: string[];
  cadreChoisi: string | null;
}
