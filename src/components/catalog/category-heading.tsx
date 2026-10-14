import { notFound, unstable_rethrow } from "next/navigation";
import { UserName, USER_NAME_CONTAINER_CLASS } from "@/components/user-name";
import { th } from "@/i18n/th";
import { getCategory } from "@/modules/catalog";
import { isAppError } from "@/server/errors";

/** Category page h1 for a loaded name. Only the name is isolated (SEC-033, CR-T021-05). */
export function CategoryHeadingView({ name }: { name: string }) {
  return (
    <h1 className={`type-page-title ${USER_NAME_CONTAINER_CLASS}`}>
      <UserName>{name}</UserName>
    </h1>
  );
}

/** Generic h1, shown while the name loads and when it cannot be loaded. */
export function CategoryHeadingFallback() {
  return <h1 className="type-page-title">{th.catalog.categories.label}</h1>;
}

/**
 * Server Component: the category h1 from `getCategory` (API_CONTRACTS.md 5.2). An unknown or
 * inactive category is the not-found page (D-039); any other failure keeps the generic h1, the
 * list below shows its own error state.
 */
export async function CategoryHeading({ slug }: { slug: string }) {
  let name: string;
  try {
    name = (await getCategory(slug)).name;
  } catch (error) {
    unstable_rethrow(error);
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    return <CategoryHeadingFallback />;
  }
  return <CategoryHeadingView name={name} />;
}
