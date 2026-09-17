import { PermissionGate } from '../features/access/PermissionGate';
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
import { AccountPage } from '../routes/AccountPage';
import { UsersAccessPage } from '../routes/admin/UsersAccessPage';
import '../styles/access.css';

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

const AdminEventResultsPage = lazy(async () => {
  const module = await import('../routes/admin/AdminEventResultsPage');
  return { default: module.AdminEventResultsPage };
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
      { path: 'live/:sessionId', element: <LazyAdminRoute><PermissionGate requires={['event.live']}><LiveControlPage /></PermissionGate></LazyAdminRoute> },
      { path: 'quizzes/:quizId/edit', element: <LazyAdminRoute><PermissionGate requires={['quiz.read']}><QuizEditorPage /></PermissionGate></LazyAdminRoute> },
      {
        element: <AdminShell />,
        children: [
          { index: true, element: <AdminPage /> },
          { path: 'users', element: <PermissionGate requires={['users.manage']}><UsersAccessPage /></PermissionGate> },
          { path: 'quizzes', element: <LazyAdminRoute><PermissionGate requires={['quiz.read']}><QuizLibraryPage /></PermissionGate></LazyAdminRoute> },
          { path: 'quizzes/new', element: <LazyAdminRoute><PermissionGate requires={['quiz.create']}><QuizCreatePage /></PermissionGate></LazyAdminRoute> },
          { path: 'quizzes/:quizId', element: <LazyAdminRoute><PermissionGate requires={['quiz.read']}><QuizDetailPage /></PermissionGate></LazyAdminRoute> },
          { path: 'quizzes/:quizId/readiness', element: <LazyAdminRoute><PermissionGate requires={['quiz.read', 'quiz.answers.read']}><QuizPreflightPage /></PermissionGate></LazyAdminRoute> },
          { path: 'quizzes/:quizId/readiness/repair', element: <LazyAdminRoute><PermissionGate requires={['quiz.edit', 'quiz.answers.edit']}><QuizRepairPage /></PermissionGate></LazyAdminRoute> },
          { path: 'events', element: <LazyAdminRoute><PermissionGate requires={['event.read']}><AdminEventsPage /></PermissionGate></LazyAdminRoute> },
          { path: 'events/new', element: <LazyAdminRoute><PermissionGate requires={['event.create']}><AdminEventCreatePage /></PermissionGate></LazyAdminRoute> },
          { path: 'events/:eventId/scoring', element: <LazyAdminRoute><PermissionGate requires={['event.read']}><AdminEventScoringPage /></PermissionGate></LazyAdminRoute> },
          { path: 'events/:eventId/results', element: <LazyAdminRoute><PermissionGate requires={['event.read']}><AdminEventResultsPage /></PermissionGate></LazyAdminRoute> },
          { path: 'events/:eventId', element: <LazyAdminRoute><PermissionGate requires={['event.read']}><AdminEventDetailPage /></PermissionGate></LazyAdminRoute> },
          { path: 'events/:eventId/print', element: <LazyAdminRoute><PermissionGate requires={['event.export']}><AdminPrintCenterPage /></PermissionGate></LazyAdminRoute> },
          { path: 'events/:eventId/registrations', element: <LazyAdminRoute><PermissionGate requires={['event.contacts']}><AdminEventRegistrationsPage /></PermissionGate></LazyAdminRoute> },
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
      { path: 'account', element: <AccountPage /> },
      { path: 'invite/:inviteId', element: <AccountPage /> },
      { path: 'events', element: <EventsPage /> },
      { path: 'events/:eventId', element: <PublicEventPage /> },
      { path: 'events/:eventId/registration/manage', element: <ManageRegistrationPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
