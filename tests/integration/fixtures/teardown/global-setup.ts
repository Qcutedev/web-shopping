/**
 * Stand-in for the integration global setup, used by the teardown case of run-guards.test.ts
 * (CR-37). It touches no database. FIXTURE_TEARDOWN=throw makes the teardown it returns throw,
 * as the real one does when the run lock was lost (RunLockLostError); any other value makes it
 * end normally, which is the control case.
 */
export default function setup(): () => void {
  const mode = process.env["FIXTURE_TEARDOWN"];
  return () => {
    if (mode === "throw") {
      throw new Error("fixture teardown failed on purpose");
    }
  };
}
