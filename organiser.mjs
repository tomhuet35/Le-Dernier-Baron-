// Range les fichiers dans les bons dossiers si le dépôt a été envoyé « à plat ».
import { existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs';

const dossiers = {
  client: ['index.html'],
  'client/src': ['App.tsx', 'Table.tsx', 'Profil.tsx', 'connexion.ts', 'main.tsx', 'socket.ts', 'styles.css', 'textes.ts', 'ui.tsx'],
  'client/public': ['boite.webp', 'dos.webp', 'icone-192.png', 'icone-512.png', 'manifest.webmanifest'],
  shared: ['cartes.ts', 'config.ts', 'moteur.ts', 'niveaux.ts', 'regles.ts', 'rng.ts', 'robot.ts', 'types.ts', 'vue.ts'],
  server: ['comptes.ts', 'index.ts', 'serveur.ts'],
  tests: ['comptes.test.ts', 'regles.test.ts', 'serveur.test.ts', 'simulation.test.ts'],
};
let deplaces = 0;
const ranger = (fichier, dossier) => {
  if (!existsSync(fichier)) return;
  mkdirSync(dossier, { recursive: true });
  renameSync(fichier, `${dossier}/${fichier}`);
  deplaces++;
};
for (const [dossier, fichiers] of Object.entries(dossiers)) for (const f of fichiers) ranger(f, dossier);
for (const f of readdirSync('.')) if (f.endsWith('.webp')) ranger(f, 'client/public/cartes');
console.log(deplaces ? `${deplaces} fichiers rangés dans leurs dossiers.` : 'Fichiers déjà rangés.');
