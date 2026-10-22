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
  NEXT_ENV_FILE_NAMES,
  scanEnvText,
} from "../../../e2e/support/env-file-scan";

const BOM = String.fromCharCode(0xfeff);

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

  it("scans the .env.test files the server loads when NODE_ENV is test", () => {
    expect(NEXT_ENV_FILE_NAMES).toEqual(
      expect.arrayContaining([
        ".env",
        ".env.local",
        ".env.development",
        ".env.test",
        ".env.test.local",
      ]),
    );
  });

  it("reads DATABASE_URL from any form, for the comparison with DATABASE_URL_TEST (CR-156)", () => {
    expect(scanEnvText(`${BOM}DATABASE_URL="postgresql://u:p@127.0.0.1:5432/d"\n`)).toEqual({
      DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/d",
    });
  });
});
