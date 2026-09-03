import type { FormEvent } from 'react';

import type { EventFormValues } from './types';

interface EventFormProps {
  readonly values: EventFormValues;
  readonly pending: boolean;
  readonly submitLabel: string;
  readonly onChange: (values: EventFormValues) => void;
  readonly onSubmit: () => void;
}

export function EventForm({ values, pending, submitLabel, onChange, onSubmit }: EventFormProps) {
  const update = <Key extends keyof EventFormValues>(key: Key, value: EventFormValues[Key]) => {
    onChange({ ...values, [key]: value });
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };
  return (
    <form className="event-form" onSubmit={submit}>
      <label className="editor-field event-field-wide">
        <span>Název akce</span>
        <input required maxLength={300} value={values.title} onChange={(event) => update('title', event.target.value)} />
      </label>
      <label className="editor-field">
        <span>Datum a čas</span>
        <input required type="datetime-local" value={values.startsAt} onChange={(event) => update('startsAt', event.target.value)} />
      </label>
      <label className="editor-field">
        <span>Časové pásmo</span>
        <input required maxLength={100} value={values.timeZone} onChange={(event) => update('timeZone', event.target.value)} />
      </label>
      <label className="editor-field event-field-wide">
        <span>Místo</span>
        <input required maxLength={300} value={values.venueName} onChange={(event) => update('venueName', event.target.value)} />
      </label>
      <label className="editor-field event-field-wide">
        <span>Veřejné upřesnění místa</span>
        <input required maxLength={500} value={values.publicLocation} onChange={(event) => update('publicLocation', event.target.value)} />
      </label>
      <label className="editor-field">
        <span>Max týmů</span>
        <input required type="number" min={1} max={10_000} value={values.teamCapacity} onChange={(event) => update('teamCapacity', event.target.valueAsNumber)} />
      </label>
      <label className="editor-field">
        <span>Max lidí</span>
        <input required type="number" min={1} max={100_000} value={values.peopleCapacity} onChange={(event) => update('peopleCapacity', event.target.valueAsNumber)} />
      </label>
      <label className="editor-field">
        <span>Min členů týmu</span>
        <input required type="number" min={1} max={1_000} value={values.teamSizeMin} onChange={(event) => update('teamSizeMin', event.target.valueAsNumber)} />
      </label>
      <label className="editor-field">
        <span>Max členů týmu</span>
        <input required type="number" min={values.teamSizeMin || 1} max={1_000} value={values.teamSizeMax} onChange={(event) => update('teamSizeMax', event.target.valueAsNumber)} />
      </label>
      <div className="event-form-actions event-field-wide">
        <button className="primary-button" type="submit" disabled={pending}>
          {pending ? 'Ukládám…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
