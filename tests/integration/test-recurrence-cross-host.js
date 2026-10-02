/** Independent native-Date oracles run in each event zone, then replayed on four hosts. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RecurrenceEngineV2 } from '../../core/events/RecurrenceEngineV2.js';
import { TimezoneManager } from '../../core/timezone/TimezoneManager.js';

const hosts = ['UTC', 'America/Los_Angeles', 'Asia/Kolkata', 'Australia/Melbourne'];
const zones = [...hosts, 'America/New_York', 'Australia/Lord_Howe'];
const file = fileURLToPath(import.meta.url);
const starts = rows => rows.map(row => row.start.getTime());
const localFields = date => [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds()];
const mode = process.argv[2];

function child(mode, zone, input) {
    const result = spawnSync(process.execPath, [file, mode], {
        env: { ...process.env, TZ: zone }, input, encoding: 'utf8', timeout: 60000,
        maxBuffer: 16 * 1024 * 1024
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${zone}: ${result.stderr}\n${result.stdout}`);
    return result.stdout;
}

if (!mode) {
    const fixtures = zones.flatMap(zone => JSON.parse(child('--reference', zone)));
    for (const host of hosts) process.stdout.write(child('--assert', host, JSON.stringify(fixtures)));
    console.log('✅ Cross-host recurrence instants, wall times, seek, iterator, bounds and exceptions');
} else if (mode === '--reference') {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const fixtures = [];
    // This oracle does not import the engine's stepping, seeking or timezone helpers.
    function add(rule, start, count, advance) {
        const date = new Date(start);
        const expected = [];
        for (let i = 0; i < count; i++) {
            expected.push(date.getTime());
            advance(date);
        }
        fixtures.push({ rule: `${rule};COUNT=${count}`, zone, expected, wall: expected.map(ms => localFields(new Date(ms))) });
    }
    const start = new Date(2023, 0, 1, 9, 15, 20, 250);
    add('FREQ=DAILY', start, 800, date => date.setDate(date.getDate() + 1));
    add('FREQ=DAILY;INTERVAL=3', start, 280, date => date.setDate(date.getDate() + 3));
    add('FREQ=DAILY;BYHOUR=9,14', start, 50, date => {
        date.setDate(date.getDate() + 1);
        if (date.getHours() < 14) date.setHours(14);
        else { date.setDate(date.getDate() + 1); date.setHours(9); }
    });
    add('FREQ=WEEKLY;INTERVAL=2', start, 80, date => date.setDate(date.getDate() + 14));
    add('FREQ=WEEKLY;INTERVAL=2;BYDAY=FR,MO,WE', start, 200, date => {
        const current = date.getDay();
        const target = [1, 3, 5].find(day => day > current);
        date.setDate(date.getDate() + (target === undefined ? 14 - current + 1 : target - current));
    });
    add('FREQ=MONTHLY', start, 36, date => date.setMonth(date.getMonth() + 1));
    add('FREQ=MONTHLY;BYMONTHDAY=15', new Date(2023, 0, 15, 9), 36, date => {
        date.setMonth(date.getMonth() + 1); date.setDate(15);
    });
    add('FREQ=MONTHLY;BYMONTHDAY=-1', new Date(2023, 0, 31, 9), 36, date => {
        date.setDate(1); date.setMonth(date.getMonth() + 1);
        date.setDate(new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate());
    });
    for (const ordinal of [2, -1]) {
        add(`FREQ=MONTHLY;BYDAY=${ordinal}FR`, start, 36, date => {
            date.setDate(1); date.setMonth(date.getMonth() + 1);
            if (ordinal > 0) {
                while (date.getDay() !== 5) date.setDate(date.getDate() + 1);
                date.setDate(date.getDate() + 7);
            } else {
                date.setDate(new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate());
                while (date.getDay() !== 5) date.setDate(date.getDate() - 1);
            }
        });
    }
    add('FREQ=YEARLY', start, 5, date => date.setFullYear(date.getFullYear() + 1));
    add('FREQ=YEARLY;BYMONTH=3,11;BYMONTHDAY=15', start, 8, date => {
        if (date.getMonth() < 2) date.setMonth(2);
        else if (date.getMonth() < 10) date.setMonth(10);
        else { date.setFullYear(date.getFullYear() + 1); date.setMonth(2); }
        date.setDate(15);
    });
    add('FREQ=YEARLY;BYYEARDAY=-1', start, 5, date => {
        date.setFullYear(date.getFullYear() + 1); date.setMonth(11, 31);
    });
    for (const [month, day] of [[2, 10], [10, 3], [3, 7], [9, 6]]) {
        const transition = new Date(2024, month, day, 1, 59, 58, 250);
        add('FREQ=SECONDLY;INTERVAL=7', transition, 20, date => date.setSeconds(date.getSeconds() + 7));
        add('FREQ=MINUTELY;INTERVAL=13', transition, 20, date => date.setMinutes(date.getMinutes() + 13));
        add('FREQ=HOURLY;INTERVAL=2', transition, 20, date => date.setHours(date.getHours() + 2));
        add('FREQ=DAILY', new Date(2024, month, day - 2, 2, 30), 8, date => date.setDate(date.getDate() + 1));
    }
    process.stdout.write(JSON.stringify(fixtures));
} else {
    const fixtures = JSON.parse(readFileSync(0, 'utf8'));
    for (const { rule, zone, expected, wall } of fixtures) {
        const event = { id: 'zone', title: 'Zone recurrence', recurring: true, recurrenceRule: rule,
            timeZone: zone, start: new Date(expected[0]), end: new Date(expected[0] + 3600000) };
        const engine = new RecurrenceEngineV2();
        const label = `${process.env.TZ}/${zone}: ${rule} at ${event.start.toISOString()}`;
        const before = new Date(expected.at(-1));
        const rows = engine.expandEvent(event, event.start, before, { maxOccurrences: 2000 });
        assert.deepEqual(starts(rows), expected, `${label}: native wall-clock oracle`);
        const formatter = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: 'numeric',
            day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' });
        const wallFields = rows.map(row => {
            const parts = Object.fromEntries(formatter.formatToParts(row.start).map(part => [part.type, part.value]));
            return ['year', 'month', 'day', 'hour', 'minute', 'second'].map(field => +parts[field]);
        });
        assert.deepEqual(wallFields, wall, `${label}: named-zone calendar fields`);
        assert.ok(rows.every(row => row.end - row.start === 3600000), `${label}: duration`);
        assert.deepEqual(starts([...engine.iterateOccurrences(event)]), expected, `${label}: independent iterator`);
        assert.deepEqual(starts(engine.expandEvent(event, event.start, before, { maxOccurrences: 2000, handleDST: false })), expected,
            `${label}: compatible handleDST option does not double-adjust instants`);
        for (const index of [1, Math.floor(expected.length / 2), expected.length - 2]) {
            const after = new Date(expected[index] + 1);
            const endIndex = Math.min(index + 3, expected.length - 1);
            const end = new Date(expected[endIndex]);
            const filtered = expected.filter(ms => ms >= after && ms <= end);
            assert.deepEqual(starts(engine.expandEvent(event, after, end)), filtered, `${label}: seek and bounds`);
            assert.deepEqual(starts([...engine.iterateOccurrences(event, { after, before: end, inclusive: true })]), filtered,
                `${label}: iterator seek and bounds`);
            assert.deepEqual(starts([...engine.iterateOccurrences(event, {
                after: new Date(expected[index]), before: end
            })]), expected.filter(ms => ms > expected[index] && ms < end), `${label}: exclusive bounds`);
        }
        assert.equal(engine.nextOccurrence(event, before), null, `${label}: COUNT exhausted`);
        const walking = new RecurrenceEngineV2();
        walking.seekToRange = () => {};
        const after = new Date(expected[Math.floor(expected.length / 2)]);
        assert.deepEqual(starts(walking.expandEvent(event, after, before, { maxOccurrences: 2000 })),
            expected.filter(ms => ms >= after), `${label}: seek-disabled filtering`);
    }

    const engine = new RecurrenceEngineV2();
    const start = new Date('2024-01-01T09:00:00Z');
    const event = { id: 'utc-year', start, end: new Date(+start + 3600000), recurring: true,
        timeZone: 'UTC', recurrenceRule: 'FREQ=DAILY;COUNT=365' };
    const expected = Array.from({ length: 365 }, (_, day) => +start + day * 86400000);
    assert.deepEqual(starts(engine.expandEvent(event, start, new Date('2034-12-31T00:00Z'), { maxOccurrences: 2000 })), expected,
        'ten-year window must not apply future host transitions to a one-year UTC series');
    const old = { ...event, start: new Date('1995-01-01T09:00:00Z'), recurrenceRule: 'FREQ=SECONDLY;INTERVAL=7' };
    old.end = new Date(+old.start + 3600000);
    const target = new Date('2026-01-01T09:00:00Z');
    const first = +old.start + Math.ceil((target - old.start) / 7000) * 7000;
    let steps = 0;
    const advance = engine.getNextDate.bind(engine);
    engine.getNextDate = (...args) => { steps++; return advance(...args); };
    assert.deepEqual(starts(engine.takeOccurrences(old, 5, { after: target, inclusive: true })),
        Array.from({ length: 5 }, (_, i) => first + i * 7000), 'decades-old explicit UTC seek');
    assert.ok(steps < 20, `UTC seek must skip arithmetically: ${steps}`);

    // UTC, floating UNTIL, date-only EXDATE, and overrides near a zone's midnight.
    const tokyo = { ...event, id: 'tokyo', timeZone: 'Asia/Tokyo', start: new Date('2024-01-01T15:30Z'),
        end: new Date('2024-01-01T16:30Z'), recurrenceRule: 'FREQ=DAILY;UNTIL=20240105T003000;EXDATE=20240103' };
    const bounds = [new Date('2024-01-01T00:00Z'), new Date('2024-01-10T00:00Z')];
    const tokyoExpected = ['2024-01-01T15:30Z', '2024-01-03T15:30Z', '2024-01-04T15:30Z'].map(Date.parse);
    assert.deepEqual(starts(engine.expandEvent(tokyo, ...bounds)), tokyoExpected, 'floating rule dates use event zone');
    engine.addException(tokyo.id, new Date('2024-01-03T16:00Z'), 'Zone holiday');
    engine.addModifiedInstance(tokyo.id, new Date('2024-01-04T17:00Z'), { title: 'Zone edit' });
    const overridden = engine.expandEvent(tokyo, ...bounds, { includeCancelled: true });
    assert.equal(overridden[1].status, 'cancelled');
    assert.equal(overridden[2].status, 'cancelled');
    assert.equal(overridden[2].cancellationReason, 'Zone holiday');
    assert.equal(overridden[3].title, 'Zone edit');
    assert.equal(overridden[3].isModified, true);
    engine.addModifiedInstance(tokyo.id, new Date('2024-01-04T16:00Z'), { title: 'Later edit' });
    engine.addModifiedInstance(tokyo.id, new Date('2024-01-04T17:00Z'), { title: 'Latest edit' });
    assert.equal(engine.expandEvent(tokyo, ...bounds).at(-1).title, 'Latest edit', 'last edit on the zoned date wins');

    const override = { ...event, timeZone: 'America/New_York' };
    assert.deepEqual(starts(engine.expandEvent(override, start, new Date('2024-12-31T00:00Z'),
        { maxOccurrences: 2000, timezone: 'UTC' })), expected, 'explicit option overrides event zone');
    const cacheEvent = { ...event, id: 'zone-cache', start: new Date('2024-03-09T14:00Z'),
        end: new Date('2024-03-09T15:00Z'), recurrenceRule: 'FREQ=DAILY;COUNT=3' };
    const cacheEnd = new Date('2024-03-12T00:00Z');
    engine.expandEvent(cacheEvent, cacheEvent.start, cacheEnd);
    cacheEvent.timeZone = 'America/New_York';
    assert.deepEqual(starts(engine.expandEvent(cacheEvent, cacheEvent.start, cacheEnd)),
        ['2024-03-09T14:00Z', '2024-03-10T13:00Z', '2024-03-11T13:00Z'].map(Date.parse), 'cache includes default event zone');

    const offsets = TimezoneManager.getInstance();
    assert.equal(offsets.getTimezoneOffset(new Date('2024-01-01T00:00Z'), 'Asia/Kolkata', true), -330);
    assert.equal(offsets.getTimezoneOffset(new Date('2024-07-01T00:00Z'), 'America/Los_Angeles', true), 420);
    console.log(`  ✅ ${fixtures.length} independent zone fixtures and cross-host regressions on ${process.env.TZ}`);
}
