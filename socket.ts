import { io } from 'socket.io-client';

/** Connexion unique au serveur de jeu (même adresse que le site). */
export const socket = io({ transports: ['websocket', 'polling'] });
