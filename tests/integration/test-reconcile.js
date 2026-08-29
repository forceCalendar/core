/**
 * Test diff-based snapshot loading: Event.isEquivalent, EventStore.reconcile
 * and Calendar.setEvents/reconcileEvents
 */

import { Event } from '../../core/events/Event.js';
import { EventStore } from '../../core/events/EventStore.js';
import { Calendar } from '../../core/calendar/Calendar.js';

console.log('Testing reconcile functionality...\n');

let failures = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`  ✅ ${message}`);
    } else {
        console.log(`  ❌ ${message}`);
        failures++;
    }
}

function assertThrows(fn, pattern, message) {
    try {
        fn();
        assert(false, `${message} (did not throw)`);
    } catch (error) {
        assert(pattern.test(error.message), `${message} (${error.message})`);
    }
}

function data(id, extra = {}) {
    return {
        id,
        title: `Event ${id}`,
        start: new Date('2025-03-10T10:00:00Z'),
        end: new Date('2025-03-10T11:00:00Z'),
        timeZone: 'UTC',
        ...extra
    };
}

function ids(events) {
    return events.map(e => (e.event ? e.event.id : e.id)).sort();
}

console.log('=== Test 1: Event.isEquivalent covers the full data surface ===');
const base = new Event(data('x', { backgroundColor: 'red', attendees: [{ name: 'A', email: 'a@b.co' }] }));
assert(Event.isEquivalent(base, base.clone()), 'Clone is equivalent to original');
assert(Event.isEquivalent(base, data('x', { backgroundColor: 'red', attendees: [{ name: 'A', email: 'a@b.co' }] })), 'Raw data equivalent to Event built from it');
assert(!Event.isEquivalent(base, base.clone({ backgroundColor: 'blue' })), 'Background colour difference detected');
assert(base.equals(base.clone({ backgroundColor: 'blue' })), 'equals() is unchanged and still ignores colours');
assert(!Event.isEquivalent(base, base.clone({ attendees: [] })), 'Attendee difference detected');
assert(!Event.isEquivalent(base, base.clone({ attendees: [{ name: 'A', email: 'a@b.co', responseStatus: 'accepted' }] })), 'Nested attendee field difference detected');
assert(!Event.isEquivalent(base, base.clone({ metadata: { sfId: '1' } })), 'Metadata difference detected');
assert(
    Event.isEquivalent(
        base.clone({ metadata: { a: 1, b: { c: [1, 2] } } }),
        base.clone({ metadata: { b: { c: [1, 2] }, a: 1 } })
    ),
    'Metadata key order is ignored'
);
assert(!Event.isEquivalent(base, base.clone({ location: 'Room 1' })), 'Location difference detected');
assert(!Event.isEquivalent(base, base.clone({ timeZone: 'Europe/Paris' })), 'Timezone difference detected');
assert(!Event.isEquivalent(base, base.clone({ visibility: 'private' })), 'Visibility difference detected');
assert(!Event.isEquivalent(base, base.clone({ categories: ['work'] })), 'Category difference detected');
assert(!Event.isEquivalent(base, base.clone({ reminders: [{ method: 'email', minutesBefore: 10 }] })), 'Reminder difference detected');
assert(!Event.isEquivalent(base, base.clone({ end: new Date('2025-03-10T12:00:00Z') })), 'End time difference detected');
assert(!Event.isEquivalent(base, base.clone({ id: 'y' })), 'Different ids are never equivalent');
assert(
    Event.isEquivalent(data('c', { color: 'red' }), data('c', { color: 'red', backgroundColor: 'red', borderColor: 'red' })),
    'Colour alias is normalized before comparison'
);
assert(
    Event.isEquivalent(data('d'), { ...data('d'), start: '2025-03-10T10:00:00Z', end: '2025-03-10T11:00:00Z' }),
    'Date objects and ISO strings compare by timestamp'
);
assert(
    Event.isEquivalent(
        data('r', { recurring: true, recurrenceRule: { freq: 'DAILY', count: 3 } }),
        data('r', { recurring: true, recurrenceRule: { count: 3, freq: 'DAILY' } })
    ),
    'Object recurrence rules compare structurally'
);
assert(!Event.isEquivalent(base, null), 'null is not equivalent');
assert(Event.isEquivalent(null, null), 'Same reference (null) is equivalent');
assertThrows(() => Event.isEquivalent(base, { id: 'bad' }), /title/, 'Invalid raw data throws a validation error');

console.log('\n=== Test 2: EventStore.reconcile applies only the differences ===');
const store = new EventStore();
store.loadEvents([data('a'), data('b'), data('c')]);
const originalA = store.getEvent('a');
const originalB = store.getEvent('b');
const versionBefore = store.version;

const notifications = [];
store.subscribe(change => notifications.push(change));

