export const PI_SDK_PACKAGES: readonly string[];

export function pinnedSdkVersions(manifest: {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}): Record<string, string | null>;

export function sdkVersionMismatches(
  expected: Record<string, string | null>,
  installed: Record<string, string | null | undefined>,
): string[];
