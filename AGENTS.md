# Project Rules & Instructions

## GitHub Sync & Versioning
- After modifying or updating application code and passing build/tests, bump the app version (e.g., `v1.0.2`, `v1.0.3`) in the `index.html` header badge (`#appVersionBadge`) and `service-worker.js` (`CACHE_NAME`).
- Always commit and push the changes to GitHub (`git push origin main`) so that the live external repo stays in sync with the latest fixes and features.
- Always report the exact new version number in your response so the user can easily verify which deployment build is active.