const result = store.reconcile([data('a'), data('b', { title: 'Renamed B' }), data('d')]);

assert(ids(result.added).join() === 'd', 'New event reported as added');
assert(ids(result.updated).join() === 'b', 'Changed event reported as updated');
assert(result.updated[0].oldEvent === originalB, 'Update carries the previous instance as oldEvent');
assert(result.updated[0].event.title === 'Renamed B', 'Update carries the new instance as event');
assert(ids(result.removed).join() === 'c', 'Missing event reported as removed');
assert(ids(result.unchanged).join() === 'a', 'Equivalent event reported as unchanged');
assert(result.unchanged[0] === originalA, 'Unchanged entry is the stored instance');
assert(store.getEvent('a') === originalA, 'Unchanged event keeps its identity in the store');
assert(store.getEvent('b') === result.updated[0].event, 'Updated event is the incoming instance');
assert(store.getEvent('c') === null, 'Removed event is gone from the store');
assert(store.getAllEvents().length === 3, 'Store holds exactly the snapshot');
assert(notifications.length === 1, 'Exactly one notification emitted');
assert(notifications[0].type === 'batch', 'Notification is a batch');
assert(
    notifications[0].changes.map(c => c.type).sort().join() === 'add,remove,update',
    'Batch lists one add, one remove and one update'
);
assert(notifications[0].count === 3, 'Batch count matches the number of changes');
assert(store.version > versionBefore, 'Store version advanced');
assert(store.isBatchMode === false, 'Batch mode is closed after reconcile');

console.log('\n=== Test 3: Identical snapshot is a no-op ===');
notifications.length = 0;
const versionIdle = store.version;
const idle = store.reconcile([data('a'), data('b', { title: 'Renamed B' }), data('d')]);
assert(idle.added.length === 0 && idle.updated.length === 0 && idle.removed.length === 0, 'No changes reported');
assert(idle.unchanged.length === 3, 'All entries reported as unchanged');
assert(notifications.length === 0, 'No notification emitted');
assert(store.version === versionIdle, 'Store version unchanged');

console.log('\n=== Test 4: removeMissing:false keeps extras ===');
notifications.length = 0;
const partial = store.reconcile([data('e')], { removeMissing: false });
assert(partial.added.length === 1 && partial.removed.length === 0, 'Only the new event is added');
assert(partial.unchanged.length === 0, 'Events absent from the snapshot are not reported as unchanged');
assert(store.getAllEvents().length === 4, 'Existing events are retained');
assert(notifications.length === 1 && notifications[0].changes.length === 1, 'Single batch with one add');

console.log('\n=== Test 5: Field-level changes count as updates ===');
const fieldStore = new EventStore();
fieldStore.loadEvents([data('f', { backgroundColor: '#fff', attendees: [{ name: 'A', email: 'a@b.co' }] })]);
const colourOnly = fieldStore.reconcile([data('f', { backgroundColor: '#000', attendees: [{ name: 'A', email: 'a@b.co' }] })]);
assert(colourOnly.updated.length === 1 && colourOnly.unchanged.length === 0, 'Colour-only change is an update');
const attendeeOnly = fieldStore.reconcile([data('f', { backgroundColor: '#000', attendees: [] })]);
assert(attendeeOnly.updated.length === 1, 'Attendee-only change is an update');
const metadataOnly = fieldStore.reconcile([data('f', { backgroundColor: '#000', metadata: { source: 'sf' } })]);
assert(metadataOnly.updated.length === 1, 'Metadata-only change is an update');
assert(fieldStore.getEvent('f').metadata.source === 'sf', 'Store reflects the latest metadata');

console.log('\n=== Test 6: Indices stay consistent through reconcile ===');
const indexStore = new EventStore({ timezone: 'UTC' });
indexStore.loadEvents([data('m', { categories: ['work'] }), data('gone')]);
indexStore.reconcile([
    data('m', { start: new Date('2025-03-12T10:00:00Z'), end: new Date('2025-03-12T11:00:00Z'), categories: ['home'] }),
    data('rec', { recurring: true, recurrenceRule: 'FREQ=DAILY;COUNT=3' })
]);
assert(indexStore.getEventsForDate(new Date('2025-03-10T12:00:00Z')).every(e => e.id !== 'm'), 'Moved event left its old date');
assert(indexStore.getEventsForDate(new Date('2025-03-12T12:00:00Z')).some(e => e.id === 'm'), 'Moved event is found on its new date');
assert(indexStore.queryEvents({ categories: ['work'] }).length === 0, 'Old category index entry removed');
assert(indexStore.queryEvents({ categories: ['home'] }).length === 1, 'New category index entry added');
assert(indexStore.getEventsForDate(new Date('2025-03-10T12:00:00Z')).every(e => e.id !== 'gone'), 'Removed event is not returned by date queries');
assert(indexStore.indices.recurring.has('rec'), 'Recurring index updated for added event');
assert(
    indexStore.getEventsInRange(new Date('2025-03-12T00:00:00Z'), new Date('2025-03-12T23:59:59Z')).some(e => e.metadata?.recurringEventId === 'rec' || e.id === 'rec'),
    'Recurring event added via reconcile expands in range queries'
);
indexStore.reconcile([data('m', { start: new Date('2025-03-12T10:00:00Z'), end: new Date('2025-03-12T11:00:00Z'), categories: ['home'] })]);
assert(!indexStore.indices.recurring.has('rec'), 'Recurring index cleaned up for removed event');

