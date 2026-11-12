import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authentificationTest, creerServiceComptes, stockageMemoire } from '../server/comptes';
import { demarrerServeur } from '../server/serveur';
import type { TirageImpose } from '../server/showFolleNuit';
import { SOLDE_DEPART } from '../shared/casino';
import {
  CASE_TOP_SLOT,
  CASES_CHASSE,
  CASES_FN,
  COLONNES_BILLES,
  NOMBRES_FN,
  PAIEMENT_NOMBRE,
  retourFN,
  ROUE_FN,
  SEGMENTS_FOLLE,
  tirerBilles,
  tirerChasse,
  tirerFolle,
  tirerManche,
  tirerPile,
  X_MAX_FN,
  X_TOP_SLOT,
  X_TOP_SLOT_HAPPY,
  happyHourFN,
  xPile,
  type HappyHourFN,
  type Hasard,
  type Manche,
  type VueFolleNuit,
} from '../shared/folleNuit';
import { suivant } from '../shared/rng';

/** Hasard rejouable (mulberry32), pour des tests stables. */
function hasardFixe(graine: number): Hasard {
  let s = graine;
  return (n: number) => {
    const [x, ns] = suivant(s);
    s = ns;
    return Math.floor(x * n);
  };
}

describe('La Folle Nuit : la roue et les gains', () => {
  it('a 54 cases, dans les bonnes proportions, sans deux cases pareilles côte à côte', () => {
    const compte: Record<string, number> = {};
    for (const c of ROUE_FN) compte[c] = (compte[c] ?? 0) + 1;
    expect(ROUE_FN).toHaveLength(54);
    expect(compte).toEqual({ '1': 21, '2': 13, '5': 7, '10': 4, pile: 4, chasse: 2, billes: 2, folle: 1 });
    ROUE_FN.forEach((c, i) => expect(c).not.toBe(ROUE_FN[(i + 1) % 54]));
  });

  it('paie le chiffre pour 1, multiplié par le Top Slot, et rien sur une autre case', () => {
    const manche = (c: string, top: { case: string; x: number } | null): Manche =>
      ({ topSlot: { touche: top, affiche: top ?? { case: '1', x: 2 } }, arret: ROUE_FN.indexOf(c as never), case: c, bonus: null }) as Manche;
    expect(retourFN('2', 1000, manche('2', null))).toBe(3000);
    expect(retourFN('2', 1000, manche('2', { case: '2', x: 5 }))).toBe(11_000);
    expect(retourFN('2', 1000, manche('2', { case: '10', x: 50 }))).toBe(3000);
    expect(retourFN('10', 1000, manche('2', null))).toBe(0);
    expect(retourFN('1', 25_000, manche('1', { case: '1', x: 7 }))).toBe(25_000 * 8);
  });

  it('joue chaque bonus avec ses règles (pièce, mur, bille, roue géante)', () => {
    const h = hasardFixe(42);
    for (let k = 0; k < 300; k++) {
      const p = tirerPile(h);
      expect(p.couronne).toBeGreaterThanOrEqual(p.chapeau);
      expect(xPile(p)).toBe(p.cote === 'couronne' ? p.couronne : p.chapeau);

      const c = tirerChasse(h);
      expect(c.valeurs).toHaveLength(CASES_CHASSE);
      expect(Math.min(...c.valeurs)).toBeGreaterThanOrEqual(5);

      const b = tirerBilles(h);
      expect(b.x).toBeGreaterThan(0);
      b.lancers.forEach((l, i) => {
        let col = l.depart;
        for (const pas of l.chemin) {
          col += pas;
          expect(col).toBeGreaterThanOrEqual(0);
          expect(col).toBeLessThan(COLONNES_BILLES);
        }
        expect(col).toBe(l.arrivee);
        // Tous les lancers sauf le dernier tombent sur DOUBLE, et doublent les cases du suivant.
        if (i < b.lancers.length - 1) {
          expect(l.cases[l.arrivee]).toBe(0);
          l.cases.forEach((v, j) => v && expect(b.lancers[i + 1].cases[j]).toBe(Math.min(X_MAX_FN, v * 2)));
        } else expect(l.cases[l.arrivee]).toBe(b.x);
      });

      const f = tirerFolle(h);
      expect(f.segments).toHaveLength(SEGMENTS_FOLLE);
      expect(f.segments.filter((s) => s === 'double')).toHaveLength(3);
      expect(f.segments.filter((s) => s === 'triple')).toHaveLength(1);
      expect(f.arrets.length).toBeGreaterThanOrEqual(1);
      expect(f.arrets.length).toBeLessThanOrEqual(6);
      for (const fl of f.fleches) {
        expect(fl.x).toBeGreaterThanOrEqual(10);
        expect(fl.x).toBeLessThanOrEqual(X_MAX_FN);
      }
    }
  });

  it('rend environ 97 % des mises sur chaque case (comme un vrai show)', () => {
    const tot = (t: [unknown, number][]) => t.reduce((s, [, p]) => s + p, 0);
    const ex = X_TOP_SLOT.reduce((s, [v, p]) => s + v * p, 0) / tot(X_TOP_SLOT);
    const pTop = (c: string) => (CASE_TOP_SLOT.find(([k]) => k === c)?.[1] ?? 0) / tot(CASE_TOP_SLOT as [unknown, number][]);
    const nb = (c: string) => ROUE_FN.filter((x) => x === c).length;
    for (const n of NOMBRES_FN) {
      const rtp = (nb(n) / 54) * (1 + PAIEMENT_NOMBRE[n] * (1 + pTop(n) * (ex - 1)));
      expect(rtp).toBeGreaterThan(0.97);
      expect(rtp).toBeLessThan(0.98);
    }
    // Les bonus : multiplicateur moyen sur un grand nombre de parties (Top Slot à part).
    const h = hasardFixe(7);
    const moyenne = (f: () => number, n: number) => Array.from({ length: n }, f).reduce((s, x) => s + x, 0) / n;
    expect(moyenne(() => xPile(tirerPile(h)), 20_000)).toBeGreaterThan(8.8);
    expect(moyenne(() => xPile(tirerPile(h)), 20_000)).toBeLessThan(10.2);
    const chasse = moyenne(() => tirerChasse(h).valeurs[h(CASES_CHASSE)], 40_000);
    expect(chasse).toBeGreaterThan(18);
    expect(chasse).toBeLessThan(22);
    const billes = moyenne(() => tirerBilles(h).x, 40_000);
    expect(billes).toBeGreaterThan(18);
    expect(billes).toBeLessThan(22.5);
    const folle = moyenne(() => tirerFolle(h).fleches[h(3)].x, 20_000);
    expect(folle).toBeGreaterThan(36);
    expect(folle).toBeLessThan(48);
  });

  it('donne un multiplicateur du Top Slot à chaque manche, de ×10 à ×100 pendant la Happy Hour', () => {
    expect(CASE_TOP_SLOT.every(([c]) => c !== null)).toBe(true);
    const h = hasardFixe(11);
    const normaux = new Set(X_TOP_SLOT.map(([x]) => x));
    for (let i = 0; i < 3000; i++) {
      const t = tirerManche(h).topSlot;
      expect(t.touche).not.toBeNull();
      expect(CASES_FN).toContain(t.touche!.case);
      expect(normaux.has(t.touche!.x)).toBe(true);
      expect(t.affiche).toEqual(t.touche);
    }
    const vus = new Set<number>();
    for (let i = 0; i < 3000; i++) {
      const x = tirerManche(h, undefined, true).topSlot.touche!.x;
      expect(x).toBeGreaterThanOrEqual(10);
      expect(x).toBeLessThanOrEqual(100);
      vus.add(x);
    }
    expect([...vus].sort((a, b) => a - b)).toEqual(X_TOP_SLOT_HAPPY.map(([x]) => x));
  });

  it('ouvre la Happy Hour de 11 h à 12 h, heure de Paris (hiver comme été)', () => {
    expect(happyHourFN(Date.parse('2026-11-12T10:30:00Z'))).toEqual({ active: true, reste: 30 * 60_000 }); // 11 h 30 à Paris (UTC+1)
    expect(happyHourFN(Date.parse('2026-07-01T09:15:00Z'))).toEqual({ active: true, reste: 45 * 60_000 }); // 11 h 15 (UTC+2)
    expect(happyHourFN(Date.parse('2026-11-12T09:00:00Z'))).toEqual({ active: false, reste: 60 * 60_000 }); // 10 h : dans une heure
    expect(happyHourFN(Date.parse('2026-11-12T11:00:00Z'))).toEqual({ active: false, reste: 23 * 3_600_000 }); // midi : demain
  });

  it('tire une manche complète, avec l’arrêt imposé si on le demande', () => {
    const h = hasardFixe(3);
    const m = tirerManche(h, { arret: ROUE_FN.indexOf('folle'), topSlot: { case: 'folle', x: 2 } });
    expect(m.case).toBe('folle');
    expect(m.bonus?.type).toBe('folle');
    expect(m.topSlot.touche).toEqual({ case: 'folle', x: 2 });
    if (m.bonus?.type !== 'folle') throw new Error();
    expect(retourFN('folle', 1000, m, 1)).toBe(1000 * (1 + Math.min(X_MAX_FN, m.bonus.folle.fleches[1].x * 2)));
  });
});

