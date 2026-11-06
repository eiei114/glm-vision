import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PI_SDK_PACKAGES, pinnedSdkVersions, sdkVersionMismatches } from "../scripts/pi-sdk-versions.mjs";

const manifest = JSON.parse(readFileSync("package.json", "utf8"));

describe("Pi SDK version resolution", () => {
  it("reads the pinned version of every Pi SDK package from package.json", () => {
    const pinned = pinnedSdkVersions(manifest);

    expect(Object.keys(pinned)).toEqual([...PI_SDK_PACKAGES]);
    for (const name of PI_SDK_PACKAGES) {
      expect(pinned[name], `${name} should be pinned in package.json`).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it("follows the manifest pin instead of a hard-coded version", () => {
    const bumped = Object.fromEntries(PI_SDK_PACKAGES.map((name) => [name, "9.9.9"]));
    const pinned = pinnedSdkVersions({ devDependencies: bumped });

    // A dependency bump must change the expectation, not fail the gate.
    expect(pinned).toEqual(bumped);
    expect(sdkVersionMismatches(pinned, bumped)).toEqual([]);
  });

  it("still fails when the installed version drifts from the pin", () => {
    const pinned = pinnedSdkVersions(manifest);
    const drifted = { ...pinned, "@earendil-works/pi-agent-core": "0.0.1-drifted" };

    const mismatches = sdkVersionMismatches(pinned, drifted);

    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]).toContain("@earendil-works/pi-agent-core");
    expect(mismatches[0]).toContain("installed 0.0.1-drifted");
  });

  it("reports a missing installed package and an unpinned dependency", () => {
    const pinned = pinnedSdkVersions(manifest);
    const missing = sdkVersionMismatches(pinned, {});
    expect(missing).toHaveLength(PI_SDK_PACKAGES.length);
    expect(missing[0]).toContain("installed missing");

    const unpinned = pinnedSdkVersions({});
    expect(unpinned["@earendil-works/pi-ai"]).toBeNull();
    expect(sdkVersionMismatches(unpinned, { "@earendil-works/pi-ai": "1.4.0" })[0]).toContain(
      "must be pinned in package.json",
    );
  });
});