console.log('\n=== Test 7: Input validation happens before mutation ===');
const guardStore = new EventStore();
guardStore.loadEvents([data('keep')]);
const guardVersion = guardStore.version;
assertThrows(() => guardStore.reconcile([data('dup'), data('dup')]), /Duplicate event id/, 'Duplicate ids are rejected');
assert(guardStore.getEvent('keep') !== null && guardStore.getAllEvents().length === 1, 'Store untouched after duplicate id error');
assertThrows(() => guardStore.reconcile([data('ok'), { id: 'bad', start: new Date() }]), /title/, 'Invalid entries are rejected');
assert(guardStore.getEvent('keep') !== null && guardStore.getAllEvents().length === 1, 'Store untouched after validation error');
assert(guardStore.version === guardVersion, 'Version untouched after rejected input');
assertThrows(() => guardStore.reconcile(null), /iterable/, 'Non-iterable input is rejected');
assertThrows(() => guardStore.reconcile([], { isEquivalent: 'nope' }), /isEquivalent/, 'Non-function comparator is rejected');
assert(guardStore.isBatchMode === false, 'Batch mode not left open after errors');

console.log('\n=== Test 8: Errors while applying roll the store back ===');
const rollbackStore = new EventStore();
rollbackStore.loadEvents([data('r1'), data('r2')]);
const rollbackVersion = rollbackStore.version;
const rollbackLog = [];
rollbackStore.subscribe(change => rollbackLog.push(change.type));
assertThrows(
    () =>
        rollbackStore.reconcile([data('r1', { title: 'changed' }), data('r3')], {
            isEquivalent: () => {
                throw new Error('comparator failed');
            }
        }),
    /comparator failed/,
    'Comparator error propagates'
);
assert(rollbackStore.getAllEvents().length === 2, 'Event count restored after rollback');
assert(rollbackStore.getEvent('r3') === null && rollbackStore.getEvent('r2') !== null, 'Store contents restored after rollback');
assert(rollbackStore.version === rollbackVersion, 'Version restored after rollback');
assert(rollbackLog.length === 0, 'No notification emitted for a rolled back reconcile');
assert(rollbackStore.isBatchMode === false, 'Batch mode closed after rollback');

console.log('\n=== Test 9: Custom comparator and nested batches ===');
const customStore = new EventStore();
customStore.loadEvents([data('t', { location: 'A' })]);
const custom = customStore.reconcile([data('t', { location: 'B' })], {
    isEquivalent: (a, b) => a.title === b.title
});
assert(custom.unchanged.length === 1 && custom.updated.length === 0, 'Custom comparator decides equivalence');
assert(customStore.getEvent('t').location === 'A', 'Stored event untouched when comparator says equivalent');

const nestedLog = [];
customStore.subscribe(change => nestedLog.push(change));
customStore.startBatch();
customStore.reconcile([data('t', { location: 'B' }), data('u')]);
assert(nestedLog.length === 0, 'No notification while the outer batch is open');
assert(customStore.isBatchMode === true, 'Outer batch stays open');
customStore.addEvent(data('v'));
customStore.commitBatch();
assert(nestedLog.length === 1 && nestedLog[0].type === 'batch', 'Outer batch emits once');
assert(
    nestedLog[0].changes.map(c => c.type).join() === 'update,add,add',
    'Reconcile changes are queued on the outer batch in order'
);

console.log('\n=== Test 10: updateEvent still works after refactor ===');
const updLog = [];
customStore.subscribe(change => updLog.push(change));
const beforeUpdate = customStore.getEvent('u');
const afterUpdate = customStore.updateEvent('u', { title: 'U2' });
assert(updLog.length === 1 && updLog[0].type === 'update', 'updateEvent emits a single update');
assert(updLog[0].oldEvent === beforeUpdate && updLog[0].event === afterUpdate, 'update change carries old and new instances');
assert(customStore.getEvent('u').title === 'U2', 'updateEvent stores the clone');

