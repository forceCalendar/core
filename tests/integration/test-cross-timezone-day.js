/**
 * Test that day queries find recurring occurrences whose day in the query
 * timezone differs from the day on the event's own wall clock, up to the
 * 26 hour spread between UTC-12 and UTC+14.
 */

import { Calendar } from '../../core/calendar/Calendar.js';
import { DateUtils } from '../../core/calendar/DateUtils.js';

console.log('Testing cross-timezone day queries...\n');

let failures = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`  ✅ ${message}`);
    } else {
        console.log(`  ❌ ${message}`);
        failures++;
    }
}

const ids = events => events.map(e => e.id).sort();
const key = date => DateUtils.getLocalDateString(date);

console.log('=== Test 1: New York evening series viewed from London ===');
{
    const calendar = new Calendar({ timeZone: 'Europe/London', date: new Date(2025, 5, 4) });
    // 22:00 in New York is 03:00 in London the next day
    calendar.addEvent({
        id: 'ny',
        title: 'NY evening',
        start: new Date(2025, 5, 2, 22),
        end: new Date(2025, 5, 2, 23),
        timeZone: 'America/New_York',
        recurrenceRule: 'FREQ=DAILY;COUNT=10'
    });
    calendar.addEvent({
        id: 'ny-single',
        title: 'NY single',
        start: new Date(2025, 5, 2, 22),
        end: new Date(2025, 5, 2, 23),
        timeZone: 'America/New_York'
    });

    const june3 = calendar.getEventsForDate(new Date(2025, 5, 3, 12));
    const occurrence = june3.find(e => e.recurringEventId === 'ny');
    assert(june3.some(e => e.id === 'ny-single'), 'Non-recurring twin found on its London day');
    assert(occurrence !== undefined, 'Recurring occurrence found on its London day');
    assert(
        occurrence && occurrence.getStartInTimezone('Europe/London').getHours() === 3 && occurrence.getStartInTimezone('Europe/London').getDate() === 3,
        'Occurrence is the 2 June 22:00 New York instance (3 June 03:00 London)'
    );
    assert(!june3.some(e => e.id === 'ny'), 'Recurring master is not returned');

    calendar.setView('day', new Date(2025, 5, 3, 12));
    const dayView = calendar.getViewData();
    const dayIds = new Set([...dayView.allDayEvents, ...dayView.hours.flatMap(h => h.events)].map(e => e.id));
    assert(dayIds.has(occurrence?.id) && dayIds.has('ny-single'), 'Day view lists both');
    const threeAm = dayView.hours[3].events.map(e => e.id).sort();
    assert(
        JSON.stringify(threeAm) === JSON.stringify([occurrence?.id, 'ny-single'].sort()) && dayView.hours[22].events.length === 0,
        'Day view slots both into the 03:00 hour on the calendar clock'
    );

    calendar.setView('week', new Date(2025, 5, 3, 12));
    const weekDay = calendar.getViewData().days.find(d => key(d.date) === '2025-06-03');
    assert(JSON.stringify(ids(weekDay.events)) === JSON.stringify(ids(june3)), 'Week view day equals getEventsForDate');
    calendar.destroy();
}

console.log('\n=== Test 2: getEventsForDate agrees with getEventsByDate in every timezone ===');
{
    const calendar = new Calendar({ timeZone: 'Europe/London', weekStartsOn: 1, date: new Date(2025, 5, 15) });
    calendar.addEvent({
        id: 'ny',
        title: 'ny',
        start: new Date(2025, 5, 2, 22),
        end: new Date(2025, 5, 2, 23),
        timeZone: 'America/New_York',
        recurrenceRule: 'FREQ=DAILY'
    });
    calendar.addEvent({
        id: 'syd',
        title: 'syd',
        start: new Date(2025, 5, 2, 1),
        end: new Date(2025, 5, 2, 2),
        timeZone: 'Australia/Sydney',
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,TH'
    });
    calendar.addEvent({
        id: 'one',
        title: 'one',
        start: new Date(2025, 5, 4, 23, 30),
        end: new Date(2025, 5, 5, 0, 30),
        timeZone: 'Europe/London'
    });
    const rangeStart = new Date(2025, 5, 1);
    const rangeEnd = new Date(2025, 5, 14);
    for (const timezone of ['Europe/London', 'America/New_York', 'Australia/Sydney', 'Asia/Kolkata', 'Pacific/Kiritimati']) {
        const byDate = calendar.getEventsByDate(rangeStart, rangeEnd, timezone);
        let diffs = 0;
        let total = 0;
        for (const day of DateUtils.getDateRange(rangeStart, rangeEnd)) {
            const grid = ids(byDate.get(key(day)) || []);
            const single = ids(calendar.getEventsForDate(day, timezone));
            total += single.length;
            if (JSON.stringify(grid) !== JSON.stringify(single)) diffs++;
        }
        assert(diffs === 0 && total > 14, `${timezone}: every day agrees (${total} entries)`);
    }
    calendar.destroy();
}

console.log('\n=== Test 3: 26 hour offset spread (Kiritimati series viewed from Pago Pago) ===');
{
    const calendar = new Calendar({ timeZone: 'Pacific/Pago_Pago', date: new Date(2025, 5, 15) });
    // 00:30 in Kiritimati (UTC+14) is 23:30 the previous day in Pago Pago (UTC-11)
    calendar.addEvent({
        id: 'kiri',
        title: 'kiri',
        start: new Date(2025, 5, 1, 0, 30),
        end: new Date(2025, 5, 1, 1, 30),
        timeZone: 'Pacific/Kiritimati',
        recurrenceRule: 'FREQ=DAILY'
    });
    const rangeStart = new Date(2025, 5, 1);
    const rangeEnd = new Date(2025, 5, 14);
    const byDate = calendar.getEventsByDate(rangeStart, rangeEnd);
    const pagoStart = e => e.getStartInTimezone('Pacific/Pago_Pago');
    const lastDay = byDate.get('2025-06-14') || [];
    const lateOccurrence = lastDay.find(e => pagoStart(e).getDate() === 14);
    assert(
        lateOccurrence !== undefined && pagoStart(lateOccurrence).getHours() === 23 && lateOccurrence.start.getDate() === 16,
        'Last grid day has the 16 June Kiritimati occurrence at 23:30 Pago Pago'
    );
    // Each 23:30 occurrence runs past midnight, so every day lists two
    let diffs = 0;
    for (const day of DateUtils.getDateRange(rangeStart, rangeEnd)) {
        const grid = ids(byDate.get(key(day)) || []);
        const single = ids(calendar.getEventsForDate(day));
        if (grid.length !== 2 || JSON.stringify(grid) !== JSON.stringify(single)) diffs++;
    }
    assert(diffs === 0, 'Two overlapping occurrences per Pago Pago day from both query paths');
    calendar.destroy();
}

if (failures > 0) {
    console.log(`\n❌ Cross-timezone day test failed: ${failures} assertion(s)`);
    process.exit(1);
}

console.log('\n✅ Cross-timezone day test complete!');
process.exit(0);