// ---------- Le show de bout en bout ----------

const identites = {
  'jeton-a': { uid: 'uid-a', nom: 'Lucas', email: 'a@gmail.com' },
  'jeton-b': { uid: 'uid-b', nom: 'Tom', email: 'b@gmail.com' },
  'jeton-n': { uid: 'uid-n', nom: 'Nina', email: 'n@gmail.com' },
};
const stockage = stockageMemoire();
const service = creerServiceComptes({ configWeb: { apiKey: 'cle', authDomain: 'test.firebaseapp.com', projectId: 'test' }, authentification: authentificationTest(identites), stockage });
let serveur: Awaited<ReturnType<typeof demarrerServeur>>;
let force: TirageImpose = undefined;
let happy: HappyHourFN = { active: false, reste: 3_600_000 };
const connecter = () => io(`http://localhost:${serveur.port}`, { transports: ['websocket'], forceNew: true });
function emettre(s: Socket, evt: string, data?: unknown): Promise<any> {
  return new Promise((ok) => s.emit(evt, data, ok));
}
function attendre(s: Socket, condition: (v: VueFolleNuit) => boolean): Promise<VueFolleNuit> {
  return new Promise((ok) => {
    const ecoute = (v: VueFolleNuit) => {
      if (!condition(v)) return;
      s.off('casino_fn', ecoute);
      ok(v);
    };
    s.on('casino_fn', ecoute);
  });
}

