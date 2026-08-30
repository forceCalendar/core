import { EventStore } from '../events/EventStore.js';
import { Event } from '../events/Event.js';
import { StateManager } from '../state/StateManager.js';
import { DateUtils } from './DateUtils.js';
import { TimezoneManager } from '../timezone/TimezoneManager.js';

/**
 * Calendar - Main calendar class with full timezone support
 * Pure JavaScript, no DOM dependencies
 * Framework agnostic, Locker Service compatible
 */
export class Calendar {
  /**
   * Create a new Calendar instance
   * @param {import('../types.js').CalendarConfig} [config={}] - Configuration options
   */
  constructor(config = {}) {
    // Initialize timezone manager first (use singleton to share cache)
    this.timezoneManager = TimezoneManager.getInstance();

    // Initialize configuration
    this.config = {
      view: 'month',
      date: new Date(),
      weekStartsOn: 0, // 0 = Sunday
      locale: 'en-US',
      timeZone: config.timeZone || this.timezoneManager.getSystemTimezone(),
      showWeekNumbers: false,
      showWeekends: true,
      fixedWeekCount: true,
      businessHours: {
        start: '09:00',
        end: '17:00'
      },
      ...config
    };

    // Initialize core components with timezone support
    this.eventStore = new EventStore({ timezone: this.config.timeZone });
    this.state = new StateManager({
      view: this.config.view,
      currentDate: this.config.date,
      weekStartsOn: this.config.weekStartsOn,
      locale: this.config.locale,
      timeZone: this.config.timeZone,
      showWeekNumbers: this.config.showWeekNumbers,
      showWeekends: this.config.showWeekends,
      fixedWeekCount: this.config.fixedWeekCount,
      businessHours: this.config.businessHours
    });

    // Event emitter for calendar events
    this.listeners = new Map();

    // Plugins
    this.plugins = new Set();

    // View instances (lazy loaded)
    this.views = new Map();

    // Set up internal listeners
    this._setupInternalListeners();

    // Load initial events if provided
    if (config.events) {
      this.setEvents(config.events);
    }
  }

  /**
   * Set the calendar view
   * @param {import('../types.js').ViewType} viewType - The view type ('month', 'week', 'day', 'list')
   * @param {Date} [date=null] - Optional date to navigate to
   */
  setView(viewType, date = null) {
    this.state.setView(viewType);

    if (date) {
      this.state.setCurrentDate(date);
    }

    this._emit('viewChange', {
      view: viewType,
      date: date || this.state.get('currentDate')
    });
  }

  /**
   * Get the current view type
   * @returns {import('../types.js').ViewType} The current view type
   */
  getView() {
    return this.state.get('view');
  }

  /**
   * Navigate to the next period
   */
  next() {
    this.state.navigateNext();
    this._emit('navigate', {
      direction: 'next',
      date: this.state.get('currentDate'),
      view: this.state.get('view')
    });
  }

  /**
   * Navigate to the previous period
   */
  previous() {
    this.state.navigatePrevious();
    this._emit('navigate', {
      direction: 'previous',
      date: this.state.get('currentDate'),
      view: this.state.get('view')
    });
  }

  /**
   * Navigate to today
   */
  today() {
    this.state.navigateToday();
    this._emit('navigate', {
      direction: 'today',
      date: this.state.get('currentDate'),
      view: this.state.get('view')
    });
  }

  /**
   * Navigate to a specific date
   * @param {Date} date - The date to navigate to
   */
  goToDate(date) {
    this.state.setCurrentDate(date);
    this._emit('navigate', {
      direction: 'goto',
      date: date,
      view: this.state.get('view')
    });
  }

  /**
   * Alias for goToDate (compat)
   * @param {Date} date - The date to navigate to
   */
  setDate(date) {
    this.goToDate(date);
  }

  /**
   * Get the current date
   * @returns {Date}
   */
  getCurrentDate() {
    return new Date(this.state.get('currentDate'));
  }

