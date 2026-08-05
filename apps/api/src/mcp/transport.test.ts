import { describe, expect, it } from "vitest";
import { mcpAuthUrl, mcpWwwAuthenticate, verifyOptionalMcpSession } from "./transport";

describe("MCP auth helpers", () => {
  it("builds the Better Auth base URL without a trailing slash", () => {
    expect(mcpAuthUrl("https://api.skillist.io/")).toBe("https://api.skillist.io/api/auth");
  });

  it("advertises the OAuth protected-resource metadata in WWW-Authenticate", () => {
    expect(mcpWwwAuthenticate("https://api.skillist.io")).toBe(
      'Bearer resource_metadata="https://api.skillist.io/.well-known/oauth-protected-resource"',
    );
  });

  it("treats a missing or non-Bearer Authorization header as anonymous", async () => {
    const neverCalled = {
      verifyToken: () => {
        throw new Error("must not be called");
      },
    } as never;
    expect(await verifyOptionalMcpSession(neverCalled, undefined)).toBeNull();
    expect(await verifyOptionalMcpSession(neverCalled, "Basic abc")).toBeNull();
  });
});
