import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authentificationTest, creerServiceComptes, normaliserStats, stockageMemoire } from '../server/comptes';
import { demarrerServeur } from '../server/serveur';
import { CASES_ROUE_SALON, formatDollars, SOLDE_DEPART } from '../shared/casino';
import { BANDES, evaluerMachine, gainSuite, GAINS_LIGNE, grilleDepuisArrets, tauxDeRetour, tirerMachine, TOURS_GRATUITS } from '../shared/machineASous';
import { jourParis } from '../shared/roulette';

// ---------- Machine à sous ----------

describe('Machine à sous « Le Bandit du Baron »', () => {
  it('rend 96 % des mises en moyenne (calcul exact, hors gros lot)', () => {
    const t = tauxDeRetour();
    expect(t.total).toBeGreaterThan(0.955);
    expect(t.total).toBeLessThan(0.965);
    expect(t.pBonus).toBeGreaterThan(0.004); // le bonus tombe environ une fois tous les 140 tours
    expect(t.pBonus).toBeLessThan(0.012);
  });

  it('lit les lignes de gauche à droite, avec la Couronne comme joker (sauf pour le Coffre)', () => {
    expect(gainSuite(['sept', 'sept', 'sept', 'fer', 'fer'])).toEqual({ symbole: 'sept', nombre: 3, multiple: GAINS_LIGNE.sept[0] });
    expect(gainSuite(['couronne', 'sept', 'couronne', 'sept', 'fer'])).toEqual({ symbole: 'sept', nombre: 4, multiple: GAINS_LIGNE.sept[1] });
    expect(gainSuite(['couronne', 'couronne', 'couronne', 'couronne', 'couronne'])).toEqual({ symbole: 'couronne', nombre: 5, multiple: 1000 });
    // 3 Couronnes puis 2 Fers : les Couronnes seules paient plus que 5 Fers.
    expect(gainSuite(['couronne', 'couronne', 'couronne', 'fer', 'fer'])?.symbole).toBe('couronne');
    expect(gainSuite(['coffre', 'coffre', 'coffre', 'sept', 'sept'])).toBeNull();
    expect(gainSuite(['couronne', 'coffre', 'sept', 'sept', 'sept'])).toBeNull();
    expect(gainSuite(['diamant', 'diamant', 'lingot', 'diamant', 'diamant'])).toBeNull();
  });

  it('donne les tours gratuits avec 3 Coffres, et double les gains pendant ces tours', () => {
    const arrets = trouverArrets((g) => g.flat().filter((s) => s === 'coffre').length === 3);
    const normal = evaluerMachine(arrets, 10_000, false);
    expect(normal.coffres).toBe(3);
    expect(normal.toursGagnes).toBe(TOURS_GRATUITS);
    expect(normal.gain).toBeGreaterThanOrEqual(2 * 10_000);
    expect(evaluerMachine(arrets, 10_000, true).gain).toBe(normal.gain * 2);
  });

  it('reste proche de son taux de retour sur 30 000 tours tirés au hasard', () => {
    const hasard = graine(7);
    let mise = 0;
    let gain = 0;
    for (let i = 0; i < 30_000; i++) {
      mise += 1000;
      const r = tirerMachine(hasard, 1000, false);
      gain += r.gain;
      let reste = r.toursGagnes;
      while (reste > 0) {
        reste--;
        const g = tirerMachine(hasard, 1000, true);
        gain += g.gain;
        reste += g.toursGagnes;
      }
    }
    expect(gain / mise).toBeGreaterThan(0.8);
    expect(gain / mise).toBeLessThan(1.12);
  });

  it('écrit les montants à la française', () => {
    expect(formatDollars(1_250_000)).toBe('1 250 000 $');
    expect(formatDollars(1_250_000, true)).toBe('$1,250,000');
  });
});

function graine(n: number) {
  let a = n * 99991;
  return (max: number) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * max);
  };
}

function trouverArrets(condition: (g: ReturnType<typeof grilleDepuisArrets>) => boolean): number[] {
  const L = BANDES[0].length;
  for (let a = 0; a < L; a++)
    for (let b = 0; b < L; b++)
      for (let c = 0; c < L; c++) {
        const arrets = [a, b, c, 0, 0];
        if (condition(grilleDepuisArrets(arrets))) return arrets;
      }
  throw new Error('aucune grille trouvée');
}

