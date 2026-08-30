/**
 * Test that view data of a recurring series never goes stale after the
 * series is updated, reconciled, removed and re-added or replaced: every
 * mutation path invalidates the recurrence engine's expansion cache, and
 * the cache key covers the rule and DTSTART so id reuse cannot alias.
 */

import { Event } from '../../core/events/Event.js';
import { RecurrenceEngineV2 } from '../../core/events/RecurrenceEngineV2.js';
import { EventStore } from '../../core/events/EventStore.js';
import { Calendar } from '../../core/calendar/Calendar.js';
import { EnhancedCalendar } from '../../core/integration/EnhancedCalendar.js';
import { DateUtils } from '../../core/calendar/DateUtils.js';

console.log('Testing occurrence cache invalidation...\n');

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
const series = (rule, start = new Date(2025, 5, 2, 9), end = new Date(2025, 5, 2, 10)) => ({
    id: 'r',
    title: 'r',
    start,
    end,
    timeZone: TZ,
    recurrenceRule: rule
});
const countSeries = calendar =>
    calendar
        .getViewData()
        .weeks.flatMap(week => week.days)
        .reduce((n, day) => n + day.events.filter(e => e.recurringEventId === 'r').length, 0);

console.log('=== Test 1: Calendar month view after every mutation path ===');
{
    // June 2025, Monday start: grid is Mon 26 May - Sun 6 Jul
    const calendar = new Calendar({ timeZone: TZ, weekStartsOn: 1, date: new Date(2025, 5, 15) });
    calendar.addEvent(series('FREQ=DAILY'));
    const daily = countSeries(calendar);
    assert(daily === 35, `Daily series fills the grid from its start (${daily} occurrences)`);

    calendar.updateEvent('r', { recurrenceRule: 'FREQ=WEEKLY' });
    const weekly = countSeries(calendar);
    assert(weekly === 5, `updateEvent(rule) is reflected in the month view (${weekly} occurrences)`);

    calendar.updateEvent('r', { start: new Date(2025, 5, 2, 11), end: new Date(2025, 5, 2, 12) });
    const jun9 = calendar
        .getViewData()
        .weeks.flatMap(week => week.days)
        .find(day => DateUtils.getLocalDateString(day.date) === '2025-06-09')
        .events.filter(e => e.recurringEventId === 'r');
    assert(
        jun9.length === 1 && jun9[0].start.getHours() === 11 && jun9[0].id === Event.occurrenceId('r', jun9[0].start),
        'updateEvent(start) moves the occurrences and their ids'
    );

    calendar.reconcileEvents([series('FREQ=DAILY;COUNT=3')]);
    assert(countSeries(calendar) === 3, 'reconcileEvents is reflected in the month view');

    calendar.removeEvent('r');
    assert(countSeries(calendar) === 0, 'removeEvent drops the occurrences');
    calendar.addEvent(series('FREQ=DAILY;COUNT=5'));
    assert(countSeries(calendar) === 5, 'Re-adding the same id expands the new series');

    calendar.setEvents([series('FREQ=DAILY;COUNT=7')]);
    assert(countSeries(calendar) === 7, 'setEvents is reflected in the month view');

    calendar.setEvents([series('FREQ=DAILY;COUNT=2')], { reconcile: true });
    assert(countSeries(calendar) === 2, 'setEvents({ reconcile: true }) is reflected in the month view');

    calendar.eventStore.updateEvents([{ id: 'r', updates: { recurrenceRule: 'FREQ=DAILY;COUNT=4' } }]);
    assert(countSeries(calendar) === 4, 'Batched updates are reflected in the month view');

    calendar.eventStore.clear();
    calendar.addEvent(series('FREQ=WEEKLY;COUNT=2'));
    assert(countSeries(calendar) === 2, 'clear() then add expands the new series');
    calendar.destroy();
}

