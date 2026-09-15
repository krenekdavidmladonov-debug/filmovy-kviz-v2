import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';

import { useAuth } from '../auth/AuthProvider';
import { roleLabels } from '@filmovy-kviz/quiz-domain';
import { productConfig } from '../config/product';
import { Brand } from '../ui/Brand';

const navigation = [
  { to: '/admin', label: 'Přehled', end: true },
  { to: '/admin/quizzes', label: 'Kvízy', end: false },
  { to: '/admin/events', label: 'Akce', end: false },
] as const;

function AdminNavigation() {
  const { can } = useAuth();
  return (
    <nav className="admin-navigation" aria-label="Administrace">
      {navigation.filter(item => item.to === '/admin' || (item.to === '/admin/quizzes' ? can('quiz.read') : can('event.read'))).map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) => (isActive ? 'admin-nav-link active' : 'admin-nav-link')}
        >
          {item.label}
        </NavLink>
      ))}
      {can('users.manage') && <NavLink className="admin-nav-link" to="/admin/users">Uživatelé a přístupy</NavLink>}
      <NavLink className="admin-nav-link" to="/account">Můj účet</NavLink>
    </nav>
  );
}

export function AdminShell() {
  const { currentUser, membership, signOut } = useAuth();
  const [pending, setPending] = useState(false);

  async function handleSignOut() {
    setPending(true);
    try {
      await signOut();
    } finally {
      setPending(false);
    }
  }

  const accountLabel = membership ? roleLabels[membership.role] : 'Uživatel';

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <NavLink className="admin-brand" to="/admin" aria-label={`${productConfig.adminLabel} – přehled`}>
          <span><strong><Brand /></strong><small>Administrace</small></span>
        </NavLink>
        <AdminNavigation />
        <div className="admin-account">
          <span>{accountLabel}</span>
          <strong>{currentUser?.email}</strong>
          <button type="button" className="quiet-button" onClick={() => void handleSignOut()} disabled={pending}>
            {pending ? 'Odhlašuji…' : 'Odhlásit se'}
          </button>
        </div>
      </aside>

      <header className="admin-mobile-header">
        <NavLink className="admin-brand" to="/admin" aria-label={`${productConfig.adminLabel} – přehled`}>
          <strong><Brand /></strong>
        </NavLink>
        <details className="admin-nav-disclosure">
          <summary aria-label="Otevřít navigaci administrace">Menu</summary>
          <div className="admin-mobile-menu">
            <AdminNavigation />
            <div className="admin-account compact">
              <span>{accountLabel}</span>
              <strong>{currentUser?.email}</strong>
              <button type="button" className="quiet-button" onClick={() => void handleSignOut()} disabled={pending}>
                {pending ? 'Odhlašuji…' : 'Odhlásit se'}
              </button>
            </div>
          </div>
        </details>
      </header>

      <main className="admin-main" id="main-content">
        {import.meta.env.VITE_APP_ENV === 'staging' && <div role="note" className="admin-content"><strong>STAGING — pouze syntetická testovací data</strong></div>}
        <div className="admin-content"><Outlet /></div>
      </main>
    </div>
  );
}
