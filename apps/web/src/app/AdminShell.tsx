import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

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
          data-area={item.to === '/admin/quizzes' ? 'quizzes' : item.to === '/admin/events' ? 'events' : 'overview'}
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
  const { pathname } = useLocation();
  const area = pathname.startsWith('/admin/quizzes') ? 'quizzes' : pathname.startsWith('/admin/events') ? 'events' : 'overview';
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
  const isStaging = import.meta.env.VITE_APP_ENV === 'staging';

  return (
    <div className="admin-shell" data-area={area}>
      <aside className="admin-sidebar">
        <div className="admin-brand-group">
          <NavLink className="admin-brand" to="/admin" aria-label={`${productConfig.adminLabel} – přehled`}>
            <span><strong><Brand /></strong><small>Administrace</small></span>
          </NavLink>
          {isStaging && <span className="admin-environment-label">Testovací verze</span>}
        </div>
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
        <div className="admin-brand-group">
          <NavLink className="admin-brand" to="/admin" aria-label={`${productConfig.adminLabel} – přehled`}>
            <strong><Brand /></strong>
          </NavLink>
          {isStaging && <span className="admin-environment-label">Testovací verze</span>}
        </div>
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
        <div className="admin-content">
          {isStaging && <p role="note" className="admin-environment-note">Pro zkoušení používejte pouze smyšlená data.</p>}
          <Outlet />
        </div>
      </main>
    </div>
  );
}
