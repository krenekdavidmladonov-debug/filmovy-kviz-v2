import { useState } from 'react';
import { Navigate } from 'react-router-dom';

import { useAuth } from '../../auth/AuthProvider';
import { AdminLoading } from './AdminLoading';

export function AdminNoAccessPage() {
  const { currentUser, role, loading, signOut } = useAuth();
  const [pending, setPending] = useState(false);

  if (loading) {
    return <AdminLoading />;
  }

  if (!currentUser) {
    return <Navigate to="/admin/login" replace />;
  }

  if (role) {
    return <Navigate to="/admin" replace />;
  }

  async function handleSignOut() {
    setPending(true);
    try {
      await signOut();
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="admin-centered permission-card">
      <p className="eyebrow">Přístup zamítnut</p>
      <h1>Nemáte oprávnění</h1>
      <p>
        Účet <strong>{currentUser.email}</strong> nemá roli admin ani moderator.
      </p>
      <button className="secondary-button" type="button" onClick={() => void handleSignOut()} disabled={pending}>
        {pending ? 'Odhlašuji…' : 'Odhlásit'}
      </button>
    </section>
  );
}
