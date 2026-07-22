(function (root) {
    'use strict';

    function getSaveBlockReason(state) {
        if (!state.firebaseInitialized || !state.hasDatabaseRef || !state.authenticated) {
            return 'Firebase is not authenticated';
        }
        if (!state.initialDataLoaded) {
            return 'Cloud data has not finished loading; save blocked for safety';
        }
        if (state.remoteConflictDetected) {
            return 'Cloud data changed on another device. Resolve the conflict before saving.';
        }
        return null;
    }

    function chooseTransactionValue(currentData, expectedTimestamp, nextData) {
        const currentTimestamp = currentData ? (currentData.lastModified || null) : null;
        return currentTimestamp === expectedTimestamp
            ? { commit: true, value: nextData }
            : { commit: false, value: undefined };
    }

    function sanitizeBackupData(data) {
        const clean = JSON.parse(JSON.stringify(data || {}));
        delete clean.apiKey;
        delete clean.alphaVantageKey;
        return clean;
    }

    function makeBackupEnvelope(data, metadata) {
        return {
            backupMetadata: Object.assign({
                schemaVersion: 1,
                exportedAt: new Date().toISOString(),
                apiKeysIncluded: false
            }, metadata || {}),
            tradeData: sanitizeBackupData(data)
        };
    }

    function backupKeysToPrune(keys, keepCount) {
        const limit = Math.max(1, keepCount || 30);
        return [...keys].sort().slice(0, Math.max(0, keys.length - limit));
    }

    function createSerializedQueue() {
        let tail = Promise.resolve();
        return function enqueue(task) {
            const result = tail.then(task, task);
            tail = result.catch(() => {});
            return result;
        };
    }

    const api = {
        getSaveBlockReason,
        chooseTransactionValue,
        sanitizeBackupData,
        makeBackupEnvelope,
        backupKeysToPrune,
        createSerializedQueue
    };

    root.TradeSyncSafety = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
