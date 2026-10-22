import { comptesDepuisEnvironnement } from './comptes';
import { demarrerServeur } from './serveur';

const port = Number(process.env.PORT) || 3000;
// Délais facultatifs (millisecondes), utiles pour accélérer les tests.
const delaiRobot = Number(process.env.DELAI_ROBOT_MS) || undefined;
const delaiFinDePli = Number(process.env.DELAI_FIN_DE_PLI_MS) || undefined;
const attentePublique = Number(process.env.ATTENTE_PUBLIQUE_MS) || undefined;

// Comptes joueurs (Firebase) : activés seulement si FIREBASE_CONFIG et la clé du compte de service sont présentes.
const comptes = await comptesDepuisEnvironnement(process.env);

demarrerServeur({ port, delaiRobot, delaiFinDePli, attentePublique, comptes }).then(({ port: p }) => {
  console.log(`Le Dernier Baron est en ligne sur http://localhost:${p}`);
});
