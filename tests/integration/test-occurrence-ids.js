/**
 * Test that occurrence ids taken from view data resolve consistently
 * everywhere: selection, id resolution, the occurrence iterators and
 * reconcile snapshots that contain occurrences.
 */

import { Event } from '../../core/events/Event.js';
import { RecurrenceEngine } from '../../core/events/RecurrenceEngine.js';
import { RecurrenceEngineV2 } from '../../core/events/RecurrenceEngineV2.js';
import { EventStore } from '../../core/events/EventStore.js';
import { Calendar } from '../../core/calendar/Calendar.js';
import { EnhancedCalendar } from '../../core/integration/EnhancedCalendar.js';

console.log('Testing occurrence id resolution...\n');

let failures = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`  ✅ ${message}`);
    } else {
        console.log(`  ❌ ${message}`);
        failures++;
    }
}

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const throwsMatching = (fn, pattern) => {
    try {
        fn();
    } catch (error) {
        return pattern.test(error.message) ? true : `wrong message: ${error.message}`;
    }
    return 'did not throw';
};

function makeCalendar(Klass = Calendar) {
    const calendar = new Klass({ timeZone: TZ, weekStartsOn: 1, date: new Date(2025, 5, 15) });
    calendar.addEvent({
        id: 'daily',
        title: 'Daily',
        start: new Date(2025, 5, 2, 9),
        end: new Date(2025, 5, 2, 10),
        timeZone: TZ,
        recurrenceRule: 'FREQ=DAILY'
    });
    calendar.addEvent({
        id: 'plain',
        title: 'Plain',
        start: new Date(2025, 5, 11, 13),
        end: new Date(2025, 5, 11, 14),
        timeZone: TZ
    });
    return calendar;
}

console.log('=== Test 1: selectEvent with an occurrence id ===');
{
    const calendar = makeCalendar();
    const occurrence = calendar.getEventsForDate(new Date(2025, 5, 11)).find(e => e.recurringEventId === 'daily');
    const payloads = [];
    calendar.on('eventSelect', payload => payloads.push(payload));

    calendar.selectEvent(occurrence.id);
    assert(calendar.state.get('selectedEventId') === 'daily', 'State holds the master id');
    assert(payloads.length === 1 && payloads[0].event.id === 'daily' && payloads[0].eventId === 'daily', 'Payload carries the master');
    assert(payloads[0].occurrenceId === occurrence.id, 'Payload carries the occurrence id');
    assert(
        payloads[0].occurrence instanceof Event &&
            payloads[0].occurrence.id === occurrence.id &&
            payloads[0].occurrence.isOccurrence &&
            payloads[0].occurrence.start.getTime() === occurrence.start.getTime(),
        'Payload carries the occurrence itself'
    );
    assert(calendar.getEvent(calendar.state.get('selectedEventId')) !== null, 'Selected id can be looked up');

    calendar.selectEvent('plain');
    assert(
        payloads[1].eventId === 'plain' && payloads[1].occurrenceId === null && payloads[1].occurrence === null,
        'Plain ids select without occurrence fields'
    );
    calendar.selectEvent('daily_1');
    assert(
        payloads[2].eventId === 'daily' && payloads[2].occurrenceId === 'daily_1' && payloads[2].occurrence === null,
        'Occurrence id without a matching occurrence still selects the master, occurrence is null'
    );
    calendar.selectEvent('nope_1');
    assert(payloads.length === 3 && calendar.state.get('selectedEventId') === 'daily', 'Unknown ids are ignored');
    calendar.destroy();
}

