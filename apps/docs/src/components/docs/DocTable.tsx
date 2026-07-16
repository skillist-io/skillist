import type { ReactNode } from "react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function DocTable({ columns, rows }: { columns: string[]; rows: ReactNode[][] }) {
  return (
    <div className="not-content my-6">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column}>{column}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.map((cell) => String(cell)).join("|")}>
              {row.map((cell, cellIndex) => (
                <TableCell key={`${columns[cellIndex]}-${String(cell)}`}>{cell}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
