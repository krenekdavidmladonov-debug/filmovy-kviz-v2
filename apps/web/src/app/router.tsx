import { createBrowserRouter, Navigate } from 'react-router-dom';

import { AdminPage } from '../routes/admin/AdminPage';
import { EventsPage } from '../routes/events/EventsPage';
import { NotFoundPage } from '../routes/NotFoundPage';
import { ProjectorPage } from '../routes/projector/ProjectorPage';
import { AppLayout } from './AppLayout';

export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to="/events" replace /> },
      { path: 'admin', element: <AdminPage /> },
      { path: 'projector', element: <ProjectorPage /> },
      { path: 'events', element: <EventsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
