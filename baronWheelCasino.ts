/**
 * The Baron's Wheel : la roue géante du Salon privé, en direct. Une seule manche à la fois pour tout le salon, qui
 * tourne tant qu'au moins un créateur la regarde.
 *
 * - À la fin des mises, le serveur pose les multiplicateurs (3 cases au hasard), puis tire la case d'arrêt
 *   (crypto.randomInt) et l'angle d'arrivée : tous les téléphones font tourner la roue de la même façon et elle s'arrête
 *   sur cette case.
 * - Sur un bonus, toutes ses récompenses cachées sont tirées d'un coup ; chaque joueur qui a misé sur ce bonus fait ses
 *   choix (sans choix à temps, le serveur choisit pour lui au hasard). Les récompenses ne partent vers les téléphones
 *   qu'une fois les choix fermés.
 * - Chaque mise est débitée tout de suite (rendue si elle est annulée avant la fin des mises, ou si le serveur
 *   s'arrête avant la fin de la manche). Les gains sont versés une seule fois, à la fin de la manche.
 */
import { randomInt } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import type { AnnonceCasino } from '../shared/casino';
import {
  BONUS_BW,
  CASES_BW,
  DEGRES_CASE_BW,
  DUREES_BW,
  estBonusBW,
  etapesBonusBW,
  gainBW,
  GAINS_CHIFFRES_BW,
  multiplicateurDe,
  tirerMultiplicateursBW,
  JETONS_BW,
  MAX_CASE_BW,
  MAX_MANCHE_BW,
  NB_CASES_BW,
  recompenseBonusBW,
  ROUE_BW,
  tirerBonusBW,
  type BonusBW,
  type BoostBW,
  type CaseBW,
  type DureesBW,
  type EtapeBonusBW,
  type Hasard,
  type JackpotBW,
  type JoueurBW,
  type JournalBW,
  type ManchesJournalBW,
  type PhaseBW,
  type TirageBonusBW,
  type VueBonusBW,
  type VueBW,
} from '../shared/baronWheel';
import type { Identite } from './comptes';
import type { BanqueCasino } from './tablesCasino';

type Reponse = { ok: true; [cle: string]: unknown } | { ok: false; erreur: string };
type Rappel = (r: Reponse) => void;

const SALLE_BW = 'casino-baron-wheel';
const GRILLE = 2 ** 48 - 1;
const hasardCrypto: Hasard = () => randomInt(0, GRILLE) / GRILLE;
/** Tours complets de la roue avant l'arrêt. */
const TOURS = 5;

interface Joueur {
  uid: string;
  nom: string;
  avatar: number;
  mises: Partial<Record<CaseBW, number>>;
  /** L'ordre des jetons posés (pour « Annuler » le dernier). */
  poses: { c: CaseBW; montant: number }[];
  /** Choix du bonus (un par étape de choix). */
  choix: (number | null)[];
  gain: number | null;
  jackpot?: JackpotBW;
  resultat?: VueBonusBW['resultat'];
}

const totalMises = (m: Partial<Record<CaseBW, number>>) => Object.values(m).reduce((s: number, x) => s + (x ?? 0), 0);

