import { isIP } from "node:net";

export function isWildcardHost(host: string): boolean {
  if (host === "0.0.0.0") return true;
  if (isIP(host) !== 6) return false;

  return new URL(`http://[${host}]`).hostname === "[::]";
}
