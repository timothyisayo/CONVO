import { describe, expect, it } from "vitest";
import { programmesForCollege } from "@shared/academic";

describe("programmesForCollege", () => {
  it("returns only programmes offered by the selected college", () => {
    expect(programmesForCollege("College of Basic and Applied Sciences")).toContain("Computer Science");
    expect(programmesForCollege("College of Basic and Applied Sciences")).not.toContain("Nursing Science");
    expect(programmesForCollege("College of Allied Health Sciences")).toContain("Nursing Science");
    expect(programmesForCollege("College of Allied Health Sciences")).not.toContain("Accounting");
  });

  it("returns no programmes before a recognised college is selected", () => {
    expect(programmesForCollege("")).toEqual([]);
    expect(programmesForCollege("Unknown college")).toEqual([]);
  });
});
