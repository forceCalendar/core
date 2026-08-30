import { DateUtils } from '../calendar/DateUtils.js';
import { TimezoneManager } from '../timezone/TimezoneManager.js';
import { RRuleParser } from './RRuleParser.js';

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * RecurrenceEngine - Handles expansion of recurring events
 * Full support for RFC 5545 (iCalendar) RRULE specification
 */
export class RecurrenceEngine {
  // Hard limit to prevent resource exhaustion regardless of caller input
  static MAX_OCCURRENCES_HARD_LIMIT = 10000;

  // Hard limit on expansion loop iterations (every occurrence stepped
  // through, inside the range or not) so a rule that cannot be seeked
  // arithmetically still terminates in bounded time
  static MAX_ITERATIONS_HARD_LIMIT = 100000;

  // expandEvent is typically called many times with the same RRULE string
  // (every view render), so parsed rules are cached by their source string
  static _ruleCache = new Map();
  static _RULE_CACHE_MAX = 500;

  /**
   * Expand a recurring event into individual occurrences
   *
   * Occurrences before rangeStart are skipped without being generated:
   * daily, weekly and sub-daily rules seek straight to the range, so the
   * cost of a query does not grow with the age of the series, and a series
   * that started years before the queried window is still expanded.
   *
   * @param {import('./Event.js').Event} event - The recurring event
   * @param {Date} rangeStart - Start of the expansion range
   * @param {Date} rangeEnd - End of the expansion range
   * @param {number} [maxOccurrences=365] - Maximum number of occurrences to return.
   *   Only occurrences inside the range count towards this limit; occurrences
   *   between the series start and rangeStart do not consume it.
   * @param {string} [timezone] - Timezone for expansion (important for DST)
   * @returns {import('../types.js').EventOccurrence[]} Array of occurrence objects with start/end dates
   */
  static expandEvent(event, rangeStart, rangeEnd, maxOccurrences = 365, timezone = null) {
    // Enforce hard limit regardless of caller-provided value
    maxOccurrences = Math.min(maxOccurrences, RecurrenceEngine.MAX_OCCURRENCES_HARD_LIMIT);
    if (!event.recurring || !event.recurrenceRule) {
      return [{ start: event.start, end: event.end, timezone: event.timeZone }];
    }

    const rule = this._getParsedRule(event.recurrenceRule);
    const duration = event.end - event.start;
    const eventTimezone = timezone || event.timeZone || 'UTC';
    const tzManager = TimezoneManager.getInstance();

    // If UNTIL is specified, use it as the range end
    if (rule.until && rule.until < rangeEnd) {
      rangeEnd = rule.until;
    }

    // DAILY and WEEKLY series iterate on numeric timestamps (no Date
    // arithmetic per step); other frequencies use the general loop
    let occurrences = null;
    if (rule.freq === 'DAILY' || rule.freq === 'WEEKLY') {
      occurrences = this._expandFast(
        event,
        rule,
        rangeStart.getTime(),
        rangeEnd.getTime(),
        maxOccurrences,
        eventTimezone,
        tzManager,
        duration
      );
    }
    if (!occurrences) {
      occurrences = this._expandGeneral(
        event,
        rule,
        rangeStart.getTime(),
        rangeEnd.getTime(),
        maxOccurrences,
        eventTimezone,
        tzManager,
        duration
      );
    }

    // Apply BYSETPOS filtering if present and not already handled by MONTHLY+byDay
    if (rule.bySetPos && rule.bySetPos.length > 0 && rule.freq !== 'MONTHLY') {
      return this._applyBySetPos(occurrences, rule);
    }

    return occurrences;
  }

  /**
   * Lazily iterate the occurrences of an event in chronological order.
   *
   * Yields the same occurrence objects, in the same order, that expandEvent
   * returns for the window — but one at a time, so a caller can stop after
   * any number of them without the rest of the series being generated.
   * Daily, weekly and sub-daily rules are seeked to `after` arithmetically,
   * so finding the first occurrence after a far-away instant does not step
   * through the series from its start.
   *
   * Both bounds are exclusive unless `inclusive` is set: an occurrence that
   * starts exactly at `after` or `before` is skipped by default, which lets
   * `iterateOccurrences(event, { after: previous.start })` continue a series
   * without repeating `previous`. With `inclusive: true` the window is
   * closed on both ends, exactly like expandEvent's range. An omitted bound
   * leaves that end of the window open.
   *
   * COUNT, UNTIL, INTERVAL, BYDAY/BYMONTHDAY/BYSETPOS and exception dates
   * are honoured as in expandEvent; BYSETPOS rules are yielded one period at
   * a time, since the set positions of a period are only known once it is
   * complete. A non-recurring event yields its single occurrence when it
   * falls inside the window. Iteration ends at COUNT or UNTIL, at `before`,
   * or — as a guard for rules that produce no occurrences — after
   * MAX_ITERATIONS_HARD_LIMIT consecutive steps without one.
   *
   * The generator is single-use; call this method again for a fresh one.
   *
   * @example
   * for (const occurrence of RecurrenceEngine.iterateOccurrences(event, { after: new Date() })) {
   *   if (occurrence.start > deadline) break;
   *   schedule(occurrence);
   * }
   *
   * @param {import('./Event.js').Event} event - The event to iterate
   * @param {import('../types.js').OccurrenceIteratorOptions} [options={}] - Window and timezone
   * @returns {Generator<import('../types.js').EventOccurrence, void, undefined>} Occurrences in chronological order
   * @throws {TypeError} If `after` or `before` is not a valid Date or timestamp
   */
  static iterateOccurrences(event, options = {}) {
    const window = this._occurrenceWindow(options);
    if (!event.recurring || !event.recurrenceRule) {
      return this._iterateSingle(
        { start: event.start, end: event.end, timezone: event.timeZone },
        window
      );
    }

    const rule = this._getParsedRule(event.recurrenceRule);
    let rangeEndMs = window.endMs;
    // Same UNTIL clamp as expandEvent (a non-Date UNTIL compares false)
    if (rule.until && rule.until < rangeEndMs) {
      rangeEndMs = rule.until.valueOf();
    }

    let occurrences = this._iterateRule(
      event,
      rule,
      window.startMs,
      rangeEndMs,
      options.timezone || event.timeZone || 'UTC',
      TimezoneManager.getInstance(),
      event.end - event.start
    );
    if (rule.bySetPos && rule.bySetPos.length > 0 && rule.freq !== 'MONTHLY') {
      occurrences = this._iterateBySetPos(occurrences, rule);
    }
    return occurrences;
  }

