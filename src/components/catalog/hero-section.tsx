import { existsSync } from "node:fs";
import { join } from "node:path";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { HeroCarousel, type HeroProduct, type HeroSlide } from "@/components/catalog/hero-carousel";
import { Skeleton } from "@/components/ui/skeleton";
import { th } from "@/i18n/th";
import { productHref, ROUTES } from "@/lib/routes";
import { listProducts } from "@/modules/catalog";

const HERO_HREFS = [ROUTES.search, ROUTES.search, ROUTES.openStore] as const;
const PRODUCTS_PER_SLIDE = 3;

/** Drop a transparent PNG of the presenter here to put them on the poster. */
const PRESENTER_FILE = "hero/presenter.png";

/**
 * Server Component. The poster shows the newest products that have a picture, shared out over the
 * slides. A catalog failure only leaves the poster without products: the poster is not the point
 * of the page, so nothing is shown about the error.
 */
export async function HeroSection() {
  await connection();
  const { hero } = th.catalog.home;
  const products: HeroProduct[] = [];
  try {
    const page = await listProducts({
      page: 1,
      pageSize: hero.slides.length * PRODUCTS_PER_SLIDE * 2,
      sort: "newest",
    });
    for (const item of page.items) {
      if (item.image === null) continue;
      products.push({ title: item.title, href: productHref(item.slug), imageUrl: item.image.url });
    }
  } catch (error) {
    unstable_rethrow(error);
  }

  const slides: HeroSlide[] = hero.slides.map((slide, i) => ({
    ...slide,
    href: HERO_HREFS[i] ?? ROUTES.search,
    products: products.filter((_, k) => k % hero.slides.length === i).slice(0, PRODUCTS_PER_SLIDE),
  }));
  const presenterSrc = existsSync(join(process.cwd(), "public", PRESENTER_FILE))
    ? `/${PRESENTER_FILE}`
    : null;

  return (
    <HeroCarousel
      slides={slides}
      presenterSrc={presenterSrc}
      labels={{
        region: hero.label,
        previous: hero.previous,
        next: hero.next,
        pause: hero.pause,
        play: hero.play,
        goTo: hero.goTo,
        slideOf: hero.slideOf,
        badge: hero.badge,
        presenterAlt: hero.presenterAlt,
      }}
    />
  );
}

export function HeroSkeleton() {
  return <Skeleton aria-hidden="true" className="h-96 w-full md:h-[30rem]" />;
}
