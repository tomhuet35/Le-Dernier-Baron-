export type Famille = 'billets' | 'lingots' | 'lames' | 'diamants';
export type Speciale = 'baron' | 'pickpocket' | 'homme_de_main' | 'alibi' | 'juge' | 'croupier';
export type TypeEvenement = 'descente_police' | 'trahison' | 'casse_du_siecle' | 'couvre_feu' | 'alliance';

export interface Carte {
  id: string;
  type: 'gang' | 'atout' | 'speciale';
  famille?: Famille | 'chat_noir';
  valeur?: number;
  speciale?: Speciale;
  nom: string;
  image: string;
}

export interface CarteEvenement {
  id: string;
  type: 'evenement';
  evenement: TypeEvenement;
  nom: string;
  image: string;
}

export type Phase =
  | 'TRAHISON'
  | 'ANNONCES'
  | 'ALLIANCE'
  | 'PLI'
  | 'VOL'
  | 'FIN_DE_PLI'
  | 'FIN_DE_NUIT'
  | 'FIN_DE_PARTIE';

export interface CartePosee {
  joueurId: string;
  carteId: string;
  valeurCroupier?: 0 | 11;
}

export interface PliTermine {
  cartes: CartePosee[];
  gagnantId: string;
  butinId: string | null;
  braquage: boolean;
}

export interface ScoreNuit {
  joueurId: string;
  annonce: number;
  plis: number;
  reussie: boolean;
  pointsAnnonce: number;
  pointsButin: number;
  bonus: number;
  total: number;
}

export interface BilanNuit {
  nuit: number;
  evenement: TypeEvenement | null;
  scores: ScoreNuit[];
}

export interface EntreeJournal {
  n: number;
  texte: string;
}

export interface JoueurPartie {
  id: string;
  nom: string;
}

export interface Vol {
  voleurId: string;
  source: 'pickpocket' | 'baron';
}

/** État complet d'une partie. Il ne quitte jamais le serveur : les joueurs reçoivent une Vue. */
export interface EtatPartie {
  joueurs: JoueurPartie[]; // ordre des sièges
  nuit: number;
  premier: number; // siège du premier joueur de la nuit
  phase: Phase;
  rng: number;
  mains: Record<string, string[]>;
  piocheEvenements: string[];
  evenement: TypeEvenement | null;
  evenementId: string | null;
  annonces: Record<string, number | null>;
  annoncesRevelees: boolean;
  choixTrahison: Record<string, string>; // absent = pas encore choisi
  choixAlliance: Record<string, string | null>; // absent = pas encore choisi, null = personne
  alliances: [string, string][];
  pli: CartePosee[];
  ouvreur: number; // siège qui ouvre le pli en cours
  tour: number; // siège qui doit jouer
  plis: Record<string, number>;
  butins: Record<string, string[]>;
  bonusBaron: Record<string, number>;
  braquages: Record<string, number>;
  vol: Vol | null;
  dernierPli: PliTermine | null;
  nbPlisJoues: number;
  scores: Record<string, number>;
  bilans: BilanNuit[];
  prets: Record<string, boolean>;
  journal: EntreeJournal[];
  compteurJournal: number;
}

export type Action =
  | { type: 'TRAHISON'; joueurId: string; carteId: string }
  | { type: 'ANNONCE'; joueurId: string; valeur: number }
  | { type: 'ALLIANCE'; joueurId: string; allieId: string | null }
  | { type: 'JOUER'; joueurId: string; carteId: string; valeurCroupier?: 0 | 11 }
  | { type: 'VOLER'; joueurId: string; cibleId: string | null; carteId?: string }
  | { type: 'SUITE' }
  | { type: 'CONTINUER'; joueurId: string }
  | { type: 'FORCER_SUITE' };

export type Resultat = { ok: true; etat: EtatPartie } | { ok: false; erreur: string };

export interface VueCarte {
  id: string;
  jouable: boolean;
}

export interface VueJoueur {
  id: string;
  nom: string;
  nbCartes: number;
  annonce: number | null; // visible seulement une fois les annonces révélées
  aAnnonce: boolean;
  plis: number;
  butin: string[];
  score: number;
  attendu: boolean;
}

/** Ce qu'un joueur a le droit de voir. */
export interface Vue {
  moi: string;
  nuit: number;
  nbNuits: number;
  phase: Phase;
  evenement: TypeEvenement | null;
  evenementId: string | null;
  joueurs: VueJoueur[];
  premierId: string;
  ouvreurId: string;
  tourId: string | null;
  main: VueCarte[];
  familleDemandee: Famille | null;
  pli: CartePosee[];
  dernierPli: PliTermine | null;
  vol: Vol | null;
  aChoisiTrahison: boolean;
  maCarteTrahison: string | null;
  monAnnonce: number | null;
  aChoisiAllie: boolean;
  monAllie: string | null;
  alliances: [string, string][];
  attente: string[];
  bilans: BilanNuit[];
  journal: EntreeJournal[];
  pret: boolean;
}

export interface JoueurSalonVue {
  id: string;
  nom: string;
  connecte: boolean;
  robot: boolean;
}

export interface VueSalon {
  code: string;
  moi: string;
  hoteId: string;
  modeTest: boolean;
  joueurs: JoueurSalonVue[];
  partie: Vue | null;
}
