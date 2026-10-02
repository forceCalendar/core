/** Regression coverage for the full Calendar -> EventStore -> optimizer teardown chain. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { Calendar, EnhancedCalendar, EventStore } from '../../core/index.js';
import { PerformanceOptimizer } from '../../core/performance/PerformanceOptimizer.js';
import { AdaptiveMemoryManager } from '../../core/performance/AdaptiveMemoryManager.js';

// Unlike older tests that call process.exit(), this checks whether a real consumer
// can exit naturally after destroying its calendars, with no timer unref hacks.
const entry = new URL('../../core/index.js', import.meta.url).href;
const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { Calendar, EnhancedCalendar, EventStore } from ${JSON.stringify(entry)};
    for (const Constructor of [Calendar, EnhancedCalendar, EventStore]) {
        const instance = new Constructor();
        instance.destroy();
        instance.destroy();
    }
`], { encoding: 'utf8', timeout: 5000 });
assert.equal(child.error, undefined, `Destroyed calendars must not keep Node alive: ${child.error}`);
assert.equal(child.status, 0, child.stderr);

// Numeric handles, including zero, cover browsers and timer-hosting environments
// independently of Node's Timeout objects. Nothing here relies on private handles.
const originalTimers = {
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout
};
const timers = new Map();
let nextHandle = 0;
const installTimer = (callback, delay) => {
    const handle = nextHandle++;
    timers.set(handle, { callback, delay });
    return handle;
};
globalThis.setInterval = installTimer;
globalThis.setTimeout = installTimer;
globalThis.clearInterval = handle => timers.delete(handle);
globalThis.clearTimeout = handle => timers.delete(handle);

try {
    for (const Constructor of [AdaptiveMemoryManager, PerformanceOptimizer, EventStore, Calendar, EnhancedCalendar]) {
        const instance = new Constructor();
        const manager = instance instanceof AdaptiveMemoryManager
            ? instance
            : (instance.optimizer || instance.eventStore?.optimizer || instance).memoryManager;
        assert.ok(timers.size > 0, `${Constructor.name} creates monitoring timers`);
        instance.destroy();
        instance.destroy();
        assert.equal(timers.size, 0, `${Constructor.name}.destroy clears all timers`);
        assert.equal(manager.monitoringInterval, null);
        assert.equal(manager.caches.size, 0);
    }

    const optimizer = new PerformanceOptimizer();
    let ranBatch = false;
    const batchResult = optimizer.batch(() => { ranBatch = true; }).catch(error => error);
    const markers = optimizer.createLazyIndexMarkers({
        id: 'long-event', start: new Date(2026, 0, 1), end: new Date(2027, 0, 1)
    });
    const indexedBefore = new Set(markers.indexed);
    const indexResult = optimizer.expandLazyIndex('long-event', new Date(2026, 2, 1), new Date(2026, 2, 3))
        .catch(error => error);
    const queuedCallbacks = Array.from(timers.values(), timer => timer.callback);
    optimizer.destroy();
    assert.equal(timers.size, 0, 'Destroy cancels pending lazy indexing and batch timers');
    assert.match((await batchResult).message, /destroyed/i);
    assert.match((await indexResult).message, /destroyed/i);
    assert.equal(optimizer.batchQueue.length, 0);
    assert.equal(optimizer.batchCallbacks.length, 0);
    assert.equal(optimizer.pendingIndexes.size, 0);
    assert.equal(markers.pending, false);
    // A callback already queued by its host must not resume work after teardown.
    for (const callback of queuedCallbacks) callback();
    assert.equal(ranBatch, false);
    assert.deepEqual(markers.indexed, indexedBefore);
    await assert.rejects(optimizer.batch(() => {}), /destroyed/i);
    await assert.rejects(optimizer.expandLazyIndex('long-event', new Date(), new Date()), /destroyed/i);
    optimizer.startCleanupTimer();
    optimizer.memoryManager.startMonitoring();
    assert.equal(timers.size, 0, 'Destroyed instances cannot restart background work');

    // Updating an event can replace its lazy markers while an old expansion is
    // queued. Both independent tasks must be tracked, even though the ID matches.
    const replacements = new PerformanceOptimizer();
    const event = { id: 'same-id', start: new Date(2026, 0, 1), end: new Date(2027, 0, 1) };
    const oldMarkers = replacements.createLazyIndexMarkers(event);
    const oldResult = replacements.expandLazyIndex(event.id, event.start, event.end).catch(error => error);
    const newMarkers = replacements.createLazyIndexMarkers(event);
    const newResult = replacements.expandLazyIndex(event.id, event.start, event.end).catch(error => error);
    assert.equal(replacements.pendingIndexTasks.size, 2);
    replacements.destroy();
    assert.equal(timers.size, 0, 'Every replaced expansion timer is cleared');
    assert.match((await oldResult).message, /destroyed/i);
    assert.match((await newResult).message, /destroyed/i);
    assert.equal(oldMarkers.pending, false);
    assert.equal(newMarkers.pending, false);
    assert.equal(replacements.pendingIndexTasks.size, 0);

    const completion = new PerformanceOptimizer({ enableAdaptiveMemory: false, cleanupInterval: 0 });
    completion.createLazyIndexMarkers(event);
    const firstResult = completion.expandLazyIndex(event.id, event.start, event.start);
    const firstHandle = Array.from(timers.keys())[0];
    completion.createLazyIndexMarkers(event);
    const secondResult = completion.expandLazyIndex(event.id, event.end, event.end);
    const secondPromise = completion.pendingIndexes.get(event.id);
    const firstCallback = timers.get(firstHandle).callback;
    timers.delete(firstHandle); // The host removes a one-shot timer before firing.
    firstCallback();
    assert.equal((await firstResult).size, 1);
    assert.equal(completion.pendingIndexes.get(event.id), secondPromise, 'Old completions preserve the new pending entry');
    assert.equal(completion.pendingIndexTasks.size, 1);
    const [secondHandle, secondTimer] = Array.from(timers.entries())[0];
    timers.delete(secondHandle);
    secondTimer.callback();
    assert.equal((await secondResult).size, 1);
    assert.equal(completion.pendingIndexes.size, 0);
    assert.equal(completion.pendingIndexTasks.size, 0);
    const batch = completion.batch(() => 42);
    const [batchHandle, batchTimer] = Array.from(timers.entries())[0];
    timers.delete(batchHandle);
    batchTimer.callback();
    assert.equal(await batch, 42, 'Live batch work still completes normally');
    completion.destroy();
    assert.equal(timers.size, 0);

    const midBatch = new PerformanceOptimizer({ batchSize: 2 });
    let ranAfterDestroy = false;
    const firstBatchResult = midBatch.batch(() => {
        midBatch.destroy();
        return 'completed';
    });
    const cancelledBatchResult = midBatch.batch(() => {
        ranAfterDestroy = true;
        return 42;
    }).catch(error => error);
    assert.equal(await firstBatchResult, 'completed');
    assert.match((await cancelledBatchResult).message, /destroyed/i);
    assert.equal(ranAfterDestroy, false, 'Destroy within a batch cancels the remaining operations');
    assert.equal(timers.size, 0);

    const manager = new AdaptiveMemoryManager({ adaptiveScaling: false });
    let finishMemoryRead;
    manager.getMemoryUsage = () => new Promise(resolve => { finishMemoryRead = resolve; });
    const pendingCheck = manager.checkNow();
    manager.destroy();
    finishMemoryRead(0.85);
    await pendingCheck;
    assert.equal(manager.stats.lastCheckTime, null, 'An in-flight check does not run after destroy');
    assert.equal(manager.stats.adjustments, 0);

    const calendar = new Calendar();
    let destroys = 0;
    calendar.on('destroy', () => {
        destroys++;
        calendar.destroy();
    });
    calendar.destroy();
    assert.equal(destroys, 1, 'Destroy is safe from its own listener');
    assert.equal(calendar.state.globalListeners.size, 0, 'Destroy releases its state subscription');
    assert.equal(timers.size, 0);

    const store = new EventStore();
    let clears = 0;
    store.subscribe(change => {
        if (change.type === 'clear') {
            clears++;
            store.destroy();
        }
    });
    store.destroy();
    assert.equal(clears, 1, 'Store destruction is safe from clear notifications');
    assert.equal(timers.size, 0);

    for (const config of [
        { enableAdaptiveMemory: false },
        { cleanupInterval: 0 },
        { enableAdaptiveMemory: false, cleanupInterval: 0 }
    ]) {
        const instance = new PerformanceOptimizer(config);
        instance.destroy();
        instance.destroy();
        assert.equal(timers.size, 0, 'Disabled optional resources are safe to destroy');
    }
} finally {
    Object.assign(globalThis, originalTimers);
}
console.log('Lifecycle regression tests passed');
