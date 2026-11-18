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
| `CONTACT_EMAIL` | Facultative. Adresse de contact de la page Confidentialité (`/confidentialite`) et des notifications ; par défaut `ledernierbaron@gmail.com`. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Facultatives. Clés des notifications d'invitation. Sans elles, le serveur les crée une fois et les garde dans Firestore (collection `parametres`). |
| `GARDER_EVEILLE` | `non` désactive le réveil automatique du site toutes les 10 minutes. |

Pendant le pli, le tapis s'agrandit et les boutons se rangent dans le menu ⋯ ; il revient à la vue normale au début de chaque pli (Réglages → Tapis en grand pour le désactiver).

Le jeu est en français et en anglais : il suit la langue du téléphone, et Réglages → Langue permet de changer. Les signalements de joueurs sont gardés 6 mois dans Firestore (collection `signalements`).

**Classement de la semaine** (avec les comptes joueurs) : chaque joueur y garde son meilleur score de la semaine, dans les parties jouées jusqu'au bout avec au moins 2 joueurs humains. Il repart à zéro le lundi à 0 h (heure de Paris). Les 3 premiers portent la couronne d'or, d'argent ou de bronze à côté de leur nom, partout dans le jeu, et la bannière de l'accueil montre le premier (le gagnant de la semaine précédente tant que personne n'a encore joué). Chaque lundi, les 10 premiers de la semaine qui vient de finir gagnent de l'XP (500 pour le 1er, 300 pour le 2e, 200 pour le 3e, puis 100 jusqu'au 10e, réglable dans `shared/niveaux.ts`) : elle est ajoutée une seule fois, à leur première connexion de la semaine suivante, avec une animation. Les scores sont gardés 8 semaines dans Firestore (collection `classements`, créée toute seule).

**Roulette du jour** (avec un compte) : un tour gratuit par jour (il revient à minuit, heure de Paris), depuis l'accueil. Huit cases : de l'XP, ou un personnage à gagner — la Danseuse, puis la Journaliste, puis le Barman (chacun une seule fois, ensuite la case devient un gros lot de 200 XP). Les personnages gagnés se choisissent dans le salon ; le serveur refuse les autres.

**Grand Hôtel du Baron, contrats et album** (Salon privé) : 3 contrats par jour (minuit, heure de Paris), tirés au sort et adaptés au niveau du casino ; chacun rapporte 2 rubis, des dollars (50 000 $ par niveau) et un morceau d'album, et les 3 remplis donnent 5 rubis de plus. Un contrat se change une fois par jour pour 3 rubis. Trois gros coups par semaine (lundi 0 h) rapportent 10 rubis chacun. L'Album du Baron a une page par jeu, 6 morceaux par page : un morceau par contrat, et un pour la première victoire du jour à chaque jeu ; une page complète rapporte 10 rubis, l'album entier 50. Les rubis ne se gagnent jamais aux jeux, ne s'envoient pas et ne s'achètent pas ; sous 10 000 $, on peut échanger 5 rubis contre des dollars une fois par jour (jamais l'inverse), et les envois à des amis reprennent le lendemain. Tout est gardé avec le casino du compte (champ `casino.salon`), et les réglages sont dans `shared/contrats.ts`.

**Salle des ventes et Bureau du Baron** (Salon privé) : chaque jour, 3 lots aux enchères entre tous les joueurs du salon, jusqu'à minuit (heure de Paris) ; le troisième se joue en rubis. Une enchère bloque la somme et dépasse la précédente d'au moins 10 % ; la somme dépassée est rendue aussitôt. Mises de départ : 10 M$ (commun), 100 M$ (rare), 1 Md$ (précieux), 10 Md$ (légendaire), ou 15 / 40 / 100 / 250 rubis. À minuit, l'objet part chez le meilleur enchérisseur et rejoint les vitrines de son bureau (10 objets, `shared/ventes.ts`). La valeur de la collection fait le classement « La plus belle collection » ; la collection complète rapporte 100 rubis et le cadre d'avatar Mécène (l'album complet donne le cadre Collectionneur). Les lots sont gardés avec les réglages du serveur (document `casino`, champ `ventes`) : une vente finie pendant un arrêt du serveur se règle au redémarrage.

**Grand Hôtel du Baron** (Salon privé) : l'accueil montre l'hôtel en coupe ; on appuie sur un étage. Les étages s'ouvrent avec le niveau du casino : le bar (machines à sous, Coffres) dès le niveau 1, les tables (blackjack, roulette) au niveau 5, la scène (Folle Nuit, The Baron's Wheel, Course, Couronne, Chute) au niveau 15, le Penthouse au niveau 40 (champagne du jour : 3 rubis et des dollars ; tables VIP à venir). Le serveur refuse les mises d'un jeu dont l'étage est fermé. Carte de membre selon le niveau : bronze, argent (20, roulette du salon ×1,5), or (40, ×2), noire (70, ×3 et Ristourne du Baron : 5 % des pertes de la semaine rendues le lundi, 5 Md$ au plus). Semaine du Baron : un télégramme par jour du lundi au dimanche (heure de Paris), et le dimanche un coffre de 15 rubis si les six autres jours ont été ouverts (5 sinon). Happy hour chaque soir de 21 h à 22 h : XP doublée sur toutes les mises. Réglages dans `shared/hotel.ts`.

**Les Cercles** (Salon privé) : des clubs de 20 membres au plus, avec un nom et un blason (8 au choix). Fonder un cercle coûte 50 rubis, changer de blason 10. Rôles : Président (le fondateur ; ouvre ou ferme le cercle, nomme le Croupier en chef), Croupier en chef (accepte les demandes, exclut des membres), Membres. 1 % des mises des membres alimente la cagnotte (offerte par la maison), tirée au sort chaque lundi entre les membres qui ont misé. Classement des cercles par mises de la semaine, discussion du cercle (60 derniers messages, filtrés). Gardé avec les réglages du serveur (document `cercles`). Réglages dans `shared/cercles.ts`.

**La Bourse de 1929** (Salon privé) : six sociétés fictives, une séance toutes les 5 minutes. Les cours bougent selon la nervosité de chaque titre ; parfois une nouvelle du « Petit Baron » fait bondir ou chuter un titre, ou tout le marché (krach de −25 à −45 %, envolée de +15 à +30 %). Les cours restent entre 10 % et 800 % de leur référence et y reviennent doucement. Achat de 1 M$ à 1 Md$, vente d'un quart, de la moitié ou de tout, 1 % de courtage à chaque ordre. Cours gardés avec les réglages du serveur (document `bourse`), portefeuilles avec le casino du joueur. Réglages dans `shared/bourse.ts`.

**Tables VIP du Penthouse** : blackjack et roulette aux mises dix fois plus hautes (blackjack de 10 000 à 2 500 000 $ ; roulette, jetons de 10 000 à 5 000 000 $, 10 M$ par tour), réservées au niveau 40. Elles s'ouvrent depuis le Penthouse et sont listées à part des tables ordinaires ; le serveur refuse de créer ou de rejoindre une table VIP sous le niveau 40.

**Le Marché noir** (Salon privé) : chaque jour, un étal de 4 articles payés en rubis, propre à chaque joueur : deux cadres d'avatar rares (40 rubis), un objet de collection pour le bureau (2,5 fois sa mise de départ en rubis) et une mallette de dollars (8 rubis). Il change à minuit (heure de Paris) ; on peut le relancer 3 fois par jour pour 5 rubis. Le joueur choisit le cadre qu'il porte parmi ceux gagnés ou achetés. Réglages dans `shared/marche.ts`.

**Le Tailleur du Baron** (Salon privé) : une boutique de 12 tenues, chacune un personnage complet (images `avatar-10` à `avatar-21`). Tenues de ville à 50 M$, de soirée à 500 M$, de prestige à 150 rubis (la Baronne : 300). Une tenue achetée se porte au salon à la place du personnage du compte (tables, classements, cercles, défis) ; on peut revenir à son personnage habituel. Réglages dans `shared/tailleur.ts`.

**Regarder un ami jouer** : dans la liste d'amis, le bouton « Regarder » apparaît quand un ami est en pleine partie (sauf le tutoriel). Le spectateur suit la partie depuis la place de son ami, sans jamais recevoir de carte en main ni les annonces avant leur révélation ; il lit le chat sans écrire. Les joueurs voient qui regarde (pastille 👁 sur le tapis), 10 spectateurs au plus par table.

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
  - `vue.ts` : `vuePourJoueur`, ce que chaque joueur a le droit de voir, et `vueSpectateur`, ce que voit un ami qui regarde (rien de caché).
  - `config.ts` : les points, les bonus et les **arbitrages** des cas que la règle papier ne précise pas. C'est le fichier à modifier pour changer une règle.
  - `cartes.ts` : les 72 cartes, générées à partir de `cartes.json`.
  - `robot.ts` : le joueur automatique.
- `server/` : le serveur Node.js et Socket.IO (salons à code, reconnexion, robots, enchaînement automatique des plis). `classement.ts` tient le classement de la semaine.
- `client/` : l'interface React, pensée d'abord pour le téléphone. Les illustrations sont dans `client/public/cartes/`.
- `tests/` : les tests Vitest.

Principes de sécurité du jeu : le serveur détient seul l'état complet et vérifie chaque action. Chaque joueur ne reçoit que sa propre main : les mains adverses, les annonces non révélées et les choix secrets (Trahison, Alliance) ne quittent jamais le serveur. Les tests vérifient ce point à chaque étape de parties simulées.

Les parties sont gardées en mémoire, sans base de données (seuls les comptes et le classement sont dans Firestore). Un salon abandonné est supprimé au bout de 3 heures.
