import { useEffect, useRef, useState } from 'react';

import type { SemanticRound } from './semanticModel';

export function UnsavedChangesDialog({
  busy,
  onSave,
  onDiscard,
  onCancel,
}: {
  readonly busy: boolean;
  readonly onSave: () => void;
  readonly onDiscard: () => void;
  readonly onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.open) dialog.showModal();
    cancelRef.current?.focus();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);
  return (
    <dialog ref={dialogRef} className="editor-dialog" aria-labelledby="unsaved-dialog-title" onCancel={(event) => { event.preventDefault(); onCancel(); }}>
      <h2 id="unsaved-dialog-title">Máte neuložené změny.</h2>
      <p>Než budete pokračovat, zvolte, co se má s rozepsanými změnami stát.</p>
      <div className="editor-dialog-actions">
        <button type="button" className="primary-button" disabled={busy} onClick={onSave}>Uložit a pokračovat</button>
        <button type="button" className="secondary-button" disabled={busy} onClick={onDiscard}>Pokračovat bez uložení</button>
        <button ref={cancelRef} type="button" className="secondary-button" disabled={busy} onClick={onCancel}>Zrušit</button>
      </div>
    </dialog>
  );
}

export function RemoveRoundDialog({
  round,
  rounds,
  busy,
  onMove,
  onDelete,
  onCancel,
}: {
  readonly round: SemanticRound;
  readonly rounds: readonly SemanticRound[];
  readonly busy: boolean;
  readonly onMove: (targetRoundId: string) => void;
  readonly onDelete: () => void;
  readonly onCancel: () => void;
}) {
  const targets = rounds.filter((item) => item.id !== round.id && item.id !== 'roundless');
  const [targetRoundId, setTargetRoundId] = useState(targets[0]?.id ?? '');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.open) dialog.showModal();
    cancelRef.current?.focus();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);
  return (
    <dialog ref={dialogRef} className="editor-dialog" aria-labelledby="remove-round-title" onCancel={(event) => { event.preventDefault(); onCancel(); }}>
      <h2 id="remove-round-title">Odstranit {round.position}. kolo?</h2>
      <p>Kolo obsahuje {round.questions.length} {round.questions.length === 1 ? 'otázku' : 'otázek'}.</p>
      {round.questions.length > 0 && targets.length > 0 && (
        <label className="form-field">Přesunout otázky do jiného kola
          <select value={targetRoundId} onChange={(event) => setTargetRoundId(event.target.value)}>
            {targets.map((target) => <option key={target.id} value={target.id}>{target.position}. kolo – {target.title}</option>)}
          </select>
        </label>
      )}
      <div className="editor-dialog-actions vertical-actions">
        {round.questions.length > 0 && targets.length > 0 && (
          <button type="button" className="secondary-button" disabled={busy || targetRoundId === ''} onClick={() => onMove(targetRoundId)}>
            Přesunout otázky a odstranit kolo
          </button>
        )}
        <button type="button" className="danger-button" disabled={busy} onClick={onDelete}>
          Odstranit kolo včetně {round.questions.length} {round.questions.length === 1 ? 'otázky' : 'otázek'}
        </button>
        <button ref={cancelRef} type="button" className="secondary-button" disabled={busy} onClick={onCancel}>Zrušit</button>
      </div>
    </dialog>
  );
}