console.log('\n=== Test 2: EventStore day queries ===');
{
    const store = new EventStore({ timezone: TZ });
    store.addEvent(series('FREQ=DAILY'));
    const day = new Date(2025, 5, 10);
    assert(store.getEventsForDate(day).length === 1, 'Daily occurrence on 10 June');
    store.updateEvent('r', { recurrenceRule: 'FREQ=WEEKLY' });
    assert(store.getEventsForDate(day).length === 0, 'getEventsForDate sees the updated rule');
    assert(store.getEventsForDate(new Date(2025, 5, 9)).length === 1, 'Weekly occurrence on Monday 9 June');
    store.reconcile([series('FREQ=DAILY;UNTIL=20250605T000000Z')]);
    assert(store.getEventsForDate(new Date(2025, 5, 9)).length === 0, 'reconcile sees the new UNTIL');
    store.destroy();
}

console.log('\n=== Test 3: RecurrenceEngineV2 cache key covers rule and DTSTART ===');
{
    const engine = new RecurrenceEngineV2();
    const rangeStart = new Date(2025, 5, 1);
    const rangeEnd = new Date(2025, 5, 30, 23, 59, 59, 999);
    const first = new Event(series('FREQ=DAILY;COUNT=3'));
    const second = new Event(series('FREQ=DAILY;COUNT=6'));
    const third = new Event(series('FREQ=DAILY;COUNT=6', new Date(2025, 5, 4, 9), new Date(2025, 5, 4, 10)));
    assert(engine.expandEvent(first, rangeStart, rangeEnd).length === 3, 'First expansion cached');
    assert(engine.expandEvent(second, rangeStart, rangeEnd).length === 6, 'Same id with another rule is not served from the cache');
    const moved = engine.expandEvent(third, rangeStart, rangeEnd);
    assert(moved.length === 6 && moved[0].start.getDate() === 4, 'Same id and rule with another DTSTART is not served from the cache');
    assert(engine.occurrenceCache.size === 3, `One cache entry per distinct series (${engine.occurrenceCache.size})`);
    const objectRule = new Event(series({ freq: 'DAILY', interval: 1, count: 2 }));
    assert(engine.expandEvent(objectRule, rangeStart, rangeEnd).length === 2, 'Object rules are keyed too');
    engine.clearEventCache('r');
    assert(engine.occurrenceCache.size === 0, 'clearEventCache drops every entry of the series');
    assert(
        typeof engine.getCacheKey('r', rangeStart, rangeEnd, {}) === 'string' && engine.getCacheKey('r', rangeStart, rangeEnd, {}).startsWith('r_'),
        'getCacheKey still accepts a bare id'
    );
}

console.log('\n=== Test 4: EnhancedCalendar keeps its own engine in sync ===');
{
    const enhanced = new EnhancedCalendar({ timeZone: TZ, date: new Date(2025, 5, 15) });
    enhanced.addEvent(series('FREQ=DAILY'));
    const rangeStart = new Date(2025, 5, 1);
    const rangeEnd = new Date(2025, 5, 30, 23, 59, 59);
    const before = enhanced.getEventsInRange(rangeStart, rangeEnd).length;
    assert(before === 29, `Daily series in June (${before} occurrences)`);
    enhanced.updateEvent('r', { recurrenceRule: 'FREQ=WEEKLY' });
    const after = enhanced.getEventsInRange(rangeStart, rangeEnd).length;
    assert(after === 5, `getEventsInRange reflects the updated rule (${after} occurrences)`);
    enhanced.removeEvent('r');
    assert(enhanced.getEventsInRange(rangeStart, rangeEnd).length === 0, 'Removed series is gone');
    enhanced.addEvent(series('FREQ=DAILY;COUNT=2'));
    assert(enhanced.getEventsInRange(rangeStart, rangeEnd).length === 2, 'Re-added series is expanded afresh');
    enhanced.setEvents([series('FREQ=DAILY;COUNT=3')]);
    assert(enhanced.getEventsInRange(rangeStart, rangeEnd).length === 3, 'setEvents is reflected');
    enhanced.reconcileEvents([series('FREQ=DAILY;COUNT=4')]);
    assert(enhanced.getEventsInRange(rangeStart, rangeEnd).length === 4, 'reconcileEvents is reflected');
    enhanced.destroy();
}

if (failures > 0) {
    console.log(`\n❌ Occurrence cache test failed: ${failures} assertion(s)`);
    process.exit(1);
}

console.log('\n✅ Occurrence cache test complete!');
process.exit(0);
