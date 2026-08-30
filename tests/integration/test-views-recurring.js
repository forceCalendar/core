/**
 * Test that month/week/day/list views expand recurring series into
 * occurrences with stable ids that resolve back to their master event.
 */

import { Event } from '../../core/events/Event.js';
import { RecurrenceEngineV2 } from '../../core/events/RecurrenceEngineV2.js';
import { Calendar } from '../../core/calendar/Calendar.js';
import { EnhancedCalendar } from '../../core/integration/EnhancedCalendar.js';
import { DateUtils } from '../../core/calendar/DateUtils.js';

console.log('Testing recurring events in views...\n');

let failures = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`  ✅ ${message}`);
    } else {
        console.log(`  ❌ ${message}`);
        failures++;
    }
}

const RECURRING_IDS = ['standup', 'weekly-allday', 'retreat'];
const cellEvents = viewData => viewData.weeks.flatMap(week => week.days.flatMap(day => day.events));
const findCell = (viewData, date) =>
    viewData.weeks.flatMap(week => week.days).find(day => DateUtils.isSameDay(day.date, date));
const ofSeries = (events, masterId) =>
    events.filter(e => e.id === masterId || e.recurringEventId === masterId);

// June 2025, week starts on Sunday: grid runs Sun 1 Jun - Sat 12 Jul (42 cells)
const calendar = new Calendar({ view: 'month', date: new Date(2025, 5, 15), weekStartsOn: 0 });

// Daily series that started years before the range
calendar.addEvent({
    id: 'standup',
    title: 'Standup',
    start: new Date(2020, 0, 6, 9, 0),
    end: new Date(2020, 0, 6, 9, 30),
    recurring: true,
    recurrenceRule: 'FREQ=DAILY'
});
// All-day weekly series whose master start (Wed 4 Jun) is inside the range
calendar.addEvent({
    id: 'weekly-allday',
    title: 'Weekly Review',
    start: new Date(2025, 5, 4),
    allDay: true,
    recurring: true,
    recurrenceRule: 'FREQ=WEEKLY'
});
// Multi-day weekly series: Fri 18:00 - Mon 10:00, first occurrence straddles the grid start
calendar.addEvent({
    id: 'retreat',
    title: 'Retreat',
    start: new Date(2025, 4, 30, 18, 0),
    end: new Date(2025, 5, 2, 10, 0),
    recurring: true,
    recurrenceRule: 'FREQ=WEEKLY'
});
calendar.addEvent({
    id: 'single',
    title: 'One-off',
    start: new Date(2025, 5, 10, 13, 0),
    end: new Date(2025, 5, 10, 14, 0)
});

console.log('=== Test 1: Month view ===');
const engine = calendar.eventStore.recurrenceEngine;
let expandCalls = 0;
const originalExpand = engine.expandEvent.bind(engine);
engine.expandEvent = (...args) => {
    expandCalls++;
    return originalExpand(...args);
};

const month = calendar.getViewData();
const monthEvents = cellEvents(month);
assert(month.weeks.length === 6 && monthEvents.length > 0, 'Month view has 6 weeks with events');
assert(expandCalls === RECURRING_IDS.length, `Each series is expanded once for the whole grid (${expandCalls} expansions)`);
assert(ofSeries(monthEvents, 'standup').length === 42, `Daily series started years earlier fills every cell (${ofSeries(monthEvents, 'standup').length})`);
assert(ofSeries(monthEvents, 'weekly-allday').length === 6, `All-day weekly series appears on each Wednesday (${ofSeries(monthEvents, 'weekly-allday').length})`);
assert(monthEvents.filter(e => e.id === 'single').length === 1, 'Non-recurring event appears once');
assert(monthEvents.every(e => !RECURRING_IDS.includes(e.id)), 'Recurring masters never appear as themselves in the grid');
assert(ofSeries(monthEvents, 'standup').every(e => e instanceof Event && e.isOccurrence && e.recurringEventId === 'standup'), 'Occurrences are Event instances flagged as occurrences of their master');
assert(monthEvents.filter(e => !e.isOccurrence).every(e => e.recurringEventId === null && e.occurrenceStart === null), 'Stored events carry the default occurrence fields');

