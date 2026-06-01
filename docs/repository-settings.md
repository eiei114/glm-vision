# Repository settings

Use this as a checklist when reviewing GitHub settings for `glm-vision`.

## About

- **Description:** One-line pitch for glm-vision.
- **Website:** https://www.npmjs.com/package/glm-vision
- **Topics:** `pi`, `pi-package`, `typescript`, `glm`, `vision` (add `agent-skill` only if skills are included).

## Branch protection

- Protect `main`.
- Require CI status checks before merge.
- Require linear history (optional).

## Actions

- Allow GitHub Actions to create tags/releases (Auto Release).
- Ensure OIDC Trusted Publishing permissions are enabled (Publish workflow uses `id-token: write`).

## Security

- Enable dependency alerts.
- Use GitHub Security Advisories if available.

## Issues & templates

- Keep issue templates in `.github/ISSUE_TEMPLATE` up to date.
