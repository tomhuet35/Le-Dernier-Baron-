import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authentificationTest, creerServiceComptes, stockageMemoire } from '../server/comptes';
import { demarrerServeur } from '../server/serveur';
import { SOLDE_DEPART } from '../shared/casino';
import {
  chancesPlace,
  DUREES_COURSE,
  gainMiseCourse,
  NB_CHEVAUX,
  NOMS_CHEVAUX,
  progression,
  RTP_COURSE,
  scenarioCourse,
  tirerArrivee,
  tirerPartants,
  type VueCourse,
} from '../shared/course';

/** Un hasard reproductible (mulberry32). */
function graine(n: number) {
  let a = n >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('La Course des Écuries : les règles', () => {
  it('tire six partants aux noms différents, avec des cotes justes (95 % de l’inverse de leur chance)', () => {
    const h = graine(7);
    for (let k = 0; k < 500; k++) {
      const p = tirerPartants(h);
      expect(p).toHaveLength(NB_CHEVAUX);
      expect(new Set(p.map((x) => x.nom)).size).toBe(NB_CHEVAUX);
      expect(p.every((x) => NOMS_CHEVAUX.includes(x.nom))).toBe(true);
      expect(p.reduce((s, x) => s + x.chance, 0)).toBeCloseTo(1, 9);
      const q = chancesPlace(p.map((x) => x.chance));
      for (const [i, x] of p.entries()) {
        expect(x.chance).toBeGreaterThan(0.025);
        expect(x.cote).toBeGreaterThanOrEqual(1.1);
        expect(x.place).toBeGreaterThanOrEqual(1.05);
        expect(x.place).toBeLessThanOrEqual(x.cote);
        // Ce que rend chaque mise en moyenne : au plus 95 % (arrondi en faveur du salon), et pas beaucoup moins.
        expect(x.chance * x.cote).toBeLessThanOrEqual(RTP_COURSE + 1e-9);
        expect(x.chance * x.cote).toBeGreaterThan(0.85);
        if (x.place > 1.05) {
          expect(q[i] * x.place).toBeLessThanOrEqual(RTP_COURSE + 1e-9);
          expect(q[i] * x.place).toBeGreaterThan(0.93);
        }
      }
    }
  });

  it('tire l’arrivée selon les chances (le premier comme les deux premiers)', () => {
    const h = graine(11);
    const chances = [0.4, 0.25, 0.15, 0.1, 0.06, 0.04];
    const q = chancesPlace(chances);
    const premier = Array(6).fill(0);
    const place = Array(6).fill(0);
    const N = 60_000;
    for (let k = 0; k < N; k++) {
      const o = tirerArrivee(chances, h);
      expect(new Set(o).size).toBe(6);
      premier[o[0]]++;
      place[o[0]]++;
      place[o[1]]++;
    }
    for (let i = 0; i < 6; i++) {
      expect(premier[i] / N).toBeCloseTo(chances[i], 2);
      expect(place[i] / N).toBeCloseTo(q[i], 2);
    }
  });

  it('écrit un scénario qui respecte l’arrivée : chacun passe le poteau à son heure, sans jamais reculer', () => {
    const h = graine(3);
    for (let k = 0; k < 200; k++) {
      const ordre = tirerArrivee([0.3, 0.2, 0.2, 0.1, 0.1, 0.1], h);
      const s = scenarioCourse(ordre, h);
      const t0 = s.arrivees[ordre[0]];
      expect(t0).toBeGreaterThanOrEqual(DUREES_COURSE.gagnantMin);
      expect(t0).toBeLessThanOrEqual(DUREES_COURSE.gagnantMax);
      for (let r = 1; r < 6; r++) expect(s.arrivees[ordre[r]]).toBeGreaterThan(s.arrivees[ordre[r - 1]]);
      // Le peloton tient en moins de 2 secondes.
      expect(s.arrivees[ordre[5]] - t0).toBeLessThan(2000);
      for (let c = 0; c < 6; c++) {
        let avant = 0;
        for (let t = 0; t <= s.arrivees[c] + 3000; t += 37) {
          const p = progression(s, c, t);
          expect(p).toBeGreaterThanOrEqual(avant - 1e-12);
          avant = p;
        }
        expect(progression(s, c, s.arrivees[c] - 1)).toBeLessThan(1);
        expect(progression(s, c, s.arrivees[c])).toBeCloseTo(1, 9);
      }
      // À chaque arrivée, ceux qui ont passé le poteau sont exactement ceux qui devaient le passer.
      for (let r = 0; r < 6; r++) {
        const t = s.arrivees[ordre[r]];
        const passes = ordre.filter((c) => progression(s, c, t) >= 1 - 1e-12);
        expect(passes.sort()).toEqual(ordre.slice(0, r + 1).sort());
      }
    }
  });

  it('paie les mises gagnant et placé au dollar près', () => {
    const partants = [
      { nom: 'A', chance: 0.4, cote: 2.3, place: 1.35 },
      { nom: 'B', chance: 0.3, cote: 3.1, place: 1.62 },
      { nom: 'C', chance: 0.1, cote: 9.5, place: 3.07 },
      { nom: 'D', chance: 0.1, cote: 9.5, place: 3.07 },
      { nom: 'E', chance: 0.05, cote: 19, place: 7.2 },
      { nom: 'F', chance: 0.05, cote: 19, place: 7.2 },
    ];
    const ordre = [2, 0, 1, 3, 4, 5];
    expect(gainMiseCourse({ cheval: 2, type: 'gagnant', montant: 25_000 }, partants, ordre)).toBe(237_500);
    expect(gainMiseCourse({ cheval: 2, type: 'place', montant: 1_000 }, partants, ordre)).toBe(3_070);
    expect(gainMiseCourse({ cheval: 0, type: 'place', montant: 5_000 }, partants, ordre)).toBe(6_750);
    expect(gainMiseCourse({ cheval: 0, type: 'gagnant', montant: 5_000 }, partants, ordre)).toBe(0);
    expect(gainMiseCourse({ cheval: 1, type: 'place', montant: 5_000 }, partants, ordre)).toBe(0);
  });
});

// ---------- Des courses en direct ----------

const identites = {
  'jeton-a': { uid: 'uid-a', nom: 'Lucas', email: 'a@gmail.com' },
  'jeton-b': { uid: 'uid-b', nom: 'Léa', email: 'b@gmail.com' },
  'jeton-n': { uid: 'uid-n', nom: 'Nina', email: 'n@gmail.com' },
};
const service = creerServiceComptes({ configWeb: { apiKey: 'cle', authDomain: 'test.firebaseapp.com', projectId: 'test' }, authentification: authentificationTest(identites), stockage: stockageMemoire() });
let serveur: Awaited<ReturnType<typeof demarrerServeur>>;
/** L'arrivée des prochaines courses : le 3 (couloir 2), puis le 1 (couloir 0), puis les autres. */
let arrivee: number[] | undefined = [2, 0, 1, 3, 4, 5];
const connecter = () => io(`http://localhost:${serveur.port}`, { transports: ['websocket'], forceNew: true });
function emettre(s: Socket, evt: string, data?: unknown): Promise<any> {
  return new Promise((ok) => s.emit(evt, data, ok));
}
function attendre(s: Socket, cond: (v: VueCourse) => boolean, ms = 10_000): Promise<VueCourse> {
  return new Promise((ok, ko) => {
    const t = setTimeout(() => ko(new Error('vue attendue jamais reçue')), ms);
    const f = (v: VueCourse) => {
      if (!cond(v)) return;
      clearTimeout(t);
      s.off('casino_course', f);
      ok(v);
    };
    s.on('casino_course', f);
  });
}

beforeAll(async () => {
  for (const id of Object.values(identites)) await service.preparer(id.uid, id.nom);
  await service.donnerBadgeCreateur('uid-a');
  await service.donnerBadgeCreateur('uid-b');
  // Lucas a 10 000 000 $ (pour essayer les plafonds).
  await service.entrerCasino('uid-a');
  await service.mouvementCasino('uid-a', 9_000_000);
  serveur = await demarrerServeur({
    port: 0,
    servirClient: false,
    comptes: service,
    casino: {
      jeuALaffiche: () => null,
      delaiEcriture: 30,
      delaisCourse: { mises: 900, depart: 150, gagnantMin: 400, gagnantMax: 500, apres: 50, resultat: 500 },
      arriveeCourse: () => arrivee,
    },
  });
});
afterAll(async () => {
  await serveur.fermer();
});

describe('La Course des Écuries en direct', () => {
  it('reste introuvable sans badge Créateur', async () => {
    const n = connecter();
    await emettre(n, 'identifier', { jeton: 'jeton-n' });
    for (const evt of ['casino_course_entrer', 'casino_course_miser', 'casino_course_annuler', 'casino_course_doubler', 'casino_course_refaire']) {
      expect((await emettre(n, evt, { cheval: 0, type: 'gagnant', montant: 1000 })).erreur).toBe('Introuvable.');
    }
    n.close();
  });

  it('prend les mises, les plafonne, paie l’arrivée, puis refait et double les mises', async () => {
    const a = connecter();
    const b = connecter();
    await emettre(a, 'identifier', { jeton: 'jeton-a' });
    await emettre(b, 'identifier', { jeton: 'jeton-b' });
    expect((await emettre(a, 'casino_course_entrer')).ok).toBe(false); // pas encore au salon
    await emettre(a, 'casino_entrer');
    await emettre(b, 'casino_entrer');

    // Course 1
    const e = await emettre(a, 'casino_course_entrer');
    expect(e.ok).toBe(true);
    let v: VueCourse = e.course;
    if (v.phase !== 'mises' || (v.reste ?? 0) < 600) v = await attendre(a, (x) => x.phase === 'mises' && (x.reste ?? 0) > 600);
    expect(v.partants).toHaveLength(6);
    expect(v.scenario).toBeNull(); // l'arrivée reste secrète jusqu'au départ
    expect((await emettre(b, 'casino_course_entrer')).ok).toBe(true);
    expect((await emettre(a, 'casino_course_miser', { cheval: 2, type: 'gagnant', montant: 1234 })).erreur).toMatch(/Jeton/);
    expect((await emettre(a, 'casino_course_miser', { cheval: 6, type: 'gagnant', montant: 1000 })).erreur).toMatch(/introuvable/);
    expect((await emettre(a, 'casino_course_miser', { cheval: 1, type: 'trio', montant: 1000 })).erreur).toMatch(/introuvable/);
    // Plafond par mise : 1 000 000 $ sur un même cheval, même type.
    expect((await emettre(a, 'casino_course_miser', { cheval: 4, type: 'gagnant', montant: 500_000 })).ok).toBe(true);
    expect((await emettre(a, 'casino_course_miser', { cheval: 4, type: 'gagnant', montant: 500_000 })).ok).toBe(true);
    expect((await emettre(a, 'casino_course_miser', { cheval: 4, type: 'gagnant', montant: 1_000 })).erreur).toMatch(/1 000 000/);
    // Annuler la dernière, puis tout.
    await emettre(a, 'casino_course_annuler');
    await emettre(a, 'casino_course_annuler', { tout: true });
    // Tout est rendu (le million misé a pu faire passer un niveau du salon : son bonus reste acquis).
    const base = (await emettre(a, 'casino_vue')).casino.solde;
    expect(base - SOLDE_DEPART - 9_000_000).toBeGreaterThanOrEqual(0);
    expect(base - SOLDE_DEPART - 9_000_000).toBeLessThan(1_000_000);
    // Lucas : 100 000 $ gagnant sur le 3 (couloir 2) et 5 000 $ gagnant sur le 1. Léa : 25 000 $ placé sur le 1.
    await emettre(a, 'casino_course_miser', { cheval: 2, type: 'gagnant', montant: 100_000 });
    await emettre(a, 'casino_course_miser', { cheval: 0, type: 'gagnant', montant: 5_000 });
    const vueB = attendre(b, (x) => x.mesMises.length === 1);
    await emettre(b, 'casino_course_miser', { cheval: 0, type: 'place', montant: 25_000 });
    const vb = await vueB;
    expect(vb.joueurs.map((j) => j.nom).sort()).toEqual(['Lucas', 'Léa']);
    expect(vb.solde).toBe(SOLDE_DEPART - 25_000);
    expect((await emettre(a, 'casino_course_refaire')).erreur).toMatch(/Aucune/);

    const depart = await attendre(a, (x) => x.phase === 'depart');
    expect(depart.scenario).toBeNull();
    expect((await emettre(a, 'casino_course_miser', { cheval: 1, type: 'gagnant', montant: 1_000 })).erreur).toMatch(/fermées/);
    expect((await emettre(a, 'casino_course_annuler')).erreur).toMatch(/fermées/);
    const course = await attendre(a, (x) => x.phase === 'course');
    expect(course.scenario?.ordre).toEqual([2, 0, 1, 3, 4, 5]);
    expect(course.ecoule).toBeGreaterThanOrEqual(0);
    expect(course.monGain).toBeNull();

    const res = await attendre(a, (x) => x.phase === 'resultat');
    const p = res.partants;
    const gainA = Math.floor((100_000 * Math.round(p[2].cote * 100)) / 100);
    expect(res.monGain).toBe(gainA);
    expect(res.solde).toBe(base - 105_000 + gainA);
    expect(res.historique[0]).toEqual({ cheval: 2, nom: p[2].nom, cote: p[2].cote });
    const resB = await emettre(b, 'casino_vue');
    const gainB = Math.floor((25_000 * Math.round(p[0].place * 100)) / 100);
    expect(resB.casino.solde).toBe(SOLDE_DEPART - 25_000 + gainB);
    expect(res.joueurs.find((j) => j.nom === 'Léa')?.gain).toBe(gainB);
    expect(res.joueurs.find((j) => j.nom === 'Lucas')).toMatchObject({ mise: 105_000, gain: gainA, moi: true });

    // Course 2 : Lucas refait ses mises, les double, et l'arrivée change.
    arrivee = [5, 4, 3, 2, 1, 0];
    const v2 = await attendre(a, (x) => x.phase === 'mises' && x.numero === res.numero + 1);
    expect(v2.peutRefaire).toBe(true);
    expect(v2.mesMises).toEqual([]);
    expect((await emettre(a, 'casino_course_doubler')).erreur).toMatch(/Aucune/);
    expect((await emettre(a, 'casino_course_refaire')).ok).toBe(true);
    expect((await emettre(a, 'casino_course_refaire')).erreur).toMatch(/déjà/);
    const vueDoublee = attendre(a, (x) => x.mesMises.length === 4);
    expect((await emettre(a, 'casino_course_doubler')).ok).toBe(true);
    const doublee = await vueDoublee;
    expect(doublee.mesMises.reduce((s, m) => s + m.montant, 0)).toBe(210_000);
    const res2 = await attendre(a, (x) => x.phase === 'resultat' && x.numero === v2.numero);
    expect(res2.monGain).toBe(0);
    expect(res2.solde).toBe(res.solde - 210_000);
    expect(res2.historique.map((x) => x.cheval).slice(0, 2)).toEqual([5, 2]);

    // Le salon montre la course en direct.
    const salon = await emettre(a, 'casino_vue');
    expect(salon.casino.course).toMatchObject({ enDirect: true, spectateurs: 2 });
    expect(salon.casino.course.historique[0].cheval).toBe(5);
    a.close();
    b.close();
  }, 30_000);

  it('plafonne une course à 4 000 000 $', async () => {
    arrivee = [0, 1, 2, 3, 4, 5];
    const a = connecter();
    await emettre(a, 'identifier', { jeton: 'jeton-a' });
    await emettre(a, 'casino_entrer');
    let v: VueCourse = (await emettre(a, 'casino_course_entrer')).course;
    if (v.phase !== 'mises' || (v.reste ?? 0) < 600) v = await attendre(a, (x) => x.phase === 'mises' && (x.reste ?? 0) > 600);
    for (let c = 0; c < 4; c++) {
      expect(await emettre(a, 'casino_course_miser', { cheval: c, type: 'place', montant: 500_000 })).toEqual({ ok: true });
      expect(await emettre(a, 'casino_course_miser', { cheval: c, type: 'place', montant: 500_000 })).toEqual({ ok: true });
    }
    expect((await emettre(a, 'casino_course_miser', { cheval: 5, type: 'gagnant', montant: 1_000 })).erreur).toMatch(/4 000 000/);
    expect((await emettre(a, 'casino_course_doubler')).erreur).toMatch(/1 000 000|4 000 000/);
    await emettre(a, 'casino_course_annuler', { tout: true });
    a.close();
  }, 15_000);
});
