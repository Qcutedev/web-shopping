import { describe, expect, it, vi } from "vitest";

import { createLogger } from "./logger";
import {
  UPLOAD_VOLUME_ALERT_INTERVAL_MS,
  UPLOAD_VOLUME_ALERT_MESSAGE,
  withUploadVolumeAlert,
} from "./upload-volume-alert";

const RAN = "Upload orphan cleanup ran";

function setup(level: "info" | "error" = "info") {
  const lines: Array<Record<string, unknown>> = [];
  const base = createLogger({
    level,
    write: (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
  });
  let clock = 0;
  const log = withUploadVolumeAlert(base, { now: () => clock });
  return {
    log,
    lines,
    advance: (ms: number) => {
      clock += ms;
    },
    alerts: () =>
      lines.filter(
        (l) => l.msg === UPLOAD_VOLUME_ALERT_MESSAGE || l.message === UPLOAD_VOLUME_ALERT_MESSAGE,
      ),
  };
}

const result = (filesMissing: number) => ({
  component: "upload-cleanup",
  rowsDeleted: filesMissing,
  filesDeleted: 0,
  filesMissing,
  filesFailed: 0,
});

describe("withUploadVolumeAlert", () => {
  it("writes the result line and one alert line when filesMissing is above zero", () => {
    const { log, lines, alerts } = setup();
    log.info(RAN, result(3));
    expect(lines).toHaveLength(2);
    expect(alerts()).toHaveLength(1);
    const alert = alerts()[0];
    expect(alert).toMatchObject({
      filesMissing: 3,
      suppressedRuns: 0,
      alert: "upload-files-missing",
    });
    expect(alert?.level).toBe("error");
  });

  it("writes no alert for filesMissing 0, a missing field, or another component", () => {
    const { log, lines, alerts } = setup();
    log.info(RAN, result(0));
    log.info(RAN, { component: "upload-cleanup", rowsDeleted: 1 });
    log.info(RAN, { component: "other", filesMissing: 5 });
    log.info("Something else", result(4));
    expect(alerts()).toHaveLength(0);
    expect(lines).toHaveLength(4);
  });

  it("is not filtered by LOG_LEVEL: the alert is written at level error", () => {
    const { log, alerts } = setup("error");
    log.info(RAN, result(1));
    expect(alerts()).toHaveLength(1);
  });

  it("limits the alert to one per interval and counts the runs held back", () => {
    const { log, alerts, advance } = setup();
    log.info(RAN, result(1));
    advance(UPLOAD_VOLUME_ALERT_INTERVAL_MS - 1);
    log.info(RAN, result(2));
    log.info(RAN, result(2));
    expect(alerts()).toHaveLength(1);
    advance(1);
    log.info(RAN, result(5));
    expect(alerts()).toHaveLength(2);
    expect(alerts()[1]).toMatchObject({ filesMissing: 5, suppressedRuns: 2 });
  });

  it("writes no alert line for suppressed counts of zero", () => {
    const { log, alerts, advance } = setup();
    log.info(RAN, result(1));
    advance(UPLOAD_VOLUME_ALERT_INTERVAL_MS * 2);
    log.info(RAN, result(0));
    expect(alerts()).toHaveLength(1);
  });

  it("keeps the alert state in a child logger and passes other levels through", () => {
    const { log, lines, alerts } = setup();
    const child = log.child({ requestId: "r1" });
    child.info(RAN, result(2));
    log.info(RAN, result(2));
    expect(alerts()).toHaveLength(1);
    log.warn("w");
    log.error("e");
    expect(lines.some((l) => l.level === "warn")).toBe(true);
  });

  it("carries counts only: no path or key in the alert", () => {
    const { log, alerts } = setup();
    log.info(RAN, { ...result(1), storageKey: "ab/secretkey", path: "/mnt/up" });
    expect(JSON.stringify(alerts()[0])).not.toMatch(/secretkey|\/mnt\/up/);
  });

  it("does not throw when the underlying security call throws", () => {
    const base = createLogger({ write: () => undefined });
    vi.spyOn(base, "security").mockImplementation(() => {
      throw new Error("boom");
    });
    const log = withUploadVolumeAlert(base);
    expect(() => log.info(RAN, result(1))).not.toThrow();
  });
});
