/**
 * EnhancedCalendar - Integration of advanced search and recurrence features
 * Demonstrates how to use the new scalable components
 */

import { Calendar } from '../calendar/Calendar.js';
import { SearchWorkerManager } from '../search/SearchWorkerManager.js';
import { RecurrenceEngineV2 } from '../events/RecurrenceEngineV2.js';

export class EnhancedCalendar extends Calendar {
  constructor(config) {
    super(config);

    // Initialize enhanced components
    this.searchManager = new SearchWorkerManager(this.eventStore);
    this.recurrenceEngine = new RecurrenceEngineV2();

    // Performance monitoring
    this.performanceMetrics = {
      searchTime: [],
      expansionTime: [],
      renderTime: []
    };

    // Setup event listeners for real-time indexing
    this.setupRealtimeIndexing();

    // The enhanced engine keeps its own expansion cache, so drop the entries
    // of every series the store changes
    this._unsubscribeCacheInvalidation = this.eventStore.subscribe(change =>
      this._invalidateOccurrenceCache(change)
    );
  }

  /**
   * Invalidate the enhanced engine's cached expansions for a store change
   * @param {import('../types.js').EventStoreChange} change - Store change
   * @private
   */
  _invalidateOccurrenceCache(change) {
    const engine = this.recurrenceEngine;
    if (!engine || !change) {
      return;
    }
    switch (change.type) {
      case 'add':
      case 'update':
      case 'remove':
        if (change.event) {
          engine.clearEventCache(change.event.id);
        }
        break;
      case 'batch':
        for (const entry of change.changes || []) {
          this._invalidateOccurrenceCache(entry);
        }
        break;
      default:
        engine.occurrenceCache.clear();
    }
  }

  /**
   * Enhanced search with worker support
   */
  async search(query, options = {}) {
    const startTime = performance.now();

    try {
      // Use enhanced search manager
      const results = await this.searchManager.search(query, {
        fields: options.fields || ['title', 'description', 'location', 'category'],
        fuzzy: options.fuzzy !== false,
        limit: options.limit || 50,
        prefixMatch: options.autocomplete || false,
        ...options
      });

      const endTime = performance.now();
      this.recordMetric('searchTime', endTime - startTime);

      // Transform results to match expected format
      return results.map(r => r.event);
    } catch (error) {
      console.error('Search error:', error);
      // Fallback to basic search
      return super.search ? super.search(query, options) : [];
    }
  }

  /**
   * Get events with enhanced recurrence expansion
   *
   * Regular events overlapping the range are returned as stored. Every
   * recurring series in the store is expanded with this calendar's
   * RecurrenceEngineV2 (so instance modifications and cancellations apply),
   * including series that started before the range. Occurrences are the
   * engine's plain occurrence objects, with the id `<masterId>_<startMs>`
   * (see `Event.occurrenceId`), `recurringEventId`, `isOccurrence: true` and
   * `occurrenceStart`.
   */
  getEventsInRange(startDate, endDate, options = {}) {
    const startTime = performance.now();
    const rangeStart = new Date(startDate);
    const rangeEnd = new Date(endDate);

    // Recurring masters are represented by their occurrences below
    const regularEvents = this.eventStore
      .getEventsInRange(rangeStart, rangeEnd, false)
      .filter(event => !event.recurring);

    // A series that started before the range can still occur inside it, so
    // every recurring series is a candidate; the engine selects by range.
    const recurringEvents = this.eventStore.queryEvents({ recurring: true });

    // Expand recurring events with enhanced engine
    const expandedOccurrences = [];

    for (const event of recurringEvents) {
      // Look back one event duration so occurrences that began before the
      // range but overlap it are found
      const duration = Math.max(0, event.end - event.start);
      const expandStart = new Date(rangeStart.getTime() - duration);
      const occurrences = this.recurrenceEngine.expandEvent(event, expandStart, rangeEnd, {
        maxOccurrences: options.maxOccurrences || 365,
        includeModified: options.includeModified !== false,
        includeCancelled: options.includeCancelled || false,
        timezone: options.timezone || event.timeZone,
        handleDST: options.handleDST !== false
      });

      for (const occurrence of occurrences) {
        if (occurrence.end < rangeStart || occurrence.start > rangeEnd) {
          continue;
        }
        expandedOccurrences.push({
          ...occurrence,
          isOccurrence: true,
          occurrenceStart: new Date(occurrence.start)
        });
      }
    }

    const endTime = performance.now();
    this.recordMetric('expansionTime', endTime - startTime);

    // Combine and sort
    const allEventsInRange = [...regularEvents, ...expandedOccurrences];
    allEventsInRange.sort((a, b) => a.start - b.start);

    return allEventsInRange;
  }

