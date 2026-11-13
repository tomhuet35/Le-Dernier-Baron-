import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authentificationTest, creerServiceComptes, stockageMemoire } from '../server/comptes';
import { demarrerServeur } from '../server/serveur';
import { SOLDE_DEPART } from '../shared/casino';
import { afficheCasino, DUREE_AFFICHE, ORDRE_AFFICHE, PLAFOND_BONUS_AFFICHE, type AfficheCasino } from '../shared/afficheCasino';
import { bonusNiveauCasino, JEUX_CASINO } from '../shared/profilCasino';

/** Minuit à Paris le 13 novembre 2026 (heure d'hiver : 23 h UTC la veille). */
const MINUIT = Date.UTC(2026, 10, 12, 23, 0, 0);

describe('Le jeu à l’affiche : le roulement', () => {
  it('change toutes les 3 heures, à heure fixe (heure de Paris)', () => {
    const a = afficheCasino(MINUIT);
    expect(a.debut).toBe(MINUIT);
    expect(a.reste).toBe(DUREE_AFFICHE);
    const b = afficheCasino(MINUIT + DUREE_AFFICHE - 1000);
    expect(b.jeu).toBe(a.jeu);
    expect(b.reste).toBe(1000);
    const c = afficheCasino(MINUIT + DUREE_AFFICHE);
    expect(c.jeu).toBe(a.suivant);
    expect(c.debut).toBe(MINUIT + DUREE_AFFICHE);
    // En été aussi, les créneaux tombent sur 0 h, 3 h, 6 h… à Paris.
    const ete = Date.UTC(2026, 6, 14, 22, 0, 0); // minuit à Paris le 15 juillet
    expect(afficheCasino(ete).debut).toBe(ete);
    expect(afficheCasino(ete + 3_600_000).debut).toBe(ete);
  });

  it('montre huit jeux par jour, les neuf en deux jours, et chaque jeu à chaque heure en neuf jours', () => {
    expect([...ORDRE_AFFICHE].sort()).toEqual([...JEUX_CASINO].sort());
    expect(ORDRE_AFFICHE).toHaveLength(9);
    const parCreneau = Array.from({ length: 8 }, () => new Set<string>());
    const parJour: Set<string>[] = [];
    for (let jour = 0; jour < 9; jour++) {
      const vus = new Set<string>();
      for (let k = 0; k < 8; k++) {
        const a = afficheCasino(MINUIT + jour * 86_400_000 + k * DUREE_AFFICHE + 60_000);
        vus.add(a.jeu);
        parCreneau[k].add(a.jeu);
      }
      expect(vus.size).toBe(8);
      parJour.push(vus);
    }
    for (let jour = 0; jour < 8; jour++) expect(new Set([...parJour[jour], ...parJour[jour + 1]]).size).toBe(9);
    for (const s of parCreneau) expect(s.size).toBe(9);
  });
});

// ---------- En direct : XP doublée et bonus sur les gains ----------

const identites = { 'jeton-a': { uid: 'uid-a', nom: 'Lucas', email: 'a@gmail.com' } };
const service = creerServiceComptes({ configWeb: { apiKey: 'cle', authDomain: 'test.firebaseapp.com', projectId: 'test' }, authentification: authentificationTest(identites), stockage: stockageMemoire() });
let serveur: Awaited<ReturnType<typeof demarrerServeur>>;
let affiche: AfficheCasino | null = { jeu: 'chute', debut: 1, reste: DUREE_AFFICHE, suivant: 'roulette' };
const connecter = () => io(`http://localhost:${serveur.port}`, { transports: ['websocket'], forceNew: true });
function emettre(s: Socket, evt: string, data?: unknown): Promise<any> {
  return new Promise((ok) => s.emit(evt, data, ok));
}
const attendre = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
/** Quatre écus de 250 000 $ tout à gauche (risque faible, 8 rangées : ×5,6). */
async function quatreEcus(a: Socket) {
  await attendre(1100);
  const r = [];
  for (let k = 0; k < 4; k++) r.push(await emettre(a, 'casino_chute_lacher', { mise: 250_000, rangees: 8, risque: 'faible' }));
  return r;
}

