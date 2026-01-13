/**
 * RecurrenceEngineV2 - Enhanced recurrence engine with advanced features
 * Handles modified instances, complex timezone transitions, and performance optimization
 */

import { TimezoneManager } from '../timezone/TimezoneManager.js';
import { RRuleParser } from './RRuleParser.js';

export class RecurrenceEngineV2 {
  constructor() {
    // Use singleton to share cache across all components
    this.tzManager = TimezoneManager.getInstance();

    // Cache for expanded occurrences
    this.occurrenceCache = new Map();
    this.cacheSize = 100;

    // Modified instances storage
    this.modifiedInstances = new Map(); // eventId -> Map(occurrenceDate -> modifications)

    // Exception storage with reasons
    this.exceptionStore = new Map(); // eventId -> Map(date -> reason)
  }

  /**
   * Expand recurring event with advanced handling
   * @param {Event} event - Recurring event
   * @param {Date} rangeStart - Start of expansion range
   * @param {Date} rangeEnd - End of expansion range
   * @param {Object} options - Expansion options
   * @returns {Array} Expanded occurrences
   */
  expandEvent(event, rangeStart, rangeEnd, options = {}) {
    const {
      maxOccurrences = 365,
      includeModified = true,
      includeCancelled = false,
      timezone = event.timeZone || 'UTC',
      handleDST = true
    } = options;

    // Check cache
    const cacheKey = this.getCacheKey(event.id, rangeStart, rangeEnd, options);
    if (this.occurrenceCache.has(cacheKey)) {
      return this.occurrenceCache.get(cacheKey);
    }

    if (!event.recurring || !event.recurrenceRule) {
      return [this.createOccurrence(event, event.start, event.end)];
    }

    const rule = RRuleParser.parse(event.recurrenceRule);
    const occurrences = [];
    const duration = event.end - event.start;

    // Initialize expansion state
    const state = {
      currentDate: new Date(event.start),
      count: 0,
      tzOffsets: new Map(),
      dstTransitions: []
    };

    // Pre-calculate DST transitions in range
    if (handleDST) {
      state.dstTransitions = this.findDSTTransitions(rangeStart, rangeEnd, timezone);
    }

    // Expand occurrences
    while (state.currentDate <= rangeEnd && state.count < maxOccurrences) {
      if (state.currentDate >= rangeStart) {
        const occurrence = this.generateOccurrence(
          event,
          state.currentDate,
          duration,
          timezone,
          state
        );

        // Check exceptions and modifications
        if (occurrence) {
          const dateKey = this.getDateKey(occurrence.start);

          // Skip if exception
          if (this.isException(event.id, occurrence.start, rule)) {
            if (!includeCancelled) {
              state.currentDate = this.getNextDate(state.currentDate, rule, timezone);
              state.count++;
              continue;
            }
            occurrence.status = 'cancelled';
            occurrence.cancellationReason = this.getExceptionReason(event.id, occurrence.start);
          }

          // Apply modifications if any
          if (includeModified) {
            const modified = this.getModifiedInstance(event.id, occurrence.start);
            if (modified) {
              Object.assign(occurrence, modified);
              occurrence.isModified = true;
            }
          }

          occurrences.push(occurrence);
        }
      }

      // Get next occurrence date
      state.currentDate = this.getNextDate(state.currentDate, rule, timezone, state);
      state.count++;

      // Check COUNT limit
      if (rule.count && state.count >= rule.count) {
        break;
      }

      // Check UNTIL limit
      if (rule.until && state.currentDate > rule.until) {
        break;
      }
    }

    // Cache results
    this.cacheOccurrences(cacheKey, occurrences);

    return occurrences;
  }

