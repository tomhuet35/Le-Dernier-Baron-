/**
 * Les Contrats du Salon, l'Album du Baron et les Rubis du Baron (Grand Hôtel du Baron, première brique).
 *
 * - Contrats du jour : 3 par jour (minuit, heure de Paris), tirés au sort dans une liste fixe ; leurs objectifs
 *   grandissent avec le niveau du casino. Chacun rapporte des rubis, des dollars et un morceau de vignette ; les 3
 *   remplis rapportent un bonus de rubis. Un contrat peut être changé une fois par jour, contre des rubis.
 * - Gros coups de la semaine : 3 objectifs du lundi 0 h au lundi suivant (heure de Paris), payés en rubis.
 * - Album du Baron : une page par jeu, 6 morceaux de vignette par page. Un morceau vient de chaque contrat, et de la
 *   première victoire du jour à chaque jeu. Une page complète, puis l'album complet, rapportent des rubis.
 * - Missions permanentes (Blackjack et Roulette seulement, des jeux où l'on choisit son coup) : gagner 5 coups, puis 20, 50, 100… jusqu'à 10 000 ; chaque palier rapporte
 *   des rubis et des dollars (de plus en plus).
 * - Rubis : jamais gagnés aux jeux d'argent, jamais envoyés à un autre joueur, et jamais achetés avec de l'argent
 *   réel. Le dépannage (rubis contre dollars, quand on est ruiné) ne marche que dans ce sens.
 *
 * Tout ce fichier est pur : le serveur (salonCasino.ts) lui passe les événements et applique les récompenses.
 */
import { normaliserMissions, type IdTrophee } from './missions';
import { JEUX_CASINO, NOMS_JEUX_CASINO, type JeuCasino } from './profilCasino';
import { normaliserCollection, type Collection } from './ventes';
import { normaliserPortefeuille, type Portefeuille } from './bourse';
import { CADRES_MARCHE, normaliserMarche, type EtatMarche } from './marche';
import { estTenue, normaliserTenues } from './tailleur';

// ---------------------------------------------------------------------------------------------------------------
// Réglages

export const CONTRATS_PAR_JOUR = 3;
/** Rubis par contrat du jour, et bonus quand les 3 sont remplis. */
export const RUBIS_CONTRAT = 2;
export const RUBIS_TOUS_CONTRATS = 5;
/** Rubis par gros coup de la semaine. */
export const RUBIS_GROS_COUP = 10;
/** Rubis d'une page d'album complète, et de l'album entier. */
export const RUBIS_PAGE = 10;
export const RUBIS_ALBUM = 50;
/** Changer un contrat du jour : son prix en rubis (une fois par jour). */
export const PRIX_CHANGER_CONTRAT = 3;
/** Morceaux de vignette par page (2 colonnes × 3 rangées). */
export const MORCEAUX_PAGE = 6;
const PAGE_COMPLETE = (1 << MORCEAUX_PAGE) - 1;
/** Dépannage : sous ce solde, on peut échanger des rubis contre des dollars, une fois par jour. */
export const SEUIL_DEPANNAGE = 10_000;
export const PRIX_DEPANNAGE = 5;
/** Missions permanentes : les paliers de coups gagnants à chaque jeu, et les rubis de chacun. */
export const PALIERS = [5, 20, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000];
export const RUBIS_PALIERS = [1, 2, 3, 5, 8, 10, 15, 20, 30, 50];
/** Les jeux qui ont des missions permanentes. */
export const JEUX_PERMANENTS: JeuCasino[] = ['blackjack', 'roulette'];
/** Dollars d'un palier : ceux d'un contrat du jour, multipliés par le rang du palier (1 à 10). */
export const dollarsPalier = (k: number, niveau: number) => dollarsContrat(niveau) * (k + 1);
/** Le palier suivant (index), ou null quand tout est fait. */
export const palierSuivant = (n: number) => {
  const k = PALIERS.findIndex((p) => p > n);
  return k < 0 ? null : k;
};
/** Plafond des rubis (garde-fou). */
export const RUBIS_MAX = 1_000_000;

/** Les objectifs grandissent avec le niveau : ×1 jusqu'au niveau 9, ×2 du 10 au 19… ×11 au niveau 100. */
export const echelleNiveau = (niveau: number) => 1 + Math.floor(Math.max(1, niveau) / 10);
/** Dollars d'un contrat du jour : 50 000 $ par niveau, 100 000 $ au moins. */
export const dollarsContrat = (niveau: number) => Math.max(100_000, 50_000 * Math.max(1, niveau));
/** Dollars du dépannage : de quoi se refaire, à la mesure du niveau. */
export const dollarsDepannage = (niveau: number) => 1_000_000 * echelleNiveau(niveau);

