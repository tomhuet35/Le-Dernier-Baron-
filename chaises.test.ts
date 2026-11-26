import { describe, expect, it } from 'vitest';
import { GAINS_CHAISES, esperanceChaises, gainChaises, tirerOrdreChaises } from '../shared/baronWheel';

describe('Chaises musicales', () => {
  it('chaque invité vaut ×12 en moyenne (≈ 97 % sur la roue du Bal)', () => {
    expect(esperanceChaises()).toBe(12);
    expect((esperanceChaises() * 2.2 * 2) / 54).toBeCloseTo(0.978, 2);
  });
  it("l'ordre est une permutation équitable", () => {
    let g = 7;
    const h = () => {
      g = (g * 16807) % 2147483647;
      return g / 2147483647;
    };
    const n = 200_000;
    const rang = [0, 0, 0, 0].map(() => [0, 0, 0, 0]);
    let s = 0;
    for (let i = 0; i < n; i++) {
      const o = tirerOrdreChaises(h);
      expect([...o].sort()).toEqual([0, 1, 2, 3]);
      o.forEach((inv, r) => rang[inv][r]++);
      s += gainChaises(o, 2);
    }
    rang.forEach((l) => l.forEach((x) => expect(x / n).toBeCloseTo(0.25, 2)));
    expect(s / n).toBeCloseTo(12, 0);
    expect(GAINS_CHAISES[3]).toBe(30);
  });
});
