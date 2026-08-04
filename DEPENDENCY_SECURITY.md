# Dependency security overrides

The overrides below are deliberate release controls. Keep them exact, review
them on every dependency upgrade, and remove them once the direct upstream
package declares a patched dependency range.

## Backend: `uuid` 11.1.1

`firebase-admin` 13 currently reaches `uuid` 9 through `gaxios`, `google-gax`,
and `teeny-request`. That version is affected by GHSA-w5hq-g745-h8pq. The
backend pins the transitive package to 11.1.1, which retains the CommonJS
`v4`/`v5` API used by this dependency graph and includes the bounds check.

Do not replace this with the `npm audit fix --force` suggestion. The suggested
Firebase major/downgrade paths either remove the legacy namespace API currently
used by `src/config/firebase.js` or introduce a dependency graph with high
severity findings. Remove the override only after the Google/Firebase packages
adopt a patched range and the full backend test and syntax gates pass.

The backend also pins `gcp-metadata` 5.3.0 as a direct peer bridge. MongoDB 6
declares the optional GCP metadata peer as `^5.2.0`, while the directly used
Google Auth library requires its own 6.x copy. Keeping 5.3.0 at the application
root lets npm place Google Auth's 6.x package below Google Auth instead of
incorrectly satisfying MongoDB with an incompatible hoisted major.

## Frontend: `cookie` 0.7.2

SvelteKit 2.70.1 resolves `cookie` 0.6.0, which is affected by
GHSA-pxg6-pf52-xh8x. The frontend pins only this transitive package to 0.7.2.
This avoids the invalid audit recommendation to downgrade the SvelteKit
adapters to obsolete `0.0.x` releases.

## Required verification

Any change to these overrides must pass:

- clean `npm ci` from the corresponding lockfile;
- `npm ls` with no invalid or extraneous packages;
- `npm audit` with no accepted hidden residuals;
- backend syntax and full unit/integration-eligible tests;
- frontend lint, unit tests, and production build.

Do not use `--force` to satisfy these gates.