  /**
   * Add an event
   * @param {import('../events/Event.js').Event|import('../types.js').EventData} eventData - Event data or Event instance
   * @returns {import('../events/Event.js').Event} The added event
   */
  addEvent(eventData) {
    // If eventData is not an Event instance and doesn't have a timezone, use calendar's timezone
    if (!(eventData instanceof Event) && !eventData.timeZone) {
      eventData = { ...eventData, timeZone: this.config.timeZone };
    }

    const event = this.eventStore.addEvent(eventData);

    this._emit('eventAdd', { event });

    return event;
  }

  /**
   * Update an event
   *
   * An occurrence id taken from view data (see {@link Event.occurrenceId})
   * updates the recurring master, i.e. the whole series.
   * @param {string} eventId - Event id or occurrence id
   * @param {Object} updates - Properties to update
   * @returns {Event} The updated event (the master for an occurrence id)
   */
  updateEvent(eventId, updates) {
    const oldEvent = this.eventStore.getEvent(eventId);
    const event = this.eventStore.updateEvent(eventId, updates);

    this._emit('eventUpdate', { event, oldEvent });

    return event;
  }

  /**
   * Remove an event
   *
   * An occurrence id taken from view data (see {@link Event.occurrenceId})
   * removes the recurring master, i.e. the whole series.
   * @param {string} eventId - Event id or occurrence id
   * @returns {boolean} True if removed
   */
  removeEvent(eventId) {
    const event = this.eventStore.getEvent(eventId);
    const removed = this.eventStore.removeEvent(eventId);

    if (removed) {
      this._emit('eventRemove', { event });
    }

    return removed;
  }

  /**
   * Alias for removeEvent (compat)
   * @param {string} eventId - The event ID
   * @returns {boolean} True if removed
   */
  deleteEvent(eventId) {
    return this.removeEvent(eventId);
  }

  /**
   * Get an event by ID
   *
   * Occurrence ids taken from view data (`<masterId>_<startMs>`, see
   * {@link Event.occurrenceId}) resolve to the stored recurring master, so
   * every id a renderer hands back can be looked up here.
   * @param {string} eventId - Event id or occurrence id
   * @returns {Event|null} The stored event (the master for an occurrence id) or null
   */
  getEvent(eventId) {
    return this.eventStore.getEvent(eventId);
  }

  /**
   * Resolve an event id or occurrence id to the id of the stored event it
   * refers to: the id itself for a stored event, the master's id for an
   * occurrence id taken from view data, `null` when nothing stored matches.
   * See `EventStore.resolveEventId`.
   *
   * @example
   * calendar.resolveEventId('standup_1750028400000'); // 'standup'
   * calendar.resolveEventId('unknown'); // null
   *
   * @param {string} id - Event id or occurrence id
   * @returns {string|null} Id of the stored event, or null
   */
  resolveEventId(id) {
    return this.eventStore.resolveEventId(id);
  }

  /**
   * Get the occurrence an occurrence id from view data stands for, as an
   * {@link Event} like the ones the views hold, or `null` when the id is
   * not an occurrence of a stored recurring series. See
   * `EventStore.getOccurrence`.
   * @param {string} occurrenceId - Occurrence id (`<masterId>_<startMs>`)
   * @returns {Event|null} The occurrence, or null
   */
  getOccurrence(occurrenceId) {
    return this.eventStore.getOccurrence(occurrenceId, this.config.timeZone);
  }

  /**
   * Get all stored events (recurring masters, never their occurrences)
   * @returns {Event[]}
   */
  getEvents() {
    return this.eventStore.getAllEvents();
  }

