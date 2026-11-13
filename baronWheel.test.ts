import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authentificationTest, creerServiceComptes, stockageMemoire } from '../server/comptes';
import { demarrerServeur } from '../server/serveur';
import { SOLDE_DEPART, type AnnonceCasino } from '../shared/casino';
import {
  CASES_BW,
  choixDuBonusBW,
  COMPOSITION_BW,
  DEGRES_CASE_BW,
  etapesBonusBW,
  gainBW,
  GAINS_CHIFFRES_BW,
  NB_CASES_BW,
  recompenseBonusBW,
  ROUE_BW,
  rtpBW,
  simulerBW,
  tirerBonusBW,
  type CaseBW,
  type VueBW,
} from '../shared/baronWheel';

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

describe('The Baron’s Wheel : les règles', () => {
  it('a exactement 40 cases de 9°, dans la composition du cahier des charges, sans deux bonus pareils côte à côte', () => {
    expect(ROUE_BW).toHaveLength(NB_CASES_BW);
    expect(DEGRES_CASE_BW).toBe(9);
    for (const c of CASES_BW) expect(ROUE_BW.filter((x) => x === c)).toHaveLength(COMPOSITION_BW[c]);
    expect(Object.values(COMPOSITION_BW).reduce((s, x) => s + x, 0)).toBe(40);
    for (let i = 0; i < 40; i++) expect(ROUE_BW[i]).not.toBe(ROUE_BW[(i + 1) % 40]);
  });

  it('rend environ 95 % de chaque mise (calcul exact), quel que soit l’itinéraire de la Grande Évasion', () => {
    const r = rtpBW();
    for (const c of CASES_BW) {
      expect(r[c]).toBeGreaterThan(0.935);
      expect(r[c]).toBeLessThan(0.96);
    }
    for (const v of Object.values(r.routes)) {
      expect(v).toBeGreaterThan(0.945);
      expect(v).toBeLessThan(0.96);
    }
  });

  it('simule 100 000 manches : fréquences, retour, jackpots rares', () => {
    const s = simulerBW(100_000, graine(5));
    for (const c of CASES_BW) expect(s.frequences[c] / s.manches).toBeCloseTo(COMPOSITION_BW[c] / 40, 2);
    expect(s.retourTotal).toBeGreaterThan(0.9);
    expect(s.retourTotal).toBeLessThan(1);
    expect(s.jackpots.grand).toBeLessThan(s.jackpots.mini);
    expect(s.volatilite).toBeGreaterThan(1);
  });

  it('cache les récompenses dans les bonus et paie le choix du joueur', () => {
    const h = graine(9);
    for (let k = 0; k < 300; k++) {
      const p = tirerBonusBW('pickpocket', h);
      if (p.type !== 'pickpocket') throw new Error();
      expect(p.mallettes).toContain(p.butin);
      expect(p.mallettes.filter((x) => x === p.butin).length).toBeGreaterThanOrEqual(1);
      const b = tirerBonusBW('braquage', h);
      if (b.type !== 'braquage') throw new Error();
      expect([...b.code].sort()).toEqual([1, 1, 2]);
      expect([...b.meca].sort()).toEqual([1, 1, 1, 1, 1, 2, 2, 3]);
      const r = recompenseBonusBW(b, [0, 0, 0]);
      expect(r.x).toBe(b.coffre[0].jackpot ? b.coffre[0].x : b.code[0] * b.meca[0] * b.coffre[0].x);
    }
    expect(choixDuBonusBW('braquage')).toEqual([3, 8, 4]);
    expect(etapesBonusBW('evasion').map((e) => e.nom)).toEqual(['intro', 'route', 'poursuite', 'revele']);
    expect(recompenseBonusBW({ type: 'evasion', routes: [{ evade: false, x: 10 }, { evade: true, x: 25 }, { evade: true, x: 100 }] }, [0])).toEqual({ x: 0, evade: false });
    expect(gainBW(25_000, 9.5)).toBe(237_500);
    expect(gainBW(1_000, 4.7)).toBe(4_700);
  });
});

// ---------- En direct ----------

