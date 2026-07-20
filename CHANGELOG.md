# Changelog

All notable user-facing changes to glm-vision are documented here.

This project follows [Semantic Versioning](https://semver.org/) for public package releases:

- **MAJOR** version: incompatible configuration, command, package, or runtime behavior changes.
- **MINOR** version: backwards-compatible features, new supported models, or new commands.
- **PATCH** version: backwards-compatible bug fixes, documentation fixes, and internal maintenance.

## [Unreleased]

### Changed

- Bump package version to `1.4.2` for the next patch release.

- Add Buy Me a Coffee sponsor button to README and native GitHub funding link via `.github/FUNDING.yml`.

## [1.4.0] - 2026-06-08

### Added

- Selection-driven `/glm-vision:model` and `/glm-vision:mode` commands using the Pi TUI picker.

### Changed

- README, usage guide, release checklist, and bug-report template now document colon commands as the primary UX; legacy space forms remain compatibility-only.

## [1.3.0] - 2026-06-03

### Added

- Colon flat Pi commands for glm-vision actions (`/glm-vision:status`, `/glm-vision:on`, cache controls, prompt presets, and related aliases) while keeping legacy `/glm-vision` space dispatch for one release.

## [1.2.2] - 2026-06-02

### Fixed

- Dispatch npm publishing explicitly after the auto-release workflow creates a tag and GitHub Release.

## [1.2.0] - 2026-05-26

### Added
- Multi-image support with conflict resolution.
- Upstream model watch command.
- GLM vision Coding Plan check command.
- Prompt presets and vision response cache.
- Expanded README examples for UI screenshot review, OCR, diagram reading, and error-image diagnosis.
- Troubleshooting guidance for model selection, z.ai authentication, incomplete OCR, and forwarded images.
- Release process documentation and GitHub issue templates.
- Trusted npm publishing CI.

### Changed
- Updated test expectations for glm-4.6v-flashx and glm-5v-turbo models.
- Normalized npm repository URL.
- Hardened GLM vision config and API error handling.

## [1.0.2] - 2026-05-20

### Changed

- Current package version. See Git history and npm package metadata for release details.

## Release note template

Use this template when preparing a GitHub release or npm release note:

```markdown
## glm-vision vX.Y.Z

### Summary

One or two sentences describing why this release exists.

### Added

- New user-visible capabilities.

### Changed

- Behavior, documentation, or model support changes.

### Fixed

- Bugs fixed in this release.

### Upgrade notes

- Required user or maintainer actions. Write "None" when not needed.

### Verification

- Commands or manual checks performed before publishing.
```

