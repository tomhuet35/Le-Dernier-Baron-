import { describe, expect, it } from 'vitest';
import { etatSalonVide, normaliserEtatSalon, rafraichirContrats } from '../shared/contrats';
import {
  cadeauSemaine,
  carteMembre,
  carteSuivante,
  COFFRE_COMPLET,
  COFFRE_PARTIEL,
  etageDuJeu,
  ETAGES,
  happyHour,
  jeuOuvert,
  jourSemaineParis,
  PART_RISTOURNE,
  ristourne,
} from '../shared/hotel';
import { JEUX_CASINO } from '../shared/profilCasino';

/** Un instant donné en heure de Paris (hiver : UTC + 1). */
const paris = (j: number, h: number, min = 0) => Date.UTC(2026, 10, j, h - 1, min);

describe('Grand Hôtel : les étages', () => {
  it('place chaque jeu à un étage, et ouvre les étages par niveau', () => {
    for (const j of JEUX_CASINO) expect(ETAGES.some((e) => e.jeux.includes(j))).toBe(true);
    expect(etageDuJeu('machine')).toBe('bar');
    expect(etageDuJeu('blackjack')).toBe('tables');
    expect(etageDuJeu('baronWheel')).toBe('scene');
    expect(jeuOuvert(1, 'machine')).toBe(true);
    expect(jeuOuvert(4, 'roulette')).toBe(false);
    expect(jeuOuvert(5, 'roulette')).toBe(true);
    expect(jeuOuvert(14, 'course')).toBe(false);
    expect(jeuOuvert(15, 'course')).toBe(true);
  });
});

describe('Grand Hôtel : la carte de membre', () => {
  it('suit le niveau et multiplie la roulette du salon', () => {
    expect(carteMembre(1).id).toBe('bronze');
    expect(carteMembre(19).id).toBe('bronze');
    expect(carteMembre(20)).toMatchObject({ id: 'argent', roue: 1.5 });
    expect(carteMembre(45)).toMatchObject({ id: 'or', roue: 2 });
    expect(carteMembre(100)).toMatchObject({ id: 'noire', roue: 3 });
    expect(carteSuivante(25)!.id).toBe('or');
    expect(carteSuivante(80)).toBeNull();
  });

  it('rend 5 % des pertes de la semaine à la carte noire seulement', () => {
    expect(ristourne(70, 1_000_000_000, 400_000_000)).toBe(600_000_000 * PART_RISTOURNE);
    expect(ristourne(69, 1_000_000_000, 400_000_000)).toBe(0);
    expect(ristourne(90, 100, 500)).toBe(0);
  });
});

describe('Grand Hôtel : l’heure de Paris', () => {
  it('donne le jour de la semaine (lundi 0 … dimanche 6)', () => {
    expect(jourSemaineParis(paris(16, 0, 30))).toBe(0); // lundi 16 novembre 2026, 0 h 30
    expect(jourSemaineParis(paris(22, 23, 59))).toBe(6); // dimanche 22, 23 h 59
    expect(jourSemaineParis(paris(23, 0, 1))).toBe(0);
  });

  it('place la happy hour entre 21 h et 22 h, et annonce la suivante', () => {
    const h = happyHour(paris(18, 20));
    expect(h.enCours).toBe(false);
    expect(h.debut).toBe(paris(18, 21));
    expect(happyHour(paris(18, 21, 30))).toEqual({ debut: paris(18, 21), fin: paris(18, 22), enCours: true });
    const apres = happyHour(paris(18, 22, 5));
    expect(apres.enCours).toBe(false);
    expect(apres.debut).toBe(paris(19, 21));
    // Été (UTC + 2) : toujours 21 h à Paris.
    expect(new Date(happyHour(Date.UTC(2026, 6, 10, 12)).debut).toISOString()).toBe('2026-07-10T19:00:00.000Z');
  });
});

describe('Grand Hôtel : la Semaine du Baron', () => {
  it('donne un cadeau par jour, et un gros coffre le dimanche si la semaine est complète', () => {
    expect(cadeauSemaine(0, 1, []).rubis).toBe(1);
    expect(cadeauSemaine(2, 10, []).rubis).toBe(2);
    expect(cadeauSemaine(6, 1, [0, 1, 2, 3, 4, 5]).rubis).toBe(COFFRE_COMPLET.rubis);
    expect(cadeauSemaine(6, 1, [0, 1, 3, 4, 5]).rubis).toBe(COFFRE_PARTIEL.rubis);
  });

  it('repart à zéro chaque lundi', () => {
    const e = etatSalonVide();
    rafraichirContrats(e, 'u', '2026-11-18', '2026-S47', 1);
    e.semaineBaron.pris = [0, 1, 2];
    rafraichirContrats(e, 'u', '2026-11-19', '2026-S47', 1);
    expect(e.semaineBaron.pris).toEqual([0, 1, 2]);
    rafraichirContrats(e, 'u', '2026-11-23', '2026-S48', 1);
    expect(e.semaineBaron).toEqual({ semaine: '2026-S48', pris: [] });
    e.pertes = { semaine: '2026-S48', mise: 10, gain: 3 };
    e.champagne = '2026-11-23';
    expect(normaliserEtatSalon(JSON.parse(JSON.stringify(e)))).toEqual(e);
  });
});
