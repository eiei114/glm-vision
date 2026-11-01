import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const autoReleaseWorkflow = readFileSync(".github/workflows/auto-release.yml", "utf8");

describe("automatic release workflow safety", () => {
  it("only starts through an explicit workflow dispatch, not a main push", () => {
    const triggers = autoReleaseWorkflow.match(/^on:\r?\n([\s\S]*?)(?=^permissions:)/m)?.[1];

    const triggerKeys = triggers?.match(/^ {2}[A-Za-z0-9_-]+:/gm)?.map((trigger) => trigger.trim());

    expect(triggerKeys).toEqual(["workflow_dispatch:"]);
  });

  it("requires a version confirmation and only releases from main", () => {
    expect(autoReleaseWorkflow).toMatch(/^ {6}confirm_version:\r?$/m);
    expect(autoReleaseWorkflow).toMatch(/^ {8}required: true\r?$/m);
    expect(autoReleaseWorkflow).toMatch(
      /^ {4}if: github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'\r?$/m,
    );
    expect(autoReleaseWorkflow).toMatch(/CONFIRM_VERSION.*github\.event\.inputs\.confirm_version/);
    expect(autoReleaseWorkflow).toMatch(/\[ "\$CONFIRM_VERSION" != "\$VERSION" \]/);
  });
});
