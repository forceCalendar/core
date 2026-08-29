/**
 * Test recurrence expansion consistency
 */

import { Event } from '../../core/events/Event.js';
import { EventStore } from '../../core/events/EventStore.js';
import { RecurrenceEngine } from '../../core/events/RecurrenceEngine.js';
import { RecurrenceEngineV2 } from '../../core/events/RecurrenceEngineV2.js';
import { Calendar } from '../../core/calendar/Calendar.js';

console.log('Testing recurrence functionality...\n');

let failures = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`  ✅ ${message}`);
    } else {
        console.log(`  ❌ ${message}`);
        failures++;
    }
}

console.log('=== Test 1: EventStore recurring range expansion ===');
const store = new EventStore();
store.addEvent({
    id: 'daily-1',
    title: 'Daily Standup',
    start: new Date('2025-01-01T09:00:00'),
    end: new Date('2025-01-01T09:15:00'),
    recurring: true,
    recurrenceRule: 'FREQ=DAILY;COUNT=5',
    timeZone: 'UTC'
});

const laterOccurrences = store.getEventsInRange(
    new Date('2025-01-03T00:00:00'),
    new Date('2025-01-03T23:59:59')
);

assert(laterOccurrences.length === 1, 'Recurring series is expanded after original start date');
assert(laterOccurrences[0] instanceof Event, 'Expanded occurrence is returned as Event instance');
assert(
    laterOccurrences[0].metadata.recurringEventId === 'daily-1',
    'Expanded occurrence keeps recurring parent metadata'
);
assert(
    typeof laterOccurrences[0].getStartInTimezone === 'function',
    'Expanded occurrence keeps Event methods'
);

console.log('\n=== Test 2: RecurrenceEngineV2 cache isolation ===');
const engine = new RecurrenceEngineV2();
const event = new Event({
    id: 'cache-1',
    title: 'Cache Test',
    start: new Date('2025-02-01T10:00:00'),
    end: new Date('2025-02-01T11:00:00'),
    recurring: true,
    recurrenceRule: 'FREQ=DAILY;COUNT=2',
    timeZone: 'UTC'
});

const firstExpansion = engine.expandEvent(
    event,
    new Date('2025-02-01T00:00:00'),
    new Date('2025-02-03T00:00:00')
);
firstExpansion[0].title = 'Mutated Title';
firstExpansion[0].start.setFullYear(2030);

const secondExpansion = engine.expandEvent(
    event,
    new Date('2025-02-01T00:00:00'),
    new Date('2025-02-03T00:00:00')
);

assert(secondExpansion[0].title === 'Cache Test', 'Cached occurrence object cannot be mutated by caller');
assert(secondExpansion[0].start.getFullYear() === 2025, 'Cached occurrence Date cannot be mutated by caller');

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

// Reference expansion with seeking disabled: the engine walks every
// occurrence from the series start, so the result is what the expansion
// loop alone produces for the same query
function withoutSeek(fn) {
    const { _seekFixedStep, _seekWeekCycle } = RecurrenceEngine;
    RecurrenceEngine._seekFixedStep = (fromMs, rangeStartMs, rangeEndMs) => ({
        ms: fromMs,
        steps: 0,
        nextSystemTransition: RecurrenceEngine._nextSystemTransition(fromMs, rangeEndMs)
    });
    RecurrenceEngine._seekWeekCycle = (fromMs, weekday, rangeStartMs, rangeEndMs) => ({
        ms: fromMs,
        steps: 0,
        weekday,
        nextSystemTransition: RecurrenceEngine._nextSystemTransition(fromMs, rangeEndMs)
    });
    try {
        return fn();
    } finally {
        RecurrenceEngine._seekFixedStep = _seekFixedStep;
        RecurrenceEngine._seekWeekCycle = _seekWeekCycle;
    }
}

function bruteForceV1(event, rangeStart, rangeEnd) {
    return withoutSeek(() => RecurrenceEngine.expandEvent(event, rangeStart, rangeEnd, 10000));
}

