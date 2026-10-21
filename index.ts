import { demarrerServeur } from './serveur';

const port = Number(process.env.PORT) || 3000;
// Délais facultatifs (millisecondes), utiles pour accélérer les tests.
const delaiRobot = Number(process.env.DELAI_ROBOT_MS) || undefined;
const delaiFinDePli = Number(process.env.DELAI_FIN_DE_PLI_MS) || undefined;

demarrerServeur({ port, delaiRobot, delaiFinDePli }).then(({ port: p }) => {
  console.log(`Le Dernier Baron est en ligne sur http://localhost:${p}`);
});
