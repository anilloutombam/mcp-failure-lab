import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";

const key = process.env.OPENROUTER_API_KEY;
if (!key) throw new Error("Set OPENROUTER_API_KEY");

const runs = Math.max(1, Number.parseInt(process.env.RUNS ?? "20", 10));
const model = "typesafe/jev-1.13";
const packageVersion = "0.10.0";

const cases = [
  {
    name: "clean",
    scenario: {
      name: "clean ping",
      call: { tool: "ping", args: {} },
      timeoutMs: 1000,
      expect: { outcome: "success" },
    },
    normalize(report) {
      return {
        observed: { outcome: report?.outcome ?? "success", fault: null },
        recovery: null,
      };
    },
  },
  {
    name: "hang_timeout",
    scenario: {
      name: "hang timeout",
      call: { tool: "hang", args: {} },
      timeoutMs: 300,
      expect: { outcome: "timeout" },
    },
    normalize(report) {
      return {
        observed: { outcome: "timeout", fault: "hang", usable_result: false },
        recovery: null,
      };
    },
  },
  {
    name: "duplicate_no_recovery",
    scenario: {
      name: "duplicate response",
      call: { tool: "duplicate_response", args: {} },
      timeoutMs: 1000,
      expect: { outcome: "success" },
    },
    normalize(report) {
      return {
        observed: { outcome: "protocol_anomaly", fault: "duplicate_response" },
        recovery: null,
      };
    },
  },
  {
    name: "duplicate_with_recovery",
    scenario: {
      name: "duplicate response with recovery observer",
      call: { tool: "duplicate_response", args: {} },
      timeoutMs: 1000,
      expect: { outcome: "success" },
      observe: {
        call: { tool: "ping", args: {} },
        timeoutMs: 1000,
        expect: { outcome: "success" },
      },
    },
    normalize(report) {
      return {
        observed: { outcome: "protocol_anomaly", fault: "duplicate_response" },
        recovery: { attempted: true, outcome: "success", tool: "ping" },
      };
    },
  },
  {
    name: "disconnect_no_recovery",
    scenario: {
      name: "disconnect",
      call: { tool: "disconnect", args: {} },
      timeoutMs: 1000,
      expect: { outcome: "error" },
    },
    normalize(report) {
      return {
        observed: { outcome: "transport_error", fault: "disconnect", usable_result: false },
        recovery: null,
      };
    },
  },
  {
    name: "disconnect_with_recovery",
    scenario: {
      name: "disconnect with recovery observer",
      call: { tool: "disconnect", args: {} },
      timeoutMs: 1000,
      expect: { outcome: "error" },
      observe: {
        call: { tool: "ping", args: {} },
        timeoutMs: 1000,
        expect: { outcome: "success" },
      },
    },
    normalize(report) {
      return {
        observed: { outcome: "transport_error", fault: "disconnect", usable_result: false },
        recovery: { attempted: true, outcome: "success", tool: "ping" },
      };
    },
  },
];

mkdirSync("results", { recursive: true });
mkdirSync("tmp-scenarios", { recursive: true });

function runMcp(name, scenario) {
  const path = `tmp-scenarios/${name}.json`;
  writeFileSync(path, JSON.stringify(scenario, null, 2));

  try {
    const out = execFileSync(
      "npx",
      ["-y", `mcp-failure-lab@${packageVersion}`, "run", path, "--report", "json"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return JSON.parse(out);
  } catch (e) {
    for (const raw of [e.stdout, e.stderr, e.message].filter(Boolean).map(String)) {
      try {
        return JSON.parse(raw);
      } catch {}
    }
    return { raw: String(e.message ?? e) };
  }
}

async function askJev(name, evidence) {
  const body = {
    model,
    state: {
      source: `mcp-failure-lab@${packageVersion}`,
      scenario: name,
      evidence,
    },
    questions: {
      action: {
        type: "choice",
        instructions:
          "Based only on the observed MCP execution and recovery evidence, should the agent continue using the current tool/session?",
        criteria: {
          accept: "Safe to continue using the current result/session without another attempt.",
          retry:
            "Retry or reconnect before continuing because the current execution is unreliable or transiently failed.",
          reject:
            "Do not use the current result/session because it is malformed, contradictory, or unsafe.",
        },
      },
    },
  };

  const started = performance.now();
  const res = await fetch("https://openrouter.ai/api/alpha/decisions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const json = await res.json();
  return {
    scenario: name,
    http: res.status,
    latency_ms: Math.round(performance.now() - started),
    response: json,
  };
}

const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const outfile = `results/ab-${stamp}.jsonl`;
writeFileSync(outfile, "");

console.error(`Running ${cases.length} cases × ${runs} runs`);
console.error(`Output: ${outfile}`);

for (const test of cases) {
  for (let run = 1; run <= runs; run++) {
    const report = runMcp(test.name, test.scenario);
    const evidence = test.normalize(report);
    const result = await askJev(test.name, evidence);

    const row = {
      timestamp: new Date().toISOString(),
      run,
      scenario: test.name,
      evidence,
      ...result,
      mcp_report: report,
    };

    appendFileSync(outfile, JSON.stringify(row) + "\n");

    const a = result.response?.answers?.action;
    console.error(
      `[${test.name} ${run}/${runs}] ${a?.choice ?? "NO_CHOICE"} ` +
        `P(a/r/rj)=${a?.probabilities?.accept ?? "n/a"}/` +
        `${a?.probabilities?.retry ?? "n/a"}/` +
        `${a?.probabilities?.reject ?? "n/a"} ` +
        `conf=${a?.confidence ?? "n/a"}`,
    );
  }
}

console.error(`Done. Summarize with: node summarize.mjs ${outfile}`);
