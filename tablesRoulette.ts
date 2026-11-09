/**
 * Tables de roulette du Salon privé : jusqu'à 5 places (créateurs et bots), un tour après l'autre.
 *
 * Mises (25 s, « Rien ne va plus » 3 s avant la fin) → la bille tourne (le serveur tire le numéro avec
 * crypto.randomInt) → résultat et paiements → nouveau tour. Chaque jeton posé est débité tout de suite du
 * porte-monnaie du salon (et rendu s'il est retiré avant la fin des mises) ; les gains sont crédités au résultat.
 * Un joueur qui part laisse ses mises : elles sont jouées et payées quand même. Les bots misent un peu au hasard,
 * avec un argent illimité jamais enregistré.
 */
import { randomInt } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import { JETONS_ROULETTE, MAX_CASE_ROULETTE, MAX_TOUR_ROULETTE, MISES_ROULETTE, PLACES_ROULETTE, retourMise, SIMPLES, type JetonPoseRoulette, type VueTableRoulette } from '../shared/rouletteCasino';
import type { ResumeTableBJ } from '../shared/blackjack';
import type { AnnonceCasino } from '../shared/casino';
import { filtrerMessage } from '../shared/moderation';
import { PRENOMS_BOTS } from '../shared/robot';
import type { Identite } from './comptes';
import type { BanqueCasino } from './tablesCasino';

type Reponse = { ok: true; [cle: string]: unknown } | { ok: false; erreur: string };
type Rappel = (r: Reponse) => void;

export interface DelaisRoulette {
  mises: number;
  /** « Rien ne va plus » : les mises se ferment ce temps-là avant la fin. */
  fermeture: number;
  tirage: number;
  resultat: number;
  absence: number;
}
const DELAIS: DelaisRoulette = { mises: 25_000, fermeture: 3_000, tirage: 7_000, resultat: 5_500, absence: 60_000 };
/** Un gain net de cette taille est annoncé dans tout le salon. */
const GAIN_ANNONCE = 1_000_000;

interface Siege {
  id: string;
  uid: string | null;
  nom: string;
  avatar: number;
  bot: boolean;
  sockets: Set<string>;
  parti: boolean;
  absentDepuis: number | null;
}
interface Pose {
  cle: string;
  montant: number;
  place: string;
}
interface Table {
  code: string;
  hote: string;
  sieges: Siege[];
  etape: 'mises' | 'tirage' | 'resultat';
  fin: number | null;
  duree: number | null;
  minuterie: ReturnType<typeof setTimeout> | null;
  minuteriesBots: ReturnType<typeof setTimeout>[];
  poses: Pose[];
  /** Les mises du tour précédent de chaque place (bouton « Refaire »). */
  precedentes: Map<string, { cle: string; montant: number }[]>;
  historique: number[];
  numero: number;
  tirage: number | null;
  resultats: Map<string, number>;
  messages: { nom: string; texte: string }[];
}

const LETTRES = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const PLEINS = [...MISES_ROULETTE.values()].filter((m) => m.type === 'plein').map((m) => m.cle);

