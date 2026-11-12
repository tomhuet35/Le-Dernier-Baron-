import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authentificationTest, creerServiceComptes, stockageMemoire } from '../server/comptes';
import { creerDefis } from '../server/defisCasino';
import { demarrerServeur } from '../server/serveur';
import { SOLDE_DEPART, type AnnonceCasino, type VueCasino } from '../shared/casino';
import {
  bonusNiveauCasino,
  cadreCasino,
  niveauCasino,
  progressionCasino,
  titreCasino,
  xpPourNiveauCasino,
  type ProfilCasino,
  type VueAmisCasino,
  type VueDefi,
} from '../shared/profilCasino';

describe('Profil du casino : les niveaux', () => {
  it('passe d’un niveau à l’autre aux bons paliers', () => {
    expect([1, 2, 3, 10, 100].map(xpPourNiveauCasino)).toEqual([0, 1_000, 3_000, 45_000, 4_950_000]);
    for (let n = 1; n <= 100; n++) {
      expect(niveauCasino(xpPourNiveauCasino(n))).toBe(n);
      if (n > 1) expect(niveauCasino(xpPourNiveauCasino(n) - 1)).toBe(n - 1);
    }
    expect(niveauCasino(0)).toBe(1);
    expect(niveauCasino(-5)).toBe(1);
    expect(niveauCasino(Number.NaN)).toBe(1);
    expect(niveauCasino(1e15)).toBe(100);
  });

  it('verse les bons bonus, et donne un titre et un cadre tous les 10 niveaux', () => {
    expect([1, 2, 9, 10, 11, 50, 100].map(bonusNiveauCasino)).toEqual([0, 200_000, 900_000, 5_000_000, 1_100_000, 25_000_000, 50_000_000]);
    expect([1, 9, 10, 19, 20, 99, 100].map((n) => titreCasino(n)[0])).toEqual(['Novice', 'Novice', 'Habitué', 'Habitué', 'Flambeur', 'Seigneur du casino', 'Baron du casino']);
    expect([9, 10, 29, 30, 55, 100].map(cadreCasino)).toEqual(['aucun', 'bronze', 'argent', 'or', 'saphir', 'baron']);
    expect(progressionCasino(1_500_000)).toEqual({ xp: 1_500, niveau: 2, xpNiveau: 1_000, xpSuivant: 3_000, bonusSuivant: 300_000 });
    expect(progressionCasino(1e13)).toMatchObject({ niveau: 100, xpSuivant: null, bonusSuivant: null });
  });
});

describe('Défis : reprise après un redémarrage du serveur', () => {
  it('rend une invitation expirée et règle un défi fini pendant l’arrêt', async () => {
    const t = 1_000_000_000;
    const verses: [string, number][] = [];
    const resultats: [string, string, number][] = [];
    const d = creerDefis({
      horloge: () => t,
      prelever: () => true,
      verser: (u, m) => verses.push([u, m]),
      resultat: (u, _adv, r, m) => resultats.push([u, r, m]),
      sontAmis: () => true,
      notifier: () => undefined,
      annoncer: () => undefined,
      sauver: () => undefined,
    });
    const a = { uid: 'a', nom: 'A', avatar: 1 };
    const b = { uid: 'b', nom: 'B', avatar: 2 };
    const c = { uid: 'c', nom: 'C', avatar: 3 };
    d.importer([
      { id: 'x1', de: a, vers: b, jeu: 'tous', duree: 300_000, mise: 1_000_000, etat: 'attente', creeLe: 0, expire: t - 1, debut: null, fin: null, scores: { de: 0, vers: 0 }, gagnant: null, majLe: 0 },
      { id: 'x2', de: a, vers: c, jeu: 'coffres', duree: 300_000, mise: 500_000, etat: 'enCours', creeLe: 0, expire: 0, debut: t - 400_000, fin: t - 100_000, scores: { de: -20_000, vers: 15_000 }, gagnant: null, majLe: 0 },
      { id: 'abime', etat: 'nimporte' },
      null,
    ]);
    await new Promise((ok) => setTimeout(ok, 30));
    expect(verses).toEqual(expect.arrayContaining([['a', 1_000_000], ['c', 1_000_000]]));
    expect(resultats).toEqual(expect.arrayContaining([['c', 'gagne', 500_000], ['a', 'perdu', 500_000]]));
    expect(d.vuesDe('a').map((v) => v.etat).sort()).toEqual(['expire', 'fini']);
    d.fermer();
  });
});

