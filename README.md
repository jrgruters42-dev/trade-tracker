# Trading Journal

Personal Caruso-entry/Minervini-exit trading journal hosted on Netlify.

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
4. Deploy `index.html`, `firestore-sync.js`, `sync-safety.js`, and
   `service-worker.js` together.
5. Sign in normally. If Firestore has no completed schema-v2 migration, the app
   reads `tradeData` from Realtime Database and atomically creates the granular
   Firestore data set.
6. The app validates collection counts after the write before enabling saves.
7. Confirm 7 open positions, 173 closed trades, 103 journal entries, 104 equity
   records, 2 cash flows, and 6 populated sizing profiles before editing.

The initial migration uses one short lease write followed by a 397-write atomic
batch, below the 450-write application safety limit and Firestore's 500-write
batch limit. The lease prevents two devices from racing the first migration.

## Tests

Run:

```sh
npm test
```

The test suite uses the July 20, 2026 database export to verify record counts,
stable identities, granular writes, cross-device merging, conflict detection,
backup sanitization, and integration wiring.
