import { describe, expect, it } from 'vitest';
import { CASES_MINUIT, MAX_TOURS_MINUIT, esperanceMinuit, gainMinuit, parcoursMinuit, tirerToursMinuit } from '../shared/baronWheel';

describe('Roue de Minuit', () => {
  it('32 cases, ≈ ×23,8 par masque (≈ 97 % sur la case unique de la roue du Bal)', () => {
    expect(CASES_MINUIT.length).toBe(32);
    expect(esperanceMinuit()).toBeGreaterThan(23.6);
    expect(esperanceMinuit()).toBeLessThan(24);
    expect((esperanceMinuit() * 2.2) / 54).toBeCloseTo(0.97, 2);
  });
  it('Double puis Triple multiplient, et le masque garde son gain', () => {
    // Le masque du milieu (p = 1) lit la case r : 5 (Double), puis 21 (Triple), puis 11 (×200).
    const p = parcoursMinuit([5, 21, 11], 1);
    expect(p.facteurs).toEqual([1, 2, 6]);
    expect(p.gain).toBe(1200);
    expect(gainMinuit([0], 1)).toBe(3);
  });
  it('le tirage est honnête pour les trois masques', () => {
    let g = 3;
    const h = () => {
      g = (g * 16807) % 2147483647;
      return g / 2147483647;
    };
    const n = 600_000;
    const s = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const t = tirerToursMinuit(h);
      expect(t.length).toBeLessThanOrEqual(MAX_TOURS_MINUIT);
      for (let p = 0; p < 3; p++) s[p] += gainMinuit(t, p);
    }
    for (const x of s) expect(Math.abs(x / n - esperanceMinuit())).toBeLessThan(0.5);
  });
});
