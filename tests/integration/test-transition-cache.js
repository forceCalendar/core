/**
 * Test that system-timezone and event-timezone transition scans extend
 * their caches incrementally and skip the pre-tzdata era, so a series with
 * a far-past DTSTART is expanded quickly on every navigation step.
 */

import { Event } from '../../core/events/Event.js';
import { RecurrenceEngine } from '../../core/events/RecurrenceEngine.js';
import { TimezoneManager } from '../../core/timezone/TimezoneManager.js';

console.log('Testing transition scans...\n');

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
const makeEvent = (rule, start, timeZone = TZ) =>
    new Event({ id: 'e', title: 'e', start, end: new Date(start.getTime() + 90 * 60000), timeZone, recurrenceRule: rule });

console.log('=== Test 1: system transition cache extends incrementally ===');
{
    const scans = [];
    const originalScan = RecurrenceEngine._scanSystemTransitions;
    RecurrenceEngine._scanSystemTransitions = function (fromMs, toMs) {
        scans.push([fromMs, toMs]);
        return originalScan.call(this, fromMs, toMs);
    };
    try {
        RecurrenceEngine._systemTransitions = null;
        const a = new Date(2024, 0, 1).getTime();
        const b = new Date(2025, 0, 1).getTime();
        const c = new Date(2026, 0, 1).getTime();
        const z = new Date(2023, 0, 1).getTime();
        RecurrenceEngine._nextSystemTransition(a, b);
        RecurrenceEngine._nextSystemTransition(a, c);
        RecurrenceEngine._nextSystemTransition(z, c);
        RecurrenceEngine._nextSystemTransition(z, c);
        assert(
            scans.length === 3 && scans[1][0] === b && scans[1][1] === c && scans[2][0] === z && scans[2][1] === a,
            'Extending coverage scans only the new span on each side'
        );
        const incremental = RecurrenceEngine._systemTransitions.transitions;
        const fromScratch = originalScan.call(RecurrenceEngine, z, c);
        assert(JSON.stringify(incremental) === JSON.stringify(fromScratch), `Incremental scan equals a fresh scan (${incremental.length} transitions)`);

        // Lookups return the first transition after the instant, or Infinity
        for (const t of fromScratch) {
            if (RecurrenceEngine._nextSystemTransition(t - 1, c) !== t || RecurrenceEngine._nextSystemTransition(t, c) <= t) {
                assert(false, `Lookup around transition ${new Date(t).toISOString()}`);
                break;
            }
        }
        assert(RecurrenceEngine._nextSystemTransition(c - 1, c) === Infinity || RecurrenceEngine._nextSystemTransition(c - 1, c) > c - 1, 'Lookup at the end of coverage');

        // A series with a far-past DTSTART: month steps after the first scan only the new month
        scans.length = 0;
        const ancient = makeEvent('FREQ=DAILY', new Date(1, 0, 1, 9));
        ancient.start.setFullYear(1);
        const monthStart = new Date(2025, 0, 1);
        const started = performance.now();
        RecurrenceEngine.expandEvent(ancient, monthStart, new Date(2025, 0, 31, 23, 59, 59), 1000);
        const firstMs = performance.now() - started;
        scans.length = 0;
        const again = performance.now();
        for (let month = 1; month <= 12; month++) {
            const occurrences = RecurrenceEngine.expandEvent(ancient, new Date(2025, month, 1), new Date(2025, month + 1, 0, 23, 59, 59), 1000);
            if (occurrences.length < 28) {
                assert(false, `Month ${month} lost occurrences (${occurrences.length})`);
            }
        }
        const twelveMs = performance.now() - again;
        assert(scans.every(([from, to]) => to - from < 40 * 86400000), `Navigating forward scans only the new month (${scans.length} scans)`);
        assert(twelveMs < firstMs + 200 && twelveMs < 400, `Twelve month steps from a year-1 series in ${twelveMs.toFixed(1)} ms (first month ${firstMs.toFixed(1)} ms)`);
    } finally {
        RecurrenceEngine._scanSystemTransitions = originalScan;
        RecurrenceEngine._systemTransitions = null;
    }
}

console.log('\n=== Test 2: pre-tzdata spans are not probed week by week ===');
{
    RecurrenceEngine._systemTransitions = null;
    const started = performance.now();
    const earliest = makeEvent('FREQ=DAILY', new Date(2025, 0, 1, 9));
    earliest.start = new Date(-8.64e15);
    earliest.end = new Date(-8.64e15 + 3600000);
    const occurrences = RecurrenceEngine.expandEvent(earliest, new Date(2025, 5, 1), new Date(2025, 5, 30, 23, 59, 59), 1000);
    const elapsed = performance.now() - started;
    assert(occurrences.length === 30, `Daily series from the earliest Date has ${occurrences.length} occurrences in June 2025`);
    assert(elapsed < 3000, `Expanded in ${elapsed.toFixed(0)} ms instead of hanging`);
    const year1 = makeEvent('FREQ=WEEKLY;BYDAY=TU', new Date(2025, 0, 7, 9));
    year1.start.setFullYear(1);
    year1.end = new Date(year1.start.getTime() + 3600000);
    const tuesdays = RecurrenceEngine.expandEvent(year1, new Date(2025, 5, 1), new Date(2025, 5, 30, 23, 59, 59), 1000);
    assert(tuesdays.length === 4 && tuesdays.every(o => o.start.getDay() === 2 && o.start.getHours() === 9), 'Series from year 1 keeps its wall clock');

    // Offsets are tracked relative to the system zone, so probe another zone
    const manager = TimezoneManager.getInstance();
    const zone = TZ === 'America/New_York' ? 'Australia/Sydney' : 'America/New_York';
    const first = manager.getNextTransition(zone, new Date(1700, 0, 1).getTime(), new Date(1900, 0, 1).getTime());
    assert(first > new Date(1800, 0, 1).getTime() && first < new Date(1900, 0, 1).getTime(), `First ${zone} transition after 1700 is in the 19th century (${new Date(first).getUTCFullYear()})`);
    const lookups = [];
    for (const [from, to] of [[2020, 2021], [2021, 2023], [2018, 2023]]) {
        lookups.push(manager.getNextTransition('Europe/London', new Date(from, 0, 1).getTime(), new Date(to, 0, 1).getTime()));
    }
    assert(
        new Date(lookups[0]).getUTCFullYear() === 2020 && new Date(lookups[1]).getUTCFullYear() === 2021 && new Date(lookups[2]).getUTCFullYear() === 2018,
        'Event-timezone transition lookups stay correct as coverage grows in both directions'
    );
    RecurrenceEngine._systemTransitions = null;
}

if (failures > 0) {
    console.log(`\n❌ Transition scans test failed: ${failures} assertion(s)`);
    process.exit(1);
}

console.log('\n✅ Transition scans test complete!');
process.exit(0);
