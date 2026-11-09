import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authentificationTest, creerServiceComptes, stockageMemoire } from '../server/comptes';
import { demarrerServeur } from '../server/serveur';
import {
  actionsPossibles,
  commencerDonne,
  etapeCroupier,
  finirAssurance,
  gainPlace,
  jouerBJ,
  nouveauSabot,
  repondreAssurance,
  strategieDeBase,
  totalMain,
  type CarteBJ,
  type DonneBJ,
  type MainBJ,
  type VueTableBJ,
} from '../shared/blackjack';
import { CADEAU_SALON, SOLDE_DEPART } from '../shared/casino';

/** Carte : rang 1 (As) à 13 (Roi). */
const c = (rang: number, couleur = 0): CarteBJ => couleur * 13 + rang - 1;
/** Sabot qui donne les cartes dans cet ordre (on tire par la fin). */
const sabotDe = (...cartes: CarteBJ[]) => [...cartes].reverse();
/** Le croupier joue jusqu'au bout. */
const finirCroupier = (d: DonneBJ, s: CarteBJ[]) => {
  while (etapeCroupier(d, s));
};
const main = (...cartes: CarteBJ[]): MainBJ => ({ cartes, mise: 1000, doublee: false, separee: false, finie: false, issue: null, gain: 0 });

describe('Blackjack : règles', () => {
  it('compte l’As pour 11 quand c’est possible', () => {
    expect(totalMain([c(1), c(13)])).toEqual({ total: 21, souple: true });
    expect(totalMain([c(1), c(1), c(9)])).toEqual({ total: 21, souple: true });
    expect(totalMain([c(1), c(6), c(10)])).toEqual({ total: 17, souple: false });
    expect(totalMain([c(10), c(6), c(9)])).toEqual({ total: 25, souple: false });
  });

  it('paie le blackjack 3 pour 2', () => {
    const s = sabotDe(c(1), c(9), c(13), c(7));
    const d = commencerDonne(s, [{ id: 'a', mise: 1000 }]);
    expect(d.phase).toBe('croupier');
    finirCroupier(d, s);
    expect(d.places[0].mains[0]).toMatchObject({ issue: 'blackjack', gain: 2500 });
  });

  it('fait rester le croupier sur un 17 souple, après la question de l’assurance', () => {
    const s = sabotDe(c(10), c(1), c(8), c(6));
    const d = commencerDonne(s, [{ id: 'a', mise: 1000 }]);
    expect(d.phase).toBe('assurance');
    expect(repondreAssurance(d, 'a', false)).toEqual({ ok: true, cout: 0 });
    finirAssurance(d);
    expect(d.phase).toBe('joueurs');
    jouerBJ(d, s, 'rester');
    finirCroupier(d, s);
    expect(d.croupier).toHaveLength(2);
    expect(d.places[0].mains[0]).toMatchObject({ issue: 'gagne', gain: 2000 });
  });

  it('double la mise pour une seule carte', () => {
    const s = sabotDe(c(5), c(10), c(6), c(7), c(10));
    const d = commencerDonne(s, [{ id: 'a', mise: 1000 }]);
    expect(actionsPossibles(d)).toContain('doubler');
    jouerBJ(d, s, 'doubler');
    finirCroupier(d, s);
    expect(d.places[0].mains[0]).toMatchObject({ cartes: [c(5), c(6), c(10)], mise: 2000, doublee: true, issue: 'gagne', gain: 4000 });
  });

  it('sépare une paire en deux mains (les As séparés reçoivent une seule carte, sans blackjack)', () => {
    const s = sabotDe(c(8), c(10), c(8, 1), c(7), c(3), c(10));
    const d = commencerDonne(s, [{ id: 'a', mise: 1000 }]);
    expect(actionsPossibles(d)).toContain('separer');
    jouerBJ(d, s, 'separer');
    expect(d.places[0].mains.map((m) => totalMain(m.cartes).total)).toEqual([11, 18]);
    jouerBJ(d, s, 'rester');
    jouerBJ(d, s, 'rester');
    finirCroupier(d, s);
    expect(d.places[0].mains.map((m) => m.issue)).toEqual(['perdu', 'gagne']);
    expect(gainPlace(d.places[0])).toBe(2000);

    const s2 = sabotDe(c(1), c(10), c(1, 2), c(8), c(13), c(12));
    const d2 = commencerDonne(s2, [{ id: 'a', mise: 1000 }]);
    jouerBJ(d2, s2, 'separer');
    expect(d2.phase).toBe('croupier'); // As séparés : une carte chacun, terminé
    finirCroupier(d2, s2);
    expect(d2.places[0].mains.map((m) => [m.issue, m.gain])).toEqual([
      ['gagne', 2000],
      ['gagne', 2000],
    ]);
  });

  it('rembourse l’assurance 2 pour 1 quand le croupier a blackjack', () => {
    const s = sabotDe(c(10), c(1), c(9), c(13));
    const d = commencerDonne(s, [{ id: 'a', mise: 1000 }]);
    expect(repondreAssurance(d, 'a', true)).toEqual({ ok: true, cout: 500 });
    finirAssurance(d);
    expect(d.phase).toBe('fin');
    expect(d.places[0].mains[0].issue).toBe('perdu');
    expect(gainPlace(d.places[0])).toBe(1500);
  });

  it('arrête la donne quand le croupier montre une carte à 10 et a blackjack (blackjack contre blackjack : égalité)', () => {
    const s = sabotDe(c(10), c(1, 1), c(13), c(9), c(13, 1), c(1, 2));
    const d = commencerDonne(s, [
      { id: 'a', mise: 1000 },
      { id: 'b', mise: 1000 },
    ]);
    expect(d.phase).toBe('fin');
    expect(d.places.map((p) => p.mains[0].issue)).toEqual(['perdu', 'egalite']);
    expect(d.places.map(gainPlace)).toEqual([0, 1000]);
  });

  it('ne fait pas tirer le croupier quand toutes les mains ont sauté', () => {
    const s = sabotDe(c(10), c(10), c(6), c(5), c(10));
    const d = commencerDonne(s, [{ id: 'a', mise: 1000 }]);
    jouerBJ(d, s, 'tirer');
    expect(d.places[0].mains[0].issue).toBe('saute');
    finirCroupier(d, s);
    expect(d.croupier).toHaveLength(2);
    expect(gainPlace(d.places[0])).toBe(0);
  });

  it('fait jouer les bots selon la stratégie de base', () => {
    const toutes = ['tirer', 'rester', 'doubler', 'separer'] as const;
    expect(strategieDeBase(main(c(10), c(6)), c(10), [...toutes])).toBe('tirer');
    expect(strategieDeBase(main(c(10), c(6)), c(6), [...toutes])).toBe('rester');
    expect(strategieDeBase(main(c(5), c(6)), c(6), [...toutes])).toBe('doubler');
    expect(strategieDeBase(main(c(5), c(6), c(0 + 1)), c(6), ['tirer', 'rester'])).toBe('rester'); // 12 contre 6
    expect(strategieDeBase(main(c(1), c(1)), c(10), [...toutes])).toBe('separer');
    expect(strategieDeBase(main(c(1), c(7)), c(9), [...toutes])).toBe('tirer');
    expect(strategieDeBase(main(c(10), c(10)), c(6), [...toutes])).toBe('rester');
  });

  it('mélange un sabot de 6 jeux complets', () => {
    let a = 5;
    const s = nouveauSabot((n) => {
      a = (a * 48271) % 2147483647;
      return a % n;
    });
    expect(s).toHaveLength(312);
    expect(new Set(s).size).toBe(52);
    expect(s.filter((x) => x === c(1)).length).toBe(6);
  });
});

