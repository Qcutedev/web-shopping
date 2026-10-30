import { th } from "@/i18n/th";

/**
 * Thin bar above the header with three facts about the marketplace, among them the labels that
 * payment and shipping are simulated. A narrow screen shows the first line only; the footer
 * repeats the simulation notices at every width.
 */
export function AnnouncementBar() {
  const { items, label } = th.shell.announcement;
  return (
    <div aria-label={label} role="region" className="bg-primary-active text-on-primary">
      <ul className="container-page type-caption flex items-center justify-center gap-x-8 py-2 md:justify-between">
        {items.map((item, i) => (
          <li key={item} className={i === 0 ? "text-center" : "hidden md:block"}>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
