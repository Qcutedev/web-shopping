/**
 * The sign-in endpoint allows 5 requests a minute per address, successful or not
 * (RATE_LIMITS.SIGN_IN_ADDRESS), and every e2e browser comes from 127.0.0.1. The suite signs in
 * many times, so a spec calls `takeSignIn()` right before it submits a sign-in form; the call
 * waits until fewer than MAX_IN_WINDOW sign-ins of this process happened in the last window.
 *
 * global-setup signs in three seeded accounts just before the first test, from another process, so
 * the log starts with three entries. The count is exact: every sign-in of the suite goes through takeSignIn().
 */
const WINDOW_MS = 60_500;
const MAX_IN_WINDOW = 5;
const SETUP_SIGN_INS = 3;

const log: number[] = Array.from({ length: SETUP_SIGN_INS }, () => Date.now());

export async function takeSignIn(): Promise<void> {
  for (;;) {
    const now = Date.now();
    while (log.length > 0 && now - log[0]! >= WINDOW_MS) log.shift();
    if (log.length < MAX_IN_WINDOW) {
      log.push(now);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, log[0]! + WINDOW_MS - now + 50));
  }
}