function bruteForceV2(event, rangeStart, rangeEnd) {
    const engine = new RecurrenceEngineV2();
    engine.seekToRange = () => {};
    return engine.expandEvent(event, rangeStart, rangeEnd, { maxOccurrences: 10000 });
}

console.log('\n=== Test 3: Series older than the occurrence cap stay visible ===');
const june2025Start = new Date(2025, 5, 1);
const june2025End = new Date(2025, 5, 30, 23, 59);
const dailySince2024 = makeRecurring('old-daily', 'FREQ=DAILY', new Date(2024, 0, 1, 9, 0));

const v1Default = RecurrenceEngine.expandEvent(dailySince2024, june2025Start, june2025End);
assert(v1Default.length === 30, `RecurrenceEngine default cap returns June 2025 for a 2024 daily series (${v1Default.length})`);

const v2Default = new RecurrenceEngineV2().expandEvent(dailySince2024, june2025Start, june2025End);
assert(v2Default.length === 30, `RecurrenceEngineV2 default cap returns June 2025 for a 2024 daily series (${v2Default.length})`);
assert(
    v2Default.length === 30 &&
        v2Default[0].start.getTime() === new Date(2025, 5, 1, 9, 0).getTime() &&
        v2Default[29].start.getTime() === new Date(2025, 5, 30, 9, 0).getTime(),
    'Seeked occurrences keep the series wall-clock time'
);
assert(
    v2Default.map(o => o.start.toDateString()).join() === v1Default.map(o => o.start.toDateString()).join(),
    'Both engines agree on which days the seeked occurrences fall on'
);

const dailySince1995 = makeRecurring('very-old-daily', 'FREQ=DAILY', new Date(1995, 0, 1, 9, 0));
assert(
    RecurrenceEngine.expandEvent(dailySince1995, june2025Start, june2025End).length === 30,
    'RecurrenceEngine expands a daily series started 30 years before the range'
);
assert(
    new RecurrenceEngineV2().expandEvent(dailySince1995, june2025Start, june2025End).length === 30,
    'RecurrenceEngineV2 expands a daily series started 30 years before the range'
);

const oldStore = new EventStore();
oldStore.addEvent({
    id: 'store-old-daily',
    title: 'Old Daily',
    start: new Date(2024, 0, 1, 9, 0),
    end: new Date(2024, 0, 1, 10, 0),
    recurring: true,
    recurrenceRule: 'FREQ=DAILY',
    timeZone: 'UTC'
});
assert(
    oldStore.getEventsInRange(june2025Start, june2025End).length === 30,
    'EventStore.getEventsInRange expands a series started 17 months earlier'
);

const oldCalendar = new Calendar({ timeZone: 'UTC' });
oldCalendar.addEvent({
    id: 'cal-old-daily',
    title: 'Old Daily',
    start: new Date(2024, 0, 1, 9, 0),
    end: new Date(2024, 0, 1, 10, 0),
    recurring: true,
    recurrenceRule: 'FREQ=DAILY',
    timeZone: 'UTC'
});
assert(
    oldCalendar.getEventsInRange(new Date(2026, 2, 1), new Date(2026, 2, 31, 23, 59)).length === 31,
    'Calendar.getEventsInRange shows March 2026 for a daily series from 2024'
);
oldCalendar.destroy();

console.log('\n=== Test 4: COUNT and UNTIL are measured from the series start ===');
const counted = makeRecurring('counted', 'FREQ=DAILY;COUNT=10', new Date(2024, 0, 1, 9, 0));
assert(
    RecurrenceEngine.expandEvent(counted, june2025Start, june2025End).length === 0,
    'RecurrenceEngine: COUNT=10 series produces nothing 17 months after it ended'
);
assert(
    new RecurrenceEngineV2().expandEvent(counted, june2025Start, june2025End).length === 0,
    'RecurrenceEngineV2: COUNT=10 series produces nothing 17 months after it ended'
);
const countedTail = RecurrenceEngine.expandEvent(counted, new Date(2024, 0, 8), new Date(2024, 0, 31));
assert(
    countedTail.length === 3 && countedTail[2].start.getTime() === new Date(2024, 0, 10, 9, 0).getTime(),
    `RecurrenceEngine: seeking into a COUNT series keeps the last occurrences (${countedTail.length})`
);
const countedTailV2 = new RecurrenceEngineV2().expandEvent(counted, new Date(2024, 0, 8), new Date(2024, 0, 31));
assert(starts(countedTailV2) === starts(countedTail), 'RecurrenceEngineV2: seeking into a COUNT series matches');

