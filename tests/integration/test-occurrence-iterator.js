/**
 * Test lazy occurrence iteration: iterateOccurrences, nextOccurrence and
 * takeOccurrences on both engines, EventStore and Calendar
 */

import { deepStrictEqual } from 'node:assert';
import { Event } from '../../core/events/Event.js';
import { EventStore } from '../../core/events/EventStore.js';
import { RecurrenceEngine } from '../../core/events/RecurrenceEngine.js';
import { RecurrenceEngineV2 } from '../../core/events/RecurrenceEngineV2.js';
import { Calendar } from '../../core/calendar/Calendar.js';
import { EnhancedCalendar } from '../../core/integration/EnhancedCalendar.js';

console.log('Testing lazy occurrence iteration...\n');

let failures = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`  ✅ ${message}`);
    } else {
        console.log(`  ❌ ${message}`);
        failures++;
    }
}

function same(actual, expected) {
    try {
        deepStrictEqual(actual, expected);
        return true;
    } catch {
        return false;
    }
}

function makeRecurring(id, rule, start, durationMinutes = 60, timeZone = 'UTC') {
    return new Event({
        id,
        title: `Series ${id}`,
        start,
        end: new Date(start.getTime() + durationMinutes * 60000),
        recurring: true,
        recurrenceRule: rule,
        timeZone
    });
}

function starts(occurrences) {
    return occurrences.map(o => o.start.getTime()).join(',');
}

function dates(...days) {
    return days.map(d => new Date(2025, 5, d, 9, 0).getTime()).join(',');
}

console.log('=== Test 1: Iterating a window yields exactly what expandEvent returns ===');
const rules = [
    'FREQ=DAILY',
    'FREQ=DAILY;INTERVAL=3',
    'FREQ=DAILY;COUNT=40',
    'FREQ=DAILY;UNTIL=20250615T090000',
    'FREQ=DAILY;EXDATE=20250603T090000,20250610',
    'FREQ=DAILY;BYSETPOS=1,-1',
    'FREQ=WEEKLY',
    'FREQ=WEEKLY;INTERVAL=2',
    'FREQ=WEEKLY;BYDAY=MO,WE,FR',
    'FREQ=WEEKLY;BYDAY=TU,TH;COUNT=25',
    'FREQ=WEEKLY;BYDAY=MO,TU,WE;BYSETPOS=-1',
    'FREQ=MONTHLY',
    'FREQ=MONTHLY;BYMONTHDAY=15',
    'FREQ=MONTHLY;BYDAY=2TU',
    'FREQ=MONTHLY;BYDAY=-1FR',
    'FREQ=MONTHLY;INTERVAL=2;COUNT=12',
    'FREQ=YEARLY',
    'FREQ=YEARLY;BYMONTH=3',
    'FREQ=HOURLY;INTERVAL=6',
    'FREQ=MINUTELY;INTERVAL=90;COUNT=500'
];
const seriesStarts = [
    [new Date(2024, 0, 1, 9, 0), 'UTC'],
    [new Date(1995, 0, 1, 9, 0), 'America/New_York']
];
const windows = [
    [new Date(2025, 5, 1), new Date(2025, 5, 30, 23, 59)], // one month
    [new Date(1990, 0, 1), new Date(1995, 0, 3)], // straddles the 1995 start, precedes the 2024 one
    [new Date(2030, 2, 1), new Date(2030, 3, 15)], // far ahead, across a DST change
    [new Date(2025, 5, 1, 9, 0), new Date(2025, 5, 8, 9, 0)] // both bounds on occurrence instants
];

