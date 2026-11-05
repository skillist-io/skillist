import { describe, expect, it } from "vitest";
import { csvCell } from "./audit-log";

describe("csvCell", () => {
  it("quotes values and escapes quotes", () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it("neutralizes spreadsheet formulas", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe(`"'=HYPERLINK(1)"`);
    expect(csvCell("@cmd")).toBe(`"'@cmd"`);
  });
});
