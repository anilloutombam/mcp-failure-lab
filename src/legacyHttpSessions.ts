import { randomUUID } from "node:crypto";

import {
  WebStandardStreamableHTTPServerTransport,
  type McpServer,
} from "@modelcontextprotocol/server";

import {
  RequestScopedDuplicateResponseFaults,
  type DuplicateResponseFaults,
} from "./duplicateResponse.js";
import { applyMalformedMessageResponse } from "./malformedMessageHttp.js";
import {
  RequestScopedMalformedMessageFaults,
  type MalformedMessageFaults,
} from "./malformedMessage.js";
import { createServer } from "./server.js";
import type { SessionLossActivation, SessionLossController } from "./sessionLoss.js";

export const MAX_HTTP_SESSIONS = 128;

interface LegacySession {
  transport: WebStandardStreamableHTTPServerTransport;
  server: McpServer;
  malformedMessage: MalformedMessageFaults;
  duplicateResponse: DuplicateResponseFaults;
  interruptActiveResponse: () => void;
  loss?: SessionLossActivation;
  closed: boolean;
}

export class LegacyHttpSessions {
  private readonly sessions = new Map<string, LegacySession>();
  private readonly active = new Set<LegacySession>();
  private closed = false;

  constructor(private readonly maxSessions = MAX_HTTP_SESSIONS) {}

  async fetch(
    request: Request,
    interruptActiveResponse: () => void = () => undefined,
  ): Promise<Response> {
    if (this.closed) return sessionError(503, -32603, "Server shutting down");

    const sessionId = request.headers.get("mcp-session-id");
    if (sessionId !== null) {
      const session = this.sessions.get(sessionId);
      if (session === undefined) return sessionError(404, -32001, "Session not found");
      session.interruptActiveResponse = interruptActiveResponse;
      return this.handle(session, request);
    }
    if (this.active.size >= this.maxSessions) {
      return sessionError(503, -32603, "Too many active sessions");
    }

    let session!: LegacySession;
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      onsessioninitialized: (id) => {
        this.sessions.set(id, session);
      },
      onsessionclosed: (id) => {
        this.sessions.delete(id);
      },
    });
    const malformedMessage = new RequestScopedMalformedMessageFaults();
    const duplicateResponse = new RequestScopedDuplicateResponseFaults();
    const controller: SessionLossController = {
      lose: async (activation) => {
        if (session.loss !== undefined) throw new Error("Session loss is already active");
        session.loss = activation;
        const id = transport.sessionId;
        if (id !== undefined) this.sessions.delete(id);
        if (activation === "during_request") session.interruptActiveResponse();
      },
    };
    const server = createServer({
      disconnect: async () => {
        session.interruptActiveResponse();
      },
      malformedMessageFaults: malformedMessage,
      duplicateResponseFaults: duplicateResponse,
      sessionLoss: controller,
    });
    session = {
      transport,
      server,
      malformedMessage,
      duplicateResponse,
      interruptActiveResponse,
      closed: false,
    };
    this.active.add(session);
    try {
      await server.connect(transport);
    } catch (error) {
      await this.closeSession(session);
      throw error;
    }

    const response = await this.handle(session, request);
    if (transport.sessionId === undefined) await this.closeSession(session);
    return response;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const sessions = [...this.active];
    this.sessions.clear();
    await Promise.all(sessions.map((session) => this.closeSession(session)));
  }

  private async handle(session: LegacySession, request: Request): Promise<Response> {
    const response = await session.transport.handleRequest(request);
    const transformed = await applyMalformedMessageResponse(
      response,
      session.malformedMessage,
      session.duplicateResponse,
    );
    if (request.method.toUpperCase() === "DELETE") {
      await this.closeSession(session);
      return transformed;
    }
    if (transformed.body === null) {
      if (session.loss !== undefined) await this.closeSession(session);
      return transformed;
    }
    return this.closeAfterLoss(transformed, session);
  }

  private closeAfterLoss(response: Response, session: LegacySession): Response {
    const reader = response.body!.getReader();
    const body = new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        try {
          const { done, value } = await reader.read();
          if (!done) {
            controller.enqueue(value);
            return;
          }
          if (session.loss !== undefined) await this.closeSession(session);
          controller.close();
        } catch (error) {
          await this.closeSession(session);
          controller.error(error);
        }
      },
      cancel: async (reason) => {
        await reader.cancel(reason).catch(() => undefined);
        if (session.loss !== undefined) await this.closeSession(session);
      },
    });
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  private async closeSession(session: LegacySession): Promise<void> {
    if (session.closed) return;
    session.closed = true;
    this.active.delete(session);
    const id = session.transport.sessionId;
    if (id !== undefined) this.sessions.delete(id);
    session.malformedMessage.clear();
    session.duplicateResponse.clear();
    await session.server.close();
  }
}

function sessionError(status: number, code: number, message: string): Response {
  return Response.json({ jsonrpc: "2.0", error: { code, message }, id: null }, { status });
}
