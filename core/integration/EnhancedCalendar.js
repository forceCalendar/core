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
   */
  async getEventsInRange(startDate, endDate, options = {}) {
    const startTime = performance.now();

    const regularEvents = [];
    const recurringEvents = [];

    // Separate regular and recurring events
    const allEvents = this.eventStore.getEventsInRange(startDate, endDate, false);

    for (const event of allEvents) {
      if (event.recurring) {
        recurringEvents.push(event);
      } else {
        regularEvents.push(event);
      }
    }

    // Expand recurring events with enhanced engine
    const expandedOccurrences = [];

    for (const event of recurringEvents) {
      const occurrences = this.recurrenceEngine.expandEvent(event, startDate, endDate, {
        maxOccurrences: options.maxOccurrences || 365,
        includeModified: options.includeModified !== false,
        includeCancelled: options.includeCancelled || false,
        timezone: options.timezone || event.timeZone,
        handleDST: options.handleDST !== false
      });

      expandedOccurrences.push(...occurrences);
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
  calendar
    .advancedSearch('standup', {
      dateRange: {
        start: new Date('2024-01-01'),
        end: new Date('2024-01-31')
      },
      categories: ['meetings'],
      modifiedOnly: false
    })
    .then(results => {
      console.log('Search results:', results);
    });

  return calendar;
}

export default EnhancedCalendar;
