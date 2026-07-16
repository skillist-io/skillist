import { Info } from "lucide-react";
import type { ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function DocAlert({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Alert className="not-content my-6">
      <Info />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