// ---------------------------------------------------------------------------------------------------------------
// Les contrats

/**
 * Ce que compte un contrat :
 * - tours : les mises placées (une mise = un tour, une partie, ou un pari) ;
 * - mise / gain : les dollars misés / gagnés ;
 * - victoires : les coups gagnants (un gain versé) ;
 * - gros : les gains d'au moins `x` fois la dernière mise au même jeu ;
 * - jeux : les jeux différents où l'on a misé (dans la journée, ou dans la semaine) ;
 * - evenement : un événement nommé, noté par le serveur (bonus de la machine, jackpot, défi gagné).
 */
export type MesureContrat = 'tours' | 'mise' | 'gain' | 'victoires' | 'gros' | 'jeux' | 'evenement';
export type EvenementContrat = 'bonusMachine' | 'jackpot' | 'defiGagne';

export interface ModeleContrat {
  id: string;
  /** Le jeu concerné (null : tous les jeux du salon). */
  jeu: JeuCasino | null;
  mesure: MesureContrat;
  /** Mesure « gros » : le multiple de la mise à atteindre. */
  x?: number;
  /** Mesure « evenement » : lequel. */
  evenement?: EvenementContrat;
  /** L'objectif, selon le niveau du casino. */
  cible: (niveau: number) => number;
  /** Le texte, avec {n} pour l'objectif (en dollars s'il s'agit d'argent). */
  texte: [string, string];
}

const fixe = (n: number) => () => n;
/** Objectifs « nombre de tours » : un peu plus longs à mesure que le joueur monte (×1 au début, jusqu'à ×4). */
const tours = (n: number) => (niveau: number) => n * Math.min(4, 1 + Math.floor(Math.max(1, niveau) / 30));
/** Les jeux ouverts au joueur (selon son niveau) ; par défaut tous. */
export type JeuxOuverts = (jeu: JeuCasino) => boolean;
const tousOuverts: JeuxOuverts = () => true;
const nomJeu = (j: JeuCasino) => NOMS_JEUX_CASINO[j];

export const CONTRATS_DU_JOUR: ModeleContrat[] = [
  { id: 'bandit-tours', jeu: 'machine', mesure: 'tours', cible: tours(20), texte: [`Jouer {n} tours à The Golden Heist`, `Play {n} spins on ${nomJeu('machine')[1]}`] },
  { id: 'bandit-bonus', jeu: 'machine', mesure: 'evenement', evenement: 'bonusMachine', cible: fixe(1), texte: [`Déclencher un bonus à The Golden Heist`, `Trigger a bonus on ${nomJeu('machine')[1]}`] },
  { id: 'nuits-tours', jeu: 'nuits', mesure: 'tours', cible: tours(20), texte: [`Jouer {n} tours aux Nuits du Baron`, `Play {n} spins on ${nomJeu('nuits')[1]}`] },
  { id: 'blackjack-victoires', jeu: 'blackjack', mesure: 'victoires', cible: fixe(3), texte: ['Gagner {n} mains au blackjack', 'Win {n} hands of blackjack'] },
  { id: 'roulette-victoires', jeu: 'roulette', mesure: 'victoires', cible: fixe(3), texte: ['Gagner {n} paris à la roulette', 'Win {n} bets at roulette'] },
  { id: 'folle-nuit-tours', jeu: 'folleNuit', mesure: 'tours', cible: tours(5), texte: [`Placer {n} mises à la Folle Nuit`, `Place {n} bets on ${nomJeu('folleNuit')[1]}`] },
  { id: 'coffres-tours', jeu: 'coffres', mesure: 'tours', cible: tours(5), texte: [`Jouer {n} parties aux Coffres du Baron`, `Play {n} rounds of ${nomJeu('coffres')[1]}`] },
  { id: 'toits-tours', jeu: 'toits', mesure: 'tours', cible: tours(5), texte: [`Jouer {n} parties Sur les toits`, `Play {n} rounds of ${nomJeu('toits')[1]}`] },
  { id: 'couronne-gros', jeu: 'couronne', mesure: 'gros', x: 5, cible: fixe(1), texte: [`Encaisser à ×5 ou plus au Vol de la Couronne`, `Cash out at ×5 or more on ${nomJeu('couronne')[1]}`] },
  { id: 'chute-tours', jeu: 'chute', mesure: 'tours', cible: tours(20), texte: [`Lâcher {n} écus à la Chute des Écus`, `Drop {n} crowns on ${nomJeu('chute')[1]}`] },
  { id: 'course-victoires', jeu: 'course', mesure: 'victoires', cible: fixe(1), texte: [`Parier sur le gagnant à la Course des Écuries`, `Back the winner at ${nomJeu('course')[1]}`] },
  { id: 'roue-tours', jeu: 'baronWheel', mesure: 'tours', cible: tours(5), texte: [`Placer {n} mises au Baron Express`, `Place {n} bets on ${nomJeu('baronWheel')[1]}`] },
  { id: 'mise-totale', jeu: null, mesure: 'mise', cible: (n) => 2_000_000 * echelleNiveau(n), texte: ['Miser {n} dans le salon', 'Bet {n} in the lounge'] },
  { id: 'gain-total', jeu: null, mesure: 'gain', cible: (n) => 1_000_000 * echelleNiveau(n), texte: ['Gagner {n} dans le salon', 'Win {n} in the lounge'] },
  { id: 'trois-jeux', jeu: null, mesure: 'jeux', cible: fixe(3), texte: ['Jouer à {n} jeux différents', 'Play {n} different games'] },
  { id: 'gros-gain', jeu: null, mesure: 'gros', x: 10, cible: fixe(1), texte: ['Réussir un gain d’au moins ×10 la mise', 'Land a win of at least ×10 your bet'] },
];

