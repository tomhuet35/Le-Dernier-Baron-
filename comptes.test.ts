import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  appliquerResultat,
  authentificationTest,
  creerServiceComptes,
  lireCompteService,
  lireConfigWeb,
  normaliserStats,
  stockageMemoire,
  TAILLE_HISTORIQUE,
} from '../server/comptes';
import { demarrerServeur } from '../server/serveur';
import { niveauDepuisXp, progression, resultatsPartie, titreNiveau, xpPourNiveau, XP_NUIT, XP_PARTIE, XP_VICTOIRE } from '../shared/niveaux';
import { actionRobot } from '../shared/robot';
import type { BilanNuit, ScoreNuit, VueSalon } from '../shared/types';

const score = (joueurId: string, total: number, reussie = total > 0): ScoreNuit => ({
  joueurId,
  annonce: 1,
  plis: reussie ? 1 : 0,
  reussie,
  pointsAnnonce: total,
  pointsButin: 0,
  bonus: 0,
  total,
});
const nuit = (n: number, scores: ScoreNuit[]): BilanNuit => ({ nuit: n, evenement: null, scores });

describe('Niveaux', () => {
  it('chaque palier demande 50 XP de plus que le précédent', () => {
    expect([1, 2, 3, 4, 5, 10].map(xpPourNiveau)).toEqual([0, 100, 250, 450, 700, 2700]);
    expect(niveauDepuisXp(0)).toBe(1);
    expect(niveauDepuisXp(99)).toBe(1);
    expect(niveauDepuisXp(100)).toBe(2);
    expect(niveauDepuisXp(449)).toBe(3);
    expect(niveauDepuisXp(450)).toBe(4);
    expect(niveauDepuisXp(100_000)).toBeGreaterThan(10);
  });

  it('donne un titre à chaque niveau et reste Baron au-delà du 10', () => {
    expect(titreNiveau(1)).toBe('Petite frappe');
    expect(titreNiveau(10)).toBe('Baron');
    expect(titreNiveau(25)).toBe('Baron');
  });

  it('mesure l’avancement vers le niveau suivant', () => {
    expect(progression(175)).toMatchObject({ niveau: 2, xpDansNiveau: 75, xpPalier: 150, fraction: 0.5 });
  });
});

describe('Résultats de partie', () => {
  it('compte victoires (ex æquo compris), nuits gagnées, annonces réussies et XP', () => {
    const joueurs = [
      { id: 'a', score: 80 },
      { id: 'b', score: 80 },
      { id: 'c', score: 30 },
    ];
    const bilans = [
      nuit(1, [score('a', 10), score('b', 10), score('c', -10)]), // a et b gagnent la nuit
      nuit(2, [score('a', -10), score('b', -20), score('c', -10)]), // personne : meilleur total négatif
      nuit(3, [score('a', 30), score('b', 20), score('c', 0, true)]), // a seul
    ];
    const r = Object.fromEntries(resultatsPartie(joueurs, bilans).map((x) => [x.joueurId, x]));
    expect(r.a).toMatchObject({ rang: 1, victoire: true, nuitsGagnees: 2, annoncesReussies: 2, xp: XP_PARTIE + XP_VICTOIRE + 2 * XP_NUIT });
    expect(r.b).toMatchObject({ rang: 1, victoire: true, nuitsGagnees: 1, xp: XP_PARTIE + XP_VICTOIRE + XP_NUIT });
    expect(r.c).toMatchObject({ rang: 3, victoire: false, nuitsGagnees: 0, annoncesReussies: 1, xp: XP_PARTIE });
  });

  it('ajoute la partie au compte et garde les 20 dernières', () => {
    const r = { joueurId: 'a', rang: 1, score: 75, victoire: true, nuitsGagnees: 3, annoncesReussies: 5, xp: 170 };
    let stats = appliquerResultat(null, 'Lucas', r, { date: 1, nbJoueurs: 4, adversaires: ['B', 'C', 'D'] });
    expect(stats).toMatchObject({ nom: 'Lucas', parties: 1, victoires: 1, nuitsGagnees: 3, annoncesReussies: 5, meilleurScore: 75, xp: 170 });
    for (let i = 2; i <= 25; i++) {
      stats = appliquerResultat(stats, 'Lucas', { ...r, victoire: false, score: i, xp: 10, nuitsGagnees: 0 }, { date: i, nbJoueurs: 3, adversaires: [] });
    }
    expect(stats.parties).toBe(25);
    expect(stats.victoires).toBe(1);
    expect(stats.meilleurScore).toBe(75);
    expect(stats.historique).toHaveLength(TAILLE_HISTORIQUE);
    expect(stats.historique[0].date).toBe(25);
  });

  it('relit sans planter un document incomplet', () => {
    expect(normaliserStats({ victoires: 3, historique: [{ rang: 2 }, null] })).toMatchObject({ victoires: 3, parties: 0, xp: 0, historique: [{ rang: 2, adversaires: [] }] });
    expect(normaliserStats(undefined)).toBeNull();
  });
});

