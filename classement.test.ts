import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creerClassement, semaineDe, stockageClassementMemoire } from '../server/classement';
import { authentificationTest, creerServiceComptes, stockageMemoire } from '../server/comptes';
import { demarrerServeur } from '../server/serveur';
import { RECOMPENSES_SEMAINE, xpRecompenseSemaine } from '../shared/niveaux';
import { actionRobot } from '../shared/robot';
import type { ListeAmis, VueClassement, VueSalon } from '../shared/types';

const iso = (t: number) => new Date(t).toISOString();
const JOUR = 86_400_000;

describe('Semaines du classement (heure de Paris)', () => {
  it('va du lundi 0 h au lundi suivant 0 h, heure de Paris', () => {
    const s = semaineDe(Date.parse('2026-11-05T12:00:00Z')); // jeudi
    expect(s.cle).toBe('2026-S45');
    expect(iso(s.debut)).toBe('2026-11-01T23:00:00.000Z'); // lundi 2 novembre 0 h à Paris (heure d'hiver)
    expect(iso(s.fin)).toBe('2026-11-08T23:00:00.000Z');
    expect(semaineDe(Date.parse('2026-11-08T22:59:59Z')).cle).toBe('2026-S45'); // dimanche 23 h 59 à Paris
    expect(semaineDe(Date.parse('2026-11-08T23:00:00Z')).cle).toBe('2026-S46'); // lundi 0 h à Paris
  });
  it('tient compte du changement d’heure et du passage à l’année suivante', () => {
    const ete = semaineDe(Date.parse('2026-10-21T10:00:00Z'));
    expect(ete.cle).toBe('2026-S43');
    expect(iso(ete.debut)).toBe('2026-10-18T22:00:00.000Z'); // lundi 0 h, heure d'été
    expect(iso(ete.fin)).toBe('2026-10-25T23:00:00.000Z'); // lundi suivant 0 h, heure d'hiver
    expect(semaineDe(Date.parse('2027-01-01T12:00:00Z')).cle).toBe('2026-S53');
    expect(semaineDe(Date.parse('2027-01-04T12:00:00Z')).cle).toBe('2027-S01');
  });
});

