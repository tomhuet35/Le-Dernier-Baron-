import { describe, expect, it } from 'vitest';
import { lacherBille, moyenneParRubis, MULTIPLICATEURS_PLINKO } from '../shared/plinko';

describe('Plinko du Baron', () => {
  it('la case est le nombre de rebonds à droite, et le gain suit la mise', () => {
    const r = lacherBille(15, () => 0.9);
    expect(r.caseFinale).toBe(12);
    expect(r.gain).toBe(15 * 1_000_000 * 1000);
    expect(lacherBille(5, () => 0.1).caseFinale).toBe(0);
  });
  it('13 cases symétriques, environ 4,5 M$ par rubis en moyenne', () => {
    expect(MULTIPLICATEURS_PLINKO.length).toBe(13);
    expect([...MULTIPLICATEURS_PLINKO].reverse()).toEqual(MULTIPLICATEURS_PLINKO);
    const m = moyenneParRubis();
    expect(m > 4e6 && m < 5e6).toBe(true);
  });
});
