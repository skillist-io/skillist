import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const endpoints = [
  { service: "Web app", url: "https://skillist.dev" },
  { service: "Registry browse", url: "https://skillist.dev/registry" },
  { service: "Skill page", url: "https://skillist.dev/{org}/{repo}" },
  { service: "SKILL.md delivery", url: "https://skillist.dev/{org}/{repo}/SKILL.md" },
  { service: "API", url: "https://api.skillist.dev" },
  { service: "Registry MCP", url: "https://api.skillist.dev/mcp" },
  { service: "API reference", url: "https://api.skillist.dev/docs" },
]

export function EndpointsTable() {
  return (
    <div className="not-content">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Service</TableHead>
            <TableHead>URL</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {endpoints.map((endpoint) => (
            <TableRow key={endpoint.service}>
              <TableCell className="font-medium">{endpoint.service}</TableCell>
              <TableCell>
                {endpoint.url.startsWith("https://") &&
                !endpoint.url.includes("{") ? (
                  <a
                    href={endpoint.url}
                    className="font-mono text-xs text-primary underline-offset-4 hover:underline"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {endpoint.url.replace("https://", "")}
                  </a>
                ) : (
                  <span className="font-mono text-xs text-muted-foreground">
                    {endpoint.url.replace("https://", "")}
                  </span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
