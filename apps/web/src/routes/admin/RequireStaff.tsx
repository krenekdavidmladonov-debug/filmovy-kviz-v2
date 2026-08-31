import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { useAuth } from '../../auth/AuthProvider';
import { AdminLoading } from './AdminLoading';

export function RequireStaff() {
  const { currentUser, role, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <AdminLoading />;
  }

  if (!currentUser) {
    return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />;
  }

  if (!role) {
    return <Navigate to="/admin/no-access" replace />;
  }

  return <Outlet />;
}