const jun4 = findCell(month, new Date(2025, 5, 4));
const jun4Weekly = ofSeries(jun4.events, 'weekly-allday');
assert(jun4Weekly.length === 1 && jun4Weekly[0].id !== 'weekly-allday' && jun4Weekly[0].isOccurrence, 'Master whose own start is in range appears once, as an occurrence');
assert(jun4Weekly[0].allDay && jun4.events[0] === jun4Weekly[0], 'All-day occurrence keeps allDay and sorts first in its cell');
assert(month.weeks.every(w => w.days.every(d => new Set(d.events.map(e => e.id)).size === d.events.length)), 'No cell contains the same id twice');

const jun1 = findCell(month, new Date(2025, 5, 1));
const jun2 = findCell(month, new Date(2025, 5, 2));
const jun3 = findCell(month, new Date(2025, 5, 3));
const jun6 = findCell(month, new Date(2025, 5, 6));
const retreatJun1 = ofSeries(jun1.events, 'retreat');
assert(retreatJun1.length === 1 && retreatJun1[0].start.getTime() === new Date(2025, 4, 30, 18, 0).getTime(), 'Multi-day occurrence that started before the grid shows on the first cell');
assert(ofSeries(jun2.events, 'retreat')[0]?.id === retreatJun1[0].id, 'Multi-day occurrence spans every day it covers with one id');
assert(ofSeries(jun3.events, 'retreat').length === 0, 'Multi-day occurrence does not leak past its end');
assert(ofSeries(jun6.events, 'retreat').length === 1 && ofSeries(jun6.events, 'retreat')[0].id !== retreatJun1[0].id, 'Next multi-day occurrence gets its own id');
assert(ofSeries(monthEvents, 'retreat').length === 4 * 7 - 4, `Multi-day occurrences fill the days they span (${ofSeries(monthEvents, 'retreat').length})`);

console.log('\n=== Test 2: Week view ===');
expandCalls = 0;
calendar.setView('week', new Date(2025, 5, 16));
const week = calendar.getViewData();
const weekEvents = week.days.flatMap(day => day.events);
assert(expandCalls === RECURRING_IDS.length, `Each series is expanded once for the week (${expandCalls} expansions)`);
assert(ofSeries(weekEvents, 'standup').length === 7, 'Daily series appears on all 7 days');
assert(ofSeries(weekEvents, 'weekly-allday').length === 1, 'All-day weekly series appears once in the week');
assert(ofSeries(weekEvents, 'retreat').length === 4 && new Set(ofSeries(weekEvents, 'retreat').map(e => e.id)).size === 2, 'Two multi-day occurrences cover four days of the week');
const monday = week.days[1];
assert(monday.overlapGroups.length === 1 && monday.overlapGroups[0].length === 2, 'Overlap groups are built from occurrences');
assert(monday.events.length === 2 && monday.events[0].recurringEventId === 'retreat' && monday.events[1].recurringEventId === 'standup', 'Day events stay sorted with the earlier-starting occurrence first');

console.log('\n=== Test 3: Day view ===');
calendar.setView('day', new Date(2025, 5, 18));
const day = calendar.getViewData();
const timedIds = new Set(day.hours.flatMap(hour => hour.events.map(e => e.id)));
assert(day.allDayEvents.length === 1 && day.allDayEvents[0].recurringEventId === 'weekly-allday', 'All-day occurrence is listed in allDayEvents');
assert(timedIds.size === 1 && [...timedIds][0].startsWith('standup_'), 'Timed occurrence is placed in the hour slots');
assert(day.hours[9].events.length === 1 && day.hours[9].events[0].recurringEventId === 'standup', 'Timed occurrence lands in its hour');

console.log('\n=== Test 4: List view ===');
calendar.setView('list', new Date(2025, 5, 15));
const list = calendar.getViewData();
const listEvents = list.days.flatMap(d => d.events);
assert(list.totalEvents === 39 && listEvents.length === 39, `List view holds 30 standups, 4 reviews and 5 retreats (${list.totalEvents})`);
assert(ofSeries(listEvents, 'standup').length === 30 && ofSeries(listEvents, 'retreat').length === 5, 'List view expands every series including the one that started years earlier');
assert(new Set(listEvents.map(e => e.id)).size === listEvents.length, 'List view ids are unique');

