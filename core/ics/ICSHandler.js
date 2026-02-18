/**
 * ICS Import/Export Handler
 * High-level API for calendar data interchange
 */

import { ICSParser } from './ICSParser.js';
import { Event } from '../events/Event.js';

export class ICSHandler {
  constructor(calendar) {
    this.calendar = calendar;
    this.parser = new ICSParser();
  }

  /**
   * Import events from ICS file or string
   * @param {string|File|Blob} input - ICS data source
   * @param {Object} options - Import options
   * @returns {Promise<Object>} Import results
   */
  async import(input, options = {}) {
    const {
      merge = true, // Merge with existing events
      updateExisting = false, // Update events with matching IDs
      skipDuplicates = true, // Skip if event already exists
      dateRange = null, // Only import events in range
      categories = null // Only import specific categories
    } = options;

    try {
      // Get ICS string from input
      const icsString = await this.getICSString(input);

      // Parse ICS to events
      const parsedEvents = this.parser.parse(icsString);

      // Process each event
      const results = {
        imported: [],
        skipped: [],
        updated: [],
        errors: []
      };

      for (const eventData of parsedEvents) {
        try {
          // Apply filters
          if (dateRange && !this.isInDateRange(eventData, dateRange)) {
            results.skipped.push({ event: eventData, reason: 'out_of_range' });
            continue;
          }

          if (categories && !categories.includes(eventData.category)) {
            results.skipped.push({ event: eventData, reason: 'category_filtered' });
            continue;
          }

          // Check for existing event
          const existingEvent = this.calendar.getEvent(eventData.id);

          if (existingEvent) {
            if (updateExisting) {
              // Update existing event
              this.calendar.updateEvent(eventData.id, eventData);
              results.updated.push(eventData);
            } else if (skipDuplicates) {
              results.skipped.push({ event: eventData, reason: 'duplicate' });
            } else {
              // Create new event with different ID
              eventData.id = this.generateNewId(eventData.id);
              this.calendar.addEvent(eventData);
              results.imported.push(eventData);
            }
          } else {
            // Add new event
            this.calendar.addEvent(eventData);
            results.imported.push(eventData);
          }
        } catch (error) {
          results.errors.push({
            event: eventData,
            error: error.message
          });
        }
      }

      // Clear and replace if not merging
      if (!merge) {
        // Remove existing events not in import
        const importedIds = new Set(parsedEvents.map(e => e.id));
        const existingEvents = this.calendar.getEvents();

        for (const event of existingEvents) {
          if (!importedIds.has(event.id)) {
            this.calendar.removeEvent(event.id);
          }
        }
      }

      return results;
    } catch (error) {
      throw new Error(`ICS import failed: ${error.message}`);
    }
  }

  /**
   * Export calendar events to ICS format
   * @param {Object} options - Export options
   * @returns {string} ICS formatted string
   */
  export(options = {}) {
    const {
      dateRange = null, // Only export events in range
      categories = null, // Only export specific categories
      calendarName = 'Lightning Calendar Export',
      includeRecurring = true,
      expandRecurring = false // Expand recurring events to instances
    } = options;

    // Get events to export
    let events = this.calendar.getEvents();

    // Apply filters
    if (dateRange) {
      events = events.filter(event => this.isInDateRange(event, dateRange));
    }

    if (categories) {
      events = events.filter(event => categories.includes(event.category));
    }

    // Handle recurring events
    if (expandRecurring) {
      events = this.expandRecurringEvents(events, dateRange);
    } else if (!includeRecurring) {
      events = events.filter(
        event => !(event.recurring || event.recurrenceRule || event.recurrence)
      );
    }

    // Generate ICS
    return this.parser.export(events, calendarName);
  }

