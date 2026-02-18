/**
 * Event Search Engine
 * Full-text search and filtering for calendar events
 */

export class EventSearch {
  constructor(eventStore) {
    this.eventStore = eventStore;

    // Search index for performance
    this.searchIndex = new Map();
    this.indexFields = ['title', 'description', 'location', 'category'];
    this._indexDirty = false;

    // Build initial index
    this.rebuildIndex();

    // Subscribe to EventStore changes to keep index in sync
    if (this.eventStore && typeof this.eventStore.subscribe === 'function') {
      this._unsubscribe = this.eventStore.subscribe(change => {
        if (change.type === 'batch') {
          this._indexDirty = true;
        } else if (
          change.type === 'add' ||
          change.type === 'update' ||
          change.type === 'remove' ||
          change.type === 'clear'
        ) {
          this._indexDirty = true;
        }
      });
    }
  }

  /**
   * Destroy the search engine and unsubscribe from store changes
   */
  destroy() {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
    this.searchIndex.clear();
  }

  /**
   * Search events by query string
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @returns {Array} Matching events
   */
  search(query, options = {}) {
    const {
      fields = this.indexFields, // Fields to search in
      fuzzy = true, // Fuzzy matching
      caseSensitive = false, // Case sensitive search
      limit = null, // Max results
      sortBy = 'relevance' // Sort results
    } = options;

    if (!query || query.trim() === '') {
      return [];
    }

    // Rebuild index if stale
    this._ensureIndex();

    // Normalize query
    const normalizedQuery = caseSensitive ? query : query.toLowerCase();
    const queryTerms = this.tokenize(normalizedQuery);

    // Search through events
    const results = [];
    const events = this.eventStore.getAllEvents();

    for (const event of events) {
      const score = this.calculateMatchScore(event, queryTerms, fields, {
        fuzzy,
        caseSensitive
      });

      if (score > 0) {
        results.push({
          event,
          score,
          matches: this.getMatchDetails(event, queryTerms, fields, { caseSensitive })
        });
      }
    }

    // Sort results
    this.sortResults(results, sortBy);

    // Apply limit
    const limited = limit ? results.slice(0, limit) : results;

    // Return just the events (not the scoring metadata)
    return limited.map(r => r.event);
  }

  /**
   * Filter events by criteria
   * @param {Object} filters - Filter criteria
   * @returns {Array} Filtered events
   */
  filter(filters) {
    const {
      dateRange = null,
      categories = null,
      locations = null,
      attendees = null,
      status = null,
      allDay = null,
      recurring = null,
      hasReminders = null,
      custom = null // Custom filter function
    } = filters;

    let events = this.eventStore.getAllEvents();

    // Date range filter
    if (dateRange) {
      events = events.filter(event => {
        const eventStart = event.start;
        const eventEnd = event.end || event.start;
        return (
          (eventStart >= dateRange.start && eventStart <= dateRange.end) ||
          (eventEnd >= dateRange.start && eventEnd <= dateRange.end) ||
          (eventStart <= dateRange.start && eventEnd >= dateRange.end)
        );
      });
    }

    // Category filter
    if (categories && categories.length > 0) {
      const categorySet = new Set(categories);
      events = events.filter(event => {
        // Handle both single category and categories array
        if (event.category) {
          return categorySet.has(event.category);
        }
        if (event.categories && Array.isArray(event.categories)) {
          return event.categories.some(cat => categorySet.has(cat));
        }
        return false;
      });
    }

    // Location filter
    if (locations && locations.length > 0) {
      const locationSet = new Set(locations.map(l => l.toLowerCase()));
      events = events.filter(event => {
        if (!event.location) return false;
        return locationSet.has(event.location.toLowerCase());
      });
    }

    // Attendees filter
    if (attendees && attendees.length > 0) {
      const attendeeEmails = new Set(
        attendees.map(a => (typeof a === 'string' ? a.toLowerCase() : a.email?.toLowerCase()))
      );
      events = events.filter(event => {
        if (!event.attendees || event.attendees.length === 0) return false;
        return event.attendees.some(attendee => {
          const email = attendee.email || attendee;
          return attendeeEmails.has(email.toLowerCase());
        });
      });
    }

    // Status filter
    if (status) {
      const statusSet = new Set(Array.isArray(status) ? status : [status]);
      events = events.filter(event => statusSet.has(event.status));
    }

    // All-day filter
    if (allDay !== null) {
      events = events.filter(event => event.allDay === allDay);
    }

    // Recurring filter
    if (recurring !== null) {
      events = events.filter(event => {
        const hasRecurrence = !!(event.recurring || event.recurrenceRule || event.recurrence);
        return recurring ? hasRecurrence : !hasRecurrence;
      });
    }

    // Reminders filter
    if (hasReminders !== null) {
      events = events.filter(event => {
        const hasRem = event.reminders && event.reminders.length > 0;
        return hasReminders ? hasRem : !hasRem;
      });
    }

    // Custom filter function
    if (custom && typeof custom === 'function') {
      events = events.filter(custom);
    }

    return events;
  }

  /**
   * Advanced search combining text search and filters
   * @param {string} query - Search query
   * @param {Object} filters - Filter criteria
   * @param {Object} options - Search options
   * @returns {Array} Matching events
   */
  advancedSearch(query, filters = {}, options = {}) {
    // First apply filters
    let events = this.filter(filters);

    // Then search within filtered results if query provided
    if (query && query.trim() !== '') {
      const searchResults = this.search(query, {
        ...options,
        limit: null // Don't limit during filtering phase
      });
      const searchIds = new Set(searchResults.map(e => e.id));
      events = events.filter(e => searchIds.has(e.id));
    }

    // Apply final limit if specified
    if (options.limit) {
      events = events.slice(0, options.limit);
    }

    return events;
  }

