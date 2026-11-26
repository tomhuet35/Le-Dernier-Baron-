/**
 * Le Bal du Grand Hôtel : la roue géante du bal, en direct (le même moteur que le Baron Express). Une seule manche à
 * la fois pour tout le salon, qui tourne tant qu'au moins un joueur la regarde.
 *
 * - À la fin des mises, le serveur tire la case d'arrêt de la grande roue et le cran de la petite (crypto.randomInt),
 *   et leurs angles d'arrivée : tous les téléphones font valser les deux roues de la même façon.
 * - Sur un bonus, tout son tirage est fait d'un coup ; chaque joueur qui a misé dessus fait son choix (sans choix à
 *   temps, le serveur choisit pour lui au hasard). Ce qui est caché ne part vers les téléphones qu'une fois les choix
 *   fermés.
 * - Chaque mise est débitée tout de suite (rendue si elle est annulée avant la fin des mises, ou si le serveur s'arrête
 *   avant la fin de la manche). Les gains sont versés une seule fois, à la fin de la manche.
 */
import { randomInt } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import type { AnnonceCasino } from '../shared/casino';
import { DUREES_BW, type DureesBW, type Hasard } from '../shared/baronWheel';
import {
  CASES_BAL,
  DEGRES_CASE_BAL,
  DEGRES_CRAN_BAL,
  DUREES_BAL,
  estBonusBal,
  etapesBal,
  gainBW,
  JETONS_BW,
  MAX_CASE_BW,
  MAX_MANCHE_BW,
  NB_CASES_BAL,
  NB_CRANS_BAL,
  PETITE_BAL,
  recompenseBal,
  ROUE_BAL,
  tirerBonusBal,
  VALEUR_CHIFFRE_BAL,
  type BonusBal,
  type CaseBal,
  type EtapeBal,
  type JoueurBal,
  type PhaseBal,
  type TirageBal,
  type VueBal,
  type VueBonusBal,
} from '../shared/balWheel';
import type { Identite } from './comptes';
import type { BanqueCasino } from './tablesCasino';

type Reponse = { ok: true; [cle: string]: unknown } | { ok: false; erreur: string };
type Rappel = (r: Reponse) => void;

const SALLE_BAL = 'casino-bal-wheel';
const GRILLE = 2 ** 48 - 1;
const hasardCrypto: Hasard = () => randomInt(0, GRILLE) / GRILLE;

interface Joueur {
  uid: string;
  nom: string;
  avatar: number;
  mises: Partial<Record<CaseBal, number>>;
  poses: { c: CaseBal; montant: number }[];
  choix: number | null;
  resultat?: { x: number; gain: number };
  gain: number | null;
}

const milliers = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const totalMises = (m: Partial<Record<CaseBal, number>>) => Object.values(m).reduce((s: number, x) => s + (x ?? 0), 0);
const modulo = (a: number, n: number) => ((a % n) + n) % n;

