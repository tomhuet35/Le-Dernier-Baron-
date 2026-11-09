import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authentificationTest, creerServiceComptes, normaliserStats, stockageMemoire } from '../server/comptes';
import { demarrerServeur } from '../server/serveur';
import { CASES_ROUE_SALON, formatDollars, SOLDE_DEPART } from '../shared/casino';
import {
  BANDES,
  COUPS_DEPART_CASSE,
  esperanceCasse,
  evaluerMachine,
  gainCasse,
  gainSuite,
  GAINS_LIGNE,
  nouveauCasse,
  ouvrirCasse,
  ROUE_BARON,
  tauxDeRetour,
  tirerMachine,
  TOURS_GRATUITS,
  type ResultatMachine,
} from '../shared/machineASous';
import { jourParis } from '../shared/roulette';

// ---------- Machine à sous ----------

describe('Machine à sous « Le Bandit du Baron »', () => {
  it('rend 96 % des mises en moyenne (calcul exact, hors gros lot)', () => {
    const t = tauxDeRetour();
    expect(t.total).toBeGreaterThan(0.955);
    expect(t.total).toBeLessThan(0.965);
    expect(1 / t.pCasse).toBeGreaterThan(100); // le casse tombe environ une fois tous les 140 tours
    expect(1 / t.pCasse).toBeLessThan(200);
    expect(1 / t.pRoue).toBeGreaterThan(300); // la roue, environ une fois tous les 450 tours
    expect(1 / t.pRoue).toBeLessThan(700);
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

  it('lance le casse avec 3 Coffres, la roue avec une Couronne sur le premier et le dernier rouleau, et double les gains des tours gratuits', () => {
    const casse = evaluerMachine(trouverArrets((r) => r.coffres === 3), 10_000, false);
    expect(casse).toMatchObject({ coffres: 3, casse: true });
    expect(casse.gain).toBeGreaterThanOrEqual(2 * 10_000);
    const arretsRoue = trouverArrets((r) => r.grille[0].includes('couronne') && r.grille[4].includes('couronne'), true);
    expect(evaluerMachine(arretsRoue, 10_000, false).roue).toBe(true);
    const avecGain = trouverArrets((r) => r.gain > 0 && !r.casse && !r.roue);
    const normal = evaluerMachine(avecGain, 10_000, false);
    expect(normal.gain).toBeGreaterThan(0);
    expect(evaluerMachine(avecGain, 10_000, true).gain).toBe(normal.gain * 2);
    expect(ROUE_BARON.filter((c) => c.type === 'tours')).toEqual([{ type: 'tours', n: TOURS_GRATUITS }]);
    expect(ROUE_BARON.filter((c) => c.type === 'grosLot')).toHaveLength(1);
  });

  it('fait le casse : un coffre par coup, « +2 coups », lingots qui multiplient, arrêt sur la sirène', () => {
    // Mélange choisi : l'ordre reste celui de la liste (6 liasses, 2 lingots, 2 « +2 coups », 2 sirènes).
    const e = nouveauCasse((n) => n - 1);
    expect(e.coups).toBe(COUPS_DEPART_CASSE);
    expect(ouvrirCasse(e, 8)).toEqual({ type: 'coups' });
    expect(e.coups).toBe(COUPS_DEPART_CASSE - 1 + 2);
    expect(ouvrirCasse(e, 8)).toBeNull(); // déjà ouvert
    expect(ouvrirCasse(e, 6)).toEqual({ type: 'lingot' });
    expect(ouvrirCasse(e, 5)?.type).toBe('billets');
    expect(e).toMatchObject({ butin: e.contenus[5].type === 'billets' ? e.contenus[5].valeur : 0, multiplicateur: 2, fini: false });
    expect(ouvrirCasse(e, 10)).toEqual({ type: 'sirene' });
    expect(e).toMatchObject({ fini: true, sirene: true });
    expect(gainCasse(e)).toBe(e.butin * 2);
    expect(ouvrirCasse(e, 0)).toBeNull(); // le casse est fini
    // Gain moyen exact, confirmé par 20 000 casses joués au hasard.
    const h = graine(3);
    let total = 0;
    for (let i = 0; i < 20_000; i++) {
      const c = nouveauCasse(h);
      while (!c.fini) {
        const fermes = c.ouverts.map((o, k) => (o ? -1 : k)).filter((k) => k >= 0);
        ouvrirCasse(c, fermes[h(fermes.length)]);
      }
      total += gainCasse(c);
    }
    expect(Math.abs(total / 20_000 - esperanceCasse()) / esperanceCasse()).toBeLessThan(0.04);
  });

  it('reste proche de son taux de retour sur 30 000 tours tirés au hasard (bonus compris)', () => {
    const hasard = graine(7);
    let mise = 0;
    let gain = 0;
    const tour = (gratuit: boolean): number => {
      const r: ResultatMachine = tirerMachine(hasard, 1000, gratuit);
      let g = r.gain;
      let tours = 0;
      if (r.casse) {
        const c = nouveauCasse(hasard);
        while (!c.fini) {
          const fermes = c.ouverts.map((o, k) => (o ? -1 : k)).filter((k) => k >= 0);
          ouvrirCasse(c, fermes[hasard(fermes.length)]);
        }
        g += gainCasse(c) * 1000;
      }
      if (r.roue) {
        const c = ROUE_BARON[hasard(ROUE_BARON.length)];
        if (c.type === 'multiple') g += c.x * 1000;
        else if (c.type === 'tours') tours = c.n;
      }
      for (let k = 0; k < tours; k++) g += tour(true);
      return g;
    };
    for (let i = 0; i < 30_000; i++) {
      mise += 1000;
      gain += tour(false);
    }
    expect(gain / mise).toBeGreaterThan(0.75);
    expect(gain / mise).toBeLessThan(1.2);
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

/** Cherche des arrêts de rouleaux qui donnent un tirage voulu (en faisant varier les rouleaux 1 à 3, ou 1, 2 et 5). */
function trouverArrets(condition: (r: ResultatMachine) => boolean, extremes = false): number[] {
  for (let a = 0; a < BANDES[0].length; a++)
    for (let b = 0; b < BANDES[1].length; b++)
      for (let c = 0; c < (extremes ? BANDES[4].length : BANDES[2].length); c++) {
        const arrets = extremes ? [a, b, 5, 9, c] : [a, b, c, 5, 9];
        if (condition(evaluerMachine(arrets, 1, false))) return arrets;
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
      tirageRoueBaron: () => 10, // la case des tours gratuits
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

  it('fait jouer le casse et la Roue du Baron, puis les tours gratuits sans débiter ; refuse une mise plus grosse que le solde', async () => {
    // Tom n'a plus que 500 $ : aucune mise possible.
    await service.entrerCasino('uid-crea2');
    await service.mouvementCasino('uid-crea2', -(SOLDE_DEPART - 500));
    const s = connecter();
    expect((await emettre(s, 'identifier', { jeton: 'jeton-crea2' })).ok).toBe(true);
    expect((await emettre(s, 'casino_entrer')).casino.solde).toBe(500);
    expect((await emettre(s, 'casino_machine', { mise: 1000 })).erreur).toMatch(/Solde insuffisant/);
    s.close();

    // Lucas : 3 Coffres, le casse.
    arretsImposes = trouverArrets((r) => r.casse && !r.roue);
    k = 0;
    const l = connecter();
    expect((await emettre(l, 'identifier', { jeton: 'jeton-crea' })).ok).toBe(true);
    const entree = (await emettre(l, 'casino_entrer')).casino;
    expect(entree.bonus).toBeNull();
    await attendre(360);
    const declenche = await emettre(l, 'casino_machine', { mise: 20_000 });
    expect(declenche.machine.casse).toBe(true);
    expect(declenche.casino.bonus).toMatchObject({ type: 'casse', mise: 20_000, coups: 3, butin: 0, multiplicateur: 1 });
    expect(declenche.casino.bonus.ouverts.every((x: unknown) => x === null)).toBe(true); // rien n'est dévoilé à l'avance
    await attendre(360);
    expect((await emettre(l, 'casino_machine', { mise: 1000 })).erreur).toMatch(/bonus/);
    let solde = declenche.casino.solde;
    let fin: any = null;
    for (let i = 0; i < 12 && !fin; i++) {
      const r = await emettre(l, 'casino_casse', { index: i });
      expect(r.ok).toBe(true);
      if (r.casse.fini) fin = r;
      else expect(r.casino.solde).toBe(solde);
    }
    expect(fin.casse.gain).toBe(fin.casse.butin * fin.casse.multiplicateur * 20_000);
    expect(fin.casse.tout).toHaveLength(12);
    expect(fin.casino.solde).toBe(solde + fin.casse.gain);
    expect(fin.casino.bonus).toBeNull();
    expect((await emettre(l, 'casino_casse', { index: 0 })).ok).toBe(false);
    solde = fin.casino.solde;

    // Une Couronne sur le premier et le dernier rouleau : la roue, qui tombe sur les 10 tours gratuits.
    arretsImposes = trouverArrets((r) => r.roue && !r.casse, true);
    k = 0;
    await attendre(360);
    const roue = await emettre(l, 'casino_machine', { mise: 10_000 });
    expect(roue.machine.roue).toBe(true);
    expect(roue.casino.bonus).toEqual({ type: 'roue', mise: 10_000 });
    const tiree = await emettre(l, 'casino_roue_baron');
    expect(tiree.roueBaron).toMatchObject({ case: 10, tours: TOURS_GRATUITS, gain: 0 });
    expect(tiree.casino).toMatchObject({ toursGratuits: TOURS_GRATUITS, miseGratuite: 10_000, bonus: null });
    // Tour gratuit : la mise envoyée est ignorée, rien n'est débité, les gains comptent double.
    arretsImposes = null;
    await attendre(360);
    const gratuit = await emettre(l, 'casino_machine', { mise: 100_000 });
    expect(gratuit.machine).toMatchObject({ gratuit: true, mise: 10_000 });
    expect(gratuit.casino.toursGratuits).toBe(TOURS_GRATUITS - 1);
    expect(gratuit.casino.solde).toBe(tiree.casino.solde + gratuit.machine.gain);
    l.close();
  });

  it('relit le casino d’un compte en tolérant les valeurs abîmées', () => {
    expect(normaliserStats({ casino: { solde: -50, depuis: 3, roue: '2026-11-09' } })?.casino).toEqual({ solde: 0, depuis: 3, roue: '2026-11-09' });
    expect(normaliserStats({ casino: { solde: 1e20, depuis: 1 } })?.casino?.solde).toBe(1_000_000_000_000);
    expect(normaliserStats({ casino: 'non' })?.casino).toBeUndefined();
  });
});
