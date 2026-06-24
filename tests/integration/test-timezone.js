#!/usr/bin/env node

/**
 * Test timezone functionality
 */

import { Calendar } from '../../core/index.js';
import { Event } from '../../core/events/Event.js';
import { TimezoneManager } from '../../core/timezone/TimezoneManager.js';

console.log('Testing Lightning Calendar Core - Timezone Support');
console.log('==================================================\n');

let failures = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`  ✅ ${message}`);
    } else {
        console.log(`  ❌ ${message}`);
        failures++;
    }
}

const calendar = new Calendar({
    timeZone: 'America/New_York'
});

console.log('=== Test 1: Calendar timezone configuration ===');
assert(calendar.getTimezone() === 'America/New_York', 'Calendar initializes with configured timezone');

console.log('\n=== Test 2: Event UTC conversion ===');
const nyEvent = new Event({
    id: 'test-event-1',
    title: 'Morning Meeting',
    start: new Date('2024-12-24T10:00:00'),
    end: new Date('2024-12-24T11:00:00'),
    timeZone: 'America/New_York'
});

assert(nyEvent.timeZone === 'America/New_York', 'Event stores its timezone');
assert(
    nyEvent.startUTC.toISOString() === '2024-12-24T15:00:00.000Z',
    'New York 10:00 winter event converts to 15:00 UTC'
);

console.log('\n=== Test 3: Date queries across timezones ===');
calendar.addEvent({
    id: 'ny-meeting',
    title: 'New York Meeting',
    start: new Date('2024-12-24T10:00:00'),
    end: new Date('2024-12-24T11:00:00'),
    timeZone: 'America/New_York'
});

calendar.addEvent({
    id: 'london-conf',
    title: 'London Conference',
    start: new Date('2024-12-24T15:00:00'),
    end: new Date('2024-12-24T16:00:00'),
    timeZone: 'Europe/London'
});

calendar.addEvent({
    id: 'tokyo-sync',
    title: 'Tokyo Team Sync',
    start: new Date('2024-12-25T09:00:00'),
    end: new Date('2024-12-25T10:00:00'),
    timeZone: 'Asia/Tokyo'
});

const dec24 = new Date('2024-12-24');
const nyEvents = calendar.getEventsForDate(dec24, 'America/New_York');
const londonEvents = calendar.getEventsForDate(dec24, 'Europe/London');
const tokyoEvents = calendar.getEventsForDate(dec24, 'Asia/Tokyo');

assert(nyEvents.length === 3, 'New York perspective finds three Dec 24 events');
assert(londonEvents.length === 2, 'London perspective finds two Dec 24 events');
assert(tokyoEvents.length === 0, 'Tokyo perspective finds no Dec 24 events');

console.log('\n=== Test 4: Timezone utility behavior ===');
const tm = TimezoneManager.getInstance();
const timeDiff = tm.getTimezoneDifference(
    'America/New_York',
    'America/Los_Angeles',
    new Date('2024-12-24T12:00:00')
);

assert(Math.round(timeDiff) === 3, 'NY to LA timezone difference is three hours');
assert(calendar.getTimezones().length >= 20, 'Common timezone list is populated');

console.log('\n=== Test 5: DST handling ===');
const summerDate = new Date('2024-07-15T12:00:00');
const winterDate = new Date('2024-12-15T12:00:00');

assert(tm.isDST(summerDate, 'America/New_York') === true, 'New York observes DST in July');
assert(tm.isDST(winterDate, 'America/New_York') === false, 'New York is not in DST in December');
assert(
    tm.getTimezoneOffset(winterDate, 'America/New_York') >
        tm.getTimezoneOffset(summerDate, 'America/New_York'),
    'Winter offset is larger than summer offset for New York'
);

console.log('\n=== Test 6: Calendar timezone updates ===');
calendar.setTimezone('Europe/London');
assert(calendar.getTimezone() === 'Europe/London', 'Calendar timezone updates to Europe/London');

if (failures > 0) {
    console.log(`\n❌ Timezone test failed: ${failures} assertion(s)`);
    process.exit(1);
}

console.log('\n✅ Timezone tests completed successfully!');
process.exit(0);
