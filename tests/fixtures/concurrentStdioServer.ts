import { serveStdio, StdioServerTransport } from "@modelcontextprotocol/server/stdio";

import {
  DuplicateResponseTransport,
  RequestScopedDuplicateResponseFaults,
} from "../../src/duplicateResponse.js";
import {
  MalformedMessageTransport,
  RequestScopedMalformedMessageFaults,
} from "../../src/malformedMessage.js";
import { createServer } from "../../src/server.js";

const malformedMessageFaults = new RequestScopedMalformedMessageFaults();
const duplicateResponseFaults = new RequestScopedDuplicateResponseFaults();
const observedMalformedFaults = {
  activate: malformedMessageFaults.activate.bind(malformedMessageFaults),
  clear: malformedMessageFaults.clear.bind(malformedMessageFaults),
  apply: (...args: Parameters<RequestScopedMalformedMessageFaults["apply"]>) => {
    const message = malformedMessageFaults.apply(...args);
    if (message !== args[0]) {
      const requestId = args[1] ?? (args[0] as { id?: unknown }).id;
      process.stderr.write(`${JSON.stringify({ malformedResponseId: requestId })}\n`);
    }
    return message;
  },
};

serveStdio(
  () =>
    createServer({
      malformedMessageFaults: observedMalformedFaults,
      duplicateResponseFaults,
    }),
  {
    legacy: "serve",
    transport: new MalformedMessageTransport(
      new DuplicateResponseTransport(new StdioServerTransport(), duplicateResponseFaults),
      observedMalformedFaults,
    ),
  },
);