const weeklyCounted = makeRecurring('weekly-counted', 'FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=7', new Date(2024, 0, 1, 9, 0));
const weeklyTail = RecurrenceEngine.expandEvent(weeklyCounted, new Date(2024, 0, 10), new Date(2024, 1, 1));
assert(
    weeklyTail.length === 3 && weeklyTail[2].start.getTime() === new Date(2024, 0, 15, 9, 0).getTime(),
    `BYDAY COUNT series: seek stops on the COUNT boundary (${weeklyTail.length})`
);

const untilBefore = makeRecurring('until-before', 'FREQ=DAILY;UNTIL=20250101T000000Z', new Date(2024, 0, 1, 9, 0));
assert(
    RecurrenceEngine.expandEvent(untilBefore, june2025Start, june2025End).length === 0,
    'RecurrenceEngine: UNTIL before the range yields nothing'
);
assert(
    new RecurrenceEngineV2().expandEvent(untilBefore, june2025Start, june2025End).length === 0,
    'RecurrenceEngineV2: UNTIL before the range yields nothing'
);
const untilInside = makeRecurring('until-inside', 'FREQ=DAILY;UNTIL=20250610T235959Z', new Date(2024, 0, 1, 9, 0));
const untilInsideV1 = RecurrenceEngine.expandEvent(untilInside, june2025Start, june2025End);
const untilInsideV2 = new RecurrenceEngineV2().expandEvent(untilInside, june2025Start, june2025End);
const untilLimit = RecurrenceEngine.parseRule(untilInside.recurrenceRule).until;
assert(
    untilInsideV2.length > 0 &&
        untilInsideV2.length < 30 &&
        untilInsideV2.every(o => o.start <= untilLimit) &&
        untilInsideV2.length === untilInsideV1.length,
    `UNTIL inside the range is honoured after seeking (${untilInsideV1.length}/${untilInsideV2.length})`
);

console.log('\n=== Test 5: Seeking produces exactly what stepping from the start would ===');
const seekCases = [
    ['FREQ=DAILY', new Date(2019, 2, 3, 2, 30)],
    ['FREQ=DAILY;INTERVAL=3', new Date(2017, 10, 5, 1, 30)],
    ['FREQ=WEEKLY', new Date(2015, 9, 31, 23, 45)],
    ['FREQ=WEEKLY;BYDAY=MO,WE', new Date(2018, 0, 1, 9, 0)],
    ['FREQ=WEEKLY;BYDAY=TU,TH,SA', new Date(2018, 0, 3, 2, 15)],
    ['FREQ=WEEKLY;BYDAY=SU', new Date(2021, 5, 15, 12, 0)],
    ['FREQ=HOURLY', new Date(2020, 0, 1, 9, 0)],
    ['FREQ=HOURLY;INTERVAL=7', new Date(2022, 2, 12, 22, 0)],
    ['FREQ=MINUTELY;INTERVAL=45', new Date(2024, 9, 26, 0, 10)]
];
const seekWindows = [
    [new Date(2025, 2, 8), new Date(2025, 2, 12)],
    [new Date(2025, 10, 1, 12), new Date(2025, 10, 4)],
    [new Date(2026, 0, 1), new Date(2026, 0, 31, 23, 59)]
];
let nonEmptySeeks = 0;
for (const [rule, start] of seekCases) {
    const series = makeRecurring(`seek-${rule}`, rule, start, 30);
    for (const [rangeStart, rangeEnd] of seekWindows) {
        const seeked = RecurrenceEngine.expandEvent(series, rangeStart, rangeEnd, 10000);
        const reference = bruteForceV1(series, rangeStart, rangeEnd);
        if (seeked.length > 0) nonEmptySeeks++;
        assert(
            starts(seeked) === starts(reference),
            `${rule} from ${start.toDateString()} in ${rangeStart.toDateString()} window matches stepping (${seeked.length})`
        );
        const seekedV2 = new RecurrenceEngineV2().expandEvent(series, rangeStart, rangeEnd, { maxOccurrences: 10000 });
        const referenceV2 = bruteForceV2(series, rangeStart, rangeEnd);
        assert(
            starts(seekedV2) === starts(referenceV2),
            `RecurrenceEngineV2 ${rule} from ${start.toDateString()} in ${rangeStart.toDateString()} window matches stepping (${seekedV2.length})`
        );
    }
}
assert(nonEmptySeeks >= 20, `Seek comparison exercised non-empty windows (${nonEmptySeeks})`);

