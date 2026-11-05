"use client";

import { Tabs as TabsPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "../utils";

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root className={cn("space-y-6", className)} {...props} />;
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn("flex gap-6 overflow-x-auto border-b border-border", className)}
      {...props}
    />
  );
}

/** Ink on the active tab, as in the nav: signal violet is reserved for live state. */
function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "-mb-px shrink-0 border-b-2 border-transparent py-2 text-sm font-medium text-muted-foreground transition-colors",
        "hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        "data-[state=active]:border-foreground data-[state=active]:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content className={cn("focus-visible:outline-none", className)} {...props} />
  );
}

export { Tabs, TabsContent, TabsList, TabsTrigger };
