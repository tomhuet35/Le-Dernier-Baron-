import express from 'express';
import { randomBytes, randomInt } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server, type Socket } from 'socket.io';
import {
  ATTENTE_PARTIE_PUBLIQUE_MS,
  DELAI_FIN_DE_PLI_MS,
  DELAI_REACTION_MS,
  DELAI_REMPLACEMENT_MS,
  DELAI_REVANCHE_MS,
  DELAI_ROBOT_MS,
  DUREE_TOUR_MS,
  HUMAINS_MIN_POUR_COMPTER,
  MAX_JOUEURS,
  MIN_JOUEURS,
  NB_AVATARS,
  REACTIONS,
  SIGNALEMENTS_POUR_COUPER,
  TAILLE_PARTIE_PUBLIQUE,
} from '../shared/config';
import { estLangue, selon, traduireErreurMoteur, type Langue } from '../shared/langue';
import { filtrerMessage, pseudoAcceptable } from '../shared/moderation';
import { CARTE } from '../shared/cartes';
import { ajouterAuJournal, appliquerAction, attenteDe, creerPartie } from '../shared/moteur';
import { estTapis, estWeekendXpDouble, niveauDepuisXp, resultatsPartie, titreNiveau, trancheNiveau } from '../shared/niveaux';
import { actionRobot, NIVEAUX_BOT, PRENOMS_BOTS, profilAleatoire, profilPourTranche, PROFIL_REMPLACANT, STYLES_BOT } from '../shared/robot';
import type {
  Action,
  BilanCompte,
  CompteJoueurVue,
  EnregistrementVue,
  EtatPartie,
  MessageChat,
  Reaction,
  AmiVue,
  Invitation,
  ListeAmis,
  ProfilBot,
  ProfilPublic,
  StatutAmi,
  VueSalon,
} from '../shared/types';
import { vuePourJoueur } from '../shared/vue';
import { profilDe, relationEntre, type Identite, type ResultatDemande, type ServiceComptes, type StatsCompte } from './comptes';
import type { ServiceNotifications } from './notifications';

interface JoueurSalon {
  id: string;
  nom: string;
  jeton: string;
  socketId: string | null;
  robot: boolean; // la place est jouée par l'ordinateur (bot, ou joueur parti remplacé)
  /** Joueur ordinateur : niveau et style. null pour un humain. */
  bot: ProfilBot | null;
  avatar: number;
  /** Compte Firebase du joueur (null pour un invité). */
  uid: string | null;
  compte: CompteJoueurVue | null;
  /** A quitté la partie en cours (ou ne répond plus) : l'ordinateur joue à sa place, la partie ne lui rapporte pas d'XP. */
  abandon: boolean;
}

interface Salon {
  code: string;
  hoteId: string;
  joueurs: JoueurSalon[];
  partie: EtatPartie | null;
  messages: MessageChat[];
  compteurMessages: number;
  modeTest: boolean;
  derniereActivite: number;
  minuterie: ReturnType<typeof setTimeout> | null;
  echeance: { cle: string; fin: number } | null;
  minuterieTour: ReturnType<typeof setTimeout> | null;
  enregistrement: EnregistrementVue | null;
  /** Partie publique : lancement automatique, sans hôte. */
  publique: boolean;
  depart: { fin: number; minuterie: ReturnType<typeof setTimeout> } | null;
  sansHumainDepuis: number | null;
  /** Tutoriel : partie guidée de 3 nuits contre 2 ordinateurs débutants, sans minuteur, jamais comptée. */
  tutoriel: boolean;
  /** Partie publique : tranche de niveau de la table (0 débutants … 3 barons). */
  tranche: number | null;
  /** Vitesse des ordinateurs (partie privée et tutoriel, réglée par l'hôte) : multiplie leur temps de réflexion. */
  vitesse: number;
  /** Fin de partie publique : joueurs qui veulent la revanche. */
  revanche: { votes: Set<string>; fin: number; minuterie: ReturnType<typeof setTimeout> } | null;
  /** Joueurs dont le chat est coupé pour toute la table (après plusieurs signalements). */
  muets: Set<string>;
  /** Signalements reçus par chaque joueur de la table (qui l'a signalé). */
  signalements: Map<string, Set<string>>;
  /** Numéro de la partie jouée dans ce salon (change à chaque nouvelle partie ou revanche). */
  numeroPartie: number;
}

/** Réglage « Vitesse des ordinateurs » : lente, normale ou rapide. */
const VITESSES: Record<string, number> = { lente: 1.8, normale: 1, rapide: 0.55 };
const vitesseDe = (v: unknown) => VITESSES[String(v)] ?? 1;

type Reponse = { ok: true; [cle: string]: unknown } | { ok: false; erreur: string };
type Rappel = (r: Reponse) => void;

export interface OptionsServeur {
  port?: number;
  delaiFinDePli?: number;
  delaiRobot?: number;
  dureeTour?: number;
  /** Attente avant le lancement d'une partie publique (millisecondes). */
  attentePublique?: number;
  servirClient?: boolean;
  /** Comptes joueurs (Firebase) ; sans eux, tout le monde joue en invité. */
  comptes?: ServiceComptes | null;
  /** Week-end XP double (remplaçable pour les tests). */
  xpDouble?: (date: Date) => boolean;
  /** Notifications d'invitation (Web Push), si les comptes sont actifs. */
  notifications?: ServiceNotifications | null;
  /** Adresse de contact affichée sur la page Confidentialité (variable CONTACT_EMAIL). */
  contact?: string | null;
  /** Temps laissé pour accepter la revanche (millisecondes, remplaçable pour les tests). */
  delaiRevanche?: number;
}

const LETTRES = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
/** Donne du tutoriel (choisie pour montrer une carte spéciale, un Chat noir et un événement simple). */
export const GRAINE_TUTORIEL = 40750;

