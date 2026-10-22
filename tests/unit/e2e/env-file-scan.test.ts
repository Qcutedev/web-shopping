/**
 * SEC-074 and CR-155: the e2e refusal check must see every driver override that the e2e server's
 * own env parser (`@next/env`, dotenv syntax) would load. Each text below was shown to be read by
 * @next/env 16.4.0 as setting the variable (docs/SECURITY.md SEC-074), and to be missed by
 * `node:util` `parseEnv`, which the check used before.
 */
import { parseEnv } from "node:util";
import { describe, expect, it } from "vitest";

import {
  assertNoDriverOverrideForE2e,
  collectDevelopmentUrls,
  NEXT_ENV_FILE_NAMES,
  scanEnvText,
} from "../../../e2e/support/env-file-scan";
import { resolveTestDatabase, TestDatabaseRefusedError } from "../../helpers/test-database-url";

const BOM = String.fromCharCode(0xfeff);
// Built from code points, never typed (SEC-043).
const LS = String.fromCodePoint(0x2028);
const PS = String.fromCodePoint(0x2029);

function refusal(text: string, source = "the .env file"): string | undefined {
  try {
    assertNoDriverOverrideForE2e(scanEnvText(text), source);
  } catch (error) {
    return (error as Error).message;
  }
  return undefined;
}

describe("scanEnvText and the e2e driver-override check", () => {
  it.each([
    ["a byte order mark before the first line", `${BOM}PGOPTIONS=-c role=x\nA=1\n`],
    ["lone CR line ends", "A=1\rPGOPTIONS=-c role=x\rNODE_PG_FORCE_NATIVE=1\n"],
    ["the colon form", "PGOPTIONS: -c role=x\n"],
    ["CRLF line ends", "A=1\r\nPGOPTIONS=-c role=x\r\n"],
    ["an export line", "export PGOPTIONS=-c role=x\n"],
    ["a quoted value", 'PGOPTIONS="-c role=x"\n'],
    ["lower case, as Windows allows", "pgoptions=-c role=x\n"],
    ["NODE_PG_FORCE_NATIVE alone", "NODE_PG_FORCE_NATIVE=1\n"],
    ["a quoted value, U+2028, then the assignment (SEC-078)", `A='1'${LS}PGOPTIONS=-c role=x\n`],
    ["a quoted value, U+2029, then the assignment (SEC-078)", `A='1'${PS}PGOPTIONS=-c role=x\n`],
  ])("refuses %s", (_label, text) => {
    expect(refusal(text)).toContain("is set in the .env file");
  });

  it("shows why the old parser was not enough: parseEnv misses each of the three forms", () => {
    const names = (text: string) => Object.keys(parseEnv(text)).map((key) => key.toUpperCase());
    expect(names(`${BOM}PGOPTIONS=-c role=x\n`)).not.toContain("PGOPTIONS");
    expect(names("A=1\rPGOPTIONS=-c role=x\n")).not.toContain("PGOPTIONS");
    expect(names("PGOPTIONS: -c role=x\n")).not.toContain("PGOPTIONS");
  });

  it("names the variable, never the value, and says it is the e2e run", () => {
    const message = refusal("PGOPTIONS=value-must-not-leak\n", "the .env.test file") ?? "";
    expect(message).toContain("PGOPTIONS is set in the .env.test file");
    expect(message).toContain("Unset it for the e2e run");
    expect(message).not.toContain("integration");
    expect(message).not.toContain("value-must-not-leak");
  });

  it.each([
    ["nothing", ""],
    ["other variables", "A=1\nPGHOST=h\nPGOPTIONS_OLD=x\n"],
    ["an empty value", "PGOPTIONS=\nNODE_PG_FORCE_NATIVE=''\n"],
    ["a commented line", "# PGOPTIONS=-c role=x\n"],
    ["a comment after an empty value", "PGOPTIONS= # none\n"],
  ])("does not refuse %s", (_label, text) => {
    expect(refusal(text)).toBeUndefined();
  });

  it("scans exactly the files next dev may load, including .env.development.local", () => {
    expect(NEXT_ENV_FILE_NAMES).toEqual([
      ".env",
      ".env.local",
      ".env.development",
      ".env.development.local",
      ".env.test",
      ".env.test.local",
    ]);
  });

  it("reads DATABASE_URL from any form, for the comparison with DATABASE_URL_TEST (CR-156)", () => {
    expect(scanEnvText(`${BOM}DATABASE_URL="postgresql://u:p@127.0.0.1:5432/d"\n`)).toEqual({
      DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/d",
    });
  });
});

