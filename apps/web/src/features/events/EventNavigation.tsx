import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import './event-navigation.css';

/** Context navigation reuses the existing event routes and permission gates. */
export function EventNavigation() {
  const { pathname, hash } = useLocation();
  const { can } = useAuth();
  const match = /^\/admin\/events\/([^/]+)(?:\/(.*))?$/.exec(pathname);
  if (!match || match[1] === 'new') return null;
  const base = `/admin/events/${match[1]}`;
  const current = match[2] ?? '';
  const links = [
    { label: 'Přehled', to: base, active: current === '' && hash !== '#event-quiz', visible: true },
    { label: 'Kvíz', to: `${base}#event-quiz`, active: current === '' && hash === '#event-quiz', visible: true },
    { label: 'Týmy', to: `${base}/registrations`, active: current === 'registrations', visible: can('event.contacts') },
    { label: 'Materiály', to: `${base}/print`, active: current === 'print', visible: can('event.export') },
    { label: 'Výsledky', to: `${base}/results`, active: current === 'results', visible: true },
  ];
  return <nav className="event-context-navigation" aria-label="Sekce akce">
    {links.filter(link => link.visible).map(link => <Link key={link.label} to={link.to} aria-current={link.active ? 'page' : undefined}>{link.label}</Link>)}
    <Link className="event-scoring-shortcut" to={`${base}/scoring`} aria-current={current === 'scoring' ? 'page' : undefined}>Zapsat body</Link>
  </nav>;
}