// ---------- Au salon, de bout en bout ----------

const identites = {
  'jeton-a': { uid: 'uid-a', nom: 'Lucas', email: 'a@gmail.com' },
  'jeton-b': { uid: 'uid-b', nom: 'Léa', email: 'b@gmail.com' },
  'jeton-n': { uid: 'uid-n', nom: 'Nina', email: 'n@gmail.com' },
};
const stockage = stockageMemoire();
const service = creerServiceComptes({ configWeb: { apiKey: 'cle', authDomain: 'test.firebaseapp.com', projectId: 'test' }, authentification: authentificationTest(identites), stockage });
let serveur: Awaited<ReturnType<typeof demarrerServeur>>;
let badges = [0, 1, 2];
const DEPART_A = 200_000_000;
const DEPART_B = 10_000_000;

const connecter = () => io(`http://localhost:${serveur.port}`, { transports: ['websocket'], forceNew: true });
function emettre(s: Socket, evt: string, data?: unknown): Promise<any> {
  return new Promise((ok) => s.emit(evt, data, ok));
}
/** Garde tout ce qu'un téléphone reçoit pour un événement. */
function ecouter<T>(s: Socket, evt: string): T[] {
  const recus: T[] = [];
  s.on(evt, (x: T) => recus.push(x));
  return recus;
}
async function attendreQue(cond: () => boolean, ms = 5000) {
  const fin = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > fin) throw new Error('trop long');
    await new Promise((ok) => setTimeout(ok, 20));
  }
}
const solde = async (s: Socket) => ((await emettre(s, 'casino_vue')).casino as VueCasino).solde;
const profil = async (s: Socket, uid?: string) => (await emettre(s, 'casino_profil', uid ? { uid } : {})).profil as ProfilCasino;

/** Une partie des Coffres : perdue tout de suite (badge au coffre 0), ou deux butins encaissés (×1,25). */
async function coffresPerdus(s: Socket, mise: number) {
  expect((await emettre(s, 'casino_coffres_lancer', { mise, badges: 3 })).ok).toBe(true);
  expect((await emettre(s, 'casino_coffres_ouvrir', { index: 0 })).coffres.etat).toBe('perdu');
}
async function coffresGagnes(s: Socket, mise: number) {
  expect((await emettre(s, 'casino_coffres_lancer', { mise, badges: 3 })).ok).toBe(true);
  await emettre(s, 'casino_coffres_ouvrir', { index: 12 });
  await emettre(s, 'casino_coffres_ouvrir', { index: 20 });
  expect((await emettre(s, 'casino_coffres_encaisser')).coffres.gain).toBe(Math.floor(mise * 1.25));
}

let a: Socket;
let b: Socket;

beforeAll(async () => {
  for (const id of Object.values(identites)) await service.preparer(id.uid, id.nom);
  await service.donnerBadgeCreateur('uid-a');
  await service.donnerBadgeCreateur('uid-b');
  await service.entrerCasino('uid-a');
  await service.mouvementCasino('uid-a', DEPART_A - SOLDE_DEPART);
  await service.entrerCasino('uid-b');
  await service.mouvementCasino('uid-b', DEPART_B - SOLDE_DEPART);
  serveur = await demarrerServeur({
    port: 0,
    servirClient: false,
    comptes: service,
    casino: { delaiEcriture: 30, placerBadgesCoffres: () => badges, delaisCouronne: { mises: 60_000 }, echelleDefis: 0.004 },
  });
  a = connecter();
  b = connecter();
  await emettre(a, 'identifier', { jeton: 'jeton-a' });
  await emettre(b, 'identifier', { jeton: 'jeton-b' });
});
afterAll(async () => {
  a.close();
  b.close();
  await serveur.fermer();
});