// ---------- Une table à deux créateurs et un bot ----------

const identites = {
  'jeton-a': { uid: 'uid-a', nom: 'Lucas', email: 'a@gmail.com' },
  'jeton-b': { uid: 'uid-b', nom: 'Tom', email: 'b@gmail.com' },
  'jeton-n': { uid: 'uid-n', nom: 'Nina', email: 'n@gmail.com' },
};
const stockage = stockageMemoire();
const service = creerServiceComptes({ configWeb: { apiKey: 'cle', authDomain: 'test.firebaseapp.com', projectId: 'test' }, authentification: authentificationTest(identites), stockage });
let serveur: Awaited<ReturnType<typeof demarrerServeur>>;
const connecter = () => io(`http://localhost:${serveur.port}`, { transports: ['websocket'], forceNew: true });
function emettre(s: Socket, evt: string, data?: unknown): Promise<any> {
  return new Promise((ok) => s.emit(evt, data, ok));
}

beforeAll(async () => {
  for (const id of Object.values(identites)) await service.preparer(id.uid, id.nom);
  await service.donnerBadgeCreateur('uid-a');
  await service.donnerBadgeCreateur('uid-b');
  let graine = 11;
  serveur = await demarrerServeur({
    port: 0,
    servirClient: false,
    comptes: service,
    casino: {
      delaiEcriture: 30,
      finCadeau: Date.now() + 3_600_000,
      delaisTables: { mises: 2000, decision: 1500, assurance: 400, bot: 20, croupier: 15, pause: 150 },
      sabotBlackjack: () =>
        nouveauSabot((n) => {
          graine = (graine * 48271) % 2147483647;
          return graine % n;
        }),
    },
  });
});
afterAll(async () => {
  await serveur.fermer();
});

/** Joue « rester » à chaque tour et refuse l'assurance ; renvoie la première vue de fin de donne. */
function jouerJusquALaFin(s: Socket): Promise<VueTableBJ> {
  return new Promise((ok) => {
    const ecoute = (v: VueTableBJ) => {
      if (v.actions.length) void emettre(s, 'casino_bj_action', { type: 'rester' });
      if (v.assurance) void emettre(s, 'casino_bj_assurance', { oui: false });
      if (v.phase === 'fin') {
        s.off('casino_bj', ecoute);
        ok(v);
      }
    };
    s.on('casino_bj', ecoute);
  });
}

