/**
 * Test category search integration
 */

import { Calendar } from '../../core/calendar/Calendar.js';
import { EventSearch } from '../../core/search/EventSearch.js';

console.log('Testing category search integration...\n');

let failures = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`  ✅ ${message}`);
    } else {
        console.log(`  ❌ ${message}`);
        failures++;
    }
}

const calendar = new Calendar();

calendar.addEvent({
    id: 'test-1',
    title: 'Test Meeting',
    start: new Date('2025-01-15T10:00:00'),
    end: new Date('2025-01-15T11:00:00'),
    category: 'meeting'
});

const events = calendar.getEvents();
assert(events.length === 1, 'Calendar stores one event');
assert(events[0].category === 'meeting', 'Stored event exposes singular category getter');
assert(Array.isArray(events[0].categories), 'Stored event exposes categories array');

const searchEngine = new EventSearch(calendar.eventStore);

const filtered = searchEngine.filter({
    categories: ['meeting']
});
assert(filtered.length === 1, 'Category filter finds singular-category event');

const uniqueCategories = searchEngine.getUniqueValues('category');
assert(uniqueCategories.length === 1, 'Unique category list contains one category');
assert(uniqueCategories[0] === 'meeting', 'Unique category list contains meeting');

if (failures > 0) {
    console.log(`\n❌ Category search integration test failed: ${failures} assertion(s)`);
    process.exit(1);
}

console.log('\n✅ Category search integration test complete!');
process.exit(0);
