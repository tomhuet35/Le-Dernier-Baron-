import express from 'express';
import { randomBytes, randomInt } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server, type Socket } from 'socket.io';
import { DELAI_FIN_DE_PLI_MS, DELAI_ROBOT_MS, MAX_JOUEURS, MIN_JOUEURS } from '../shared/config';
import { appliquerAction, attenteDe, creerPartie } from '../shared/moteur';
import { actionRobot } from '../shared/robot';
import type { Action, EtatPartie, VueSalon } from '../shared/types';
import { vuePourJoueur } from '../shared/vue';

interface JoueurSalon {
  id: string;
  nom: string;
  jeton: string;
  socketId: string | null;
  robot: boolean; // robot de test, ou joueur parti remplacé par l'ordinateur
  robotDeTest: boolean;
}

interface Salon {
  code: string;
  hoteId: string;
  joueurs: JoueurSalon[];
  partie: EtatPartie | null;
  modeTest: boolean;
  derniereActivite: number;
  minuterie: ReturnType<typeof setTimeout> | null;
}

type Reponse = { ok: true; [cle: string]: unknown } | { ok: false; erreur: string };
type Rappel = (r: Reponse) => void;

export interface OptionsServeur {
  port?: number;
  delaiFinDePli?: number;
  delaiRobot?: number;
  servirClient?: boolean;
}

const LETTRES = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export function demarrerServeur(options: OptionsServeur = {}) {
  const delaiFinDePli = options.delaiFinDePli ?? DELAI_FIN_DE_PLI_MS;
  const delaiRobot = options.delaiRobot ?? DELAI_ROBOT_MS;
  const app = express();
  const http = createServer(app);
  const io = new Server(http, { cors: { origin: '*' } });
  const salons = new Map<string, Salon>();
  const socketsVersJoueur = new Map<string, { code: string; joueurId: string }>();

  app.get('/sante', (_req, res) => {
    res.json({ ok: true, salons: salons.size });
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

  function vueSalon(salon: Salon, joueurId: string): VueSalon {
    return {
      code: salon.code,
      moi: joueurId,
      hoteId: salon.hoteId,
      modeTest: salon.modeTest,
      joueurs: salon.joueurs.map((j) => ({ id: j.id, nom: j.nom, connecte: j.robotDeTest || j.socketId !== null, robot: j.robot })),
      partie: salon.partie ? vuePourJoueur(salon.partie, joueurId) : null,
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
    diffuser(salon);
    planifier(salon);
    return { ok: true };
  }

  /** Fait avancer la partie toute seule : fin de pli après une pause, coups des robots. */
  function planifier(salon: Salon) {
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
    salon.partie = creerPartie(
      salon.joueurs.map((j) => ({ id: j.id, nom: j.nom })),
      randomInt(1, 2 ** 31),
    );
    diffuser(salon);
    planifier(salon);
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

    socket.on('creer', (data: { nom?: string; modeTest?: boolean } = {}, rappel?: Rappel) => {
      const nom = nettoyerNom(data?.nom);
      if (!nom) return repondre(rappel, { ok: false, erreur: 'Choisis un pseudo.' });
      const joueur: JoueurSalon = { id: nouvelId(), nom, jeton: nouvelId() + nouvelId(), socketId: null, robot: false, robotDeTest: false };
      const salon: Salon = {
        code: nouveauCode(),
        hoteId: joueur.id,
        joueurs: [joueur],
        partie: null,
        modeTest: !!data?.modeTest,
        derniereActivite: Date.now(),
        minuterie: null,
      };
      salons.set(salon.code, salon);
      attacher(socket, salon, joueur);
      repondre(rappel, { ok: true, code: salon.code, jeton: joueur.jeton, joueurId: joueur.id });
      diffuser(salon);
    });

    socket.on('rejoindre', (data: { code?: string; nom?: string } = {}, rappel?: Rappel) => {
      const salon = salons.get(String(data?.code ?? '').trim().toUpperCase());
      if (!salon) return repondre(rappel, { ok: false, erreur: 'Aucune partie avec ce code.' });
      if (salon.partie) return repondre(rappel, { ok: false, erreur: 'La partie a déjà commencé.' });
      if (salon.joueurs.length >= MAX_JOUEURS) return repondre(rappel, { ok: false, erreur: `Le salon est complet (${MAX_JOUEURS} joueurs).` });
      const nom = nettoyerNom(data?.nom);
      if (!nom) return repondre(rappel, { ok: false, erreur: 'Choisis un pseudo.' });
      const joueur: JoueurSalon = { id: nouvelId(), nom: nomUnique(salon, nom), jeton: nouvelId() + nouvelId(), socketId: null, robot: false, robotDeTest: false };
      salon.joueurs.push(joueur);
      attacher(socket, salon, joueur);
      repondre(rappel, { ok: true, code: salon.code, jeton: joueur.jeton, joueurId: joueur.id });
      diffuser(salon);
    });

    socket.on('reprendre', (data: { code?: string; jeton?: string } = {}, rappel?: Rappel) => {
      const salon = salons.get(String(data?.code ?? '').toUpperCase());
      const joueur = salon?.joueurs.find((j) => j.jeton === data?.jeton);
      if (!salon || !joueur) return repondre(rappel, { ok: false, erreur: 'Cette partie n’existe plus.' });
      if (joueur.socketId && joueur.socketId !== socket.id) {
        io.sockets.sockets.get(joueur.socketId)?.disconnect(true);
        socketsVersJoueur.delete(joueur.socketId);
      }
      attacher(socket, salon, joueur);
      if (!joueur.robotDeTest) joueur.robot = false;
      repondre(rappel, { ok: true, code: salon.code, jeton: joueur.jeton, joueurId: joueur.id });
      diffuser(salon);
      planifier(salon);
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
      salon.joueurs.push({ id: nouvelId(), nom: `Robot ${numero}`, jeton: nouvelId(), socketId: null, robot: true, robotDeTest: true });
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
      diffuser(c.salon);
      planifier(c.salon);
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
            for (const s of salons.values()) if (s.minuterie) clearTimeout(s.minuterie);
            io.close();
            http.close(() => fin());
          }),
      });
    });
  });
}
