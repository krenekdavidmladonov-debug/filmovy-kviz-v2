import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';

export function AdminSettingsPage() {
  const { can } = useAuth();
  return <article><header className="event-page-heading"><div><h1>Nastavení</h1><p className="lead">Účet a přístupy k přípravě a moderování.</p></div></header>
    <div className="settings-sections">
      <section className="event-section"><h2>Můj účet</h2><p>Přihlášení a nastavení vašeho účtu.</p><Link className="secondary-link" to="/account">Otevřít můj účet</Link></section>
      {can('users.manage') && <section className="event-section"><h2>Uživatelé a přístupy</h2><p>Pozvánky a oprávnění spolupracovníků.</p><Link className="secondary-link" to="/admin/users">Spravovat přístupy</Link></section>}
      {can('quiz.read') && <section className="event-section"><h2>Vzhled kvízového večera</h2><p>Společný motiv, jednotlivé slidy a vyhlášení nastavíte přímo v editoru vybraného kvízu.</p><Link className="secondary-link" to="/admin/quizzes">Vybrat kvíz</Link></section>}
    </div>
  </article>;
}
