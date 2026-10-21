export type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Address-bar parameters as URLSearchParams. An empty value is dropped: a GET form sends
 * `status=` for a select left on "all", and the query schemas reject "" instead of reading it as
 * "no filter".
 */
export function toUrlSearchParams(searchParams: SearchParams): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) {
      value.forEach((entry) => {
        if (entry !== "") params.append(key, entry);
      });
    } else if (value !== undefined && value !== "") params.append(key, value);
  }
  return params;
}
