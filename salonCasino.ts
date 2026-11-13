/**
 * Salon privé du Baron (casino des comptes Créateur) : solde, roulette du salon, machines à sous, tables, le show
 * La Folle Nuit, les Coffres du Baron, le Vol de la Couronne, la Chute des Écus, le gros lot progressif, et le jeu à
 * l'affiche (toutes les 3 heures, un jeu compte double pour l'XP et donne 10 % de bonus sur ses gains).
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
import { gainCasse, MISES_MACHINE, nouveauCasse, ouvrirCasse, ROUE_BARON, TOURS_GRATUITS_MAX, tirerMachine, type EtatCasse } from '../shared/machineASous';
import { jourParis, lendemainParis } from '../shared/roulette';
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
import type { DureesFN, HappyHourFN } from '../shared/folleNuit';
import { creerShowFolleNuit, type TirageImpose } from './showFolleNuit';
import { creerCoffres } from './festinCasino';
import { creerVolCouronne } from './couronneCasino';
import { creerChute } from './chuteCasino';
import { afficheCasino, BONUS_AFFICHE, PLAFOND_BONUS_AFFICHE, XP_AFFICHE, type AfficheCasino } from '../shared/afficheCasino';
import type { DureesCouronne } from '../shared/couronne';

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
  /** Happy Hour de la Folle Nuit imposée (démonstration). */
  happyHourFolleNuit?: (t: number) => HappyHourFN;
  /** Les Coffres du Baron : hasard, et positions des badges de police imposées (tests, démonstration). */
  hasardCoffres?: (n: number) => number;
  placerBadgesCoffres?: (badges: number) => number[] | undefined;
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
  /** Le jeu à l'affiche à l'instant t (remplaçable pour les tests et la démonstration ; null : aucun). */
  jeuALaffiche?: (t: number) => AfficheCasino | null;
}

/** Porte-monnaie d'un créateur, tenu en mémoire pendant qu'il joue. */
interface Porte {
  nom: string;
  avatar: number;
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
  /** Écritures lancées (compteur) et en cours : pas de recalage sur un compte lu pendant une écriture. */
  ecrituresLancees: number;
  ecrituresEnVol: number;
}

type BonusMachine = { type: 'casse'; mise: number; etat: EtatCasse } | { type: 'roue'; mise: number };

