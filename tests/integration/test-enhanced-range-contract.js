/** Enhanced ranges retain plain occurrence objects and accept inherited timezone arguments. */
import assert from 'node:assert/strict';
import { Calendar, EnhancedCalendar, Event } from '../../core/index.js';

const start = new Date('2026-10-02T00:00:00Z');
const end = new Date('2026-10-05T00:00:00Z');
const series = {
    id: 'series', title: 'Recurring',
    start: new Date('2026-10-02T09:00:00Z'), end: new Date('2026-10-02T10:00:00Z'),
    timeZone: 'UTC', recurrenceRule: 'FREQ=DAILY;COUNT=3'
};
const regular = {
    id: 'regular', title: 'Regular',
    start: new Date('2026-10-02T05:00:00Z'), end: new Date('2026-10-02T06:00:00Z'),
    timeZone: 'UTC'
};
const calendar = new EnhancedCalendar({ timeZone: 'UTC', events: [series, regular] });
const base = new Calendar({ timeZone: 'UTC', events: [series, regular] });
try {
    assert.ok(base.getEventsInRange(start, end).every(event => event instanceof Event));
    const results = calendar.getEventsInRange(start, end);
    const stored = results.find(event => event.id === 'regular');
    assert.equal(stored, calendar.getEvent('regular'), 'Regular events keep stored Event identity');
    const occurrences = results.filter(event => event.recurringEventId === 'series');
    assert.equal(occurrences.length, 3);
    for (const occurrence of occurrences) {
        assert.equal(occurrence instanceof Event, false, 'Enhanced occurrences remain plain objects');
        assert.equal(occurrence.isOccurrence, true);
        assert.equal(occurrence.isRecurring, true);
        assert.equal(occurrence.timezone, 'UTC');
        assert.equal(occurrence.occurrenceStart.getTime(), occurrence.start.getTime());
        assert.equal(occurrence.id, Event.occurrenceId('series', occurrence.start));
    }

    const timezone = 'America/New_York';
    const stringResults = calendar.getEventsInRange(start, end, timezone);
    const optionResults = calendar.getEventsInRange(start, end, { timezone });
    assert.deepEqual(stringResults, optionResults, 'Timezone string is equivalent to enhanced options');
    assert.ok(stringResults.filter(event => event.isOccurrence).every(event => event.timezone === timezone));
    // Regular-event queries use the inherited timezone argument too.
    const earlyStart = new Date('2026-10-02T00:00:00Z');
    const earlyEnd = new Date('2026-10-02T02:00:00Z');
    const regularIds = events => events.filter(event => !event.isOccurrence).map(event => event.id);
    assert.deepEqual(
        regularIds(calendar.getEventsInRange(earlyStart, earlyEnd, timezone)),
        regularIds(base.getEventsInRange(earlyStart, earlyEnd, timezone))
    );
    const query = calendar.eventStore.getEventsInRange;
    let queryTimezone;
    calendar.eventStore.getEventsInRange = function (...args) {
        queryTimezone = args[3];
        return query.apply(this, args);
    };
    calendar.getEventsInRange(start, end, timezone);
    assert.equal(queryTimezone, timezone);
    calendar.eventStore.getEventsInRange = query;

    calendar.modifyOccurrence('series', occurrences[0].start, { title: 'Modified' });
    calendar.cancelOccurrence('series', occurrences[1].start, 'Cancelled for test');
    const changed = calendar.getEventsInRange(start, end);
    assert.equal(changed.find(event => event.id === occurrences[0].id).title, 'Modified');
    assert.equal(changed.some(event => event.id === occurrences[1].id), false);
    const cancelled = calendar.getEventsInRange(start, end, { includeCancelled: true })
        .find(event => event.id === occurrences[1].id);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.cancellationReason, 'Cancelled for test');
} finally {
    calendar.destroy();
    base.destroy();
}
console.log('Enhanced range contract tests passed');
