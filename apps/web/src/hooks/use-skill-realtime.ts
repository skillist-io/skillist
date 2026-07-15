import { useEffect, useRef, useState } from "react";
import type { SkillPublishedEvent } from "@skillist/contracts";

const API_URL = import.meta.env.VITE_API_URL ?? "";

export function useSkillRealtime(org: string, slug: string) {
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<SkillPublishedEvent | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!org || !slug) return;

    const wsUrl = `${API_URL.replace("http", "ws")}/v1/realtime/skills/${org}/${slug}`;
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
  }, [org, slug]);

  return { connected, lastEvent };
}