describe('Profil, amis et défis du casino en direct', () => {
  it('restent introuvables sans badge Créateur', async () => {
    const n = connecter();
    await emettre(n, 'identifier', { jeton: 'jeton-n' });
    for (const evt of ['casino_profil', 'casino_mes_amis', 'casino_ami', 'casino_envoyer', 'casino_defis', 'casino_defi_lancer', 'casino_defi_repondre', 'casino_defi_annuler'])
      expect((await emettre(n, evt, { uid: 'uid-a', action: 'demander', montant: 100_000 })).erreur).toBe('Introuvable.');
    n.close();
  });

  it('compte l’argent misé pour l’XP (pas les mises annulées) et paie chaque niveau une seule fois', async () => {
    expect((await emettre(a, 'casino_profil')).ok).toBe(false); // pas encore au salon
    const niveaux = ecouter<{ niveau: number; avant: number; bonus: number }>(a, 'casino_niveau');
    expect((await emettre(a, 'casino_entrer')).ok).toBe(true);
    expect(await profil(a)).toMatchObject({ niveau: 1, xp: 0, mise: 0, relation: 'moi', journal: [] });

    // 2 × 500 000 $ misés : 1 000 XP, le niveau 2 et son bonus (200 000 $).
    await coffresPerdus(a, 500_000);
    expect(niveaux).toEqual([]);
    await coffresPerdus(a, 500_000);
    await attendreQue(() => niveaux.length > 0);
    expect(niveaux).toEqual([{ niveau: 2, avant: 1, bonus: 200_000 }]);
    expect(await solde(a)).toBe(DEPART_A - 1_000_000 + 200_000);
    const p = await profil(a);
    expect(p).toMatchObject({ niveau: 2, xp: 1_000, xpNiveau: 1_000, xpSuivant: 3_000, bonusSuivant: 300_000, mise: 1_000_000, gagne: 0 });
    expect(p.jeux.coffres).toEqual({ mise: 1_000_000, gain: 0 });
    expect(p.journal?.[0]).toMatchObject({ type: 'niveau', niveau: 2, montant: 200_000 });
    expect(((await emettre(a, 'casino_vue')).casino as VueCasino).profil).toMatchObject({ niveau: 2, xp: 1_000, demandes: 0, invitations: 0, defi: null });

    // Une mise de la Couronne annulée avant l'envol ne compte pas.
    const e = await emettre(a, 'casino_cv_entrer');
    expect(e.couronne.phase).toBe('mises');
    expect((await emettre(a, 'casino_cv_miser', { emplacement: 0, mise: 10_000 })).ok).toBe(true);
    expect((await profil(a)).mise).toBe(1_010_000);
    expect((await emettre(a, 'casino_cv_annuler', { emplacement: 0 })).ok).toBe(true);
    expect((await profil(a)).mise).toBe(1_000_000);
    await emettre(a, 'casino_cv_quitter');

    // Gains comptés aussi ; et tout est écrit dans le compte.
    await coffresGagnes(a, 100_000); // mise 100 000, gain 125 000
    await attendreQue(() => false, 150).catch(() => undefined);
    const c = (await service.lire('uid-a'))!.casino!;
    expect(c).toMatchObject({ mise: 1_100_000, gagne: 125_000, niveauPaye: 2 });
    expect(c.jeux?.coffres).toEqual({ mise: 1_100_000, gain: 125_000 });
    expect(c.journal?.[0]).toMatchObject({ type: 'niveau', niveau: 2 });
  });

  it('fait des amis du casino, montre où ils jouent et leur envoie de l’argent (plafond par jour)', async () => {
    const socialA = ecouter<{ type: string; nom: string; montant?: number }>(a, 'casino_social');
    const socialB = ecouter<{ type: string; nom: string; montant?: number }>(b, 'casino_social');
    const soldesB = ecouter<number>(b, 'casino_solde');
    expect((await emettre(b, 'casino_entrer')).ok).toBe(true);
    let amisA = (await emettre(a, 'casino_mes_amis')).amis as VueAmisCasino;
    expect(amisA.amis).toEqual([]);
    expect(amisA.autres.map((j) => j.uid)).toContain('uid-b');
    expect(amisA.envoisRestants).toBe(50_000_000);
    // Pas encore amis : pas d'envoi.
    expect((await emettre(a, 'casino_envoyer', { uid: 'uid-b', montant: 1_000_000 })).erreur).toMatch(/amis/);

    expect((await emettre(a, 'casino_ami', { uid: 'uid-b', action: 'demander' })).resultat).toBe('envoyee');
    expect((await emettre(a, 'casino_ami', { uid: 'uid-b', action: 'demander' })).resultat).toBe('deja_envoyee');
    await attendreQue(() => socialB.length > 0);
    expect(socialB[0]).toEqual({ type: 'demande', nom: 'Lucas' });
    expect(((await emettre(b, 'casino_vue')).casino as VueCasino).profil?.demandes).toBe(1);
    expect(((await emettre(b, 'casino_mes_amis')).amis as VueAmisCasino).recues.map((j) => j.uid)).toEqual(['uid-a']);
    expect((await profil(b, 'uid-a')).relation).toBe('demande_recue');
    expect((await emettre(b, 'casino_ami', { uid: 'uid-a', action: 'accepter' })).resultat).toBe('amis');
    await attendreQue(() => socialA.length > 0);
    expect(socialA[0]).toEqual({ type: 'ami', nom: 'Léa' });

    amisA = (await emettre(a, 'casino_mes_amis')).amis;
    expect(amisA.amis).toEqual([{ uid: 'uid-b', nom: 'Léa', avatar: expect.any(Number), niveau: 1, enLigne: true, ou: { ecran: 'salon' } }]);
    b.emit('casino_position', { ecran: 'couronne' });
    b.emit('casino_position', { ecran: 'poker' }); // inconnu : ignoré
    await new Promise((ok) => setTimeout(ok, 50));
    expect(((await emettre(a, 'casino_mes_amis')).amis as VueAmisCasino).amis[0].ou).toEqual({ ecran: 'couronne' });
    const pb = await profil(a, 'uid-b');
    expect(pb).toMatchObject({ uid: 'uid-b', nom: 'Léa', relation: 'ami', enLigne: true, solde: DEPART_B, niveau: 1 });
    expect(pb.journal).toBeUndefined(); // le journal d'un ami reste privé

    // Envois : 1 M, puis 4 × 10 M ; au-delà de 50 M dans la journée, refusé.
    const avantA = await solde(a);
    expect((await emettre(a, 'casino_envoyer', { uid: 'uid-b', montant: 1_234 })).ok).toBe(false);
    const r = await emettre(a, 'casino_envoyer', { uid: 'uid-b', montant: 1_000_000 });
    expect(r.envoisRestants).toBe(49_000_000);
    await attendreQue(() => socialB.some((x) => x.type === 'recu'));
    expect(socialB.find((x) => x.type === 'recu')).toEqual({ type: 'recu', nom: 'Lucas', montant: 1_000_000 });
    expect(soldesB.at(-1)).toBe(DEPART_B + 1_000_000);
    for (let i = 0; i < 4; i++) expect((await emettre(a, 'casino_envoyer', { uid: 'uid-b', montant: 10_000_000 })).ok).toBe(true);
    expect((await emettre(a, 'casino_envoyer', { uid: 'uid-b', montant: 10_000_000 })).erreur).toMatch(/Plafond.*9.000.000/);
    expect((await emettre(a, 'casino_envoyer', { uid: 'uid-b', montant: 5_000_000 })).envoisRestants).toBe(4_000_000);
    expect(await solde(a)).toBe(avantA - 46_000_000);
    expect(await solde(b)).toBe(DEPART_B + 46_000_000);
    expect((await profil(b)).journal?.[0]).toMatchObject({ type: 'recu', nom: 'Lucas', montant: 5_000_000 });
    expect((await profil(a)).journal?.[0]).toMatchObject({ type: 'envoi', nom: 'Léa', montant: 5_000_000 });
  });

  it('joue un défi : mises prises, scores du jeu choisi, le meilleur bilan emporte tout', async () => {
    const defisA = ecouter<VueDefi>(a, 'casino_defi');
    const defisB = ecouter<VueDefi>(b, 'casino_defi');
    const annonces = ecouter<AnnonceCasino>(a, 'casino_annonce');
    const lancer = (data: object) => emettre(a, 'casino_defi_lancer', { uid: 'uid-b', jeu: 'coffres', duree: 5 * 60_000, mise: 1_000_000, ...data });
    expect((await lancer({ mise: 1_234 })).erreur).toMatch(/Mise/);
    expect((await lancer({ duree: 1000 })).erreur).toMatch(/Durée/);
    expect((await lancer({ jeu: 'poker' })).erreur).toMatch(/Jeu/);
    expect((await lancer({ uid: 'uid-a' })).erreur).toMatch(/toi-même/);
    expect((await lancer({ uid: 'uid-n' })).erreur).toMatch(/introuvable/);

    const avantA = await solde(a);
    const avantB = await solde(b);
    const l = await lancer({});
    expect(l.ok).toBe(true);
    expect(l.casino.solde).toBe(avantA - 1_000_000);
    expect((await lancer({})).erreur).toMatch(/déjà/); // un seul défi en attente entre eux
    await attendreQue(() => defisB.length > 0);
    expect(defisB[0]).toMatchObject({ etat: 'attente', de: { uid: 'uid-a', nom: 'Lucas' }, vers: { uid: 'uid-b' }, jeu: 'coffres', mise: 1_000_000 });
    expect(((await emettre(b, 'casino_vue')).casino as VueCasino).profil?.invitations).toBe(1);
    expect((await emettre(a, 'casino_defi_repondre', { id: l.defi.id, accepter: true })).erreur).toMatch(/introuvable/); // seul l'invité répond

    const acc = await emettre(b, 'casino_defi_repondre', { id: l.defi.id, accepter: true });
    expect(acc.defi.etat).toBe('enCours');
    expect(acc.casino.solde).toBe(avantB - 1_000_000);
    // Pendant le défi : Lucas gagne aux Coffres (+25 000), Léa y perd (−10 000) ; la machine ne compte pas.
    await coffresGagnes(a, 100_000);
    await coffresPerdus(b, 10_000);
    await attendreQue(() => defisA.some((d) => d.etat === 'enCours' && d.scores.de === 25_000 && d.scores.vers === -10_000));
    await attendreQue(() => defisA.some((d) => d.etat === 'fini'), 4000);
    const fin = defisA.find((d) => d.etat === 'fini')!;
    expect(fin).toMatchObject({ gagnant: 'de', scores: { de: 25_000, vers: -10_000 } });
    expect(await solde(a)).toBe(avantA - 100_000 + 125_000 + 1_000_000);
    expect(await solde(b)).toBe(avantB - 1_000_000 - 10_000);
    await attendreQue(() => annonces.some((x) => x.jeu === 'defi'));
    expect(annonces.find((x) => x.jeu === 'defi')).toEqual({ nom: 'Lucas', jeu: 'defi', gain: 2_000_000, contre: 'Léa' });
    expect((await profil(a)).defis).toEqual({ gagnes: 1, perdus: 0, nuls: 0 });
    expect((await profil(b)).defis).toEqual({ gagnes: 0, perdus: 1, nuls: 0 });
    expect((await profil(b)).journal?.[0]).toMatchObject({ type: 'defi', nom: 'Lucas', resultat: 'perdu', montant: 1_000_000 });
  });

  it('rend la mise d’un défi refusé, expiré ou à égalité', async () => {
    const defisA = ecouter<VueDefi>(a, 'casino_defi');
    const s0 = await solde(a);
    const r1 = await emettre(a, 'casino_defi_lancer', { uid: 'uid-b', jeu: 'tous', duree: 10 * 60_000, mise: 100_000 });
    expect(r1.ok).toBe(true);
    expect((await emettre(b, 'casino_defi_repondre', { id: r1.defi.id, accepter: false })).defi.etat).toBe('refuse');
    expect(await solde(a)).toBe(s0);

    // Personne ne répond : l'invitation expire (10 min, accélérées) et la mise revient.
    const r2 = await emettre(a, 'casino_defi_lancer', { uid: 'uid-b', jeu: 'tous', duree: 10 * 60_000, mise: 100_000 });
    expect(await solde(a)).toBe(s0 - 100_000);
    await attendreQue(() => defisA.some((d) => d.id === r2.defi.id && d.etat === 'expire'), 5000);
    expect(await solde(a)).toBe(s0);

    // Personne ne joue : égalité, chacun récupère sa mise.
    const sb = await solde(b);
    const r3 = await emettre(a, 'casino_defi_lancer', { uid: 'uid-b', jeu: 'roulette', duree: 5 * 60_000, mise: 500_000 });
    expect((await emettre(b, 'casino_defi_repondre', { id: r3.defi.id, accepter: true })).ok).toBe(true);
    await attendreQue(() => defisA.some((d) => d.id === r3.defi.id && d.etat === 'fini'), 5000);
    expect(defisA.find((d) => d.id === r3.defi.id && d.etat === 'fini')?.gagnant).toBe('nul');
    expect(await solde(a)).toBe(s0);
    expect(await solde(b)).toBe(sb);
    expect((await emettre(a, 'casino_defis')).defis.map((d: VueDefi) => d.etat)).toEqual(expect.arrayContaining(['fini', 'refuse', 'expire']));

    // Plus amis : plus d'envoi ni de défi.
    expect((await emettre(b, 'casino_ami', { uid: 'uid-a', action: 'retirer' })).resultat).toBe('retire');
    expect((await emettre(a, 'casino_envoyer', { uid: 'uid-b', montant: 100_000 })).erreur).toMatch(/amis/);
    expect((await emettre(a, 'casino_defi_lancer', { uid: 'uid-b', jeu: 'tous', duree: 5 * 60_000, mise: 0 })).erreur).toMatch(/amis/);
  });
});

