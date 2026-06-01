# Release

This package uses npm Trusted Publishing (OIDC) via GitHub Actions.

## Workflows

- `.github/workflows/auto-release.yml` creates a `vX.Y.Z` tag and GitHub Release when `package.json` changes on `main`.
- `.github/workflows/publish.yml` publishes on tags `v*.*.*`, `release.published`, or manual dispatch.
- `.github/workflows/ci.yml` validates on PRs and pushes to `main`.

## Standard release flow

1. Update README/CHANGELOG/docs as needed.
2. Bump the version.

   ```bash
   npm version patch
   # or: npm version minor
   # or: npm version major
   ```

3. Push the commit.

   ```bash
   git push origin HEAD
   ```

4. Auto Release creates the tag and GitHub Release.
5. Publish workflow runs and publishes to npm via Trusted Publishing.

## Manual publish

If needed, run the Publish workflow with `workflow_dispatch` and set the desired ref.

## Pre-release checks

```bash
npm run lint
npm run typecheck
npm test
npm run validate:package
```

## More detail

See [`RELEASE.md`](../RELEASE.md) for the maintainer checklist and release note template.
