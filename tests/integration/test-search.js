/**
 * Test Search and Filter functionality
 */

import { Calendar } from '../../core/calendar/Calendar.js';
import { EventSearch } from '../../core/search/EventSearch.js';
import { SearchWorkerManager } from '../../core/search/SearchWorkerManager.js';

console.log('Testing Search and Filter functionality...\n');

let failures = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`  ✅ ${message}`);
    } else {
        console.log(`  ❌ ${message}`);
        failures++;
    }
}

// Create calendar with diverse test events
const calendar = new Calendar();

// Add test events with various properties
const testEvents = [
    {
        id: 'meeting-1',
        title: 'Product Planning Meeting',
        description: 'Quarterly product roadmap discussion',
        start: new Date('2025-01-15T10:00:00'),
        end: new Date('2025-01-15T11:30:00'),
        location: 'Conference Room A',
        category: 'meeting',
        attendees: [
            { email: 'john@company.com', name: 'John Smith' },
            { email: 'sarah@company.com', name: 'Sarah Johnson' }
        ]
    },
    {
        id: 'meeting-2',
        title: 'Team Standup',
        description: 'Daily sync with the engineering team',
        start: new Date('2025-01-16T09:00:00'),
        end: new Date('2025-01-16T09:15:00'),
        location: 'Zoom',
        category: 'meeting',
        attendees: [
            { email: 'dev-team@company.com', name: 'Dev Team' }
        ],
        recurrence: 'FREQ=DAILY;COUNT=5'
    },
    {
        id: 'workshop-1',
        title: 'JavaScript Workshop',
        description: 'Advanced JavaScript patterns and best practices',
        start: new Date('2025-01-20T09:00:00'),
        end: new Date('2025-01-20T17:00:00'),
        location: 'Training Room',
        category: 'training',
        attendees: [
            { email: 'instructor@training.com', name: 'Instructor' },
            { email: 'students@company.com', name: 'Students' }
        ]
    },
    {
        id: 'holiday-1',
        title: 'Australia Day',
        description: 'National holiday',
        start: new Date('2025-01-26'),
        allDay: true,
        category: 'holiday'
    },
    {
        id: 'deadline-1',
        title: 'Project Deadline',
        description: 'Final submission for Q1 project',
        start: new Date('2025-01-31T23:59:00'),
        category: 'deadline',
        reminders: [
            { method: 'popup', minutesBefore: 1440 }, // 1 day before
            { method: 'popup', minutesBefore: 60 }    // 1 hour before
        ]
    },
    {
        id: 'social-1',
        title: 'Team Lunch',
        description: 'Monthly team gathering at Italian restaurant',
        start: new Date('2025-01-25T12:00:00'),
        end: new Date('2025-01-25T14:00:00'),
        location: 'Mario\'s Restaurant',
        category: 'social',
        attendees: [
            { email: 'team@company.com', name: 'Whole Team' }
        ]
    }
];

// Add all test events
testEvents.forEach(event => calendar.addEvent(event));
console.log(`✅ Created calendar with ${testEvents.length} test events\n`);

// Create search engine
const searchEngine = new EventSearch(calendar.eventStore);

// Test 1: Text search
console.log('=== Test 1: Text Search ===');
console.log('Searching for "meeting"...');
let results = searchEngine.search('meeting', {
    fields: ['title', 'description'],
    fuzzy: false
});
console.log(`Found ${results.length} results:`);
results.forEach(event => {
    console.log(`  - ${event.title}`);
});
assert(results.length === 1, 'Text search finds one matching meeting title');

// Test 2: Fuzzy search
console.log('\n=== Test 2: Fuzzy Search ===');
console.log('Searching for "meetting" (typo) with fuzzy matching...');
results = searchEngine.search('meetting', {
    fields: ['title'],
    fuzzy: true
});
console.log(`Found ${results.length} results with fuzzy matching:`);
results.forEach(event => {
    console.log(`  - ${event.title}`);
});
assert(results.length === 1, 'Fuzzy search matches misspelled meeting query');

