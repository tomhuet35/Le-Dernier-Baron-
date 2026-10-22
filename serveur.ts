import express from 'express';
import { randomBytes, randomInt } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server, type Socket } from 'socket.io';
import { DELAI_FIN_DE_PLI_MS, DELAI_ROBOT_MS, DUREE_TOUR_MS, MAX_JOUEURS, MIN_JOUEURS, NB_AVATARS } from '../shared/config';
import { ajouterAuJournal, appliquerAction, attenteDe, creerPartie } from '../shared/moteur';
import { niveauDepuisXp, resultatsPartie, titreNiveau } from '../shared/niveaux';
import { actionRobot } from '../shared/robot';
import type { Action, BilanCompte, CompteJoueurVue, EnregistrementVue, EtatPartie, MessageChat, VueSalon } from '../shared/types';
import { vuePourJoueur } from '../shared/vue';
import { profilDe, type Identite, type ServiceComptes, type StatsCompte } from './comptes';

interface JoueurSalon {
  id: string;
  nom: string;
  jeton: string;
  socketId: string | null;
  robot: boolean; // robot de test, ou joueur parti remplacé par l'ordinateur
  robotDeTest: boolean;
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
}

type Reponse = { ok: true; [cle: string]: unknown } | { ok: false; erreur: string };
type Rappel = (r: Reponse) => void;

export interface OptionsServeur {
  port?: number;
  delaiFinDePli?: number;
  delaiRobot?: number;
  dureeTour?: number;
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
  const app = express();
  const http = createServer(app);
  const io = new Server(http, { cors: { origin: '*' } });
  const salons = new Map<string, Salon>();
  const socketsVersJoueur = new Map<string, { code: string; joueurId: string }>();

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

  function vueSalon(salon: Salon, joueurId: string): VueSalon {
    return {
      code: salon.code,
      moi: joueurId,
      hoteId: salon.hoteId,
      modeTest: salon.modeTest,
      joueurs: salon.joueurs.map((j) => ({
        id: j.id,
        nom: j.nom,
        connecte: j.robotDeTest || j.socketId !== null,
        robot: j.robot,
        avatar: j.avatar,
        compte: j.compte,
      })),
      partie: salon.partie ? vuePourJoueur(salon.partie, joueurId) : null,
      messages: salon.messages,
      tempsRestant: salon.echeance ? Math.max(0, salon.echeance.fin - Date.now()) : null,
      dureeTour,
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
    const avecCompte = salon.joueurs.filter((j) => j.uid && !j.robotDeTest);
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
      const action = actionRobot(vuePourJoueur(p, id));
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
    salon.minuterie = setTimeout(() => {
      if (!salon.partie) return;
      const action = actionRobot(vuePourJoueur(salon.partie, robot.id));
      if (action) appliquer(salon, action);
    }, delaiRobot);
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
        const relais = salon.joueurs.find((j) => j.socketId && !j.robotDeTest);
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
      if (c.salon.hoteId !== c.joueur.id) return repondre(rappel, { ok: false, erreur: "Seul l'hôte peut faire cela." }), null;
      return c;
    };

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
      const joueur: JoueurSalon = { id: nouvelId(), nom, jeton: nouvelId() + nouvelId(), socketId: null, robot: false, robotDeTest: false, avatar: 1, uid: null, compte: null };
      const salon: Salon = {
        code: nouveauCode(),
        hoteId: joueur.id,
        joueurs: [joueur],
        partie: null,
        modeTest: !!data?.modeTest,
        derniereActivite: Date.now(),
        minuterie: null,
        echeance: null,
        minuterieTour: null,
        messages: [],
        compteurMessages: 0,
        enregistrement: null,
      };
      salons.set(salon.code, salon);
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
      const joueur: JoueurSalon = {
        id: nouvelId(),
        nom: nomUnique(salon, nom),
        jeton: nouvelId() + nouvelId(),
        socketId: null,
        robot: false,
        robotDeTest: false,
        avatar: avatarLibre(salon),
        uid: null,
        compte: null,
      };
      salon.joueurs.push(joueur);
      lierCompte(salon, joueur);
      attacher(socket, salon, joueur);
      repondre(rappel, { ok: true, code: salon.code, jeton: joueur.jeton, joueurId: joueur.id });
      diffuser(salon);
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
      if (!joueur.robotDeTest) joueur.robot = false;
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

    socket.on('quitter', (_data: unknown, rappel?: Rappel) => {
      const c = contexte();
      if (!c) return repondre(rappel, { ok: true });
      const { salon, joueur } = c;
      if (!salon.partie) {
        salon.joueurs = salon.joueurs.filter((j) => j.id !== joueur.id);
        socketsVersJoueur.delete(socket.id);
        if (!salon.joueurs.some((j) => !j.robotDeTest)) salons.delete(salon.code);
        else {
          if (salon.hoteId === joueur.id) salon.hoteId = salon.joueurs.find((j) => !j.robotDeTest)!.id;
          diffuser(salon);
        }
      } else detacher(socket.id);
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

    socket.on('ajouter_robot', (_data: unknown, rappel?: Rappel) => {
      const c = hote(rappel);
      if (!c) return;
      const { salon } = c;
      if (!salon.modeTest) return repondre(rappel, { ok: false, erreur: 'Les robots ne sont disponibles qu’en mode test.' });
      if (salon.partie || salon.joueurs.length >= MAX_JOUEURS) return repondre(rappel, { ok: false, erreur: 'Impossible d’ajouter un robot.' });
      const numero = salon.joueurs.filter((j) => j.robotDeTest).length + 1;
      salon.joueurs.push({
        id: nouvelId(),
        nom: `Robot ${numero}`,
        jeton: nouvelId(),
        socketId: null,
        robot: true,
        robotDeTest: true,
        avatar: avatarLibre(salon),
        uid: null,
        compte: null,
      });
      diffuser(salon);
      repondre(rappel, { ok: true });
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
      if (!c.salon.partie || !cible || cible.socketId || cible.robotDeTest) {
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

    socket.on('disconnect', () => detacher(socket.id));
  });

  // Supprime les salons abandonnés depuis plus de 3 heures.
  const menage = setInterval(() => {
    const limite = Date.now() - 3 * 60 * 60 * 1000;
    for (const [code, s] of salons) {
      if (s.derniereActivite < limite && !s.joueurs.some((j) => j.socketId)) {
        if (s.minuterie) clearTimeout(s.minuterie);
        if (s.minuterieTour) clearTimeout(s.minuterieTour);
        salons.delete(code);
      }
    }
  }, 10 * 60 * 1000);

  return new Promise<{ port: number; fermer: () => Promise<void> }>((resolve) => {
    http.listen(options.port ?? 3000, () => {
      const port = (http.address() as AddressInfo).port;
      resolve({
        port,
        fermer: () =>
          new Promise<void>((fin) => {
            clearInterval(menage);
            for (const s of salons.values()) {
              if (s.minuterie) clearTimeout(s.minuterie);
              if (s.minuterieTour) clearTimeout(s.minuterieTour);
            }
            io.close();
            http.close(() => fin());
          }),
      });
    });
  });
}
