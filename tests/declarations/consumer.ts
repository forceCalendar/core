import DefaultCalendar, { Calendar, EnhancedCalendar, Event, EventStore } from '@forcecalendar/core';
import { Calendar as CalendarEntry } from '@forcecalendar/core/calendar';
import { Event as EventEntry } from '@forcecalendar/core/events';
import { StateManager } from '@forcecalendar/core/state';
import { EventSearch } from '@forcecalendar/core/search';
import { ICSHandler } from '@forcecalendar/core/ics';
import type { EnhancedCalendarOccurrence, EnhancedRangeOptions } from '@forcecalendar/core/types';

const start = new Date('2026-10-02T00:00:00Z');
const end = new Date('2026-10-03T00:00:00Z');
const base = new Calendar({ timeZone: 'UTC' });
const events: Event[] = base.getEventsInRange(start, end, 'UTC');
events.forEach(event => event.toObject());
const defaultCalendar: Calendar = new DefaultCalendar();
const subpathCalendar: Calendar = new CalendarEntry();
const storeEvents: Event[] = new EventStore().getEventsInRange(start, end);
const enhanced = new EnhancedCalendar({ timeZone: 'UTC' });
const unconfigured = new EnhancedCalendar();
const rangeOptions: EnhancedRangeOptions = {
  maxOccurrences: 10,
  includeModified: true,
  includeCancelled: true,
  timezone: 'UTC',
  handleDST: true
};
const enhancedEvents = enhanced.getEventsInRange(start, end);
enhanced.getEventsInRange(start, end, rangeOptions);
enhanced.getEventsInRange(start, end, 'UTC');
// Calendar subclasses can accurately expose extra range result shapes while
// ordinary Calendar consumers retain Event[] without a type assertion.
const enhancedBase: Calendar<EnhancedCalendarOccurrence> = enhanced;
const enhancedBaseEvents: (Event | EnhancedCalendarOccurrence)[] = enhancedBase.getEventsInRange(start, end);
for (const event of enhancedEvents) {
  const id: string = event.id;
  const date: Date | string = event.start;
  if (event instanceof Event) {
    event.toObject();
  } else {
    const timezone: string = event.timezone;
    const occurrenceStart: Date = event.occurrenceStart;
    const occurrence: boolean = event.isOccurrence;
    void [timezone, occurrenceStart, occurrence];
    // Expanded occurrences deliberately are plain objects, not Event instances.
    // @ts-expect-error Expanded occurrences have no Event methods.
    event.toObject();
  }
  void [id, date];
}
void [defaultCalendar, subpathCalendar, storeEvents, EventEntry, StateManager, EventSearch, ICSHandler, unconfigured, enhancedBaseEvents];
