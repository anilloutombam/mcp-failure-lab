import {
  JUNIT_XML_OUTCOME_ELEMENTS,
  type JUnitScenarioReport,
  type JUnitTestCaseReport,
} from "./junitReport.js";

function validXmlCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0);
  return (
    codePoint === 0x09 ||
    codePoint === 0x0a ||
    codePoint === 0x0d ||
    (codePoint !== undefined && codePoint >= 0x20 && codePoint <= 0xd7ff) ||
    (codePoint !== undefined && codePoint >= 0xe000 && codePoint <= 0xfffd) ||
    (codePoint !== undefined && codePoint >= 0x10000 && codePoint <= 0x10ffff)
  );
}

export function escapeXml(value: string): string {
  return Array.from(value, (character) => (validXmlCharacter(character) ? character : "�"))
    .join("")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function seconds(durationMs: number): string {
  return (durationMs / 1000).toFixed(6);
}

function outcomeElement(testCase: JUnitTestCaseReport): string | undefined {
  const { outcome } = testCase;
  if (outcome.status === "passed") return undefined;

  const element = JUNIT_XML_OUTCOME_ELEMENTS[outcome.status];
  const messages = outcome.status === "failed" ? outcome.failures : [outcome.message];
  const message = messages[0] ?? "scenario failed";
  return `    <${element} message="${escapeXml(message)}">${escapeXml(messages.join("\n"))}</${element}>`;
}

function serializeTestCase(testCase: JUnitTestCaseReport): string {
  const children = [
    outcomeElement(testCase),
    testCase.diagnostics.length === 0
      ? undefined
      : `    <system-out>${escapeXml(testCase.diagnostics.join("\n"))}</system-out>`,
  ].filter((child): child is string => child !== undefined);
  const attributes =
    `name="${escapeXml(testCase.name)}" ` +
    `classname="mcp-failure-lab.${testCase.source}" ` +
    `time="${seconds(testCase.durationMs)}"`;

  if (children.length === 0) return `  <testcase ${attributes}/>`;
  return [`  <testcase ${attributes}>`, ...children, "  </testcase>"].join("\n");
}

export function serializeJUnitReport(report: JUnitScenarioReport): string {
  const failures = report.testCases.filter(
    (testCase) => testCase.outcome.status === "failed",
  ).length;
  const errors = report.testCases.filter(
    (testCase) => testCase.outcome.status === "errored",
  ).length;
  const attributes =
    `name="${escapeXml(report.name)}" ` +
    `tests="${report.testCases.length}" ` +
    `failures="${failures}" ` +
    `errors="${errors}" ` +
    `time="${seconds(report.durationMs)}"`;

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuite ${attributes}>`,
    ...report.testCases.map(serializeTestCase),
    "</testsuite>",
  ].join("\n");
}