describe('Arrêt du serveur (mise à jour du site)', () => {
  it('rend les mises encore en jeu et écrit tout avant de s’arrêter', async () => {
    const ids = { 'jeton-z': { uid: 'uid-z', nom: 'Zoé', email: 'z@gmail.com' } };
    const st = stockageMemoire();
    const sv = creerServiceComptes({ configWeb: { apiKey: 'cle', authDomain: 'test.firebaseapp.com', projectId: 'test' }, authentification: authentificationTest(ids), stockage: st });
    await sv.preparer('uid-z', 'Zoé');
    await sv.donnerBadgeCreateur('uid-z');
    // Écritures lentes (10 s) : seul l'arrêt peut les faire partir à temps.
    const srv = await demarrerServeur({ port: 0, servirClient: false, comptes: sv, casino: { delaiEcriture: 10_000, placerBadgesCoffres: () => [0, 1, 2], delaisCouronne: { mises: 60_000 } } });
    const z = io(`http://localhost:${srv.port}`, { transports: ['websocket'], forceNew: true });
    await emettre(z, 'identifier', { jeton: 'jeton-z' });
    await emettre(z, 'casino_entrer');
    // Une partie des Coffres en cours (un butin trouvé), une mise de la Couronne avant l'envol, une partie perdue.
    await emettre(z, 'casino_coffres_lancer', { mise: 50_000, badges: 3 });
    await emettre(z, 'casino_coffres_ouvrir', { index: 0 }); // badge : perdue (50 000 $ partis pour de bon)
    await emettre(z, 'casino_coffres_lancer', { mise: 100_000, badges: 3 });
    await emettre(z, 'casino_coffres_ouvrir', { index: 10 });
    await emettre(z, 'casino_cv_entrer');
    expect((await emettre(z, 'casino_cv_miser', { emplacement: 0, mise: 25_000 })).ok).toBe(true);
    expect(((await emettre(z, 'casino_vue')).casino as VueCasino).solde).toBe(SOLDE_DEPART - 175_000);
    expect((await sv.lire('uid-z'))!.casino!.solde).toBe(SOLDE_DEPART); // rien n'est encore écrit
    z.close();
    await srv.fermer();
    const c = (await sv.lire('uid-z'))!.casino!;
    expect(c.solde).toBe(SOLDE_DEPART - 50_000);
    expect(c.mise).toBe(50_000); // seule la partie jouée compte
  });
});

