import { NavLink, Outlet } from 'react-router-dom';

const navigation = [
  { to: '/admin', label: 'Admin' },
  { to: '/projector', label: 'Projektor' },
  { to: '/events', label: 'Akce' },
] as const;

export function AppLayout() {
  return (
    <div className="app-shell">
      <header className="site-header">
        <NavLink className="brand" to="/events" aria-label="Filmový Kvíz – úvod">
          <span className="brand-mark" aria-hidden="true">FK</span>
          <span>Filmový Kvíz <strong>V2</strong></span>
        </NavLink>
        <nav aria-label="Hlavní navigace">
          {navigation.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="page-shell">
        <Outlet />
      </main>
    </div>
  );
}
