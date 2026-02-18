import { DateUtils } from '../calendar/DateUtils.js';
import { TimezoneManager } from '../timezone/TimezoneManager.js';
import { RRuleParser } from './RRuleParser.js';

/**
 * RecurrenceEngine - Handles expansion of recurring events
 * Full support for RFC 5545 (iCalendar) RRULE specification
 */
export class RecurrenceEngine {
  /**
   * Expand a recurring event into individual occurrences
   * @param {import('./Event.js').Event} event - The recurring event
   * @param {Date} rangeStart - Start of the expansion range
   * @param {Date} rangeEnd - End of the expansion range
   * @param {number} [maxOccurrences=365] - Maximum number of occurrences to generate
   * @param {string} [timezone] - Timezone for expansion (important for DST)
   * @returns {import('../../types.js').EventOccurrence[]} Array of occurrence objects with start/end dates
   */
  static expandEvent(event, rangeStart, rangeEnd, maxOccurrences = 365, timezone = null) {
    if (!event.recurring || !event.recurrenceRule) {
      return [{ start: event.start, end: event.end, timezone: event.timeZone }];
    }

    const rule = this.parseRule(event.recurrenceRule);
    const occurrences = [];
    const duration = event.end - event.start;
    const eventTimezone = timezone || event.timeZone || 'UTC';
    const tzManager = TimezoneManager.getInstance();

    // Work in event's timezone for accurate recurrence calculation
    let currentDate = new Date(event.start);
    let count = 0;

    // If UNTIL is specified, use it as the range end
    if (rule.until && rule.until < rangeEnd) {
      rangeEnd = rule.until;
    }

    // Track DST transitions for proper timezone handling
    let lastOffset = tzManager.getTimezoneOffset(currentDate, eventTimezone);

    // Track last date to detect infinite loop (date not advancing)
    const lastDateTimestamp = null;
    let stuckCount = 0;
    const maxStuckIterations = 3;

    while (currentDate <= rangeEnd && count < maxOccurrences) {
      // Check if this occurrence is within the range
      if (currentDate >= rangeStart) {
        const occurrenceStart = new Date(currentDate);
        const occurrenceEnd = new Date(currentDate.getTime() + duration);

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
        if (!this.isException(occurrenceStart, rule, event.id)) {
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
      const previousTimestamp = currentDate.getTime();
      currentDate = this.getNextOccurrence(currentDate, rule, eventTimezone);
      count++;

      // Safeguard: detect if date is not advancing (infinite loop risk)
      if (currentDate.getTime() === previousTimestamp) {
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

    // Apply BYSETPOS filtering if present and not already handled by MONTHLY+byDay
    if (rule.bySetPos && rule.bySetPos.length > 0 && rule.freq !== 'MONTHLY') {
      return this._applyBySetPos(occurrences, rule);
    }

    return occurrences;
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
      let key;
      switch (rule.freq) {
        case 'YEARLY':
          key = occ.start.getFullYear();
          break;
        case 'WEEKLY':
          key = `${occ.start.getFullYear()}-W${DateUtils.getWeekNumber(occ.start)}`;
          break;
        default:
          key = `${occ.start.getFullYear()}-${occ.start.getMonth()}`;
      }
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(occ);
    }

    // Filter each group by BYSETPOS positions
    const filtered = [];
    for (const group of groups.values()) {
      for (const pos of rule.bySetPos) {
        const idx = pos > 0 ? pos - 1 : group.length + pos;
        if (idx >= 0 && idx < group.length) {
          filtered.push(group[idx]);
        }
      }
    }

    return filtered.sort((a, b) => a.start - b.start);
  }

  /**
   * Parse an RRULE string into a rule object
   * @param {string|import('../../types.js').RecurrenceRule} ruleString - RRULE string (e.g., "FREQ=DAILY;INTERVAL=1;COUNT=10") or rule object
   * @returns {import('../../types.js').RecurrenceRule} Parsed rule object
   */
  static parseRule(ruleString) {
    // Use the new comprehensive parser
    return RRuleParser.parse(ruleString);
  }

  /**
   * Calculate the next occurrence based on the rule
   * @param {Date} currentDate - Current occurrence date
   * @param {Object} rule - Recurrence rule object
   * @param {string} [timezone] - Timezone for calculation
   * @returns {Date} Next occurrence date
   */
  static getNextOccurrence(currentDate, rule, timezone = 'UTC') {
    const next = new Date(currentDate);

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
          // Find next day that matches byDay
          // Limit iterations to prevent infinite loop with malformed byDay
          const maxIterations = 8; // 7 days + 1 for safety
          let iterations = 0;
          const originalDate = next.getDate();
          next.setDate(next.getDate() + 1);
          while (!this.matchesByDay(next, rule.byDay) && iterations < maxIterations) {
            next.setDate(next.getDate() + 1);
            iterations++;
          }
          // If no match found, fall back to simple weekly interval from original date
          if (iterations >= maxIterations) {
            console.warn('RecurrenceEngine: Invalid byDay rule, falling back to weekly interval');
            // Reset to original and add weekly interval
            next.setDate(originalDate + 7 * rule.interval);
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
          const daysInMonth = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
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

    return next;
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
  static isException(date, rule, eventId = null) {
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
      const hasTime = exceptionDate.getHours() !== 0 || exceptionDate.getMinutes() !== 0 || exceptionDate.getSeconds() !== 0;
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
