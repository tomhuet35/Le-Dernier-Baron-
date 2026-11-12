import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authentificationTest, creerServiceComptes, stockageMemoire } from '../server/comptes';
import { demarrerServeur } from '../server/serveur';
import { SOLDE_DEPART } from '../shared/casino';
import { caseDuChemin, chancesChute, gainChute, multiplicateursChute, RANGEES_MAX, RANGEES_MIN, RISQUES_CHUTE, rtpChute, type ResultatChute } from '../shared/chute';

describe('La Chute des Écus : les tables', () => {
  it('a une case de plus que de rangées, symétrique, plus riche au bord qu’au milieu', () => {
    for (const risque of RISQUES_CHUTE)
      for (let n = RANGEES_MIN; n <= RANGEES_MAX; n++) {
        const x = multiplicateursChute(n, risque);
        expect(x).toHaveLength(n + 1);
        expect(x).toEqual([...x].reverse());
        for (let k = 1; k <= n / 2; k++) expect(x[k]).toBeLessThanOrEqual(x[k - 1]);
        expect(Math.min(...x)).toBeGreaterThanOrEqual(0.2);
      }
    expect(Math.max(...multiplicateursChute(16, 'eleve'))).toBe(1000);
    expect(Math.min(...multiplicateursChute(16, 'eleve'))).toBe(0.2);
    expect(Math.max(...multiplicateursChute(16, 'moyen'))).toBe(110);
    expect(Math.max(...multiplicateursChute(16, 'faible'))).toBe(16);
    expect(multiplicateursChute(7, 'moyen')).toEqual([]);
  });

  it('rend environ 93 % des mises sur chaque table, et le milieu fait perdre', () => {
    const gagnants: Record<string, number[]> = { faible: [], moyen: [], eleve: [] };
    for (let n = RANGEES_MIN; n <= RANGEES_MAX; n++) {
      const p = chancesChute(n);
      expect(p.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 12);
      for (const risque of RISQUES_CHUTE) {
        const rtp = rtpChute(n, risque);
        expect(rtp).toBeGreaterThan(0.92);
        expect(rtp).toBeLessThan(0.935);
        const x = multiplicateursChute(n, risque);
        expect(x.includes(1)).toBe(false); // aucune case ne rend tout juste la mise
        expect(x[Math.floor(n / 2)]).toBeLessThan(1); // le milieu fait perdre
        gagnants[risque].push(p.reduce((s, q, k) => s + (x[k] > 1 ? q : 0), 0));
      }
    }
    const moyenne = (t: number[]) => t.reduce((s, x) => s + x, 0) / t.length;
    // Un écu sur quatre gagne en risque faible, un sur sept en moyen, un sur quinze en élevé (en moyenne sur les rangées).
    expect(moyenne(gagnants.faible)).toBeCloseTo(0.24, 1);
    expect(moyenne(gagnants.moyen)).toBeCloseTo(0.15, 1);
    expect(moyenne(gagnants.eleve)).toBeCloseTo(0.065, 1);
    expect(Math.max(...gagnants.faible)).toBeLessThan(0.35);
    expect(gainChute(10_000, 0.2)).toBe(2_000);
    expect(gainChute(1_000, 1.1)).toBe(1_100);
    expect(gainChute(25_000, 8.9)).toBe(222_500);
    expect(caseDuChemin([1, 0, 1, 1, 0, 0, 0, 1])).toBe(4);
  });
});

// ---------- Des écus lâchés pour de vrai ----------

const identites = {
  'jeton-a': { uid: 'uid-a', nom: 'Lucas', email: 'a@gmail.com' },
  'jeton-n': { uid: 'uid-n', nom: 'Nina', email: 'n@gmail.com' },
};
const stockage = stockageMemoire();
const service = creerServiceComptes({ configWeb: { apiKey: 'cle', authDomain: 'test.firebaseapp.com', projectId: 'test' }, authentification: authentificationTest(identites), stockage });
let serveur: Awaited<ReturnType<typeof demarrerServeur>>;
/** Le chemin du prochain écu (tout à droite par défaut), ou undefined pour le hasard. */
let chemin: number[] | undefined;
const connecter = () => io(`http://localhost:${serveur.port}`, { transports: ['websocket'], forceNew: true });
function emettre(s: Socket, evt: string, data?: unknown): Promise<any> {
  return new Promise((ok) => s.emit(evt, data, ok));
}
const attendre = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

beforeAll(async () => {
  for (const id of Object.values(identites)) await service.preparer(id.uid, id.nom);
  await service.donnerBadgeCreateur('uid-a');
  serveur = await demarrerServeur({ port: 0, servirClient: false, comptes: service, casino: { delaiEcriture: 30, cheminChute: (n: number) => chemin?.slice(0, n), delaiAnnonceChute: 60 } });
});
afterAll(async () => {
  await serveur.fermer();
});

