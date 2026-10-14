import { useContext, useState } from 'react';
import { parseQuizAsset, type PrintTemplate } from '@filmovy-kviz/quiz-domain';
import { MediaAuthoringContext, MediaUploadField } from '../media/MediaUploadField';

export interface PrintTemplateFieldsProps {
  value: PrintTemplate;
  disabled: boolean;
  onChange: (value: PrintTemplate) => void;
  quizId: string;
}

export function PrintTemplateFields({ value, disabled, onChange, quizId }: PrintTemplateFieldsProps) {
  const parent = useContext(MediaAuthoringContext);
  const [pending, setPending] = useState(false);
  const change = (patch: Partial<PrintTemplate>) => onChange({ ...value, ...patch });
  const busy = disabled || pending;
  return <section className="editor-card" aria-label="Vzhled tiskových archů">
    <h3>Tiskové archy</h3>
    <p className="field-help">Uložte nastavení s kvízem. Akce převezme jeho podobu při přípravě; již připravenou akci znovu připravte, aby se změny projevily v PDF.</p>
    <label className="editor-field"><span>Nadpis archů</span><input maxLength={120} value={value.title ?? ''} disabled={busy} placeholder="Název akce" onChange={event => change({ title: event.target.value })} /></label>
    <label className="editor-field"><span>Pokyny pro týmy</span><textarea maxLength={400} rows={3} value={value.instructions ?? ''} disabled={busy} placeholder="Zapisujte čitelně. Čísla odpovědí odpovídají otázkám v daném kole." onChange={event => change({ instructions: event.target.value })} /></label>
    <label className="editor-field"><span>Patička</span><input maxLength={160} value={value.footer ?? ''} disabled={busy} placeholder="JustKvíz / Prostor pro vaše znalosti" onChange={event => change({ footer: event.target.value })} /></label>
    <label className="editor-field"><span>Rozložení odpovědního listu</span><select value={value.layout ?? 'comfortable'} disabled={busy} onChange={event => change({ layout: event.target.value as 'comfortable' | 'compact' })}><option value="comfortable">Pohodlné: nové kolo na nové straně</option><option value="compact">Úsporné: kola navazují</option></select></label>
    <p className="field-help">Pohodlné má 15,5 mm na odpověď, úsporné 12 mm. V obou variantách zůstává jméno týmu na každé straně. Malé políčko vpravo slouží pořadateli pro body.</p>
    <label className="editor-field"><span>Barva drobného akcentu</span><input type="color" value={value.accentColor?.length === 7 ? value.accentColor : '#a87521'} disabled={busy} onChange={event => change({ accentColor: event.target.value })} /></label>
    <label><input type="checkbox" checked={value.showLogo !== false} disabled={busy} onChange={event => change({ showLogo: event.target.checked })} /> Zobrazit logo v záhlaví</label>
    {value.showLogo !== false && <>
      <label className="editor-field"><span>Textové logo</span><input maxLength={40} value={value.logoText ?? ''} disabled={busy} placeholder="JustKvíz" onChange={event => change({ logoText: event.target.value })} /></label>
      <MediaAuthoringContext.Provider value={{ quizId, canUpload: parent?.canUpload ?? !disabled, canAttach: parent?.canAttach ?? !disabled, onPending: next => { setPending(next); parent?.onPending(next); } }}>
        <MediaUploadField kind="image" label="Obrázkové logo pro tisk" value={value.logoImage ?? ''} disabled={disabled} onReady={reference => change({ logoImage: reference })} />
      </MediaAuthoringContext.Provider>
      <p className="field-help">Pro vložení do PDF nahrajte PNG nebo JPEG, případně je vyberte z médií tohoto kvízu. WebP a externí odkazy tisk nepodporuje; obrázkové logo nahradí textové logo.</p>
      {value.logoImage && !parseQuizAsset(value.logoImage) && <p role="status">Toto logo používá externí odkaz. Před tiskem jej nahraďte nahraným PNG/JPEG, odeberte nebo skryjte logo.</p>}
    </>}
    <button type="button" className="secondary-button" disabled={busy} onClick={() => onChange({ ...(value.title !== undefined ? { title: value.title } : {}), ...(value.instructions !== undefined ? { instructions: value.instructions } : {}), ...(value.footer !== undefined ? { footer: value.footer } : {}) })}>Obnovit výchozí vzhled archů</button>
  </section>;
}
