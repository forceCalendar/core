/**
 * Event copies must preserve every canonical constructor field, including
 * independent start/end timezones. Legacy aliases remain normalized on input.
 */
import assert from 'node:assert/strict';
import { Event } from '../../core/events/Event.js';
import { Calendar } from '../../core/calendar/Calendar.js';

const fields = [
    'id', 'title', 'start', 'end', 'allDay', 'description', 'location',
    'color', 'backgroundColor', 'borderColor', 'textColor', 'recurring',
    'recurrenceRule', 'timeZone', 'endTimeZone', 'status', 'visibility',
    'organizer', 'attendees', 'reminders', 'categories', 'attachments',
    'conferenceData', 'metadata'
];

function data(overrides = {}) {
    return {
        id: 'flight',
        title: 'Cross-timezone event',
        start: new Date(2025, 0, 15, 8),
        end: new Date(2025, 0, 15, 11),
        allDay: false,
        description: 'Keep the complete event',
        location: 'Arrival terminal',
        color: '#123456',
        backgroundColor: '#234567',
        borderColor: '#345678',
        textColor: '#ffffff',
        recurring: true,
        recurrenceRule: { freq: 'WEEKLY', interval: 2, count: 3, byDay: ['WE'] },
        timeZone: 'America/New_York',
        endTimeZone: 'America/Los_Angeles',
        status: 'tentative',
        visibility: 'confidential',
        organizer: { id: 'organizer', name: 'Organizer', email: 'organizer@example.com' },
        attendees: [{ name: 'Attendee', email: 'attendee@example.com', responseStatus: 'accepted', optional: false }],
        reminders: [{ method: 'popup', minutesBefore: 0, enabled: false }],
        categories: ['travel', 'work'],
        attachments: [{ fileName: 'agenda.pdf', fileUrl: 'https://example.com/agenda.pdf', size: 0 }],
        conferenceData: { solution: 'meet', url: 'https://example.com/meeting', notes: '' },
        metadata: { source: 'integration', nested: { tags: ['a', 'b'], enabled: false, count: 0, empty: '', optional: null } },
        ...overrides
    };
}

function assertFields(actual, expected, label) {
    for (const field of fields) {
        assert.deepEqual(actual[field], expected[field], `${label}: ${field}`);
    }
    assert.equal(actual.startUTC.getTime(), expected.startUTC.getTime(), `${label}: startUTC`);
    assert.equal(actual.endUTC.getTime(), expected.endUTC.getTime(), `${label}: endUTC`);
    assert.equal(actual.duration, expected.duration, `${label}: duration`);
    assert(Event.isEquivalent(actual, expected), `${label}: equivalence`);
}

let passed = 0;
function test(name, run) {
    run();
    passed++;
    console.log(`  ✅ ${name}`);
}

console.log('Testing event metadata fidelity...\n');

const original = new Event(data());

test('Clone preserves all canonical fields and independent UTC endpoints', () => {
    const clone = original.clone();
    assertFields(clone, original, 'clone');
    assert.notEqual(clone, original);
    assert.equal(clone.startUTC.toISOString(), '2025-01-15T13:00:00.000Z');
    assert.equal(clone.endUTC.toISOString(), '2025-01-15T19:00:00.000Z');
    assert.equal(clone.durationHours, 6);
    // Preserve the existing copy contract for mutable top-level values.
    for (const field of ['start', 'end', 'organizer', 'attendees', 'reminders', 'categories', 'attachments', 'conferenceData', 'metadata']) {
        assert.notEqual(clone[field], original[field], `clone copies ${field}`);
    }
    for (const field of ['attendees', 'reminders', 'attachments']) {
        assert.notEqual(clone[field][0], original[field][0], `clone copies ${field} entries`);
    }
});

test('toObject exports every canonical field and reconstructs without loss', () => {
    const exported = original.toObject();
    assert.deepEqual(Object.keys(exported).sort(), [...fields].sort());
    for (const field of fields) {
        const expected = field === 'start' || field === 'end' ? original[field].toISOString() : original[field];
        assert.deepEqual(exported[field], expected, `export: ${field}`);
    }
    assertFields(Event.fromObject(exported), original, 'plain-object roundtrip');
    // Use JSON-compatible nested values; nested Date/string conversion is not
    // part of Event's contract (only start/end are normalized on construction).
    assertFields(Event.fromObject(JSON.parse(JSON.stringify(exported))), original, 'JSON roundtrip');
});

test('Calendar title-only update preserves all other fields and the old event', () => {
    const calendar = new Calendar({ timeZone: 'UTC' });
    try {
        const stored = calendar.addEvent(data());
        const before = stored.toObject();
        const notifications = [];
        calendar.on('eventUpdate', change => notifications.push(change));
        const updated = calendar.updateEvent(stored.id, { title: 'Renamed flight' });
        assertFields(updated, new Event(data({ title: 'Renamed flight' })), 'title update');
        assert.equal(calendar.getEvent(stored.id), updated);
        assert.notEqual(updated, stored);
        assert.deepEqual(stored.toObject(), before);
        assert.equal(notifications.length, 1);
        assert.equal(notifications[0].oldEvent, stored);
        assert.equal(notifications[0].event, updated);
    } finally {
        calendar.destroy();
    }
});

