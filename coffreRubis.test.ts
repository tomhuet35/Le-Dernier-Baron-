import { describe, expect, it } from 'vitest';
import { GROS_LOT_COFFRE_RUBIS, LOTS_COFFRE_RUBIS, ouvrirCoffreRubis } from '../shared/coffreRubis';

describe('Coffre-fort aux rubis', () => {
  it('les chances font 100 %', () => {
    expect(Math.round(LOTS_COFFRE_RUBIS.reduce((s, l) => s + l.p, 0) * 1000)).toBe(1000);
  });
  it('le gain suit la mise, gros lot compris', () => {
    expect(ouvrirCoffreRubis(5, () => 0).gain).toBe(5_000_000);
    expect(ouvrirCoffreRubis(50, () => 0.995).gain).toBe(GROS_LOT_COFFRE_RUBIS * 10);
    expect(ouvrirCoffreRubis(15, () => 0.5).gain).toBe(30_000_000);
  });
});
