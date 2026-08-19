import { spawn } from "node:child_process";

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function runCli(...args: string[]): Promise<CliResult> {
  const child = spawn(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      NO_COLOR: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });

  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);

    child.once("close", (code, signal) => {
      if (signal !== null) {
        reject(new Error(`CLI terminated by signal ${signal}`));
        return;
      }

      if (code === null) {
        reject(new Error("CLI exited without an exit code"));
        return;
      }

      resolve(code);
    });
  });

  return {
    exitCode,
    stdout,
    stderr,
  };
}