  /**
   * Set all events (replaces existing)
   *
   * By default this clears the store and re-adds every entry, so every stored
   * {@link Event} instance is replaced. Pass `{ reconcile: true }` to apply only
   * the differences instead (see {@link Calendar#reconcileEvents}).
   *
   * Emits a single `eventsSet` event whose payload lists the resulting
   * `events` plus the `added`, `updated`, `removed` and `unchanged` sets, so
   * listeners can tell a snapshot load apart from user mutations (no
   * `eventAdd`/`eventUpdate`/`eventRemove` events are emitted).
   *
   * @example
   * calendar.on('eventsSet', ({ added, updated, removed }) => {
   *   if (added.length || updated.length || removed.length) render();
   * });
   * calendar.setEvents(snapshot, { reconcile: true });
   *
   * @param {Array<import('../events/Event.js').Event|import('../types.js').EventData>} events - Array of events
   * @param {import('../types.js').SetEventsOptions} [options={}] - Load options
   * @returns {import('../types.js').EventsSetPayload} The applied change set
   */
  setEvents(events, options = {}) {
    if (options.reconcile) {
      return this.reconcileEvents(events, options);
    }
    this._assertIterable(events, 'setEvents');

    const removed = this.getEvents();
    this.eventStore.loadEvents(events);
    const added = this.getEvents();

    /** @type {import('../types.js').EventsSetPayload} */
    const payload = { events: this.getEvents(), added, updated: [], removed, unchanged: [] };
    this._emit('eventsSet', payload);
    return payload;
  }

  /**
   * Reconcile the calendar with a snapshot of events, applying only the differences.
   *
   * Intended for consumers that receive periodic full snapshots (polling a
   * server, a reactive `events` prop). Unchanged events keep their existing
   * {@link Event} instance, changed ones are replaced, new ones are added and
   * events missing from the snapshot are removed (unless
   * `removeMissing: false`). Equivalence is decided by
   * {@link Event.isEquivalent} unless an `isEquivalent` comparator is supplied.
   * Plain event data without a `timeZone` defaults to the calendar timezone,
   * exactly as with {@link Calendar#addEvent}.
   *
   * The store emits one `eventStoreChange` of type `batch` (or none when
   * nothing differs) and the calendar emits a single `eventsSet` event
   * carrying the change set. Per-event `eventAdd`/`eventUpdate`/`eventRemove`
   * events are not emitted, so listeners that forward those to a backend are
   * not triggered by a snapshot load.
   *
   * @example
   * const { added, updated, removed, unchanged } = calendar.reconcileEvents(rows);
   * updated.forEach(({ event, oldEvent }) => console.log(oldEvent.title, '->', event.title));
   *
   * @param {Array<import('../events/Event.js').Event|import('../types.js').EventData>} events - Complete snapshot of events
   * @param {import('../types.js').ReconcileOptions} [options={}] - Reconcile options
   * @returns {import('../types.js').EventsSetPayload} Resulting events and the applied change set
   * @throws {Error} If `events` is not iterable, an entry fails validation or two entries share an id
   */
  reconcileEvents(events, options = {}) {
    this._assertIterable(events, 'reconcileEvents');
    const { removeMissing, isEquivalent } = options;
    const prepared = [];
    for (const eventData of events) {
      if (!(eventData instanceof Event) && eventData && !eventData.timeZone) {
        prepared.push({ ...eventData, timeZone: this.config.timeZone });
      } else {
        prepared.push(eventData);
      }
    }

    const storeOptions = {};
    if (removeMissing !== undefined) storeOptions.removeMissing = removeMissing;
    if (isEquivalent !== undefined) storeOptions.isEquivalent = isEquivalent;

    const result = this.eventStore.reconcile(prepared, storeOptions);

    /** @type {import('../types.js').EventsSetPayload} */
    const payload = { events: this.getEvents(), ...result };
    this._emit('eventsSet', payload);
    return payload;
  }

  /**
   * Throw a clear error when a snapshot is not iterable
   * @param {*} events - Candidate snapshot
   * @param {string} method - Calling method, for the message
   * @private
   */
  _assertIterable(events, method) {
    if (!events || typeof events[Symbol.iterator] !== 'function') {
      throw new Error(`${method}() expects an iterable of events`);
    }
  }

