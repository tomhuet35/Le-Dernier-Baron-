/**
 * Les Tickets du Baron (Salon privé, au Bar) : on choisit son ticket, on l'achète, on le gratte du doigt.
 *
 * Le serveur a déjà tiré le ticket et crédité le gain à l'achat : l'écran ne fait que le cacher sous la couche à
 * gratter. Le solde affiché attend que le ticket soit découvert pour monter.
 *
 * Visuels (facultatifs, sinon le ticket est dessiné en CSS) : ticket-veinard.webp, ticket-epoque.webp,
 * ticket-baron.webp (le ticket, zone centrale vide), tickets-fond.webp (le décor).
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as PE } from 'react';
import type { VueCasino } from '../../shared/casino';
import { MODELES_TICKETS, montantsTicket, TICKETS, type ModeleTicket, type Ticket } from '../../shared/tickets';
import type { Appel } from './App';
import { dollars } from './casinoOutils';
import { EN, tr } from './traduction';
import { jouerEffet } from './ui';
import './tickets.css';

const CLE_MODELE = 'bf-ticket';
/** Part de la couche grattée à partir de laquelle tout le ticket se découvre. */
const SEUIL_DECOUVERT = 0.55;

/** Montant court pour une case : 10 k $, 2,5 M $, 5 Md $. */
function court(n: number): string {
  const f = (x: number) => x.toLocaleString(EN ? 'en-US' : 'fr-FR', { maximumFractionDigits: 1 });
  if (n >= 1e9) return `${f(n / 1e9)} ${EN ? 'B' : 'Md'} $`;
  if (n >= 1e6) return `${f(n / 1e6)} M $`;
  if (n >= 1e3) return `${f(n / 1e3)} k $`;
  return `${n} $`;
}

function lireModele(): ModeleTicket {
  try {
    const m = localStorage.getItem(CLE_MODELE);
    return MODELES_TICKETS.includes(m as ModeleTicket) ? (m as ModeleTicket) : 'veinard';
  } catch {
    return 'veinard';
  }
}

/** Dessine la couche argentée à gratter (motif Art déco et « Grattez ici »). */
function peindreCouche(c: HTMLCanvasElement) {
  const ctx = c.getContext('2d');
  if (!ctx) return;
  const { width: w, height: h } = c;
  ctx.globalCompositeOperation = 'source-over';
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#d9d4c7');
  g.addColorStop(0.35, '#9c968a');
  g.addColorStop(0.55, '#e8e3d6');
  g.addColorStop(1, '#8a8478');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // Éventails Art déco discrets.
  ctx.strokeStyle = 'rgba(80, 70, 50, 0.22)';
  ctx.lineWidth = Math.max(1, w / 260);
  const pas = w / 6;
  for (let y = -pas; y < h + pas; y += pas) {
    for (let x = -pas / 2; x < w + pas; x += pas) {
      const cx = x + ((Math.round(y / pas) % 2) * pas) / 2;
      for (let r = pas * 0.18; r < pas * 0.55; r += pas * 0.12) {
        ctx.beginPath();
        ctx.arc(cx, y, r, Math.PI * 1.1, Math.PI * 1.9);
        ctx.stroke();
      }
    }
  }
  // Paillettes.
  for (let k = 0; k < 140; k++) {
    ctx.fillStyle = `rgba(255, 255, 255, ${0.15 + Math.random() * 0.35})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, w / 300 + 1, w / 300 + 1);
  }
  ctx.fillStyle = 'rgba(60, 40, 20, 0.55)';
  ctx.font = `700 ${Math.round(w / 11)}px Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(tr('GRATTEZ ICI', 'SCRATCH HERE'), w / 2, h / 2);
}

/** La couche à gratter : le doigt (ou la souris) efface ; au-delà du seuil, tout se découvre. */
function Couche({ cle, onDecouvert, decouvert }: { cle: number; onDecouvert: () => void; decouvert: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const dernier = useRef<{ x: number; y: number } | null>(null);
  const traits = useRef(0);
  const fini = useRef(false);
  const rappel = useRef(onDecouvert);
  rappel.current = onDecouvert;

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    fini.current = false;
    const taille = () => {
      const r = c.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      c.width = Math.max(1, Math.round(r.width * dpr));
      c.height = Math.max(1, Math.round(r.height * dpr));
      peindreCouche(c);
    };
    taille();
    const obs = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => !fini.current && traits.current === 0 && taille()) : null;
    obs?.observe(c);
    return () => obs?.disconnect();
  }, [cle]);

  const part = () => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return 0;
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let vides = 0;
    let total = 0;
    const pas = 4 * 8;
    for (let i = 3; i < data.length; i += pas) {
      total++;
      if (data[i] < 40) vides++;
    }
    return total ? vides / total : 0;
  };

  const gratter = (e: PE<HTMLCanvasElement>) => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx || fini.current) return;
    const r = c.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * c.width;
    const y = ((e.clientY - r.top) / r.height) * c.height;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = c.width * 0.12;
    ctx.beginPath();
    const d = dernier.current ?? { x, y };
    ctx.moveTo(d.x, d.y);
    ctx.lineTo(x + 0.01, y);
    ctx.stroke();
    dernier.current = { x, y };
    traits.current++;
    if (traits.current % 8 === 0 && part() >= SEUIL_DECOUVERT) {
      fini.current = true;
      rappel.current();
    }
  };

  return (
    <canvas
      ref={canvas}
      className={`tk-couche ${decouvert ? 'partie' : ''}`}
      aria-label={tr('Couche à gratter', 'Scratch layer')}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        dernier.current = null;
        gratter(e);
      }}
      onPointerMove={(e) => {
        if (e.buttons || e.pointerType === 'touch') gratter(e);
      }}
      onPointerUp={() => {
        dernier.current = null;
        if (!fini.current && part() >= SEUIL_DECOUVERT) {
          fini.current = true;
          rappel.current();
        }
      }}
    />
  );
}

