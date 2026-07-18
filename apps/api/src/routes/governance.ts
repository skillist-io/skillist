import { OpenAPIHono } from "@hono/zod-openapi";
import { evalsRoutes } from "./governance/evals";
import { inventoryRoutes } from "./governance/inventory";
import { mcpServersRoutes } from "./governance/mcp-servers";
import { observabilityRoutes } from "./governance/observability";
import { policiesRoutes } from "./governance/policies";
import type { AppEnv } from "./governance/shared";

export const governanceRoutes = new OpenAPIHono<AppEnv>();

governanceRoutes.route("/", observabilityRoutes);
governanceRoutes.route("/", policiesRoutes);
governanceRoutes.route("/", evalsRoutes);
governanceRoutes.route("/", inventoryRoutes);
governanceRoutes.route("/", mcpServersRoutes);