const identites = {
  'jeton-a': { uid: 'uid-a', nom: 'Lucas', email: 'a@gmail.com' },
  'jeton-b': { uid: 'uid-b', nom: 'Léa', email: 'b@gmail.com' },
  'jeton-n': { uid: 'uid-n', nom: 'Nina', email: 'n@gmail.com' },
};
const service = creerServiceComptes({ configWeb: { apiKey: 'cle', authDomain: 'test.firebaseapp.com', projectId: 'test' }, authentification: authentificationTest(identites), stockage: stockageMemoire() });
let serveur: Awaited<ReturnType<typeof demarrerServeur>>;
let arretImpose: number | undefined;
let ouverture: number | null = null;
const indice = (c: CaseBW, k = 0) => ROUE_BW.map((x, i) => (x === c ? i : -1)).filter((i) => i >= 0)[k];
const connecter = () => io(`http://localhost:${serveur.port}`, { transports: ['websocket'], forceNew: true });
function emettre(s: Socket, evt: string, data?: unknown): Promise<any> {
  return new Promise((ok) => s.emit(evt, data, ok));
}
function attendre(s: Socket, cond: (v: VueBW) => boolean, ms = 12_000): Promise<VueBW> {
  return new Promise((ok, ko) => {
    const t = setTimeout(() => ko(new Error('vue attendue jamais reçue')), ms);
    const f = (v: VueBW) => {
      if (!cond(v)) return;
      clearTimeout(t);
      s.off('casino_bw', f);
      ok(v);
    };
    s.on('casino_bw', f);
  });
}
const etape = (v: VueBW) => (v.bonus ? v.bonus.etapes[v.bonus.etape].nom : null);
/** Attend l'ouverture des mises d'une nouvelle manche, avec du temps devant soi. */
async function nouvelleManche(a: Socket, apres = 0) {
  return attendre(a, (x) => x.phase === 'mises' && x.numero > apres && (x.reste ?? 0) > 500);
}

beforeAll(async () => {
  for (const id of Object.values(identites)) await service.preparer(id.uid, id.nom);
  await service.donnerBadgeCreateur('uid-a');
  await service.donnerBadgeCreateur('uid-b');
  await service.entrerCasino('uid-a');
  await service.mouvementCasino('uid-a', 9_000_000);
  serveur = await demarrerServeur({
    port: 0,
    servirClient: false,
    comptes: service,
    casino: {
      jeuALaffiche: () => null,
      cadeaux: [],
      delaiEcriture: 30,
      delaisBaronWheel: { mises: 900, tour: 250, resultat: 300, intro: 80, choix: 700, serrure: 700, etape: 80, vol: 80, poursuite: 80, revele: 150 },
      arretBaronWheel: () => arretImpose,
      ouvertureBaronWheel: () => ouverture,
    },
  });
});
afterAll(async () => {
  await serveur.fermer();
});

