import { describe, expect, it } from "vitest";
import { allSemanticAssertionsPassed, containsExpected, hasExpectedStatusResponse } from "../scripts/pi-sdk-smoke-contract.mjs";

describe("Pi SDK behavior-v2 smoke assertions", () => {
  it("accepts an observed feature response and rejects a missing one", () => {
    expect(containsExpected("tool result: SMOKE_VISION_DESCRIPTION", "SMOKE_VISION_DESCRIPTION")).toBe(
      true,
    );
    expect(containsExpected("tool result: [glm-vision error]", "SMOKE_VISION_DESCRIPTION")).toBe(
      false,
    );
  });

  it("does not treat clean shutdown as proof of a reloaded feature response", () => {
    const reloadAssertions = [
      { id: "reloaded_extension_registered", expected: "registered", observed: "registered", passed: true },
      { id: "reloaded_feature_response", expected: "SMOKE_VISION_DESCRIPTION", observed: "", passed: false },
      { id: "clean_shutdown", expected: "exit_code=0", observed: "exit_code=0", passed: true },
    ];

    expect(allSemanticAssertionsPassed(reloadAssertions)).toBe(false);
  });

  it("requires the actual status command disposition and notification", () => {
    expect(hasExpectedStatusResponse("handled", "glm-vision: ON\nmodel: glm-4.6v")).toBe(true);
    expect(hasExpectedStatusResponse("handled", "glm-vision: OFF")).toBe(false);
    expect(hasExpectedStatusResponse("ignored", "glm-vision: ON")).toBe(false);
    expect(hasExpectedStatusResponse("handled", null)).toBe(false);
  });
});