describe('Configuration Firebase', () => {
  it('lit le bloc copié depuis la console Firebase', () => {
    const bloc = `// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaTest",
  authDomain: "baron-123.firebaseapp.com",
  projectId: "baron-123",
  storageBucket: "baron-123.firebasestorage.app",
  messagingSenderId: "42",
  appId: "1:42:web:abc"
};`;
    expect(lireConfigWeb(bloc)).toEqual({ apiKey: 'AIzaTest', authDomain: 'baron-123.firebaseapp.com', projectId: 'baron-123', appId: '1:42:web:abc' });
    expect(lireConfigWeb('{"apiKey":"k","projectId":"p"}')).toEqual({ apiKey: 'k', authDomain: 'p.firebaseapp.com', projectId: 'p' });
    expect(lireConfigWeb('n’importe quoi')).toBeNull();
    expect(lireConfigWeb(undefined)).toBeNull();
  });

  it('trouve la clé du compte de service dans un fichier secret, quel que soit son nom', () => {
    const dossier = mkdtempSync(join(tmpdir(), 'secrets-'));
    writeFileSync(join(dossier, 'autre.json'), '{"a":1}');
    const cle = { type: 'service_account', project_id: 'baron-123', client_email: 'x@baron-123.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n' };
    writeFileSync(join(dossier, 'baron-123-firebase-adminsdk.json'), JSON.stringify(cle, null, 2));
    const sa = lireCompteService({}, [join(dossier, 'absent'), dossier]);
    expect(sa?.project_id).toBe('baron-123');
    expect(sa?.private_key).toContain('\nabc\n');
    expect(lireCompteService({ FIREBASE_SERVICE_ACCOUNT: Buffer.from(JSON.stringify(cle)).toString('base64') }, [])?.client_email).toContain('baron-123');
    expect(lireCompteService({}, [mkdtempSync(join(tmpdir(), 'vide-'))])).toBeNull();
  });
});

// ---------- De bout en bout avec de faux comptes ----------

const identites = {
  'jeton-alice': { uid: 'uid-alice', nom: 'Alice', email: 'alice@gmail.com' },
  'jeton-bruno': { uid: 'uid-bruno', nom: 'Bruno', email: 'bruno@exemple.fr' },
};
const stockage = stockageMemoire();
const authentification = authentificationTest(identites);
const service = creerServiceComptes({ configWeb: { apiKey: 'cle', authDomain: 'test.firebaseapp.com', projectId: 'test' }, authentification, stockage });
let serveur: Awaited<ReturnType<typeof demarrerServeur>>;
const url = () => `http://localhost:${serveur.port}`;
const connecter = () => io(url(), { transports: ['websocket'], forceNew: true });
function emettre(s: Socket, evt: string, data?: unknown): Promise<any> {
  return new Promise((ok) => s.emit(evt, data, ok));
}

beforeAll(async () => {
  serveur = await demarrerServeur({ port: 0, delaiFinDePli: 5, delaiRobot: 5, servirClient: false, comptes: service });
});
afterAll(async () => {
  await serveur.fermer();
});

/** Fait jouer automatiquement des téléphones jusqu'à la fin de partie et à l'enregistrement des victoires. */
function jouerJusquALaFin(sockets: Socket[]) {
  const dernieres: (VueSalon | null)[] = sockets.map(() => null);
  return Promise.all(
    sockets.map(
      (s, i) =>
        new Promise<VueSalon>((termine) => {
          let enCours = false;
          const agir = async () => {
            if (enCours) return;
            enCours = true;
            for (let k = 0; k < 20; k++) {
              const p = dernieres[i]?.partie;
              const action = p && p.phase !== 'FIN_DE_PARTIE' ? actionRobot(p) : null;
              if (!action) break;
              const r = await emettre(s, 'action', action);
              if (!r.ok && dernieres[i]?.partie === p) break;
            }
            enCours = false;
          };
          s.on('salon', (v: VueSalon) => {
            dernieres[i] = v;
            if (v.partie?.phase === 'FIN_DE_PARTIE') {
              if (v.enregistrement && v.enregistrement.etat !== 'en_cours') termine(v);
              return;
            }
            if (v.partie) void agir();
          });
        }),
    ),
  );
}

