# TypeScript notes

glm-vision is TypeScript-first and keeps `strict: true` enabled.

## Entry point

- `src/index.ts` is the Pi extension entrypoint (see `package.json` → `pi.extensions`).

## Compiler settings

- `target`: `ES2022`
- `module` / `moduleResolution`: `NodeNext`
- `strict`: `true`

## Development commands

```bash
npm run lint
npm run typecheck
npm test
```

## Project structure

- `src/` — extension implementation
- `tests/` — Vitest tests
