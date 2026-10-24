import { useEffect, useRef, useState } from 'react';
import { CARTE } from '../../shared/cartes';
import { POINTS_ANNONCE_ZERO_PAR_NUIT, POINTS_PAR_PLI_ANNONCE, PENALITE_PAR_ECART } from '../../shared/config';
import type { PliTermine, Vue } from '../../shared/types';
import { EFFET_EVENEMENT, NOM_EVENEMENT, NOM_SPECIALE, effetCarte, nomCarte } from './textes';
import { EN, tr } from './traduction';

/** Le tutoriel a été commencé au moins une fois sur ce téléphone (pour ne plus le proposer à l'accueil). */
export const CLE_TUTORIEL = 'ldb-tutoriel';
export function marquerTutoriel(etat: 'commence' | 'fini') {
  try {
    if (localStorage.getItem(CLE_TUTORIEL) !== 'fini') localStorage.setItem(CLE_TUTORIEL, etat);
  } catch {
    /* stockage indisponible */
  }
}
export function tutorielDejaVu(): boolean {
  try {
    return !!localStorage.getItem(CLE_TUTORIEL);
  } catch {
    return false;
  }
}

/** Zone du jeu mise en avant pendant une étape : la page l'entoure d'un halo doré. */
type Cible = 'annonce' | 'main' | 'tapis' | 'vol' | 'scores' | null;

interface Etape {
  id: string;
  titre: string;
  texte: string;
  cible: Cible;
  /** Étape liée à une action du joueur : elle disparaît d'elle-même quand l'action est faite. */
  action?: boolean;
}

const AVEC_ARTICLE: Record<string, string> = {
  baron: 'le Baron',
  pickpocket: 'le Pickpocket',
  homme_de_main: 'l’Homme de main',
  alibi: 'l’Alibi',
  juge: 'le Juge',
  croupier: 'le Croupier',
};
const nomSpeciale = (s: string) => (EN ? `the ${NOM_SPECIALE[s as keyof typeof NOM_SPECIALE] ?? s}` : (AVEC_ARTICLE[s] ?? s));

