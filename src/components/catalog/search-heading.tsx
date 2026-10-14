import { UserName, USER_NAME_CONTAINER_CLASS } from "@/components/user-name";
import { th } from "@/i18n/th";

/** Search page h1. Only the visitor's text `q` is isolated; the fixed wording stays outside. */
export function SearchHeading({ q }: { q: string | undefined }) {
  return (
    <h1 className={`type-page-title ${USER_NAME_CONTAINER_CLASS}`}>
      {q === undefined ? (
        th.catalog.search.allTitle
      ) : (
        <>
          {th.catalog.search.resultsForPrefix}
          <UserName>{q}</UserName>
          {th.catalog.search.resultsForSuffix}
        </>
      )}
    </h1>
  );
}
