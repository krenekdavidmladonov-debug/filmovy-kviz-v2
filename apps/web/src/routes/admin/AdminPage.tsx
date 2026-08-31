import { useState } from 'react';

import { useAuth, type StaffRole } from '../../auth/AuthProvider';

const roleLabels: Readonly<Record<StaffRole, string>> = {
  admin: 'Administrátor',
  moderator: 'Moderátor',
};

export function AdminPage() {
  const { currentUser, role, signOut } = useAuth();
  const [pending, setPending] = useState(false);

  async function handleSignOut() {
    setPending(true);
    try {
      await signOut();
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="admin-dashboard">
      <header className="admin-dashboard-heading">
        <div>
          <p className="eyebrow">Soukromá část</p>
          <h1>Administrace</h1>
          <p className="lead">Bezpečný základ je připravený. Obsah administrace přidáme v dalších krocích.</p>
        </div>
        <div className="account-card">
          <div className="avatar" aria-hidden="true">
            {currentUser?.email?.slice(0, 1).toUpperCase() ?? 'U'}
          </div>
          <div className="account-details">
            <span>Přihlášený účet</span>
            <strong>{currentUser?.email}</strong>
            <span className="role-pill">{role ? roleLabels[role] : 'Bez role'}</span>
          </div>
          <button className="secondary-button" type="button" onClick={() => void handleSignOut()} disabled={pending}>
            {pending ? 'Odhlašuji…' : 'Odhlásit'}
          </button>
        </div>
      </header>

      <div className="admin-ready-card">
        <span className="status-dot" aria-hidden="true" />
        <div>
          <strong>Přístup ověřen</strong>
          <p>Role pochází z Firebase ID tokenu. Datová oprávnění vynucují Firestore Security Rules.</p>
        </div>
      </div>
    </section>
  );
}
