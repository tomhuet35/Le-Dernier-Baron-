/**
 * Salon privé du Baron (casino des comptes Créateur) : solde, roulette du salon, machines à sous, tables, le show
 * La Folle Nuit, le Festin du Baron et le gros lot progressif.
 *
 * - Chaque événement casino_* vérifie que le compte connecté a le badge Créateur ; sinon « Introuvable. », sans dire
 *   que le casino existe.
 * - Le serveur est seul maître de l'argent : le téléphone envoie une mise, le serveur la vérifie, la débite, tire le
 *   résultat (crypto.randomInt) et crédite le gain. Le solde ne passe jamais sous zéro.
 * - Le solde de chaque créateur est tenu en mémoire pendant qu'il joue ; les mouvements sont écrits dans Firestore par
 *   transaction, regroupés (au plus une écriture toutes les 5 s, et à la sortie du salon ou à la déconnexion).
 * - Gros lot et « plus riches du salon » : document « casino » de la collection « parametres ».
 */
import { randomInt } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import {
  cadeauDisponible,
  CADEAUX_SALON,
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
import type { Identite, ServiceComptes, StatsCompte } from './comptes';
import { creerTablesBlackjack, type BanqueCasino, type DelaisTables } from './tablesCasino';
import { creerTablesRoulette, type DelaisRoulette } from './tablesRoulette';
import { dureeAnimationNuits, etatNuitsVide, jouerNuits, meilleurJackpot, type EtatNuits, type ForcerNuits } from '../shared/machineNuits';
import type { CarteBJ } from '../shared/blackjack';
import type { DureesFN, HappyHourFN } from '../shared/folleNuit';
import { creerShowFolleNuit, type TirageImpose } from './showFolleNuit';
import { creerFestin } from './festinCasino';

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
  /** Le Festin du Baron : hasard, et positions des os imposées (tests, démonstration). */
  hasardFestin?: (n: number) => number;
  placerOsFestin?: (os: number) => number[] | undefined;
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
  /** Heure d'ouverture des cadeaux à durée (gardée avec les réglages du serveur). */
  const ouvertures: Record<string, number> = {};

  const portes = new Map<string, Porte>();
  const createurs = new Map<string, { ok: boolean; t: number }>();
  let grosLot = GROS_LOT_DEPART;
  const riches = new Map<string, { nom: string; avatar: number; solde: number }>();
  let minuterieSalon: ReturnType<typeof setTimeout> | null = null;
  let dernierGrosLotDiffuse = 0;

  // Gros lot et plus riches, gardés avec les réglages du serveur.
  const chargement = comptes
    .lireParametre('casino')
    .then((brut) => {
      const d = (brut ?? {}) as { grosLot?: unknown; riches?: unknown; ouvertures?: unknown };
      if (d.ouvertures && typeof d.ouvertures === 'object')
        for (const [k, v] of Object.entries(d.ouvertures as Record<string, unknown>)) if (typeof v === 'number' && Number.isFinite(v)) ouvertures[k] = v;
      if (typeof d.grosLot === 'number' && Number.isFinite(d.grosLot) && d.grosLot >= GROS_LOT_DEPART) grosLot = Math.floor(d.grosLot);
      if (d.riches && typeof d.riches === 'object') {
        for (const [uid, r] of Object.entries(d.riches as Record<string, unknown>)) {
          const x = r as { nom?: unknown; avatar?: unknown; solde?: unknown };
          if (typeof x?.solde === 'number' && !riches.has(uid)) riches.set(uid, { nom: typeof x.nom === 'string' ? x.nom : '', avatar: typeof x.avatar === 'number' ? x.avatar : 1, solde: x.solde });
        }
      }
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
      void comptes.ecrireParametre('casino', { grosLot, riches: Object.fromEntries(riches), ouvertures }).catch((e) => console.error('Casino : écriture impossible :', e));
    }, delaiEcriture);
  };

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
    if (!delta && !record) return p.ecriture;
    p.enAttente = 0;
    p.record = 0;
    p.ecriture = p.ecriture
      .then(() => comptes.mouvementCasino(uid, delta, record || undefined))
      .then(() => undefined)
      .catch((e) => {
        console.error('Casino : écriture du solde impossible :', e);
        p.enAttente += delta; // réessayé à la prochaine écriture
        p.record = Math.max(p.record, record);
      });
    return p.ecriture;
  }

  function mouvement(uid: string, p: Porte, delta: number) {
    p.solde = Math.min(SOLDE_MAX, Math.max(0, p.solde + delta));
    p.enAttente += delta;
    riches.set(uid, { nom: p.nom, avatar: p.avatar, solde: p.solde });
    sauverSalon();
    if (!p.minuterie) p.minuterie = setTimeout(() => void ecrire(uid), delaiEcriture);
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
      const p = portes.get(uid);
      if (!p) return void comptes.mouvementCasino(uid, montant).catch((e) => console.error('Casino : gain perdu :', e));
      mouvement(uid, p, montant);
      p.record = Math.max(p.record, montant);
    },
    joueur: (uid) => {
      const p = portes.get(uid);
      return p ? { nom: p.nom, avatar: p.avatar } : null;
    },
  };
  const tables = creerTablesBlackjack({ io, banque, horloge, delais: options.delaisTables, sabot: options.sabotBlackjack });
  const roulettes = creerTablesRoulette({ io, banque, horloge, delais: options.delaisRoulette, tirage: options.tirageRoulette, annoncer: (a) => annoncer(a) });
  const festin = creerFestin({ banque, hasard: options.hasardFestin, placer: options.placerOsFestin, annoncer: (a) => annoncer(a) });
  const show = creerShowFolleNuit({ io, banque, horloge, hasard: options.hasardFolleNuit, delais: options.delaisFolleNuit, tirage: options.tirageFolleNuit, happyHour: options.happyHourFolleNuit, annoncer: (a) => annoncer(a) });

  function vue(uid: string): VueCasino {
    const p = portes.get(uid);
    const t = horloge();
    const liste: RicheSalon[] = [...riches.entries()]
      .sort(([, a], [, b]) => b.solde - a.solde)
      .slice(0, 10)
      .map(([u, r]) => ({ nom: r.nom, avatar: r.avatar, solde: r.solde, ...(u === uid ? { moi: true as const } : {}) }));
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
      festin: { enCours: festin.enCours(uid) },
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
    const porteDe = (id: Identite, stats: StatsCompte): Porte => {
      let p = portes.get(id.uid);
      if (!p) {
        p = {
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
      riches.set(id.uid, { nom: p.nom, avatar: p.avatar, solde: p.solde });
      return p;
    };
    let dans = false;
    tables.brancher(socket, { acces, enSalon: (uid) => dans && portes.has(uid), L });
    roulettes.brancher(socket, { acces, enSalon: (uid) => dans && portes.has(uid), L });
    show.brancher(socket, { acces, enSalon: (uid) => dans && portes.has(uid), L });
    festin.brancher(socket, { acces, enSalon: (uid) => dans && portes.has(uid), L });

    socket.on('casino_entrer', async (_data: unknown, rappel?: Rappel) => {
      const id = await acces(rappel);
      if (!id) return;
      try {
        await chargement;
        const stats = await comptes.entrerCasino(id.uid);
        if (!stats) return repondre(rappel, INTROUVABLE);
        porteDe(id, stats);
        sauverSalon();
        void socket.join(SALLE);
        dans = true;
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
      void socket.leave(SALLE);
      dans = false;
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
        riches.set(id.uid, { nom: p.nom, avatar: p.avatar, solde: p.solde });
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
        riches.set(id.uid, { nom: p.nom, avatar: p.avatar, solde: p.solde });
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
        if (gain) mouvement(id.uid, p, gain);
        if (gain > 0) p.record = Math.max(p.record, gain);
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
        if (!gratuit) mouvement(id.uid, p, -mise);
        const { resultat } = jouerNuits(hasardNuits, mise, e, options.forcerNuits?.());
        if (resultat.gain) {
          mouvement(id.uid, p, resultat.gain);
          p.record = Math.max(p.record, resultat.gain);
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
        if (gain) {
          mouvement(id.uid, p, gain);
          p.record = Math.max(p.record, gain);
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
      if (gain) {
        mouvement(id.uid, p, gain);
        p.record = Math.max(p.record, gain);
      }
      if (c.type === 'grosLot') annoncer({ nom: p.nom, jeu: 'roueBaron', gain, grosLot: true });
      else if (gain >= MULTIPLE_GROS_GAIN * b.mise) annoncer({ nom: p.nom, jeu: 'roueBaron', gain });
      if (!p.toursGratuits && !p.bonus.length) p.miseGratuite = 0;
      sauverSalon();
      repondre(rappel, { ok: true, roueBaron: { case: i, gain, tours, grosLot: c.type === 'grosLot' }, casino: vue(id.uid) });
    });

    socket.on('disconnect', () => {
      const id = ctx.identite();
      if (id && portes.has(id.uid)) void ecrire(id.uid);
    });
  }

  /** Écrit tout ce qui attend (arrêt du serveur, tests). */
  async function vider() {
    tables.fermer();
    roulettes.fermer();
    show.fermer();
    await Promise.all([...portes.keys()].map((uid) => ecrire(uid)));
    if (minuterieSalon) {
      clearTimeout(minuterieSalon);
      minuterieSalon = null;
      await comptes.ecrireParametre('casino', { grosLot, riches: Object.fromEntries(riches), ouvertures }).catch(() => undefined);
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

  return { brancher, vider, estCreateur, tableDe, tableComplete };
}
