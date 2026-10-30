import Image from "next/image";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { Reveal } from "@/components/reveal";
import { ScrollRow, ScrollRowItem } from "@/components/scroll-row";
import { UserName, USER_NAME_CONTAINER_CLASS } from "@/components/user-name";
import { fill } from "@/i18n/fill";
import { th } from "@/i18n/th";
import { storeHref } from "@/lib/routes";
import { listFeaturedStores } from "@/modules/catalog";
import type { FeaturedStoreDto } from "@/modules/catalog/schema";

const STORE_COUNT = 12;

/** A row of stores: logo (or the first letter of the name) over the name and product count. */
export function FeaturedStoresView({ stores }: { stores: readonly FeaturedStoreDto[] }) {
  if (stores.length === 0) return null;
  const { stores: copy, scrollPrevious, scrollNext } = th.catalog.home;
  return (
    <Reveal>
      <section aria-labelledby="home-stores" className="flex flex-col gap-4">
        <h2 id="home-stores" className="type-section-title">
          {copy.title}
        </h2>
        <ScrollRow label={copy.label} previous={scrollPrevious} next={scrollNext}>
          {stores.map((store) => (
            <ScrollRowItem key={store.slug}>
              <Link
                href={storeHref(store.slug)}
                className="group focus-ring border-border bg-surface flex h-full flex-col items-center gap-2 rounded-lg border p-4 text-center transition-all duration-300 hover:-translate-y-1 hover:shadow-md"
              >
                <span className="bg-surface-muted text-primary relative flex size-16 items-center justify-center overflow-hidden rounded-full text-2xl font-semibold">
                  {store.logo === null ? (
                    <span aria-hidden="true">{Array.from(store.name)[0]}</span>
                  ) : (
                    <Image
                      src={store.logo.url}
                      alt=""
                      fill
                      sizes="64px"
                      unoptimized
                      className="object-cover"
                    />
                  )}
                </span>
                <span
                  className={`type-label text-foreground line-clamp-2 group-hover:underline ${USER_NAME_CONTAINER_CLASS}`}
                >
                  <UserName>{store.name}</UserName>
                </span>
                <span className="type-caption text-foreground-muted">
                  {fill(copy.productCount, { count: store.productCount })}
                </span>
              </Link>
            </ScrollRowItem>
          ))}
        </ScrollRow>
      </section>
    </Reveal>
  );
}

/** Server Component. Stores are a shortcut: if they fail to load, nothing is shown. */
export async function FeaturedStores() {
  await connection();
  let stores: FeaturedStoreDto[];
  try {
    stores = await listFeaturedStores(STORE_COUNT);
  } catch (error) {
    unstable_rethrow(error);
    return null;
  }
  return <FeaturedStoresView stores={stores} />;
}
