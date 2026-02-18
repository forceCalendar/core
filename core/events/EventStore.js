import { Event } from './Event.js';
import { DateUtils } from '../calendar/DateUtils.js';
import { RecurrenceEngine } from './RecurrenceEngine.js';
import { PerformanceOptimizer } from '../performance/PerformanceOptimizer.js';
import { ConflictDetector } from '../conflicts/ConflictDetector.js';
import { TimezoneManager } from '../timezone/TimezoneManager.js';

/**
 * EventStore - Manages calendar events with efficient querying
 * Uses Map for O(1) lookups and spatial indexing concepts for date queries
 * Now with performance optimizations for large datasets
 */
export class EventStore {
  constructor(config = {}) {
    // Primary storage - Map for O(1) ID lookups
    /** @type {Map<string, Event>} */
    this.events = new Map();

    // Indices for efficient queries (using UTC for consistent indexing)
    this.indices = {
      /** @type {Map<string, Set<string>>} UTC Date string -> Set of event IDs */
      byDate: new Map(),
      /** @type {Map<string, Set<string>>} YYYY-MM (UTC) -> Set of event IDs */
      byMonth: new Map(),
      /** @type {Set<string>} Set of recurring event IDs */
      recurring: new Set(),
      /** @type {Map<string, Set<string>>} Category -> Set of event IDs */
      byCategory: new Map(),
      /** @type {Map<string, Set<string>>} Status -> Set of event IDs */
      byStatus: new Map()
    };

    // Timezone manager for conversions (use singleton to share cache)
    this.timezoneManager = TimezoneManager.getInstance();

    // Default timezone for the store (can be overridden)
    this.defaultTimezone = config.timezone || this.timezoneManager.getSystemTimezone();

    // Performance optimizer
    this.optimizer = new PerformanceOptimizer(config.performance);

    // Conflict detector
    this.conflictDetector = new ConflictDetector(this);

    // Batch operation state
    this.isBatchMode = false;
    this.batchNotifications = [];
    this.batchBackup = null; // For rollback support
    this._batchLock = null; // Lock to prevent concurrent batch operations
    this._batchLockResolve = null; // Resolver for the batch lock

    // Change tracking
    /** @type {number} */
    this.version = 0;
    /** @type {Set<import('../../types.js').EventListener>} */
    this.listeners = new Set();
  }

  /**
   * Add an event to the store
   * @param {Event|import('../../types.js').EventData} event - The event to add
   * @returns {Event} The added event
   * @throws {Error} If event with same ID already exists
   */
  addEvent(event) {
    return this.optimizer.measure('addEvent', () => {
      if (!(event instanceof Event)) {
        event = new Event(event);
      }

      if (this.events.has(event.id)) {
        throw new Error(`Event with id ${event.id} already exists`);
      }

      // Store the event
      this.events.set(event.id, event);

      // Cache the event
      this.optimizer.cache(event.id, event, 'event');

      // Update indices
      this._indexEvent(event);

      // Notify listeners (batch if in batch mode)
      if (this.isBatchMode) {
        this.batchNotifications.push({
          type: 'add',
          event,
          version: ++this.version
        });
      } else {
        this._notifyChange({
          type: 'add',
          event,
          version: ++this.version
        });
      }

      return event;
    });
  }

  /**
   * Update an existing event
   * @param {string} eventId - The event ID
   * @param {Partial<import('../../types.js').EventData>} updates - Properties to update
   * @returns {Event} The updated event
   * @throws {Error} If event not found
   */
  updateEvent(eventId, updates) {
    const existingEvent = this.events.get(eventId);
    if (!existingEvent) {
      throw new Error(`Event with id ${eventId} not found`);
    }

    // Remove old indices
    this._unindexEvent(existingEvent);

    // Create updated event
    const updatedEvent = existingEvent.clone(updates);

    // Store updated event
    this.events.set(eventId, updatedEvent);

    // Re-index
    this._indexEvent(updatedEvent);

    // Notify listeners
    this._notifyChange({
      type: 'update',
      event: updatedEvent,
      oldEvent: existingEvent,
      version: ++this.version
    });

    return updatedEvent;
  }

  /**
   * Remove an event from the store
   * @param {string} eventId - The event ID to remove
   * @returns {boolean} True if removed, false if not found
   */
  removeEvent(eventId) {
    const event = this.events.get(eventId);
    if (!event) {
      return false;
    }

    // Remove from primary storage
    this.events.delete(eventId);

    // Remove from indices
    this._unindexEvent(event);

    // Notify listeners
    this._notifyChange({
      type: 'remove',
      event,
      version: ++this.version
    });

    return true;
  }

