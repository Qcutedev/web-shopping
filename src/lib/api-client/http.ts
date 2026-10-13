/**
 * Minimal typed wrapper over `fetch` for the `/api/v1` envelope (docs/API_CONTRACTS.md section 2).
 *
 * It never throws: a refusal, a network failure, and an unreadable answer all come back as an
 * `ApiFailure`, so a form can show one Thai message and stay usable. The server decides every
 * outcome; nothing here computes a price, total, or permission.
 */

export interface ApiFieldError {
  /** Location of the offending value, `""` for the request root. */
  path: string;
  /** Schema issue code, for example `too_small`. */
  code: string;
}

export interface ApiFailure {
  ok: false;
  /** HTTP status, or 0 when no answer arrived. */
  status: number;
  /** Error code of the envelope, `NETWORK_ERROR` or `UNKNOWN` when there is none. */
  code: string;
  fields: ApiFieldError[];
  requestId: string | null;
}

export interface ApiSuccess<T> {
  ok: true;
  status: number;
  data: T;
}

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

export interface ApiRequestOptions {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  /** JSON body. Omit for a mutation without a body. */
  body?: unknown;
  /** For tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

function failure(status: number, code: string): ApiFailure {
  return { ok: false, status, code, fields: [], requestId: null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readFields(details: unknown): ApiFieldError[] {
  if (!isRecord(details) || !Array.isArray(details.fields)) return [];
  const out: ApiFieldError[] = [];
  for (const entry of details.fields) {
    if (isRecord(entry) && typeof entry.path === "string" && typeof entry.code === "string") {
      out.push({ path: entry.path, code: entry.code });
    }
  }
  return out;
}

export async function apiRequest<T>(
  path: string,
  { method, body, fetchImpl }: ApiRequestOptions,
): Promise<ApiResult<T>> {
  const doFetch = fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch(path, {
      method,
      // Every mutation sends a JSON content type, with or without a body (API_CONTRACTS 1.2).
      headers:
        method === "GET"
          ? { Accept: "application/json" }
          : {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    return failure(0, "NETWORK_ERROR");
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return failure(response.status, "UNKNOWN");
  }

  if (response.ok) {
    if (isRecord(json) && "data" in json) {
      return { ok: true, status: response.status, data: json.data as T };
    }
    return failure(response.status, "UNKNOWN");
  }

  const error = isRecord(json) && isRecord(json.error) ? json.error : null;
  if (error === null) return failure(response.status, "UNKNOWN");
  return {
    ok: false,
    status: response.status,
    code: typeof error.code === "string" ? error.code : "UNKNOWN",
    fields: readFields(error.details),
    requestId: typeof error.requestId === "string" ? error.requestId : null,
  };
}