  /**
   * Get the event store's change counter
   *
   * The counter increases with every add/update/remove/clear and every
   * committed batch, so comparing two readings is a cheap way to find out
   * whether {@link Calendar#setEvents} or {@link Calendar#reconcileEvents}
   * changed anything.
   *
   * @returns {number} Current store version
   */
  getEventsVersion() {
    return this.eventStore.version;
  }

  /**
   * Query events with filters
   * @param {Object} filters - Query filters
   * @returns {Event[]}
   */
  queryEvents(filters) {
    return this.eventStore.queryEvents(filters);
  }

  /**
   * Get events for a specific date, with recurring series expanded into occurrences
   * @param {Date} date - The date
   * @param {string} [timezone] - Timezone for the query (defaults to calendar timezone)
   * @returns {Event[]}
   */
  getEventsForDate(date, timezone = null) {
    return this.eventStore.getEventsForDate(date, timezone || this.config.timeZone);
  }

  /**
   * Get the events for every day in a range, keyed by local date (YYYY-MM-DD)
   *
   * Recurring series are expanded once for the whole range; this is what the
   * month and week views use. See `EventStore.getEventsByDate`.
   * @param {Date} start - First day of the range
   * @param {Date} end - Last day of the range
   * @param {string} [timezone] - Timezone for the query (defaults to calendar timezone)
   * @returns {Map<string, Event[]>} Local date string -> events on that day
   */
  getEventsByDate(start, end, timezone = null) {
    return this.eventStore.getEventsByDate(start, end, timezone || this.config.timeZone);
  }

  /**
   * Get events in a date range
   * @param {Date} start - Start date
   * @param {Date} end - End date
   * @param {string} [timezone] - Timezone for the query (defaults to calendar timezone)
   * @returns {Event[]}
   */
  getEventsInRange(start, end, timezone = null) {
    return this.eventStore.getEventsInRange(start, end, true, timezone || this.config.timeZone);
  }

  /**
   * Lazily iterate the occurrences of an event in chronological order.
   *
   * Occurrences are produced one at a time, so taking the next few of an
   * open-ended series does not expand the series. `after` and `before`
   * are exclusive unless `inclusive` is set; see
   * RecurrenceEngineV2.iterateOccurrences for the full semantics.
   *
   * @example
   * for (const occurrence of calendar.iterateOccurrences('standup', { after: new Date() })) {
   *   if (occurrence.start > deadline) break;
   *   remind(occurrence);
   * }
   *
   * @param {string} eventId - Event id or occurrence id (resolved to its master)
   * @param {import('../types.js').ExpandedOccurrenceIteratorOptions} [options={}] - Window and expansion options
   * @returns {Generator<import('../types.js').ExpandedOccurrence, void, undefined>} Occurrences in chronological order
   * @throws {Error} If no event with the ID exists
   */
  iterateOccurrences(eventId, options = {}) {
    return this.eventStore.iterateOccurrences(eventId, options);
  }

  /**
   * First occurrence of an event after an instant, or null when the
   * series has no occurrence after it. `after` is exclusive unless
   * `options.inclusive` is set.
   *
   * @example
   * const upcoming = calendar.getNextOccurrence('standup', new Date());
   *
   * @param {string} eventId - Event id or occurrence id (resolved to its master)
   * @param {Date|number} [after=null] - Instant to search from (defaults to the series start)
   * @param {import('../types.js').ExpandedOccurrenceIteratorOptions} [options={}] - Further options
   * @returns {import('../types.js').ExpandedOccurrence|null} The next occurrence, or null
   * @throws {Error} If no event with the ID exists
   */
  getNextOccurrence(eventId, after = null, options = {}) {
    return this.eventStore.getNextOccurrence(eventId, after, options);
  }

