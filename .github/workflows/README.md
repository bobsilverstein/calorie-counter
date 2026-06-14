# CI/CD — Firebase Hosting (keyless, Workload Identity Federation)

GitHub Actions deploys this app to Firebase Hosting. Authentication to Google
Cloud is **keyless** via Workload Identity Federation (WIF) — there is **no
service-account JSON key stored in GitHub**.

The app is a static single-page app (plain HTML + Tailwind via CDN + vanilla JS +
Firebase v8 compat SDK). There is **no build step, no `package.json`, no
`node_modules`**. The pipeline checks out the repo, stamps a version string into
`public/app.js`, authenticates with WIF, and deploys the `public/` tree with
`firebase-tools`.

- GCP / Firebase project: `calorie-counter-cdcbe` (project number `819905276769`)
- Hosting public dir: `public/` (see `firebase.json`)
- Live URL: https://calorie-counter-cdcbe.web.app

## Workflows

| File | Trigger | What it does |
| --- | --- | --- |
| `deploy.yml` | push to `main` (+ manual) | Stamps version, deploys `public/` to the **live** channel (production). |
| `preview.yml` | `pull_request` → `main` | Stamps version, deploys to a temporary **preview channel**, comments the preview URL on the PR. **Fork PRs are skipped** (no OIDC token available). |
| `firebase-rules.yml` | **manual only** (`workflow_dispatch` + typed `deploy-rules`) | Deploys `firestore.rules` + `firestore.indexes.json`. **Sensitive — dormant by design** until an auth model exists and `firebase.json` gains a `"firestore"` block. |

## Authentication — Workload Identity Federation (no secrets)

The GCP-side resources are already provisioned (see
`docs/gcp-migration-runbook.md` for the exact `gcloud` commands):

- **Workload Identity Pool:** `github-pool`
- **OIDC provider:** `github-provider`, issuer `https://token.actions.githubusercontent.com`, scoped by attribute-condition to `assertion.repository == 'bobsilverstein/calorie-counter'` (only this repo can use it).
- **Deploy service account:** `gh-deploy@calorie-counter-cdcbe.iam.gserviceaccount.com`, granted least-privilege roles: `firebasehosting.admin`, `firebaserules.admin`, `datastore.indexAdmin`, `serviceusage.serviceUsageConsumer`.
- The repo is bound to impersonate that SA via `roles/iam.workloadIdentityUser` on the `attribute.repository/bobsilverstein/calorie-counter` principal set.

Each workflow declares `permissions: id-token: write`, and the
`google-github-actions/auth` step exchanges the GitHub OIDC token for short-lived
GCP credentials. The provider path and SA email are **not secrets** (security
comes from the attribute-condition + the impersonation binding), so they are
committed directly in the workflows — there is nothing to rotate.

> The old `FIREBASE_SERVICE_ACCOUNT_CALORIE_COUNTER_CDCBE` repository secret is no
> longer used by any workflow and can be **deleted** (Settings → Secrets and
> variables → Actions).

## Version-stamping contract

The app displays a version string injected at deploy time.

- **Single source of truth for the number:** the repo-root file `version.txt`
  (a single integer).
- **Single token in the app:** `public/app.js` contains exactly one line:

  ```js
  const versionNumber = "__APP_VERSION__";
  ```

  `__APP_VERSION__` is the literal token the deploy step replaces.
- **Computed value** (done in-workflow with `sed`, no extra dependencies):

  ```
  V <version.txt integer> · <YYYY-MM-DD UTC> · <short-sha>
  ```

  The preview workflow appends ` (preview)`. The step **fails the build** if the
  token is missing, so a renamed/removed token can never silently ship the
  placeholder.

### "Auto-versioning"

To cut a new version, **edit `version.txt`** and merge to `main`; the next deploy
stamps the new number. The date and short SHA are always derived automatically.
(Future option: drive the number from git tags.)

## Firestore rules (manual, sensitive)

`firebase-rules.yml` is gated behind `workflow_dispatch` + a typed `deploy-rules`
confirmation, and **must not** be wired to any push/PR trigger until the app has
a real auth model and the rules have been reviewed. Two prerequisites remain
before it can run:

1. Add a `"firestore"` block to `firebase.json` (kept absent for now as a safety
   interlock).
2. Replace the placeholder UID in `firestore.rules` with the real owner UID and
   review (see the Firestore-auth lockdown in `docs/gcp-migration-runbook.md`).

The deploy SA already holds the required `firebaserules.admin` +
`datastore.indexAdmin` roles, so no extra IAM is needed.

## Maintainer checklist

- [ ] First deploy: merge to `main` (or run `deploy.yml` manually) and confirm the
      WIF auth step succeeds and hosting deploys.
- [ ] Delete the obsolete `FIREBASE_SERVICE_ACCOUNT_CALORIE_COUNTER_CDCBE` secret.
- [ ] (Recommended) Branch protection on `main` so production deploys go through
      reviewed PRs.
- [ ] To release a new version number, bump `version.txt` and merge to `main`.
