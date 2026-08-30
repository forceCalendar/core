/**
 * Test Event timezone validation: invalid identifiers are still rejected
 * with the same errors, and valid ones are validated once per process so
 * cloning an event per occurrence stays cheap.
 */

import { Event } from '../../core/events/Event.js';
import { Calendar } from '../../core/calendar/Calendar.js';

console.log('Testing event validation...\n');

let failures = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`  ✅ ${message}`);
    } else {
        console.log(`  ❌ ${message}`);
        failures++;
    }
}

const base = { id: 'e', title: 'e', start: new Date(2025, 5, 2, 9), end: new Date(2025, 5, 2, 10) };
const errorOf = fn => {
    try {
        fn();
    } catch (error) {
        return error.message;
    }
    return null;
};

console.log('=== Test 1: invalid timezones are rejected every time ===');
{
    assert(errorOf(() => new Event({ ...base, timeZone: 'Mars/Olympus' })) === 'Invalid timezone: Mars/Olympus', 'Invalid timeZone throws');
    assert(errorOf(() => new Event({ ...base, timeZone: 'Mars/Olympus' })) === 'Invalid timezone: Mars/Olympus', 'Still throws on the second attempt');
    assert(errorOf(() => new Event({ ...base, endTimeZone: 'Nowhere' })) === 'Invalid end timezone: Nowhere', 'Invalid endTimeZone throws');
    assert(errorOf(() => new Event({ ...base, timeZone: 'America/New_York', endTimeZone: 'Europe/London' })) === null, 'Valid timezones pass');
}

console.log('\n=== Test 2: valid timezones are validated once ===');
{
    const OriginalFormat = Intl.DateTimeFormat;
    let constructions = 0;
    const counting = function (...args) {
        constructions++;
        return new OriginalFormat(...args);
    };
    counting.supportedLocalesOf = OriginalFormat.supportedLocalesOf;
    Intl.DateTimeFormat = counting;
    try {
        const event = new Event({ ...base, timeZone: 'Australia/Adelaide', endTimeZone: 'Australia/Adelaide' });
        constructions = 0;
        for (let i = 0; i < 50; i++) {
            event.clone({ id: `e_${i}` });
        }
        assert(constructions === 0, `Cloning a validated event constructs no Intl.DateTimeFormat (${constructions})`);
    } finally {
        Intl.DateTimeFormat = OriginalFormat;
    }
}

console.log('\n=== Test 3: expanding a month grid stays cheap ===');
{
    const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const calendar = new Calendar({ timeZone: TZ, weekStartsOn: 1, fixedWeekCount: true, date: new Date(2025, 5, 15) });
    const rules = ['FREQ=DAILY', 'FREQ=WEEKLY;BYDAY=MO,WE', 'FREQ=MONTHLY;BYMONTHDAY=10', 'FREQ=WEEKLY;INTERVAL=2'];
    for (let i = 0; i < 200; i++) {
        calendar.addEvent({
            id: `s${i}`,
            title: `s${i}`,
            start: new Date(2020 + (i % 5), i % 12, 1 + (i % 27), 9),
            end: new Date(2020 + (i % 5), i % 12, 1 + (i % 27), 10),
            timeZone: TZ,
            recurrenceRule: rules[i % 4]
        });
    }
    calendar.getViewData();
    const started = performance.now();
    const view = calendar.getViewData();
    const elapsed = performance.now() - started;
    const entries = view.weeks.flatMap(w => w.days).reduce((n, d) => n + d.events.length, 0);
    assert(entries > 2500, `200 series produce ${entries} cell entries`);
    // Generous bound: before memoisation this took over 500 ms
    assert(elapsed < 400, `Warm month grid with 200 series in ${elapsed.toFixed(1)} ms`);
    calendar.destroy();
}

if (failures > 0) {
    console.log(`\n❌ Event validation test failed: ${failures} assertion(s)`);
    process.exit(1);
}

console.log('\n✅ Event validation test complete!');
process.exit(0);