describe('Classement de la semaine', () => {
  it('garde le meilleur score de chacun, couronne les 3 premiers et repart à zéro chaque lundi', async () => {
    let maintenant = Date.parse('2026-11-03T10:00:00Z');
    const stockage = stockageClassementMemoire();
    const c = creerClassement(stockage, () => maintenant);
    const e = (nom: string, score: number) => ({ nom, avatar: 1, niveau: 3, score });
    await c.noter('a', e('Alice', 100));
    maintenant += 1000;
    await c.noter('b', e('Bruno', 150));
    maintenant += 1000;
    await c.noter('c', e('Carla', 120));
    maintenant += 1000;
    expect(await c.noter('d', e('Dan', 90))).toEqual({ ameliore: true, podiumChange: false });
    expect([c.couronneDe('b'), c.couronneDe('c'), c.couronneDe('a'), c.couronneDe('d')]).toEqual([1, 2, 3, null]);
    // Un score plus faible ne remplace pas le meilleur ; un meilleur score fait monter.
    expect(await c.noter('a', e('Alice', 80))).toEqual({ ameliore: false, podiumChange: false });
    expect(await c.noter('a', e('Alice', 200))).toEqual({ ameliore: true, podiumChange: true });
    expect(c.couronneDe('a')).toBe(1);
    // À score égal, le premier arrivé passe devant.
    maintenant += 1000;
    await c.noter('e', e('Ève', 120));
    expect(c.rangDe('c')).toEqual({ rang: 3, score: 120 });
    expect(c.rangDe('e')).toEqual({ rang: 4, score: 120 });
    // Pseudo choquant : jamais affiché.
    await c.noter('f', e('GrosConnard', 10));
    const vue: VueClassement = await c.vue('d');
    expect(vue.semaine.entrees.map((x) => x.score)).toEqual([200, 150, 120, 120, 90, 10]);
    expect(vue.semaine.moi).toMatchObject({ rang: 5, score: 90, moi: true });
    expect(vue.semaine.entrees.at(-1)!.nom).toBeNull();
    expect(c.meneur()).toMatchObject({ nom: 'Alice', score: 200, semaine: 'courante' });

    // Gardé dans le stockage : un serveur qui redémarre retrouve le classement.
    const relu = creerClassement(stockage, () => maintenant);
    await relu.charger();
    expect(relu.couronneDe('a')).toBe(1);
    expect(relu.rangDe('d')?.rang).toBe(5);

    // Lundi suivant : couronnes remises en jeu ; la bannière montre le premier de la semaine dernière.
    maintenant = Date.parse('2026-11-09T08:00:00Z');
    expect(c.verifierSemaine()).toBe(true);
    expect(c.couronneDe('a')).toBeNull();
    expect(c.meneur()).toMatchObject({ nom: 'Alice', semaine: 'precedente' });
    const nouvelle = await c.vue(null);
    expect(nouvelle.semaine.entrees).toEqual([]);
    expect(nouvelle.precedente?.entrees[0]).toMatchObject({ rang: 1, nom: 'Alice', score: 200 });
    await c.noter('d', e('Dan', 30));
    expect(c.couronneDe('d')).toBe(1);
    expect(c.meneur()).toMatchObject({ nom: 'Dan', semaine: 'courante' });

    // Compte supprimé : retiré des classements. Les semaines de plus de 8 semaines sont effacées.
    await c.retirer('a');
    expect(stockage.semaines.get('2026-S45')!.scores.a).toBeUndefined();
    maintenant += 10 * 7 * JOUR;
    c.verifierSemaine();
    expect(await c.purger()).toBe(2);
  });
});

// ---------- De bout en bout : partie comptée, couronnes, bannière et spectateur ----------

const identites = {
  'jeton-lea': { uid: 'uid-lea', nom: 'Léa', email: 'lea@gmail.com' },
  'jeton-max': { uid: 'uid-max', nom: 'Max', email: 'max@gmail.com' },
  'jeton-noe': { uid: 'uid-noe', nom: 'Noé', email: 'noe@gmail.com' },
};
const stockage = stockageMemoire();
const service = creerServiceComptes({ configWeb: { apiKey: 'cle', authDomain: 'test.firebaseapp.com', projectId: 'test' }, authentification: authentificationTest(identites), stockage });
let serveur: Awaited<ReturnType<typeof demarrerServeur>>;
const connecter = () => io(`http://localhost:${serveur.port}`, { transports: ['websocket'], forceNew: true });
function emettre(s: Socket, evt: string, data?: unknown): Promise<any> {
  return new Promise((ok) => s.emit(evt, data, ok));
}

beforeAll(async () => {
  serveur = await demarrerServeur({ port: 0, delaiFinDePli: 5, delaiRobot: 5, servirClient: false, comptes: service });
});
afterAll(async () => {
  await serveur.fermer();
});

