/**
 * Les Cercles du Salon privé, côté serveur : l'état de tous les cercles (gardé avec les réglages du serveur, document
 * « cercles » de la collection « parametres »), les droits de chacun, la cagnotte et la discussion.
 * L'argent et les rubis passent par le salon (salonCasino.ts), qui fournit les fonctions ci-dessous.
 */
import { randomInt, randomUUID } from 'node:crypto';
import {
  DEMANDES_MAX,
  estBlason,
  MEMBRES_MAX,
  MESSAGES_MAX,
  messageValide,
  nomCercleValide,
  normaliserCercles,
  nouveauCercle,
  PART_CAGNOTTE,
  peutGerer,
  PRIX_BLASON,
  PRIX_FONDER,
  resumeCercle,
  retirerMembre,
  roleDe,
  tirerCagnotte,
  type Cercle,
  type MessageCercle,
  type VueCercles,
} from '../shared/cercles';

export interface OptionsCercles {
  horloge: () => number;
  /** La semaine (« 2026-S47 ») et sa fin, à l'instant t. */
  semaine: (t: number) => { cle: string; fin: number };
  lire: () => Promise<unknown>;
  ecrire: (cercles: Cercle[]) => Promise<void>;
  /** Prend des rubis au joueur (false s'il n'en a pas assez). */
  payerRubis: (uid: string, n: number) => boolean;
  /** Verse la cagnotte gagnée. */
  verser: (uid: string, montant: number) => void;
  /** Prévient un joueur (ses téléphones au salon). */
  notifier: (uid: string, evenement: string, data: unknown) => void;
  delaiEcriture?: number;
}

/** Les réponses des actions : 'ok' ou un code d'erreur (le salon le traduit). */
export type ResultatCercle =
  | 'ok'
  | 'deja_membre'
  | 'pas_membre'
  | 'introuvable'
  | 'nom'
  | 'nom_pris'
  | 'rubis'
  | 'complet'
  | 'droits'
  | 'demande_envoyee'
  | 'trop_de_demandes'
  | 'vide';