// ---------- Salon privé de bout en bout ----------

const identites = {
  'jeton-crea': { uid: 'uid-crea', nom: 'Lucas', email: 'crea@gmail.com' },
  'jeton-crea2': { uid: 'uid-crea2', nom: 'Tom', email: 'tom@gmail.com' },
  'jeton-normal': { uid: 'uid-normal', nom: 'Nina', email: 'nina@gmail.com' },
};
const stockage = stockageMemoire();
const service = creerServiceComptes({ configWeb: { apiKey: 'cle', authDomain: 'test.firebaseapp.com', projectId: 'test' }, authentification: authentificationTest(identites), stockage });
let serveur: Awaited<ReturnType<typeof demarrerServeur>>;
/** Arrêts imposés à la machine (sinon une graine). */
let arretsImposes: number[] | null = null;
let k = 0;
const hasardGraine = graine(3);
const connecter = () => io(`http://localhost:${serveur.port}`, { transports: ['websocket'], forceNew: true });
function emettre(s: Socket, evt: string, data?: unknown): Promise<any> {
  return new Promise((ok) => s.emit(evt, data, ok));
}
const attendre = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

beforeAll(async () => {
  for (const [, id] of Object.entries(identites)) await service.preparer(id.uid, id.nom);
  await service.donnerBadgeCreateur('uid-crea');
  await service.donnerBadgeCreateur('uid-crea2');
  serveur = await demarrerServeur({
    port: 0,
    servirClient: false,
    comptes: service,
    casino: {
      tirageRoue: () => 3, // la case verte : le million
      hasardMachine: (n) => (arretsImposes ? arretsImposes[k++ % 5] : hasardGraine(n)),
      delaiEcriture: 40,
    },
  });
});
afterAll(async () => {
  await serveur.fermer();
});

