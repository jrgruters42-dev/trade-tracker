(function (root) {
    'use strict';

    const SCHEMA_VERSION = 2;
    const MAX_MIGRATION_WRITES = 450;
    const COLLECTIONS = [
        { key: 'openPositions', name: 'openPositions', prefix: 'position', idField: 'id', shape: 'array' },
        { key: 'closedTrades', name: 'closedTrades', prefix: 'trade', shape: 'array' },
        { key: 'cashFlows', name: 'cashFlows', prefix: 'cash-flow', idField: 'id', shape: 'array' },
        { key: 'dailyEquity', name: 'dailyEquity', prefix: 'equity', idField: 'date', shape: 'array' },
        { key: 'dailyEquityEntries', name: 'dailyEquityEntries', prefix: 'journal', idField: 'date', shape: 'array' },
        { key: 'stockProfiles', name: 'stockProfiles', prefix: 'profile', idField: '_slot', shape: 'indexedObject' }
    ];

    const TRANSIENT_ROOT_FIELDS = new Set(['lastModified', 'lastModifiedBy']);

    class FirestoreConflictError extends Error {
        constructor(conflicts) {
            super('The same journal item changed on another device. Your changes were not overwritten.');
            this.name = 'FirestoreConflictError';
            this.conflicts = conflicts || [];
        }
    }

    function clone(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function cleanForFirestore(value) {
        if (value === undefined) return null;
        if (value === null || typeof value !== 'object') return value;
        if (Array.isArray(value)) return value.map(cleanForFirestore);
        return Object.fromEntries(
            Object.entries(value)
                .filter(([, child]) => child !== undefined)
                .map(([key, child]) => [key, cleanForFirestore(child)])
        );
    }

    function stableStringify(value) {
        if (value === null || typeof value !== 'object') return JSON.stringify(value);
        if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
        return '{' + Object.keys(value).sort()
            .map(key => JSON.stringify(key) + ':' + stableStringify(value[key]))
            .join(',') + '}';
    }

    function equal(left, right) {
        return stableStringify(left) === stableStringify(right);
    }

    function randomId() {
        if (root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID();
        return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
    }

    function hashString(value) {
        let hash = 2166136261;
        for (let index = 0; index < value.length; index++) {
            hash ^= value.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(16).padStart(8, '0');
    }

    function deterministicMigrationId(collection, item, index) {
        const content = stableStringify(stripSyncMetadata(item));
        return `migration-${index}-${hashString(collection + ':' + content)}`;
    }

    function safeDocumentId(value) {
        return encodeURIComponent(String(value)).replace(/\./g, '%2E');
    }

    function collectionItems(data, definition) {
        const source = data && data[definition.key];
        if (definition.shape === 'indexedObject') {
            return Object.entries(source || {})
                .filter(([slot, value]) => slot !== '0' && value && typeof value === 'object')
                .map(([slot, value], index) => Object.assign({}, value, {
                    _slot: String(value._slot || slot),
                    _syncOrder: Number.isFinite(value._syncOrder) ? value._syncOrder : index
                }));
        }
        return Array.isArray(source) ? source : [];
    }

    function ensureIdentities(data, idFactory) {
        const makeId = idFactory || randomId;
        COLLECTIONS.forEach(definition => {
            const items = collectionItems(data, definition);
            items.forEach((item, index) => {
                if (!item._syncId) {
                    const naturalId = definition.idField && item[definition.idField] !== undefined && item[definition.idField] !== null && item[definition.idField] !== ''
                        ? item[definition.idField]
                        : makeId(definition.key, item, index);
                    item._syncId = `${definition.prefix}-${safeDocumentId(naturalId)}`;
                }
                if (!Number.isFinite(item._syncOrder)) item._syncOrder = index;
            });

            if (definition.shape === 'indexedObject') {
                const rebuilt = {};
                items.forEach(item => { rebuilt[item._slot] = item; });
                data[definition.key] = rebuilt;
            } else {
                data[definition.key] = items;
            }
        });
        return data;
    }

    function normalizeData(data, idFactory) {
        return ensureIdentities(cleanForFirestore(clone(data || {})), idFactory);
    }

    function extractSettings(data) {
        const collectionKeys = new Set(COLLECTIONS.map(definition => definition.key));
        return Object.fromEntries(
            Object.entries(data || {}).filter(([key]) => !collectionKeys.has(key) && !TRANSIENT_ROOT_FIELDS.has(key))
        );
    }

    function collectionMap(data, definition) {
        return new Map(collectionItems(data, definition).map(item => [item._syncId, item]));
    }

    function diffSnapshots(baseData, nextData) {
        const base = normalizeData(baseData || {});
        const next = normalizeData(nextData || {});
        const operations = [];

        const baseSettings = extractSettings(base);
        const nextSettings = extractSettings(next);
        if (!equal(baseSettings, nextSettings)) {
            operations.push({ type: 'set', collection: 'settings', id: 'main', payload: nextSettings });
        }

        COLLECTIONS.forEach(definition => {
            const before = collectionMap(base, definition);
            const after = collectionMap(next, definition);
            after.forEach((payload, id) => {
                if (!before.has(id) || !equal(before.get(id), payload)) {
                    operations.push({ type: 'set', collection: definition.name, id, payload });
                }
            });
            before.forEach((payload, id) => {
                if (!after.has(id)) operations.push({ type: 'delete', collection: definition.name, id, payload });
            });
        });

        return operations;
    }

    function mergeValue(base, local, remote, path, conflicts) {
        const localChanged = !equal(base, local);
        const remoteChanged = !equal(base, remote);
        if (localChanged && remoteChanged && !equal(local, remote)) {
            conflicts.push(path);
            return local;
        }
        return localChanged ? local : remote;
    }

    function threeWayMerge(baseData, localData, remoteData) {
        const base = normalizeData(baseData || {});
        const local = normalizeData(localData || {});
        const remote = normalizeData(remoteData || {});
        const conflicts = [];
        const merged = {};

        const baseSettings = extractSettings(base);
        const localSettings = extractSettings(local);
        const remoteSettings = extractSettings(remote);
        new Set([...Object.keys(baseSettings), ...Object.keys(localSettings), ...Object.keys(remoteSettings)])
            .forEach(key => {
                const value = mergeValue(baseSettings[key], localSettings[key], remoteSettings[key], `settings.${key}`, conflicts);
                if (value !== undefined) merged[key] = clone(value);
            });

        COLLECTIONS.forEach(definition => {
            const before = collectionMap(base, definition);
            const localItems = collectionMap(local, definition);
            const remoteItems = collectionMap(remote, definition);
            const result = [];
            new Set([...before.keys(), ...localItems.keys(), ...remoteItems.keys()]).forEach(id => {
                const value = mergeValue(before.get(id), localItems.get(id), remoteItems.get(id), `${definition.key}.${id}`, conflicts);
                if (value !== undefined) result.push(clone(value));
            });
            result.sort((a, b) => (a._syncOrder || 0) - (b._syncOrder || 0));
            if (definition.shape === 'indexedObject') {
                merged[definition.key] = Object.fromEntries(result.map(item => [item._slot, item]));
            } else {
                merged[definition.key] = result;
            }
        });

        return { merged, conflicts };
    }

    function countCollections(data) {
        return Object.fromEntries(COLLECTIONS.map(definition => [definition.key, collectionItems(data || {}, definition).length]));
    }

    function stripSyncMetadata(value) {
        if (Array.isArray(value)) return value.map(stripSyncMetadata);
        if (value && typeof value === 'object') {
            return Object.fromEntries(Object.entries(value)
                .filter(([key]) => key !== '_syncId' && key !== '_syncOrder' && key !== '_slot' && !TRANSIENT_ROOT_FIELDS.has(key))
                .map(([key, child]) => [key, stripSyncMetadata(child)]));
        }
        return value;
    }

    function validateMigration(source, migrated) {
        const sourceCounts = countCollections(source);
        const migratedCounts = countCollections(migrated);
        const mismatches = Object.keys(sourceCounts)
            .filter(key => sourceCounts[key] !== migratedCounts[key])
            .map(key => `${key}: expected ${sourceCounts[key]}, found ${migratedCounts[key]}`);
        const contentMatches = equal(
            stripSyncMetadata(normalizeData(source || {})),
            stripSyncMetadata(normalizeData(migrated || {}))
        );
        if (!contentMatches) mismatches.push('journal record content differs from the migration source');
        return { valid: mismatches.length === 0, contentMatches, sourceCounts, migratedCounts, mismatches };
    }

    function checkpointClone(checkpoint) {
        return {
            data: clone(checkpoint.data),
            versions: Object.assign({}, checkpoint.versions || {})
        };
    }

    class JournalFirestoreStore {
        constructor(firebaseNamespace, database, user) {
            this.firebase = firebaseNamespace;
            this.db = database;
            this.user = user;
            this.userRef = database.collection('users').doc(user.uid);
            this.metaRef = this.userRef.collection('system').doc('meta');
            this.settingsRef = this.userRef.collection('settings').doc('main');
            this.currentCheckpoint = { data: {}, versions: {} };
            this.unsubscribers = [];
            this.changeHandler = null;
            this.notifyTimer = null;
        }

        refFor(collection, id) {
            if (collection === 'settings') return this.settingsRef;
            return this.userRef.collection(collection).doc(id);
        }

        versionKey(collection, id) {
            return `${collection}/${id}`;
        }

        wrapper(payload, revision) {
            return {
                payload: cleanForFirestore(payload),
                revision,
                updatedAt: this.firebase.firestore.FieldValue.serverTimestamp(),
                updatedBy: this.user.email || this.user.uid
            };
        }

        async hasMigration() {
            const snapshot = await this.metaRef.get();
            return snapshot.exists
                && snapshot.data().schemaVersion >= SCHEMA_VERSION
                && snapshot.data().migrationStatus === 'complete';
        }

        async acquireMigrationLease() {
            const owner = randomId();
            const now = Date.now();
            const result = await this.db.runTransaction(async transaction => {
                const snapshot = await transaction.get(this.metaRef);
                const current = snapshot.exists ? snapshot.data() : null;
                if (current && current.schemaVersion >= SCHEMA_VERSION && current.migrationStatus === 'complete') {
                    return 'complete';
                }
                if (current && current.migrationStatus === 'in-progress'
                    && current.migrationOwner !== owner
                    && now - (current.migrationStartedAtMs || 0) < 120000) {
                    return 'wait';
                }
                transaction.set(this.metaRef, {
                    schemaVersion: SCHEMA_VERSION,
                    migrationStatus: 'in-progress',
                    migrationOwner: owner,
                    migrationStartedAtMs: now
                }, { merge: true });
                return 'acquired';
            });

            if (result !== 'wait') return result;
            // Another newly opened device is doing the same atomic migration. Give it a
            // short window to finish, then load its validated result instead of racing it.
            for (let attempt = 0; attempt < 20; attempt++) {
                await new Promise(resolve => setTimeout(resolve, 500));
                if (await this.hasMigration()) return 'complete';
            }
            throw new Error('Another device is still migrating the journal. Wait a moment and reload.');
        }

        async migrateFromRealtimeDatabase(legacyData) {
            // Deterministic IDs make two simultaneous first launches idempotent: both
            // devices target the same Firestore documents instead of duplicating history.
            const normalized = normalizeData(legacyData, deterministicMigrationId);
            const operations = diffSnapshots({}, normalized);
            if (operations.length + 1 > MAX_MIGRATION_WRITES) {
                throw new Error(`Migration needs ${operations.length + 1} writes, above the ${MAX_MIGRATION_WRITES}-write safety limit.`);
            }

            const validation = validateMigration(legacyData, normalized);
            if (!validation.valid) throw new Error('Migration validation failed: ' + validation.mismatches.join('; '));

            const lease = await this.acquireMigrationLease();
            if (lease === 'complete') {
                const checkpoint = await this.load();
                const existingValidation = validateMigration(normalized, checkpoint.data);
                if (!existingValidation.valid) {
                    throw new Error('The completed Firestore migration does not match this Realtime Database snapshot: ' + existingValidation.mismatches.join('; '));
                }
                return { checkpoint, validation: existingValidation };
            }

            const batch = this.db.batch();
            operations.forEach(operation => {
                batch.set(this.refFor(operation.collection, operation.id), this.wrapper(operation.payload, 1));
            });
            batch.set(this.metaRef, {
                schemaVersion: SCHEMA_VERSION,
                migrationStatus: 'complete',
                migrationOwner: null,
                migratedAt: this.firebase.firestore.FieldValue.serverTimestamp(),
                migratedBy: this.user.email || this.user.uid,
                source: 'realtime-database/tradeData',
                sourceCounts: validation.sourceCounts,
                lastModified: this.firebase.firestore.FieldValue.serverTimestamp()
            });
            await batch.commit();

            const checkpoint = await this.load();
            const postValidation = validateMigration(normalized, checkpoint.data);
            if (!postValidation.valid) throw new Error('Post-migration validation failed: ' + postValidation.mismatches.join('; '));
            return { checkpoint, validation: postValidation };
        }

        async load() {
            const [metaSnapshot, settingsSnapshot, ...collectionSnapshots] = await Promise.all([
                this.metaRef.get(),
                this.settingsRef.get(),
                ...COLLECTIONS.map(definition => this.userRef.collection(definition.name).get())
            ]);
            if (!metaSnapshot.exists
                || metaSnapshot.data().schemaVersion < SCHEMA_VERSION
                || metaSnapshot.data().migrationStatus !== 'complete') {
                throw new Error('Firestore journal has not been migrated yet.');
            }

            const data = settingsSnapshot.exists ? clone(settingsSnapshot.data().payload || {}) : {};
            const versions = {};
            if (settingsSnapshot.exists) versions[this.versionKey('settings', 'main')] = settingsSnapshot.data().revision || 0;

            COLLECTIONS.forEach((definition, index) => {
                const items = collectionSnapshots[index].docs.map(document => {
                    const wrapper = document.data();
                    versions[this.versionKey(definition.name, document.id)] = wrapper.revision || 0;
                    const payload = clone(wrapper.payload || {});
                    payload._syncId = payload._syncId || document.id;
                    return payload;
                }).sort((a, b) => (a._syncOrder || 0) - (b._syncOrder || 0));
                data[definition.key] = definition.shape === 'indexedObject'
                    ? Object.fromEntries(items.map(item => [item._slot, item]))
                    : items;
            });

            const meta = metaSnapshot.data();
            const lastModified = meta.lastModified && typeof meta.lastModified.toDate === 'function'
                ? meta.lastModified.toDate().toISOString()
                : null;
            data.lastModified = lastModified;
            data.lastModifiedBy = meta.updatedBy || meta.migratedBy || null;
            this.currentCheckpoint = { data: normalizeData(data), versions };
            return checkpointClone(this.currentCheckpoint);
        }

        getCheckpoint() {
            return checkpointClone(this.currentCheckpoint);
        }

        scheduleNotification() {
            clearTimeout(this.notifyTimer);
            this.notifyTimer = setTimeout(() => {
                if (this.changeHandler) this.changeHandler(this.getCheckpoint());
            }, 30);
        }

        subscribe(handler, errorHandler) {
            this.unsubscribe();
            this.changeHandler = handler;
            const onError = errorHandler || (error => console.error('Firestore listener failed:', error));

            this.unsubscribers.push(this.settingsRef.onSnapshot({ includeMetadataChanges: true }, snapshot => {
                if (snapshot.metadata.hasPendingWrites) return;
                const nextSettings = snapshot.exists ? clone(snapshot.data().payload || {}) : {};
                const current = this.currentCheckpoint.data;
                const collections = Object.fromEntries(COLLECTIONS.map(definition => [definition.key, current[definition.key]]));
                this.currentCheckpoint.data = normalizeData(Object.assign({}, nextSettings, collections));
                const key = this.versionKey('settings', 'main');
                if (snapshot.exists) this.currentCheckpoint.versions[key] = snapshot.data().revision || 0;
                else delete this.currentCheckpoint.versions[key];
                this.scheduleNotification();
            }, onError));

            COLLECTIONS.forEach(definition => {
                const unsubscribe = this.userRef.collection(definition.name)
                    .onSnapshot({ includeMetadataChanges: true }, snapshot => {
                        if (snapshot.metadata.hasPendingWrites) return;
                        const items = snapshot.docs.map(document => {
                            const wrapper = document.data();
                            this.currentCheckpoint.versions[this.versionKey(definition.name, document.id)] = wrapper.revision || 0;
                            const payload = clone(wrapper.payload || {});
                            payload._syncId = payload._syncId || document.id;
                            return payload;
                        }).sort((a, b) => (a._syncOrder || 0) - (b._syncOrder || 0));
                        const liveIds = new Set(snapshot.docs.map(document => this.versionKey(definition.name, document.id)));
                        Object.keys(this.currentCheckpoint.versions)
                            .filter(key => key.startsWith(definition.name + '/') && !liveIds.has(key))
                            .forEach(key => delete this.currentCheckpoint.versions[key]);
                        this.currentCheckpoint.data[definition.key] = definition.shape === 'indexedObject'
                            ? Object.fromEntries(items.map(item => [item._slot, item]))
                            : items;
                        this.scheduleNotification();
                    }, onError);
                this.unsubscribers.push(unsubscribe);
            });
        }

        unsubscribe() {
            this.unsubscribers.forEach(unsubscribe => unsubscribe());
            this.unsubscribers = [];
            clearTimeout(this.notifyTimer);
        }

        async save(localData, baseCheckpoint) {
            const normalized = normalizeData(localData);
            const base = baseCheckpoint || this.getCheckpoint();
            const operations = diffSnapshots(base.data, normalized);
            if (operations.length === 0) return this.getCheckpoint();
            if (operations.length + 1 > MAX_MIGRATION_WRITES) {
                throw new Error(`This action needs ${operations.length + 1} writes, above the ${MAX_MIGRATION_WRITES}-write safety limit. No cloud data was changed.`);
            }

            const expectedVersions = base.versions || {};
            await this.db.runTransaction(async transaction => {
                const snapshots = await Promise.all(operations.map(operation => transaction.get(this.refFor(operation.collection, operation.id))));
                const conflicts = [];
                snapshots.forEach((snapshot, index) => {
                    const operation = operations[index];
                    const expected = expectedVersions[this.versionKey(operation.collection, operation.id)] || 0;
                    const actual = snapshot.exists ? (snapshot.data().revision || 0) : 0;
                    if (actual !== expected) conflicts.push(`${operation.collection}/${operation.id}`);
                });
                if (conflicts.length) throw new FirestoreConflictError(conflicts);

                operations.forEach((operation, index) => {
                    const reference = this.refFor(operation.collection, operation.id);
                    const previousRevision = snapshots[index].exists ? (snapshots[index].data().revision || 0) : 0;
                    if (operation.type === 'delete') transaction.delete(reference);
                    else transaction.set(reference, this.wrapper(operation.payload, previousRevision + 1));
                });
                transaction.set(this.metaRef, {
                    schemaVersion: SCHEMA_VERSION,
                    migrationStatus: 'complete',
                    lastModified: this.firebase.firestore.FieldValue.serverTimestamp(),
                    updatedBy: this.user.email || this.user.uid
                }, { merge: true });
            });

            const nextData = clone(this.currentCheckpoint.data);
            const nextVersions = Object.assign({}, this.currentCheckpoint.versions);
            const applied = threeWayMerge(base.data, normalized, nextData);
            this.currentCheckpoint.data = normalizeData(applied.conflicts.length ? normalized : applied.merged);
            operations.forEach(operation => {
                const key = this.versionKey(operation.collection, operation.id);
                if (operation.type === 'delete') delete nextVersions[key];
                else nextVersions[key] = (expectedVersions[key] || 0) + 1;
            });
            this.currentCheckpoint.versions = nextVersions;
            return this.getCheckpoint();
        }

        async createBackup(data, metadata, documentId) {
            const cleanData = root.TradeSyncSafety
                ? root.TradeSyncSafety.sanitizeBackupData(data)
                : clone(data);
            const id = documentId || ('event-' + new Date().toISOString().replace(/[.:]/g, '-'));
            await this.userRef.collection('backups').doc(id).set({
                backupMetadata: Object.assign({
                    schemaVersion: SCHEMA_VERSION,
                    exportedAt: new Date().toISOString(),
                    apiKeysIncluded: false
                }, metadata || {}),
                tradeData: cleanForFirestore(cleanData),
                createdAt: this.firebase.firestore.FieldValue.serverTimestamp()
            });
        }

        async createDailyBackup(data, dateKey, keepCount) {
            const reference = this.userRef.collection('backups').doc(`daily-${dateKey}`);
            const existing = await reference.get();
            if (!existing.exists) {
                await this.createBackup(data, { type: 'daily' }, `daily-${dateKey}`);
            }
            const snapshots = await this.userRef.collection('backups').get();
            const dailyIds = snapshots.docs.map(document => document.id).filter(id => id.startsWith('daily-')).sort();
            const limit = Math.max(1, keepCount || 30);
            const stale = dailyIds.slice(0, Math.max(0, dailyIds.length - limit));
            if (stale.length) {
                const batch = this.db.batch();
                stale.forEach(id => batch.delete(this.userRef.collection('backups').doc(id)));
                await batch.commit();
            }
        }
    }

    const api = {
        SCHEMA_VERSION,
        COLLECTIONS,
        FirestoreConflictError,
        JournalFirestoreStore,
        cleanForFirestore,
        deterministicMigrationId,
        ensureIdentities,
        normalizeData,
        extractSettings,
        diffSnapshots,
        threeWayMerge,
        countCollections,
        validateMigration
    };

    root.TradeFirestoreSync = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