export function JeuTickets({ vue, appel, onVue, onRetour }: { vue: VueCasino; appel: Appel; onVue: (v: VueCasino) => void; onRetour: () => void }) {
  const [modele, setModele] = useState<ModeleTicket>(lireModele);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [decouvert, setDecouvert] = useState(false);
  /** Ce que le ticket en cours a crédité, pas encore montré au solde. */
  const [masque, setMasque] = useState(0);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const vueRef = useRef(vue);
  vueRef.current = vue;
  const infos = TICKETS[modele];

  useEffect(() => {
    try {
      localStorage.setItem(CLE_MODELE, modele);
    } catch {
      /* rien */
    }
  }, [modele]);

  const ticketRef = useRef<Ticket | null>(null);
  ticketRef.current = ticket;
  const decouvertRef = useRef(false);
  decouvertRef.current = decouvert;
  const decouvrir = useCallback(() => {
    if (decouvertRef.current) return;
    decouvertRef.current = true;
    setDecouvert(true);
    setMasque(0);
    const t = ticketRef.current;
    if (t && t.gain > 0) jouerEffet(t.gain >= 50 * t.prix ? 'lingots_pluie' : 'machine_pieces');
  }, []);

  const acheter = async () => {
    if (occupe) return;
    if (infos.prix > vue.solde - masque) return setErreur(tr('Solde insuffisant pour ce ticket.', 'Not enough money for this ticket.'));
    setOccupe(true);
    setErreur(null);
    const r = await appel('casino_ticket_acheter', { modele });
    setOccupe(false);
    if (!r.ok) return setErreur(r.erreur ?? tr('Achat impossible.', 'Purchase failed.'));
    const { ticket: t, solde, credite } = r as unknown as { ticket: Ticket; solde: number; credite?: number };
    jouerEffet('jeton');
    setTicket(t);
    decouvertRef.current = false;
    setDecouvert(false);
    setMasque(credite ?? t.gain);
    onVue({ ...vueRef.current, solde });
  };

  const soldeAffiche = vue.solde - masque;
  const gagne = !!ticket && decouvert && ticket.gain > 0;
  const montants = montantsTicket(modele);

  return (
    <div className="cas-ecran tk-ecran">
      <header className="cas-barre">
        <button type="button" className="cas-retour" onClick={onRetour}>
          ‹ {tr('Salon', 'Lounge')}
        </button>
        <h1 className="tk-titre">{tr('Les Tickets du Baron', 'The Baron’s Tickets')}</h1>
        <span className="cas-solde-petit">{dollars(soldeAffiche)}</span>
      </header>

      <nav className="tk-choix" aria-label={tr('Choisis ton ticket', 'Choose your ticket')}>
        {MODELES_TICKETS.map((m) => (
          <button
            key={m}
            type="button"
            className={`tk-choix-ticket tk-${m} ${m === modele ? 'actif' : ''}`}
            aria-pressed={m === modele}
            disabled={occupe}
            onClick={() => {
              if (m === modele) return;
              setModele(m);
              if (ticket && !decouvert) decouvrir();
              setTicket(null);
            }}
          >
            <b>{tr(...TICKETS[m].nom)}</b>
            <span>{dollars(TICKETS[m].prix)}</span>
            <small>{tr(`Gros lot ${court(TICKETS[m].prix * TICKETS[m].grosLot)}`, `Top prize ${court(TICKETS[m].prix * TICKETS[m].grosLot)}`)}</small>
          </button>
        ))}
      </nav>

      <section className="tk-scene">
        <div className={`tk-ticket tk-${modele} ${gagne ? 'gagne' : ''}`} style={{ '--tk-image': `url('/cartes/ticket-${modele}.webp')` } as CSSProperties}>
          <div className="tk-entete">
            <small>{tr('Le Grand Hôtel du Baron', 'The Baron’s Grand Hotel')}</small>
            <strong>{tr(...infos.nom)}</strong>
            <span>{tr(`Gros lot : ${dollars(infos.prix * infos.grosLot)}`, `Top prize: ${dollars(infos.prix * infos.grosLot)}`)}</span>
          </div>
          <div className="tk-zone">
            <div className="tk-grille">
              {(ticket?.cases ?? Array<number>(9).fill(0)).map((x, i) => {
                const gagnante = decouvert && !!ticket?.gagnantes.includes(i);
                return (
                  <div key={i} className={`tk-case ${gagnante ? 'gagnante' : ''} ${x === montants[montants.length - 1] ? 'gros' : ''}`}>
                    {ticket ? court(x * ticket.prix) : ''}
                    {ticket?.coupDouble === i && <em className="tk-double">×2</em>}
                  </div>
                );
              })}
            </div>
            {ticket ? <Couche cle={ticket.id} decouvert={decouvert} onDecouvert={decouvrir} /> : <div className="tk-couche-vide">{tr('Achète un ticket pour gratter', 'Buy a ticket to scratch')}</div>}
          </div>
          <p className="tk-regle">{tr('Trois montants identiques : tu gagnes ce montant. Le ×2 double le gain !', 'Three matching amounts: you win that amount. The ×2 doubles the win!')}</p>
        </div>

        <div className="tk-bas" aria-live="polite">
          {ticket && decouvert ? (
            gagne ? (
              <p className="tk-resultat gagne">
                {ticket.coupDouble !== null && <span>{tr('Coup double ! ', 'Double up! ')}</span>}
                {tr('Gagné', 'You win')} <b>+{dollars(ticket.gain)}</b>
              </p>
            ) : (
              <p className="tk-resultat">{tr('Pas de chance… Le prochain sera le bon !', 'No luck… The next one is the one!')}</p>
            )
          ) : ticket ? (
            <button type="button" className="tk-tout" onClick={decouvrir}>
              {tr('Tout gratter', 'Scratch all')}
            </button>
          ) : null}
          {erreur && <p className="cas-erreur">{erreur}</p>}
          <button type="button" className="tk-acheter" disabled={occupe || (!!ticket && !decouvert)} onClick={() => void acheter()}>
            {ticket ? tr('Un autre ticket', 'Another ticket') : tr('Acheter', 'Buy')} · {dollars(infos.prix)}
          </button>
        </div>
      </section>
    </div>
  );
}