export function creerBalWheel(options: {
  io: Server;
  banque: BanqueCasino;
  horloge?: () => number;
  /** Les durées du Bal (mises, tour, résultat) et celles des mini-jeux (raccourcies dans les tests). */
  delais?: Partial<typeof DUREES_BAL>;
  delaisBonus?: Partial<DureesBW>;
  hasard?: Hasard;
  /** Arrêts imposés (tests, démonstration) ; au hasard sinon. */
  arret?: () => { case?: number; cran?: number } | undefined;
  annoncer?: (a: AnnonceCasino) => void;
}) {
  const { io, banque } = options;
  const horloge = options.horloge ?? Date.now;
  const D = { ...DUREES_BAL, ...options.delais };
  const DB: DureesBW = { ...DUREES_BW, ...options.delaisBonus };
  const hasard = options.hasard ?? hasardCrypto;

  const spectateurs = new Map<string, { uid: string }>();
  const joueurs = new Map<string, Joueur>();
  const precedentes = new Map<string, Partial<Record<CaseBal, number>>>();

  let numero = 0;
  let phase: PhaseBal = 'mises';
  let fin: number | null = null;
  let duree: number | null = null;
  let angle = 0;
  let angleP = 0;
  let tour: { depart: number; arrivee: number; departP: number; arriveeP: number; debut: number; duree: number } | null = null;
  let arret: number | null = null;
  let arretP: number | null = null;
  let tirage: TirageBal | null = null;
  let etapes: EtapeBal[] = [];
  let etape = 0;
  let paye = false;
  let minuterie: ReturnType<typeof setTimeout> | null = null;
  let enCours = false;
  let historique: VueBal['historique'] = [];

  const uidsSpectateurs = () => new Set([...spectateurs.values()].map((s) => s.uid));
  const multiplicateur = () => (arretP === null ? 1 : PETITE_BAL[arretP]);
  /** L'étape `nom` est-elle atteinte (ou dépassée) ? */
  const atteinte = (nom: string) => {
    const k = etapes.findIndex((e) => e.nom === nom);
    return k >= 0 && (etape >= k || phase === 'resultat');
  };

  function vueBonus(j: Joueur | undefined): VueBonusBal | null {
    if (!tirage) return null;
    const t = tirage;
    const nbOptions = etapes.find((e) => e.choix > 0)?.choix ?? 0;
    const tous = [...joueurs.values()].filter((x) => (x.mises[t.type] ?? 0) > 0);
    const v: VueBonusBal = {
      type: t.type,
      etapes,
      etape,
      multiplicateur: multiplicateur(),
      mise: j?.mises[t.type] ?? 0,
      mesChoix: nbOptions ? [j?.choix ?? null] : [],
      choixSalon: nbOptions ? [Array.from({ length: nbOptions }, (_, o) => tous.filter((x) => x.choix === o).length)] : [],
      resultat: j && atteinte('revele') ? (j.resultat ?? null) : null,
    };
    if (t.type === 'pickpocket') {
      v.butin = atteinte('vol') ? t.butin : null;
      v.mallettes = atteinte('revele') ? [...t.mallettes] : [null, null, null];
    }
    if (t.type === 'donne') v.cartes = t.cartes.map((x) => (atteinte('revele') ? { x } : null));
    if (t.type === 'fontaine') {
      v.fontaine = { versements: atteinte('versement') ? t.versements : null };
      // (la durée du versement trahirait les relances : cachée jusque-là)
      if (!atteinte('versement')) v.etapes = etapes.map((e) => (e.nom === 'versement' ? { ...e, duree: 0 } : e));
    }
    if (t.type === 'chaises') v.chaises = { ordre: atteinte('musique') ? t.ordre : null };
    if (t.type === 'minuit') {
      v.minuit = { tours: atteinte('tours') ? t.tours : null };
      if (!atteinte('tours')) v.etapes = etapes.map((e) => (e.nom === 'tours' ? { ...e, duree: 0 } : e));
    }
    return v;
  }

  function vue(uid: string | null): VueBal {
    const t = horloge();
    const j = uid ? joueurs.get(uid) : undefined;
    const liste: JoueurBal[] = [...joueurs.values()]
      .filter((x) => totalMises(x.mises) > 0)
      .map((x) => ({ nom: x.nom, avatar: x.avatar, mise: totalMises(x.mises), gain: x.gain, ...(x.uid === uid ? { moi: true as const } : {}) }))
      .sort((a, b) => (b.gain ?? 0) - (a.gain ?? 0) || b.mise - a.mise);
    return {
      numero,
      phase,
      reste: fin === null ? null : Math.max(0, fin - t),
      duree,
      angle,
      angleP,
      tour: tour && phase === 'tour' ? { depart: tour.depart, arrivee: tour.arrivee, departP: tour.departP, arriveeP: tour.arriveeP, ecoule: t - tour.debut, duree: tour.duree } : null,
      arret: phase === 'mises' ? null : arret,
      arretP: phase === 'mises' ? null : arretP,
      bonus: phase === 'bonus' || phase === 'resultat' ? vueBonus(j) : null,
      mesMises: j ? { ...j.mises } : {},
      peutRefaire: !!uid && !!precedentes.get(uid) && totalMises(precedentes.get(uid) ?? {}) > 0,
      bilan: phase === 'resultat' && j && j.gain !== null ? { mise: totalMises(j.mises), gain: j.gain } : null,
      joueurs: liste.slice(0, 20),
      historique,
      spectateurs: uidsSpectateurs().size,
      solde: uid ? banque.solde(uid) : 0,
    };
  }

  function diffuser() {
    for (const [sid, s] of spectateurs) io.to(sid).emit('casino_bal', vue(s.uid));
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
    for (const j of joueurs.values()) if (totalMises(j.mises) > 0) precedentes.set(j.uid, { ...j.mises });
    joueurs.clear();
    tirage = null;
    etapes = [];
    etape = 0;
    tour = null;
    arret = null;
    arretP = null;
    paye = false;
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
    fin = horloge() + D.mises;
    duree = D.mises;
    plusTard(lancer, D.mises);
    diffuser();
  }

  /** Les deux roues valsent : la grande dans le sens des aiguilles d'une montre, la petite dans l'autre. */
  function lancer() {
    const impose = options.arret?.();
    arret = impose?.case !== undefined && Number.isInteger(impose.case) && impose.case >= 0 && impose.case < NB_CASES_BAL ? impose.case : Math.floor(hasard() * NB_CASES_BAL);
    arretP = impose?.cran !== undefined && Number.isInteger(impose.cran) && impose.cran >= 0 && impose.cran < NB_CRANS_BAL ? impose.cran : Math.floor(hasard() * NB_CRANS_BAL);
    // L'éventail est en haut : la case `arret` y arrive quand la grande roue a tourné de -(son angle), à un tiers de case près.
    const ecart = (hasard() * 2 - 1) * (DEGRES_CASE_BAL / 3);
    const depart = angle;
    const arrivee = depart + 4 * 360 + modulo(-(arret * DEGRES_CASE_BAL + ecart) - depart, 360);
    const departP = angleP;
    const arriveeP = departP - 3 * 360 - modulo(departP + arretP * DEGRES_CRAN_BAL, 360);
    tour = { depart, arrivee, departP, arriveeP, debut: horloge(), duree: D.tour };
    phase = 'tour';
    fin = null;
    duree = null;
    plusTard(resultat, D.tour);
    diffuser();
  }

  function resultat() {
    if (arret === null || arretP === null || !tour) return;
    angle = modulo(tour.arrivee, 360);
    angleP = modulo(tour.arriveeP, 360);
    const c = ROUE_BAL[arret];
    historique = [{ c, x: multiplicateur() }, ...historique].slice(0, 20);
    if (estBonusBal(c)) {
      tirage = tirerBonusBal(c, hasard);
      etapes = etapesBal(tirage, DB);
      etape = 0;
      for (const j of joueurs.values()) j.choix = null;
      phase = 'bonus';
      lancerEtape();
      return;
    }
    payer();
  }

  function lancerEtape() {
    const e = etapes[etape];
    fin = horloge() + e.duree;
    duree = e.duree;
    plusTard(etapeSuivante, e.duree);
    diffuser();
  }

  function etapeSuivante() {
    // Le choix se ferme : ceux qui n'ont pas choisi reçoivent un choix au hasard.
    const n = etapes[etape]?.choix ?? 0;
    if (n > 0 && tirage) for (const j of joueurs.values()) if ((j.mises[tirage.type] ?? 0) > 0 && j.choix === null) j.choix = Math.floor(hasard() * n);
    if (etapes[etape + 1]?.nom === 'revele') calculerBonus();
    if (etape + 1 >= etapes.length) return payer();
    etape += 1;
    lancerEtape();
  }

  function calculerBonus() {
    if (!tirage) return;
    for (const j of joueurs.values()) {
      const mise = j.mises[tirage.type] ?? 0;
      if (!mise) continue;
      const x = recompenseBal(tirage, j.choix) * multiplicateur();
      j.resultat = { x, gain: gainBW(mise, x) };
    }
  }

  /** Verse les gains de la manche (une seule fois), puis montre les résultats. */
  function payer() {
    if (paye || arret === null) return;
    paye = true;
    const c = ROUE_BAL[arret];
    if (tirage && !joueursOntResultat()) calculerBonus();
    for (const j of joueurs.values()) {
      const mise = totalMises(j.mises);
      if (!mise) continue;
      const surCase = j.mises[c] ?? 0;
      let gain = 0;
      if (surCase > 0) gain = estBonusBal(c) ? (j.resultat?.gain ?? 0) : gainBW(surCase, VALEUR_CHIFFRE_BAL[c] * multiplicateur());
      j.gain = gain;
      if (gain > 0) banque.crediter(j.uid, gain);
      if ((gain >= 10 * mise && gain >= 1_000_000) || gain >= 10_000_000) options.annoncer?.({ nom: j.nom, jeu: 'baronWheel', gain });
    }
    phase = 'resultat';
    fin = horloge() + D.resultat;
    duree = D.resultat;
    plusTard(ouvrirMises, D.resultat);
    diffuser();
  }
  const joueursOntResultat = () => !tirage || [...joueurs.values()].every((j) => !(j.mises[(tirage as TirageBal).type] ?? 0) || j.resultat);

  function entrer(socket: Socket, uid: string) {
    spectateurs.set(socket.id, { uid });
    void socket.join(SALLE_BAL);
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
    const regarde = async (rappel: unknown) => {
      const id = await ctx.acces(rappel);
      if (!id) return null;
      if (!ctx.enSalon(id.uid) || spectateurs.get(socket.id)?.uid !== id.uid) return erreur(rappel, 'Tu ne regardes pas la roue.', 'You are not watching the wheel.'), null;
      return id;
    };
    const pourMiser = async (rappel: unknown) => {
      const id = await regarde(rappel);
      if (!id) return null;
      if (phase !== 'mises' || fin === null || horloge() >= fin) return erreur(rappel, 'Les mises sont fermées : attends la prochaine manche.', 'Bets are closed: wait for the next round.'), null;
      let j = joueurs.get(id.uid);
      if (!j) {
        const infos = banque.joueur(id.uid);
        j = { uid: id.uid, nom: infos?.nom || id.nom || '', avatar: infos?.avatar ?? 1, mises: {}, poses: [], choix: null, gain: null };
        joueurs.set(id.uid, j);
      }
      return { id, j };
    };
    const poser = (m: { id: Identite; j: Joueur }, ajout: { c: CaseBal; montant: number }[], rappel: unknown) => {
      const apres = { ...m.j.mises };
      for (const x of ajout) apres[x.c] = (apres[x.c] ?? 0) + x.montant;
      if (Object.values(apres).some((v) => (v ?? 0) > MAX_CASE_BW)) return erreur(rappel, `Pas plus de ${milliers(MAX_CASE_BW)} $ sur une même case.`, `No more than $${MAX_CASE_BW.toLocaleString('en-US')} on one spot.`);
      if (totalMises(apres) > MAX_MANCHE_BW) return erreur(rappel, `Pas plus de ${milliers(MAX_MANCHE_BW)} $ par manche.`, `No more than $${MAX_MANCHE_BW.toLocaleString('en-US')} per round.`);
      const total = ajout.reduce((s, x) => s + x.montant, 0);
      if (!banque.debiter(m.id.uid, total)) return erreur(rappel, 'Solde insuffisant.', 'Not enough money.');
      m.j.mises = apres;
      m.j.poses.push(...ajout);
      diffuser();
      repondre(rappel, { ok: true });
    };

    socket.on('casino_bal_entrer', async (_data: unknown, rappel?: Rappel) => {
      const id = await ctx.acces(rappel);
      if (!id) return;
      if (!ctx.enSalon(id.uid)) return repondre(rappel, { ok: false, erreur: 'Introuvable.' });
      entrer(socket, id.uid);
      repondre(rappel, { ok: true, roue: vue(id.uid) });
    });
    socket.on('casino_bal_quitter', (_data: unknown, rappel?: Rappel) => {
      sortir(socket.id);
      void socket.leave(SALLE_BAL);
      repondre(rappel, { ok: true });
    });
    socket.on('casino_bal_miser', async (data: { case?: unknown; montant?: unknown } = {}, rappel?: Rappel) => {
      const m = await pourMiser(rappel);
      if (!m) return;
      const c = data?.case as CaseBal;
      const montant = Number(data?.montant);
      if (!CASES_BAL.includes(c)) return erreur(rappel, 'Case introuvable.', 'Unknown spot.');
      if (!JETONS_BW.includes(montant)) return erreur(rappel, 'Jeton impossible.', 'Invalid chip.');
      poser(m, [{ c, montant }], rappel);
    });
    socket.on('casino_bal_annuler', async (data: { tout?: unknown } = {}, rappel?: Rappel) => {
      const m = await pourMiser(rappel);
      if (!m) return;
      if (!m.j.poses.length) return repondre(rappel, { ok: true });
      const retires = data?.tout ? m.j.poses.splice(0) : m.j.poses.splice(-1);
      for (const x of retires) {
        const reste = (m.j.mises[x.c] ?? 0) - x.montant;
        if (reste > 0) m.j.mises[x.c] = reste;
        else delete m.j.mises[x.c];
      }
      banque.rembourser(m.id.uid, retires.reduce((s, x) => s + x.montant, 0));
      diffuser();
      repondre(rappel, { ok: true });
    });
    socket.on('casino_bal_doubler', async (_data: unknown, rappel?: Rappel) => {
      const m = await pourMiser(rappel);
      if (!m) return;
      const ajout = (Object.entries(m.j.mises) as [CaseBal, number][]).filter(([, v]) => v > 0).map(([c, montant]) => ({ c, montant }));
      if (!ajout.length) return erreur(rappel, 'Aucune mise à doubler.', 'No bet to double.');
      poser(m, ajout, rappel);
    });
    socket.on('casino_bal_refaire', async (_data: unknown, rappel?: Rappel) => {
      const m = await pourMiser(rappel);
      if (!m) return;
      const avant = precedentes.get(m.id.uid);
      if (!avant || !totalMises(avant)) return erreur(rappel, 'Aucune mise à refaire.', 'No bet to repeat.');
      if (totalMises(m.j.mises)) return erreur(rappel, 'Tu as déjà misé sur cette manche.', 'You have already bet on this round.');
      poser(m, (Object.entries(avant) as [CaseBal, number][]).filter(([, v]) => v > 0).map(([c, montant]) => ({ c, montant })), rappel);
    });
    /** Le choix du bonus (une seule fois, pendant l'étape de choix). */
    socket.on('casino_bal_choisir', async (data: { etape?: unknown; choix?: unknown } = {}, rappel?: Rappel) => {
      const id = await regarde(rappel);
      if (!id) return;
      const k = Number(data?.etape);
      const o = Number(data?.choix);
      const t = tirage?.type as BonusBal | undefined;
      if (phase !== 'bonus' || !t || k !== etape || !etapes[k]?.choix || fin === null || horloge() >= fin) return erreur(rappel, 'Trop tard pour choisir.', 'Too late to choose.');
      const j = joueurs.get(id.uid);
      if (!j || !(j.mises[t] ?? 0)) return erreur(rappel, 'Tu n’as pas misé sur ce bonus.', 'You did not bet on this bonus.');
      if (!Number.isInteger(o) || o < 0 || o >= etapes[k].choix) return erreur(rappel, 'Choix impossible.', 'Invalid choice.');
      if (j.choix !== null) return erreur(rappel, 'Tu as déjà choisi.', 'You have already chosen.');
      j.choix = o;
      diffuser();
      repondre(rappel, { ok: true });
    });
    socket.on('disconnect', () => sortir(socket.id));
  }

  /** Ce que l'accueil du salon montre : en direct ou non, combien regardent, les derniers résultats. */
  const resume = () => ({ enDirect: enCours, spectateurs: uidsSpectateurs().size, historique: historique.slice(0, 6).map((h) => h.c) });

  /** Arrêt du serveur : une manche pas encore payée est annulée, ses mises rendues. */
  const rendreMisesEnCours = () => {
    arreter();
    if (paye) return;
    for (const j of joueurs.values()) {
      const m = totalMises(j.mises);
      if (m > 0 && j.gain === null) banque.rembourser(j.uid, m);
    }
    joueurs.clear();
  };

  return { brancher, sortir, fermer: arreter, rendreMisesEnCours, resume };
}