export const GROS_COUPS: ModeleContrat[] = [
  { id: 'defis-gagnes', jeu: null, mesure: 'evenement', evenement: 'defiGagne', cible: fixe(3), texte: ['Gagner {n} défis contre des amis', 'Win {n} challenges against friends'] },
  { id: 'jackpot', jeu: null, mesure: 'evenement', evenement: 'jackpot', cible: fixe(1), texte: ['Toucher le gros lot de The Golden Heist', 'Hit The Golden Heist jackpot'] },
  { id: 'cinq-jeux', jeu: null, mesure: 'jeux', cible: fixe(5), texte: ['Jouer à {n} jeux différents dans la semaine', 'Play {n} different games this week'] },
];

const MODELES = new Map([...CONTRATS_DU_JOUR, ...GROS_COUPS].map((m) => [m.id, m]));
export const modeleContrat = (id: string) => MODELES.get(id) ?? null;
export const estArgent = (m: ModeleContrat) => m.mesure === 'mise' || m.mesure === 'gain';

// ---------------------------------------------------------------------------------------------------------------
// État d'un joueur (gardé avec son casino)

export interface Contrat {
  id: string;
  /** Objectif fixé au tirage (il ne bouge plus si le niveau change dans la journée). */
  cible: number;
  progres: number;
  fait: boolean;
}

export interface EtatContrats {
  /** Le jour (heure de Paris) des contrats du jour. */
  jour: string;
  liste: Contrat[];
  /** Un contrat déjà changé aujourd'hui ? */
  change: boolean;
  /** Le bonus des 3 contrats déjà versé ? */
  tous: boolean;
  /** Les jeux où l'on a misé aujourd'hui (contrat « jeux différents »), et ceux déjà gagnés (morceau du jour). */
  jeux: JeuCasino[];
  victoires: JeuCasino[];
  /** La semaine (« 2026-S47 ») des gros coups, les gros coups, et les jeux joués cette semaine. */
  semaine: string;
  grosCoups: Contrat[];
  jeuxSemaine: JeuCasino[];
}

export interface EtatSalonJoueur {
  rubis: number;
  contrats: EtatContrats;
  /** Album : par jeu, les morceaux collés (un bit par case, 6 cases). */
  album: Partial<Record<JeuCasino, number>>;
  /** Récompense de l'album entier déjà versée ? */
  albumComplet: boolean;
  /** Dernier jour du dépannage (heure de Paris). */
  depannage?: string;
  /** Bureau du Baron : les objets gagnés à la Salle des ventes, et la récompense de la collection complète. */
  collection: Collection;
  collectionComplete: boolean;
  /** Cadres d'avatar spéciaux gagnés (« collectionneur » : l'album ; « mecene » : la collection). */
  cadres: string[];
  /** Grand Hôtel : la Semaine du Baron (jours pris, 0 lundi … 6 dimanche), les mises et gains de la semaine (pour la
   * Ristourne du lundi), et le dernier jour du champagne du Penthouse. */
  semaineBaron: { semaine: string; pris: number[] };
  pertes: { semaine: string; mise: number; gain: number };
  champagne?: string;
  /** La Bourse de 1929 : les actions du joueur. */
  portefeuille: Portefeuille;
  /** Le Marché noir du jour, et le cadre spécial porté (null : le plus beau gagné). */
  marche: EtatMarche;
  cadreChoisi: string | null;
  /** Le Tailleur : les tenues achetées (numéros d'avatar) et celle portée au salon (null : le personnage du compte). */
  tenues: number[];
  tenue: number | null;
  /** Le cadeau de bienvenue du compte a été remis. */
  bienvenue?: boolean;
  /** La récompense des premiers pas (visite guidée du Groom) a été remise. */
  premiersPas?: boolean;
  /** Les missions des jeux (avancement) et leurs trophées gagnés (shared/missions.ts). */
  missions: Partial<Record<string, number>>;
  trophees: IdTrophee[];
  /** Missions permanentes : coups gagnants comptés à chaque jeu. */
  gagnes: Partial<Record<JeuCasino, number>>;
}