  /**
   * Get an event by ID
   * @param {string} eventId - The event ID
   * @returns {Event|null} The event or null if not found
   */
  getEvent(eventId) {
    // Check cache first
    const cached = this.optimizer.getFromCache(eventId, 'event');
    if (cached) {
      return cached;
    }

    // Get from store
    const event = this.events.get(eventId) || null;

    // Cache if found
    if (event) {
      this.optimizer.cache(eventId, event, 'event');
    }

    return event;
  }

  /**
   * Get all events
   * @returns {Event[]} Array of all events
   */
  getAllEvents() {
    return Array.from(this.events.values());
  }

  /**
   * Query events with filters
   * @param {import('../../types.js').QueryFilters} [filters={}] - Query filters
   * @returns {Event[]} Filtered events
   */
  queryEvents(filters = {}) {
    let results = Array.from(this.events.values());

    // Filter by date range
    if (filters.start || filters.end) {
      const start = filters.start ? new Date(filters.start) : null;
      const end = filters.end ? new Date(filters.end) : null;

      results = results.filter(event => {
        if (start && event.end < start) return false;
        if (end && event.start > end) return false;
        return true;
      });
    }

    // Filter by specific date
    if (filters.date) {
      const date = new Date(filters.date);
      results = results.filter(event => event.occursOn(date));
    }

    // Filter by month
    if (filters.month && filters.year) {
      const monthKey = `${filters.year}-${String(filters.month).padStart(2, '0')}`;
      const eventIds = this.indices.byMonth.get(monthKey) || new Set();
      results = results.filter(event => eventIds.has(event.id));
    }

    // Filter by all-day events
    if (Object.prototype.hasOwnProperty.call(filters, 'allDay')) {
      results = results.filter(event => event.allDay === filters.allDay);
    }

    // Filter by recurring
    if (Object.prototype.hasOwnProperty.call(filters, 'recurring')) {
      results = results.filter(event => event.recurring === filters.recurring);
    }

    // Filter by status
    if (filters.status) {
      results = results.filter(event => event.status === filters.status);
    }

    // Filter by categories
    if (filters.categories && filters.categories.length > 0) {
      results = results.filter(event =>
        filters.matchAllCategories
          ? event.hasAllCategories(filters.categories)
          : event.hasAnyCategory(filters.categories)
      );
    }

    // Filter by having attendees
    if (Object.prototype.hasOwnProperty.call(filters, 'hasAttendees')) {
      results = results.filter(event =>
        filters.hasAttendees ? event.hasAttendees : !event.hasAttendees
      );
    }

    // Filter by organizer email
    if (filters.organizerEmail) {
      results = results.filter(
        event => event.organizer && event.organizer.email === filters.organizerEmail
      );
    }

    // Sort results
    if (filters.sort) {
      results.sort((a, b) => {
        switch (filters.sort) {
          case 'start':
            return a.start - b.start;
          case 'end':
            return a.end - b.end;
          case 'duration':
            return a.duration - b.duration;
          case 'title':
            return a.title.localeCompare(b.title);
          default:
            return 0;
        }
      });
    }

    return results;
  }

  /**
   * Get events for a specific date
   * @param {Date} date - The date to query
   * @param {string} [timezone] - Timezone for the query (defaults to store timezone)
   * @returns {Event[]} Events occurring on the date, sorted by start time
   */
  getEventsForDate(date, timezone = null) {
    timezone = timezone || this.defaultTimezone;

    // Use local date string for the query date (in the calendar's timezone)
    const dateStr = DateUtils.getLocalDateString(date);

    // Collect candidate event IDs from indices
    const candidateIds = new Set();

    // Check byDate index for nearby dates (handles most events)
    const checkDate = new Date(date);
    for (let offset = -1; offset <= 1; offset++) {
      const tempDate = new Date(checkDate);
      tempDate.setDate(tempDate.getDate() + offset);
      const tempDateStr = DateUtils.getLocalDateString(tempDate);
      const eventIds = this.indices.byDate.get(tempDateStr);
      if (eventIds) {
        eventIds.forEach(id => candidateIds.add(id));
      }
    }

    // Also check byMonth index to catch long-running events that might not be
    // indexed in byDate for this specific date (lazy indexing only indexes
    // first/last week of multi-week events)
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const monthEventIds = this.indices.byMonth.get(monthKey);
    if (monthEventIds) {
      monthEventIds.forEach(id => candidateIds.add(id));
    }

    // Filter candidates to events that actually overlap with the requested date
    const allEvents = [];
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    for (const id of candidateIds) {
      const event = this.events.get(id);
      if (event) {
        // Check if event actually occurs on the requested date in the given timezone
        const eventStartLocal = event.getStartInTimezone(timezone);
        const eventEndLocal = event.getEndInTimezone(timezone);

        // Event overlaps with this day if it starts before end of day and ends after start of day
        if (eventStartLocal <= endOfDay && eventEndLocal >= startOfDay) {
          allEvents.push(event);
        }
      }
    }

    return allEvents.sort((a, b) => {
      // Sort by start time in the specified timezone
      const aStart = a.getStartInTimezone(timezone);
      const bStart = b.getStartInTimezone(timezone);
      const timeCompare = aStart - bStart;
      if (timeCompare !== 0) return timeCompare;
      return b.duration - a.duration; // Longer events first
    });
  }