describe('Table de blackjack de bout en bout', () => {
  it('reste introuvable sans badge Créateur', async () => {
    const n = connecter();
    await emettre(n, 'identifier', { jeton: 'jeton-n' });
    expect(await emettre(n, 'casino_bj_creer', { bots: 1 })).toEqual({ ok: false, erreur: 'Introuvable.' });
    expect(await emettre(n, 'casino_bj_rejoindre', { code: 'ABCD' })).toEqual({ ok: false, erreur: 'Introuvable.' });
    n.close();
  });

  it('fait jouer deux créateurs et un bot à la même table, et règle chaque donne au dollar près', async () => {
    const a = connecter();
    const b = connecter();
    await emettre(a, 'identifier', { jeton: 'jeton-a' });
    await emettre(b, 'identifier', { jeton: 'jeton-b' });
    // Il faut être entré au salon.
    expect((await emettre(a, 'casino_bj_creer', { bots: 1 })).ok).toBe(false);
    await emettre(a, 'casino_entrer');
    await emettre(b, 'casino_entrer');
    const creee = await emettre(a, 'casino_bj_creer', { bots: 1 });
    expect(creee.ok).toBe(true);
    const code: string = creee.table.code;
    expect(creee.table).toMatchObject({ phase: 'mises', hote: true, solde: SOLDE_DEPART });
    expect(creee.table.places.map((p: { bot: boolean }) => p.bot)).toEqual([false, true]);
    const rejoint = await emettre(b, 'casino_bj_rejoindre', { code });
    expect(rejoint.table.places).toHaveLength(3);
    // La table apparaît dans le salon.
    expect((await emettre(b, 'casino_vue')).casino.tables[0]).toMatchObject({ code, max: 5 });
    expect((await emettre(b, 'casino_vue')).casino.tables[0].joueurs.filter((j: { bot: boolean }) => !j.bot).map((j: { nom: string }) => j.nom)).toEqual(['Lucas', 'Tom']);

    // Mises refusées : trop petite, trop grosse.
    expect((await emettre(a, 'casino_bj_miser', { montant: 500 })).ok).toBe(false);
    expect((await emettre(a, 'casino_bj_miser', { montant: 300_000 })).ok).toBe(false);

    const soldes: Record<string, number> = { 'uid-a': creee.table.solde, 'uid-b': rejoint.table.solde };
    for (let donne = 0; donne < 3; donne++) {
      const finA = jouerJusquALaFin(a);
      const finB = jouerJusquALaFin(b);
      // Les deux misent : la donne part tout de suite.
      expect((await emettre(a, 'casino_bj_miser', { montant: 10_000 })).ok).toBe(true);
      expect((await emettre(b, 'casino_bj_miser', { montant: 20_000 })).ok).toBe(true);
      const [va, vb] = await Promise.all([finA, finB]);
      for (const [v, uid] of [
        [va, 'uid-a'],
        [vb, 'uid-b'],
      ] as const) {
        const moi = v.places.find((p) => p.moi)!;
        const mise = moi.mains.reduce((s, m) => s + m.mise, 0) + moi.assurance;
        expect(moi.gainTotal).not.toBeNull();
        expect(v.croupier.every((x) => x !== null)).toBe(true);
        // Le solde suit exactement : avant la donne − mises (doublements et assurance compris) + ce qui revient.
        expect(v.solde).toBe(soldes[uid] - mise + moi.gainTotal!);
        soldes[uid] = v.solde;
      }
      // Attendre la donne suivante (mises ouvertes).
      await new Promise<void>((ok) => {
        const f = (v: VueTableBJ) => v.phase === 'mises' && (a.off('casino_bj', f), ok());
        a.on('casino_bj', f);
      });
    }
    // Les comptes : chaque solde écrit est celui de la dernière vue.
    const vueA: VueTableBJ = (await emettre(a, 'casino_bj_rejoindre', { code })).table;
    await emettre(a, 'casino_bj_quitter');
    await emettre(a, 'casino_quitter');
    expect((await stockage.lire('uid-a'))?.casino?.solde).toBe(vueA.solde);
    a.close();
    b.close();
  }, 30_000);

  it('donne le cadeau du Baron une seule fois', async () => {
    const s = connecter();
    await emettre(s, 'identifier', { jeton: 'jeton-b' });
    const entree = (await emettre(s, 'casino_entrer')).casino;
    expect(entree.cadeau).toMatchObject({ montant: CADEAU_SALON.montant });
    const r = await emettre(s, 'casino_cadeau');
    expect(r.ok).toBe(true);
    expect(r.casino.solde).toBe(entree.solde + 9_000_000);
    expect(r.casino.cadeau).toBeNull();
    expect((await emettre(s, 'casino_cadeau')).ok).toBe(false);
    expect((await stockage.lire('uid-b'))?.casino?.cadeaux).toEqual([CADEAU_SALON.id]);
    expect(await service.recupererCadeauCasino('uid-b', CADEAU_SALON.id, 9_000_000)).toBe('deja');
    s.close();
  });
});
