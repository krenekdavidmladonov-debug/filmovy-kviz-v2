import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';

import { AdminPage } from '../routes/admin/AdminPage';
import { AdminLoginPage } from '../routes/admin/AdminLoginPage';
import { AdminLoading } from '../routes/admin/AdminLoading';
import { AdminNoAccessPage } from '../routes/admin/AdminNoAccessPage';
import { RequireStaff } from '../routes/admin/RequireStaff';
import { EventsPage } from '../routes/events/EventsPage';
import { NotFoundPage } from '../routes/NotFoundPage';
import { AdminShell } from './AdminShell';
import { AppLayout } from './AppLayout';

const QuizLibraryPage = lazy(async () => {
  const module = await import('../routes/admin/QuizLibraryPage');
  return { default: module.QuizLibraryPage };
});

const QuizDetailPage = lazy(async () => {
  const module = await import('../routes/admin/QuizDetailPage');
  return { default: module.QuizDetailPage };
});

const QuizEditorPage = lazy(async () => {
  const module = await import('../routes/admin/QuizEditorPage');
  return { default: module.QuizEditorPage };
});

const LiveControlPage = lazy(async () => {
  const module = await import('../routes/admin/LiveControlPage');
  return { default: module.LiveControlPage };
});

const ProjectorPage = lazy(async () => {
  const module = await import('../routes/projector/ProjectorPage');
  return { default: module.ProjectorPage };
});

function LazyAdminRoute({ children }: { readonly children: ReactNode }) {
  return <Suspense fallback={<AdminLoading />}>{children}</Suspense>;
}

function LazyProjectorRoute() {
  return <Suspense fallback={<section className="projector-stage projector-message"><h1>Načítám projektor…</h1></section>}><ProjectorPage /></Suspense>;
}

export const router = createBrowserRouter([
  { path: 'projector', element: <LazyProjectorRoute /> },
  { path: 'projector/:sessionId', element: <LazyProjectorRoute /> },
  {
    path: 'admin',
    element: <RequireStaff />,
    children: [
      { path: 'live/:sessionId', element: <LazyAdminRoute><LiveControlPage /></LazyAdminRoute> },
      { path: 'quizzes/:quizId/edit', element: <LazyAdminRoute><QuizEditorPage /></LazyAdminRoute> },
      {
        element: <AdminShell />,
        children: [
          { index: true, element: <AdminPage /> },
          { path: 'quizzes', element: <LazyAdminRoute><QuizLibraryPage /></LazyAdminRoute> },
          { path: 'quizzes/:quizId', element: <LazyAdminRoute><QuizDetailPage /></LazyAdminRoute> },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to="/events" replace /> },
      { path: 'admin/login', element: <AdminLoginPage /> },
      { path: 'admin/no-access', element: <AdminNoAccessPage /> },
      { path: 'events', element: <EventsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
