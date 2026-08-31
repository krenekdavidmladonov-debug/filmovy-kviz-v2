interface SurfacePlaceholderProps {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly status: string;
  readonly projector?: boolean;
}

export function SurfacePlaceholder({
  eyebrow,
  title,
  description,
  status,
  projector = false,
}: SurfacePlaceholderProps) {
  return (
    <section className={projector ? 'surface projector-surface' : 'surface'}>
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="lead">{description}</p>
      </div>
      <div className="status-card" role="status">
        <span className="status-dot" aria-hidden="true" />
        {status}
      </div>
    </section>
  );
}
