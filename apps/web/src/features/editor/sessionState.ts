export type EditorSaveStatus = 'saved' | 'saving' | 'dirty' | 'failed';

export function editorSaveStatus(dirty: boolean, saving: boolean, failed: boolean): EditorSaveStatus {
  if (saving) return 'saving';
  if (failed) return 'failed';
  return dirty ? 'dirty' : 'saved';
}

export const editorSaveLabels: Record<EditorSaveStatus, string> = {
  saved: 'Uloženo',
  saving: 'Ukládám…',
  dirty: 'Neuložené změny',
  failed: 'Uložení se nezdařilo',
};

export function needsNavigationDecision(dirty: boolean, currentKey: string, nextKey: string): boolean {
  return dirty && currentKey !== nextKey;
}