describe('Classement et spectateurs de bout en bout', () => {
  it('compte la partie, couronne les meilleurs et laisse un ami regarder sans voir aucune carte cachée', async () => {
    const [lea, max, noe] = [connecter(), connecter(), connecter()];
    for (const [s, jeton] of [
      [lea, 'jeton-lea'],
      [max, 'jeton-max'],
      [noe, 'jeton-noe'],
    ] as const) {
      expect((await emettre(s, 'identifier', { jeton })).ok).toBe(true);
    }
    // Noé devient ami avec Léa.
    const codeLea: string = (await emettre(lea, 'amis')).liste.monCode;
    const codeNoe: string = (await emettre(noe, 'amis')).liste.monCode;
    await emettre(noe, 'ajouter_ami', { code: codeLea });
    await emettre(lea, 'repondre_ami', { code: codeNoe, accepter: true });
    // Pas encore en partie : rien à regarder.
    expect((await emettre(noe, 'regarder', { code: codeLea })).erreur).toMatch(/pas en train de jouer/);
    await new Promise((ok) => setTimeout(ok, 1050)); // une demande par seconde au plus

    const cree = await emettre(lea, 'creer', { nom: 'Léa' });
    await emettre(max, 'rejoindre', { code: cree.code, nom: 'Max' });
    await emettre(lea, 'ajouter_bot');

    // Léa et Max jouent tout seuls jusqu'au bout ; on lance la partie en ralentissant un peu Max.
    const vues: Record<string, VueSalon | null> = { lea: null, max: null };
    const fin = Promise.all(
      (
        [
          ['lea', lea],
          ['max', max],
        ] as const
      ).map(
        ([nom, s]) =>
          new Promise<VueSalon>((termine) => {
            let enCours = false;
            const agir = async () => {
              if (enCours) return;
              enCours = true;
              await new Promise((ok) => setTimeout(ok, 8));
              for (let k = 0; k < 20; k++) {
                const p = vues[nom]?.partie;
                const action = p && p.phase !== 'FIN_DE_PARTIE' ? actionRobot(p) : null;
                if (!action) break;
                const r = await emettre(s, 'action', action);
                if (!r.ok && vues[nom]?.partie === p) break;
              }
              enCours = false;
            };
            s.on('salon', (v: VueSalon) => {
              vues[nom] = v;
              if (v.partie?.phase === 'FIN_DE_PARTIE') {
                if (v.enregistrement && v.enregistrement.etat !== 'en_cours') termine(v);
                return;
              }
              if (v.partie) void agir();
            });
          }),
      ),
    );
    const vuesSpectateur: VueSalon[] = [];
    noe.on('salon', (v: VueSalon) => vuesSpectateur.push(v));
    expect((await emettre(lea, 'lancer')).ok).toBe(true);

    // Noé regarde la partie de Léa en direct, depuis sa place.
    const regarde = await emettre(noe, 'regarder', { code: codeLea });
    expect(regarde.ok).toBe(true);
    expect(regarde.jeton).toBeUndefined();
    await new Promise((ok) => setTimeout(ok, 60));
    const premiere = vuesSpectateur[0];
    expect(premiere.spectateur).toEqual({ ami: 'Léa' });
    expect(premiere.moi).toBe(cree.joueurId);
    expect(vues.lea?.spectateurs).toEqual(['Noé']);
    // Les spectateurs ne jouent pas et n'écrivent pas.
    expect((await emettre(noe, 'action', { type: 'ANNONCE', valeur: 0 })).ok).toBe(false);
    expect((await emettre(noe, 'chat', { texte: 'coucou' })).ok).toBe(false);

    const [vLea] = await fin;
    expect(vLea.enregistrement?.etat).toBe('fait');
    // Aucune carte en main n'a jamais été montrée au spectateur, ni une annonce avant leur révélation.
    for (const v of vuesSpectateur) {
      expect(v.partie?.main ?? []).toEqual([]);
      if (v.partie && !v.partie.joueurs.every((j) => j.annonce !== null) && v.partie.phase === 'ANNONCES') expect(v.partie.monAnnonce).toBeNull();
    }
    // Il voit la fin de partie comme les joueurs.
    await new Promise((ok) => setTimeout(ok, 50));
    expect(vuesSpectateur.at(-1)?.partie?.phase).toBe('FIN_DE_PARTIE');
    // Depuis la table qu'il regarde, Noé ouvre la fiche de Max et peut l'ajouter en ami.
    const idMax = vLea.partie!.joueurs.find((j) => j.nom === 'Max')!.id;
    expect((await emettre(noe, 'profil_joueur', { joueurId: idMax })).profil).toMatchObject({ nom: 'Max', type: 'compte' });
    expect(await emettre(noe, 'ajouter_ami_joueur', { joueurId: idMax })).toMatchObject({ ok: true, resultat: 'envoyee' });

    // Classement : Léa et Max y sont avec leur score final ; le meilleur des deux porte la couronne d'or.
    const scoreLea = vLea.partie!.joueurs.find((j) => j.id === cree.joueurId)!.score;
    const scoreMax = vLea.partie!.joueurs.find((j) => j.nom === 'Max')!.score;
    const r = await emettre(lea, 'classement');
    expect(r.ok).toBe(true);
    const cl: VueClassement = r.classement;
    expect(cl.semaine.entrees.map((x) => x.score).sort((a, b) => b - a)).toEqual([scoreLea, scoreMax].sort((a, b) => b - a));
    expect(cl.semaine.moi).toMatchObject({ nom: 'Léa', score: scoreLea, moi: true });
    expect(JSON.stringify(cl)).not.toMatch(/uid-|@/);
    const premier = scoreLea >= scoreMax ? 'Léa' : 'Max';
    await new Promise((ok) => setTimeout(ok, 40));
    const derniere = vues.lea!;
    expect(derniere.joueurs.find((j) => j.nom === premier)?.compte?.couronne).toBe(1);
    expect(derniere.joueurs.find((j) => j.nom === (premier === 'Léa' ? 'Max' : 'Léa'))?.compte?.couronne).toBe(2);
    expect(derniere.joueurs.find((j) => j.bot)?.compte).toBeNull();
    // Bannière de l'accueil : le premier de la semaine.
    const accueil = connecter();
    const enLigne = await new Promise<{ baron: { nom: string; score: number } | null }>((ok) => accueil.once('en_ligne', ok));
    expect(enLigne.baron).toMatchObject({ nom: premier, score: Math.max(scoreLea, scoreMax), semaine: 'courante' });
    accueil.close();
    // Liste d'amis de Noé : la couronne de Léa ; sa fiche donne sa place de la semaine.
    const amisNoe: ListeAmis = (await emettre(noe, 'amis')).liste;
    expect(amisNoe.amis[0].couronne).toBe(premier === 'Léa' ? 1 : 2);
    expect((await emettre(noe, 'profil_ami', { code: codeLea })).profil.semaine).toMatchObject({ score: scoreLea });

    // Noé arrête de regarder : les joueurs ne le voient plus.
    const sansNoe = new Promise<VueSalon>((ok) => lea.on('salon', (v: VueSalon) => !v.spectateurs && ok(v)));
    expect((await emettre(noe, 'quitter')).ok).toBe(true);
    await sansNoe;
    [lea, max, noe].forEach((s) => s.close());
  }, 30_000);

  it('ne propose pas de regarder une partie que l’ami a quittée', async () => {
    const [lea, max, noe] = [connecter(), connecter(), connecter()];
    for (const [s, jeton] of [
      [lea, 'jeton-lea'],
      [max, 'jeton-max'],
      [noe, 'jeton-noe'],
    ] as const) {
      expect((await emettre(s, 'identifier', { jeton })).ok).toBe(true);
    }
    const codeLea: string = (await emettre(lea, 'amis')).liste.monCode;
    const cree = await emettre(lea, 'creer', { nom: 'Léa' });
    await emettre(max, 'rejoindre', { code: cree.code, nom: 'Max' });
    await emettre(lea, 'ajouter_bot');
    expect((await emettre(lea, 'lancer')).ok).toBe(true);
    const leaPourNoe = async () => ((await emettre(noe, 'amis')).liste as ListeAmis).amis.find((a) => a.nom === 'Léa');
    expect((await leaPourNoe())?.regardable).toBe(true);
    // Léa quitte la partie (l'ordinateur la finit à sa place) : il n'y a plus rien à regarder.
    await emettre(lea, 'quitter');
    expect((await leaPourNoe())?.regardable).toBeUndefined();
    expect((await emettre(noe, 'regarder', { code: codeLea })).erreur).toMatch(/pas en train de jouer/);
    [lea, max, noe].forEach((s) => s.close());
  }, 15_000);
});

