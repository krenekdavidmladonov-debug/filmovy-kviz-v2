import type { ReactNode } from 'react';

export function TechnicalDetails({ children }: { readonly children: ReactNode }) {
  return (
    <details className="technical-details">
      <summary>Technické podrobnosti</summary>
      <div className="technical-details-content">{children}</div>
    </details>
  );
}