beforeAll(async () => {
  for (const id of Object.values(identites)) await service.preparer(id.uid, id.nom);
  await service.donnerBadgeCreateur('uid-a');
  await service.donnerBadgeCreateur('uid-b');
  serveur = await demarrerServeur({
    port: 0,
    servirClient: false,
    comptes: service,
    casino: {
      delaiEcriture: 30,
      delaisFolleNuit: { mises: 1200, fermeture: 200, topSlot: 40, roue: 40, resultat: 150, intro: 60, choix: 500, piece: 40, chasse: 40, bille: 20, tourFolle: 20, finBonus: 150 },
      tirageFolleNuit: () => force,
      happyHourFolleNuit: () => happy,
    },
  });
});
afterAll(async () => {
  await serveur.fermer();
});

describe('La Folle Nuit en direct', () => {
  it('reste introuvable sans badge Créateur', async () => {
    const n = connecter();
    await emettre(n, 'identifier', { jeton: 'jeton-n' });
    for (const evt of ['casino_fn_entrer', 'casino_fn_miser', 'casino_fn_choix']) expect((await emettre(n, evt, { case: '1', montant: 1000 })).erreur).toBe('Introuvable.');
    n.close();
  });

  it('fait miser deux créateurs, applique le Top Slot, joue la Chasse au butin et s’arrête quand plus personne ne regarde', async () => {
    const a = connecter();
    const b = connecter();
    await emettre(a, 'identifier', { jeton: 'jeton-a' });
    await emettre(b, 'identifier', { jeton: 'jeton-b' });
    // Sans être entré au salon, pas de show.
    expect((await emettre(a, 'casino_fn_entrer')).ok).toBe(false);
    await emettre(a, 'casino_entrer');
    await emettre(b, 'casino_entrer');

    // Manche 1 : la roue s'arrête sur un « 2 », le Top Slot y met ×5.
    force = { arret: ROUE_FN.indexOf('2'), topSlot: { case: '2', x: 5 } };
    const ea = await emettre(a, 'casino_fn_entrer');
    expect(ea.ok).toBe(true);
    expect(ea.show.phase).toBe('mises');
    await emettre(b, 'casino_fn_entrer');
    await attendre(a, (v) => v.phase === 'mises' && !v.closes);
    expect((await emettre(a, 'casino_fn_miser', { case: '7', montant: 1000 })).ok).toBe(false); // case inventée
    expect((await emettre(a, 'casino_fn_miser', { case: '2', montant: 1234 })).ok).toBe(false); // jeton inventé
    expect((await emettre(a, 'casino_fn_miser', { case: '2', montant: 100_000 })).ok).toBe(true);
    expect((await emettre(a, 'casino_fn_miser', { case: 'pile', montant: 25_000 })).ok).toBe(true);
    expect((await emettre(a, 'casino_fn_miser', { case: '2', montant: 500_000 })).erreur).toMatch(/500 000/);
    expect((await emettre(b, 'casino_fn_miser', { case: '1', montant: 5000 })).ok).toBe(true);
    expect((await emettre(b, 'casino_fn_miser', { case: '1', montant: 5000 })).ok).toBe(true);
    expect((await emettre(b, 'casino_fn_annuler')).ok).toBe(true); // retire le dernier jeton
    const r1 = await attendre(a, (v) => v.phase === 'resultat');
    expect(r1.arret).toBe(ROUE_FN.indexOf('2'));
    expect(r1.topSlot?.touche).toEqual({ case: '2', x: 5 });
    expect(r1.monGain).toBe(100_000 * 11 - 125_000);
    expect(r1.solde).toBe(SOLDE_DEPART + 100_000 * 11 - 125_000);
    expect(r1.joueurs.find((j) => j.nom === 'Tom')).toMatchObject({ mise: 5000, gain: -5000 });
    expect(r1.historique[0]).toEqual({ case: '2', x: 10 });

    // Manche 2 : la Chasse au butin. Lucas refait ses mises et ajoute la Chasse ; Tom regarde sans miser.
    force = { arret: ROUE_FN.indexOf('chasse'), topSlot: null };
    await attendre(a, (v) => v.phase === 'mises' && !v.closes);
    expect((await emettre(a, 'casino_fn_refaire')).ok).toBe(true);
    expect((await emettre(a, 'casino_fn_miser', { case: 'chasse', montant: 25_000 })).ok).toBe(true);
    const choix = await attendre(a, (v) => v.phase === 'choix');
    expect(choix.bonus?.type).toBe('chasse');
    if (choix.bonus?.type !== 'chasse') throw new Error();
    expect(choix.bonus.valeurs).toBeNull(); // rien n'est dévoilé avant la fin du choix
    expect((await emettre(b, 'casino_fn_choix', { index: 3 })).erreur).toMatch(/pas misé/);
    expect((await emettre(a, 'casino_fn_choix', { index: 200 })).ok).toBe(false);
    expect((await emettre(a, 'casino_fn_choix', { index: 7 })).ok).toBe(true);
    const fin = await attendre(a, (v) => v.phase === 'finBonus');
    if (fin.bonus?.type !== 'chasse' || !fin.bonus.valeurs) throw new Error();
    expect(fin.bonus.choix).toBe(7);
    const x = fin.bonus.valeurs[7];
    expect(fin.monGain).toBe(25_000 * (1 + x) - 150_000);
    expect(fin.historique[0]).toEqual({ case: 'chasse', x: Math.max(...fin.bonus.valeurs) });

    // Plus personne ne regarde : la manche en cours se termine, puis le show s'arrête.
    force = undefined;
    await emettre(a, 'casino_fn_quitter');
    await emettre(b, 'casino_fn_quitter');
    await new Promise((ok) => setTimeout(ok, 3500));
    expect((await emettre(a, 'casino_vue')).casino.folleNuit.enDirect).toBe(false);
    a.close();
    b.close();
  });

  it('pendant la Happy Hour, le Top Slot donne de ×10 à ×100 et la vue l’annonce', async () => {
    happy = { active: true, reste: 20 * 60_000 };
    force = undefined;
    const a = connecter();
    await emettre(a, 'identifier', { jeton: 'jeton-a' });
    await emettre(a, 'casino_entrer');
    const e = await emettre(a, 'casino_fn_entrer');
    expect(e.ok).toBe(true);
    expect(e.show.happyHour).toEqual({ active: true, reste: 20 * 60_000 });
    const v = await attendre(a, (x) => (x.phase === 'topSlot' || x.phase === 'roue') && !!x.topSlot);
    expect(v.topSlot?.touche?.x).toBeGreaterThanOrEqual(10);
    expect(v.topSlot?.touche?.x).toBeLessThanOrEqual(100);
    a.close();
    happy = { active: false, reste: 3_600_000 };
  });
});
