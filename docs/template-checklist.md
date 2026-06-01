# Template checklist

Use this checklist to keep `glm-vision` aligned with the Pi extension template.

## Repository basics

- [x] `package.json` name/description/repository/homepage/bugs set for glm-vision.
- [x] `pi.extensions` points to `src/index.ts`.
- [x] README follows the template section order and required badges.
- [x] CI workflow runs lint/typecheck/test/validate:package.
- [x] Publish workflow uses npm Trusted Publishing (OIDC).
- [x] Auto Release workflow tags version bumps.
- [x] Required docs exist in `docs/`.

## Docs set

- [x] `docs/release.md`
- [x] `docs/typescript.md`
- [x] `docs/examples.md`
- [x] `docs/github-template.md`
- [x] `docs/repository-settings.md`

## Security

- [x] `SECURITY.md` present.
- [ ] Vulnerability reporting flow verified in GitHub settings.

## GitHub settings (verify in UI)

- [ ] About description + website set.
- [ ] Topics include `pi`, `pi-package`, `typescript` (and `agent-skill` if applicable).
- [ ] Default branch protection for `main` enabled.
- [ ] Actions and packages permissions configured for Trusted Publishing.

## Release readiness

- [x] `npm run validate:package` available.
- [x] Version bumps (`npm version <type>`) trigger Auto Release and Publish workflows.