let cases = 0;
let nonEmpty = 0;
const mismatchesV1 = [];
const mismatchesV2 = [];
for (const rule of rules) {
    for (const [start, timeZone] of seriesStarts) {
        const series = makeRecurring(`diff-${rule}-${start.getFullYear()}`, rule, start, 30, timeZone);
        for (const [after, before] of windows) {
            cases++;
            const label = `${rule} from ${start.getFullYear()} (${timeZone}) in ${after.toDateString()}..${before.toDateString()}`;
            const expected = RecurrenceEngine.expandEvent(series, after, before, 10000);
            const iterated = Array.from(
                RecurrenceEngine.iterateOccurrences(series, { after, before, inclusive: true })
            );
            if (expected.length > 0) nonEmpty++;
            if (!same(iterated, expected)) {
                mismatchesV1.push(`${label}: ${iterated.length} vs ${expected.length}`);
            }

            const engine = new RecurrenceEngineV2();
            const expectedV2 = engine.expandEvent(series, after, before, { maxOccurrences: 10000 });
            const iteratedV2 = Array.from(
                engine.iterateOccurrences(series, { after, before, inclusive: true })
            );
            if (!same(iteratedV2, expectedV2)) {
                mismatchesV2.push(`${label}: ${iteratedV2.length} vs ${expectedV2.length}`);
            }
        }
    }
}
assert(
    mismatchesV1.length === 0,
    `RecurrenceEngine: iterator matches expandEvent in all ${cases} rule/window cases (${nonEmpty} non-empty)`
);
mismatchesV1.forEach(m => console.log(`     mismatch: ${m}`));
assert(
    mismatchesV2.length === 0,
    `RecurrenceEngineV2: iterator matches expandEvent in all ${cases} rule/window cases`
);
mismatchesV2.forEach(m => console.log(`     mismatch: ${m}`));
assert(nonEmpty > cases / 3, `The differential matrix exercises real occurrences (${nonEmpty}/${cases} non-empty)`);

// The V2 options that change expansion output are honoured by the iterator too
const optionEngine = new RecurrenceEngineV2();
const optionSeries = makeRecurring('options', 'FREQ=DAILY;EXDATE=20250603', new Date(2025, 5, 1, 9, 0), 30, 'America/New_York');
optionEngine.addException('options', new Date(2025, 5, 5, 9, 0), 'Holiday');
optionEngine.addModifiedInstance('options', new Date(2025, 5, 7, 9, 0), { title: 'Moved', location: 'Room 2' });
let optionMismatches = 0;
for (const options of [
    { includeCancelled: true },
    { includeModified: false },
    { handleDST: false },
    { includeCancelled: true, includeModified: false, handleDST: false }
]) {
    const expected = optionEngine.expandEvent(optionSeries, new Date(2025, 5, 1), new Date(2025, 5, 10), {
        maxOccurrences: 10000,
        ...options
    });
    const iterated = Array.from(
        optionEngine.iterateOccurrences(optionSeries, {
            after: new Date(2025, 5, 1),
            before: new Date(2025, 5, 10),
            inclusive: true,
            ...options
        })
    );
    if (!same(iterated, expected)) optionMismatches++;
}
assert(optionMismatches === 0, 'RecurrenceEngineV2: includeCancelled/includeModified/handleDST match expandEvent');

console.log('\n=== Test 2: after/before are exclusive by default and closed with inclusive ===');
const daily = makeRecurring('daily', 'FREQ=DAILY', new Date(2025, 5, 1, 9, 0));
const june3 = new Date(2025, 5, 3, 9, 0);
const june5 = new Date(2025, 5, 5, 9, 0);
const engineV2 = new RecurrenceEngineV2();
for (const [name, iterate] of [
    ['RecurrenceEngine', options => RecurrenceEngine.iterateOccurrences(daily, options)],
    ['RecurrenceEngineV2', options => engineV2.iterateOccurrences(daily, options)]
]) {
    assert(
        starts(Array.from(iterate({ after: june3, before: june5 }))) === dates(4),
        `${name}: an occurrence starting exactly at after or before is skipped by default`
    );
    assert(
        starts(Array.from(iterate({ after: june3, before: june5, inclusive: true }))) === dates(3, 4, 5),
        `${name}: inclusive closes the window on both ends`
    );
    assert(
        starts(Array.from(iterate({ after: june3.getTime(), before: june5.getTime() }))) === dates(4),
        `${name}: bounds may be given as timestamps`
    );
    assert(
        starts(Array.from(iterate({ before: june3 }))) === dates(1, 2),
        `${name}: omitting after starts at the series start`
    );
}

