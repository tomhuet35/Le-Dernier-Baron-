/**
 * La Course des Écuries : les courses en direct du Salon privé. Une seule course à la fois pour tout le salon, qui
 * tourne tant qu'au moins un créateur la regarde.
 *
 * Une course : mises (20 s) → départ (3,5 s, les mises sont fermées) → la course → les résultats (8 s).
 * - Les partants (noms, formes, cotes) sont tirés à l'ouverture des mises ; l'ordre d'arrivée et le scénario au départ
 *   (crypto.randomInt). Le scénario part chez tous les téléphones : chacun voit la même course.
 * - Chaque mise est débitée tout de suite (rendue si elle est annulée avant le départ, ou si le serveur s'arrête).
 * - À l'arrivée du dernier cheval, les gains sont versés ; un gros gain est annoncé au salon.
 */
import { randomInt } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import type { AnnonceCasino } from '../shared/casino';
import {
  DUREES_COURSE,
  gainMiseCourse,
  JETONS_COURSE,
  MAX_COURSE,
  MAX_MISE_COURSE,
  NB_CHEVAUX,
  scenarioCourse,
  tirerArrivee,
  tirerPartants,
  TYPES_MISE_COURSE,
  type DureesCourse,
  type Hasard,
  type JoueurCourse,
  type MiseCourse,
  type Partant,
  type PhaseCourse,
  type ScenarioCourse,
  type TypeMiseCourse,
  type VueCourse,
} from '../shared/course';
import type { Identite } from './comptes';
import type { BanqueCasino } from './tablesCasino';

type Reponse = { ok: true; [cle: string]: unknown } | { ok: false; erreur: string };
type Rappel = (r: Reponse) => void;

const SALLE_COURSE = 'casino-course';
const GRILLE = 2 ** 48 - 1;
const hasardCrypto: Hasard = () => randomInt(0, GRILLE) / GRILLE;

interface Joueur {
  uid: string;
  nom: string;
  avatar: number;
  mises: MiseCourse[];
  gain: number | null;
}

const total = (ms: MiseCourse[]) => ms.reduce((s, m) => s + m.montant, 0);

