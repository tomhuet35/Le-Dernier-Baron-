import { describe, expect, it } from 'vitest';
import { etatSalonVide, normaliserEtatSalon } from '../shared/contrats';
import { avatarCasino, TENUES, tenue } from '../shared/tailleur';

describe('Le Tailleur', () => {
  it('a 11 tenues aux numéros 10 à 20, en dollars puis en rubis', () => {
    expect(TENUES.map((t) => t.n)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(tenue(20)).toMatchObject({ monnaie: 'rubis', prix: 300 });
    expect(tenue(9)).toBeNull();
  });

  it('montre la tenue portée au salon, sinon le personnage du compte', () => {
    const e = etatSalonVide();
    expect(avatarCasino(3, e)).toBe(3);
    e.tenues = [12];
    e.tenue = 12;
    expect(avatarCasino(3, e)).toBe(12);
    e.tenue = 15;
    expect(avatarCasino(3, e)).toBe(3);
  });

  it('relit les tenues et écarte ce qui n’existe pas', () => {
    const e = normaliserEtatSalon({ tenues: [10, 10, 4, 99, 17], tenue: 4 });
    expect(e.tenues).toEqual([10, 17]);
    expect(e.tenue).toBeNull();
    expect(normaliserEtatSalon({ tenues: [17], tenue: 17 }).tenue).toBe(17);
  });
});