const jan2026Start = new Date(2026, 0, 1);
const jan2026End = new Date(2026, 0, 31, 23, 59);
const weeklyByDay = makeRecurring('weekly-byday', 'FREQ=WEEKLY;BYDAY=MO,WE', new Date(2018, 0, 1, 9, 0));
const weeklyByDayV1 = RecurrenceEngine.expandEvent(weeklyByDay, jan2026Start, jan2026End);
assert(
    weeklyByDayV1.length === 8 && weeklyByDayV1.every(o => o.start.getDay() === 1 || o.start.getDay() === 3),
    `Weekly BYDAY series from 2018 yields the Mondays and Wednesdays of January 2026 (${weeklyByDayV1.length})`
);

console.log('\n=== Test 6: maxOccurrences and the hard limits still bound the output ===');
const twoYears = RecurrenceEngine.expandEvent(dailySince2024, new Date(2024, 0, 1), new Date(2025, 11, 31), 100);
assert(twoYears.length === 100, `maxOccurrences caps occurrences inside the range (${twoYears.length})`);
const capped = RecurrenceEngine.expandEvent(dailySince1995, new Date(1995, 0, 1), new Date(2030, 0, 1), 1e9);
assert(
    capped.length === RecurrenceEngine.MAX_OCCURRENCES_HARD_LIMIT,
    `MAX_OCCURRENCES_HARD_LIMIT still applies to returned occurrences (${capped.length})`
);
const cappedV2 = new RecurrenceEngineV2().expandEvent(dailySince1995, new Date(1995, 0, 1), new Date(2030, 0, 1), {
    maxOccurrences: 1e9
});
assert(
    cappedV2.length === RecurrenceEngineV2.MAX_OCCURRENCES_HARD_LIMIT,
    `RecurrenceEngineV2 MAX_OCCURRENCES_HARD_LIMIT still applies (${cappedV2.length})`
);

// A rule with no arithmetic seek walks from the series start; the iteration
// guard keeps that bounded even for a pathological distance
const unseekable = makeRecurring('unseekable', 'FREQ=DAILY;BYHOUR=9,14', new Date(1990, 0, 1, 9, 0));
const unseekableV2 = new RecurrenceEngineV2().expandEvent(unseekable, june2025Start, june2025End);
assert(unseekableV2.length > 0, `Rules without a seek still walk to the range within the guard (${unseekableV2.length})`);
const farUnseekable = makeRecurring('far-unseekable', 'FREQ=DAILY;BYHOUR=9', new Date(1500, 0, 1, 9, 0));
const guardStart = Date.now();
const guarded = new RecurrenceEngineV2().expandEvent(farUnseekable, june2025Start, june2025End);
const guardMs = Date.now() - guardStart;
assert(
    Array.isArray(guarded) && guardMs < 2000,
    `Iteration guard bounds the work for a series 500 years before the range (${guardMs}ms)`
);

if (failures > 0) {
    console.log(`\n❌ Recurrence test failed: ${failures} assertion(s)`);
    process.exit(1);
}

console.log('\n✅ Recurrence functionality test complete!');
process.exit(0);