  /**
   * Generate a single occurrence with timezone handling
   */
  generateOccurrence(event, date, duration, timezone, state) {
    const start = new Date(date);
    const end = new Date(date.getTime() + duration);

    // Handle DST transitions
    if (state.dstTransitions.length > 0) {
      const adjusted = this.adjustForDST(start, end, timezone, state.dstTransitions);
      start.setTime(adjusted.start.getTime());
      end.setTime(adjusted.end.getTime());
    }

    return {
      id: `${event.id}_${start.getTime()}`,
      recurringEventId: event.id,
      title: event.title,
      start,
      end,
      startUTC: this.tzManager.toUTC(start, timezone),
      endUTC: this.tzManager.toUTC(end, timezone),
      timezone,
      originalStart: event.start,
      allDay: event.allDay,
      description: event.description,
      location: event.location,
      categories: event.categories,
      status: 'confirmed',
      isRecurring: true,
      isModified: false
    };
  }

  /**
   * Get next occurrence date with complex pattern support
   */
  getNextDate(currentDate, rule, timezone, state = {}) {
    const next = new Date(currentDate);

    switch (rule.freq) {
      case 'DAILY':
        return this.getNextDaily(next, rule);

      case 'WEEKLY':
        return this.getNextWeekly(next, rule, timezone);

      case 'MONTHLY':
        return this.getNextMonthly(next, rule, timezone);

      case 'YEARLY':
        return this.getNextYearly(next, rule, timezone);

      case 'HOURLY':
        next.setHours(next.getHours() + rule.interval);
        return next;

      case 'MINUTELY':
        next.setMinutes(next.getMinutes() + rule.interval);
        return next;

      default:
        // Fallback to daily
        next.setDate(next.getDate() + rule.interval);
        return next;
    }
  }

  /**
   * Get next daily occurrence
   */
  getNextDaily(date, rule) {
    const next = new Date(date);
    next.setDate(next.getDate() + rule.interval);

    // Apply BYHOUR, BYMINUTE, BYSECOND if specified
    if (rule.byHour && rule.byHour.length > 0) {
      const currentHour = next.getHours();
      const nextHour = rule.byHour.find(h => h > currentHour);
      if (nextHour !== undefined) {
        next.setHours(nextHour);
      } else {
        // Move to next day and use first hour
        next.setDate(next.getDate() + 1);
        next.setHours(rule.byHour[0]);
      }
    }

    return next;
  }

  /**
   * Get next weekly occurrence with BYDAY support
   */
  getNextWeekly(date, rule, timezone) {
    const next = new Date(date);

    if (rule.byDay && rule.byDay.length > 0) {
      // Find next matching weekday
      const dayMap = {
        SU: 0,
        MO: 1,
        TU: 2,
        WE: 3,
        TH: 4,
        FR: 5,
        SA: 6
      };

      const currentDay = next.getDay();
      let daysToAdd = null;

      // Find next occurrence day
      for (const byDay of rule.byDay) {
        const targetDay = dayMap[byDay.weekday || byDay];
        if (targetDay > currentDay) {
          daysToAdd = targetDay - currentDay;
          break;
        }
      }

      // If no day found in current week, go to next week
      if (daysToAdd === null) {
        const firstDay = dayMap[rule.byDay[0].weekday || rule.byDay[0]];
        daysToAdd = 7 - currentDay + firstDay;

        // Apply interval for weekly recurrence
        if (rule.interval > 1) {
          daysToAdd += 7 * (rule.interval - 1);
        }
      }

      next.setDate(next.getDate() + daysToAdd);
    } else {
      // Simple weekly interval
      next.setDate(next.getDate() + 7 * rule.interval);
    }

    return next;
  }

  /**
   * Get next monthly occurrence with complex patterns
   */
  getNextMonthly(date, rule, timezone) {
    const next = new Date(date);

    if (rule.byMonthDay && rule.byMonthDay.length > 0) {
      // Specific day(s) of month
      const targetDays = rule.byMonthDay.sort((a, b) => a - b);
      const currentDay = next.getDate();

      let targetDay = targetDays.find(d => d > currentDay);
      if (targetDay) {
        // Found a day in current month
        next.setDate(targetDay);
      } else {
        // Move to next month
        next.setMonth(next.getMonth() + rule.interval);

        // Handle negative days (from end of month)
        targetDay = targetDays[0];
        if (targetDay < 0) {
          const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
          next.setDate(lastDay + targetDay + 1);
        } else {
          next.setDate(targetDay);
        }
      }
    } else if (rule.byDay && rule.byDay.length > 0) {
      // Nth weekday of month (e.g., "2nd Tuesday")
      const byDay = rule.byDay[0];
      const nthOccurrence = byDay.nth || 1;

      next.setMonth(next.getMonth() + rule.interval);
      this.setToNthWeekdayOfMonth(next, byDay.weekday, nthOccurrence);
    } else if (rule.bySetPos && rule.bySetPos.length > 0) {
      // BYSETPOS for selecting from set
      next.setMonth(next.getMonth() + rule.interval);
      // Complex BYSETPOS logic would go here
    } else {
      // Same day of next month
      const currentDay = next.getDate();
      next.setMonth(next.getMonth() + rule.interval);

      // Handle month-end edge cases
      const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
      if (currentDay > lastDay) {
        next.setDate(lastDay);
      }
    }

    return next;
  }

