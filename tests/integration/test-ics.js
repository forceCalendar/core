/**
 * Test ICS Import/Export functionality
 */

import { Calendar } from '../../core/calendar/Calendar.js';
import { ICSHandler } from '../../core/ics/ICSHandler.js';

console.log('Testing ICS Import/Export functionality...\n');

let failures = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`);
  } else {
    console.log(`  ❌ ${message}`);
    failures++;
  }
}

async function assertRejects(fn, message) {
  try {
    await fn();
    assert(false, message);
  } catch {
    assert(true, message);
  }
}

function assertThrows(fn, message) {
  try {
    fn();
    assert(false, message);
  } catch {
    assert(true, message);
  }
}

// Create calendar with test events
const calendar = new Calendar();

calendar.addEvent({
  id: 'meeting-1',
  title: 'Team Standup',
  description: 'Daily team sync meeting',
  start: new Date('2025-01-15T09:00:00'),
  end: new Date('2025-01-15T09:30:00'),
  timeZone: 'America/New_York',
  location: 'Zoom',
  category: 'meeting',
  attendees: [
    { email: 'john@example.com', name: 'John Doe' },
    { email: 'jane@example.com', name: 'Jane Smith' }
  ],
  recurrence: 'FREQ=DAILY;COUNT=5'
});

calendar.addEvent({
  id: 'event-2',
  title: 'Project Launch',
  description: 'Launch party for new project',
  start: new Date('2025-01-20T18:00:00'),
  end: new Date('2025-01-20T21:00:00'),
  location: 'Office Rooftop',
  category: 'social',
  attendees: [{ email: 'team@example.com', name: 'Team' }]
});

calendar.addEvent({
  id: 'workshop-1',
  title: 'All-Day Workshop',
  start: new Date('2025-01-25'),
  allDay: true,
  category: 'training'
});

console.log('Created test calendar with 3 events');

const icsHandler = new ICSHandler(calendar);

console.log('\n=== Export and Validation ===');
const exported = icsHandler.export({
  calendarName: 'Test Calendar Export'
});

assert(exported.includes('BEGIN:VCALENDAR'), 'Export includes VCALENDAR wrapper');
assert(exported.includes('UID:meeting-1'), 'Export includes meeting UID');
assert(
  exported.includes('DTSTART;TZID=America/New_York:20250115T090000'),
  'Export preserves event timeZone as TZID'
);

const validation = icsHandler.validate(exported);
assert(validation.valid, 'Exported ICS validates successfully');

console.log('\n=== Re-import Round Trip ===');
const calendar2 = new Calendar();
const icsHandler2 = new ICSHandler(calendar2);
const importResults = await icsHandler2.import(exported);

assert(importResults.imported.length === 3, 'Re-import imports all exported events');
assert(importResults.errors.length === 0, 'Re-import has no per-event errors');

const importedMeeting = calendar2.getEvent('meeting-1');
assert(importedMeeting?.timeZone === 'America/New_York', 'Re-import preserves DTSTART TZID');
assert(importedMeeting?.endTimeZone === 'America/New_York', 'Re-import preserves DTEND TZID');

console.log('\n=== External ICS Parsing ===');
const externalICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//External Calendar//EN
BEGIN:VEVENT
UID:external-event-1
DTSTART;TZID=America/Los_Angeles:20250130T140000
DTEND;TZID=America/Los_Angeles:20250130T150000
SUMMARY:External Meeting
DESCRIPTION:Imported from external calendar
LOCATION:Conference Room A
STATUS:CONFIRMED
END:VEVENT
END:VCALENDAR`;

const externalResults = await icsHandler2.import(externalICS);
assert(externalResults.imported.length === 1, 'External ICS imports one event');

const externalEvent = calendar2.getEvent('external-event-1');
assert(externalEvent?.timeZone === 'America/Los_Angeles', 'TZID parameter is preserved on import');

console.log('\n=== URL Safety ===');
assert(ICSHandler.validateURL('https://example.com/calendar.ics').hostname === 'example.com', 'Public HTTPS URL is accepted');
assertThrows(() => ICSHandler.validateURL('file:///tmp/calendar.ics'), 'Non-HTTP URL is rejected');
assertThrows(() => ICSHandler.validateURL('http://127.0.0.1/calendar.ics'), 'Loopback URL is rejected');
assertThrows(() => ICSHandler.validateURL('http://10.0.0.1/calendar.ics'), 'Private IPv4 URL is rejected');
assertThrows(() => ICSHandler.validateURL('http://169.254.169.254/latest'), 'Link-local metadata URL is rejected');
assertThrows(() => ICSHandler.validateURL('https://user:pass@example.com/calendar.ics'), 'Embedded credentials are rejected');

await assertRejects(
  () =>
    icsHandler.readResponseText(
      {
        body: null,
        text: async () => 'BEGIN:VCALENDAR'.repeat(10)
      },
      10
    ),
  'Response body size is checked before import'
);

if (failures > 0) {
  console.log(`\n❌ ICS test failed: ${failures} assertion(s)`);
  process.exit(1);
}

console.log('\n✅ ICS functionality test complete!');
process.exit(0);
