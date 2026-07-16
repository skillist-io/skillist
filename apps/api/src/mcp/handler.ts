import type { Context } from "hono";
import type { Env } from "../env";
import { createWorkerDb } from "../lib/db";
import { handleMcpJsonRpc, mcpServerInfo } from "./registry-server";

export async function handleMcpRequest(c: Context<{ Bindings: Env }>) {
  if (c.req.method === "GET") {
    return c.json(mcpServerInfo());
  }

  if (c.req.method !== "POST") {
    return c.json({ error: "Method not allowed" }, 405);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      {
        jsonrpc: "2.0",
        error: { code: -32700, message: "Parse error" },
        id: null,
      },
      400,
    );
  }

  const db = createWorkerDb(c.env);
  const response = await handleMcpJsonRpc(db, body);

  if (Array.isArray(response)) {
    return c.json(response);
  }
  return c.json(response);
}
