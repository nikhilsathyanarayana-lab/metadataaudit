# Redundant / Unused Code Audit (SPA)

Date: 2026-02-22

## Scope
- `SPA/js/*.js`

## How this was checked
- Searched for top-level function/const declarations and counted symbol references across SPA JS files.
- Ran `jslint` on SPA JS files as a baseline lint pass.

## Findings

### 1) Unused helper in `SPA/js/3.js`
- `buildAppLookupKey` was declared but never called.
- This helper was safe to remove because no callers existed in SPA modules.

## Follow-up notes
- `jslint` currently fails early on ESM syntax (`import`, `const`, `let`) in this repository's current module format, so it is not yet a reliable signal for unused code detection until its config/tooling is aligned for ES modules.
