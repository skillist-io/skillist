import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("skillist api", () => {
  it("health check", async () => {
    const res = await SELF.fetch("http://localhost/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: "ok", service: "skillist-api" });
  });

  it("openapi spec", async () => {
    const res = await SELF.fetch("http://localhost/openapi.json");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      openapi?: string;
      info?: { title?: string };
    };
    expect(body.openapi).toBe("3.1.0");
    expect(body.info?.title).toBe("Skillist API");
  });
});
