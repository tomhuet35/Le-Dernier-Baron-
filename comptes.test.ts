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
import { niveauDepuisXp, progression, resultatsPartie, tapisActif, tapisGagnes, titreNiveau, xpPourNiveau, XP_NUIT, XP_PARTIE, XP_VICTOIRE } from '../shared/niveaux';
import { actionRobot } from '../shared/robot';
import type { BilanNuit, Invitation, ListeAmis, ScoreNuit, VueSalon } from '../shared/types';

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

describe('Tapis à débloquer', () => {
  it('débloque Velours au niveau 5, Prestige au 10, Noir de sang au 15 et Or noir au 20', () => {
    expect(tapisGagnes(4, 5).map((t) => t.id)).toEqual(['velours']);
    expect(tapisGagnes(5, 9)).toEqual([]);
    expect(tapisGagnes(1, 10).map((t) => t.id)).toEqual(['velours', 'prestige']);
    expect(tapisGagnes(14, 16).map((t) => t.id)).toEqual(['noir']);
    expect(tapisGagnes(19, 21).map((t) => t.id)).toEqual(['or-noir']);
  });
  it('ne pose qu’un tapis débloqué, sinon le classique', () => {
    expect(tapisActif('velours', xpPourNiveau(5))).toBe('velours');
    expect(tapisActif('velours', xpPourNiveau(5) - 1)).toBe('baron');
    expect(tapisActif('prestige', xpPourNiveau(9))).toBe('baron');
    expect(tapisActif('prestige', xpPourNiveau(10))).toBe('prestige');
    expect(tapisActif('noir', xpPourNiveau(14))).toBe('baron');
    expect(tapisActif('noir', xpPourNiveau(15))).toBe('noir');
    expect(tapisActif('or-noir', xpPourNiveau(19))).toBe('baron');
    expect(tapisActif('or-noir', xpPourNiveau(20))).toBe('or-noir');
    // Anciens tapis (retirés) : on revient au classique.
    expect(tapisActif('jetons', 99999)).toBe('baron');
    expect(tapisActif('inconnu', 99999)).toBe('baron');
    expect(tapisActif(undefined, 0)).toBe('baron');
    expect(normaliserStats({ tapis: 'tricheur' })?.tapis).toBe('baron');
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
  'jeton-carla': { uid: 'uid-carla', nom: 'Carla', email: 'carla@gmail.com' },
  'jeton-dan': { uid: 'uid-dan', nom: null, email: 'dan.martin@gmail.com' },
  'jeton-eve': { uid: 'uid-eve', nom: 'Ève', email: 'eve@gmail.com' },
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
    await emettre(a, 'ajouter_bot');
    await emettre(a, 'ajouter_bot');
    const fin = jouerJusquALaFin([a]);
    await emettre(a, 'lancer');
    const [vue] = await fin;
    expect(vue.code).toBe(cree.code);
    expect(vue.enregistrement).toEqual({ etat: 'test', bilans: {} });
    expect(stockage.donnees.get('uid-alice')!.parties).toBe(avant);
    a.close();
  });

  it('compte une partie privée à 2 humains et 1 bot, mais pas une partie seul contre l’ordinateur', async () => {
    const [a, b] = [connecter(), connecter()];
    await emettre(a, 'identifier', { jeton: 'jeton-bruno' });
    const avant = stockage.donnees.get('uid-bruno')!.parties;
    const cree = await emettre(a, 'creer', { nom: 'Bruno' });
    await emettre(b, 'rejoindre', { code: cree.code, nom: 'Chloé' });
    await emettre(a, 'ajouter_bot', { niveau: 'debutant' });
    const fin = jouerJusquALaFin([a, b]);
    await emettre(a, 'lancer');
    const [vue] = await fin;
    expect(vue.enregistrement?.etat).toBe('fait');
    expect(stockage.donnees.get('uid-bruno')!.parties).toBe(avant + 1);
    // Fiche publique de Bruno vue par Chloé : statistiques, jamais l'e-mail.
    const fiche = await emettre(b, 'profil_joueur', { joueurId: cree.joueurId });
    expect(fiche.profil).toMatchObject({ type: 'compte', nom: 'Bruno', parties: avant + 1 });
    expect(JSON.stringify(fiche)).not.toContain('@');
    a.close();
    b.close();

    const seul = connecter();
    await emettre(seul, 'identifier', { jeton: 'jeton-bruno' });
    await emettre(seul, 'creer', { nom: 'Bruno' });
    await emettre(seul, 'ajouter_bot');
    await emettre(seul, 'ajouter_bot');
    const finSeul = jouerJusquALaFin([seul]);
    await emettre(seul, 'lancer');
    const [vueSeul] = await finSeul;
    expect(vueSeul.enregistrement).toEqual({ etat: 'solo', bilans: {} });
    expect(stockage.donnees.get('uid-bruno')!.parties).toBe(avant + 1);
    seul.close();
  });

  it('retrouve sa place depuis un autre téléphone grâce à son compte, même en pleine partie', async () => {
    const a = connecter();
    await emettre(a, 'identifier', { jeton: 'jeton-bruno' });
    const cree = await emettre(a, 'creer', { nom: 'Bruno', modeTest: true });
    await emettre(a, 'ajouter_bot');
    await emettre(a, 'ajouter_bot');
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

  it('tapis : refusé tant que le niveau n’est pas atteint, puis posé et gardé sur le compte', async () => {
    const pause = () => new Promise((ok) => setTimeout(ok, 450));
    const e = connecter();
    expect((await emettre(e, 'tapis', { tapis: 'velours' })).ok).toBe(false); // pas connecté
    const id = await emettre(e, 'identifier', { jeton: 'jeton-eve' });
    expect(id.profil.tapis).toBe('baron');
    expect((await emettre(e, 'tapis', { tapis: 'velours' })).ok).toBe(false); // niveau 1
    stockage.donnees.get('uid-eve')!.xp = xpPourNiveau(5);
    await pause();
    const r = await emettre(e, 'tapis', { tapis: 'velours' });
    expect(r).toMatchObject({ ok: true, profil: { tapis: 'velours' } });
    await pause();
    expect((await emettre(e, 'tapis', { tapis: 'prestige' })).ok).toBe(false); // niveau 10 requis
    await pause();
    expect((await emettre(e, 'tapis', { tapis: 'jetons' })).ok).toBe(false); // tapis retiré
    stockage.donnees.get('uid-eve')!.xp = xpPourNiveau(15);
    await pause();
    expect((await emettre(e, 'tapis', { tapis: 'noir' })).profil.tapis).toBe('noir');
    expect(stockage.donnees.get('uid-eve')!.tapis).toBe('noir');
    expect((await emettre(e, 'profil')).profil.tapis).toBe('noir');
    e.close();
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

  it('amis : code ami, demande, acceptation, présence, invitation et retrait', async () => {
    const [c, d] = [connecter(), connecter()];
    const idC = await emettre(c, 'identifier', { jeton: 'jeton-carla' });
    expect(idC.ok).toBe(true);
    await emettre(d, 'identifier', { jeton: 'jeton-dan' });
    const listeC: ListeAmis = (await emettre(c, 'amis')).liste;
    const listeD: ListeAmis = (await emettre(d, 'amis')).liste;
    expect(listeC.monCode).toMatch(/^[A-Z2-9]{6}$/);
    expect(listeD.monCode).not.toBe(listeC.monCode);
    expect(listeC.amis).toEqual([]);

    // Sans compte : impossible.
    const invite = connecter();
    expect((await emettre(invite, 'amis')).ok).toBe(false);
    invite.close();

    // Carla ajoute Dan par son code (en minuscules, avec des espaces : toléré).
    expect((await emettre(c, 'ajouter_ami', { code: 'ZZZZZZ' })).ok).toBe(false);
    expect((await emettre(c, 'ajouter_ami', { code: listeC.monCode })).erreur).toMatch(/propre code/);
    const majD = new Promise<void>((ok) => d.once('amis_maj', () => ok()));
    expect((await emettre(c, 'ajouter_ami', { code: ` ${listeD.monCode.toLowerCase()} ` })).resultat).toBe('envoyee');
    await majD;
    const dApres: ListeAmis = (await emettre(d, 'amis')).liste;
    expect(dApres.recues.map((x) => x.nom)).toEqual(['Carla']);
    expect(JSON.stringify(dApres)).not.toContain('@');
    expect((await emettre(c, 'amis')).liste.envoyees.map((x: { nom: string }) => x.nom)).toEqual(['dan.martin']);

    // Dan accepte : les deux sont amis et se voient en ligne.
    expect((await emettre(d, 'repondre_ami', { code: listeC.monCode, accepter: true })).ok).toBe(true);
    const cAmis: ListeAmis = (await emettre(c, 'amis')).liste;
    expect(cAmis.amis).toMatchObject([{ nom: 'dan.martin', statut: 'en_ligne' }]);
    expect(cAmis.envoyees).toEqual([]);

    // Invitation : il faut une partie privée.
    expect((await emettre(c, 'inviter', { code: listeD.monCode })).ok).toBe(false);
    const cree = await emettre(c, 'creer', { nom: 'Carla' });
    const recue = new Promise<Invitation>((ok) => d.once('invitation', ok));
    expect((await emettre(c, 'inviter', { code: listeD.monCode })).ok).toBe(true);
    const inv = await recue;
    expect(inv).toMatchObject({ de: 'Carla', code: cree.code });
    expect((await emettre(c, 'inviter', { code: listeD.monCode })).ok).toBe(false); // trop rapproché
    const rejoint = await emettre(d, 'rejoindre', { code: inv.code, nom: 'Dan' });
    expect(rejoint.ok).toBe(true);
    // Fiche de Dan vue par Carla dans le salon : « ami ».
    expect((await emettre(c, 'profil_joueur', { joueurId: rejoint.joueurId })).profil.relation).toBe('ami');
    expect((await emettre(c, 'inviter', { code: listeD.monCode })).erreur).toMatch(/déjà dans ta partie/);

    // Dan se déconnecte : Carla est prévenue et le voit hors ligne.
    const horsLigne = new Promise<void>((ok) => c.once('amis_maj', () => ok()));
    d.close();
    await horsLigne;
    expect((await emettre(c, 'amis')).liste.amis[0].statut).toBe('hors_ligne');
    // Sa fiche reste consultable depuis la liste d'amis, même hors ligne.
    const ficheDan = await emettre(c, 'profil_ami', { code: listeD.monCode });
    expect(ficheDan).toMatchObject({ ok: true, profil: { type: 'compte', nom: 'dan.martin', relation: 'ami' } });
    expect(JSON.stringify(ficheDan)).not.toContain('@');

    // Retrait : plus aucun lien des deux côtés.
    expect((await emettre(c, 'retirer_ami', { code: listeD.monCode })).ok).toBe(true);
    expect(stockage.donnees.get('uid-dan')!.amis).toEqual([]);
    expect(stockage.donnees.get('uid-carla')!.amis).toEqual([]);
    // Plus amis : la fiche n'est plus accessible par le code.
    expect((await emettre(c, 'profil_ami', { code: listeD.monCode })).ok).toBe(false);
    c.close();
  });

  it('demandes croisées, ajout depuis la table et suppression de compte', async () => {
    const [c, b] = [connecter(), connecter()];
    await emettre(c, 'identifier', { jeton: 'jeton-carla' });
    await emettre(b, 'identifier', { jeton: 'jeton-bruno' });
    const cree = await emettre(c, 'creer', { nom: 'Carla' });
    const rb = await emettre(b, 'rejoindre', { code: cree.code, nom: 'Bruno' });
    expect((await emettre(c, 'profil_joueur', { joueurId: rb.joueurId })).profil.relation).toBe('aucune');
    expect((await emettre(c, 'profil_joueur', { joueurId: cree.joueurId })).profil.relation).toBe('moi');
    // Carla demande depuis la fiche, Bruno demande aussi : ils deviennent amis directement.
    expect((await emettre(c, 'ajouter_ami_joueur', { joueurId: rb.joueurId })).resultat).toBe('envoyee');
    expect((await emettre(b, 'profil_joueur', { joueurId: cree.joueurId })).profil.relation).toBe('demande_recue');
    expect((await emettre(b, 'ajouter_ami_joueur', { joueurId: cree.joueurId })).resultat).toBe('amis');
    expect(stockage.donnees.get('uid-bruno')!.amis).toContain('uid-carla');
    // Bruno supprime son compte : il disparaît de la liste de Carla.
    expect((await emettre(b, 'supprimer_compte')).ok).toBe(true);
    expect(stockage.donnees.get('uid-carla')!.amis).not.toContain('uid-bruno');
    expect((await emettre(c, 'amis')).liste.amis).toEqual([]);
    c.close();
    b.close();
  });
});