console.log('\n=== Test 2: resolveEventId and getOccurrence ===');
{
    const calendar = makeCalendar();
    const occurrence = calendar.getEventsForDate(new Date(2025, 5, 11)).find(e => e.recurringEventId === 'daily');
    assert(calendar.resolveEventId('daily') === 'daily', 'Master id resolves to itself');
    assert(calendar.resolveEventId(occurrence.id) === 'daily', 'Occurrence id resolves to the master');
    assert(calendar.resolveEventId('plain') === 'plain' && calendar.resolveEventId('plain_5') === null, 'Non-recurring ids only resolve exactly');
    assert(calendar.resolveEventId('missing') === null && calendar.resolveEventId(undefined) === null, 'Unknown ids resolve to null');
    assert(calendar.eventStore.resolveEventId(occurrence.id) === 'daily', 'EventStore exposes the same resolution');

    const found = calendar.getOccurrence(occurrence.id);
    assert(found instanceof Event && found.id === occurrence.id && found.recurringEventId === 'daily', 'getOccurrence returns the occurrence');
    assert(found.start.getTime() === occurrence.start.getTime() && found.title === 'Daily', 'Occurrence matches the view data');
    assert(calendar.getOccurrence('daily') === null, 'A master id is not an occurrence');
    assert(calendar.getOccurrence('daily_1') === null && calendar.getOccurrence('plain_1') === null, 'Instants without an occurrence yield null');
    calendar.destroy();
}

console.log('\n=== Test 3: occurrence iterators accept occurrence ids ===');
{
    for (const [label, calendar] of [['Calendar', makeCalendar()], ['EnhancedCalendar', makeCalendar(EnhancedCalendar)]]) {
        const occurrence = calendar.getEventsForDate(new Date(2025, 5, 11)).find(e => e.recurringEventId === 'daily');
        const viaMaster = calendar.takeOccurrences('daily', 3, { after: new Date(2025, 5, 20) });
        const viaOccurrence = calendar.takeOccurrences(occurrence.id, 3, { after: new Date(2025, 5, 20) });
        assert(
            viaOccurrence.length === 3 && viaOccurrence.every((o, i) => o.start.getTime() === viaMaster[i].start.getTime()),
            `${label}.takeOccurrences resolves the occurrence id`
        );
        assert(
            calendar.getNextOccurrence(occurrence.id, occurrence.start)?.start.getTime() === occurrence.start.getTime() + 86400000,
            `${label}.getNextOccurrence resolves the occurrence id`
        );
        let steps = 0;
        for (const next of calendar.iterateOccurrences(occurrence.id, { after: occurrence.start })) {
            steps++;
            if (steps === 2) {
                assert(next.start.getTime() === occurrence.start.getTime() + 2 * 86400000, `${label}.iterateOccurrences resolves the occurrence id`);
                break;
            }
        }
        assert(throwsMatching(() => calendar.takeOccurrences('nope_1', 1), /not found/) === true, `${label} still rejects unknown ids`);
        calendar.destroy();
    }
}

console.log('\n=== Test 4: reconcile with occurrences in the snapshot ===');
{
    const calendar = makeCalendar();
    const master = calendar.getEvent('daily');
    const changes = [];
    calendar.eventStore.subscribe(change => changes.push(change.type));

    // A snapshot built from view data: occurrences instead of the master
    const snapshot = [...calendar.getEventsInRange(new Date(2025, 5, 9), new Date(2025, 5, 13, 23, 59, 59))];
    assert(snapshot.filter(e => e.isOccurrence).length === 5 && snapshot.some(e => e.id === 'plain'), 'Snapshot holds five occurrences and the plain event');
    const result = calendar.reconcileEvents(snapshot);
    assert(calendar.getEvent('daily') === master && master.recurring, 'Master is kept, not replaced by an occurrence');
    assert(result.unchanged.length === 2 && result.updated.length === 0 && result.added.length === 0 && result.removed.length === 0, 'Occurrences count as their unchanged master');
    assert(calendar.getEvents().length === 2 && changes.length === 0, 'Store has the two events and nothing was notified');
    assert(calendar.getEventsForDate(new Date(2025, 5, 11)).length === 2, 'View still expands the series');

    // Plain objects of occurrences (what toObject() produces) and a master alongside its occurrences
    const asObjects = snapshot.map(e => e.toObject());
    const result2 = calendar.reconcileEvents([...asObjects, master.toObject()]);
    assert(result2.unchanged.length === 2 && calendar.getEvent('daily') === master, 'toObject() occurrences and their master dedupe to one unchanged master');

    // Ids that resolve to a stored recurring master, without any occurrence marker
    const result3 = calendar.reconcileEvents([
        { id: 'daily_1', title: 'x', start: new Date(2025, 5, 11, 9), end: new Date(2025, 5, 11, 10) },
        { id: 'plain', title: 'Plain', start: new Date(2025, 5, 11, 13), end: new Date(2025, 5, 11, 14) }
    ]);
    assert(result3.unchanged.length === 2 && calendar.getEvent('daily') === master, 'An id shaped like an occurrence of a stored series refers to that series');

    // Occurrences whose master is neither stored nor in the snapshot
    const orphanCheck = throwsMatching(
        () => calendar.reconcileEvents([{ id: 'ghost_1', title: 'x', start: new Date(2025, 5, 11, 9), isOccurrence: true, recurringEventId: 'ghost' }]),
        /ghost_1.*ghost/
    );
    assert(orphanCheck === true, 'Occurrence of an unknown master is rejected up front');
    assert(calendar.getEvents().length === 2 && changes.length === 0, 'Store untouched after the rejected snapshot');

    // A new series delivered as master plus occurrences in one snapshot
    calendar.reconcileEvents([
        master,
        { id: 'weekly', title: 'Weekly', start: new Date(2025, 5, 2, 15), end: new Date(2025, 5, 2, 16), recurrenceRule: 'FREQ=WEEKLY' },
        { id: 'weekly_1', title: 'Weekly', start: new Date(2025, 5, 9, 15), end: new Date(2025, 5, 9, 16), isOccurrence: true, recurringEventId: 'weekly' }
    ]);
    assert(calendar.getEvents().map(e => e.id).sort().join() === 'daily,weekly' && calendar.getEvent('weekly').recurring, 'Snapshot master wins over its occurrences');
    calendar.destroy();
}