export function creerTablesRoulette(options: {
  io: Server;
  banque: BanqueCasino;
  horloge?: () => number;
  hasard?: (n: number) => number;
  /** Numéro tiré (remplaçable pour les tests ; au hasard sinon). */
  tirage?: () => number;
  delais?: Partial<DelaisRoulette>;
  annoncer?: (a: AnnonceCasino) => void;
}) {
  const { io, banque } = options;
  const horloge = options.horloge ?? Date.now;
  const hasard = options.hasard ?? ((n: number) => randomInt(n));
  const tirer = options.tirage ?? (() => randomInt(37));
  const D = { ...DELAIS, ...options.delais };
  const tables = new Map<string, Table>();
  /** Téléphone → table et place. */
  const liens = new Map<string, { code: string; siege: string }>();
  let numeroBot = 0;

  const humains = (t: Table) => t.sieges.filter((s) => !s.bot && !s.parti);
  const present = (s: Siege) => s.bot || (!s.parti && s.sockets.size > 0);
  const ouvertes = (t: Table) => t.etape === 'mises' && t.fin !== null && horloge() < t.fin - D.fermeture;
  const posesDe = (t: Table, place: string) => t.poses.filter((p) => p.place === place);
  const total = (poses: { montant: number }[]) => poses.reduce((s, p) => s + p.montant, 0);

  function vue(t: Table, siegeId: string | null): VueTableRoulette {
    const moi = t.sieges.find((s) => s.id === siegeId);
    // Jetons regroupés par case et par joueur.
    const groupes = new Map<string, JetonPoseRoulette>();
    for (const p of t.poses) {
      const k = `${p.place}|${p.cle}`;
      const g = groupes.get(k);
      if (g) g.montant += p.montant;
      else groupes.set(k, { ...p });
    }
    return {
      code: t.code,
      numero: t.numero,
      phase: t.etape,
      reste: t.fin === null ? null : Math.max(0, t.fin - horloge()),
      duree: t.duree,
      closes: !ouvertes(t),
      places: t.sieges.map((s) => ({
        id: s.id,
        nom: s.nom,
        avatar: s.avatar,
        bot: s.bot,
        ...(s.id === siegeId ? { moi: true as const } : {}),
        ...(s.id === t.hote ? { hote: true as const } : {}),
        ...(!present(s) ? { absent: true as const } : {}),
        mise: total(posesDe(t, s.id)),
        resultat: t.etape === 'resultat' ? (t.resultats.get(s.id) ?? null) : null,
      })),
      jetons: [...groupes.values()],
      tirage: t.etape === 'mises' ? null : t.tirage,
      historique: t.historique,
      hote: t.hote === siegeId,
      solde: moi?.uid ? banque.solde(moi.uid) : 0,
      peutRefaire: !!siegeId && !!t.precedentes.get(siegeId)?.length,
      messages: t.messages.slice(-30),
    };
  }

  function diffuser(t: Table) {
    for (const s of t.sieges) for (const sid of s.sockets) io.to(sid).emit('casino_rl', vue(t, s.id));
  }

  function planifier(t: Table, ms: number, f: () => void) {
    if (t.minuterie) clearTimeout(t.minuterie);
    t.fin = horloge() + ms;
    t.duree = ms;
    t.minuterie = setTimeout(() => {
      t.minuterie = null;
      f();
    }, ms);
  }

  function arreterBots(t: Table) {
    for (const m of t.minuteriesBots) clearTimeout(m);
    t.minuteriesBots = [];
  }

  function supprimer(t: Table) {
    if (t.minuterie) clearTimeout(t.minuterie);
    arreterBots(t);
    for (const s of t.sieges) for (const sid of s.sockets) liens.delete(sid);
    tables.delete(t.code);
  }

  /** Retire les places parties ou absentes depuis trop longtemps (sauf celles qui ont des jetons sur le tapis). */
  function nettoyer(t: Table) {
    const maintenant = horloge();
    t.sieges = t.sieges.filter((s) => {
      const garde = s.bot || posesDe(t, s.id).length > 0 || (!s.parti && (s.absentDepuis === null || maintenant - s.absentDepuis < D.absence));
      if (!garde) for (const sid of s.sockets) liens.delete(sid);
      return garde;
    });
    if (!humains(t).length && !t.poses.some((p) => !t.sieges.find((s) => s.id === p.place)?.bot)) return supprimer(t), false;
    if (!t.sieges.some((s) => s.id === t.hote && !s.parti)) t.hote = humains(t)[0]?.id ?? t.hote;
    return true;
  }

  /** Les bots misent à des moments différents pendant les mises : une simple, une douzaine ou un plein. */
  function faireMiserBots(t: Table) {
    arreterBots(t);
    for (const s of t.sieges.filter((x) => x.bot)) {
      const nb = 1 + hasard(3);
      for (let k = 0; k < nb; k++) {
        const quand = Math.floor(((D.mises - D.fermeture) * (8 + hasard(75))) / 100);
        t.minuteriesBots.push(
          setTimeout(() => {
            if (!tables.has(t.code) || !ouvertes(t) || !t.sieges.includes(s)) return;
            const choix = hasard(10);
            const cle = choix < 5 ? SIMPLES[hasard(SIMPLES.length)] : choix < 7 ? `douzaine-${1 + hasard(3)}` : choix < 8 ? `colonne-${1 + hasard(3)}` : PLEINS[hasard(PLEINS.length)];
            const montant = JETONS_ROULETTE[hasard(3)];
            t.poses.push({ cle, montant, place: s.id });
            diffuser(t);
          }, quand),
        );
      }
    }
  }

  function ouvrirMises(t: Table) {
    if (!tables.has(t.code)) return;
    t.poses = [];
    t.tirage = null;
    t.resultats = new Map();
    if (!nettoyer(t)) return;
    t.etape = 'mises';
    planifier(t, D.mises, () => lancer(t));
    faireMiserBots(t);
    diffuser(t);
  }

  function lancer(t: Table) {
    if (!tables.has(t.code)) return;
    arreterBots(t);
    t.numero += 1;
    t.etape = 'tirage';
    t.tirage = ((tirer() % 37) + 37) % 37;
    // Les mises de ce tour deviennent celles à « refaire » au tour suivant.
    const parPlace = new Map<string, { cle: string; montant: number }[]>();
    for (const p of t.poses) parPlace.set(p.place, [...(parPlace.get(p.place) ?? []), { cle: p.cle, montant: p.montant }]);
    for (const [place, l] of parPlace) t.precedentes.set(place, l);
    planifier(t, D.tirage, () => payer(t));
    diffuser(t);
  }

  function payer(t: Table) {
    if (!tables.has(t.code) || t.tirage === null) return;
    const n = t.tirage;
    for (const s of t.sieges) {
      const mes = posesDe(t, s.id);
      if (!mes.length) continue;
      const retour = mes.reduce((r, p) => r + retourMise(p.cle, p.montant, n), 0);
      const net = retour - total(mes);
      t.resultats.set(s.id, net);
      if (!s.bot && s.uid && retour > 0) banque.crediter(s.uid, retour);
      if (!s.bot && net >= GAIN_ANNONCE) options.annoncer?.({ nom: s.nom, jeu: 'roulette', gain: net });
    }
    t.historique = [n, ...t.historique].slice(0, 12);
    t.etape = 'resultat';
    planifier(t, D.resultat, () => ouvrirMises(t));
    diffuser(t);
  }

  function nouveauBot(): Siege {
    numeroBot += 1;
    return { id: `bot-r${numeroBot}`, uid: null, nom: PRENOMS_BOTS[hasard(PRENOMS_BOTS.length)], avatar: 1 + hasard(6), bot: true, sockets: new Set(), parti: false, absentDepuis: null };
  }

  function asseoir(t: Table, socket: Socket, id: Identite): Siege {
    let s = t.sieges.find((x) => x.uid === id.uid);
    const infos = banque.joueur(id.uid);
    if (!s) {
      s = { id: `r-${id.uid.slice(0, 8)}-${hasard(1e6)}`, uid: id.uid, nom: infos?.nom || id.nom || '', avatar: infos?.avatar ?? 1, bot: false, sockets: new Set(), parti: false, absentDepuis: null };
      t.sieges.push(s);
    }
    s.parti = false;
    s.absentDepuis = null;
    s.sockets.add(socket.id);
    liens.set(socket.id, { code: t.code, siege: s.id });
    return s;
  }

  function quitter(socketId: string) {
    const lien = liens.get(socketId);
    liens.delete(socketId);
    const t = lien ? tables.get(lien.code) : undefined;
    const s = t?.sieges.find((x) => x.id === lien!.siege);
    if (!t || !s) return;
    s.sockets.delete(socketId);
    if (s.sockets.size) return;
    s.parti = true;
    if (!nettoyer(t)) return;
    diffuser(t);
  }

  // Ménage : places absentes depuis plus d'une minute.
  const menage = setInterval(() => {
    for (const t of [...tables.values()]) {
      if (t.etape !== 'mises') continue;
      const avant = t.sieges.length;
      if (nettoyer(t) && t.sieges.length !== avant) diffuser(t);
    }
  }, 10_000);
  menage.unref?.();

  function brancher(socket: Socket, ctx: { acces: (rappel: unknown) => Promise<Identite | null>; enSalon: (uid: string) => boolean; L: (fr: string, en: string) => string }) {
    const { L } = ctx;
    const repondre = (rappel: unknown, r: Reponse) => {
      if (typeof rappel === 'function') (rappel as Rappel)(r);
    };
    const erreur = (rappel: unknown, fr: string, en: string) => repondre(rappel, { ok: false, erreur: L(fr, en) });
    const maTable = () => {
      const lien = liens.get(socket.id);
      const t = lien ? tables.get(lien.code) : undefined;
      const s = t?.sieges.find((x) => x.id === lien!.siege);
      return t && s ? { t, s } : null;
    };
    /** Le joueur, sa table, et les mises ouvertes ; sinon l'erreur est déjà envoyée. */
    const pourMiser = async (rappel: unknown) => {
      const id = await ctx.acces(rappel);
      if (!id) return null;
      const m = maTable();
      if (!m) return erreur(rappel, 'Tu n’es à aucune table.', 'You are not at a table.'), null;
      if (!ouvertes(m.t)) return erreur(rappel, 'Rien ne va plus : les mises sont fermées.', 'No more bets.'), null;
      return { id, ...m };
    };
    let dernierMessage = 0;

    socket.on('casino_rl_creer', async (data: { bots?: unknown } = {}, rappel?: Rappel) => {
      const id = await ctx.acces(rappel);
      if (!id) return;
      if (!ctx.enSalon(id.uid)) return repondre(rappel, { ok: false, erreur: 'Introuvable.' });
      if (liens.has(socket.id)) quitter(socket.id);
      let code = '';
      do code = Array.from({ length: 4 }, () => LETTRES[hasard(LETTRES.length)]).join('');
      while (tables.has(code));
      const t: Table = { code, hote: '', sieges: [], etape: 'mises', fin: null, duree: null, minuterie: null, minuteriesBots: [], poses: [], precedentes: new Map(), historique: [], numero: 0, tirage: null, resultats: new Map(), messages: [] };
      tables.set(code, t);
      const s = asseoir(t, socket, id);
      t.hote = s.id;
      const nb = Math.max(0, Math.min(PLACES_ROULETTE - 1, Math.floor(Number(data?.bots) || 0)));
      for (let i = 0; i < nb; i++) t.sieges.push(nouveauBot());
      ouvrirMises(t);
      repondre(rappel, { ok: true, table: vue(t, s.id) });
    });

    socket.on('casino_rl_rejoindre', async (data: { code?: unknown } = {}, rappel?: Rappel) => {
      const id = await ctx.acces(rappel);
      if (!id) return;
      if (!ctx.enSalon(id.uid)) return repondre(rappel, { ok: false, erreur: 'Introuvable.' });
      const t = tables.get(String(data?.code ?? '').toUpperCase());
      if (!t) return erreur(rappel, 'Cette table est fermée.', 'This table is closed.');
      const deja = t.sieges.some((s) => s.uid === id.uid);
      if (!deja && t.sieges.length >= PLACES_ROULETTE) return erreur(rappel, 'La table est complète.', 'The table is full.');
      const lien = liens.get(socket.id);
      if (lien && lien.code !== t.code) quitter(socket.id);
      const s = asseoir(t, socket, id);
      diffuser(t);
      repondre(rappel, { ok: true, table: vue(t, s.id) });
    });

    socket.on('casino_rl_quitter', (_data: unknown, rappel?: Rappel) => {
      quitter(socket.id);
      repondre(rappel, { ok: true });
    });

    socket.on('casino_rl_bot', (data: { ajouter?: unknown } = {}, rappel?: Rappel) => {
      const m = maTable();
      if (!m) return erreur(rappel, 'Tu n’es à aucune table.', 'You are not at a table.');
      if (m.t.hote !== m.s.id) return erreur(rappel, 'Seul l’hôte de la table peut faire cela.', 'Only the table host can do that.');
      if (data?.ajouter) {
        if (m.t.sieges.length >= PLACES_ROULETTE) return erreur(rappel, 'La table est complète.', 'The table is full.');
        m.t.sieges.push(nouveauBot());
      } else {
        const bot = [...m.t.sieges].reverse().find((s) => s.bot && !posesDe(m.t, s.id).length);
        if (!bot) return erreur(rappel, 'Aucun bot à retirer pour le moment.', 'No bot to remove right now.');
        m.t.sieges = m.t.sieges.filter((s) => s !== bot);
      }
      diffuser(m.t);
      repondre(rappel, { ok: true });
    });

    socket.on('casino_rl_miser', async (data: { cle?: unknown; montant?: unknown } = {}, rappel?: Rappel) => {
      const m = await pourMiser(rappel);
      if (!m) return;
      const cle = String(data?.cle ?? '');
      const montant = Number(data?.montant);
      if (!MISES_ROULETTE.has(cle) || !JETONS_ROULETTE.includes(montant)) return erreur(rappel, 'Mise impossible.', 'Invalid bet.');
      const mes = posesDe(m.t, m.s.id);
      if (total(mes.filter((p) => p.cle === cle)) + montant > MAX_CASE_ROULETTE) return erreur(rappel, 'Pas plus de 500 000 $ sur une même case.', 'No more than $500,000 on one spot.');
      if (total(mes) + montant > MAX_TOUR_ROULETTE) return erreur(rappel, 'Pas plus de 1 000 000 $ par tour.', 'No more than $1,000,000 per spin.');
      if (!banque.debiter(m.id.uid, montant)) return erreur(rappel, 'Solde insuffisant pour ce jeton.', 'Not enough money for this chip.');
      m.t.poses.push({ cle, montant, place: m.s.id });
      diffuser(m.t);
      repondre(rappel, { ok: true });
    });

    socket.on('casino_rl_annuler', async (data: { tout?: unknown } = {}, rappel?: Rappel) => {
      const m = await pourMiser(rappel);
      if (!m) return;
      const mes = posesDe(m.t, m.s.id);
      if (!mes.length) return repondre(rappel, { ok: true });
      const retirees = data?.tout ? mes : [mes[mes.length - 1]];
      m.t.poses = m.t.poses.filter((p) => !retirees.includes(p));
      banque.crediter(m.id.uid, total(retirees));
      diffuser(m.t);
      repondre(rappel, { ok: true });
    });

    /** Pose d'un coup plusieurs mises (doubler, refaire), si les limites et le solde le permettent. */
    const poserPlusieurs = (m: { id: Identite; t: Table; s: Siege }, ajout: { cle: string; montant: number }[], rappel: unknown) => {
      const mes = posesDe(m.t, m.s.id);
      const parCase = new Map<string, number>();
      for (const p of [...mes, ...ajout]) parCase.set(p.cle, (parCase.get(p.cle) ?? 0) + p.montant);
      if ([...parCase.values()].some((v) => v > MAX_CASE_ROULETTE)) return erreur(rappel, 'Pas plus de 500 000 $ sur une même case.', 'No more than $500,000 on one spot.');
      if (total(mes) + total(ajout) > MAX_TOUR_ROULETTE) return erreur(rappel, 'Pas plus de 1 000 000 $ par tour.', 'No more than $1,000,000 per spin.');
      if (!banque.debiter(m.id.uid, total(ajout))) return erreur(rappel, 'Solde insuffisant.', 'Not enough money.');
      for (const a of ajout) m.t.poses.push({ ...a, place: m.s.id });
      diffuser(m.t);
      repondre(rappel, { ok: true });
    };

    socket.on('casino_rl_doubler', async (_data: unknown, rappel?: Rappel) => {
      const m = await pourMiser(rappel);
      if (!m) return;
      const mes = posesDe(m.t, m.s.id);
      if (!mes.length) return erreur(rappel, 'Aucune mise à doubler.', 'No bet to double.');
      poserPlusieurs(m, mes.map((p) => ({ cle: p.cle, montant: p.montant })), rappel);
    });

    socket.on('casino_rl_refaire', async (_data: unknown, rappel?: Rappel) => {
      const m = await pourMiser(rappel);
      if (!m) return;
      const avant = m.t.precedentes.get(m.s.id);
      if (!avant?.length) return erreur(rappel, 'Aucune mise à refaire.', 'No bet to repeat.');
      if (posesDe(m.t, m.s.id).length) return erreur(rappel, 'Tu as déjà misé ce tour.', 'You already bet this spin.');
      poserPlusieurs(m, avant, rappel);
    });

    socket.on('casino_rl_chat', (data: { texte?: unknown } = {}, rappel?: Rappel) => {
      const m = maTable();
      if (!m) return erreur(rappel, 'Tu n’es à aucune table.', 'You are not at a table.');
      const t = horloge();
      if (t - dernierMessage < 800) return erreur(rappel, 'Patiente une seconde.', 'Wait a second.');
      dernierMessage = t;
      const texte = filtrerMessage(String(data?.texte ?? '').trim().slice(0, 120)).texte;
      if (!texte) return repondre(rappel, { ok: true });
      m.t.messages.push({ nom: m.s.nom, texte });
      m.t.messages = m.t.messages.slice(-30);
      diffuser(m.t);
      repondre(rappel, { ok: true });
    });

    socket.on('disconnect', () => {
      const m = maTable();
      if (!m) return;
      m.s.sockets.delete(socket.id);
      liens.delete(socket.id);
      if (!m.s.sockets.size) m.s.absentDepuis = horloge();
      diffuser(m.t);
    });
  }

  /** Les tables ouvertes, pour l'accueil du salon. */
  const resume = (): ResumeTableBJ[] =>
    [...tables.values()].map((t) => ({ code: t.code, joueurs: t.sieges.filter((s) => !s.parti).map((s) => ({ nom: s.nom, avatar: s.avatar, bot: s.bot })), max: PLACES_ROULETTE }));

  /** La table où ce téléphone est assis (pour inviter des amis). */
  const tableDe = (socketId: string) => liens.get(socketId)?.code ?? null;
  const existe = (code: string) => tables.has(code);
  const complete = (code: string) => (tables.get(code)?.sieges.length ?? PLACES_ROULETTE) >= PLACES_ROULETTE;

  /** Un créateur sort du salon : il quitte sa table. */
  const sortir = (socketId: string) => quitter(socketId);

  const fermer = () => {
    clearInterval(menage);
    for (const t of tables.values()) {
      if (t.minuterie) clearTimeout(t.minuterie);
      arreterBots(t);
    }
  };

  return { brancher, resume, sortir, fermer, tableDe, existe, complete };
}
