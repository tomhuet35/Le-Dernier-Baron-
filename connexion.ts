/**
 * Connexion aux comptes joueurs avec Firebase Authentication (e-mail + mot de passe, ou Google).
 * Ce module n'est chargé que si le serveur annonce des comptes configurés.
 */
import { initializeApp } from 'firebase/app';
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type Auth,
} from 'firebase/auth';
import { EN, LANGUE } from './traduction';

export interface ConfigComptes {
  firebase: { apiKey: string; authDomain: string; projectId: string; appId?: string };
  emulateurAuth?: string | null;
}

export interface Utilisateur {
  uid: string;
  email: string | null;
  nom: string | null;
}

let auth: Auth | null = null;
const a = () => {
  if (!auth) throw new Error('Comptes non démarrés');
  return auth;
};

export function demarrer(config: ConfigComptes) {
  if (auth) return;
  auth = getAuth(initializeApp(config.firebase));
  auth.languageCode = LANGUE; // e-mails et fenêtre Google dans la langue du jeu
  if (config.emulateurAuth) connectAuthEmulator(auth, `http://${config.emulateurAuth.replace(/^https?:\/\//, '')}`, { disableWarnings: true });
}

/** Appelé à chaque connexion ou déconnexion (y compris au chargement de la page). */
export function suivre(rappel: (u: Utilisateur | null) => void): () => void {
  return onAuthStateChanged(a(), (u) => rappel(u ? { uid: u.uid, email: u.email, nom: u.displayName } : null));
}

export async function jeton(forcer = false): Promise<string | null> {
  return a().currentUser ? a().currentUser!.getIdToken(forcer) : null;
}

export async function inscrire(email: string, motDePasse: string, pseudo: string) {
  const { user } = await createUserWithEmailAndPassword(a(), email.trim(), motDePasse);
  if (pseudo.trim()) {
    await updateProfile(user, { displayName: pseudo.trim().slice(0, 16) });
    await user.getIdToken(true); // le jeton suivant contient le pseudo
  }
}

export async function connecter(email: string, motDePasse: string) {
  await signInWithEmailAndPassword(a(), email.trim(), motDePasse);
}

export async function connecterGoogle() {
  const fournisseur = new GoogleAuthProvider();
  fournisseur.setCustomParameters({ prompt: 'select_account' });
  await signInWithPopup(a(), fournisseur);
}

export async function reinitialiser(email: string) {
  await sendPasswordResetEmail(a(), email.trim());
}

export async function deconnecter() {
  await signOut(a());
}

const MESSAGES_EN: Record<string, string> = {
  'auth/invalid-email': 'Invalid e-mail address.',
  'auth/missing-email': 'Enter your e-mail address.',
  'auth/missing-password': 'Enter your password.',
  'auth/weak-password': 'Password too short: at least 6 characters.',
  'auth/email-already-in-use': 'An account already exists with this address: sign in.',
  'auth/invalid-credential': 'Wrong e-mail or password.',
  'auth/invalid-login-credentials': 'Wrong e-mail or password.',
  'auth/wrong-password': 'Wrong e-mail or password.',
  'auth/user-not-found': 'No account with this address.',
  'auth/user-disabled': 'This account has been disabled.',
  'auth/too-many-requests': 'Too many attempts: try again in a few minutes.',
  'auth/popup-closed-by-user': 'Google sign-in cancelled.',
  'auth/cancelled-popup-request': 'Google sign-in cancelled.',
  'auth/popup-blocked': 'The Google window was blocked: allow pop-ups or use your e-mail.',
  'auth/unauthorized-domain': 'This site is not authorised in Firebase yet (Authentication > Settings > Authorised domains).',
  'auth/operation-not-allowed': 'This sign-in method is not enabled in Firebase.',
  'auth/network-request-failed': 'No internet connection.',
  'auth/requires-recent-login': 'Sign in again, then retry.',
  'auth/account-exists-with-different-credential': 'This address is already linked to another sign-in method.',
  'auth/internal-error': 'Sign-in failed: try again, or use your e-mail and a password.',
};

const MESSAGES_FR: Record<string, string> = {
  'auth/invalid-email': 'Adresse e-mail invalide.',
  'auth/missing-email': 'Entre ton adresse e-mail.',
  'auth/missing-password': 'Entre ton mot de passe.',
  'auth/weak-password': 'Mot de passe trop court : 6 caractères minimum.',
  'auth/email-already-in-use': 'Un compte existe déjà avec cette adresse : connecte-toi.',
  'auth/invalid-credential': 'E-mail ou mot de passe incorrect.',
  'auth/invalid-login-credentials': 'E-mail ou mot de passe incorrect.',
  'auth/wrong-password': 'E-mail ou mot de passe incorrect.',
  'auth/user-not-found': 'Aucun compte avec cette adresse.',
  'auth/user-disabled': 'Ce compte a été désactivé.',
  'auth/too-many-requests': 'Trop de tentatives : réessaie dans quelques minutes.',
  'auth/popup-closed-by-user': 'Connexion Google annulée.',
  'auth/cancelled-popup-request': 'Connexion Google annulée.',
  'auth/popup-blocked': 'La fenêtre Google a été bloquée : autorise les fenêtres pop-up ou utilise ton e-mail.',
  'auth/unauthorized-domain': 'Ce site n’est pas encore autorisé dans Firebase (Authentication > Paramètres > Domaines autorisés).',
  'auth/operation-not-allowed': 'Ce mode de connexion n’est pas activé dans Firebase.',
  'auth/network-request-failed': 'Pas de connexion internet.',
  'auth/requires-recent-login': 'Reconnecte-toi puis réessaie.',
  'auth/account-exists-with-different-credential': 'Cette adresse est déjà liée à un autre mode de connexion.',
  'auth/internal-error': 'La connexion n’a pas pu aboutir : réessaie, ou utilise ton e-mail et un mot de passe.',
};

export function messageErreur(e: unknown): string {
  const code = typeof e === 'object' && e && 'code' in e ? String((e as { code: unknown }).code) : '';
  const messages = EN ? MESSAGES_EN : MESSAGES_FR;
  const generique = EN ? 'Sign-in error' : 'Erreur de connexion';
  return messages[code] ?? (code ? `${generique} (${code.replace('auth/', '')}).` : `${generique}.`);
}
