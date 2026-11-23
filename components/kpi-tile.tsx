import type { ReactNode } from "react";

type KpiTileProps = {
  label: string;
  value: ReactNode;
  caption?: ReactNode;
  explanation: string;
  colorClassName?: string;
};

export function KpiTile({ label, value, caption, explanation, colorClassName }: KpiTileProps) {
  return (
    <article className={`app-card relative overflow-visible rounded-xl p-4 ${colorClassName ?? ""}`}>
      <p className="app-kicker flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide">
        {label}
        <span className="group relative inline-flex">
          <span
            tabIndex={0}
            aria-label={explanation}
            className="app-muted inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full text-[10px] font-bold ring-1 ring-current outline-none"
          >
            ?
          </span>
          <span
            role="tooltip"
            className="app-card pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 w-56 -translate-x-1/2 rounded-lg p-2 text-left text-xs font-normal normal-case tracking-normal opacity-0 shadow-lg transition group-hover:opacity-100 group-focus-within:opacity-100"
          >
            {explanation}
          </span>
        </span>
      </p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
      {caption ? <p className="app-muted mt-1 text-xs">{caption}</p> : null}
    </article>
  );
}
