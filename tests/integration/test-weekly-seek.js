/**
 * Test that RecurrenceEngineV2 seeks WEEKLY BYDAY rules to the range
 * exactly as stepping from DTSTART would, treats BYDAY as a set, and
 * warns once when an expansion is truncated.
 */

import { Event } from '../../core/events/Event.js';
import { RecurrenceEngine } from '../../core/events/RecurrenceEngine.js';
import { RecurrenceEngineV2 } from '../../core/events/RecurrenceEngineV2.js';

console.log('Testing WEEKLY BYDAY seeking...\n');

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
const signature = occurrences => occurrences.map(o => `${o.id}|${o.start.getTime()}|${o.end.getTime()}`).join(',');

const warnings = [];
const originalWarn = console.warn;
console.warn = (...args) => warnings.push(args.join(' '));

// Oracle: the same engine with seeking disabled, i.e. stepped from DTSTART
const walking = new RecurrenceEngineV2();
walking.seekToRange = () => {};

console.log('=== Test 1: WEEKLY BYDAY seek matches walking from DTSTART ===');
{
    const rules = [
        'FREQ=WEEKLY;BYDAY=MO,WE,FR',
        'FREQ=WEEKLY;BYDAY=FR,MO',
        'FREQ=WEEKLY;BYDAY=SU',
        'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU',
        'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH',
        'FREQ=WEEKLY;INTERVAL=3;BYDAY=SA,SU;COUNT=40',
        'FREQ=WEEKLY;BYDAY=MO,TH;COUNT=25',
        'FREQ=WEEKLY;BYDAY=WE;UNTIL=20250630T000000Z',
        'FREQ=WEEKLY;BYDAY=MO,WE;EXDATE=20250611T090000',
        { freq: 'WEEKLY', interval: 1, byDay: ['TH', 'MO'] }
    ];
    const starts = [
        new Date(2024, 0, 15, 9, 0),
        new Date(2025, 2, 8, 9, 0),
        new Date(2025, 9, 31, 9, 0),
        new Date(2025, 5, 10, 9, 0),
        new Date(2025, 2, 9, 2, 30),
        new Date(2025, 9, 5, 2, 30),
        new Date(2020, 5, 1, 1, 30),
        new Date(2019, 0, 6, 23, 15)
    ];
    const windows = [
        [new Date(2025, 0, 1), new Date(2025, 11, 31, 23, 59, 59, 999)],
        [new Date(2025, 5, 10, 9, 0), new Date(2025, 6, 10)],
        [new Date(2019, 0, 1), new Date(2019, 11, 31)],
        [new Date(2025, 2, 1), new Date(2025, 3, 15)],
        [new Date(2025, 9, 20), new Date(2025, 10, 20)],
        [new Date(2026, 5, 1), new Date(2026, 5, 30)]
    ];
    let combos = 0;
    let mismatches = 0;
    let example = null;
    for (const rule of rules) {
        for (const start of starts) {
            for (const [rangeStart, rangeEnd] of windows) {
                for (const timezone of [undefined, 'America/New_York', 'Australia/Sydney']) {
                    const event = makeEvent(rule, start);
                    const options = { maxOccurrences: 10000, timezone };
                    const seeked = new RecurrenceEngineV2().expandEvent(event, rangeStart, rangeEnd, options);
                    const walked = walking.expandEvent(event, rangeStart, rangeEnd, options);
                    combos++;
                    if (signature(seeked) !== signature(walked)) {
                        mismatches++;
                        example = example || { rule, start, rangeStart, seeked: seeked.length, walked: walked.length };
                    }
                    const iterated = Array.from(
                        new RecurrenceEngineV2().iterateOccurrences(event, { after: rangeStart, before: rangeEnd, inclusive: true, timezone })
                    );
                    combos++;
                    if (signature(iterated) !== signature(walked)) {
                        mismatches++;
                        example = example || { rule, start, rangeStart, iterated: iterated.length, walked: walked.length };
                    }
                }
            }
        }
    }
    assert(mismatches === 0, `${combos} expansions match the walked series${example ? ` (first mismatch: ${JSON.stringify(example)})` : ''}`);
}

console.log('\n=== Test 2: far-past WEEKLY BYDAY series ===');
{
    const event = makeEvent('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU', new Date(1400, 0, 1, 9));
    const engine = new RecurrenceEngineV2();
    warnings.length = 0;
    const started = performance.now();
    const june = engine.expandEvent(event, new Date(2025, 5, 1), new Date(2025, 5, 30, 23, 59, 59, 999), { maxOccurrences: 1000 });
    const elapsed = performance.now() - started;
    assert(june.length === 30, `Every day of June 2025 is an occurrence (${june.length})`);
    assert(june[0].start.getDate() === 1 && june[0].start.getHours() === 9, 'First occurrence is 1 June 09:00');
    assert(elapsed < 100, `Expanded in ${elapsed.toFixed(1)} ms`);
    assert(warnings.length === 0, 'No truncation warning');

    const v1 = RecurrenceEngine.expandEvent(event, new Date(2025, 5, 1), new Date(2025, 5, 30, 23, 59, 59, 999), 1000);
    assert(signature(v1.map(o => ({ id: 'e', ...o }))) === signature(june.map(o => ({ ...o, id: 'e' }))), 'RecurrenceEngine agrees');

    const next = engine.nextOccurrence(makeEvent('FREQ=WEEKLY;BYDAY=MO,WE', new Date(1995, 0, 2, 9)), new Date(2300, 0, 1));
    assert(next && next.start.getFullYear() === 2300 && [1, 3].includes(next.start.getDay()), 'nextOccurrence seeks a BYDAY series 300 years ahead');
}

console.log('\n=== Test 3: truncated expansions warn once ===');
{
    warnings.length = 0;
    // MONTHLY cannot be seeked: from year -8000 the range needs over 100000 steps
    const event = makeEvent('FREQ=MONTHLY;BYMONTHDAY=15', new Date(-8000, 0, 15, 9));
    const engine = new RecurrenceEngineV2();
    const occurrences = engine.expandEvent(event, new Date(2025, 0, 1), new Date(2025, 11, 31), { maxOccurrences: 100 });
    assert(occurrences.length === 0, 'Expansion is truncated before reaching the range');
    assert(warnings.length === 1 && /truncated/.test(warnings[0]) && /event e/.test(warnings[0]), 'One warning names the event');
    engine.expandEvent(makeEvent('FREQ=MONTHLY;BYMONTHDAY=15', new Date(-8000, 1, 15, 9)), new Date(2025, 0, 1), new Date(2025, 11, 31), { maxOccurrences: 100 });
    Array.from(engine.iterateOccurrences(event, { after: new Date(2025, 0, 1), before: new Date(2025, 11, 31) }));
    assert(warnings.length === 1, 'Later truncations do not warn again');
}

console.warn = originalWarn;

if (failures > 0) {
    console.log(`\n❌ Weekly seek test failed: ${failures} assertion(s)`);
    process.exit(1);
}

console.log('\n✅ Weekly seek test complete!');
process.exit(0);
