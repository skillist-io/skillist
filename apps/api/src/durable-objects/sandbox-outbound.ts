import { WorkerEntrypoint } from "cloudflare:workers";
import type { Env } from "../env";
import { isOutboundAllowed } from "../lib/sandbox-egress";

export type OutboundProps = { allowedHosts: string[] };

/**
 * Every HTTP and HTTPS request a skill container makes lands here.
 *
 * The name is load-bearing: the sandbox finds this through `ctx.exports.Outbound`,
 * so src/index.ts must export it under exactly this name.
 */
export class Outbound extends WorkerEntrypoint<Env, OutboundProps> {
  async fetch(request: Request): Promise<Response> {
    const { hostname } = new URL(request.url);
    if (!isOutboundAllowed(hostname, this.ctx.props.allowedHosts ?? [])) {
      return new Response("Origin is disallowed", { status: 520 });
    }

    // Not followed here on purpose. A redirect followed by this fetch would reach
    // its target without a policy check, so an allowed host could bounce a skill
    // to a blocked one. Handing the 3xx back makes the skill's next request come
    // through this check.
    return fetch(new Request(request, { redirect: "manual" }));
  }
}
