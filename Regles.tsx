import type React from 'react';
import { useState } from 'react';
import { CARTES } from '../../shared/cartes';
import type { Famille, TypeEvenement } from '../../shared/types';
import { COULEUR_FAMILLE, EFFET_EVENEMENT, NOM_EVENEMENT, NOM_FAMILLE, infoCarte } from './textes';
import { Fenetre, Zoom } from './ui';
import { EN, tr } from './traduction';

/** Règles illustrées : chaque notion est montrée avec les vraies cartes du jeu (touche une carte pour l'agrandir). */

type Onglet = 'essentiel' | 'nuit' | 'cartes' | 'plis' | 'evenements' | 'score';
const ONGLETS: [Onglet, string][] = [
  ['essentiel', tr('L’essentiel', 'Basics')],
  ['nuit', tr('Une nuit', 'A night')],
  ['cartes', tr('Les cartes', 'Cards')],
  ['plis', tr('Les plis', 'Tricks')],
  ['evenements', tr('Événements', 'Events')],
  ['score', 'Score'],
];

const nombre = (test: (c: (typeof CARTES)[number]) => boolean) => CARTES.filter(test).length;

const FAMILLES: { famille: Famille; carte: string }[] = [
  { famille: 'billets', carte: 'billets-10' },
  { famille: 'lingots', carte: 'lingots-10' },
  { famille: 'lames', carte: 'lames-10' },
  { famille: 'diamants', carte: 'diamants-10' },
];

const PERSONNAGES: { carte: string; speciale: string; resume: string; detail: string }[] = [
  {
    carte: 'baron',
    speciale: 'baron',
    resume: tr('Bat tout le monde… sauf le Pickpocket.', 'Beats everyone… except the Pickpocket.'),
    detail: tr('Quand il gagne un pli, il peut voler un butin. +20 s’il capture un Homme de main.', 'When he wins a trick, he may steal a piece of loot. +20 if he captures a Henchman.'),
  },
  {
    carte: 'pickpocket',
    speciale: 'pickpocket',
    resume: tr('Vole un butin dès qu’il est posé.', 'Steals a piece of loot as soon as it is played.'),
    detail: tr('Il vole même s’il perd le pli. S’il tombe sur le Baron : Braquage, il gagne le pli et +40.', 'It steals even if it loses the trick. If it meets the Baron: Stick-up, it wins the trick and +40.'),
  },
  {
    carte: 'homme-de-main-1',
    speciale: 'homme_de_main',
    resume: tr('Bat toutes les cartes numérotées.', 'Beats all numbered cards.'),
    detail: tr('S’il y en a plusieurs dans le pli, le premier posé gagne. Seuls le Baron et le Juge le battent.', 'If there are several in the trick, the first one played wins. Only the Baron and the Judge beat it.'),
  },
  {
    carte: 'alibi-1',
    speciale: 'alibi',
    resume: tr('Ne gagne jamais, mais protège.', 'Never wins, but protects.'),
    detail: tr('Tant que tu le gardes en main, on ne peut pas te voler (sauf pendant un Couvre-feu). Pratique pour perdre un pli.', 'As long as you keep it in your hand, nobody can rob you (except during a Curfew). Handy for losing a trick.'),
  },
  {
    carte: 'juge',
    speciale: 'juge',
    resume: tr('Le monde à l’envers.', 'The world upside down.'),
    detail: tr('Ne gagne jamais. Quand il est dans le pli, la plus petite valeur l’emporte, toutes familles confondues.', 'Never wins. When it is in the trick, the lowest value wins, whatever the suit.'),
  },
  {
    carte: 'croupier',
    speciale: 'croupier',
    resume: tr('Vaut 0 ou 11, au choix.', 'Worth 0 or 11, your choice.'),
    detail: tr('Tu choisis en le posant : 11 pour battre un 10, ou 0 pour perdre exprès. Il compte comme la famille demandée.', 'You choose when you play it: 11 to beat a 10, or 0 to lose on purpose. It counts as the suit led.'),
  },
];

