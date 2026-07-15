import { DurableObject } from "cloudflare:workers";
import type { SkillPublishedEvent } from "@skillist/contracts";

type ConnectionMeta = {
  type: "websocket" | "sse";
  connectedAt: number;
};

export class SkillRealtimeHub extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/broadcast" && request.method === "POST") {
      const event = (await request.json()) as SkillPublishedEvent;
      await this.broadcast(event);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname === "/ws") {
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      if (!server) return new Response("WebSocket error", { status: 500 });
      this.ctx.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === "/sse") {
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      await writer.write(
        encoder.encode(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`),
      );

      const id = crypto.randomUUID();
      const interval = setInterval(async () => {
        try {
          await writer.write(encoder.encode(`: ping\n\n`));
        } catch {
          clearInterval(interval);
        }
      }, 15000);

      this.ctx.storage.put(`sse:${id}`, { writer, interval });

      return new Response(readable, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    return new Response("Not found", { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message === "string" && message === "ping") {
      ws.send(JSON.stringify({ type: "pong" }));
    }
  }

  async webSocketClose(
    ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ) {
    ws.close();
  }

  private async broadcast(event: SkillPublishedEvent): Promise<void> {
    const payload = JSON.stringify(event);
    const sockets = this.ctx.getWebSockets();
    for (const ws of sockets) {
      try {
        ws.send(payload);
      } catch {
        // ignore dead sockets
      }
    }

    // SSE clients receive via storage writers if any
    const keys = await this.ctx.storage.list<{ writer: WritableStreamDefaultWriter; interval: ReturnType<typeof setInterval> }>({ prefix: "sse:" });
    const encoder = new TextEncoder();
    for (const [, entry] of keys) {
      try {
        await entry.writer.write(
          encoder.encode(`event: skill.published\ndata: ${payload}\n\n`),
        );
      } catch {
        clearInterval(entry.interval);
      }
    }
  }
}