  /**
   * Get events that overlap with a given time range
   * @param {Date} start - Start time
   * @param {Date} end - End time
   * @param {string} [excludeId=null] - Optional event ID to exclude (useful when checking for conflicts)
   * @returns {Event[]} Array of overlapping events
   */
  getOverlappingEvents(start, end, excludeId = null) {
    const overlapping = [];

    // Get all events in the date range
    const startDate = DateUtils.startOfDay(start);
    const endDate = DateUtils.endOfDay(end);
    const dates = DateUtils.getDateRange(startDate, endDate);

    // Collect all events from those dates
    const checkedIds = new Set();
    dates.forEach(date => {
      // Use getLocalDateString to match the index key format (YYYY-MM-DD)
      const dateStr = DateUtils.getLocalDateString(date);
      const eventIds = this.indices.byDate.get(dateStr) || new Set();

      eventIds.forEach(id => {
        if (!checkedIds.has(id) && id !== excludeId) {
          checkedIds.add(id);
          const event = this.events.get(id);

          if (event && event.overlaps({ start, end })) {
            overlapping.push(event);
          }
        }
      });
    });

    return overlapping.sort((a, b) => a.start - b.start);
  }

  /**
   * Check if an event would conflict with existing events
   * @param {Date} start - Start time
   * @param {Date} end - End time
   * @param {string} excludeId - Optional event ID to exclude
   * @returns {boolean} True if there are conflicts
   */
  hasConflicts(start, end, excludeId = null) {
    return this.getOverlappingEvents(start, end, excludeId).length > 0;
  }

  /**
   * Get events grouped by overlapping time slots
   * Useful for calculating event positions in week/day views
   * @param {Date} date - The date to analyze
   * @param {boolean} timedOnly - Only include timed events (not all-day)
   * @returns {Array<Event[]>} Array of event groups that overlap
   */
  getOverlapGroups(date, timedOnly = true) {
    let events = this.getEventsForDate(date);

    if (timedOnly) {
      events = events.filter(e => !e.allDay);
    }

    const groups = [];
    const processed = new Set();

    events.forEach(event => {
      if (processed.has(event.id)) return;

      // Start a new group with this event
      const group = [event];
      processed.add(event.id);

      // Find all events that overlap with any event in this group
      let i = 0;
      while (i < group.length) {
        const currentEvent = group[i];

        events.forEach(otherEvent => {
          if (!processed.has(otherEvent.id) && currentEvent.overlaps(otherEvent)) {
            group.push(otherEvent);
            processed.add(otherEvent.id);
          }
        });

        i++;
      }

      groups.push(group);
    });

    return groups;
  }

  /**
   * Calculate positions for overlapping events (for rendering)
   * @param {Event[]} events - Array of overlapping events
   * @returns {Map<string, {column: number, totalColumns: number}>} Position data for each event
   */
  calculateEventPositions(events) {
    const positions = new Map();

    if (events.length === 0) return positions;

    // Sort by start time, then by duration (longer events first)
    events.sort((a, b) => {
      const startDiff = a.start - b.start;
      if (startDiff !== 0) return startDiff;
      return b.end - b.start - (a.end - a.start);
    });

    // Track which columns are occupied at each time
    const columns = [];

    events.forEach(event => {
      // Find the first available column
      let column = 0;
      while (column < columns.length) {
        const columnEvents = columns[column];
        const hasConflict = columnEvents.some(e => e.overlaps(event));

        if (!hasConflict) {
          break;
        }
        column++;
      }

      // Add event to the column
      if (!columns[column]) {
        columns[column] = [];
      }
      columns[column].push(event);

      positions.set(event.id, {
        column: column,
        totalColumns: 0 // Will be updated after all events are placed
      });
    });

    // Update total columns for all events
    const totalColumns = columns.length;
    positions.forEach(pos => {
      pos.totalColumns = totalColumns;
    });

    return positions;
  }

