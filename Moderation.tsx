/**
 * Protection du chat : couper la discussion d'un joueur (seulement pour soi) et le signaler.
 * Les joueurs coupés restent coupés jusqu'à la fin de la visite (même après un rechargement de la page).
 */
import { useEffect, useState } from 'react';
import type { Appel } from './App';
import { tr } from './traduction';
import { Fenetre } from './ui';

const CLE = 'ldb-masques';
const masques = new Map<string, Set<string>>();
const abonnes = new Set<() => void>();
try {
  const brut = JSON.parse(sessionStorage.getItem(CLE) ?? '{}') as Record<string, string[]>;
  for (const [code, ids] of Object.entries(brut)) if (Array.isArray(ids)) masques.set(code, new Set(ids.filter((x) => typeof x === 'string')));
} catch {
  /* rien de gardé */
}
function garder() {
  try {
    sessionStorage.setItem(CLE, JSON.stringify(Object.fromEntries([...masques].map(([code, ids]) => [code, [...ids]]))));
  } catch {
    /* stockage indisponible */
  }
}

export function estMasque(code: string, joueurId: string): boolean {
  return masques.get(code)?.has(joueurId) ?? false;
}
export function basculerMasque(code: string, joueurId: string, masquer?: boolean) {
  const ids = masques.get(code) ?? new Set<string>();
  const doit = masquer ?? !ids.has(joueurId);
  if (doit) ids.add(joueurId);
  else ids.delete(joueurId);
  masques.set(code, ids);
  garder();
  abonnes.forEach((f) => f());
}
/** Joueurs coupés dans ce salon (se met à jour quand on en coupe un). */
export function useMasques(code: string): Set<string> {
  const [, maj] = useState(0);
  useEffect(() => {
    const f = () => maj((n) => n + 1);
    abonnes.add(f);
    return () => {
      abonnes.delete(f);
    };
  }, []);
  return masques.get(code) ?? new Set<string>();
}

const MOTIFS: [string, string, string][] = [
  ['insultes', 'Insultes ou harcèlement', 'Insults or harassment'],
  ['pseudo', 'Pseudo choquant', 'Offensive name'],
  ['triche', 'Triche ou anti-jeu', 'Cheating or unsportsmanlike play'],
  ['autre', 'Autre', 'Other'],
];

/** Signaler un joueur : le signalement est gardé pour vérification, et son chat est coupé pour toi. */
export function FenetreSignaler({ code, joueurId, nom, appel, onFermer }: { code: string; joueurId: string; nom: string; appel: Appel; onFermer: () => void }) {
  const [motif, setMotif] = useState('insultes');
  const [occupe, setOccupe] = useState(false);
  const [fait, setFait] = useState(false);
  const envoyer = async () => {
    setOccupe(true);
    const r = await appel('signaler', { joueurId, motif });
    setOccupe(false);
    if (r.ok) setFait(true);
  };
  // Le chat du joueur signalé est coupé pour moi quand je referme la fenêtre (avant, le message resterait affiché).
  const fermer = () => {
    if (fait) basculerMasque(code, joueurId, true);
    onFermer();
  };
  return (
    <Fenetre titre={tr(`Signaler ${nom}`, `Report ${nom}`)} onFermer={fermer}>
      {fait ? (
        <>
          <p>{tr('Merci, ton signalement est enregistré. Le chat de ce joueur est coupé pour toi.', 'Thank you, your report has been recorded. This player’s chat is now muted for you.')}</p>
          <button type="button" className="principal large" onClick={fermer}>
            OK
          </button>
        </>
      ) : (
        <>
          <p className="discret">
            {tr(
              'Ses derniers messages sont joints au signalement. Après plusieurs signalements, son chat est coupé pour toute la table.',
              'Their latest messages are attached to the report. After several reports, their chat is muted for the whole table.',
            )}
          </p>
          <div className="motifs" role="radiogroup" aria-label={tr('Motif', 'Reason')}>
            {MOTIFS.map(([id, fr, en]) => (
              <button key={id} type="button" role="radio" aria-checked={motif === id} className={motif === id ? 'choisi' : ''} onClick={() => setMotif(id)}>
                {tr(fr, en)}
              </button>
            ))}
          </div>
          <div className="rangee">
            <button type="button" className="danger" disabled={occupe} onClick={() => void envoyer()}>
              {occupe ? tr('Un instant…', 'One moment…') : tr('Signaler', 'Report')}
            </button>
            <button type="button" onClick={onFermer}>
              {tr('Annuler', 'Cancel')}
            </button>
          </div>
        </>
      )}
    </Fenetre>
  );
}

/**
 * La fenêtre « Signaler » vit à la racine de l'application : elle reste ouverte même si le message (ou la fiche)
 * d'où elle a été ouverte disparaît, par exemple quand le serveur coupe le chat du joueur signalé.
 */
type DemandeSignalement = { code: string; joueurId: string; nom: string; appel: Appel };
let demande: DemandeSignalement | null = null;
const abonnesDemande = new Set<() => void>();
function ouvrirSignalement(d: DemandeSignalement | null) {
  demande = d;
  abonnesDemande.forEach((f) => f());
}
export function FenetreSignalementGlobale() {
  const [, maj] = useState(0);
  useEffect(() => {
    const f = () => maj((n) => n + 1);
    abonnesDemande.add(f);
    return () => {
      abonnesDemande.delete(f);
    };
  }, []);
  if (!demande) return null;
  const d = demande;
  return <FenetreSignaler key={`${d.code}-${d.joueurId}`} code={d.code} joueurId={d.joueurId} nom={d.nom} appel={d.appel} onFermer={() => ouvrirSignalement(null)} />;
}

/** Boutons « Couper son chat » et « Signaler » (fiche d'un joueur, message du chat). */
export function ActionsModeration({ code, joueurId, nom, appel, compact }: { code: string; joueurId: string; nom: string; appel: Appel; compact?: boolean }) {
  const coupes = useMasques(code);
  const coupe = coupes.has(joueurId);
  return (
    <div className={`actions-moderation ${compact ? 'compact' : ''}`}>
      <button type="button" className="petit" onClick={() => basculerMasque(code, joueurId)} aria-pressed={coupe}>
        {coupe ? tr('🔈 Remettre son chat', '🔈 Unmute chat') : tr('🔇 Couper son chat', '🔇 Mute chat')}
      </button>
      <button type="button" className="petit danger-discret" onClick={() => ouvrirSignalement({ code, joueurId, nom, appel })}>
        {tr('⚑ Signaler', '⚑ Report')}
      </button>
    </div>
  );
}