  /**
   * The first `count` occurrences of an event inside a window, generated
   * lazily. `count` is capped at the engine's MAX_OCCURRENCES_HARD_LIMIT.
   *
   * @example
   * const nextFive = calendar.takeOccurrences('standup', 5, { after: new Date() });
   *
   * @param {string} eventId - Event id or occurrence id (resolved to its master)
   * @param {number} count - Maximum number of occurrences to return (fractions are floored)
   * @param {import('../types.js').ExpandedOccurrenceIteratorOptions} [options={}] - Window and expansion options
   * @returns {import('../types.js').ExpandedOccurrence[]} Up to `count` occurrences in chronological order
   * @throws {Error} If no event with the ID exists
   */
  takeOccurrences(eventId, count, options = {}) {
    return this.eventStore.takeOccurrences(eventId, count, options);
  }

  /**
   * Set the calendar's timezone
   * @param {string} timezone - IANA timezone identifier
   */
  setTimezone(timezone) {
    const parsedTimezone = this.timezoneManager.parseTimezone(timezone);
    const previousTimezone = this.config.timeZone;

    this.config.timeZone = parsedTimezone;
    this.eventStore.defaultTimezone = parsedTimezone;
    this.state.setState({ timeZone: parsedTimezone });

    this._emit('timezoneChange', {
      timezone: parsedTimezone,
      previousTimezone: previousTimezone
    });
  }

  /**
   * Get the current timezone
   * @returns {string} Current timezone
   */
  getTimezone() {
    return this.config.timeZone;
  }

  /**
   * Set the calendar locale
   * @param {string} locale - Locale identifier (e.g. 'en-US')
   */
  setLocale(locale) {
    this.config.locale = locale;
    this.state.setState({ locale });
    this._emit('localeChange', { locale });
  }

  /**
   * Set the week start day
   * @param {number} weekStartsOn - 0 = Sunday, 1 = Monday, etc.
   */
  setWeekStartsOn(weekStartsOn) {
    this.config.weekStartsOn = weekStartsOn;
    this.state.setState({ weekStartsOn });
    this._emit('weekStartsOnChange', { weekStartsOn });
  }

  /**
   * Convert a date from one timezone to another
   * @param {Date} date - Date to convert
   * @param {string} fromTimezone - Source timezone
   * @param {string} toTimezone - Target timezone
   * @returns {Date} Converted date
   */
  convertTimezone(date, fromTimezone, toTimezone) {
    return this.timezoneManager.convertTimezone(date, fromTimezone, toTimezone);
  }

  /**
   * Convert a date to the calendar's timezone
   * @param {Date} date - Date to convert
   * @param {string} fromTimezone - Source timezone
   * @returns {Date} Date in calendar timezone
   */
  toCalendarTimezone(date, fromTimezone) {
    return this.timezoneManager.convertTimezone(date, fromTimezone, this.config.timeZone);
  }

  /**
   * Convert a date from the calendar's timezone
   * @param {Date} date - Date in calendar timezone
   * @param {string} toTimezone - Target timezone
   * @returns {Date} Converted date
   */
  fromCalendarTimezone(date, toTimezone) {
    return this.timezoneManager.convertTimezone(date, this.config.timeZone, toTimezone);
  }

  /**
   * Format a date in a specific timezone
   * @param {Date} date - Date to format
   * @param {string} [timezone] - Timezone for formatting (defaults to calendar timezone)
   * @param {Object} [options] - Formatting options
   * @returns {string} Formatted date string
   */
  formatInTimezone(date, timezone = null, options = {}) {
    return this.timezoneManager.formatInTimezone(date, timezone || this.config.timeZone, options);
  }

  /**
   * Get list of common timezones with offsets
   * @returns {Array<{value: string, label: string, offset: string}>} Timezone list
   */
  getTimezones() {
    return this.timezoneManager.getCommonTimezones();
  }

