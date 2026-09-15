import type { ReactNode } from 'react';
import type { Permission } from '@filmovy-kviz/quiz-domain';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';

/** Navigation feedback only; the server independently enforces permissions and resource scope. */
export function PermissionGate({ requires, children }: { requires: readonly Permission[]; children: ReactNode }) {
  const { can } = useAuth();
  if (!requires.every(can)) return <section className="account-card"><h1>Tato činnost není dostupná</h1><p>Váš účet pro ni nemá potřebná oprávnění. Přidělený přístup najdete v osobním účtu.</p><Link to="/account">Můj účet</Link></section>;
  return children;
}
