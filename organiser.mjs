// Range les fichiers dans les bons dossiers si le dépôt a été envoyé « à plat ».
import { existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs';

const dossiers = {
  client: ['index.html', 'confidentialite.html'],
  'client/src': ['App.tsx', 'Casino.tsx', 'casino.css', 'Classement.tsx', 'Table.tsx', 'Profil.tsx', 'Regles.tsx', 'Reglages.tsx', 'reglages.ts', 'RouletteDuJour.tsx', 'appli.ts', 'Tutoriel.tsx', 'connexion.ts', 'main.tsx', 'Moderation.tsx', 'socket.ts', 'styles.css', 'textes.ts', 'traduction.ts', 'ui.tsx'],
  'client/public': ['boite.webp', 'dos.webp', 'icone-192.png', 'icone-512.png', 'icone-maskable.png', 'icone-apple.png', 'icone-badge.png', 'manifest.webmanifest', 'sw.js'],
  shared: ['cartes.ts', 'casino.ts', 'config.ts', 'langue.ts', 'machineASous.ts', 'moderation.ts', 'moteur.ts', 'niveaux.ts', 'regles.ts', 'rng.ts', 'robot.ts', 'roulette.ts', 'types.ts', 'vue.ts'],
  server: ['classement.ts', 'comptes.ts', 'fictifs.ts', 'index.ts', 'notifications.ts', 'salonCasino.ts', 'serveur.ts'],
  tests: ['casino.test.ts', 'classement.test.ts', 'comptes.test.ts', 'regles.test.ts', 'serveur.test.ts', 'simulation.test.ts'],
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
