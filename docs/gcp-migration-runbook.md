# GCP / Firebase Migration Runbook

How `calorie-counter-cdcbe` was moved under the personal GCP account and switched
to keyless CI/CD, plus the remaining Firestore-auth lockdown.

## Context / decisions

- The Firebase project **is** a GCP project: `calorie-counter-cdcbe`
  (project number `819905276769`), no organization (consumer Gmail account),
  Firestore Native in `nam5`, free **Spark** plan (no billing linked — fine for
  static hosting + Firestore + Google Auth).
- It was **owned by `bob.silverstein50@gmail.com`**; the maintainer
  (`silversteinjonathan00@gmail.com`) had only `editor`.
- **Decision 1 — Transfer (not rebuild):** keep the existing project, its data,
  hosting URL, and `firebase-config.js`; just move ownership. Zero data
  migration.
- **Decision 2 — Keyless CI:** authenticate GitHub Actions to GCP with Workload
  Identity Federation instead of a long-lived service-account JSON key.

## Phase 0 — Pre-migration backup (done)

A full, faithful Firestore export was taken before any change (raw
Firestore-typed JSON, includes "missing" ancestor docs so the `Logs/<date>` tree
is captured):

| Collection | Docs |
| --- | --- |
| Foods | 584 |
| DailyLog (legacy) | 15 |
| DailyNotes | 9 |
| Backups | 6 |
| Logs | 3 |
| config | 1 |

Note: the live data is split across the **legacy `DailyLog`** tree and the
**current `Logs`** tree — reconcile this when the app's data model is finalized.

## Phase 1 — Ownership transfer (done, by Bob)

```bash
gcloud projects add-iam-policy-binding calorie-counter-cdcbe \
  --member="user:silversteinjonathan00@gmail.com" --role="roles/owner"
```

Optional cleanup once owner access is verified:

```bash
gcloud projects remove-iam-policy-binding calorie-counter-cdcbe \
  --member="user:bob.silverstein50@gmail.com" --role="roles/owner"
```

Billing stays optional (free tier). To attach the personal billing account for
Blaze headroom later: `gcloud billing projects link calorie-counter-cdcbe
--billing-account=<ACCOUNT_ID>`.

## Phase 2 — Workload Identity Federation (done)

```bash
P=calorie-counter-cdcbe; PNUM=819905276769
SA=gh-deploy@$P.iam.gserviceaccount.com

gcloud services enable iamcredentials.googleapis.com sts.googleapis.com iam.googleapis.com --project $P

gcloud iam workload-identity-pools create github-pool --location=global \
  --display-name="GitHub Actions" --project $P
gcloud iam workload-identity-pools providers create-oidc github-provider \
  --location=global --workload-identity-pool=github-pool \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository=='bobsilverstein/calorie-counter'" \
  --project $P

gcloud iam service-accounts create gh-deploy --display-name="GitHub Actions deploy" --project $P
for R in roles/firebasehosting.admin roles/firebaserules.admin \
         roles/datastore.indexAdmin roles/serviceusage.serviceUsageConsumer; do
  gcloud projects add-iam-policy-binding $P --member="serviceAccount:$SA" --role="$R"
done

# NOTE: the SA must finish propagating before this binding succeeds; retry if it
# fails the first time.
gcloud iam service-accounts add-iam-policy-binding $SA --project $P \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/$PNUM/locations/global/workloadIdentityPools/github-pool/attribute.repository/bobsilverstein/calorie-counter"
```

Provider resource name used by the workflows:

```
projects/819905276769/locations/global/workloadIdentityPools/github-pool/providers/github-provider
```

## Phase 3 — Workflow cutover (this PR)

`deploy.yml`, `preview.yml`, and `firebase-rules.yml` now authenticate with
`google-github-actions/auth` (WIF) and deploy via `firebase-tools`, replacing the
`FirebaseExtended/action-hosting-deploy` + JSON-secret approach. Each workflow
adds `permissions: id-token: write`. See `.github/workflows/README.md`.

## Phase 4 — Verify & finish

1. Merge this PR (or run `deploy.yml` manually) and confirm the auth step
   exchanges the OIDC token and hosting deploys green.
2. **Delete** the now-unused `FIREBASE_SERVICE_ACCOUNT_CALORIE_COUNTER_CDCBE`
   GitHub secret.

## Remaining — Firestore auth lockdown (separate work)

The database is still publicly readable. Recommended: add Google sign-in and lock
rules to the owner UID (single-user). Safe sequence: ship login → verify
read/write under open rules → tighten `firestore.rules` to
`request.auth.uid == "<UID>"` → add the `"firestore"` block to `firebase.json` →
deploy rules via the manual `firebase-rules.yml` → verify an unauthenticated read
is denied. Keep the previous open rules handy as a rollback.
