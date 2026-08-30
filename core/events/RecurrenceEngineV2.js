/**
 * RecurrenceEngineV2 - Enhanced recurrence engine with advanced features
 * Handles modified instances, complex timezone transitions, and performance optimization
 */

import { TimezoneManager } from '../timezone/TimezoneManager.js';
import { RecurrenceEngine } from './RecurrenceEngine.js';
import { RRuleParser } from './RRuleParser.js';

const DAY = 86400000;

// How far ahead of the iteration cursor DST transitions are scanned at a time
const DST_SCAN_CHUNK = 100 * DAY;

export class RecurrenceEngineV2 {
  // Hard limit to prevent resource exhaustion regardless of caller input
  static MAX_OCCURRENCES_HARD_LIMIT = 10000;

  // Hard limit on expansion loop iterations (every occurrence stepped
  // through, inside the range or not) so a rule that cannot be seeked
  // arithmetically still terminates in bounded time
  static MAX_ITERATIONS_HARD_LIMIT = 100000;

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
   *
   * Occurrences before rangeStart are skipped without being generated:
   * daily, weekly, hourly and minutely rules seek straight to the range, so
   * a series that started years before the queried window is expanded at
   * the same cost as one that started yesterday.
   *
   * @param {import('./Event.js').Event} event - Recurring event
   * @param {Date} rangeStart - Start of expansion range
   * @param {Date} rangeEnd - End of expansion range
   * @param {Object} options - Expansion options
   * @param {number} [options.maxOccurrences=365] - Maximum number of occurrences to
   *   return. Only occurrences inside the range count towards this limit.
   * @param {boolean} [options.includeModified=true] - Apply stored instance modifications
   * @param {boolean} [options.includeCancelled=false] - Return exception dates as cancelled occurrences
   * @param {string} [options.timezone] - Timezone for expansion (defaults to the event's)
   * @param {boolean} [options.handleDST=true] - Adjust occurrences across DST transitions
   * @returns {import('../types.js').ExpandedOccurrence[]} Expanded occurrences
   */
  expandEvent(event, rangeStart, rangeEnd, options = {}) {
    const {
      maxOccurrences: requestedMax = 365,
      includeModified = true,
      includeCancelled = false,
      timezone = event.timeZone || 'UTC',
      handleDST = true
    } = options;

    // Enforce hard limit regardless of caller-provided value
    const maxOccurrences = Math.min(requestedMax, RecurrenceEngineV2.MAX_OCCURRENCES_HARD_LIMIT);

    // Check cache
    const cacheKey = this.getCacheKey(event, rangeStart, rangeEnd, options);
    if (this.occurrenceCache.has(cacheKey)) {
      return this.cloneOccurrences(this.occurrenceCache.get(cacheKey));
    }

    if (!event.recurring || !event.recurrenceRule) {
      return this.cloneOccurrences([this.createOccurrence(event, event.start, event.end)]);
    }

    const rule = RRuleParser.parse(event.recurrenceRule);
    const occurrences = [];
    const duration = event.end - event.start;

    // Initialize expansion state. `count` is the number of steps taken from
    // DTSTART, which is what RFC 5545 COUNT measures.
    const state = {
      currentDate: new Date(event.start),
      count: 0,
      tzOffsets: new Map(),
      dstTransitions: [],
      stuckIterations: 0
    };

    // Pre-calculate DST transitions in range
    if (handleDST) {
      state.dstTransitions = this.findDSTTransitions(rangeStart, rangeEnd, timezone);
    }

    this.seekToRange(state, rule, rangeStart, rangeEnd, timezone);

    // Expand occurrences
    let iterations = 0;
    while (
      state.currentDate <= rangeEnd &&
      occurrences.length < maxOccurrences &&
      iterations < RecurrenceEngineV2.MAX_ITERATIONS_HARD_LIMIT
    ) {
      iterations++;
      if (state.currentDate >= rangeStart) {
        const occurrence = this._applyOverrides(
          event,
          this.generateOccurrence(event, state.currentDate, duration, timezone, state),
          rule,
          includeCancelled,
          includeModified
        );
        if (occurrence) {
          occurrences.push(occurrence);
        }
      }

      // Get next occurrence date
      const previousTimestamp = state.currentDate.getTime();
      state.currentDate = this.getNextDate(state.currentDate, rule, timezone, state);
      state.count++;

      if (state.currentDate.getTime() <= previousTimestamp) {
        state.stuckIterations++;
        if (state.stuckIterations >= 3) {
          break;
        }
      } else {
        state.stuckIterations = 0;
      }

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

    return this.cloneOccurrences(occurrences);
  }

  /**
   * Lazily iterate the occurrences of an event in chronological order.
   *
   * Yields what expandEvent returns for the window, one occurrence at a
   * time and without the expansion cache: stored instance modifications
   * and exceptions are applied as each occurrence is produced, so changes
   * made through addModifiedInstance or addException are visible on the
   * next pull. Rules seekToRange can seek (plain daily and weekly, hourly,
   * minutely) jump straight to `after`, and DST transitions are scanned
   * lazily ahead of the cursor instead of for the whole window up front.
   *
   * Both bounds are exclusive unless `inclusive` is set: an occurrence that
   * starts exactly at `after` or `before` is skipped by default, so
   * iterating from a known occurrence's start continues the series without
   * repeating it; with `inclusive: true` the window is closed on both ends
   * like expandEvent's range. A non-recurring event yields its single
   * occurrence when it falls inside the window. Iteration ends at COUNT or
   * UNTIL, at `before`, or — as a guard for rules that produce no
   * occurrences — after MAX_ITERATIONS_HARD_LIMIT consecutive steps
   * without one. The generator is single-use; call again for a fresh one.
   *
   * @example
   * const engine = new RecurrenceEngineV2();
   * for (const occurrence of engine.iterateOccurrences(event, { after: new Date() })) {
   *   if (occurrence.start > deadline) break;
   *   schedule(occurrence);
   * }
   *
   * @param {import('./Event.js').Event} event - The event to iterate
   * @param {import('../types.js').ExpandedOccurrenceIteratorOptions} [options={}] - Window and expansion options
   * @returns {Generator<import('../types.js').ExpandedOccurrence, void, undefined>} Occurrences in chronological order
   * @throws {TypeError} If `after` or `before` is not a valid Date or timestamp
   */
  iterateOccurrences(event, options = {}) {
    const window = RecurrenceEngine._occurrenceWindow(options);
    if (!event.recurring || !event.recurrenceRule) {
      return this._iterateSingle(event, window);
    }
    const {
      includeModified = true,
      includeCancelled = false,
      timezone = event.timeZone || 'UTC',
      handleDST = true
    } = options;
    return this._iterateRule(event, RRuleParser.parse(event.recurrenceRule), window, {
      includeModified,
      includeCancelled,
      timezone,
      handleDST
    });
  }

  /**
   * First occurrence of an event after an instant, or null when the series
   * has no occurrence after it. `after` is exclusive unless
   * `options.inclusive` is set, so passing the start of a known occurrence
   * returns the one that follows it.
   *
   * @example
   * const upcoming = engine.nextOccurrence(event, new Date());
   *
   * @param {import('./Event.js').Event} event - The event to query
   * @param {Date|number} [after=null] - Instant to search from (defaults to the series start)
   * @param {import('../types.js').ExpandedOccurrenceIteratorOptions} [options={}] - Further options
   * @returns {import('../types.js').ExpandedOccurrence|null} The next occurrence, or null
   */
  nextOccurrence(event, after = null, options = {}) {
    for (const occurrence of this.iterateOccurrences(event, { ...options, after })) {
      return occurrence;
    }
    return null;
  }

  /**
   * The first `count` occurrences of an event inside a window, generated
   * lazily so an open-ended series costs only the occurrences taken.
   * `count` is capped at MAX_OCCURRENCES_HARD_LIMIT; fewer are returned
   * when the series or the window ends first.
   *
   * @example
   * const nextFive = engine.takeOccurrences(event, 5, { after: new Date() });
   *
   * @param {import('./Event.js').Event} event - The event to query
   * @param {number} count - Maximum number of occurrences to return (fractions are floored)
   * @param {import('../types.js').ExpandedOccurrenceIteratorOptions} [options={}] - Window and expansion options
   * @returns {import('../types.js').ExpandedOccurrence[]} Up to `count` occurrences in chronological order
   */
  takeOccurrences(event, count, options = {}) {
    const limit = Math.floor(Math.min(count, RecurrenceEngineV2.MAX_OCCURRENCES_HARD_LIMIT));
    const taken = [];
    if (!(limit > 0)) {
      return taken;
    }
    for (const occurrence of this.iterateOccurrences(event, options)) {
      taken.push(occurrence);
      if (taken.length >= limit) {
        break;
      }
    }
    return taken;
  }

  /**
   * Yield a non-recurring event's single occurrence if it starts inside
   * the window
   * @param {import('./Event.js').Event} event - The event
   * @param {{ startMs: number, endMs: number }} window - Inclusive bounds
   * @returns {Generator<import('../types.js').ExpandedOccurrence, void, undefined>}
   * @private
   */
  *_iterateSingle(event, window) {
    const ms = new Date(event.start).getTime();
    if (ms >= window.startMs && ms <= window.endMs) {
      yield this.cloneOccurrence(this.createOccurrence(event, event.start, event.end));
    }
  }

  /**
   * Lazy counterpart of the expandEvent loop: seeks to the window, then
   * steps the cursor and yields each in-window occurrence with the same
   * DST adjustment, exception handling and instance modifications.
   * @private
   */
  *_iterateRule(event, rule, window, options) {
    const { includeModified, includeCancelled, timezone, handleDST } = options;
    const duration = event.end - event.start;
    const state = {
      currentDate: new Date(event.start),
      count: 0,
      tzOffsets: new Map(),
      dstTransitions: [],
      stuckIterations: 0
    };
    if (Number.isNaN(state.currentDate.getTime()) || window.startMs > window.endMs) {
      return;
    }

    // DST transitions are found on the same day grid expandEvent walks,
    // starting from the window start (DTSTART for an open window) and
    // extended in chunks ahead of the cursor
    let dstScan = null;
    if (handleDST) {
      const scanStart = Number.isFinite(window.startMs)
        ? window.startMs
        : state.currentDate.getTime();
      dstScan = { cursor: new Date(scanStart), lastOffset: 0 };
      dstScan.lastOffset = this.tzManager.getTimezoneOffset(dstScan.cursor, timezone);
    }

    if (Number.isFinite(window.startMs)) {
      const rangeStart = new Date(window.startMs);
      this.seekToRange(state, rule, rangeStart, rangeStart, timezone);
    }

    let idleSteps = 0;
    while (state.currentDate.getTime() <= window.endMs) {
      const currentMs = state.currentDate.getTime();
      if (currentMs >= window.startMs) {
        if (dstScan) {
          this._scanDSTTransitions(
            dstScan,
            state.dstTransitions,
            Math.min(currentMs + DST_SCAN_CHUNK, window.endMs),
            timezone
          );
        }
        const occurrence = this._applyOverrides(
          event,
          this.generateOccurrence(event, state.currentDate, duration, timezone, state),
          rule,
          includeCancelled,
          includeModified
        );
        if (occurrence) {
          idleSteps = 0;
          yield this.cloneOccurrence(occurrence);
        }
      }

      state.currentDate = this.getNextDate(state.currentDate, rule, timezone, state);
      state.count++;

      if (state.currentDate.getTime() <= currentMs) {
        state.stuckIterations++;
        if (state.stuckIterations >= 3) {
          return;
        }
      } else {
        state.stuckIterations = 0;
      }

      if (rule.count && state.count >= rule.count) {
        return;
      }
      if (rule.until && state.currentDate > rule.until) {
        return;
      }
      idleSteps++;
      if (idleSteps >= RecurrenceEngineV2.MAX_ITERATIONS_HARD_LIMIT) {
        return;
      }
    }
  }

  /**
   * Apply exceptions and stored instance modifications to a generated
   * occurrence
   * @param {import('./Event.js').Event} event - The recurring event
   * @param {Object} occurrence - Occurrence from generateOccurrence
   * @param {Object} rule - Parsed recurrence rule
   * @param {boolean} includeCancelled - Return exception dates as cancelled occurrences
   * @param {boolean} includeModified - Apply stored instance modifications
   * @returns {Object|null} The occurrence, or null when it is excluded
   * @private
   */
  _applyOverrides(event, occurrence, rule, includeCancelled, includeModified) {
    if (!occurrence) {
      return null;
    }
    if (this.isException(event.id, occurrence.start, rule)) {
      if (!includeCancelled) {
        return null;
      }
      occurrence.status = 'cancelled';
      occurrence.cancellationReason = this.getExceptionReason(event.id, occurrence.start);
    }
    if (includeModified) {
      const modified = this.getModifiedInstance(event.id, occurrence.start);
      if (modified) {
        Object.assign(occurrence, modified);
        occurrence.isModified = true;
      }
    }
    return occurrence;
  }

  /**
   * Move the expansion cursor to the last occurrence before the range
   * without stepping through every occurrence in between.
   *
   * Applies to rules whose step is a fixed duration between system-timezone
   * transitions (plain DAILY and WEEKLY, HOURLY, MINUTELY); the step that
   * crosses a transition is taken with getNextDate so the result is exactly
   * what stepping from DTSTART would produce. Never seeks past UNTIL, and
   * counts skipped steps against COUNT.
   *
   * @param {Object} state - Expansion state (currentDate and count are updated)
   * @param {Object} rule - Parsed recurrence rule
   * @param {Date} rangeStart - Start of expansion range
   * @param {Date} rangeEnd - End of expansion range
   * @param {string} timezone - Expansion timezone
   */
  seekToRange(state, rule, rangeStart, rangeEnd, timezone) {
    const stepMs = this.getFixedStepMs(rule);
    if (stepMs <= 0) {
      return;
    }
    let targetMs = rangeStart.getTime();
    if (rule.until) {
      // Rule objects may carry UNTIL as a string; an unparseable value
      // compares false and leaves the target alone
      const untilMs = new Date(rule.until).getTime();
      if (untilMs < targetMs) {
        targetMs = untilMs;
      }
    }
    const fromMs = state.currentDate.getTime();
    if (!(fromMs < targetMs)) {
      return;
    }
    const seek = RecurrenceEngine._seekFixedStep(
      fromMs,
      targetMs,
      rangeEnd.getTime(),
      stepMs,
      rule.count ? rule.count - 1 : Infinity,
      cursor => cursor.setTime(this.getNextDate(cursor, rule, timezone, state).getTime())
    );
    state.currentDate = new Date(seek.ms);
    state.count = seek.steps;
  }

  /**
   * Milliseconds per step for rules getNextDate advances by a fixed
   * duration while the system UTC offset is constant
   * @param {Object} rule - Parsed recurrence rule
   * @returns {number} Step length in milliseconds, or 0 when not fixed
   */
  getFixedStepMs(rule) {
    const interval = rule.interval;
    if (!Number.isInteger(interval) || interval <= 0) {
      return 0;
    }
    switch (rule.freq) {
      case 'DAILY':
        return rule.byHour && rule.byHour.length > 0 ? 0 : interval * DAY;
      case 'WEEKLY':
        return rule.byDay && rule.byDay.length > 0 ? 0 : 7 * interval * DAY;
      case 'HOURLY':
        return interval * 3600000;
      case 'MINUTELY':
        return interval * 60000;
      default:
        return 0;
    }
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
  getNextDate(currentDate, rule, timezone, _state = {}) {
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
  getNextWeekly(date, rule, _timezone) {
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
  getNextMonthly(date, rule, _timezone) {
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
        targetDay = targetDays[0];
        if (targetDay < 0) {
          // Counted from the end of the month (-1 is the last day). Move to
          // the first so the month step cannot overflow from a 31st.
          next.setDate(1);
          next.setMonth(next.getMonth() + rule.interval);
          const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
          next.setDate(Math.max(1, lastDay + targetDay + 1));
        } else {
          // Move to next month
          next.setMonth(next.getMonth() + rule.interval);
          next.setDate(targetDay);
        }
      }
    } else if (rule.byDay && rule.byDay.length > 0) {
      // Nth weekday of month (e.g., "2nd Tuesday")
      const byDay = rule.byDay[0];
      let weekday, nthOccurrence;

      if (typeof byDay === 'string') {
        // Parse string format from RRuleParser: "MO", "2TU", "-1FR"
        const match = byDay.match(/^(-?\d*)([A-Z]{2})$/);
        weekday = match ? match[2] : byDay;
        nthOccurrence = match && match[1] ? parseInt(match[1], 10) : 1;
      } else {
        weekday = byDay.weekday;
        nthOccurrence = byDay.nth || 1;
      }

      next.setMonth(next.getMonth() + rule.interval);
      this.setToNthWeekdayOfMonth(next, weekday, nthOccurrence);
    } else if (rule.bySetPos && rule.bySetPos.length > 0) {
      // BYSETPOS selects from the set of candidates generated by other BY* rules
      next.setMonth(next.getMonth() + rule.interval);
      next.setDate(1);

      const dayMap = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
      const candidates = [];

      if (rule.byDay && rule.byDay.length > 0) {
        // Generate all matching weekday occurrences in the month
        const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
        for (let d = 1; d <= lastDay; d++) {
          const date = new Date(next.getFullYear(), next.getMonth(), d);
          const dayOfWeek = date.getDay();
          for (const byDay of rule.byDay) {
            const dayStr = typeof byDay === 'string' ? byDay.replace(/^-?\d+/, '') : byDay.weekday;
            if (dayMap[dayStr] === dayOfWeek) {
              candidates.push(d);
              break;
            }
          }
        }
      }

      // Apply BYSETPOS indices (1-based, negative from end)
      const selectedDays = [];
      for (const pos of rule.bySetPos) {
        const index = pos > 0 ? pos - 1 : candidates.length + pos;
        if (index >= 0 && index < candidates.length) {
          selectedDays.push(candidates[index]);
        }
      }

      if (selectedDays.length > 0) {
        next.setDate(selectedDays[0]);
      }
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
  getNextYearly(date, rule, _timezone) {
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
    const scan = { cursor: new Date(start), lastOffset: 0 };
    scan.lastOffset = this.tzManager.getTimezoneOffset(scan.cursor, timezone);
    this._scanDSTTransitions(scan, transitions, new Date(end).getTime(), timezone);
    return transitions;
  }

  /**
   * Walk the scan cursor one day at a time up to untilMs, appending each
   * offset change. The cursor and last offset persist in `scan`, so the
   * walk can be resumed later on the same day grid.
   * @param {{ cursor: Date, lastOffset: number }} scan - Resumable scan position (mutated)
   * @param {Array} transitions - Transition list to append to
   * @param {number} untilMs - Scan through this timestamp (inclusive)
   * @param {string} timezone - Timezone to probe
   * @private
   */
  _scanDSTTransitions(scan, transitions, untilMs, timezone) {
    while (scan.cursor.getTime() <= untilMs) {
      const offset = this.tzManager.getTimezoneOffset(scan.cursor, timezone);

      if (offset !== scan.lastOffset) {
        transitions.push({
          date: new Date(scan.cursor),
          oldOffset: scan.lastOffset,
          newOffset: offset,
          type: offset < scan.lastOffset ? 'spring-forward' : 'fall-back'
        });
      }

      scan.lastOffset = offset;
      scan.cursor.setDate(scan.cursor.getDate() + 1);
    }
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
   *
   * When given the event itself the key also covers everything the
   * expansion depends on (DTSTART, end, recurrence rule), so a series that
   * is updated, replaced or re-added under the same id can never be served
   * a stale expansion. Keys always start with `<eventId>_`, which is what
   * {@link RecurrenceEngineV2#clearEventCache} matches on.
   * @param {import('./Event.js').Event|string} event - Recurring event, or just its id
   * @param {Date} start - Start of expansion range
   * @param {Date} end - End of expansion range
   * @param {Object} options - Expansion options
   * @returns {string} Cache key
   */
  getCacheKey(event, start, end, options) {
    const eventId = typeof event === 'string' ? event : event.id;
    const key = `${eventId}_${start.getTime()}_${end.getTime()}_${JSON.stringify(options)}`;
    if (typeof event === 'string') {
      return key;
    }
    const startMs = new Date(event.start).getTime();
    const endMs = new Date(event.end).getTime();
    return `${key}|${startMs}|${endMs}|${this._ruleFingerprint(event.recurrenceRule)}`;
  }

  /**
   * Stable text form of a recurrence rule for cache keys. A rule that
   * cannot be serialised gets a unique fingerprint, i.e. is never cached.
   * @param {string|Object} rule - RRULE string or rule object
   * @returns {string} Fingerprint
   * @private
   */
  _ruleFingerprint(rule) {
    if (typeof rule === 'string') {
      return rule;
    }
    try {
      return JSON.stringify(rule);
    } catch {
      return `uncacheable:${Date.now()}:${Math.random()}`;
    }
  }

  /**
   * Cache occurrences
   */
  cacheOccurrences(key, occurrences) {
    this.occurrenceCache.set(key, this.cloneOccurrences(occurrences));

    // LRU eviction
    if (this.occurrenceCache.size > this.cacheSize) {
      const firstKey = this.occurrenceCache.keys().next().value;
      this.occurrenceCache.delete(firstKey);
    }
  }

  /**
   * Clone occurrence results before returning or caching.
   */
  cloneOccurrences(occurrences) {
    return occurrences.map(occurrence => this.cloneOccurrence(occurrence));
  }

  /**
   * Clone a single occurrence, copying its Date and array fields.
   * @param {import('../types.js').ExpandedOccurrence} occurrence - Occurrence to clone
   * @returns {import('../types.js').ExpandedOccurrence} Independent copy
   */
  cloneOccurrence(occurrence) {
    return {
      ...occurrence,
      start: occurrence.start ? new Date(occurrence.start) : occurrence.start,
      end: occurrence.end ? new Date(occurrence.end) : occurrence.end,
      startUTC: occurrence.startUTC ? new Date(occurrence.startUTC) : occurrence.startUTC,
      endUTC: occurrence.endUTC ? new Date(occurrence.endUTC) : occurrence.endUTC,
      originalStart: occurrence.originalStart
        ? new Date(occurrence.originalStart)
        : occurrence.originalStart,
      categories: Array.isArray(occurrence.categories)
        ? [...occurrence.categories]
        : occurrence.categories
    };
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
