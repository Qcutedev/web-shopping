import { redirect, unstable_rethrow } from "next/navigation";
import { Pagination } from "@/components/ui/pagination";
import { fill } from "@/i18n/fill";
import { th } from "@/i18n/th";
import { ROUTES, signInHref } from "@/lib/routes";
import {
  DEFAULT_PAGE_SIZE,
  listAddresses,
  type Page,
  paginationQuerySchema,
  queryRecord,
  type AddressDto,
} from "@/modules/profile";
import type { Actor } from "@/server/auth/actor";
import { isAppError } from "@/server/errors";
import { requireAccountActor } from "./account-actor";
import { AddressBook } from "./address-book";
import { AccountLoadError } from "./load-state";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Reads `page` and `pageSize` from the address bar through the same schema as the endpoint. An
 * invalid query is not an error page: the list falls back to the first page.
 */
export function pageQueryFrom(searchParams: SearchParams): { page: number; pageSize: number } {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) value.forEach((entry) => params.append(key, entry));
    else if (value !== undefined) params.append(key, value);
  }
  const parsed = paginationQuerySchema.safeParse(queryRecord(params));
  return parsed.success
    ? { page: parsed.data.page, pageSize: parsed.data.pageSize }
    : { page: 1, pageSize: DEFAULT_PAGE_SIZE };
}

function hrefForPage(page: number): string {
  return page <= 1 ? ROUTES.accountAddresses : `${ROUTES.accountAddresses}?page=${page}`;
}

/**
 * Server Component: the signed-in user's addresses, one page, through the module service. The
 * query is runtime data, so this renders behind a Suspense boundary (Cache Components).
 */
export async function AddressesSection({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let actor: Actor;
  try {
    actor = await requireAccountActor(ROUTES.accountAddresses);
  } catch (error) {
    unstable_rethrow(error);
    return <AccountLoadError retryHref={ROUTES.accountAddresses} />;
  }

  const query = pageQueryFrom(await searchParams);
  let result: Page<AddressDto>;
  try {
    result = await listAddresses(actor, query);
  } catch (error) {
    unstable_rethrow(error);
    if (isAppError(error) && error.code === "UNAUTHENTICATED") {
      redirect(signInHref(ROUTES.accountAddresses));
    }
    return <AccountLoadError retryHref={hrefForPage(query.page)} />;
  }

  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
  return (
    <div className="flex flex-col gap-6">
      <AddressBook addresses={result.items} total={result.total} firstPageHref={hrefForPage(1)} />
      {totalPages > 1 ? (
        <Pagination
          page={result.page}
          totalPages={totalPages}
          hrefForPage={hrefForPage}
          label={th.pagination.label}
          previousLabel={th.pagination.previous}
          nextLabel={th.pagination.next}
          pageLabel={(page) => fill(th.pagination.page, { page })}
        />
      ) : null}
    </div>
  );
}
