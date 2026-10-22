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
  DELAI_ROBOT_MS,
  DUREE_TOUR_MS,
  HUMAINS_MIN_POUR_COMPTER,
  MAX_JOUEURS,
  MIN_JOUEURS,
  NB_AVATARS,
  TAILLE_PARTIE_PUBLIQUE,
} from '../shared/config';
import { ajouterAuJournal, appliquerAction, attenteDe, creerPartie } from '../shared/moteur';
import { niveauDepuisXp, resultatsPartie, titreNiveau } from '../shared/niveaux';
import { actionRobot, NIVEAUX_BOT, PRENOMS_BOTS, profilAleatoire, PROFIL_REMPLACANT, STYLES_BOT } from '../shared/robot';
import type {
  Action,
  BilanCompte,
  CompteJoueurVue,
  EnregistrementVue,
  EtatPartie,
  MessageChat,
  ProfilBot,
  ProfilPublic,
  VueSalon,
} from '../shared/types';
import { vuePourJoueur } from '../shared/vue';
import { profilDe, type Identite, type ServiceComptes, type StatsCompte } from './comptes';

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
}

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
}

const LETTRES = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export function demarrerServeur(options: OptionsServeur = {}) {
  const delaiFinDePli = options.delaiFinDePli ?? DELAI_FIN_DE_PLI_MS;
  const delaiRobot = options.delaiRobot ?? DELAI_ROBOT_MS;
  const dureeTour = options.dureeTour ?? DUREE_TOUR_MS;
  const comptes = options.comptes ?? null;
  const attentePublique = options.attentePublique ?? ATTENTE_PARTIE_PUBLIQUE_MS;
  const app = express();
  const http = createServer(app);
  const io = new Server(http, { cors: { origin: '*' } });
  const salons = new Map<string, Salon>();
  const socketsVersJoueur = new Map<string, { code: string; joueurId: string }>();
  let ferme = false;

  app.get('/sante', (_req, res) => {
    res.json({ ok: true, salons: salons.size, comptes: !!comptes });
  });
  // Configuration publique de Firebase pour l'écran de connexion (null : comptes désactivés).
  app.get('/api/config', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ firebase: comptes?.configWeb ?? null, emulateurAuth: comptes?.emulateurAuth ?? null });
  });
  if (options.servirClient !== false) {
    const ici = dirname(fileURLToPath(import.meta.url));
    const dossier = [join(ici, 'client'), join(ici, '../dist/client')].find((d) => existsSync(join(d, 'index.html')));
    if (dossier) {
      app.use(express.static(dossier, { maxAge: '1h' }));
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
    };
    salon.joueurs.push(joueur);
    if (!salon.hoteId) salon.hoteId = joueur.id;
    return joueur;
  }

  /** Ajoute un joueur ordinateur avec un prénom libre. */
  function ajouterBot(salon: Salon, profil: ProfilBot): JoueurSalon {
    const pris = new Set(salon.joueurs.map((j) => j.nom.toLowerCase()));
    const libres = PRENOMS_BOTS.filter((n) => !pris.has(n.toLowerCase()));
    const nom = libres.length ? libres[randomInt(libres.length)] : nomUnique(salon, 'Bot');
    const bot: JoueurSalon = { id: nouvelId(), nom, jeton: nouvelId(), socketId: null, robot: true, bot: profil, avatar: avatarLibre(salon), uid: null, compte: null };
    salon.joueurs.push(bot);
    return bot;
  }

  function supprimerSalon(salon: Salon) {
    if (salon.minuterie) clearTimeout(salon.minuterie);
    if (salon.minuterieTour) clearTimeout(salon.minuterieTour);
    if (salon.depart) clearTimeout(salon.depart.minuterie);
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
    while (salon.joueurs.length < TAILLE_PARTIE_PUBLIQUE) ajouterBot(salon, profilAleatoire());
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
      })),
      partie: salon.partie ? vuePourJoueur(salon.partie, joueurId) : null,
      messages: salon.messages,
      tempsRestant: salon.echeance ? Math.max(0, salon.echeance.fin - Date.now()) : null,
      dureeTour,
      publique: salon.publique,
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
    const r = appliquerAction(salon.partie, action);
    if (!r.ok) return { ok: false, erreur: r.erreur };
    salon.partie = r.etat;
    planifier(salon);
    if (salon.partie.phase === 'FIN_DE_PARTIE' && !salon.enregistrement) enregistrerPartie(salon);
    diffuser(salon);
    return { ok: true };
  }

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
    const resultats = resultatsPartie(
      p.joueurs.map((j) => ({ id: j.id, score: p.scores[j.id] ?? 0 })),
      p.bilans,
    );
    const date = Date.now();
    void Promise.all(
      avecCompte.map(async (j) => {
        const r = resultats.find((x) => x.joueurId === j.id);
        if (!r || !j.uid) return true;
        try {
          const adversaires = p.joueurs.filter((x) => x.id !== j.id).map((x) => x.nom);
          const stats = await comptes.enregistrer(j.uid, j.nom, r, { date, nbJoueurs: p.joueurs.length, adversaires });
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
        salon.partie = ajouterAuJournal(p, `Temps écoulé pour ${nom} : l'ordinateur joue à sa place.`);
      }
      appliquer(salon, action);
    }
  }

  /** Fait avancer la partie toute seule : fin de pli après une pause, coups des robots, minuteur de 30 secondes. */
  function planifier(salon: Salon) {
    if (ferme) return;
    const pTour = salon.partie;
    const cle = pTour ? cleTour(pTour) : null;
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
      salon.minuterie = setTimeout(() => appliquer(salon, { type: 'SUITE' }), delaiFinDePli);
      return;
    }
    const robot = salon.joueurs.find((j) => j.robot && attenteDe(p).includes(j.id));
    if (!robot) return;
    // Les bots prennent un temps de réflexion variable, comme des joueurs humains.
    const delai = robot.bot && p.phase !== 'FIN_DE_NUIT' ? delaiRobot * (0.7 + Math.random() * 1.3) : delaiRobot;
    salon.minuterie = setTimeout(() => {
      if (!salon.partie) return;
      const action = actionRobot(vuePourJoueur(salon.partie, robot.id), Math.random, robot.bot ?? PROFIL_REMPLACANT);
      if (action) appliquer(salon, action);
    }, delai);
  }

  function lancerPartie(salon: Salon) {
    salon.enregistrement = null;
    salon.partie = creerPartie(
      salon.joueurs.map((j) => ({ id: j.id, nom: j.nom })),
      randomInt(1, 2 ** 31),
    );
    planifier(salon);
    diffuser(salon);
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
      if (!c) return repondre(rappel, { ok: false, erreur: 'Tu ne fais partie d’aucun salon.' }), null;
      if (c.salon.publique) return repondre(rappel, { ok: false, erreur: 'Partie publique : elle se lance toute seule.' }), null;
      if (c.salon.hoteId !== c.joueur.id) return repondre(rappel, { ok: false, erreur: "Seul l'hôte peut faire cela." }), null;
      return c;
    };
    socket.emit('en_ligne', resumeEnLigne());
    diffuserEnLigne();

    // Compte connecté sur ce téléphone (vérifié par Firebase), rattaché aux places que le joueur occupe.
    let identite: Identite | null = null;
    let resume: CompteJoueurVue | null = null;
    let derniereIdentification = 0;
    /** Rattache le compte à la place du joueur, sauf si ce compte occupe déjà une autre place du salon. */
    const lierCompte = (salon: Salon, joueur: JoueurSalon) => {
      if (!identite || joueur.uid === identite.uid) return;
      const uid = identite.uid;
      if (salon.joueurs.some((j) => j.id !== joueur.id && j.uid === uid)) return;
      if (salon.partie && joueur.uid) return; // partie en cours : la place garde son compte
      joueur.uid = uid;
      joueur.compte = resume;
    };

    socket.on('creer', (data: { nom?: string; modeTest?: boolean } = {}, rappel?: Rappel) => {
      const nom = nettoyerNom(data?.nom);
      if (!nom) return repondre(rappel, { ok: false, erreur: 'Choisis un pseudo.' });
      quitterSalonActuel();
      const salon = nouveauSalon(false, !!data?.modeTest);
      const joueur = nouveauJoueur(salon, nom);
      lierCompte(salon, joueur);
      attacher(socket, salon, joueur);
      repondre(rappel, { ok: true, code: salon.code, jeton: joueur.jeton, joueurId: joueur.id });
      diffuser(salon);
    });

    socket.on('rejoindre', (data: { code?: string; nom?: string } = {}, rappel?: Rappel) => {
      const salon = salons.get(String(data?.code ?? '').trim().toUpperCase());
      if (!salon) return repondre(rappel, { ok: false, erreur: 'Aucune partie avec ce code.' });
      // Un joueur connecté à son compte retrouve sa place, même depuis un autre téléphone ou en cours de partie.
      const sienne = identite ? salon.joueurs.find((j) => j.uid === identite?.uid) : undefined;
      if (sienne) return reprendrePlace(salon, sienne, rappel);
      if (salon.partie) return repondre(rappel, { ok: false, erreur: 'La partie a déjà commencé.' });
      if (salon.joueurs.length >= MAX_JOUEURS) return repondre(rappel, { ok: false, erreur: `Le salon est complet (${MAX_JOUEURS} joueurs).` });
      const nom = nettoyerNom(data?.nom);
      if (!nom) return repondre(rappel, { ok: false, erreur: 'Choisis un pseudo.' });
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
      if (!nom) return repondre(rappel, { ok: false, erreur: 'Choisis un pseudo.' });
      // Un compte qui a déjà une place dans une partie publique en cours la retrouve.
      if (identite) {
        for (const s of salons.values()) {
          const sienne = s.publique && s.partie && s.partie.phase !== 'FIN_DE_PARTIE' ? s.joueurs.find((j) => j.uid === identite?.uid) : undefined;
          if (sienne) return reprendrePlace(s, sienne, rappel);
        }
      }
      quitterSalonActuel();
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
      ouvertes.sort((a, b) => humains(b).length - humains(a).length);
      let salon = ouvertes[0];
      if (!salon) {
        salon = nouveauSalon(true);
        programmerDepart(salon, attentePublique);
      }
      entrer(salon, nom, rappel);
    });

    socket.on('reprendre', (data: { code?: string; jeton?: string } = {}, rappel?: Rappel) => {
      const salon = salons.get(String(data?.code ?? '').toUpperCase());
      const joueur = salon?.joueurs.find((j) => j.jeton === data?.jeton);
      if (!salon || !joueur) return repondre(rappel, { ok: false, erreur: 'Cette partie n’existe plus.' });
      reprendrePlace(salon, joueur, rappel);
    });

    function reprendrePlace(salon: Salon, joueur: JoueurSalon, rappel: unknown) {
      if (joueur.socketId && joueur.socketId !== socket.id) {
        io.sockets.sockets.get(joueur.socketId)?.disconnect(true);
        socketsVersJoueur.delete(joueur.socketId);
      }
      attacher(socket, salon, joueur);
      if (!joueur.bot) joueur.robot = false;
      salon.sansHumainDepuis = null;
      repondre(rappel, { ok: true, code: salon.code, jeton: joueur.jeton, joueurId: joueur.id });
      planifier(salon);
      diffuser(salon);
    }

    socket.on('identifier', async (data: { jeton?: string } = {}, rappel?: Rappel) => {
      if (!comptes) return repondre(rappel, { ok: false, erreur: 'Les comptes ne sont pas activés sur ce serveur.' });
      const jeton = typeof data?.jeton === 'string' ? data.jeton : '';
      if (!jeton) {
        // Déconnexion du compte : la place d'un salon pas encore lancé redevient « invité ».
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
      if (maintenant - derniereIdentification < 800) return repondre(rappel, { ok: false, erreur: 'Patiente une seconde.' });
      derniereIdentification = maintenant;
      const id = await comptes.verifier(jeton).catch(() => null);
      if (!id) return repondre(rappel, { ok: false, erreur: 'Session expirée : reconnecte-toi à ton compte.' });
      let stats: StatsCompte | null;
      try {
        stats = await comptes.lire(id.uid);
      } catch (e) {
        console.error('Lecture du compte impossible :', e);
        return repondre(rappel, { ok: false, erreur: 'Ton profil est indisponible pour le moment. Tu peux jouer en invité.' });
      }
      identite = id;
      resume = resumeCompte(stats);
      const c = contexte();
      if (c) {
        lierCompte(c.salon, c.joueur);
        diffuser(c.salon);
      }
      repondre(rappel, { ok: true, profil: profilDe(id, stats) });
    });

    socket.on('profil', async (_data: unknown, rappel?: Rappel) => {
      if (!comptes || !identite) return repondre(rappel, { ok: false, erreur: 'Connecte-toi à ton compte.' });
      const id = identite;
      try {
        const stats = await comptes.lire(id.uid);
        resume = resumeCompte(stats);
        repondre(rappel, { ok: true, profil: profilDe(id, stats) });
      } catch (e) {
        console.error('Lecture du compte impossible :', e);
        repondre(rappel, { ok: false, erreur: 'Ton profil est indisponible pour le moment.' });
      }
    });

    socket.on('supprimer_compte', async (_data: unknown, rappel?: Rappel) => {
      if (!comptes || !identite) return repondre(rappel, { ok: false, erreur: 'Connecte-toi à ton compte.' });
      const uid = identite.uid;
      try {
        await comptes.supprimer(uid);
      } catch (e) {
        console.error('Suppression du compte impossible :', e);
        return repondre(rappel, { ok: false, erreur: 'La suppression a échoué, réessaie plus tard.' });
      }
      identite = null;
      resume = null;
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
        if (salon.publique && salon.partie.phase !== 'FIN_DE_PARTIE') {
          joueur.robot = true;
          planifier(salon);
        }
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
      if (c.salon.partie) return repondre(rappel, { ok: false, erreur: 'La partie est déjà lancée.' });
      if (n < MIN_JOUEURS || n > MAX_JOUEURS) return repondre(rappel, { ok: false, erreur: `Il faut entre ${MIN_JOUEURS} et ${MAX_JOUEURS} joueurs.` });
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
      if (salon.partie || salon.joueurs.length >= MAX_JOUEURS) return repondre(rappel, { ok: false, erreur: 'Impossible d’ajouter un joueur ordinateur.' });
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
      if (!c) return repondre(rappel, { ok: false, erreur: 'Tu ne fais partie d’aucun salon.' });
      const j = c.salon.joueurs.find((x) => x.id === data?.joueurId);
      if (!j) return repondre(rappel, { ok: false, erreur: 'Joueur introuvable.' });
      let profil: ProfilPublic;
      if (j.bot) profil = { type: 'bot', nom: j.nom, avatar: j.avatar, niveau: j.bot.niveau, style: j.bot.style };
      else if (!j.uid || !comptes) profil = { type: 'invite', nom: j.nom, avatar: j.avatar };
      else {
        try {
          const stats = await comptes.lire(j.uid);
          profil = {
            type: 'compte',
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
          return repondre(rappel, { ok: false, erreur: 'Profil indisponible pour le moment.' });
        }
      }
      repondre(rappel, { ok: true, profil });
    });

    socket.on('retirer', (data: { joueurId?: string } = {}, rappel?: Rappel) => {
      const c = hote(rappel);
      if (!c) return;
      const { salon } = c;
      if (salon.partie || data?.joueurId === c.joueur.id) return repondre(rappel, { ok: false, erreur: 'Impossible de retirer ce joueur.' });
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
        return repondre(rappel, { ok: false, erreur: 'Seul un joueur déconnecté peut être remplacé.' });
      }
      cible.robot = !!data?.actif;
      planifier(c.salon);
      diffuser(c.salon);
      repondre(rappel, { ok: true });
    });

    socket.on('action', (data: Partial<Action> = {}, rappel?: Rappel) => {
      const c = contexte();
      if (!c) return repondre(rappel, { ok: false, erreur: 'Tu ne fais partie d’aucun salon.' });
      const type = data?.type;
      if (type === 'SUITE') return repondre(rappel, { ok: false, erreur: 'Action réservée au serveur.' });
      if (type === 'FORCER_SUITE' && c.salon.hoteId !== c.joueur.id) return repondre(rappel, { ok: false, erreur: "Seul l'hôte peut passer à la suite." });
      const action = { ...data, joueurId: c.joueur.id } as Action;
      repondre(rappel, appliquer(c.salon, action));
    });

    socket.on('avatar', (data: { avatar?: number } = {}, rappel?: Rappel) => {
      const c = contexte();
      if (!c) return repondre(rappel, { ok: false, erreur: 'Tu ne fais partie d’aucun salon.' });
      const n = Number(data?.avatar);
      if (!Number.isInteger(n) || n < 1 || n > NB_AVATARS) return repondre(rappel, { ok: false, erreur: 'Personnage inconnu.' });
      if (c.salon.joueurs.some((j) => j.id !== c.joueur.id && j.avatar === n)) return repondre(rappel, { ok: false, erreur: 'Ce personnage est déjà pris.' });
      c.joueur.avatar = n;
      diffuser(c.salon);
      repondre(rappel, { ok: true });
    });

    const dernierMessage = new Map<string, number>();
    socket.on('chat', (data: { texte?: string } = {}, rappel?: Rappel) => {
      const c = contexte();
      if (!c) return repondre(rappel, { ok: false, erreur: 'Tu ne fais partie d’aucun salon.' });
      const texte = typeof data?.texte === 'string' ? data.texte.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
      if (!texte) return repondre(rappel, { ok: false, erreur: 'Message vide.' });
      const maintenant = Date.now();
      if (maintenant - (dernierMessage.get(c.joueur.id) ?? 0) < 700) return repondre(rappel, { ok: false, erreur: 'Doucement, un message à la fois.' });
      dernierMessage.set(c.joueur.id, maintenant);
      const { salon } = c;
      salon.compteurMessages += 1;
      salon.messages.push({ n: salon.compteurMessages, auteurId: c.joueur.id, nom: c.joueur.nom, texte, heure: maintenant });
      if (salon.messages.length > 80) salon.messages.splice(0, salon.messages.length - 80);
      diffuser(salon);
      repondre(rappel, { ok: true });
    });

    socket.on('rejouer', (_data: unknown, rappel?: Rappel) => {
      const c = hote(rappel);
      if (!c) return;
      if (c.salon.partie?.phase !== 'FIN_DE_PARTIE') return repondre(rappel, { ok: false, erreur: "La partie n'est pas terminée." });
      lancerPartie(c.salon);
      repondre(rappel, { ok: true });
    });

    socket.on('disconnect', () => {
      detacher(socket.id);
      diffuserEnLigne();
    });
  });

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
