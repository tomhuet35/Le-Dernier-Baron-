/**
 * Constantes de jeu et arbitrages.
 *
 * Les arbitrages tranchent les cas que la règle papier ne précise pas (section 8 du cahier des charges) :
 *  1. Le paquet de 62 cartes est remélangé à chaque nuit ............................ moteur.ts, demarrerNuit
 *  2. Premier joueur tiré au hasard à la nuit 1, puis passe au joueur suivant ........ moteur.ts
 *  3. La première carte numérotée fixe la famille (un Chat noir en tête : Chat noir demandé) regles.ts
 *  4. Le Croupier compte comme une carte de la famille demandée (0 ou 11) ............ regles.ts, resoudrePli
 *  5. Un pli sans carte pouvant gagner revient au joueur qui l'a ouvert .............. regles.ts, resoudrePli
 *  6. Avec le Juge, l'ordre est inversé : la plus petite valeur gagne ............... regles.ts, resoudrePli
 *  7. Le butin est la carte de gang de plus haute valeur du pli (jamais un Chat noir)  regles.ts, resoudrePli
 *  8. Les vols sont facultatifs et le voleur choisit la carte prise .................. moteur.ts, VOLER
 *  9. La protection par l'Alibi est automatique et ne défausse pas l'Alibi ........... moteur.ts, resoudreVol
 * 10. La Descente de police bloque les vols mais pas les bonus ....................... DESCENTE_BLOQUE_BONUS
 * 11. Le bonus Baron + Homme de main vaut +20 une seule fois par pli ................. BONUS_BARON_PAR_HOMME_DE_MAIN
 * 12. Les événements sont tirés sans remise (6 des 10 cartes servent) ................ moteur.ts, creerPartie
 */

export const NB_NUITS = 8;
export const MIN_JOUEURS = 3;
export const MAX_JOUEURS = 6;
export const NUITS_AVEC_EVENEMENT = [2, 3, 4, 5, 6, 7];

export const POINTS_PAR_PLI_ANNONCE = 10;
export const POINTS_ANNONCE_ZERO_PAR_NUIT = 10;
export const PENALITE_PAR_ECART = 10;

export const BONUS_BARON_HOMME_DE_MAIN = 20;
/** false : +20 une seule fois par pli ; true : +20 par Homme de main présent dans le pli. */
export const BONUS_BARON_PAR_HOMME_DE_MAIN = false;
export const BONUS_BRAQUAGE = 40;
export const BONUS_ALLIANCE = 20;

export const MULTIPLICATEUR_BUTIN_CASSE = 2;
export const MULTIPLICATEUR_BUTIN_DESCENTE = 0;
/** false : la Descente de police n'annule pas les bonus. */
export const DESCENTE_BLOQUE_BONUS = false;

export const TAILLE_JOURNAL = 60;

/** Temps maximum pour agir ; passé ce délai, l'ordinateur joue à la place du joueur. */
export const DUREE_TOUR_MS = 30_000;
/** Nombre d'avatars disponibles (un par joueur, 6 joueurs au maximum). */
export const NB_AVATARS = 6;

/** Durées côté serveur (millisecondes). */
export const DELAI_FIN_DE_PLI_MS = 2400;
export const DELAI_ROBOT_MS = 900;
