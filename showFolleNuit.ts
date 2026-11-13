/**
 * La Folle Nuit : le show en direct du Salon privé. Une seule roue pour tout le salon, qui tourne en continu tant
 * qu'au moins un créateur regarde le show (ou qu'il reste des mises à jouer).
 *
 * Une manche : mises (15 s, « Rien ne va plus » juste avant la fin) → le Top Slot → la roue → le résultat ; si la roue
 * s'arrête sur un bonus : présentation, choix (Chasse au butin, Folle Nuit), le jeu, puis les gains. Tout est tiré par
 * le serveur (crypto.randomInt) au moment où les mises se ferment ; l'écran ne fait que montrer ce qu'il reçoit.
 * Chaque jeton posé est débité tout de suite (rendu s'il est retiré avant la fin des mises) ; les gains sont crédités
 * quand le résultat est montré à tout le monde. Un joueur qui part laisse ses mises : elles sont jouées et payées.
 */
import { randomInt } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import type { AnnonceCasino } from '../shared/casino';
import {
  bonusAvecChoix,
  caseChasse,
  CASES_CHASSE,
  DUREES_FN,
  dureeJeuBonus,
  estBonus,
  estCaseFN,
  facteurTopSlot,
  flecheFolle,
  FLECHES_FOLLE,
  happyHourFN,
  JETONS_FN,
  MAX_CASE_FN,
  MAX_MANCHE_FN,
  PAIEMENT_NOMBRE,
  retourFN,
  tirerManche,
  X_MAX_FN,
  xPile,
  type CaseFN,
  type DureesFN,
  type HappyHourFN,
  type Hasard,
  type JoueurFN,
  type Manche,
  type PhaseFN,
  type TopSlot,
  type VueBonusFN,
  type VueFolleNuit,
} from '../shared/folleNuit';
import { filtrerMessage } from '../shared/moderation';
import type { Identite } from './comptes';
import type { BanqueCasino } from './tablesCasino';

type Reponse = { ok: true; [cle: string]: unknown } | { ok: false; erreur: string };
type Rappel = (r: Reponse) => void;

/** Un gain net de cette taille est annoncé dans tout le salon. */
const GAIN_ANNONCE = 1_000_000;
const SALLE_SHOW = 'casino-folle-nuit';

export type TirageImpose = { arret?: number; topSlot?: TopSlot | null } | undefined;

interface Joueur {
  uid: string;
  nom: string;
  avatar: number;
  poses: { case: CaseFN; montant: number }[];
  /** Case de la Chasse ou flèche de la Folle Nuit. */
  choix?: number;
  gain: number | null;
}

