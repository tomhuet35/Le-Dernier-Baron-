/**
 * Le Vol de la Couronne : les manches en direct du Salon privé. Une seule couronne pour tout le salon, qui s'envole
 * en continu tant qu'au moins un créateur la regarde (ou qu'une mise est encore en vol).
 *
 * Une manche : mises (7 s) → l'envol (le multiplicateur monte, e^(k·t)) → la pie frappe → pause (4 s).
 * - Le point où la pie frappe est tiré à l'envol (crypto.randomInt) ; personne ne le connaît avant.
 * - Chaque mise est débitée tout de suite (rendue si elle est annulée avant l'envol).
 * - « Récupérer » : le serveur calcule le multiplicateur à l'instant où il reçoit la demande ; trop tard (la pie a
 *   frappé), la demande est refusée. Les récupérations automatiques sont payées exactement au multiplicateur choisi.
 * - Un joueur qui part laisse ses mises en vol : ses récupérations automatiques sont honorées.
 * - Si la couronne atteint ×10 000, elle s'échappe vers les étoiles : toutes les mises encore en vol y sont payées.
 */
import { randomInt } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import { MULTIPLE_GROS_GAIN, type AnnonceCasino } from '../shared/casino';
import {
  autoValide,
  DUREES_COURONNE,
  gainCouronne,
  K_COURONNE,
  MISES_COURONNE,
  MISES_PAR_MANCHE,
  multiplicateurCouronne,
  tempsDuMultiplicateur,
  tirerVol,
  X_MAX_COURONNE,
  type DureesCouronne,
  type JoueurCouronne,
  type MiseCouronne,
  type PhaseCouronne,
  type VueCouronne,
} from '../shared/couronne';
import type { Identite } from './comptes';
import type { BanqueCasino } from './tablesCasino';

type Reponse = { ok: true; [cle: string]: unknown } | { ok: false; erreur: string };
type Rappel = (r: Reponse) => void;

const SALLE_COURONNE = 'casino-couronne';
/** Tirage uniforme dans [0, 1) : crypto.randomInt accepte au plus 2^48 − 1 valeurs. */
const GRILLE = 2 ** 48 - 1;

interface Joueur {
  uid: string;
  nom: string;
  avatar: number;
  mises: (MiseCouronne | null)[];
}

