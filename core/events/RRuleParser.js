/**
 * RRuleParser - Full RFC 5545 compliant RRULE parser
 * Supports all RFC 5545 recurrence rule features
 */

const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

// RFC 5545 weekdaynum: an optional signed ordinal (1-53) and a weekday code.
// An explicit '+' and lowercase codes are accepted and normalised away.
const BYDAY_TOKEN = /^([+-]?\d{1,2})?([A-Za-z]{2})$/;
const MAX_ORDINAL = 53;

export class RRuleParser {
  /**
   * Parse an RRULE string into a structured rule object
   * @param {string|Object} rrule - RRULE string or rule object
   * @returns {Object} Parsed rule object
   */
  static parse(rrule) {
    // If already an object, validate and return
    if (typeof rrule === 'object') {
      return this.validateRule(rrule);
    }

    const rule = {
      freq: null,
      interval: 1,
      count: null,
      until: null,
      byDay: [],
      byWeekNo: [],
      byMonth: [],
      byMonthDay: [],
      byYearDay: [],
      bySetPos: [],
      byHour: [],
      byMinute: [],
      bySecond: [],
      wkst: 'MO', // Week start day
      exceptions: [],
      tzid: null
    };

    // Parse RRULE string
    const parts = rrule.toUpperCase().split(';');

    for (const part of parts) {
      const [key, value] = part.split('=');

      switch (key) {
        case 'FREQ':
          rule.freq = this.parseFrequency(value);
          break;

        case 'INTERVAL':
          rule.interval = parseInt(value, 10);
          if (rule.interval < 1) rule.interval = 1;
          break;

        case 'COUNT':
          rule.count = parseInt(value, 10);
          break;

        case 'UNTIL':
          rule.until = this.parseDateTime(value);
          break;

        case 'BYDAY':
          rule.byDay = this.parseByDay(value);
          break;

        case 'BYWEEKNO':
          // RFC 5545: valid range is 1-53 or -53 to -1 (no zero)
          rule.byWeekNo = this.parseIntList(value).filter(v => v !== 0 && v >= -53 && v <= 53);
          break;

        case 'BYMONTH':
          rule.byMonth = this.parseIntList(value);
          break;

        case 'BYMONTHDAY':
          rule.byMonthDay = this.parseIntList(value);
          break;

        case 'BYYEARDAY':
          rule.byYearDay = this.parseIntList(value);
          break;

        case 'BYSETPOS':
          rule.bySetPos = this.parseIntList(value);
          break;

        case 'BYHOUR':
          rule.byHour = this.parseIntList(value);
          break;

        case 'BYMINUTE':
          rule.byMinute = this.parseIntList(value);
          break;

        case 'BYSECOND':
          rule.bySecond = this.parseIntList(value);
          break;

        case 'WKST':
          rule.wkst = value;
          break;

        case 'EXDATE':
          rule.exceptions = this.parseExceptionDates(value);
          break;

        case 'TZID':
          rule.tzid = value;
          break;
      }
    }

    return this.validateRule(rule);
  }

  /**
   * Parse frequency value
   * @private
   */
  static parseFrequency(freq) {
    const validFrequencies = [
      'SECONDLY',
      'MINUTELY',
      'HOURLY',
      'DAILY',
      'WEEKLY',
      'MONTHLY',
      'YEARLY'
    ];
    return validFrequencies.includes(freq) ? freq : 'DAILY';
  }

  /**
   * Parse BYDAY value
   * Returns array of canonical strings like ['MO', '2TU', '-1FR'] for
   * compatibility with RecurrenceEngine. Empty list items are ignored.
   * @throws {Error} If an item is not a valid RFC 5545 weekday value
   * @private
   */
  static parseByDay(value) {
    return value
      .split(',')
      .map(day => day.trim())
      .filter(day => day !== '')
      .map(day => this.normalizeByDay(day));
  }

