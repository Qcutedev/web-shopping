/**
 * Starts a process, collects its output, and waits for it to end. When it does not end within
 * the time limit, the process AND every process it started are stopped.
 *
 * Why not `execFile` with its `timeout` option (review finding CR-35): on Windows that stops
 * only the process itself. A `vitest` run forks workers, and they would stay alive, holding
 * connections to the test database, after the test that started the run had given up on it.
 *
 * How the tree is stopped:
 * - Windows: `taskkill /T /F /PID <pid>`, which ends the process and all its descendants.
 * - Elsewhere: the process is started as the leader of its own process group, and the group is
 *   sent SIGKILL. A descendant that left the group (by starting its own session) is not reached.
 */
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";

export type ProcessRun = {
  /** The exit status; null when the process was ended by a signal or stopped on the time limit. */
  exitCode: number | null;
  /** Everything the process wrote to its standard output and standard error, in that order. */
  output: string;
  /** True when the time limit ran out and the process tree was stopped. */
  timedOut: boolean;
};

export type ProcessRunOptions = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
};

/** Stops the process `pid` and every process that descends from it. Never throws. */
export function killProcessTree(pid: number): void {
  if (process.platform === "win32") {
    const taskkill = join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "taskkill.exe");
    spawnSync(taskkill, ["/T", "/F", "/PID", String(pid)], { windowsHide: true, stdio: "ignore" });
    return;
  }
  try {
    // A negative id addresses the whole process group, whose leader `runProcess` made the child.
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
}

export function runProcess(
  command: string,
  args: readonly string[],
  options: ProcessRunOptions,
): Promise<ProcessRun> {
  return new Promise((done, fail) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      // Its own process group, so that the group can be signalled. Not on Windows, where
      // `detached` means a console of its own and taskkill walks the tree by parent id.
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid !== undefined) {
        killProcessTree(child.pid);
      }
    }, options.timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      fail(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ exitCode: timedOut ? null : code, output: `${stdout}\n${stderr}`, timedOut });
    });
  });
}
