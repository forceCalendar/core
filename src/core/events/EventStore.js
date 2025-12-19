import { Event } from './Event.js';
import { DateUtils } from '../calendar/DateUtils.js';

/**
 * EventStore - Manages calendar events with efficient querying
 * Uses Map for O(1) lookups and spatial indexing concepts for date queries
 */
export class EventStore {
  constructor() {
    // Primary storage - Map for O(1) ID lookups
    this.events = new Map();

    // Indices for efficient queries
    this.indices = {
      byDate: new Map(), // Date string -> Set of event IDs
      byMonth: new Map(), // YYYY-MM -> Set of event IDs
      recurring: new Set() // Set of recurring event IDs
    };

    // Change tracking
    this.version = 0;
    this.listeners = new Set();
  }

  /**
   * Add an event to the store
   * @param {Event} event - The event to add
   * @returns {Event} The added event
   */
  addEvent(event) {
    if (!(event instanceof Event)) {
      event = new Event(event);
    }

    if (this.events.has(event.id)) {
      throw new Error(`Event with id ${event.id} already exists`);
    }

    // Store the event
    this.events.set(event.id, event);

    // Update indices
    this._indexEvent(event);

    // Notify listeners
    this._notifyChange({
      type: 'add',
      event,
      version: ++this.version
    });

    return event;
  }

  /**
   * Update an existing event
   * @param {string} eventId - The event ID
   * @param {Object} updates - Properties to update
   * @returns {Event} The updated event
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
   * @returns {Event|null}
   */
  getEvent(eventId) {
    return this.events.get(eventId) || null;
  }

  /**
   * Get all events
   * @returns {Event[]}
   */
  getAllEvents() {
    return Array.from(this.events.values());
  }

  /**
   * Query events with filters
   * @param {Object} filters - Query filters
   * @returns {Event[]}
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
    if (filters.hasOwnProperty('allDay')) {
      results = results.filter(event => event.allDay === filters.allDay);
    }

    // Filter by recurring
    if (filters.hasOwnProperty('recurring')) {
      results = results.filter(event => event.recurring === filters.recurring);
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
   * @returns {Event[]}
   */
  getEventsForDate(date) {
    const dateStr = date.toDateString();
    const eventIds = this.indices.byDate.get(dateStr) || new Set();

    return Array.from(eventIds)
      .map(id => this.events.get(id))
      .filter(event => event) // Filter out any null values
      .sort((a, b) => {
        // Sort by start time, then by duration
        const timeCompare = a.start - b.start;
        if (timeCompare !== 0) return timeCompare;
        return b.duration - a.duration; // Longer events first
      });
  }

  /**
   * Get events for a date range
   * @param {Date} start - Start date
   * @param {Date} end - End date
   * @returns {Event[]}
   */
  getEventsInRange(start, end) {
    return this.queryEvents({ start, end, sort: 'start' });
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
    // Index by date(s)
    const startDate = DateUtils.startOfDay(event.start);
    const endDate = DateUtils.endOfDay(event.end);

    // For each day the event spans, add to date index
    const dates = DateUtils.getDateRange(startDate, endDate);

    dates.forEach(date => {
      const dateStr = date.toDateString();

      if (!this.indices.byDate.has(dateStr)) {
        this.indices.byDate.set(dateStr, new Set());
      }
      this.indices.byDate.get(dateStr).add(event.id);
    });

    // Index by month(s)
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

    // Index recurring events
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
      version: this.version
    };
  }
}