  /**
   * Parse one BYDAY entry into its ordinal and weekday.
   *
   * Accepts the RFC 5545 string form ('MO', '2TU', '-1FR', '+1MO', case
   * insensitive) and the object form ({ nth, weekday }). The weekday must be
   * one of SU, MO, TU, WE, TH, FR, SA and the ordinal, when present, an
   * integer from 1 to 53 in either direction; anything else yields null so
   * callers never operate on an unknown weekday.
   * @param {string|{nth?: number, weekday: string}} token - BYDAY entry
   * @returns {{nth: number|null, weekday: string}|null} Parsed entry, or null if invalid
   */
  static parseByDayToken(token) {
    if (token && typeof token === 'object') {
      const weekday = typeof token.weekday === 'string' ? token.weekday.trim().toUpperCase() : '';
      if (!WEEKDAY_CODES.includes(weekday)) {
        return null;
      }
      let nth = null;
      if (token.nth !== undefined && token.nth !== null && token.nth !== 0) {
        nth = Number(token.nth);
        if (!Number.isInteger(nth) || Math.abs(nth) > MAX_ORDINAL) {
          return null;
        }
      }
      return { nth, weekday };
    }
    if (typeof token !== 'string') {
      return null;
    }
    const match = BYDAY_TOKEN.exec(token.trim());
    if (!match) {
      return null;
    }
    const weekday = match[2].toUpperCase();
    if (!WEEKDAY_CODES.includes(weekday)) {
      return null;
    }
    let nth = null;
    if (match[1] !== undefined) {
      nth = parseInt(match[1], 10);
      if (nth === 0 || Math.abs(nth) > MAX_ORDINAL) {
        return null;
      }
    }
    return { nth, weekday };
  }

  /**
   * Canonical string form of a BYDAY entry: 'MO', '2TU', '-1FR'
   * @param {string|{nth?: number, weekday: string}} token - BYDAY entry
   * @returns {string} Canonical entry
   * @throws {Error} If the entry is not a valid RFC 5545 weekday value
   * @private
   */
  static normalizeByDay(token) {
    const parsed = this.parseByDayToken(token);
    if (!parsed) {
      throw new Error(this.byDayError(token));
    }
    return parsed.nth === null ? parsed.weekday : `${parsed.nth}${parsed.weekday}`;
  }

  /**
   * @private
   */
  static byDayError(token) {
    const shown = token && typeof token === 'object' ? JSON.stringify(token) : String(token);
    return (
      `RRULE BYDAY value "${shown}" is invalid: expected an optional ordinal ` +
      `(1-${MAX_ORDINAL}, optionally signed) followed by one of ${WEEKDAY_CODES.join(', ')}`
    );
  }

  /**
   * Parse comma-separated integer list
   * @private
   */
  static parseIntList(value) {
    return value
      .split(',')
      .map(v => parseInt(v.trim(), 10))
      .filter(v => !isNaN(v));
  }

  /**
   * Parse date/datetime value
   * @private
   */
  static parseDateTime(value) {
    // Handle different date formats
    // YYYYMMDD
    if (value.length === 8) {
      const year = parseInt(value.substr(0, 4), 10);
      const month = parseInt(value.substr(4, 2), 10) - 1;
      const day = parseInt(value.substr(6, 2), 10);
      return new Date(year, month, day);
    }

    // YYYYMMDDTHHMMSS
    if (value.length === 15 && value[8] === 'T') {
      const year = parseInt(value.substr(0, 4), 10);
      const month = parseInt(value.substr(4, 2), 10) - 1;
      const day = parseInt(value.substr(6, 2), 10);
      const hour = parseInt(value.substr(9, 2), 10);
      const minute = parseInt(value.substr(11, 2), 10);
      const second = parseInt(value.substr(13, 2), 10);
      return new Date(year, month, day, hour, minute, second);
    }

    // YYYYMMDDTHHMMSSZ (UTC)
    if (value.length === 16 && value[8] === 'T' && value[15] === 'Z') {
      const year = parseInt(value.substr(0, 4), 10);
      const month = parseInt(value.substr(4, 2), 10) - 1;
      const day = parseInt(value.substr(6, 2), 10);
      const hour = parseInt(value.substr(9, 2), 10);
      const minute = parseInt(value.substr(11, 2), 10);
      const second = parseInt(value.substr(13, 2), 10);
      return new Date(Date.UTC(year, month, day, hour, minute, second));
    }

    // Try standard date parse as fallback
    return new Date(value);
  }

  /**
   * Parse exception dates
   * @private
   */
  static parseExceptionDates(value) {
    const dates = value.split(',');
    return dates.map(date => this.parseDateTime(date.trim()));
  }