/** Petit hasard reproductible (le même jour donne les mêmes contrats, même si le serveur redémarre). */
export function hasardGraine(graine: string): (n: number) => number {
  let h = 2166136261;
  for (let i = 0; i < graine.length; i++) h = Math.imul(h ^ graine.charCodeAt(i), 16777619);
  let x = h >>> 0 || 1;
  return (n: number) => {
    // xorshift32
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return n > 0 ? x % n : 0;
  };
}

/** Tire n contrats différents (et pas deux sur le même jeu), sans ceux de la liste « exclus ». */
export function tirerContrats(hasard: (n: number) => number, n: number, niveau: number, exclus: string[] = [], ouvert: JeuxOuverts = tousOuverts): Contrat[] {
  const pris: ModeleContrat[] = [];
  // Seulement des jeux que le joueur a déjà débloqués.
  const reste = CONTRATS_DU_JOUR.filter((m) => !exclus.includes(m.id) && (!m.jeu || ouvert(m.jeu)));
  while (pris.length < n && reste.length) {
    const m = reste.splice(hasard(reste.length), 1)[0];
    if (m.jeu && pris.some((p) => p.jeu === m.jeu)) continue;
    pris.push(m);
  }
  return pris.map((m) => ({ id: m.id, cible: m.cible(niveau), progres: 0, fait: false }));
}

/** « Jouer à N jeux différents » : jamais plus que le nombre de jeux ouverts au joueur. */
const jeuxPossibles = (ouvert: JeuxOuverts) => Math.max(1, JEUX_CASINO.filter(ouvert).length);
const cibleGrosCoup = (m: ModeleContrat, niveau: number, ouvert: JeuxOuverts) => (m.mesure === 'jeux' ? Math.min(m.cible(niveau), jeuxPossibles(ouvert)) : m.cible(niveau));
const grosCoupsNeufs = (niveau: number, ouvert: JeuxOuverts): Contrat[] => GROS_COUPS.map((m) => ({ id: m.id, cible: cibleGrosCoup(m, niveau, ouvert), progres: 0, fait: false }));

export function etatSalonVide(): EtatSalonJoueur {
  return {
    rubis: 0,
    contrats: { jour: '', liste: [], change: false, tous: false, jeux: [], victoires: [], semaine: '', grosCoups: [], jeuxSemaine: [] },
    album: {},
    albumComplet: false,
    collection: {},
    collectionComplete: false,
    cadres: [],
    semaineBaron: { semaine: '', pris: [] },
    pertes: { semaine: '', mise: 0, gain: 0 },
    portefeuille: {},
    marche: { jour: '', relances: 0, achats: [] },
    cadreChoisi: null,
    tenues: [],
    missions: {},
    trophees: [],
    gagnes: {},
    tenue: null,
  };
}