console.log('\n=== Test 3: Open-ended iteration stops at COUNT and UNTIL ===');
const counted = makeRecurring('counted', 'FREQ=DAILY;COUNT=10', new Date(2025, 5, 1, 9, 0));
const untilSeries = makeRecurring('until', 'FREQ=DAILY;UNTIL=20250615T090000', new Date(2025, 5, 1, 9, 0));
const countedAll = Array.from(RecurrenceEngine.iterateOccurrences(counted));
assert(countedAll.length === 10, `RecurrenceEngine: unbounded iteration ends at COUNT (${countedAll.length})`);
const countedAllV2 = Array.from(engineV2.iterateOccurrences(counted));
assert(countedAllV2.length === 10, `RecurrenceEngineV2: unbounded iteration ends at COUNT (${countedAllV2.length})`);
const untilAll = Array.from(RecurrenceEngine.iterateOccurrences(untilSeries));
assert(
    untilAll.length === 15 && untilAll[14].start.getTime() === new Date(2025, 5, 15, 9, 0).getTime(),
    `RecurrenceEngine: unbounded iteration ends at UNTIL (${untilAll.length})`
);
const untilAllV2 = Array.from(engineV2.iterateOccurrences(untilSeries));
assert(starts(untilAllV2) === starts(untilAll), 'RecurrenceEngineV2: unbounded iteration ends at UNTIL');
const countedAfter = Array.from(RecurrenceEngine.iterateOccurrences(counted, { after: new Date(2025, 5, 8) }));
assert(
    starts(countedAfter) === dates(8, 9, 10),
    `Seeking into a COUNT series still ends at COUNT (${countedAfter.length})`
);

console.log('\n=== Test 4: take(n) from a series started in 1995 does not walk from DTSTART ===');
// Expected values come from expandEvent over the same instant, so the test
// holds in any system timezone: the engines shift the first occurrence
// after a timezone offset change, and the iterator reproduces that. The
// seek takes one single step per system DST transition it crosses (about
// 60 for 30 years) instead of one per day (~11,000).
const dailySince1995 = makeRecurring('since-1995', 'FREQ=DAILY', new Date(1995, 0, 1, 9, 0));
const afterJune2025 = new Date(2025, 5, 1);
const expectedFive = RecurrenceEngine.expandEvent(dailySince1995, afterJune2025, new Date(2025, 5, 30), 5);

const advanceInPlace = RecurrenceEngine._advanceInPlace;
let stepsV1 = 0;
RecurrenceEngine._advanceInPlace = function (next, rule) {
    stepsV1++;
    return advanceInPlace.call(this, next, rule);
};
const t0 = performance.now();
const fiveV1 = RecurrenceEngine.takeOccurrences(dailySince1995, 5, { after: afterJune2025 });
const msV1 = performance.now() - t0;
RecurrenceEngine._advanceInPlace = advanceInPlace;
assert(
    fiveV1.length === 5 && starts(fiveV1) === starts(expectedFive),
    'RecurrenceEngine: takeOccurrences returns the five occurrences after the seek target'
);
assert(
    stepsV1 < 200,
    `RecurrenceEngine: the cursor took ${stepsV1} single steps instead of the ~11,000 from DTSTART`
);
assert(msV1 < 100, `RecurrenceEngine: takeOccurrences(5) from 1995 took ${msV1.toFixed(2)}ms`);