// Test 3: Category filter
console.log('\n=== Test 3: Category Filter ===');
console.log('Filtering by category: meeting...');
results = searchEngine.filter({
    categories: ['meeting']
});
console.log(`Found ${results.length} meetings:`);
results.forEach(event => {
    console.log(`  - ${event.title} (${event.category})`);
});
assert(results.length === 2, 'Category filter finds both meetings');

// Test 4: Date range filter
console.log('\n=== Test 4: Date Range Filter ===');
console.log('Filtering events from Jan 15-20, 2025...');
results = searchEngine.filter({
    dateRange: {
        start: new Date('2025-01-15'),
        end: new Date('2025-01-20T23:59:59')
    }
});
console.log(`Found ${results.length} events in date range:`);
results.forEach(event => {
    console.log(`  - ${event.title} (${event.start.toLocaleDateString()})`);
});
assert(results.length === 3, 'Date range filter finds Jan 15-20 events');

// Test 5: All-day events filter
console.log('\n=== Test 5: All-Day Events Filter ===');
console.log('Filtering for all-day events...');
results = searchEngine.filter({
    allDay: true
});
console.log(`Found ${results.length} all-day events:`);
results.forEach(event => {
    console.log(`  - ${event.title}`);
});
assert(results.length === 1 && results[0].title === 'Australia Day', 'All-day filter finds holiday');

// Test 6: Events with reminders
console.log('\n=== Test 6: Events with Reminders ===');
console.log('Filtering for events with reminders...');
results = searchEngine.filter({
    hasReminders: true
});
console.log(`Found ${results.length} events with reminders:`);
results.forEach(event => {
    console.log(`  - ${event.title} (${event.reminders.length} reminders)`);
});
assert(results.length === 1 && results[0].id === 'deadline-1', 'Reminder filter finds deadline');

// Test 7: Attendee filter
console.log('\n=== Test 7: Attendee Filter ===');
console.log('Filtering for events with john@company.com...');
results = searchEngine.filter({
    attendees: ['john@company.com']
});
console.log(`Found ${results.length} events with John:`);
results.forEach(event => {
    console.log(`  - ${event.title}`);
});
assert(results.length === 1 && results[0].id === 'meeting-1', 'Attendee filter finds John meeting');

// Test 8: Advanced search (text + filters)
console.log('\n=== Test 8: Advanced Search ===');
console.log('Searching for "team" in meetings category...');
results = searchEngine.advancedSearch('team', {
    categories: ['meeting', 'social']
});
console.log(`Found ${results.length} results:`);
results.forEach(event => {
    console.log(`  - ${event.title} (${event.category})`);
});
assert(results.length === 2, 'Advanced search finds team meeting/social events');

// Test 9: Get suggestions
console.log('\n=== Test 9: Autocomplete Suggestions ===');
console.log('Getting suggestions for "pro"...');
const suggestions = searchEngine.getSuggestions('pro', {
    field: 'title',
    limit: 5
});
console.log(`Found ${suggestions.length} suggestions:`);
suggestions.forEach(suggestion => {
    console.log(`  - ${suggestion}`);
});
assert(suggestions.length === 2, 'Autocomplete suggestions include product-related titles');

// Test 10: Get unique values
console.log('\n=== Test 10: Unique Values ===');
console.log('Getting all unique categories...');
const categories = searchEngine.getUniqueValues('category');
console.log(`Found ${categories.length} categories:`);
categories.forEach(cat => {
    console.log(`  - ${cat}`);
});
assert(categories.length === 5, 'Unique category list has five entries');

// Test 11: Group by category
console.log('\n=== Test 11: Group By Category ===');
console.log('Grouping events by category...');
const grouped = searchEngine.groupBy('category', {
    sortGroups: true,
    sortEvents: true
});
for (const [category, events] of Object.entries(grouped)) {
    console.log(`${category}: ${events.length} events`);
    events.forEach(event => {
        console.log(`  - ${event.title}`);
    });
}
assert(grouped.meeting?.length === 2, 'Group by category includes two meetings');