describe('The Baron’s Wheel en direct', () => {
  it('reste introuvable sans badge Créateur', async () => {
    const n = connecter();
    await emettre(n, 'identifier', { jeton: 'jeton-n' });
    for (const evt of ['casino_bw_entrer', 'casino_bw_miser', 'casino_bw_annuler', 'casino_bw_doubler', 'casino_bw_refaire', 'casino_bw_choisir', 'casino_bw_journal']) {
      expect((await emettre(n, evt, { case: 'x1', montant: 1000 })).erreur).toBe('Introuvable.');
    }
    n.close();
  });

  it('prend les mises, s’arrête sur la case tirée et paie les chiffres', async () => {
    const a = connecter();
    await emettre(a, 'identifier', { jeton: 'jeton-a' });
    expect((await emettre(a, 'casino_bw_entrer')).ok).toBe(false); // pas encore au salon
    await emettre(a, 'casino_entrer');
    const e = await emettre(a, 'casino_bw_entrer');
    expect(e.ok).toBe(true);
    let v: VueBW = e.roue;
    if (v.phase !== 'mises' || (v.reste ?? 0) < 500) v = await nouvelleManche(a);
    expect(v.arret).toBeNull();
    expect(v.dore).toBeNull(); // pas de grande ouverture
    expect((await emettre(a, 'casino_bw_miser', { case: 'x5', montant: 1234 })).erreur).toMatch(/Jeton/);
    expect((await emettre(a, 'casino_bw_miser', { case: 'x3', montant: 1000 })).erreur).toMatch(/introuvable/);
    // Plafonds : 1 000 000 $ par case.
    await emettre(a, 'casino_bw_miser', { case: 'x1', montant: 500_000 });
    await emettre(a, 'casino_bw_miser', { case: 'x1', montant: 500_000 });
    expect((await emettre(a, 'casino_bw_miser', { case: 'x1', montant: 1_000 })).erreur).toMatch(/1 000 000/);
    await emettre(a, 'casino_bw_annuler', { tout: true });
    // Tout est rendu (le million misé a pu faire passer un niveau du salon : son bonus reste acquis).
    const base = (await emettre(a, 'casino_vue')).casino.solde;
    expect(base).toBeGreaterThanOrEqual(v.solde);
    // 25 000 $ sur le 5X, 5 000 $ sur le Baron ; la roue s'arrêtera sur un 5X.
    arretImpose = indice('x5', 2);
    await emettre(a, 'casino_bw_miser', { case: 'x5', montant: 25_000 });
    await emettre(a, 'casino_bw_miser', { case: 'baron', montant: 5_000 });
    await emettre(a, 'casino_bw_miser', { case: 'x10', montant: 1_000 });
    await emettre(a, 'casino_bw_annuler'); // retire le dernier jeton (le 10X)
    const tour = await attendre(a, (x) => x.phase === 'tour');
    expect(tour.mesMises).toEqual({ x5: 25_000, baron: 5_000 });
    expect((await emettre(a, 'casino_bw_miser', { case: 'x1', montant: 1_000 })).erreur).toMatch(/fermées/);
    // La roue tourne de 5 tours et plus, et s'arrête avec la case tirée sous l'aiguille.
    expect(tour.tour!.arrivee - tour.tour!.depart).toBeGreaterThanOrEqual(5 * 360);
    const sous = Math.floor((((-tour.tour!.arrivee % 360) + 360) % 360) / DEGRES_CASE_BW);
    expect(sous).toBe(arretImpose);
    expect(tour.arret).toBe(arretImpose);
    const res = await attendre(a, (x) => x.phase === 'resultat');
    expect(res.bonus).toBeNull();
    expect(res.bilan).toEqual({ mise: 30_000, gain: gainBW(25_000, GAINS_CHIFFRES_BW.x5) });
    expect(res.solde).toBe(base - 30_000 + 237_500);
    expect(res.historique[0]).toEqual({ c: 'x5' });
    const j = await emettre(a, 'casino_bw_journal');
    expect(j.journal.manches[0]).toMatchObject({ c: 'x5', mise: 30_000, gain: 237_500, solde: res.solde });
    expect(j.journal.moi).toMatchObject({ manches: 1, mise: 30_000, gain: 237_500 });
    // Manche suivante : Refaire, puis Doubler.
    const v2 = await nouvelleManche(a, res.numero);
    expect(v2.peutRefaire).toBe(true);
    arretImpose = indice('x1');
    expect((await emettre(a, 'casino_bw_refaire')).ok).toBe(true);
    expect((await emettre(a, 'casino_bw_doubler')).ok).toBe(true);
    const r2 = await attendre(a, (x) => x.phase === 'resultat' && x.numero === v2.numero);
    expect(r2.bilan).toEqual({ mise: 60_000, gain: 0 });
    a.close();
  }, 30_000);

  it('joue le Pickpocket : la récompense reste cachée jusqu’à la fin, chacun choisit sa mallette', async () => {
    const a = connecter();
    const b = connecter();
    await emettre(a, 'identifier', { jeton: 'jeton-a' });
    await emettre(b, 'identifier', { jeton: 'jeton-b' });
    await emettre(a, 'casino_entrer');
    await emettre(b, 'casino_entrer');
    await emettre(a, 'casino_bw_entrer');
    await emettre(b, 'casino_bw_entrer');
    const v = await nouvelleManche(a);
    arretImpose = indice('pickpocket', 1);
    await emettre(a, 'casino_bw_miser', { case: 'pickpocket', montant: 100_000 });
    await emettre(b, 'casino_bw_miser', { case: 'pickpocket', montant: 5_000 });
    await emettre(b, 'casino_bw_miser', { case: 'x2', montant: 5_000 });
    const vol = await attendre(a, (x) => etape(x) === 'vol');
    expect(vol.bonus!.butin).toBeGreaterThanOrEqual(10);
    expect(vol.bonus!.mallettes).toEqual([null, null, null]);
    expect((await emettre(a, 'casino_bw_choisir', { etape: vol.bonus!.etape, choix: 0 })).erreur).toMatch(/Trop tard/);
    const choix = await attendre(a, (x) => etape(x) === 'mallettes');
    expect(choix.bonus!.mallettes).toEqual([null, null, null]); // toujours cachées pendant le choix
    expect((await emettre(a, 'casino_bw_choisir', { etape: choix.bonus!.etape, choix: 3 })).erreur).toMatch(/impossible/);
    expect((await emettre(a, 'casino_bw_choisir', { etape: choix.bonus!.etape, choix: 2 })).ok).toBe(true);
    expect((await emettre(a, 'casino_bw_choisir', { etape: choix.bonus!.etape, choix: 1 })).erreur).toMatch(/déjà/);
    // Léa ne choisit pas : le serveur choisira pour elle.
    const revele = await attendre(a, (x) => etape(x) === 'revele');
    const mallettes = revele.bonus!.mallettes as number[];
    expect(mallettes).toContain(vol.bonus!.butin);
    expect(revele.bonus!.mesChoix).toEqual([2]);
    expect(revele.bonus!.resultat).toMatchObject({ x: mallettes[2], gain: gainBW(100_000, mallettes[2]) });
    const fin = await attendre(a, (x) => x.phase === 'resultat' && x.numero === v.numero);
    expect(etape(fin)).toBe('revele'); // pendant les résultats, le bonus reste sur sa révélation
    expect(fin.bilan).toEqual({ mise: 100_000, gain: gainBW(100_000, mallettes[2]) });
    const finB = (await emettre(b, 'casino_bw_journal')).journal.manches[0];
    expect([0, 1, 2].map((k) => gainBW(5_000, mallettes[k]))).toContain(finB.gain);
    expect(fin.joueurs.map((x) => x.nom).sort()).toEqual(['Lucas', 'Léa']);
    a.close();
    b.close();
  }, 30_000);

  it('joue le Braquage : code × mécanisme × coffre', async () => {
    const a = connecter();
    await emettre(a, 'identifier', { jeton: 'jeton-a' });
    await emettre(a, 'casino_entrer');
    await emettre(a, 'casino_bw_entrer');
    const v = await nouvelleManche(a);
    arretImpose = indice('braquage', 3);
    await emettre(a, 'casino_bw_miser', { case: 'braquage', montant: 25_000 });
    const choisis = [1, 6, 3];
    for (const [r, nom] of (['code', 'mecanisme', 'coffre'] as const).entries()) {
      const x = await attendre(a, (y) => etape(y) === nom);
      expect((await emettre(a, 'casino_bw_choisir', { etape: x.bonus!.etape, choix: choisis[r] })).ok).toBe(true);
      if (nom === 'mecanisme') expect(x.bonus!.code!.every((c) => c !== null)).toBe(true); // le code est déjà révélé
    }
    const fin = await attendre(a, (x) => x.phase === 'resultat' && x.numero === v.numero);
    const bz = fin.bonus!;
    const coffre = bz.coffre![3]!;
    const x = coffre.jackpot ? coffre.x : bz.code![1]! * bz.meca![6]! * coffre.x;
    expect(bz.resultat).toMatchObject({ x, gain: gainBW(25_000, x) });
    expect(fin.bilan).toEqual({ mise: 25_000, gain: gainBW(25_000, x) });
    a.close();
  }, 30_000);

  it('pendant la grande ouverture, la case dorée paie double et le salon l’annonce', async () => {
    ouverture = Date.now() + 3_600_000;
    const a = connecter();
    const annonces: AnnonceCasino[] = [];
    await emettre(a, 'identifier', { jeton: 'jeton-a' });
    a.on('casino_annonce', (x: AnnonceCasino) => annonces.push(x));
    await emettre(a, 'casino_entrer');
    const salon = (await emettre(a, 'casino_vue')).casino;
    expect(salon.baronWheel.ouverture).toBeGreaterThan(3_500_000);
    await emettre(a, 'casino_bw_entrer');
    const v = await nouvelleManche(a);
    expect(v.dore).not.toBeNull();
    expect(v.ouverture).toBeGreaterThan(0);
    const c = ROUE_BW[v.dore!];
    arretImpose = v.dore!;
    await emettre(a, 'casino_bw_miser', { case: c, montant: 100_000 });
    const fin = await attendre(a, (x) => x.phase === 'resultat' && x.numero === v.numero);
    expect(fin.historique[0]).toEqual({ c, dore: true });
    if (c.startsWith('x')) expect(fin.bilan!.gain).toBe(2 * gainBW(100_000, GAINS_CHIFFRES_BW[c as 'x1']));
    else expect(fin.bilan!.gain).toBe(2 * gainBW(100_000, fin.bonus!.resultat!.x));
    ouverture = null;
    expect(SOLDE_DEPART).toBeGreaterThan(0);
    a.close();
  }, 40_000);
});
