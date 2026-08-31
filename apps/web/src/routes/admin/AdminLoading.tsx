export function AdminLoading() {
  return (
    <section className="admin-centered" aria-live="polite" aria-busy="true">
      <span className="loading-spinner" aria-hidden="true" />
      <p>Ověřuji přihlášení…</p>
    </section>
  );
}
