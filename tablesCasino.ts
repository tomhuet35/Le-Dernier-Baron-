/**
 * Tables de blackjack du Salon privé : jusqu'à 5 places (créateurs et bots), une donne après l'autre.
 *
 * Mises (15 s, ou dès que tout le monde a misé) → donne → assurance si le croupier montre un As (8 s) → chaque main
 * joue à son tour (20 s, « rester » par défaut ; les bots suivent la stratégie de base) → croupier → paiements →
 * pause de quelques secondes, puis nouvelles mises. L'argent passe par le porte-monnaie du salon (banque) : la mise
 * est débitée à la donne, le doublement, la séparation et l'assurance au moment où ils sont joués, et les gains
 * crédités à la fin. Les bots ont un argent illimité, jamais enregistré.
 */
import { randomInt } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import {
  actionsPossibles,
  assuranceComplete,
  commencerDonne,
  coutAction,
  etapeCroupier,
  finirAssurance,
  gainPlace,
  jouerBJ,
  mainEnCours,
  MISE_MAX_BJ,
  MISE_MIN_BJ,
  nouveauSabot,
  PLACES_BJ,
  repondreAssurance,
  sabotAMelanger,
  strategieDeBase,
  type ActionBJ,
  type CarteBJ,
  type DonneBJ,
  type ResumeTableBJ,
  type VueTableBJ,
} from '../shared/blackjack';
import { filtrerMessage } from '../shared/moderation';
import { PRENOMS_BOTS } from '../shared/robot';
import type { Identite } from './comptes';

type Reponse = { ok: true; [cle: string]: unknown } | { ok: false; erreur: string };
type Rappel = (r: Reponse) => void;

/** Le porte-monnaie du salon, vu par les tables. */
export interface BanqueCasino {
  solde(uid: string): number;
  debiter(uid: string, montant: number): boolean;
  crediter(uid: string, montant: number): void;
  joueur(uid: string): { nom: string; avatar: number } | null;
}

export interface DelaisTables {
  mises: number;
  decision: number;
  assurance: number;
  bot: number;
  croupier: number;
  pause: number;
  absence: number;
}
const DELAIS: DelaisTables = { mises: 15_000, decision: 20_000, assurance: 8_000, bot: 1_100, croupier: 750, pause: 4_500, absence: 60_000 };

interface Siege {
  id: string;
  uid: string | null;
  nom: string;
  avatar: number;
  bot: boolean;
  sockets: Set<string>;
  mise: number;
  pret: boolean;
  parti: boolean;
  absentDepuis: number | null;
}
interface Table {
  code: string;
  hote: string;
  sieges: Siege[];
  sabot: CarteBJ[];
  donne: DonneBJ | null;
  etape: 'mises' | 'donne' | 'pause';
  fin: number | null;
  duree: number | null;
  minuterie: ReturnType<typeof setTimeout> | null;
  messages: { nom: string; texte: string }[];
  numero: number;
  melange: boolean;
  paye: boolean;
}

const LETTRES = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const MISES_BOTS = [5_000, 10_000, 10_000, 25_000, 25_000, 50_000, 100_000];

