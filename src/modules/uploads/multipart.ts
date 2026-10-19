/**
 * A strict reader of a `multipart/form-data` body that holds exactly one file in the field
 * `file` (docs/API_CONTRACTS.md section 5.8). Pure: it works on bytes that were already read
 * under the byte limit (`readRawBodyBytes`), so nothing here can hold more than that limit, and
 * the file's bytes are a view of the body, not a copy.
 *
 * What it accepts, and nothing more (RFC 7578 as browsers send it):
 *
 *   --<boundary>CRLF
 *   Content-Disposition: form-data; name="file"; filename="photo.jpg"CRLF
 *   Content-Type: image/jpegCRLF
 *   CRLF
 *   <bytes>CRLF
 *   --<boundary>--[anything]
 *
 *   - no preamble before the first delimiter; whatever follows the closing delimiter is ignored;
 *   - a part may carry only `Content-Disposition` and `Content-Type`, each at most once; any other
 *     header (`Content-Transfer-Encoding` included, which would change what the bytes mean) is
 *     refused, and the header block of a part is at most MAX_PART_HEADER_BYTES;
 *   - `Content-Disposition` is `form-data` with the parameters `name` and `filename` only, each a
 *     token or a quoted string, at most once (`filename*` is refused);
 *   - header bytes are strict UTF-8 (browsers send a file name as raw UTF-8);
 *   - exactly one part: a part whose name is not `file` is an unknown field (provisional, item
 *     8.2-8), a second `file` part is refused, and a `file` part without `filename` is a plain
 *     value, not a file.
 *
 * Every refusal is a 400 (errors.ts) whose message repeats nothing of the body.
 */
import { fileMissing, invalidClientFilename, malformedMultipart, unknownFormField } from "./errors";
import { MAX_CLIENT_FILENAME_LENGTH, MAX_PART_HEADER_BYTES, UPLOAD_FIELD_NAME } from "./schema";

/** RFC 2046 boundary: 1 to 70 characters of `bchars`, not ending in a space. */
const BOUNDARY_PATTERN = /^[0-9A-Za-z'()+_,\-./:=? ]{0,69}[0-9A-Za-z'()+_,\-./:=?]$/;

/** RFC 9110 token characters: a header name, a parameter name, an unquoted parameter value. */
const TOKEN_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

const CRLF = Buffer.from("\r\n", "latin1");
const HEADER_END = Buffer.from("\r\n\r\n", "latin1");
const DASH = 0x2d;
const CR = 0x0d;
const LF = 0x0a;

/** The one file of the form, as the client described it. Nothing here is trusted yet. */
export interface MultipartFile {
  /** The client's file name, checked by `isAllowedClientFilename`. Never used as a name. */
  filename: string;
  /** The part's `Content-Type` media type, lower-cased, without parameters; "" when absent. */
  declaredType: string;
  /** A view of the body: the file's bytes. */
  bytes: Uint8Array;
}

/**
 * The boundary of a `multipart/form-data` content type. The media type itself was already
 * checked by `assertContentType`; here the `boundary` parameter must be present once and valid.
 */
export function parseBoundary(contentType: string | null): string {
  const header = contentType ?? "";
  const params = header.split(";").slice(1);
  let boundary: string | undefined;
  for (const raw of params) {
    const param = raw.trim();
    if (param === "") continue;
    const eq = param.indexOf("=");
    if (eq <= 0) throw malformedMultipart("The content type has a malformed parameter.");
    const name = param.slice(0, eq).trim().toLowerCase();
    let value = param.slice(eq + 1).trim();
    if (name !== "boundary") continue;
    if (boundary !== undefined) {
      throw malformedMultipart("The content type names more than one boundary.");
    }
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    boundary = value;
  }
  if (boundary === undefined || !BOUNDARY_PATTERN.test(boundary)) {
    throw malformedMultipart("The content type has no valid multipart boundary.");
  }
  return boundary;
}

/** C0 and C1 controls and DEL. */
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/;
/** Separators of a path on any platform, and the Windows drive and stream separator. */
const PATH_SEPARATOR = /[/\\:]/;
/** Percent-encoded separators, dots, and controls: harmless here, refused for every consumer. */
const ENCODED_PATH_CHARACTER = /%(?:2f|5c|3a|2e|0[0-9a-f]|1[0-9a-f]|7f)/i;

/**
 * Whether a client file name is acceptable (TM-17, TM-18: traversal names are refused). The name
 * is never used as a name or a path; it is checked so that no name that could be one passes, and
 * for its extension. Refused: empty or longer than MAX_CLIENT_FILENAME_LENGTH, a control
 * character, `/`, `\`, `:`, a name that is `.` or `..` or starts with `..`, and a percent-encoded
 * separator, dot, or control character.
 */
export function isAllowedClientFilename(name: string): boolean {
  if (name.length === 0 || name.length > MAX_CLIENT_FILENAME_LENGTH) return false;
  if (CONTROL_CHARACTER.test(name) || PATH_SEPARATOR.test(name)) return false;
  if (name === "." || name.startsWith("..")) return false;
  if (ENCODED_PATH_CHARACTER.test(name)) return false;
  return true;
}

interface PartHeaders {
  disposition: { name: string; filename: string | undefined };
  declaredType: string;
}

function decodeHeaderBlock(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw malformedMultipart("A part header is not valid UTF-8.");
  }
}

/**
 * `form-data; name="file"; filename="a.jpg"`. Quoted values end at the next `"`; browsers
 * percent-encode `"`, CR, and LF inside them (WHATWG), so no escape is interpreted.
 */