/** Étapes possibles maintenant (dans l'ordre où elles doivent être lues). */
function etapesPossibles(v: Vue, pliAffiche: PliTermine | null, revelation: boolean, nom: (id: string) => string): Etape[] {
  const liste: Etape[] = [];
  const attenduMoi = v.attente.includes(v.moi);
  const main = v.main.map((c) => c.id);
  if (v.nuit === 1 && v.phase === 'ANNONCES') {
    liste.push({
      id: 'bienvenue',
      titre: tr('Bienvenue à la table !', 'Welcome to the table!'),
      texte: tr(
        'Tu affrontes Greg et Cyrielle. Cette partie d’apprentissage dure 3 nuits (8 dans une vraie partie) : 1 carte chacun la nuit 1, 2 cartes la nuit 2, 3 la nuit 3. À la fin, le meilleur score devient le Dernier Baron. Prends ton temps : ici, pas de chrono.',
        'You face Greg and Cyrielle. This practice game lasts 3 nights (8 in a real game): 1 card each on night 1, 2 cards on night 2, 3 on night 3. At the end, the best score becomes the Last Baron. Take your time: no timer here.',
      ),
      cible: null,
    });
  }
  if (v.phase === 'ANNONCES' && attenduMoi && v.monAnnonce === null) {
    const carte = v.nuit === 1 && main[0] ? CARTE[main[0]] : null;
    liste.push({
      id: 'annonce',
      titre: tr('Ton annonce', 'Your bid'),
      texte: EN
        ? `Before playing, bid how many tricks you think you will win tonight. Bid made: +${POINTS_PAR_PLI_ANNONCE} per trick bid (and +${POINTS_ANNONCE_ZERO_PAR_NUIT} per night if you make 0). Bid missed: −${PENALITE_PAR_ECART} per trick off. ` +
          (carte ? `Your only card is ${nomCarte(carte.id)}: a strong card, go for 1.` : 'Count your strong cards before choosing.')
        : `Avant de jouer, annonce combien de plis tu penses gagner cette nuit. Annonce réussie : +${POINTS_PAR_PLI_ANNONCE} par pli annoncé (et +${POINTS_ANNONCE_ZERO_PAR_NUIT} par nuit si tu réussis 0). Annonce ratée : −${PENALITE_PAR_ECART} par pli d’écart. ` +
          (carte ? `Ta seule carte est ${carte.nom} : une carte forte, tente 1.` : 'Compte tes cartes fortes avant de choisir.'),
      cible: 'annonce',
      action: true,
    });
  }
  if (v.evenement && !revelation && v.phase !== 'FIN_DE_NUIT' && v.phase !== 'FIN_DE_PARTIE') {
    liste.push({
      id: 'evenement',
      titre: tr(`Événement : ${NOM_EVENEMENT[v.evenement]}`, `Event: ${NOM_EVENEMENT[v.evenement]}`),
      texte: tr(
        `Chaque nuit, sauf la première et la dernière, une carte événement change une règle. Cette nuit : ${EFFET_EVENEMENT[v.evenement].toLowerCase()} Le bandeau en haut le rappelle.`,
        `Every night except the first and the last, an event card changes a rule. Tonight: ${EFFET_EVENEMENT[v.evenement].toLowerCase()} The banner at the top reminds you.`,
      ),
      cible: null,
    });
  }
  // Cartes spéciales et Chat noir : expliqués la première fois qu'ils arrivent dans ta main.
  for (const id of main) {
    const c = CARTE[id];
    if (!c) continue;
    if (c.type === 'atout') {
      liste.push({ id: 'chat_noir', titre: tr('Le Chat noir, l’atout', 'The Black Cat, the trump'), texte: effetCarte(c), cible: 'main' });
    } else if (c.speciale) {
      liste.push({
        id: `speciale-${c.speciale}`,
        titre: tr(`Carte spéciale : ${nomSpeciale(c.speciale)}`, `Special card: ${nomSpeciale(c.speciale)}`),
        texte: `${effetCarte(c)} ${tr('Appui long sur une carte pour la voir en grand.', 'Long-press a card to see it in big.')}`,
        cible: 'main',
      });
    }
  }
  if (v.phase === 'PLI' && v.tourId === v.moi) {
    liste.push({
      id: 'jouer',
      titre: tr('À toi de jouer', 'Your turn'),
      texte:
        v.pli.length === 0
          ? tr(
              'Tu ouvres le pli : la famille de ta carte (Billets, Diamants, Lames ou Lingots) devient la famille demandée. Les cartes que tu peux jouer sont entourées d’or : touche-en une, puis valide.',
              'You lead the trick: your card’s suit (Cash, Diamonds, Blades or Gold) becomes the suit led. The cards you can play are outlined in gold: tap one, then confirm.',
            )
          : tr(
              'Suis la famille demandée si tu en as une. Sinon, joue un Chat noir (l’atout) ou n’importe quelle carte. Les cartes jouables sont entourées d’or : touche-en une, puis valide.',
              'Follow the suit led if you have it. Otherwise, play a Black Cat (the trump) or any card. Playable cards are outlined in gold: tap one, then confirm.',
            ),
      cible: 'main',
      action: true,
    });
  }
  if (pliAffiche && v.phase === 'FIN_DE_PLI') {
    liste.push({
      id: 'pli',
      titre: pliAffiche.gagnantId === v.moi ? tr('Tu remportes le pli', 'You win the trick') : tr(`${nom(pliAffiche.gagnantId)} remporte le pli`, `${nom(pliAffiche.gagnantId)} wins the trick`),
      texte: tr(
        'La plus forte carte de la famille demandée gagne, sauf si un Chat noir ou une carte spéciale passe devant. Le gagnant garde la plus belle carte de gang du pli : c’est son butin, qui rapporte ses points si son annonce est réussie.',
        'The highest card of the suit led wins, unless a Black Cat or a special card beats it. The winner keeps the best gang card of the trick: that is their loot, which scores its points if their bid is made.',
      ),
      cible: 'tapis',
    });
  }
  if (v.phase === 'VOL' && v.vol?.voleurId === v.moi) {
    liste.push({
      id: 'vol',
      titre: tr('Vol !', 'Theft!'),
      texte: tr(
        'Ta carte te permet de voler une carte de butin à un adversaire : touche la carte à prendre. Un joueur qui garde un Alibi en main est protégé. Tu peux aussi ne rien voler.',
        'Your card lets you steal a loot card from an opponent: tap the card to take. A player holding an Alibi is protected. You can also steal nothing.',
      ),
      cible: 'vol',
      action: true,
    });
  }
  if (v.phase === 'FIN_DE_NUIT') {
    liste.push({
      id: 'fin_nuit',
      titre: tr('Fin de la nuit', 'End of the night'),
      texte: tr(
        `Chacun marque ses points : annonce réussie, +${POINTS_PAR_PLI_ANNONCE} par pli et le butin ; annonce ratée, −${PENALITE_PAR_ECART} par pli d’écart et pas de butin. Touche le bouton pour passer à la nuit suivante.`,
        `Everyone scores: bid made, +${POINTS_PAR_PLI_ANNONCE} per trick plus the loot; bid missed, −${PENALITE_PAR_ECART} per trick off and no loot. Tap the button to go to the next night.`,
      ),
      cible: 'scores',
    });
  }
  return liste;
}

