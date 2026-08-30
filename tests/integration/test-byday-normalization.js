/**
 * Test that BYDAY values are normalised by the parser and that neither
 * recurrence engine can be made to loop forever by a BYDAY value it does
 * not understand.
 *
 * Before this test existed, a rule such as FREQ=MONTHLY;BYDAY=+1MO (valid
 * per RFC 5545) was kept as '+1MO' by RRuleParser, which the MONTHLY
 * expansion paths could not map to a weekday; their weekday search then
 * spun forever. Expansions are therefore run in a child process with a
 * hard timeout, so a regression fails the test instead of hanging it.
 */

import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { RRuleParser } from '../../core/events/RRuleParser.js';
import { RecurrenceEngine } from '../../core/events/RecurrenceEngine.js';
import { RecurrenceEngineV2 } from '../../core/events/RecurrenceEngineV2.js';
import { Calendar } from '../../core/calendar/Calendar.js';

const SELF = fileURLToPath(import.meta.url);
const TIME_BUDGET_MS = 5000;

// Child mode: expand one rule with one engine and print the occurrence
// starts as JSON. Exits non-zero if the expansion throws.
if (process.argv[2] === '--expand') {
    const [engine, rule, startIso] = process.argv.slice(3);
    const start = new Date(startIso);
    const event = {
        id: 'series',
        title: 'Series',
        start,
        end: new Date(start.getTime() + 3600000),
        recurring: true,
        recurrenceRule: rule,
        timeZone: 'UTC'
    };
    const rangeStart = new Date(2025, 0, 1);
    const rangeEnd = new Date(2025, 11, 31, 23, 59, 59);
    let starts;
    try {
        if (engine === 'v1') {
            starts = RecurrenceEngine.expandEvent(event, rangeStart, rangeEnd).map(o => o.start);
        } else if (engine === 'v2') {
            starts = new RecurrenceEngineV2().expandEvent(event, rangeStart, rangeEnd).map(o => o.start);
        } else {
            const calendar = new Calendar({ view: 'month', date: rangeStart });
            calendar.addEvent(event);
            starts = calendar.getEventsInRange(rangeStart, rangeEnd).map(e => e.start);
        }
    } catch (error) {
        process.stdout.write(JSON.stringify({ error: error.message }));
        process.exit(2);
    }
    process.stdout.write(JSON.stringify({ starts: starts.map(d => new Date(d).toISOString()) }));
    process.exit(0);
}

console.log('Testing BYDAY normalisation and bounded weekday searches...\n');

let failures = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`  ✅ ${message}`);
    } else {
        console.log(`  ❌ ${message}`);
        failures++;
    }
}

function assertThrows(fn, message, pattern = /BYDAY/) {
    try {
        fn();
        assert(false, `${message} (no error thrown)`);
    } catch (error) {
        assert(pattern.test(error.message), `${message}: ${error.message}`);
    }
}

// Runs the expansion in a child process under a time budget
function expandInChild(engine, rule, start) {
    const began = Date.now();
    const result = spawnSync(process.execPath, [SELF, '--expand', engine, rule, start.toISOString()], {
        timeout: TIME_BUDGET_MS,
        encoding: 'utf8'
    });
    const elapsed = Date.now() - began;
    if (result.error || result.signal) {
        return { timedOut: true, elapsed };
    }
    let payload;
    try {
        payload = JSON.parse(result.stdout);
    } catch {
        payload = { error: `unparseable output: ${result.stdout} ${result.stderr}` };
    }
    return { ...payload, status: result.status, elapsed };
}