describe('Comptes de bout en bout', () => {
  it('publie la configuration web et refuse un jeton inconnu', async () => {
    const config = await fetch(`${url()}/api/config`).then((r) => r.json());
    expect(config.firebase.projectId).toBe('test');
    const s = connecter();
    expect((await emettre(s, 'identifier', { jeton: 'faux' })).ok).toBe(false);
    expect((await emettre(s, 'profil')).ok).toBe(false);
    s.close();
  });

  it('enregistre victoires, nuits gagnées et niveaux des joueurs connectés, pas ceux des invités', async () => {
    const [a, b, c] = [connecter(), connecter(), connecter()];
    const idA = await emettre(a, 'identifier', { jeton: 'jeton-alice' });
    expect(idA).toMatchObject({ ok: true, profil: { nom: 'Alice', email: 'alice@gmail.com', parties: 0, xp: 0 } });
    const cree = await emettre(a, 'creer', { nom: 'Alice' });
    const rejointB = await emettre(b, 'rejoindre', { code: cree.code, nom: 'Bruno' });
    // Bruno se connecte une fois dans le salon : son compte est rattaché à sa place.
    expect((await emettre(b, 'identifier', { jeton: 'jeton-bruno' })).ok).toBe(true);
    await emettre(c, 'rejoindre', { code: cree.code, nom: 'Chloé' });
    const fin = jouerJusquALaFin([a, b, c]);
    expect((await emettre(a, 'lancer')).ok).toBe(true);
    const [vue] = await fin;

    expect(vue.enregistrement?.etat).toBe('fait');
    const p = vue.partie!;
    const attendus = Object.fromEntries(resultatsPartie(p.joueurs.map((j) => ({ id: j.id, score: j.score })), p.bilans).map((r) => [r.joueurId, r]));
    const bilans = vue.enregistrement!.bilans;
    expect(Object.keys(bilans).sort()).toEqual([cree.joueurId, rejointB.joueurId].sort());
    for (const [joueurId, uid] of [
      [cree.joueurId, 'uid-alice'],
      [rejointB.joueurId, 'uid-bruno'],
    ]) {
      const r = attendus[joueurId];
      const stats = stockage.donnees.get(uid)!;
      expect(stats).toMatchObject({ parties: 1, victoires: r.victoire ? 1 : 0, nuitsGagnees: r.nuitsGagnees, xp: r.xp });
      expect(bilans[joueurId]).toMatchObject({ victoire: r.victoire, xpGagne: r.xp, victoires: r.victoire ? 1 : 0, niveau: niveauDepuisXp(r.xp) });
      expect(vue.joueurs.find((j) => j.id === joueurId)?.compte).toMatchObject({ victoires: r.victoire ? 1 : 0, niveau: niveauDepuisXp(r.xp) });
    }
    expect(vue.joueurs.find((j) => j.nom === 'Chloé')?.compte).toBeNull();

    // Le profil d'Alice contient la partie dans son historique.
    const profil = await emettre(a, 'profil');
    expect(profil.profil.historique).toHaveLength(1);
    expect(profil.profil.historique[0]).toMatchObject({ nbJoueurs: 3, adversaires: ['Bruno', 'Chloé'] });
    [a, b, c].forEach((s) => s.close());
  });

  it('ne compte jamais une partie de test avec des robots', async () => {
    const avant = stockage.donnees.get('uid-alice')!.parties;
    const a = connecter();
    await emettre(a, 'identifier', { jeton: 'jeton-alice' });
    const cree = await emettre(a, 'creer', { nom: 'Alice', modeTest: true });
    await emettre(a, 'ajouter_robot');
    await emettre(a, 'ajouter_robot');
    const fin = jouerJusquALaFin([a]);
    await emettre(a, 'lancer');
    const [vue] = await fin;
    expect(vue.code).toBe(cree.code);
    expect(vue.enregistrement).toEqual({ etat: 'test', bilans: {} });
    expect(stockage.donnees.get('uid-alice')!.parties).toBe(avant);
    a.close();
  });

  it('retrouve sa place depuis un autre téléphone grâce à son compte, même en pleine partie', async () => {
    const a = connecter();
    await emettre(a, 'identifier', { jeton: 'jeton-bruno' });
    const cree = await emettre(a, 'creer', { nom: 'Bruno', modeTest: true });
    await emettre(a, 'ajouter_robot');
    await emettre(a, 'ajouter_robot');
    await emettre(a, 'lancer');
    const autre = connecter();
    // Sans compte : la partie a commencé, impossible d'entrer.
    expect((await emettre(autre, 'rejoindre', { code: cree.code, nom: 'Intrus' })).ok).toBe(false);
    await emettre(autre, 'identifier', { jeton: 'jeton-bruno' });
    const retour = await emettre(autre, 'rejoindre', { code: cree.code, nom: 'Bruno' });
    expect(retour).toMatchObject({ ok: true, joueurId: cree.joueurId, jeton: cree.jeton });
    a.close();
    autre.close();
  });

  it('supprime le compte et ses statistiques à la demande du joueur', async () => {
    const a = connecter();
    await emettre(a, 'identifier', { jeton: 'jeton-alice' });
    expect(stockage.donnees.has('uid-alice')).toBe(true);
    expect((await emettre(a, 'supprimer_compte')).ok).toBe(true);
    expect(stockage.donnees.has('uid-alice')).toBe(false);
    expect(authentification.supprimes).toContain('uid-alice');
    expect((await emettre(a, 'profil')).ok).toBe(false);
    a.close();
  });
});
