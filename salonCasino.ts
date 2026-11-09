/**
 * Salon privé du Baron (casino des comptes Créateur) : solde, roulette du salon, machine à sous, gros lot progressif.
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
  CASE_VERTE_SALON,
  CASES_ROUE_SALON,
  GROS_LOT_DEPART,
  MULTIPLE_GROS_GAIN,
  PART_GROS_LOT,
  SOLDE_MAX,
  type AnnonceCasino,
  type RicheSalon,
  type VueCasino,
} from '../shared/casino';
import { MISES_MACHINE, TOURS_GRATUITS_MAX, tirerMachine } from '../shared/machineASous';
import { jourParis, lendemainParis } from '../shared/roulette';
import type { Identite, ServiceComptes, StatsCompte } from './comptes';

type Reponse = { ok: true; [cle: string]: unknown } | { ok: false; erreur: string };
type Rappel = (r: Reponse) => void;

export interface OptionsCasino {
  io: Server;
  comptes: ServiceComptes;
  horloge?: () => number;
  /** Case de la roulette du salon (remplaçable pour les tests ; au hasard sinon). */
  tirageRoue?: () => number;
  /** Hasard de la machine à sous : entier de 0 à n − 1 (remplaçable pour les tests). */
  hasardMachine?: (n: number) => number;
  /** Regroupement des écritures du solde, en millisecondes. */
  delaiEcriture?: number;
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
  toursGratuits: number;
  miseGratuite: number;
  minuterie: ReturnType<typeof setTimeout> | null;
  ecriture: Promise<void>;
  /** Un tour à la fois : un double appui ne débite jamais deux fois. */
  occupe: boolean;
  dernierTour: number;
}

const SALLE = 'casino';
const INTROUVABLE: Reponse = { ok: false, erreur: 'Introuvable.' };
/** Délai minimal entre deux tours de machine (les rouleaux tournent bien plus longtemps à l'écran). */
const ECART_TOURS_MS = 350;

export function creerCasino(options: OptionsCasino) {
  const { io, comptes } = options;
  const horloge = options.horloge ?? Date.now;
  const delaiEcriture = options.delaiEcriture ?? 5000;
  const hasardMachine = options.hasardMachine ?? ((n: number) => randomInt(n));
  const tirageRoue = options.tirageRoue ?? (() => randomInt(CASES_ROUE_SALON.length));

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
      const d = (brut ?? {}) as { grosLot?: unknown; riches?: unknown };
      if (typeof d.grosLot === 'number' && Number.isFinite(d.grosLot) && d.grosLot >= GROS_LOT_DEPART) grosLot = Math.floor(d.grosLot);
      if (d.riches && typeof d.riches === 'object') {
        for (const [uid, r] of Object.entries(d.riches as Record<string, unknown>)) {
          const x = r as { nom?: unknown; avatar?: unknown; solde?: unknown };
          if (typeof x?.solde === 'number' && !riches.has(uid)) riches.set(uid, { nom: typeof x.nom === 'string' ? x.nom : '', avatar: typeof x.avatar === 'number' ? x.avatar : 1, solde: x.solde });
        }
      }
    })
    .catch((e) => console.error('Casino : lecture des réglages impossible :', e));

  const sauverSalon = () => {
    if (minuterieSalon) return;
    minuterieSalon = setTimeout(() => {
      minuterieSalon = null;
      void comptes.ecrireParametre('casino', { grosLot, riches: Object.fromEntries(riches) }).catch((e) => console.error('Casino : écriture impossible :', e));
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
      riches: liste,
    };
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
          toursGratuits: 0,
          miseGratuite: 0,
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
        if (tirage === CASE_VERTE_SALON) annoncer({ nom: p.nom, jeu: 'roue', gain: r.gain });
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
          gainGrosLot = grosLot;
          gain += grosLot;
          grosLot = GROS_LOT_DEPART;
          diffuserGrosLot(true);
        } else diffuserGrosLot();
        if (gain) mouvement(id.uid, p, gain);
        if (gain > 0) p.record = Math.max(p.record, gain);
        if (r.toursGagnes) {
          if (!gratuit) p.miseGratuite = mise;
          p.toursGratuits = Math.min(TOURS_GRATUITS_MAX, p.toursGratuits + r.toursGagnes);
        }
        if (!p.toursGratuits) p.miseGratuite = 0;
        if (gainGrosLot) annoncer({ nom: p.nom, jeu: 'machine', gain, grosLot: true });
        else if (gain >= MULTIPLE_GROS_GAIN * mise) annoncer({ nom: p.nom, jeu: 'machine', gain });
        sauverSalon();
        repondre(rappel, { ok: true, machine: { ...r, gain, gainGrosLot, gratuit, mise }, casino: vue(id.uid) });
      } finally {
        p.occupe = false;
      }
    });

    socket.on('disconnect', () => {
      const id = ctx.identite();
      if (id && portes.has(id.uid)) void ecrire(id.uid);
    });
  }

  /** Écrit tout ce qui attend (arrêt du serveur, tests). */
  async function vider() {
    await Promise.all([...portes.keys()].map((uid) => ecrire(uid)));
    if (minuterieSalon) {
      clearTimeout(minuterieSalon);
      minuterieSalon = null;
      await comptes.ecrireParametre('casino', { grosLot, riches: Object.fromEntries(riches) }).catch(() => undefined);
    }
  }

  return { brancher, vider };
}
