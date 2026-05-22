import { describe, expect, it } from "vitest";
import packageJson from "../../../package.json";
import { runMacMvpDemoCheck } from "./macMvpDemoCheck";

describe("Mac MVP demo check", () => {
  it("runs the canonical capture, recall, and correction script", async () => {
    const report = await runMacMvpDemoCheck();
    const transcript = report.lines.join("\n");

    expect(report.ok).toBe(true);
    expect(transcript).toContain("phone verified");
    expect(transcript).toContain("Friendy is on");
    expect(transcript).toContain("I noticed you added Maya");
    expect(transcript).toContain("saved Maya");
    expect(transcript).toContain("That was Maya");
    expect(transcript).toContain("updated Maya");
  });

  it("exposes the demo check as an npm script", () => {
    expect(packageJson.scripts["check:mac-mvp-demo"]).toBe("tsx src/relationship/evals/macMvpDemoCheck.ts");
  });
});