/** Nouveau jour, nouvelle semaine : les contrats repartent (le reste ne bouge pas). Renvoie true si quelque chose a changé. */
export function rafraichirContrats(e: EtatSalonJoueur, uid: string, jour: string, semaine: string, niveau: number, ouvert: JeuxOuverts = tousOuverts): boolean {
  const c = e.contrats;
  let change = false;
  if (c.jour !== jour) {
    e.contrats = { ...c, jour, liste: tirerContrats(hasardGraine(`${uid}|${jour}`), CONTRATS_PAR_JOUR, niveau, [], ouvert), change: false, tous: false, jeux: [], victoires: [] };
    change = true;
  }
  // Un contrat (pas encore commencé) sur un jeu encore fermé au joueur : on le remplace par un jeu qu'il peut jouer.
  const ferme = (x: Contrat) => {
    const j = modeleContrat(x.id)?.jeu;
    return !x.fait && x.progres === 0 && !!j && !ouvert(j);
  };
  if (e.contrats.liste.some(ferme)) {
    const hasard = hasardGraine(`${uid}|${jour}|niveau`);
    const liste = [...e.contrats.liste];
    for (let i = 0; i < liste.length; i++) {
      if (!ferme(liste[i])) continue;
      const jeuxPris = liste.filter((_, k) => k !== i).map((x) => modeleContrat(x.id)?.jeu).filter((j): j is JeuCasino => !!j);
      const exclus = [...liste.map((x) => x.id), ...CONTRATS_DU_JOUR.filter((m) => m.jeu && jeuxPris.includes(m.jeu)).map((m) => m.id)];
      const [nouveau] = tirerContrats(hasard, 1, niveau, exclus, ouvert);
      if (nouveau) liste[i] = nouveau;
    }
    e.contrats = { ...e.contrats, liste };
    change = true;
  }
  if (e.contrats.semaine !== semaine) {
    e.contrats = { ...e.contrats, semaine, grosCoups: grosCoupsNeufs(niveau, ouvert), jeuxSemaine: [] };
    change = true;
  }
  // « Jouer à 5 jeux différents » alors que le joueur n'en a que 4 d'ouverts : l'objectif s'adapte.
  const max = jeuxPossibles(ouvert);
  if (e.contrats.grosCoups.some((g) => !g.fait && modeleContrat(g.id)?.mesure === 'jeux' && g.cible > max)) {
    e.contrats = { ...e.contrats, grosCoups: e.contrats.grosCoups.map((g) => (!g.fait && modeleContrat(g.id)?.mesure === 'jeux' && g.cible > max ? { ...g, cible: max, fait: g.progres >= max } : g)) };
    change = true;
  }
  if (e.semaineBaron.semaine !== semaine) {
    e.semaineBaron = { semaine, pris: [] };
    change = true;
  }
  return change;
}

/** Change un contrat du jour pas encore rempli (une fois par jour) ; le nouveau n'est ni un contrat du jour ni sur le même jeu qu'eux. */
export function changerContrat(e: EtatSalonJoueur, index: number, niveau: number, hasard: (n: number) => number, ouvert: JeuxOuverts = tousOuverts): 'ok' | 'deja' | 'fait' | 'rubis' | 'introuvable' {
  const c = e.contrats;
  const ancien = c.liste[index];
  if (!ancien) return 'introuvable';
  if (ancien.fait) return 'fait';
  if (c.change) return 'deja';
  if (e.rubis < PRIX_CHANGER_CONTRAT) return 'rubis';
  const autres = c.liste.filter((_, i) => i !== index);
  const jeuxPris = autres.map((x) => modeleContrat(x.id)?.jeu).filter((j): j is JeuCasino => !!j);
  const exclus = [...c.liste.map((x) => x.id), ...CONTRATS_DU_JOUR.filter((m) => m.jeu && jeuxPris.includes(m.jeu)).map((m) => m.id)];
  const [nouveau] = tirerContrats(hasard, 1, niveau, exclus, ouvert);
  if (!nouveau) return 'introuvable';
  e.rubis -= PRIX_CHANGER_CONTRAT;
  e.contrats = { ...c, change: true, liste: c.liste.map((x, i) => (i === index ? nouveau : x)) };
  return 'ok';
}

// ---------------------------------------------------------------------------------------------------------------
// Les événements des jeux

export type EvenementJeu =
  | { type: 'mise'; jeu: JeuCasino; montant: number }
  /** derniereMise : la dernière mise du joueur à ce jeu (pour les gains « ×10 la mise »). */
  | { type: 'gain'; jeu: JeuCasino; montant: number; derniereMise: number }
  | { type: 'evenement'; nom: EvenementContrat };

/** Ce qu'un événement a rapporté (à verser par le serveur). */
export interface RecompensesContrats {
  /** Contrats du jour et gros coups remplis par cet événement. */
  contrats: { id: string; cible: number; semaine: boolean }[];
  /** Les 3 contrats du jour remplis (bonus). */
  tous: boolean;
  rubis: number;
  dollars: number;
  /** Morceaux d'album gagnés (à coller avec collerMorceau). */
  morceaux: (JeuCasino | null)[];
  /** Paliers de missions permanentes atteints. */
  paliers: { jeu: JeuCasino; cible: number; rubis: number }[];
}

