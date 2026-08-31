interface QuizErrorStateProps {
  readonly message: string;
  readonly onRetry?: () => void;
}

export function QuizErrorState({ message, onRetry }: QuizErrorStateProps) {
  return (
    <section className="quiz-state-card" role="alert">
      <span className="state-symbol" aria-hidden="true">!</span>
      <div>
        <h2>Knihovnu nelze zobrazit</h2>
        <p>{message}</p>
      </div>
      {onRetry && (
        <button className="secondary-button" type="button" onClick={onRetry}>
          Zkusit znovu
        </button>
      )}
    </section>
  );
}
