import type { ReactNode } from "react";

export function Card({
  title,
  eyebrow,
  children,
  action,
  className = ""
}: {
  title?: string;
  eyebrow?: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`.trim()}>
      {(title || eyebrow || action) && (
        <div className="card-header">
          <div>
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            {title && <h2>{title}</h2>}
          </div>
          {action && <div className="card-action">{action}</div>}
        </div>
      )}
      <div>{children}</div>
    </section>
  );
}
