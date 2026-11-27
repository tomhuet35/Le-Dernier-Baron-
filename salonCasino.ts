/**
 * Salon privé du Baron (casino des comptes Créateur) : solde, roulette du salon, machines à sous, tables, le show
 * La Folle Nuit, les Coffres du Baron, le Vol de la Couronne, la Chute des Écus, la Course des Écuries, le gros lot
 * progressif, et le jeu à l'affiche (toutes les 3 heures, un jeu compte double pour l'XP et donne 10 % de bonus sur
 * ses gains).
 *
 * - Chaque événement casino_* vérifie que le compte connecté a le badge Créateur ; sinon « Introuvable. », sans dire
 *   que le casino existe.
 * - Le serveur est seul maître de l'argent : le téléphone envoie une mise, le serveur la vérifie, la débite, tire le
 *   résultat (crypto.randomInt) et crédite le gain. Le solde ne passe jamais sous zéro.
 * - Le solde de chaque créateur est tenu en mémoire pendant qu'il joue ; les mouvements sont écrits dans Firestore par
 *   transaction, regroupés (au plus une écriture toutes les 5 s, et à la sortie du salon ou à la déconnexion).
 * - Gros lot et « plus riches du salon » : document « casino » de la collection « parametres ».
 * - Profil du casino (à part du jeu de cartes) : chaque mise et chaque gain de chaque jeu passe par « suivre » (XP,
 *   niveaux et leurs bonus, statistiques par jeu, scores des défis). Amis du casino, envois d'argent entre amis, et
 *   défis 1 contre 1 (defisCasino.ts, gardés avec les réglages du serveur).
 */
import { estMisePlinko, lacherBille, MULTI_MAX_PLINKO } from '../shared/plinko';
import { randomInt } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import {
  cadeauDisponible,
  CADEAUX_SALON,
  formatDollars,
  CASES_ROUE_SALON,
  GROS_GAIN_ROUE,
  GROS_LOT_DEPART,
  MULTIPLE_GROS_GAIN,
  PART_GROS_LOT,
  SOLDE_MAX,
  partGrosLot,
  type AnnonceCasino,
  type CadeauSalon,
  type RicheSalon,
  type VueBonusMachine,
  type VueCasino,
} from '../shared/casino';
import { jouerBulles, MISES_BULLES } from '../shared/bulles';
import { gainCasse, MISES_MACHINE, nouveauCasse, ouvrirCasse, ROUE_BARON, TOURS_GRATUITS_MAX, tirerMachine, type EtatCasse } from '../shared/machineASous';
import { jourParis, lendemainParis } from '../shared/roulette';
import {
  changerContrat,
  collerMorceau,
  dollarsDepannage,
  normaliserEtatSalon,
  noterEvenement,
  PRIX_CHANGER_CONTRAT,
  PRIX_DEPANNAGE,
  rafraichirContrats,
  RUBIS_MAX,
  SEUIL_DEPANNAGE,
  type AnnonceContrats,
  type EtatSalonJoueur,
  type EvenementJeu,
  type RecompensesContrats,
  type VueContrats,
} from '../shared/contrats';
import { semaineDe } from './classement';
import { creerVentes } from './ventesCasino';
import { creerCercles, type ResultatCercle } from './cerclesCasino';
import { creerBourse } from './bourseCasino';
import { avatarCasino, tenue as tenueDe } from '../shared/tailleur';
import { etal, PRIX_RELANCE, rafraichirMarche, RELANCES_MAX, valeurObjetMarche, type VueMarche } from '../shared/marche';
import { ACTIONS_MAX, acheter, devisAchat, estAction, MONTANTS_ACHAT, produitVente, vendre, type VueBourse } from '../shared/bourse';
import { CADEAU_COMPTE, cadeauSemaine, carteMembre, champagnePenthouse, etageOuvert, happyHour, jeuOuvert, jourSemaineParis, ristourne, type AnnonceHotel, type JeuNiveau, type VueHotel } from '../shared/hotel';
import {
  ajouterObjet,
  cadreSpecial,
  objetsDifferents,
  normaliserCollection,
  valeurCollection,
  type AnnonceVente,
  type CollectionneurSalon,
  type Lot,
  type Monnaie,
  type VueBureau,
} from '../shared/ventes';
import type { ExtraCasino, Identite, ServiceComptes, StatsCompte } from './comptes';
import {
  bonusNiveauCasino,
  ENVOI_MAX_JOUR,
  estJeuCasino,
  JOURNAL_MAX,
  MONTANTS_ENVOI,
  niveauCasino,
  progressionCasino,
  xpDeMises,
  type BilanDefis,
  type EntreeJournalCasino,
  type JeuCasino,
  type JoueurCasino,
  type PositionCasino,
  type ProfilCasino,
  type StatsJeuCasino,
  type VueAmisCasino,
} from '../shared/profilCasino';
import { creerDefis } from './defisCasino';
import { creerTablesBlackjack, type BanqueCasino, type DelaisTables } from './tablesCasino';
import { creerTablesRoulette, type DelaisRoulette } from './tablesRoulette';
import { dureeAnimationNuits, etatNuitsVide, jouerNuits, meilleurJackpot, type EtatNuits, type ForcerNuits } from '../shared/machineNuits';
import type { CarteBJ } from '../shared/blackjack';
import type { DureesFN } from '../shared/folleNuit';
import { creerShowFolleNuit, type TirageImpose } from './showFolleNuit';
import { creerCoffres } from './festinCasino';
import { creerVolCouronne } from './couronneCasino';
import { creerChute } from './chuteCasino';
import { creerTickets } from './ticketsCasino';
import { creerToits } from './toitsCasino';
import { creerCourse } from './courseCasino';
import { creerBaronWheel } from './baronWheelCasino';
import { creerBalWheel } from './balWheelCasino';
import { CADEAU_OUVERTURE_BW, DUREE_OUVERTURE_BW, evenementsBW, ROUE_BW, type BoostBW, type CaseBW, type DureesBW } from '../shared/baronWheel';
import type { DureesCourse } from '../shared/course';
import { afficheCasino, BONUS_AFFICHE, PLAFOND_BONUS_AFFICHE, XP_AFFICHE, type AfficheCasino } from '../shared/afficheCasino';
import type { DureesCouronne } from '../shared/couronne';

/**
 * Le grand spectacle de la roue du Baron (heure de Paris) : dans ce créneau, les premières manches s'arrêtent, une par
 * une et dans l'ordre, sur les cases demandées (avec ×x posé dessus par le Top Slot si x est donné, sinon au hasard ; la
 * Chaudière peut aussi avoir son point d'explosion imposé).
 */
const SPECTACLE_BW: { debut: number; fin: number; manches: { c: CaseBW; x?: number; explosion?: number }[] } = {
  debut: Date.parse('2026-11-25T10:29:00+01:00'),
  fin: Date.parse('2026-11-25T11:30:00+01:00'),
  manches: [{ c: 'controleur' }, { c: 'course' }, { c: 'chaudiere' }, { c: 'restaurant' }, { c: 'express' }],
};

type Reponse = { ok: true; [cle: string]: unknown } | { ok: false; erreur: string; casino?: VueCasino };
type Rappel = (r: Reponse) => void;

export interface OptionsCasino {
  io: Server;
  comptes: ServiceComptes;
  horloge?: () => number;
  /** Case de la roulette du salon (remplaçable pour les tests ; au hasard sinon). */
  tirageRoue?: () => number;
  /** Hasard de la machine à sous : entier de 0 à n − 1 (remplaçable pour les tests). */
  hasardMachine?: (n: number) => number;
  /** Case de la Roue du Baron (remplaçable pour les tests ; au hasard sinon). */
  tirageRoueBaron?: () => number;
  /** Mélange des coffres du casse (remplaçable pour les tests ; au hasard sinon). */
  hasardCasse?: (n: number) => number;
  /** Regroupement des écritures du solde, en millisecondes. */
  delaiEcriture?: number;
  /** Casino ouvert à tous (son propre site) : tout compte, invités compris, entre ; sinon badge Créateur seulement. */
  ouvert?: boolean;
  /** Les cadeaux du Baron (remplaçables pour les tests). */
  cadeaux?: CadeauSalon[];
  /** Blackjack : délais et sabot (remplaçables pour les tests). */
  delaisTables?: Partial<DelaisTables>;
  sabotBlackjack?: () => CarteBJ[];
  /** Roulette : délais et numéro tiré (remplaçables pour les tests). */
  delaisRoulette?: Partial<DelaisRoulette>;
  tirageRoulette?: () => number;
  /** Les Nuits du Baron : hasard des rouleaux, et tirage imposé (tests, démonstration). */
  hasardNuits?: (n: number) => number;
  forcerNuits?: () => ForcerNuits | undefined;
  /** La Folle Nuit : délais, hasard, et arrêt de la roue imposé (tests, démonstration). */
  delaisFolleNuit?: Partial<DureesFN>;
  hasardFolleNuit?: (n: number) => number;
  tirageFolleNuit?: () => TirageImpose;
  /** Les Coffres du Baron : hasard, et positions des badges de police imposées (tests, démonstration). */
  hasardCoffres?: (n: number) => number;
  placerBadgesCoffres?: (badges: number) => number[] | undefined;
  /** Le hasard des sauts de « Sur les toits » (tests, démonstration) ; au hasard sinon. */
  hasardToits?: (n: number) => number;
  /** Le Vol de la Couronne : délais, vitesse de montée et point de la pie imposé (tests, démonstration). */
  delaisCouronne?: Partial<DureesCouronne>;
  kCouronne?: number;
  tirageCouronne?: () => number | undefined;
  /** La Chute des Écus : rebonds et chemin imposés, délai de l'annonce (tests, démonstration). */
  hasardChute?: () => number;
  cheminChute?: (rangees: number) => number[] | undefined;
  delaiAnnonceChute?: number;
  /** Défis entre amis : durées accélérées (tests). */
  echelleDefis?: number;
  /** La Course des Écuries : délais, et ordre d'arrivée imposé (tests, démonstration). */
  delaisCourse?: Partial<DureesCourse>;
  arriveeCourse?: () => number[] | undefined;
  /** The Baron's Wheel : délais, case d'arrêt imposée, et fin de la grande ouverture (tests, démonstration). */
  delaisBaronWheel?: Partial<DureesBW>;
  arretBaronWheel?: () => number | undefined;
  multiplicateursBaronWheel?: () => BoostBW[] | undefined;
  ouvertureBaronWheel?: () => number | null;
  /** Le jeu à l'affiche à l'instant t (remplaçable pour les tests et la démonstration ; null : aucun). */
  jeuALaffiche?: (t: number) => AfficheCasino | null;
}

/** Porte-monnaie d'un créateur, tenu en mémoire pendant qu'il joue. */
interface Porte {
  nom: string;
  avatar: number;
  /** Le personnage du compte (sans tenue du Tailleur). */
  avatarCompte: number;
  /** Solde à jour (ce qui est dans Firestore + ce qui attend d'y être écrit). */
  solde: number;
  enAttente: number;
  record: number;
  roue?: string;
  cadeaux: string[];
  toursGratuits: number;
  miseGratuite: number;
  /** Les Nuits du Baron : free games et rouleaux figés. */
  nuits: EtatNuits;
  /** Bonus de la machine à jouer, dans l'ordre (casse puis roue si les deux tombent ensemble). */
  bonus: BonusMachine[];
  minuterie: ReturnType<typeof setTimeout> | null;
  ecriture: Promise<void>;
  /** Un tour à la fois : un double appui ne débite jamais deux fois. */
  occupe: boolean;
  dernierTour: number;
  /** Profil du casino : premier passage, totaux misé et gagné (l'XP en découle), par jeu, plus gros gain écrit. */
  depuis: number;
  mise: number;
  /** Mises comptées en plus pour l'XP (jeu à l'affiche). */
  bonusXp: number;
  /** Bonus de gains déjà touché pendant le créneau du jeu à l'affiche (début du créneau). */
  affiche: { debut: number; bonus: number };
  gagne: number;
  jeux: Partial<Record<JeuCasino, StatsJeuCasino>>;
  plusGrosGain: number;
  niveauPaye: number;
  amis: string[];
  recues: string[];
  envoyees: string[];
  envois: { jour: string; total: number };
  journal: EntreeJournalCasino[];
  defisBilan: BilanDefis;
  /** Ce qui attend d'être écrit, en plus du solde. */
  activite: NonNullable<ExtraCasino['activite']> | null;
  journalAjouts: EntreeJournalCasino[];
  defisAjouts: BilanDefis | null;
  niveauAEcrire: boolean;
  envoisAEcrire: boolean;
  /** Grand Hôtel : rubis, contrats, album (à écrire s'il a changé), et la dernière mise à chaque jeu (en mémoire). */
  salonJ: EtatSalonJoueur;
  salonAEcrire: boolean;
  dernieresMises: Partial<Record<JeuCasino, number>>;
  /** Écritures lancées (compteur) et en cours : pas de recalage sur un compte lu pendant une écriture. */
  ecrituresLancees: number;
  ecrituresEnVol: number;
}

type BonusMachine = { type: 'casse'; mise: number; etat: EtatCasse } | { type: 'roue'; mise: number };

const SALLE = 'casino';
const INTROUVABLE: Reponse = { ok: false, erreur: 'Introuvable.' };
/** Délai minimal entre deux tours de machine (les rouleaux tournent bien plus longtemps à l'écran). */
const ECART_TOURS_MS = 350;
const ETAGE_FERME: [string, string] = ['Ce jeu n’est pas encore ouvert pour toi : monte de niveau !', 'This game isn’t open to you yet: level up!'];

