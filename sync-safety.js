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

    const activeTokens = new Map();

    /**
     * Single-use client-side workflow token (not a cryptographic token).
     * Issued to authorize explicit record deletions during user-initiated workflows.
     */
    function issueDeletionToken(dataset, recordId, payloadId) {
        const nonce = 'del-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
        const token = {
            nonce,
            dataset,
            recordId: String(recordId),
            payloadId: payloadId !== undefined ? String(payloadId) : null,
            createdAt: Date.now()
        };
        activeTokens.set(nonce, token);
        return token;
    }

    function consumeToken(tokenOrNonce) {
        if (!tokenOrNonce) return null;
        const nonce = typeof tokenOrNonce === 'object' ? tokenOrNonce.nonce : tokenOrNonce;
        if (!nonce || !activeTokens.has(nonce)) return null;
        const token = activeTokens.get(nonce);
        activeTokens.delete(nonce);
        if (Date.now() - token.createdAt > 120000) return null;
        return token;
    }

    function invalidateToken(tokenOrNonce) {
        if (!tokenOrNonce) return;
        const nonce = typeof tokenOrNonce === 'object' ? tokenOrNonce.nonce : tokenOrNonce;
        if (nonce) activeTokens.delete(nonce);
    }

    function getStableRecordId(item, collectionKey) {
        if (!item || typeof item !== 'object') return null;
        if (collectionKey === 'stockProfiles') {
            const rawSlot = (item._slot !== undefined && item._slot !== null && item._slot !== '')
                ? item._slot
                : (item._syncId || item.id);
            if (rawSlot !== undefined && rawSlot !== null && rawSlot !== '') {
                let slotStr = String(rawSlot).replace(/^profile-/, '');
                if (slotStr === '0') slotStr = '1';
                return 'profile-' + slotStr;
            }
        }
        if (collectionKey === 'openPositions') {
            const raw = (item.id !== undefined && item.id !== null && item.id !== '') ? item.id : item._syncId;
            if (raw !== undefined && raw !== null && raw !== '') {
                return 'position-' + String(raw).replace(/^position-/, '');
            }
        }
        if (collectionKey === 'closedTrades') {
            const raw = (item.id !== undefined && item.id !== null && item.id !== '') ? item.id : item._syncId;
            if (raw !== undefined && raw !== null && raw !== '') {
                return 'trade-' + String(raw).replace(/^trade-/, '');
            }
        }
        if (collectionKey === 'cashFlows') {
            const raw = (item.id !== undefined && item.id !== null && item.id !== '') ? item.id : item._syncId;
            if (raw !== undefined && raw !== null && raw !== '') {
                return 'cash-flow-' + String(raw).replace(/^cash-flow-/, '');
            }
        }
        if (collectionKey === 'dailyEquity') {
            const raw = item.date || item._syncId;
            if (raw !== undefined && raw !== null && raw !== '') {
                return 'equity-' + String(raw).replace(/^equity-/, '');
            }
        }
        if (collectionKey === 'dailyEquityEntries') {
            const raw = item.date || item._syncId;
            if (raw !== undefined && raw !== null && raw !== '') {
                return 'journal-' + String(raw).replace(/^journal-/, '');
            }
        }
        if (item._syncId) return String(item._syncId);
        if (item.id !== undefined && item.id !== null && item.id !== '') return String(item.id);
        if (item.date !== undefined && item.date !== null && item.date !== '') return String(item.date);
        if (item._slot !== undefined && item._slot !== null && item._slot !== '') return String(item._slot);
        if (item.symbol !== undefined && item.symbol !== null && item.symbol !== '') return String(item.symbol);
        return null;
    }

    function tokenMatchesId(token, removedIds) {
        if (!token) return false;
        const targetRecordId = token.recordId !== null && token.recordId !== undefined && token.recordId !== '' ? String(token.recordId) : null;
        const targetPayloadId = token.payloadId !== null && token.payloadId !== undefined && token.payloadId !== '' ? String(token.payloadId) : null;
        return removedIds.some(id => {
            const strId = String(id);
            if (targetRecordId !== null && strId === targetRecordId) return true;
            if (targetPayloadId !== null && strId === targetPayloadId) return true;
            if (targetRecordId !== null && (strId === 'position-' + targetRecordId || strId === 'trade-' + targetRecordId || strId === 'cash-flow-' + targetRecordId || strId === 'journal-' + targetRecordId || strId === 'equity-' + targetRecordId || strId === 'profile-' + targetRecordId)) return true;
            if (targetPayloadId !== null && (strId === 'position-' + targetPayloadId || strId === 'trade-' + targetPayloadId || strId === 'cash-flow-' + targetPayloadId || strId === 'journal-' + targetPayloadId || strId === 'equity-' + targetPayloadId || strId === 'profile-' + targetPayloadId)) return true;
            return false;
        });
    }

    const REQUIRED_ARRAY_KEYS = ['openPositions', 'closedTrades', 'cashFlows', 'dailyEquity', 'dailyEquityEntries'];

    function validatePayloadSafety(proposedPayload, baseCheckpoint, options = {}) {
        if (!proposedPayload || typeof proposedPayload !== 'object') {
            return { safe: false, reason: 'MALFORMED_DATASET:payload' };
        }

        for (const key of REQUIRED_ARRAY_KEYS) {
            if (!Array.isArray(proposedPayload[key])) {
                return { safe: false, reason: 'MALFORMED_DATASET:' + key };
            }
        }

        if (proposedPayload.stockProfiles !== undefined && proposedPayload.stockProfiles !== null && typeof proposedPayload.stockProfiles !== 'object') {
            return { safe: false, reason: 'MALFORMED_DATASET:stockProfiles' };
        }

        if (!baseCheckpoint || typeof baseCheckpoint !== 'object' || !baseCheckpoint.data || typeof baseCheckpoint.data !== 'object') {
            return { safe: false, reason: 'AUTHORITATIVE_CHECKPOINT_MISSING' };
        }

        const baseData = baseCheckpoint.data;

        for (const key of REQUIRED_ARRAY_KEYS) {
            if (!Array.isArray(baseData[key])) {
                return { safe: false, reason: 'MALFORMED_CHECKPOINT_DATASET:' + key };
            }
        }

        if (baseData.stockProfiles !== undefined && baseData.stockProfiles !== null && typeof baseData.stockProfiles !== 'object') {
            return { safe: false, reason: 'MALFORMED_CHECKPOINT_DATASET:stockProfiles' };
        }

        let consumedToken = null;
        if (options && options.deletionToken) {
            consumedToken = consumeToken(options.deletionToken);
            if (!consumedToken) {
                return { safe: false, reason: 'EXPIRED_OR_CONSUMED_TOKEN' };
            }
        }

        const allKeys = [...REQUIRED_ARRAY_KEYS, 'stockProfiles'];

        for (const key of allKeys) {
            const cloudSource = baseData[key];
            const proposedSource = proposedPayload[key];

            const cloudItems = key === 'stockProfiles'
                ? (Array.isArray(cloudSource)
                    ? cloudSource.filter(item => item && typeof item === 'object').map((item, idx) => {
                        let slotStr = (item._slot !== undefined && item._slot !== null && item._slot !== '' && String(item._slot) !== 'undefined')
                            ? String(item._slot)
                            : (item._syncId ? String(item._syncId).replace(/^profile-/, '') : String(idx + 1));
                        if (slotStr === '0') slotStr = '1';
                        return Object.assign({}, item, { _slot: slotStr, _syncId: `profile-${slotStr}` });
                    })
                    : Object.entries(cloudSource || {})
                        .filter(([slot, item]) => slot !== 'undefined' && item && typeof item === 'object')
                        .map(([slot, item]) => {
                            let slotStr = (item._slot !== undefined && item._slot !== null && item._slot !== '' && String(item._slot) !== 'undefined')
                                ? String(item._slot)
                                : (item._syncId ? String(item._syncId).replace(/^profile-/, '') : String(slot).replace(/^profile-/, ''));
                            if (slotStr === '0') slotStr = '1';
                            return Object.assign({}, item, { _slot: slotStr, _syncId: `profile-${slotStr}` });
                        }))
                : (Array.isArray(cloudSource) ? cloudSource : []);

            const proposedItems = key === 'stockProfiles'
                ? (Array.isArray(proposedSource)
                    ? proposedSource.filter(item => item && typeof item === 'object').map((item, idx) => {
                        let slotStr = (item._slot !== undefined && item._slot !== null && item._slot !== '' && String(item._slot) !== 'undefined')
                            ? String(item._slot)
                            : (item._syncId ? String(item._syncId).replace(/^profile-/, '') : String(idx + 1));
                        if (slotStr === '0') slotStr = '1';
                        return Object.assign({}, item, { _slot: slotStr, _syncId: `profile-${slotStr}` });
                    })
                    : Object.entries(proposedSource || {})
                        .filter(([slot, item]) => slot !== 'undefined' && item && typeof item === 'object')
                        .map(([slot, item]) => {
                            let slotStr = (item._slot !== undefined && item._slot !== null && item._slot !== '' && String(item._slot) !== 'undefined')
                                ? String(item._slot)
                                : (item._syncId ? String(item._syncId).replace(/^profile-/, '') : String(slot).replace(/^profile-/, ''));
                            if (slotStr === '0') slotStr = '1';
                            return Object.assign({}, item, { _slot: slotStr, _syncId: `profile-${slotStr}` });
                        }))
                : (Array.isArray(proposedSource) ? proposedSource : []);

            const cloudIdsMap = new Map();
            cloudItems.forEach(item => {
                const id = getStableRecordId(item, key);
                if (id) cloudIdsMap.set(id, item);
            });

            const proposedIdsSet = new Set();
            proposedItems.forEach(item => {
                const id = getStableRecordId(item, key);
                if (id) proposedIdsSet.add(id);
            });

            const removedIds = [];
            for (const cloudId of cloudIdsMap.keys()) {
                if (!proposedIdsSet.has(cloudId)) {
                    removedIds.push(cloudId);
                }
            }

            if (removedIds.length > 0) {
                if (cloudItems.length > 1 && proposedItems.length === 0) {
                    return { safe: false, reason: 'EMPTY_DATASET_OVERWRITE:' + key };
                }
                if (!consumedToken) {
                    return { safe: false, reason: 'UNAUTHORIZED_DELETION' };
                }
                if (consumedToken.dataset !== key) {
                    return { safe: false, reason: 'UNAUTHORIZED_DELETION' };
                }
                if (removedIds.length > 1) {
                    return { safe: false, reason: 'UNAUTHORIZED_DELETION' };
                }
                if (!tokenMatchesId(consumedToken, removedIds)) {
                    return { safe: false, reason: 'UNAUTHORIZED_DELETION' };
                }
            }
        }

        return { safe: true, tokenUsed: consumedToken };
    }

    const api = {
        getSaveBlockReason,
        chooseTransactionValue,
        sanitizeBackupData,
        makeBackupEnvelope,
        backupKeysToPrune,
        createSerializedQueue,
        issueDeletionToken,
        consumeToken,
        invalidateToken,
        getStableRecordId,
        validatePayloadSafety
    };

    root.TradeSyncSafety = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
