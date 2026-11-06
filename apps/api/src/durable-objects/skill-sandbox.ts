import { DurableObject } from "cloudflare:workers";
import { Files } from "@cloudflare/sandbox";
import type { Env } from "../env";
import { MAX_OUTPUT_CHARS } from "../lib/skill-runtime";
import type { OutboundProps } from "./sandbox-outbound";

/** A leaked container stops on its own. Longer than the slowest allowed run. */
const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000;

// The HTTPS intercept re-signs traffic with a per-container certificate. curl and
// Git read the system bundle; Node.js and Python `requests` need pointing at it.
const CA = "/etc/cloudflare/certs/cloudflare-containers-ca.crt";
const BUNDLE = "/etc/ssl/certs/ca-certificates.crt";
const TRUST_CA = [
  "sh",
  "-c",
  `timeout 10 sh -c 'until [ -s ${CA} ]; do sleep 0.1; done' && cat ${CA} >>${BUNDLE}`,
];

// Added to what commands already see, which is PATH, image ENV lines and non-secret
// CLOUDFLARE_* metadata. A skill can read all of it, so never put a secret here.
const BASE_ENV = {
  HOME: "/root",
  NODE_EXTRA_CA_CERTS: CA,
  REQUESTS_CA_BUNDLE: BUNDLE,
};

export type SandboxOutputStream = "stdout" | "stderr";

export type SandboxRunInput = {
  /** Shell command line, already quoted. */
  command: string;
  cwd: string;
  timeoutMs: number;
  env?: Record<string, string>;
  onOutput?: (stream: SandboxOutputStream, chunk: string) => void | Promise<void>;
};

export type SandboxRunResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
};

/**
 * Runs one untrusted skill script in a container with deny-by-default egress.
 *
 * Two layers enforce that. `enableInternet: false` blocks everything, and the
 * intercepts then route ports 80 and 443 through the `Outbound` entrypoint, which
 * lets allowed hosts out. Both are in place before any skill code can run: if
 * setup fails, the container is destroyed and the run stops, so a run can never
 * fall back to wider access than it was given. DNS stays open, as it does for every
 * container, so lookups are a possible exfiltration channel this can't close.
 *
 * One instance serves one run, so nothing carries between tenants.
 */
export abstract class SkillSandbox extends DurableObject<Env> {
  protected abstract readonly instance: "basic" | "standard-1";

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const container = ctx.container;
    // The inactivity timeout doesn't survive a Durable Object restart.
    if (container?.running) {
      void ctx.blockConcurrencyWhile(() => container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS));
    }
  }

  private get container(): Container {
    const container = this.ctx.container;
    if (!container) throw new Error("No container is configured");
    return container;
  }

  private get files() {
    return new Files(this.container);
  }

  /** Intercepts last until the container stops, so one registration covers the run. */
  private async intercept(allowedHosts: string[]): Promise<void> {
    const exports = this.ctx.exports as unknown as {
      Outbound(options: { props: OutboundProps }): Fetcher;
    };
    const outbound = exports.Outbound({ props: { allowedHosts } });
    await this.container.interceptAllOutboundHttp(outbound);
    await this.container.interceptOutboundHttps("*", outbound);
  }

  /** Start the container. Must finish before anything else is called. */
  async start(allowedHosts: string[]): Promise<void> {
    if (this.container.running) throw new Error("Sandbox is already running");

    this.container.start({
      image: this.container.images.sandbox,
      instance: this.instance,
      enableInternet: false,
    });

    try {
      await this.intercept(allowedHosts);
      const trust = await this.container.exec(TRUST_CA);
      if ((await trust.exitCode) !== 0) {
        throw new Error("The container did not trust the intercept CA");
      }
      await this.container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);
    } catch (error) {
      await this.container.destroy();
      throw error;
    }
  }

  async mkdir(path: string): Promise<void> {
    await this.files.mkdir(path, { recursive: true });
  }

  async writeFile(path: string, content: string): Promise<void> {
    await this.files.writeFile(path, content);
  }

  async makeExecutable(path: string): Promise<void> {
    const chmod = await this.container.exec(["chmod", "+x", path]);
    if ((await chmod.exitCode) !== 0) throw new Error(`Could not chmod ${path}`);
  }

  async run(input: SandboxRunInput): Promise<SandboxRunResult> {
    const seconds = Math.ceil(input.timeoutMs / 1000);
    const started = Date.now();
    // GNU timeout kills the script's whole process group, so a deadline really
    // stops the work. --kill-after covers scripts that ignore SIGTERM.
    const process = await this.container.exec(
      ["timeout", "--kill-after=5", String(seconds), "bash", "-c", input.command],
      { cwd: input.cwd, env: { ...BASE_ENV, ...input.env } },
    );

    // One budget across both streams. Past it the pipes are still drained, because
    // a script blocked on a full pipe would otherwise sit there until the deadline.
    let captured = 0;
    let truncated = false;
    const read = async (stream: SandboxOutputStream, body: ReadableStream | null) => {
      if (!body) return "";
      const decoder = new TextDecoder();
      const kept: string[] = [];
      for await (const bytes of body) {
        if (captured >= MAX_OUTPUT_CHARS) continue;
        const text = decoder.decode(bytes as Uint8Array, { stream: true });
        const slice = text.slice(0, MAX_OUTPUT_CHARS - captured);
        captured += slice.length;
        kept.push(slice);
        await input.onOutput?.(stream, slice);
        if (captured >= MAX_OUTPUT_CHARS && !truncated) {
          truncated = true;
          await input.onOutput?.(stream, "\n…[output truncated — limit reached]");
        }
      }
      return kept.join("");
    };

    const [stdout, stderr, exitCode] = await Promise.all([
      read("stdout", process.stdout),
      read("stderr", process.stderr),
      process.exitCode,
    ]);
    const durationMs = Date.now() - started;

    // 124 is timeout's own code. 137 is SIGKILL, which can also be the kernel's
    // OOM killer, so it only counts once the deadline has passed.
    const timedOut = exitCode === 124 || (exitCode === 137 && durationMs >= seconds * 1000);
    return { stdout, stderr, exitCode, durationMs, timedOut };
  }

  /**
   * Stops the container and everything in it. This is also how a run is cancelled:
   * the in-flight `run` then resolves with exit code 137.
   */
  async destroy(): Promise<void> {
    await this.container.destroy();
  }
}