  /**
   * Get search suggestions/autocomplete
   * @param {string} partial - Partial search term
   * @param {Object} options - Suggestion options
   * @returns {Array} Suggested terms
   */
  getSuggestions(partial, options = {}) {
    const { field = 'title', limit = 10, minLength = 2 } = options;

    if (!partial || partial.length < minLength) {
      return [];
    }

    const normalizedPartial = partial.toLowerCase();
    const suggestions = new Set();
    const events = this.eventStore.getAllEvents();

    for (const event of events) {
      const value = event[field];
      if (!value) continue;

      const normalizedValue = value.toLowerCase();
      if (normalizedValue.includes(normalizedPartial)) {
        suggestions.add(value);
        if (suggestions.size >= limit) break;
      }
    }

    return Array.from(suggestions);
  }

  /**
   * Get unique values for a field (for filter dropdowns)
   * @param {string} field - Field name
   * @returns {Array} Unique values
   */
  getUniqueValues(field) {
    const values = new Set();
    const events = this.eventStore.getAllEvents();

    for (const event of events) {
      // Special handling for category/categories
      if (field === 'category') {
        // Check both single category and categories array
        if (event.category) {
          values.add(event.category);
        }
        if (event.categories && Array.isArray(event.categories)) {
          event.categories.forEach(cat => values.add(cat));
        }
      } else {
        const value = event[field];
        if (value !== undefined && value !== null && value !== '') {
          if (Array.isArray(value)) {
            value.forEach(v => values.add(v));
          } else {
            values.add(value);
          }
        }
      }
    }

    return Array.from(values).sort();
  }

  /**
   * Group events by a field
   * @param {string} field - Field to group by
   * @param {Object} options - Grouping options
   * @returns {Object} Grouped events
   */
  groupBy(field, options = {}) {
    const { sortGroups = true, sortEvents = false, includeEmpty = false } = options;

    const groups = new Map();
    const events = this.eventStore.getAllEvents();

    for (const event of events) {
      const value = event[field] || (includeEmpty ? `(No ${field})` : null);
      if (value === null) continue;

      if (!groups.has(value)) {
        groups.set(value, []);
      }
      groups.get(value).push(event);
    }

    // Sort events within groups if requested
    if (sortEvents) {
      for (const [key, eventList] of groups) {
        eventList.sort((a, b) => a.start - b.start);
      }
    }

    // Convert to object and sort keys if requested
    const result = {};
    const keys = Array.from(groups.keys());
    if (sortGroups) keys.sort();

    for (const key of keys) {
      result[key] = groups.get(key);
    }

    return result;
  }

  /**
   * Calculate match score for an event
   * @private
   */
  calculateMatchScore(event, queryTerms, fields, options) {
    let totalScore = 0;
    const { fuzzy, caseSensitive } = options;

    for (const field of fields) {
      const value = event[field];
      if (!value) continue;

      const normalizedValue = caseSensitive ? value : value.toLowerCase();

      for (const term of queryTerms) {
        // Exact match gets highest score
        if (normalizedValue.includes(term)) {
          totalScore += 10;
        }
        // Fuzzy match if enabled
        else if (fuzzy) {
          const distance = this.levenshteinDistance(term, normalizedValue);
          if (distance <= 2) {
            totalScore += 5 - distance;
          }
        }
      }

      // Boost score for title matches
      if (field === 'title') {
        totalScore *= 2;
      }
    }

    return totalScore;
  }

  /**
   * Get match details for highlighting
   * @private
   */
  getMatchDetails(event, queryTerms, fields, options) {
    const matches = {};
    const { caseSensitive } = options;

    for (const field of fields) {
      const value = event[field];
      if (!value) continue;

      const normalizedValue = caseSensitive ? value : value.toLowerCase();
      const fieldMatches = [];

      for (const term of queryTerms) {
        let index = normalizedValue.indexOf(term);
        while (index !== -1) {
          fieldMatches.push({
            start: index,
            end: index + term.length,
            term
          });
          index = normalizedValue.indexOf(term, index + 1);
        }
      }

      if (fieldMatches.length > 0) {
        matches[field] = fieldMatches;
      }
    }

    return matches;
  }

  /**
   * Tokenize search query
   * @private
   */
  tokenize(query) {
    // Simple tokenization - split by spaces and remove empty strings
    return query.split(/\s+/).filter(term => term.length > 0);
  }

  /**
   * Calculate Levenshtein distance for fuzzy matching
   * @private
   */
  levenshteinDistance(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix = [];
    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[b.length][a.length];
  }

  /**
   * Sort search results
   * @private
   */
  sortResults(results, sortBy) {
    switch (sortBy) {
      case 'relevance':
        results.sort((a, b) => b.score - a.score);
        break;
      case 'date':
        results.sort((a, b) => a.event.start - b.event.start);
        break;
      case 'title':
        results.sort((a, b) => a.event.title.localeCompare(b.event.title));
        break;
      default:
        // Keep original order
        break;
    }
  }

  /**
   * Ensure the search index is up to date
   * @private
   */
  _ensureIndex() {
    if (this._indexDirty) {
      this.rebuildIndex();
    }
  }

  /**
   * Rebuild search index
   */
  rebuildIndex() {
    this.searchIndex.clear();
    this._indexDirty = false;
    const events = this.eventStore.getAllEvents();

    for (const event of events) {
      for (const field of this.indexFields) {
        const value = event[field];
        if (!value) continue;

        const tokens = this.tokenize(value.toLowerCase());
        for (const token of tokens) {
          if (!this.searchIndex.has(token)) {
            this.searchIndex.set(token, new Set());
          }
          this.searchIndex.get(token).add(event.id);
        }
      }
    }
  }
}
