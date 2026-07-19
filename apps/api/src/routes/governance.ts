import { OpenAPIHono } from "@hono/zod-openapi";
import { coverageRoutes } from "./governance/coverage";
import { evalsRoutes } from "./governance/evals";
import { failurePatternsRoutes } from "./governance/failure-patterns";
import { inventoryRoutes } from "./governance/inventory";
import { mcpServersRoutes } from "./governance/mcp-servers";
import { observabilityRoutes } from "./governance/observability";
import { policiesRoutes } from "./governance/policies";
import type { AppEnv } from "./governance/shared";

export const governanceRoutes = new OpenAPIHono<AppEnv>();

governanceRoutes.route("/", observabilityRoutes);
governanceRoutes.route("/", policiesRoutes);
governanceRoutes.route("/", coverageRoutes);
governanceRoutes.route("/", failurePatternsRoutes);
governanceRoutes.route("/", evalsRoutes);
governanceRoutes.route("/", inventoryRoutes);
governanceRoutes.route("/", mcpServersRoutes);
