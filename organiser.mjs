// Range les fichiers dans les bons dossiers si le dépôt a été envoyé « à plat ».
import { existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs';

const dossiers = {
  client: ['index.html', 'confidentialite.html'],
  'client/src': ['App.tsx', 'Casino.tsx', 'casinoOutils.tsx', 'CasinoBlackjack.tsx', 'boutique.css', 'blackjack.css', 'CasinoFolleNuit.tsx', 'CasinoFestin.tsx', 'festin.css', 'CasinoCouronne.tsx', 'couronne.css', 'CasinoChute.tsx', 'chute.css', 'CasinoTickets.tsx', 'tickets.css', 'CasinoToits.tsx', 'toits.css', 'CasinoParametres.tsx', 'CasinoBulles.tsx', 'bulles.css', 'CasinoCourse.tsx', 'course.css', 'CasinoBaronWheel.tsx', 'baronWheel.css', 'CasinoBaronExpress.tsx', 'baronExpress.css', 'CasinoBraquage.tsx', 'braquage.css', 'CasinoEvasion.tsx', 'evasion.css', 'CasinoAiguillage.tsx', 'aiguillage.css', 'CasinoChaudiere.tsx', 'chaudiere.css', 'CasinoDonne.tsx', 'donne.css', 'CasinoPickpocket.tsx', 'pickpocket.css', 'CasinoAffiche.tsx', 'CasinoSocial.tsx', 'casinoSocial.css', 'CasinoNuits.tsx', 'folleNuit.css', 'CasinoContrats.tsx', 'contrats.css', 'ChargementCasino.tsx', 'chargement.css', 'ressourcesCasino.ts', 'ressourcesJeux.ts', 'ChargementJeu.tsx', 'chargementJeu.css', 'CasinoBureau.tsx', 'bureau.css', 'CasinoHotel.tsx', 'hotel.css', 'accueil.css', 'CasinoCercles.tsx', 'cercles.css', 'CasinoBourse.tsx', 'bourse.css', 'CasinoMarche.tsx', 'marche.css', 'CasinoTailleur.tsx', 'tailleur.css', 'CasinoRoulette.tsx', 'roulette.css', 'casino.css', 'Classement.tsx', 'Table.tsx', 'Profil.tsx', 'Regles.tsx', 'Reglages.tsx', 'reglages.ts', 'RouletteDuJour.tsx', 'appli.ts', 'Tutoriel.tsx', 'connexion.ts', 'main.tsx', 'Moderation.tsx', 'socket.ts', 'styles.css', 'textes.ts', 'traduction.ts', 'ui.tsx'],
  'client/public': ['boite.webp', 'dos.webp', 'icone-192.png', 'icone-512.png', 'icone-maskable.png', 'icone-apple.png', 'icone-badge.png', 'manifest.webmanifest', 'manifest-casino.webmanifest', 'icone-casino-192.png', 'icone-casino-512.png', 'icone-casino-maskable.png', 'icone-casino-apple.png', 'sw.js'],
  shared: ['blackjack.ts', 'cartes.ts', 'casino.ts', 'config.ts', 'contrats.ts', 'ventes.ts', 'hotel.ts', 'cercles.ts', 'bourse.ts', 'marche.ts', 'tailleur.ts', 'tickets.ts', 'toits.ts', 'plinko.ts', 'bulles.ts', 'couronne.ts', 'chute.ts', 'course.ts', 'baronWheel.ts', 'afficheCasino.ts', 'profilCasino.ts', 'folleNuit.ts', 'festin.ts', 'langue.ts', 'machineASous.ts', 'machineNuits.ts', 'moderation.ts', 'moteur.ts', 'niveaux.ts', 'regles.ts', 'rng.ts', 'robot.ts', 'roulette.ts', 'rouletteCasino.ts', 'types.ts', 'vue.ts'],
  server: ['classement.ts', 'ventesCasino.ts', 'cerclesCasino.ts', 'bourseCasino.ts', 'comptes.ts', 'fictifs.ts', 'index.ts', 'notifications.ts', 'salonCasino.ts', 'serveur.ts', 'showFolleNuit.ts', 'festinCasino.ts', 'couronneCasino.ts', 'chuteCasino.ts', 'ticketsCasino.ts', 'toitsCasino.ts', 'courseCasino.ts', 'baronWheelCasino.ts', 'defisCasino.ts', 'tablesCasino.ts', 'tablesRoulette.ts'],
  tests: ['blackjack.test.ts', 'casino.test.ts', 'contrats.test.ts', 'ventes.test.ts', 'hotel.test.ts', 'cercles.test.ts', 'bourse.test.ts', 'marche.test.ts', 'tailleur.test.ts', 'invite.test.ts', 'tickets.test.ts', 'toits.test.ts', 'plinko.test.ts', 'bulles.test.ts', 'classement.test.ts', 'comptes.test.ts', 'couronne.test.ts', 'chute.test.ts', 'course.test.ts', 'baronWheel.test.ts', 'afficheCasino.test.ts', 'profilCasino.test.ts', 'folleNuit.test.ts', 'festin.test.ts', 'machineNuits.test.ts', 'regles.test.ts', 'rouletteCasino.test.ts', 'serveur.test.ts', 'simulation.test.ts'],
};
let deplaces = 0;
const ranger = (fichier, dossier) => {
  if (!existsSync(fichier)) return;
  mkdirSync(dossier, { recursive: true });
  renameSync(fichier, `${dossier}/${fichier}`);
  deplaces++;
};
for (const [dossier, fichiers] of Object.entries(dossiers)) for (const f of fichiers) ranger(f, dossier);
for (const f of readdirSync('.')) if (f.endsWith('.webp') || f.endsWith('.mp3')) ranger(f, 'client/public/cartes');
console.log(deplaces ? `${deplaces} fichiers rangés dans leurs dossiers.` : 'Fichiers déjà rangés.');
