import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import { demarrerServeur } from '../server/serveur';
import { actionRobot, PRENOMS_BOTS } from '../shared/robot';
import type { VueSalon } from '../shared/types';

let serveur: Awaited<ReturnType<typeof demarrerServeur>>;
const url = () => `http://localhost:${serveur.port}`;

beforeAll(async () => {
  serveur = await demarrerServeur({ port: 0, delaiFinDePli: 5, delaiRobot: 5, servirClient: false });
});
afterAll(async () => {
  await serveur.fermer();
});

function emettre(s: Socket, evt: string, data?: unknown): Promise<any> {
  return new Promise((ok) => s.emit(evt, data, ok));
}

describe('Serveur de bout en bout', () => {
  it('trois téléphones jouent une partie complète, chacun ne voyant que sa main', async () => {
    const noms = ['Alice', 'Bruno', 'Chloé'];
    const sockets = noms.map(() => io(url(), { transports: ['websocket'], forceNew: true }));
    const dernieres: (VueSalon | null)[] = [null, null, null];
    const fuites: string[] = [];
    const fin = sockets.map(
      (s, i) =>
        new Promise<VueSalon>((termine) => {
          let enCours = false;
          const agir = async () => {
            if (enCours) return;
            enCours = true;
            for (let k = 0; k < 20; k++) {
              const p = dernieres[i]?.partie;
              const action = p && p.phase !== 'FIN_DE_PARTIE' ? actionRobot(p) : null;
              if (!action) break;
              const r = await emettre(s, 'action', action);
              if (!r.ok && dernieres[i]?.partie === p) break;
            }
            enCours = false;
          };
          s.on('salon', (v: VueSalon) => {
            dernieres[i] = v;
            const p = v.partie;
            if (!p) return;
            if (JSON.stringify(p.joueurs).includes('"main"')) fuites.push(noms[i]);
            if (p.phase === 'FIN_DE_PARTIE') return termine(v);
            void agir();
          });
        }),
    );
    const cree = await emettre(sockets[0], 'creer', { nom: 'Alice' });
    expect(cree.ok).toBe(true);
    for (const s of sockets.slice(1)) expect((await emettre(s, 'rejoindre', { code: cree.code, nom: 'Ami' })).ok).toBe(true);
    // Un joueur qui n'est pas l'hôte ne peut pas lancer.
    expect((await emettre(sockets[1], 'lancer')).ok).toBe(false);
    expect((await emettre(sockets[0], 'lancer')).ok).toBe(true);
    const finales = await Promise.race([
      Promise.all(fin),
      new Promise<never>((_, ko) => setTimeout(() => ko(new Error('La partie ne se termine pas')), 50000)),
    ]);
    expect(fuites).toEqual([]);
    for (const v of finales) expect(v.partie?.bilans).toHaveLength(8);
    sockets.forEach((s) => s.close());
  });

  it('un joueur qui recharge la page retrouve sa place', async () => {
    const a = io(url(), { transports: ['websocket'], forceNew: true });
    const cree = await emettre(a, 'creer', { nom: 'Hôte', modeTest: true });
    await emettre(a, 'ajouter_bot');
    await emettre(a, 'ajouter_bot');
    expect((await emettre(a, 'lancer')).ok).toBe(true);
    a.close();
    const b = io(url(), { transports: ['websocket'], forceNew: true });
    const vue = new Promise<VueSalon>((ok) => b.once('salon', ok));
    const r = await emettre(b, 'reprendre', { code: cree.code, jeton: cree.jeton });
    expect(r.ok).toBe(true);
    const v = await vue;
    expect(v.moi).toBe(cree.joueurId);
    expect(v.partie?.main.length).toBeGreaterThan(0);
    b.close();
  });

  it('parties publiques : deux joueurs du monde entier se retrouvent, les bots complètent la table', async () => {
    const pub = await demarrerServeur({ port: 0, delaiFinDePli: 5, delaiRobot: 5, dureeTour: 40, attentePublique: 400, servirClient: false });
    const url2 = `http://localhost:${pub.port}`;
    const [a, b] = [io(url2, { transports: ['websocket'], forceNew: true }), io(url2, { transports: ['websocket'], forceNew: true })];
    const premiere = new Promise<VueSalon>((ok) => a.on('salon', (v: VueSalon) => v.partie && ok(v)));
    const ra = await emettre(a, 'jouer_public', { nom: 'Lucas' });
    const rb = await emettre(b, 'jouer_public', { nom: 'Kim' });
    expect(ra.ok && rb.ok).toBe(true);
    expect(rb.code).toBe(ra.code); // même table
    // Une partie publique ne se lance pas à la main.
    expect((await emettre(a, 'lancer')).ok).toBe(false);
    const v = await premiere;
    expect(v.publique).toBe(true);
    expect(v.joueurs).toHaveLength(6);
    const bots = v.joueurs.filter((j) => j.bot);
    expect(bots).toHaveLength(4);
    for (const j of bots) expect(PRENOMS_BOTS).toContain(j.nom);
    // Fiches des joueurs : bot avec niveau et style, invité sans statistiques.
    const fiche = await emettre(a, 'profil_joueur', { joueurId: bots[0].id });
    expect(fiche.profil).toMatchObject({ type: 'bot', nom: bots[0].nom, niveau: bots[0].bot?.niveau, style: bots[0].bot?.style });
    expect((await emettre(a, 'profil_joueur', { joueurId: rb.joueurId })).profil).toEqual({ type: 'invite', nom: 'Kim', avatar: expect.any(Number) });
    // Kim quitte : l'ordinateur reprend aussitôt sa place.
    const apres = new Promise<VueSalon>((ok) => a.on('salon', (x: VueSalon) => x.joueurs.find((j) => j.id === rb.joueurId)?.robot && ok(x)));
    await emettre(b, 'quitter');
    expect((await apres).joueurs.find((j) => j.id === rb.joueurId)?.connecte).toBe(false);
    // La partie va au bout (le minuteur joue pour Lucas qui ne fait rien).
    const fin = await new Promise<VueSalon>((ok) => a.on('salon', (x: VueSalon) => x.partie?.phase === 'FIN_DE_PARTIE' && ok(x)));
    expect(fin.partie?.bilans).toHaveLength(8);
    a.close();
    b.close();
    await pub.fermer();
  });

  it('un joueur seul en partie publique joue contre 5 bots ; une nouvelle table s’ouvre pour les suivants', async () => {
    const pub = await demarrerServeur({ port: 0, delaiFinDePli: 5, delaiRobot: 5, attentePublique: 200, servirClient: false });
    const url2 = `http://localhost:${pub.port}`;
    const a = io(url2, { transports: ['websocket'], forceNew: true });
    const lancee = new Promise<VueSalon>((ok) => a.on('salon', (v: VueSalon) => v.partie && ok(v)));
    const premiereVue = new Promise<VueSalon>((ok) => a.once('salon', ok));
    const ra = await emettre(a, 'jouer_public', { nom: 'Solo' });
    const attente = await premiereVue;
    expect(attente.partie).toBeNull();
    expect(attente.departDans).toBeGreaterThan(0);
    const v = await lancee;
    expect(v.joueurs.filter((j) => j.bot)).toHaveLength(5);
    const b = io(url2, { transports: ['websocket'], forceNew: true });
    const rb = await emettre(b, 'jouer_public', { nom: 'Retard' });
    expect(rb.code).not.toBe(ra.code);
    a.close();
    b.close();
    await pub.fermer();
  });

  it('partie privée : l’hôte ajoute des bots au niveau et au style choisis', async () => {
    const a = io(url(), { transports: ['websocket'], forceNew: true });
    const b = io(url(), { transports: ['websocket'], forceNew: true });
    const cree = await emettre(a, 'creer', { nom: 'Hôte' });
    await emettre(b, 'rejoindre', { code: cree.code, nom: 'Invité' });
    expect((await emettre(b, 'ajouter_bot', { niveau: 'expert' })).ok).toBe(false); // pas l'hôte
    const vue = new Promise<VueSalon>((ok) => a.on('salon', (v: VueSalon) => v.joueurs.length === 4 && ok(v)));
    expect((await emettre(a, 'ajouter_bot', { niveau: 'expert', style: 'voleur' })).ok).toBe(true);
    expect((await emettre(a, 'ajouter_bot')).ok).toBe(true);
    const v = await vue;
    expect(v.publique).toBe(false);
    expect(v.joueurs[2].bot).toEqual({ niveau: 'expert', style: 'voleur' });
    expect(v.joueurs[3].bot).not.toBeNull();
    expect(new Set(v.joueurs.map((j) => j.nom)).size).toBe(4);
    a.close();
    b.close();
  });

  it("l'ordinateur joue à la place d'un joueur qui ne fait rien pendant le temps imparti", async () => {
    const rapide = await demarrerServeur({ port: 0, delaiFinDePli: 5, delaiRobot: 5, dureeTour: 30, servirClient: false });
    const a = io(`http://localhost:${rapide.port}`, { transports: ['websocket'], forceNew: true });
    const fin = new Promise<VueSalon>((ok) => a.on('salon', (v: VueSalon) => v.partie?.phase === 'FIN_DE_PARTIE' && ok(v)));
    await emettre(a, 'creer', { nom: 'Absent', modeTest: true });
    await emettre(a, 'ajouter_bot');
    await emettre(a, 'ajouter_bot');
    expect((await emettre(a, 'avatar', { avatar: 2 })).ok).toBe(false); // déjà pris par un robot
    await emettre(a, 'lancer');
    const v = await fin;
    expect(v.partie?.bilans).toHaveLength(8);
    expect(v.joueurs.map((j) => j.avatar).sort()).toEqual([1, 2, 3]);
    a.close();
    await rapide.fermer();
  });
});