export function demarrerServeur(options: OptionsServeur = {}) {
  const delaiFinDePli = options.delaiFinDePli ?? DELAI_FIN_DE_PLI_MS;
  const delaiRobot = options.delaiRobot ?? DELAI_ROBOT_MS;
  const dureeTour = options.dureeTour ?? DUREE_TOUR_MS;
  const comptes = options.comptes ?? null;
  const notifications = options.notifications ?? null;
  const contact = options.contact ?? null;
  /** Dernière notification envoyée par un joueur à un ami (« uid>uid ») : pas plus d'une toutes les 30 secondes. */
  const dernieresNotifications = new Map<string, number>();
  const attentePublique = options.attentePublique ?? ATTENTE_PARTIE_PUBLIQUE_MS;
  const app = express();
  const http = createServer(app);
  const io = new Server(http, { cors: { origin: '*' } });
  const salons = new Map<string, Salon>();
  const socketsVersJoueur = new Map<string, { code: string; joueurId: string }>();
  // Amis : téléphones connectés par compte, et amis de chaque compte en ligne (pour prévenir de leur présence).
  const socketsParUid = new Map<string, Set<string>>();
  const amisParUid = new Map<string, Set<string>>();
  let ferme = false;

  // Petit « coucou » qui garde le site éveillé (voir index.ts) : répond tout de suite, sans rien calculer.
  app.get('/api/ping', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.type('text/plain').send('ok');
  });
  app.get('/sante', (_req, res) => {
    res.json({ ok: true, salons: salons.size, comptes: !!comptes });
  });
  // Configuration publique de Firebase pour l'écran de connexion (null : comptes désactivés).
  app.get('/api/config', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({
      firebase: comptes?.configWeb ?? null,
      emulateurAuth: comptes?.emulateurAuth ?? null,
      contact: contact && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) ? contact : null,
      vapid: notifications?.clePublique ?? null,
    });
  });
  if (options.servirClient !== false) {
    const ici = dirname(fileURLToPath(import.meta.url));
    const dossier = [join(ici, 'client'), join(ici, '../dist/client')].find((d) => existsSync(join(d, 'index.html')));
    if (dossier) {
      // Fichiers du code (nom unique à chaque version) : gardés un an. Le reste (page, images, musique) est revérifié
      // à chaque visite : une image remplacée sur GitHub s'affiche dès le rechargement de la page.
      app.use(
        express.static(dossier, {
          // /confidentialite ouvre confidentialite.html
          extensions: ['html'],
          setHeaders: (res, chemin) => {
            res.setHeader('Cache-Control', /[\\/]assets[\\/]/.test(chemin) ? 'public, max-age=31536000, immutable' : 'no-cache');
          },
        }),
      );
      app.use((_req, res) => res.sendFile(join(dossier, 'index.html')));
    }
  }

  const nouvelId = () => randomBytes(6).toString('hex');
  const nouveauCode = () => {
    let code = '';
    do code = Array.from({ length: 4 }, () => LETTRES[randomInt(LETTRES.length)]).join('');
    while (salons.has(code));
    return code;
  };
  const nettoyerNom = (nom: unknown) =>
    typeof nom === 'string' ? nom.replace(/\s+/g, ' ').trim().slice(0, 16) : '';
  const nomUnique = (salon: Salon, nom: string) => {
    let candidat = nom;
    for (let i = 2; salon.joueurs.some((j) => j.nom.toLowerCase() === candidat.toLowerCase()); i++) candidat = `${nom} ${i}`;
    return candidat;
  };

  const avatarLibre = (salon: Salon) =>
    Array.from({ length: NB_AVATARS }, (_, i) => i + 1).find((n) => !salon.joueurs.some((j) => j.avatar === n)) ?? 1;
  const humains = (salon: Salon) => salon.joueurs.filter((j) => !j.bot);

  function nouveauSalon(publique: boolean, modeTest = false): Salon {
    const salon: Salon = {
      code: nouveauCode(),
      hoteId: '',
      joueurs: [],
      partie: null,
      modeTest,
      derniereActivite: Date.now(),
      minuterie: null,
      echeance: null,
      minuterieTour: null,
      messages: [],
      compteurMessages: 0,
      enregistrement: null,
      publique,
      depart: null,
      sansHumainDepuis: null,
      tutoriel: false,
      tranche: null,
      vitesse: 1,
      revanche: null,
      muets: new Set(),
      signalements: new Map(),
      numeroPartie: 0,
    };
    salons.set(salon.code, salon);
    return salon;
  }

  function nouveauJoueur(salon: Salon, nom: string): JoueurSalon {
    const joueur: JoueurSalon = {
      id: nouvelId(),
      nom: nomUnique(salon, nom),
      jeton: nouvelId() + nouvelId(),
      socketId: null,
      robot: false,
      bot: null,
      avatar: avatarLibre(salon),
      uid: null,
      compte: null,
      abandon: false,
    };
    salon.joueurs.push(joueur);
    if (!salon.hoteId) salon.hoteId = joueur.id;
    return joueur;
  }

  /** Ajoute un joueur ordinateur avec un prénom libre (ou celui demandé). */
  function ajouterBot(salon: Salon, profil: ProfilBot, prenom?: string): JoueurSalon {
    const pris = new Set(salon.joueurs.map((j) => j.nom.toLowerCase()));
    const libres = PRENOMS_BOTS.filter((n) => !pris.has(n.toLowerCase()));
    const nom = prenom && !pris.has(prenom.toLowerCase()) ? prenom : libres.length ? libres[randomInt(libres.length)] : nomUnique(salon, 'Bot');
    const bot: JoueurSalon = { id: nouvelId(), nom, jeton: nouvelId(), socketId: null, robot: true, bot: profil, avatar: avatarLibre(salon), uid: null, compte: null, abandon: false };
    salon.joueurs.push(bot);
    return bot;
  }

  function supprimerSalon(salon: Salon) {
    if (salon.minuterie) clearTimeout(salon.minuterie);
    if (salon.minuterieTour) clearTimeout(salon.minuterieTour);
    if (salon.depart) clearTimeout(salon.depart.minuterie);
    if (salon.revanche) clearTimeout(salon.revanche.minuterie);
    salons.delete(salon.code);
    diffuserEnLigne();
  }

  /** Partie publique : lancement automatique après l'attente, les places libres sont prises par des bots. */
  function programmerDepart(salon: Salon, delai: number) {
    if (salon.depart) clearTimeout(salon.depart.minuterie);
    const minuterie = setTimeout(() => demarrerPublique(salon), delai);
    salon.depart = { fin: Date.now() + delai, minuterie };
  }

  function demarrerPublique(salon: Salon) {
    if (salon.depart) clearTimeout(salon.depart.minuterie);
    salon.depart = null;
    if (salon.partie || !salons.has(salon.code)) return;
    if (!humains(salon).length) return supprimerSalon(salon);
    while (salon.joueurs.length < TAILLE_PARTIE_PUBLIQUE) ajouterBot(salon, salon.tranche === null ? profilAleatoire() : profilPourTranche(salon.tranche));
    lancerPartie(salon);
    diffuserEnLigne();
  }

  // Nombre de personnes connectées au jeu, affiché sur l'accueil (« joueurs en ligne »).
  let enLigneProgramme = false;
  function diffuserEnLigne() {
    if (enLigneProgramme) return;
    enLigneProgramme = true;
    setTimeout(() => {
      enLigneProgramme = false;
      io.emit('en_ligne', resumeEnLigne());
    }, 1000).unref();
  }
  const resumeEnLigne = () => ({
    joueurs: io.engine.clientsCount,
    enAttente: [...salons.values()].filter((s) => s.publique && !s.partie).reduce((n, s) => n + humains(s).length, 0),
  });

  function vueSalon(salon: Salon, joueurId: string): VueSalon {
    return {
      code: salon.code,
      moi: joueurId,
      hoteId: salon.hoteId,
      modeTest: salon.modeTest,
      joueurs: salon.joueurs.map((j) => ({
        id: j.id,
        nom: j.nom,
        connecte: !!j.bot || j.socketId !== null,
        robot: j.robot,
        bot: j.bot,
        avatar: j.avatar,
        compte: j.compte,
        ...(j.abandon ? { abandon: true } : {}),
      })),
      partie: salon.partie ? vuePourJoueur(salon.partie, joueurId) : null,
      messages: salon.messages,
      revanche: salon.revanche ? { votants: [...salon.revanche.votes], finDans: Math.max(0, salon.revanche.fin - Date.now()) } : null,
      ...(salon.muets.has(joueurId) ? { chatCoupe: true } : {}),
      tempsRestant: salon.echeance ? Math.max(0, salon.echeance.fin - Date.now()) : null,
      dureeTour,
      publique: salon.publique,
      tutoriel: salon.tutoriel,
      tranche: salon.tranche,
      departDans: salon.depart ? Math.max(0, salon.depart.fin - Date.now()) : null,
      comptesActifs: !!comptes,
      enregistrement: salon.enregistrement,
    };
  }

  function diffuser(salon: Salon) {
    salon.derniereActivite = Date.now();
    for (const j of salon.joueurs) if (j.socketId) io.to(j.socketId).emit('salon', vueSalon(salon, j.id));
  }

  function appliquer(salon: Salon, action: Action): Reponse {
    if (!salon.partie) return { ok: false, erreur: "La partie n'a pas commencé." };
    const avant = salon.partie.dernierPli;
    const r = appliquerAction(salon.partie, action);
    if (!r.ok) return { ok: false, erreur: r.erreur };
    salon.partie = r.etat;
    planifier(salon);
    if (salon.partie.phase === 'FIN_DE_PARTIE' && !salon.enregistrement) enregistrerPartie(salon);
    diffuser(salon);
    if (salon.partie.dernierPli && salon.partie.dernierPli !== avant && JSON.stringify(salon.partie.dernierPli) !== JSON.stringify(avant)) reactionsDesBots(salon);
    return { ok: true };
  }

  /** Réaction rapide : envoyée à toute la table (pas gardée dans l'historique). */
  let compteurReactions = 0;
  function envoyerReaction(salon: Salon, joueurId: string, emoji: string) {
    compteurReactions += 1;
    const reaction: Reaction = { n: compteurReactions, joueurId, emoji };
    for (const j of salon.joueurs) if (j.socketId) io.to(j.socketId).emit('reaction', reaction);
  }
  /** De temps en temps, un joueur ordinateur réagit au pli qui vient de se terminer, comme le ferait un humain. */
  function reactionsDesBots(salon: Salon) {
    const pli = salon.partie?.dernierPli;
    if (!pli || salon.tutoriel) return;
    const bot = (id: string) => salon.joueurs.find((j) => j.id === id && j.bot);
    const plus = (id: string, emoji: string, proba: number, delai: number) => {
      if (!bot(id) || Math.random() > proba) return;
      setTimeout(() => salon.partie && envoyerReaction(salon, id, emoji), delai).unref();
    };
    const speciale = (c: { carteId: string }) => CARTE[c.carteId]?.speciale;
    if (pli.braquage) {
      const victime = pli.cartes.find((c) => speciale(c) === 'baron')?.joueurId;
      plus(pli.gagnantId, '😂', 0.7, 500);
      if (victime) plus(victime, Math.random() < 0.5 ? '😱' : '😡', 0.7, 1100);
      return;
    }
    if (pli.cartes.some((c) => speciale(c) === 'baron') && pli.cartes.some((c) => speciale(c) === 'homme_de_main')) plus(pli.gagnantId, '🔥', 0.6, 600);
    else plus(pli.gagnantId, Math.random() < 0.5 ? '🔥' : '👍', 0.12, 700);
  }

  function statutDe(uid: string): StatutAmi {
    if (!socketsParUid.get(uid)?.size) return 'hors_ligne';
    for (const s of salons.values()) {
      if (s.partie && s.partie.phase !== 'FIN_DE_PARTIE' && s.joueurs.some((j) => j.uid === uid && j.socketId)) return 'en_partie';
    }
    return 'en_ligne';
  }

  /** Demande aux téléphones de ces comptes de recharger leur liste d'amis. */
  function prevenirAmis(uids: Iterable<string>) {
    for (const uid of uids) for (const sid of socketsParUid.get(uid) ?? []) io.to(sid).emit('amis_maj');
  }

  function memoriserAmis(stats: Record<string, StatsCompte>) {
    for (const [uid, st] of Object.entries(stats)) if (socketsParUid.has(uid)) amisParUid.set(uid, new Set(st.amis));
  }

  async function listeAmis(uid: string, salon?: Salon): Promise<ListeAmis | null> {
    if (!comptes) return null;
    const moi = await comptes.lire(uid);
    if (!moi) return null;
    const tous = [...new Set([...moi.amis, ...moi.demandesRecues, ...moi.demandesEnvoyees])];
    const lus = await comptes.lirePlusieurs(tous);
    const vue = (u: string): AmiVue | null => {
      const st = lus[u];
      if (!st?.codeAmi) return null;
      const niveau = niveauDepuisXp(st.xp);
      return {
        code: st.codeAmi,
        nom: st.nom || 'Joueur',
        avatar: st.avatar,
        niveau,
        titre: titreNiveau(niveau),
        victoires: st.victoires,
        statut: statutDe(u),
        avecMoi: !!salon?.joueurs.some((j) => j.uid === u),
        notifiable: !!notifications && st.push.length > 0,
      };
    };
    const rang: Record<StatutAmi, number> = { en_ligne: 0, en_partie: 1, hors_ligne: 2 };
    const liste = (uids: string[]) => uids.map(vue).filter((x): x is AmiVue => !!x);
    return {
      monCode: moi.codeAmi ?? '',
      amis: liste(moi.amis).sort((a, b) => rang[a.statut] - rang[b.statut] || a.nom.localeCompare(b.nom)),
      recues: liste(moi.demandesRecues),
      envoyees: liste(moi.demandesEnvoyees),
    };
  }

  const MESSAGE_DEMANDE: Record<ResultatDemande, [string, string]> = {
    envoyee: ['Demande d’ami envoyée.', 'Friend request sent.'],
    amis: ['Vous êtes maintenant amis !', 'You are now friends!'],
    deja_amis: ['Vous êtes déjà amis.', 'You are already friends.'],
    deja_envoyee: ['Demande déjà envoyée : elle attend sa réponse.', 'Request already sent: waiting for an answer.'],
    soi_meme: ['C’est ton propre code !', 'That’s your own code!'],
    limite: ['Trop d’amis ou de demandes en attente.', 'Too many friends or pending requests.'],
  };

  const resumeCompte = (stats: StatsCompte | null): CompteJoueurVue => {
    const niveau = niveauDepuisXp(stats?.xp ?? 0);
    return { niveau, titre: titreNiveau(niveau), victoires: stats?.victoires ?? 0 };
  };

  /** Range les victoires, nuits gagnées et l'expérience de chaque joueur connecté à son compte. */
  function enregistrerPartie(salon: Salon) {
    const p = salon.partie;
    if (!comptes || !p) return;
    if (salon.modeTest) {
      salon.enregistrement = { etat: 'test', bilans: {} };
      return;
    }
    if (humains(salon).length < HUMAINS_MIN_POUR_COMPTER) {
      salon.enregistrement = { etat: 'solo', bilans: {} };
      return;
    }
    const avecCompte = salon.joueurs.filter((j) => j.uid && !j.bot);
    const bilans: Record<string, BilanCompte> = {};
    salon.enregistrement = { etat: avecCompte.length ? 'en_cours' : 'fait', bilans };
    if (!avecCompte.length) return;
    const date = Date.now();
    // Week-end XP double : toute l'expérience de la partie compte deux fois.
    const xpDouble = (options.xpDouble ?? estWeekendXpDouble)(new Date(date));
    const resultats = resultatsPartie(
      p.joueurs.map((j) => ({ id: j.id, score: p.scores[j.id] ?? 0 })),
      p.bilans,
    ).map((r) => (xpDouble ? { ...r, xp: r.xp * 2 } : r));
    void Promise.all(
      avecCompte.map(async (j) => {
        const brut = resultats.find((x) => x.joueurId === j.id);
        if (!brut || !j.uid) return true;
        // Abandon : le joueur est parti (ou ne répondait plus) et l'ordinateur a fini à sa place : pas d'XP.
        const r = j.abandon || j.robot ? { ...brut, victoire: false, nuitsGagnees: 0, annoncesReussies: 0, xp: 0, abandon: true } : brut;
        try {
          const adversaires = p.joueurs.filter((x) => x.id !== j.id).map((x) => x.nom);
          const stats = await comptes.enregistrer(j.uid, j.nom, r, { date, nbJoueurs: p.joueurs.length, adversaires }, j.avatar);
          const niveau = niveauDepuisXp(stats.xp);
          bilans[j.id] = {
            victoire: r.victoire,
            nuitsGagnees: r.nuitsGagnees,
            xpGagne: r.xp,
            niveauAvant: niveauDepuisXp(stats.xp - r.xp),
            niveau,
            titre: titreNiveau(niveau),
            xp: stats.xp,
            victoires: stats.victoires,
            parties: stats.parties,
            ...(xpDouble && !r.abandon ? { xpDouble: true } : {}),
            ...(r.abandon ? { abandon: true } : {}),
          };
          j.compte = resumeCompte(stats);
          return true;
        } catch (e) {
          console.error(`Victoires non enregistrées pour ${j.nom} :`, e);
          return false;
        }
      }),
    )
      .then((reussites) => {
        if (salon.partie !== p) return; // une nouvelle partie a déjà commencé
        salon.enregistrement = { etat: reussites.every(Boolean) ? 'fait' : 'erreur', bilans };
        diffuser(salon);
      })
      .catch((e) => console.error('Enregistrement de la partie impossible :', e));
  }

  /** Identifie le tour en cours : le minuteur repart à zéro quand il change. */
  const PHASES_MINUTEES = ['TRAHISON', 'ANNONCES', 'ALLIANCE', 'PLI', 'VOL', 'FIN_DE_NUIT'];
  function cleTour(p: EtatPartie): string | null {
    if (!PHASES_MINUTEES.includes(p.phase)) return null;
    return [p.nuit, p.phase, p.nbPlisJoues, p.pli.length, p.tour, p.vol?.voleurId ?? ''].join('|');
  }

  /** Temps écoulé : l'ordinateur agit pour chaque joueur encore attendu. */
  function tempsEcoule(salon: Salon, cle: string) {
    const depart = salon.partie;
    if (!depart || cleTour(depart) !== cle) return;
    for (const id of attenteDe(depart)) {
      const p = salon.partie;
      if (!p || cleTour(p) !== cle || !attenteDe(p).includes(id)) continue;
      const action = actionRobot(vuePourJoueur(p, id), Math.random, PROFIL_REMPLACANT);
      if (!action) continue;
      if (p.phase !== 'FIN_DE_NUIT') {
        const nom = salon.joueurs.find((j) => j.id === id)?.nom ?? '?';
        salon.partie = ajouterAuJournal(p, `Temps écoulé pour ${nom} : l'ordinateur joue à sa place.`, `Time’s up for ${nom}: the computer plays instead.`);
      }
      appliquer(salon, action);
    }
  }

  /** Fait avancer la partie toute seule : fin de pli après une pause, coups des robots, minuteur de 30 secondes. */
  function planifier(salon: Salon) {
    if (ferme) return;
    const pTour = salon.partie;
    // Tutoriel : pas de minuteur, le joueur prend le temps de lire les explications.
    const cle = pTour && !salon.tutoriel ? cleTour(pTour) : null;
    if (cle !== (salon.echeance?.cle ?? null)) {
      if (salon.minuterieTour) clearTimeout(salon.minuterieTour);
      salon.minuterieTour = null;
      salon.echeance = cle ? { cle, fin: Date.now() + dureeTour } : null;
      if (cle) salon.minuterieTour = setTimeout(() => tempsEcoule(salon, cle), dureeTour);
    }
    if (salon.minuterie) clearTimeout(salon.minuterie);
    salon.minuterie = null;
    const p = salon.partie;
    if (!p) return;
    if (p.phase === 'FIN_DE_PLI') {
      // En vitesse lente, le pli reste aussi un peu plus longtemps sur le tapis.
      const pause = delaiFinDePli * (salon.tutoriel ? 1.6 : 1) * (salon.vitesse > 1 ? 1.25 : 1);
      salon.minuterie = setTimeout(() => appliquer(salon, { type: 'SUITE' }), pause);
      return;
    }
    const robot = salon.joueurs.find((j) => j.robot && attenteDe(p).includes(j.id));
    if (!robot) return;
    // Les bots prennent un temps de réflexion variable, comme des joueurs humains.
    const reflexion = robot.bot && p.phase !== 'FIN_DE_NUIT' ? delaiRobot * (0.7 + Math.random() * 1.3) * salon.vitesse : delaiRobot;
    const delai = reflexion * (salon.tutoriel ? 1.7 : 1);
    salon.minuterie = setTimeout(() => {
      if (!salon.partie) return;
      const action = actionRobot(vuePourJoueur(salon.partie, robot.id), Math.random, robot.bot ?? PROFIL_REMPLACANT);
      if (action) appliquer(salon, action);
    }, delai);
  }

  function lancerPartie(salon: Salon) {
    salon.enregistrement = null;
    if (salon.revanche) clearTimeout(salon.revanche.minuterie);
    salon.revanche = null;
    salon.numeroPartie += 1;
    const joueurs = salon.joueurs.map((j) => ({ id: j.id, nom: j.nom }));
    // Le tutoriel distribue toujours la même donne : la nuit 1, le joueur ouvre et gagne son premier pli à coup sûr ;
    // la nuit 2 (Casse du siècle), un Chat noir ; la nuit 3, le Baron face à un Homme de main.
    salon.partie = salon.tutoriel
      ? creerPartie(joueurs, GRAINE_TUTORIEL, { nbNuits: 3, nuitsAvecEvenement: [2] })
      : creerPartie(joueurs, randomInt(1, 2 ** 31));
    planifier(salon);
    diffuser(salon);
  }

  /** Revanche : lancée dès que tous les joueurs présents l'ont acceptée. */
  function verifierRevanche(salon: Salon) {
    const r = salon.revanche;
    if (!r) return;
    const presents = salon.joueurs.filter((j) => !j.bot && j.socketId && !j.abandon);
    if (presents.length && presents.every((j) => r.votes.has(j.id))) lancerRevanche(salon);
  }

  /**
   * Revanche d'une partie publique : les mêmes joueurs rejouent à la même table. Les humains qui ne l'ont pas
   * acceptée quittent le salon et un ordinateur prend leur siège ; les ordinateurs de la partie restent.
   */
  function lancerRevanche(salon: Salon) {
    const r = salon.revanche;
    if (!r) return;
    clearTimeout(r.minuterie);
    salon.revanche = null;
    if (!salons.has(salon.code) || salon.partie?.phase !== 'FIN_DE_PARTIE') return;
    if (!salon.joueurs.some((j) => !j.bot && r.votes.has(j.id))) return diffuser(salon);
    const taille = salon.joueurs.length;
    const partants = salon.joueurs.filter((j) => !j.bot && !r.votes.has(j.id));
    for (const j of partants) {
      if (!j.socketId) continue;
      socketsVersJoueur.delete(j.socketId);
      io.to(j.socketId).emit('sorti', { raison: 'revanche' });
    }
    salon.joueurs = salon.joueurs.filter((j) => !partants.includes(j));
    while (salon.joueurs.length < Math.max(taille, MIN_JOUEURS)) {
      ajouterBot(salon, salon.tranche === null ? profilAleatoire() : profilPourTranche(salon.tranche));
    }
    for (const j of salon.joueurs) {
      if (j.bot) continue;
      // Parti entre-temps : l'ordinateur tient sa place jusqu'à son retour.
      j.robot = !j.socketId;
      j.abandon = false;
    }
    salon.sansHumainDepuis = null;
    lancerPartie(salon);
    diffuserEnLigne();
  }

  function attacher(socket: Socket, salon: Salon, joueur: JoueurSalon) {
    const ancien = socketsVersJoueur.get(socket.id);
    if (ancien && (ancien.code !== salon.code || ancien.joueurId !== joueur.id)) detacher(socket.id);
    joueur.socketId = socket.id;
    socketsVersJoueur.set(socket.id, { code: salon.code, joueurId: joueur.id });
  }

  function detacher(socketId: string) {
    const lien = socketsVersJoueur.get(socketId);
    socketsVersJoueur.delete(socketId);
    if (!lien) return;
    const salon = salons.get(lien.code);
    const joueur = salon?.joueurs.find((j) => j.id === lien.joueurId);
    if (!salon || !joueur || joueur.socketId !== socketId) return;
    joueur.socketId = null;
    // En pleine partie, un joueur qui ne revient pas est remplacé par l'ordinateur (la table n'attend pas).
    if (salon.partie && salon.partie.phase !== 'FIN_DE_PARTIE' && !salon.tutoriel && !joueur.bot && !joueur.robot) {
      const numero = salon.numeroPartie;
      setTimeout(() => {
        const p = salon.partie;
        if (joueur.socketId || joueur.robot || !p || salon.numeroPartie !== numero || p.phase === 'FIN_DE_PARTIE' || !salons.has(salon.code)) return;
        joueur.robot = true;
        salon.partie = ajouterAuJournal(p, `${joueur.nom} ne répond plus : l'ordinateur prend sa place.`, `${joueur.nom} is not responding: the computer takes over.`);
        planifier(salon);
        diffuser(salon);
      }, DELAI_REMPLACEMENT_MS).unref();
    }
    verifierRevanche(salon);
    if (salon.hoteId === joueur.id) {
      // Si l'hôte ne revient pas dans les 45 secondes, un autre joueur connecté prend le relais.
      setTimeout(() => {
        if (joueur.socketId || salon.hoteId !== joueur.id) return;
        const relais = salon.joueurs.find((j) => j.socketId && !j.bot);
        if (relais) {
          salon.hoteId = relais.id;
          diffuser(salon);
        }
      }, 45_000).unref();
    }
    diffuser(salon);
  }

  io.on('connection', (socket) => {
    // Langue du téléphone (envoyée à la connexion) : les messages du serveur sont écrits dans cette langue.
    const langue: Langue = estLangue(socket.handshake.auth?.langue) ? socket.handshake.auth.langue : 'fr';
    socket.data.langue = langue;
    const L = (fr: string, en: string) => selon(langue, fr, en);
    const contexte = () => {
      const lien = socketsVersJoueur.get(socket.id);
      const salon = lien ? salons.get(lien.code) : undefined;
      const joueur = salon?.joueurs.find((j) => j.id === lien?.joueurId);
      return salon && joueur ? { salon, joueur } : null;
    };
    const repondre = (rappel: unknown, r: Reponse) => {
      if (typeof rappel === 'function') (rappel as Rappel)(r);
    };
    const hote = (rappel: unknown) => {
      const c = contexte();
      if (!c) return repondre(rappel, { ok: false, erreur: L('Tu ne fais partie d’aucun salon.', 'You are not in any room.') }), null;
      if (c.salon.publique) return repondre(rappel, { ok: false, erreur: L('Partie publique : elle se lance toute seule.', 'Public game: it starts by itself.') }), null;
      if (c.salon.hoteId !== c.joueur.id) return repondre(rappel, { ok: false, erreur: L("Seul l'hôte peut faire cela.", 'Only the host can do that.') }), null;
      return c;
    };
    socket.emit('en_ligne', resumeEnLigne());
    diffuserEnLigne();

    // Compte connecté sur ce téléphone (vérifié par Firebase), rattaché aux places que le joueur occupe.
    let identite: Identite | null = null;
    let resume: CompteJoueurVue | null = null;
    let derniereIdentification = 0;
    let dernierTapis = 0;
    /** Rattache le compte à la place du joueur, sauf si ce compte occupe déjà une autre place du salon. */
    const lierCompte = (salon: Salon, joueur: JoueurSalon) => {
      if (!identite || joueur.uid === identite.uid) return;
      const uid = identite.uid;
      if (salon.joueurs.some((j) => j.id !== joueur.id && j.uid === uid)) return;
      if (salon.partie && joueur.uid) return; // partie en cours : la place garde son compte
      joueur.uid = uid;
      joueur.compte = resume;
    };

    socket.on('creer', (data: { nom?: string; modeTest?: boolean; vitesse?: string } = {}, rappel?: Rappel) => {
      const nom = nettoyerNom(data?.nom);
      if (!nom) return repondre(rappel, { ok: false, erreur: L('Choisis un pseudo.', 'Choose a nickname.') });
      quitterSalonActuel();
      const salon = nouveauSalon(false, !!data?.modeTest);
      salon.vitesse = vitesseDe(data?.vitesse);
      const joueur = nouveauJoueur(salon, nom);
      lierCompte(salon, joueur);
      attacher(socket, salon, joueur);
      repondre(rappel, { ok: true, code: salon.code, jeton: joueur.jeton, joueurId: joueur.id });
      diffuser(salon);
    });

    // Tutoriel : une partie guidée qui démarre tout de suite, seul contre deux ordinateurs débutants.
    socket.on('tutoriel', (data: { nom?: string; vitesse?: string } = {}, rappel?: Rappel) => {
      const nom = nettoyerNom(data?.nom) || L('Joueur', 'Player');
      quitterSalonActuel();
      const salon = nouveauSalon(false, true);
      salon.tutoriel = true;
      salon.vitesse = vitesseDe(data?.vitesse);
      const joueur = nouveauJoueur(salon, nom);
      attacher(socket, salon, joueur);
      ajouterBot(salon, { niveau: 'debutant', style: 'equilibre' }, 'Greg');
      ajouterBot(salon, { niveau: 'debutant', style: 'prudent' }, 'Cyrielle');
      lancerPartie(salon);
      repondre(rappel, { ok: true, code: salon.code, jeton: joueur.jeton, joueurId: joueur.id });
    });

    socket.on('rejoindre', (data: { code?: string; nom?: string } = {}, rappel?: Rappel) => {
      const salon = salons.get(String(data?.code ?? '').trim().toUpperCase());
      if (!salon) return repondre(rappel, { ok: false, erreur: L('Aucune partie avec ce code.', 'No game with this code.') });
      // Un joueur connecté à son compte retrouve sa place, même depuis un autre téléphone ou en cours de partie.
      const sienne = identite ? salon.joueurs.find((j) => j.uid === identite?.uid) : undefined;
      if (sienne) return reprendrePlace(salon, sienne, rappel);
      if (salon.partie) return repondre(rappel, { ok: false, erreur: L('La partie a déjà commencé.', 'The game has already started.') });
      if (salon.joueurs.length >= MAX_JOUEURS) return repondre(rappel, { ok: false, erreur: L(`Le salon est complet (${MAX_JOUEURS} joueurs).`, `The room is full (${MAX_JOUEURS} players).`) });
      const nom = nettoyerNom(data?.nom);
      if (!nom) return repondre(rappel, { ok: false, erreur: L('Choisis un pseudo.', 'Choose a nickname.') });
      entrer(salon, nom, rappel);
    });

    function entrer(salon: Salon, nom: string, rappel: unknown) {
      const c = contexte();
      if (c && c.salon !== salon) quitterSalonActuel();
      const joueur = nouveauJoueur(salon, nom);
      lierCompte(salon, joueur);
      attacher(socket, salon, joueur);
      if (salon.publique && salon.depart) {
        // Laisse au moins 10 secondes au nouveau venu pour choisir son personnage.
        if (salon.depart.fin - Date.now() < 10_000) programmerDepart(salon, 10_000);
        if (humains(salon).length >= TAILLE_PARTIE_PUBLIQUE) demarrerPublique(salon);
      }
      repondre(rappel, { ok: true, code: salon.code, jeton: joueur.jeton, joueurId: joueur.id });
      diffuser(salon);
      diffuserEnLigne();
    }

    /** Partie publique : rejoint une partie qui attend des joueurs, ou en ouvre une nouvelle. */
    socket.on('jouer_public', (data: { nom?: string } = {}, rappel?: Rappel) => {
      const nom = nettoyerNom(data?.nom);
      if (!nom) return repondre(rappel, { ok: false, erreur: L('Choisis un pseudo.', 'Choose a nickname.') });
      // Un compte qui a déjà une place dans une partie publique en cours la retrouve.
      if (identite) {
        for (const s of salons.values()) {
          const sienne =
            s.publique && s.partie && s.partie.phase !== 'FIN_DE_PARTIE' ? s.joueurs.find((j) => j.uid === identite?.uid && !j.abandon) : undefined;
          if (sienne) return reprendrePlace(s, sienne, rappel);
        }
      }
      quitterSalonActuel();
      // Partie publique : pas de pseudo insultant à la table d'inconnus.
      const pseudo = pseudoAcceptable(nom) ? nom : L('Joueur', 'Player');
      const maintenant = Date.now();
      const ouvertes = [...salons.values()].filter(
        (s) =>
          s.publique &&
          !s.partie &&
          s.depart &&
          s.depart.fin - maintenant > 3000 &&
          s.joueurs.length < TAILLE_PARTIE_PUBLIQUE &&
          !(identite && s.joueurs.some((j) => j.uid === identite?.uid)),
      );
      // Tables par niveau : d'abord une table de sa tranche, sinon d'une tranche voisine (jamais un débutant
      // face à des experts) ; à égalité, la plus remplie. Aucune table proche : on ouvre une table de son niveau.
      const tranche = trancheNiveau(resume?.niveau ?? 1);
      const ecart = (s: Salon) => Math.abs((s.tranche ?? tranche) - tranche);
      const proches = ouvertes.filter((s) => ecart(s) <= 1);
      proches.sort((a, b) => ecart(a) - ecart(b) || humains(b).length - humains(a).length);
      let salon = proches[0];
      if (!salon) {
        salon = nouveauSalon(true);
        salon.tranche = tranche;
        programmerDepart(salon, attentePublique);
      }
      entrer(salon, pseudo, rappel);
    });

    socket.on('reprendre', (data: { code?: string; jeton?: string } = {}, rappel?: Rappel) => {
      const salon = salons.get(String(data?.code ?? '').toUpperCase());
      const joueur = salon?.joueurs.find((j) => j.jeton === data?.jeton);
      if (!salon || !joueur) return repondre(rappel, { ok: false, erreur: L('Cette partie n’existe plus.', 'This game no longer exists.') });
      reprendrePlace(salon, joueur, rappel);
    });

    function reprendrePlace(salon: Salon, joueur: JoueurSalon, rappel: unknown) {
      if (joueur.socketId && joueur.socketId !== socket.id) {
        io.sockets.sockets.get(joueur.socketId)?.disconnect(true);
        socketsVersJoueur.delete(joueur.socketId);
      }
      attacher(socket, salon, joueur);
      if (!joueur.bot) {
        joueur.robot = false;
        joueur.abandon = false; // revenu avant la fin : la partie compte normalement
      }
      salon.sansHumainDepuis = null;
      repondre(rappel, { ok: true, code: salon.code, jeton: joueur.jeton, joueurId: joueur.id });
      planifier(salon);
      diffuser(salon);
    }

    socket.on('identifier', async (data: { jeton?: string } = {}, rappel?: Rappel) => {
      if (!comptes) return repondre(rappel, { ok: false, erreur: L('Les comptes ne sont pas activés sur ce serveur.', 'Accounts are not enabled on this server.') });
      const jeton = typeof data?.jeton === 'string' ? data.jeton : '';
      if (!jeton) {
        // Déconnexion du compte : la place d'un salon pas encore lancé redevient « invité ».
        oublierPresence();
        identite = null;
        resume = null;
        const c = contexte();
        if (c && !c.salon.partie && c.joueur.uid) {
          c.joueur.uid = null;
          c.joueur.compte = null;
          diffuser(c.salon);
        }
        return repondre(rappel, { ok: true, profil: null });
      }
      const maintenant = Date.now();
      if (maintenant - derniereIdentification < 800) return repondre(rappel, { ok: false, erreur: L('Patiente une seconde.', 'Wait a second.') });
      derniereIdentification = maintenant;
      const id = await comptes.verifier(jeton).catch(() => null);
      if (!id) return repondre(rappel, { ok: false, erreur: L('Session expirée : reconnecte-toi à ton compte.', 'Session expired: please sign in again.') });
      let stats: StatsCompte | null;
      try {
        stats = await comptes.preparer(id.uid, id.nom, id.email ? id.email.split('@')[0] : '');
      } catch (e) {
        console.error('Lecture du compte impossible :', e);
        return repondre(rappel, { ok: false, erreur: L('Ton profil est indisponible pour le moment. Tu peux jouer en invité.', 'Your profile is unavailable right now. You can play as a guest.') });
      }
      if (identite && identite.uid !== id.uid) oublierPresence();
      identite = id;
      resume = resumeCompte(stats);
      noterPresence(id.uid, stats);
      if (stats.langue !== langue) void comptes.definirLangue(id.uid, langue).catch(() => undefined);
      const c = contexte();
      if (c) {
        lierCompte(c.salon, c.joueur);
        diffuser(c.salon);
      }
      repondre(rappel, { ok: true, profil: profilDe(id, stats) });
    });

    socket.on('profil', async (_data: unknown, rappel?: Rappel) => {
      if (!comptes || !identite) return repondre(rappel, { ok: false, erreur: L('Connecte-toi à ton compte.', 'Sign in to your account.') });
      const id = identite;
      try {
        const stats = await comptes.lire(id.uid);
        resume = resumeCompte(stats);
        repondre(rappel, { ok: true, profil: profilDe(id, stats) });
      } catch (e) {
        console.error('Lecture du compte impossible :', e);
        repondre(rappel, { ok: false, erreur: L('Ton profil est indisponible pour le moment.', 'Your profile is unavailable right now.') });
      }
    });

    // Réglage « Vitesse des ordinateurs » changé en cours de route par l'hôte d'une partie privée (ou dans le tutoriel).
    socket.on('vitesse', (data: { vitesse?: string } = {}, rappel?: Rappel) => {
      const c = contexte();
      if (!c || c.salon.publique || (c.salon.hoteId !== c.joueur.id && !c.salon.tutoriel)) return repondre(rappel, { ok: false, erreur: '' });
      c.salon.vitesse = vitesseDe(data?.vitesse);
      repondre(rappel, { ok: true });
    });

    socket.on('tapis', async (data: { tapis?: unknown } = {}, rappel?: Rappel) => {
      if (!comptes || !identite) return repondre(rappel, { ok: false, erreur: L('Connecte-toi à ton compte.', 'Sign in to your account.') });
      if (!estTapis(data?.tapis)) return repondre(rappel, { ok: false, erreur: L('Tapis inconnu.', 'Unknown felt.') });
      if (Date.now() - dernierTapis < 400) return repondre(rappel, { ok: false, erreur: L('Patiente une seconde.', 'Wait a second.') });
      dernierTapis = Date.now();
      const id = identite;
      try {
        const stats = await comptes.choisirTapis(id.uid, data.tapis);
        if (!stats) return repondre(rappel, { ok: false, erreur: L('Ce tapis se débloque plus tard : continue de jouer pour monter de niveau.', 'This felt unlocks later: keep playing to level up.') });
        resume = resumeCompte(stats);
        repondre(rappel, { ok: true, profil: profilDe(id, stats) });
      } catch (e) {
        console.error('Choix du tapis impossible :', e);
        repondre(rappel, { ok: false, erreur: L('Le tapis n’a pas pu être changé, réessaie plus tard.', 'The felt could not be changed, try again later.') });
      }
    });

    socket.on('supprimer_compte', async (_data: unknown, rappel?: Rappel) => {
      if (!comptes || !identite) return repondre(rappel, { ok: false, erreur: L('Connecte-toi à ton compte.', 'Sign in to your account.') });
      const uid = identite.uid;
      try {
        await comptes.supprimer(uid);
      } catch (e) {
        console.error('Suppression du compte impossible :', e);
        return repondre(rappel, { ok: false, erreur: L('La suppression a échoué, réessaie plus tard.', 'Deletion failed, try again later.') });
      }
      const amisAvant = amisParUid.get(uid) ?? new Set<string>();
      oublierPresence();
      identite = null;
      resume = null;
      prevenirAmis(amisAvant);
      for (const salon of salons.values()) {
        let change = false;
        for (const j of salon.joueurs) {
          if (j.uid === uid) {
            j.uid = null;
            j.compte = null;
            change = true;
          }
        }
        if (change) diffuser(salon);
      }
      repondre(rappel, { ok: true });
    });

    /** Quitte le salon actuel : avant la partie la place est libérée ; pendant une partie publique, l'ordinateur prend le relais. */
    function quitterSalonActuel() {
      const c = contexte();
      if (!c) return;
      const { salon, joueur } = c;
      if (!salon.partie) {
        salon.joueurs = salon.joueurs.filter((j) => j.id !== joueur.id);
        socketsVersJoueur.delete(socket.id);
        if (!humains(salon).length) supprimerSalon(salon);
        else {
          if (salon.hoteId === joueur.id) salon.hoteId = humains(salon)[0].id;
          diffuser(salon);
        }
      } else {
        // Abandon : l'ordinateur finit la partie à sa place, et elle ne lui rapportera pas d'XP.
        if (salon.partie.phase !== 'FIN_DE_PARTIE' && !salon.tutoriel && !joueur.bot) {
          joueur.robot = true;
          joueur.abandon = true;
          salon.partie = ajouterAuJournal(
            salon.partie,
            `${joueur.nom} a quitté la partie : l'ordinateur prend sa place.`,
            `${joueur.nom} left the game: the computer takes over.`,
          );
          planifier(salon);
        }
        salon.revanche?.votes.delete(joueur.id);
        detacher(socket.id);
      }
      diffuserEnLigne();
    }

    socket.on('quitter', (_data: unknown, rappel?: Rappel) => {
      quitterSalonActuel();
      repondre(rappel, { ok: true });
    });

    socket.on('lancer', (_data: unknown, rappel?: Rappel) => {
      const c = hote(rappel);
      if (!c) return;
      const n = c.salon.joueurs.length;
      if (c.salon.partie) return repondre(rappel, { ok: false, erreur: L('La partie est déjà lancée.', 'The game has already started.') });
      if (n < MIN_JOUEURS || n > MAX_JOUEURS) return repondre(rappel, { ok: false, erreur: L(`Il faut entre ${MIN_JOUEURS} et ${MAX_JOUEURS} joueurs.`, `You need between ${MIN_JOUEURS} and ${MAX_JOUEURS} players.`) });
      lancerPartie(c.salon);
      repondre(rappel, { ok: true });
    });

    socket.on('melanger', (_data: unknown, rappel?: Rappel) => {
      const c = hote(rappel);
      if (!c || c.salon.partie) return;
      const t = c.salon.joueurs;
      for (let i = t.length - 1; i > 0; i--) {
        const k = randomInt(i + 1);
        [t[i], t[k]] = [t[k], t[i]];
      }
      diffuser(c.salon);
      repondre(rappel, { ok: true });
    });

    /** Partie privée : l'hôte ajoute un joueur ordinateur (niveau et style au choix, ou au hasard). */
    socket.on('ajouter_bot', (data: { niveau?: string; style?: string } = {}, rappel?: Rappel) => {
      const c = hote(rappel);
      if (!c) return;
      const { salon } = c;
      if (salon.partie || salon.joueurs.length >= MAX_JOUEURS) return repondre(rappel, { ok: false, erreur: L('Impossible d’ajouter un joueur ordinateur.', 'Cannot add a computer player.') });
      const hasard = profilAleatoire();
      const niveau = NIVEAUX_BOT.find((n) => n === data?.niveau) ?? hasard.niveau;
      const style = STYLES_BOT.find((st) => st === data?.style) ?? hasard.style;
      ajouterBot(salon, { niveau, style });
      diffuser(salon);
      repondre(rappel, { ok: true });
    });

    /** Fiche d'un joueur de la table : statistiques de son compte, ou niveau et style d'un bot. */
    socket.on('profil_joueur', async (data: { joueurId?: string } = {}, rappel?: Rappel) => {
      const c = contexte();
      if (!c) return repondre(rappel, { ok: false, erreur: L('Tu ne fais partie d’aucun salon.', 'You are not in any room.') });
      const j = c.salon.joueurs.find((x) => x.id === data?.joueurId);
      if (!j) return repondre(rappel, { ok: false, erreur: L('Joueur introuvable.', 'Player not found.') });
      let profil: ProfilPublic;
      if (j.bot) profil = { type: 'bot', nom: j.nom, avatar: j.avatar, niveau: j.bot.niveau, style: j.bot.style };
      else if (!j.uid || !comptes) profil = { type: 'invite', nom: j.nom, avatar: j.avatar };
      else {
        try {
          const stats = await comptes.lire(j.uid);
          let relation: Extract<ProfilPublic, { type: 'compte' }>['relation'] = null;
          if (identite) relation = identite.uid === j.uid ? 'moi' : relationEntre(await comptes.lire(identite.uid), j.uid);
          profil = {
            type: 'compte',
            relation,
            nom: j.nom,
            avatar: j.avatar,
            xp: stats?.xp ?? 0,
            parties: stats?.parties ?? 0,
            victoires: stats?.victoires ?? 0,
            nuitsGagnees: stats?.nuitsGagnees ?? 0,
            annoncesReussies: stats?.annoncesReussies ?? 0,
            meilleurScore: stats?.meilleurScore ?? null,
            historique: (stats?.historique ?? []).slice(0, 5),
          };
        } catch (e) {
          console.error('Lecture du profil impossible :', e);
          return repondre(rappel, { ok: false, erreur: L('Profil indisponible pour le moment.', 'Profile unavailable right now.') });
        }
      }
      repondre(rappel, { ok: true, profil });
    });

    socket.on('retirer', (data: { joueurId?: string } = {}, rappel?: Rappel) => {
      const c = hote(rappel);
      if (!c) return;
      const { salon } = c;
      if (salon.partie || data?.joueurId === c.joueur.id) return repondre(rappel, { ok: false, erreur: L('Impossible de retirer ce joueur.', 'Cannot remove this player.') });
      const cible = salon.joueurs.find((j) => j.id === data?.joueurId);
      if (cible?.socketId) {
        socketsVersJoueur.delete(cible.socketId);
        io.to(cible.socketId).emit('exclu');
      }
      salon.joueurs = salon.joueurs.filter((j) => j.id !== data?.joueurId);
      diffuser(salon);
      repondre(rappel, { ok: true });
    });

    socket.on('remplacer', (data: { joueurId?: string; actif?: boolean } = {}, rappel?: Rappel) => {
      const c = hote(rappel);
      if (!c) return;
      const cible = c.salon.joueurs.find((j) => j.id === data?.joueurId);
      if (!c.salon.partie || !cible || cible.socketId || cible.bot) {
        return repondre(rappel, { ok: false, erreur: L('Seul un joueur déconnecté peut être remplacé.', 'Only a disconnected player can be replaced.') });
      }
      cible.robot = !!data?.actif;
      planifier(c.salon);
      diffuser(c.salon);
      repondre(rappel, { ok: true });
    });

    socket.on('action', (data: Partial<Action> = {}, rappel?: Rappel) => {
      const c = contexte();
      if (!c) return repondre(rappel, { ok: false, erreur: L('Tu ne fais partie d’aucun salon.', 'You are not in any room.') });
      const type = data?.type;
      if (type === 'SUITE') return repondre(rappel, { ok: false, erreur: L('Action réservée au serveur.', 'Server-only action.') });
      if (type === 'FORCER_SUITE' && c.salon.hoteId !== c.joueur.id) return repondre(rappel, { ok: false, erreur: L("Seul l'hôte peut passer à la suite.", 'Only the host can move on.') });
      const action = { ...data, joueurId: c.joueur.id } as Action;
      const r = appliquer(c.salon, action);
      repondre(rappel, r.ok ? r : { ok: false, erreur: traduireErreurMoteur(r.erreur, langue) });
    });

    socket.on('avatar', (data: { avatar?: number } = {}, rappel?: Rappel) => {
      const c = contexte();
      if (!c) return repondre(rappel, { ok: false, erreur: L('Tu ne fais partie d’aucun salon.', 'You are not in any room.') });
      const n = Number(data?.avatar);
      if (!Number.isInteger(n) || n < 1 || n > NB_AVATARS) return repondre(rappel, { ok: false, erreur: L('Personnage inconnu.', 'Unknown character.') });
      if (c.salon.joueurs.some((j) => j.id !== c.joueur.id && j.avatar === n)) return repondre(rappel, { ok: false, erreur: L('Ce personnage est déjà pris.', 'This character is already taken.') });
      c.joueur.avatar = n;
      diffuser(c.salon);
      repondre(rappel, { ok: true });
    });

    const dernierMessage = new Map<string, number>();
    socket.on('chat', (data: { texte?: string } = {}, rappel?: Rappel) => {
      const c = contexte();
      if (!c) return repondre(rappel, { ok: false, erreur: L('Tu ne fais partie d’aucun salon.', 'You are not in any room.') });
      const brut = typeof data?.texte === 'string' ? data.texte.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
      if (!brut) return repondre(rappel, { ok: false, erreur: L('Message vide.', 'Empty message.') });
      if (c.salon.muets.has(c.joueur.id)) {
        return repondre(rappel, { ok: false, erreur: L('Ton chat est coupé dans cette partie après des signalements.', 'Your chat is muted in this game after reports.') });
      }
      // Partie publique (inconnus) : les insultes sont remplacées par des étoiles.
      const texte = c.salon.publique ? filtrerMessage(brut).texte : brut;
      const maintenant = Date.now();
      if (maintenant - (dernierMessage.get(c.joueur.id) ?? 0) < 700) return repondre(rappel, { ok: false, erreur: L('Doucement, un message à la fois.', 'Easy, one message at a time.') });
      dernierMessage.set(c.joueur.id, maintenant);
      const { salon } = c;
      salon.compteurMessages += 1;
      salon.messages.push({ n: salon.compteurMessages, auteurId: c.joueur.id, nom: c.joueur.nom, texte, heure: maintenant });
      if (salon.messages.length > 80) salon.messages.splice(0, salon.messages.length - 80);
      diffuser(salon);
      repondre(rappel, { ok: true });
    });

    let derniereReaction = 0;
    socket.on('reaction', (data: { emoji?: string } = {}, rappel?: Rappel) => {
      const c = contexte();
      if (!c) return repondre(rappel, { ok: false, erreur: L('Tu ne fais partie d’aucun salon.', 'You are not in any room.') });
      const emoji = REACTIONS.find((e) => e === data?.emoji);
      if (!emoji) return repondre(rappel, { ok: false, erreur: L('Réaction inconnue.', 'Unknown reaction.') });
      const maintenant = Date.now();
      if (maintenant - derniereReaction < DELAI_REACTION_MS) return repondre(rappel, { ok: false, erreur: L('Une réaction à la fois.', 'One reaction at a time.') });
      derniereReaction = maintenant;
      envoyerReaction(c.salon, c.joueur.id, emoji);
      repondre(rappel, { ok: true });
    });

    // Fin de partie publique : « Revanche » avec les mêmes joueurs.
    socket.on('revanche', (data: { veut?: boolean } = {}, rappel?: Rappel) => {
      const c = contexte();
      if (!c) return repondre(rappel, { ok: false, erreur: L('Tu ne fais partie d’aucun salon.', 'You are not in any room.') });
      const { salon, joueur } = c;
      if (!salon.publique || salon.partie?.phase !== 'FIN_DE_PARTIE') {
        return repondre(rappel, { ok: false, erreur: L('La revanche se propose à la fin d’une partie en ligne.', 'A rematch is offered at the end of an online game.') });
      }
      if (data?.veut === false) {
        salon.revanche?.votes.delete(joueur.id);
        diffuser(salon);
        return repondre(rappel, { ok: true });
      }
      if (!salon.revanche) {
        const delai = options.delaiRevanche ?? DELAI_REVANCHE_MS;
        const minuterie = setTimeout(() => lancerRevanche(salon), delai);
        salon.revanche = { votes: new Set(), fin: Date.now() + delai, minuterie };
      }
      salon.revanche.votes.add(joueur.id);
      joueur.abandon = false;
      repondre(rappel, { ok: true });
      verifierRevanche(salon);
      if (salon.revanche) diffuser(salon);
    });

    // Signaler un joueur : enregistré avec ses derniers messages ; à partir de 2 signalements, son chat est coupé pour la table.
    const mesSignalements: number[] = [];
    socket.on('signaler', async (data: { joueurId?: string; motif?: string } = {}, rappel?: Rappel) => {
      const c = contexte();
      if (!c) return repondre(rappel, { ok: false, erreur: L('Tu ne fais partie d’aucun salon.', 'You are not in any room.') });
      const { salon, joueur } = c;
      const cible = salon.joueurs.find((j) => j.id === data?.joueurId);
      if (!cible || cible.bot || cible.id === joueur.id) return repondre(rappel, { ok: false, erreur: L('Ce joueur ne peut pas être signalé.', 'This player cannot be reported.') });
      const maintenant = Date.now();
      while (mesSignalements.length && maintenant - mesSignalements[0] > 10 * 60 * 1000) mesSignalements.shift();
      const deja = salon.signalements.get(cible.id) ?? new Set<string>();
      if (deja.has(joueur.id)) return repondre(rappel, { ok: true, message: L('Tu as déjà signalé ce joueur.', 'You have already reported this player.') });
      if (mesSignalements.length >= 5) return repondre(rappel, { ok: false, erreur: L('Trop de signalements : réessaie plus tard.', 'Too many reports: try again later.') });
      mesSignalements.push(maintenant);
      deja.add(joueur.id);
      salon.signalements.set(cible.id, deja);
      const motif = ['insultes', 'pseudo', 'triche', 'autre'].includes(String(data?.motif)) ? String(data?.motif) : 'autre';
      const messages = salon.messages.filter((m) => m.auteurId === cible.id).slice(-10).map((m) => ({ texte: m.texte, heure: m.heure }));
      const signalement = {
        date: maintenant,
        salon: salon.code,
        publique: salon.publique,
        motif,
        signaleur: { nom: joueur.nom, uid: joueur.uid },
        signale: { nom: cible.nom, uid: cible.uid },
        messages,
      };
      if (comptes) await comptes.signaler(signalement).catch((e) => console.error('Signalement non enregistré :', e));
      else console.log('Signalement :', JSON.stringify(signalement));
      const autresHumains = humains(salon).filter((j) => j.id !== cible.id).length;
      if (deja.size >= Math.min(SIGNALEMENTS_POUR_COUPER, autresHumains) && !salon.muets.has(cible.id)) {
        salon.muets.add(cible.id);
        salon.messages = salon.messages.filter((m) => m.auteurId !== cible.id);
        if (salon.partie) {
          salon.partie = ajouterAuJournal(salon.partie, `Le chat de ${cible.nom} est coupé après des signalements.`, `${cible.nom}’s chat has been muted after reports.`);
        }
        diffuser(salon);
      }
      repondre(rappel, { ok: true, message: L('Signalement enregistré. Merci !', 'Report recorded. Thank you!') });
    });

    socket.on('rejouer', (_data: unknown, rappel?: Rappel) => {
      const c = hote(rappel);
      if (!c) return;
      if (c.salon.partie?.phase !== 'FIN_DE_PARTIE') return repondre(rappel, { ok: false, erreur: L("La partie n'est pas terminée.", 'The game is not over.') });
      lancerPartie(c.salon);
      repondre(rappel, { ok: true });
    });

    socket.on('disconnect', () => {
      oublierPresence();
      detacher(socket.id);
      diffuserEnLigne();
    });

    // ---------- Amis ----------
    function noterPresence(uid: string, stats: StatsCompte) {
      let set = socketsParUid.get(uid);
      const premier = !set?.size;
      if (!set) socketsParUid.set(uid, (set = new Set()));
      set.add(socket.id);
      amisParUid.set(uid, new Set(stats.amis));
      if (premier) prevenirAmis(stats.amis);
    }
    function oublierPresence() {
      if (!identite) return;
      const uid = identite.uid;
      const set = socketsParUid.get(uid);
      if (!set?.delete(socket.id) || set.size) return;
      socketsParUid.delete(uid);
      const amis = amisParUid.get(uid) ?? new Set<string>();
      amisParUid.delete(uid);
      prevenirAmis(amis);
    }
    const avecCompte = (rappel: unknown) => {
      if (!comptes || !identite) {
        repondre(rappel, { ok: false, erreur: L('Connecte-toi à ton compte pour gérer tes amis.', 'Sign in to your account to manage your friends.') });
        return null;
      }
      return { comptes, uid: identite.uid };
    };
    const codeValide = (code: unknown) => (typeof code === 'string' ? code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) : '');
    async function uidDuCode(code: unknown, rappel: unknown): Promise<string | null> {
      const c = codeValide(code);
      const uid = c && comptes ? await comptes.chercherCode(c).catch(() => null) : null;
      if (!uid) repondre(rappel, { ok: false, erreur: L('Aucun joueur avec ce code ami.', 'No player with this friend code.') });
      return uid;
    }
    let derniereDemande = 0;
    async function demander(vers: string, rappel: unknown) {
      const a = avecCompte(rappel);
      if (!a) return;
      if (vers === a.uid) return repondre(rappel, { ok: false, erreur: L(...MESSAGE_DEMANDE.soi_meme) });
      const maintenant = Date.now();
      if (maintenant - derniereDemande < 300) return repondre(rappel, { ok: false, erreur: L('Patiente une seconde.', 'Wait a second.') });
      derniereDemande = maintenant;
      try {
        const { resultat, stats } = await a.comptes.demanderAmi(a.uid, vers);
        memoriserAmis(stats);
        if (resultat === 'envoyee' || resultat === 'amis') prevenirAmis([a.uid, vers]);
        const ok = resultat === 'envoyee' || resultat === 'amis' || resultat === 'deja_amis' || resultat === 'deja_envoyee';
        repondre(rappel, ok ? { ok: true, resultat, message: L(...MESSAGE_DEMANDE[resultat]) } : { ok: false, erreur: L(...MESSAGE_DEMANDE[resultat]) });
      } catch (e) {
        console.error('Demande d’ami impossible :', e);
        repondre(rappel, { ok: false, erreur: L('La demande n’a pas pu être envoyée, réessaie.', 'The request could not be sent, try again.') });
      }
    }

    socket.on('amis', async (_data: unknown, rappel?: Rappel) => {
      const a = avecCompte(rappel);
      if (!a) return;
      try {
        repondre(rappel, { ok: true, liste: await listeAmis(a.uid, contexte()?.salon) });
      } catch (e) {
        console.error('Liste d’amis indisponible :', e);
        repondre(rappel, { ok: false, erreur: L('Liste d’amis indisponible pour le moment.', 'Friends list unavailable right now.') });
      }
    });

    // Fiche d'un ami (ou d'une demande en cours), même s'il est hors ligne.
    socket.on('profil_ami', async (data: { code?: string } = {}, rappel?: Rappel) => {
      const a = avecCompte(rappel);
      if (!a) return;
      const autre = await uidDuCode(data?.code, rappel);
      if (!autre) return;
      try {
        const [moi, stats] = await Promise.all([a.comptes.lire(a.uid), a.comptes.lire(autre)]);
        const relation = autre === a.uid ? 'moi' : relationEntre(moi, autre);
        if (relation === 'aucune' || !stats) return repondre(rappel, { ok: false, erreur: L('Ce joueur ne fait pas partie de tes amis.', 'This player is not one of your friends.') });
        const profil: ProfilPublic = {
          type: 'compte',
          relation,
          nom: stats.nom || 'Joueur',
          avatar: stats.avatar,
          xp: stats.xp,
          parties: stats.parties,
          victoires: stats.victoires,
          nuitsGagnees: stats.nuitsGagnees,
          annoncesReussies: stats.annoncesReussies,
          meilleurScore: stats.meilleurScore,
          historique: stats.historique.slice(0, 5),
        };
        repondre(rappel, { ok: true, profil });
      } catch (e) {
        console.error('Lecture du profil impossible :', e);
        repondre(rappel, { ok: false, erreur: L('Profil indisponible pour le moment.', 'Profile unavailable right now.') });
      }
    });

    socket.on('ajouter_ami', async (data: { code?: string } = {}, rappel?: Rappel) => {
      if (!avecCompte(rappel)) return;
      const vers = await uidDuCode(data?.code, rappel);
      if (vers) await demander(vers, rappel);
    });

    socket.on('ajouter_ami_joueur', async (data: { joueurId?: string } = {}, rappel?: Rappel) => {
      if (!avecCompte(rappel)) return;
      const j = contexte()?.salon.joueurs.find((x) => x.id === data?.joueurId);
      if (!j?.uid) return repondre(rappel, { ok: false, erreur: L('Ce joueur n’a pas de compte.', 'This player has no account.') });
      await demander(j.uid, rappel);
    });

    socket.on('repondre_ami', async (data: { code?: string; accepter?: boolean } = {}, rappel?: Rappel) => {
      const a = avecCompte(rappel);
      if (!a) return;
      const autre = await uidDuCode(data?.code, rappel);
      if (!autre) return;
      try {
        memoriserAmis(await a.comptes.repondreAmi(a.uid, autre, !!data?.accepter));
        prevenirAmis([a.uid, autre]);
        repondre(rappel, { ok: true, message: data?.accepter ? L('Vous êtes maintenant amis !', 'You are now friends!') : L('Demande refusée.', 'Request declined.') });
      } catch (e) {
        console.error('Réponse impossible :', e);
        repondre(rappel, { ok: false, erreur: L('Réessaie dans un instant.', 'Try again in a moment.') });
      }
    });

    socket.on('retirer_ami', async (data: { code?: string } = {}, rappel?: Rappel) => {
      const a = avecCompte(rappel);
      if (!a) return;
      const autre = await uidDuCode(data?.code, rappel);
      if (!autre) return;
      try {
        memoriserAmis(await a.comptes.retirerLien(a.uid, autre));
        prevenirAmis([a.uid, autre]);
        repondre(rappel, { ok: true });
      } catch (e) {
        console.error('Retrait impossible :', e);
        repondre(rappel, { ok: false, erreur: L('Réessaie dans un instant.', 'Try again in a moment.') });
      }
    });

    // Jeu visible ou en arrière-plan sur ce téléphone : décide si une invitation part aussi en notification.
    socket.data.visible = true;
    socket.on('visibilite', (data: { visible?: unknown } = {}) => {
      socket.data.visible = data?.visible !== false;
    });

    // Notifications d'invitation : ce téléphone s'abonne (ou se désabonne) pour le compte connecté.
    socket.on('push_abonner', async (data: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } = {}, rappel?: Rappel) => {
      if (!notifications) return repondre(rappel, { ok: false, erreur: L('Les notifications ne sont pas disponibles sur ce serveur.', 'Notifications are not available on this server.') });
      const a = avecCompte(rappel);
      if (!a) return;
      const endpoint = typeof data?.endpoint === 'string' ? data.endpoint : '';
      const p256dh = typeof data?.keys?.p256dh === 'string' ? data.keys.p256dh : '';
      const auth = typeof data?.keys?.auth === 'string' ? data.keys.auth : '';
      const valide = /^https:\/\/[^\s]+$/.test(endpoint) && endpoint.length <= 1000 && /^[A-Za-z0-9_=-]{20,200}$/.test(p256dh) && /^[A-Za-z0-9_=-]{8,100}$/.test(auth);
      if (!valide) return repondre(rappel, { ok: false, erreur: L('Abonnement aux notifications invalide.', 'Invalid notification subscription.') });
      try {
        await a.comptes.abonnerPush(a.uid, { endpoint, p256dh, auth });
        repondre(rappel, { ok: true });
      } catch (e) {
        console.error('Abonnement aux notifications impossible :', e);
        repondre(rappel, { ok: false, erreur: L('Réessaie dans un instant.', 'Try again in a moment.') });
      }
    });
    socket.on('push_desabonner', async (data: { endpoint?: unknown } = {}, rappel?: Rappel) => {
      if (!comptes || !identite || typeof data?.endpoint !== 'string') return repondre(rappel, { ok: true });
      await comptes.retirerPush(identite.uid, [data.endpoint]).catch(() => undefined);
      repondre(rappel, { ok: true });
    });

    /** Invite un ami en ligne (ou joignable par notification) à rejoindre sa partie privée. */
    const dernieresInvitations = new Map<string, number>();
    socket.on('inviter', async (data: { code?: string } = {}, rappel?: Rappel) => {
      const a = avecCompte(rappel);
      if (!a) return;
      const c = contexte();
      if (!c || c.salon.publique || c.salon.partie) return repondre(rappel, { ok: false, erreur: L('Crée d’abord une partie privée pour inviter tes amis.', 'Create a private game first to invite your friends.') });
      const ami = await uidDuCode(data?.code, rappel);
      if (!ami) return;
      if (!(amisParUid.get(a.uid)?.has(ami) ?? (await a.comptes.lire(a.uid))?.amis.includes(ami))) {
        return repondre(rappel, { ok: false, erreur: L('Ce joueur n’est pas dans tes amis.', 'This player is not in your friends.') });
      }
      if (c.salon.joueurs.some((j) => j.uid === ami)) return repondre(rappel, { ok: false, erreur: L('Cet ami est déjà dans ta partie.', 'This friend is already in your game.') });
      if (c.salon.joueurs.length >= MAX_JOUEURS) return repondre(rappel, { ok: false, erreur: L('La partie est complète.', 'The game is full.') });
      const sockets = socketsParUid.get(ami) ?? new Set<string>();
      // Jeu ouvert et visible sur un appareil de l'ami : l'invitation s'affiche dans le jeu.
      // Jeu fermé ou en arrière-plan : une notification part aussi, si l'ami les a activées.
      const visible = [...sockets].some((sid) => io.sockets.sockets.get(sid)?.data.visible !== false);
      const statsAmi = !visible && notifications ? await a.comptes.lire(ami) : null;
      const notifiable = !visible && !!notifications && !!statsAmi?.push.length;
      if (!sockets.size && !notifiable) {
        return repondre(rappel, { ok: false, erreur: L('Cet ami n’est pas en ligne et n’a pas activé les notifications : envoie-lui le lien du salon.', 'This friend is offline and has not enabled notifications: send them the room link.') });
      }
      const maintenant = Date.now();
      if (maintenant - (dernieresInvitations.get(ami) ?? 0) < 5000) return repondre(rappel, { ok: false, erreur: L('Invitation déjà envoyée, patiente un peu.', 'Invitation already sent, wait a little.') });
      dernieresInvitations.set(ami, maintenant);
      const invitation: Invitation = { id: nouvelId(), de: c.joueur.nom, code: c.salon.code, heure: maintenant };
      for (const sid of sockets) io.to(sid).emit('invitation', invitation);
      if (notifiable && notifications) {
        const cle = `${a.uid}>${ami}`;
        if (maintenant - (dernieresNotifications.get(cle) ?? 0) < 30_000) {
          return repondre(rappel, { ok: false, erreur: L('Notification déjà envoyée : laisse-lui le temps de répondre.', 'Notification already sent: give them time to answer.') });
        }
        dernieresNotifications.set(cle, maintenant);
        const recue = await notifications
          .envoyer(ami, {
            // Écrite dans la langue de l'ami (celle de son jeu).
            titre: selon(statsAmi?.langue ?? 'fr', 'Invitation au Dernier Baron', 'Invitation to Le Dernier Baron'),
            texte: selon(statsAmi?.langue ?? 'fr', `${c.joueur.nom} t’invite à sa table. Touche pour la rejoindre.`, `${c.joueur.nom} invites you to their table. Tap to join.`),
            url: `/?salon=${c.salon.code}`,
            etiquette: `invitation-${c.salon.code}`,
            invitation,
          })
          .catch(() => false);
        if (!recue && !sockets.size) return repondre(rappel, { ok: false, erreur: L('La notification n’a pas pu partir : envoie-lui le lien du salon.', 'The notification could not be sent: send them the room link.') });
        return repondre(rappel, { ok: true, message: sockets.size ? L('Invitation envoyée !', 'Invitation sent!') : L('Invitation envoyée par notification !', 'Invitation sent by notification!') });
      }
      repondre(rappel, { ok: true, message: L('Invitation envoyée !', 'Invitation sent!') });
    });
  });

  // Signalements de plus de 6 mois : supprimés au démarrage, puis chaque jour.
  const purger = () => void comptes?.purgerSignalements().catch((e) => console.error('Ménage des signalements impossible :', e));
  if (comptes) purger();
  const purgeQuotidienne = setInterval(purger, 24 * 60 * 60 * 1000);
  purgeQuotidienne.unref();

  // Ménage : salons privés abandonnés depuis 3 heures, parties publiques sans aucun humain connecté depuis 2 minutes.
  const menage = setInterval(() => {
    const maintenant = Date.now();
    for (const s of [...salons.values()]) {
      const humainConnecte = s.joueurs.some((j) => j.socketId);
      if (s.publique && s.partie) {
        if (humainConnecte) s.sansHumainDepuis = null;
        else if (s.sansHumainDepuis === null) s.sansHumainDepuis = maintenant;
        else if (maintenant - s.sansHumainDepuis > 2 * 60 * 1000) supprimerSalon(s);
      } else if (s.derniereActivite < maintenant - 3 * 60 * 60 * 1000 && !humainConnecte) supprimerSalon(s);
    }
  }, 30 * 1000);

  return new Promise<{ port: number; fermer: () => Promise<void> }>((resolve) => {
    http.listen(options.port ?? 3000, () => {
      const port = (http.address() as AddressInfo).port;
      resolve({
        port,
        fermer: () =>
          new Promise<void>((fin) => {
            ferme = true;
            clearInterval(menage);
            clearInterval(purgeQuotidienne);
            for (const s of salons.values()) {
              if (s.minuterie) clearTimeout(s.minuterie);
              if (s.minuterieTour) clearTimeout(s.minuterieTour);
              if (s.depart) clearTimeout(s.depart.minuterie);
            }
            io.close();
            http.close(() => fin());
          }),
      });
    });
  });
}