const timingEngine = new RecurrenceEngineV2();
const expectedFiveV2 = timingEngine.expandEvent(dailySince1995, afterJune2025, new Date(2025, 5, 30), {
    maxOccurrences: 5
});
const getNextDate = timingEngine.getNextDate;
let stepsV2 = 0;
timingEngine.getNextDate = function (...args) {
    stepsV2++;
    return getNextDate.apply(this, args);
};
const t1 = performance.now();
const fiveV2 = timingEngine.takeOccurrences(dailySince1995, 5, { after: afterJune2025 });
const msV2 = performance.now() - t1;
assert(
    fiveV2.length === 5 && starts(fiveV2) === starts(expectedFiveV2),
    'RecurrenceEngineV2: takeOccurrences returns the five occurrences after the seek target'
);
assert(stepsV2 < 200, `RecurrenceEngineV2: the cursor took ${stepsV2} single steps`);
assert(msV2 < 100, `RecurrenceEngineV2: takeOccurrences(5) from 1995 took ${msV2.toFixed(2)}ms`);
console.log(`     timing: RecurrenceEngine ${msV1.toFixed(2)}ms, RecurrenceEngineV2 ${msV2.toFixed(2)}ms`);

const weeklySince1995 = makeRecurring('weekly-1995', 'FREQ=WEEKLY;BYDAY=MO,WE', new Date(1995, 0, 2, 9, 0));
const nextWeekly = RecurrenceEngine.nextOccurrence(weeklySince1995, afterJune2025);
const expectedWeekly = RecurrenceEngine.expandEvent(weeklySince1995, afterJune2025, new Date(2025, 5, 30), 1)[0];
assert(
    nextWeekly && nextWeekly.start.getDay() === 1 && nextWeekly.start.getTime() === expectedWeekly.start.getTime(),
    'RecurrenceEngine: BYDAY series seeks to the first matching weekday after the instant'
);
const hourlySince1995 = makeRecurring('hourly-1995', 'FREQ=HOURLY;INTERVAL=6', new Date(1995, 0, 1, 9, 0));
const nextHourly = RecurrenceEngine.nextOccurrence(hourlySince1995, afterJune2025);
const expectedHourly = RecurrenceEngine.expandEvent(hourlySince1995, afterJune2025, new Date(2025, 5, 2), 1)[0];
assert(
    nextHourly && nextHourly.start.getTime() === expectedHourly.start.getTime(),
    'RecurrenceEngine: sub-daily series seeks arithmetically too'
);

console.log('\n=== Test 5: nextOccurrence past the end of a series returns null ===');
const lastOfFive = new Date(2025, 5, 10, 9, 0);
assert(RecurrenceEngine.nextOccurrence(counted, lastOfFive) === null, 'RecurrenceEngine: null after the COUNTth occurrence');
assert(
    RecurrenceEngine.nextOccurrence(counted, lastOfFive, { inclusive: true }) !== null,
    'RecurrenceEngine: the COUNTth occurrence itself is found with inclusive'
);
assert(engineV2.nextOccurrence(counted, lastOfFive) === null, 'RecurrenceEngineV2: null after the COUNTth occurrence');
assert(
    RecurrenceEngine.nextOccurrence(untilSeries, new Date(2025, 5, 15, 9, 0)) === null,
    'RecurrenceEngine: null after UNTIL'
);
assert(engineV2.nextOccurrence(untilSeries, new Date(2025, 5, 15, 9, 0)) === null, 'RecurrenceEngineV2: null after UNTIL');
assert(
    RecurrenceEngine.nextOccurrence(counted, new Date(2020, 0, 1)) !== null &&
        RecurrenceEngine.nextOccurrence(counted, new Date(2020, 0, 1)).start.getTime() === counted.start.getTime(),
    'RecurrenceEngine: an instant before the series start yields the first occurrence'
);

console.log('\n=== Test 6: Non-recurring events yield exactly one occurrence ===');
const single = new Event({
    id: 'single',
    title: 'One-off',
    start: new Date(2025, 5, 4, 9, 0),
    end: new Date(2025, 5, 4, 10, 0),
    timeZone: 'UTC'
});
const singleV1 = Array.from(RecurrenceEngine.iterateOccurrences(single));
assert(
    singleV1.length === 1 && same(singleV1, RecurrenceEngine.expandEvent(single, new Date(2025, 5, 1), new Date(2025, 5, 30))),
    'RecurrenceEngine: a non-recurring event yields its one occurrence, shaped like expandEvent'
);
const singleV2 = Array.from(engineV2.iterateOccurrences(single));
assert(
    singleV2.length === 1 && singleV2[0].id === 'single' && singleV2[0].isRecurring === false,
    'RecurrenceEngineV2: a non-recurring event yields its one occurrence'
);
assert(
    RecurrenceEngine.nextOccurrence(single, single.start) === null &&
        engineV2.nextOccurrence(single, single.start) === null,
    'A non-recurring event has no occurrence after its own start'
);
assert(
    Array.from(RecurrenceEngine.iterateOccurrences(single, { before: new Date(2025, 5, 1) })).length === 0,
    'A non-recurring event outside the window yields nothing'
);