  /**
   * Export and download as file
   * @param {string} filename - Name for the downloaded file
   * @param {Object} options - Export options
   */
  downloadAsFile(filename = 'calendar.ics', options = {}) {
    const icsContent = this.export(options);
    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });

    // Create download link
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;

    // Trigger download
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Clean up
    URL.revokeObjectURL(link.href);
  }

  /**
   * Import from URL
   * @param {string} url - URL to ICS file
   * @param {Object} options - Import options
   * @returns {Promise<Object>} Import results
   */
  async importFromURL(url, options = {}) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch ICS: ${response.statusText}`);
      }
      const icsString = await response.text();
      return this.import(icsString, options);
    } catch (error) {
      throw new Error(`Failed to import from URL: ${error.message}`);
    }
  }

  /**
   * Subscribe to calendar feed
   * @param {string} url - URL to ICS feed
   * @param {Object} options - Subscription options
   * @returns {Object} Subscription object
   */
  subscribe(url, options = {}) {
    const {
      refreshInterval = 3600000, // 1 hour default
      autoRefresh = true,
      ...importOptions
    } = options;

    const subscription = {
      url,
      lastRefresh: null,
      intervalId: null,
      status: 'active',

      refresh: async () => {
        try {
          const results = await this.importFromURL(url, importOptions);
          subscription.lastRefresh = new Date();
          return results;
        } catch (error) {
          subscription.status = 'error';
          throw error;
        }
      },

      stop: () => {
        if (subscription.intervalId) {
          clearInterval(subscription.intervalId);
          subscription.intervalId = null;
        }
        subscription.status = 'stopped';
      },

      start: () => {
        subscription.stop();
        if (autoRefresh) {
          subscription.intervalId = setInterval(() => {
            subscription.refresh().catch(console.error);
          }, refreshInterval);
        }
        subscription.status = 'active';
      }
    };

    // Initial import
    subscription.refresh().catch(console.error);

    // Start auto-refresh if enabled
    if (autoRefresh) {
      subscription.start();
    }

    return subscription;
  }

  /**
   * Get ICS string from various input types
   * @private
   */
  async getICSString(input) {
    if (typeof input === 'string') {
      return input;
    }

    if (input instanceof File || input instanceof Blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsText(input);
      });
    }

    throw new Error('Invalid input type. Expected string, File, or Blob.');
  }

  /**
   * Check if event is in date range
   * @private
   */
  isInDateRange(event, dateRange) {
    if (!dateRange) return true;

    const { start, end } = dateRange;
    const eventStart = event.start instanceof Date ? event.start : new Date(event.start);
    const eventEnd = event.end instanceof Date ? event.end : new Date(event.end || event.start);

    return (
      (eventStart >= start && eventStart <= end) ||
      (eventEnd >= start && eventEnd <= end) ||
      (eventStart <= start && eventEnd >= end)
    );
  }

  /**
   * Generate new ID for duplicate event
   * @private
   */
  generateNewId(originalId) {
    const timestamp = Date.now().toString(36);
    return `${originalId}-copy-${timestamp}`;
  }

  /**
   * Expand recurring events into individual instances
   * @private
   */
  expandRecurringEvents(events, dateRange) {
    const expanded = [];
    const rangeStart = dateRange?.start || new Date();
    const rangeEnd = dateRange?.end || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

    for (const event of events) {
      if (!(event.recurring || event.recurrenceRule || event.recurrence)) {
        expanded.push(event);
        continue;
      }

      // TODO: Get instances from calendar's recurrence engine when implemented
      // For now, just include the base event
      const instances = [
        {
          start: event.start,
          end: event.end
        }
      ];

      // Add each instance as a separate event
      for (const instance of instances) {
        expanded.push({
          ...event,
          id: `${event.id}-${instance.start.getTime()}`,
          start: instance.start,
          end: instance.end,
          recurring: false,
          recurrenceRule: null,
          recurrence: null, // Remove recurrence from instances
          parentId: event.id // Reference to original
        });
      }
    }

    return expanded;
  }

  /**
   * Validate ICS string
   * @param {string} icsString - ICS content to validate
   * @returns {Object} Validation results
   */
  validate(icsString) {
    const results = {
      valid: true,
      errors: [],
      warnings: []
    };

    try {
      // Check basic structure
      if (!icsString.includes('BEGIN:VCALENDAR')) {
        results.errors.push('Missing BEGIN:VCALENDAR');
        results.valid = false;
      }

      if (!icsString.includes('END:VCALENDAR')) {
        results.errors.push('Missing END:VCALENDAR');
        results.valid = false;
      }

      if (!icsString.includes('VERSION:')) {
        results.warnings.push('Missing VERSION property');
      }

      // Try to parse
      const events = this.parser.parse(icsString);

      // Check events
      if (events.length === 0) {
        results.warnings.push('No events found in calendar');
      }

      // Validate each event
      for (let i = 0; i < events.length; i++) {
        const event = events[i];

        if (!event.start) {
          results.errors.push(`Event ${i + 1}: Missing start date`);
          results.valid = false;
        }

        if (!event.title && !event.description) {
          results.warnings.push(`Event ${i + 1}: No title or description`);
        }
      }
    } catch (error) {
      results.errors.push(`Parse error: ${error.message}`);
      results.valid = false;
    }

    return results;
  }
}
