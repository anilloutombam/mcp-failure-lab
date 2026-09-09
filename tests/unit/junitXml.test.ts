import { describe, expect, it } from "vitest";

import type { JUnitScenarioReport } from "../../src/junitReport.js";
import { escapeXml, escapeXmlAttribute, serializeJUnitReport } from "../../src/junitXml.js";

function report(overrides: Partial<JUnitScenarioReport> = {}): JUnitScenarioReport {
  return {
    name: "example scenario",
    durationMs: 12,
    testCases: [
      {
        name: "example scenario",
        source: "primary",
        durationMs: 12,
        outcome: { status: "passed" },
        diagnostics: [],
      },
    ],
    ...overrides,
  };
}

describe("JUnit XML serialization", () => {
  it("serializes a passing report", () => {
    expect(serializeJUnitReport(report())).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<testsuite name="example scenario" tests="1" failures="0" errors="0" time="0.012000">',
        '  <testcase name="example scenario" classname="mcp-failure-lab.primary" time="0.012000"/>',
        "</testsuite>",
      ].join("\n"),
    );
  });

  it("serializes assertion failures as failure elements", () => {
    const xml = serializeJUnitReport(
      report({
        testCases: [
          {
            name: "failed scenario",
            source: "primary",
            durationMs: 5,
            outcome: { status: "failed", failures: ["expected success", "received timeout"] },
            diagnostics: ["expected success", "received timeout"],
          },
        ],
      }),
    );

    expect(xml).toContain('tests="1" failures="1" errors="0"');
    expect(xml).toContain(
      '<failure message="expected success">expected success\nreceived timeout</failure>',
    );
    expect(xml).toContain("<system-out>expected success\nreceived timeout</system-out>");
  });

  it("serializes execution errors as error elements", () => {
    const xml = serializeJUnitReport(
      report({
        testCases: [
          {
            name: "errored scenario",
            source: "execution",
            durationMs: 3,
            outcome: { status: "errored", message: "connection closed" },
            diagnostics: [],
          },
        ],
      }),
    );

    expect(xml).toContain('tests="1" failures="0" errors="1"');
    expect(xml).toContain('<error message="connection closed">connection closed</error>');
    expect(xml).toContain('classname="mcp-failure-lab.execution"');
  });

  it("preserves observer identity and duration", () => {
    const xml = serializeJUnitReport(
      report({
        durationMs: 16,
        testCases: [
          {
            name: "example scenario",
            source: "primary",
            durationMs: 12,
            outcome: { status: "passed" },
            diagnostics: [],
          },
          {
            name: "example scenario (observer)",
            source: "observer",
            durationMs: 4,
            outcome: { status: "passed" },
            diagnostics: [],
          },
        ],
      }),
    );

    expect(xml).toContain('tests="2" failures="0" errors="0" time="0.016000"');
    expect(xml).toContain(
      'name="example scenario (observer)" classname="mcp-failure-lab.observer" time="0.004000"',
    );
  });

  it("escapes XML-sensitive content and replaces invalid characters", () => {
    expect(escapeXml(`<&>"'\u0000🚀`)).toBe("&lt;&amp;&gt;&quot;&apos;�🚀");
    expect(escapeXmlAttribute("first\nsecond\t\r")).toBe("first&#xA;second&#x9;&#xD;");

    const xml = serializeJUnitReport(
      report({
        name: `scenario <&>"'\nnext`,
        testCases: [
          {
            name: `case <&>"'`,
            source: "primary",
            durationMs: 1,
            outcome: { status: "failed", failures: [`failure <&>"'\nnext`] },
            diagnostics: [],
          },
        ],
      }),
    );

    expect(xml).toContain('name="scenario &lt;&amp;&gt;&quot;&apos;&#xA;next"');
    expect(xml).toContain('name="case &lt;&amp;&gt;&quot;&apos;"');
    expect(xml).toContain(
      '<failure message="failure &lt;&amp;&gt;&quot;&apos;&#xA;next">failure &lt;&amp;&gt;&quot;&apos;\nnext</failure>',
    );
  });
});