console.log('\n=== Test 5: Standalone getEventsForDate / getEventsByDate ===');
const jun16 = calendar.getEventsForDate(new Date(2025, 5, 16));
assert(jun16.length === 2 && jun16.every(e => e.isOccurrence), `getEventsForDate returns occurrences on its own (${jun16.length})`);
assert(calendar.getEventsForDate(new Date(2025, 5, 1)).some(e => e.recurringEventId === 'retreat'), 'getEventsForDate includes a multi-day occurrence that started the day before');
assert(calendar.getEventsForDate(new Date(2025, 5, 10)).some(e => e.id === 'single'), 'getEventsForDate still returns non-recurring events');
assert(calendar.eventStore.getEventsForDate(new Date(2025, 5, 4)).filter(e => e.id === 'weekly-allday' || e.recurringEventId === 'weekly-allday').length === 1, 'Store getEventsForDate does not double count the master on its start day');
const groups = calendar.getOverlapGroups(new Date(2025, 5, 16));
assert(groups.length === 1 && groups[0].length === 2, 'getOverlapGroups sees occurrences');

const byDate = calendar.getEventsByDate(new Date(2025, 5, 1), new Date(2025, 5, 7));
assert(byDate.size === 7 && [...byDate.keys()][0] === '2025-06-01' && [...byDate.keys()][6] === '2025-06-07', 'getEventsByDate has an entry for every day of the range');
assert(byDate.get('2025-06-04').map(e => e.recurringEventId).join() === 'weekly-allday,standup', 'getEventsByDate buckets are sorted by start');
assert(byDate.get('2025-06-01').map(e => e.id).join() === jun1.events.map(e => e.id).join(), 'getEventsByDate matches the month grid cell');
assert(calendar.getEvents().length === 4 && calendar.getEvents().every(e => !e.isOccurrence), 'getEvents still returns only the stored masters');

console.log('\n=== Test 6: Occurrence identity and resolution ===');
const standupOcc = jun16.find(e => e.recurringEventId === 'standup');
assert(standupOcc.id === `standup_${standupOcc.start.getTime()}`, `Occurrence id is <masterId>_<startMs> (${standupOcc.id})`);
assert(standupOcc.id === Event.occurrenceId('standup', standupOcc.start), 'Event.occurrenceId builds the same id');
assert(standupOcc.occurrenceStart.getTime() === standupOcc.start.getTime() && standupOcc.occurrenceStart !== standupOcc.start, 'occurrenceStart mirrors the occurrence start');
assert(standupOcc.metadata.recurringEventId === 'standup' && standupOcc.metadata.occurrenceId === standupOcc.id, 'Occurrence metadata keeps the master id and occurrence id');
const fromGrid = ofSeries(findCell(month, new Date(2025, 5, 16)).events, 'standup')[0];
const fromRange = calendar
    .getEventsInRange(new Date(2025, 5, 10), new Date(2025, 5, 20))
    .find(e => e.recurringEventId === 'standup' && e.start.getTime() === standupOcc.start.getTime());
assert(fromGrid.id === standupOcc.id && fromRange.id === standupOcc.id, 'The same occurrence gets the same id from any view or range');
const engineOcc = new RecurrenceEngineV2().expandEvent(
    calendar.getEvent('standup'),
    DateUtils.startOfDay(new Date(2025, 5, 16)),
    DateUtils.endOfDay(new Date(2025, 5, 16))
);
assert(engineOcc.length === 1 && engineOcc[0].id === standupOcc.id, 'Occurrence id matches the id RecurrenceEngineV2 generates');
const parsed = Event.parseOccurrenceId(standupOcc.id);
assert(parsed.recurringEventId === 'standup' && parsed.occurrenceStart.getTime() === standupOcc.start.getTime(), 'Event.parseOccurrenceId recovers master id and start');
assert(Event.parseOccurrenceId('standup') === null && Event.parseOccurrenceId('standup_abc') === null && Event.parseOccurrenceId(null) === null, 'Event.parseOccurrenceId rejects ids that are not occurrence ids');
assert(calendar.getEvent(standupOcc.id) === calendar.getEvent('standup'), 'Calendar.getEvent resolves an occurrence id to the master');
assert(calendar.eventStore.getEvent(standupOcc.id) === calendar.eventStore.getEvent('standup'), 'EventStore.getEvent resolves an occurrence id to the master');
assert(calendar.getEvent('single_1750000000000') === null, 'Occurrence-shaped id of a non-recurring event does not resolve');
assert(calendar.getEvent('ghost_1750000000000') === null && calendar.getEvent('standup_x') === null, 'Unknown ids still return null');
let selected = null;
calendar.on('eventSelect', payload => { selected = payload; });
calendar.selectEvent(standupOcc.id);
assert(
    selected?.event.id === 'standup' && selected.occurrenceId === standupOcc.id && calendar.state.get('selectedEventId') === 'standup',
    'selectEvent accepts an occurrence id and selects its master'
);