beforeAll(async () => {
  await service.preparer('uid-a', 'Lucas');
  await service.donnerBadgeCreateur('uid-a');
  serveur = await demarrerServeur({ port: 0, servirClient: false, comptes: service, casino: { delaiEcriture: 30, cheminChute: (n: number) => Array(n).fill(0), jeuALaffiche: () => affiche } });
});
afterAll(async () => {
  await serveur.fermer();
});

describe('Le jeu à l’affiche en direct', () => {
  it('double l’XP des mises du jeu, ajoute 10 % aux gains jusqu’au plafond, et rien ailleurs', async () => {
    const a = connecter();
    await emettre(a, 'identifier', { jeton: 'jeton-a' });
    const entree = await emettre(a, 'casino_entrer');
    expect(entree.casino.affiche).toMatchObject({ jeu: 'chute', suivant: 'roulette', bonus: 0 });
    const xp0 = entree.casino.profil.xp;
    const bonus: { total: number }[] = [];
    a.on('casino_affiche', (e) => bonus.push(e));

    // 1 000 000 $ misés : 2 000 XP au lieu de 1 000 ; chaque gain de 1 400 000 $ reçoit 140 000 $ de bonus.
    const r = await quatreEcus(a);
    expect(r.every((x) => x.ok && x.chute.gain === 1_400_000)).toBe(true);
    expect(r[0].solde).toBe(SOLDE_DEPART - 250_000 + 1_400_000 + 140_000);
    expect(r[0].credite).toBe(1_540_000); // ce que l'écran montrera à l'arrivée de l'écu
    const v1 = (await emettre(a, 'casino_vue')).casino;
    expect(v1.profil.xp - xp0).toBe(2_000);
    expect(v1.affiche.bonus).toBe(560_000);
    expect(v1.profil.niveau).toBe(2); // 2 000 XP : le niveau 2 (et son bonus) arrive deux fois plus vite
    expect(v1.solde).toBe(SOLDE_DEPART + 4 * (1_400_000 - 250_000) + 560_000 + bonusNiveauCasino(2));
    await attendre(50);
    expect(bonus.map((e) => e.total)).toEqual([140_000, 280_000, 420_000, 560_000]);

    // Le plafond : 1 000 000 $ de bonus par créneau.
    await quatreEcus(a);
    expect((await emettre(a, 'casino_vue')).casino.affiche.bonus).toBe(PLAFOND_BONUS_AFFICHE);

    // Un autre jeu à l'affiche : la Chute redevient normale.
    affiche = { jeu: 'roulette', debut: 2, reste: DUREE_AFFICHE, suivant: 'machine' };
    const avant = (await emettre(a, 'casino_vue')).casino;
    expect(avant.affiche).toMatchObject({ jeu: 'roulette', bonus: 0 });
    await quatreEcus(a);
    const apres = (await emettre(a, 'casino_vue')).casino;
    expect(apres.profil.xp - avant.profil.xp).toBe(1_000);
    expect(apres.solde - avant.solde).toBe(4 * (1_400_000 - 250_000));

    // Nouveau créneau de la Chute : le plafond repart de zéro.
    affiche = { jeu: 'chute', debut: 3, reste: DUREE_AFFICHE, suivant: 'roulette' };
    await quatreEcus(a);
    expect((await emettre(a, 'casino_vue')).casino.affiche.bonus).toBe(560_000);

    // L'XP gagnée en plus est écrite avec le compte (elle survit au départ du salon).
    await emettre(a, 'casino_quitter');
    const compte = await service.lire('uid-a');
    expect(compte?.casino?.bonusXp).toBe(3_000_000);
    affiche = null;
    const retour = await emettre(a, 'casino_entrer');
    expect(retour.casino.affiche).toBeUndefined();
    expect(retour.casino.profil.xp).toBe(xp0 + 2_000 + 2_000 + 1_000 + 2_000);
    a.close();
  });
});
