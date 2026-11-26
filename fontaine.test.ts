import { describe, expect, it } from 'vitest';
import { COUPES_FONTAINE, MAX_VERSEMENTS_FONTAINE, chanceCoupeFontaine, coupeFinaleFontaine, esperanceFontaine, estDoubleFontaine, gainFontaine, multiFontaine, tirerVersementsFontaine } from '../shared/baronWheel';

describe('Fontaine de champagne', () => {
  it('vaut à peu près ×6,2 en moyenne, relances comprises (97 % avec la petite roue)', () => {
    expect(COUPES_FONTAINE.reduce<number>((a, _, k) => a + chanceCoupeFontaine(k), 0)).toBeCloseTo(1, 9);
    expect(esperanceFontaine()).toBeGreaterThan(6.1);
    expect(esperanceFontaine()).toBeLessThan(6.3);
  });
  it('une coupe Double fait reverser, les multiplicateurs doublent', () => {
    expect(multiFontaine(0, 0)).toBe(100);
    expect(multiFontaine(0, 2)).toBe(400);
    expect(multiFontaine(1, 3)).toBe('double');
    // Double, puis ×5 : ×10.
    expect(gainFontaine([[1, 0, 0, 0, 0, 0, 0], [1, 1, 0, 0, 0, 0, 0]])).toBe(10);
  });
  it('le tirage suit les chances', () => {
    let g = 1;
    const h = () => {
      g = (g * 16807) % 2147483647;
      return g / 2147483647;
    };
    const n = 400_000;
    const c = Array(COUPES_FONTAINE.length).fill(0);
    let s = 0;
    let relances = 0;
    for (let i = 0; i < n; i++) {
      const v = tirerVersementsFontaine(h);
      expect(v.length).toBeLessThanOrEqual(MAX_VERSEMENTS_FONTAINE);
      v.slice(0, -1).forEach((ch) => expect(estDoubleFontaine(coupeFinaleFontaine(ch))).toBe(true));
      c[coupeFinaleFontaine(v[0])]++;
      relances += v.length - 1;
      s += gainFontaine(v);
    }
    c.forEach((x, k) => expect(x / n).toBeCloseTo(chanceCoupeFontaine(k), 2));
    expect(relances / n).toBeCloseTo(0.109 / (1 - 0.109), 2);
    expect(Math.abs(s / n - esperanceFontaine())).toBeLessThan(0.15);
  });
});
