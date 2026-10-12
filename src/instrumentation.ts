/**
 * Server start-up hook (the framework's `instrumentation` file convention; owner devops for
 * T-011, review item V4). The framework calls `register` once when a server instance starts and
 * waits for it before the server handles a request.
 *
 * The one thing it does today: validate the environment (src/server/env.ts), so that a missing
 * or invalid variable is reported at start, by name and rule and never by value, instead of at
 * some later request. T-015 adds the scheduled jobs here, agreed with devops.
 *
 * Where it does not run:
 *
 *   - Outside the Node.js runtime. The configuration module is server code for Node.js, and it
 *     is imported inside the function so that no other runtime ever loads it.
 *   - During `next build`. The build needs no application variable (D-033 point 1), and a build
 *     machine has none of the deployment's secrets. Measured with Next.js 16.4.0: the build of
 *     this application does not call `register` at all, with or without the check below. The
 *     check stays so that a framework version or a route that does call it cannot fail a build.
 *
 * Why it ends the process itself. Measured with Next.js 16.4.0: when `register` throws,
 * `next dev` exits with code 1, but `next start` only prints the error, reports "Ready", stays
 * up, and answers every request with 500. A process that stays up is not restarted or reported
 * as failed by whatever supervises it, so an invalid configuration ends the process here, with
 * exit code 1, after the log line that names the variables has been written.
 *
 * The same applies when the configuration module cannot be loaded (the import is inside the
 * `try`): the error is thrown again after the exit is requested, so the framework prints it.
 *
 * The exit waits for that line, but not for ever. It is requested from the callback of an empty
 * write that is queued behind the line. If standard output never reports that write (a pipe
 * nobody reads, a stream that was destroyed), a timer ends the process after
 * EXIT_FALLBACK_MS all the same (review finding CR-44). The timer is not unref'd: it must keep
 * the process alive until it fires, and it is cleared when the callback comes first.
 */

/** How long the exit waits for standard output before it happens anyway. */
const EXIT_FALLBACK_MS = 2_000;

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.NEXT_PHASE === "phase-production-build") return;

    try {
      // The import is inside the `try` on purpose: a module that fails to load must end the
      // process like an invalid configuration does, not leave `next start` up answering 500.
      const { loadEnvAtStartup } = await import("./server/env");
      // Logs one line that names the variables at fault, then throws `EnvValidationError`.
      loadEnvAtStartup();
    } catch (error) {
      process.exitCode = 1;
      const fallback = setTimeout(() => process.exit(1), EXIT_FALLBACK_MS);
      // The empty write is queued behind the log line, so the exit waits for that line.
      process.stdout.write("", () => {
        clearTimeout(fallback);
        process.exit(1);
      });
      // Still thrown: until the exit happens, the framework must not treat the hook as done.
      throw error;
    }
  }
}