const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// --- Parser normalisation ---
console.log('Parser:');
assert(sameList(RRuleParser.parse('FREQ=MONTHLY;BYDAY=+1MO').byDay, ['1MO']), '+1MO is normalised to 1MO');
assert(sameList(RRuleParser.parse('FREQ=MONTHLY;BYDAY=+2tu').byDay, ['2TU']), '+2tu is normalised to 2TU');
assert(sameList(RRuleParser.parse('FREQ=MONTHLY;BYDAY=-1fr').byDay, ['-1FR']), '-1fr is normalised to -1FR');
assert(
    sameList(RRuleParser.parse('FREQ=WEEKLY;BYDAY=mo,We,+3FR,-2sa').byDay, ['MO', 'WE', '3FR', '-2SA']),
    'Mixed-case list with signed ordinals is normalised'
);
assert(
    sameList(RRuleParser.parse('FREQ=WEEKLY;BYDAY=MO,,WE,').byDay, ['MO', 'WE']),
    'Empty list items are ignored'
);
assert(
    sameList(RRuleParser.parse({ freq: 'MONTHLY', byDay: ['+1MO', ' -1fr '] }).byDay, ['1MO', '-1FR']),
    'Rule objects have their BYDAY strings normalised'
);
const objectRule = RRuleParser.parse({ freq: 'MONTHLY', byDay: [{ nth: 2, weekday: 'tu' }] });
assert(
    objectRule.byDay.length === 1 && objectRule.byDay[0].weekday === 'TU' && objectRule.byDay[0].nth === 2,
    'Rule objects keep { nth, weekday } entries with the weekday normalised'
);
assert(
    sameList(RRuleParser.parse({ freq: 'WEEKLY', byDay: 'mo' }).byDay, ['MO']),
    'A single BYDAY string on a rule object becomes a one-item list'
);
assert(
    RRuleParser.parseByDayToken('+53su').nth === 53 && RRuleParser.parseByDayToken('+53su').weekday === 'SU',
    'parseByDayToken accepts the largest ordinal'
);
assert(RRuleParser.parseByDayToken('8XX') === null, 'parseByDayToken returns null for 8XX');
assert(RRuleParser.parseByDayToken({ weekday: 'MOO' }) === null, 'parseByDayToken returns null for { weekday: MOO }');
assert(RRuleParser.parseByDayToken(undefined) === null, 'parseByDayToken returns null for undefined');

for (const bad of ['8XX', 'MOO', '+MO', '0MO', '54MO', '1', 'M0']) {
    assertThrows(() => RRuleParser.parse(`FREQ=MONTHLY;BYDAY=${bad}`), `BYDAY=${bad} is rejected`);
}
assertThrows(() => RRuleParser.parse({ freq: 'MONTHLY', byDay: ['MOO'] }), 'Rule object with MOO is rejected');
assertThrows(
    () => RRuleParser.parse({ freq: 'MONTHLY', byDay: [{ nth: 1, weekday: 'XX' }] }),
    'Rule object with { weekday: XX } is rejected'
);
assertThrows(
    () => RRuleParser.parse({ freq: 'MONTHLY', byDay: [{ nth: 99, weekday: 'MO' }] }),
    'Rule object with an out-of-range nth is rejected'
);
assert(
    RRuleParser.buildRRule(RRuleParser.parse('FREQ=MONTHLY;BYDAY=+1MO')) === 'FREQ=MONTHLY;BYDAY=1MO',
    'Round trip through buildRRule emits the canonical form'
);

