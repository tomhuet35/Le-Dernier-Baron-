import { comptesDepuisEnvironnement } from './comptes';
import { creerNotifications } from './notifications';
import { demarrerServeur } from './serveur';

const port = Number(process.env.PORT) || 3000;
// Délais facultatifs (millisecondes), utiles pour accélérer les tests.
const delaiRobot = Number(process.env.DELAI_ROBOT_MS) || undefined;
const delaiFinDePli = Number(process.env.DELAI_FIN_DE_PLI_MS) || undefined;
const attentePublique = Number(process.env.ATTENTE_PUBLIQUE_MS) || undefined;

// Comptes joueurs (Firebase) : activés seulement si FIREBASE_CONFIG et la clé du compte de service sont présentes.
const comptes = await comptesDepuisEnvironnement(process.env);
// Notifications d'invitation (jeu fermé) : seulement avec les comptes, puisqu'on invite ses amis.
const notifications = await creerNotifications(comptes, process.env);
// Adresse de contact de la page Confidentialité : réglée sur Render, jamais écrite dans le code public.
const contact = process.env.CONTACT_EMAIL?.trim() || 'ledernierbaron@gmail.com';
// Joueurs de remplissage du classement de la semaine : JOUEURS_FICTIFS=non sur Render pour les retirer.
const joueursFictifs = process.env.JOUEURS_FICTIFS !== 'non';

// Une erreur imprévue est notée, sans faire tomber le serveur (et avec lui toutes les parties et le casino en cours).
process.on('unhandledRejection', (e) => console.error('Erreur non rattrapée (promesse) :', e));
process.on('uncaughtException', (e) => console.error('Erreur non rattrapée :', e));

demarrerServeur({ port, delaiRobot, delaiFinDePli, attentePublique, comptes, notifications, contact, joueursFictifs }).then(({ port: p, fermer }) => {
  console.log(`Le Dernier Baron est en ligne sur http://localhost:${p}`);
  garderEveille();
  // Render arrête le serveur (SIGTERM) à chaque mise à jour du site : les soldes du casino sont écrits et les mises
  // encore en jeu rendues avant de s'arrêter (10 secondes au plus).
  let arret = false;
  const arreter = (signal: string) => {
    if (arret) return;
    arret = true;
    console.log(`${signal} reçu : sauvegarde avant l'arrêt…`);
    const limite = setTimeout(() => process.exit(0), 10_000);
    void fermer()
      .catch((e) => console.error('Arrêt : sauvegarde incomplète :', e))
      .finally(() => {
        clearTimeout(limite);
        process.exit(0);
      });
  };
  process.on('SIGTERM', () => arreter('SIGTERM'));
  process.on('SIGINT', () => arreter('SIGINT'));
});

/**
 * Render (offre gratuite) endort le site après 15 minutes sans visite : le joueur suivant attend alors près d'une minute.
 * Le serveur passe donc par sa propre adresse publique toutes les 10 minutes, ce qui compte comme une visite.
 * Render fournit cette adresse (RENDER_EXTERNAL_URL) ; GARDER_EVEILLE=non désactive ce réveil.
 */
function garderEveille() {
  const adresse = process.env.RENDER_EXTERNAL_URL;
  if (!adresse || process.env.GARDER_EVEILLE === 'non') return;
  const url = `${adresse.replace(/\/$/, '')}/api/ping`;
  const coucou = () =>
    fetch(url, { signal: AbortSignal.timeout(20_000) }).catch((e) => console.log('Réveil automatique : échec', (e as Error).message));
  setInterval(coucou, 10 * 60 * 1000);
  setTimeout(coucou, 60 * 1000);
  console.log(`Réveil automatique activé : ${url} toutes les 10 minutes.`);
}
