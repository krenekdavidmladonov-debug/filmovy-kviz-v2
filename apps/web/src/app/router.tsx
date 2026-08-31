import { createBrowserRouter, Navigate } from 'react-router-dom';

import { AdminPage } from '../routes/admin/AdminPage';
import { AdminLoginPage } from '../routes/admin/AdminLoginPage';
import { AdminNoAccessPage } from '../routes/admin/AdminNoAccessPage';
import { RequireStaff } from '../routes/admin/RequireStaff';
import { EventsPage } from '../routes/events/EventsPage';
import { NotFoundPage } from '../routes/NotFoundPage';
import { ProjectorPage } from '../routes/projector/ProjectorPage';
import { AppLayout } from './AppLayout';

export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to="/events" replace /> },
      { path: 'admin/login', element: <AdminLoginPage /> },
      { path: 'admin/no-access', element: <AdminNoAccessPage /> },
      {
        path: 'admin',
        element: <RequireStaff />,
        children: [
          { index: true, element: <AdminPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
      { path: 'projector', element: <ProjectorPage /> },
      { path: 'events', element: <EventsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