  /**
   * Modify a single occurrence of a recurring event
   */
  modifyOccurrence(eventId, occurrenceDate, modifications) {
    // Add to modified instances
    this.recurrenceEngine.addModifiedInstance(eventId, occurrenceDate, modifications);

    // Emit change event
    this._emit('occurrenceModified', {
      eventId,
      occurrenceDate,
      modifications
    });
  }

  /**
   * Cancel a single occurrence of a recurring event
   */
  cancelOccurrence(eventId, occurrenceDate, reason = 'Cancelled') {
    // Add exception
    this.recurrenceEngine.addException(eventId, occurrenceDate, reason);

    // Emit change event
    this._emit('occurrenceCancelled', {
      eventId,
      occurrenceDate,
      reason
    });
  }

  /**
   * Lazily iterate the occurrences of an event through the enhanced
   * engine, so occurrences changed with modifyOccurrence or cancelled with
   * cancelOccurrence are reflected. Same semantics as
   * Calendar#iterateOccurrences.
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
   * First occurrence of an event after an instant through the enhanced
   * engine, or null. Same semantics as Calendar#getNextOccurrence.
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
   * The first `count` occurrences of an event through the enhanced
   * engine. Same semantics as Calendar#takeOccurrences.
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
   * the timezone defaulted as getEventsInRange does
   * @private
   */
  _occurrenceQuery(eventId, options) {
    const event = this.eventStore.getEvent(eventId);
    if (!event) {
      throw new Error(`Event with id ${eventId} not found`);
    }
    return { event, options: { ...options, timezone: options.timezone || event.timeZone } };
  }

  /**
   * Bulk operations for recurring events
   */
  async bulkModifyOccurrences(eventId, dateRange, modifications) {
    const event = this.eventStore.getEvent(eventId);
    if (!event || !event.recurring) {
      throw new Error('Event not found or not recurring');
    }

    // Get all occurrences in range
    const occurrences = this.recurrenceEngine.expandEvent(event, dateRange.start, dateRange.end);

    // Apply modifications to each
    for (const occurrence of occurrences) {
      this.recurrenceEngine.addModifiedInstance(eventId, occurrence.start, modifications);
    }

    // Emit bulk change event
    this._emit('occurrencesBulkModified', {
      eventId,
      count: occurrences.length,
      modifications
    });
  }

  /**
   * Advanced search with filters and recurrence awareness
   */
  async advancedSearch(query, filters = {}, options = {}) {
    // First get search results
    const searchResults = await this.search(query, options);

    // Apply additional filters
    let filtered = searchResults;

    // Date range filter with recurrence expansion
    if (filters.dateRange) {
      const expandedEvents = await this.getEventsInRange(
        filters.dateRange.start,
        filters.dateRange.end,
        { includeModified: true }
      );

      const expandedIds = new Set(expandedEvents.map(e => e.recurringEventId || e.id));

      filtered = filtered.filter(e => expandedIds.has(e.id));
    }

    // Category filter
    if (filters.categories && filters.categories.length > 0) {
      const categorySet = new Set(filters.categories);
      filtered = filtered.filter(e => e.categories && e.categories.some(c => categorySet.has(c)));
    }

    // Status filter
    if (filters.status) {
      filtered = filtered.filter(e => e.status === filters.status);
    }

    // Modified only filter
    if (filters.modifiedOnly) {
      filtered = filtered.filter(e => {
        const modifications = this.recurrenceEngine.modifiedInstances.get(e.id);
        return modifications && modifications.size > 0;
      });
    }

    return filtered;
  }

  /**
   * Setup real-time indexing for search
   */
  setupRealtimeIndexing() {
    // Batch re-indexing to avoid rebuilding the index repeatedly for rapid event changes.
    let reindexTimeout = null;
    const scheduleReindex = () => {
      if (reindexTimeout) {
        clearTimeout(reindexTimeout);
      }
      reindexTimeout = setTimeout(() => {
        this.searchManager.indexEvents();
      }, 100);
    };

    // Store cleanup handle so timers are cleared on destroy.
    this._clearReindexTimeout = () => {
      if (reindexTimeout) {
        clearTimeout(reindexTimeout);
        reindexTimeout = null;
      }
    };

    this.on('eventAdd', scheduleReindex);
    this.on('eventUpdate', scheduleReindex);
    this.on('eventRemove', scheduleReindex);
    this.on('eventsSet', scheduleReindex);
    this.on('eventStoreChange', change => {
      if (change?.type === 'batch') {
        scheduleReindex();
      }
    });
  }

