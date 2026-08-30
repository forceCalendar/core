import { Event } from './Event.js';
import { DateUtils } from '../calendar/DateUtils.js';
import { RecurrenceEngineV2 } from './RecurrenceEngineV2.js';
import { PerformanceOptimizer } from '../performance/PerformanceOptimizer.js';
import { ConflictDetector } from '../conflicts/ConflictDetector.js';
import { TimezoneManager } from '../timezone/TimezoneManager.js';

// Events are indexed and expanded on their own wall clock, which can differ
// from the query timezone's by up to 26 hours (UTC-12 to UTC+14). Day
// queries therefore look this many days beyond each edge before filtering
// precisely in the query timezone.
const TIMEZONE_PAD_DAYS = 2;

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
    this.eventIndexRefs = new Map();

    // Timezone manager for conversions (use singleton to share cache)
    this.timezoneManager = TimezoneManager.getInstance();

    // Default timezone for the store (can be overridden)
    this.defaultTimezone = config.timezone || this.timezoneManager.getSystemTimezone();

    // Performance optimizer
    this.optimizer = new PerformanceOptimizer(config.performance);

    // Recurrence expansion engine
    this.recurrenceEngine = config.recurrenceEngine || new RecurrenceEngineV2();

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
    /** @type {Set<import('../types.js').EventListener>} */
    this.listeners = new Set();
  }

  /**
   * Add an event to the store
   * @param {Event|import('../types.js').EventData} event - The event to add
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
      this._queueChange({
        type: 'add',
        event,
        version: ++this.version
      });

      return event;
    });
  }

  /**
   * Update an existing event
   *
   * An occurrence id (see {@link Event.occurrenceId}) updates the recurring
   * master the occurrence belongs to, i.e. the whole series.
   * @param {string} eventId - Event id or occurrence id
   * @param {Partial<import('../types.js').EventData>} updates - Properties to update
   * @returns {Event} The updated event (the master for an occurrence id)
   * @throws {Error} If event not found
   */
  updateEvent(eventId, updates) {
    const existingEvent = this.events.get(eventId) || this._resolveOccurrenceMaster(eventId);
    if (!existingEvent) {
      throw new Error(`Event with id ${eventId} not found`);
    }

    // Create updated event
    const updatedEvent = existingEvent.clone(updates);

    this._replaceEvent(existingEvent, updatedEvent);

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
   * Swap a stored event for a new instance with the same id, keeping
   * indices and caches in sync. Does not notify listeners.
   * @param {Event} existingEvent - Event currently in the store
   * @param {Event} replacement - Event instance that takes its place
   * @private
   */
  _replaceEvent(existingEvent, replacement) {
    // Remove old indices
    this._unindexEvent(existingEvent);

    // Store replacement
    this.events.set(replacement.id, replacement);

    // Update cache with new event data
    this.optimizer.cache(replacement.id, replacement, 'event');

    // Clear query and date range caches since results may have changed
    this.optimizer.queryCache.clear();
    this.optimizer.dateRangeCache.clear();
    this._invalidateOccurrenceCache(replacement.id);

    // Re-index
    this._indexEvent(replacement);
  }

  /**
   * Remove an event from the store
   *
   * An occurrence id (see {@link Event.occurrenceId}) removes the recurring
   * master the occurrence belongs to, i.e. the whole series.
   * @param {string} eventId - Event id or occurrence id
   * @returns {boolean} True if removed, false if not found
   */
  removeEvent(eventId) {
    const event = this.events.get(eventId) || this._resolveOccurrenceMaster(eventId);
    if (!event) {
      return false;
    }

    this._detachEvent(event);

    // Notify listeners
    this._notifyChange({
      type: 'remove',
      event,
      version: ++this.version
    });

    return true;
  }

  /**
   * Remove an event from storage, caches and indices. Does not notify listeners.
   * @param {Event} event - Event currently in the store
   * @private
   */
  _detachEvent(event) {
    // Remove from primary storage
    this.events.delete(event.id);

    // Invalidate caches
    this.optimizer.eventCache.delete(event.id);
    this.optimizer.queryCache.clear();
    this.optimizer.dateRangeCache.clear();
    this._invalidateOccurrenceCache(event.id);

    // Remove from indices
    this._unindexEvent(event);
  }

  /**
   * Drop the recurrence engine's cached expansions of one series, or of
   * every series when no id is given. The engine is pluggable, so both
   * hooks are optional.
   * @param {string} [eventId] - Series to invalidate; omit to clear everything
   * @private
   */
  _invalidateOccurrenceCache(eventId = null) {
    const engine = this.recurrenceEngine;
    if (!engine) {
      return;
    }
    if (eventId !== null && typeof engine.clearEventCache === 'function') {
      engine.clearEventCache(eventId);
    } else if (engine.occurrenceCache instanceof Map) {
      engine.occurrenceCache.clear();
    }
  }

  /**
   * Get an event by ID
   *
   * Occurrence ids produced by {@link EventStore#expandRecurringEvent}
   * (`<masterId>_<startMs>`, see {@link Event.occurrenceId}) resolve to the
   * stored recurring master they were derived from, so an id taken from view
   * data can always be looked up. Occurrences themselves are never stored.
   * @param {string} eventId - Event id or occurrence id
   * @returns {Event|null} The stored event (the master for an occurrence id) or null
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
      return event;
    }

    return this._resolveOccurrenceMaster(eventId);
  }

  /**
   * Resolve an occurrence id to the stored recurring master it belongs to.
   * Not cached: the master's own cache entry is the one kept in sync.
   * @param {string} eventId - Candidate occurrence id
   * @returns {Event|null} The master event or null
   * @private
   */
  _resolveOccurrenceMaster(eventId) {
    const parsed = Event.parseOccurrenceId(eventId);
    if (!parsed) {
      return null;
    }
    const master = this.events.get(parsed.recurringEventId);
    return master && master.recurring ? master : null;
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
   * @param {import('../types.js').QueryFilters} [filters={}] - Query filters
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
      // Collect candidates from target month AND adjacent months to handle
      // timezone boundary issues (events indexed in the event's own timezone
      // may fall in a different month than the query month)
      const candidateIds = new Set();
      for (let offset = -1; offset <= 1; offset++) {
        let m = filters.month + offset;
        let y = filters.year;
        if (m < 1) {
          m = 12;
          y--;
        }
        if (m > 12) {
          m = 1;
          y++;
        }
        const key = `${y}-${String(m).padStart(2, '0')}`;
        const ids = this.indices.byMonth.get(key);
        if (ids) {
          ids.forEach(id => candidateIds.add(id));
        }
      }

      // Post-filter: only include events that actually overlap with the requested month
      const monthStart = new Date(filters.year, filters.month - 1, 1);
      const monthEnd = new Date(filters.year, filters.month, 0, 23, 59, 59, 999);

      results = results.filter(event => {
        if (!candidateIds.has(event.id)) return false;
        return event.start <= monthEnd && event.end >= monthStart;
      });
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
   *
   * Recurring series are expanded for the day, so the result holds their
   * occurrences (see {@link EventStore#expandRecurringEvent}) rather than the
   * master events. When building a grid of days use
   * {@link EventStore#getEventsByDate}, which expands once for the whole range.
   * @param {Date} date - The date to query
   * @param {string} [timezone] - Timezone for the query (defaults to store timezone)
   * @returns {Event[]} Events occurring on the date, sorted by start time
   */
  getEventsForDate(date, timezone = null) {
    timezone = timezone || this.defaultTimezone;
    const dayStart = DateUtils.startOfDay(date);
    const dayEnd = DateUtils.endOfDay(date);

    const candidates = [];
    for (const id of this._collectDateCandidateIds(date)) {
      const event = this.events.get(id);
      // Recurring masters are represented by their occurrences below
      if (event && !event.recurring) {
        candidates.push(event);
      }
    }

    // Series are expanded on their own wall clock, so cover the offset
    // spread and let _selectEventsForDay decide in the query timezone
    const expandStart = DateUtils.addDays(dayStart, -TIMEZONE_PAD_DAYS);
    const expandEnd = DateUtils.addDays(dayEnd, TIMEZONE_PAD_DAYS);
    for (const id of this.indices.recurring) {
      const event = this.events.get(id);
      if (event) {
        candidates.push(...this.expandRecurringEvent(event, expandStart, expandEnd, timezone));
      }
    }

    return this._selectEventsForDay(candidates, dayStart, dayEnd, timezone);
  }

  /**
   * Get the events for every day in a range, keyed by local date (YYYY-MM-DD)
   *
   * Recurring series are expanded once for the whole range rather than once
   * per day, which is what a month or week grid needs. Every day in the range
   * has an entry (an empty array when nothing occurs) and multi-day events
   * appear under each day they span. Each array is sorted like
   * {@link EventStore#getEventsForDate}.
   *
   * @example
   * const byDate = store.getEventsByDate(gridStart, gridEnd);
   * const events = byDate.get(DateUtils.getLocalDateString(cellDate)) || [];
   *
   * @param {Date} start - First day of the range
   * @param {Date} end - Last day of the range
   * @param {string} [timezone] - Timezone deciding which day an event falls on (defaults to store timezone)
   * @returns {Map<string, Event[]>} Local date string -> events on that day
   */
  getEventsByDate(start, end, timezone = null) {
    timezone = timezone || this.defaultTimezone;
    const rangeStart = DateUtils.startOfDay(start);
    const rangeEnd = DateUtils.endOfDay(end);

    /** @type {Map<string, Event[]>} */
    const byDate = new Map();
    for (const day of DateUtils.getDateRange(rangeStart, rangeEnd)) {
      byDate.set(DateUtils.getLocalDateString(day), []);
    }

    // Query beyond each edge so events that fall on an edge day in the
    // requested timezone are not lost to the range filter on event wall clocks.
    const events = this.getEventsInRange(
      DateUtils.addDays(rangeStart, -TIMEZONE_PAD_DAYS),
      DateUtils.addDays(rangeEnd, TIMEZONE_PAD_DAYS),
      true,
      timezone
    );

    for (const event of events) {
      const eventStart = event.getStartInTimezone(timezone);
      const eventEnd = event.getEndInTimezone(timezone);
      const lastDay = eventEnd < rangeEnd ? eventEnd : rangeEnd;
      let day = DateUtils.startOfDay(eventStart > rangeStart ? eventStart : rangeStart);
      while (day <= lastDay) {
        byDate.get(DateUtils.getLocalDateString(day))?.push(event);
        day = DateUtils.addDays(day, 1);
      }
    }

    const compare = this._compareByStart(timezone);
    for (const dayEvents of byDate.values()) {
      dayEvents.sort(compare);
    }

    return byDate;
  }

  /**
   * Collect the ids of stored events that may occur on a date.
   * @param {Date} date - The date to query
   * @returns {Set<string>} Candidate event ids
   * @private
   */
  _collectDateCandidateIds(date) {
    const candidateIds = new Set();

    // Check byDate index for nearby dates (handles most events)
    const checkDate = new Date(date);
    for (let offset = -TIMEZONE_PAD_DAYS; offset <= TIMEZONE_PAD_DAYS; offset++) {
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

    return candidateIds;
  }

  /**
   * Keep the events that overlap a day in the given timezone, sorted by start.
   * @param {Event[]} events - Candidate events
   * @param {Date} dayStart - Start of the day
   * @param {Date} dayEnd - End of the day
   * @param {string} timezone - Timezone deciding whether an event falls on the day
   * @returns {Event[]} Events on the day, sorted
   * @private
   */
  _selectEventsForDay(events, dayStart, dayEnd, timezone) {
    const onDay = events.filter(event => {
      // Event overlaps with this day if it starts before end of day and ends after start of day
      const eventStartLocal = event.getStartInTimezone(timezone);
      const eventEndLocal = event.getEndInTimezone(timezone);
      return eventStartLocal <= dayEnd && eventEndLocal >= dayStart;
    });

    return onDay.sort(this._compareByStart(timezone));
  }

  /**
   * Comparator ordering events by start time in a timezone, longer events first.
   * @param {string} timezone - Timezone used for the start comparison
   * @returns {(a: Event, b: Event) => number} Comparator
   * @private
   */
  _compareByStart(timezone) {
    return (a, b) => {
      const timeCompare = a.getStartInTimezone(timezone) - b.getStartInTimezone(timezone);
      if (timeCompare !== 0) return timeCompare;
      return b.duration - a.duration; // Longer events first
    };
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
    const addCandidateIds = eventIds => {
      if (!eventIds) return;

      eventIds.forEach(id => {
        if (!checkedIds.has(id) && id !== excludeId) {
          checkedIds.add(id);
        }
      });
    };

    dates.forEach(date => {
      // Use getLocalDateString to match the index key format (YYYY-MM-DD)
      const dateStr = DateUtils.getLocalDateString(date);
      addCandidateIds(this.indices.byDate.get(dateStr));
    });

    // Lazy-indexed long events may not have every day in byDate. Use month
    // buckets as candidates and rely on precise overlap filtering below.
    const currentMonth = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    const endMonth = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
    while (currentMonth <= endMonth) {
      const monthKey = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}`;
      addCandidateIds(this.indices.byMonth.get(monthKey));
      currentMonth.setMonth(currentMonth.getMonth() + 1);
    }

    for (const id of checkedIds) {
      const event = this.events.get(id);

      if (event && event.overlaps({ start, end })) {
        overlapping.push(event);
      }
    }

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
    return this.groupOverlappingEvents(this.getEventsForDate(date), timedOnly);
  }

  /**
   * Group a list of events into clusters of overlapping time slots
   * Same result as {@link EventStore#getOverlapGroups} for events already fetched
   * (for example one day of {@link EventStore#getEventsByDate}).
   * @param {Event[]} events - Events to group; the array is not modified
   * @param {boolean} [timedOnly=true] - Only include timed events (not all-day)
   * @returns {Array<Event[]>} Array of event groups that overlap
   */
  groupOverlappingEvents(events, timedOnly = true) {
    events = timedOnly ? events.filter(e => !e.allDay) : [...events];

    if (events.length === 0) return [];

    // Sweep-line approach: sort by start, then merge overlapping intervals
    // O(n log n) instead of O(n²)
    events.sort((a, b) => a.start - b.start || b.end - a.end);

    const groups = [];
    let currentGroup = [events[0]];
    let groupEnd = events[0].end;

    for (let i = 1; i < events.length; i++) {
      const event = events[i];
      if (event.start < groupEnd) {
        // Overlaps with current group
        currentGroup.push(event);
        if (event.end > groupEnd) {
          groupEnd = event.end;
        }
      } else {
        // No overlap — start new group
        groups.push(currentGroup);
        currentGroup = [event];
        groupEnd = event.end;
      }
    }
    groups.push(currentGroup);

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
    let expandRecurring;

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

    // Recurring series can start before the requested range but still have
    // occurrences inside it, so include all recurring series as expansion
    // candidates and let the recurrence engine filter by range.
    const baseEventIds = new Set(baseEvents.map(event => event.id));
    for (const eventId of this.indices.recurring) {
      if (!baseEventIds.has(eventId)) {
        const event = this.events.get(eventId);
        if (event) {
          baseEvents.push(event);
          baseEventIds.add(eventId);
        }
      }
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
   *
   * Returns every occurrence that overlaps the range, including ones that
   * start before it but run into it (multi-day series). Each occurrence is an
   * {@link Event} cloned from the master with:
   * - `id` from {@link Event.occurrenceId} (`<masterId>_<startMs>`), stable
   *   across ranges and resolvable with {@link EventStore#getEvent},
   * - `isOccurrence: true`, `recurringEventId` and `occurrenceStart`,
   * - `metadata.recurringEventId`, `metadata.occurrenceId` (same as `id`) and
   *   `metadata.occurrenceIndex` (position within this expansion).
   * Non-recurring events are returned as-is in a one-element array.
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

    // The engine selects occurrences by start, so look back one event
    // duration to catch occurrences that began before the range but overlap it
    const duration = Math.max(0, event.end - event.start);
    const expandStart = new Date(rangeStart.getTime() - duration);
    const occurrences = this.recurrenceEngine.expandEvent(event, expandStart, rangeEnd, {
      timezone: eventTimezone
    });

    const expanded = [];
    for (const occurrence of occurrences) {
      if (occurrence.end < rangeStart || occurrence.start > rangeEnd) {
        continue;
      }
      expanded.push(this._createOccurrence(event, occurrence, eventTimezone, expanded.length));
    }

    return expanded;
  }

  /**
   * Build the Event instance for one occurrence of a recurring master.
   * @param {Event} event - The recurring master
   * @param {{start: Date, end: Date, timezone?: string}} occurrence - Engine occurrence
   * @param {string} eventTimezone - Timezone the series was expanded in
   * @param {number} index - Position within the current expansion
   * @returns {Event} Occurrence event
   * @private
   */
  _createOccurrence(event, occurrence, eventTimezone, index) {
    const occurrenceStart = new Date(occurrence.start);
    const id = Event.occurrenceId(event.id, occurrenceStart);

    const occurrenceEvent = event.clone({
      id,
      start: occurrenceStart,
      end: new Date(occurrence.end),
      timeZone: occurrence.timezone || eventTimezone,
      metadata: {
        ...event.metadata,
        recurringEventId: event.id,
        occurrenceId: id,
        occurrenceIndex: index
      }
    });

    occurrenceEvent.isOccurrence = true;
    occurrenceEvent.recurringEventId = event.id;
    occurrenceEvent.occurrenceStart = new Date(occurrenceStart);

    return occurrenceEvent;
  }

  /**
   * Lazily iterate the occurrences of a stored event in chronological order.
   *
   * Occurrences come one at a time from the store's recurrence engine
   * (RecurrenceEngineV2 by default), so taking the next few occurrences of
   * an open-ended series does not expand the series. `after` and `before`
   * are exclusive unless `inclusive` is set; see
   * RecurrenceEngineV2.iterateOccurrences for the full semantics. The
   * expansion timezone defaults to the event's, then the store's.
   *
   * @example
   * for (const occurrence of store.iterateOccurrences('standup', { after: new Date() })) {
   *   if (occurrence.start > deadline) break;
   *   remind(occurrence);
   * }
   *
   * @param {string} eventId - The event ID
   * @param {import('../types.js').ExpandedOccurrenceIteratorOptions} [options={}] - Window and expansion options
   * @returns {Generator<import('../types.js').ExpandedOccurrence, void, undefined>} Occurrences in chronological order
   * @throws {Error} If no event with the ID exists
   */
  iterateOccurrences(eventId, options = {}) {
    const query = this._occurrenceQuery(eventId, options);
    return this.recurrenceEngine.iterateOccurrences(query.event, query.options);
  }

  /**
   * First occurrence of a stored event after an instant, or null when the
   * series has no occurrence after it. `after` is exclusive unless
   * `options.inclusive` is set.
   *
   * @example
   * const upcoming = store.getNextOccurrence('standup', new Date());
   *
   * @param {string} eventId - The event ID
   * @param {Date|number} [after=null] - Instant to search from (defaults to the series start)
   * @param {import('../types.js').ExpandedOccurrenceIteratorOptions} [options={}] - Further options
   * @returns {import('../types.js').ExpandedOccurrence|null} The next occurrence, or null
   * @throws {Error} If no event with the ID exists
   */
  getNextOccurrence(eventId, after = null, options = {}) {
    const query = this._occurrenceQuery(eventId, options);
    return this.recurrenceEngine.nextOccurrence(query.event, after, query.options);
  }

  /**
   * The first `count` occurrences of a stored event inside a window,
   * generated lazily. `count` is capped at the engine's
   * MAX_OCCURRENCES_HARD_LIMIT.
   *
   * @example
   * const nextFive = store.takeOccurrences('standup', 5, { after: new Date() });
   *
   * @param {string} eventId - The event ID
   * @param {number} count - Maximum number of occurrences to return
   * @param {import('../types.js').ExpandedOccurrenceIteratorOptions} [options={}] - Window and expansion options
   * @returns {import('../types.js').ExpandedOccurrence[]} Up to `count` occurrences in chronological order
   * @throws {Error} If no event with the ID exists
   */
  takeOccurrences(eventId, count, options = {}) {
    const query = this._occurrenceQuery(eventId, options);
    return this.recurrenceEngine.takeOccurrences(query.event, count, query.options);
  }

  /**
   * Resolve an occurrence query to the stored event and its options, with
   * the timezone defaulted as expandRecurringEvent does
   * @param {string} eventId - The event ID
   * @param {Object} options - Caller options
   * @returns {{ event: Event, options: Object }}
   * @throws {Error} If no event with the ID exists
   * @private
   */
  _occurrenceQuery(eventId, options) {
    const event = this.events.get(eventId);
    if (!event) {
      throw new Error(`Event with id ${eventId} not found`);
    }
    return {
      event,
      options: { ...options, timezone: options.timezone || event.timeZone || this.defaultTimezone }
    };
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
    this.indices.byCategory.clear();
    this.indices.byStatus.clear();
    this.eventIndexRefs.clear();
    this._invalidateOccurrenceCache();

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

    this.startBatch();
    for (const eventData of events) {
      this.addEvent(eventData);
    }
    this.commitBatch();
  }

  /**
   * Reconcile the store with a snapshot of events, applying only the differences.
   *
   * Compared with {@link EventStore#loadEvents} (clear + re-add everything) this:
   * - keeps the existing {@link Event} instance for every entry that is
   *   equivalent to the stored one (identity is preserved, no notification),
   * - replaces stored events whose incoming data differs (`update` change),
   * - adds events whose id is not in the store (`add` change),
   * - removes stored events missing from the snapshot (`remove` change),
   *   unless `removeMissing` is `false`,
   * - emits a single `batch` notification listing those changes, or nothing at
   *   all when the snapshot matches the store. When called while a batch is
   *   already open the changes are queued on that batch instead.
   *
   * Input is validated up front: invalid event data or duplicate ids throw
   * before the store is modified. Any error raised while applying the diff
   * rolls the store back to its previous state.
   *
   * @example
   * // periodic server snapshot
   * const { added, updated, removed } = store.reconcile(rowsFromServer);
   * if (added.length || updated.length || removed.length) rerender();
   *
   * @param {Array<Event|import('../types.js').EventData>} events - Complete snapshot of events
   * @param {import('../types.js').ReconcileOptions} [options={}] - Reconcile options
   * @returns {import('../types.js').ReconcileResult} Events that were added, updated, removed and left untouched
   * @throws {Error} If an entry fails validation or two entries share an id
   */
  reconcile(events, options = {}) {
    const { removeMissing = true, isEquivalent = Event.isEquivalent } = options;

    if (!events || typeof events[Symbol.iterator] !== 'function') {
      throw new Error('reconcile() expects an iterable of events');
    }
    if (typeof isEquivalent !== 'function') {
      throw new Error('reconcile() option isEquivalent must be a function');
    }

    return this.optimizer.measure('reconcile', () => {
      // Normalize and validate everything before touching the store
      /** @type {Map<string, Event>} */
      const incoming = new Map();
      for (const eventData of events) {
        const event = eventData instanceof Event ? eventData : new Event(eventData);
        if (incoming.has(event.id)) {
          throw new Error(`Duplicate event id in reconcile input: ${event.id}`);
        }
        incoming.set(event.id, event);
      }

      /** @type {import('../types.js').ReconcileResult} */
      const result = { added: [], updated: [], removed: [], unchanged: [] };

      // Nest inside an existing batch if one is open, otherwise own one
      const ownsBatch = !this.isBatchMode;
      if (ownsBatch) {
        this.startBatch(true);
      }

      try {
        if (removeMissing) {
          for (const existing of Array.from(this.events.values())) {
            if (!incoming.has(existing.id)) {
              this._detachEvent(existing);
              this._queueChange({ type: 'remove', event: existing, version: ++this.version });
              result.removed.push(existing);
            }
          }
        }

        for (const event of incoming.values()) {
          const existing = this.events.get(event.id);
          if (!existing) {
            this.events.set(event.id, event);
            this.optimizer.cache(event.id, event, 'event');
            this._indexEvent(event);
            this._queueChange({ type: 'add', event, version: ++this.version });
            result.added.push(event);
          } else if (existing === event || isEquivalent(existing, event)) {
            result.unchanged.push(existing);
          } else {
            this._replaceEvent(existing, event);
            this._queueChange({
              type: 'update',
              event,
              oldEvent: existing,
              version: ++this.version
            });
            result.updated.push({ event, oldEvent: existing });
          }
        }

        if (result.added.length > 0) {
          // Newly indexed events may change range/query results
          this.optimizer.queryCache.clear();
          this.optimizer.dateRangeCache.clear();
        }
      } catch (error) {
        if (ownsBatch) {
          this.rollbackBatch();
        }
        throw error;
      }

      if (ownsBatch) {
        this.commitBatch();
      }

      return result;
    });
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
    this._createIndexRefs(event.id);

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
      this._addToKeyedIndex('byDate', dateStr, event.id);
    });

    // Add to all months the event spans
    const currentMonth = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    while (currentMonth <= endDate) {
      const monthKey = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}`;
      this._addToKeyedIndex('byMonth', monthKey, event.id);

      currentMonth.setMonth(currentMonth.getMonth() + 1);
    }

    // Index by categories
    if (event.categories && event.categories.length > 0) {
      event.categories.forEach(category => {
        this._addToKeyedIndex('byCategory', category, event.id);
      });
    }

    // Index by status
    if (event.status) {
      this._addToKeyedIndex('byStatus', event.status, event.id);
    }

    // Index recurring events
    if (event.recurring) {
      this.indices.recurring.add(event.id);
      this.eventIndexRefs.get(event.id).recurring = true;
    }
  }

  /**
   * Lazy index for events with large date ranges
   * @private
   */
  _indexEventLazy(event) {
    this.optimizer.createLazyIndexMarkers(event);

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
      this._addToKeyedIndex('byDate', dateStr, event.id);
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
        this._addToKeyedIndex('byDate', dateStr, event.id);
      });
    }

    // Index months as normal
    const currentMonth = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    while (currentMonth <= endDate) {
      const monthKey = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}`;
      this._addToKeyedIndex('byMonth', monthKey, event.id);
      currentMonth.setMonth(currentMonth.getMonth() + 1);
    }

    // Index other properties normally
    if (event.categories && event.categories.length > 0) {
      event.categories.forEach(category => {
        this._addToKeyedIndex('byCategory', category, event.id);
      });
    }

    if (event.status) {
      this._addToKeyedIndex('byStatus', event.status, event.id);
    }

    if (event.recurring) {
      this.indices.recurring.add(event.id);
      this.eventIndexRefs.get(event.id).recurring = true;
    }
  }

  /**
   * Create reverse index references for an event.
   * @private
   */
  _createIndexRefs(eventId) {
    this.eventIndexRefs.set(eventId, {
      byDate: new Set(),
      byMonth: new Set(),
      byCategory: new Set(),
      byStatus: new Set(),
      recurring: false
    });
  }

  /**
   * Add an event to a keyed index and record the reverse reference.
   * @private
   */
  _addToKeyedIndex(indexName, key, eventId) {
    const index = this.indices[indexName];
    if (!index.has(key)) {
      index.set(key, new Set());
    }

    index.get(key).add(eventId);
    this.eventIndexRefs.get(eventId)?.[indexName].add(key);
  }

  /**
   * Remove event from indices
   * @private
   */
  _unindexEvent(event) {
    const refs = this.eventIndexRefs.get(event.id);

    if (refs) {
      this._removeFromReferencedIndex('byDate', refs.byDate, event.id);
      this._removeFromReferencedIndex('byMonth', refs.byMonth, event.id);
      this._removeFromReferencedIndex('byCategory', refs.byCategory, event.id);
      this._removeFromReferencedIndex('byStatus', refs.byStatus, event.id);

      if (refs.recurring) {
        this.indices.recurring.delete(event.id);
      }

      this.eventIndexRefs.delete(event.id);
      return;
    }

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
   * Remove an event from only the keys it was indexed into.
   * @private
   */
  _removeFromReferencedIndex(indexName, keys, eventId) {
    const index = this.indices[indexName];

    for (const key of keys) {
      const eventIds = index.get(key);
      if (!eventIds) continue;

      eventIds.delete(eventId);
      if (eventIds.size === 0) {
        index.delete(key);
      }
    }
  }

  /**
   * Notify listeners of changes
   * @private
   */
  /**
   * Deliver a change now, or queue it when a batch is open
   * @param {import('../types.js').EventStoreChange} change - Change to deliver
   * @private
   */
  _queueChange(change) {
    if (this.isBatchMode) {
      this.batchNotifications.push(change);
    } else {
      this._notifyChange(change);
    }
  }

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
        eventIndexRefs: new Map(
          Array.from(this.eventIndexRefs.entries()).map(([eventId, refs]) => [
            eventId,
            {
              byDate: new Set(refs.byDate),
              byMonth: new Set(refs.byMonth),
              byCategory: new Set(refs.byCategory),
              byStatus: new Set(refs.byStatus),
              recurring: refs.recurring
            }
          ])
        ),
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
      this.eventIndexRefs = this.batchBackup.eventIndexRefs;
      this.version = this.batchBackup.version;
      this.batchBackup = null;

      // Clear cache
      this.clearCaches();
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
   * @param {Array<Event|import('../types.js').EventData>} events - Events to add
   * @returns {Event[]} Added events
   */
  addEvents(events) {
    return this.optimizer.measure('addEvents', () => {
      this.startBatch(true);
      const results = [];
      const errors = [];

      for (const eventData of events) {
        try {
          results.push(this.addEvent(eventData));
        } catch (error) {
          errors.push({ event: eventData, error: error.message });
        }
      }

      if (errors.length > 0 && results.length === 0) {
        this.rollbackBatch();
      } else {
        this.commitBatch();
      }

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
      this.startBatch(true);
      const results = [];
      const errors = [];

      for (const { id, updates: eventUpdates } of updates) {
        try {
          results.push(this.updateEvent(id, eventUpdates));
        } catch (error) {
          errors.push({ id, error: error.message });
        }
      }

      if (errors.length > 0 && results.length === 0) {
        this.rollbackBatch();
      } else {
        this.commitBatch();
      }

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
      this.startBatch(true);
      let removed = 0;

      for (const id of eventIds) {
        if (this.removeEvent(id)) {
          removed++;
        }
      }

      if (removed === 0 && eventIds.length > 0) {
        this.rollbackBatch();
      } else {
        this.commitBatch();
      }
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
   * Clear all caches, including the recurrence engine's cached expansions
   */
  clearCaches() {
    this.optimizer.eventCache.clear();
    this.optimizer.queryCache.clear();
    this.optimizer.dateRangeCache.clear();
    this._invalidateOccurrenceCache();
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
          for (const eventId of eventIds) {
            this.eventIndexRefs.get(eventId)?.byDate.delete(dateStr);
          }
          this.indices.byDate.delete(dateStr);
          removed++;
        }
      }
    }

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
   * @param {Event|import('../types.js').EventData} event - Event to check
   * @param {import('../types.js').ConflictCheckOptions} [options={}] - Check options
   * @returns {import('../types.js').ConflictSummary} Conflict summary
   */
  checkConflicts(event, options = {}) {
    return this.conflictDetector.checkConflicts(event, options);
  }

  /**
   * Check conflicts between two events
   * @param {string} eventId1 - First event ID
   * @param {string} eventId2 - Second event ID
   * @param {import('../types.js').ConflictCheckOptions} [options={}] - Check options
   * @returns {import('../types.js').ConflictDetails[]} Conflicts between events
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
   * @param {import('../types.js').ConflictCheckOptions} [options={}] - Check options
   * @returns {import('../types.js').ConflictSummary} All conflicts in range
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
   * @param {Event|import('../types.js').EventData} event - Event to add
   * @param {boolean} [allowConflicts=true] - Whether to allow adding with conflicts
   * @returns {{event: Event, conflicts: import('../types.js').ConflictSummary}} Result
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
   * @returns {Array<{event: Event, conflicts: import('../types.js').ConflictDetails[]}>} Events with conflicts
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
