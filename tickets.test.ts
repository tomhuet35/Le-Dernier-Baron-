import { describe, expect, it } from 'vitest';
import { lotsTicket, MODELES_TICKETS, rtpTicket, TICKETS, tirerTicket } from '../shared/tickets';

const hasardDe = (graine: number) => {
  let s = graine >>> 0;
  const suivant = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  return { hasard: (n: number) => Math.floor(suivant() * n), u: suivant };
};

describe('Les Tickets du Baron', () => {
  it('chaque ticket rend entre 92 et 95 % des mises', () => {
    for (const m of MODELES_TICKETS) {
      const r = rtpTicket(m);
      expect(r > 0.92 && r < 0.95).toBe(true);
    }
  });

  it('un ticket gagnant a exactement un brelan ; un perdant n’en a aucun', () => {
    const { hasard, u } = hasardDe(7);
    let gagnants = 0;
    let rendu = 0;
    const n = 40_000;
    for (let i = 0; i < n; i++) {
      const t = tirerTicket('veinard', i, hasard, u);
      expect(t.cases.length).toBe(9);
      const compte = new Map<number, number>();
      for (const x of t.cases) compte.set(x, (compte.get(x) ?? 0) + 1);
      const brelans = [...compte.entries()].filter(([, c]) => c >= 3);
      expect(brelans.length).toBe(t.gain > 0 ? 1 : 0);
      if (t.gain > 0) {
        gagnants++;
        expect(t.gagnantes.length).toBe(3);
        const lot = t.cases[t.gagnantes[0]];
        expect(t.gain).toBe(TICKETS.veinard.prix * lot * (t.coupDouble === null ? 1 : 2));
      } else expect(t.coupDouble).toBe(null);
      rendu += t.gain;
    }
    const taux = gagnants / n;
    expect(taux > 0.22 && taux < 0.29).toBe(true);
    expect(rendu / (n * TICKETS.veinard.prix) < 1.1).toBe(true);
  });

  it('le gros lot existe pour chaque ticket', () => {
    expect(lotsTicket('baron').at(-1)?.x).toBe(5_000);
    expect(lotsTicket('veinard').at(-1)?.x).toBe(1_000);
  });
});
