import { th } from "@/i18n/th";

/**
 * Decorative strip under the poster: one short message at a time (see .ticker in globals.css).
 * The same facts are in HomeHighlights as real text, so the strip is hidden from assistive
 * technology. No promotion and no number in it.
 */
export function HomeTicker() {
  const { ticker } = th.catalog.home;
  return (
    <div aria-hidden="true" className="ticker bg-ink text-on-ink type-label py-2.5">
      {ticker.map((text) => (
        <p key={text} className="ticker-item">
          <span className="bg-primary size-2 rotate-45" />
          {text}
        </p>
      ))}
    </div>
  );
}