// Test 12: Location filter
console.log('\n=== Test 12: Location Filter ===');
console.log('Filtering by location containing "Room"...');
results = searchEngine.filter({
    custom: (event) => event.location && event.location.includes('Room')
});
console.log(`Found ${results.length} events in rooms:`);
results.forEach(event => {
    console.log(`  - ${event.title} @ ${event.location}`);
});
assert(results.length === 2, 'Custom location filter finds two room events');

// Test 13: Recurring events
console.log('\n=== Test 13: Recurring Events Filter ===');
console.log('Filtering for recurring events...');
results = searchEngine.filter({
    recurring: true
});
console.log(`Found ${results.length} recurring events:`);
results.forEach(event => {
    console.log(`  - ${event.title} (${event.recurrence})`);
});
assert(results.length === 1 && results[0].id === 'meeting-2', 'Recurring filter finds standup');

// Test 14: SearchWorkerManager cache invalidation
console.log('\n=== Test 14: SearchWorkerManager Cache Invalidation ===');
const searchManager = new SearchWorkerManager(calendar.eventStore);
await searchManager.indexEvents();

let workerResults = await searchManager.search('Product');
assert(workerResults.length === 1, 'Initial worker-manager search finds one product event');

calendar.addEvent({
    id: 'product-review-1',
    title: 'Product Review',
    description: 'Follow-up product review',
    start: new Date('2025-02-01T10:00:00'),
    end: new Date('2025-02-01T11:00:00'),
    category: 'meeting'
});

await searchManager.indexEvents();
workerResults = await searchManager.search('Product');
assert(workerResults.length === 2, 'Reindex clears stale cached search results');
searchManager.destroy();

// Test 15: Browser worker support with a small dataset uses fallback index
console.log('\n=== Test 15: Small Dataset Worker Fallback ===');
const originalWorker = globalThis.Worker;
let fakeWorker = null;

class EmptySearchWorker {
    constructor() {
        this.messages = [];
        fakeWorker = this;
    }

    postMessage(message) {
        this.messages.push(message);

        if (message.type === 'init') {
            queueMicrotask(() => this.onmessage?.({ data: { type: 'ready' } }));
        } else if (message.type === 'search') {
            queueMicrotask(() =>
                this.onmessage?.({
                    data: {
                        type: 'results',
                        id: message.data.id,
                        results: []
                    }
                })
            );
        } else if (message.type === 'index') {
            queueMicrotask(() => this.onmessage?.({ data: { type: 'indexed', count: 0 } }));
        }
    }

    terminate() {}
}

globalThis.Worker = EmptySearchWorker;

const workerCalendar = new Calendar();
workerCalendar.addEvent({
    id: 'worker-alpha',
    title: 'Worker Alpha',
    description: 'Small dataset search fallback',
    start: new Date('2025-03-01T09:00:00'),
    end: new Date('2025-03-01T10:00:00'),
    category: 'worker'
});

const smallDatasetManager = new SearchWorkerManager(workerCalendar.eventStore);
await new Promise(resolve => setTimeout(resolve, 0));
await smallDatasetManager.indexEvents();

workerResults = await smallDatasetManager.search('Worker Alpha');
assert(workerResults.length === 1, 'Small worker-capable dataset searches fallback index');
assert(
    smallDatasetManager.indexMode === 'fallback',
    'Small worker-capable dataset records fallback as active index mode'
);
assert(
    !fakeWorker?.messages.some(message => message.type === 'search'),
    'Small worker-capable dataset does not send search to an unindexed worker'
);

smallDatasetManager.destroy();

if (originalWorker) {
    globalThis.Worker = originalWorker;
} else {
    delete globalThis.Worker;
}

if (failures > 0) {
    console.log(`\n❌ Search and Filter test failed: ${failures} assertion(s)`);
    process.exit(1);
}

console.log('\n✅ Search and Filter functionality test complete!');
process.exit(0);