const recompensesVides = (): RecompensesContrats => ({ contrats: [], tous: false, rubis: 0, dollars: 0, morceaux: [], paliers: [] });

/** Un coup gagnant : un gain plus grand que la mise (une mise simplement rendue, comme une égalité, ne compte pas). */
export const estVictoire = (ev: { montant: number; derniereMise: number }) => ev.montant > Math.max(0, ev.derniereMise);

/** Ce qu'un événement ajoute à un contrat (0 s'il ne le concerne pas). */
function apport(m: ModeleContrat, ev: EvenementJeu, nouveauJeu: boolean): number {
  if (ev.type === 'evenement') return m.mesure === 'evenement' && m.evenement === ev.nom ? 1 : 0;
  if (m.jeu && m.jeu !== ev.jeu) return 0;
  if (ev.type === 'mise') {
    if (ev.montant <= 0) return 0;
    if (m.mesure === 'tours') return 1;
    if (m.mesure === 'mise') return ev.montant;
    if (m.mesure === 'jeux') return nouveauJeu ? 1 : 0;
    return 0;
  }
  if (ev.montant <= 0) return 0;
  if (m.mesure === 'gain') return ev.montant;
  if (m.mesure === 'victoires') return estVictoire(ev) ? 1 : 0;
  if (m.mesure === 'gros') return ev.derniereMise > 0 && ev.montant >= (m.x ?? 10) * ev.derniereMise ? 1 : 0;
  return 0;
}

function avancer(liste: Contrat[], ev: EvenementJeu, nouveauJeu: boolean): Contrat[] {
  const finis: Contrat[] = [];
  for (const c of liste) {
    if (c.fait) continue;
    const m = modeleContrat(c.id);
    if (!m) continue;
    const plus = apport(m, ev, nouveauJeu);
    if (!plus) continue;
    c.progres = Math.min(c.cible, c.progres + plus);
    if (c.progres >= c.cible) {
      c.fait = true;
      finis.push(c);
    }
  }
  return finis;
}

/**
 * Fait avancer les contrats du jour et les gros coups de la semaine (l'état doit être rafraîchi pour le jour en cours).
 * La première victoire du jour à chaque jeu donne aussi un morceau de sa page d'album.
 */
export function noterEvenement(e: EtatSalonJoueur, ev: EvenementJeu, niveau: number): RecompensesContrats {
  const r = recompensesVides();
  const c = e.contrats;
  // Les listes sont modifiées en place : copies d'abord (l'état peut être partagé avec une vue).
  c.liste = c.liste.map((x) => ({ ...x }));
  c.grosCoups = c.grosCoups.map((x) => ({ ...x }));
  let nouveauJour = false;
  let nouvelleSemaine = false;
  if (ev.type === 'mise' && ev.montant > 0) {
    if (!c.jeux.includes(ev.jeu)) {
      c.jeux = [...c.jeux, ev.jeu];
      nouveauJour = true;
    }
    if (!c.jeuxSemaine.includes(ev.jeu)) {
      c.jeuxSemaine = [...c.jeuxSemaine, ev.jeu];
      nouvelleSemaine = true;
    }
  }
  for (const f of avancer(c.liste, ev, nouveauJour)) {
    const m = modeleContrat(f.id);
    r.contrats.push({ id: f.id, cible: f.cible, semaine: false });
    r.rubis += RUBIS_CONTRAT;
    r.dollars += dollarsContrat(niveau);
    r.morceaux.push(m?.jeu ?? null);
  }
  for (const f of avancer(c.grosCoups, ev, nouvelleSemaine)) {
    r.contrats.push({ id: f.id, cible: f.cible, semaine: true });
    r.rubis += RUBIS_GROS_COUP;
  }
  if (!c.tous && c.liste.length && c.liste.every((x) => x.fait)) {
    c.tous = true;
    r.tous = true;
    r.rubis += RUBIS_TOUS_CONTRATS;
  }
  // Missions permanentes : un coup gagnant de plus à ce jeu ; un palier franchi paie ses rubis et ses dollars.
  if (ev.type === 'gain' && estVictoire(ev) && JEUX_PERMANENTS.includes(ev.jeu)) {
    const n = (e.gagnes[ev.jeu] ?? 0) + 1;
    e.gagnes = { ...e.gagnes, [ev.jeu]: n };
    const k = PALIERS.indexOf(n);
    if (k >= 0) {
      r.paliers.push({ jeu: ev.jeu, cible: n, rubis: RUBIS_PALIERS[k] });
      r.rubis += RUBIS_PALIERS[k];
      r.dollars += dollarsPalier(k, niveau);
    }
  }
  if (ev.type === 'gain' && estVictoire(ev) && !c.victoires.includes(ev.jeu)) {
    c.victoires = [...c.victoires, ev.jeu];
    r.morceaux.push(ev.jeu);
  }
  return r;
}

