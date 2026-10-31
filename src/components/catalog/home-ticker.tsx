import { th } from "@/i18n/th";

/**
 * Decorative strip under the poster that scrolls the site's four facts. The same facts are in
 * HomeHighlights as real text, so this strip is hidden from assistive technology. It has no
 * promotion or number in it. Two copies of the list make the loop seamless (see .ticker in globals.css).
 */
export function HomeTicker() {
  const { ticker } = th.catalog.home;
  return (
    <div aria-hidden="true" className="ticker bg-ink text-on-ink type-label py-2">
      <div className="ticker-track">
        {[0, 1].map((copy) => (
          <ul key={copy} className="flex shrink-0 items-center">
            {[...ticker, ...ticker].map((text, i) => (
              <li key={i} className="flex items-center gap-6 pr-6">
                <span>{text}</span>
                <span className="bg-primary size-2 rotate-45" />
              </li>
            ))}
          </ul>
        ))}
      </div>
    </div>
  );
}