export function creerVolCouronne(options: {
  io: Server;
  banque: BanqueCasino;
  horloge?: () => number;
  delais?: Partial<DureesCouronne>;
  /** Vitesse de montée (tests). */
  k?: number;
  /** Point de la pie imposé (tests, démonstration) ; au hasard sinon. */
  tirage?: () => number | undefined;
  annoncer?: (a: AnnonceCasino) => void;
}) {
  const { io, banque } = options;
  const horloge = options.horloge ?? Date.now;
  const D: DureesCouronne = { ...DUREES_COURONNE, ...options.delais };
  const k = options.k ?? K_COURONNE;

  /** Téléphones qui regardent → le compte. */
  const spectateurs = new Map<string, { uid: string }>();
  const joueurs = new Map<string, Joueur>();
  let manche = 0;
  let phase: PhaseCouronne = 'mises';
  let fin: number | null = null;
  let duree: number | null = null;
  /** Heure de l'envol, et du passage de la pie. */
  let envol = 0;
  let frappe = 0;
  /** Le point où la pie frappe (secret jusqu'à son passage). */
  let point = 1;
  let minuterie: ReturnType<typeof setTimeout> | null = null;
  let cadence: ReturnType<typeof setInterval> | null = null;
  let enCours = false;
  let historique: number[] = [];

  const uidsSpectateurs = () => new Set([...spectateurs.values()].map((s) => s.uid));
  const enVol = (j: Joueur) => j.mises.some((m) => m?.etat === 'enVol');

  function vue(uid: string | null): VueCouronne {
    const t = horloge();
    const j = uid ? joueurs.get(uid) : undefined;
    const liste: JoueurCouronne[] = [...joueurs.values()]
      .filter((x) => x.mises.some(Boolean))
      .map((x) => {
        const ms = x.mises.filter((m): m is MiseCouronne => !!m);
        const recuperees = ms.filter((m) => m.etat === 'recuperee');
        return {
          nom: x.nom,
          avatar: x.avatar,
          mise: ms.reduce((s, m) => s + m.mise, 0),
          x: recuperees.length ? Math.max(...recuperees.map((m) => m.x ?? 0)) : null,
          gain: ms.reduce((s, m) => s + m.gain, 0),
          vole: ms.every((m) => m.etat === 'volee'),
          ...(x.uid === uid ? { moi: true as const } : {}),
        };
      })
      .sort((a, b) => b.gain - a.gain || b.mise - a.mise);
    return {
      manche,
      phase,
      reste: fin === null ? null : Math.max(0, fin - t),
      duree,
      ecoule: phase === 'vol' ? t - envol : phase === 'volee' ? t - frappe : null,
      k,
      x: phase === 'volee' ? point : null,
      historique,
      mesMises: j ? j.mises.map((m) => (m ? { ...m } : null)) : Array(MISES_PAR_MANCHE).fill(null),
      joueurs: liste.slice(0, 20),
      spectateurs: uidsSpectateurs().size,
      solde: uid ? banque.solde(uid) : 0,
    };
  }

  function diffuser() {
    for (const [sid, s] of spectateurs) io.to(sid).emit('casino_cv', vue(s.uid));
  }

  function arreterMinuteries() {
    if (minuterie) clearTimeout(minuterie);
    if (cadence) clearInterval(cadence);
    minuterie = null;
    cadence = null;
  }

  function ouvrirMises() {
    arreterMinuteries();
    joueurs.clear();
    // Plus personne ne regarde : la couronne se pose jusqu'au prochain spectateur.
    if (!spectateurs.size) {
      enCours = false;
      phase = 'mises';
      fin = null;
      duree = null;
      return;
    }
    enCours = true;
    manche += 1;
    phase = 'mises';
    fin = horloge() + D.mises;
    duree = D.mises;
    minuterie = setTimeout(decoller, D.mises);
    minuterie.unref?.();
    diffuser();
  }

  function decoller() {
    arreterMinuteries();
    const impose = options.tirage?.();
    point = typeof impose === 'number' && impose >= 1 ? Math.min(X_MAX_COURONNE, Math.floor(impose * 100 + 1e-9) / 100) : tirerVol(randomInt(0, GRILLE) / GRILLE);
    phase = 'vol';
    envol = horloge();
    fin = null;
    duree = null;
    const t = tempsDuMultiplicateur(point, k);
    minuterie = setTimeout(passageDeLaPie, Math.max(0, t));
    minuterie.unref?.();
    cadence = setInterval(recupererAutos, D.pas);
    cadence.unref?.();
    diffuser();
  }

  function payer(j: Joueur, m: MiseCouronne, x: number) {
    m.etat = 'recuperee';
    m.x = x;
    m.gain = gainCouronne(m.mise, x);
    banque.crediter(j.uid, m.gain);
    if (m.gain >= MULTIPLE_GROS_GAIN * m.mise) options.annoncer?.({ nom: j.nom, jeu: 'couronne', gain: m.gain });
  }

  /** Les récupérations automatiques atteintes (jusqu'à `jusqua`), payées exactement au multiplicateur choisi. */
  function recupererAutos(jusqua?: number) {
    if (phase !== 'vol') return;
    const x = typeof jusqua === 'number' ? jusqua : multiplicateurCouronne(horloge() - envol, k);
    let change = false;
    for (const j of joueurs.values())
      for (const m of j.mises)
        if (m?.etat === 'enVol' && m.auto !== null && m.auto <= x && m.auto <= point) {
          payer(j, m, m.auto);
          change = true;
        }
    if (change) diffuser();
  }

  function passageDeLaPie() {
    if (phase !== 'vol') return;
    // Les récupérations automatiques jusqu'au point exact passent avant la pie.
    recupererAutos(point);
    const etoiles = point >= X_MAX_COURONNE;
    for (const j of joueurs.values())
      for (const m of j.mises) {
        if (m?.etat !== 'enVol') continue;
        if (etoiles) payer(j, m, X_MAX_COURONNE);
        else m.etat = 'volee';
      }
    arreterMinuteries();
    phase = 'volee';
    frappe = horloge();
    historique = [point, ...historique].slice(0, 24);
    fin = frappe + D.pause;
    duree = D.pause;
    minuterie = setTimeout(ouvrirMises, D.pause);
    minuterie.unref?.();
    diffuser();
  }

  function entrer(socket: Socket, uid: string) {
    spectateurs.set(socket.id, { uid });
    void socket.join(SALLE_COURONNE);
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
    /** Le joueur qui regarde la couronne ; sinon l'erreur est déjà envoyée. */
    const auJeu = async (rappel: unknown) => {
      const id = await ctx.acces(rappel);
      if (!id) return null;
      if (!ctx.enSalon(id.uid) || spectateurs.get(socket.id)?.uid !== id.uid) return erreur(rappel, 'Tu ne regardes pas la couronne.', 'You are not watching the crown.'), null;
      return id;
    };
    const emplacement = (rappel: unknown, brut: unknown): number | null => {
      const i = Number(brut ?? 0);
      if (!Number.isInteger(i) || i < 0 || i >= MISES_PAR_MANCHE) return erreur(rappel, 'Mise introuvable.', 'Unknown bet.'), null;
      return i;
    };

    socket.on('casino_cv_entrer', async (_data: unknown, rappel?: Rappel) => {
      const id = await ctx.acces(rappel);
      if (!id) return;
      if (!ctx.enSalon(id.uid)) return repondre(rappel, { ok: false, erreur: 'Introuvable.' });
      entrer(socket, id.uid);
      repondre(rappel, { ok: true, couronne: vue(id.uid) });
    });

    socket.on('casino_cv_quitter', (_data: unknown, rappel?: Rappel) => {
      sortir(socket.id);
      void socket.leave(SALLE_COURONNE);
      repondre(rappel, { ok: true });
    });

    socket.on('casino_cv_miser', async (data: { emplacement?: unknown; mise?: unknown; auto?: unknown } = {}, rappel?: Rappel) => {
      const id = await auJeu(rappel);
      if (!id) return;
      const i = emplacement(rappel, data?.emplacement);
      if (i === null) return;
      if (phase !== 'mises' || fin === null || horloge() >= fin) return erreur(rappel, 'La couronne s’envole : attends le prochain envol.', 'The crown is taking off: wait for the next flight.');
      const mise = Number(data?.mise);
      if (!MISES_COURONNE.includes(mise)) return erreur(rappel, 'Mise impossible.', 'Invalid bet.');
      const auto = data?.auto === null || data?.auto === undefined ? null : Number(data.auto);
      if (auto !== null && !autoValide(auto)) return erreur(rappel, 'Récupération automatique de ×1,01 à ×10 000.', 'Auto cash-out from ×1.01 to ×10,000.');
      let j = joueurs.get(id.uid);
      if (!j) {
        const infos = banque.joueur(id.uid);
        j = { uid: id.uid, nom: infos?.nom || id.nom || '', avatar: infos?.avatar ?? 1, mises: Array(MISES_PAR_MANCHE).fill(null) };
        joueurs.set(id.uid, j);
      }
      if (j.mises[i]) return erreur(rappel, 'Cette mise est déjà posée.', 'This bet is already placed.');
      if (!banque.debiter(id.uid, mise)) return erreur(rappel, 'Solde insuffisant.', 'Not enough money.');
      j.mises[i] = { mise, auto, etat: 'enVol', x: null, gain: 0 };
      diffuser();
      repondre(rappel, { ok: true, couronne: vue(id.uid) });
    });

    socket.on('casino_cv_annuler', async (data: { emplacement?: unknown } = {}, rappel?: Rappel) => {
      const id = await auJeu(rappel);
      if (!id) return;
      const i = emplacement(rappel, data?.emplacement);
      if (i === null) return;
      const j = joueurs.get(id.uid);
      const m = j?.mises[i];
      if (!j || !m) return erreur(rappel, 'Aucune mise à annuler.', 'No bet to cancel.');
      if (phase !== 'mises') return erreur(rappel, 'Trop tard : la couronne s’est envolée.', 'Too late: the crown has taken off.');
      j.mises[i] = null;
      banque.crediter(id.uid, m.mise);
      diffuser();
      repondre(rappel, { ok: true, couronne: vue(id.uid) });
    });

    socket.on('casino_cv_recuperer', async (data: { emplacement?: unknown } = {}, rappel?: Rappel) => {
      const id = await auJeu(rappel);
      if (!id) return;
      const i = emplacement(rappel, data?.emplacement);
      if (i === null) return;
      const j = joueurs.get(id.uid);
      const m = j?.mises[i];
      if (!j || !m) return erreur(rappel, 'Aucune mise en vol.', 'No bet in flight.');
      if (m.etat === 'recuperee') return erreur(rappel, 'Cette mise est déjà récupérée.', 'This bet is already cashed out.');
      const t = horloge();
      // Le multiplicateur de l'instant où la demande arrive ; la pie déjà passée, c'est trop tard.
      if (phase !== 'vol' || m.etat !== 'enVol' || t - envol >= tempsDuMultiplicateur(point, k)) return erreur(rappel, 'Trop tard : la pie a volé la couronne !', 'Too late: the magpie stole the crown!');
      payer(j, m, multiplicateurCouronne(t - envol, k));
      diffuser();
      repondre(rappel, { ok: true, couronne: vue(id.uid) });
    });

    socket.on('disconnect', () => sortir(socket.id));
  }

  /** Ce que l'accueil du salon montre : en direct ou non, combien regardent, les derniers envols. */
  const resume = () => ({ enDirect: enCours, spectateurs: uidsSpectateurs().size, historique: historique.slice(0, 6) });
  /** Une mise de ce joueur est-elle en vol ? */
  const misesEnVol = (uid: string) => {
    const j = joueurs.get(uid);
    return !!j && enVol(j);
  };

  return { brancher, sortir, fermer: arreterMinuteries, resume, misesEnVol };
}
