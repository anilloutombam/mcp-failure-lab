import { open } from "node:fs/promises";

export const MAX_CONFIG_FILE_BYTES = 1024 * 1024;

export async function readBoundedTextFile(
  path: string,
  maxBytes: number = MAX_CONFIG_FILE_BYTES,
): Promise<string> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.allocUnsafe(maxBytes + 1);
    let bytesRead = 0;

    while (bytesRead < buffer.length) {
      const result = await handle.read(buffer, bytesRead, buffer.length - bytesRead, null);
      if (result.bytesRead === 0) break;
      bytesRead += result.bytesRead;
    }

    if (bytesRead > maxBytes) {
      throw new RangeError(`file exceeds the ${maxBytes}-byte limit`);
    }

    return buffer.toString("utf8", 0, bytesRead);
  } finally {
    await handle.close();
  }
}
