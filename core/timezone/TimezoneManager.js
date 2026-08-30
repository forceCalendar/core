/**
 * TimezoneManager - Comprehensive timezone handling for global calendar operations
 * Handles timezone conversions, DST transitions, and IANA timezone database
 *
 * Critical for Salesforce orgs spanning multiple timezones
 */

import { TimezoneDatabase } from './TimezoneDatabase.js';

// Singleton instance for shared use across the application
let sharedInstance = null;

// Timezone databases know only local mean time before the 19th century, so
// transition scans check a span that ends before this instant at its ends
// rather than probing it week by week
const PRE_TZDATA_FLOOR_MS = Date.UTC(1800, 0, 1);

export class TimezoneManager {
  /**
   * Get the shared singleton instance of TimezoneManager
   * This should be used instead of creating new instances to avoid memory bloat
   * @returns {TimezoneManager} The shared instance
   */
  static getInstance() {
    if (!sharedInstance) {
      sharedInstance = new TimezoneManager();
    }
    return sharedInstance;
  }

  /**
   * Reset the singleton instance (useful for testing)
   * @private
   */
  static _resetInstance() {
    if (sharedInstance) {
      sharedInstance.clearCache();
    }
    sharedInstance = null;
  }

  constructor() {
    // Initialize comprehensive timezone database
    this.database = new TimezoneDatabase();

    // Cache timezone offsets for performance
    // offsetCache: Map<timezone, Map<15-minute UTC bucket, offset>>
    this.offsetCache = new Map();
    this.dstCache = new Map();

    // Intl.DateTimeFormat construction is ~50x the cost of using one,
    // so formatters are cached per timezone and reused
    this.formatterCache = new Map();

    // Discovered offset-transition instants per zone:
    // Map<timezone, {from: number, to: number, transitions: number[]}>
    // covering [from, to] with a sorted list of transition timestamps
    this.transitionCache = new Map();

    // Cache size management
    this.maxCacheSize = 1000;
    // ~20k 15-minute buckets per zone (≈ a few hundred KB worst case) covers
    // multi-year expansions without evicting entries mid-scan
    this.maxOffsetBucketsPerZone = 20000;
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  /**
   * Convert date from one timezone to another
   * @param {Date} date - Date to convert
   * @param {string} fromTimezone - Source timezone (IANA identifier)
   * @param {string} toTimezone - Target timezone (IANA identifier)
   * @returns {Date} Converted date
   */
  convertTimezone(date, fromTimezone, toTimezone) {
    if (!date) return null;
    if (fromTimezone === toTimezone) return new Date(date);

    // Get offset difference
    const fromOffset = this.getTimezoneOffset(date, fromTimezone);
    const toOffset = this.getTimezoneOffset(date, toTimezone);
    const offsetDiff = (toOffset - fromOffset) * 60 * 1000; // Convert to milliseconds

    return new Date(date.getTime() + offsetDiff);
  }

  /**
   * Convert date to UTC
   * @param {Date} date - Date in local timezone
   * @param {string} timezone - Source timezone
   * @returns {Date} Date in UTC
   */
  toUTC(date, timezone) {
    if (!date) return null;
    if (timezone === 'UTC') return new Date(date);

    // offset is positive for timezones behind UTC (e.g., NYC = +300)
    // To convert local to UTC, we ADD the offset
    const offset = this.getTimezoneOffset(date, timezone);
    return new Date(date.getTime() + offset * 60 * 1000);
  }

  /**
   * Convert UTC date to timezone
   * @param {Date} utcDate - Date in UTC
   * @param {string} timezone - Target timezone
   * @returns {Date} Date in specified timezone
   */
  fromUTC(utcDate, timezone) {
    if (!utcDate) return null;
    if (timezone === 'UTC') return new Date(utcDate);

    // offset is positive for timezones behind UTC (e.g., NYC = +300)
    // To convert UTC to local, we SUBTRACT the offset
    const offset = this.getTimezoneOffset(utcDate, timezone);
    return new Date(utcDate.getTime() - offset * 60 * 1000);
  }

  /**
   * Get timezone offset in minutes
   * @param {Date} date - Date to check (for DST calculation)
   * @param {string} timezone - Timezone identifier
   * @returns {number} Offset in minutes from UTC
   */
  getTimezoneOffset(date, timezone) {
    // Resolve any aliases
    timezone = this.database.resolveAlias(timezone);

    // Offsets only change at DST transitions, which occur on 15-minute UTC
    // boundaries worldwide — one cached entry covers each 15-minute bucket
    const bucket = Math.floor(date.getTime() / 900000);
    let zoneCache = this.offsetCache.get(timezone);
    if (zoneCache) {
      const cached = zoneCache.get(bucket);
      if (cached !== undefined) {
        this.cacheHits++;
        return cached;
      }
    } else {
      zoneCache = new Map();
      this.offsetCache.set(timezone, zoneCache);
    }

    this.cacheMisses++;

    let offset;

    // Try using Intl API if available (best option for browser/Node.js environments)
    if (typeof Intl !== 'undefined' && Intl.DateTimeFormat) {
      try {
        // Create same date in target timezone
        const parts = this._getFormatter(timezone).formatToParts(date);
        let year, month, day, hour, minute, second;
        for (const part of parts) {
          switch (part.type) {
            case 'year':
              year = +part.value;
              break;
            case 'month':
              month = +part.value;
              break;
            case 'day':
              day = +part.value;
              break;
            case 'hour':
              hour = +part.value;
              break;
            case 'minute':
              minute = +part.value;
              break;
            case 'second':
              second = +part.value;
              break;
          }
        }
        const tzDate = new Date(year, month - 1, day, hour, minute, second);
        // formatToParts carries no milliseconds, so compare against the
        // whole-second part of the input or sub-second noise leaks into
        // the offset (e.g. 660.0042 instead of 660)
        const wholeSecondMs = Math.floor(date.getTime() / 1000) * 1000;
        offset = -((tzDate.getTime() - wholeSecondMs) / (1000 * 60));
      } catch (e) {
        // Fallback to database calculation
      }
    }

    if (offset === undefined) {
      // Fallback: Use timezone database
      const tzData = this.database.getTimezone(timezone);
      if (!tzData) {
        throw new Error(`Unknown timezone: ${timezone}`);
      }

      offset = tzData.offset;

      // Apply DST if applicable
      if (tzData.dst && this.isDST(date, timezone, tzData.dst)) {
        offset += tzData.dst.offset;
      }
    }

    if (zoneCache.size >= this.maxOffsetBucketsPerZone) {
      zoneCache.clear();
    }
    zoneCache.set(bucket, offset);
    return offset;
  }

  /**
   * Find the next instant at which the zone's UTC offset changes
   * @param {string} timezone - Timezone identifier
   * @param {number} fromMs - Search from this timestamp (exclusive)
   * @param {number} toMs - Search up to this timestamp (inclusive)
   * @returns {number} Timestamp of the first offset change after fromMs, or Infinity
   */
  getNextTransition(timezone, fromMs, toMs) {
    if (fromMs >= toMs) {
      return Infinity;
    }
    timezone = this.database.resolveAlias(timezone);
    let cached = this.transitionCache.get(timezone);
    if (!cached) {
      cached = {
        from: fromMs,
        to: toMs,
        transitions: this._scanTransitions(timezone, fromMs, toMs)
      };
      this.transitionCache.set(timezone, cached);
    } else {
      // Extend coverage incrementally so only the uncovered span is scanned
      if (fromMs < cached.from) {
        cached.transitions = this._scanTransitions(timezone, fromMs, cached.from).concat(
          cached.transitions
        );
        cached.from = fromMs;
      }
      if (toMs > cached.to) {
        cached.transitions = cached.transitions.concat(
          this._scanTransitions(timezone, cached.to, toMs)
        );
        cached.to = toMs;
      }
    }
    // First transition after fromMs; the list is sorted
    const transitions = cached.transitions;
    let lo = 0;
    let hi = transitions.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (transitions[mid] > fromMs) {
        hi = mid;
      } else {
        lo = mid + 1;
      }
    }
    if (lo < transitions.length && transitions[lo] <= toMs) {
      return transitions[lo];
    }
    return Infinity;
  }