console.log('\n=== Test 7: The generator is iterable, single-use and freshly created per call ===');
for (const [name, iterate] of [
    ['RecurrenceEngine', () => RecurrenceEngine.iterateOccurrences(counted)],
    ['RecurrenceEngineV2', () => engineV2.iterateOccurrences(counted)]
]) {
    const iterator = iterate();
    assert(
        typeof iterator[Symbol.iterator] === 'function' && iterator[Symbol.iterator]() === iterator,
        `${name}: the generator is its own iterator`
    );
    const first = iterator.next();
    const rest = [...iterator];
    assert(
        !first.done && first.value.start.getTime() === counted.start.getTime() && rest.length === 9,
        `${name}: next() and spread share one cursor (${rest.length} remaining after one next())`
    );
    assert([...iterator].length === 0, `${name}: an exhausted generator yields nothing more`);
    assert([...iterate()].length === 10, `${name}: a fresh call restarts the series`);
}

console.log('\n=== Test 8: takeOccurrences bounds ===');
assert(RecurrenceEngine.takeOccurrences(counted, 0).length === 0, 'take(0) returns an empty array');
assert(RecurrenceEngine.takeOccurrences(counted, 100).length === 10, 'take(n) stops when the series ends first');
assert(
    engineV2.takeOccurrences(counted, 3).length === 3 && engineV2.takeOccurrences(counted, 3)[2].start.getTime() === june3.getTime(),
    'RecurrenceEngineV2: take(3) returns the first three occurrences'
);
const capped = RecurrenceEngine.takeOccurrences(dailySince1995, 1e9);
assert(
    capped.length === RecurrenceEngine.MAX_OCCURRENCES_HARD_LIMIT,
    `take(n) is capped at MAX_OCCURRENCES_HARD_LIMIT for an open-ended series (${capped.length})`
);

console.log('\n=== Test 9: Invalid bounds fail before iteration starts ===');
let eagerError = null;
try {
    RecurrenceEngine.iterateOccurrences(daily, { after: new Date('nope') });
} catch (error) {
    eagerError = error;
}
assert(eagerError instanceof TypeError, 'RecurrenceEngine: an invalid after throws a TypeError at call time');
eagerError = null;
try {
    engineV2.iterateOccurrences(daily, { before: 'tomorrow' });
} catch (error) {
    eagerError = error;
}
assert(eagerError instanceof TypeError, 'RecurrenceEngineV2: a non-date before throws a TypeError at call time');

