/**
 * ICS Import/Export Handler
 * High-level API for calendar data interchange
 */

import { ICSParser } from './ICSParser.js';
import { RecurrenceEngineV2 } from '../events/RecurrenceEngineV2.js';

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

      // Enforce input size limit before parsing
      if (typeof icsString === 'string' && icsString.length > ICSParser.MAX_INPUT_SIZE) {
        throw new Error(
          `ICS input exceeds maximum size of ${ICSParser.MAX_INPUT_SIZE / (1024 * 1024)}MB`
        );
      }

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
    const {
      requestTimeout = 30000,
      maxRedirects = 5,
      maxFileSize = this.parser.maxFileSize || ICSParser.MAX_INPUT_SIZE
    } = options;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), requestTimeout);

      try {
        const response = await this.fetchSafeURL(url, {
          signal: controller.signal,
          maxRedirects
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch ICS: ${response.statusText}`);
        }

        // Validate Content-Type header
        const contentType = response.headers.get('content-type') || '';
        const allowedTypes = ['text/calendar', 'text/plain', 'application/octet-stream'];
        const typeMatch = allowedTypes.some(t => contentType.toLowerCase().includes(t));
        if (contentType && !typeMatch) {
          throw new Error(
            `Unexpected Content-Type: ${contentType}. Expected text/calendar or text/plain`
          );
        }

        const contentLength = response.headers.get('content-length');
        if (contentLength && Number(contentLength) > maxFileSize) {
          throw new Error(`ICS response exceeds maximum size of ${maxFileSize / (1024 * 1024)}MB`);
        }

        const icsString = await this.readResponseText(response, maxFileSize);
        return this.import(icsString, options);
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(`Failed to import from URL: request timed out after ${requestTimeout}ms`);
      }
      throw new Error(`Failed to import from URL: ${error.message}`);
    }
  }

  /**
   * Fetch a URL after validating the initial URL and each redirect target.
   * @private
   */
  async fetchSafeURL(url, { signal, maxRedirects }) {
    if (typeof fetch !== 'function') {
      throw new Error('fetch API is not available in this environment');
    }

    let currentURL = url;
    const manualRedirects = ICSHandler.isNodeRuntime();

    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
      await ICSHandler.validateURLForFetch(currentURL);

      const response = await fetch(currentURL, {
        signal,
        redirect: manualRedirects ? 'manual' : 'follow'
      });

      if (
        !manualRedirects ||
        response.status < 300 ||
        response.status >= 400 ||
        !response.headers.get('location')
      ) {
        return response;
      }

      currentURL = new URL(response.headers.get('location'), currentURL).toString();
    }

    throw new Error(`Too many redirects while fetching ICS feed (limit ${maxRedirects})`);
  }

  /**
   * Read a response body while enforcing a byte limit.
   * @private
   */
  async readResponseText(response, maxFileSize) {
    if (!response.body || typeof response.body.getReader !== 'function') {
      const text = await response.text();
      if (text.length > maxFileSize) {
        throw new Error(`ICS response exceeds maximum size of ${maxFileSize / (1024 * 1024)}MB`);
      }
      return text;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let received = 0;
    let text = '';
    let done = false;

    while (!done) {
      const chunk = await reader.read();
      done = chunk.done;
      if (done) break;

      const { value } = chunk;
      received += value.byteLength;
      if (received > maxFileSize) {
        await reader.cancel();
        throw new Error(`ICS response exceeds maximum size of ${maxFileSize / (1024 * 1024)}MB`);
      }

      text += decoder.decode(value, { stream: true });
    }

    text += decoder.decode();
    return text;
  }

  /**
   * Validate a URL for safety (prevent SSRF attacks)
   * @param {string} url - URL to validate
   * @throws {Error} If URL is not safe
   */
  static validateURL(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error('Invalid URL');
    }

    // Only allow http and https schemes
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(
        `URL scheme "${parsed.protocol}" is not allowed. Only http and https are permitted`
      );
    }

    if (parsed.username || parsed.password) {
      throw new Error('URLs with embedded credentials are not allowed');
    }

    const hostname = ICSHandler.normalizeHostname(parsed.hostname);
    if (ICSHandler.isBlockedHostname(hostname) || ICSHandler.isPrivateIPAddress(hostname)) {
      throw new Error('URLs pointing to private/internal networks are not allowed');
    }

    return parsed;
  }

  /**
   * Validate a URL and, in Node runtimes, ensure DNS does not resolve privately.
   * @param {string} url - URL to validate
   * @returns {Promise<URL>} Parsed safe URL
   */
  static async validateURLForFetch(url) {
    const parsed = ICSHandler.validateURL(url);

    if (ICSHandler.isNodeRuntime() && !ICSHandler.isIPAddress(parsed.hostname)) {
      const dns = await import('node:dns/promises');
      const addresses = await dns.lookup(parsed.hostname, { all: true, verbatim: true });

      for (const address of addresses) {
        if (ICSHandler.isPrivateIPAddress(address.address)) {
          throw new Error('URL hostname resolves to a private/internal network address');
        }
      }
    }

    return parsed;
  }

  /**
   * @private
   */
  static isNodeRuntime() {
    return typeof process !== 'undefined' && !!process.versions?.node;
  }

  /**
   * @private
   */
  static normalizeHostname(hostname) {
    return String(hostname)
      .trim()
      .toLowerCase()
      .replace(/^\[/, '')
      .replace(/\]$/, '')
      .replace(/\.$/, '');
  }

  /**
   * @private
   */
  static isBlockedHostname(hostname) {
    return (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname === 'metadata.google.internal'
    );
  }

  /**
   * @private
   */
  static isIPAddress(hostname) {
    const normalized = ICSHandler.normalizeHostname(hostname);
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(normalized) || normalized.includes(':');
  }

  /**
   * @private
   */
  static isPrivateIPAddress(address) {
    const normalized = ICSHandler.normalizeHostname(address);
    const ipv4Match = normalized.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);

    if (ipv4Match) {
      const octets = ipv4Match.slice(1).map(Number);
      if (octets.some(octet => octet < 0 || octet > 255)) return true;

      const [first, second] = octets;
      return (
        first === 0 ||
        first === 10 ||
        first === 127 ||
        first >= 224 ||
        (first === 100 && second >= 64 && second <= 127) ||
        (first === 169 && second === 254) ||
        (first === 172 && second >= 16 && second <= 31) ||
        (first === 192 && second === 168) ||
        (first === 198 && (second === 18 || second === 19))
      );
    }

    const mappedIPv4 = normalized.match(/::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (mappedIPv4) {
      return ICSHandler.isPrivateIPAddress(mappedIPv4[1]);
    }

    if (!normalized.includes(':')) {
      return false;
    }

    if (normalized === '::' || normalized === '::1') {
      return true;
    }

    const firstHextet = parseInt(normalized.split(':')[0] || '0', 16);
    return (
      (firstHextet & 0xfe00) === 0xfc00 ||
      (firstHextet & 0xffc0) === 0xfe80 ||
      (firstHextet & 0xffc0) === 0xfec0 ||
      (firstHextet & 0xff00) === 0xff00
    );
  }

  /**
   * Subscribe to calendar feed
   * @param {string} url - URL to ICS feed
   * @param {Object} options - Subscription options
   * @returns {Object} Subscription object
   */
  subscribe(url, options = {}) {
    // Validate URL before subscribing to prevent SSRF
    ICSHandler.validateURL(url);

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
    const recurrenceEngine = new RecurrenceEngineV2();

    for (const event of events) {
      if (!(event.recurring || event.recurrenceRule || event.recurrence)) {
        expanded.push(event);
        continue;
      }

      // Use RecurrenceEngineV2 to expand occurrences within the date range
      const occurrences = recurrenceEngine.expandEvent(event, rangeStart, rangeEnd);

      // Add each occurrence as a separate event
      for (const occurrence of occurrences) {
        expanded.push({
          ...event,
          id: `${event.id}-${occurrence.start.getTime()}`,
          start: occurrence.start,
          end: occurrence.end,
          recurring: false,
          recurrenceRule: null,
          recurrence: null,
          parentId: event.id
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
