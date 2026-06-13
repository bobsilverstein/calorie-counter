# CI/CD — Firebase Hosting

This folder replaces the old manual Windows `deploy.bat` flow with GitHub
Actions. (`deploy.bat` is currently corrupted — it contains pasted JS, not batch
commands — and is no longer used; it can be deleted.)

The app is a static single-page app (plain HTML + Tailwind via CDN + vanilla JS
+ Firebase v8 compat SDK). There is **no build step, no `package.json`, no
`node_modules`**. The pipeline just checks out the repo, stamps a version string
into `public/app.js`, and deploys the `public/` tree to Firebase Hosting.

- Firebase project: `calorie-counter-cdcbe`
- Hosting public dir: `public/` (see `firebase.json`)
- Live URL: https://calorie-counter-cdcbe.web.app

## Workflows

| File | Trigger | What it does |
| --- | --- | --- |
| `deploy.yml` | push to `main` (+ manual) | Stamps version, deploys `public/` to the **live** channel (production). |
| `preview.yml` | `pull_request` → `main` | Stamps version, deploys to a temporary **preview channel**, comments the preview URL on the PR. **Fork PRs are skipped** (see below). |
| `firebase-rules.yml` | **manual only** (`workflow_dispatch`) | Deploys `firestore.rules` + `firestore.indexes.json`. **Sensitive — disabled by default.** Requires extra IAM roles (see below). |

### Why fork PRs skip the preview

On a `pull_request` from a fork, GitHub deliberately does **not** expose repo
secrets to the runner, so the Firebase service-account secret would be empty and
the deploy would fail. We do **not** use `pull_request_target` (which would
leak secrets to untrusted fork code). `preview.yml` therefore guards on the PR
head coming from this repository:

```yaml
if: github.event.pull_request.head.repo.full_name == github.repository
```

For a single-maintainer personal app this is almost always fine: push your
branch to this repo (not a fork) to get a preview, or rely on the live deploy
after merge.

## Required GitHub secret

| Secret name | Value |
| --- | --- |
| `FIREBASE_SERVICE_ACCOUNT_CALORIE_COUNTER_CDCBE` | The **full JSON** of a Google service-account key with permission to deploy to Firebase Hosting on project `calorie-counter-cdcbe`. |

The name must match **exactly** — all three workflows reference it.

### How to create the service account + secret

Easiest path (Firebase CLI does the IAM wiring for you):

```bash
# From a machine with the Firebase CLI logged into an account that owns the project
firebase init hosting:github
```

This creates a service account, grants it the Hosting deploy roles, and stores
the JSON as a GitHub secret for you. Let it create the secret, then **rename**
the secret in GitHub to `FIREBASE_SERVICE_ACCOUNT_CALORIE_COUNTER_CDCBE` if it
chose a different name (GitHub → repo **Settings → Secrets and variables →
Actions**).

Manual path (if you prefer to do it by hand):

1. Google Cloud Console → IAM & Admin → **Service Accounts** (project
   `calorie-counter-cdcbe`).
2. Create a service account, e.g. `github-actions-hosting`.
3. Grant it the **Firebase Hosting Admin** role (`roles/firebasehosting.admin`).
   For preview channels it also needs read access typically covered by
   **Firebase Viewer** / **Firebase Authentication Viewer** — the
   `firebase init hosting:github` flow grants exactly the right set, so prefer
   that if unsure.
4. Create a **JSON key** for the service account and download it.
5. GitHub → repo **Settings → Secrets and variables → Actions → New repository
   secret**:
   - Name: `FIREBASE_SERVICE_ACCOUNT_CALORIE_COUNTER_CDCBE`
   - Value: paste the **entire** contents of the downloaded JSON file.
6. Delete the local JSON key file; do not commit it.

> `GITHUB_TOKEN` is provided automatically by Actions — you do **not** create it.
> The preview action uses it only to post the preview-URL comment on the PR.

