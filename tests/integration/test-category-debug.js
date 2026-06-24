/**
 * Test category normalization
 */

import { Event } from '../../core/events/Event.js';

console.log('Testing category normalization...\n');

let failures = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`  ✅ ${message}`);
    } else {
        console.log(`  ❌ ${message}`);
        failures++;
    }
}

const testData = {
    id: 'test-1',
    title: 'Test Meeting',
    start: new Date('2025-01-15T10:00:00'),
    end: new Date('2025-01-15T11:00:00'),
    category: 'meeting'
};

const normalized = Event.normalize(testData);
assert(Array.isArray(normalized.categories), 'Singular category normalizes to categories array');
assert(normalized.categories[0] === 'meeting', 'Normalized categories include singular category');

const event = new Event(testData);
assert(event.categories.length === 1, 'Event stores one category from singular input');
assert(event.category === 'meeting', 'Event category getter returns first category');

const event2 = new Event({
    ...testData,
    categories: ['meeting', 'important']
});
assert(event2.categories.length === 2, 'Event preserves categories array input');
assert(event2.category === 'meeting', 'Event category getter returns first array category');

if (failures > 0) {
    console.log(`\n❌ Category normalization test failed: ${failures} assertion(s)`);
    process.exit(1);
}

console.log('\n✅ Category normalization test complete!');
process.exit(0);