  /**
   * Get next yearly occurrence
   */
  getNextYearly(date, rule, timezone) {
    const next = new Date(date);

    if (rule.byMonth && rule.byMonth.length > 0) {
      const currentMonth = next.getMonth();
      const targetMonth = rule.byMonth.find(m => m - 1 > currentMonth);

      if (targetMonth) {
        // Found month in current year
        next.setMonth(targetMonth - 1);
      } else {
        // Move to next year
        next.setFullYear(next.getFullYear() + rule.interval);
        next.setMonth(rule.byMonth[0] - 1);
      }

      // Apply BYMONTHDAY if specified
      if (rule.byMonthDay && rule.byMonthDay.length > 0) {
        next.setDate(rule.byMonthDay[0]);
      }
    } else if (rule.byYearDay && rule.byYearDay.length > 0) {
      // Nth day of year
      next.setFullYear(next.getFullYear() + rule.interval);
      const yearDay = rule.byYearDay[0];

      if (yearDay > 0) {
        // Count from start of year
        next.setMonth(0, 1);
        next.setDate(yearDay);
      } else {
        // Count from end of year
        next.setMonth(11, 31);
        next.setDate(next.getDate() + yearDay + 1);
      }
    } else {
      // Same date next year
      next.setFullYear(next.getFullYear() + rule.interval);
    }

    return next;
  }

  /**
   * Set date to Nth weekday of month
   */
  setToNthWeekdayOfMonth(date, weekday, nth) {
    const dayMap = {
      SU: 0,
      MO: 1,
      TU: 2,
      WE: 3,
      TH: 4,
      FR: 5,
      SA: 6
    };

    const targetDay = dayMap[weekday];
    date.setDate(1); // Start at first of month

    // Find first occurrence
    while (date.getDay() !== targetDay) {
      date.setDate(date.getDate() + 1);
    }

    if (nth > 0) {
      // Nth occurrence from start
      date.setDate(date.getDate() + 7 * (nth - 1));
    } else {
      // Nth occurrence from end
      const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();

      // Find last occurrence
      const temp = new Date(date);
      temp.setDate(lastDay);
      while (temp.getDay() !== targetDay) {
        temp.setDate(temp.getDate() - 1);
      }

      // Move back nth weeks
      temp.setDate(temp.getDate() + 7 * (nth + 1));
      date.setTime(temp.getTime());
    }
  }

  /**
   * Find DST transitions in date range
   */
  findDSTTransitions(start, end, timezone) {
    const transitions = [];
    const current = new Date(start);

    // Check each day for offset changes
    let lastOffset = this.tzManager.getTimezoneOffset(current, timezone);

    while (current <= end) {
      const offset = this.tzManager.getTimezoneOffset(current, timezone);

      if (offset !== lastOffset) {
        transitions.push({
          date: new Date(current),
          oldOffset: lastOffset,
          newOffset: offset,
          type: offset < lastOffset ? 'spring-forward' : 'fall-back'
        });
      }

      lastOffset = offset;
      current.setDate(current.getDate() + 1);
    }

    return transitions;
  }

