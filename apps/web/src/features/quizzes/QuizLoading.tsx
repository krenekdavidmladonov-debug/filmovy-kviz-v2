export function QuizLoading({ label = 'Načítám knihovnu…' }: { readonly label?: string }) {
  return (
    <section className="quiz-loading" aria-live="polite" aria-busy="true">
      <span className="loading-spinner" aria-hidden="true" />
      <p>{label}</p>
    </section>
  );
}
