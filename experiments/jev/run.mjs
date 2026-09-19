import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";

const key = process.env.OPENROUTER_API_KEY;
if (!key) throw new Error("Set OPENROUTER_API_KEY");

const runs = Math.max(1, Number.parseInt(process.env.RUNS ?? "20", 10));
const model = "typesafe/jev-1.13";
const packageVersion = "0.10.0";

function assertEvidence(condition, message) {
  if (!condition) throw new Error(`MCP evidence validation failed: ${message}`);
}

function validateReport(report, { name, outcome }) {
  assertEvidence(report && typeof report === "object", `${name}: report is missing`);
  assertEvidence(report.name === name, `${name}: unexpected report name`);
  assertEvidence(report.outcome === outcome, `${name}: expected ${outcome}, got ${report.outcome}`);
  assertEvidence(report.passed === true, `${name}: scenario assertions did not pass`);
  assertEvidence(
    Array.isArray(report.failures) && report.failures.length === 0,
    `${name}: scenario reported failures`,
  );
}

function resultText(report) {
  return report.result?.content?.find((item) => item.type === "text")?.text;
}

function parseSuccessfulPing(report, name) {
  const text = resultText(report);
  assertEvidence(typeof text === "string", `${name}: ping result text is missing`);
  let ping;
  try {
    ping = JSON.parse(text);
  } catch {
    throw new Error(`MCP evidence validation failed: ${name}: ping result is not valid JSON`);
  }
  assertEvidence(ping.status === "ok", `${name}: ping status is not ok`);
}

function validateRecovery(report, name) {
  const observer = report.observer;
  assertEvidence(observer && typeof observer === "object", `${name}: recovery observer is missing`);
  assertEvidence(observer.outcome === "success", `${name}: recovery observer did not succeed`);
  assertEvidence(observer.passed === true, `${name}: recovery assertions did not pass`);
  assertEvidence(
    Array.isArray(observer.failures) && observer.failures.length === 0,
    `${name}: recovery observer reported failures`,
  );
  parseSuccessfulPing(observer, `${name} recovery`);
}

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
      validateReport(report, { name: "clean ping", outcome: "success" });
      parseSuccessfulPing(report, "clean ping");
      return {
        observed: { outcome: report.outcome, fault: null },
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
      validateReport(report, { name: "hang timeout", outcome: "timeout" });
      return {
        observed: { outcome: report.outcome, fault: "hang", usable_result: false },
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
      validateReport(report, { name: "duplicate response", outcome: "success" });
      assertEvidence(
        resultText(report) === "duplicate response activated",
        "duplicate response: activation result is missing",
      );
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
      const name = "duplicate response with recovery observer";
      validateReport(report, { name, outcome: "success" });
      assertEvidence(
        resultText(report) === "duplicate response activated",
        `${name}: activation result is missing`,
      );
      validateRecovery(report, name);
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
      validateReport(report, { name: "disconnect", outcome: "error" });
      assertEvidence(
        typeof report.error === "string" && report.error.length > 0,
        "disconnect: transport error is missing",
      );
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
      const name = "disconnect with recovery observer";
      validateReport(report, { name, outcome: "error" });
      assertEvidence(
        typeof report.error === "string" && report.error.length > 0,
        `${name}: transport error is missing`,
      );
      validateRecovery(report, name);
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
    throw new Error(`MCP Failure Lab did not return a JSON report for ${name}`, { cause: e });
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
  if (!res.ok) throw new Error(`Jev request for ${name} failed with HTTP ${res.status}`);
  assertEvidence(
    json.answers?.action?.type === "choice",
    `${name}: Jev response does not contain an action choice`,
  );
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