  /**
   * Validate and normalize a rule.
   *
   * Works on a copy: rule objects handed in are typically the stored
   * recurrenceRule of an Event, and normalising them in place would make
   * the stored event differ from the data it was created from (a spurious
   * update on the next reconcile) and let the engines' per-rule caches leak
   * into it. The copy is shallow except for the array fields, which are
   * copied as well.
   * @param {Object} rule - Rule object (not modified)
   * @returns {Object} Normalised copy
   * @private
   */
  static validateRule(rule) {
    rule = { ...rule };
    for (const field of ['bySetPos', 'exceptions']) {
      if (Array.isArray(rule[field])) {
        rule[field] = [...rule[field]];
      }
    }

    // BYDAY entries are normalised to canonical codes so the engines only
    // ever see a known weekday (an unknown one cannot be searched for)
    const byDay = Array.isArray(rule.byDay) ? rule.byDay : rule.byDay ? [rule.byDay] : [];
    rule.byDay = byDay.map(day => {
      if (day && typeof day === 'object') {
        const parsed = this.parseByDayToken(day);
        if (!parsed) {
          throw new Error(this.byDayError(day));
        }
        return { ...day, weekday: parsed.weekday };
      }
      return this.normalizeByDay(day);
    });

    // Ensure frequency is set
    if (!rule.freq) {
      rule.freq = 'DAILY';
    }

    // Cannot have both COUNT and UNTIL
    if (rule.count && rule.until) {
      throw new Error('RRULE cannot have both COUNT and UNTIL');
    }

    // Validate interval (RFC 5545 default is 1; rule objects may omit it)
    if (!Number.isInteger(rule.interval) || rule.interval < 1) {
      rule.interval = 1;
    }

    // Validate by* arrays
    const validateArray = (arr, min, max) => {
      return arr.filter(v => v >= min && v <= max);
    };

    rule.byMonth = validateArray(rule.byMonth || [], 1, 12);
    rule.byMonthDay = validateArray(rule.byMonthDay || [], -31, 31).filter(v => v !== 0);
    rule.byYearDay = validateArray(rule.byYearDay || [], -366, 366).filter(v => v !== 0);
    // RFC 5545: BYWEEKNO valid range is 1-53 or -53 to -1
    rule.byWeekNo = validateArray(rule.byWeekNo || [], -53, 53).filter(v => v !== 0);
    rule.byHour = validateArray(rule.byHour || [], 0, 23);
    rule.byMinute = validateArray(rule.byMinute || [], 0, 59);
    rule.bySecond = validateArray(rule.bySecond || [], 0, 59);

    return rule;
  }

  /**
   * Build RRULE string from rule object
   * @param {Object} rule - Rule object
   * @returns {string} RRULE string
   */
  static buildRRule(rule) {
    const parts = [];

    // Required frequency
    parts.push(`FREQ=${rule.freq}`);

    // Optional interval
    if (rule.interval && rule.interval > 1) {
      parts.push(`INTERVAL=${rule.interval}`);
    }

    // Count or until
    if (rule.count) {
      parts.push(`COUNT=${rule.count}`);
    } else if (rule.until) {
      parts.push(`UNTIL=${this.formatDateTime(rule.until)}`);
    }

    // By* rules
    if (rule.byDay && rule.byDay.length > 0) {
      const dayStr = rule.byDay
        .map(d => {
          // Handle both string format ('MO', '2TU', '-1FR') from parseByDay
          // and object format ({nth: 2, weekday: 'MO'})
          if (typeof d === 'string') {
            return d;
          }
          return d.nth ? `${d.nth}${d.weekday}` : d.weekday;
        })
        .join(',');
      parts.push(`BYDAY=${dayStr}`);
    }

    if (rule.byMonth && rule.byMonth.length > 0) {
      parts.push(`BYMONTH=${rule.byMonth.join(',')}`);
    }

    if (rule.byMonthDay && rule.byMonthDay.length > 0) {
      parts.push(`BYMONTHDAY=${rule.byMonthDay.join(',')}`);
    }

    if (rule.byYearDay && rule.byYearDay.length > 0) {
      parts.push(`BYYEARDAY=${rule.byYearDay.join(',')}`);
    }

    if (rule.byWeekNo && rule.byWeekNo.length > 0) {
      parts.push(`BYWEEKNO=${rule.byWeekNo.join(',')}`);
    }

    if (rule.bySetPos && rule.bySetPos.length > 0) {
      parts.push(`BYSETPOS=${rule.bySetPos.join(',')}`);
    }

    if (rule.byHour && rule.byHour.length > 0) {
      parts.push(`BYHOUR=${rule.byHour.join(',')}`);
    }

    if (rule.byMinute && rule.byMinute.length > 0) {
      parts.push(`BYMINUTE=${rule.byMinute.join(',')}`);
    }

    if (rule.bySecond && rule.bySecond.length > 0) {
      parts.push(`BYSECOND=${rule.bySecond.join(',')}`);
    }

    // Week start
    if (rule.wkst && rule.wkst !== 'MO') {
      parts.push(`WKST=${rule.wkst}`);
    }

    return parts.join(';');
  }