export function creerCercles(o: OptionsCercles) {
  let cercles: Cercle[] = [];
  /** Le cercle de chaque joueur. */
  const parJoueur = new Map<string, string>();
  let minuterie: ReturnType<typeof setTimeout> | null = null;
  const reindexer = () => {
    parJoueur.clear();
    for (const c of cercles) for (const m of c.membres) parJoueur.set(m.uid, c.id);
  };
  const chargement = o
    .lire()
    .then((brut) => {
      cercles = normaliserCercles(brut);
      reindexer();
    })
    .catch((e) => console.error('Cercles : lecture impossible :', e));

  const sauver = () => {
    if (minuterie) return;
    minuterie = setTimeout(() => {
      minuterie = null;
      void o.ecrire(cercles).catch((e) => console.error('Cercles : écriture impossible :', e));
    }, o.delaiEcriture ?? 5000);
  };
  const cercleDe = (uid: string) => {
    const id = parJoueur.get(uid);
    return id ? (cercles.find((c) => c.id === id) ?? null) : null;
  };
  const demandeDe = (uid: string) => cercles.find((c) => c.demandes.some((d) => d.uid === uid))?.id ?? null;

  /** Nouvelle semaine : chaque cercle tire sa cagnotte. */
  function verifierSemaine() {
    const s = o.semaine(o.horloge()).cle;
    let change = false;
    for (const c of cercles) {
      if (c.semaine === s) continue;
      change = true;
      const g = tirerCagnotte(c, s, (n) => randomInt(Math.max(1, n)));
      if (g) {
        o.verser(g.uid, g.montant);
        for (const m of c.membres) o.notifier(m.uid, 'casino_cercle_cagnotte', { nom: g.nom, montant: g.montant, moi: m.uid === g.uid });
      }
    }
    if (change) {
      sauver();
      for (const c of cercles) diffuser(c);
    }
  }
  const tic = setInterval(verifierSemaine, 60_000);
  tic.unref?.();

  function vue(uid: string): VueCercles {
    const c = cercleDe(uid);
    const t = o.horloge();
    return {
      mien: c ? { id: c.id, nom: c.nom, blason: c.blason, ouvert: c.ouvert, creeLe: c.creeLe, membres: c.membres, demandes: peutGerer(c, uid) ? c.demandes : [], cagnotte: Math.floor(c.cagnotte), messages: c.messages, dernierTirage: c.dernierTirage, moi: roleDe(c, uid)!, finSemaine: o.semaine(t).fin } : null,
      demande: c ? null : demandeDe(uid),
      classement: [...cercles].sort((a, b) => b.membres.reduce((s, m) => s + m.mise, 0) - a.membres.reduce((s, m) => s + m.mise, 0) || b.membres.length - a.membres.length).slice(0, 30).map(resumeCercle),
    };
  }
  /** Chaque membre reçoit la nouvelle vue de son cercle. */
  function diffuser(c: Cercle) {
    for (const m of c.membres) o.notifier(m.uid, 'casino_cercles', vue(m.uid));
  }
  const modifie = (c: Cercle) => {
    sauver();
    diffuser(c);
  };

  return {
    chargement,
    vue,
    cercleDe: (uid: string) => cercleDe(uid)?.id ?? null,
    /** Une mise d'un joueur : elle compte pour son cercle (classement) et alimente la cagnotte. */
    noterMise(uid: string, mise: number) {
      if (!(mise > 0)) return;
      const c = cercleDe(uid);
      if (!c) return;
      verifierSemaine();
      const m = c.membres.find((x) => x.uid === uid);
      if (!m) return;
      m.mise += mise;
      c.cagnotte += mise * PART_CAGNOTTE;
      sauver();
    },
    /** Le nom et l'avatar d'un membre ont changé. */
    majJoueur(uid: string, nom: string, avatar: number) {
      const c = cercleDe(uid);
      const m = c?.membres.find((x) => x.uid === uid);
      if (m && (m.nom !== nom || m.avatar !== avatar)) {
        m.nom = nom;
        m.avatar = avatar;
        sauver();
      }
    },
    fonder(qui: { uid: string; nom: string; avatar: number }, nomBrut: unknown, blason: unknown, ouvert: unknown): ResultatCercle {
      if (cercleDe(qui.uid)) return 'deja_membre';
      const nom = nomCercleValide(nomBrut);
      if (!nom || !estBlason(blason)) return 'nom';
      if (cercles.some((c) => c.nom.toLocaleLowerCase('fr') === nom.toLocaleLowerCase('fr'))) return 'nom_pris';
      if (!o.payerRubis(qui.uid, PRIX_FONDER)) return 'rubis';
      for (const c of cercles) c.demandes = c.demandes.filter((d) => d.uid !== qui.uid);
      const c = nouveauCercle(randomUUID(), nom, blason, ouvert !== false, qui, o.horloge(), o.semaine(o.horloge()).cle);
      cercles.push(c);
      parJoueur.set(qui.uid, c.id);
      modifie(c);
      return 'ok';
    },
    rejoindre(qui: { uid: string; nom: string; avatar: number }, id: unknown): ResultatCercle {
      if (cercleDe(qui.uid)) return 'deja_membre';
      const c = cercles.find((x) => x.id === id);
      if (!c) return 'introuvable';
      if (c.membres.length >= MEMBRES_MAX) return 'complet';
      if (!c.ouvert) {
        if (c.demandes.some((d) => d.uid === qui.uid)) return 'demande_envoyee';
        if (c.demandes.length >= DEMANDES_MAX) return 'trop_de_demandes';
        for (const x of cercles) x.demandes = x.demandes.filter((d) => d.uid !== qui.uid);
        c.demandes.push({ ...qui, t: o.horloge() });
        modifie(c);
        return 'demande_envoyee';
      }
      for (const x of cercles) x.demandes = x.demandes.filter((d) => d.uid !== qui.uid);
      c.membres.push({ ...qui, role: 'membre', depuis: o.horloge(), mise: 0 });
      parJoueur.set(qui.uid, c.id);
      modifie(c);
      return 'ok';
    },
    annulerDemande(uid: string) {
      for (const c of cercles)
        if (c.demandes.some((d) => d.uid === uid)) {
          c.demandes = c.demandes.filter((d) => d.uid !== uid);
          modifie(c);
        }
    },
    repondreDemande(uid: string, autre: unknown, accepter: boolean): ResultatCercle {
      const c = cercleDe(uid);
      if (!c) return 'pas_membre';
      if (!peutGerer(c, uid)) return 'droits';
      const d = c.demandes.find((x) => x.uid === autre);
      if (!d) return 'introuvable';
      c.demandes = c.demandes.filter((x) => x.uid !== autre);
      if (accepter) {
        if (c.membres.length >= MEMBRES_MAX) return 'complet';
        if (cercleDe(d.uid)) {
          modifie(c);
          return 'deja_membre';
        }
        c.membres.push({ uid: d.uid, nom: d.nom, avatar: d.avatar, role: 'membre', depuis: o.horloge(), mise: 0 });
        parJoueur.set(d.uid, c.id);
        o.notifier(d.uid, 'casino_cercles', vue(d.uid));
      }
      modifie(c);
      return 'ok';
    },
    quitter(uid: string): ResultatCercle {
      const c = cercleDe(uid);
      if (!c) return 'pas_membre';
      retirerMembre(c, uid);
      parJoueur.delete(uid);
      if (!c.membres.length) cercles = cercles.filter((x) => x.id !== c.id);
      else modifie(c);
      sauver();
      return 'ok';
    },
    exclure(uid: string, autre: unknown): ResultatCercle {
      const c = cercleDe(uid);
      if (!c) return 'pas_membre';
      const cible = c.membres.find((m) => m.uid === autre);
      if (!cible || cible.uid === uid) return 'introuvable';
      // Le croupier exclut des membres ; seul le président peut écarter le croupier.
      const moi = roleDe(c, uid);
      if (!(moi === 'president' || (moi === 'croupier' && cible.role === 'membre'))) return 'droits';
      retirerMembre(c, cible.uid);
      parJoueur.delete(cible.uid);
      o.notifier(cible.uid, 'casino_cercles', vue(cible.uid));
      modifie(c);
      return 'ok';
    },
    /** Le président nomme (ou retire) le Croupier en chef ; il n'y en a qu'un. */
    nommerCroupier(uid: string, autre: unknown): ResultatCercle {
      const c = cercleDe(uid);
      if (!c) return 'pas_membre';
      if (roleDe(c, uid) !== 'president') return 'droits';
      const cible = c.membres.find((m) => m.uid === autre);
      if (!cible || cible.uid === uid) return 'introuvable';
      const etait = cible.role === 'croupier';
      for (const m of c.membres) if (m.role === 'croupier') m.role = 'membre';
      if (!etait) cible.role = 'croupier';
      modifie(c);
      return 'ok';
    },
    changerBlason(uid: string, blason: unknown): ResultatCercle {
      const c = cercleDe(uid);
      if (!c) return 'pas_membre';
      if (!peutGerer(c, uid)) return 'droits';
      if (!estBlason(blason) || blason === c.blason) return 'introuvable';
      if (!o.payerRubis(uid, PRIX_BLASON)) return 'rubis';
      c.blason = blason;
      modifie(c);
      return 'ok';
    },
    changerOuverture(uid: string, ouvert: boolean): ResultatCercle {
      const c = cercleDe(uid);
      if (!c) return 'pas_membre';
      if (roleDe(c, uid) !== 'president') return 'droits';
      c.ouvert = ouvert;
      modifie(c);
      return 'ok';
    },
    message(qui: { uid: string; nom: string; avatar: number }, texte: unknown): ResultatCercle {
      const c = cercleDe(qui.uid);
      if (!c) return 'pas_membre';
      const t = messageValide(texte);
      if (!t) return 'vide';
      const m: MessageCercle = { t: o.horloge(), uid: qui.uid, nom: qui.nom, avatar: qui.avatar, texte: t };
      c.messages = [...c.messages, m].slice(-MESSAGES_MAX);
      sauver();
      for (const x of c.membres) o.notifier(x.uid, 'casino_cercle_message', m);
      return 'ok';
    },
    exporter: () => cercles,
    async fermer() {
      clearInterval(tic);
      if (minuterie) {
        clearTimeout(minuterie);
        minuterie = null;
        await o.ecrire(cercles).catch(() => undefined);
      }
    },
  };
}
