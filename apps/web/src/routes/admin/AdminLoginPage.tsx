import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';

import { useAuth } from '../../auth/AuthProvider';
import { getCzechAuthError } from '../../auth/authErrors';
import { AdminLoading } from './AdminLoading';

export function AdminLoginPage() {
  const { currentUser, role, loading, initializationError, signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  if (loading) {
    return <AdminLoading />;
  }

  if (currentUser) {
    return <Navigate to={role ? '/admin' : '/admin/no-access'} replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSubmitting(true);

    try {
      await signIn(email, password);
    } catch (error) {
      setFormError(getCzechAuthError(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="admin-auth-layout">
      <div className="admin-auth-intro">
        <p className="eyebrow">Soukromá část</p>
        <h1>Přihlášení do administrace</h1>
        <p className="lead">
          Přístup je určen pouze administrátorům a moderátorům filmového kvízu.
        </p>
      </div>

      <form className="login-card" onSubmit={(event) => void handleSubmit(event)}>
        <div className="login-card-heading">
          <span className="secure-badge" aria-hidden="true">FK</span>
          <div>
            <h2>Vítejte zpět</h2>
            <p>Přihlaste se testovacím účtem z lokálního emulátoru.</p>
          </div>
        </div>

        <label className="form-field">
          <span>E-mail</span>
          <input
            type="email"
            name="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            disabled={submitting || Boolean(initializationError)}
          />
        </label>

        <label className="form-field">
          <span>Heslo</span>
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            disabled={submitting || Boolean(initializationError)}
          />
        </label>

        {(initializationError || formError) && (
          <p className="form-error" role="alert">{initializationError ?? formError}</p>
        )}

        <button className="primary-button" type="submit" disabled={submitting || Boolean(initializationError)}>
          {submitting ? 'Přihlašuji…' : 'Přihlásit se'}
        </button>

        <p className="form-note">Pouze lokální vývoj · Firebase Authentication Emulator</p>
      </form>
    </section>
  );
}