export function creerTablesBlackjack(options: { io: Server; banque: BanqueCasino; horloge?: () => number; hasard?: (n: number) => number; delais?: Partial<DelaisTables>; sabot?: () => CarteBJ[] }) {
  const { io, banque } = options;
  const horloge = options.horloge ?? Date.now;
  const hasard = options.hasard ?? ((n: number) => randomInt(n));
  const D = { ...DELAIS, ...options.delais };
  const fabriquerSabot = options.sabot ?? (() => nouveauSabot(hasard));
  const tables = new Map<string, Table>();
  /** Téléphone → table et place. */
  const liens = new Map<string, { code: string; siege: string }>();
  let numeroBot = 0;

  const humains = (t: Table) => t.sieges.filter((s) => !s.bot && !s.parti);
  const present = (s: Siege) => s.bot || (!s.parti && s.sockets.size > 0);

  function vue(t: Table, siegeId: string | null): VueTableBJ {
    const d = t.donne;
    const enCours = d ? mainEnCours(d) : null;
    const moi = t.sieges.find((s) => s.id === siegeId);
    const maPlace = d?.places.find((p) => p.id === siegeId);
    return {
      code: t.code,
      numero: t.numero,
      phase: t.etape === 'mises' || !d ? 'mises' : d.phase,
      reste: t.fin === null ? null : Math.max(0, t.fin - horloge()),
      duree: t.duree,
      places: t.sieges.map((s) => {
        const p = d?.places.find((x) => x.id === s.id);
        return {
          id: s.id,
          nom: s.nom,
          avatar: s.avatar,
          bot: s.bot,
          ...(s.id === siegeId ? { moi: true as const } : {}),
          ...(s.id === t.hote ? { hote: true as const } : {}),
          ...(!present(s) ? { absent: true as const } : {}),
          mise: s.mise,
          pret: s.pret,
          mains: (p?.mains ?? []).map((m) => ({ cartes: m.cartes, mise: m.mise, doublee: m.doublee, issue: m.issue, gain: m.gain })),
          assurance: p?.assurance ?? 0,
          gainTotal: p && d?.phase === 'fin' ? gainPlace(p) : null,
        };
      }),
      croupier: d ? d.croupier.map((c, i) => (i === 1 && !d.revele ? null : c)) : [],
      tour: enCours && d?.tour ? { place: enCours.place.id, main: d.tour.main } : null,
      actions: enCours && enCours.place.id === siegeId && moi && !moi.bot ? actionsPossibles(d!) : [],
      assurance: !!(d?.phase === 'assurance' && maPlace && !maPlace.assuranceRepondue),
      sabot: t.sabot.length,
      melange: t.melange,
      hote: t.hote === siegeId,
      solde: moi?.uid ? banque.solde(moi.uid) : 0,
      messages: t.messages.slice(-30),
    };
  }

  function diffuser(t: Table) {
    for (const s of t.sieges) for (const sid of s.sockets) io.to(sid).emit('casino_bj', vue(t, s.id));
  }

  function planifier(t: Table, ms: number, f: () => void, montrer = true) {
    if (t.minuterie) clearTimeout(t.minuterie);
    t.fin = montrer ? horloge() + ms : null;
    t.duree = montrer ? ms : null;
    t.minuterie = setTimeout(() => {
      t.minuterie = null;
      f();
    }, ms);
  }

  function supprimer(t: Table) {
    if (t.minuterie) clearTimeout(t.minuterie);
    for (const s of t.sieges) for (const sid of s.sockets) liens.delete(sid);
    tables.delete(t.code);
  }

  /** Retire les places parties ou absentes depuis trop longtemps (hors d'une donne). */
  function nettoyer(t: Table) {
    const maintenant = horloge();
    t.sieges = t.sieges.filter((s) => {
      const garde = s.bot || (!s.parti && (s.absentDepuis === null || maintenant - s.absentDepuis < D.absence));
      if (!garde) for (const sid of s.sockets) liens.delete(sid);
      return garde;
    });
    if (!humains(t).length) return supprimer(t), false;
    if (!t.sieges.some((s) => s.id === t.hote)) t.hote = humains(t)[0].id;
    return true;
  }

  function ouvrirMises(t: Table) {
    if (!tables.has(t.code) || !nettoyer(t)) return;
    t.etape = 'mises';
    t.donne = null;
    t.paye = false;
    t.melange = false;
    for (const s of t.sieges) {
      s.pret = s.bot;
      s.mise = s.bot ? MISES_BOTS[hasard(MISES_BOTS.length)] : 0;
    }
    planifier(t, D.mises, () => lancerDonne(t));
    diffuser(t);
  }

  function verifierMises(t: Table) {
    if (t.etape !== 'mises') return;
    const enAttente = t.sieges.filter((s) => !s.bot && present(s));
    if (enAttente.length && enAttente.every((s) => s.pret)) lancerDonne(t);
  }

  function lancerDonne(t: Table) {
    if (!tables.has(t.code) || t.etape !== 'mises') return;
    const mises: { id: string; mise: number }[] = [];
    for (const s of t.sieges) {
      if (s.mise < MISE_MIN_BJ || (!s.bot && (!s.pret || !present(s)))) continue;
      if (s.bot || (s.uid && banque.debiter(s.uid, s.mise))) mises.push({ id: s.id, mise: s.mise });
    }
    if (!mises.length || !mises.some((m) => !t.sieges.find((s) => s.id === m.id)?.bot)) {
      // Personne (de vrai) n'a misé : on attend la prochaine donne.
      for (const m of mises) {
        const s = t.sieges.find((x) => x.id === m.id);
        if (s && !s.bot && s.uid) banque.crediter(s.uid, m.mise);
      }
      return ouvrirMises(t);
    }
    if (!t.sabot.length || sabotAMelanger(t.sabot)) {
      t.sabot = fabriquerSabot();
      t.melange = true;
    }
    t.numero += 1;
    t.etape = 'donne';
    t.donne = commencerDonne(t.sabot, mises);
    suite(t);
  }

  function suite(t: Table) {
    const d = t.donne;
    if (!d || !tables.has(t.code)) return;
    if (d.phase === 'assurance') {
      for (const p of d.places) {
        const s = t.sieges.find((x) => x.id === p.id);
        if (s && !p.assuranceRepondue && (s.bot || !present(s))) repondreAssurance(d, p.id, false);
      }
      if (assuranceComplete(d)) {
        finirAssurance(d);
        return suite(t);
      }
      planifier(t, D.assurance, () => {
        finirAssurance(d);
        suite(t);
      });
      return diffuser(t);
    }
    if (d.phase === 'joueurs') {
      const en = mainEnCours(d)!;
      const s = t.sieges.find((x) => x.id === en.place.id);
      if (!s || s.bot) {
        planifier(
          t,
          D.bot * (0.7 + hasard(60) / 100),
          () => {
            jouerBJ(d, t.sabot, strategieDeBase(en.main, d.croupier[0], actionsPossibles(d)));
            suite(t);
          },
          false,
        );
      } else if (!present(s)) {
        planifier(t, 400, () => {
          jouerBJ(d, t.sabot, 'rester');
          suite(t);
        }, false);
      } else {
        planifier(t, D.decision, () => {
          jouerBJ(d, t.sabot, 'rester');
          suite(t);
        });
      }
      return diffuser(t);
    }
    if (d.phase === 'croupier') {
      planifier(
        t,
        D.croupier,
        () => {
          etapeCroupier(d, t.sabot);
          suite(t);
        },
        false,
      );
      return diffuser(t);
    }
    // Fin de la donne : chacun reçoit ce qui lui revient.
    if (!t.paye) {
      t.paye = true;
      for (const p of d.places) {
        const s = t.sieges.find((x) => x.id === p.id);
        const gain = gainPlace(p);
        if (s && !s.bot && s.uid && gain > 0) banque.crediter(s.uid, gain);
      }
    }
    t.etape = 'pause';
    planifier(t, D.pause, () => ouvrirMises(t), false);
    diffuser(t);
  }

  function nouveauBot(): Siege {
    numeroBot += 1;
    return {
      id: `bot-${numeroBot}`,
      uid: null,
      nom: PRENOMS_BOTS[hasard(PRENOMS_BOTS.length)],
      avatar: 1 + hasard(6),
      bot: true,
      sockets: new Set(),
      mise: 0,
      pret: true,
      parti: false,
      absentDepuis: null,
    };
  }

  function asseoir(t: Table, socket: Socket, id: Identite): Siege {
    let s = t.sieges.find((x) => x.uid === id.uid);
    const infos = banque.joueur(id.uid);
    if (!s) {
      s = { id: `j-${id.uid.slice(0, 8)}-${hasard(1e6)}`, uid: id.uid, nom: infos?.nom || id.nom || '', avatar: infos?.avatar ?? 1, bot: false, sockets: new Set(), mise: 0, pret: false, parti: false, absentDepuis: null };
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
    s.parti = true;
    if (t.etape !== 'donne' || !t.donne?.places.some((p) => p.id === s.id)) {
      if (!nettoyer(t)) return;
    }
    if (t.etape === 'mises') verifierMises(t);
    diffuser(t);
  }

  // Ménage : places absentes depuis plus d'une minute.
  const menage = setInterval(() => {
    for (const t of [...tables.values()]) {
      if (t.etape === 'donne') continue;
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
    const maTable = () => {
      const lien = liens.get(socket.id);
      const t = lien ? tables.get(lien.code) : undefined;
      const s = t?.sieges.find((x) => x.id === lien!.siege);
      return t && s ? { t, s } : null;
    };
    const erreur = (rappel: unknown, fr: string, en: string) => repondre(rappel, { ok: false, erreur: L(fr, en) });
    let dernierMessage = 0;

    socket.on('casino_bj_creer', async (data: { bots?: unknown } = {}, rappel?: Rappel) => {
      const id = await ctx.acces(rappel);
      if (!id) return;
      if (!ctx.enSalon(id.uid)) return repondre(rappel, { ok: false, erreur: 'Introuvable.' });
      if (liens.has(socket.id)) quitter(socket.id);
      let code = '';
      do code = Array.from({ length: 4 }, () => LETTRES[hasard(LETTRES.length)]).join('');
      while (tables.has(code));
      const t: Table = { code, hote: '', sieges: [], sabot: [], donne: null, etape: 'mises', fin: null, duree: null, minuterie: null, messages: [], numero: 0, melange: false, paye: false };
      tables.set(code, t);
      const s = asseoir(t, socket, id);
      t.hote = s.id;
      const nb = Math.max(0, Math.min(PLACES_BJ - 1, Math.floor(Number(data?.bots) || 0)));
      for (let i = 0; i < nb; i++) t.sieges.push(nouveauBot());
      ouvrirMises(t);
      repondre(rappel, { ok: true, table: vue(t, s.id) });
    });

    socket.on('casino_bj_rejoindre', async (data: { code?: unknown } = {}, rappel?: Rappel) => {
      const id = await ctx.acces(rappel);
      if (!id) return;
      if (!ctx.enSalon(id.uid)) return repondre(rappel, { ok: false, erreur: 'Introuvable.' });
      const t = tables.get(String(data?.code ?? '').toUpperCase());
      if (!t) return erreur(rappel, 'Cette table est fermée.', 'This table is closed.');
      const deja = t.sieges.some((s) => s.uid === id.uid);
      if (!deja && t.sieges.length >= PLACES_BJ) return erreur(rappel, 'La table est complète.', 'The table is full.');
      const lien = liens.get(socket.id);
      if (lien && lien.code !== t.code) quitter(socket.id);
      const s = asseoir(t, socket, id);
      diffuser(t);
      repondre(rappel, { ok: true, table: vue(t, s.id) });
    });

    socket.on('casino_bj_quitter', (_data: unknown, rappel?: Rappel) => {
      quitter(socket.id);
      repondre(rappel, { ok: true });
    });

    socket.on('casino_bj_bot', (data: { ajouter?: unknown } = {}, rappel?: Rappel) => {
      const m = maTable();
      if (!m) return erreur(rappel, 'Tu n’es à aucune table.', 'You are not at a table.');
      if (m.t.hote !== m.s.id) return erreur(rappel, 'Seul l’hôte de la table peut faire cela.', 'Only the table host can do that.');
      if (data?.ajouter) {
        if (m.t.sieges.length >= PLACES_BJ) return erreur(rappel, 'La table est complète.', 'The table is full.');
        const b = nouveauBot();
        if (m.t.etape === 'mises') b.mise = MISES_BOTS[hasard(MISES_BOTS.length)];
        m.t.sieges.push(b);
      } else {
        const enJeu = new Set(m.t.etape === 'donne' ? (m.t.donne?.places.map((p) => p.id) ?? []) : []);
        const bot = [...m.t.sieges].reverse().find((s) => s.bot && !enJeu.has(s.id));
        if (!bot) return erreur(rappel, 'Aucun bot à retirer pour le moment.', 'No bot to remove right now.');
        m.t.sieges = m.t.sieges.filter((s) => s !== bot);
      }
      diffuser(m.t);
      repondre(rappel, { ok: true });
    });

    socket.on('casino_bj_miser', async (data: { montant?: unknown } = {}, rappel?: Rappel) => {
      const id = await ctx.acces(rappel);
      if (!id) return;
      const m = maTable();
      if (!m || m.t.etape !== 'mises') return erreur(rappel, 'Les mises sont fermées.', 'Betting is closed.');
      const montant = Number(data?.montant);
      if (montant !== 0 && (!Number.isInteger(montant) || montant < MISE_MIN_BJ || montant > MISE_MAX_BJ || montant % 1000 !== 0))
        return erreur(rappel, 'Mise impossible (de 1 000 à 250 000 $).', 'Invalid bet ($1,000 to $250,000).');
      if (montant > banque.solde(id.uid)) return erreur(rappel, 'Solde insuffisant pour cette mise.', 'Not enough money for this bet.');
      m.s.mise = montant;
      m.s.pret = true;
      diffuser(m.t);
      repondre(rappel, { ok: true });
      verifierMises(m.t);
    });

    socket.on('casino_bj_action', async (data: { type?: unknown } = {}, rappel?: Rappel) => {
      const id = await ctx.acces(rappel);
      if (!id) return;
      const m = maTable();
      const d = m?.t.donne;
      const en = d ? mainEnCours(d) : null;
      if (!m || !d || !en || en.place.id !== m.s.id) return erreur(rappel, 'Ce n’est pas ton tour.', 'It is not your turn.');
      const action = String(data?.type) as ActionBJ;
      if (!actionsPossibles(d).includes(action)) return erreur(rappel, 'Action impossible.', 'Action not allowed.');
      const cout = coutAction(d, action);
      if (cout && !banque.debiter(id.uid, cout)) return erreur(rappel, 'Solde insuffisant.', 'Not enough money.');
      jouerBJ(d, m.t.sabot, action);
      repondre(rappel, { ok: true });
      suite(m.t);
    });

    socket.on('casino_bj_assurance', async (data: { oui?: unknown } = {}, rappel?: Rappel) => {
      const id = await ctx.acces(rappel);
      if (!id) return;
      const m = maTable();
      const d = m?.t.donne;
      const p = d?.places.find((x) => x.id === m?.s.id);
      if (!m || !d || d.phase !== 'assurance' || !p || p.assuranceRepondue) return erreur(rappel, 'Trop tard pour l’assurance.', 'Too late for insurance.');
      const cout = Math.floor(p.mains[0].mise / 2);
      const oui = !!data?.oui && banque.solde(id.uid) >= cout;
      const r = repondreAssurance(d, p.id, oui);
      if (r.cout) banque.debiter(id.uid, r.cout);
      repondre(rappel, { ok: true });
      if (assuranceComplete(d)) {
        finirAssurance(d);
        suite(m.t);
      } else diffuser(m.t);
    });

    socket.on('casino_bj_chat', (data: { texte?: unknown } = {}, rappel?: Rappel) => {
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
      if (m.t.etape === 'mises') verifierMises(m.t);
      diffuser(m.t);
    });
  }

  /** Les tables ouvertes, pour l'accueil du salon. */
  const resume = (): ResumeTableBJ[] =>
    [...tables.values()].map((t) => ({ code: t.code, joueurs: t.sieges.map((s) => ({ nom: s.nom, avatar: s.avatar, bot: s.bot })), max: PLACES_BJ }));

  /** La table où ce téléphone est assis (pour inviter des amis). */
  const tableDe = (socketId: string) => liens.get(socketId)?.code ?? null;
  const existe = (code: string) => tables.has(code);
  const complete = (code: string) => (tables.get(code)?.sieges.length ?? PLACES_BJ) >= PLACES_BJ;

  /** Un créateur sort du salon : il quitte sa table. */
  const sortir = (socketId: string) => quitter(socketId);

  const fermer = () => {
    clearInterval(menage);
    for (const t of tables.values()) if (t.minuterie) clearTimeout(t.minuterie);
  };

  return { brancher, resume, sortir, fermer, tableDe, existe, complete };
}