function parseDisposition(value: string): PartHeaders["disposition"] {
  const lower = value.toLowerCase();
  if (!lower.startsWith("form-data")) {
    throw malformedMultipart("A part is not form-data.");
  }
  const params = new Map<string, string>();
  let i = "form-data".length;
  const skipBlanks = (): void => {
    while (value[i] === " " || value[i] === "\t") i += 1;
  };
  for (;;) {
    skipBlanks();
    if (i >= value.length) break;
    if (value[i] !== ";") throw malformedMultipart("A part's disposition is malformed.");
    i += 1;
    skipBlanks();
    const eq = value.indexOf("=", i);
    if (eq === -1) throw malformedMultipart("A part's disposition is malformed.");
    const key = value.slice(i, eq).trim().toLowerCase();
    if (!TOKEN_PATTERN.test(key)) throw malformedMultipart("A part's disposition is malformed.");
    i = eq + 1;
    skipBlanks();
    let paramValue: string;
    if (value[i] === '"') {
      const close = value.indexOf('"', i + 1);
      if (close === -1) throw malformedMultipart("A part's disposition is malformed.");
      paramValue = value.slice(i + 1, close);
      i = close + 1;
    } else {
      let end = i;
      while (
        end < value.length &&
        value[end] !== ";" &&
        value[end] !== " " &&
        value[end] !== "\t"
      ) {
        end += 1;
      }
      paramValue = value.slice(i, end);
      if (!TOKEN_PATTERN.test(paramValue)) {
        throw malformedMultipart("A part's disposition is malformed.");
      }
      i = end;
    }
    if (key !== "name" && key !== "filename") {
      throw malformedMultipart("A part's disposition has a parameter that is not accepted.");
    }
    if (params.has(key)) throw malformedMultipart("A part's disposition repeats a parameter.");
    params.set(key, paramValue);
  }
  const name = params.get("name");
  if (name === undefined) throw malformedMultipart("A part has no field name.");
  return { name, filename: params.get("filename") };
}

const HEADER_LINE = /^([!#$%&'*+\-.^_`|~0-9A-Za-z]+):[ \t]*(.*?)[ \t]*$/;

function parseHeaders(block: string): PartHeaders {
  let disposition: PartHeaders["disposition"] | undefined;
  let declaredType: string | undefined;
  for (const line of block.split("\r\n")) {
    const match = HEADER_LINE.exec(line);
    if (match === null) throw malformedMultipart("A part header is malformed.");
    const name = (match[1] ?? "").toLowerCase();
    const value = match[2] ?? "";
    if (name === "content-disposition") {
      if (disposition !== undefined) throw malformedMultipart("A part header is repeated.");
      disposition = parseDisposition(value);
    } else if (name === "content-type") {
      if (declaredType !== undefined) throw malformedMultipart("A part header is repeated.");
      const end = value.indexOf(";");
      declaredType = (end === -1 ? value : value.slice(0, end)).trim().toLowerCase();
    } else {
      throw malformedMultipart("A part has a header that is not accepted.");
    }
  }
  if (disposition === undefined) throw malformedMultipart("A part has no disposition.");
  return { disposition, declaredType: declaredType ?? "" };
}

/**
 * The one file of a `multipart/form-data` body with the given boundary. Throws a 400 for a body
 * whose framing cannot be read, a field other than `file`, no file, more than one, or a client
 * file name that `isAllowedClientFilename` refuses. Size and type are the caller's checks.
 */
export function parseSingleFilePart(body: Uint8Array, boundary: string): MultipartFile {
  const buffer = Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  const delimiter = Buffer.from(`--${boundary}`, "latin1");
  const nextDelimiter = Buffer.concat([CRLF, delimiter]);
  if (!buffer.subarray(0, delimiter.length).equals(delimiter)) {
    throw malformedMultipart("The body does not start with the boundary.");
  }
  let position = delimiter.length;
  let file: MultipartFile | undefined;
  for (;;) {
    if (buffer[position] === DASH && buffer[position + 1] === DASH) break; // closing delimiter
    if (buffer[position] !== CR || buffer[position + 1] !== LF) {
      throw malformedMultipart("A boundary line is malformed.");
    }
    position += 2;
    if (buffer[position] === CR && buffer[position + 1] === LF) {
      throw malformedMultipart("A part has no headers.");
    }
    const headerEnd = buffer.indexOf(HEADER_END, position);
    if (headerEnd === -1 || headerEnd - position > MAX_PART_HEADER_BYTES) {
      throw malformedMultipart("A part's headers are missing or too long.");
    }
    const headers = parseHeaders(decodeHeaderBlock(body.subarray(position, headerEnd)));
    const contentStart = headerEnd + HEADER_END.length;
    const contentEnd = buffer.indexOf(nextDelimiter, contentStart);
    if (contentEnd === -1) throw malformedMultipart("A part is not closed by the boundary.");

    if (headers.disposition.name !== UPLOAD_FIELD_NAME) throw unknownFormField();
    if (file !== undefined || headers.disposition.filename === undefined) throw fileMissing();
    if (!isAllowedClientFilename(headers.disposition.filename)) throw invalidClientFilename();
    file = {
      filename: headers.disposition.filename,
      declaredType: headers.declaredType,
      bytes: body.subarray(contentStart, contentEnd),
    };
    position = contentEnd + nextDelimiter.length;
  }
  if (file === undefined) throw fileMissing();
  return file;
}
