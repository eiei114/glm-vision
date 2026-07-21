# Release guide

This guide is for maintainers publishing `glm-vision` to npm and GitHub.

## Versioning policy

glm-vision uses Semantic Versioning (`MAJOR.MINOR.PATCH`).

- **MAJOR**: breaking changes to package installation, configuration file shape, command names, default behavior, supported Pi extension API, or supported model contract.
- **MINOR**: backwards-compatible features such as new commands, new supported vision models, new configuration options, or improved image extraction behavior.
- **PATCH**: backwards-compatible bug fixes, dependency maintenance, documentation improvements, and release-process updates.

When in doubt, choose the smallest version bump that accurately describes user impact.

## Pre-release checklist

1. Confirm `package.json` has the package name, version, repository, license, and `pi.extensions` entry.
2. Review README examples and troubleshooting for accuracy.
3. Move completed entries from `CHANGELOG.md` `[Unreleased]` into a new version section.
4. Confirm issue templates still request enough environment details for support.
5. Run local validation (`npm run lint`, `npm run typecheck`, `npm test`, `npm run validate:package`, `npm run version:check`).
6. Test installation in a clean Pi environment when possible:

   ```bash
   pi install npm:glm-vision
   /glm-vision:status
   /glm-vision:model
   /glm-vision:mode
   ```

7. Test or manually verify the core scenarios:
   - UI screenshot review
   - OCR/text extraction
   - Diagram reading
   - Error-image diagnosis

## npm release steps

1. Start from a clean working tree on the release branch.

   ```bash
   git status --short
   ```

2. Pick the version bump.

   ```bash
   npm version patch
   # or: npm version minor
   # or: npm version major
   ```

3. Inspect generated changes.

   ```bash
   git show --stat
   git diff HEAD~1..HEAD
   ```

4. Run a dry-run package publish to verify included files.

   ```bash
   npm publish --dry-run
   ```

5. Publish to npm.

   ```bash
   npm publish --access public
   ```

6. Push the release commit and tag.

   ```bash
   git push origin HEAD
   git push origin --tags
   ```

7. Create a GitHub release using the release note template below.
8. Confirm the npm page shows the new version and installation command works.

## GitHub release note template

```markdown
## glm-vision vX.Y.Z

### Summary

One or two sentences describing the release.

### Highlights

- Most important user-facing change.
- Second most important user-facing change.

### Added

- New capabilities.

### Changed

- Behavior, documentation, or model support changes.

### Fixed

- Bugs fixed.

### Upgrade notes

- Required user action, or "None".

### Verification

- `npm publish --dry-run`
- Manual Pi install/status check
- Scenario checks performed
```

## Post-release checks

- Confirm `https://www.npmjs.com/package/glm-vision` shows the new version.
- Confirm README links render correctly on GitHub and npm.
- Confirm `pi install npm:glm-vision` installs the published version.
- Leave follow-up issues for any known gaps discovered during release verification.