export function creerCasino(options: OptionsCasino) {
  const { io, comptes } = options;
  const horloge = options.horloge ?? Date.now;
  const delaiEcriture = options.delaiEcriture ?? 5000;
  const hasardMachine = options.hasardMachine ?? ((n: number) => randomInt(n));
  const hasardNuits = options.hasardNuits ?? ((n: number) => randomInt(n));
  const tirageRoue = options.tirageRoue ?? (() => randomInt(CASES_ROUE_SALON.length));
  const tirageRoueBaron = options.tirageRoueBaron ?? (() => randomInt(ROUE_BARON.length));
  const hasardCasse = options.hasardCasse ?? ((n: number) => randomInt(n));
  const cadeaux = options.cadeaux ?? CADEAUX_SALON;
  const jeuALaffiche = options.jeuALaffiche ?? afficheCasino;
  /** Heure d'ouverture des cadeaux à durée (gardée avec les réglages du serveur). */
  const ouvertures: Record<string, number> = {};

  const portes = new Map<string, Porte>();
  /** Téléphones au salon, par compte (en ligne), et où joue chacun (le téléphone qui l'a dit en dernier). */
  const presents = new Map<string, Set<string>>();
  const positions = new Map<string, { ecran: PositionCasino['ecran']; sid: string }>();
  const createurs = new Map<string, { ok: boolean; t: number }>();
  let grosLot = GROS_LOT_DEPART;
  const riches = new Map<string, { nom: string; avatar: number; solde: number; niveau?: number }>();
  let minuterieSalon: ReturnType<typeof setTimeout> | null = null;
  let dernierGrosLotDiffuse = 0;
  /** Salle des ventes : les lots gardés (lus au démarrage), et la plus belle collection de chaque joueur. */
  let brutVentes: unknown = undefined;
  const collections = new Map<string, CollectionneurSalon>();

  // Gros lot et plus riches, gardés avec les réglages du serveur.
  const chargement = comptes
    .lireParametre('casino')
    .then((brut) => {
      const d = (brut ?? {}) as { grosLot?: unknown; riches?: unknown; ouvertures?: unknown; defis?: unknown; ventes?: unknown; collections?: unknown };
      brutVentes = d.ventes;
      if (d.collections && typeof d.collections === 'object') {
        for (const [uid, r] of Object.entries(d.collections as Record<string, unknown>)) {
          const x = r as { nom?: unknown; avatar?: unknown; valeur?: unknown; objets?: unknown; cadre?: unknown };
          if (typeof x?.valeur === 'number' && x.valeur > 0 && !collections.has(uid))
            collections.set(uid, {
              uid,
              nom: typeof x.nom === 'string' ? x.nom : '',
              avatar: typeof x.avatar === 'number' ? x.avatar : 1,
              valeur: x.valeur,
              objets: typeof x.objets === 'number' ? x.objets : 0,
              cadre: x.cadre === 'mecene' || x.cadre === 'collectionneur' ? x.cadre : null,
            });
        }
      }
      if (d.ouvertures && typeof d.ouvertures === 'object')
        for (const [k, v] of Object.entries(d.ouvertures as Record<string, unknown>)) if (typeof v === 'number' && Number.isFinite(v)) ouvertures[k] = v;
      if (typeof d.grosLot === 'number' && Number.isFinite(d.grosLot) && d.grosLot >= GROS_LOT_DEPART) grosLot = Math.floor(d.grosLot);
      if (d.riches && typeof d.riches === 'object') {
        for (const [uid, r] of Object.entries(d.riches as Record<string, unknown>)) {
          const x = r as { nom?: unknown; avatar?: unknown; solde?: unknown; niveau?: unknown };
          if (typeof x?.solde === 'number' && !riches.has(uid))
            riches.set(uid, { nom: typeof x.nom === 'string' ? x.nom : '', avatar: typeof x.avatar === 'number' ? x.avatar : 1, solde: x.solde, ...(typeof x.niveau === 'number' ? { niveau: x.niveau } : {}) });
        }
      }
      defis.importer(d.defis);
    })
    .catch((e) => console.error('Casino : lecture des réglages impossible :', e))
    .then(() => {
      ventes.importer(brutVentes);
      // Un cadeau à durée s'ouvre la première fois que le serveur le voit : son heure d'ouverture est gardée.
      const nouveaux = cadeaux.filter((c) => c.duree !== undefined && ouvertures[c.id] === undefined);
      for (const c of nouveaux) ouvertures[c.id] = horloge();
      if (nouveaux.length) sauverSalon();
    });

  const sauverSalon = () => {
    if (minuterieSalon) return;
    minuterieSalon = setTimeout(() => {
      minuterieSalon = null;
      void comptes.ecrireParametre('casino', reglagesSalon()).catch((e) => console.error('Casino : écriture impossible :', e));
    }, delaiEcriture);
  };
  const reglagesSalon = () => ({ grosLot, riches: Object.fromEntries(riches), ouvertures, defis: defis.exporter(), ventes: ventes.exporter(), collections: Object.fromEntries(collections) });

  async function estCreateur(uid: string): Promise<boolean> {
    const c = createurs.get(uid);
    if (c && horloge() - c.t < 60_000) return c.ok;
    const stats = await comptes.lire(uid).catch(() => null);
    const ok = options.ouvert ? !!stats : stats?.createur === true;
    createurs.set(uid, { ok, t: horloge() });
    return ok;
  }

  /** Écrit dans Firestore ce qui attend (à la suite des écritures déjà lancées). */
  function ecrire(uid: string): Promise<void> {
    const p = portes.get(uid);
    if (!p) return Promise.resolve();
    if (p.minuterie) clearTimeout(p.minuterie);
    p.minuterie = null;
    const delta = p.enAttente;
    const record = p.record;
    const extra: ExtraCasino = {};
    if (p.activite) extra.activite = p.activite;
    if (p.niveauAEcrire) extra.niveauPaye = p.niveauPaye;
    if (p.envoisAEcrire) extra.envois = { ...p.envois };
    if (p.journalAjouts.length) extra.journal = p.journalAjouts;
    if (p.defisAjouts) extra.defis = p.defisAjouts;
    if (p.salonAEcrire) extra.salon = JSON.parse(JSON.stringify(p.salonJ)) as EtatSalonJoueur;
    if (!delta && !record && !Object.keys(extra).length) return p.ecriture;
    p.enAttente = 0;
    p.record = 0;
    p.plusGrosGain = Math.max(p.plusGrosGain, record);
    p.activite = null;
    p.niveauAEcrire = false;
    p.envoisAEcrire = false;
    p.journalAjouts = [];
    p.defisAjouts = null;
    p.salonAEcrire = false;
    p.ecrituresLancees += 1;
    p.ecrituresEnVol += 1;
    p.ecriture = p.ecriture
      .then(() => comptes.mouvementCasino(uid, delta, record || undefined, Object.keys(extra).length ? extra : undefined))
      .then(() => undefined)
      .catch((e) => {
        console.error('Casino : écriture du solde impossible :', e);
        // Réessayé à la prochaine écriture : tout ce qui n'est pas parti y retourne.
        p.enAttente += delta;
        p.record = Math.max(p.record, record);
        if (extra.activite) {
          const a = p.activite ?? (p.activite = { mise: {}, gain: {} });
          for (const [j, m] of Object.entries(extra.activite.mise) as [JeuCasino, number][]) a.mise[j] = (a.mise[j] ?? 0) + m;
          for (const [j, g] of Object.entries(extra.activite.gain) as [JeuCasino, number][]) a.gain[j] = (a.gain[j] ?? 0) + g;
          if (extra.activite.bonusXp) a.bonusXp = (a.bonusXp ?? 0) + extra.activite.bonusXp;
        }
        if (extra.niveauPaye !== undefined) p.niveauAEcrire = true;
        if (extra.envois) p.envoisAEcrire = true;
        if (extra.journal) p.journalAjouts = [...p.journalAjouts, ...extra.journal].slice(0, JOURNAL_MAX);
        if (extra.defis) p.defisAjouts = ajouterBilan(p.defisAjouts, extra.defis);
        if (extra.salon) p.salonAEcrire = true;
        planifier(uid, p);
      })
      .finally(() => {
        p.ecrituresEnVol -= 1;
      });
    return p.ecriture;
  }

  /** Une écriture dans quelques secondes (regroupée avec les suivantes). */
  function planifier(uid: string, p: Porte) {
    if (!p.minuterie) p.minuterie = setTimeout(() => void ecrire(uid), delaiEcriture);
  }
  const ajouterBilan = (a: BilanDefis | null, b: BilanDefis): BilanDefis => ({ gagnes: (a?.gagnes ?? 0) + b.gagnes, perdus: (a?.perdus ?? 0) + b.perdus, nuls: (a?.nuls ?? 0) + b.nuls });
  const niveauDe = (p: Porte) => niveauCasino(xpDeMises(p.mise + p.bonusXp));
  const majRiche = (uid: string, p: Porte) => riches.set(uid, { nom: p.nom, avatar: p.avatar, solde: p.solde, niveau: niveauDe(p) });

  /** Envoie un événement aux téléphones d'un joueur qui sont au salon. */
  function notifier(uid: string, evenement: string, data: unknown) {
    for (const sid of presents.get(uid) ?? []) io.to(sid).emit(evenement, data);
  }

  /** Ajoute une ligne au journal d'un joueur (écrite avec son solde, ou tout de suite s'il n'est pas là). */
  function noterJournal(uid: string, e: EntreeJournalCasino, bilan?: BilanDefis) {
    const p = portes.get(uid);
    if (!p) return void comptes.mouvementCasino(uid, 0, undefined, { journal: [e], ...(bilan ? { defis: bilan } : {}) }).catch((x) => console.error('Casino : journal perdu :', x));
    p.journal = [e, ...p.journal].slice(0, JOURNAL_MAX);
    p.journalAjouts = [e, ...p.journalAjouts].slice(0, JOURNAL_MAX);
    if (bilan) {
      p.defisBilan = ajouterBilan(p.defisBilan, bilan);
      p.defisAjouts = ajouterBilan(p.defisAjouts, bilan);
    }
    planifier(uid, p);
  }

  /** Verse de l'argent hors jeu (envoi d'un ami, défi) : au porte-monnaie s'il est en mémoire, sinon dans Firestore. */
  function verserHorsJeu(uid: string, montant: number) {
    if (montant <= 0) return;
    const p = portes.get(uid);
    if (p) {
      mouvement(uid, p, montant);
      notifier(uid, 'casino_solde', p.solde);
    } else void comptes.mouvementCasino(uid, montant).catch((e) => console.error('Casino : versement perdu :', e));
  }

  /**
   * Chaque mise et chaque gain des jeux passe ici : totaux et statistiques par jeu (profil), XP et niveaux (avec leur
   * bonus), scores des défis. Une mise rendue (annulée avant d'être jouée) arrive en négatif.
   */
  function suivre(uid: string, jeu: JeuCasino, misee: number, gagnee: number) {
    const p = portes.get(uid);
    if (p) {
      // Grand Hôtel : les mises et gains de la semaine (Ristourne du lundi).
      rafraichirSalon(uid, p);
      p.salonJ.pertes = { ...p.salonJ.pertes, mise: Math.max(0, p.salonJ.pertes.mise + misee), gain: p.salonJ.pertes.gain + Math.max(0, gagnee) };
      p.salonAEcrire = true;
      const avant = niveauDe(p);
      p.mise = Math.max(0, p.mise + misee);
      p.gagne = Math.max(0, p.gagne + gagnee);
      const s = p.jeux[jeu] ?? { mise: 0, gain: 0 };
      p.jeux[jeu] = { mise: Math.max(0, s.mise + misee), gain: Math.max(0, s.gain + gagnee) };
      const a = p.activite ?? (p.activite = { mise: {}, gain: {} });
      if (misee) a.mise[jeu] = (a.mise[jeu] ?? 0) + misee;
      if (gagnee) a.gain[jeu] = (a.gain[jeu] ?? 0) + gagnee;
      // Le jeu à l'affiche : ses mises comptent double pour l'XP (une mise rendue est retirée aussi), et ses gains
      // reçoivent 10 % de bonus, jusqu'au plafond du créneau.
      const aff = jeuALaffiche(horloge());
      if (aff?.jeu === jeu) {
        if (misee) {
          const extra = misee > 0 ? misee * (XP_AFFICHE - 1) : Math.max(misee * (XP_AFFICHE - 1), -p.bonusXp);
          p.bonusXp += extra;
          a.bonusXp = (a.bonusXp ?? 0) + extra;
        }
        if (gagnee > 0) {
          if (p.affiche.debut !== aff.debut) p.affiche = { debut: aff.debut, bonus: 0 };
          const bonus = Math.min(PLAFOND_BONUS_AFFICHE - p.affiche.bonus, Math.floor(gagnee * BONUS_AFFICHE));
          if (bonus > 0) {
            p.affiche.bonus += bonus;
            mouvement(uid, p, bonus);
            notifier(uid, 'casino_affiche', { jeu, bonus, total: p.affiche.bonus, debut: aff.debut });
          }
        }
      }
      // Happy hour (11 h – 12 h et 21 h – 22 h à Paris) : les mises comptent double pour l'XP (une mise rendue est retirée aussi).
      if (misee && happyHour(horloge()).enCours) {
        const extra = misee > 0 ? misee : Math.max(misee, -p.bonusXp);
        p.bonusXp += extra;
        a.bonusXp = (a.bonusXp ?? 0) + extra;
      }
      // Grande ouverture de The Baron's Wheel, ou Grand Départ du week-end : ses mises comptent double pour l'XP (une seule fois si elle est aussi à l'affiche).
      if (jeu === 'baronWheel' && aff?.jeu !== jeu && misee) {
        const fo = finOuvertureBW();
        if ((fo !== null && fo > horloge()) || evenementsBW(horloge()).some((e) => e.type === 'depart')) {
          const extra = misee > 0 ? misee * (XP_AFFICHE - 1) : Math.max(misee * (XP_AFFICHE - 1), -p.bonusXp);
          p.bonusXp += extra;
          a.bonusXp = (a.bonusXp ?? 0) + extra;
        }
      }
      planifier(uid, p);
      const apres = niveauDe(p);
      if (apres > p.niveauPaye) monterNiveau(uid, p, apres);
      if (apres !== avant) majRiche(uid, p);
      // Contrats du salon et album : une mise placée, un gain versé (une mise rendue ne compte pas).
      if (misee > 0) {
        cercles.noterMise(uid, misee);
        p.dernieresMises[jeu] = misee;
        noterContrat(uid, p, { type: 'mise', jeu, montant: misee });
      }
      if (gagnee > 0) noterContrat(uid, p, { type: 'gain', jeu, montant: gagnee, derniereMise: p.dernieresMises[jeu] ?? 0 });
    }
    defis.noter(uid, jeu, gagnee - misee);
  }

  // -------------------------------------------------------------------------------------------------------------
  // Grand Hôtel du Baron : contrats, album et rubis (shared/contrats.ts)

  /** Nouveau jour, nouvelle semaine : de nouveaux contrats. */
  function rafraichirSalon(uid: string, p: Porte) {
    const t = horloge();
    const semaine = semaineDe(t).cle;
    // Nouvelle semaine : la Ristourne du Baron (carte noire) rend une part des pertes de la semaine passée.
    if (p.salonJ.pertes.semaine !== semaine) {
      const { semaine: avant, mise, gain } = p.salonJ.pertes;
      p.salonJ.pertes = { semaine, mise: 0, gain: 0 };
      p.salonAEcrire = true;
      const montant = avant ? ristourne(niveauDe(p), mise, gain) : 0;
      if (montant > 0) {
        mouvement(uid, p, montant);
        const a: AnnonceHotel = { type: 'ristourne', montant };
        notifier(uid, 'casino_hotel', a);
      }
      planifier(uid, p);
    }
    if (rafraichirContrats(p.salonJ, uid, jourParis(t), semaine, niveauDe(p), (j) => ouvertPour(p, j))) {
      p.salonAEcrire = true;
      planifier(uid, p);
    }
  }

  /** Un événement des jeux : les contrats avancent, et ce qu'ils rapportent est versé. */
  function noterContrat(uid: string, p: Porte, ev: EvenementJeu) {
    rafraichirSalon(uid, p);
    const r = noterEvenement(p.salonJ, ev, niveauDe(p));
    verserContrats(uid, p, r);
    // La progression a pu bouger sans récompense : elle part avec la prochaine écriture (regroupée).
    p.salonAEcrire = true;
    planifier(uid, p);
  }

  /** Verse les rubis, les dollars et les morceaux d'album gagnés, et prévient le téléphone. */
  function verserContrats(uid: string, p: Porte, r: RecompensesContrats) {
    if (!r.contrats.length && !r.morceaux.length && !r.rubis && !r.dollars) return;
    const e = p.salonJ;
    const rubisAvant = e.rubis;
    const annonce: AnnonceContrats = { contrats: r.contrats, tous: r.tous, rubis: 0, dollars: r.dollars, morceaux: [] };
    e.rubis = Math.min(RUBIS_MAX, e.rubis + r.rubis);
    for (const jeu of r.morceaux) {
      // Une page (ou l'album) complétée ajoute ses rubis ; l'album déjà complet donne un rubis à la place du morceau.
      const m = collerMorceau(e, jeu, (n) => randomInt(Math.max(1, n)));
      if (m) annonce.morceaux.push(m);
      else e.rubis = Math.min(RUBIS_MAX, e.rubis + 1);
    }
    annonce.rubis = e.rubis - rubisAvant;
    if (r.dollars > 0) mouvement(uid, p, r.dollars);
    p.salonAEcrire = true;
    planifier(uid, p);
    notifier(uid, 'casino_contrats', annonce);
  }

  /** Un événement nommé (bonus de la machine, jackpot, défi gagné) pour les contrats d'un joueur présent. */
  function evenementContrat(uid: string, nom: 'bonusMachine' | 'jackpot' | 'defiGagne') {
    const p = portes.get(uid);
    if (p) noterContrat(uid, p, { type: 'evenement', nom });
  }

  function vueContrats(uid: string, p: Porte): VueContrats {
    rafraichirSalon(uid, p);
    const t = horloge();
    const e = p.salonJ;
    return {
      rubis: e.rubis,
      jour: e.contrats.liste,
      tous: e.contrats.tous,
      changeDispo: !e.contrats.change && e.contrats.liste.some((c) => !c.fait),
      grosCoups: e.contrats.grosCoups,
      finJour: lendemainParis(t),
      finSemaine: semaineDe(t).fin,
      album: e.album,
      albumComplet: e.albumComplet,
      depannage: p.solde < SEUIL_DEPANNAGE && e.rubis >= PRIX_DEPANNAGE && e.depannage !== jourParis(t),
      dollarsDepannage: dollarsDepannage(niveauDe(p)),
      objets: objetsDifferents(e.collection),
      cadres: e.cadres,
      cadreChoisi: e.cadreChoisi,
      tenues: e.tenues,
      tenue: e.tenue,
    };
  }

  /** Nouvelle tenue portée : le personnage change partout au salon. */
  function changerAvatarSalon(uid: string, p: Porte) {
    p.avatar = avatarCasino(p.avatarCompte, p.salonJ);
    p.salonAEcrire = true;
    planifier(uid, p);
    majRiche(uid, p);
    cercles.majJoueur(uid, p.nom, p.avatar);
    if (valeurCollection(p.salonJ.collection) > 0) majCollection(uid, p.nom, p.avatar, p.salonJ);
  }

  function vueHotel(uid: string, p: Porte): VueHotel {
    rafraichirSalon(uid, p);
    const t = horloge();
    const niveau = niveauDe(p);
    const jour = jourSemaineParis(t);
    const pris = p.salonJ.semaineBaron.pris;
    return {
      niveau,
      carte: carteMembre(niveau).id,
      semaine: { jour, pris, cadeau: pris.includes(jour) ? null : cadeauSemaine(jour, niveau, pris), coffreComplet: [0, 1, 2, 3, 4, 5].every((j) => pris.includes(j)) },
      happyHour: happyHour(t),
      champagne: etageOuvert(niveau, 'penthouse') && p.salonJ.champagne !== jourParis(t) ? champagnePenthouse(niveau) : null,
      joues: (Object.keys(p.jeux) as JeuCasino[]).filter((j) => (p.jeux[j]?.mise ?? 0) > 0),
    };
  }

  /** Nouveau niveau : les bonus des niveaux franchis (chacun versé une seule fois), et la fête sur le téléphone. */
  function monterNiveau(uid: string, p: Porte, niveau: number) {
    const avant = p.niveauPaye;
    let bonus = 0;
    for (let n = avant + 1; n <= niveau; n++) bonus += bonusNiveauCasino(n);
    p.niveauPaye = niveau;
    p.niveauAEcrire = true;
    if (bonus) mouvement(uid, p, bonus);
    noterJournal(uid, { t: horloge(), type: 'niveau', niveau, montant: bonus });
    notifier(uid, 'casino_niveau', { niveau, avant, bonus });
  }

  function mouvement(uid: string, p: Porte, delta: number) {
    p.solde = Math.min(SOLDE_MAX, Math.max(0, p.solde + delta));
    p.enAttente += delta;
    majRiche(uid, p);
    sauverSalon();
    planifier(uid, p);
  }

  // Le porte-monnaie, vu par les tables de blackjack.
  const banque: BanqueCasino = {
    solde: (uid) => portes.get(uid)?.solde ?? 0,
    debiter: (uid, montant) => {
      const p = portes.get(uid);
      if (!p || montant <= 0 || p.solde < montant) return false;
      mouvement(uid, p, -montant);
      return true;
    },
    crediter: (uid, montant) => {
      if (!(montant > 0)) return;
      const p = portes.get(uid);
      if (!p) return void comptes.mouvementCasino(uid, montant, montant).catch((e) => console.error('Casino : gain perdu :', e));
      mouvement(uid, p, montant);
      p.record = Math.max(p.record, montant);
    },
    rembourser: (uid, montant) => {
      if (!(montant > 0)) return;
      const p = portes.get(uid);
      if (!p) return void comptes.mouvementCasino(uid, montant).catch((e) => console.error('Casino : remboursement perdu :', e));
      mouvement(uid, p, montant);
    },
    joueur: (uid) => {
      const p = portes.get(uid);
      return p ? { nom: p.nom, avatar: p.avatar } : null;
    },
  };
  /** Le porte-monnaie vu par un jeu : chaque mise, gain et remboursement y est suivi (XP, statistiques, défis). */
  /** Le jeu est-il ouvert pour ce joueur (son niveau, ou un jeu auquel il a déjà misé) ? */
  const ouvertPour = (p: Porte, jeu: JeuNiveau) => jeuOuvert(niveauDe(p), jeu, jeu !== 'bal' && (p.jeux[jeu]?.mise ?? 0) > 0);
  const banqueDe = (jeu: JeuCasino, acces: JeuNiveau = jeu): BanqueCasino => ({
    solde: banque.solde,
    joueur: banque.joueur,
    debiter: (uid, montant) => {
      // Grand Hôtel : pas de mise dans un jeu dont l'étage n'est pas encore ouvert au joueur.
      const p = portes.get(uid);
      if (p && !ouvertPour(p, acces)) return false;
      if (!banque.debiter(uid, montant)) return false;
      suivre(uid, jeu, montant, 0);
      return true;
    },
    crediter: (uid, montant) => {
      if (!(montant > 0)) return;
      if (!portes.has(uid)) {
        // Joueur parti (sans porte-monnaie en mémoire) : gain et statistiques écrits ensemble.
        void comptes.mouvementCasino(uid, montant, montant, { activite: { mise: {}, gain: { [jeu]: montant } } }).catch((e) => console.error('Casino : gain perdu :', e));
        return defis.noter(uid, jeu, montant);
      }
      banque.crediter(uid, montant);
      suivre(uid, jeu, 0, montant);
    },
    rembourser: (uid, montant) => {
      if (!(montant > 0)) return;
      banque.rembourser(uid, montant);
      suivre(uid, jeu, -montant, 0);
    },
  });
  const defis = creerDefis({
    horloge,
    prelever: (uid, montant) => {
      const p = portes.get(uid);
      if (!p || montant <= 0 || p.solde < montant) return false;
      mouvement(uid, p, -montant);
      return true;
    },
    verser: verserHorsJeu,
    resultat: (uid, adversaire, r, montant) => {
      noterJournal(uid, { t: horloge(), type: 'defi', nom: adversaire, resultat: r, montant }, { gagnes: r === 'gagne' ? 1 : 0, perdus: r === 'perdu' ? 1 : 0, nuls: r === 'nul' ? 1 : 0 });
      if (r === 'gagne') evenementContrat(uid, 'defiGagne');
    },
    sontAmis: (a, b) => !!portes.get(a)?.amis.includes(b),
    notifier: (uid, d) => notifier(uid, 'casino_defi', d),
    annoncer: (a) => annoncer(a),
    sauver: () => sauverSalon(),
    echelle: options.echelleDefis,
  });
  /** Les tables VIP : réservées aux membres du Penthouse. */
  const vipAutorise = (uid: string) => {
    const p = portes.get(uid);
    return !!p && etageOuvert(niveauDe(p), 'penthouse');
  };
  const tables = creerTablesBlackjack({ io, banque: banqueDe('blackjack'), horloge, delais: options.delaisTables, sabot: options.sabotBlackjack, vipAutorise });
  const roulettes = creerTablesRoulette({ io, banque: banqueDe('roulette'), horloge, delais: options.delaisRoulette, tirage: options.tirageRoulette, annoncer: (a) => annoncer(a), vipAutorise });
  const coffres = creerCoffres({ banque: banqueDe('coffres'), hasard: options.hasardCoffres, placer: options.placerBadgesCoffres, annoncer: (a) => annoncer(a) });
  const show = creerShowFolleNuit({ io, banque: banqueDe('folleNuit'), horloge, hasard: options.hasardFolleNuit, delais: options.delaisFolleNuit, tirage: options.tirageFolleNuit, annoncer: (a) => annoncer(a) });
  const couronne = creerVolCouronne({ io, banque: banqueDe('couronne'), horloge, delais: options.delaisCouronne, k: options.kCouronne, tirage: options.tirageCouronne, annoncer: (a) => annoncer(a) });
  const course = creerCourse({ io, banque: banqueDe('course'), horloge, delais: options.delaisCourse, arrivee: options.arriveeCourse, annoncer: (a) => annoncer(a) });
  /** La grande ouverture de The Baron's Wheel : elle dure autant que son cadeau (ouvert à la mise en ligne). */
  const finOuvertureBW = (): number | null => {
    if (options.ouvertureBaronWheel) return options.ouvertureBaronWheel();
    if (!cadeaux.some((c) => c.id === CADEAU_OUVERTURE_BW)) return null;
    const debut = ouvertures[CADEAU_OUVERTURE_BW];
    return debut === undefined ? null : debut + DUREE_OUVERTURE_BW;
  };
  // Le grand spectacle : les premières manches dont les mises ferment entre SPECTACLE_BW.debut et .fin, une par une.
  const casesDe = (c: CaseBW) => ROUE_BW.flatMap((x, i) => (x === c ? [i] : []));
  const spectacle: { suivante: number; enCours: (typeof SPECTACLE_BW.manches)[number] | null; tirage: (typeof SPECTACLE_BW.manches)[number] | null } = { suivante: 0, enCours: null, tirage: null };
  const roueBW = creerBaronWheel({
    io,
    banque: banqueDe('baronWheel'),
    horloge,
    delais: options.delaisBaronWheel,
    multiplicateurs: () => {
      const t = horloge();
      const m = SPECTACLE_BW.manches[spectacle.suivante];
      // (jamais dans les tests : ils règlent leurs délais)
      if (m && !options.delaisBaronWheel && !options.multiplicateursBaronWheel && t >= SPECTACLE_BW.debut && t < SPECTACLE_BW.fin) {
        spectacle.enCours = m;
        // (sans multiplicateur imposé, le Top Slot tire au hasard)
        if (m.x !== undefined) return casesDe(m.c).map((i) => ({ i, x: m.x as number }));
      }
      return options.multiplicateursBaronWheel?.();
    },
    arret: () => {
      const m = spectacle.enCours;
      if (m) {
        spectacle.enCours = null;
        spectacle.suivante++;
        spectacle.tirage = m;
        return casesDe(m.c)[0];
      }
      return options.arretBaronWheel?.();
    },
    tirage: (c) => {
      const m = spectacle.tirage;
      spectacle.tirage = null;
      if (!m || c !== m.c || c !== 'chaudiere' || m.explosion === undefined) return undefined;
      return { type: 'chaudiere', explosion: m.explosion };
    },
    ouverture: finOuvertureBW,
    annoncer: (a) => annoncer(a),
  });
  // Le Bal du Grand Hôtel : la roue du bal (même banque que le Baron Express, ses mises comptent pour la roue).
  const roueBal = creerBalWheel({
    io,
    banque: banqueDe('baronWheel', 'bal'),
    horloge,
    ...(options.delaisBaronWheel ? { delais: { mises: 2_000, tour: 1_000, resultat: 1_000 }, delaisBonus: options.delaisBaronWheel } : {}),
    annoncer: (a) => annoncer(a),
  });
  // -------------------------------------------------------------------------------------------------------------
  // Salle des ventes et Bureau du Baron (shared/ventes.ts, server/ventesCasino.ts)

  /** La plus belle collection : la fiche d'un joueur (retirée s'il n'a plus rien). */
  function majCollection(uid: string, nom: string, avatar: number, e: { collection: Parameters<typeof valeurCollection>[0]; cadres: string[]; cadreChoisi?: string | null }) {
    const valeur = valeurCollection(e.collection);
    if (valeur <= 0) return void collections.delete(uid);
    collections.set(uid, { uid, nom, avatar, valeur, objets: objetsDifferents(e.collection), cadre: cadreSpecial(e.cadres, e.cadreChoisi) });
    sauverSalon();
  }
  const classementCollections = () => [...collections.values()].sort((a, b) => b.valeur - a.valeur).slice(0, 10);

  const ventes = creerVentes({
    horloge,
    jour: jourParis,
    fin: lendemainParis,
    debiter: (uid, monnaie, montant) => {
      const p = portes.get(uid);
      if (!p || montant <= 0) return false;
      if (monnaie === 'dollars') {
        if (p.solde < montant) return false;
        mouvement(uid, p, -montant);
        return true;
      }
      if (p.salonJ.rubis < montant) return false;
      p.salonJ.rubis -= montant;
      p.salonAEcrire = true;
      planifier(uid, p);
      return true;
    },
    rendre: (uid, monnaie, montant, lot, par) => {
      if (monnaie === 'dollars') verserHorsJeu(uid, montant);
      else {
        const p = portes.get(uid);
        if (p) {
          p.salonJ.rubis = Math.min(RUBIS_MAX, p.salonJ.rubis + montant);
          p.salonAEcrire = true;
          planifier(uid, p);
        } else void comptes.mouvementCasino(uid, 0, undefined, { salonDelta: { rubis: montant } }).catch((e) => console.error('Salle des ventes : rubis non rendus :', e));
      }
      const a: AnnonceVente = { type: 'surenchere', objet: lot.objet, par, monnaie, rendu: montant };
      notifier(uid, 'casino_vente', a);
    },
    attribuer: (uid, lot: Lot, valeur) => {
      const p = portes.get(uid);
      const montant = lot.meilleure?.montant ?? 0;
      if (p) {
        const { complete } = ajouterObjet(p.salonJ, lot.objet, valeur);
        p.salonAEcrire = true;
        planifier(uid, p);
        majCollection(uid, p.nom, p.avatar, p.salonJ);
        const a: AnnonceVente = { type: 'gagne', objet: lot.objet, montant, monnaie: lot.monnaie, complete };
        notifier(uid, 'casino_vente', a);
      } else
        void comptes
          .mouvementCasino(uid, 0, undefined, { salonDelta: { objets: [{ id: lot.objet, valeur }] } })
          .then((s) => s?.casino && majCollection(uid, s.nom, s.avatar, normaliserEtatSalon(s.casino.salon)))
          .catch((e) => console.error('Salle des ventes : objet non remis :', e));
    },
    diffuser: (v) => io.to(SALLE).emit('casino_ventes', v),
    sauver: () => sauverSalon(),
  });

  // -------------------------------------------------------------------------------------------------------------
  // Les Cercles (shared/cercles.ts, server/cerclesCasino.ts) et la Bourse de 1929 (shared/bourse.ts, server/bourseCasino.ts)

  const cercles = creerCercles({
    horloge,
    semaine: (t) => semaineDe(t),
    lire: () => comptes.lireParametre('cercles').then((b) => (b as { liste?: unknown } | null)?.liste),
    ecrire: (liste) => comptes.ecrireParametre('cercles', { liste }),
    payerRubis: (uid, n) => {
      const p = portes.get(uid);
      if (!p || p.salonJ.rubis < n) return false;
      p.salonJ.rubis -= n;
      p.salonAEcrire = true;
      planifier(uid, p);
      return true;
    },
    verser: verserHorsJeu,
    notifier,
    delaiEcriture,
  });
  const bourse = creerBourse({
    horloge,
    jour: jourParis,
    lire: () => comptes.lireParametre('bourse'),
    ecrire: (e) => comptes.ecrireParametre('bourse', e as unknown as Record<string, unknown>),
    diffuser: (cours, nouvelle, prochaine) => io.to(SALLE).emit('casino_bourse_seance', { cours, nouvelle, prochaine }),
  });
  const vueBourse = (p: Porte): VueBourse => {
    const e = bourse.etat();
    return { cours: e.cours, ouverture: e.ouverture, historique: e.historique, nouvelles: e.nouvelles, prochaine: bourse.prochaine(), portefeuille: p.salonJ.portefeuille };
  };

  const tickets = creerTickets({ banque: banqueDe('tickets'), horloge, annoncer: (a) => annoncer(a) });
  const toits = creerToits({ banque: banqueDe('toits'), hasard: options.hasardToits, annoncer: (a) => annoncer(a) });
  const chute = creerChute({ banque: banqueDe('chute'), horloge, hasard: options.hasardChute, chemin: options.cheminChute, delaiAnnonce: options.delaiAnnonceChute, annoncer: (a) => annoncer(a) });

  function vue(uid: string): VueCasino {
    const p = portes.get(uid);
    const t = horloge();
    const liste: RicheSalon[] = [...riches.entries()]
      .sort(([, a], [, b]) => b.solde - a.solde)
      .slice(0, 10)
      .map(([u, r]) => ({ nom: r.nom, avatar: r.avatar, solde: r.solde, ...(r.niveau ? { niveau: r.niveau } : {}), ...(u === uid ? { moi: true as const } : {}) }));
    return {
      nom: p?.nom ?? '',
      avatar: p?.avatar ?? 1,
      avatarCompte: p?.avatarCompte ?? 1,
      solde: p?.solde ?? 0,
      roueProchaine: p?.roue === jourParis(t) ? lendemainParis(t) : null,
      grosLot,
      toursGratuits: p?.toursGratuits ?? 0,
      miseGratuite: p?.miseGratuite ?? 0,
      bonus: p?.bonus[0] ? vueBonus(p.bonus[0]) : null,
      riches: liste,
      tables: tables.resume(),
      tablesRoulette: roulettes.resume(),
      folleNuit: show.resume(),
      coffres: { enCours: coffres.enCours(uid) },
      toits: { enCours: toits.enCours(uid) },
      couronne: couronne.resume(),
      course: course.resume(),
      baronWheel: roueBW.resume(),
      balWheel: roueBal.resume(),
      ...(p ? { profil: { ...progressionCasino(p.mise + p.bonusXp), demandes: p.recues.length, invitations: defis.invitations(uid), defi: defis.enCours(uid) } } : {}),
      ...(p ? { contrats: vueContrats(uid, p) } : {}),
      ventes: ventes.vue(),
      ...(p ? { hotel: vueHotel(uid, p) } : {}),
      ...(() => {
        const a = jeuALaffiche(t);
        return a ? { affiche: { ...a, bonus: p && p.affiche.debut === a.debut ? p.affiche.bonus : 0 } } : {};
      })(),
      nuits: p ? { gratuits: p.nuits.gratuits, miseGratuite: p.nuits.miseGratuite, collantes: p.nuits.collantes } : { gratuits: 0, miseGratuite: 0, collantes: null },
      cadeau: (() => {
        const c = p ? cadeauDisponible(cadeaux, ouvertures, p.cadeaux, t) : null;
        return c ? { montant: c.cadeau.montant, fin: c.fin } : null;
      })(),
    };
  }

  /** Le bonus vu par le téléphone : seuls les coffres déjà ouverts montrent leur contenu. */
  function vueBonus(b: BonusMachine): VueBonusMachine {
    if (b.type === 'roue') return { type: 'roue', mise: b.mise };
    const e = b.etat;
    return { type: 'casse', mise: b.mise, ouverts: e.contenus.map((c, i) => (e.ouverts[i] ? c : null)), coups: e.coups, butin: e.butin, multiplicateur: e.multiplicateur };
  }

  /** Gros lot du salon : la part qui revient à cette mise, puis le pot repart (jamais sous son montant de départ). */
  function prendreGrosLot(mise: number): number {
    const part = partGrosLot(grosLot, mise);
    grosLot = Math.max(GROS_LOT_DEPART, grosLot - part);
    diffuserGrosLot(true);
    return part;
  }

  function annoncer(a: AnnonceCasino) {
    io.to(SALLE).emit('casino_annonce', a);
  }
  function diffuserGrosLot(force = false) {
    const t = horloge();
    if (!force && t - dernierGrosLotDiffuse < 2000) return;
    dernierGrosLotDiffuse = t;
    io.to(SALLE).emit('casino_gros_lot', grosLot);
  }

  /** Branche les événements du casino sur le téléphone d'un joueur. */
  function brancher(socket: Socket, ctx: { identite: () => Identite | null; L: (fr: string, en: string) => string }) {
    const { L } = ctx;
    const repondre = (rappel: unknown, r: Reponse) => {
      if (typeof rappel === 'function') (rappel as Rappel)(r);
    };
    /** Le compte connecté, s'il a le badge Créateur ; sinon la réponse « Introuvable. » est déjà envoyée. */
    const acces = async (rappel: unknown): Promise<Identite | null> => {
      const id = ctx.identite();
      if (!id || !(await estCreateur(id.uid))) {
        repondre(rappel, INTROUVABLE);
        return null;
      }
      return id;
    };
    /** lancees : le compteur d'écritures au moment où le compte a été relu (recalage seulement s'il n'a pas bougé). */
    const porteDe = (id: Identite, stats: StatsCompte, lancees?: number): Porte => {
      let p = portes.get(id.uid);
      if (!p) {
        const c = stats.casino;
        const mise = c?.mise ?? 0;
        p = {
          depuis: c?.depuis ?? horloge(),
          mise,
          bonusXp: c?.bonusXp ?? 0,
          affiche: { debut: 0, bonus: 0 },
          gagne: c?.gagne ?? 0,
          jeux: { ...(c?.jeux ?? {}) },
          plusGrosGain: c?.plusGrosGain ?? 0,
          niveauPaye: Math.max(c?.niveauPaye ?? 1, 1),
          amis: [...(c?.amis ?? [])],
          recues: [...(c?.demandesRecues ?? [])],
          envoyees: [...(c?.demandesEnvoyees ?? [])],
          envois: c?.envois ? { ...c.envois } : { jour: '', total: 0 },
          journal: [...(c?.journal ?? [])],
          defisBilan: c?.defis ? { ...c.defis } : { gagnes: 0, perdus: 0, nuls: 0 },
          activite: null,
          journalAjouts: [],
          defisAjouts: null,
          salonJ: normaliserEtatSalon(c?.salon),
          salonAEcrire: false,
          dernieresMises: {},
          niveauAEcrire: false,
          envoisAEcrire: false,
          ecrituresLancees: 0,
          ecrituresEnVol: 0,
          nom: stats.nom || id.nom || '',
          avatar: stats.avatar,
          avatarCompte: stats.avatar,
          solde: stats.casino?.solde ?? 0,
          enAttente: 0,
          record: 0,
          roue: stats.casino?.roue,
          cadeaux: stats.casino?.cadeaux ?? [],
          toursGratuits: 0,
          miseGratuite: 0,
          nuits: etatNuitsVide(),
          bonus: [],
          minuterie: null,
          ecriture: Promise.resolve(),
          occupe: false,
          dernierTour: 0,
        };
        portes.set(id.uid, p);
      }
      p.nom = stats.nom || p.nom;
      p.avatar = stats.avatar;
      // Rien n'attend d'être écrit : le porte-monnaie se recale sur le compte (au cas où un autre serveur, le temps
      // d'une mise à jour du site, ou un versement hors salon l'aurait changé).
      const c = stats.casino;
      const calme = lancees === p.ecrituresLancees && !p.ecrituresEnVol && !p.occupe;
      if (c && calme && !p.enAttente && !p.record && !p.activite && !p.journalAjouts.length && !p.defisAjouts && !p.niveauAEcrire && !p.envoisAEcrire && !p.salonAEcrire) {
        p.salonJ = normaliserEtatSalon(c.salon);
        p.solde = c.solde;
        p.mise = c.mise ?? 0;
        p.bonusXp = c.bonusXp ?? 0;
        p.gagne = c.gagne ?? 0;
        p.jeux = { ...(c.jeux ?? {}) };
        p.plusGrosGain = c.plusGrosGain ?? 0;
        p.niveauPaye = Math.max(c.niveauPaye ?? 1, 1);
        p.journal = [...(c.journal ?? [])];
        p.defisBilan = c.defis ? { ...c.defis } : { gagnes: 0, perdus: 0, nuls: 0 };
        p.envois = c.envois ? { ...c.envois } : { jour: '', total: 0 };
        p.roue = c.roue;
        p.cadeaux = c.cadeaux ?? [];
      }
      // Le Tailleur : au salon, on porte sa tenue (si on en a choisi une) à la place du personnage du compte.
      p.avatarCompte = stats.avatar;
      p.avatar = avatarCasino(stats.avatar, p.salonJ);
      if (valeurCollection(p.salonJ.collection) > 0) majCollection(id.uid, p.nom, p.avatar, p.salonJ);
      cercles.majJoueur(id.uid, p.nom, p.avatar);
      p.amis = [...(c?.amis ?? p.amis)];
      p.recues = [...(c?.demandesRecues ?? p.recues)];
      p.envoyees = [...(c?.demandesEnvoyees ?? p.envoyees)];
      majRiche(id.uid, p);
      return p;
    };
    /** Le compte de ce téléphone, une fois entré au salon (présence, notifications). */
    let monUid: string | null = null;
    const partir = () => {
      if (!monUid) return;
      const set = presents.get(monUid);
      set?.delete(socket.id);
      if (!set?.size) {
        presents.delete(monUid);
        positions.delete(monUid);
      } else if (positions.get(monUid)?.sid === socket.id) positions.set(monUid, { ecran: 'salon', sid: [...set][0] });
      monUid = null;
    };
    let dans = false;
    tables.brancher(socket, { acces, enSalon: (uid) => dans && portes.has(uid), L });
    roulettes.brancher(socket, { acces, enSalon: (uid) => dans && portes.has(uid), L });
    show.brancher(socket, { acces, enSalon: (uid) => dans && portes.has(uid), L });
    coffres.brancher(socket, { acces, enSalon: (uid) => dans && portes.has(uid), L });
    couronne.brancher(socket, { acces, enSalon: (uid) => dans && portes.has(uid), L });
    chute.brancher(socket, { acces, enSalon: (uid) => dans && portes.has(uid), L });
    tickets.brancher(socket, { acces, enSalon: (uid) => dans && portes.has(uid), L });
    toits.brancher(socket, { acces, enSalon: (uid) => dans && portes.has(uid), L });
    course.brancher(socket, { acces, enSalon: (uid) => dans && portes.has(uid), L });
    roueBW.brancher(socket, { acces, enSalon: (uid) => dans && portes.has(uid), L });
    roueBal.brancher(socket, { acces, enSalon: (uid) => dans && portes.has(uid), L });

    socket.on('casino_entrer', async (_data: unknown, rappel?: Rappel) => {
      const id = await acces(rappel);
      if (!id) return;
      try {
        await chargement;
        // Ce qui attend part d'abord : le compte relu juste après est à jour.
        if (portes.has(id.uid)) await ecrire(id.uid);
        const lancees = portes.get(id.uid)?.ecrituresLancees;
        const stats = await comptes.entrerCasino(id.uid);
        if (!stats) return repondre(rappel, INTROUVABLE);
        const p = porteDe(id, stats, lancees);
        // Cadeau de bienvenue : une fois par compte (un invité le recevra en créant le sien).
        let bienvenue = null;
        if (!id.uid.startsWith('invite-') && !p.salonJ.bienvenue) {
          p.salonJ.bienvenue = true;
          p.salonJ.rubis = Math.min(RUBIS_MAX, p.salonJ.rubis + CADEAU_COMPTE.rubis);
          mouvement(id.uid, p, CADEAU_COMPTE.dollars);
          p.salonAEcrire = true;
          planifier(id.uid, p);
          bienvenue = CADEAU_COMPTE;
        }
        sauverSalon();
        void socket.join(SALLE);
        dans = true;
        if (monUid && monUid !== id.uid) partir();
        monUid = id.uid;
        presents.set(id.uid, (presents.get(id.uid) ?? new Set()).add(socket.id));
        if (!positions.has(id.uid)) positions.set(id.uid, { ecran: 'salon', sid: socket.id });
        repondre(rappel, { ok: true, casino: vue(id.uid), ...(bienvenue ? { bienvenue } : {}) });
      } catch (e) {
        console.error('Casino : entrée impossible :', e);
        repondre(rappel, { ok: false, erreur: L('Le salon est indisponible pour le moment.', 'The lounge is unavailable right now.') });
      }
    });

    socket.on('casino_quitter', async (_data: unknown, rappel?: Rappel) => {
      const id = ctx.identite();
      tables.sortir(socket.id);
      roulettes.sortir(socket.id);
      show.sortir(socket.id);
      couronne.sortir(socket.id);
      course.sortir(socket.id);
      roueBW.sortir(socket.id);
      roueBal.sortir(socket.id);
      void socket.leave(SALLE);
      dans = false;
      partir();
      if (id) await ecrire(id.uid);
      repondre(rappel, { ok: true });
    });

    socket.on('casino_vue', async (_data: unknown, rappel?: Rappel) => {
      const id = await acces(rappel);
      if (!id) return;
      if (!portes.has(id.uid)) return repondre(rappel, INTROUVABLE);
      repondre(rappel, { ok: true, casino: vue(id.uid) });
    });

    // Cadeau du Baron : une somme à récupérer une seule fois, jusqu'à la date prévue.
    socket.on('casino_cadeau', async (_data: unknown, rappel?: Rappel) => {
      const id = await acces(rappel);
      if (!id) return;
      const p = portes.get(id.uid);
      if (!p || !dans) return repondre(rappel, INTROUVABLE);
      // Le cadeau récupéré : celui que le salon montre (ouvert, pas encore pris, qui se termine le plus tôt).
      const dispo = cadeauDisponible(cadeaux, ouvertures, p.cadeaux, horloge());
      if (!dispo) return repondre(rappel, { ok: false, erreur: L('Le cadeau n’est plus disponible.', 'The gift is no longer available.'), casino: vue(id.uid) });
      const cadeau = dispo.cadeau;
      if (p.occupe) return repondre(rappel, { ok: false, erreur: L('Patiente une seconde.', 'Wait a second.') });
      p.occupe = true;
      try {
        await ecrire(id.uid);
        const r = await comptes.recupererCadeauCasino(id.uid, cadeau.id, cadeau.montant);
        if (r === null) return repondre(rappel, INTROUVABLE);
        if (r === 'deja') {
          if (!p.cadeaux.includes(cadeau.id)) p.cadeaux.push(cadeau.id);
          return repondre(rappel, { ok: false, erreur: L('Tu as déjà récupéré ce cadeau.', 'You have already claimed this gift.'), casino: vue(id.uid) });
        }
        p.solde = r.casino?.solde ?? p.solde + cadeau.montant;
        p.cadeaux = r.casino?.cadeaux ?? [...p.cadeaux, cadeau.id];
        majRiche(id.uid, p);
        sauverSalon();
        repondre(rappel, { ok: true, cadeau: cadeau.montant, casino: vue(id.uid) });
      } catch (e) {
        console.error('Casino : cadeau impossible :', e);
        repondre(rappel, { ok: false, erreur: L('Le cadeau est indisponible pour le moment, réessaie plus tard.', 'The gift is unavailable right now, try again later.') });
      } finally {
        p.occupe = false;
      }
    });

    socket.on('casino_roue', async (_data: unknown, rappel?: Rappel) => {
      const id = await acces(rappel);
      if (!id) return;
      const p = portes.get(id.uid);
      if (!p || !dans) return repondre(rappel, INTROUVABLE);
      if (p.occupe) return repondre(rappel, { ok: false, erreur: L('Patiente une seconde.', 'Wait a second.') });
      p.occupe = true;
      try {
        await ecrire(id.uid); // le solde de Firestore est à jour avant la transaction de la roue
        const tirage = tirageRoue() % CASES_ROUE_SALON.length;
        const r = await comptes.tournerRoueSalon(id.uid, jourParis(horloge()), tirage, carteMembre(niveauDe(p)).roue);
        if (r === null) return repondre(rappel, INTROUVABLE);
        if (r === 'deja') return repondre(rappel, { ok: false, erreur: L('Tu as déjà tourné la roulette du salon aujourd’hui : reviens demain !', 'You have already spun the lounge wheel today: come back tomorrow!') });
        p.solde = r.stats.casino?.solde ?? p.solde + r.gain;
        p.roue = r.stats.casino?.roue;
        majRiche(id.uid, p);
        sauverSalon();
        if (r.gain >= GROS_GAIN_ROUE) annoncer({ nom: p.nom, jeu: 'roue', gain: r.gain });
        repondre(rappel, { ok: true, roue: { case: tirage, gain: r.gain }, casino: vue(id.uid) });
      } catch (e) {
        console.error('Casino : roulette du salon impossible :', e);
        repondre(rappel, { ok: false, erreur: L('La roulette est indisponible pour le moment, réessaie plus tard.', 'The wheel is unavailable right now, try again later.') });
      } finally {
        p.occupe = false;
      }
    });

    socket.on('casino_machine', async (data: { mise?: unknown } = {}, rappel?: Rappel) => {
      const id = await acces(rappel);
      if (!id) return;
      const p = portes.get(id.uid);
      if (!p || !dans) return repondre(rappel, INTROUVABLE);
      const t = horloge();
      if (p.occupe || t - p.dernierTour < ECART_TOURS_MS) return repondre(rappel, { ok: false, erreur: L('Patiente une seconde.', 'Wait a second.') });
      // Bonus en attente : on renvoie l'état du salon, pour que le téléphone rouvre le bonus.
      if (p.bonus.length) return repondre(rappel, { ok: false, erreur: L('Termine d’abord ton bonus.', 'Finish your bonus first.'), casino: vue(id.uid) });
      const gratuit = p.toursGratuits > 0;
      const mise = gratuit ? p.miseGratuite : Number(data?.mise);
      if (!ouvertPour(p, 'machine')) return repondre(rappel, { ok: false, erreur: L(ETAGE_FERME[0], ETAGE_FERME[1]) });
      if (!gratuit && !MISES_MACHINE.includes(mise)) return repondre(rappel, { ok: false, erreur: L('Mise impossible.', 'Invalid bet.') });
      if (!gratuit && p.solde < mise) return repondre(rappel, { ok: false, erreur: L('Solde insuffisant pour cette mise.', 'Not enough money for this bet.') });
      p.occupe = true;
      p.dernierTour = t;
      try {
        if (!gratuit) {
          mouvement(id.uid, p, -mise);
          suivre(id.uid, 'machine', mise, 0);
          grosLot += Math.round(mise * PART_GROS_LOT);
        } else {
          p.toursGratuits -= 1;
        }
        const r = tirerMachine(hasardMachine, mise, gratuit);
        let gain = r.gain;
        let gainGrosLot = 0;
        if (r.grosLot) {
          gainGrosLot = prendreGrosLot(mise);
          gain += gainGrosLot;
        } else diffuserGrosLot();
        if (gain > 0) {
          mouvement(id.uid, p, gain);
          p.record = Math.max(p.record, gain);
          suivre(id.uid, 'machine', 0, gain);
        }
        // Bonus : le Casse du coffre (3 Coffres), puis la Roue du Baron (Couronne sur le premier et le dernier rouleau).
        if (r.casse) p.bonus.push({ type: 'casse', mise, etat: nouveauCasse(hasardCasse) });
        if (r.roue) p.bonus.push({ type: 'roue', mise });
        // Free games : 3 jetons ou plus, à la mise de ce tour (pendant des tours gratuits, ils s'ajoutent).
        if (r.freeGames) {
          p.toursGratuits = Math.min(TOURS_GRATUITS_MAX, p.toursGratuits + r.freeGames);
          p.miseGratuite = mise;
        }
        if (!p.toursGratuits && !p.bonus.length) p.miseGratuite = 0;
        if (gainGrosLot) annoncer({ nom: p.nom, jeu: 'machine', gain, grosLot: true });
        else if (gain >= MULTIPLE_GROS_GAIN * mise) annoncer({ nom: p.nom, jeu: 'machine', gain });
        if (r.casse || r.roue || r.freeGames) evenementContrat(id.uid, 'bonusMachine');
        if (gainGrosLot) evenementContrat(id.uid, 'jackpot');
        sauverSalon();
        repondre(rappel, { ok: true, machine: { ...r, gain, gainGrosLot, gratuit, mise }, casino: vue(id.uid) });
      } finally {
        p.occupe = false;
      }
    });

    // Les Bulles du Baron : un tour en cascade (et ses tours gratuits, joués d'un coup si le bonus tombe).
    socket.on('casino_bulles', async (data: { mise?: unknown } = {}, rappel?: Rappel) => {
      const id = await acces(rappel);
      if (!id) return;
      const p = portes.get(id.uid);
      if (!p || !dans) return repondre(rappel, INTROUVABLE);
      const t = horloge();
      if (p.occupe || t - p.dernierTour < ECART_TOURS_MS) return repondre(rappel, { ok: false, erreur: L('Patiente une seconde.', 'Wait a second.') });
      const mise = Number(data?.mise);
      if (!ouvertPour(p, 'machine')) return repondre(rappel, { ok: false, erreur: L(ETAGE_FERME[0], ETAGE_FERME[1]) });
      if (!MISES_BULLES.includes(mise)) return repondre(rappel, { ok: false, erreur: L('Mise impossible.', 'Invalid bet.') });
      if (p.solde < mise) return repondre(rappel, { ok: false, erreur: L('Solde insuffisant pour cette mise.', 'Not enough money for this bet.') });
      p.occupe = true;
      p.dernierTour = t;
      try {
        mouvement(id.uid, p, -mise);
        suivre(id.uid, 'machine', mise, 0);
        const r = jouerBulles(mise, () => randomInt(1_000_000_000) / 1_000_000_000);
        if (r.gain > 0) {
          mouvement(id.uid, p, r.gain);
          p.record = Math.max(p.record, r.gain);
          suivre(id.uid, 'machine', 0, r.gain);
        }
        if (r.gratuits.length) evenementContrat(id.uid, 'bonusMachine');
        if (r.gain >= MULTIPLE_GROS_GAIN * mise) {
          const nom = p.nom;
          // Annoncé après l'animation des cascades.
          setTimeout(() => annoncer({ nom, jeu: 'bulles', gain: r.gain }), 4000 + r.gratuits.length * 2500);
        }
        sauverSalon();
        repondre(rappel, { ok: true, bulles: { ...r, mise }, casino: vue(id.uid) });
      } catch (e) {
        // Jamais de tour muet : on répond toujours (et la trace aide à corriger).
        console.error('casino_bulles', e);
        repondre(rappel, { ok: false, erreur: L('La machine a eu un hoquet, réessaie.', 'The machine hiccuped, try again.'), casino: vue(id.uid) });
      } finally {
        p.occupe = false;
      }
    });

    // Les Nuits du Baron : un tour (free games et rouleaux figés gardés par le serveur).
    socket.on('casino_nuits', async (data: { mise?: unknown } = {}, rappel?: Rappel) => {
      const id = await acces(rappel);
      if (!id) return;
      const p = portes.get(id.uid);
      if (!p || !dans) return repondre(rappel, INTROUVABLE);
      const t = horloge();
      if (p.occupe || t - p.dernierTour < ECART_TOURS_MS) return repondre(rappel, { ok: false, erreur: L('Patiente une seconde.', 'Wait a second.') });
      const e = p.nuits;
      const gratuit = e.gratuits > 0;
      // Pendant une descente de police, la mise reste celle du tour où elle a commencé.
      const mise = gratuit ? e.miseGratuite : (e.collantes?.mise ?? Number(data?.mise));
      if (!ouvertPour(p, 'nuits')) return repondre(rappel, { ok: false, erreur: L(ETAGE_FERME[0], ETAGE_FERME[1]) });
      if (!gratuit && !MISES_MACHINE.includes(mise)) return repondre(rappel, { ok: false, erreur: L('Mise impossible.', 'Invalid bet.') });
      if (!gratuit && p.solde < mise) return repondre(rappel, { ok: false, erreur: L('Solde insuffisant pour cette mise.', 'Not enough money for this bet.') });
      p.occupe = true;
      p.dernierTour = t;
      try {
        if (!gratuit) {
          mouvement(id.uid, p, -mise);
          suivre(id.uid, 'nuits', mise, 0);
        }
        const { resultat } = jouerNuits(hasardNuits, mise, e, options.forcerNuits?.());
        if (resultat.gain > 0) {
          mouvement(id.uid, p, resultat.gain);
          p.record = Math.max(p.record, resultat.gain);
          suivre(id.uid, 'nuits', 0, resultat.gain);
        }
        // Annonce au salon : gros gain, ou jackpot MAJOR / GRAND du bonus Jetons du Baron.
        const jackpot = resultat.bonusJetons ? meilleurJackpot(resultat.bonusJetons) : null;
        if (jackpot) evenementContrat(id.uid, 'jackpot');
        // L'annonce attend la fin de l'animation chez le joueur (rouleaux, événement, bonus), pour ne rien lui gâcher.
        if (resultat.gain >= MULTIPLE_GROS_GAIN * mise || jackpot === 'major' || jackpot === 'grand') {
          const annonce = { nom: p.nom, jeu: 'nuits' as const, gain: resultat.gain, ...(jackpot === 'major' || jackpot === 'grand' ? { jackpot } : {}) };
          setTimeout(() => annoncer(annonce), dureeAnimationNuits(resultat)).unref?.();
        }
        sauverSalon();
        repondre(rappel, { ok: true, nuits: { ...resultat, mise, gratuit }, casino: vue(id.uid) });
      } finally {
        p.occupe = false;
      }
    });

    // Le Casse du coffre : on ouvre un coffre à la fois ; à la fin, le butin (× multiplicateur × mise) est versé.
    socket.on('casino_casse', async (data: { index?: unknown } = {}, rappel?: Rappel) => {
      const id = await acces(rappel);
      if (!id) return;
      const p = portes.get(id.uid);
      const b = p?.bonus[0];
      if (!p || !dans || b?.type !== 'casse') return repondre(rappel, { ok: false, erreur: L('Aucun casse en cours.', 'No heist in progress.') });
      const contenu = ouvrirCasse(b.etat, Number(data?.index));
      if (!contenu) return repondre(rappel, { ok: false, erreur: L('Ce coffre est déjà ouvert.', 'This safe is already open.') });
      let gain = 0;
      if (b.etat.fini) {
        gain = gainCasse(b.etat) * b.mise;
        if (gain > 0) {
          mouvement(id.uid, p, gain);
          p.record = Math.max(p.record, gain);
          suivre(id.uid, 'machine', 0, gain);
        }
        p.bonus.shift();
        if (gain >= MULTIPLE_GROS_GAIN * b.mise) annoncer({ nom: p.nom, jeu: 'casse', gain });
        if (!p.toursGratuits && !p.bonus.length) p.miseGratuite = 0;
        sauverSalon();
      }
      repondre(rappel, {
        ok: true,
        contenu,
        casse: { ...vueBonus(b), fini: b.etat.fini, sirene: b.etat.sirene, gain, ...(b.etat.fini ? { tout: b.etat.contenus } : {}) },
        casino: vue(id.uid),
      });
    });

    // La Roue du Baron : ×10 à ×100 la mise, 10 tours gratuits, ou la case verte du gros lot.
    socket.on('casino_roue_baron', async (_data: unknown, rappel?: Rappel) => {
      const id = await acces(rappel);
      if (!id) return;
      const p = portes.get(id.uid);
      const b = p?.bonus[0];
      if (!p || !dans || b?.type !== 'roue') return repondre(rappel, { ok: false, erreur: L('Aucune roue à lancer.', 'No wheel to spin.') });
      const i = tirageRoueBaron() % ROUE_BARON.length;
      const c = ROUE_BARON[i];
      let gain = 0;
      let tours = 0;
      if (c.type === 'multiple') gain = c.x * b.mise;
      else if (c.type === 'grosLot') gain = prendreGrosLot(b.mise);
      else {
        tours = c.n;
        p.toursGratuits = Math.min(TOURS_GRATUITS_MAX, p.toursGratuits + tours);
        p.miseGratuite = b.mise;
      }
      p.bonus.shift();
      if (gain > 0) {
        mouvement(id.uid, p, gain);
        p.record = Math.max(p.record, gain);
        suivre(id.uid, 'machine', 0, gain);
      }
      if (c.type === 'grosLot') {
        annoncer({ nom: p.nom, jeu: 'roueBaron', gain, grosLot: true });
        evenementContrat(id.uid, 'jackpot');
      }
      else if (gain >= MULTIPLE_GROS_GAIN * b.mise) annoncer({ nom: p.nom, jeu: 'roueBaron', gain });
      if (!p.toursGratuits && !p.bonus.length) p.miseGratuite = 0;
      sauverSalon();
      repondre(rappel, { ok: true, roueBaron: { case: i, gain, tours, grosLot: c.type === 'grosLot' }, casino: vue(id.uid) });
    });

    // Changer un contrat du jour pas encore rempli : une fois par jour, contre des rubis.
    socket.on('casino_contrat_changer', async (data: { index?: unknown } = {}, rappel?: Rappel) => {
      const id = await acces(rappel);
      if (!id) return;
      const p = portes.get(id.uid);
      if (!p || !dans) return repondre(rappel, INTROUVABLE);
      rafraichirSalon(id.uid, p);
      const r = changerContrat(p.salonJ, Number(data?.index), niveauDe(p), (n) => randomInt(Math.max(1, n)), (j) => ouvertPour(p, j));
      if (r !== 'ok') {
        const msg: Record<typeof r, [string, string]> = {
          deja: ['Tu as déjà changé un contrat aujourd’hui.', 'You have already swapped a contract today.'],
          fait: ['Ce contrat est déjà rempli.', 'This contract is already done.'],
          rubis: [`Il faut ${PRIX_CHANGER_CONTRAT} rubis pour changer un contrat.`, `You need ${PRIX_CHANGER_CONTRAT} rubies to swap a contract.`],
          introuvable: ['Contrat introuvable.', 'Contract not found.'],
        };
        return repondre(rappel, { ok: false, erreur: L(...msg[r]), casino: vue(id.uid) });
      }
      p.salonAEcrire = true;
      planifier(id.uid, p);
      repondre(rappel, { ok: true, casino: vue(id.uid) });
    });

    // Salle des ventes : une enchère sur un des lots du jour (la somme est bloquée, et rendue si quelqu'un surenchérit).
    socket.on('casino_encherir', async (data: { index?: unknown; montant?: unknown } = {}, rappel?: Rappel) => {
      const id = await acces(rappel);
      if (!id) return;
      const p = portes.get(id.uid);
      if (!p || !dans) return repondre(rappel, INTROUVABLE);
      if (p.occupe) return repondre(rappel, { ok: false, erreur: L('Patiente une seconde.', 'Wait a second.') });
      const r = ventes.encherir({ uid: id.uid, nom: p.nom, avatar: p.avatar }, Number(data?.index), Number(data?.montant));
      if (r !== 'ok') {
        const msg: Record<typeof r, [string, string]> = {
          introuvable: ['Ce lot n’est plus en vente.', 'This lot is no longer for sale.'],
          deja: ['Ton enchère est déjà la meilleure.', 'Your bid is already the highest.'],
          minimum: ['Quelqu’un a enchéri entre-temps : regarde le nouveau minimum.', 'Someone bid in the meantime: check the new minimum.'],
          trop: ['Cette enchère est bien trop haute.', 'That bid is far too high.'],
          solde: ['Tu n’as pas de quoi payer cette enchère.', 'You can’t afford this bid.'],
        };
        return repondre(rappel, { ok: false, erreur: L(...msg[r]), casino: vue(id.uid) });
      }
      repondre(rappel, { ok: true, casino: vue(id.uid) });
    });

    // Bureau du Baron : la collection d'un joueur (la mienne, ou celle d'un autre), et la plus belle du salon.
    socket.on('casino_bureau', async (data: { uid?: unknown } = {}, rappel?: Rappel) => {
      const id = await acces(rappel);
      if (!id) return;
      if (!portes.has(id.uid) || !dans) return repondre(rappel, INTROUVABLE);
      const cible = typeof data?.uid === 'string' && data.uid ? data.uid : id.uid;
      const q = portes.get(cible);
      let fiche: { nom: string; avatar: number; niveau: number; salon: EtatSalonJoueur } | null = null;
      if (q) fiche = { nom: q.nom, avatar: q.avatar, niveau: niveauDe(q), salon: q.salonJ };
      else {
        const s = await comptes.lire(cible).catch(() => null);
        if (s?.casino) fiche = { nom: s.nom, avatar: s.avatar, niveau: progressionCasino((s.casino.mise ?? 0) + (s.casino.bonusXp ?? 0)).niveau, salon: normaliserEtatSalon(s.casino.salon) };
      }
      if (!fiche) return repondre(rappel, { ok: false, erreur: L('Bureau introuvable.', 'Office not found.') });
      const bureau: VueBureau = {
        uid: cible,
        nom: fiche.nom,
        avatar: fiche.avatar,
        niveau: fiche.niveau,
        collection: normaliserCollection(fiche.salon.collection),
        valeur: valeurCollection(fiche.salon.collection),
        cadre: cadreSpecial(fiche.salon.cadres, fiche.salon.cadreChoisi),
        moi: cible === id.uid,
        classement: classementCollections(),
      };
      repondre(rappel, { ok: true, bureau });
    });

    // Semaine du Baron : le télégramme du jour (du lundi au dimanche, heure de Paris), une fois par jour.
    socket.on('casino_semaine', async (_data: unknown, rappel?: Rappel) => {
      const id = await acces(rappel);
      if (!id) return;
      const p = portes.get(id.uid);
      if (!p || !dans) return repondre(rappel, INTROUVABLE);
      rafraichirSalon(id.uid, p);
      const jour = jourSemaineParis(horloge());
      const e = p.salonJ;
      if (e.semaineBaron.pris.includes(jour)) return repondre(rappel, { ok: false, erreur: L('Tu as déjà ouvert le télégramme du jour.', 'You already opened today’s telegram.'), casino: vue(id.uid) });
      const cadeau = cadeauSemaine(jour, niveauDe(p), e.semaineBaron.pris);
      e.semaineBaron = { ...e.semaineBaron, pris: [...e.semaineBaron.pris, jour] };
      e.rubis = Math.min(RUBIS_MAX, e.rubis + cadeau.rubis);
      mouvement(id.uid, p, cadeau.dollars);
      p.salonAEcrire = true;
      planifier(id.uid, p);
      repondre(rappel, { ok: true, cadeau, jour, casino: vue(id.uid) });
    });

    // Penthouse : le champagne du jour (membres du Penthouse, une fois par jour).
    socket.on('casino_champagne', async (_data: unknown, rappel?: Rappel) => {
      const id = await acces(rappel);
      if (!id) return;
      const p = portes.get(id.uid);
      if (!p || !dans) return repondre(rappel, INTROUVABLE);
      const niveau = niveauDe(p);
      if (!etageOuvert(niveau, 'penthouse')) return repondre(rappel, { ok: false, erreur: L(ETAGE_FERME[0], ETAGE_FERME[1]) });
      const jour = jourParis(horloge());
      if (p.salonJ.champagne === jour) return repondre(rappel, { ok: false, erreur: L('Le champagne du jour est déjà servi : reviens demain.', 'Today’s champagne has been served: come back tomorrow.'), casino: vue(id.uid) });
      const cadeau = champagnePenthouse(niveau);
      p.salonJ.champagne = jour;
      p.salonJ.rubis = Math.min(RUBIS_MAX, p.salonJ.rubis + cadeau.rubis);
      mouvement(id.uid, p, cadeau.dollars);
      p.salonAEcrire = true;
      planifier(id.uid, p);
      repondre(rappel, { ok: true, cadeau, casino: vue(id.uid) });
    });

    // ----- Les Cercles -----
    const texteCercle: Record<Exclude<ResultatCercle, 'ok'>, [string, string]> = {
      deja_membre: ['Tu fais déjà partie d’un cercle.', 'You are already in a circle.'],
      pas_membre: ['Tu ne fais partie d’aucun cercle.', 'You are not in a circle.'],
      introuvable: ['Introuvable.', 'Not found.'],
      nom: ['Choisis un nom de 3 à 24 caractères, sans symbole ni grossièreté, et un blason.', 'Pick a 3 to 24 character name, with no symbols or rude words, and a crest.'],
      nom_pris: ['Ce nom est déjà pris par un autre cercle.', 'Another circle already has this name.'],
      rubis: ['Il te manque des rubis.', 'You don’t have enough rubies.'],
      complet: ['Ce cercle est complet (20 membres).', 'This circle is full (20 members).'],
      droits: ['Seuls le président et le croupier en chef peuvent faire ça.', 'Only the president and the head croupier can do that.'],
      demande_envoyee: ['Demande envoyée : le président doit l’accepter.', 'Request sent: the president must accept it.'],
      trop_de_demandes: ['Ce cercle a trop de demandes en attente.', 'This circle has too many pending requests.'],
      vide: ['Message vide.', 'Empty message.'],
    };
    const actionCercle = async (rappel: unknown, f: (id: Identite, p: Porte) => ResultatCercle) => {
      const id = await acces(rappel);
      if (!id) return;
      const p = portes.get(id.uid);
      if (!p || !dans) return repondre(rappel, INTROUVABLE);
      await cercles.chargement;
      const r = f(id, p);
      // « Demande envoyée » n'est pas une erreur : la réponse est positive, avec son message.
      if (r === 'ok' || r === 'demande_envoyee') return repondre(rappel, { ok: true, ...(r === 'demande_envoyee' ? { info: L(...texteCercle[r]) } : {}), cercles: cercles.vue(id.uid), casino: vue(id.uid) });
      repondre(rappel, { ok: false, erreur: L(...texteCercle[r]) });
    };
    const qui = (id: Identite, p: Porte) => ({ uid: id.uid, nom: p.nom, avatar: p.avatar });
    socket.on('casino_cercles', (_d: unknown, rappel?: Rappel) => void actionCercle(rappel, () => 'ok'));
    socket.on('casino_cercle_fonder', (d: { nom?: unknown; blason?: unknown; ouvert?: unknown } = {}, rappel?: Rappel) => void actionCercle(rappel, (id, p) => cercles.fonder(qui(id, p), d?.nom, d?.blason, d?.ouvert)));
    socket.on('casino_cercle_rejoindre', (d: { id?: unknown } = {}, rappel?: Rappel) => void actionCercle(rappel, (id, p) => cercles.rejoindre(qui(id, p), d?.id)));
    socket.on('casino_cercle_annuler', (_d: unknown, rappel?: Rappel) => void actionCercle(rappel, (id) => (cercles.annulerDemande(id.uid), 'ok')));
    socket.on('casino_cercle_demande', (d: { uid?: unknown; accepter?: unknown } = {}, rappel?: Rappel) => void actionCercle(rappel, (id) => cercles.repondreDemande(id.uid, d?.uid, d?.accepter === true)));
    socket.on('casino_cercle_quitter', (_d: unknown, rappel?: Rappel) => void actionCercle(rappel, (id) => cercles.quitter(id.uid)));
    socket.on('casino_cercle_exclure', (d: { uid?: unknown } = {}, rappel?: Rappel) => void actionCercle(rappel, (id) => cercles.exclure(id.uid, d?.uid)));
    socket.on('casino_cercle_croupier', (d: { uid?: unknown } = {}, rappel?: Rappel) => void actionCercle(rappel, (id) => cercles.nommerCroupier(id.uid, d?.uid)));
    socket.on('casino_cercle_blason', (d: { blason?: unknown } = {}, rappel?: Rappel) => void actionCercle(rappel, (id) => cercles.changerBlason(id.uid, d?.blason)));
    socket.on('casino_cercle_ouvert', (d: { ouvert?: unknown } = {}, rappel?: Rappel) => void actionCercle(rappel, (id) => cercles.changerOuverture(id.uid, d?.ouvert === true)));
    let dernierMessage = 0;
    socket.on('casino_cercle_message', (d: { texte?: unknown } = {}, rappel?: Rappel) => {
      if (horloge() - dernierMessage < 800) return repondre(rappel, { ok: false, erreur: L('Doucement !', 'Slow down!') });
      dernierMessage = horloge();
      void actionCercle(rappel, (id, p) => cercles.message(qui(id, p), d?.texte));
    });

    // ----- Le Marché noir -----
    const vueMarche = (uid: string, p: Porte): VueMarche => {
      const e = p.salonJ;
      const t = horloge();
      if (rafraichirMarche(e, jourParis(t))) (p.salonAEcrire = true), planifier(uid, p);
      const articles = etal(uid, e.marche.jour, e.marche.relances, niveauDe(p)).map((a, i) => ({
        ...a,
        achete: e.marche.achats.includes(i),
        possede: a.type === 'cadre' ? e.cadres.includes(a.cadre) : false,
      }));
      return { articles, relances: RELANCES_MAX - e.marche.relances, fin: lendemainParis(t), cadres: e.cadres, cadreChoisi: e.cadreChoisi };
    };
    socket.on('casino_marche', async (_d: unknown, rappel?: Rappel) => {
      const id = await acces(rappel);
      if (!id) return;
      const p = portes.get(id.uid);
      if (!p || !dans) return repondre(rappel, INTROUVABLE);
      repondre(rappel, { ok: true, marche: vueMarche(id.uid, p) });
    });
    socket.on('casino_marche_acheter', async (d: { index?: unknown } = {}, rappel?: Rappel) => {
      const id = await acces(rappel);
      if (!id) return;
      const p = portes.get(id.uid);
      if (!p || !dans) return repondre(rappel, INTROUVABLE);
      const v = vueMarche(id.uid, p);
      const i = Number(d?.index);
      const a = v.articles[i];
      const e = p.salonJ;
      if (!a) return repondre(rappel, { ok: false, erreur: L('Article introuvable.', 'Item not found.') });
      if (a.achete) return repondre(rappel, { ok: false, erreur: L('Tu as déjà acheté cet article aujourd’hui.', 'You already bought this item today.') });
      if (a.possede) return repondre(rappel, { ok: false, erreur: L('Tu as déjà ce cadre.', 'You already own this frame.') });
      if (e.rubis < a.prix) return repondre(rappel, { ok: false, erreur: L(`Il te faut ${a.prix} rubis.`, `You need ${a.prix} rubies.`) });
      e.rubis -= a.prix;
      e.marche = { ...e.marche, achats: [...e.marche.achats, i] };
      if (a.type === 'cadre') {
        e.cadres = [...e.cadres, a.cadre];
        e.cadreChoisi = a.cadre;
      } else if (a.type === 'objet') {
        ajouterObjet(e, a.objet, valeurObjetMarche(a.objet));
      } else mouvement(id.uid, p, a.dollars);
      if (a.type !== 'mallette') majCollection(id.uid, p.nom, p.avatar, e);
      p.salonAEcrire = true;
      planifier(id.uid, p);
      repondre(rappel, { ok: true, marche: vueMarche(id.uid, p), casino: vue(id.uid) });
    });
    socket.on('casino_marche_relancer', async (_d: unknown, rappel?: Rappel) => {
      const id = await acces(rappel);
      if (!id) return;
      const p = portes.get(id.uid);
      if (!p || !dans) return repondre(rappel, INTROUVABLE);
      vueMarche(id.uid, p);
      const e = p.salonJ;
      if (e.marche.relances >= RELANCES_MAX) return repondre(rappel, { ok: false, erreur: L('Le receleur n’a plus rien d’autre aujourd’hui.', 'The fence has nothing else today.') });
      if (e.rubis < PRIX_RELANCE) return repondre(rappel, { ok: false, erreur: L(`Il te faut ${PRIX_RELANCE} rubis.`, `You need ${PRIX_RELANCE} rubies.`) });
      e.rubis -= PRIX_RELANCE;
      e.marche = { ...e.marche, relances: e.marche.relances + 1, achats: [] };
      p.salonAEcrire = true;
      planifier(id.uid, p);
      repondre(rappel, { ok: true, marche: vueMarche(id.uid, p), casino: vue(id.uid) });
    });
    // ----- Le Tailleur -----
    // Le Plinko du Baron : des rubis contre une bille, qui tombe dans une case de dollars (jamais des rubis).
    socket.on('casino_plinko', async (d: { mise?: unknown } = {}, rappel?: Rappel) => {
      const id = await acces(rappel);
      if (!id) return;
      const p = portes.get(id.uid);
      if (!p || !dans) return repondre(rappel, INTROUVABLE);
      if (p.occupe) return repondre(rappel, { ok: false, erreur: L('Patiente une seconde.', 'Wait a second.') });
      const mise = d?.mise;
      if (!estMisePlinko(mise)) return repondre(rappel, { ok: false, erreur: L('Mise inconnue.', 'Unknown bet.') });
      if (p.salonJ.rubis < mise) return repondre(rappel, { ok: false, erreur: L(`Il te faut ${mise} rubis.`, `You need ${mise} rubies.`) });
      p.salonJ.rubis -= mise;
      const r = lacherBille(mise, () => randomInt(2 ** 40) / 2 ** 40);
      mouvement(id.uid, p, r.gain);
      p.salonAEcrire = true;
      planifier(id.uid, p);
      if (r.multi >= MULTI_MAX_PLINKO) setTimeout(() => annoncer({ nom: p.nom, jeu: 'plinko', gain: r.gain }), 3000);
      repondre(rappel, { ok: true, chemin: r.chemin, caseFinale: r.caseFinale, multi: r.multi, gain: r.gain, casino: vue(id.uid) });
    });
    socket.on('casino_tailleur_acheter', async (d: { n?: unknown } = {}, rappel?: Rappel) => {
      const id = await acces(rappel);
      if (!id) return;
      const p = portes.get(id.uid);
      if (!p || !dans) return repondre(rappel, INTROUVABLE);
      if (p.occupe) return repondre(rappel, { ok: false, erreur: L('Patiente une seconde.', 'Wait a second.') });
      const t = tenueDe(Number(d?.n));
      const e = p.salonJ;
      if (!t) return repondre(rappel, { ok: false, erreur: L('Tenue introuvable.', 'Outfit not found.') });
      if (e.tenues.includes(t.n)) return repondre(rappel, { ok: false, erreur: L('Cette tenue est déjà à toi.', 'You already own this outfit.') });
      if (t.monnaie === 'rubis') {
        if (e.rubis < t.prix) return repondre(rappel, { ok: false, erreur: L(`Il te faut ${t.prix} rubis.`, `You need ${t.prix} rubies.`) });
        e.rubis -= t.prix;
      } else {
        if (p.solde < t.prix) return repondre(rappel, { ok: false, erreur: L('Solde insuffisant.', 'Not enough money.') });
        mouvement(id.uid, p, -t.prix);
      }
      e.tenues = [...e.tenues, t.n];
      e.tenue = t.n;
      changerAvatarSalon(id.uid, p);
      repondre(rappel, { ok: true, casino: vue(id.uid) });
    });
    socket.on('casino_tailleur_porter', async (d: { n?: unknown } = {}, rappel?: Rappel) => {
      const id = await acces(rappel);
      if (!id) return;
      const p = portes.get(id.uid);
      if (!p || !dans) return repondre(rappel, INTROUVABLE);
      const n = d?.n === null ? null : Number(d?.n);
      if (n !== null && !p.salonJ.tenues.includes(n)) return repondre(rappel, { ok: false, erreur: L('Tenue introuvable.', 'Outfit not found.') });
      p.salonJ.tenue = n;
      changerAvatarSalon(id.uid, p);
      repondre(rappel, { ok: true, casino: vue(id.uid) });
    });

    socket.on('casino_cadre_choisir', async (d: { cadre?: unknown } = {}, rappel?: Rappel) => {
      const id = await acces(rappel);
      if (!id) return;
      const p = portes.get(id.uid);
      if (!p || !dans) return repondre(rappel, INTROUVABLE);
      const c = d?.cadre;
      if (c !== null && (typeof c !== 'string' || !p.salonJ.cadres.includes(c))) return repondre(rappel, { ok: false, erreur: L('Cadre introuvable.', 'Frame not found.') });
      p.salonJ.cadreChoisi = c;
      majCollection(id.uid, p.nom, p.avatar, p.salonJ);
      p.salonAEcrire = true;
      planifier(id.uid, p);
      repondre(rappel, { ok: true, marche: vueMarche(id.uid, p), casino: vue(id.uid) });
    });

    // ----- La Bourse de 1929 -----
    socket.on('casino_bourse', async (_d: unknown, rappel?: Rappel) => {
      const id = await acces(rappel);
      if (!id) return;
      const p = portes.get(id.uid);
      if (!p || !dans) return repondre(rappel, INTROUVABLE);
      await bourse.chargement;
      repondre(rappel, { ok: true, bourse: vueBourse(p) });
    });
    // Acheter pour un montant proposé (1 M$ à 1 Md$), ou vendre une part de sa ligne (un quart, la moitié, tout).
    socket.on('casino_bourse_ordre', async (d: { action?: unknown; sens?: unknown; montant?: unknown; part?: unknown } = {}, rappel?: Rappel) => {
      const id = await acces(rappel);
      if (!id) return;
      const p = portes.get(id.uid);
      if (!p || !dans) return repondre(rappel, INTROUVABLE);
      if (p.occupe) return repondre(rappel, { ok: false, erreur: L('Patiente une seconde.', 'Wait a second.') });
      await bourse.chargement;
      const a = d?.action;
      if (!estAction(a)) return repondre(rappel, { ok: false, erreur: L('Titre inconnu.', 'Unknown stock.') });
      const cours = bourse.etat().cours[a];
      const e = p.salonJ;
      if (d?.sens === 'achat') {
        const montant = Number(d?.montant);
        if (!MONTANTS_ACHAT.includes(montant)) return repondre(rappel, { ok: false, erreur: L('Montant impossible.', 'Invalid amount.') });
        const { n, total } = devisAchat(cours, Math.min(montant, p.solde));
        if (n <= 0) return repondre(rappel, { ok: false, erreur: L('Solde insuffisant pour une seule action.', 'Not enough money for a single share.') });
        if ((e.portefeuille[a]?.n ?? 0) + n > ACTIONS_MAX) return repondre(rappel, { ok: false, erreur: L('Tu as atteint le maximum d’actions de cette société.', 'You hold the maximum number of shares of this company.') });
        mouvement(id.uid, p, -total);
        e.portefeuille = acheter(e.portefeuille, a, n, total);
      } else if (d?.sens === 'vente') {
        const part = Number(d?.part);
        const ligne = e.portefeuille[a];
        if (!ligne || ![0.25, 0.5, 1].includes(part)) return repondre(rappel, { ok: false, erreur: L('Rien à vendre.', 'Nothing to sell.') });
        const n = part === 1 ? ligne.n : Math.max(1, Math.floor(ligne.n * part));
        mouvement(id.uid, p, produitVente(cours, n));
        e.portefeuille = vendre(e.portefeuille, a, n);
      } else return repondre(rappel, { ok: false, erreur: L('Ordre impossible.', 'Invalid order.') });
      p.salonAEcrire = true;
      planifier(id.uid, p);
      repondre(rappel, { ok: true, bourse: vueBourse(p), casino: vue(id.uid) });
    });

    // Dépannage : des rubis contre des dollars, quand on est ruiné (une fois par jour). Jamais l'inverse.
    socket.on('casino_depannage', async (_data: unknown, rappel?: Rappel) => {
      const id = await acces(rappel);
      if (!id) return;
      const p = portes.get(id.uid);
      if (!p || !dans) return repondre(rappel, INTROUVABLE);
      if (p.occupe) return repondre(rappel, { ok: false, erreur: L('Patiente une seconde.', 'Wait a second.') });
      const jour = jourParis(horloge());
      const e = p.salonJ;
      if (p.solde >= SEUIL_DEPANNAGE) return repondre(rappel, { ok: false, erreur: L(`Le dépannage n’est possible que sous ${formatDollars(SEUIL_DEPANNAGE)}.`, `Bailouts are only possible under ${formatDollars(SEUIL_DEPANNAGE, true)}.`), casino: vue(id.uid) });
      if (e.depannage === jour) return repondre(rappel, { ok: false, erreur: L('Un seul dépannage par jour : reviens demain.', 'One bailout a day: come back tomorrow.'), casino: vue(id.uid) });
      if (e.rubis < PRIX_DEPANNAGE) return repondre(rappel, { ok: false, erreur: L(`Il faut ${PRIX_DEPANNAGE} rubis.`, `You need ${PRIX_DEPANNAGE} rubies.`), casino: vue(id.uid) });
      const montant = dollarsDepannage(niveauDe(p));
      e.rubis -= PRIX_DEPANNAGE;
      e.depannage = jour;
      mouvement(id.uid, p, montant);
      p.salonAEcrire = true;
      planifier(id.uid, p);
      repondre(rappel, { ok: true, depannage: montant, casino: vue(id.uid) });
    });

    socket.on('disconnect', () => {
      const id = ctx.identite();
      partir();
      if (id && portes.has(id.uid)) void ecrire(id.uid);
    });

    brancherSocial(socket, { acces, identite: ctx.identite, L, auSalon: (uid: string) => dans && portes.has(uid) && monUid === uid });
  }

  /**
   * Écrit tout ce qui attend (arrêt du serveur, tests). Render arrête le serveur à chaque mise à jour du site : les
   * mises encore en jeu (donne, tour, manche, envol, partie des Coffres) sont rendues avant, pour que personne ne perde
   * une mise dont le coup ne sera jamais joué.
   */
  async function vider() {
    for (const jeu of [tables, roulettes, show, couronne, course, roueBW, roueBal, coffres, toits]) {
      try {
        jeu.rendreMisesEnCours();
      } catch (e) {
        console.error('Casino : mises en cours non rendues :', e);
      }
    }
    tables.fermer();
    roulettes.fermer();
    show.fermer();
    couronne.fermer();
    course.fermer();
    roueBW.fermer();
    roueBal.fermer();
    chute.fermer();
    tickets.fermer();
    defis.fermer();
    ventes.fermer();
    bourse.fermer();
    await cercles.fermer();
    await Promise.all([...portes.keys()].map((uid) => ecrire(uid)));
    if (minuterieSalon) {
      clearTimeout(minuterieSalon);
      minuterieSalon = null;
      await comptes.ecrireParametre('casino', reglagesSalon()).catch(() => undefined);
    }
  }

  /** La table du Salon privé où ce téléphone est assis (pour inviter des amis), ou null. */
  function tableDe(socketId: string): { jeu: 'blackjack' | 'roulette'; code: string } | null {
    const bj = tables.tableDe(socketId);
    if (bj) return { jeu: 'blackjack', code: bj };
    const rl = roulettes.tableDe(socketId);
    return rl ? { jeu: 'roulette', code: rl } : null;
  }
  const tableComplete = (jeu: 'blackjack' | 'roulette', code: string) => (jeu === 'blackjack' ? tables.complete(code) : roulettes.complete(code));

  // -------------------------------------------------------------------------------------------------------------
  // Profil, amis, envois et défis du casino

  /** Où joue quelqu'un (s'il est au salon) ; à une table, avec son code pour le rejoindre. */
  function positionDe(uid: string): PositionCasino | null {
    if (!presents.has(uid)) return null;
    const pos = positions.get(uid);
    if (!pos) return { ecran: 'salon' };
    if (pos.ecran === 'blackjack' || pos.ecran === 'roulette') {
      const t = tableDe(pos.sid);
      return t && t.jeu === pos.ecran ? { ecran: pos.ecran, table: t.code } : { ecran: 'salon' };
    }
    return { ecran: pos.ecran };
  }

  /** Un joueur du salon, en bref : son porte-monnaie s'il est en mémoire, sinon la liste des riches (null si inconnu). */
  function joueurCasino(uid: string): JoueurCasino | null {
    const p = portes.get(uid);
    const r = riches.get(uid);
    if (!p && !r) return null;
    return { uid, nom: p?.nom ?? r?.nom ?? '', avatar: p?.avatar ?? r?.avatar ?? 1, niveau: p ? niveauDe(p) : (r?.niveau ?? 1), enLigne: presents.has(uid), ou: positionDe(uid) };
  }
  /** Les mêmes, en allant lire Firestore pour ceux que le salon ne connaît pas encore. */
  async function joueursCasino(uids: string[]): Promise<Record<string, JoueurCasino>> {
    const res: Record<string, JoueurCasino> = {};
    const manquants: string[] = [];
    for (const u of uids) {
      const j = joueurCasino(u);
      if (j) res[u] = j;
      else manquants.push(u);
    }
    if (manquants.length) {
      const lus = await comptes.lirePlusieurs(manquants).catch(() => ({}) as Record<string, StatsCompte | null>);
      for (const u of manquants) {
        const s = lus[u];
        if (s?.casino) res[u] = { uid: u, nom: s.nom, avatar: s.avatar, niveau: niveauCasino(xpDeMises((s.casino.mise ?? 0) + (s.casino.bonusXp ?? 0))), enLigne: false, ou: null };
      }
    }
    return res;
  }

  const envoisDuJour = (p: Porte) => (p.envois.jour === jourParis(horloge()) ? p.envois.total : 0);

  async function vueAmis(uid: string): Promise<VueAmisCasino> {
    const p = portes.get(uid)!;
    const connus = new Set([...p.amis, ...p.recues, ...p.envoyees]);
    const autres = [...riches.keys()].filter((u) => u !== uid && !connus.has(u));
    const fiches = await joueursCasino([...connus, ...autres]);
    const liste = (us: string[]) => us.map((u) => fiches[u]).filter((j): j is JoueurCasino => !!j);
    const parNiveau = (a: JoueurCasino, b: JoueurCasino) => Number(b.enLigne) - Number(a.enLigne) || b.niveau - a.niveau || a.nom.localeCompare(b.nom);
    return {
      amis: liste(p.amis).sort(parNiveau),
      recues: liste(p.recues),
      envoyees: liste(p.envoyees),
      autres: liste(autres).sort(parNiveau).slice(0, 40),
      envoisRestants: Math.max(0, ENVOI_MAX_JOUR - envoisDuJour(p)),
    };
  }

  function brancherSocial(
    socket: Socket,
    ctx: { acces: (rappel: unknown) => Promise<Identite | null>; identite: () => Identite | null; L: (fr: string, en: string) => string; auSalon: (uid: string) => boolean },
  ) {
    const { L } = ctx;
    const repondre = (rappel: unknown, r: Reponse) => {
      if (typeof rappel === 'function') (rappel as Rappel)(r);
    };
    const erreur = (rappel: unknown, fr: string, en: string) => repondre(rappel, { ok: false, erreur: L(fr, en) });
    /** Le joueur et son porte-monnaie, s'il est bien entré au salon ; sinon « Introuvable. » est déjà envoyé. */
    const auSalon = async (rappel: unknown): Promise<{ id: Identite; p: Porte } | null> => {
      const id = await ctx.acces(rappel);
      if (!id) return null;
      const p = portes.get(id.uid);
      if (!p || !ctx.auSalon(id.uid)) return repondre(rappel, INTROUVABLE), null;
      return { id, p };
    };

    // Où je joue (pour que mes amis puissent me rejoindre).
    socket.on('casino_position', (data: { ecran?: unknown } = {}) => {
      const id = ctx.identite();
      const ecran = data?.ecran;
      if (!id || !ctx.auSalon(id.uid) || !(ecran === 'salon' || estJeuCasino(ecran))) return;
      positions.set(id.uid, { ecran, sid: socket.id });
    });

    socket.on('casino_profil', async (data: { uid?: unknown } = {}, rappel?: Rappel) => {
      const m = await auSalon(rappel);
      if (!m) return;
      const { id, p } = m;
      const cible = typeof data?.uid === 'string' && data.uid ? data.uid : id.uid;
      const q = portes.get(cible);
      let base: Omit<ProfilCasino, 'uid' | 'niveau' | 'xp' | 'xpNiveau' | 'xpSuivant' | 'bonusSuivant' | 'enLigne' | 'ou' | 'relation'> & { journal: EntreeJournalCasino[] };
      /** Mises comptées en plus pour l'XP (jeu à l'affiche). */
      let bonusXp = q?.bonusXp ?? 0;
      if (q) base = { nom: q.nom, avatar: q.avatar, solde: q.solde, mise: q.mise, gagne: q.gagne, plusGrosGain: Math.max(q.plusGrosGain, q.record), jeux: q.jeux, defis: q.defisBilan, depuis: q.depuis, journal: q.journal };
      else {
        const s = await comptes.lire(cible).catch(() => null);
        const c = s?.casino;
        if (!s || !c) return erreur(rappel, 'Joueur introuvable.', 'Player not found.');
        bonusXp = c.bonusXp ?? 0;
        base = { nom: s.nom, avatar: s.avatar, solde: c.solde, mise: c.mise ?? 0, gagne: c.gagne ?? 0, plusGrosGain: c.plusGrosGain ?? 0, jeux: c.jeux ?? {}, defis: c.defis ?? { gagnes: 0, perdus: 0, nuls: 0 }, depuis: c.depuis, journal: c.journal ?? [] };
      }
      const relation: ProfilCasino['relation'] =
        cible === id.uid ? 'moi' : p.amis.includes(cible) ? 'ami' : p.envoyees.includes(cible) ? 'demande_envoyee' : p.recues.includes(cible) ? 'demande_recue' : 'aucune';
      const { journal, ...reste } = base;
      const profil: ProfilCasino = { uid: cible, ...reste, ...progressionCasino(base.mise + bonusXp), enLigne: presents.has(cible), ou: positionDe(cible), relation, ...(relation === 'moi' ? { journal } : {}) };
      repondre(rappel, { ok: true, profil });
    });

    socket.on('casino_mes_amis', async (_data: unknown, rappel?: Rappel) => {
      const m = await auSalon(rappel);
      if (!m) return;
      repondre(rappel, { ok: true, amis: await vueAmis(m.id.uid) });
    });

    socket.on('casino_ami', async (data: { uid?: unknown; action?: unknown } = {}, rappel?: Rappel) => {
      const m = await auSalon(rappel);
      if (!m) return;
      const { id, p } = m;
      const autre = data?.uid;
      const action = data?.action;
      if (typeof autre !== 'string' || !autre || (action !== 'demander' && action !== 'accepter' && action !== 'refuser' && action !== 'retirer')) return erreur(rappel, 'Demande impossible.', 'Invalid request.');
      try {
        const r = await comptes.lienCasino(id.uid, autre, action);
        for (const [u, c] of Object.entries(r.comptes)) {
          const q = portes.get(u);
          if (!q) continue;
          q.amis = [...(c.amis ?? [])];
          q.recues = [...(c.demandesRecues ?? [])];
          q.envoyees = [...(c.demandesEnvoyees ?? [])];
        }
        if (r.resultat === 'introuvable' || r.resultat === 'soi_meme') return erreur(rappel, 'Joueur introuvable.', 'Player not found.');
        if (r.resultat === 'limite') return erreur(rappel, 'Liste d’amis pleine (50 au plus).', 'Friend list full (50 at most).');
        if (r.resultat === 'envoyee') notifier(autre, 'casino_social', { type: 'demande', nom: p.nom });
        if (r.resultat === 'amis') notifier(autre, 'casino_social', { type: 'ami', nom: p.nom });
        for (const u of [id.uid, autre]) notifier(u, 'casino_amis_maj', null);
        repondre(rappel, { ok: true, resultat: r.resultat, amis: await vueAmis(id.uid), casino: vue(id.uid) });
      } catch (e) {
        console.error('Casino : amis indisponibles :', e);
        erreur(rappel, 'Les amis sont indisponibles pour le moment, réessaie plus tard.', 'Friends are unavailable right now, try again later.');
      }
    });

    // Envoyer de l'argent à un ami du casino (sommes fixes, plafond par jour).
    socket.on('casino_envoyer', async (data: { uid?: unknown; montant?: unknown } = {}, rappel?: Rappel) => {
      const m = await auSalon(rappel);
      if (!m) return;
      const { id, p } = m;
      const dest = data?.uid;
      const montant = Number(data?.montant);
      if (typeof dest !== 'string' || !MONTANTS_ENVOI.includes(montant)) return erreur(rappel, 'Envoi impossible.', 'Invalid transfer.');
      if (!p.amis.includes(dest)) return erreur(rappel, 'Tu ne peux envoyer de l’argent qu’à tes amis du casino.', 'You can only send money to your casino friends.');
      const fiche = (await joueursCasino([dest]))[dest];
      if (!fiche) return erreur(rappel, 'Joueur introuvable.', 'Player not found.');
      // Vérifié et débité d'un bloc (sans attente) : deux envois simultanés ne dépassent jamais le plafond.
      const jour = jourParis(horloge());
      const deja = envoisDuJour(p);
      if (deja + montant > ENVOI_MAX_JOUR) {
        const reste = Math.max(0, ENVOI_MAX_JOUR - deja);
        return erreur(rappel, `Plafond du jour : tu peux encore envoyer ${formatDollars(reste)}.`, `Daily limit: you can still send ${formatDollars(reste, true)}.`);
      }
      if (p.solde < montant) return erreur(rappel, 'Solde insuffisant.', 'Not enough money.');
      // Les dollars d'un dépannage ne partent pas chez un ami : après un dépannage, les envois reprennent demain.
      if (p.salonJ.depannage === jour) return erreur(rappel, 'Après un dépannage, les envois reprennent demain.', 'After a bailout, transfers resume tomorrow.');
      mouvement(id.uid, p, -montant);
      p.envois = { jour, total: deja + montant };
      p.envoisAEcrire = true;
      const t = horloge();
      noterJournal(id.uid, { t, type: 'envoi', nom: fiche.nom, montant });
      verserHorsJeu(dest, montant);
      noterJournal(dest, { t, type: 'recu', nom: p.nom, montant });
      notifier(dest, 'casino_social', { type: 'recu', nom: p.nom, montant });
      repondre(rappel, { ok: true, envoisRestants: ENVOI_MAX_JOUR - deja - montant, casino: vue(id.uid) });
    });

    socket.on('casino_defis', async (_data: unknown, rappel?: Rappel) => {
      const m = await auSalon(rappel);
      if (!m) return;
      repondre(rappel, { ok: true, defis: defis.vuesDe(m.id.uid) });
    });

    socket.on('casino_defi_lancer', async (data: { uid?: unknown; jeu?: unknown; duree?: unknown; mise?: unknown } = {}, rappel?: Rappel) => {
      const m = await auSalon(rappel);
      if (!m) return;
      const { id, p } = m;
      const dest = data?.uid;
      if (typeof dest !== 'string') return erreur(rappel, 'Défi impossible.', 'Invalid challenge.');
      const fiche = (await joueursCasino([dest]))[dest];
      if (!fiche) return erreur(rappel, 'Joueur introuvable.', 'Player not found.');
      const r = defis.lancer({ uid: id.uid, nom: p.nom, avatar: p.avatar }, { uid: dest, nom: fiche.nom, avatar: fiche.avatar }, data?.jeu, data?.duree, data?.mise);
      if (!r.ok) return erreur(rappel, ...r.erreur);
      repondre(rappel, { ok: true, defi: r.defi, casino: vue(id.uid) });
    });

    socket.on('casino_defi_repondre', async (data: { id?: unknown; accepter?: unknown } = {}, rappel?: Rappel) => {
      const m = await auSalon(rappel);
      if (!m) return;
      const r = defis.repondre(m.id.uid, data?.id, data?.accepter === true);
      if (!r.ok) return erreur(rappel, ...r.erreur);
      repondre(rappel, { ok: true, defi: r.defi, casino: vue(m.id.uid) });
    });

    socket.on('casino_defi_annuler', async (data: { id?: unknown } = {}, rappel?: Rappel) => {
      const m = await auSalon(rappel);
      if (!m) return;
      const r = defis.annuler(m.id.uid, data?.id);
      if (!r.ok) return erreur(rappel, ...r.erreur);
      repondre(rappel, { ok: true, defi: r.defi, casino: vue(m.id.uid) });
    });
  }

  /**
   * Un invité passe sur son compte : ce qui attend est écrit, puis sa progression au casino est déplacée d'un bloc.
   * Les deux portes sont oubliées (relues au prochain passage).
   */
  async function transfererInvite(de: string, vers: string): Promise<'fait' | 'deja' | 'vide'> {
    if (portes.has(de)) await ecrire(de);
    const p = portes.get(de);
    if (p?.occupe || p?.ecrituresEnVol || p?.enAttente) return 'vide';
    const r = await comptes.transfererCasino(de, vers);
    if (r === 'fait') {
      for (const uid of [de, vers]) {
        const porte = portes.get(uid);
        if (porte?.minuterie) clearTimeout(porte.minuterie);
        portes.delete(uid);
        createurs.delete(uid);
      }
      riches.delete(de);
    }
    return r;
  }

  return { brancher, vider, estCreateur, tableDe, tableComplete, transfererInvite };
}