  /**
   * Get overlapping event groups for a date
   * @param {Date} date - The date to check
   * @param {boolean} timedOnly - Only include timed events
   * @returns {Array<Event[]>} Array of event groups that overlap
   */
  getOverlapGroups(date, timedOnly = true) {
    return this.eventStore.getOverlapGroups(date, timedOnly);
  }

  /**
   * Calculate event positions for rendering
   * @param {Event[]} events - Array of overlapping events
   * @returns {Map<string, {column: number, totalColumns: number}>} Position data
   */
  calculateEventPositions(events) {
    return this.eventStore.calculateEventPositions(events);
  }

  /**
   * Get the current view's data
   * @returns {import('../types.js').MonthViewData|import('../types.js').WeekViewData|import('../types.js').DayViewData|import('../types.js').ListViewData|null} View-specific data
   */
  getViewData() {
    const view = this.state.get('view');
    const currentDate = this.state.get('currentDate');

    switch (view) {
      case 'month':
        return this._getMonthViewData(currentDate);
      case 'week':
        return this._getWeekViewData(currentDate);
      case 'day':
        return this._getDayViewData(currentDate);
      case 'list':
        return this._getListViewData(currentDate);
      default:
        return null;
    }
  }

  /**
   * Get month view data
   * @private
   */
  _getMonthViewData(date) {
    const year = date.getFullYear();
    const month = date.getMonth();
    const weekStartsOn = this.state.get('weekStartsOn');
    const fixedWeekCount = this.state.get('fixedWeekCount');

    // Get the first day of the month
    const firstDay = new Date(year, month, 1);

    // Get the last day of the month
    const lastDay = new Date(year, month + 1, 0);

    // Calculate the start date (beginning of the week containing the first day)
    const startDate = DateUtils.startOfWeek(firstDay, weekStartsOn);

    // Calculate weeks
    const weeks = [];
    let currentDate = new Date(startDate);

    // Generate weeks
    const maxWeeks = fixedWeekCount
      ? 6
      : Math.ceil((lastDay.getDate() + DateUtils.getDayOfWeek(firstDay, weekStartsOn)) / 7);

    // Expand recurring series once for the whole grid, not once per cell
    const eventsByDate = this.getEventsByDate(
      startDate,
      DateUtils.addDays(startDate, maxWeeks * 7 - 1)
    );

    for (let weekIndex = 0; weekIndex < maxWeeks; weekIndex++) {
      const week = {
        weekNumber: DateUtils.getWeekNumber(currentDate),
        days: []
      };

      for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
        const dayDate = new Date(currentDate);
        const isCurrentMonth = dayDate.getMonth() === month;
        const isToday = DateUtils.isToday(dayDate);
        const isWeekend = dayDate.getDay() === 0 || dayDate.getDay() === 6;

        week.days.push({
          date: dayDate,
          dayOfMonth: dayDate.getDate(),
          isCurrentMonth,
          isToday,
          isWeekend,
          events: eventsByDate.get(DateUtils.getLocalDateString(dayDate)) || []
        });

        // Use DateUtils.addDays to handle month boundaries correctly
        currentDate = DateUtils.addDays(currentDate, 1);
      }

      weeks.push(week);
    }

