/**
 * Test recurrence period handling at boundaries: WEEKLY BYSETPOS weeks
 * that straddle New Year, and MONTHLY rules counted from the end of the
 * month.
 */

import { Event } from '../../core/events/Event.js';
import { RecurrenceEngine } from '../../core/events/RecurrenceEngine.js';
import { RecurrenceEngineV2 } from '../../core/events/RecurrenceEngineV2.js';

console.log('Testing recurrence periods...\n');

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
const day = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const makeEvent = (rule, start) =>
    new Event({ id: 'e', title: 'e', start, end: new Date(start.getTime() + 3600000), timeZone: TZ, recurrenceRule: rule });
const expandDays = (event, rangeStart, rangeEnd) =>
    RecurrenceEngine.expandEvent(event, rangeStart, rangeEnd, 10000).map(o => day(o.start));
const iterateDays = (event, rangeStart, rangeEnd) =>
    Array.from(RecurrenceEngine.iterateOccurrences(event, { after: rangeStart, before: rangeEnd, inclusive: true })).map(o =>
        day(o.start)
    );

const warnings = [];
const originalWarn = console.warn;
console.warn = (...args) => warnings.push(args.join(' '));

console.log('=== Test 1: WEEKLY BYSETPOS across the year boundary ===');
{
    // Mon 29 Dec 2025 - Sun 4 Jan 2026 is ISO week 1 of 2026
    const rangeStart = new Date(2025, 11, 29);
    const rangeEnd = new Date(2026, 0, 3, 23, 59, 59, 999);
    const cases = [
        ['FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=1,3', ['2025-12-29', '2025-12-31']],
        ['FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1', ['2026-01-02']],
        ['FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=2,-2', ['2025-12-30', '2026-01-01']]
    ];
    for (const [rule, expected] of cases) {
        const event = makeEvent(rule, new Date(2024, 0, 1, 9));
        const expanded = expandDays(event, rangeStart, rangeEnd);
        const iterated = iterateDays(event, rangeStart, rangeEnd);
        assert(JSON.stringify(expanded) === JSON.stringify(expected), `${rule}: expandEvent selects one period for the week (${expanded})`);
        assert(JSON.stringify(iterated) === JSON.stringify(expected), `${rule}: iterateOccurrences agrees (${iterated})`);

        // Whole year: the two paths must agree
        const yearExpanded = expandDays(event, new Date(2025, 0, 1), new Date(2025, 11, 31, 23, 59, 59, 999));
        const yearIterated = iterateDays(event, new Date(2025, 0, 1), new Date(2025, 11, 31, 23, 59, 59, 999));
        assert(JSON.stringify(yearExpanded) === JSON.stringify(yearIterated), `${rule}: whole year 2025 agrees (${yearExpanded.length} occurrences)`);
        // A window spanning both years selects each boundary week once
        const twoYears = expandDays(event, new Date(2025, 0, 1), new Date(2026, 11, 31, 23, 59, 59, 999));
        const boundary = twoYears.filter(d => d >= '2025-12-29' && d <= '2026-01-04');
        assert(JSON.stringify(boundary) === JSON.stringify(expected), `${rule}: two-year window selects the boundary week once (${boundary})`);
    }
    // Wed 1 Jan 2025 belongs to ISO week 1 of 2025 (Mon 30 Dec 2024 - Sun 5 Jan 2025)
    const event = makeEvent('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=1', new Date(2024, 0, 1, 9));
    const across2025 = expandDays(event, new Date(2024, 11, 30), new Date(2025, 0, 5, 23, 59, 59, 999));
    assert(JSON.stringify(across2025) === JSON.stringify(['2024-12-30']), `Week 1 of 2025 starting in 2024 selects Monday 30 Dec once (${across2025})`);
}

console.log('\n=== Test 2: MONTHLY BYMONTHDAY counted from the end of the month ===');
{
    const rangeStart = new Date(2025, 0, 1);
    const rangeEnd = new Date(2025, 11, 31, 23, 59, 59, 999);
    const lastDays = [
        '2025-01-31', '2025-02-28', '2025-03-31', '2025-04-30', '2025-05-31', '2025-06-30',
        '2025-07-31', '2025-08-31', '2025-09-30', '2025-10-31', '2025-11-30', '2025-12-31'
    ];
    for (const start of [new Date(2025, 0, 31, 9), new Date(2024, 10, 30, 9)]) {
        const event = makeEvent('FREQ=MONTHLY;BYMONTHDAY=-1', start);
        warnings.length = 0;
        const expanded = expandDays(event, rangeStart, rangeEnd);
        assert(JSON.stringify(expanded) === JSON.stringify(lastDays), `Last day of every month from ${day(start)} (${expanded.length} occurrences)`);
        assert(warnings.length === 0, 'No "date not advancing" warning');
        const iterated = iterateDays(event, rangeStart, rangeEnd);
        assert(JSON.stringify(iterated) === JSON.stringify(lastDays), 'iterateOccurrences agrees');
        const v2 = new RecurrenceEngineV2().expandEvent(event, rangeStart, rangeEnd, { maxOccurrences: 1000 }).map(o => day(o.start));
        assert(JSON.stringify(v2) === JSON.stringify(lastDays), 'RecurrenceEngineV2 agrees');
        assert(RecurrenceEngine.expandEvent(event, rangeStart, rangeEnd, 10000).every(o => o.start.getHours() === 9), 'Wall-clock time is preserved');
    }

    const secondLast = makeEvent('FREQ=MONTHLY;BYMONTHDAY=-2;INTERVAL=2', new Date(2025, 0, 30, 9));
    const expanded = expandDays(secondLast, rangeStart, rangeEnd);
    assert(
        JSON.stringify(expanded) === JSON.stringify(['2025-01-30', '2025-03-30', '2025-05-30', '2025-07-30', '2025-09-29', '2025-11-29']),
        `BYMONTHDAY=-2 every second month (${expanded})`
    );
    const counted = makeEvent('FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=3', new Date(2025, 0, 31, 9));
    assert(expandDays(counted, rangeStart, rangeEnd).length === 3, 'COUNT is honoured');

    // Positive days keep their behaviour
    const fifteenth = makeEvent('FREQ=MONTHLY;BYMONTHDAY=15', new Date(2024, 5, 15, 9));
    const fifteenths = expandDays(fifteenth, rangeStart, rangeEnd);
    assert(fifteenths.length === 12 && fifteenths.every(d => d.endsWith('-15')), 'BYMONTHDAY=15 unchanged');
}

console.warn = originalWarn;

if (failures > 0) {
    console.log(`\n❌ Recurrence periods test failed: ${failures} assertion(s)`);
    process.exit(1);
}

console.log('\n✅ Recurrence periods test complete!');
process.exit(0);
