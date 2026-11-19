import { describe, expect, it } from 'vitest';
import { authentificationTest, casinoEntame, creerServiceComptes, stockageMemoire } from '../server/comptes';
import { SOLDE_DEPART } from '../shared/casino';

const service = () => {
  const stockage = stockageMemoire();
  const comptes = creerServiceComptes({ configWeb: { apiKey: 'k', authDomain: 'd', projectId: 'p' }, authentification: authentificationTest({}), stockage });
  return { stockage, comptes };
};

describe('Invités du casino', () => {
  it('la progression d’un invité passe sur un compte neuf, une seule fois', async () => {
    const { stockage, comptes } = service();
    await comptes.preparer('invite-1', null, 'Invité 1234');
    await comptes.preparer('alice', 'Alice');
    await comptes.entrerCasino('invite-1');
    await comptes.mouvementCasino('invite-1', 250_000, 0, { activite: { mise: { machine: 3 }, gain: {} } } as never);
    stockage.donnees.get('invite-1')!.casino!.amis = ['bob'];
    expect(await comptes.transfererCasino('invite-1', 'alice')).toBe('fait');
    const alice = await comptes.lire('alice');
    expect(alice?.casino?.solde).toBe(SOLDE_DEPART + 250_000);
    expect(alice?.casino?.amis).toBeUndefined();
    expect((await comptes.lire('invite-1'))?.casino).toBeUndefined();
    expect(await comptes.transfererCasino('invite-1', 'alice')).toBe('vide');
  });

  it('un compte qui a déjà joué garde sa progression', async () => {
    const { comptes } = service();
    await comptes.preparer('invite-2', null, 'Invité');
    await comptes.preparer('bob', 'Bob');
    await comptes.entrerCasino('invite-2');
    await comptes.entrerCasino('bob');
    await comptes.mouvementCasino('bob', 10, 0, { activite: { mise: { machine: 1 }, gain: {} } } as never);
    expect(casinoEntame((await comptes.lire('bob'))?.casino)).toBe(true);
    expect(await comptes.transfererCasino('invite-2', 'bob')).toBe('deja');
    expect(!!(await comptes.lire('invite-2'))?.casino).toBe(true);
  });
});
