/**
 * Test that expanding a recurring event never changes the stored rule
 * (so a snapshot equal to the store reconciles as unchanged) and that the
 * colour shorthand is equivalent to its longhand form.
 */

import { Event } from '../../core/events/Event.js';
import { RRuleParser } from '../../core/events/RRuleParser.js';
import { RecurrenceEngine } from '../../core/events/RecurrenceEngine.js';
import { RecurrenceEngineV2 } from '../../core/events/RecurrenceEngineV2.js';
import { Calendar } from '../../core/calendar/Calendar.js';

console.log('Testing rule immutability and colour equivalence...\n');

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
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('=== Test 1: RRuleParser leaves rule objects alone ===');
{
    const rule = { freq: 'WEEKLY', byDay: ['MO', 'WE'], byMonthDay: [15, 0, 40], count: 5 };
    const snapshot = JSON.stringify(rule);
    const parsed = RRuleParser.parse(rule);
    assert(JSON.stringify(rule) === snapshot, 'parse() does not touch the caller object');
    assert(parsed !== rule && parsed.byDay !== rule.byDay, 'parse() returns a copy');
    assert(same(parsed.byMonthDay, [15]) && same(parsed.byMonth, []) && parsed.interval === 1, 'Copy is normalised');
    const validated = RRuleParser.validateRule(rule);
    assert(JSON.stringify(rule) === snapshot && validated !== rule, 'validateRule() works on a copy too');
    const withDates = { freq: 'DAILY', exceptions: [new Date(2025, 5, 12)] };
    const parsedDates = RRuleParser.parse(withDates);
    assert(parsedDates.exceptions !== withDates.exceptions && parsedDates.exceptions[0] === withDates.exceptions[0], 'Arrays are copied, entries shared');
}

console.log('\n=== Test 2: expansion does not mutate the stored rule ===');
{
    const rule = { freq: 'WEEKLY', byDay: ['WE', 'MO'], count: 12 };
    const original = JSON.parse(JSON.stringify(rule));
    const calendar = new Calendar({ timeZone: TZ, weekStartsOn: 1, date: new Date(2025, 5, 15) });
    const stored = calendar.addEvent({
        id: 'r',
        title: 'r',
        start: new Date(2025, 5, 2, 9),
        end: new Date(2025, 5, 2, 10),
        recurrenceRule: rule
    });
    calendar.getViewData();
    calendar.setView('week');
    calendar.getViewData();
    calendar.getEventsForDate(new Date(2025, 5, 4));
    RecurrenceEngine.expandEvent(stored, new Date(2025, 5, 1), new Date(2025, 6, 1), 100);
    Array.from(RecurrenceEngine.iterateOccurrences(stored, { before: new Date(2025, 6, 1) }));
    new RecurrenceEngineV2().expandEvent(stored, new Date(2025, 5, 1), new Date(2025, 6, 1));
    Array.from(new RecurrenceEngineV2().iterateOccurrences(stored, { before: new Date(2025, 6, 1) }));
    assert(same(stored.recurrenceRule, original), 'Stored rule is deep-equal to what was stored');
    assert(Object.keys(stored.recurrenceRule).sort().join() === 'byDay,count,freq', 'No parser fields were added to the stored rule');
    assert(same(rule, original), 'Caller rule object is untouched');

    const result = calendar.reconcileEvents([
        { id: 'r', title: 'r', start: new Date(2025, 5, 2, 9), end: new Date(2025, 5, 2, 10), recurrenceRule: { freq: 'WEEKLY', byDay: ['WE', 'MO'], count: 12 } }
    ]);
    assert(result.updated.length === 0 && result.unchanged.length === 1 && calendar.getEvent('r') === stored, 'Identical snapshot after rendering reconciles as unchanged');
    const count = calendar.getEventsByDate(new Date(2025, 5, 2), new Date(2025, 5, 8)).get('2025-06-04')?.length;
    assert(count === 1, 'Series still expands correctly');
    calendar.destroy();
}

console.log('\n=== Test 3: colour shorthand is equivalent to its longhand ===');
{
    const base = { id: 'c', title: 'c', start: new Date(2025, 5, 2, 9), end: new Date(2025, 5, 2, 10), timeZone: TZ };
    assert(Event.isEquivalent({ ...base, color: 'red' }, { ...base, backgroundColor: 'red', borderColor: 'red' }), '{ color } equals { backgroundColor, borderColor }');
    assert(!Event.isEquivalent({ ...base, color: 'red' }, { ...base, backgroundColor: 'red' }), 'Missing borderColor is a difference');
    assert(!Event.isEquivalent({ ...base, color: 'red' }, { ...base, color: 'blue' }), 'Different colours differ');
    assert(!Event.isEquivalent({ ...base, color: 'red' }, { ...base, color: 'red', textColor: '#fff' }), 'textColor is still compared');
    assert(!Event.EQUIVALENCE_FIELDS.includes('color') && Event.EQUIVALENCE_FIELDS.includes('backgroundColor'), 'EQUIVALENCE_FIELDS compares the normalised colours');

    const calendar = new Calendar({ timeZone: TZ, date: new Date(2025, 5, 15) });
    const stored = calendar.addEvent({ ...base, color: 'red' });
    const result = calendar.reconcileEvents([{ ...base, backgroundColor: 'red', borderColor: 'red' }]);
    assert(result.unchanged.length === 1 && calendar.getEvent('c') === stored, 'Reconcile treats the longhand snapshot as unchanged');
    calendar.destroy();
}

if (failures > 0) {
    console.log(`\n❌ Rule immutability test failed: ${failures} assertion(s)`);
    process.exit(1);
}

console.log('\n✅ Rule immutability test complete!');
process.exit(0);
