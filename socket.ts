import { io } from 'socket.io-client';
import { LANGUE } from './traduction';

/** Connexion unique au serveur de jeu (même adresse que le site). La langue sert aux messages du serveur. */
export const socket = io({ transports: ['websocket', 'polling'], auth: { langue: LANGUE } });