// --- Engines refuse unknown weekdays instead of searching for them ---
console.log('\nEngine guards:');
assertThrows(
    () => RecurrenceEngine.setToWeekdayOfMonth(new Date(2025, 0, 15), 'XX', 1),
    'RecurrenceEngine.setToWeekdayOfMonth throws for XX',
    /weekday/
);
assertThrows(
    () => RecurrenceEngine.setToWeekdayOfMonth(new Date(2025, 0, 15), undefined, 1),
    'RecurrenceEngine.setToWeekdayOfMonth throws for undefined',
    /weekday/
);
assertThrows(
    () => new RecurrenceEngineV2().setToNthWeekdayOfMonth(new Date(2025, 0, 15), 'XX', 1),
    'RecurrenceEngineV2.setToNthWeekdayOfMonth throws for XX',
    /weekday/
);
assertThrows(
    () => new RecurrenceEngineV2().setToNthWeekdayOfMonth(new Date(2025, 0, 15), undefined, -1),
    'RecurrenceEngineV2.setToNthWeekdayOfMonth throws for undefined',
    /weekday/
);
// Un-normalised rule objects handed straight to the engines (bypassing the parser)
const rawRule = { freq: 'MONTHLY', interval: 1, byDay: ['+1MO'], bySetPos: [] };
const v1Next = new Date(2025, 0, 6, 9, 0);
RecurrenceEngine._advanceInPlace(v1Next, rawRule);
assert(
    v1Next.getFullYear() === 2025 && v1Next.getMonth() === 1 && v1Next.getDate() === 3 && v1Next.getDay() === 1,
    'RecurrenceEngine advances +1MO to the first Monday of the next month'
);
const v2Next = new RecurrenceEngineV2().getNextMonthly(new Date(2025, 0, 6, 9, 0), rawRule, 'UTC');
assert(
    v2Next.getFullYear() === 2025 && v2Next.getMonth() === 1 && v2Next.getDate() === 3 && v2Next.getDay() === 1,
    'RecurrenceEngineV2 advances +1MO to the first Monday of the next month'
);
const lastFri = new Date(2025, 0, 31, 9, 0);
RecurrenceEngine.setToWeekdayOfMonth(lastFri, '-1fr', -1);
assert(lastFri.getDate() === 31 && lastFri.getDay() === 5, 'RecurrenceEngine resolves -1fr to the last Friday');
const v2LastFri = new Date(2025, 2, 1);
new RecurrenceEngineV2().setToNthWeekdayOfMonth(v2LastFri, 'FR', -1);
assert(v2LastFri.getDate() === 28 && v2LastFri.getDay() === 5, 'RecurrenceEngineV2 resolves the last Friday of March 2025');
assert(
    RecurrenceEngine.matchesByDay(new Date(2025, 0, 6), ['+1MO']) === true &&
        RecurrenceEngine.matchesByDay(new Date(2025, 0, 7), ['+1MO']) === false &&
        RecurrenceEngine.matchesByDay(new Date(2025, 0, 6), ['MOO']) === false,
    'matchesByDay understands +1MO and ignores unknown codes'
);
assert(RecurrenceEngine.getDayName('+2tu') === '2nd Tuesday', 'getDayName understands +2tu');

// --- Expansion of each form finishes within budget via both engines and the calendar ---
console.log('\nExpansion within time budget:');
const cases = [
    {
        rule: 'FREQ=MONTHLY;BYDAY=+1MO',
        start: new Date(2025, 0, 6, 9, 0), // first Monday of January 2025
        check: d => d.getDay() === 1 && d.getDate() <= 7,
        label: 'first Monday'
    },
    {
        rule: 'FREQ=MONTHLY;BYDAY=+2tu',
        start: new Date(2025, 0, 14, 9, 0), // second Tuesday of January 2025
        check: d => d.getDay() === 2 && d.getDate() >= 8 && d.getDate() <= 14,
        label: 'second Tuesday'
    },
    {
        rule: 'FREQ=MONTHLY;BYDAY=-1fr',
        start: new Date(2025, 0, 31, 9, 0), // last Friday of January 2025
        check: d => {
            const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
            return d.getDay() === 5 && d.getDate() > lastDay - 7;
        },
        label: 'last Friday'
    }
];

for (const { rule, start, check, label } of cases) {
    for (const engine of ['v1', 'v2', 'calendar']) {
        const result = expandInChild(engine, rule, start);
        if (result.timedOut) {
            assert(false, `${rule} via ${engine} finished within ${TIME_BUDGET_MS}ms (timed out)`);
            continue;
        }
        assert(!result.error, `${rule} via ${engine} expanded without error${result.error ? `: ${result.error}` : ''}`);
        const dates = (result.starts || []).map(iso => new Date(iso));
        assert(
            dates.length === 12 && dates.every(check),
            `${rule} via ${engine} yields the ${label} of each month of 2025 (${dates.length} occurrences, ${result.elapsed}ms)`
        );
    }
}

// An invalid rule that reaches the calendar fails fast with a clear error
for (const bad of ['8XX', 'MOO']) {
    const result = expandInChild('calendar', `FREQ=MONTHLY;BYDAY=${bad}`, new Date(2025, 0, 6, 9, 0));
    assert(
        !result.timedOut && result.status === 2 && /BYDAY/.test(result.error || ''),
        `Calendar.getEventsInRange rejects BYDAY=${bad} within budget: ${result.error || 'timed out'}`
    );
}

console.log(`\n${failures === 0 ? 'All BYDAY normalisation tests passed' : `${failures} BYDAY normalisation test(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
