import { DurableObject } from "cloudflare:workers";
import type { SkillPublishedEvent } from "@skillist/contracts";

type SseConnection = {
  writer: WritableStreamDefaultWriter<Uint8Array>;
  interval: ReturnType<typeof setInterval>;
};

export class SkillRealtimeHub extends DurableObject {
  // SSE writers live only in memory. A live stream writer and its keepalive
  // timer cannot be serialized into DO storage (the previous implementation
  // did exactly that, so SSE clients never received events and writers leaked).
  // An open SSE response keeps this DO awake, so an in-memory map is the correct
  // home for these connections. WebSocket clients are tracked separately by the
  // hibernation API via getWebSockets().
  private sseConnections = new Map<string, SseConnection>();
  private encoder = new TextEncoder();

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/broadcast" && request.method === "POST") {
      const event = (await request.json()) as SkillPublishedEvent;
      await this.broadcast(event);
      return Response.json({ ok: true });
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
      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
      const writer = writable.getWriter();
      const id = crypto.randomUUID();

      await writer.write(
        this.encoder.encode(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`),
      );

      const interval = setInterval(() => {
        // A failed keepalive write means the client hung up — reap the
        // connection so we neither leak the timer nor try to broadcast to it.
        writer.write(this.encoder.encode(": ping\n\n")).catch(() => this.removeSse(id));
      }, 15000);

      this.sseConnections.set(id, { writer, interval });

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

  private removeSse(id: string): void {
    const conn = this.sseConnections.get(id);
    if (!conn) return;
    this.sseConnections.delete(id);
    clearInterval(conn.interval);
    conn.writer.close().catch(() => {});
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message === "string" && message === "ping") {
      ws.send(JSON.stringify({ type: "pong" }));
    }
  }

  async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean) {
    ws.close();
  }

  private async broadcast(event: SkillPublishedEvent): Promise<void> {
    const payload = JSON.stringify(event);

    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(payload);
      } catch {
        // ignore dead sockets
      }
    }

    const frame = this.encoder.encode(`event: skill.published\ndata: ${payload}\n\n`);
    await Promise.all(
      [...this.sseConnections.entries()].map(([id, conn]) =>
        conn.writer.write(frame).catch(() => this.removeSse(id)),
      ),
    );
  }
}
