/**
 * Resolve the Pi SDK versions the smoke harness must run against.
 *
 * The harness verifies the extension against whatever the repository pins, so
 * the expected versions come from `package.json` instead of a literal map.
 * A dependency bump then only has to update the manifest: the smoke gate keeps
 * checking that the installed packages match the pin, and never fails merely
 * because the pin moved.
 */

/** Pi SDK packages the smoke harness drives. */
export const PI_SDK_PACKAGES = [
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-tui",
];

/**
 * Read the exact version pinned for each Pi SDK package.
 *
 * @param {{ dependencies?: Record<string, string>, devDependencies?: Record<string, string> }} manifest
 *   Parsed `package.json`.
 * @returns {Record<string, string | null>} Pin per package, or `null` when unpinned.
 */
export function pinnedSdkVersions(manifest) {
  const declared = { ...(manifest?.dependencies ?? {}), ...(manifest?.devDependencies ?? {}) };
  return Object.fromEntries(PI_SDK_PACKAGES.map((name) => [name, declared[name] ?? null]));
}

/**
 * Describe every package whose installed version differs from the pin.
 *
 * @param {Record<string, string | null>} expected Pins from {@link pinnedSdkVersions}.
 * @param {Record<string, string | null | undefined>} installed Installed versions.
 * @returns {string[]} One message per mismatch; empty when everything matches.
 */
export function sdkVersionMismatches(expected, installed) {
  return Object.entries(expected)
    .filter(([name, pinned]) => installed[name] !== pinned)
    .map(
      ([name, pinned]) =>
        `${name} must be ${pinned ?? "pinned in package.json"}; installed ${installed[name] ?? "missing"}`,
    );
}