## Version-stamping contract

The app displays a version string. The pipeline injects it at deploy time.

- **Single source of truth for the number:** the repo-root file `version.txt`
  contains a single integer (currently `205`).
- **Single token in the app:** `public/app.js` contains exactly one line of the
  form:

  ```js
  const versionNumber = "__APP_VERSION__";
  ```

  `__APP_VERSION__` is the literal token the deploy step replaces. (A separate
  effort is collapsing the app down to expose exactly this one line.)
- **Computed value** (done in the workflow with `sed`, no extra dependencies):

  ```
  V <version.txt integer> · <YYYY-MM-DD UTC> · <short-sha>
  ```

  Example: `V 205 · 2026-06-11 · a1b2c3d`. The preview workflow appends
  ` (preview)`.

The stamp step **fails the build** if the `__APP_VERSION__` token is not found,
so a missing/renamed token can never silently ship the placeholder.

### "Auto-versioning"

There is no automatic number bump. To cut a new version, **edit `version.txt`**
(e.g. `205` → `206`) and merge to `main`; the next deploy stamps the new number.
The date and short SHA are always derived automatically at deploy time.

**Future option:** drive the version from git tags instead (e.g. a `v206` tag →
stamp `206`), which removes the manual `version.txt` edit. Not implemented here
to keep the flow dependency-free and obvious.

## Firestore rules (manual, sensitive)

`firebase-rules.yml` is gated behind `workflow_dispatch` and additionally
requires the operator to type `deploy-rules` to confirm. It does **not** run
automatically and **must not** be wired to any push/PR trigger until the app has
a real auth model and the rules have been reviewed — security rules are the only
barrier between the public internet and the database.

To deploy rules, the service account in the secret needs **two additional IAM
roles** beyond Hosting:

- **Firebase Rules Admin** (`roles/firebaserules.admin`)
- **Cloud Datastore Index Admin** (`roles/datastore.indexAdmin`)

The job exits with a clear error if `firestore.rules` / `firestore.indexes.json`
are missing. Both files **already exist** in the repo, but `firebase.json` does
not yet reference them (it needs a `"firestore"` block) — add that before using
this workflow. Just as important: **do not deploy the current rules yet** — they
require an auth model the app does not have, so deploying them as-is would lock
everyone out.

## What the maintainer must do (checklist)

- [ ] Create the service account and add the secret
      `FIREBASE_SERVICE_ACCOUNT_CALORIE_COUNTER_CDCBE` (see above). Easiest:
      `firebase init hosting:github`.
- [ ] Confirm the app exposes exactly one `const versionNumber = "__APP_VERSION__";`
      line in `public/app.js` (handled by the concurrent app cleanup).
- [ ] (Recommended) Add branch protection on `main` so production deploys only
      happen via reviewed PRs.
- [ ] Push branches to this repo (not a fork) when you want a PR preview.
- [ ] To release a new version number, bump `version.txt` and merge to `main`.
- [ ] Only if/when you have Firestore rules: add the two extra IAM roles to the
      service account, create `firestore.rules` + `firestore.indexes.json`, then
      run the **Deploy Firestore Rules & Indexes (manual)** workflow.

## Pinned action versions

All actions are pinned to a full commit SHA for supply-chain safety; the
human-readable tag is in a comment next to each `uses:`.

| Action | Tag | Pinned SHA |
| --- | --- | --- |
| `actions/checkout` | v4 | `34e114876b0b11c390a56381ad16ebd13914f8d5` |
| `FirebaseExtended/action-hosting-deploy` | v0.10.0 | `e2eda2e106cfa35cdbcf4ac9ddaf6c4756df2c8c` |
| `w9jds/firebase-action` | v15.19.1 | `b3c725170700a48b168a32972e7aaa4c92bf1061` |

Consider enabling Dependabot (`.github/dependabot.yml`, ecosystem
`github-actions`) to get PRs that bump these SHAs as new versions ship.
