import { AsyncLocalStorage } from "node:async_hooks";
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
export const HTTP_SESSION_IDLE_TIMEOUT_MS = 5 * 60_000;

interface RequestContext {
  interruptResponse: () => void;
}

interface LegacySession {
  transport: WebStandardStreamableHTTPServerTransport;
  server: McpServer;
  malformedMessage: MalformedMessageFaults;
  duplicateResponse: DuplicateResponseFaults;
  loss?: SessionLossActivation;
  lastActivity: number;
  activeRequests: number;
  closed: boolean;
}

export class LegacyHttpSessions {
  private readonly sessions = new Map<string, LegacySession>();
  private readonly active = new Set<LegacySession>();
  private readonly requestContext = new AsyncLocalStorage<RequestContext>();
  private closed = false;

  constructor(
    private readonly maxSessions = MAX_HTTP_SESSIONS,
    private readonly idleTimeoutMs = HTTP_SESSION_IDLE_TIMEOUT_MS,
    private readonly now: () => number = Date.now,
  ) {}

  async fetch(
    request: Request,
    interruptActiveResponse: () => void = () => undefined,
  ): Promise<Response> {
    if (this.closed) return sessionError(503, -32603, "Server shutting down");

    const sessionId = request.headers.get("mcp-session-id");
    if (sessionId !== null) {
      const session = this.sessions.get(sessionId);
      if (session === undefined) return sessionError(404, -32001, "Session not found");
      return this.handle(session, request, interruptActiveResponse);
    }
    await this.reclaimIdleSessions();
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
        if (activation === "during_request") {
          const context = this.requestContext.getStore();
          if (context === undefined) throw new Error("Session loss requires an active request");
          context.interruptResponse();
        }
      },
    };
    const server = createServer({
      disconnect: async () => {
        this.requestContext.getStore()?.interruptResponse();
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
      lastActivity: this.now(),
      activeRequests: 0,
      closed: false,
    };
    this.active.add(session);
    try {
      await server.connect(transport);
    } catch (error) {
      await this.closeSession(session);
      throw error;
    }

    const response = await this.handle(session, request, interruptActiveResponse);
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

  private async handle(
    session: LegacySession,
    request: Request,
    interruptResponse: () => void,
  ): Promise<Response> {
    session.activeRequests += 1;
    session.lastActivity = this.now();
    let transformed: Response;
    try {
      const response = await this.requestContext.run({ interruptResponse }, () =>
        session.transport.handleRequest(request),
      );
      transformed = await applyMalformedMessageResponse(
        response,
        session.malformedMessage,
        session.duplicateResponse,
      );
    } catch (error) {
      this.finishRequest(session);
      throw error;
    }
    if (request.method.toUpperCase() === "DELETE") {
      this.finishRequest(session);
      await this.closeSession(session);
      return transformed;
    }
    if (transformed.body === null) {
      this.finishRequest(session);
      if (session.loss !== undefined) await this.closeSession(session);
      return transformed;
    }
    return this.closeAfterLoss(transformed, session);
  }

  private closeAfterLoss(response: Response, session: LegacySession): Response {
    const reader = response.body!.getReader();
    let finished = false;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      this.finishRequest(session);
    };
    const body = new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        try {
          const { done, value } = await reader.read();
          if (!done) {
            controller.enqueue(value);
            return;
          }
          finish();
          if (session.loss !== undefined) await this.closeSession(session);
          controller.close();
        } catch (error) {
          finish();
          await this.closeSession(session);
          controller.error(error);
        }
      },
      cancel: async (reason) => {
        await reader.cancel(reason).catch(() => undefined);
        finish();
        if (session.loss !== undefined) await this.closeSession(session);
      },
    });
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  private finishRequest(session: LegacySession): void {
    session.activeRequests = Math.max(0, session.activeRequests - 1);
    session.lastActivity = this.now();
  }

  private async reclaimIdleSessions(): Promise<void> {
    const cutoff = this.now() - this.idleTimeoutMs;
    const idle = [...this.active].filter(
      (session) => session.activeRequests === 0 && session.lastActivity <= cutoff,
    );
    await Promise.all(idle.map((session) => this.closeSession(session)));
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
