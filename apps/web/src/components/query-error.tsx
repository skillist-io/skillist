import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type QueryErrorProps = {
  title?: string;
  message?: string;
  onRetry?: () => void;
};

export function QueryError({
  title = "Could not load data",
  message = "We couldn't reach the Skillist API. Check your connection and try again.",
  onRetry,
}: QueryErrorProps) {
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div className="space-y-2">
          <div>
            <p className="font-medium">{title}</p>
            <p className="text-sm text-muted-foreground">{message}</p>
          </div>
          {onRetry ? (
            <Button type="button" size="sm" variant="outline" onClick={onRetry}>
              <RefreshCw className="size-3.5" />
              Retry
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