    return {
      type: 'month',
      year,
      month,
      monthName: DateUtils.getMonthName(date, this.state.get('locale')),
      weeks,
      startDate,
      endDate: new Date(currentDate.getTime() - 1) // Last moment of the view
    };
  }

  /**
   * Get week view data
   * @private
   */
  _getWeekViewData(date) {
    const weekStartsOn = this.state.get('weekStartsOn');
    const startDate = DateUtils.startOfWeek(date, weekStartsOn);
    const endDate = DateUtils.endOfWeek(date, weekStartsOn);

    const days = [];
    const currentDate = new Date(startDate);

    // Expand recurring series once for the whole week, not once per day
    const eventsByDate = this.getEventsByDate(startDate, endDate);

    for (let i = 0; i < 7; i++) {
      const dayDate = new Date(currentDate);
      const events = eventsByDate.get(DateUtils.getLocalDateString(dayDate)) || [];
      days.push({
        date: dayDate,
        dayOfMonth: dayDate.getDate(),
        dayOfWeek: dayDate.getDay(),
        dayName: DateUtils.getDayName(dayDate, this.state.get('locale')),
        isToday: DateUtils.isToday(dayDate),
        isWeekend: dayDate.getDay() === 0 || dayDate.getDay() === 6,
        events,
        // Add overlap groups for positioning overlapping events
        overlapGroups: this.eventStore.groupOverlappingEvents(events, true),
        getEventPositions: events => this.eventStore.calculateEventPositions(events)
      });
      // Move to next day
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return {
      type: 'week',
      weekNumber: DateUtils.getWeekNumber(startDate),
      startDate,
      endDate,
      days
    };
  }

  /**
   * Get day view data
   * @private
   */
  _getDayViewData(date) {
    const timezone = this.config.timeZone;
    const events = this.getEventsForDate(date);

    // Separate all-day and timed events. Hour slots are placed on the
    // calendar's wall clock, so timed events are compared in that timezone.
    const allDayEvents = events.filter(e => e.allDay);
    const timedEvents = events
      .filter(e => !e.allDay)
      .map(event => ({
        event,
        start: event.getStartInTimezone(timezone),
        end: event.getEndInTimezone(timezone)
      }));

    // Create hourly slots for timed events
    const hours = [];
    for (let hour = 0; hour < 24; hour++) {
      const hourDate = new Date(date);
      hourDate.setHours(hour, 0, 0, 0);
      const hourEnd = new Date(date);
      hourEnd.setHours(hour + 1, 0, 0, 0);

      hours.push({
        hour,
        time: DateUtils.formatTime(hourDate, this.state.get('locale')),
        events: timedEvents
          .filter(({ start, end }) => {
            // Check if event occurs during this hour (not just starts)
            // Event occurs in this hour if it overlaps with the hour slot
            return start < hourEnd && end > hourDate;
          })
          .map(({ event }) => event)
      });
    }

    return {
      type: 'day',
      date,
      dayName: DateUtils.getDayName(date, this.state.get('locale')),
      isToday: DateUtils.isToday(date),
      allDayEvents,
      hours
    };
  }

  /**
   * Get list view data
   * @private
   */
  _getListViewData(date) {
    // Get events for the next 30 days
    const startDate = new Date(date);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 30);

    const events = this.getEventsInRange(startDate, endDate);

    // Group events by day
    const groupedEvents = new Map();

    events.forEach(event => {
      const dateKey = event.start.toDateString();
      if (!groupedEvents.has(dateKey)) {
        groupedEvents.set(dateKey, {
          date: new Date(event.start),
          events: []
        });
      }
      groupedEvents.get(dateKey).events.push(event);
    });

    // Convert to sorted array
    const days = Array.from(groupedEvents.values())
      .sort((a, b) => a.date - b.date)
      .map(day => ({
        ...day,
        dayName: DateUtils.getDayName(day.date, this.state.get('locale')),
        isToday: DateUtils.isToday(day.date)
      }));

    return {
      type: 'list',
      startDate,
      endDate,
      days,
      totalEvents: events.length
    };
  }

  /**
   * Select an event
   *
   * Accepts a stored event's id or an occurrence id taken from view data
   * (see {@link Event.occurrenceId}). Either way the stored event is what
   * gets selected: `selectedEventId` in the state holds its id, so it can
   * always be looked up with {@link Calendar#getEvent}. The `eventSelect`
   * payload carries the stored `event`, its `eventId`, and for an
   * occurrence id also `occurrenceId` and the `occurrence` itself (an
   * {@link Event} as in view data, or null when the series has no
   * occurrence at that instant). Nothing happens for an unknown id.
   *
   * @example
   * calendar.on('eventSelect', ({ event, occurrence }) => open(occurrence || event));
   * calendar.selectEvent(chip.dataset.eventId);
   *
   * @param {string} eventId - Event id or occurrence id to select
   */
  selectEvent(eventId) {
    const event = this.getEvent(eventId);
    if (!event) {
      return;
    }
    const isOccurrence = eventId !== event.id;
    this.state.selectEvent(event.id);
    /** @type {import('../types.js').EventSelectPayload} */
    const payload = {
      event,
      eventId: event.id,
      occurrenceId: isOccurrence ? eventId : null,
      occurrence: isOccurrence ? this.getOccurrence(eventId) : null
    };
    this._emit('eventSelect', payload);
  }

  /**
   * Clear event selection
   */
  clearEventSelection() {
    const eventId = this.state.get('selectedEventId');
    this.state.clearEventSelection();

    if (eventId) {
      this._emit('eventDeselect', { eventId });
    }
  }

  /**
   * Select a date
   * @param {Date} date - Date to select
   */
  selectDate(date) {
    this.state.selectDate(date);
    this._emit('dateSelect', { date });
  }

  /**
   * Clear date selection
   */
  clearDateSelection() {
    const date = this.state.get('selectedDate');
    this.state.clearDateSelection();

    if (date) {
      this._emit('dateDeselect', { date });
    }
  }

  /**
   * Subscribe to calendar events
   * @param {string} eventName - Event name
   * @param {Function} callback - Callback function
   * @returns {Function} Unsubscribe function
   */
  on(eventName, callback) {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, new Set());
    }
    this.listeners.get(eventName).add(callback);

    return () => this.off(eventName, callback);
  }

  /**
   * Unsubscribe from calendar events
   * @param {string} eventName - Event name
   * @param {Function} callback - Callback function
   */
  off(eventName, callback) {
    const callbacks = this.listeners.get(eventName);
    if (callbacks) {
      callbacks.delete(callback);
      if (callbacks.size === 0) {
        this.listeners.delete(eventName);
      }
    }
  }

  /**
   * Emit an event
   * @private
   */
  _emit(eventName, data) {
    const callbacks = this.listeners.get(eventName);
    if (callbacks) {
      callbacks.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in event listener for "${eventName}":`, error);
        }
      });
    }
  }

  /**
   * Set up internal listeners
   * @private
   */
  _setupInternalListeners() {
    // Listen to state changes
    this.state.subscribe((newState, oldState) => {
      this._emit('stateChange', { newState, oldState });
    });

    // Listen to event store changes
    this.eventStore.subscribe(change => {
      this._emit('eventStoreChange', change);
    });
  }

  /**
   * Install a plugin
   * @param {Object} plugin - Plugin object with install method
   */
  use(plugin) {
    if (this.plugins.has(plugin)) {
      console.warn('Plugin already installed');
      return;
    }

    if (typeof plugin.install === 'function') {
      plugin.install(this);
      this.plugins.add(plugin);
    } else {
      throw new Error('Plugin must have an install method');
    }
  }

  /**
   * Destroy the calendar and clean up
   */
  destroy() {
    // Emit destroy event before clearing listeners
    this._emit('destroy');

    // Clear all listeners
    this.listeners.clear();

    // Properly destroy EventStore (clears events, caches, and cleanup timers)
    this.eventStore.destroy();

    // Clear plugins — wrap each uninstall in try-catch so one failure
    // doesn't prevent cleanup of remaining plugins
    this.plugins.forEach(plugin => {
      if (typeof plugin.uninstall === 'function') {
        try {
          plugin.uninstall(this);
        } catch (error) {
          console.error('Error uninstalling plugin:', error);
        }
      }
    });
    this.plugins.clear();

    // Clear view instances
    this.views.clear();
  }
} // Test workflow
