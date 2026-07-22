# Trading Journal

Personal Caruso-entry/Minervini-exit trading journal hosted with Firebase Hosting.

## Data safety architecture

- Google Authentication limits the journal to its owner.
- Cloud Firestore stores every position, closed trade, journal entry, equity record,
  cash flow, and sizing profile as a separate document.
- Realtime listeners synchronize changes across devices.
- Per-document revisions prevent two devices from silently overwriting the same item.
- The former Realtime Database `tradeData` record is read only during the initial
  migration and remains untouched as a recovery source.
- Daily Firestore restore points are retained for 30 days. Manual JSON downloads
  exclude market-data API keys.

## First Firestore deployment

1. Export a fresh JSON backup from the Realtime Database.
2. In Firebase project `trade-tracker-36e7a`, create a Cloud Firestore database.
3. Publish `firestore.rules` before opening the updated journal.
4. Deploy the contents of `public/` together.
5. Sign in normally. If Firestore has no completed schema-v2 migration, the app
   reads `tradeData` from Realtime Database and atomically creates the granular
   Firestore data set.
6. The app validates collection counts after the write before enabling saves.
7. Confirm 7 open positions, 173 closed trades, 103 journal entries, 104 equity
   records, 2 cash flows, and 6 populated sizing profiles before editing.

The initial migration uses one short lease write followed by a 397-write atomic
batch, below the 450-write application safety limit and Firestore's 500-write
batch limit. The lease prevents two devices from racing the first migration.

## Firebase Hosting

The site in `public/` is configured to deploy to Firebase project
`trade-tracker-36e7a`.
After installing the Firebase CLI and signing in, deploy the journal and its
Firestore rules together:

```sh
firebase deploy --only hosting,firestore:rules
```

The default site URL is `https://trade-tracker-36e7a.web.app`. Firebase Hosting
serves the app; Cloud Firestore remains the realtime source of truth for journal
data on every device.

## Automatic GitHub deployment

The workflow in `.github/workflows/firebase-hosting.yml` runs the complete safety
test suite and deploys Firebase Hosting whenever relevant files are committed to
the `main` branch. GitHub must contain one repository secret named
`FIREBASE_SERVICE_ACCOUNT_TRADE_TRACKER_36E7A`. Store the Firebase service-account
JSON as the value of that secret; never commit the JSON file to the repository.

If the tests fail, the live Firebase site is not changed. The workflow can also be
started manually from the repository's **Actions** tab.

## Tests

Run:

```sh
npm test
```

The test suite uses the July 20, 2026 database export to verify record counts,
stable identities, granular writes, cross-device merging, conflict detection,
backup sanitization, and integration wiring.
