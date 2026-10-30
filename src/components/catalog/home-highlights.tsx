import type { ReactNode } from "react";
import { th } from "@/i18n/th";

const ICON_PROPS = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: false,
  className: "size-6",
} as const;

const ICONS: readonly ReactNode[] = [
  <svg key="store" {...ICON_PROPS}>
    <path d="M4 9l1.5-5h13L20 9M4 9v11h16V9M4 9c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3" />
  </svg>,
  <svg key="search" {...ICON_PROPS}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4 4" />
  </svg>,
  <svg key="star" {...ICON_PROPS}>
    <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
  </svg>,
  <svg key="open" {...ICON_PROPS}>
    <path d="M5 10v10h14V10M3 10l2-6h14l2 6M10 20v-6h4v6" />
  </svg>,
];

/** Four facts about the site, each true of the system. No promotion, no number. */
export function HomeHighlights() {
  const { highlights } = th.catalog.home;
  return (
    <section aria-label={highlights.label} className="bg-surface-muted rounded-xl p-4 md:p-6">
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {highlights.items.map((item, i) => (
          <li key={item.title} className="flex items-start gap-3">
            <span className="bg-surface text-primary border-border flex size-12 shrink-0 items-center justify-center rounded-full border">
              {ICONS[i]}
            </span>
            <span className="flex flex-col">
              <span className="type-label text-foreground">{item.title}</span>
              <span className="type-caption text-foreground-secondary">{item.description}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