const SALLE = 'casino';
const INTROUVABLE: Reponse = { ok: false, erreur: 'Introuvable.' };
/** Délai minimal entre deux tours de machine (les rouleaux tournent bien plus longtemps à l'écran). */
const ECART_TOURS_MS = 350;

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

  // Gros lot et plus riches, gardés avec les réglages du serveur.
  const chargement = comptes
    .lireParametre('casino')
    .then((brut) => {
      const d = (brut ?? {}) as { grosLot?: unknown; riches?: unknown; ouvertures?: unknown; defis?: unknown };
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
  const reglagesSalon = () => ({ grosLot, riches: Object.fromEntries(riches), ouvertures, defis: defis.exporter() });

  async function estCreateur(uid: string): Promise<boolean> {
    const c = createurs.get(uid);
    if (c && horloge() - c.t < 60_000) return c.ok;
    const stats = await comptes.lire(uid).catch(() => null);
    const ok = stats?.createur === true;
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
    if (!delta && !record && !Object.keys(extra).length) return p.ecriture;
    p.enAttente = 0;
    p.record = 0;
    p.plusGrosGain = Math.max(p.plusGrosGain, record);
    p.activite = null;
    p.niveauAEcrire = false;
    p.envoisAEcrire = false;
    p.journalAjouts = [];
    p.defisAjouts = null;
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
      planifier(uid, p);
      const apres = niveauDe(p);
      if (apres > p.niveauPaye) monterNiveau(uid, p, apres);
      if (apres !== avant) majRiche(uid, p);
    }
    defis.noter(uid, jeu, gagnee - misee);
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
  const banqueDe = (jeu: JeuCasino): BanqueCasino => ({
    solde: banque.solde,
    joueur: banque.joueur,
    debiter: (uid, montant) => {
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
    resultat: (uid, adversaire, r, montant) =>
      noterJournal(uid, { t: horloge(), type: 'defi', nom: adversaire, resultat: r, montant }, { gagnes: r === 'gagne' ? 1 : 0, perdus: r === 'perdu' ? 1 : 0, nuls: r === 'nul' ? 1 : 0 }),
    sontAmis: (a, b) => !!portes.get(a)?.amis.includes(b),
    notifier: (uid, d) => notifier(uid, 'casino_defi', d),
    annoncer: (a) => annoncer(a),
    sauver: () => sauverSalon(),
    echelle: options.echelleDefis,
  });
  const tables = creerTablesBlackjack({ io, banque: banqueDe('blackjack'), horloge, delais: options.delaisTables, sabot: options.sabotBlackjack });
  const roulettes = creerTablesRoulette({ io, banque: banqueDe('roulette'), horloge, delais: options.delaisRoulette, tirage: options.tirageRoulette, annoncer: (a) => annoncer(a) });
  const coffres = creerCoffres({ banque: banqueDe('coffres'), hasard: options.hasardCoffres, placer: options.placerBadgesCoffres, annoncer: (a) => annoncer(a) });
  const show = creerShowFolleNuit({ io, banque: banqueDe('folleNuit'), horloge, hasard: options.hasardFolleNuit, delais: options.delaisFolleNuit, tirage: options.tirageFolleNuit, happyHour: options.happyHourFolleNuit, annoncer: (a) => annoncer(a) });
  const couronne = creerVolCouronne({ io, banque: banqueDe('couronne'), horloge, delais: options.delaisCouronne, k: options.kCouronne, tirage: options.tirageCouronne, annoncer: (a) => annoncer(a) });
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
      couronne: couronne.resume(),
      ...(p ? { profil: { ...progressionCasino(p.mise + p.bonusXp), demandes: p.recues.length, invitations: defis.invitations(uid), defi: defis.enCours(uid) } } : {}),
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
          niveauAEcrire: false,
          envoisAEcrire: false,
          ecrituresLancees: 0,
          ecrituresEnVol: 0,
          nom: stats.nom || id.nom || '',
          avatar: stats.avatar,
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
      if (c && calme && !p.enAttente && !p.record && !p.activite && !p.journalAjouts.length && !p.defisAjouts && !p.niveauAEcrire && !p.envoisAEcrire) {
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
        porteDe(id, stats, lancees);
        sauverSalon();
        void socket.join(SALLE);
        dans = true;
        if (monUid && monUid !== id.uid) partir();
        monUid = id.uid;
        presents.set(id.uid, (presents.get(id.uid) ?? new Set()).add(socket.id));
        if (!positions.has(id.uid)) positions.set(id.uid, { ecran: 'salon', sid: socket.id });
        repondre(rappel, { ok: true, casino: vue(id.uid) });
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
        const r = await comptes.tournerRoueSalon(id.uid, jourParis(horloge()), tirage);
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
        sauverSalon();
        repondre(rappel, { ok: true, machine: { ...r, gain, gainGrosLot, gratuit, mise }, casino: vue(id.uid) });
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
      if (c.type === 'grosLot') annoncer({ nom: p.nom, jeu: 'roueBaron', gain, grosLot: true });
      else if (gain >= MULTIPLE_GROS_GAIN * b.mise) annoncer({ nom: p.nom, jeu: 'roueBaron', gain });
      if (!p.toursGratuits && !p.bonus.length) p.miseGratuite = 0;
      sauverSalon();
      repondre(rappel, { ok: true, roueBaron: { case: i, gain, tours, grosLot: c.type === 'grosLot' }, casino: vue(id.uid) });
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
    for (const jeu of [tables, roulettes, show, couronne, coffres]) {
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
    chute.fermer();
    defis.fermer();
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

  return { brancher, vider, estCreateur, tableDe, tableComplete };
}
