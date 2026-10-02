/**
 * SECONDLY must behave the same through the default engine, its lazy API,
 * and EventStore. Exercise seeking and local Date stepping in separate
 * processes because the system-timezone transition cache is process-wide.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Event } from '../../core/events/Event.js';
import { EventStore } from '../../core/events/EventStore.js';
import { RecurrenceEngine } from '../../core/events/RecurrenceEngine.js';
import { RecurrenceEngineV2 } from '../../core/events/RecurrenceEngineV2.js';

if (process.argv[2] !== '--timezone-child') {
    for (const timezone of ['UTC', 'America/New_York', 'Australia/Lord_Howe']) {
        const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--timezone-child'], {
            env: { ...process.env, TZ: timezone },
            encoding: 'utf8',
            timeout: 30000
        });
        process.stdout.write(result.stdout || '');
        process.stderr.write(result.stderr || '');
        assert.ifError(result.error);
        assert.equal(result.status, 0, `SECONDLY regression tests pass in ${timezone}`);
    }
    console.log('✅ SECONDLY recurrence tests passed in three system timezones');
} else {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const start = new Date('2026-01-01T09:00:00Z');
    const at = seconds => new Date(start.getTime() + seconds * 1000);
    const starts = occurrences => occurrences.map(occurrence => occurrence.start.getTime());
    const makeEvent = (rule, eventStart = start, timeZone = 'UTC') => new Event({
        id: 'secondly',
        title: 'Second-by-second',
        start: eventStart,
        end: new Date(eventStart.getTime() + 1000),
        timeZone,
        recurring: true,
        recurrenceRule: rule
    });
    const assertStarts = (occurrences, expected, label) => {
        assert.deepEqual(starts(occurrences), expected.map(date => date.getTime()), label);
        assert.ok(occurrences.every(occurrence => occurrence.end - occurrence.start === 1000), `${label}: duration`);
    };

    // COUNT includes DTSTART, and an omitted INTERVAL means one second.
    const event = makeEvent('FREQ=SECONDLY;COUNT=3');
    const engine = new RecurrenceEngineV2();
    const expanded = engine.expandEvent(event, start, at(10));
    assertStarts(expanded, [at(0), at(1), at(2)], 'default interval and COUNT');
    assert.deepEqual(starts(expanded), starts(RecurrenceEngine.expandEvent(event, start, at(10))), 'V1 parity');
    assertStarts([...engine.iterateOccurrences(event)], [at(0), at(1), at(2)], 'unbounded iterator stops at COUNT');
    assert.equal(engine.nextOccurrence(event, at(2)), null, 'no occurrence beyond COUNT');
    assertStarts(engine.expandEvent(makeEvent('FREQ=SECONDLY;COUNT=1'), start, at(10)), [start], 'COUNT=1');
    assertStarts(engine.expandEvent(makeEvent({ freq: 'SECONDLY', interval: 2, count: 3 }), start, at(10)),
        [at(0), at(2), at(4)], 'object rule');

    const intervalEvent = makeEvent('FREQ=SECONDLY;INTERVAL=7;COUNT=5');
    assertStarts(engine.expandEvent(intervalEvent, at(8), at(40)), [at(14), at(21), at(28)], 'seek preserves interval and skipped COUNT');
    assertStarts([...engine.iterateOccurrences(intervalEvent, { after: at(8) })],
        [at(14), at(21), at(28)], 'iterator seek preserves skipped COUNT');
    assertStarts(engine.expandEvent(intervalEvent, at(29), at(40)), [], 'window after COUNT');
    assertStarts([...engine.iterateOccurrences(intervalEvent, { after: at(29) })], [], 'iterator after COUNT');
    assertStarts(engine.expandEvent(intervalEvent, at(-10), at(-1)), [], 'window before DTSTART');
    assertStarts(engine.expandEvent(intervalEvent, at(7), at(21)), [at(7), at(14), at(21)], 'closed expansion window');
    assertStarts([...engine.iterateOccurrences(intervalEvent, { after: at(7), before: at(21) })], [at(14)], 'exclusive iterator bounds');
    assertStarts([...engine.iterateOccurrences(intervalEvent, { after: at(7), before: at(21), inclusive: true })],
        [at(7), at(14), at(21)], 'inclusive iterator bounds');
    assertStarts(engine.takeOccurrences(intervalEvent, 2, { after: at(7) }), [at(14), at(21)], 'takeOccurrences limit');
    assert.equal(engine.nextOccurrence(intervalEvent, at(7)).start.getTime(), at(14).getTime(), 'nextOccurrence advances by seconds');
    assertStarts(engine.expandEvent(intervalEvent, start, at(40), { maxOccurrences: 2 }), [at(0), at(7)], 'expansion limit');

    const untilEvent = makeEvent('FREQ=SECONDLY;INTERVAL=2;UNTIL=20260101T090006Z');
    assertStarts(engine.expandEvent(untilEvent, at(3), at(10)), [at(4), at(6)], 'UNTIL is inclusive after seeking');
    assertStarts([...engine.iterateOccurrences(untilEvent, { after: at(3) })], [at(4), at(6)], 'iterator ends at UNTIL');
    assertStarts(engine.expandEvent(untilEvent, at(7), at(10)), [], 'window after UNTIL');
    assert.equal(engine.nextOccurrence(untilEvent, at(6)), null, 'no occurrence beyond UNTIL');

    // Local second increments must roll minutes, days, and years, keeping
    // millisecond precision and the existing wall-clock stepping semantics.
    const rollover = makeEvent('FREQ=SECONDLY;COUNT=4', new Date(2025, 11, 31, 23, 59, 58, 250), timezone);
    const rolloverExpected = [
        new Date(2025, 11, 31, 23, 59, 58, 250),
        new Date(2025, 11, 31, 23, 59, 59, 250),
        new Date(2026, 0, 1, 0, 0, 0, 250),
        new Date(2026, 0, 1, 0, 0, 1, 250)
    ];
    assertStarts(engine.expandEvent(rollover, rollover.start, rolloverExpected[3]), rolloverExpected, 'calendar boundary');
    assertStarts([...engine.iterateOccurrences(rollover)], rolloverExpected, 'iterator calendar boundary');

    // Compare arithmetic seeking against explicit Date#setSeconds steps
    // over spring/fall transitions, including Lord Howe's half-hour change.
    const boundaryStarts = [
        new Date(2026, 2, 8, 1, 59, 58),
        new Date(2026, 10, 1, 1, 59, 58),
        new Date(2026, 3, 5, 1, 59, 58),
        new Date(2026, 9, 4, 1, 59, 58)
    ];
    for (const boundary of boundaryStarts) {
        for (const interval of [1, 7, 61]) {
            const stepped = [new Date(boundary)];
            for (let i = 1; i < 12; i++) {
                const next = new Date(stepped[i - 1]);
                next.setSeconds(next.getSeconds() + interval);
                stepped.push(next);
            }
            const boundaryEvent = makeEvent(`FREQ=SECONDLY;INTERVAL=${interval};COUNT=12`, boundary, timezone);
            const after = new Date(stepped[5].getTime() + 200);
            const before = stepped[8];
            const expected = stepped.slice(6, 9);
            const label = `${timezone} ${boundary.toISOString()} interval ${interval}`;
            assertStarts(new RecurrenceEngineV2().expandEvent(boundaryEvent, after, before), expected, `DST seek: ${label}`);
            assertStarts([...new RecurrenceEngineV2().iterateOccurrences(boundaryEvent, { after, before, inclusive: true })],
                expected, `DST iterator: ${label}`);
        }
    }

    // A decades-old secondly series must seek, rather than exhausting the
    // iteration budget before reaching the requested window.
    const oldEvent = makeEvent('FREQ=SECONDLY;INTERVAL=7', new Date('1995-01-01T09:00:00Z'));
    const oldEngine = new RecurrenceEngineV2();
    const getNextDate = oldEngine.getNextDate;
    let steps = 0;
    oldEngine.getNextDate = function (...args) {
        steps++;
        return getNextDate.apply(this, args);
    };
    const oldExpected = RecurrenceEngine.expandEvent(oldEvent, start, at(60), 5);
    assert.equal(oldExpected.length, 5, 'V1 old-series oracle returns five occurrences');
    assertStarts(oldEngine.expandEvent(oldEvent, start, at(60), { maxOccurrences: 5 }),
        oldExpected.map(occurrence => occurrence.start), 'decades-old expansion');
    assert.ok(steps < 200, `old expansion uses bounded seeking (${steps} steps)`);
    steps = 0;
    assertStarts(oldEngine.takeOccurrences(oldEvent, 5, { after: start, inclusive: true }),
        oldExpected.map(occurrence => occurrence.start), 'decades-old iterator');
    assert.ok(steps < 200, `old iterator uses bounded seeking (${steps} steps)`);
    const exhaustedOldEvent = makeEvent('FREQ=SECONDLY;COUNT=100', oldEvent.start);
    assertStarts(oldEngine.expandEvent(exhaustedOldEvent, start, at(60)), [], 'old COUNT is exhausted before range');

    const store = new EventStore({ timezone: 'UTC' });
    try {
        store.addEvent(event);
        const occurrences = store.getEventsInRange(start, at(10));
        assertStarts(occurrences, [at(0), at(1), at(2)], 'EventStore default recurrence engine');
        assert.ok(occurrences.every(occurrence => occurrence instanceof Event && occurrence.isOccurrence), 'store returns occurrence Events');
        assert.equal(new Set(occurrences.map(occurrence => occurrence.id)).size, 3, 'store occurrence IDs are unique');
        assert.ok(occurrences.every(occurrence => occurrence.recurringEventId === event.id), 'store occurrences reference the master');
    } finally {
        store.destroy();
    }
    console.log(`  ✅ SECONDLY expansion, iteration, seeking, boundaries and EventStore (${timezone})`);
}