  /**
   * Get events for a date range
   * @param {Date} start - Start date
   * @param {Date} end - End date
   * @param {boolean|Object} [expandRecurringOrOptions=true] - Boolean to expand recurring events,
   *   or options object: { expandRecurring?: boolean, timezone?: string }
   * @param {string} [timezone] - Timezone for the query
   * @returns {Event[]}
   */
  getEventsInRange(start, end, expandRecurringOrOptions = true, timezone = null) {
    let expandRecurring = true;

    if (typeof expandRecurringOrOptions === 'object' && expandRecurringOrOptions !== null) {
      // Options object form: getEventsInRange(start, end, { expandRecurring, timezone })
      expandRecurring = expandRecurringOrOptions.expandRecurring !== false;
      timezone = expandRecurringOrOptions.timezone || timezone;
    } else if (typeof expandRecurringOrOptions === 'string') {
      // Legacy overloaded form: string was treated as timezone (deprecated)
      timezone = expandRecurringOrOptions;
      expandRecurring = true;
    } else {
      expandRecurring = expandRecurringOrOptions;
    }

    timezone = timezone || this.defaultTimezone;

    // Convert range to UTC for querying
    const startUTC = this.timezoneManager.toUTC(start, timezone);
    const endUTC = this.timezoneManager.toUTC(end, timezone);

    // Query using UTC times
    const baseEvents = this.queryEvents({
      start: startUTC,
      end: endUTC,
      sort: 'start'
    });

    if (!expandRecurring) {
      return baseEvents;
    }

    // Expand recurring events
    const expandedEvents = [];
    baseEvents.forEach(event => {
      if (event.recurring && event.recurrenceRule) {
        const occurrences = this.expandRecurringEvent(event, start, end, timezone);
        expandedEvents.push(...occurrences);
      } else {
        expandedEvents.push(event);
      }
    });

    return expandedEvents.sort((a, b) => {
      // Sort by start time in the specified timezone
      const aStart = a.getStartInTimezone(timezone);
      const bStart = b.getStartInTimezone(timezone);
      return aStart - bStart;
    });
  }

  /**
   * Expand a recurring event into individual occurrences
   * @param {Event} event - The recurring event
   * @param {Date} rangeStart - Start of the expansion range
   * @param {Date} rangeEnd - End of the expansion range
   * @param {string} [timezone] - Timezone for the expansion
   * @returns {Event[]} Array of event occurrences
   */
  expandRecurringEvent(event, rangeStart, rangeEnd, timezone = null) {
    if (!event.recurring || !event.recurrenceRule) {
      return [event];
    }

    timezone = timezone || this.defaultTimezone;

    // Expand in the event's timezone for accurate recurrence calculation
    const eventTimezone = event.timeZone || timezone;
    const occurrences = RecurrenceEngine.expandEvent(event, rangeStart, rangeEnd);

    return occurrences.map((occurrence, index) => {
      // Create a new event instance for each occurrence
      const occurrenceEvent = event.clone({
        id: `${event.id}_occurrence_${index}`,
        start: occurrence.start,
        end: occurrence.end,
        timeZone: eventTimezone,
        metadata: {
          ...event.metadata,
          recurringEventId: event.id,
          occurrenceIndex: index
        }
      });

      return occurrenceEvent;
    });
  }

  /**
   * Clear all events
   */
  clear() {
    const oldEvents = this.getAllEvents();

    this.events.clear();
    this.indices.byDate.clear();
    this.indices.byMonth.clear();
    this.indices.recurring.clear();

    this._notifyChange({
      type: 'clear',
      oldEvents,
      version: ++this.version
    });
  }

  /**
   * Bulk load events
   * @param {Event[]} events - Array of events or event data
   */
  loadEvents(events) {
    this.clear();

    for (const eventData of events) {
      this.addEvent(eventData);
    }
  }