console.log('\n=== Test 5: non-iterable snapshots ===');
{
    const calendar = makeCalendar();
    assert(throwsMatching(() => calendar.reconcileEvents(null), /reconcileEvents\(\) expects an iterable/) === true, 'reconcileEvents(null) throws a clear error');
    assert(throwsMatching(() => calendar.setEvents(undefined), /setEvents\(\) expects an iterable/) === true, 'setEvents(undefined) throws a clear error');
    assert(throwsMatching(() => calendar.setEvents(42, { reconcile: true }), /reconcileEvents\(\) expects an iterable/) === true, 'setEvents(42, { reconcile: true }) throws a clear error');
    assert(calendar.getEvents().length === 2, 'Store untouched');
    const store = new EventStore({ timezone: TZ });
    assert(throwsMatching(() => store.reconcile(null), /expects an iterable/) === true, 'EventStore.reconcile(null) throws a clear error');
    store.destroy();
    calendar.destroy();
}

console.log('\n=== Test 6: occurrence id helpers ===');
{
    assert(Event.occurrenceId('m', new Date(2025, 5, 16, 9)) === `m_${new Date(2025, 5, 16, 9).getTime()}`, 'occurrenceId from a Date');
    assert(Event.occurrenceId('m', 1000) === 'm_1000', 'occurrenceId from a timestamp');
    assert(throwsMatching(() => Event.occurrenceId('m', 'garbage'), /valid Date or timestamp/) === true, 'occurrenceId rejects an invalid date');
    assert(throwsMatching(() => Event.occurrenceId('m', new Date(NaN)), /valid Date or timestamp/) === true, 'occurrenceId rejects an invalid Date object');

    const event = new Event({ id: 'e', title: 'e', start: new Date(2025, 5, 10, 9), end: new Date(2025, 5, 10, 10), timeZone: TZ, recurrenceRule: 'FREQ=DAILY;COUNT=10' });
    assert(RecurrenceEngine.takeOccurrences(event, 2.5).length === 2, 'RecurrenceEngine.takeOccurrences floors a fractional count');
    assert(new RecurrenceEngineV2().takeOccurrences(event, 2.5).length === 2, 'RecurrenceEngineV2.takeOccurrences floors a fractional count');
    assert(RecurrenceEngine.takeOccurrences(event, 0.5).length === 0 && new RecurrenceEngineV2().takeOccurrences(event, NaN).length === 0, 'Counts below one yield nothing');
    assert(RecurrenceEngine.takeOccurrences(event, Infinity).length === 10, 'Infinite count is capped');
}

if (failures > 0) {
    console.log(`\n❌ Occurrence id test failed: ${failures} assertion(s)`);
    process.exit(1);
}

console.log('\n✅ Occurrence id test complete!');
process.exit(0);
