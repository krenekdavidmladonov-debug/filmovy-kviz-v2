import type { FormEvent } from 'react';

import type { RegistrationFormValues } from '../events/registrationApi';

export function RegistrationForm({ values, minimum, maximum, pending, submitLabel, onChange, onSubmit }: {
  readonly values: RegistrationFormValues;
  readonly minimum: number;
  readonly maximum: number;
  readonly pending: boolean;
  readonly submitLabel: string;
  readonly onChange: (values: RegistrationFormValues) => void;
  readonly onSubmit: () => void;
}) {
  const submit = (event: FormEvent) => { event.preventDefault(); onSubmit(); };
  return <form className="registration-form" onSubmit={submit}>
    <label className="editor-field"><span>Název týmu *</span><input required minLength={2} maxLength={80} value={values.teamName} onChange={(e) => onChange({ ...values, teamName: e.target.value })} /></label>
    <label className="editor-field"><span>Počet členů *</span><input required type="number" min={minimum} max={maximum} value={values.memberCount} onChange={(e) => onChange({ ...values, memberCount: Number(e.target.value) })} /><small>Povolená velikost: {minimum}–{maximum}.</small></label>
    <label className="editor-field"><span>E-mail *</span><input required type="email" maxLength={254} value={values.contactEmail} onChange={(e) => onChange({ ...values, contactEmail: e.target.value })} /></label>
    <button className="primary-button" type="submit" disabled={pending}>{pending ? 'Ukládám…' : submitLabel}</button>
  </form>;
}