  /**
   * Get search suggestions (autocomplete)
   */
  async getSuggestions(partial, field = 'title') {
    if (partial.length < 2) {
      return [];
    }

    // Use search with prefix matching
    const results = await this.searchManager.search(partial, {
      fields: [field],
      prefixMatch: true,
      limit: 10
    });

    // Extract unique values
    const suggestions = new Set();
    for (const result of results) {
      const value = result.event[field];
      if (value) {
        suggestions.add(value);
      }
    }

    return Array.from(suggestions);
  }

  /**
   * Performance monitoring
   */
  recordMetric(type, value) {
    this.performanceMetrics[type].push(value);

    // Keep only last 100 measurements
    if (this.performanceMetrics[type].length > 100) {
      this.performanceMetrics[type].shift();
    }
  }

  /**
   * Get performance statistics
   */
  getPerformanceStats() {
    const stats = {};

    for (const [metric, values] of Object.entries(this.performanceMetrics)) {
      if (values.length === 0) {
        stats[metric] = { avg: 0, min: 0, max: 0, p95: 0 };
        continue;
      }

      const sorted = [...values].sort((a, b) => a - b);
      const sum = sorted.reduce((a, b) => a + b, 0);

      stats[metric] = {
        avg: sum / sorted.length,
        min: sorted[0],
        max: sorted[sorted.length - 1],
        p95: sorted[Math.floor(sorted.length * 0.95)]
      };
    }

    return stats;
  }

  /**
   * Export calendar with recurrence data
   */
  exportWithRecurrence(format = 'json') {
    const data = {
      events: this.eventStore.getAllEvents(),
      modifiedInstances: {},
      exceptions: {}
    };

    // Include modified instances
    for (const [eventId, modifications] of this.recurrenceEngine.modifiedInstances) {
      data.modifiedInstances[eventId] = Array.from(modifications.entries());
    }

    // Include exceptions
    for (const [eventId, exceptions] of this.recurrenceEngine.exceptionStore) {
      data.exceptions[eventId] = Array.from(exceptions.entries());
    }

    if (format === 'json') {
      return JSON.stringify(data, null, 2);
    }

    // Could add ICS export here
    return data;
  }

  /**
   * Import calendar with recurrence data
   */
  importWithRecurrence(data, format = 'json') {
    if (format === 'json') {
      const parsed = typeof data === 'string' ? JSON.parse(data) : data;

      // Import events
      for (const event of parsed.events) {
        this.addEvent(event);
      }

      // Import modified instances
      if (parsed.modifiedInstances) {
        for (const [eventId, modifications] of Object.entries(parsed.modifiedInstances)) {
          for (const [dateKey, mods] of modifications) {
            this.recurrenceEngine.addModifiedInstance(eventId, new Date(dateKey), mods);
          }
        }
      }

      // Import exceptions
      if (parsed.exceptions) {
        for (const [eventId, exceptions] of Object.entries(parsed.exceptions)) {
          for (const [dateKey, reason] of exceptions) {
            this.recurrenceEngine.addException(eventId, new Date(dateKey), reason);
          }
        }
      }
    }
  }

  /**
   * Clean up resources
   */
  destroy() {
    if (typeof this._clearReindexTimeout === 'function') {
      this._clearReindexTimeout();
      this._clearReindexTimeout = null;
    }
    if (typeof this._unsubscribeCacheInvalidation === 'function') {
      this._unsubscribeCacheInvalidation();
      this._unsubscribeCacheInvalidation = null;
    }

    // Clean up worker
    if (this.searchManager) {
      this.searchManager.destroy();
    }

    // Clear caches
    if (this.recurrenceEngine) {
      this.recurrenceEngine.occurrenceCache.clear();
    }

    // Call parent destroy if exists
    if (super.destroy) {
      super.destroy();
    }
  }
}

// Usage Example
export function createEnhancedCalendar(config) {
  const calendar = new EnhancedCalendar(config);

  // Example: Add a complex recurring event
  calendar.addEvent({
    id: 'meeting-1',
    title: 'Weekly Team Standup',
    start: new Date('2024-01-01T10:00:00'),
    end: new Date('2024-01-01T10:30:00'),
    recurring: true,
    recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20241231T235959Z',
    timeZone: 'America/New_York',
    categories: ['meetings', 'team']
  });

  // Example: Modify a single occurrence
  calendar.modifyOccurrence('meeting-1', new Date('2024-01-08T10:00:00'), {
    title: 'Extended Team Standup - Sprint Planning',
    end: new Date('2024-01-08T11:30:00'),
    location: 'Conference Room A'
  });

  // Example: Cancel an occurrence
  calendar.cancelOccurrence('meeting-1', new Date('2024-01-15T10:00:00'), 'Public Holiday');

  // Example: Advanced search
  return calendar;
}

export default EnhancedCalendar;
