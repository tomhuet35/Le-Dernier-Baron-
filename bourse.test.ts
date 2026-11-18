import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  acheter,
  devisAchat,
  etatBourseNeuf,
  FRAIS,
  HISTORIQUE_MAX,
  IDS_ACTIONS,
  jouerSeance,
  normaliserEtatBourse,
  PLAFOND,
  PLANCHER,
  produitVente,
  SEANCE_MS,
  seancesEnRetard,
  valeurPortefeuille,
  vendre,
} from '../shared/bourse';

/** Hasard reproductible. */
function alea(graine = 7) {
  let x = graine;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
}

describe('Bourse de 1929 : les séances', () => {
  it('fait bouger les cours sans jamais sortir du plancher ni du plafond, sur des milliers de séances', () => {
    const e = etatBourseNeuf(0, 'j');
    const h = alea();
    let krachs = 0;
    let envolees = 0;
    let nouvelles = 0;
    for (let k = 1; k <= 20_000; k++) {
      const n = jouerSeance(e, k * SEANCE_MS, `j${Math.floor(k / 288)}`, h);
      if (n?.type === 'krach') krachs++;
      if (n?.type === 'envolee') envolees++;
      if (n) nouvelles++;
      for (const a of IDS_ACTIONS) {
        expect(e.cours[a] >= ACTIONS[a].reference * PLANCHER - 1).toBe(true);
        expect(e.cours[a] <= ACTIONS[a].reference * PLAFOND + 1).toBe(true);
      }
    }
    expect(krachs > 50 && krachs < 250).toBe(true);
    expect(envolees > 80 && envolees < 300).toBe(true);
    expect(nouvelles > 2000).toBe(true);
    expect(e.historique.wagons.length).toBe(HISTORIQUE_MAX);
    // En moyenne, les cours restent autour de leur référence (pas d'argent créé à l'infini).
    for (const a of IDS_ACTIONS) {
      const moyenne = e.historique[a].reduce((s, x) => s + x, 0) / e.historique[a].length;
      expect(moyenne < ACTIONS[a].reference * 3).toBe(true);
    }
  });

  it('compte les séances manquées (12 au plus)', () => {
    const e = etatBourseNeuf(0, 'j');
    expect(seancesEnRetard(e, 3 * SEANCE_MS + 10)).toBe(3);
    expect(seancesEnRetard(e, 100 * SEANCE_MS)).toBe(12);
  });

  it('relit un état gardé', () => {
    const e = etatBourseNeuf(0, 'j');
    jouerSeance(e, SEANCE_MS, 'j', alea(3));
    expect(normaliserEtatBourse(JSON.parse(JSON.stringify(e)), 0, 'j')).toEqual(e);
  });
});

describe('Bourse de 1929 : le portefeuille', () => {
  it('achète avec 1 % de frais, revend avec 1 % de frais', () => {
    const d = devisAchat(1_000_000, 100_000_000);
    expect(d.n).toBe(99);
    expect(d.total).toBe(Math.ceil(99 * 1_000_000 * (1 + FRAIS)));
    let p = acheter({}, 'wagons', d.n, d.total);
    expect(valeurPortefeuille(p, { ...ACTIONS_COURS(), wagons: 2_000_000 })).toBe(198_000_000);
    expect(produitVente(2_000_000, 99)).toBe(Math.floor(99 * 2_000_000 * 0.99));
    p = vendre(p, 'wagons', 33);
    expect(p.wagons).toEqual({ n: 66, cout: Math.round((d.total * 66) / 99) });
    p = vendre(p, 'wagons', 66);
    expect(p.wagons).toBeUndefined();
  });
});

function ACTIONS_COURS() {
  return Object.fromEntries(IDS_ACTIONS.map((a) => [a, ACTIONS[a].reference])) as Record<(typeof IDS_ACTIONS)[number], number>;
}