// ---------------------------------------------------------------------------------------------------------------
// L'album

export const morceauxDe = (masque: number | undefined) => {
  let n = 0;
  for (let m = masque ?? 0; m; m &= m - 1) n++;
  return n;
};
export const pageComplete = (masque: number | undefined) => ((masque ?? 0) & PAGE_COMPLETE) === PAGE_COMPLETE;
export const albumComplet = (album: Partial<Record<JeuCasino, number>>) => JEUX_CASINO.every((j) => pageComplete(album[j]));

export interface MorceauColle {
  jeu: JeuCasino;
  case: number;
  /** Cette case a fini la page ; ce morceau a fini l'album. */
  page: boolean;
  album: boolean;
}

/**
 * Colle un morceau : sur la page du jeu demandé s'il lui en manque, sinon sur une autre page incomplète (au hasard).
 * Album déjà complet : null (le serveur donne un rubis à la place). Les rubis de la page et de l'album sont ajoutés.
 */
export function collerMorceau(e: EtatSalonJoueur, jeu: JeuCasino | null, hasard: (n: number) => number): MorceauColle | null {
  const incompletes = JEUX_CASINO.filter((j) => !pageComplete(e.album[j]));
  if (!incompletes.length) return null;
  const page = jeu && incompletes.includes(jeu) ? jeu : incompletes[hasard(incompletes.length)];
  const masque = e.album[page] ?? 0;
  const libres = Array.from({ length: MORCEAUX_PAGE }, (_, i) => i).filter((i) => !(masque & (1 << i)));
  const k = libres[hasard(libres.length)];
  e.album = { ...e.album, [page]: masque | (1 << k) };
  const finiPage = pageComplete(e.album[page]);
  if (finiPage) e.rubis = Math.min(RUBIS_MAX, e.rubis + RUBIS_PAGE);
  let finiAlbum = false;
  if (finiPage && !e.albumComplet && albumComplet(e.album)) {
    e.albumComplet = true;
    finiAlbum = true;
    e.rubis = Math.min(RUBIS_MAX, e.rubis + RUBIS_ALBUM);
    if (!e.cadres.includes('collectionneur')) e.cadres = [...e.cadres, 'collectionneur'];
  }
  return { jeu: page, case: k, page: finiPage, album: finiAlbum };
}

// ---------------------------------------------------------------------------------------------------------------
// Vue (téléphone) et relecture (Firestore)

export interface VueContrats {
  rubis: number;
  jour: Contrat[];
  /** Le bonus des 3 contrats, déjà versé ? Changer un contrat est-il encore possible aujourd'hui ? */
  tous: boolean;
  changeDispo: boolean;
  grosCoups: Contrat[];
  /** Fin des contrats du jour et de la semaine (ms). */
  finJour: number;
  finSemaine: number;
  album: Partial<Record<JeuCasino, number>>;
  albumComplet: boolean;
  /** Le dépannage est-il possible maintenant ? */
  depannage: boolean;
  dollarsDepannage: number;
  /** Bureau : objets différents de la collection, et cadres spéciaux gagnés. */
  objets: number;
  cadres: string[];
  /** Le cadre porté (null : le plus beau gagné). */
  cadreChoisi: string | null;
  /** Le Tailleur : tenues achetées et tenue portée. */
  tenues: number[];
  tenue: number | null;
  /** Les missions des jeux : avancement et trophées gagnés. */
  missions: Partial<Record<string, number>>;
  trophees: IdTrophee[];
  /** Missions permanentes : coups gagnants à chaque jeu. */
  gagnes: Partial<Record<JeuCasino, number>>;
}

/** Ce que le serveur envoie au téléphone quand un contrat se termine, un morceau se colle, ou une page se complète. */
export interface AnnonceContrats {
  contrats: { id: string; cible: number; semaine: boolean }[];
  tous: boolean;
  rubis: number;
  dollars: number;
  morceaux: { jeu: JeuCasino; case: number; page: boolean; album: boolean }[];
  /** Paliers de missions permanentes atteints. */
  paliers?: { jeu: JeuCasino; cible: number; rubis: number }[];
}

