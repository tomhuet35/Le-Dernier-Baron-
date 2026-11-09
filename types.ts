import type { IdTapis } from './niveaux';

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
  /** La même ligne en anglais. */
  en?: string;
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
  /** Partie courte (tutoriel) : nombre de nuits et nuits avec un événement. Absents : règles normales. */
  nbNuits?: number;
  nuitsAvecEvenement?: number[];
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
  familleDemandee: Famille | 'chat_noir' | null;
  pli: CartePosee[];
  dernierPli: PliTermine | null;
  vol: Vol | null;
  aChoisiTrahison: boolean;
  maCarteTrahison: string | null;
  monAnnonce: number | null;
  aChoisiAllie: boolean;
  monAllie: string | null;
  alliances: [string, string][];
  /** Qui a choisi qui pendant l'Alliance : révélé à tous une fois que chacun a choisi. */
  choixAllies: Record<string, string | null> | null;
  attente: string[];
  bilans: BilanNuit[];
  journal: EntreeJournal[];
  pret: boolean;
}

export type NiveauBot = 'debutant' | 'confirme' | 'expert';
export type StyleBot = 'equilibre' | 'prudent' | 'audacieux' | 'voleur';
export interface ProfilBot {
  niveau: NiveauBot;
  style: StyleBot;
}

export interface JoueurSalonVue {
  id: string;
  nom: string;
  connecte: boolean;
  /** La place est jouée par l'ordinateur (bot, ou joueur absent remplacé). */
  robot: boolean;
  /** Joueur ordinateur (bot) : son niveau et son style ; null pour un humain. */
  bot: ProfilBot | null;
  avatar: number;
  /** Niveau et victoires du joueur s'il est connecté à son compte (visible de tout le salon). */
  compte: CompteJoueurVue | null;
  /** A quitté la partie en cours : l'ordinateur joue à sa place. */
  abandon?: boolean;
}

export interface CompteJoueurVue {
  niveau: number;
  titre: string;
  victoires: number;
  /** Place sur le podium du classement de la semaine : couronne d'or (1), d'argent (2) ou de bronze (3). */
  couronne?: Rang;
}

/** Place sur le podium du classement de la semaine. */
export type Rang = 1 | 2 | 3;

/** Une ligne du classement de la semaine (jamais d'adresse e-mail ni d'identifiant de compte). */
export interface EntreeClassementVue {
  rang: number;
  /** Pseudo du compte (null s'il est choquant : affiché « Joueur »). */
  nom: string | null;
  avatar: number;
  niveau: number;
  score: number;
  /** C'est le joueur qui regarde le classement. */
  moi?: boolean;
}

/** XP gagnée grâce au classement de la semaine dernière (envoyée une seule fois, à la connexion qui suit). */
export interface RecompenseSemaine {
  rang: number;
  xp: number;
  /** Début et fin de la semaine récompensée. */
  debut: number;
  fin: number;
  niveauAvant: number;
  niveau: number;
}

export interface VueClassement {
  semaine: { cle: string; debut: number; fin: number; entrees: EntreeClassementVue[]; moi: EntreeClassementVue | null; total: number };
  precedente: { cle: string; debut: number; fin: number; entrees: EntreeClassementVue[] } | null;
}

/** Bannière de l'accueil : le premier de la semaine (ou de la semaine dernière tant que personne n'a encore joué). */
export interface MeneurSemaine {
  nom: string | null;
  avatar: number;
  niveau: number;
  score: number;
  semaine: 'courante' | 'precedente';
}

/** Ce que la partie terminée a rapporté au compte d'un joueur. */
export interface BilanCompte {
  victoire: boolean;
  nuitsGagnees: number; // pendant cette partie
  xpGagne: number;
  niveauAvant: number;
  niveau: number;
  titre: string;
  xp: number; // totaux du compte après la partie
  victoires: number;
  parties: number;
  /** Partie jouée pendant un week-end XP double. */
  xpDouble?: boolean;
  /** Partie quittée avant la fin : aucune XP. */
  abandon?: boolean;
}

export interface EnregistrementVue {
  /** test : partie avec des robots de test, jamais comptée. */
  /** test : partie avec des robots de test ; solo : moins de 2 joueurs humains. Ces parties ne comptent pas. */
  etat: 'en_cours' | 'fait' | 'erreur' | 'test' | 'solo';
  bilans: Record<string, BilanCompte>; // par joueurId
}

export interface EntreeHistorique {
  date: number;
  rang: number;
  nbJoueurs: number;
  score: number;
  victoire: boolean;
  nuitsGagnees: number;
  xp: number;
  adversaires: string[];
  /** Partie quittée avant la fin (aucune XP). */
  abandon?: boolean;
}