// ---------- Récompenses du classement : de l'XP pour les 10 premiers, chaque lundi ----------

describe('Récompenses du classement de la semaine', () => {
  it('donne 500, 300 et 200 XP au podium, puis 100 jusqu’au 10e, et rien après', () => {
    expect([1, 2, 3, 4, 10, 11, 50].map(xpRecompenseSemaine)).toEqual([500, 300, 200, 100, 100, 0, 0]);
    expect(RECOMPENSES_SEMAINE).toHaveLength(10);
  });

  it('ajoute l’XP une seule fois, à la première connexion de la semaine suivante', async () => {
    const ids = {
      'jeton-or': { uid: 'uid-or', nom: 'Oriane', email: 'or@gmail.com' },
      'jeton-argent': { uid: 'uid-argent', nom: 'Arthur', email: 'ar@gmail.com' },
      'jeton-loin': { uid: 'uid-loin', nom: 'Lou', email: 'lou@gmail.com' },
    };
    const st = stockageMemoire();
    const svc = creerServiceComptes({ configWeb: { apiKey: 'cle', authDomain: 'test.firebaseapp.com', projectId: 'test' }, authentification: authentificationTest(ids), stockage: st });
    // Semaine dernière (S45) : Oriane 1re, Arthur 2e, dix autres joueurs, puis Lou 13e.
    const s45 = semaineDe(Date.parse('2026-11-05T12:00:00Z'));
    const noter = (uid: string, nom: string, score: number) => st.classements.noterClassement(s45, uid, { nom, avatar: 1, niveau: 2, score, date: s45.debut + 1000 });
    await noter('uid-or', 'Oriane', 300);
    await noter('uid-argent', 'Arthur', 250);
    for (let k = 0; k < 10; k++) await noter(`uid-autre-${k}`, `Autre ${k}`, 200 - k);
    await noter('uid-loin', 'Lou', 50);
    // On est le mardi suivant.
    const srv = await demarrerServeur({ port: 0, servirClient: false, comptes: svc, horloge: () => Date.parse('2026-11-10T09:00:00Z') });
    const brancher = () => io(`http://localhost:${srv.port}`, { transports: ['websocket'], forceNew: true });
    try {
      const or = brancher();
      const premiere = await emettre(or, 'identifier', { jeton: 'jeton-or' });
      expect(premiere.recompense).toMatchObject({ rang: 1, xp: 500, debut: s45.debut, fin: s45.fin, niveauAvant: 1, niveau: 4 });
      expect(premiere.profil.xp).toBe(500);
      // Déjà donnée : ni à la mise à jour du profil, ni à une nouvelle connexion.
      expect((await emettre(or, 'profil')).recompense).toBeUndefined();
      const or2 = brancher();
      const seconde = await emettre(or2, 'identifier', { jeton: 'jeton-or' });
      expect(seconde.recompense).toBeUndefined();
      expect(seconde.profil.xp).toBe(500);
      expect((await svc.recompenserSemaine('uid-or', s45.cle, 500))).toBe('deja');

      const argent = brancher();
      expect((await emettre(argent, 'identifier', { jeton: 'jeton-argent' })).recompense).toMatchObject({ rang: 2, xp: 300 });
      const loin = brancher();
      const rienPourLou = await emettre(loin, 'identifier', { jeton: 'jeton-loin' });
      expect(rienPourLou.ok).toBe(true);
      expect(rienPourLou.recompense).toBeUndefined();
      expect(rienPourLou.profil.xp).toBe(0);
      expect((await svc.lire('uid-argent'))?.recompenseSemaine).toBe(s45.cle);
      [or, or2, argent, loin].forEach((x) => x.close());
    } finally {
      await srv.fermer();
    }
  });
});