console.log('\n=== Test 10: Calendar and EventStore expose the iterator ===');
const calendar = new Calendar({ timeZone: 'UTC' });
calendar.addEvent({
    id: 'standup',
    title: 'Standup',
    start: new Date(2025, 5, 1, 9, 0),
    end: new Date(2025, 5, 1, 9, 15),
    recurring: true,
    recurrenceRule: 'FREQ=DAILY',
    timeZone: 'UTC'
});
calendar.addEvent({
    id: 'launch',
    title: 'Launch',
    start: new Date(2025, 5, 4, 12, 0),
    end: new Date(2025, 5, 4, 13, 0),
    timeZone: 'UTC'
});
const nextStandup = calendar.getNextOccurrence('standup', june3);
assert(
    nextStandup && nextStandup.start.getTime() === new Date(2025, 5, 4, 9, 0).getTime() && nextStandup.recurringEventId === 'standup',
    'Calendar#getNextOccurrence returns the occurrence following the instant'
);
assert(
    starts(calendar.takeOccurrences('standup', 3, { after: june3 })) === dates(4, 5, 6),
    'Calendar#takeOccurrences returns the next n occurrences'
);
const storeExpanded = calendar.eventStore.recurrenceEngine.expandEvent(
    calendar.getEvent('standup'),
    new Date(2025, 5, 1),
    new Date(2025, 5, 30),
    { maxOccurrences: 10000, timezone: 'UTC' }
);
assert(
    same(
        Array.from(calendar.iterateOccurrences('standup', { after: new Date(2025, 5, 1), before: new Date(2025, 5, 30), inclusive: true })),
        storeExpanded
    ),
    'Calendar#iterateOccurrences over a window matches the store engine expansion'
);
const nextLaunch = calendar.getNextOccurrence('launch');
assert(
    nextLaunch && nextLaunch.id === 'launch' && nextLaunch.isRecurring === false,
    'Calendar#getNextOccurrence works for a non-recurring event'
);
let missingError = null;
try {
    calendar.iterateOccurrences('nope');
} catch (error) {
    missingError = error;
}
assert(missingError instanceof Error, 'Calendar#iterateOccurrences throws for an unknown event ID');

const store = new EventStore({ timezone: 'UTC' });
store.addEvent(makeRecurring('store-daily', 'FREQ=DAILY;COUNT=3', new Date(2025, 5, 1, 9, 0)));
assert(
    starts(Array.from(store.iterateOccurrences('store-daily'))) === dates(1, 2, 3) &&
        store.getNextOccurrence('store-daily', june3) === null &&
        store.takeOccurrences('store-daily', 2).length === 2,
    'EventStore#iterateOccurrences, getNextOccurrence and takeOccurrences agree with the engine'
);

console.log('\n=== Test 11: EnhancedCalendar reflects cancelled and modified occurrences ===');
const enhanced = new EnhancedCalendar({ timeZone: 'UTC' });
enhanced.addEvent({
    id: 'sync',
    title: 'Sync',
    start: new Date(2025, 5, 1, 9, 0),
    end: new Date(2025, 5, 1, 9, 30),
    recurring: true,
    recurrenceRule: 'FREQ=DAILY',
    timeZone: 'UTC'
});
enhanced.cancelOccurrence('sync', new Date(2025, 5, 4, 9, 0), 'Public holiday');
enhanced.modifyOccurrence('sync', new Date(2025, 5, 6, 9, 0), { title: 'Sync (extended)' });
const afterCancel = enhanced.getNextOccurrence('sync', june3);
assert(
    afterCancel && afterCancel.start.getTime() === new Date(2025, 5, 5, 9, 0).getTime(),
    'EnhancedCalendar#getNextOccurrence skips a cancelled occurrence'
);
const cancelled = enhanced.getNextOccurrence('sync', june3, { includeCancelled: true });
assert(
    cancelled && cancelled.status === 'cancelled' && cancelled.cancellationReason === 'Public holiday',
    'EnhancedCalendar#getNextOccurrence yields the cancelled occurrence with includeCancelled'
);
const modified = enhanced.takeOccurrences('sync', 2, { after: new Date(2025, 5, 5, 9, 0) });
assert(
    modified.length === 2 && modified[0].isModified === true && modified[0].title === 'Sync (extended)',
    'EnhancedCalendar#takeOccurrences applies instance modifications'
);

// Changes are visible to a generator that is already running
const live = enhanced.iterateOccurrences('sync', { after: new Date(2025, 5, 9, 9, 0) });
const june10 = live.next().value;
enhanced.cancelOccurrence('sync', new Date(2025, 5, 11, 9, 0));
const afterLiveCancel = live.next().value;
assert(
    june10.start.getDate() === 10 && afterLiveCancel.start.getDate() === 12,
    'A running generator sees an occurrence cancelled after it started'
);

if (failures > 0) {
    console.log(`\n❌ Occurrence iterator test failed: ${failures} assertion(s)`);
    process.exit(1);
}

console.log('\n✅ Occurrence iterator test complete!');
process.exit(0);
