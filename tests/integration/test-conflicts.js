/**
 * Test ConflictDetector functionality
 */

import { EventStore } from '../../core/events/EventStore.js';
import { ConflictDetector } from '../../core/conflicts/ConflictDetector.js';

console.log('Testing ConflictDetector functionality...\n');

let failures = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`  ✅ ${message}`);
    } else {
        console.log(`  ❌ ${message}`);
        failures++;
    }
}

const store = new EventStore();
const detector = new ConflictDetector(store);

// 2025-01-13 is a Monday
store.addEvent({
    id: 'busy-1',
    title: 'Morning Meeting',
    start: new Date('2025-01-13T10:00:00'),
    end: new Date('2025-01-13T11:00:00')
});
store.addEvent({
    id: 'busy-2',
    title: 'Afternoon Meeting',
    start: new Date('2025-01-13T14:00:00'),
    end: new Date('2025-01-13T15:00:00')
});

// Test 1: getFreePeriods without business hours restriction
console.log('=== Test 1: getFreePeriods (no business hours) ===');
let free = detector.getFreePeriods(
    new Date('2025-01-13T09:00:00'),
    new Date('2025-01-13T17:00:00'),
    30
);
assert(free.length === 3, `Found 3 free periods (got ${free.length})`);

// Test 2: business hours respect minutes, not just hours
console.log('\n=== Test 2: Business hours minute precision ===');
const opts = {
    businessHoursOnly: true,
    businessHours: { start: '09:30', end: '17:00' }
};
free = detector.getFreePeriods(
    new Date('2025-01-13T09:00:00'),
    new Date('2025-01-13T10:00:00'),
    30,
    opts
);
assert(
    free.length === 0,
    'Gap starting 09:00 is rejected when business hours start at 09:30'
);

free = detector.getFreePeriods(
    new Date('2025-01-13T09:30:00'),
    new Date('2025-01-13T10:00:00'),
    30,
    opts
);
assert(
    free.length === 1,
    'Gap starting exactly at 09:30 business start is accepted'
);

// Test 3: end boundary is enforced to the minute
console.log('\n=== Test 3: Business hours end boundary ===');
free = detector.getFreePeriods(
    new Date('2025-01-13T16:00:00'),
    new Date('2025-01-13T17:30:00'),
    30,
    { businessHoursOnly: true, businessHours: { start: '09:00', end: '17:00' } }
);
assert(
    free.length === 0,
    'Gap ending 17:30 is rejected when business hours end at 17:00'
);

free = detector.getFreePeriods(
    new Date('2025-01-13T16:00:00'),
    new Date('2025-01-13T17:00:00'),
    30,
    { businessHoursOnly: true, businessHours: { start: '09:00', end: '17:00' } }
);
assert(
    free.length === 1,
    'Gap ending exactly at 17:00 business end is accepted'
);

// Test 4: multi-day spans never fit within a single day's business hours
console.log('\n=== Test 4: Multi-day span rejection ===');
free = detector.getFreePeriods(
    new Date('2025-01-13T16:00:00'),
    new Date('2025-01-14T10:00:00'),
    30,
    { businessHoursOnly: true, businessHours: { start: '09:00', end: '17:00' } }
);
assert(
    free.length === 0,
    'Gap spanning midnight is rejected with businessHoursOnly'
);

// Test 5: excludeWeekends filters Saturday/Sunday gaps
console.log('\n=== Test 5: Weekend exclusion ===');
// 2025-01-18 is a Saturday
free = detector.getFreePeriods(
    new Date('2025-01-18T10:00:00'),
    new Date('2025-01-18T12:00:00'),
    30,
    {
        businessHoursOnly: true,
        businessHours: { start: '09:00', end: '17:00' },
        excludeWeekends: true
    }
);
assert(free.length === 0, 'Saturday gap is rejected when excludeWeekends is set');

free = detector.getFreePeriods(
    new Date('2025-01-18T10:00:00'),
    new Date('2025-01-18T12:00:00'),
    30,
    {
        businessHoursOnly: true,
        businessHours: { start: '09:00', end: '17:00' },
        excludeWeekends: false
    }
);
assert(free.length === 1, 'Saturday gap is accepted when excludeWeekends is off');

// Test 6: basic overlap conflict detection still works
console.log('\n=== Test 6: checkConflicts overlap detection ===');
const summary = detector.checkConflicts({
    id: 'new-1',
    title: 'Overlapping Meeting',
    start: new Date('2025-01-13T10:30:00'),
    end: new Date('2025-01-13T11:30:00')
});
assert(summary.hasConflicts === true, 'Overlap with busy-1 is detected');

if (failures > 0) {
    console.log(`\n❌ ConflictDetector test failed: ${failures} assertion(s)`);
    process.exit(1);
}

console.log('\n✅ ConflictDetector functionality test complete!');
process.exit(0);