  /**
   * Scan a range for offset transitions. Probes in 7-day steps (shorter
   * than any gap between real-world transitions, including Ramadan DST
   * suspensions) and binary-searches each change to the exact instant.
   * @param {string} timezone - Resolved timezone identifier
   * @param {number} fromMs - Range start
   * @param {number} toMs - Range end
   * @returns {number[]} Sorted transition timestamps
   * @private
   */
  _scanTransitions(timezone, fromMs, toMs) {
    const WEEK = 7 * 86400000;
    const transitions = [];
    const offsetAt = ms => this.getTimezoneOffset(new Date(ms), timezone);
    let lo = fromMs;
    let loOffset = offsetAt(lo);
    // Timezone databases know only local mean time before the 19th century:
    // that era has a single offset and is skipped in one step (probing it
    // week by week could take minutes for a very old DTSTART)
    if (lo < PRE_TZDATA_FLOOR_MS) {
      lo = Math.min(toMs, PRE_TZDATA_FLOOR_MS);
      loOffset = offsetAt(lo);
    }
    while (lo < toMs) {
      const hi = Math.min(lo + WEEK, toMs);
      const hiOffset = offsetAt(hi);
      if (hiOffset !== loOffset) {
        // Binary search for the first ms with the new offset
        let a = lo;
        let b = hi;
        while (b - a > 1) {
          const mid = Math.floor((a + b) / 2);
          if (offsetAt(mid) === loOffset) {
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
   * Get a cached Intl.DateTimeFormat for a timezone
   * @param {string} timezone - Timezone identifier
   * @returns {Intl.DateTimeFormat}
   * @private
   */
  _getFormatter(timezone) {
    let formatter = this.formatterCache.get(timezone);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
      });
      this.formatterCache.set(timezone, formatter);
    }
    return formatter;
  }

  /**
   * Check if date is in DST for given timezone
   * @param {Date} date - Date to check
   * @param {string} timezone - Timezone identifier
   * @param {Object} [dstRule] - DST rule object (optional, will fetch if not provided)
   * @returns {boolean} True if in DST
   */
  isDST(date, timezone, dstRule = null) {
    // Check cache first
    const cacheKey = `${timezone}_${date.getFullYear()}_${date.getMonth()}_${date.getDate()}_${date.getHours()}`;
    if (this.dstCache.has(cacheKey)) {
      this.cacheHits++;
      return this.dstCache.get(cacheKey);
    }
    this.cacheMisses++;

    // Get DST rule if not provided
    if (!dstRule) {
      const tzData = this.database.getTimezone(timezone);
      if (!tzData || !tzData.dst) return false;
      dstRule = tzData.dst;
    }

    const year = date.getFullYear();
    const dstStart = this.getNthWeekdayOfMonth(
      year,
      dstRule.start.month,
      dstRule.start.week,
      dstRule.start.day
    );
    const dstEnd = this.getNthWeekdayOfMonth(
      year,
      dstRule.end.month,
      dstRule.end.week,
      dstRule.end.day
    );

    // Handle Southern Hemisphere (DST crosses year boundary)
    let result;
    if (dstStart > dstEnd) {
      result = date >= dstStart || date < dstEnd;
    } else {
      result = date >= dstStart && date < dstEnd;
    }

    // Cache the result
    this.dstCache.set(cacheKey, result);
    this._manageCacheSize();

    return result;
  }

  /**
   * Get nth weekday of month
   * @private
   */
  getNthWeekdayOfMonth(year, month, week, dayOfWeek) {
    const date = new Date(year, month, 1);
    const firstDay = date.getDay();

    let dayOffset = dayOfWeek - firstDay;
    if (dayOffset < 0) dayOffset += 7;

    if (week > 0) {
      // Nth occurrence from start
      date.setDate(1 + dayOffset + (week - 1) * 7);
    } else {
      // Nth occurrence from end
      const lastDay = new Date(year, month + 1, 0).getDate();
      date.setDate(lastDay);
      const lastDayOfWeek = date.getDay();
      let offset = lastDayOfWeek - dayOfWeek;
      if (offset < 0) offset += 7;
      date.setDate(lastDay - offset + (week + 1) * 7);
    }

    return date;
  }

  /**
   * Get list of common timezones
   * @returns {Array<{value: string, label: string, offset: string}>}
   */
  getCommonTimezones() {
    const now = new Date();
    const timezones = [
      { value: 'America/New_York', label: 'Eastern Time (New York)', region: 'Americas' },
      { value: 'America/Chicago', label: 'Central Time (Chicago)', region: 'Americas' },
      { value: 'America/Denver', label: 'Mountain Time (Denver)', region: 'Americas' },
      { value: 'America/Phoenix', label: 'Mountain Time - Arizona (Phoenix)', region: 'Americas' },
      { value: 'America/Los_Angeles', label: 'Pacific Time (Los Angeles)', region: 'Americas' },
      { value: 'America/Anchorage', label: 'Alaska Time (Anchorage)', region: 'Americas' },
      { value: 'Pacific/Honolulu', label: 'Hawaii Time (Honolulu)', region: 'Pacific' },
      { value: 'America/Toronto', label: 'Eastern Time (Toronto)', region: 'Americas' },
      { value: 'America/Vancouver', label: 'Pacific Time (Vancouver)', region: 'Americas' },
      { value: 'America/Mexico_City', label: 'Central Time (Mexico City)', region: 'Americas' },
      { value: 'America/Sao_Paulo', label: 'Brasilia Time (São Paulo)', region: 'Americas' },
      { value: 'Europe/London', label: 'GMT/BST (London)', region: 'Europe' },
      { value: 'Europe/Paris', label: 'Central European Time (Paris)', region: 'Europe' },
      { value: 'Europe/Berlin', label: 'Central European Time (Berlin)', region: 'Europe' },
      { value: 'Europe/Moscow', label: 'Moscow Time', region: 'Europe' },
      { value: 'Asia/Dubai', label: 'Gulf Time (Dubai)', region: 'Asia' },
      { value: 'Asia/Kolkata', label: 'India Time (Mumbai)', region: 'Asia' },
      { value: 'Asia/Shanghai', label: 'China Time (Shanghai)', region: 'Asia' },
      { value: 'Asia/Tokyo', label: 'Japan Time (Tokyo)', region: 'Asia' },
      { value: 'Asia/Seoul', label: 'Korea Time (Seoul)', region: 'Asia' },
      { value: 'Asia/Singapore', label: 'Singapore Time', region: 'Asia' },
      { value: 'Australia/Sydney', label: 'Australian Eastern Time (Sydney)', region: 'Oceania' },
      {
        value: 'Australia/Melbourne',
        label: 'Australian Eastern Time (Melbourne)',
        region: 'Oceania'
      },
      { value: 'Pacific/Auckland', label: 'New Zealand Time (Auckland)', region: 'Oceania' },
      { value: 'UTC', label: 'UTC', region: 'UTC' }
    ];

    // Add current offset to each timezone
    return timezones
      .map(tz => {
        const offset = this.getTimezoneOffset(now, tz.value);
        const offsetHours = -offset / 60; // Convert to hours from UTC
        const hours = Math.floor(Math.abs(offsetHours));
        const minutes = Math.round(Math.abs(offsetHours % 1) * 60);
        const sign = offsetHours >= 0 ? '+' : '-';
        const offsetStr = `UTC${sign}${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;

        return {
          ...tz,
          offset: offsetStr,
          offsetMinutes: -offset // Store in minutes for sorting
        };
      })
      .sort((a, b) => a.offsetMinutes - b.offsetMinutes);
  }

  /**
   * Format date in specific timezone
   * @param {Date} date - Date to format
   * @param {string} timezone - Timezone for formatting
   * @param {Object} options - Formatting options
   * @returns {string} Formatted date string
   */
  formatInTimezone(date, timezone, options = {}) {
    if (!date) return '';

    const defaultOptions = {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: timezone
    };

    const formatOptions = { ...defaultOptions, ...options };

    try {
      return new Intl.DateTimeFormat('en-US', formatOptions).format(date);
    } catch (e) {
      // Fallback to basic formatting
      const tzDate = this.fromUTC(this.toUTC(date, 'UTC'), timezone);
      return tzDate.toLocaleString('en-US', options);
    }
  }

  /**
   * Get timezone from browser/system
   * @returns {string} IANA timezone identifier
   */
  getSystemTimezone() {
    if (typeof Intl !== 'undefined' && Intl.DateTimeFormat) {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone;
      } catch (e) {
        // Fallback
      }
    }

    // Fallback based on offset
    const offset = new Date().getTimezoneOffset();
    const offsetHours = -offset / 60;

    // Try to match offset to known timezone
    for (const [tz, tzData] of Object.entries(this.database.timezones)) {
      if (tzData.offset / 60 === offsetHours) {
        return tz;
      }
    }

    return 'UTC';
  }

  /**
   * Parse timezone from string (handles abbreviations)
   * @param {string} tzString - Timezone string
   * @returns {string} IANA timezone identifier
   */
  parseTimezone(tzString) {
    if (!tzString) return 'UTC';

    // Check if it's already an IANA identifier
    if (Object.prototype.hasOwnProperty.call(this.database.timezones, tzString)) {
      return tzString;
    }

    // Check abbreviations
    const upperTz = tzString.toUpperCase();
    if (
      this.database.aliases &&
      Object.prototype.hasOwnProperty.call(this.database.aliases, upperTz)
    ) {
      return this.database.aliases[upperTz];
    }

    // Try to parse offset format (e.g., "+05:30", "-08:00")
    const offsetMatch = tzString.match(/^([+-])(\d{2}):?(\d{2})$/);
    if (offsetMatch) {
      const sign = offsetMatch[1] === '+' ? 1 : -1;
      const hours = parseInt(offsetMatch[2], 10);
      const minutes = parseInt(offsetMatch[3], 10);
      const totalOffset = sign * (hours + minutes / 60);

      // Find matching timezone
      for (const [tz, tzData] of Object.entries(this.database.timezones)) {
        if (tzData.offset / 60 === totalOffset) {
          return tz;
        }
      }
    }

    return 'UTC';
  }

  /**
   * Calculate timezone difference in hours
   * @param {string} timezone1 - First timezone
   * @param {string} timezone2 - Second timezone
   * @param {Date} [date] - Date for DST calculation
   * @returns {number} Hour difference
   */
  getTimezoneDifference(timezone1, timezone2, date = new Date()) {
    const offset1 = this.getTimezoneOffset(date, timezone1);
    const offset2 = this.getTimezoneOffset(date, timezone2);
    return (offset2 - offset1) / 60;
  }

  /**
   * Clear caches (useful when date changes significantly)
   */
  clearCache() {
    this.offsetCache.clear();
    this.dstCache.clear();
    this.transitionCache.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  /**
   * Validate timezone identifier
   * @param {string} timezone - Timezone to validate
   * @returns {boolean} True if valid
   */
  isValidTimezone(timezone) {
    return this.database.isValidTimezone(timezone);
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache stats
   */
  getCacheStats() {
    const hitRate =
      this.cacheHits + this.cacheMisses > 0
        ? ((this.cacheHits / (this.cacheHits + this.cacheMisses)) * 100).toFixed(2)
        : 0;

    return {
      offsetCacheSize: [...this.offsetCache.values()].reduce((n, m) => n + m.size, 0),
      dstCacheSize: this.dstCache.size,
      maxCacheSize: this.maxCacheSize,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      hitRate: `${hitRate}%`
    };
  }

  /**
   * Manage cache size - evict old entries if needed
   * @private
   */
  _manageCacheSize() {
    // Offset cache size is managed per-zone at insertion time in
    // getTimezoneOffset; only the DST cache needs periodic eviction here
    if (this.dstCache.size > this.maxCacheSize / 2) {
      const entriesToRemove = Math.floor(this.dstCache.size / 2);
      const keys = Array.from(this.dstCache.keys());
      for (let i = 0; i < entriesToRemove; i++) {
        this.dstCache.delete(keys[i]);
      }
    }
  }
}