describe('La Chute des Écus en direct', () => {
  it('reste introuvable sans badge Créateur', async () => {
    const n = connecter();
    await emettre(n, 'identifier', { jeton: 'jeton-n' });
    expect((await emettre(n, 'casino_chute_lacher', { mise: 1000, rangees: 8, risque: 'faible' })).erreur).toBe('Introuvable.');
    n.close();
  });

  it('vérifie la mise, les rangées et le risque, débite la mise et crédite le gain d’un bloc', async () => {
    const a = connecter();
    await emettre(a, 'identifier', { jeton: 'jeton-a' });
    expect((await emettre(a, 'casino_chute_lacher', { mise: 1000, rangees: 8, risque: 'faible' })).ok).toBe(false); // pas encore au salon
    await emettre(a, 'casino_entrer');
    expect((await emettre(a, 'casino_chute_lacher', { mise: 1234, rangees: 8, risque: 'faible' })).erreur).toMatch(/Mise/);
    expect((await emettre(a, 'casino_chute_lacher', { mise: 1000, rangees: 17, risque: 'faible' })).erreur).toMatch(/16/);
    expect((await emettre(a, 'casino_chute_lacher', { mise: 1000, rangees: 7.5, risque: 'faible' })).erreur).toMatch(/16/);
    expect((await emettre(a, 'casino_chute_lacher', { mise: 1000, rangees: 12, risque: 'fou' })).erreur).toMatch(/Risque/);

    // Au milieu du plateau, risque élevé : ×0,2.
    chemin = [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0];
    const m = await emettre(a, 'casino_chute_lacher', { mise: 10_000, rangees: 16, risque: 'eleve' });
    expect(m.ok).toBe(true);
    const r1: ResultatChute = m.chute;
    expect(r1.chemin).toEqual(chemin);
    expect(r1.case).toBe(8);
    expect(r1.x).toBe(0.2);
    expect(r1.gain).toBe(2_000);
    expect(m.solde).toBe(SOLDE_DEPART - 10_000 + 2_000);

    // Tout à droite : ×1 000, annoncé au salon une fois l'écu arrivé en bas.
    chemin = Array(16).fill(1);
    const annonces: unknown[] = [];
    a.on('casino_annonce', (x) => annonces.push(x));
    const g = await emettre(a, 'casino_chute_lacher', { mise: 1_000, rangees: 16, risque: 'eleve' });
    expect(g.chute.case).toBe(16);
    expect(g.chute.x).toBe(1000);
    expect(g.chute.gain).toBe(1_000_000);
    expect(g.solde).toBe(SOLDE_DEPART - 8_000 - 1_000 + 1_000_000);
    expect(g.chute.id).toBe(r1.id + 1);
    expect(annonces).toHaveLength(0); // pas avant la fin de la chute
    await attendre(150);
    expect(annonces).toEqual([{ nom: 'Lucas', jeu: 'chute', gain: 1_000_000 }]);

    // Au hasard : un rebond par rangée, la case est le nombre de rebonds à droite.
    chemin = undefined;
    await attendre(1000);
    for (let k = 0; k < 5; k++) {
      const h = await emettre(a, 'casino_chute_lacher', { mise: 1_000, rangees: 9, risque: 'moyen' });
      expect(h.chute.chemin).toHaveLength(9);
      expect(h.chute.chemin.every((d: number) => d === 0 || d === 1)).toBe(true);
      expect(h.chute.case).toBe(caseDuChemin(h.chute.chemin));
      expect(h.chute.x).toBe(multiplicateursChute(9, 'moyen')[h.chute.case]);
    }
    a.close();
  });

  it('refuse de mitrailler : 8 écus par seconde au plus', async () => {
    const a = connecter();
    await emettre(a, 'identifier', { jeton: 'jeton-a' });
    await emettre(a, 'casino_entrer');
    await attendre(1100);
    chemin = Array(8).fill(0);
    const r = await Promise.all(Array.from({ length: 10 }, () => emettre(a, 'casino_chute_lacher', { mise: 1_000, rangees: 8, risque: 'faible' })));
    expect(r.filter((x) => x.ok)).toHaveLength(8);
    expect(r.filter((x) => !x.ok)[0].erreur).toMatch(/Doucement/);
    await attendre(1100);
    expect((await emettre(a, 'casino_chute_lacher', { mise: 1_000, rangees: 8, risque: 'faible' })).ok).toBe(true);
    a.close();
  });

  it('compte les mises pour l’XP du casino et le jeu dans le profil', async () => {
    const a = connecter();
    await emettre(a, 'identifier', { jeton: 'jeton-a' });
    await emettre(a, 'casino_entrer');
    const avant = (await emettre(a, 'casino_vue')).casino.profil.xp;
    await attendre(1100);
    chemin = Array(8).fill(0);
    for (let k = 0; k < 4; k++) await emettre(a, 'casino_chute_lacher', { mise: 250_000, rangees: 8, risque: 'faible' });
    const apres = (await emettre(a, 'casino_vue')).casino.profil.xp;
    expect(apres - avant).toBe(1_000);
    const profil = await emettre(a, 'casino_profil', {});
    expect(profil.profil.jeux.chute.mise).toBeGreaterThanOrEqual(1_000_000);
    a.close();
  });
});