export function creerBaronWheel(options: {
  io: Server;
  banque: BanqueCasino;
  horloge?: () => number;
  delais?: Partial<DureesBW>;
  hasard?: Hasard;
  /** Case d'arrêt imposée (tests, démonstration) ; au hasard sinon. */
  arret?: () => number | undefined;
  /** Multiplicateurs imposés (tests, démonstration) ; au hasard sinon. */
  multiplicateurs?: () => BoostBW[] | undefined;
  /** Grande ouverture : sa fin (ms), ou null. */
  ouverture?: () => number | null;
  annoncer?: (a: AnnonceCasino) => void;
}) {
  const { io, banque } = options;
  const horloge = options.horloge ?? Date.now;
  const D: DureesBW = { ...DUREES_BW, ...options.delais };
  const hasard = options.hasard ?? hasardCrypto;
  const finOuverture = () => {
    const f = options.ouverture?.() ?? null;
    return f !== null && f > horloge() ? f : null;
  };

  const spectateurs = new Map<string, { uid: string }>();
  const joueurs = new Map<string, Joueur>();
  const precedentes = new Map<string, Partial<Record<CaseBW, number>>>();
  const journaux = new Map<string, ManchesJournalBW[]>();
  const totaux = new Map<string, JournalBW['moi']>();
  const salon: JournalBW['salon'] = { manches: 0, cases: Object.fromEntries(CASES_BW.map((c) => [c, 0])) as Record<CaseBW, number>, jackpots: { mini: 0, minor: 0, major: 0, grand: 0 } };

  let numero = 0;
  let phase: PhaseBW = 'mises';
  let fin: number | null = null;
  let duree: number | null = null;
  let angle = 0;
  let tour: { depart: number; arrivee: number; debut: number; duree: number } | null = null;
  let arret: number | null = null;
  let boosts: BoostBW[] | null = null;
  let tirage: TirageBonusBW | null = null;
  let etapes: EtapeBonusBW[] = [];
  let etape = 0;
  let paye = false;
  let minuterie: ReturnType<typeof setTimeout> | null = null;
  let enCours = false;
  let historique: VueBW['historique'] = [];

  const uidsSpectateurs = () => new Set([...spectateurs.values()].map((s) => s.uid));
  const bonusCourant = (): BonusBW | null => (tirage ? tirage.type : null);
  /** L'indice de l'étape de choix (0, 1, 2) correspondant à l'étape `k` du bonus, ou -1. */
  const rangChoix = (k: number) => (etapes[k]?.choix ? etapes.slice(0, k).filter((e) => e.choix > 0).length : -1);
  /** L'étape `nom` est-elle atteinte (ou dépassée) ? */
  const atteinte = (nom: EtapeBonusBW['nom']) => {
    const k = etapes.findIndex((e) => e.nom === nom);
    return k >= 0 && (etape >= k || phase === 'resultat');
  };

  function vueBonus(j: Joueur | undefined): VueBonusBW | null {
    if (!tirage) return null;
    const t = tirage;
    const nbChoix = etapes.filter((e) => e.choix > 0).length;
    const tous = [...joueurs.values()].filter((x) => (x.mises[t.type] ?? 0) > 0);
    const choixSalon = etapes
      .filter((e) => e.choix > 0)
      .map((e, r) => Array.from({ length: e.choix }, (_, o) => tous.filter((x) => x.choix[r] === o).length));
    const v: VueBonusBW = {
      type: t.type,
      etapes,
      etape,
      multiplicateur: multiplicateurDe(boosts, arret),
      mise: j?.mises[t.type] ?? 0,
      mesChoix: j ? Array.from({ length: nbChoix }, (_, r) => j.choix[r] ?? null) : Array(nbChoix).fill(null),
      choixSalon,
      resultat: j && atteinte('revele') ? (j.resultat ?? null) : null,
    };
    if (t.type === 'baron') v.cartes = atteinte('revele') ? t.cartes : [null, null, null];
    if (t.type === 'pickpocket') {
      v.butin = atteinte('vol') ? t.butin : null;
      v.mallettes = atteinte('revele') ? t.mallettes : [null, null, null];
    }
    if (t.type === 'evasion') v.routes = atteinte('poursuite') ? t.routes : [null, null, null];
    if (t.type === 'braquage') {
      v.code = atteinte('codeRevele') ? t.code : [null, null, null];
      v.meca = atteinte('mecaRevele') ? t.meca : Array(8).fill(null);
      v.coffre = atteinte('revele') ? t.coffre : [null, null, null, null];
    }
    if (t.type === 'express') {
      // Le voyage se révèle gare après gare : rien de ce qui attend plus loin ne part vers les téléphones.
      const tunnelVu = (n: number) => atteinte(n === 0 ? 'tunnel1' : 'tunnel2');
      const gagnant = t.decroche.findIndex((d) => d === null);
      v.express = {
        paris: atteinte('paris') ? [...t.paris] : t.paris.map(() => null),
        venise: t.venise.map((x, k) => (atteinte('venise') && t.decroche[k] !== 0 ? x : null)),
        decroches: t.decroche.map((d) => (d !== null && tunnelVu(d) ? d : null)),
        coffre: atteinte('istanbul') ? t.coffre : null,
        gagnant: atteinte('istanbul') ? gagnant : null,
      };
    }
    return v;
  }

  function vue(uid: string | null): VueBW {
    const t = horloge();
    const j = uid ? joueurs.get(uid) : undefined;
    const liste: JoueurBW[] = [...joueurs.values()]
      .filter((x) => totalMises(x.mises) > 0)
      .map((x) => ({ nom: x.nom, avatar: x.avatar, mise: totalMises(x.mises), gain: x.gain, ...(x.jackpot ? { jackpot: x.jackpot } : {}), ...(x.uid === uid ? { moi: true as const } : {}) }))
      .sort((a, b) => (b.gain ?? 0) - (a.gain ?? 0) || b.mise - a.mise);
    const ouverture = finOuverture();
    return {
      numero,
      phase,
      reste: fin === null ? null : Math.max(0, fin - t),
      duree,
      angle,
      tour: tour && phase === 'tour' ? { depart: tour.depart, arrivee: tour.arrivee, ecoule: t - tour.debut, duree: tour.duree } : null,
      arret: phase === 'mises' || phase === 'multiplicateurs' ? null : arret,
      multiplicateurs: phase === 'mises' ? null : boosts,
      bonus: phase === 'bonus' || phase === 'resultat' ? vueBonus(j) : null,
      mesMises: j ? { ...j.mises } : {},
      peutRefaire: !!uid && !!precedentes.get(uid) && totalMises(precedentes.get(uid) ?? {}) > 0,
      bilan: phase === 'resultat' && j && j.gain !== null ? { mise: totalMises(j.mises), gain: j.gain } : null,
      joueurs: liste.slice(0, 20),
      historique,
      spectateurs: uidsSpectateurs().size,
      solde: uid ? banque.solde(uid) : 0,
      ouverture: ouverture === null ? null : ouverture - t,
    };
  }

  function diffuser() {
    for (const [sid, s] of spectateurs) io.to(sid).emit('casino_bw', vue(s.uid));
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
    paye = false;
    if (!spectateurs.size) {
      enCours = false;
      phase = 'mises';
      fin = null;
      duree = null;
      boosts = null;
      return;
    }
    enCours = true;
    numero += 1;
    phase = 'mises';
    boosts = null;
    fin = horloge() + D.mises;
    duree = D.mises;
    plusTard(poserMultiplicateurs, D.mises);
    diffuser();
  }

  /** Les mises sont fermées : 3 cases de la roue reçoivent un multiplicateur (une 4e, dorée, pendant l'ouverture). */
  function poserMultiplicateurs() {
    const impose = options.multiplicateurs?.();
    const valides = impose?.filter((b) => Number.isInteger(b.i) && b.i >= 0 && b.i < NB_CASES_BW && b.x >= 1);
    boosts = valides ?? tirerMultiplicateursBW(hasard, finOuverture() !== null);
    phase = 'multiplicateurs';
    fin = horloge() + D.multiplicateurs;
    duree = D.multiplicateurs;
    plusTard(lancer, D.multiplicateurs);
    diffuser();
  }

  function lancer() {
    const impose = options.arret?.();
    arret = impose !== undefined && Number.isInteger(impose) && impose >= 0 && impose < NB_CASES_BW ? impose : Math.floor(hasard() * NB_CASES_BW);
    // L'aiguille est en haut : la case `arret` y arrive quand la roue a tourné de -(centre de la case), à ±3° près.
    const decalage = (hasard() * 2 - 1) * (DEGRES_CASE_BW / 3);
    const cible = (((-(arret * DEGRES_CASE_BW + DEGRES_CASE_BW / 2 + decalage) % 360) + 360) % 360);
    const depart = angle;
    const reste = (((cible - (depart % 360)) % 360) + 360) % 360;
    tour = { depart, arrivee: depart + TOURS * 360 + reste, debut: horloge(), duree: D.tour };
    phase = 'tour';
    fin = null;
    duree = null;
    plusTard(resultat, D.tour);
    diffuser();
  }

  function resultat() {
    if (arret === null || !tour) return;
    angle = tour.arrivee % 360;
    const c = ROUE_BW[arret];
    const m = multiplicateurDe(boosts, arret);
    historique = [{ c, ...(m > 1 ? { x: m } : {}) }, ...historique].slice(0, 20);
    salon.manches++;
    salon.cases[c]++;
    if (estBonusBW(c)) {
      tirage = tirerBonusBW(c, hasard);
      etapes = etapesBonusBW(c, D);
      etape = 0;
      for (const j of joueurs.values()) j.choix = etapes.filter((e) => e.choix > 0).map(() => null);
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
    // Une étape de choix se ferme : ceux qui n'ont pas choisi reçoivent un choix au hasard.
    const r = rangChoix(etape);
    if (r >= 0 && tirage) {
      const n = etapes[etape].choix;
      for (const j of joueurs.values()) if ((j.mises[tirage.type] ?? 0) > 0 && j.choix[r] === null) j.choix[r] = Math.floor(hasard() * n);
    }
    // Avant la révélation finale, chaque joueur reçoit sa récompense (calculée une fois, versée à la fin).
    if (etapes[etape + 1]?.nom === 'revele') calculerBonus();
    // Fin du bonus : on reste sur la dernière étape (la révélation) pendant les résultats.
    if (etape + 1 >= etapes.length) return payer();
    etape += 1;
    lancerEtape();
  }

  function calculerBonus() {
    if (!tirage) return;
    for (const j of joueurs.values()) {
      const mise = j.mises[tirage.type] ?? 0;
      if (!mise) continue;
      const r = recompenseBonusBW(tirage, j.choix.map((x) => x ?? 0));
      // Le multiplicateur de la roue multiplie la récompense, sauf un jackpot (valeur fixe).
      const x = r.jackpot ? r.x : r.x * multiplicateurDe(boosts, arret);
      j.resultat = { ...r, x, gain: gainBW(mise, x) };
    }
  }

  /** Verse les gains de la manche (une seule fois), puis montre les résultats. */
  function payer() {
    if (paye || arret === null) return;
    paye = true;
    const c = ROUE_BW[arret];
    const m = multiplicateurDe(boosts, arret);
    for (const j of joueurs.values()) {
      const mise = totalMises(j.mises);
      if (!mise) continue;
      const surCase = j.mises[c] ?? 0;
      let gain = 0;
      if (surCase > 0) {
        if (estBonusBW(c)) {
          gain = j.resultat?.gain ?? 0;
          if (j.resultat?.jackpot) {
            j.jackpot = j.resultat.jackpot;
            salon.jackpots[j.resultat.jackpot]++;
          }
        } else gain = gainBW(surCase, GAINS_CHIFFRES_BW[c] * m);
      }
      j.gain = gain;
      if (gain > 0) banque.crediter(j.uid, gain);
      const mt = totaux.get(j.uid) ?? { manches: 0, mise: 0, gain: 0, bonus: { baron: 0, pickpocket: 0, evasion: 0, braquage: 0, express: 0 } };
      mt.manches++;
      mt.mise += mise;
      mt.gain += gain;
      if (estBonusBW(c) && surCase > 0) mt.bonus[c]++;
      totaux.set(j.uid, mt);
      const ligne: ManchesJournalBW = { numero, c, mise, gain, solde: banque.solde(j.uid), t: horloge(), ...(j.jackpot ? { jackpot: j.jackpot } : {}) };
      journaux.set(j.uid, [ligne, ...(journaux.get(j.uid) ?? [])].slice(0, 20));
      if ((gain >= 10 * mise && gain >= 1_000_000) || gain >= 10_000_000 || (j.jackpot && (j.jackpot === 'major' || j.jackpot === 'grand'))) options.annoncer?.({ nom: j.nom, jeu: 'baronWheel', gain });
    }
    phase = 'resultat';
    fin = horloge() + D.resultat;
    duree = D.resultat;
    plusTard(ouvrirMises, D.resultat);
    diffuser();
  }

  function entrer(socket: Socket, uid: string) {
    spectateurs.set(socket.id, { uid });
    void socket.join(SALLE_BW);
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
        j = { uid: id.uid, nom: infos?.nom || id.nom || '', avatar: infos?.avatar ?? 1, mises: {}, poses: [], choix: [], gain: null };
        joueurs.set(id.uid, j);
      }
      return { id, j };
    };
    /** Pose plusieurs jetons d'un coup, si les plafonds et le solde le permettent. */
    const poser = (m: { id: Identite; j: Joueur }, ajout: { c: CaseBW; montant: number }[], rappel: unknown) => {
      const apres = { ...m.j.mises };
      for (const x of ajout) apres[x.c] = (apres[x.c] ?? 0) + x.montant;
      if (Object.values(apres).some((v) => (v ?? 0) > MAX_CASE_BW)) return erreur(rappel, 'Pas plus de 1 000 000 $ sur une même case.', 'No more than $1,000,000 on one spot.');
      if (totalMises(apres) > MAX_MANCHE_BW) return erreur(rappel, 'Pas plus de 4 000 000 $ par manche.', 'No more than $4,000,000 per round.');
      const total = ajout.reduce((s, x) => s + x.montant, 0);
      if (!banque.debiter(m.id.uid, total)) return erreur(rappel, 'Solde insuffisant.', 'Not enough money.');
      m.j.mises = apres;
      m.j.poses.push(...ajout);
      diffuser();
      repondre(rappel, { ok: true });
    };

    socket.on('casino_bw_entrer', async (_data: unknown, rappel?: Rappel) => {
      const id = await ctx.acces(rappel);
      if (!id) return;
      if (!ctx.enSalon(id.uid)) return repondre(rappel, { ok: false, erreur: 'Introuvable.' });
      entrer(socket, id.uid);
      repondre(rappel, { ok: true, roue: vue(id.uid) });
    });

    socket.on('casino_bw_quitter', (_data: unknown, rappel?: Rappel) => {
      sortir(socket.id);
      void socket.leave(SALLE_BW);
      repondre(rappel, { ok: true });
    });

    socket.on('casino_bw_miser', async (data: { case?: unknown; montant?: unknown } = {}, rappel?: Rappel) => {
      const m = await pourMiser(rappel);
      if (!m) return;
      const c = data?.case as CaseBW;
      const montant = Number(data?.montant);
      if (!CASES_BW.includes(c)) return erreur(rappel, 'Case introuvable.', 'Unknown spot.');
      if (!JETONS_BW.includes(montant)) return erreur(rappel, 'Jeton impossible.', 'Invalid chip.');
      poser(m, [{ c, montant }], rappel);
    });

    socket.on('casino_bw_annuler', async (data: { tout?: unknown } = {}, rappel?: Rappel) => {
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

    socket.on('casino_bw_doubler', async (_data: unknown, rappel?: Rappel) => {
      const m = await pourMiser(rappel);
      if (!m) return;
      const ajout = (Object.entries(m.j.mises) as [CaseBW, number][]).filter(([, v]) => v > 0).map(([c, montant]) => ({ c, montant }));
      if (!ajout.length) return erreur(rappel, 'Aucune mise à doubler.', 'No bet to double.');
      poser(m, ajout, rappel);
    });

    socket.on('casino_bw_refaire', async (_data: unknown, rappel?: Rappel) => {
      const m = await pourMiser(rappel);
      if (!m) return;
      const avant = precedentes.get(m.id.uid);
      if (!avant || !totalMises(avant)) return erreur(rappel, 'Aucune mise à refaire.', 'No bet to repeat.');
      if (totalMises(m.j.mises)) return erreur(rappel, 'Tu as déjà misé sur cette manche.', 'You have already bet on this round.');
      poser(
        m,
        (Object.entries(avant) as [CaseBW, number][]).filter(([, v]) => v > 0).map(([c, montant]) => ({ c, montant })),
        rappel,
      );
    });

    /** Un choix du bonus : l'étape (son indice) et l'option. Un seul choix par étape, qui ne change plus. */
    socket.on('casino_bw_choisir', async (data: { etape?: unknown; choix?: unknown } = {}, rappel?: Rappel) => {
      const id = await regarde(rappel);
      if (!id) return;
      const k = Number(data?.etape);
      const o = Number(data?.choix);
      const t = bonusCourant();
      if (phase !== 'bonus' || !t || k !== etape || !etapes[k]?.choix || fin === null || horloge() >= fin) return erreur(rappel, 'Trop tard pour choisir.', 'Too late to choose.');
      const j = joueurs.get(id.uid);
      if (!j || !(j.mises[t] ?? 0)) return erreur(rappel, 'Tu n’as pas misé sur ce bonus.', 'You did not bet on this bonus.');
      if (!Number.isInteger(o) || o < 0 || o >= etapes[k].choix) return erreur(rappel, 'Choix impossible.', 'Invalid choice.');
      const r = rangChoix(k);
      if (j.choix[r] !== null && j.choix[r] !== undefined) return erreur(rappel, 'Tu as déjà choisi.', 'You have already chosen.');
      j.choix[r] = o;
      diffuser();
      repondre(rappel, { ok: true });
    });

    socket.on('casino_bw_journal', async (_data: unknown, rappel?: Rappel) => {
      const id = await ctx.acces(rappel);
      if (!id) return;
      if (!ctx.enSalon(id.uid)) return repondre(rappel, { ok: false, erreur: 'Introuvable.' });
      const journal: JournalBW = {
        manches: journaux.get(id.uid) ?? [],
        salon,
        moi: totaux.get(id.uid) ?? { manches: 0, mise: 0, gain: 0, bonus: { baron: 0, pickpocket: 0, evasion: 0, braquage: 0, express: 0 } },
      };
      repondre(rappel, { ok: true, journal });
    });

    socket.on('disconnect', () => sortir(socket.id));
  }

  /** Ce que l'accueil du salon montre : en direct ou non, combien regardent, les derniers résultats, la grande ouverture. */
  const resume = () => {
    const o = finOuverture();
    return { enDirect: enCours, spectateurs: uidsSpectateurs().size, historique: historique.slice(0, 6).map((h) => h.c), ouverture: o === null ? null : o - horloge() };
  };

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

  return { brancher, sortir, fermer: arreter, rendreMisesEnCours, resume, BONUS: BONUS_BW };
}
