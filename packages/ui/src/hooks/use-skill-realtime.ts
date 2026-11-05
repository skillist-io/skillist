import type { SkillPublishedEvent } from "@skillist/contracts";
import { useEffect, useRef, useState } from "react";
import { clientFetchBase } from "../lib/client-api-base";

export function useSkillRealtime(org: string, repo: string) {
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<SkillPublishedEvent | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!org || !repo) return;

    // Same origin as every other API call. The CSP allows this host's sockets
    // but not the API host's, so a cross-origin URL here is refused in the
    // browser and the page sits on "disconnected" with no server error.
    const base = clientFetchBase().replace(/^http/, "ws");
    const wsUrl = `${base}/v1/realtime/skills/${org}/${repo}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);
    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as SkillPublishedEvent;
        if (data.type === "skill.published") {
          setLastEvent(data);
        }
      } catch {
        // ignore
      }
    };

    const ping = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send("ping");
    }, 30000);

    return () => {
      clearInterval(ping);
      ws.close();
    };
  }, [org, repo]);

  return { connected, lastEvent };
}
