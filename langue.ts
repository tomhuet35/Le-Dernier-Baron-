/**
 * Français et anglais : ce qui est partagé entre le serveur et l'interface (noms des cartes, des événements,
 * titres de niveau, tapis, tables, ordinateurs, erreurs du moteur). Le reste des textes vit à côté de chaque écran.
 */
import { CARTE } from './cartes';
import type { Famille, NiveauBot, Speciale, StyleBot, TypeEvenement } from './types';

export type Langue = 'fr' | 'en';
export const estLangue = (v: unknown): v is Langue => v === 'fr' || v === 'en';

/** Choisit le texte dans la langue demandée. */
export const selon = (langue: Langue, fr: string, en: string) => (langue === 'en' ? en : fr);

export const NOM_FAMILLE_TR: Record<Langue, Record<Famille | 'chat_noir', string>> = {
  fr: { billets: 'Billets', lingots: 'Lingots', lames: 'Lames', diamants: 'Diamants', chat_noir: 'Chat noir' },
  en: { billets: 'Cash', lingots: 'Gold', lames: 'Blades', diamants: 'Diamonds', chat_noir: 'Black Cat' },
};

export const NOM_SPECIALE_TR: Record<Langue, Record<Speciale, string>> = {
  fr: { baron: 'Baron', pickpocket: 'Pickpocket', homme_de_main: 'Homme de main', alibi: 'Alibi', juge: 'Juge', croupier: 'Croupier' },
  en: { baron: 'Baron', pickpocket: 'Pickpocket', homme_de_main: 'Henchman', alibi: 'Alibi', juge: 'Judge', croupier: 'Croupier' },
};

export const NOM_EVENEMENT_TR: Record<Langue, Record<TypeEvenement, string>> = {
  fr: { descente_police: 'Descente de police', trahison: 'Trahison', casse_du_siecle: 'Casse du siècle', couvre_feu: 'Couvre-feu', alliance: 'Alliance' },
  en: { descente_police: 'Police Raid', trahison: 'Betrayal', casse_du_siecle: 'Heist of the Century', couvre_feu: 'Curfew', alliance: 'Alliance' },
};

/** Nom d'une carte (« Billets 7 », « Cash 7 », « Croupier (11) »). */
export function nomCarteTr(id: string, langue: Langue, valeurCroupier?: 0 | 11): string {
  const c = CARTE[id];
  if (!c) return '?';
  let nom = c.nom;
  if (langue === 'en') {
    if (c.speciale) nom = NOM_SPECIALE_TR.en[c.speciale];
    else if (c.famille) nom = `${NOM_FAMILLE_TR.en[c.famille]} ${c.valeur}`;
  }
  return c.speciale === 'croupier' && valeurCroupier !== undefined ? `${nom} (${valeurCroupier})` : nom;
}

/** Titres du niveau 1 au niveau 10 ; au-delà, on reste Baron. */
export const TITRES_TR: Record<Langue, string[]> = {
  fr: ['Petite frappe', 'Guetteur', 'Pickpocket', 'Homme de main', 'Croupier', 'Contrebandier', 'Lieutenant', 'Bras droit', 'Parrain', 'Baron'],
  en: ['Small-timer', 'Lookout', 'Pickpocket', 'Henchman', 'Croupier', 'Smuggler', 'Lieutenant', 'Right-hand Man', 'Godfather', 'Baron'],
};
export function titreNiveauTr(n: number, langue: Langue): string {
  const t = TITRES_TR[langue];
  return t[Math.min(Math.max(1, n), t.length) - 1];
}

export const NOM_TAPIS_EN: Record<string, string> = { baron: 'Classic', velours: 'Velvet', prestige: 'Prestige', noir: 'Blood Black', 'or-noir': 'Black Gold' };

export const TRANCHES_EN = [
  { nom: 'Beginners', detail: 'lvl 1–4' },
  { nom: 'Skilled', detail: 'lvl 5–9' },
  { nom: 'Experts', detail: 'lvl 10–14' },
  { nom: 'Barons', detail: 'lvl 15+' },
];

export const NOM_NIVEAU_BOT_EN: Record<NiveauBot, string> = { debutant: 'Beginner', confirme: 'Skilled', expert: 'Expert' };
export const NOM_STYLE_BOT_EN: Record<StyleBot, string> = { equilibre: 'Balanced', prudent: 'Cautious', audacieux: 'Bold', voleur: 'Thief' };
export const DESCRIPTION_STYLE_BOT_EN: Record<StyleBot, string> = {
  equilibre: 'Bids what the hand is worth, no more, no less.',
  prudent: 'Bids low and likes to aim for zero tricks with a weak hand.',
  audacieux: 'Bids high and plays big cards early.',
  voleur: 'Goes for the loot: Pickpocket as soon as possible, always steals the best card.',
};
export const DESCRIPTION_NIVEAU_BOT_EN: Record<NiveauBot, string> = {
  debutant: 'Often plays at random and misjudges bids.',
  confirme: 'Plays correctly, with a few mistakes.',
  expert: 'Counts tricks, keeps trumps and plays precisely.',
};

/** Erreurs du moteur de jeu (écrites en français dans moteur.ts), traduites pour un joueur anglophone. */
const ERREURS_EN: Record<string, string> = {
  'Joueur inconnu.': 'Unknown player.',
  'Tu as déjà choisi ta carte.': 'You have already chosen your card.',
  'Tu as déjà annoncé.': 'You have already made your bid.',
  'Tu as déjà choisi.': 'You have already chosen.',
  'Allié invalide.': 'Invalid ally.',
  'Tu dois suivre la famille demandée.': 'You must follow the suit led.',
  'Choisis la valeur du Croupier : 0 ou 11.': 'Choose the Croupier’s value: 0 or 11.',
  'Cible invalide.': 'Invalid target.',
  'Rien à poursuivre.': 'Nothing to continue.',
  'Action inconnue.': 'Unknown action.',
  "La partie n'a pas commencé.": 'The game has not started.',
  "Ce n'est pas le moment.": 'Not now.',
  "Ce n'est pas ton tour.": 'It’s not your turn.',
  "Cette carte n'est pas dans ta main.": 'That card is not in your hand.',
  'La partie est terminée.': 'The game is over.',
  "Ce n'est pas le moment de passer une carte.": 'Not the time to pass a card.',
  "Ce n'est pas le moment d'annoncer.": 'Not the time to bid.',
  "Ce n'est pas le moment de choisir un allié.": 'Not the time to choose an ally.',
  "Ce n'est pas le moment de jouer une carte.": 'Not the time to play a card.',
  "Ce n'est pas le moment de voler.": 'Not the time to steal.',
  "Ce n'est pas à toi de voler.": 'It’s not your turn to steal.',
};
export function traduireErreurMoteur(fr: string, langue: Langue): string {
  if (langue !== 'en') return fr;
  if (ERREURS_EN[fr]) return ERREURS_EN[fr];
  const annonce = /^L'annonce doit être comprise entre 0 et (\d+)\.$/.exec(fr);
  if (annonce) return `Your bid must be between 0 and ${annonce[1]}.`;
  return fr;
}
