import { RefereePage } from '../routes/referee/RefereePage';
import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';

import { AdminPage } from '../routes/admin/AdminPage';
import { AdminLoginPage } from '../routes/admin/AdminLoginPage';
import { AdminLoading } from '../routes/admin/AdminLoading';
import { AdminNoAccessPage } from '../routes/admin/AdminNoAccessPage';
import { RequireStaff } from '../routes/admin/RequireStaff';
import { EventsPage } from '../routes/events/EventsPage';
import { PublicEventPage } from '../routes/events/PublicEventPage';
import { ManageRegistrationPage } from '../routes/events/ManageRegistrationPage';
import { NotFoundPage } from '../routes/NotFoundPage';
import { AdminShell } from './AdminShell';
import { AppLayout } from './AppLayout';

const QuizLibraryPage = lazy(async () => {
  const module = await import('../routes/admin/QuizLibraryPage');
  return { default: module.QuizLibraryPage };
});

const QuizCreatePage = lazy(async () => {
  const module = await import('../routes/admin/QuizCreatePage');
  return { default: module.QuizCreatePage };
});

const QuizDetailPage = lazy(async () => {
  const module = await import('../routes/admin/QuizDetailPage');
  return { default: module.QuizDetailPage };
});

const QuizEditorPage = lazy(async () => {
  const module = await import('../routes/admin/QuizEditorPage');
  return { default: module.QuizEditorPage };
});

const QuizPreflightPage = lazy(async () => {
  const module = await import('../routes/admin/QuizPreflightPage');
  return { default: module.QuizPreflightPage };
});

const QuizRepairPage = lazy(async () => {
  const module = await import('../routes/admin/QuizRepairPage');
  return { default: module.QuizRepairPage };
});

const AdminEventScoringPage = lazy(async () => {
  const module = await import('../routes/admin/AdminEventScoringPage');
  return { default: module.AdminEventScoringPage };
});

const AdminEventsPage = lazy(async () => {
  const module = await import('../routes/admin/AdminEventsPage');
  return { default: module.AdminEventsPage };
});

const AdminEventCreatePage = lazy(async () => {
  const module = await import('../routes/admin/AdminEventCreatePage');
  return { default: module.AdminEventCreatePage };
});

const AdminEventDetailPage = lazy(async () => {
  const module = await import('../routes/admin/AdminEventDetailPage');
  return { default: module.AdminEventDetailPage };
});

const AdminPrintCenterPage = lazy(async () => {
  const module = await import('../routes/admin/AdminPrintCenterPage');
  return { default: module.AdminPrintCenterPage };
});

const AdminEventRegistrationsPage = lazy(async () => {
  const module = await import('../routes/admin/AdminEventRegistrationsPage');
  return { default: module.AdminEventRegistrationsPage };
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
  { path: 'referee/:eventId', element: <RefereePage /> },
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
          { path: 'quizzes/new', element: <LazyAdminRoute><QuizCreatePage /></LazyAdminRoute> },
          { path: 'quizzes/:quizId', element: <LazyAdminRoute><QuizDetailPage /></LazyAdminRoute> },
          { path: 'quizzes/:quizId/readiness', element: <LazyAdminRoute><QuizPreflightPage /></LazyAdminRoute> },
          { path: 'quizzes/:quizId/readiness/repair', element: <LazyAdminRoute><QuizRepairPage /></LazyAdminRoute> },
          { path: 'events', element: <LazyAdminRoute><AdminEventsPage /></LazyAdminRoute> },
          { path: 'events/new', element: <LazyAdminRoute><AdminEventCreatePage /></LazyAdminRoute> },
          { path: 'events/:eventId/scoring', element: <LazyAdminRoute><AdminEventScoringPage /></LazyAdminRoute> },
          { path: 'events/:eventId', element: <LazyAdminRoute><AdminEventDetailPage /></LazyAdminRoute> },
          { path: 'events/:eventId/print', element: <LazyAdminRoute><AdminPrintCenterPage /></LazyAdminRoute> },
          { path: 'events/:eventId/registrations', element: <LazyAdminRoute><AdminEventRegistrationsPage /></LazyAdminRoute> },
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
      { path: 'events/:eventId', element: <PublicEventPage /> },
      { path: 'events/:eventId/registration/manage', element: <ManageRegistrationPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