console.log('\n=== Test 7: Update and remove through an occurrence id ===');
let updatePayload = null;
calendar.on('eventUpdate', payload => { updatePayload = payload; });
const updated = calendar.updateEvent(standupOcc.id, { title: 'Daily Standup' });
assert(updated.id === 'standup' && updated.title === 'Daily Standup', 'updateEvent with an occurrence id updates the master');
assert(updatePayload?.event.id === 'standup' && updatePayload?.oldEvent.id === 'standup', 'eventUpdate reports the master');
assert(calendar.getEvents().length === 4, 'Updating through an occurrence id does not add an event');
assert(calendar.getEventsForDate(new Date(2025, 5, 20)).find(e => e.recurringEventId === 'standup').title === 'Daily Standup', 'Later occurrences reflect the update');
let threw = false;
try {
    calendar.eventStore.updateEvent('ghost_1750000000000', { title: 'x' });
} catch {
    threw = true;
}
assert(threw, 'updateEvent still throws for an occurrence id with no master');

let removePayload = null;
calendar.on('eventRemove', payload => { removePayload = payload; });
assert(calendar.deleteEvent(jun4Weekly[0].id) === true, 'deleteEvent with an occurrence id removes the series');
assert(removePayload?.event.id === 'weekly-allday' && calendar.getEvent('weekly-allday') === null, 'eventRemove reports the master and it is gone');
assert(calendar.removeEvent(jun4Weekly[0].id) === false && calendar.getEvent(jun4Weekly[0].id) === null, 'Occurrence id no longer resolves once the master is removed');
calendar.setView('month', new Date(2025, 5, 15));
assert(ofSeries(cellEvents(calendar.getViewData()), 'weekly-allday').length === 0, 'Removed series disappears from the month view');

console.log('\n=== Test 8: EnhancedCalendar.getEventsInRange ===');
const enhanced = new EnhancedCalendar({ view: 'month', date: new Date(2025, 5, 15), weekStartsOn: 0 });
enhanced.addEvent({
    id: 'old-weekly',
    title: 'Old Weekly',
    start: new Date(2019, 0, 7, 9, 0),
    end: new Date(2019, 0, 7, 10, 0),
    recurring: true,
    recurrenceRule: 'FREQ=WEEKLY'
});
enhanced.addEvent({
    id: 'plain',
    title: 'Plain',
    start: new Date(2025, 5, 10, 13, 0),
    end: new Date(2025, 5, 10, 14, 0)
});
const enhancedRange = enhanced.getEventsInRange(new Date(2025, 5, 1), new Date(2025, 5, 30, 23, 59, 59));
const oldWeekly = enhancedRange.filter(e => e.recurringEventId === 'old-weekly');
assert(oldWeekly.length === 5 && enhancedRange.length === 6, `Series that started years before the range is expanded (${oldWeekly.length} occurrences)`);
assert(enhancedRange.every(e => e.id !== 'old-weekly'), 'Recurring master is not returned alongside its occurrences');
assert(oldWeekly.every(e => e.id === Event.occurrenceId('old-weekly', e.start) && e.isOccurrence && e.occurrenceStart.getTime() === e.start.getTime()), 'EnhancedCalendar occurrences carry the same id scheme and occurrence fields');
assert(enhanced.getEvent(oldWeekly[0].id)?.id === 'old-weekly', 'EnhancedCalendar resolves occurrence ids');
assert(ofSeries(cellEvents(enhanced.getViewData()), 'old-weekly').length === 6, 'EnhancedCalendar month view shows the old series');
enhanced.destroy();

if (failures > 0) {
    console.log(`\n❌ Recurring views test failed: ${failures} assertion(s)`);
    process.exit(1);
}

console.log('\n✅ Recurring views test complete!');
process.exit(0);
