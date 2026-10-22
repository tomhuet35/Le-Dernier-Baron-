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

/** Les 6 personnages que les joueurs peuvent incarner (images cartes/avatar-1.webp à avatar-6.webp). */
export const AVATARS = ['Le Parrain', 'La Chanteuse', 'Le Détective', 'Le Croupier', 'La Contrebandière', 'Le Boxeur'];