console.log('\n=== Test 11: Calendar.setEvents payload and reconcile option ===');
const calendar = new Calendar({ timeZone: 'UTC' });
const calEvents = [];
calendar.on('eventsSet', payload => calEvents.push(payload));
const mutations = [];
calendar.on('eventAdd', () => mutations.push('add'));
calendar.on('eventUpdate', () => mutations.push('update'));
calendar.on('eventRemove', () => mutations.push('remove'));
const storeChanges = [];
calendar.on('eventStoreChange', change => storeChanges.push(change.type));

const first = calendar.setEvents([data('a'), data('b')]);
assert(first.events.length === 2 && first.added.length === 2, 'Initial setEvents reports every event as added');
assert(first.removed.length === 0 && first.updated.length === 0 && first.unchanged.length === 0, 'Initial setEvents has nothing removed/updated/unchanged');
assert(calEvents.length === 1 && calEvents[0] === first, 'eventsSet payload is the returned change set');
assert(Object.keys(calEvents[0]).join() === 'events,added,updated,removed,unchanged', 'eventsSet payload keeps events first and adds the diff');

const keptA = calendar.getEvent('a');
const second = calendar.setEvents([data('a'), data('c')]);
assert(ids(second.removed).join() === 'a,b', 'Plain setEvents reports every previous event as removed');
assert(ids(second.added).join() === 'a,c', 'Plain setEvents reports the new snapshot as added');
assert(calendar.getEvent('a') !== keptA, 'Plain setEvents still replaces instances');
assert(storeChanges.join() === 'clear,batch,clear,batch', 'Plain setEvents still emits clear + batch');

storeChanges.length = 0;
const keptA2 = calendar.getEvent('a');
const versionBeforeReconcile = calendar.getEventsVersion();
const third = calendar.setEvents([data('a'), data('c', { title: 'C2' }), data('d')], { reconcile: true });
assert(calendar.getEvent('a') === keptA2, 'setEvents({ reconcile: true }) preserves unchanged instances');
assert(ids(third.added).join() === 'd' && ids(third.updated).join() === 'c' && third.removed.length === 0, 'setEvents({ reconcile: true }) reports the diff');
assert(ids(third.unchanged).join() === 'a', 'setEvents({ reconcile: true }) reports unchanged events');
assert(third.events.length === 3, 'Payload lists all resulting events');
assert(storeChanges.join() === 'batch', 'Reconcile emits a single batch store change');
assert(calEvents.length === 3 && calEvents[2] === third, 'eventsSet emitted once for reconcile');
assert(mutations.length === 0, 'No eventAdd/eventUpdate/eventRemove emitted by snapshot loads');
assert(calendar.getEventsVersion() > versionBeforeReconcile, 'getEventsVersion advances when reconcile changes something');

const versionIdleCal = calendar.getEventsVersion();
const fourth = calendar.reconcileEvents([data('a'), data('c', { title: 'C2' }), data('d')]);
assert(fourth.added.length === 0 && fourth.updated.length === 0 && fourth.removed.length === 0, 'reconcileEvents with an identical snapshot changes nothing');
assert(calendar.getEventsVersion() === versionIdleCal, 'getEventsVersion is stable when nothing changed');
assert(calEvents.length === 4, 'eventsSet still emitted for a no-op reconcile');

const fifth = calendar.reconcileEvents([data('z')], { removeMissing: false });
assert(fifth.added.length === 1 && calendar.getEvents().length === 4, 'reconcileEvents forwards removeMissing');
const sixth = calendar.reconcileEvents([data('z', { location: 'moved' })], {
    removeMissing: false,
    isEquivalent: (a, b) => a.id === b.id
});
assert(sixth.unchanged.length === 1 && calendar.getEvent('z').location === '', 'reconcileEvents forwards a custom comparator');

console.log('\n=== Test 12: Calendar timezone is applied to raw snapshot data ===');
const tzCalendar = new Calendar({ timeZone: 'America/New_York' });
const noTz = { id: 'tz', title: 'No timezone', start: new Date('2025-03-10T10:00:00'), end: new Date('2025-03-10T11:00:00') };
tzCalendar.reconcileEvents([noTz]);
assert(tzCalendar.getEvent('tz').timeZone === 'America/New_York', 'Raw data without timeZone gets the calendar timezone');
const tzAgain = tzCalendar.reconcileEvents([{ ...noTz }]);
assert(tzAgain.unchanged.length === 1, 'Same raw data is unchanged on the next snapshot');
const explicitTz = new Event({ ...noTz, timeZone: 'UTC' });
const tzSwitch = tzCalendar.reconcileEvents([explicitTz]);
assert(tzSwitch.updated.length === 1 && tzCalendar.getEvent('tz') === explicitTz, 'Event instances are stored as-is');
assert(tzCalendar.eventStore.isBatchMode === false, 'Calendar store batch closed');

if (failures > 0) {
    console.log(`\n❌ Reconcile test failed: ${failures} assertion(s)`);
    process.exit(1);
}

console.log('\n✅ Reconcile functionality test complete!');
process.exit(0);