  /**
   * Subscribe to store changes
   * @param {Function} callback - Callback function
   * @returns {Function} Unsubscribe function
   */
  subscribe(callback) {
    this.listeners.add(callback);

    return () => {
      this.listeners.delete(callback);
    };
  }

  /**
   * Index an event for efficient queries
   * @private
   */
  _indexEvent(event) {
    // Check if should use lazy indexing for large date ranges
    if (this.optimizer.shouldUseLazyIndexing(event)) {
      this._indexEventLazy(event);
      return;
    }

    // Index by local dates in the event's timezone
    // This ensures events appear on the correct calendar day
    const eventStartLocal = event.getStartInTimezone(event.timeZone);
    const eventEndLocal = event.getEndInTimezone(event.endTimeZone || event.timeZone);

    const startDate = DateUtils.startOfDay(eventStartLocal);
    const endDate = DateUtils.endOfDay(eventEndLocal);

    // For each day the event spans (in local time), add to date index
    const dates = DateUtils.getDateRange(startDate, endDate);

    dates.forEach(date => {
      const dateStr = DateUtils.getLocalDateString(date);

      if (!this.indices.byDate.has(dateStr)) {
        this.indices.byDate.set(dateStr, new Set());
      }
      this.indices.byDate.get(dateStr).add(event.id);
    });

    // Index by month(s) using UTC
    const startMonth = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}`;
    const endMonth = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}`;

