import { readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2];
if (!file) throw new Error("Usage: node summarize.mjs results/<file>.jsonl");

const rows = readFileSync(file, "utf8").split("\n").filter(Boolean).map(JSON.parse);
const groups = new Map();

for (const row of rows) {
  const a = row.response?.answers?.action;
  if (!a) continue;
  const p = a.probabilities ?? {};
  const g = groups.get(row.scenario) ?? {
    scenario: row.scenario,
    runs: 0,
    accept_choices: 0,
    retry_choices: 0,
    reject_choices: 0,
    p_accept: 0,
    p_retry: 0,
    p_reject: 0,
    confidence: 0,
    latency: 0,
    cost: 0,
  };

  g.runs++;
  if (a.choice === "accept") g.accept_choices++;
  if (a.choice === "retry") g.retry_choices++;
  if (a.choice === "reject") g.reject_choices++;
  g.p_accept += p.accept ?? 0;
  g.p_retry += p.retry ?? 0;
  g.p_reject += p.reject ?? 0;
  g.confidence += a.confidence ?? 0;
  g.latency += row.latency_ms ?? 0;
  g.cost += row.response?.usage?.cost ?? 0;
  groups.set(row.scenario, g);
}

const summary = [...groups.values()].map((g) => ({
  scenario: g.scenario,
  runs: g.runs,
  accept_choices: g.accept_choices,
  retry_choices: g.retry_choices,
  reject_choices: g.reject_choices,
  avg_p_accept: +(g.p_accept / g.runs).toFixed(3),
  avg_p_retry: +(g.p_retry / g.runs).toFixed(3),
  avg_p_reject: +(g.p_reject / g.runs).toFixed(3),
  avg_confidence: +(g.confidence / g.runs).toFixed(3),
  avg_latency_ms: Math.round(g.latency / g.runs),
  total_cost: +g.cost.toFixed(8),
}));

console.table(summary);

const byName = Object.fromEntries(summary.map((x) => [x.scenario, x]));
const deltas = [];
for (const [label, a, b] of [
  ["duplicate recovery effect", "duplicate_no_recovery", "duplicate_with_recovery"],
  ["disconnect recovery effect", "disconnect_no_recovery", "disconnect_with_recovery"],
]) {
  if (byName[a] && byName[b]) {
    deltas.push({
      comparison: label,
      delta_accept_probability: +(byName[b].avg_p_accept - byName[a].avg_p_accept).toFixed(3),
      delta_retry_probability: +(byName[b].avg_p_retry - byName[a].avg_p_retry).toFixed(3),
      delta_confidence: +(byName[b].avg_confidence - byName[a].avg_confidence).toFixed(3),
    });
  }
}

console.log("\nRecovery deltas");
console.table(deltas);

const out = file.replace(/\.jsonl$/, ".summary.json");
writeFileSync(out, JSON.stringify({ summary, deltas }, null, 2) + "\n");
console.error(`Wrote ${out}`);
