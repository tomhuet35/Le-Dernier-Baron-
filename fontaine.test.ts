import { describe, expect, it } from 'vitest';
import { COUPES_FONTAINE, chanceCoupeFontaine, coupeFinaleFontaine, esperanceFontaine, gainFontaine, tirerCheminFontaine } from '../shared/baronWheel';

describe('Fontaine de champagne', () => {
  it('vaut à peu près ×6,2 en moyenne (97 % avec la petite roue)', () => {
    expect(COUPES_FONTAINE.reduce((a, _, k) => a + chanceCoupeFontaine(k), 0)).toBeCloseTo(1, 9);
    expect(esperanceFontaine()).toBeGreaterThan(6.1);
    expect(esperanceFontaine()).toBeLessThan(6.3);
  });
  it('le tirage suit les chances', () => {
    let g = 1;
    const h = () => {
      g = (g * 16807) % 2147483647;
      return g / 2147483647;
    };
    const n = 200_000;
    const c = Array(COUPES_FONTAINE.length).fill(0);
    let s = 0;
    for (let i = 0; i < n; i++) {
      const ch = tirerCheminFontaine(h);
      c[coupeFinaleFontaine(ch)]++;
      s += gainFontaine(ch);
    }
    c.forEach((x, k) => expect(x / n).toBeCloseTo(chanceCoupeFontaine(k), 2));
    expect(s / n).toBeCloseTo(esperanceFontaine(), 0);
  });
});
