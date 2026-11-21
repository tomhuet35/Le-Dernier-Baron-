import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authentificationTest, creerServiceComptes, stockageMemoire } from '../server/comptes';
import { demarrerServeur } from '../server/serveur';
import { SOLDE_DEPART } from '../shared/casino';
import { echelleToits, gainToits, multiplicateurToits, NIVEAUX_TOITS, RISQUE_TOITS, RTP_TOITS, SAUTS_TOITS, sautReussi, type VueToits } from '../shared/toits';

describe('Sur les toits : les multiplicateurs', () => {
  it('donne les multiplicateurs attendus', () => {
    expect(multiplicateurToits('promenade', 0)).toBe(1);
    expect(multiplicateurToits('promenade', 1)).toBe(1.05); // 0,97 / 0,92
    expect(multiplicateurToits('express', 1)).toBe(1.15); // 0,97 / 0,84
    expect(multiplicateurToits('rapide', 1)).toBe(1.34); // 0,97 / 0,72
    expect(multiplicateurToits('baron', 1)).toBe(1.73); // 0,97 / 0,56
    expect(multiplicateurToits('promenade', SAUTS_TOITS)).toBe(2.23);
    expect(multiplicateurToits('express', SAUTS_TOITS)).toBe(5.54);
    expect(multiplicateurToits('rapide', SAUTS_TOITS)).toBe(25.9);
    expect(multiplicateurToits('baron', SAUTS_TOITS)).toBe(319.8);
  });

  it('rend 97 % des mises, quelle que soit la façon de jouer', () => {
    for (const n of NIVEAUX_TOITS) {
      const e = echelleToits(n);
      expect(e).toHaveLength(SAUTS_TOITS);
      expect(e.every((x, i) => i === 0 || x > e[i - 1])).toBe(true);
      e.forEach((x, i) => {
        const chance = (1 - RISQUE_TOITS[n]) ** (i + 1);
        expect(chance * x).toBeLessThanOrEqual(RTP_TOITS + 1e-9);
        expect(chance * x).toBeGreaterThan(RTP_TOITS - 0.01 * chance - 1e-9); // seul l'arrondi au centième en retire
      });
    }
    expect(gainToits(10_000, 2.53)).toBe(25_300);
  });

  it('fait chuter dans la bonne proportion', () => {
    for (const n of NIVEAUX_TOITS) {
      let ratés = 0;
      for (let v = 0; v < 10_000; v++) if (!sautReussi(() => v, n)) ratés++;
      expect(ratés / 10_000).toBeCloseTo(RISQUE_TOITS[n], 6);
    }
  });
});

// ---------- Une partie de bout en bout ----------

const identites = { 'jeton-a': { uid: 'uid-a', nom: 'Lucas', email: 'a@gmail.com' } };
const stockage = stockageMemoire();
const service = creerServiceComptes({ configWeb: { apiKey: 'cle', authDomain: 'test.firebaseapp.com', projectId: 'test' }, authentification: authentificationTest(identites), stockage });
let serveur: Awaited<ReturnType<typeof demarrerServeur>>;
/** Les prochains tirages (sur 10 000 pour un saut, sur 2 pour l'obstacle). */
let tirages: number[] = [];
const connecter = () => io(`http://localhost:${serveur.port}`, { transports: ['websocket'], forceNew: true });
function emettre(s: Socket, evt: string, data?: unknown): Promise<any> {
  return new Promise((ok) => s.emit(evt, data, ok));
}

beforeAll(async () => {
  await service.preparer('uid-a', 'Lucas');
  await service.donnerBadgeCreateur('uid-a');
  serveur = await demarrerServeur({ port: 0, servirClient: false, comptes: service, casino: { jeuALaffiche: () => null, delaiEcriture: 30, hasardToits: (n) => Math.min(n - 1, tirages.shift() ?? n - 1) } });
});
afterAll(async () => {
  await serveur.fermer();
});

describe('Sur les toits en direct', () => {
  it('saute, paie à l’encaissement, perd sur une chute et s’encaisse au fourgon', async () => {
    const a = connecter();
    await emettre(a, 'identifier', { jeton: 'jeton-a' });
    await emettre(a, 'casino_entrer');
    expect((await emettre(a, 'casino_toits_lancer', { mise: 1234, niveau: 'express' })).erreur).toMatch(/Mise/);
    expect((await emettre(a, 'casino_toits_lancer', { mise: 10_000, niveau: 'fou' })).erreur).toMatch(/difficulté/);

    // Partie 1 : deux sauts réussis, puis on encaisse.
    const s = await emettre(a, 'casino_toits_lancer', { mise: 10_000, niveau: 'express' });
    expect(s.solde).toBe(SOLDE_DEPART - 10_000);
    expect((s.toits as VueToits).suivant).toBe(1.15);
    expect((await emettre(a, 'casino_toits_encaisser')).erreur).toMatch(/au moins/);
    tirages = [9_000, 5_000];
    await emettre(a, 'casino_toits_sauter');
    const s2 = await emettre(a, 'casino_toits_sauter');
    expect(s2.toits.sauts).toBe(2);
    expect(s2.toits.x).toBe(1.37);
    const e = await emettre(a, 'casino_toits_encaisser');
    expect(e.toits.etat).toBe('encaisse');
    expect(e.solde).toBe(SOLDE_DEPART - 10_000 + 13_700);

    // Partie 2 : la chute (tirage sous le risque), l'attelage casse.
    await emettre(a, 'casino_toits_lancer', { mise: 1_000, niveau: 'baron' });
    tirages = [100, 1];
    const perdu = await emettre(a, 'casino_toits_sauter');
    expect(perdu.toits).toMatchObject({ etat: 'perdu', gain: 0, obstacle: 'attelage', sauts: 0 });
    expect((await emettre(a, 'casino_toits_sauter')).ok).toBe(false);

    // Partie 3 : dix sauts, le fourgon s'encaisse tout seul.
    await emettre(a, 'casino_toits_lancer', { mise: 1_000, niveau: 'promenade' });
    tirages = Array(SAUTS_TOITS).fill(9_999);
    let r: any;
    for (let k = 0; k < SAUTS_TOITS; k++) r = await emettre(a, 'casino_toits_sauter');
    expect(r.toits).toMatchObject({ etat: 'encaisse', sauts: SAUTS_TOITS, gain: 2_230 });

    // La partie en cours attend le joueur.
    await emettre(a, 'casino_toits_lancer', { mise: 1_000, niveau: 'rapide' });
    await emettre(a, 'casino_quitter');
    await emettre(a, 'casino_entrer');
    expect((await emettre(a, 'casino_toits_vue')).toits.etat).toBe('enCours');
    expect((await emettre(a, 'casino_vue')).casino.toits.enCours).toBe(true);
    a.close();
  });
});
