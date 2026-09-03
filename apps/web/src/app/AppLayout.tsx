import { NavLink, Outlet } from 'react-router-dom';

import { productConfig } from '../config/product';

export function AppLayout() {
  return (
    <div className="app-shell">
      <header className="site-header">
        <NavLink className="brand" to="/events" aria-label={`${productConfig.adminLabel} – úvod`}>
          <span className="brand-mark" aria-hidden="true">{productConfig.shortName}</span>
          <span>{productConfig.name}</span>
        </NavLink>
        <NavLink className="nav-link" to="/admin">Administrace</NavLink>
      </header>
      <main className="page-shell">
        <Outlet />
      </main>
    </div>
  );
}