  /**
   * First occurrence of an event after an instant, or null when the series
   * has no occurrence after it (past COUNT or UNTIL, or a non-recurring
   * event that already started).
   *
   * `after` is exclusive unless `options.inclusive` is set, so passing the
   * start of a known occurrence returns the one that follows it. Not to be
   * confused with getNextOccurrence, which steps a parsed rule once
   * without regard to COUNT, UNTIL or exceptions.
   *
   * @example
   * const upcoming = RecurrenceEngine.nextOccurrence(event, new Date());
   *
   * @param {import('./Event.js').Event} event - The event to query
   * @param {Date|number} [after=null] - Instant to search from (defaults to the series start)
   * @param {import('../types.js').OccurrenceIteratorOptions} [options={}] - Further window options
   * @returns {import('../types.js').EventOccurrence|null} The next occurrence, or null
   */
  static nextOccurrence(event, after = null, options = {}) {
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
   * const nextFive = RecurrenceEngine.takeOccurrences(event, 5, { after: new Date() });
   *
   * @param {import('./Event.js').Event} event - The event to query
   * @param {number} count - Maximum number of occurrences to return
   * @param {import('../types.js').OccurrenceIteratorOptions} [options={}] - Window and timezone
   * @returns {import('../types.js').EventOccurrence[]} Up to `count` occurrences in chronological order
   */
  static takeOccurrences(event, count, options = {}) {
    const limit = Math.min(count, RecurrenceEngine.MAX_OCCURRENCES_HARD_LIMIT);
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
   * Resolve iterator options into a closed window on numeric timestamps.
   * Exclusive bounds are shifted by one millisecond, the resolution of
   * Date, so the expansion loops only ever compare inclusively.
   * @param {import('../types.js').OccurrenceIteratorOptions} options - Iterator options
   * @returns {{ startMs: number, endMs: number }} Inclusive bounds (infinite when open)
   * @throws {TypeError} If a bound is not a valid Date or timestamp
   * @private
   */
  static _occurrenceWindow(options) {
    const { after = null, before = null, inclusive = false } = options;
    const shift = inclusive ? 0 : 1;
    return {
      startMs: after == null ? -Infinity : this._boundMs(after, 'after') + shift,
      endMs: before == null ? Infinity : this._boundMs(before, 'before') - shift
    };
  }

  /**
   * Timestamp of a window bound given as a Date or a number
   * @param {Date|number} value - Bound to convert
   * @param {string} name - Option name for the error message
   * @returns {number} Timestamp in milliseconds
   * @throws {TypeError} If the value is not a valid Date or timestamp
   * @private
   */
  static _boundMs(value, name) {
    const ms = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : NaN;
    if (Number.isNaN(ms)) {
      throw new TypeError(`RecurrenceEngine: ${name} must be a valid Date or timestamp`);
    }
    return ms;
  }

  /**
   * Yield a single occurrence if it starts inside the window
   * @param {import('../types.js').EventOccurrence} occurrence - The occurrence
   * @param {{ startMs: number, endMs: number }} window - Inclusive bounds
   * @returns {Generator<import('../types.js').EventOccurrence, void, undefined>}
   * @private
   */
  static *_iterateSingle(occurrence, window) {
    const ms = new Date(occurrence.start).getTime();
    if (ms >= window.startMs && ms <= window.endMs) {
      yield occurrence;
    }
  }

  /**
   * Lazy counterpart of the expansion loops: seeks to the window, then
   * advances a Date cursor per step and yields each in-window occurrence,
   * applying the same DST adjustment and exception filtering.
   * @private
   */
  static *_iterateRule(event, rule, rangeStartMs, rangeEndMs, eventTimezone, tzManager, duration) {
    const currentDate = new Date(event.start);
    let currentMs = currentDate.getTime();
    if (Number.isNaN(currentMs) || rangeStartMs > rangeEndMs) {
      return;
    }
    // Steps taken from DTSTART, which is what COUNT measures
    let count = 0;
    let lastOffset = tzManager.getTimezoneOffset(currentDate, eventTimezone);
    const hasExceptions = !!(rule.exceptions && rule.exceptions.length > 0);

    if (currentMs < rangeStartMs) {
      const seek = this._seekToWindow(currentMs, currentDate.getDay(), rule, rangeStartMs);
      if (seek) {
        currentMs = seek.ms;
        count = seek.steps;
        currentDate.setTime(currentMs);
      }
    }

    let stuckCount = 0;
    let idleSteps = 0;
    while (currentMs <= rangeEndMs) {
      if (currentMs >= rangeStartMs) {
        const occurrenceStart = new Date(currentMs);
        const occurrenceEnd = new Date(currentMs + duration);

        const currentOffset = tzManager.getTimezoneOffset(occurrenceStart, eventTimezone);
        if (currentOffset !== lastOffset) {
          const offsetDiff = lastOffset - currentOffset;
          occurrenceStart.setMinutes(occurrenceStart.getMinutes() + offsetDiff);
          occurrenceEnd.setMinutes(occurrenceEnd.getMinutes() + offsetDiff);
        }
        lastOffset = currentOffset;

        if (!hasExceptions || !this.isException(occurrenceStart, rule, event.id)) {
          idleSteps = 0;
          yield {
            start: occurrenceStart,
            end: occurrenceEnd,
            recurringEventId: event.id,
            timezone: eventTimezone,
            originalStart: event.start
          };
        }
      }

      if (rule.count && count + 1 >= rule.count) {
        return;
      }

      this._advanceInPlace(currentDate, rule);
      const previousMs = currentMs;
      currentMs = currentDate.getTime();
      count++;

      if (currentMs === previousMs) {
        stuckCount++;
        if (stuckCount >= 3) {
          console.warn('RecurrenceEngine: Date not advancing, breaking to prevent infinite loop');
          return;
        }
      } else {
        stuckCount = 0;
      }

      idleSteps++;
      if (idleSteps >= RecurrenceEngine.MAX_ITERATIONS_HARD_LIMIT) {
        return;
      }
    }
  }

  /**
   * Seek the iteration cursor to the last occurrence before rangeStartMs
   * using the same arithmetic as expandEvent. The system-transition scan
   * is bounded by the target itself, so an open-ended window costs no
   * more than a closed one.
   * @param {number} fromMs - Cursor position (DTSTART)
   * @param {number} weekday - Weekday of the cursor
   * @param {Object} rule - Parsed recurrence rule
   * @param {number} rangeStartMs - Seek target
   * @returns {{ ms: number, steps: number }|null} New cursor, or null for rules that cannot seek
   * @private
   */
  static _seekToWindow(fromMs, weekday, rule, rangeStartMs) {
    const maxSteps = rule.count ? rule.count - 1 : Infinity;
    if (rule.freq === 'WEEKLY' && rule.byDay && rule.byDay.length > 0) {
      const daySet = rule._byDaySet || (rule._byDaySet = this._buildByDaySet(rule.byDay));
      if (daySet.size === 0) {
        return null;
      }
      rule._byDayDeltas = rule._byDayDeltas || this._buildByDayDeltas(daySet);
      return this._seekWeekCycle(fromMs, weekday, rangeStartMs, rangeStartMs, rule, maxSteps);
    }
    const stepMs = this._seekStepMs(rule);
    if (stepMs <= 0) {
      return null;
    }
    return this._seekFixedStep(fromMs, rangeStartMs, rangeStartMs, stepMs, maxSteps, cursor =>
      this._advanceInPlace(cursor, rule)
    );
  }

  /**
   * Milliseconds per _advanceInPlace step for every rule whose step is a
   * fixed duration between system-timezone transitions: the sub-daily
   * frequencies, DAILY and plain WEEKLY
   * @param {Object} rule - Parsed recurrence rule
   * @returns {number} Step length in milliseconds, or 0 when not fixed
   * @private
   */
  static _seekStepMs(rule) {
    const interval = rule.interval;
    if (!Number.isInteger(interval) || interval <= 0) {
      return 0;
    }
    if (rule.freq === 'DAILY') {
      return interval * 86400000;
    }
    if (rule.freq === 'WEEKLY') {
      return 7 * interval * 86400000;
    }
    return this._fixedStepMs(rule);
  }

  /**
   * Streaming BYSETPOS filter: buffers the occurrences of one period and
   * yields its selected positions once the next period begins. Periods
   * arrive contiguously and in order, so the result matches _applyBySetPos.
   * @param {Iterable<import('../types.js').EventOccurrence>} source - Occurrences in order
   * @param {Object} rule - Rule with bySetPos
   * @returns {Generator<import('../types.js').EventOccurrence, void, undefined>}
   * @private
   */
  static *_iterateBySetPos(source, rule) {
    let key = null;
    let group = [];
    for (const occurrence of source) {
      const occurrenceKey = this._bySetPosKey(occurrence, rule);
      if (occurrenceKey !== key && group.length > 0) {
        yield* this._selectBySetPos(group, rule).sort((a, b) => a.start - b.start);
        group = [];
      }
      key = occurrenceKey;
      group.push(occurrence);
    }
    if (group.length > 0) {
      yield* this._selectBySetPos(group, rule).sort((a, b) => a.start - b.start);
    }
  }

  /**
   * General expansion loop: advances a Date cursor per step. Handles every
   * frequency and degenerate rules (non-advancing dates, invalid intervals).
   * @private
   */
  static _expandGeneral(
    event,
    rule,
    rangeStartMs,
    rangeEndMs,
    maxOccurrences,
    eventTimezone,
    tzManager,
    duration
  ) {
    const occurrences = [];

    // Work in event's timezone for accurate recurrence calculation
    const currentDate = new Date(event.start);
    // Steps taken from DTSTART: RFC 5545 COUNT is measured from there,
    // independent of how many occurrences fall inside the range
    let count = 0;

    // Track DST transitions for proper timezone handling
    let lastOffset = tzManager.getTimezoneOffset(currentDate, eventTimezone);

    // Track stuck iterations to detect infinite loop (date not advancing)
    let stuckCount = 0;
    const maxStuckIterations = 3;

    // Compare on numeric timestamps in the loop — Date-object comparisons
    // re-coerce through valueOf on every check
    const hasExceptions = !!(rule.exceptions && rule.exceptions.length > 0);
    let currentMs = currentDate.getTime();

    // Sub-daily rules step a fixed number of milliseconds, so the span
    // before the range is skipped arithmetically instead of one step at a
    // time; other frequencies take few enough steps per year to just walk
    const stepMs = this._fixedStepMs(rule);
    if (stepMs > 0 && currentMs < rangeStartMs) {
      const seek = this._seekFixedStep(
        currentMs,
        rangeStartMs,
        rangeEndMs,
        stepMs,
        rule.count ? rule.count - 1 : Infinity,
        cursor => this._advanceInPlace(cursor, rule)
      );
      currentMs = seek.ms;
      count = seek.steps;
      currentDate.setTime(currentMs);
    }

    let iterations = 0;
    while (
      currentMs <= rangeEndMs &&
      occurrences.length < maxOccurrences &&
      iterations < RecurrenceEngine.MAX_ITERATIONS_HARD_LIMIT
    ) {
      iterations++;
      // Check if this occurrence is within the range
      if (currentMs >= rangeStartMs) {
        const occurrenceStart = new Date(currentMs);
        const occurrenceEnd = new Date(currentMs + duration);

        // Handle DST transitions
        const currentOffset = tzManager.getTimezoneOffset(occurrenceStart, eventTimezone);
        if (currentOffset !== lastOffset) {
          // Adjust for DST change
          const offsetDiff = lastOffset - currentOffset;
          occurrenceStart.setMinutes(occurrenceStart.getMinutes() + offsetDiff);
          occurrenceEnd.setMinutes(occurrenceEnd.getMinutes() + offsetDiff);
        }
        lastOffset = currentOffset;

        // Apply exceptions if any
        if (!hasExceptions || !this.isException(occurrenceStart, rule, event.id)) {
          occurrences.push({
            start: occurrenceStart,
            end: occurrenceEnd,
            recurringEventId: event.id,
            timezone: eventTimezone,
            originalStart: event.start
          });
        }
      }

      // Calculate next occurrence
      this._advanceInPlace(currentDate, rule);
      const previousTimestamp = currentMs;
      currentMs = currentDate.getTime();
      count++;

      // Safeguard: detect if date is not advancing (infinite loop risk)
      if (currentMs === previousTimestamp) {
        stuckCount++;
        if (stuckCount >= maxStuckIterations) {
          console.warn('RecurrenceEngine: Date not advancing, breaking to prevent infinite loop');
          break;
        }
      } else {
        stuckCount = 0;
      }

      // Check COUNT limit
      if (rule.count && count >= rule.count) {
        break;
      }
    }

    return occurrences;
  }

  /**
   * Numeric expansion loop for DAILY and WEEKLY rules.
   *
   * Between DST transitions a wall-clock-preserving day step is a constant
   * number of milliseconds, so the loop is pure numeric addition. Transition
   * instants — in the system timezone (which defines Date arithmetic) and in
   * the event's timezone (which drives occurrence adjustment) — are
   * discovered by binary search and cached, so only the one step that
   * crosses a transition falls back to Date arithmetic, and only the first
   * occurrence after a transition queries a timezone offset.
   *
   * Produces output identical to _expandGeneral for the rules it accepts;
   * returns null to delegate anything it cannot handle exactly.
   * @private
   */
  static _expandFast(
    event,
    rule,
    rangeStartMs,
    rangeEndMs,
    maxOccurrences,
    eventTimezone,
    tzManager,
    duration
  ) {
    const DAY = 86400000;
    let dayDeltas = null;
    let stepDays = 0;
    let weekday = 0;

    const startDate = new Date(event.start);
    if (rule.freq === 'WEEKLY' && rule.byDay && rule.byDay.length > 0) {
      const daySet = rule._byDaySet || (rule._byDaySet = this._buildByDaySet(rule.byDay));
      if (daySet.size === 0) {
        return null; // invalid byDay — general loop handles the fallback warning
      }
      dayDeltas = rule._byDayDeltas || (rule._byDayDeltas = this._buildByDayDeltas(daySet));
      weekday = startDate.getDay();
    } else {
      stepDays = (rule.freq === 'DAILY' ? 1 : 7) * rule.interval;
      if (!Number.isInteger(stepDays) || stepDays <= 0) {
        return null; // degenerate interval — general loop's stuck detection applies
      }
    }

    const occurrences = [];
    let currentMs = startDate.getTime();
    if (Number.isNaN(currentMs)) {
      return null;
    }
    let count = 0;
    const hasExceptions = !!(rule.exceptions && rule.exceptions.length > 0);

    let lastOffset = tzManager.getTimezoneOffset(startDate, eventTimezone);
    let nextEventTzTransition = tzManager.getNextTransition(eventTimezone, currentMs, rangeEndMs);
    let nextSystemTransition = this._nextSystemTransition(currentMs, rangeEndMs);

    // Seek to the last occurrence before the range. nextEventTzTransition is
    // deliberately left as computed from DTSTART: if the seek passed an
    // event-timezone transition, the first in-range occurrence must still
    // compare its offset with lastOffset, exactly as the general loop does.
    if (currentMs < rangeStartMs) {
      const maxSteps = rule.count ? rule.count - 1 : Infinity;
      const seek = dayDeltas
        ? this._seekWeekCycle(currentMs, weekday, rangeStartMs, rangeEndMs, rule, maxSteps)
        : this._seekFixedStep(
            currentMs,
            rangeStartMs,
            rangeEndMs,
            stepDays * DAY,
            maxSteps,
            cursor => cursor.setDate(cursor.getDate() + stepDays)
          );
      currentMs = seek.ms;
      count = seek.steps;
      nextSystemTransition = seek.nextSystemTransition;
      if (dayDeltas) {
        weekday = seek.weekday;
      }
    }

    let iterations = 0;
    while (
      currentMs <= rangeEndMs &&
      occurrences.length < maxOccurrences &&
      iterations < RecurrenceEngine.MAX_ITERATIONS_HARD_LIMIT
    ) {
      iterations++;
      if (currentMs >= rangeStartMs) {
        const occurrenceStart = new Date(currentMs);
        const occurrenceEnd = new Date(currentMs + duration);

        // Only the first occurrence past a transition needs an offset check
        if (currentMs >= nextEventTzTransition) {
          const currentOffset = tzManager.getTimezoneOffset(occurrenceStart, eventTimezone);
          if (currentOffset !== lastOffset) {
            const offsetDiff = lastOffset - currentOffset;
            occurrenceStart.setMinutes(occurrenceStart.getMinutes() + offsetDiff);
            occurrenceEnd.setMinutes(occurrenceEnd.getMinutes() + offsetDiff);
            lastOffset = currentOffset;
          }
          nextEventTzTransition = tzManager.getNextTransition(eventTimezone, currentMs, rangeEndMs);
        }

        if (!hasExceptions || !this.isException(occurrenceStart, rule, event.id)) {
          occurrences.push({
            start: occurrenceStart,
            end: occurrenceEnd,
            recurringEventId: event.id,
            timezone: eventTimezone,
            originalStart: event.start
          });
        }
      }

      // Advance: pure addition unless the step crosses a system-timezone
      // transition, where Date arithmetic reproduces wall-clock semantics
      const days = dayDeltas ? dayDeltas[weekday] : stepDays;
      if (dayDeltas) {
        weekday = (weekday + days) % 7;
      }
      const naiveMs = currentMs + days * DAY;
      if (naiveMs >= nextSystemTransition) {
        const cursor = new Date(currentMs);
        cursor.setDate(cursor.getDate() + days);
        currentMs = cursor.getTime();
        nextSystemTransition = this._nextSystemTransition(currentMs, rangeEndMs);
      } else {
        currentMs = naiveMs;
      }
      count++;

      if (rule.count && count >= rule.count) {
        break;
      }
    }

    return occurrences;
  }

  /**
   * Milliseconds per step for rules whose step is a fixed duration while
   * the system UTC offset is constant. Only the sub-daily frequencies are
   * reported here: DAILY and WEEKLY have their own numeric loop, and the
   * calendar-based frequencies take too few steps per year to need seeking.
   * @param {Object} rule - Parsed recurrence rule
   * @returns {number} Step length in milliseconds, or 0 when not fixed
   * @private
   */
  static _fixedStepMs(rule) {
    const interval = rule.interval;
    if (!Number.isInteger(interval) || interval <= 0) {
      return 0;
    }
    switch (rule.freq) {
      case 'SECONDLY':
        return interval * 1000;
      case 'MINUTELY':
        return interval * 60000;
      case 'HOURLY':
        return interval * 3600000;
      default:
        return 0;
    }
  }

  /**
   * Skip the occurrences of a fixed-step rule that fall before
   * rangeStartMs without visiting each one.
   *
   * While the system UTC offset is constant, a wall-clock step of the
   * cursor is a constant number of milliseconds, so a whole run of steps
   * collapses into one multiplication. The single step that crosses a
   * system-timezone transition is taken with `advance` instead, so the
   * cursor ends up exactly where stepping every occurrence would have put
   * it. Stops at the last occurrence before rangeStartMs; the caller's loop
   * takes the step into the range.
   *
   * @param {number} fromMs - Cursor position (an occurrence instant)
   * @param {number} rangeStartMs - Seek target
   * @param {number} rangeEndMs - Upper bound for transition lookup
   * @param {number} stepMs - Step length while the UTC offset is constant
   * @param {number} maxSteps - Steps still permitted under COUNT (Infinity if unbounded)
   * @param {(cursor: Date) => void} advance - Wall-clock step, mutating the cursor
   * @returns {{ ms: number, steps: number, nextSystemTransition: number }}
   *   Cursor position, steps taken and the next system transition after it
   * @private
   */
  static _seekFixedStep(fromMs, rangeStartMs, rangeEndMs, stepMs, maxSteps, advance) {
    let ms = fromMs;
    let steps = 0;
    let nextSystemTransition = this._nextSystemTransition(ms, rangeEndMs);
    if (!Number.isFinite(rangeStartMs) || !(stepMs > 0)) {
      return { ms, steps, nextSystemTransition };
    }
    // Comparisons are written so an invalid (NaN) cursor ends the seek
    while (ms < rangeStartMs && steps < maxSteps) {
      const limit = Math.min(rangeStartMs, nextSystemTransition);
      // Largest k with ms + k * stepMs < limit
      let k = Math.ceil((limit - ms) / stepMs) - 1;
      if (ms + k * stepMs >= limit) {
        k--; // division rounded up
      }
      k = Math.min(k, maxSteps - steps);
      if (k > 0) {
        ms += k * stepMs;
        steps += k;
        continue;
      }
      if (ms + stepMs >= rangeStartMs) {
        break; // next step lands in the range
      }
      // Next step crosses a system-timezone transition
      const cursor = new Date(ms);
      advance(cursor);
      ms = cursor.getTime();
      steps++;
      nextSystemTransition = this._nextSystemTransition(ms, rangeEndMs);
    }
    return { ms, steps, nextSystemTransition };
  }

  /**
   * Seek for WEEKLY BYDAY rules, whose step pattern repeats every week:
   * whole weeks are skipped arithmetically from any weekday in the BYDAY
   * set, and single steps (identical to the expansion loop's) are only
   * taken to reach the set, around system-timezone transitions and in the
   * last week before the range.
   *
   * @param {number} fromMs - Cursor position (an occurrence instant)
   * @param {number} weekday - Weekday of the cursor (Date#getDay)
   * @param {number} rangeStartMs - Seek target
   * @param {number} rangeEndMs - Upper bound for transition lookup
   * @param {Object} rule - Parsed rule with compiled _byDaySet/_byDayDeltas
   * @param {number} maxSteps - Steps still permitted under COUNT (Infinity if unbounded)
   * @returns {{ ms: number, steps: number, weekday: number, nextSystemTransition: number }}
   * @private
   */
  static _seekWeekCycle(fromMs, weekday, rangeStartMs, rangeEndMs, rule, maxSteps) {
    const DAY = 86400000;
    const WEEK = 7 * DAY;
    const daySet = rule._byDaySet;
    const dayDeltas = rule._byDayDeltas;
    const stepsPerWeek = daySet.size;
    let ms = fromMs;
    let steps = 0;
    let nextSystemTransition = this._nextSystemTransition(ms, rangeEndMs);
    if (!Number.isFinite(rangeStartMs)) {
      return { ms, steps, weekday, nextSystemTransition };
    }
    while (ms < rangeStartMs && steps < maxSteps) {
      // A week from a weekday in the set is exactly stepsPerWeek steps and
      // returns to the same weekday
      if (daySet.has(weekday)) {
        const limit = Math.min(rangeStartMs, nextSystemTransition);
        let weeks = Math.ceil((limit - ms) / WEEK) - 1;
        if (ms + weeks * WEEK >= limit) {
          weeks--;
        }
        weeks = Math.min(weeks, Math.floor((maxSteps - steps) / stepsPerWeek));
        if (weeks > 0) {
          ms += weeks * WEEK;
          steps += weeks * stepsPerWeek;
          continue;
        }
      }
      // Single step, identical to the expansion loop
      const days = dayDeltas[weekday];
      const naiveMs = ms + days * DAY;
      if (naiveMs >= rangeStartMs) {
        break; // next step lands in the range
      }
      weekday = (weekday + days) % 7;
      if (naiveMs >= nextSystemTransition) {
        const cursor = new Date(ms);
        cursor.setDate(cursor.getDate() + days);
        ms = cursor.getTime();
        nextSystemTransition = this._nextSystemTransition(ms, rangeEndMs);
      } else {
        ms = naiveMs;
      }
      steps++;
    }
    return { ms, steps, weekday, nextSystemTransition };
  }

  /**
   * Find the next system-timezone offset transition after fromMs.
   * Cached module-wide: the system timezone is fixed for the process.
   * @param {number} fromMs - Search from this timestamp (exclusive)
   * @param {number} toMs - Extend cache coverage at least this far
   * @returns {number} Transition timestamp, or Infinity if none within coverage
   * @private
   */
  static _nextSystemTransition(fromMs, toMs) {
    if (fromMs >= toMs) {
      return Infinity;
    }
    let cache = this._systemTransitions;
    if (!cache || fromMs < cache.from || toMs > cache.to) {
      const from = Math.min(fromMs, cache ? cache.from : fromMs);
      const to = Math.max(toMs, cache ? cache.to : toMs);
      cache = { from, to, transitions: this._scanSystemTransitions(from, to) };
      this._systemTransitions = cache;
    }
    for (const t of cache.transitions) {
      if (t > fromMs) {
        return t;
      }
    }
    return Infinity;
  }

  /**
   * Scan for system-timezone offset transitions via Date#getTimezoneOffset.
   * Probes weekly (shorter than any real-world gap between transitions)
   * and binary-searches each change to the exact millisecond.
   * @private
   */
  static _scanSystemTransitions(fromMs, toMs) {
    const WEEK = 7 * 86400000;
    const transitions = [];
    let lo = fromMs;
    let loOffset = new Date(lo).getTimezoneOffset();
    while (lo < toMs) {
      const hi = Math.min(lo + WEEK, toMs);
      const hiOffset = new Date(hi).getTimezoneOffset();
      if (hiOffset !== loOffset) {
        let a = lo;
        let b = hi;
        while (b - a > 1) {
          const mid = Math.floor((a + b) / 2);
          if (new Date(mid).getTimezoneOffset() === loOffset) {
            a = mid;
          } else {
            b = mid;
          }
        }
        transitions.push(b);
        loOffset = hiOffset;
      }
      lo = hi;
    }
    return transitions;
  }

  /**
   * Apply BYSETPOS to filter occurrences within each frequency period
   * @param {Array} occurrences - Generated occurrences
   * @param {Object} rule - Recurrence rule
   * @returns {Array} Filtered occurrences
   * @private
   */
  static _applyBySetPos(occurrences, rule) {
    if (occurrences.length === 0) return occurrences;

    // Group occurrences by period
    const groups = new Map();
    for (const occ of occurrences) {
      const key = this._bySetPosKey(occ, rule);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(occ);
    }

    // Filter each group by BYSETPOS positions
    const filtered = [];
    for (const group of groups.values()) {
      filtered.push(...this._selectBySetPos(group, rule));
    }

    return filtered.sort((a, b) => a.start - b.start);
  }

  /**
   * Key of the BYSETPOS period an occurrence belongs to
   * @param {import('../types.js').EventOccurrence} occurrence - The occurrence
   * @param {Object} rule - Recurrence rule
   * @returns {string|number} Period key
   * @private
   */
  static _bySetPosKey(occurrence, rule) {
    switch (rule.freq) {
      case 'YEARLY':
        return occurrence.start.getFullYear();
      case 'WEEKLY':
        return `${occurrence.start.getFullYear()}-W${DateUtils.getWeekNumber(occurrence.start)}`;
      default:
        return `${occurrence.start.getFullYear()}-${occurrence.start.getMonth()}`;
    }
  }

  /**
   * Occurrences of one period selected by the rule's BYSETPOS positions,
   * in BYSETPOS order
   * @param {Array} group - Occurrences of a single period, in order
   * @param {Object} rule - Rule with bySetPos
   * @returns {Array} Selected occurrences
   * @private
   */
  static _selectBySetPos(group, rule) {
    const selected = [];
    for (const pos of rule.bySetPos) {
      const idx = pos > 0 ? pos - 1 : group.length + pos;
      if (idx >= 0 && idx < group.length) {
        selected.push(group[idx]);
      }
    }
    return selected;
  }

  /**
   * Parse an RRULE string into a rule object
   * @param {string|import('../types.js').RecurrenceRule} ruleString - RRULE string (e.g., "FREQ=DAILY;INTERVAL=1;COUNT=10") or rule object
   * @returns {import('../types.js').RecurrenceRule} Parsed rule object
   */
  static parseRule(ruleString) {
    // Use the new comprehensive parser
    return RRuleParser.parse(ruleString);
  }

  /**
   * Parse a rule with caching for string rules (internal use by expandEvent).
   * Cached rule objects are shared across calls and must not be mutated.
   * @param {string|Object} recurrenceRule - RRULE string or rule object
   * @returns {import('../types.js').RecurrenceRule} Parsed rule object
   * @private
   */
  static _getParsedRule(recurrenceRule) {
    if (typeof recurrenceRule !== 'string') {
      return this.parseRule(recurrenceRule);
    }
    let rule = this._ruleCache.get(recurrenceRule);
    if (!rule) {
      rule = this.parseRule(recurrenceRule);
      if (this._ruleCache.size >= this._RULE_CACHE_MAX) {
        this._ruleCache.clear();
      }
      this._ruleCache.set(recurrenceRule, rule);
    }
    return rule;
  }

  /**
   * Calculate the next occurrence based on the rule
   * @param {Date} currentDate - Current occurrence date
   * @param {Object} rule - Recurrence rule object
   * @param {string} [timezone] - Timezone for calculation
   * @returns {Date} Next occurrence date
   */
  static getNextOccurrence(currentDate, rule, _timezone = 'UTC') {
    const next = new Date(currentDate);
    this._advanceInPlace(next, rule);
    return next;
  }

  /**
   * Advance a date to the next occurrence, mutating it in place.
   * Used by expandEvent to avoid one Date allocation per step.
   * @param {Date} next - Date to advance (mutated)
   * @param {Object} rule - Recurrence rule object
   * @private
   */
  static _advanceInPlace(next, rule) {
    switch (rule.freq) {
      case 'SECONDLY':
        next.setSeconds(next.getSeconds() + rule.interval);
        break;

      case 'MINUTELY':
        next.setMinutes(next.getMinutes() + rule.interval);
        break;

      case 'HOURLY':
        next.setHours(next.getHours() + rule.interval);
        break;

      case 'DAILY':
        next.setDate(next.getDate() + rule.interval);
        break;

      case 'WEEKLY':
        if (rule.byDay && rule.byDay.length > 0) {
          // Jump straight to the next matching weekday using a delta table
          // precompiled once per rule instead of stepping day by day
          const daySet = rule._byDaySet || (rule._byDaySet = this._buildByDaySet(rule.byDay));
          if (daySet.size > 0) {
            const deltas =
              rule._byDayDeltas || (rule._byDayDeltas = this._buildByDayDeltas(daySet));
            next.setDate(next.getDate() + deltas[next.getDay()]);
          } else {
            // No valid day codes: fall back to simple weekly interval
            console.warn('RecurrenceEngine: Invalid byDay rule, falling back to weekly interval');
            next.setDate(next.getDate() + 7 * rule.interval);
          }
        } else {
          // Simple weekly recurrence
          next.setDate(next.getDate() + 7 * rule.interval);
        }
        break;

      case 'MONTHLY':
        if (rule.byMonthDay && rule.byMonthDay.length > 0) {
          // Specific day(s) of month
          const currentMonth = next.getMonth();
          next.setMonth(currentMonth + rule.interval);
          // Clamp to last day of month if day doesn't exist
          const daysInMonth = this._daysInMonth(next.getFullYear(), next.getMonth());
          next.setDate(Math.min(rule.byMonthDay[0], daysInMonth));
        } else if (rule.byDay && rule.byDay.length > 0) {
          // Specific weekday of month (e.g., "2nd Tuesday")
          next.setMonth(next.getMonth() + rule.interval);
          // Extract position from the day code itself (e.g., "2TU" -> pos=2)
          // or fall back to bySetPos
          const dayCode = rule.byDay[0];
          const dayMatch = dayCode.match(/^(-?\d+)?([A-Z]{2})$/);
          const embeddedPos = dayMatch && dayMatch[1] ? parseInt(dayMatch[1], 10) : null;
          const pos = embeddedPos || (rule.bySetPos && rule.bySetPos[0]) || 1;
          this.setToWeekdayOfMonth(next, rule.byDay[0], pos);
        } else {
          // Same day of month
          next.setMonth(next.getMonth() + rule.interval);
        }
        break;

      case 'YEARLY':
        if (rule.byMonth && rule.byMonth.length > 0) {
          next.setFullYear(next.getFullYear() + rule.interval);
          next.setMonth(rule.byMonth[0] - 1); // Months are 0-indexed
        } else {
          next.setFullYear(next.getFullYear() + rule.interval);
        }
        break;

      default:
        // Unsupported frequency
        next.setTime(next.getTime() + 24 * 60 * 60 * 1000); // Daily fallback
    }
  }

  /**
   * Days to add from each weekday (index 0-6) to reach the next weekday
   * present in the given set
   * @param {Set<number>} daySet - Non-empty set of weekday numbers
   * @returns {number[]} Delta table indexed by Date#getDay()
   * @private
   */
  static _buildByDayDeltas(daySet) {
    const deltas = new Array(7);
    for (let dow = 0; dow < 7; dow++) {
      for (let d = 1; d <= 7; d++) {
        if (daySet.has((dow + d) % 7)) {
          deltas[dow] = d;
          break;
        }
      }
    }
    return deltas;
  }

  /**
   * Number of days in a month without allocating a Date
   * @param {number} year - Full year
   * @param {number} month - Month index (0-11)
   * @returns {number}
   * @private
   */
  static _daysInMonth(year, month) {
    if (month === 1) {
      return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
    }
    return DAYS_IN_MONTH[month];
  }

  /**
   * Build a Set of numeric weekdays (0-6) from BYDAY codes
   * @param {Array<string>} byDay - Array of day codes (e.g., ['MO', '2TU'])
   * @returns {Set<number>} Weekday numbers; invalid codes are skipped
   * @private
   */
  static _buildByDaySet(byDay) {
    const dayMap = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
    const set = new Set();
    for (const day of byDay) {
      const match = /^(-?\d+)?([A-Z]{2})$/.exec(day);
      if (match && dayMap[match[2]] !== undefined) {
        set.add(dayMap[match[2]]);
      }
    }
    return set;
  }

  /**
   * Check if a date matches the BYDAY rule
   * @param {Date} date - Date to check
   * @param {Array<string>} byDay - Array of day codes (e.g., ['MO', 'WE', 'FR'])
   * @returns {boolean}
   */
  static matchesByDay(date, byDay) {
    const dayMap = {
      SU: 0,
      MO: 1,
      TU: 2,
      WE: 3,
      TH: 4,
      FR: 5,
      SA: 6
    };

    const dayOfWeek = date.getDay();
    return byDay.some(day => {
      // Handle numbered weekdays (e.g., "2MO" for 2nd Monday)
      const match = day.match(/^(-?\d+)?([A-Z]{2})$/);
      if (match) {
        const weekdayCode = match[2];
        return dayMap[weekdayCode] === dayOfWeek;
      }
      return false;
    });
  }

  /**
   * Set date to specific weekday of month
   * @param {Date} date - Date to modify
   * @param {string} weekday - Weekday code (e.g., 'MO', 'TU')
   * @param {number} position - Position in month (1-5, or -1 for last)
   */
  static setToWeekdayOfMonth(date, weekday, position = 1) {
    const dayMap = {
      SU: 0,
      MO: 1,
      TU: 2,
      WE: 3,
      TH: 4,
      FR: 5,
      SA: 6
    };

    // Extract weekday code if it has a number prefix
    const match = weekday.match(/^(-?\d+)?([A-Z]{2})$/);
    const weekdayCode = match ? match[2] : weekday;
    const targetDay = dayMap[weekdayCode];

    date.setDate(1); // Start at first of month

    // Find first occurrence of the weekday
    while (date.getDay() !== targetDay) {
      date.setDate(date.getDate() + 1);
    }

    // Move to the nth occurrence
    if (position > 1) {
      date.setDate(date.getDate() + 7 * (position - 1));
    } else if (position === -1) {
      // Last occurrence of the month
      const nextMonth = new Date(date);
      nextMonth.setMonth(nextMonth.getMonth() + 1);
      nextMonth.setDate(0); // Last day of current month

      while (nextMonth.getDay() !== targetDay) {
        nextMonth.setDate(nextMonth.getDate() - 1);
      }
      date.setTime(nextMonth.getTime());
    }
  }

  /**
   * Check if a date is an exception
   * @param {Date} date - Date to check
   * @param {Object} rule - Rule object with exceptions
   * @param {string} [eventId] - Event ID for better exception tracking
   * @returns {boolean}
   */
  static isException(date, rule, _eventId = null) {
    if (!rule.exceptions || rule.exceptions.length === 0) {
      return false;
    }

    // Support both date-only and date-time exceptions
    const dateStr = date.toDateString();
    const dateTime = date.getTime();

    return rule.exceptions.some(exDate => {
      if (typeof exDate === 'object' && exDate.date) {
        // Enhanced exception format with reason
        const exceptionDate = exDate.date instanceof Date ? exDate.date : new Date(exDate.date);
        if (exDate.matchTime) {
          return Math.abs(exceptionDate.getTime() - dateTime) < 1000; // Within 1 second
        }
        return exceptionDate.toDateString() === dateStr;
      }
      // Simple date exception — if the exception has a specific time component
      // (not midnight), match by timestamp to avoid excluding all occurrences on that day
      const exceptionDate = exDate instanceof Date ? exDate : new Date(exDate);
      const hasTime =
        exceptionDate.getHours() !== 0 ||
        exceptionDate.getMinutes() !== 0 ||
        exceptionDate.getSeconds() !== 0;
      if (hasTime) {
        return Math.abs(exceptionDate.getTime() - dateTime) < 1000;
      }
      return exceptionDate.toDateString() === dateStr;
    });
  }

  /**
   * Add exception dates to a recurrence rule
   * @param {Object} rule - Recurrence rule
   * @param {Date|Date[]} exceptions - Exception date(s) to add
   * @param {Object} [options] - Options for exception
   * @returns {Object} Updated rule
   */
  static addExceptions(rule, exceptions, options = {}) {
    if (!rule.exceptions) {
      rule.exceptions = [];
    }

    const exceptionArray = Array.isArray(exceptions) ? exceptions : [exceptions];

    exceptionArray.forEach(date => {
      if (options.reason || options.matchTime) {
        rule.exceptions.push({
          date: date,
          reason: options.reason,
          matchTime: options.matchTime || false
        });
      } else {
        rule.exceptions.push(date);
      }
    });

    return rule;
  }

  /**
   * Parse date from RRULE format (YYYYMMDDTHHMMSSZ)
   * @param {string} dateStr - Date string in RRULE format
   * @returns {Date}
   */
  static parseDate(dateStr) {
    if (dateStr.length === 8) {
      // YYYYMMDD
      const year = parseInt(dateStr.substr(0, 4), 10);
      const month = parseInt(dateStr.substr(4, 2), 10) - 1;
      const day = parseInt(dateStr.substr(6, 2), 10);
      return new Date(year, month, day);
    } else if (dateStr.length === 15 || dateStr.length === 16) {
      // YYYYMMDDTHHMMSS[Z]
      const year = parseInt(dateStr.substr(0, 4), 10);
      const month = parseInt(dateStr.substr(4, 2), 10) - 1;
      const day = parseInt(dateStr.substr(6, 2), 10);
      const hour = parseInt(dateStr.substr(9, 2), 10);
      const minute = parseInt(dateStr.substr(11, 2), 10);
      const second = parseInt(dateStr.substr(13, 2), 10);

      if (dateStr.endsWith('Z')) {
        return new Date(Date.UTC(year, month, day, hour, minute, second));
      }
      return new Date(year, month, day, hour, minute, second);
    }

    // Fallback to standard date parsing
    return new Date(dateStr);
  }

  /**
   * Generate a human-readable description of the recurrence rule
   * @param {Object|string} rule - Recurrence rule
   * @returns {string} Human-readable description
   */
  static getDescription(rule) {
    if (typeof rule === 'string') {
      rule = this.parseRule(rule);
    }

    let description = '';
    const interval = rule.interval || 1;

    switch (rule.freq) {
      case 'DAILY':
        description = interval === 1 ? 'Daily' : `Every ${interval} days`;
        break;
      case 'WEEKLY':
        description = interval === 1 ? 'Weekly' : `Every ${interval} weeks`;
        if (rule.byDay && rule.byDay.length > 0) {
          const days = rule.byDay.map(d => this.getDayName(d)).join(', ');
          description += ` on ${days}`;
        }
        break;
      case 'MONTHLY':
        description = interval === 1 ? 'Monthly' : `Every ${interval} months`;
        if (rule.byMonthDay && rule.byMonthDay.length > 0) {
          description += ` on day ${rule.byMonthDay.join(', ')}`;
        }
        break;
      case 'YEARLY':
        description = interval === 1 ? 'Yearly' : `Every ${interval} years`;
        break;
    }

    if (rule.count) {
      description += `, ${rule.count} times`;
    } else if (rule.until) {
      description += `, until ${rule.until.toLocaleDateString()}`;
    }

    return description;
  }

  /**
   * Get day name from RRULE day code
   * @param {string} dayCode - Day code (e.g., 'MO', '2TU')
   * @returns {string} Day name
   */
  static getDayName(dayCode) {
    const dayNames = {
      SU: 'Sunday',
      MO: 'Monday',
      TU: 'Tuesday',
      WE: 'Wednesday',
      TH: 'Thursday',
      FR: 'Friday',
      SA: 'Saturday'
    };

    // Extract day code if it has a number prefix
    const match = dayCode.match(/^(-?\d+)?([A-Z]{2})$/);
    const code = match ? match[2] : dayCode;
    const position = match && match[1] ? parseInt(match[1], 10) : null;

    let name = dayNames[code] || dayCode;

    if (position) {
      const ordinals = ['', '1st', '2nd', '3rd', '4th', '5th'];
      const ordinal = position === -1 ? 'Last' : ordinals[position] || `${position}th`;
      name = `${ordinal} ${name}`;
    }

    return name;
  }
}