export function creerCourse(options: {
  io: Server;
  banque: BanqueCasino;
  horloge?: () => number;
  delais?: Partial<DureesCourse>;
  hasard?: Hasard;
  /** Ordre d'arrivée imposé (tests, démonstration) ; au hasard sinon. */
  arrivee?: () => number[] | undefined;
  annoncer?: (a: AnnonceCasino) => void;
}) {
  const { io, banque } = options;
  const horloge = options.horloge ?? Date.now;
  const D: DureesCourse = { ...DUREES_COURSE, ...options.delais };
  const hasard = options.hasard ?? hasardCrypto;

  const spectateurs = new Map<string, { uid: string }>();
  const joueurs = new Map<string, Joueur>();
  /** Les mises de la course précédente, pour « Refaire ». */
  const precedentes = new Map<string, MiseCourse[]>();
  let numero = 0;
  let phase: PhaseCourse = 'mises';
  let fin: number | null = null;
  let duree: number | null = null;
  let partants: Partant[] = tirerPartants(hasard);
  let scenario: ScenarioCourse | null = null;
  let depart = 0;
  let minuterie: ReturnType<typeof setTimeout> | null = null;
  let enCours = false;
  let historique: VueCourse['historique'] = [];

  const uidsSpectateurs = () => new Set([...spectateurs.values()].map((s) => s.uid));

  function vue(uid: string | null): VueCourse {
    const t = horloge();
    const j = uid ? joueurs.get(uid) : undefined;
    const liste: JoueurCourse[] = [...joueurs.values()]
      .filter((x) => x.mises.length)
      .map((x) => ({ nom: x.nom, avatar: x.avatar, mise: total(x.mises), gain: x.gain, ...(x.uid === uid ? { moi: true as const } : {}) }))
      .sort((a, b) => (b.gain ?? 0) - (a.gain ?? 0) || b.mise - a.mise);
    return {
      numero,
      phase,
      reste: fin === null ? null : Math.max(0, fin - t),
      duree,
      partants: partants.map((p) => ({ nom: p.nom, cote: p.cote, place: p.place })),
      scenario: phase === 'course' || phase === 'resultat' ? scenario : null,
      ecoule: phase === 'course' || phase === 'resultat' ? t - depart : null,
      mesMises: j ? j.mises.map((m) => ({ ...m })) : [],
      peutRefaire: !!uid && !!precedentes.get(uid)?.length,
      monGain: phase === 'resultat' && j ? j.gain : null,
      joueurs: liste.slice(0, 20),
      historique,
      spectateurs: uidsSpectateurs().size,
      solde: uid ? banque.solde(uid) : 0,
    };
  }

  function diffuser() {
    for (const [sid, s] of spectateurs) io.to(sid).emit('casino_course', vue(s.uid));
  }

  function arreter() {
    if (minuterie) clearTimeout(minuterie);
    minuterie = null;
  }
  function plusTard(f: () => void, ms: number) {
    arreter();
    minuterie = setTimeout(f, Math.max(0, ms));
    minuterie.unref?.();
  }

  function ouvrirMises() {
    arreter();
    // Les mises de la course qui vient de finir deviennent celles à « Refaire ».
    for (const j of joueurs.values()) if (j.mises.length) precedentes.set(j.uid, j.mises.map((m) => ({ ...m })));
    joueurs.clear();
    scenario = null;
    if (!spectateurs.size) {
      enCours = false;
      phase = 'mises';
      fin = null;
      duree = null;
      return;
    }
    enCours = true;
    numero += 1;
    phase = 'mises';
    partants = tirerPartants(hasard);
    fin = horloge() + D.mises;
    duree = D.mises;
    plusTard(fermerMises, D.mises);
    diffuser();
  }

  function fermerMises() {
    phase = 'depart';
    fin = horloge() + D.depart;
    duree = D.depart;
    plusTard(lancer, D.depart);
    diffuser();
  }

  function lancer() {
    const impose = options.arrivee?.();
    const ordre =
      impose && impose.length === NB_CHEVAUX && new Set(impose).size === NB_CHEVAUX && impose.every((c) => Number.isInteger(c) && c >= 0 && c < NB_CHEVAUX)
        ? [...impose]
        : tirerArrivee(
            partants.map((p) => p.chance),
            hasard,
          );
    scenario = scenarioCourse(ordre, hasard, D);
    phase = 'course';
    depart = horloge();
    fin = null;
    duree = null;
    const dernier = Math.max(...scenario.arrivees);
    plusTard(arrivee, dernier + D.apres);
    diffuser();
  }

  function arrivee() {
    if (!scenario) return;
    const ordre = scenario.ordre;
    for (const j of joueurs.values()) {
      const gain = j.mises.reduce((s, m) => s + gainMiseCourse(m, partants, ordre), 0);
      j.gain = gain;
      if (gain > 0) banque.crediter(j.uid, gain);
      const mise = total(j.mises);
      if ((gain >= 10 * mise && gain >= 1_000_000) || gain >= 10_000_000) options.annoncer?.({ nom: j.nom, jeu: 'course', gain });
    }
    const g = ordre[0];
    historique = [{ cheval: g, nom: partants[g].nom, cote: partants[g].cote }, ...historique].slice(0, 12);
    phase = 'resultat';
    fin = horloge() + D.resultat;
    duree = D.resultat;
    plusTard(ouvrirMises, D.resultat);
    diffuser();
  }

  function entrer(socket: Socket, uid: string) {
    spectateurs.set(socket.id, { uid });
    void socket.join(SALLE_COURSE);
    if (!enCours) ouvrirMises();
    else diffuser();
  }
  function sortir(socketId: string) {
    if (!spectateurs.delete(socketId)) return;
    diffuser();
  }

  function brancher(socket: Socket, ctx: { acces: (rappel: unknown) => Promise<Identite | null>; enSalon: (uid: string) => boolean; L: (fr: string, en: string) => string }) {
    const { L } = ctx;
    const repondre = (rappel: unknown, r: Reponse) => {
      if (typeof rappel === 'function') (rappel as Rappel)(r);
    };
    const erreur = (rappel: unknown, fr: string, en: string) => repondre(rappel, { ok: false, erreur: L(fr, en) });
    const pourMiser = async (rappel: unknown) => {
      const id = await ctx.acces(rappel);
      if (!id) return null;
      if (!ctx.enSalon(id.uid) || spectateurs.get(socket.id)?.uid !== id.uid) return erreur(rappel, 'Tu ne regardes pas la course.', 'You are not watching the race.'), null;
      if (phase !== 'mises' || fin === null || horloge() >= fin) return erreur(rappel, 'Les mises sont fermées : attends la prochaine course.', 'Bets are closed: wait for the next race.'), null;
      let j = joueurs.get(id.uid);
      if (!j) {
        const infos = banque.joueur(id.uid);
        j = { uid: id.uid, nom: infos?.nom || id.nom || '', avatar: infos?.avatar ?? 1, mises: [], gain: null };
        joueurs.set(id.uid, j);
      }
      return { id, j };
    };
    /** Pose plusieurs mises d'un coup, si les plafonds et le solde le permettent. */
    const poser = (m: { id: Identite; j: Joueur }, ajout: MiseCourse[], rappel: unknown) => {
      const parMise = new Map<string, number>();
      for (const x of [...m.j.mises, ...ajout]) parMise.set(`${x.cheval}-${x.type}`, (parMise.get(`${x.cheval}-${x.type}`) ?? 0) + x.montant);
      if ([...parMise.values()].some((v) => v > MAX_MISE_COURSE)) return erreur(rappel, 'Pas plus de 1 000 000 $ sur une même mise.', 'No more than $1,000,000 on one bet.');
      if (total(m.j.mises) + total(ajout) > MAX_COURSE) return erreur(rappel, 'Pas plus de 4 000 000 $ par course.', 'No more than $4,000,000 per race.');
      if (!banque.debiter(m.id.uid, total(ajout))) return erreur(rappel, 'Solde insuffisant.', 'Not enough money.');
      m.j.mises.push(...ajout);
      diffuser();
      repondre(rappel, { ok: true });
    };

    socket.on('casino_course_entrer', async (_data: unknown, rappel?: Rappel) => {
      const id = await ctx.acces(rappel);
      if (!id) return;
      if (!ctx.enSalon(id.uid)) return repondre(rappel, { ok: false, erreur: 'Introuvable.' });
      entrer(socket, id.uid);
      repondre(rappel, { ok: true, course: vue(id.uid) });
    });

    socket.on('casino_course_quitter', (_data: unknown, rappel?: Rappel) => {
      sortir(socket.id);
      void socket.leave(SALLE_COURSE);
      repondre(rappel, { ok: true });
    });

    socket.on('casino_course_miser', async (data: { cheval?: unknown; type?: unknown; montant?: unknown } = {}, rappel?: Rappel) => {
      const m = await pourMiser(rappel);
      if (!m) return;
      const cheval = Number(data?.cheval);
      const type = data?.type as TypeMiseCourse;
      const montant = Number(data?.montant);
      if (!Number.isInteger(cheval) || cheval < 0 || cheval >= NB_CHEVAUX || !TYPES_MISE_COURSE.includes(type)) return erreur(rappel, 'Mise introuvable.', 'Unknown bet.');
      if (!JETONS_COURSE.includes(montant)) return erreur(rappel, 'Jeton impossible.', 'Invalid chip.');
      poser(m, [{ cheval, type, montant }], rappel);
    });

    socket.on('casino_course_annuler', async (data: { tout?: unknown } = {}, rappel?: Rappel) => {
      const m = await pourMiser(rappel);
      if (!m) return;
      if (!m.j.mises.length) return repondre(rappel, { ok: true });
      const retirees = data?.tout ? m.j.mises.splice(0) : m.j.mises.splice(-1);
      banque.rembourser(m.id.uid, total(retirees));
      diffuser();
      repondre(rappel, { ok: true });
    });

    socket.on('casino_course_doubler', async (_data: unknown, rappel?: Rappel) => {
      const m = await pourMiser(rappel);
      if (!m) return;
      if (!m.j.mises.length) return erreur(rappel, 'Aucune mise à doubler.', 'No bet to double.');
      poser(m, m.j.mises.map((x) => ({ ...x })), rappel);
    });

    socket.on('casino_course_refaire', async (_data: unknown, rappel?: Rappel) => {
      const m = await pourMiser(rappel);
      if (!m) return;
      const avant = precedentes.get(m.id.uid);
      if (!avant?.length) return erreur(rappel, 'Aucune mise à refaire.', 'No bet to repeat.');
      if (m.j.mises.length) return erreur(rappel, 'Tu as déjà misé sur cette course.', 'You have already bet on this race.');
      poser(m, avant.map((x) => ({ ...x })), rappel);
    });

    socket.on('disconnect', () => sortir(socket.id));
  }

  /** Ce que l'accueil du salon montre : en direct ou non, combien regardent, les derniers gagnants. */
  const resume = () => ({ enDirect: enCours, spectateurs: uidsSpectateurs().size, historique: historique.slice(0, 6) });

  /** Arrêt du serveur : une course pas encore jugée est annulée, ses mises rendues. */
  const rendreMisesEnCours = () => {
    arreter();
    if (phase === 'resultat') return;
    for (const j of joueurs.values()) if (j.mises.length && j.gain === null) banque.rembourser(j.uid, total(j.mises));
    joueurs.clear();
  };

  return { brancher, sortir, fermer: arreter, rendreMisesEnCours, resume };
}
