import { TechnicalDetails } from './TechnicalDetails';

export interface HumanErrorValue {
  readonly title: string;
  readonly message: string;
  readonly technicalCode?: string;
}

export function HumanError({ error, onRetry }: {
  readonly error: HumanErrorValue;
  readonly onRetry?: () => void;
}) {
  return (
    <section className="human-error" role="alert">
      <div>
        <strong>{error.title}</strong>
        <p>{error.message}</p>
      </div>
      {onRetry && (
        <button className="secondary-button" type="button" onClick={onRetry}>
          Zkusit znovu
        </button>
      )}
      {error.technicalCode && (
        <TechnicalDetails><code>{error.technicalCode}</code></TechnicalDetails>
      )}
    </section>
  );
}
