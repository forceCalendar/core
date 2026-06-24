/**
 * Test recurrence expansion consistency
 */

import { Event } from '../../core/events/Event.js';
import { EventStore } from '../../core/events/EventStore.js';
import { RecurrenceEngineV2 } from '../../core/events/RecurrenceEngineV2.js';

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

if (failures > 0) {
    console.log(`\n❌ Recurrence test failed: ${failures} assertion(s)`);
    process.exit(1);
}

console.log('\n✅ Recurrence functionality test complete!');
process.exit(0);
