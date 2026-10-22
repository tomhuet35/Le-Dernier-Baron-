import { CARTE, EVENEMENT } from '../../shared/cartes';
import type { Carte, Famille, TypeEvenement } from '../../shared/types';

export const NOM_FAMILLE: Record<Famille | 'chat_noir', string> = {
  billets: 'Billets',
  lingots: 'Lingots',
  lames: 'Lames',
  diamants: 'Diamants',
  chat_noir: 'Chat noir',
};

export const COULEUR_FAMILLE: Record<Famille | 'chat_noir', string> = {
  billets: '#2f7d4f',
  lingots: '#b8862a',
  lames: '#3d6a96',
  diamants: '#c2456b',
  chat_noir: '#6b4aa0',
};

export const NOM_EVENEMENT: Record<TypeEvenement, string> = {
  descente_police: 'Descente de police',
  trahison: 'Trahison',
  casse_du_siecle: 'Casse du siècle',
  couvre_feu: 'Couvre-feu',
  alliance: 'Alliance',
};

export const EFFET_EVENEMENT: Record<TypeEvenement, string> = {
  descente_police: 'Aucun vol cette nuit, et le butin vaut 0 point.',
  trahison: 'Après les annonces, chacun passe en secret une carte de sa main au joueur de droite.',
  casse_du_siecle: 'Le butin vaut le double cette nuit.',
  couvre_feu: 'Les Alibis ne protègent plus des vols.',
  alliance:
    'Après les annonces, chacun choisit en secret un allié. Deux joueurs qui se choisissent et réussissent leur annonce gagnent +20 chacun.',
};

const EFFET_SPECIALE: Record<string, string> = {
  baron: "Bat tout, sauf le Pickpocket. +20 s'il gagne un pli contenant un Homme de main. Quand il gagne un pli, il peut voler un butin.",
  pickpocket: 'Vole un butin dès qu’il est posé, même s’il perd le pli. S’il bat le Baron : Braquage, +40.',
  homme_de_main: 'Bat les cartes numérotées. S’il y en a plusieurs, le premier posé gagne.',
  alibi: 'Ne gagne jamais le pli. Tant que tu l’as en main, il te protège des vols (sauf pendant un Couvre-feu).',
  juge: 'Ne gagne jamais. Quand il est posé, l’ordre est inversé : la plus petite valeur l’emporte, toutes familles confondues, et les pouvoirs des cartes spéciales sont ignorés.',
  croupier: 'Tu choisis sa valeur en le posant : 11 (bat un 10 de la famille demandée) ou 0 (perd contre toute carte numérotée).',
};

export function effetCarte(c: Carte): string {
  if (c.type === 'atout') return 'Atout : se joue à tout moment sur une famille de gang. Posé en premier, il impose le Chat noir. Bat toutes les cartes de gang. Le Chat noir le plus fort gagne. Il n’est jamais pris comme butin.';
  if (c.type === 'gang') return 'Carte de gang. Suis la famille demandée si tu peux, ou joue un Chat noir ou une carte spéciale. La plus forte carte de la famille demandée gagne, sauf atout ou carte spéciale.';
  return EFFET_SPECIALE[c.speciale ?? ''] ?? '';
}

export function image(chemin: string): string {
  return `/${chemin}`;
}

export function infoCarte(id: string) {
  const c = CARTE[id];
  if (c) return { nom: c.nom, image: image(c.image), effet: effetCarte(c), carte: c };
  const ev = EVENEMENT[id];
  return { nom: ev.nom, image: image(ev.image), effet: EFFET_EVENEMENT[ev.evenement], carte: null };
}

const ORDRE: Record<string, number> = {
  billets: 0, lingots: 1, lames: 2, diamants: 3, chat_noir: 4,
  baron: 5, pickpocket: 6, homme_de_main: 7, juge: 8, croupier: 9, alibi: 10,
};

/** Trie une main : familles, Chats noirs, puis cartes spéciales. */
export function trierMain<T extends { id: string }>(main: T[]): T[] {
  const cle = (id: string) => {
    const c = CARTE[id];
    return (ORDRE[c.famille ?? c.speciale ?? ''] ?? 11) * 100 + (c.valeur ?? 0);
  };
  return [...main].sort((a, b) => cle(a.id) - cle(b.id));
}

export const REGLES: { titre: string; texte: string[] }[] = [
  {
    titre: 'But du jeu',
    texte: [
      'Après 8 nuits, le joueur qui a le plus de points devient le Dernier Baron.',
      'À la nuit n, chacun reçoit n cartes et la nuit compte n plis.',
    ],
  },
  {
    titre: 'Une nuit',
    texte: [
      'Distribution, puis événement (nuits 2 à 7).',
      'Annonces : chacun choisit en secret combien de plis il pense gagner, puis tout le monde révèle.',
      'Plis : le gagnant d’un pli garde le butin et ouvre le pli suivant.',
    ],
  },
  {
    titre: 'Jouer un pli',
    texte: [
      'La première carte numérotée posée fixe la famille demandée. Si tu en as, tu dois la suivre, ou jouer un Chat noir ou une carte spéciale.',
      'Si un Chat noir ouvre le pli, c’est le Chat noir qui est demandé : tu dois en fournir un si tu peux (ou jouer une carte spéciale).',
      'Les Chats noirs et les cartes spéciales se jouent à tout moment.',
    ],
  },
  {
    titre: 'Qui gagne le pli ?',
    texte: [
      '1. Pickpocket, s’il y a aussi le Baron (Braquage).',
      '2. Baron.',
      '3. Homme de main : le premier posé.',
      '4. Chat noir : le plus fort.',
      '5. Famille demandée (Croupier compris) : la plus forte.',
      'Alibi et Juge ne gagnent jamais. Quand le Juge est posé, l’ordre est inversé : la plus petite valeur gagne, toutes familles confondues.',
    ],
  },
  {
    titre: 'Butin et vols',
    texte: [
      'Le gagnant garde la carte de gang (Billets, Lingots, Lames, Diamants) de plus forte valeur du pli. Les Chats noirs ne sont jamais du butin.',
      'Le butin vaut sa valeur en points, seulement si l’annonce est réussie.',
      'Le Pickpocket vole dès qu’il est posé ; le Baron vole quand il gagne un pli.',
      'Un Alibi en main protège du vol, sauf pendant un Couvre-feu.',
    ],
  },
  {
    titre: 'Score',
    texte: [
      'Annonce réussie : +10 par pli. Annonce ratée : −10 par pli d’écart.',
      'Annonce de 0 : +10 × numéro de la nuit si elle est réussie, −10 × numéro de la nuit si tu gagnes un pli.',
      'Butin : sa valeur, seulement si l’annonce est réussie.',
      'Bonus si l’annonce est réussie : Baron + Homme de main +20, Braquage +40, Alliance +20.',
    ],
  },
  {
    titre: 'Événements',
    texte: (Object.keys(EFFET_EVENEMENT) as TypeEvenement[]).map((k) => `${NOM_EVENEMENT[k]} : ${EFFET_EVENEMENT[k]}`),
  },
];

/** Les 6 personnages que les joueurs peuvent incarner (images cartes/avatar-1.webp à avatar-6.webp). */
export const AVATARS = ['Le Parrain', 'La Chanteuse', 'Le Détective', 'Le Croupier', 'La Contrebandière', 'Le Boxeur'];