const EVENEMENTS: { type: TypeEvenement; carte: string; conseil: string }[] = [
  { type: 'casse_du_siecle', carte: 'casse-du-siecle-1', conseil: tr('Bonne nuit pour viser les grosses cartes de gang.', 'A good night to go for big gang cards.') },
  { type: 'descente_police', carte: 'descente-police-1', conseil: tr('Le butin ne rapporte rien : concentre-toi sur ton annonce.', 'Loot is worth nothing: focus on your bid.') },
  { type: 'couvre_feu', carte: 'couvre-feu-1', conseil: tr('Ton Alibi ne te sauve plus : le Baron et le Pickpocket ont le champ libre.', 'Your Alibi no longer saves you: the Baron and the Pickpocket have free rein.') },
  { type: 'trahison', carte: 'trahison-1', conseil: tr('Tu annonces d’abord, puis ta main change : prévois une marge.', 'You bid first, then your hand changes: leave yourself a margin.') },
  { type: 'alliance', carte: 'alliance-1', conseil: tr('Choisis quelqu’un dont l’annonce te semble réaliste.', 'Choose someone whose bid looks realistic.') },
];

function Carte({ id, petite, legende, onZoom }: { id: string; petite?: boolean; legende?: string; onZoom: (id: string) => void }) {
  const info = infoCarte(id);
  return (
    <figure className={`regle-carte ${petite ? 'petite' : ''}`}>
      <button type="button" onClick={() => onZoom(id)} aria-label={tr(`Voir ${info.nom} en grand`, `View ${info.nom} in big`)}>
        <img src={info.image} alt={info.nom} loading="lazy" draggable={false} />
      </button>
      {legende && <figcaption>{legende}</figcaption>}
    </figure>
  );
}

function Etape({ n, titre, children }: { n: number | string; titre: string; children: React.ReactNode }) {
  return (
    <li className="regle-etape">
      <span className="regle-numero">{n}</span>
      <div>
        <strong>{titre}</strong>
        {children}
      </div>
    </li>
  );
}

function Exemple({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <div className="regle-exemple">
      <span className="etiquette">{titre}</span>
      {children}
    </div>
  );
}

