import { isIP } from "node:net";

export function isWildcardHost(host: string): boolean {
  if (isIP(host) === 6) {
    return new URL(`http://[${host}]`).hostname === "[::]";
  }

  try {
    return new URL(`http://${host}`).hostname === "0.0.0.0";
  } catch {
    return false;
  }
}

export function isCanonicalHttpPath(path: string): boolean {
  try {
    return new URL(`http://localhost${path}`).pathname === path;
  } catch {
    return false;
  }
}