describe('Salon privé de bout en bout', () => {
  it('reste introuvable pour les invités et les joueurs sans badge Créateur', async () => {
    const invite = connecter();
    for (const evt of ['casino_entrer', 'casino_vue', 'casino_roue', 'casino_machine']) {
      expect(await emettre(invite, evt, { mise: 1000 })).toEqual({ ok: false, erreur: 'Introuvable.' });
    }
    const nina = connecter();
    expect((await emettre(nina, 'identifier', { jeton: 'jeton-normal' })).ok).toBe(true);
    for (const evt of ['casino_entrer', 'casino_vue', 'casino_roue', 'casino_machine']) {
      expect(await emettre(nina, evt, { mise: 1000 })).toEqual({ ok: false, erreur: 'Introuvable.' });
    }
    expect((await stockage.lire('uid-normal'))?.casino).toBeUndefined();
    invite.close();
    nina.close();
  });

  it('ouvre le salon avec 1 000 000 $, la roulette du salon une fois par jour, et la machine sans jamais débiter deux fois', async () => {
    const s = connecter();
    expect((await emettre(s, 'identifier', { jeton: 'jeton-crea' })).ok).toBe(true);
    const entree = await emettre(s, 'casino_entrer');
    expect(entree.ok).toBe(true);
    expect(entree.casino).toMatchObject({ nom: 'Lucas', solde: SOLDE_DEPART, roueProchaine: null, toursGratuits: 0 });
    expect(entree.casino.riches[0]).toMatchObject({ nom: 'Lucas', solde: SOLDE_DEPART, moi: true });
    // Rien d'autre que le pseudo, l'avatar et le solde des autres créateurs.
    expect(JSON.stringify(entree.casino)).not.toMatch(/uid-|@/);

    // Roulette du salon : le million (case verte), puis plus rien jusqu'à demain.
    const roue = await emettre(s, 'casino_roue');
    expect(roue.roue).toEqual({ case: 3, gain: CASES_ROUE_SALON[3] });
    expect(roue.casino.solde).toBe(2_000_000);
    expect(roue.casino.roueProchaine).toBeGreaterThan(Date.now());
    expect((await emettre(s, 'casino_roue')).erreur).toMatch(/déjà tourné/);
    expect((await stockage.lire('uid-crea'))?.casino).toMatchObject({ solde: 2_000_000, roue: jourParis(Date.now()) });

    // Mises refusées : montant inventé.
    expect((await emettre(s, 'casino_machine', { mise: 1234 })).ok).toBe(false);
    expect((await emettre(s, 'casino_machine', { mise: -100_000 })).ok).toBe(false);
    // Deux appuis en même temps : un seul tour.
    const [a, b] = await Promise.all([emettre(s, 'casino_machine', { mise: 100_000 }), emettre(s, 'casino_machine', { mise: 100_000 })]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const tour = a.ok ? a : b;
    expect(tour.casino.solde).toBe(2_000_000 - 100_000 + tour.machine.gain);
    // Plusieurs tours : le solde suit exactement les mises et les gains, et finit écrit dans Firestore.
    let solde = tour.casino.solde;
    for (let i = 0; i < 12; i++) {
      await attendre(360);
      const r = await emettre(s, 'casino_machine', { mise: 10_000 });
      expect(r.ok).toBe(true);
      const debit = r.machine.gratuit ? 0 : 10_000;
      expect(r.casino.solde).toBe(solde - debit + r.machine.gain);
      solde = r.casino.solde;
    }
    expect((await emettre(s, 'casino_quitter')).ok).toBe(true);
    expect((await stockage.lire('uid-crea'))?.casino?.solde).toBe(solde);
    s.close();
  });

  it('donne les tours gratuits sans débiter, et refuse une mise plus grosse que le solde', async () => {
    // Tom n'a plus que 500 $ : aucune mise possible.
    await service.entrerCasino('uid-crea2');
    await service.mouvementCasino('uid-crea2', -(SOLDE_DEPART - 500));
    const s = connecter();
    expect((await emettre(s, 'identifier', { jeton: 'jeton-crea2' })).ok).toBe(true);
    expect((await emettre(s, 'casino_entrer')).casino.solde).toBe(500);
    expect((await emettre(s, 'casino_machine', { mise: 1000 })).erreur).toMatch(/Solde insuffisant/);
    await service.mouvementCasino('uid-crea2', 50_000);
    s.close();

    // Lucas déclenche le bonus : 3 Coffres.
    arretsImposes = trouverArrets((g) => g.flat().filter((x) => x === 'coffre').length === 3);
    k = 0;
    const l = connecter();
    expect((await emettre(l, 'identifier', { jeton: 'jeton-crea' })).ok).toBe(true);
    const entree = (await emettre(l, 'casino_entrer')).casino;
    expect(entree.toursGratuits).toBe(0);
    const avant = entree.solde;
    await attendre(360);
    const declenche = await emettre(l, 'casino_machine', { mise: 20_000 });
    expect(declenche.ok).toBe(true);
    expect(declenche.machine.toursGagnes).toBe(TOURS_GRATUITS);
    expect(declenche.casino).toMatchObject({ toursGratuits: TOURS_GRATUITS, miseGratuite: 20_000, solde: avant - 20_000 + declenche.machine.gain });
    await attendre(360);
    // Tour gratuit : la mise envoyée est ignorée, rien n'est débité, les gains comptent double.
    const gratuit = await emettre(l, 'casino_machine', { mise: 100_000 });
    expect(gratuit.machine).toMatchObject({ gratuit: true, mise: 20_000, gain: declenche.machine.gain * 2 });
    expect(gratuit.casino.solde).toBe(declenche.casino.solde + gratuit.machine.gain);
    expect(gratuit.casino.toursGratuits).toBe(TOURS_GRATUITS - 1 + TOURS_GRATUITS);
    arretsImposes = null;
    l.close();
  });

  it('relit le casino d’un compte en tolérant les valeurs abîmées', () => {
    expect(normaliserStats({ casino: { solde: -50, depuis: 3, roue: '2026-11-09' } })?.casino).toEqual({ solde: 0, depuis: 3, roue: '2026-11-09' });
    expect(normaliserStats({ casino: { solde: 1e20, depuis: 1 } })?.casino?.solde).toBe(1_000_000_000_000);
    expect(normaliserStats({ casino: 'non' })?.casino).toBeUndefined();
  });
});