describe('Recalage du porte-monnaie', () => {
  it('relit le compte en revenant au salon quand rien n’attend (autre serveur pendant une mise à jour)', async () => {
    const ids = { 'jeton-y': { uid: 'uid-y', nom: 'Yanis', email: 'y@gmail.com' } };
    const st = stockageMemoire();
    const sv = creerServiceComptes({ configWeb: { apiKey: 'cle', authDomain: 'test.firebaseapp.com', projectId: 'test' }, authentification: authentificationTest(ids), stockage: st });
    await sv.preparer('uid-y', 'Yanis');
    await sv.donnerBadgeCreateur('uid-y');
    const srv = await demarrerServeur({ port: 0, servirClient: false, comptes: sv, casino: { delaiEcriture: 20, placerBadgesCoffres: () => [0, 1, 2] } });
    const y = io(`http://localhost:${srv.port}`, { transports: ['websocket'], forceNew: true });
    await emettre(y, 'identifier', { jeton: 'jeton-y' });
    await emettre(y, 'casino_entrer');
    await coffresPerdus(y, 10_000);
    await emettre(y, 'casino_quitter');
    // Un autre serveur (ou un versement hors salon) ajoute 1 000 000 $ au compte.
    await sv.mouvementCasino('uid-y', 1_000_000);
    const v = (await emettre(y, 'casino_entrer')).casino as VueCasino;
    expect(v.solde).toBe(SOLDE_DEPART - 10_000 + 1_000_000);
    expect(v.profil?.xp).toBe(10);
    y.close();
    await srv.fermer();
  });
});