export function creerShowFolleNuit(options: {
  io: Server;
  banque: BanqueCasino;
  horloge?: () => number;
  hasard?: Hasard;
  delais?: Partial<DureesFN>;
  /** Arrêt de la roue et Top Slot imposés (tests, démonstration). */
  tirage?: () => TirageImpose;
  /** Happy Hour imposée (tests, démonstration) ; sinon de 11 h à 12 h, heure de Paris. */
  happyHour?: (t: number) => HappyHourFN;
  annoncer?: (a: AnnonceCasino) => void;
}) {
  const { io, banque } = options;
  const horloge = options.horloge ?? Date.now;
  const hasard = options.hasard ?? ((n: number) => randomInt(n));
  const D: DureesFN = { ...DUREES_FN, ...options.delais };
  const happyHour = () => (options.happyHour ?? happyHourFN)(horloge());

  /** Téléphones qui regardent le show → le compte. */
  const spectateurs = new Map<string, { uid: string }>();
  const joueurs = new Map<string, Joueur>();
  const precedentes = new Map<string, { case: CaseFN; montant: number }[]>();
  let manche = 0;
  let phase: PhaseFN = 'mises';
  let fin: number | null = null;
  let duree: number | null = null;
  let minuterie: ReturnType<typeof setTimeout> | null = null;
  let enCours = false;
  let tirage: Manche | null = null;
  let paye = false;
  let historique: { case: CaseFN; x: number }[] = [];
  let messages: { nom: string; texte: string }[] = [];

  const ouvertes = () => phase === 'mises' && fin !== null && horloge() < fin - D.fermeture;
  const total = (l: { montant: number }[]) => l.reduce((s, p) => s + p.montant, 0);
  const uidsSpectateurs = () => new Set([...spectateurs.values()].map((s) => s.uid));
  /** Le jeu bonus en cours (après l'arrêt de la roue). */
  const bonusEnJeu = () => (tirage?.bonus && ['intro', 'choix', 'jeu', 'finBonus'].includes(phase) ? tirage.bonus : null);
  const avant = (p: PhaseFN) => {
    const ordre: PhaseFN[] = ['mises', 'topSlot', 'roue', 'intro', 'choix', 'jeu', 'finBonus', 'resultat'];
    return ordre.indexOf(phase) < ordre.indexOf(p);
  };

  function vueBonus(uid: string | null): VueBonusFN | null {
    const b = tirage?.bonus;
    if (!b || avant('intro')) return null;
    const j = uid ? joueurs.get(uid) : undefined;
    const devoile = !avant('jeu');
    if (b.type === 'pile') return { type: 'pile', couronne: b.pile.couronne, chapeau: b.pile.chapeau, cote: devoile ? b.pile.cote : null };
    if (b.type === 'chasse') return { type: 'chasse', symboles: b.chasse.symboles, valeurs: devoile ? b.chasse.valeurs : null, choix: j?.choix ?? null };
    if (b.type === 'billes') return { type: 'billes', cases: b.billes.lancers[0].cases, lancers: devoile ? b.billes.lancers : null, x: avant('finBonus') ? null : b.billes.x };
    return { type: 'folle', segments: b.folle.segments, arrets: devoile ? b.folle.arrets : null, fleches: devoile ? b.folle.fleches : null, choix: j?.choix ?? null };
  }

  function vue(uid: string | null): VueFolleNuit {
    const j = uid ? joueurs.get(uid) : undefined;
    const mesMises: Partial<Record<CaseFN, number>> = {};
    for (const p of j?.poses ?? []) mesMises[p.case] = (mesMises[p.case] ?? 0) + p.montant;
    const misesSalon: Partial<Record<CaseFN, number>> = {};
    for (const x of joueurs.values()) for (const p of x.poses) misesSalon[p.case] = (misesSalon[p.case] ?? 0) + p.montant;
    const liste: JoueurFN[] = [...joueurs.values()]
      .filter((x) => x.poses.length)
      .map((x) => ({ nom: x.nom, avatar: x.avatar, mise: total(x.poses), gain: paye ? x.gain : null, ...(x.uid === uid ? { moi: true as const } : {}) }))
      .sort((a, b) => (b.gain ?? 0) - (a.gain ?? 0) || b.mise - a.mise);
    return {
      manche,
      phase,
      reste: fin === null ? null : Math.max(0, fin - horloge()),
      duree,
      closes: !ouvertes(),
      topSlot: tirage && !avant('topSlot') ? tirage.topSlot : null,
      arret: tirage && !avant('roue') ? tirage.arret : null,
      bonus: vueBonus(uid),
      mesMises,
      misesSalon,
      monGain: paye && j?.poses.length ? j.gain : null,
      joueurs: liste.slice(0, 12),
      spectateurs: uidsSpectateurs().size,
      historique,
      solde: uid ? banque.solde(uid) : 0,
      peutRefaire: !!uid && !!precedentes.get(uid)?.length,
      messages: messages.slice(-30),
      happyHour: happyHour(),
    };
  }

  function diffuser() {
    for (const [sid, s] of spectateurs) io.to(sid).emit('casino_fn', vue(s.uid));
  }

  function planifier(ms: number, nouvelle: PhaseFN, suite: () => void) {
    if (minuterie) clearTimeout(minuterie);
    phase = nouvelle;
    fin = horloge() + ms;
    duree = ms;
    minuterie = setTimeout(() => {
      minuterie = null;
      suite();
    }, ms);
    minuterie.unref?.();
    diffuser();
  }

  function ouvrirMises() {
    // Plus personne ne regarde et aucune mise en attente : le show s'arrête jusqu'au prochain spectateur.
    for (const [uid, j] of joueurs) if (!j.poses.length) joueurs.delete(uid);
    joueurs.clear();
    tirage = null;
    paye = false;
    if (!spectateurs.size) {
      enCours = false;
      phase = 'mises';
      fin = null;
      duree = null;
      return;
    }
    enCours = true;
    planifier(D.mises, 'mises', fermer);
  }

  function fermer() {
    manche += 1;
    tirage = tirerManche(hasard, options.tirage?.(), happyHour().active);
    // Les mises de cette manche deviennent celles à « refaire » à la suivante.
    for (const j of joueurs.values()) if (j.poses.length) precedentes.set(j.uid, j.poses.map((p) => ({ ...p })));
    planifier(D.topSlot, 'topSlot', () => planifier(D.roue, 'roue', apresRoue));
  }

  function apresRoue() {
    const b = tirage!.bonus;
    if (!b) return payer(), planifier(D.resultat, 'resultat', ouvrirMises);
    planifier(D.intro, 'intro', () => {
      if (bonusAvecChoix(b.type)) planifier(D.choix, 'choix', jouerBonus);
      else jouerBonus();
    });
  }

  function jouerBonus() {
    const b = tirage!.bonus!;
    // Ceux qui n'ont pas choisi : une case ou une flèche au hasard.
    for (const j of joueurs.values()) {
      if (!j.poses.some((p) => p.case === tirage!.case)) continue;
      if (b.type === 'chasse') j.choix = caseChasse(j.choix, hasard);
      if (b.type === 'folle') j.choix = flecheFolle(j.choix, hasard);
    }
    planifier(dureeJeuBonus(b, D), 'jeu', () => {
      payer();
      planifier(D.finBonus, 'finBonus', ouvrirMises);
    });
  }

  /** Multiplicateur retenu dans l'historique : le chiffre ou le meilleur multiplicateur du bonus, Top Slot compris. */
  function xHistorique(m: Manche): number {
    const top = facteurTopSlot(m.topSlot.touche, m.case);
    const b = m.bonus;
    if (!b) return PAIEMENT_NOMBRE[m.case as '1'] * top;
    const x = b.type === 'pile' ? xPile(b.pile) : b.type === 'billes' ? b.billes.x : b.type === 'chasse' ? Math.max(...b.chasse.valeurs) : Math.max(...b.folle.fleches.map((f) => f.x));
    return Math.min(X_MAX_FN, x * top);
  }

  function payer() {
    if (!tirage || paye) return;
    const m = tirage;
    for (const j of joueurs.values()) {
      if (!j.poses.length) continue;
      const retour = j.poses.reduce((r, p) => r + retourFN(p.case, p.montant, m, j.choix), 0);
      j.gain = retour - total(j.poses);
      if (retour > 0) banque.crediter(j.uid, retour);
      if (j.gain >= GAIN_ANNONCE) options.annoncer?.({ nom: j.nom, jeu: 'folleNuit', gain: j.gain });
    }
    paye = true;
    historique = [{ case: m.case, x: xHistorique(m) }, ...historique].slice(0, 15);
  }

  function entrer(socket: Socket, uid: string) {
    spectateurs.set(socket.id, { uid });
    void socket.join(SALLE_SHOW);
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
    /** Le joueur qui regarde le show ; sinon l'erreur est déjà envoyée. */
    const auShow = async (rappel: unknown) => {
      const id = await ctx.acces(rappel);
      if (!id) return null;
      if (!ctx.enSalon(id.uid) || spectateurs.get(socket.id)?.uid !== id.uid) return erreur(rappel, 'Tu ne regardes pas le show.', 'You are not watching the show.'), null;
      return id;
    };
    const pourMiser = async (rappel: unknown) => {
      const id = await auShow(rappel);
      if (!id) return null;
      if (!ouvertes()) return erreur(rappel, 'Rien ne va plus : les mises sont fermées.', 'No more bets.'), null;
      let j = joueurs.get(id.uid);
      if (!j) {
        const infos = banque.joueur(id.uid);
        j = { uid: id.uid, nom: infos?.nom || id.nom || '', avatar: infos?.avatar ?? 1, poses: [], gain: null };
        joueurs.set(id.uid, j);
      }
      return { id, j };
    };
    /** Pose plusieurs mises d'un coup, si les plafonds et le solde le permettent. */
    const poser = (m: { id: Identite; j: Joueur }, ajout: { case: CaseFN; montant: number }[], rappel: unknown) => {
      const parCase = new Map<CaseFN, number>();
      for (const p of [...m.j.poses, ...ajout]) parCase.set(p.case, (parCase.get(p.case) ?? 0) + p.montant);
      if ([...parCase.values()].some((v) => v > MAX_CASE_FN)) return erreur(rappel, 'Pas plus de 1 000 000 $ sur une même case.', 'No more than $1,000,000 on one spot.');
      if (total(m.j.poses) + total(ajout) > MAX_MANCHE_FN) return erreur(rappel, 'Pas plus de 4 000 000 $ par manche.', 'No more than $4,000,000 per round.');
      if (!banque.debiter(m.id.uid, total(ajout))) return erreur(rappel, 'Solde insuffisant.', 'Not enough money.');
      m.j.poses.push(...ajout);
      diffuser();
      repondre(rappel, { ok: true });
    };
    let dernierMessage = 0;

    socket.on('casino_fn_entrer', async (_data: unknown, rappel?: Rappel) => {
      const id = await ctx.acces(rappel);
      if (!id) return;
      if (!ctx.enSalon(id.uid)) return repondre(rappel, { ok: false, erreur: 'Introuvable.' });
      entrer(socket, id.uid);
      repondre(rappel, { ok: true, show: vue(id.uid) });
    });

    socket.on('casino_fn_quitter', (_data: unknown, rappel?: Rappel) => {
      sortir(socket.id);
      void socket.leave(SALLE_SHOW);
      repondre(rappel, { ok: true });
    });

    socket.on('casino_fn_miser', async (data: { case?: unknown; montant?: unknown } = {}, rappel?: Rappel) => {
      const m = await pourMiser(rappel);
      if (!m) return;
      const c = data?.case;
      const montant = Number(data?.montant);
      if (!estCaseFN(c) || !JETONS_FN.includes(montant)) return erreur(rappel, 'Mise impossible.', 'Invalid bet.');
      poser(m, [{ case: c, montant }], rappel);
    });

    socket.on('casino_fn_annuler', async (data: { tout?: unknown } = {}, rappel?: Rappel) => {
      const m = await pourMiser(rappel);
      if (!m) return;
      if (!m.j.poses.length) return repondre(rappel, { ok: true });
      const retirees = data?.tout ? m.j.poses.splice(0) : m.j.poses.splice(-1);
      banque.rembourser(m.id.uid, total(retirees));
      diffuser();
      repondre(rappel, { ok: true });
    });

    socket.on('casino_fn_doubler', async (_data: unknown, rappel?: Rappel) => {
      const m = await pourMiser(rappel);
      if (!m) return;
      if (!m.j.poses.length) return erreur(rappel, 'Aucune mise à doubler.', 'No bet to double.');
      poser(m, m.j.poses.map((p) => ({ ...p })), rappel);
    });

    socket.on('casino_fn_refaire', async (_data: unknown, rappel?: Rappel) => {
      const m = await pourMiser(rappel);
      if (!m) return;
      const avant = precedentes.get(m.id.uid);
      if (!avant?.length) return erreur(rappel, 'Aucune mise à refaire.', 'No bet to repeat.');
      if (m.j.poses.length) return erreur(rappel, 'Tu as déjà misé cette manche.', 'You already bet this round.');
      poser(m, avant.map((p) => ({ ...p })), rappel);
    });

    // Chasse au butin : la case visée ; Folle Nuit : la flèche. Seulement pour ceux qui ont misé sur ce bonus.
    socket.on('casino_fn_choix', async (data: { index?: unknown } = {}, rappel?: Rappel) => {
      const id = await auShow(rappel);
      if (!id) return;
      const b = bonusEnJeu();
      if (!b || !bonusAvecChoix(b.type) || (phase !== 'intro' && phase !== 'choix')) return erreur(rappel, 'Le choix est fermé.', 'Choosing is closed.');
      const j = joueurs.get(id.uid);
      if (!j?.poses.some((p) => p.case === tirage!.case)) return erreur(rappel, 'Tu n’as pas misé sur ce bonus.', 'You did not bet on this bonus.');
      const i = Number(data?.index);
      const max = b.type === 'chasse' ? CASES_CHASSE : FLECHES_FOLLE;
      if (!Number.isInteger(i) || i < 0 || i >= max) return erreur(rappel, 'Choix impossible.', 'Invalid choice.');
      j.choix = i;
      diffuser();
      repondre(rappel, { ok: true });
    });

    socket.on('casino_fn_chat', async (data: { texte?: unknown } = {}, rappel?: Rappel) => {
      const id = await auShow(rappel);
      if (!id) return;
      const t = horloge();
      if (t - dernierMessage < 800) return erreur(rappel, 'Patiente une seconde.', 'Wait a second.');
      dernierMessage = t;
      const texte = filtrerMessage(String(data?.texte ?? '').trim().slice(0, 120)).texte;
      if (!texte) return repondre(rappel, { ok: true });
      messages = [...messages, { nom: banque.joueur(id.uid)?.nom || id.nom || '', texte }].slice(-30);
      diffuser();
      repondre(rappel, { ok: true });
    });

    socket.on('disconnect', () => sortir(socket.id));
  }

  const fermerShow = () => {
    if (minuterie) clearTimeout(minuterie);
    minuterie = null;
  };
  /** Arrêt du serveur : les mises d'une manche pas encore payée sont rendues. */
  const rendreMisesEnCours = () => {
    if (paye) return;
    paye = true;
    for (const j of joueurs.values()) {
      const t = total(j.poses);
      if (t > 0) banque.rembourser(j.uid, t);
      j.poses = [];
    }
  };
  /** Ce que l'accueil du salon montre du show : en direct ou non, les derniers résultats. */
  const resume = () => ({ enDirect: enCours, spectateurs: uidsSpectateurs().size, historique: historique.slice(0, 6), happyHour: happyHour() });

  return { brancher, sortir, fermer: fermerShow, rendreMisesEnCours, resume, estBonus };
}
