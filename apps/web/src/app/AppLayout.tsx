import { NavLink, Outlet } from 'react-router-dom';

import { productConfig } from '../config/product';
import { Brand } from '../ui/Brand';

export function AppLayout() {
  return (
    <div className="app-shell">
      <header className="site-header">
        <NavLink className="brand" to="/events" aria-label={`${productConfig.adminLabel} – úvod`}>
          <Brand />
        </NavLink>
        <NavLink className="nav-link" to="/admin">Administrace</NavLink>
      </header>
      <main className="page-shell">
        <Outlet />
      </main>
    </div>
  );
}