describe("collectDevelopmentUrls with resolveTestDatabase (CR-156, CR-158, CR-159)", () => {
  const TEST_URL = "postgresql://u:p-secret-9@127.0.0.1:5433/marketplace_test";
  const DEV_SAME_SERVER = "postgresql://u:p-secret-9@127.0.0.1:5433/marketplace_dev";
  const DEV_OTHER_SERVER = "postgresql://u:p-secret-9@127.0.0.1:5432/marketplace_dev";

  function run(input: Parameters<typeof collectDevelopmentUrls>[0]): string | undefined {
    try {
      resolveTestDatabase({
        testUrl: TEST_URL,
        ...collectDevelopmentUrls(input),
        run: "e2e",
      });
    } catch (error) {
      expect(error).toBeInstanceOf(TestDatabaseRefusedError);
      return (error as Error).message;
    }
    return undefined;
  }

  it("refuses a development URL held only in .env.local that names the test server, and names the file", () => {
    const message = run({
      processUrl: undefined,
      envFileUrl: undefined,
      nextFiles: [
        [
          ".env.local",
          scanEnvText(`DATABASE_URL="${DEV_SAME_SERVER}"
`),
        ],
      ],
    });
    expect(message).toContain("End-to-end run refused:");
    expect(message).toContain("(read from the .env.local file)");
    expect(message).not.toContain("integration");
    expect(message).not.toContain("p-secret-9");
  });

  it("accepts a development URL on another server, in every source", () => {
    expect(
      run({
        processUrl: DEV_OTHER_SERVER,
        envFileUrl: DEV_OTHER_SERVER,
        nextFiles: [[".env.local", { DATABASE_URL: DEV_OTHER_SERVER }]],
      }),
    ).toBeUndefined();
  });

  it("drops empty values and keeps the source of each URL in order", () => {
    expect(
      collectDevelopmentUrls({
        processUrl: "",
        envFileUrl: DEV_OTHER_SERVER,
        nextFiles: [
          [".env", {}],
          [".env.test", { DATABASE_URL: DEV_SAME_SERVER }],
        ],
      }),
    ).toEqual({
      otherUrls: [DEV_OTHER_SERVER, DEV_SAME_SERVER],
      otherSources: ["the .env file", "the .env.test file"],
    });
  });

  it("names the file for an unreadable URL and for a URL without a port (CR-158)", () => {
    expect(
      run({
        processUrl: undefined,
        envFileUrl: undefined,
        nextFiles: [[".env.test", { DATABASE_URL: "not a url" }]],
      }),
    ).toContain("DATABASE_URL (read from the .env.test file) is not a valid PostgreSQL URL");
    expect(
      run({
        processUrl: undefined,
        envFileUrl: undefined,
        nextFiles: [[".env.development", { DATABASE_URL: "postgresql://u:p@127.0.0.1/d" }]],
      }),
    ).toContain("(read from the .env.development file) names no host or no port");
  });

  it("says e2e and names the file when DATABASE_URL equals DATABASE_URL_TEST (CR-162)", () => {
    const message = run({
      processUrl: undefined,
      envFileUrl: undefined,
      nextFiles: [[".env.local", { DATABASE_URL: TEST_URL }]],
    });
    expect(message).toContain(
      "End-to-end run refused: DATABASE_URL_TEST is equal to DATABASE_URL (read from the .env.local file).",
    );
    expect(message).not.toContain("integration");
    expect(message).not.toContain("p-secret-9");
  });

  it("keeps the integration messages for the integration run", () => {
    expect(() => resolveTestDatabase({ testUrl: TEST_URL, otherUrls: ["not a url"] })).toThrow(
      "fix it or unset it for the integration run.",
    );
  });
});