/** Message de fin du tutoriel, affiché dans la fenêtre de fin de partie (au-dessus des boutons). */
export function FinTutoriel() {
  return (
    <div className="tuto-fin">
      <strong>{tr('Bravo, tu connais les bases !', 'Well done, you know the basics!')}</strong>
      <p>
        {tr(
          'Une vraie partie dure 8 nuits, avec 30 secondes par tour, d’autres cartes spéciales (Homme de main, Alibi, Juge, Croupier…) et d’autres événements. Les règles complètes sont dans le menu. Prêt pour une partie en ligne ?',
          'A real game lasts 8 nights, with 30 seconds per turn, more special cards (Henchman, Alibi, Judge, Croupier…) and more events. The full rules are in the menu. Ready for an online game?',
        )}
      </p>
    </div>
  );
}

/** Bulles d'explication du tutoriel, affichées une par une au bon moment de la partie. */
export function Tutoriel(props: { v: Vue; pliAffiche: PliTermine | null; revelation: boolean; nom: (id: string) => string }) {
  const { v, pliAffiche, revelation, nom } = props;
  const vues = useRef(new Set<string>());
  const [file, setFile] = useState<Etape[]>([]);
  const [masque, setMasque] = useState(false);
  const possibles = etapesPossibles(v, pliAffiche, revelation, nom);
  const cle = possibles.map((e) => e.id).join('|');

  useEffect(() => marquerTutoriel('commence'), []);
  useEffect(() => {
    if (v.phase === 'FIN_DE_PARTIE') marquerTutoriel('fini');
  }, [v.phase]);
  // Nouvelles étapes : ajoutées à la file. Étapes d'action devenues inutiles (annonce faite, carte jouée) : retirées.
  useEffect(() => {
    setFile((f) => {
      const actives = new Set(possibles.map((e) => e.id));
      const gardees = f.filter((e) => !e.action || actives.has(e.id));
      const nouvelles = possibles.filter((e) => !vues.current.has(e.id) && !gardees.some((g) => g.id === e.id));
      nouvelles.forEach((e) => vues.current.add(e.id));
      return nouvelles.length || gardees.length !== f.length ? [...gardees, ...nouvelles] : f;
    });
  }, [cle]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pendant que la carte d'événement tourne au centre de l'écran, les bulles attendent.
  const etape = masque || revelation ? null : (file[0] ?? null);
  useEffect(() => {
    if (etape?.cible) document.body.dataset.tuto = etape.cible;
    else delete document.body.dataset.tuto;
    return () => {
      delete document.body.dataset.tuto;
    };
  }, [etape?.cible]);
  if (!etape) return null;
  return (
    <div className={`tuto-bulle ${etape.cible === 'scores' ? 'bas' : ''}`} role="dialog" aria-live="polite" aria-label={etape.titre} key={etape.id}>
      <p className="tuto-etiquette">{tr('Tutoriel', 'Tutorial')}</p>
      <strong className="tuto-titre">{etape.titre}</strong>
      <p className="tuto-texte">{etape.texte}</p>
      <div className="tuto-actions">
        <button type="button" className="lien-discret" onClick={() => setMasque(true)}>
          {tr('Masquer les conseils', 'Hide tips')}
        </button>
        <button type="button" className="principal petit" onClick={() => setFile((f) => f.slice(1))}>
          {etape.action ? 'OK' : tr('Compris', 'Got it')}
        </button>
      </div>
    </div>
  );
}