/** Le texte d'un contrat, avec son objectif ([français, anglais]). */
export function texteContrat(c: { id: string; cible: number }, format: (n: number, en: boolean) => string): [string, string] {
  const m = modeleContrat(c.id);
  if (!m) return ['Contrat', 'Contract'];
  const fr = estArgent(m) ? format(c.cible, false) : String(c.cible);
  const en = estArgent(m) ? format(c.cible, true) : String(c.cible);
  return [m.texte[0].replace('{n}', fr), m.texte[1].replace('{n}', en)];
}

const entier = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);
const texte = (v: unknown) => (typeof v === 'string' ? v.slice(0, 20) : '');
const jeux = (v: unknown): JeuCasino[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is JeuCasino => JEUX_CASINO.includes(x as JeuCasino)))] : []);
function contrats(v: unknown): Contrat[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && typeof (x as Record<string, unknown>).id === 'string' && !!modeleContrat((x as Record<string, unknown>).id as string))
    .slice(0, 6)
    .map((x) => {
      const cible = Math.max(1, entier(x.cible));
      return { id: x.id as string, cible, progres: Math.min(cible, entier(x.progres)), fait: x.fait === true };
    });
}

/** Relit l'état du salon d'un compte (tolère les champs manquants ou abîmés). */
export function normaliserEtatSalon(brut: unknown): EtatSalonJoueur {
  const e = etatSalonVide();
  if (!brut || typeof brut !== 'object') return e;
  const b = brut as Record<string, unknown>;
  e.rubis = Math.min(RUBIS_MAX, entier(b.rubis));
  const c = (b.contrats && typeof b.contrats === 'object' ? b.contrats : {}) as Record<string, unknown>;
  e.contrats = {
    jour: texte(c.jour),
    liste: contrats(c.liste),
    change: c.change === true,
    tous: c.tous === true,
    jeux: jeux(c.jeux),
    victoires: jeux(c.victoires),
    semaine: texte(c.semaine),
    grosCoups: contrats(c.grosCoups),
    jeuxSemaine: jeux(c.jeuxSemaine),
  };
  if (b.album && typeof b.album === 'object')
    for (const [j, m] of Object.entries(b.album as Record<string, unknown>)) if (JEUX_CASINO.includes(j as JeuCasino)) e.album[j as JeuCasino] = entier(m) & PAGE_COMPLETE;
  e.albumComplet = b.albumComplet === true;
  if (typeof b.depannage === 'string') e.depannage = texte(b.depannage);
  e.collection = normaliserCollection(b.collection);
  e.collectionComplete = b.collectionComplete === true;
  e.cadres = Array.isArray(b.cadres) ? [...new Set(b.cadres.filter((x): x is string => x === 'collectionneur' || x === 'mecene' || CADRES_MARCHE.includes(x as never)))] : [];
  const sb = (b.semaineBaron && typeof b.semaineBaron === 'object' ? b.semaineBaron : {}) as Record<string, unknown>;
  e.semaineBaron = { semaine: texte(sb.semaine), pris: Array.isArray(sb.pris) ? [...new Set(sb.pris.filter((x): x is number => Number.isInteger(x) && x >= 0 && x <= 6))] : [] };
  const pe = (b.pertes && typeof b.pertes === 'object' ? b.pertes : {}) as Record<string, unknown>;
  e.pertes = { semaine: texte(pe.semaine), mise: entier(pe.mise), gain: entier(pe.gain) };
  if (typeof b.champagne === 'string') e.champagne = texte(b.champagne);
  e.portefeuille = normaliserPortefeuille(b.portefeuille);
  e.marche = normaliserMarche(b.marche);
  e.cadreChoisi = typeof b.cadreChoisi === 'string' && e.cadres.includes(b.cadreChoisi) ? b.cadreChoisi : null;
  e.tenues = normaliserTenues(b.tenues);
  e.tenue = estTenue(b.tenue) && e.tenues.includes(b.tenue) ? b.tenue : null;
  if (b.bienvenue === true) e.bienvenue = true;
  if (b.premiersPas === true) e.premiersPas = true;
  const mi = normaliserMissions(b.missions, b.trophees);
  e.missions = mi.missions;
  e.trophees = mi.trophees;
  if (b.gagnes && typeof b.gagnes === 'object')
    for (const [j, n] of Object.entries(b.gagnes as Record<string, unknown>)) if (JEUX_PERMANENTS.includes(j as JeuCasino)) e.gagnes[j as JeuCasino] = entier(n);
  // L'album complet donne son cadre (comptes d'avant le cadre compris).
  if (e.albumComplet && !e.cadres.includes('collectionneur')) e.cadres.push('collectionneur');
  return e;
}
