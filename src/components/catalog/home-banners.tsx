import Link from "next/link";
import { ChevronRightIcon } from "@/components/ui/icons";
import { th } from "@/i18n/th";

export interface BannerTarget {
  href: string;
  /** Picks the tint, 0 to 4 (the same tints as the category discs). */
  tone: number;
}

const BANNER =
  "group focus-ring category-disc flex h-full min-h-28 flex-col justify-center gap-1 rounded-xl p-4 transition-all duration-300 hover:-translate-y-1 hover:shadow-md";

interface BannerCopy {
  title: string;
  description: string;
  cta: string;
}

function BannerList({
  label,
  className,
  items,
  targets,
}: {
  label: string;
  className: string;
  items: readonly BannerCopy[];
  targets: readonly BannerTarget[];
}) {
  return (
    <ul aria-label={label} className={className}>
      {items.map((item, i) => {
        const target = targets[i];
        if (target === undefined) return null;
        return (
          <li key={item.title}>
            <Link href={target.href} data-tone={target.tone} className={BANNER}>
              <span className="type-card-title text-foreground">{item.title}</span>
              <span className="type-small text-foreground-secondary">{item.description}</span>
              <span className="type-label text-foreground mt-1 inline-flex items-center gap-1 group-hover:underline">
                {item.cta}
                <ChevronRightIcon />
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Two small banners beside the poster. Each is a link; none claims more than the link does. */
export function SideBanners({ targets }: { targets: readonly BannerTarget[] }) {
  const { sideBanners } = th.catalog.home;
  return (
    <BannerList
      label={sideBanners.label}
      className="grid h-full gap-3 sm:grid-cols-2 xl:grid-cols-1 xl:grid-rows-2"
      items={sideBanners.items}
      targets={targets}
    />
  );
}

/** A row of small banners under the poster. */
export function PromoBanners({ targets }: { targets: readonly BannerTarget[] }) {
  const { promoBanners } = th.catalog.home;
  return (
    <BannerList
      label={promoBanners.label}
      className="grid gap-3 sm:grid-cols-3"
      items={promoBanners.items}
      targets={targets}
    />
  );
}