    // Add to all months the event spans
    const currentMonth = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    while (currentMonth <= endDate) {
      const monthKey = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}`;

      if (!this.indices.byMonth.has(monthKey)) {
        this.indices.byMonth.set(monthKey, new Set());
      }
      this.indices.byMonth.get(monthKey).add(event.id);

      currentMonth.setMonth(currentMonth.getMonth() + 1);
    }

    // Index by categories
    if (event.categories && event.categories.length > 0) {
      event.categories.forEach(category => {
        if (!this.indices.byCategory.has(category)) {
          this.indices.byCategory.set(category, new Set());
        }
        this.indices.byCategory.get(category).add(event.id);
      });
    }

    // Index by status
    if (event.status) {
      if (!this.indices.byStatus.has(event.status)) {
        this.indices.byStatus.set(event.status, new Set());
      }
      this.indices.byStatus.get(event.status).add(event.id);
    }

    // Index recurring events
    if (event.recurring) {
      this.indices.recurring.add(event.id);
    }
  }

  /**
   * Lazy index for events with large date ranges
   * @private
   */
  _indexEventLazy(event) {
    // Create lazy index markers
    const markers = this.optimizer.createLazyIndexMarkers(event);

    // Index only the boundaries initially (in event's local timezone)
    const eventStartLocal = event.getStartInTimezone(event.timeZone);
    const eventEndLocal = event.getEndInTimezone(event.endTimeZone || event.timeZone);

    const startDate = DateUtils.startOfDay(eventStartLocal);
    const endDate = DateUtils.endOfDay(eventEndLocal);

    // Index first week
    const firstWeekEnd = new Date(startDate);
    firstWeekEnd.setDate(firstWeekEnd.getDate() + 7);
    const firstWeekDates = DateUtils.getDateRange(
      startDate,
      firstWeekEnd < endDate ? firstWeekEnd : endDate
    );

    firstWeekDates.forEach(date => {
      const dateStr = DateUtils.getLocalDateString(date);
      if (!this.indices.byDate.has(dateStr)) {
        this.indices.byDate.set(dateStr, new Set());
      }
      this.indices.byDate.get(dateStr).add(event.id);
    });

    // Index last week if different from first
    if (endDate > firstWeekEnd) {
      const lastWeekStart = new Date(endDate);
      lastWeekStart.setDate(lastWeekStart.getDate() - 7);
      const lastWeekDates = DateUtils.getDateRange(
        lastWeekStart > startDate ? lastWeekStart : startDate,
        endDate
      );

      lastWeekDates.forEach(date => {
        const dateStr = DateUtils.getLocalDateString(date);
        if (!this.indices.byDate.has(dateStr)) {
          this.indices.byDate.set(dateStr, new Set());
        }
        this.indices.byDate.get(dateStr).add(event.id);
      });
    }

    // Index months as normal
    const currentMonth = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    while (currentMonth <= endDate) {
      const monthKey = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}`;
      if (!this.indices.byMonth.has(monthKey)) {
        this.indices.byMonth.set(monthKey, new Set());
      }
      this.indices.byMonth.get(monthKey).add(event.id);
      currentMonth.setMonth(currentMonth.getMonth() + 1);
    }

    // Index other properties normally
    if (event.categories && event.categories.length > 0) {
      event.categories.forEach(category => {
        if (!this.indices.byCategory.has(category)) {
          this.indices.byCategory.set(category, new Set());
        }
        this.indices.byCategory.get(category).add(event.id);
      });
    }

    if (event.status) {
      if (!this.indices.byStatus.has(event.status)) {
        this.indices.byStatus.set(event.status, new Set());
      }
      this.indices.byStatus.get(event.status).add(event.id);
    }

    if (event.recurring) {
      this.indices.recurring.add(event.id);
    }
  }

  /**
   * Remove event from indices
   * @private
   */
  _unindexEvent(event) {
    // Remove from date indices
    for (const [dateStr, eventIds] of this.indices.byDate) {
      eventIds.delete(event.id);
      if (eventIds.size === 0) {
        this.indices.byDate.delete(dateStr);
      }
    }

    // Remove from month indices
    for (const [monthKey, eventIds] of this.indices.byMonth) {
      eventIds.delete(event.id);
      if (eventIds.size === 0) {
        this.indices.byMonth.delete(monthKey);
      }
    }

    // Remove from category indices
    for (const [category, eventIds] of this.indices.byCategory) {
      eventIds.delete(event.id);
      if (eventIds.size === 0) {
        this.indices.byCategory.delete(category);
      }
    }

    // Remove from status indices
    for (const [status, eventIds] of this.indices.byStatus) {
      eventIds.delete(event.id);
      if (eventIds.size === 0) {
        this.indices.byStatus.delete(status);
      }
    }

    // Remove from recurring index
    this.indices.recurring.delete(event.id);
  }

  /**
   * Notify listeners of changes
   * @private
   */
  _notifyChange(change) {
    for (const listener of this.listeners) {
      try {
        listener(change);
      } catch (error) {
        console.error('Error in EventStore listener:', error);
      }
    }
  }

  /**
   * Get store statistics
   * @returns {Object}
   */
  getStats() {
    return {
      totalEvents: this.events.size,
      recurringEvents: this.indices.recurring.size,
      indexedDates: this.indices.byDate.size,
      indexedMonths: this.indices.byMonth.size,
      indexedCategories: this.indices.byCategory.size,
      indexedStatuses: this.indices.byStatus.size,
      version: this.version,
      performanceMetrics: this.optimizer.getMetrics()
    };
  }

  // ============ Batch Operations ============

  /**
   * Start batch mode for bulk operations
   * Delays notifications until batch is committed
   * @param {boolean} [enableRollback=false] - Enable rollback support (creates backup)
   */
  startBatch(enableRollback = false) {
    this.isBatchMode = true;
    this.batchNotifications = [];

    // Create backup for rollback if requested
    if (enableRollback) {
      this.batchBackup = {
        events: new Map(this.events),
        indices: {
          byDate: new Map(
            Array.from(this.indices.byDate.entries()).map(([k, v]) => [k, new Set(v)])
          ),
          byMonth: new Map(
            Array.from(this.indices.byMonth.entries()).map(([k, v]) => [k, new Set(v)])
          ),
          recurring: new Set(this.indices.recurring),
          byCategory: new Map(
            Array.from(this.indices.byCategory.entries()).map(([k, v]) => [k, new Set(v)])
          ),
          byStatus: new Map(
            Array.from(this.indices.byStatus.entries()).map(([k, v]) => [k, new Set(v)])
          )
        },
        version: this.version
      };
    }
  }

  /**
   * Commit batch operations
   * Sends all notifications at once
   */
  commitBatch() {
    if (!this.isBatchMode) return;

    this.isBatchMode = false;

    // Clear backup after successful commit
    this.batchBackup = null;

    // Send a single bulk notification
    if (this.batchNotifications.length > 0) {
      this._notifyChange({
        type: 'batch',
        changes: this.batchNotifications,
        count: this.batchNotifications.length,
        version: ++this.version
      });
    }

    this.batchNotifications = [];
  }

  /**
   * Rollback batch operations
   * Restores state to before batch started
   */
  rollbackBatch() {
    if (!this.isBatchMode) return;

    this.isBatchMode = false;

    // Restore backup if available
    if (this.batchBackup) {
      this.events = this.batchBackup.events;
      this.indices = this.batchBackup.indices;
      this.version = this.batchBackup.version;
      this.batchBackup = null;

      // Clear cache
      this.optimizer.clearCache();
    }

    this.batchNotifications = [];
  }

  /**
   * Execute batch operation with automatic rollback on error
   * Uses a lock to prevent concurrent batch operations from corrupting state
   * @param {Function} operation - Operation to execute
   * @param {boolean} [enableRollback=true] - Enable automatic rollback on error
   * @returns {*} Result of operation
   * @throws {Error} If operation fails
   */
  async executeBatch(operation, enableRollback = true) {
    // Wait for any existing batch operation to complete
    while (this._batchLock) {
      await this._batchLock;
    }

    // Acquire the lock
    this._batchLock = new Promise(resolve => {
      this._batchLockResolve = resolve;
    });

    try {
      this.startBatch(enableRollback);

      try {
        const result = await operation();
        this.commitBatch();
        return result;
      } catch (error) {
        if (enableRollback) {
          this.rollbackBatch();
        }
        throw error;
      }
    } finally {
      // Release the lock
      const resolve = this._batchLockResolve;
      this._batchLock = null;
      this._batchLockResolve = null;
      if (resolve) {
        resolve();
      }
    }
  }

  /**
   * Add multiple events in batch
   * @param {Array<Event|import('../../types.js').EventData>} events - Events to add
   * @returns {Event[]} Added events
   */
  addEvents(events) {
    return this.optimizer.measure('addEvents', () => {
      this.startBatch();
      const results = [];
      const errors = [];

      for (const eventData of events) {
        try {
          results.push(this.addEvent(eventData));
        } catch (error) {
          errors.push({ event: eventData, error: error.message });
        }
      }

      this.commitBatch();

      if (errors.length > 0) {
        console.warn(`Failed to add ${errors.length} events:`, errors);
      }

      return results;
    });
  }

  /**
   * Update multiple events in batch
   * @param {Array<{id: string, updates: Object}>} updates - Update operations
   * @returns {Event[]} Updated events
   */
  updateEvents(updates) {
    return this.optimizer.measure('updateEvents', () => {
      this.startBatch();
      const results = [];
      const errors = [];

      for (const { id, updates: eventUpdates } of updates) {
        try {
          results.push(this.updateEvent(id, eventUpdates));
        } catch (error) {
          errors.push({ id, error: error.message });
        }
      }

      this.commitBatch();

      if (errors.length > 0) {
        console.warn(`Failed to update ${errors.length} events:`, errors);
      }

      return results;
    });
  }

  /**
   * Remove multiple events in batch
   * @param {string[]} eventIds - Event IDs to remove
   * @returns {number} Number of events removed
   */
  removeEvents(eventIds) {
    return this.optimizer.measure('removeEvents', () => {
      this.startBatch();
      let removed = 0;

      for (const id of eventIds) {
        if (this.removeEvent(id)) {
          removed++;
        }
      }

      this.commitBatch();
      return removed;
    });
  }

  // ============ Performance Methods ============

  /**
   * Get performance metrics
   * @returns {Object} Performance metrics
   */
  getPerformanceMetrics() {
    return this.optimizer.getMetrics();
  }

  /**
   * Clear all caches
   */
  clearCaches() {
    this.optimizer.eventCache.clear();
    this.optimizer.queryCache.clear();
    this.optimizer.dateRangeCache.clear();
  }

  /**
   * Optimize indices by removing old or irrelevant entries
   * @param {Date} [cutoffDate] - Remove indices older than this date
   */
  optimizeIndices(cutoffDate) {
    if (!cutoffDate) {
      cutoffDate = new Date();
      cutoffDate.setMonth(cutoffDate.getMonth() - 6); // Default: 6 months ago
    }

    const cutoffStr = cutoffDate.toDateString();
    let removed = 0;

    // Clean up date indices
    for (const [dateStr, eventIds] of this.indices.byDate) {
      const date = new Date(dateStr);
      if (date < cutoffDate) {
        // Check if any events still need this index
        let stillNeeded = false;
        for (const eventId of eventIds) {
          const event = this.events.get(eventId);
          if (event && event.end >= cutoffDate) {
            stillNeeded = true;
            break;
          }
        }

        if (!stillNeeded) {
          this.indices.byDate.delete(dateStr);
          removed++;
        }
      }
    }

    console.log(`Optimized indices: removed ${removed} old date entries`);
    return removed;
  }

  /**
   * Destroy the store and clean up resources
   */
  destroy() {
    this.clear();
    this.optimizer.destroy();
    this.listeners.clear();
  }

  // ============ Conflict Detection Methods ============

  /**
   * Check for conflicts for an event
   * @param {Event|import('../../types.js').EventData} event - Event to check
   * @param {import('../../types.js').ConflictCheckOptions} [options={}] - Check options
   * @returns {import('../../types.js').ConflictSummary} Conflict summary
   */
  checkConflicts(event, options = {}) {
    return this.conflictDetector.checkConflicts(event, options);
  }

  /**
   * Check conflicts between two events
   * @param {string} eventId1 - First event ID
   * @param {string} eventId2 - Second event ID
   * @param {import('../../types.js').ConflictCheckOptions} [options={}] - Check options
   * @returns {import('../../types.js').ConflictDetails[]} Conflicts between events
   */
  checkEventPairConflicts(eventId1, eventId2, options = {}) {
    const event1 = this.getEvent(eventId1);
    const event2 = this.getEvent(eventId2);

    if (!event1 || !event2) {
      throw new Error('One or both events not found');
    }

    return this.conflictDetector.checkEventPairConflicts(event1, event2, options);
  }

  /**
   * Get all conflicts in a date range
   * @param {Date} start - Start date
   * @param {Date} end - End date
   * @param {import('../../types.js').ConflictCheckOptions} [options={}] - Check options
   * @returns {import('../../types.js').ConflictSummary} All conflicts in range
   */
  getAllConflicts(start, end, options = {}) {
    const events = this.getEventsInRange(start, end, false);
    const allConflicts = [];
    const checkedPairs = new Set();

    for (let i = 0; i < events.length; i++) {
      for (let j = i + 1; j < events.length; j++) {
        const pairKey = `${events[i].id}-${events[j].id}`;
        if (!checkedPairs.has(pairKey)) {
          checkedPairs.add(pairKey);
          const conflicts = this.conflictDetector.checkEventPairConflicts(
            events[i],
            events[j],
            options
          );
          allConflicts.push(...conflicts);
        }
      }
    }

    return this.conflictDetector._buildConflictSummary(
      allConflicts,
      new Set(events.map(e => e.id)),
      new Set()
    );
  }

  /**
   * Get busy periods for attendees
   * @param {string[]} attendeeEmails - Attendee emails
   * @param {Date} start - Start date
   * @param {Date} end - End date
   * @param {Object} [options={}] - Options
   * @returns {Array<{start: Date, end: Date, eventIds: string[]}>} Busy periods
   */
  getBusyPeriods(attendeeEmails, start, end, options = {}) {
    return this.conflictDetector.getBusyPeriods(attendeeEmails, start, end, options);
  }

  /**
   * Get free periods for scheduling
   * @param {Date} start - Start date
   * @param {Date} end - End date
   * @param {number} durationMinutes - Required duration in minutes
   * @param {Object} [options={}] - Options
   * @returns {Array<{start: Date, end: Date}>} Free periods
   */
  getFreePeriods(start, end, durationMinutes, options = {}) {
    return this.conflictDetector.getFreePeriods(start, end, durationMinutes, options);
  }

  /**
   * Add event with conflict checking
   * @param {Event|import('../../types.js').EventData} event - Event to add
   * @param {boolean} [allowConflicts=true] - Whether to allow adding with conflicts
   * @returns {{event: Event, conflicts: import('../../types.js').ConflictSummary}} Result
   */
  addEventWithConflictCheck(event, allowConflicts = true) {
    // Check conflicts before adding
    const conflicts = this.checkConflicts(event);

    if (!allowConflicts && conflicts.hasConflicts) {
      throw new Error(`Cannot add event: ${conflicts.totalConflicts} conflicts detected`);
    }

    // Add the event
    const addedEvent = this.addEvent(event);

    return {
      event: addedEvent,
      conflicts
    };
  }

  /**
   * Find events with conflicts
   * @param {Object} [options={}] - Options
   * @returns {Array<{event: Event, conflicts: import('../../types.js').ConflictDetails[]}>} Events with conflicts
   */
  findEventsWithConflicts(options = {}) {
    const eventsWithConflicts = [];
    const allEvents = this.getAllEvents();

    for (const event of allEvents) {
      const conflicts = this.checkConflicts(event, options);
      if (conflicts.hasConflicts) {
        eventsWithConflicts.push({
          event,
          conflicts: conflicts.conflicts
        });
      }
    }

    return eventsWithConflicts;
  }
}
