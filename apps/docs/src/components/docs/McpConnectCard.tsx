import { InstallSnippet } from "@/components/docs/InstallSnippet";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function McpConnectCard() {
  return (
    <Card className="not-content">
      <CardHeader>
        <CardTitle className="text-base">Cursor MCP config</CardTitle>
        <CardDescription>
          Add to <code className="bg-muted px-1 py-0.5 font-mono text-xs">.cursor/mcp.json</code>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <InstallSnippet command='{ "mcpServers": { "skillist-registry": { "url": "https://api.skillist.dev/mcp" } } }' />
      </CardContent>
    </Card>
  );
}