export function ReglesIllustrees({ ongletInitial = 'essentiel' }: { ongletInitial?: Onglet }) {
  const [onglet, setOnglet] = useState<Onglet>(ongletInitial);
  const [zoom, setZoom] = useState<string | null>(null);
  const z = setZoom;
  return (
    <div className="regles">
      <nav className="regles-onglets" aria-label={tr('Parties des règles', 'Rule sections')}>
        {ONGLETS.map(([id, nom]) => (
          <button key={id} type="button" className={onglet === id ? 'actif' : ''} aria-pressed={onglet === id} onClick={() => setOnglet(id)}>
            {nom}
          </button>
        ))}
      </nav>

      {onglet === 'essentiel' && (
        <section className="regles-page">
          <p className="regles-accroche">
            {EN ? (
              <>
                8 nights, 3 to 6 players. Each night, you bet on how many tricks you will win… and you must hit it <em>exactly</em>.
              </>
            ) : (
              <>
                8 nuits, de 3 à 6 joueurs. À chaque nuit, tu paries sur le nombre de plis que tu vas gagner… et tu dois tomber <em>pile</em>.
              </>
            )}
          </p>
          <ol className="regles-etapes">
            <Etape n={1} titre={tr('Tu reçois tes cartes', 'You get your cards')}>
              <p>
                {tr(
                  'Nuit 1 : 1 carte. Nuit 2 : 2 cartes… Nuit 8 : 8 cartes. Une nuit compte autant de plis que de cartes en main.',
                  'Night 1: 1 card. Night 2: 2 cards… Night 8: 8 cards. A night has as many tricks as cards in hand.',
                )}
              </p>
              <div className="regles-nuits" aria-hidden="true">
                {Array.from({ length: 8 }, (_, i) => (
                  <span key={i} style={{ '--n': i + 1 } as React.CSSProperties}>
                    <i />
                    {i + 1}
                  </span>
                ))}
              </div>
            </Etape>
            <Etape n={2} titre={tr('Tu annonces combien de plis tu vas gagner', 'You bid how many tricks you will win')}>
              <p>{tr('En secret, de 0 au nombre de cartes. Toutes les annonces sont révélées ensemble.', 'In secret, from 0 to the number of cards. All bids are revealed together.')}</p>
            </Etape>
            <Etape n={3} titre={tr('Chacun pose une carte, la plus forte remporte le pli', 'Everyone plays a card, the strongest wins the trick')}>
              <p>{tr('Le gagnant garde la plus belle carte de gang du pli : c’est son butin.', 'The winner keeps the best gang card of the trick: that is their loot.')}</p>
            </Etape>
            <Etape n={4} titre={tr('Tu marques des points si tu as vu juste', 'You score if you guessed right')}>
              <p>{tr('Annonce réussie : +10 par pli, plus ton butin. Annonce ratée : −10 par pli d’écart, et pas de butin.', 'Bid made: +10 per trick, plus your loot. Bid missed: −10 per trick off, and no loot.')}</p>
            </Etape>
          </ol>
          <div className="regles-couronne">
            <span aria-hidden="true">♛</span>
            <p>
              {tr('Après la 8e nuit, le joueur qui a le plus de points devient ', 'After the 8th night, the player with the most points becomes ')}
              <strong>{tr('le Dernier Baron', 'the Last Baron')}</strong>.
            </p>
          </div>
          <p className="discret">
            {tr(
              'Pendant une partie, un appui long sur une carte l’affiche en grand avec son effet. Chaque joueur a 30 secondes pour agir.',
              'During a game, a long press on a card shows it in big with its effect. Each player has 30 seconds to act.',
            )}
          </p>
        </section>
      )}

      {onglet === 'nuit' && (
        <section className="regles-page">
          <ol className="regles-etapes">
            <Etape n={1} titre={tr('Distribution', 'Deal')}>
              <p>
                {tr(
                  'Toutes les cartes sont mélangées à chaque nuit. À la nuit n, chacun reçoit n cartes. Le premier joueur est affiché avant les annonces.',
                  'All cards are shuffled every night. On night n, everyone gets n cards. The first player is shown before the bids.',
                )}
              </p>
            </Etape>
            <Etape n={2} titre={tr('Événement (nuits 2 à 7)', 'Event (nights 2 to 7)')}>
              <p>{tr('Une carte Événement est révélée au centre de la table et change les règles pour la nuit.', 'An Event card is revealed in the middle of the table and changes the rules for the night.')}</p>
              <div className="regles-rangee">
                <Carte id="trahison-1" petite onZoom={z} />
                <Carte id="casse-du-siecle-1" petite onZoom={z} />
                <Carte id="couvre-feu-1" petite onZoom={z} />
              </div>
            </Etape>
            <Etape n={3} titre={tr('Annonces', 'Bids')}>
              <p>{tr('Chacun choisit en secret combien de plis il pense gagner (de 0 au nombre de cartes), puis tout est révélé.', 'Everyone secretly chooses how many tricks they think they will win (from 0 to the number of cards), then all are revealed.')}</p>
            </Etape>
            <Etape n="+" titre={tr('Trahison ou Alliance', 'Betrayal or Alliance')}>
              <p>{tr('Ces deux événements ajoutent une étape juste après les annonces : passer une carte, ou choisir un allié.', 'These two events add a step right after the bids: pass a card, or choose an ally.')}</p>
            </Etape>
            <Etape n={4} titre={tr('Les plis', 'Tricks')}>
              <p>{tr('Le premier joueur ouvre le premier pli, puis on joue chacun son tour. Le gagnant d’un pli ouvre le suivant.', 'The first player leads the first trick, then everyone plays in turn. The winner of a trick leads the next one.')}</p>
            </Etape>
            <Etape n={5} titre={tr('Le score', 'Scoring')}>
              <p>{tr('Quand tous les plis sont joués, chacun compare ses plis à son annonce et marque ses points. Le premier joueur passe au suivant.', 'When all tricks are played, everyone compares their tricks with their bid and scores. The first player moves to the next seat.')}</p>
            </Etape>
          </ol>
        </section>
      )}

      {onglet === 'cartes' && (
        <section className="regles-page">
          <h3>
            {tr('Cartes de gang', 'Gang cards')} <small>{tr(`${nombre((c) => c.type === 'gang')} cartes`, `${nombre((c) => c.type === 'gang')} cards`)}</small>
          </h3>
          <p>{tr('Quatre familles, numérotées de 1 à 10. Ce sont elles qui forment le butin.', 'Four suits, numbered 1 to 10. They make up the loot.')}</p>
          <div className="regles-familles">
            {FAMILLES.map((f) => (
              <div key={f.famille} className="regles-famille">
                <Carte id={f.carte} onZoom={z} />
                <span className="pastille-famille" style={{ background: COULEUR_FAMILLE[f.famille] }}>
                  {NOM_FAMILLE[f.famille]}
                </span>
              </div>
            ))}
          </div>

          <h3>
            {tr('Chat noir, l’atout', 'Black Cat, the trump')} <small>{tr(`${nombre((c) => c.type === 'atout')} cartes`, `${nombre((c) => c.type === 'atout')} cards`)}</small>
          </h3>
          <div className="regles-perso">
            <Carte id="chat-noir-10" onZoom={z} />
            <div>
              <strong>{tr('Bat toutes les cartes de gang.', 'Beats all gang cards.')}</strong>
              <p>
                {tr(
                  'Il se joue à tout moment, même si tu as la famille demandée. Entre deux Chats noirs, le plus fort gagne. Il n’est jamais pris comme butin.',
                  'It can be played at any time, even if you have the suit led. Between two Black Cats, the highest wins. It is never taken as loot.',
                )}
              </p>
              <p>{tr('S’il ouvre le pli, c’est le Chat noir qui est demandé.', 'If it leads the trick, Black Cat is the suit led.')}</p>
            </div>
          </div>

          <h3>
            {tr('Les personnages', 'The characters')} <small>{tr(`${nombre((c) => c.type === 'speciale')} cartes`, `${nombre((c) => c.type === 'speciale')} cards`)}</small>
          </h3>
          <p>{tr('Ils se jouent à tout moment, même si tu as la famille demandée.', 'They can be played at any time, even if you have the suit led.')}</p>
          {PERSONNAGES.map((p) => (
            <div key={p.carte} className="regles-perso">
              <Carte id={p.carte} onZoom={z} />
              <div>
                <strong>
                  {infoCarte(p.carte).nom}
                  <small> ×{nombre((c) => c.speciale === p.speciale)}</small>
                </strong>
                <span className="regles-resume">{p.resume}</span>
                <p>{p.detail}</p>
              </div>
            </div>
          ))}
        </section>
      )}

      {onglet === 'plis' && (
        <section className="regles-page">
          <h3>{tr('Suivre la famille', 'Following suit')}</h3>
          <p>
            {EN ? (
              <>
                The <strong>first numbered card</strong> played sets the suit led. If you have that suit in hand, you must play it… or play a Black Cat
                or a character. Otherwise, play anything.
              </>
            ) : (
              <>
                La <strong>première carte numérotée</strong> posée fixe la famille demandée. Si tu as cette famille en main, tu dois la jouer… ou jouer un
                Chat noir ou un personnage. Sinon, tu joues ce que tu veux.
              </>
            )}
          </p>
          <Exemple titre={tr('Exemple', 'Example')}>
            <div className="regles-rangee">
              <Carte id="lames-07" petite legende={tr('Ouvre : Lames demandé', 'Leads: Blades')} onZoom={z} />
              <span className="regles-fleche">→</span>
              <Carte id="lames-03" petite legende={tr('Autorisé', 'Allowed')} onZoom={z} />
              <Carte id="chat-noir-04" petite legende={tr('Autorisé', 'Allowed')} onZoom={z} />
              <Carte id="billets-09" petite legende={tr('Interdit si tu as des Lames', 'Not allowed if you have Blades')} onZoom={z} />
            </div>
          </Exemple>

          <h3>{tr('Qui remporte le pli ?', 'Who wins the trick?')}</h3>
          <p>{tr('On regarde dans cet ordre ; la première règle qui s’applique désigne le gagnant.', 'Check in this order; the first rule that applies decides the winner.')}</p>
          <ol className="regles-podium">
            <li>
              <span className="regles-rang">1</span>
              <span className="regles-cartes">
                <Carte id="pickpocket" petite onZoom={z} />
                <Carte id="baron" petite onZoom={z} />
              </span>
              <span>
                <strong>{tr('Braquage', 'Stick-up')}</strong>
                {tr(' : Pickpocket et Baron dans le même pli, le Pickpocket gagne (+40).', ': Pickpocket and Baron in the same trick, the Pickpocket wins (+40).')}
              </span>
            </li>
            <li>
              <span className="regles-rang">2</span>
              <span className="regles-cartes">
                <Carte id="baron" petite onZoom={z} />
              </span>
              <span>
                <strong>{tr('Le Baron', 'The Baron')}</strong>.
              </span>
            </li>
            <li>
              <span className="regles-rang">3</span>
              <span className="regles-cartes">
                <Carte id="homme-de-main-1" petite onZoom={z} />
              </span>
              <span>
                <strong>{tr('Un Homme de main', 'A Henchman')}</strong>
                {tr(' : le premier posé.', ': the first one played.')}
              </span>
            </li>
            <li>
              <span className="regles-rang">4</span>
              <span className="regles-cartes">
                <Carte id="chat-noir-08" petite onZoom={z} />
              </span>
              <span>
                <strong>{tr('Un Chat noir', 'A Black Cat')}</strong>
                {tr(' : le plus fort.', ': the highest.')}
              </span>
            </li>
            <li>
              <span className="regles-rang">5</span>
              <span className="regles-cartes">
                <Carte id="diamants-10" petite onZoom={z} />
                <Carte id="croupier" petite onZoom={z} />
              </span>
              <span>
                <strong>{tr('La famille demandée', 'The suit led')}</strong>
                {tr(' : la plus forte (Croupier compris, à 0 ou 11). Les autres familles ne gagnent jamais.', ': the highest (Croupier included, at 0 or 11). Other suits never win.')}
              </span>
            </li>
          </ol>
          <p className="discret">
            {tr(
              'Si le pli ne contient qu’un Pickpocket et des cartes qui ne gagnent pas, il le remporte. L’Alibi et le Juge ne gagnent jamais.',
              'If the trick only holds a Pickpocket and cards that cannot win, the Pickpocket wins it. The Alibi and the Judge never win.',
            )}
          </p>

          <h3>{tr('Le Juge : le monde à l’envers', 'The Judge: the world upside down')}</h3>
          <Exemple titre={tr('Exemple avec le Juge', 'Example with the Judge')}>
            <div className="regles-rangee">
              <Carte id="juge" petite onZoom={z} />
              <Carte id="diamants-09" petite onZoom={z} />
              <Carte id="baron" petite onZoom={z} />
              <Carte id="billets-02" petite legende={tr('Gagne !', 'Wins!')} onZoom={z} />
            </div>
            <p>{tr('La plus petite valeur gagne, toutes familles confondues : les personnages comme le Baron ne gagnent pas.', 'The lowest value wins, whatever the suit: characters like the Baron do not win.')}</p>
          </Exemple>

          <h3>{tr('Butin et vols', 'Loot and theft')}</h3>
          <div className="regles-perso">
            <Carte id="diamants-09" onZoom={z} />
            <div>
              <p>
                {EN ? (
                  <>
                    The trick winner keeps the <strong>highest gang card</strong> of the trick, even from another suit. It is worth its value in points at
                    the end of the night, if the bid is made.
                  </>
                ) : (
                  <>
                    Le gagnant du pli garde la <strong>carte de gang la plus forte</strong> du pli, même d’une autre famille. Elle vaut sa valeur en points
                    à la fin de la nuit, si l’annonce est réussie.
                  </>
                )}
              </p>
              <p>
                {tr(
                  'Le Pickpocket vole un butin dès qu’il est posé ; le Baron en vole un quand il gagne un pli. Un Alibi gardé en main protège.',
                  'The Pickpocket steals a piece of loot as soon as it is played; the Baron steals one when he wins a trick. An Alibi kept in hand protects you.',
                )}
              </p>
            </div>
          </div>
        </section>
      )}

      {onglet === 'evenements' && (
        <section className="regles-page">
          <p>
            {EN ? (
              <>
                An Event card is drawn at the start of <strong>nights 2 to 7</strong> (the first and last nights have none). It only applies to the
                current night.
              </>
            ) : (
              <>
                Une carte Événement est tirée au début des <strong>nuits 2 à 7</strong> (la première et la dernière nuit n’en ont pas). Elle ne vaut que
                pour la nuit en cours.
              </>
            )}
          </p>
          {EVENEMENTS.map((e) => (
            <div key={e.type} className="regles-perso">
              <Carte id={e.carte} onZoom={z} />
              <div>
                <strong>{NOM_EVENEMENT[e.type]}</strong>
                <p>{EFFET_EVENEMENT[e.type]}</p>
                <p className="regles-conseil">💡 {e.conseil}</p>
              </div>
            </div>
          ))}
        </section>
      )}

      {onglet === 'score' && (
        <section className="regles-page">
          <table className="regles-score">
            <tbody>
              <tr>
                <th>{tr('Annonce réussie', 'Bid made')}</th>
                <td>{tr('+10 par pli annoncé', '+10 per trick bid')}</td>
                <td className="regles-ex">{tr('annonce 3, 3 plis → +30', 'bid 3, 3 tricks → +30')}</td>
              </tr>
              <tr>
                <th>{tr('Annonce ratée', 'Bid missed')}</th>
                <td>{tr('−10 par pli d’écart', '−10 per trick off')}</td>
                <td className="regles-ex">{tr('annonce 2, 4 plis → −20', 'bid 2, 4 tricks → −20')}</td>
              </tr>
              <tr>
                <th>{tr('Annonce 0 réussie', 'Zero bid made')}</th>
                <td>{tr('+10 × numéro de la nuit', '+10 × night number')}</td>
                <td className="regles-ex">{tr('nuit 5 → +50', 'night 5 → +50')}</td>
              </tr>
              <tr>
                <th>{tr('Annonce 0 ratée', 'Zero bid missed')}</th>
                <td>{tr('−10 × numéro de la nuit', '−10 × night number')}</td>
                <td className="regles-ex">{tr('nuit 5 → −50', 'night 5 → −50')}</td>
              </tr>
              <tr>
                <th>{tr('Butin', 'Loot')}</th>
                <td>{tr('sa valeur, seulement si l’annonce est réussie', 'its value, only if the bid is made')}</td>
                <td className="regles-ex">{tr('Diamants 9 → +9', 'Diamonds 9 → +9')}</td>
              </tr>
              <tr>
                <th>Bonus</th>
                <td>{tr('seulement si l’annonce est réussie', 'only if the bid is made')}</td>
                <td className="regles-ex">{tr('Baron + Homme de main +20 · Braquage +40 · Alliance +20', 'Baron + Henchman +20 · Stick-up +40 · Alliance +20')}</td>
              </tr>
            </tbody>
          </table>
          <Exemple titre={tr('Exemple complet (nuit 4)', 'Full example (night 4)')}>
            <div className="regles-rangee">
              <Carte id="diamants-09" petite onZoom={z} />
              <Carte id="lames-06" petite onZoom={z} />
            </div>
            <p>
              {EN ? (
                <>
                  You bid 2 tricks and win 2, with this loot: 2 × 10 = <strong>20</strong> + loot 9 + 6 = <strong>15</strong>, so{' '}
                  <strong>35 points</strong>. Had you won 3 tricks: −10, and the loot does not count.
                </>
              ) : (
                <>
                  Tu annonces 2 plis et tu en gagnes 2, avec ce butin : 2 × 10 = <strong>20</strong> + butin 9 + 6 = <strong>15</strong>, soit{' '}
                  <strong>35 points</strong>. Si tu avais gagné 3 plis : −10, et le butin ne compte pas.
                </>
              )}
            </p>
          </Exemple>
          <p className="discret">{tr('Casse du siècle : butin ×2. Descente de police : butin à 0.', 'Heist of the Century: loot ×2. Police Raid: loot at 0.')}</p>
        </section>
      )}

      {zoom && <Zoom id={zoom} onFermer={() => setZoom(null)} />}
    </div>
  );
}

export function FenetreRegles({ onFermer }: { onFermer: () => void }) {
  return (
    <Fenetre titre={tr('Règles du jeu', 'Game rules')} onFermer={onFermer} large>
      <ReglesIllustrees />
    </Fenetre>
  );
}
