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
   * @param {import('../../types.js').CalendarConfig} [config={}] - Configuration options
   */
  constructor(config = {}) {
    // Initialize timezone manager first
    this.timezoneManager = new TimezoneManager();

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
   * @param {import('../../types.js').ViewType} viewType - The view type ('month', 'week', 'day', 'list')
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
   * @returns {import('../../types.js').ViewType} The current view type
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
   * @param {import('../events/Event.js').Event|import('../../types.js').EventData} eventData - Event data or Event instance
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
   * @param {string} eventId - The event ID
   * @param {Object} updates - Properties to update
   * @returns {Event} The updated event
   */
  updateEvent(eventId, updates) {
    const oldEvent = this.eventStore.getEvent(eventId);
    const event = this.eventStore.updateEvent(eventId, updates);

    this._emit('eventUpdate', { event, oldEvent });

    return event;
  }

  /**
   * Remove an event
   * @param {string} eventId - The event ID
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
   * @param {string} eventId - The event ID
   * @returns {Event|null}
   */
  getEvent(eventId) {
    return this.eventStore.getEvent(eventId);
  }

  /**
   * Get all events
   * @returns {Event[]}
   */
  getEvents() {
    return this.eventStore.getAllEvents();
  }

  /**
   * Set all events (replaces existing)
   * @param {Event[]} events - Array of events
   */
  setEvents(events) {
    this.eventStore.loadEvents(events);
    this._emit('eventsSet', { events: this.getEvents() });
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
   * Get events for a specific date
   * @param {Date} date - The date
   * @param {string} [timezone] - Timezone for the query (defaults to calendar timezone)
   * @returns {Event[]}
   */
  getEventsForDate(date, timezone = null) {
    return this.eventStore.getEventsForDate(date, timezone || this.config.timeZone);
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
    return this.timezoneManager.formatInTimezone(
      date,
      timezone || this.config.timeZone,
      options
    );
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
   * @returns {import('../../types.js').MonthViewData|import('../../types.js').WeekViewData|import('../../types.js').DayViewData|import('../../types.js').ListViewData|null} View-specific data
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
    const maxWeeks = fixedWeekCount ? 6 : Math.ceil((lastDay.getDate() + DateUtils.getDayOfWeek(firstDay, weekStartsOn)) / 7);

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
          events: this.getEventsForDate(dayDate)
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

    for (let i = 0; i < 7; i++) {
      const dayDate = new Date(currentDate);
      days.push({
        date: dayDate,
        dayOfMonth: dayDate.getDate(),
        dayOfWeek: dayDate.getDay(),
        dayName: DateUtils.getDayName(dayDate, this.state.get('locale')),
        isToday: DateUtils.isToday(dayDate),
        isWeekend: dayDate.getDay() === 0 || dayDate.getDay() === 6,
        events: this.getEventsForDate(dayDate),
        // Add overlap groups for positioning overlapping events
        overlapGroups: this.eventStore.getOverlapGroups(dayDate, true),
        getEventPositions: (events) => this.eventStore.calculateEventPositions(events)
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
    const events = this.getEventsForDate(date);

    // Separate all-day and timed events
    const allDayEvents = events.filter(e => e.allDay);
    const timedEvents = events.filter(e => !e.allDay);

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
        events: timedEvents.filter(event => {
          // Check if event occurs during this hour (not just starts)
          // Event occurs in this hour if it overlaps with the hour slot
          return event.start < hourEnd && event.end > hourDate;
        })
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
   * @param {string} eventId - Event ID to select
   */
  selectEvent(eventId) {
    const event = this.getEvent(eventId);
    if (event) {
      this.state.selectEvent(eventId);
      this._emit('eventSelect', { event });
    }
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
    this.eventStore.subscribe((change) => {
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
    // Clear all listeners
    this.listeners.clear();

    // Clear stores
    this.eventStore.clear();

    // Clear plugins
    this.plugins.forEach(plugin => {
      if (typeof plugin.uninstall === 'function') {
        plugin.uninstall(this);
      }
    });
    this.plugins.clear();

    this._emit('destroy');
  }
}// Test workflow