  /**
   * Format date/datetime for RRULE
   * @private
   */
  static formatDateTime(date) {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hour = String(date.getUTCHours()).padStart(2, '0');
    const minute = String(date.getUTCMinutes()).padStart(2, '0');
    const second = String(date.getUTCSeconds()).padStart(2, '0');

    return `${year}${month}${day}T${hour}${minute}${second}Z`;
  }

  /**
   * Get human-readable description of rule
   * @param {Object} rule - Parsed rule object
   * @returns {string} Human-readable description
   */
  static getDescription(rule) {
    const freqMap = {
      SECONDLY: 'second',
      MINUTELY: 'minute',
      HOURLY: 'hour',
      DAILY: 'day',
      WEEKLY: 'week',
      MONTHLY: 'month',
      YEARLY: 'year'
    };

    const weekdayMap = {
      SU: 'Sunday',
      MO: 'Monday',
      TU: 'Tuesday',
      WE: 'Wednesday',
      TH: 'Thursday',
      FR: 'Friday',
      SA: 'Saturday'
    };

    const nthMap = {
      1: 'first',
      2: 'second',
      3: 'third',
      4: 'fourth',
      5: 'fifth',
      '-1': 'last',
      '-2': 'second to last'
    };

    let description = 'Every';

    // Interval
    if (rule.interval > 1) {
      description += ` ${rule.interval}`;
    }

    // Frequency
    description += ` ${freqMap[rule.freq]}`;
    if (rule.interval > 1) {
      description += 's';
    }

    // By day - handle both string format ('MO', '2TU') and object format ({nth, weekday})
    if (rule.byDay && rule.byDay.length > 0) {
      // Helper to extract weekday and nth from string or object
      const parseDay = d => {
        if (typeof d === 'string') {
          const match = d.match(/^(-?\d+)?([A-Z]{2})$/);
          if (match) {
            return { nth: match[1] ? parseInt(match[1], 10) : null, weekday: match[2] };
          }
          return { nth: null, weekday: d };
        }
        return d;
      };

      if (rule.freq === 'WEEKLY') {
        const days = rule.byDay.map(d => weekdayMap[parseDay(d).weekday]).join(', ');
        description += ` on ${days}`;
      } else if (rule.freq === 'MONTHLY' || rule.freq === 'YEARLY') {
        const dayDescs = rule.byDay
          .map(d => {
            const parsed = parseDay(d);
            if (parsed.nth) {
              return `the ${nthMap[parsed.nth] || parsed.nth} ${weekdayMap[parsed.weekday]}`;
            }
            return weekdayMap[parsed.weekday];
          })
          .join(', ');
        description += ` on ${dayDescs}`;
      }
    }

    // By month day
    if (rule.byMonthDay && rule.byMonthDay.length > 0) {
      const days = rule.byMonthDay
        .map(d => {
          if (d < 0) {
            return `${Math.abs(d)} day(s) from the end`;
          }
          return `day ${d}`;
        })
        .join(', ');
      description += ` on ${days}`;
    }

    // By month
    if (rule.byMonth && rule.byMonth.length > 0) {
      const monthNames = [
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December'
      ];
      const months = rule.byMonth.map(m => monthNames[m - 1]).join(', ');
      description += ` in ${months}`;
    }

    // Count or until
    if (rule.count) {
      description += `, ${rule.count} time${rule.count > 1 ? 's' : ''}`;
    } else if (rule.until) {
      description += `, until ${rule.until.toLocaleDateString()}`;
    }

    return description;
  }
}