  /**
   * Adjust occurrence for DST transitions
   */
  adjustForDST(start, end, timezone, transitions) {
    for (const transition of transitions) {
      if (start >= transition.date) {
        const offsetDiff = transition.oldOffset - transition.newOffset;

        // Spring forward: skip the "lost" hour
        if (transition.type === 'spring-forward') {
          const lostHourStart = new Date(transition.date);
          lostHourStart.setHours(2); // Typical transition time
          const lostHourEnd = new Date(lostHourStart);
          lostHourEnd.setHours(3);

          if (start >= lostHourStart && start < lostHourEnd) {
            start.setHours(start.getHours() + 1);
            end.setHours(end.getHours() + 1);
          }
        }
        // Fall back: handle the "repeated" hour
        else if (transition.type === 'fall-back') {
          // Maintain wall clock time
          start.setMinutes(start.getMinutes() - offsetDiff);
          end.setMinutes(end.getMinutes() - offsetDiff);
        }
      }
    }

    return { start, end };
  }

  /**
   * Add or update a modified instance
   */
  addModifiedInstance(eventId, occurrenceDate, modifications) {
    if (!this.modifiedInstances.has(eventId)) {
      this.modifiedInstances.set(eventId, new Map());
    }

    const dateKey = this.getDateKey(occurrenceDate);
    this.modifiedInstances.get(eventId).set(dateKey, {
      ...modifications,
      modifiedAt: new Date()
    });

    // Clear cache for this event
    this.clearEventCache(eventId);
  }

  /**
   * Get modified instance data
   */
  getModifiedInstance(eventId, occurrenceDate) {
    if (!this.modifiedInstances.has(eventId)) {
      return null;
    }

    const dateKey = this.getDateKey(occurrenceDate);
    return this.modifiedInstances.get(eventId).get(dateKey);
  }

  /**
   * Add exception with reason
   */
  addException(eventId, date, reason = 'Cancelled') {
    if (!this.exceptionStore.has(eventId)) {
      this.exceptionStore.set(eventId, new Map());
    }

    const dateKey = this.getDateKey(date);
    this.exceptionStore.get(eventId).set(dateKey, reason);

    // Clear cache
    this.clearEventCache(eventId);
  }

  /**
   * Check if date is an exception
   */
  isException(eventId, date, rule) {
    const dateKey = this.getDateKey(date);

    // Check enhanced exceptions
    if (this.exceptionStore.has(eventId)) {
      if (this.exceptionStore.get(eventId).has(dateKey)) {
        return true;
      }
    }

    // Check rule exceptions
    if (rule && rule.exceptions) {
      return rule.exceptions.some(ex => {
        const exDate = ex instanceof Date ? ex : new Date(ex.date || ex);
        return this.getDateKey(exDate) === dateKey;
      });
    }

    return false;
  }

  /**
   * Get exception reason
   */
  getExceptionReason(eventId, date) {
    if (!this.exceptionStore.has(eventId)) {
      return 'Cancelled';
    }

    const dateKey = this.getDateKey(date);
    return this.exceptionStore.get(eventId).get(dateKey) || 'Cancelled';
  }

  /**
   * Create date key for indexing
   */
  getDateKey(date) {
    const d = date instanceof Date ? date : new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /**
   * Create cache key
   */
  getCacheKey(eventId, start, end, options) {
    return `${eventId}_${start.getTime()}_${end.getTime()}_${JSON.stringify(options)}`;
  }

  /**
   * Cache occurrences
   */
  cacheOccurrences(key, occurrences) {
    this.occurrenceCache.set(key, occurrences);

    // LRU eviction
    if (this.occurrenceCache.size > this.cacheSize) {
      const firstKey = this.occurrenceCache.keys().next().value;
      this.occurrenceCache.delete(firstKey);
    }
  }

  /**
   * Clear cache for specific event
   */
  clearEventCache(eventId) {
    for (const key of this.occurrenceCache.keys()) {
      if (key.startsWith(`${eventId}_`)) {
        this.occurrenceCache.delete(key);
      }
    }
  }

  /**
   * Create occurrence object
   */
  createOccurrence(event, start, end) {
    return {
      id: event.id,
      title: event.title,
      start,
      end,
      allDay: event.allDay,
      description: event.description,
      location: event.location,
      categories: event.categories,
      timezone: event.timeZone,
      isRecurring: false
    };
  }
}

export default RecurrenceEngineV2;