test('Explicit start and end timezone updates remain independent', () => {
    const startOnly = original.clone({ timeZone: 'UTC' });
    assertFields(startOnly, new Event(data({ timeZone: 'UTC' })), 'start timezone update');
    assert.equal(startOnly.endUTC.toISOString(), '2025-01-15T19:00:00.000Z');

    const calendar = new Calendar({ timeZone: 'UTC' });
    try {
        calendar.addEvent(data());
        const endOnly = calendar.updateEvent(original.id, { endTimeZone: 'Pacific/Honolulu' });
        assertFields(endOnly, new Event(data({ endTimeZone: 'Pacific/Honolulu' })), 'end timezone update');
        assert.equal(endOnly.startUTC.toISOString(), '2025-01-15T13:00:00.000Z');
        assert.equal(endOnly.endUTC.toISOString(), '2025-01-15T21:00:00.000Z');
        assert.equal(endOnly.durationHours, 8);
        assertFields(calendar.updateEvent(original.id, { location: 'New terminal' }),
            new Event(data({ endTimeZone: 'Pacific/Honolulu', location: 'New terminal' })), 'subsequent update');
        assert.throws(() => calendar.updateEvent(original.id, { endTimeZone: 'Invalid/Zone' }), /Invalid end timezone/);
        assert.equal(calendar.getEvent(original.id).endTimeZone, 'Pacific/Honolulu');
    } finally {
        calendar.destroy();
    }
});

test('Explicit null/undefined end timezone retains constructor fallback behavior', () => {
    for (const endTimeZone of [null, undefined]) {
        const clone = original.clone({ timeZone: 'UTC', endTimeZone });
        assertFields(clone, new Event(data({ timeZone: 'UTC', endTimeZone })), 'end timezone fallback');
        assert.equal(clone.endTimeZone, 'UTC');
        assert.equal(clone.durationHours, 3);
    }
});

test('Explicit canonical replacements override the copied values', () => {
    const replacements = {
        title: 'Updated event',
        start: new Date(2025, 0, 16, 9),
        end: new Date(2025, 0, 16, 10),
        allDay: true,
        description: '', location: '', color: null, backgroundColor: null,
        borderColor: null, textColor: null, recurrenceRule: 'FREQ=DAILY;COUNT=2',
        timeZone: 'UTC', endTimeZone: 'Europe/London', status: 'cancelled',
        visibility: 'private', organizer: null, attendees: [], reminders: [],
        categories: [], attachments: [], conferenceData: null, metadata: {}
    };
    const expected = new Event(data(replacements));
    assertFields(original.clone(replacements), expected, 'clone replacements');
    const calendar = new Calendar({ timeZone: 'UTC' });
    try {
        calendar.addEvent(data());
        assertFields(calendar.updateEvent(original.id, replacements), expected, 'Calendar replacements');
    } finally {
        calendar.destroy();
    }
});

test('Defaults, all-day events and legacy aliases survive copying and export', () => {
    const minimal = { id: 'minimal', title: 'Minimal', start: new Date(2025, 0, 15), timeZone: 'UTC' };
    const fixtures = [
        minimal,
        { ...minimal, allDay: true },
        { ...minimal, color: '#aabbcc', category: 'legacy', recurrence: 'FREQ=DAILY;COUNT=2', endTimeZone: 'America/Los_Angeles' }
    ];
    for (const fixture of fixtures) {
        const event = new Event(fixture);
        assertFields(event.clone(), event, 'default/alias clone');
        assertFields(Event.fromObject(event.toObject()), event, 'default/alias roundtrip');
    }
    const legacy = new Event(fixtures[2]);
    assert.deepEqual(legacy.categories, ['legacy']);
    assert.equal(legacy.recurrenceRule, fixtures[2].recurrence);
    assert.equal(legacy.backgroundColor, fixtures[2].color);
    assert.equal(legacy.borderColor, fixtures[2].color);
    assert(Event.isEquivalent(legacy, { ...legacy.toObject(), color: null }));
    assert(!Event.EQUIVALENCE_FIELDS.includes('color'), 'equivalence keeps normalized color semantics');
});

test('Reconcile preserves identity for exported snapshots and detects end-zone-only changes', () => {
    const calendar = new Calendar({ timeZone: 'UTC' });
    try {
        const stored = calendar.addEvent(data());
        const snapshot = JSON.parse(JSON.stringify(stored.toObject()));
        const unchanged = calendar.reconcileEvents([snapshot]);
        assert.equal(unchanged.unchanged.length, 1);
        assert.equal(unchanged.updated.length, 0);
        assert.equal(calendar.getEvent(stored.id), stored);
        assert(!Event.isEquivalent(stored, { ...snapshot, endTimeZone: 'Pacific/Honolulu' }));
        const changed = calendar.reconcileEvents([{ ...snapshot, endTimeZone: 'Pacific/Honolulu' }]);
        assert.equal(changed.updated.length, 1);
        assertFields(calendar.getEvent(stored.id), new Event(data({ endTimeZone: 'Pacific/Honolulu' })), 'end-zone reconcile');
    } finally {
        calendar.destroy();
    }
});

console.log(`\n✅ Event fidelity: ${passed} test groups passed`);
