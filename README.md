# Le Dernier Baron, en ligne

Jeu de plis avec annonces pour 3 à 6 joueurs, jouable sur téléphone. Un joueur crée une partie, partage le lien, ses amis le rejoignent et l'application gère toute la partie : distribution, événements, annonces, plis, vols et scores.

## Mettre le jeu en ligne gratuitement (Render)

Pour jouer chacun chez soi, le jeu doit tourner sur un serveur accessible depuis Internet. Render propose une offre gratuite qui convient.

1. **Créer un compte GitHub** (gratuit) sur github.com, puis un nouveau dépôt : bouton « New », nom `le-dernier-baron`, visibilité au choix, puis « Create repository ».
2. **Envoyer les fichiers** : dans le dépôt, cliquer sur « uploading an existing file », puis glisser **le contenu** du dossier `le-dernier-baron` (pas le dossier lui-même), et valider avec « Commit changes ». Le projet compte moins de 100 fichiers et passe en un seul envoi.
3. **Créer un compte Render** sur render.com, en se connectant avec GitHub.
4. Dans Render : « New » → « Web Service » → choisir le dépôt `le-dernier-baron`, puis renseigner :
   - **Runtime** : Node
   - **Build Command** : `npm install --include=dev && npm run build`
   - **Start Command** : `npm start`
   - **Instance Type** : Free
5. Cliquer sur « Deploy ». Après quelques minutes, Render affiche l'adresse du jeu, du type `https://le-dernier-baron.onrender.com`. C'est ce lien qu'on ouvre sur les téléphones.

Bon à savoir sur l'offre gratuite de Render :
- le serveur s'endort après 15 minutes sans joueur ; la première ouverture suivante prend environ une minute ;
- les parties sont gardées en mémoire : si le serveur s'endort ou redémarre, la partie en cours est perdue. Pendant une partie, l'activité des joueurs le garde éveillé.

### Variables à régler sur Render (onglet « Environment »)

| Variable | Rôle |
|---|---|
| `CONTACT_EMAIL` | Adresse de contact affichée sur la page Confidentialité (`/confidentialite`). Obligatoire en France dès que le jeu crée des comptes. Elle n'est jamais écrite dans le code public. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Facultatives. Clés des notifications d'invitation. Sans elles, le serveur les crée une fois et les garde dans Firestore (collection `parametres`). |
| `GARDER_EVEILLE` | `non` désactive le réveil automatique du site toutes les 10 minutes. |

Le jeu s'installe comme une application (bouton « Installer le jeu » sur Android et ordinateur ; sur iPhone et iPad : Partager → « Sur l'écran d'accueil »). Les notifications d'invitation demandent un compte, et sur iPhone ou iPad, iOS 16.4 ou plus récent avec le jeu installé sur l'écran d'accueil.

## Jouer sur le même Wi-Fi, sans mise en ligne

Il faut un ordinateur avec [Node.js](https://nodejs.org) (version 18 ou plus récente).

```bash
npm install
npm run build
npm start
```

Le jeu s'ouvre sur `http://localhost:3000`. Les amis connectés au même Wi-Fi utilisent l'adresse de l'ordinateur, par exemple `http://192.168.1.20:3000` (l'adresse IP de l'ordinateur se trouve dans ses réglages réseau).

## Tester seul avec des robots

Ajoute `?test=1` à l'adresse (par exemple `http://localhost:3000/?test=1`) avant de créer la partie : un bouton « Ajouter un robot (test) » apparaît dans le salon. Les robots jouent un coup autorisé au hasard. On peut aussi ouvrir plusieurs onglets, chacun jouant comme un joueur distinct (dans des fenêtres de navigation privée pour qu'ils ne partagent pas la même session).

Pendant une partie, si un joueur se déconnecte, l'hôte peut le faire remplacer par l'ordinateur jusqu'à son retour.

## Pour les développeurs

| Commande | Rôle |
|---|---|
| `npm run dev` | Serveur de jeu (port 3000) et interface avec rechargement à chaud (port 5173) |
| `npm run build` | Construit l'interface et le serveur dans `dist/` |
| `npm start` | Lance la version construite |
| `npm test` | Tests des règles, parties simulées et test de bout en bout du serveur |
| `npm run verifier` | Vérification des types TypeScript |

Organisation du code :
- `shared/` : le moteur de jeu, pur et sans entrée ni sortie.
  - `regles.ts` : famille demandée, cartes jouables, gagnant du pli, butin, score.
  - `moteur.ts` : la machine à états (phases TRAHISON, ANNONCES, ALLIANCE, PLI, VOL, FIN_DE_PLI, FIN_DE_NUIT, FIN_DE_PARTIE).
  - `vue.ts` : `vuePourJoueur`, ce que chaque joueur a le droit de voir.
  - `config.ts` : les points, les bonus et les **arbitrages** des cas que la règle papier ne précise pas. C'est le fichier à modifier pour changer une règle.
  - `cartes.ts` : les 72 cartes, générées à partir de `cartes.json`.
  - `robot.ts` : le joueur automatique.
- `server/` : le serveur Node.js et Socket.IO (salons à code, reconnexion, robots, enchaînement automatique des plis).
- `client/` : l'interface React, pensée d'abord pour le téléphone. Les illustrations sont dans `client/public/cartes/`.
- `tests/` : les tests Vitest.

Principes de sécurité du jeu : le serveur détient seul l'état complet et vérifie chaque action. Chaque joueur ne reçoit que sa propre main : les mains adverses, les annonces non révélées et les choix secrets (Trahison, Alliance) ne quittent jamais le serveur. Les tests vérifient ce point à chaque étape de parties simulées.

Les parties sont gardées en mémoire, sans base de données. Un salon abandonné est supprimé au bout de 3 heures.