/** Fiche d'un joueur de la table, visible par tous (jamais d'adresse e-mail). */
export type ProfilPublic =
  | { type: 'bot'; nom: string; avatar: number; niveau: NiveauBot; style: StyleBot }
  | { type: 'invite'; nom: string; avatar: number }
  | {
      type: 'compte';
      nom: string;
      avatar: number;
      xp: number;
      parties: number;
      victoires: number;
      nuitsGagnees: number;
      annoncesReussies: number;
      meilleurScore: number | null;
      historique: EntreeHistorique[];
      /** Lien avec le joueur qui regarde la fiche (null s'il n'est pas connecté à un compte). */
      relation: 'moi' | 'ami' | 'demande_envoyee' | 'demande_recue' | 'aucune' | null;
      /** Place au classement de la semaine (null : pas encore de score cette semaine). */
      semaine?: { rang: number; score: number } | null;
      /** Badge « Créateur » (équipe du jeu). */
      createur?: boolean;
    };

export type StatutAmi = 'en_ligne' | 'en_partie' | 'hors_ligne';

/** Un ami (ou une demande) tel qu'il apparaît dans la liste : jamais d'adresse e-mail. */
export interface AmiVue {
  code: string;
  nom: string;
  avatar: number;
  niveau: number;
  titre: string;
  victoires: number;
  statut: StatutAmi;
  /** Déjà assis à la même table que moi. */
  avecMoi: boolean;
  /** Hors ligne, mais joignable : il a activé les notifications d'invitation. */
  notifiable?: boolean;
  /** Couronne du classement de la semaine. */
  couronne?: Rang;
  /** En pleine partie : on peut la regarder en direct. */
  regardable?: boolean;
}

export interface ListeAmis {
  monCode: string;
  amis: AmiVue[];
  recues: AmiVue[];
  envoyees: AmiVue[];
}

/** Invitation d'un ami à rejoindre sa partie privée. */
export interface Invitation {
  id: string;
  de: string;
  code: string;
  heure: number;
}

/** Profil complet, envoyé seulement à son propriétaire. */
export interface ProfilCompte {
  nom: string;
  email: string | null;
  parties: number;
  victoires: number;
  nuitsGagnees: number;
  annoncesReussies: number;
  meilleurScore: number | null;
  xp: number;
  historique: EntreeHistorique[];
  /** Tapis de jeu posé sur la table (toujours un tapis débloqué). */
  tapis: IdTapis;
  /** Place au classement de la semaine (null : pas encore de score cette semaine). */
  semaine?: { rang: number; score: number } | null;
  /** Badge « Créateur » (équipe du jeu). */
  createur?: boolean;
  /** Personnages gagnés à la roulette du jour (numéros d'avatar). */
  personnages?: number[];
  /** Roulette du jour déjà tournée : instant où elle redevient disponible (null : disponible maintenant). */
  rouletteProchaine?: number | null;
}

export interface VueSalon {
  code: string;
  moi: string;
  hoteId: string;
  modeTest: boolean;
  joueurs: JoueurSalonVue[];
  partie: Vue | null;
  messages: MessageChat[];
  /** Millisecondes restantes pour agir (joueurs attendus), ou null s'il n'y a pas de minuteur. */
  tempsRestant: number | null;
  dureeTour: number;
  /** Partie guidée du tutoriel. */
  tutoriel?: boolean;
  /** Partie publique : tranche de niveau de la table. */
  tranche?: number | null;
  /** Partie publique (joueurs du monde entier, lancement automatique) ou privée (avec un code). */
  publique: boolean;
  /** Partie publique en attente : millisecondes avant le lancement automatique. */
  departDans: number | null;
  /** Les comptes joueurs sont configurés sur le serveur. */
  comptesActifs: boolean;
  /** Enregistrement des victoires de la partie terminée (null tant que la partie n'est pas finie). */
  enregistrement: EnregistrementVue | null;
  /** Fin de partie publique : joueurs qui ont accepté la revanche, et temps restant pour la rejoindre. */
  revanche?: { votants: string[]; finDans: number } | null;
  /** Mon chat est coupé pour toute la table (après des signalements). */
  chatCoupe?: boolean;
  /** Je regarde la partie d'un ami, sans jouer : la table est vue depuis sa place, sans aucune carte cachée. */
  spectateur?: { ami: string };
  /** Les amis qui regardent la partie en direct (pseudos), visibles des joueurs. */
  spectateurs?: string[];
}

/** Réaction rapide d'un joueur, affichée quelques secondes au-dessus de son avatar. */
export interface Reaction {
  n: number;
  joueurId: string;
  emoji: string;
}

export interface MessageChat {
  n: number;
  auteurId: string;
  nom: string;
  texte: string;
  heure: number;
}
