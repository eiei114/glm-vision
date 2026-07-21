# Template checklist

Use this checklist to keep `glm-vision` aligned with the Pi extension template.

## Repository basics

- [x] `package.json` name/description/repository/homepage/bugs set for glm-vision.
- [x] `pi.extensions` points to `src/index.ts`.
- [x] README follows the template section order and required badges.
- [x] CI workflow runs lint/typecheck/test/validate:package and npm run version:check on pull requests.
- [x] Publish workflow uses npm Trusted Publishing (OIDC).
- [x] Auto Release workflow tags version bumps.
- [x] Required docs exist in `docs/`.

## Docs set

- [x] `docs/usage.md`
- [x] `docs/examples.md`
- [x] `docs/release.md`
- [x] `docs/decisions/` (ADRs)
- [x] `docs/template-checklist.md` (maintainer checklist)

## Security

- [x] `SECURITY.md` present.
- [ ] Vulnerability reporting flow verified in GitHub settings.

## GitHub settings (verify in UI)

- [ ] About description + website set (`https://www.npmjs.com/package/glm-vision`).
- [ ] Topics include `pi`, `pi-package`, `typescript`, `glm`, `vision` (add `agent-skill` only if skills are included).
- [ ] Default branch protection for `main` enabled (require CI status checks before merge).
- [ ] Actions can create tags/releases (Auto Release) and OIDC Trusted Publishing is enabled (`id-token: write` on Publish workflow).
- [ ] Dependency alerts enabled; issue templates in `.github/ISSUE_TEMPLATE` stay current.

## Release readiness

- [x] `npm run validate:package` available.
- [x] Version bumps (`npm version <type>`) trigger Auto Release and Publish workflows.
