import { CARTE, EVENEMENT } from '../../shared/cartes';
import { NOM_EVENEMENT_TR, NOM_FAMILLE_TR, NOM_SPECIALE_TR, nomCarteTr } from '../../shared/langue';
import type { Carte, Famille, Speciale, TypeEvenement } from '../../shared/types';
import { EN, LANGUE } from './traduction';

export const NOM_FAMILLE: Record<Famille | 'chat_noir', string> = NOM_FAMILLE_TR[LANGUE];
export const NOM_SPECIALE: Record<Speciale, string> = NOM_SPECIALE_TR[LANGUE];
/** Nom d'une carte dans la langue du joueur (« Billets 7 » / « Cash 7 »). */
export const nomCarte = (id: string, valeurCroupier?: 0 | 11) => nomCarteTr(id, LANGUE, valeurCroupier);

export const COULEUR_FAMILLE: Record<Famille | 'chat_noir', string> = {
  billets: '#2f7d4f',
  lingots: '#b8862a',
  lames: '#3d6a96',
  diamants: '#c2456b',
  chat_noir: '#6b4aa0',
};

export const NOM_EVENEMENT: Record<TypeEvenement, string> = NOM_EVENEMENT_TR[LANGUE];

const EFFET_EVENEMENT_EN: Record<TypeEvenement, string> = {
  descente_police: 'No stealing tonight, and loot is worth 0 points.',
  trahison: 'After the bids, everyone secretly passes one card from their hand to the player on their right.',
  casse_du_siecle: 'Loot is worth double tonight.',
  couvre_feu: 'Alibis no longer protect against theft.',
  alliance: 'After the bids, everyone secretly chooses an ally. Two players who choose each other and make their bids score +20 each.',
};

const EFFET_EVENEMENT_FR: Record<TypeEvenement, string> = {
  descente_police: 'Aucun vol cette nuit, et le butin vaut 0 point.',
  trahison: 'Après les annonces, chacun passe en secret une carte de sa main au joueur de droite.',
  casse_du_siecle: 'Le butin vaut le double cette nuit.',
  couvre_feu: 'Les Alibis ne protègent plus des vols.',
  alliance:
    'Après les annonces, chacun choisit en secret un allié. Deux joueurs qui se choisissent et réussissent leur annonce gagnent +20 chacun.',
};

export const EFFET_EVENEMENT: Record<TypeEvenement, string> = EN ? EFFET_EVENEMENT_EN : EFFET_EVENEMENT_FR;

const EFFET_SPECIALE_EN: Record<string, string> = {
  baron: 'Beats everything except the Pickpocket. +20 if he wins a trick containing a Henchman. When he wins a trick, he may steal a piece of loot.',
  pickpocket: 'Steals a piece of loot as soon as it is played, even if it loses the trick. If it beats the Baron: Stick-up, +40.',
  homme_de_main: 'Beats numbered cards. If there are several, the first one played wins.',
  alibi: 'Never wins the trick. While it is in your hand, it protects you from theft (except during a Curfew).',
  juge: 'Never wins. Once played, the order is reversed: the lowest value wins, whatever the suit, and special card powers are ignored.',
  croupier: 'You choose its value when you play it: 11 (beats a 10 of the suit led) or 0 (loses to any numbered card).',
};

const EFFET_SPECIALE_FR: Record<string, string> = {
  baron: "Bat tout, sauf le Pickpocket. +20 s'il gagne un pli contenant un Homme de main. Quand il gagne un pli, il peut voler un butin.",
  pickpocket: 'Vole un butin dès qu’il est posé, même s’il perd le pli. S’il bat le Baron : Braquage, +40.',
  homme_de_main: 'Bat les cartes numérotées. S’il y en a plusieurs, le premier posé gagne.',
  alibi: 'Ne gagne jamais le pli. Tant que tu l’as en main, il te protège des vols (sauf pendant un Couvre-feu).',
  juge: 'Ne gagne jamais. Quand il est posé, l’ordre est inversé : la plus petite valeur l’emporte, toutes familles confondues, et les pouvoirs des cartes spéciales sont ignorés.',
  croupier: 'Tu choisis sa valeur en le posant : 11 (bat un 10 de la famille demandée) ou 0 (perd contre toute carte numérotée).',
};

export function effetCarte(c: Carte): string {
  if (c.type === 'atout') {
    return EN
      ? 'Trump: can be played on any gang suit at any time. Led first, it makes Black Cat the suit. Beats all gang cards. The highest Black Cat wins. It is never taken as loot.'
      : 'Atout : se joue à tout moment sur une famille de gang. Posé en premier, il impose le Chat noir. Bat toutes les cartes de gang. Le Chat noir le plus fort gagne. Il n’est jamais pris comme butin.';
  }
  if (c.type === 'gang') {
    return EN
      ? 'Gang card. Follow the suit led if you can, otherwise play a Black Cat or a special card. The highest card of the suit led wins, unless a trump or special card beats it.'
      : 'Carte de gang. Suis la famille demandée si tu peux, ou joue un Chat noir ou une carte spéciale. La plus forte carte de la famille demandée gagne, sauf atout ou carte spéciale.';
  }
  return (EN ? EFFET_SPECIALE_EN : EFFET_SPECIALE_FR)[c.speciale ?? ''] ?? '';
}

export function image(chemin: string): string {
  return `/${chemin}`;
}

export function infoCarte(id: string) {
  const c = CARTE[id];
  if (c) return { nom: nomCarte(id), image: image(c.image), effet: effetCarte(c), carte: c };
  const ev = EVENEMENT[id];
  return { nom: NOM_EVENEMENT[ev.evenement], image: image(ev.image), effet: EFFET_EVENEMENT[ev.evenement], carte: null };
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
export const AVATARS = EN
  ? ['The Godfather', 'The Singer', 'The Detective', 'The Croupier', 'The Smuggler', 'The Boxer']
  : ['Le Parrain', 'La Chanteuse', 'Le Détective', 'Le Croupier', 'La Contrebandière', 'Le Boxeur'];
