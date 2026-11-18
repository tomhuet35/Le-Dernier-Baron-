/**
 * Page de chargement du Salon privé (« Baron's Fortune ») : le rideau de velours, le logo qui s'allume, les jetons qui
 * roulent sur la barre. Pendant ce temps, on charge le code du casino, les images du salon et l'entrée au salon (le
 * serveur) ; le rideau s'ouvre quand tout est prêt. Ensuite, les images des jeux se chargent en arrière-plan.
 *
 * Ce fichier fait partie de l'application principale (pas du casino) : il s'affiche avant que le casino soit chargé.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { IMAGES_JEUX, IMAGES_SALON } from './ressourcesCasino';
import { tr } from './traduction';
import './chargement.css';

/** Le plus court et le plus long qu'on montre la page (le rideau s'ouvre même si une image traîne). */
const DUREE_MIN_MS = 2200;
const DUREE_MAX_IMAGES_MS = 12_000;

const PHRASES: [string, string][] = [
  ['Le croupier mélange les cartes…', 'The dealer is shuffling…'],
  ['On fait briller les jetons…', 'Polishing the chips…'],
  ['Le Baron allume son cigare…', 'The Baron lights his cigar…'],
  ['On ouvre les coffres…', 'Opening the safes…'],
  ['L’orchestre accorde ses cuivres…', 'The band is tuning up…'],
  ['Les chevaux entrent dans les stalles…', 'The horses are at the gate…'],
];

/** Charge une image (le navigateur la garde en cache) ; ne bloque jamais, même en cas d'erreur. */
function chargerImage(src: string): Promise<void> {
  return new Promise((ok) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => ok();
    img.onerror = () => ok();
    img.src = src;
  });
}

/** Charge des images quelques-unes à la fois ; rappel(n) après chacune. */
async function chargerImages(liste: string[], parallele: number, rappel?: (n: number) => void, arret?: () => boolean) {
  let i = 0;
  let faites = 0;
  const ouvrier = async () => {
    while (i < liste.length && !arret?.()) {
      const src = liste[i++];
      await chargerImage(src);
      rappel?.(++faites);
    }
  };
  await Promise.all(Array.from({ length: parallele }, ouvrier));
}

/** Les images des jeux, en arrière-plan (une seule fois par visite du site, et pas en mode économie de données). */
let jeuxEnCours = false;
function chargerJeuxEnFond() {
  if (jeuxEnCours) return;
  const connexion = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (connexion?.saveData) return;
  jeuxEnCours = true;
  window.setTimeout(() => void chargerImages(IMAGES_JEUX, 3), 1500);
}

/**
 * Le rideau du casino. `enfants(pret)` affiche le casino dessous ; il appelle pret() quand le salon est ouvert (vue
 * reçue du serveur). `module` charge le code du casino.
 */
export function EntreeCasino({ module, enfants }: { module: () => Promise<unknown>; enfants: (pret: () => void) => ReactNode }) {
  const [codeCharge, setCodeCharge] = useState(false);
  const [images, setImages] = useState(0);
  const [imagesFinies, setImagesFinies] = useState(false);
  const [salonPret, setSalonPret] = useState(false);
  const [tempsMin, setTempsMin] = useState(false);
  const [phrase, setPhrase] = useState(0);
  const [etat, setEtat] = useState<'charge' | 'ouverture' | 'fini'>('charge');
  const pretRef = useRef(() => setSalonPret(true));

  useEffect(() => {
    let fini = false;
    void module()
      .catch(() => undefined)
      .then(() => !fini && setCodeCharge(true));
    void chargerImages(IMAGES_SALON, 4, (n) => !fini && setImages(n)).then(() => !fini && setImagesFinies(true));
    const tMin = window.setTimeout(() => setTempsMin(true), DUREE_MIN_MS);
    const tMax = window.setTimeout(() => setImagesFinies(true), DUREE_MAX_IMAGES_MS);
    const tPhrase = window.setInterval(() => setPhrase((p) => (p + 1) % PHRASES.length), 1700);
    return () => {
      fini = true;
      window.clearTimeout(tMin);
      window.clearTimeout(tMax);
      window.clearInterval(tPhrase);
    };
  }, [module]);

  const tout = codeCharge && imagesFinies && salonPret && tempsMin;
  // Tout est prêt : le rideau s'ouvre.
  useEffect(() => {
    if (!tout || etat !== 'charge') return;
    setEtat('ouverture');
    chargerJeuxEnFond();
  }, [tout, etat]);
  // Puis la page disparaît (dans son propre effet : le changement d'état ci-dessus ne doit pas annuler ce minuteur).
  useEffect(() => {
    if (etat !== 'ouverture') return;
    const t = window.setTimeout(() => setEtat('fini'), 1300);
    return () => window.clearTimeout(t);
  }, [etat]);

  // La barre : le code (30 %), les images du salon (55 %), l'entrée au salon (15 %).
  const progression = Math.round(100 * ((codeCharge ? 0.3 : 0) + 0.55 * (imagesFinies ? 1 : images / Math.max(1, IMAGES_SALON.length)) + (salonPret ? 0.15 : 0)));

  return (
    <>
      {enfants(pretRef.current)}
      {etat !== 'fini' && (
        <div className={`chg ${etat === 'ouverture' ? 'ouvre' : ''}`} role="progressbar" aria-label={tr('Ouverture du casino', 'Opening the casino')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progression}>
          <div className="chg-rideau gauche" aria-hidden="true" />
          <div className="chg-rideau droite" aria-hidden="true" />
          <div className="chg-scene">
            <div className="chg-rayons" aria-hidden="true" />
            <div className="chg-logo">
              <img src="/cartes/logo-casino.webp" alt="Baron's Fortune" draggable={false} />
              <span className="chg-reflet" aria-hidden="true" />
              {Array.from({ length: 12 }, (_, k) => (
                <i key={k} className="chg-eclat" style={{ '--x': `${(k * 37 + 11) % 100}%`, '--y': `${(k * 53 + 7) % 100}%`, '--d': `${(k * 0.37) % 2.4}s` } as CSSProperties} aria-hidden="true" />
              ))}
            </div>
            <div className="chg-barre">
              <span className="chg-losange" aria-hidden="true" />
              <div className="chg-piste">
                <i style={{ width: `${progression}%` }} />
                <img className="chg-jeton" src="/cartes/jeton-rouge.webp" alt="" style={{ left: `${progression}%` }} />
              </div>
              <span className="chg-losange" aria-hidden="true" />
            </div>
            <p className="chg-texte">
              <span key={phrase}>{tr(...PHRASES[phrase])}</span>
              <b>{progression} %</b>
            </p>
          </div>
        </div>
      )}
    </>
  );
}
