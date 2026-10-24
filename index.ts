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

demarrerServeur({ port, delaiRobot, delaiFinDePli, attentePublique, comptes, notifications, contact }).then(({ port: p }) => {
  console.log(`Le Dernier Baron est en ligne sur http://localhost:${p}`);
  garderEveille();
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
