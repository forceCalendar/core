/**
 * TimezoneManager - Comprehensive timezone handling for global calendar operations
 * Handles timezone conversions, DST transitions, and IANA timezone database
 *
 * Critical for Salesforce orgs spanning multiple timezones
 */

class TimezoneManager {
    constructor() {
        // Cache timezone offsets for performance
        this.offsetCache = new Map();
        this.dstCache = new Map();

        // Common timezone abbreviations to IANA mapping
        this.timezoneAbbreviations = {
            'EST': 'America/New_York',
            'EDT': 'America/New_York',
            'CST': 'America/Chicago',
            'CDT': 'America/Chicago',
            'MST': 'America/Denver',
            'MDT': 'America/Denver',
            'PST': 'America/Los_Angeles',
            'PDT': 'America/Los_Angeles',
            'GMT': 'Europe/London',
            'BST': 'Europe/London',
            'CET': 'Europe/Paris',
            'CEST': 'Europe/Paris',
            'JST': 'Asia/Tokyo',
            'IST': 'Asia/Kolkata',
            'AEST': 'Australia/Sydney',
            'AEDT': 'Australia/Sydney'
        };

        // IANA timezone offset rules (simplified - in production would use Intl API or timezone database)
        this.timezoneOffsets = {
            'UTC': 0,
            'America/New_York': -5,
            'America/Chicago': -6,
            'America/Denver': -7,
            'America/Los_Angeles': -8,
            'America/Phoenix': -7, // No DST
            'Europe/London': 0,
            'Europe/Paris': 1,
            'Europe/Berlin': 1,
            'Asia/Tokyo': 9,
            'Asia/Shanghai': 8,
            'Asia/Kolkata': 5.5,
            'Australia/Sydney': 10,
            'Pacific/Auckland': 12
        };

        // DST rules (simplified - real implementation would be more complex)
        this.dstRules = {
            'America/New_York': { start: { month: 3, week: 2, day: 0 }, end: { month: 11, week: 1, day: 0 }, offset: 1 },
            'America/Chicago': { start: { month: 3, week: 2, day: 0 }, end: { month: 11, week: 1, day: 0 }, offset: 1 },
            'America/Denver': { start: { month: 3, week: 2, day: 0 }, end: { month: 11, week: 1, day: 0 }, offset: 1 },
            'America/Los_Angeles': { start: { month: 3, week: 2, day: 0 }, end: { month: 11, week: 1, day: 0 }, offset: 1 },
            'Europe/London': { start: { month: 3, week: -1, day: 0 }, end: { month: 10, week: -1, day: 0 }, offset: 1 },
            'Europe/Paris': { start: { month: 3, week: -1, day: 0 }, end: { month: 10, week: -1, day: 0 }, offset: 1 },
            'Australia/Sydney': { start: { month: 10, week: 1, day: 0 }, end: { month: 4, week: 1, day: 0 }, offset: 1 }
        };
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

        const offset = this.getTimezoneOffset(date, timezone);
        return new Date(date.getTime() - (offset * 60 * 1000));
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

        const offset = this.getTimezoneOffset(utcDate, timezone);
        return new Date(utcDate.getTime() + (offset * 60 * 1000));
    }

    /**
     * Get timezone offset in minutes
     * @param {Date} date - Date to check (for DST calculation)
     * @param {string} timezone - Timezone identifier
     * @returns {number} Offset in minutes from UTC
     */
    getTimezoneOffset(date, timezone) {
        // Check cache first
        const cacheKey = `${timezone}_${date.getFullYear()}_${date.getMonth()}_${date.getDate()}`;
        if (this.offsetCache.has(cacheKey)) {
            return this.offsetCache.get(cacheKey);
        }

        // Try using Intl API if available (best option for browser/Node.js environments)
        if (typeof Intl !== 'undefined' && Intl.DateTimeFormat) {
            try {
                const formatter = new Intl.DateTimeFormat('en-US', {
                    timeZone: timezone,
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false
                });

                // Create same date in target timezone
                const parts = formatter.formatToParts(date);
                const tzDate = new Date(
                    parts.find(p => p.type === 'year').value,
                    parts.find(p => p.type === 'month').value - 1,
                    parts.find(p => p.type === 'day').value,
                    parts.find(p => p.type === 'hour').value,
                    parts.find(p => p.type === 'minute').value,
                    parts.find(p => p.type === 'second').value
                );

                const offset = (tzDate.getTime() - date.getTime()) / (1000 * 60);
                this.offsetCache.set(cacheKey, -offset);
                return -offset;
            } catch (e) {
                // Fallback to manual calculation
            }
        }

        // Fallback: Manual calculation
        let baseOffset = (this.timezoneOffsets[timezone] || 0) * 60;

        // Apply DST if applicable
        if (this.isDST(date, timezone)) {
            const dstRule = this.dstRules[timezone];
            if (dstRule) {
                baseOffset += dstRule.offset * 60;
            }
        }

        this.offsetCache.set(cacheKey, baseOffset);
        return baseOffset;
    }

    /**
     * Check if date is in DST for given timezone
     * @param {Date} date - Date to check
     * @param {string} timezone - Timezone identifier
     * @returns {boolean} True if in DST
     */
    isDST(date, timezone) {
        const dstRule = this.dstRules[timezone];
        if (!dstRule) return false;

        const year = date.getFullYear();
        const dstStart = this.getNthWeekdayOfMonth(year, dstRule.start.month, dstRule.start.week, dstRule.start.day);
        const dstEnd = this.getNthWeekdayOfMonth(year, dstRule.end.month, dstRule.end.week, dstRule.end.day);

        // Handle Southern Hemisphere (DST crosses year boundary)
        if (dstStart > dstEnd) {
            return date >= dstStart || date < dstEnd;
        }

        return date >= dstStart && date < dstEnd;
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
            { value: 'Australia/Melbourne', label: 'Australian Eastern Time (Melbourne)', region: 'Oceania' },
            { value: 'Pacific/Auckland', label: 'New Zealand Time (Auckland)', region: 'Oceania' },
            { value: 'UTC', label: 'UTC', region: 'UTC' }
        ];

        // Add current offset to each timezone
        return timezones.map(tz => {
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
        }).sort((a, b) => a.offsetMinutes - b.offsetMinutes);
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
        for (const [tz, tzOffset] of Object.entries(this.timezoneOffsets)) {
            if (tzOffset === offsetHours) {
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
        if (this.timezoneOffsets.hasOwnProperty(tzString)) {
            return tzString;
        }

        // Check abbreviations
        const upperTz = tzString.toUpperCase();
        if (this.timezoneAbbreviations.hasOwnProperty(upperTz)) {
            return this.timezoneAbbreviations[upperTz];
        }

        // Try to parse offset format (e.g., "+05:30", "-08:00")
        const offsetMatch = tzString.match(/^([+-])(\d{2}):?(\d{2})$/);
        if (offsetMatch) {
            const sign = offsetMatch[1] === '+' ? 1 : -1;
            const hours = parseInt(offsetMatch[2], 10);
            const minutes = parseInt(offsetMatch[3], 10);
            const totalOffset = sign * (hours + minutes / 60);

            // Find matching timezone
            for (const [tz, offset] of Object.entries(this.timezoneOffsets)) {
                if (offset === totalOffset) {
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
    }
}

/**
 * Event class - represents a calendar event with timezone support
 * Pure JavaScript, no DOM dependencies
 * Locker Service compatible
 */


class Event {
  /**
   * Normalize event data
   * @param {import('../../types.js').EventData} data - Raw event data
   * @returns {import('../../types.js').EventData} Normalized event data
   */
  static normalize(data) {
    const normalized = { ...data };

    // Ensure dates are Date objects
    if (normalized.start && !(normalized.start instanceof Date)) {
      normalized.start = new Date(normalized.start);
    }
    if (normalized.end && !(normalized.end instanceof Date)) {
      normalized.end = new Date(normalized.end);
    }

    // If no end date, set it to start date
    if (!normalized.end) {
      normalized.end = normalized.start ? new Date(normalized.start) : null;
    }

    // For all-day events, normalize times to midnight
    if (normalized.allDay && normalized.start) {
      normalized.start.setHours(0, 0, 0, 0);
      if (normalized.end) {
        normalized.end.setHours(23, 59, 59, 999);
      }
    }

    // Normalize string fields
    normalized.id = String(normalized.id || '').trim();
    normalized.title = String(normalized.title || '').trim();
    normalized.description = String(normalized.description || '').trim();
    normalized.location = String(normalized.location || '').trim();

    // Normalize arrays
    normalized.attendees = Array.isArray(normalized.attendees) ? normalized.attendees : [];
    normalized.reminders = Array.isArray(normalized.reminders) ? normalized.reminders : [];
    normalized.categories = Array.isArray(normalized.categories) ? normalized.categories : [];
    normalized.attachments = Array.isArray(normalized.attachments) ? normalized.attachments : [];

    // Normalize status and visibility
    const validStatuses = ['confirmed', 'tentative', 'cancelled'];
    if (!validStatuses.includes(normalized.status)) {
      normalized.status = 'confirmed';
    }

    const validVisibilities = ['public', 'private', 'confidential'];
    if (!validVisibilities.includes(normalized.visibility)) {
      normalized.visibility = 'public';
    }

    // Normalize colors
    if (normalized.color && !normalized.backgroundColor) {
      normalized.backgroundColor = normalized.color;
    }
    if (normalized.color && !normalized.borderColor) {
      normalized.borderColor = normalized.color;
    }

    return normalized;
  }

  /**
   * Validate event data
   * @param {import('../../types.js').EventData} data - Normalized event data
   * @throws {Error} If validation fails
   */
  static validate(data) {
    // Required fields
    if (!data.id) {
      throw new Error('Event must have an id');
    }
    if (!data.title) {
      throw new Error('Event must have a title');
    }
    if (!data.start) {
      throw new Error('Event must have a start date');
    }

    // Validate dates
    if (!(data.start instanceof Date) || isNaN(data.start.getTime())) {
      throw new Error('Invalid start date');
    }
    if (data.end && (!(data.end instanceof Date) || isNaN(data.end.getTime()))) {
      throw new Error('Invalid end date');
    }

    // Validate date order
    if (data.end && data.start && data.end < data.start) {
      throw new Error('Event end time cannot be before start time');
    }

    // Validate recurrence
    if (data.recurring && !data.recurrenceRule) {
      throw new Error('Recurring events must have a recurrence rule');
    }

    // Validate attendees
    if (data.attendees && data.attendees.length > 0) {
      data.attendees.forEach((attendee, index) => {
        if (!attendee.email || !attendee.name) {
          throw new Error(`Attendee at index ${index} must have email and name`);
        }
        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(attendee.email)) {
          throw new Error(`Invalid email for attendee: ${attendee.email}`);
        }
      });
    }

    // Validate reminders
    if (data.reminders && data.reminders.length > 0) {
      data.reminders.forEach((reminder, index) => {
        if (!reminder.method || reminder.minutesBefore == null) {
          throw new Error(`Reminder at index ${index} must have method and minutesBefore`);
        }
        if (reminder.minutesBefore < 0) {
          throw new Error('Reminder minutesBefore must be non-negative');
        }
      });
    }

    // Validate timezone if provided
    if (data.timeZone) {
      try {
        // Test if timezone is valid by trying to use it
        new Intl.DateTimeFormat('en-US', { timeZone: data.timeZone });
      } catch (e) {
        throw new Error(`Invalid timezone: ${data.timeZone}`);
      }
    }
  }

  /**
   * Create a new Event instance
   * @param {import('../../types.js').EventData} eventData - Event data object
   * @throws {Error} If required fields are missing or invalid
   */
  constructor({
    id,
    title,
    start,
    end,
    allDay = false,
    description = '',
    location = '',
    color = null,
    backgroundColor = null,
    borderColor = null,
    textColor = null,
    recurring = false,
    recurrenceRule = null,
    timeZone = null,
    endTimeZone = null,
    status = 'confirmed',
    visibility = 'public',
    organizer = null,
    attendees = [],
    reminders = [],
    categories = [],
    attachments = [],
    conferenceData = null,
    metadata = {}
  }) {
    // Normalize and validate input
    const normalized = Event.normalize({
      id,
      title,
      start,
      end,
      allDay,
      description,
      location,
      color,
      backgroundColor,
      borderColor,
      textColor,
      recurring,
      recurrenceRule,
      timeZone,
      endTimeZone,
      status,
      visibility,
      organizer,
      attendees,
      reminders,
      categories,
      attachments,
      conferenceData,
      metadata
    });

    // Validate normalized data
    Event.validate(normalized);

    this.id = normalized.id;
    this.title = normalized.title;

    // Initialize timezone manager
    this._timezoneManager = new TimezoneManager();

    // Timezone handling
    // Store the timezone the event was created in (wall-clock time)
    this.timeZone = normalized.timeZone || this._timezoneManager.getSystemTimezone();
    this.endTimeZone = normalized.endTimeZone || this.timeZone; // Different end timezone for flights etc.

    // Store dates as provided (wall-clock time in event timezone)
    this.start = normalized.start;
    this.end = normalized.end;

    // Store UTC versions for efficient querying and comparison
    this.startUTC = this._timezoneManager.toUTC(this.start, this.timeZone);
    this.endUTC = this._timezoneManager.toUTC(this.end, this.endTimeZone);

    this.allDay = normalized.allDay;
    this.description = normalized.description;
    this.location = normalized.location;

    // Styling
    this.color = normalized.color;
    this.backgroundColor = normalized.backgroundColor;
    this.borderColor = normalized.borderColor;
    this.textColor = normalized.textColor;

    // Recurrence
    this.recurring = normalized.recurring;
    this.recurrenceRule = normalized.recurrenceRule;

    // Store original timezone from system if not provided
    this._originalTimeZone = normalized.timeZone || null;

    // Event status and visibility
    this.status = normalized.status;
    this.visibility = normalized.visibility;

    // People
    this.organizer = normalized.organizer;
    this.attendees = [...normalized.attendees];

    // Reminders
    this.reminders = [...normalized.reminders];

    // Categories/Tags
    this.categories = [...normalized.categories];

    // Attachments
    this.attachments = [...normalized.attachments];

    // Conference/Virtual meeting
    this.conferenceData = normalized.conferenceData;

    // Custom metadata for extensibility
    this.metadata = { ...normalized.metadata };

    // Computed properties cache
    this._cache = {};

    // Validate complex properties
    this._validateAttendees();
    this._validateReminders();
  }

  /**
   * Get event duration in milliseconds
   * @returns {number} Duration in milliseconds
   */
  get duration() {
    if (!this._cache.duration) {
      // Use UTC times for accurate duration calculation
      this._cache.duration = this.endUTC.getTime() - this.startUTC.getTime();
    }
    return this._cache.duration;
  }

  /**
   * Get start date in a specific timezone
   * @param {string} timezone - Target timezone
   * @returns {Date} Start date in specified timezone
   */
  getStartInTimezone(timezone) {
    if (timezone === this.timeZone) {
      return new Date(this.start);
    }
    return this._timezoneManager.fromUTC(this.startUTC, timezone);
  }

  /**
   * Get end date in a specific timezone
   * @param {string} timezone - Target timezone
   * @returns {Date} End date in specified timezone
   */
  getEndInTimezone(timezone) {
    if (timezone === this.endTimeZone) {
      return new Date(this.end);
    }
    return this._timezoneManager.fromUTC(this.endUTC, timezone);
  }

  /**
   * Update event times preserving the timezone
   * @param {Date} start - New start date
   * @param {Date} end - New end date
   * @param {string} [timezone] - Timezone for the new dates
   */
  updateTimes(start, end, timezone) {
    timezone || this.timeZone;

    this.start = start instanceof Date ? start : new Date(start);
    this.end = end instanceof Date ? end : new Date(end);

    if (timezone) {
      this.timeZone = timezone;
      this.endTimeZone = timezone;
    }

    // Update UTC versions
    this.startUTC = this._timezoneManager.toUTC(this.start, this.timeZone);
    this.endUTC = this._timezoneManager.toUTC(this.end, this.endTimeZone);

    // Clear cache
    this._cache = {};

    // Validate
    if (this.endUTC < this.startUTC) {
      throw new Error('Event end time cannot be before start time');
    }
  }

  /**
   * Get event duration in minutes
   * @returns {number} Duration in minutes
   */
  get durationMinutes() {
    return Math.floor(this.duration / (1000 * 60));
  }

  /**
   * Get event duration in hours
   * @returns {number} Duration in hours
   */
  get durationHours() {
    return this.duration / (1000 * 60 * 60);
  }

  /**
   * Check if this is a multi-day event
   * @returns {boolean} True if event spans multiple days
   */
  get isMultiDay() {
    if (!this._cache.hasOwnProperty('isMultiDay')) {
      const startDay = this.start.toDateString();
      const endDay = this.end.toDateString();
      this._cache.isMultiDay = startDay !== endDay;
    }
    return this._cache.isMultiDay;
  }

  /**
   * Check if event is recurring
   * @returns {boolean} True if event is recurring
   */
  isRecurring() {
    return this.recurring && this.recurrenceRule !== null;
  }

  /**
   * Check if event occurs on a specific date
   * @param {Date|string} date - The date to check
   * @returns {boolean} True if event occurs on the given date
   */
  occursOn(date) {
    if (!(date instanceof Date)) {
      date = new Date(date);
    }

    const dateString = date.toDateString();
    const startString = this.start.toDateString();
    const endString = this.end.toDateString();

    // For all-day events, check if date falls within range
    if (this.allDay) {
      return date >= new Date(startString) && date <= new Date(endString);
    }

    // For timed events, check if any part of the event occurs on this date
    if (this.isMultiDay) {
      // Multi-day event: check if date is within range
      const dayStart = new Date(dateString);
      const dayEnd = new Date(dateString);
      dayEnd.setHours(23, 59, 59, 999);

      return this.start <= dayEnd && this.end >= dayStart;
    } else {
      // Single day event: check if it's on the same day
      return startString === dateString;
    }
  }

  /**
   * Check if this event overlaps with another event
   * @param {Event|{start: Date, end: Date}} otherEvent - The other event or time range to check
   * @returns {boolean} True if events overlap
   * @throws {Error} If otherEvent is not an Event instance or doesn't have start/end
   */
  overlaps(otherEvent) {
    if (otherEvent instanceof Event) {
      // Events don't overlap if one ends before the other starts
      return !(this.end <= otherEvent.start || this.start >= otherEvent.end);
    } else if (otherEvent && otherEvent.start && otherEvent.end) {
      // Allow checking against time ranges
      return !(this.end <= otherEvent.start || this.start >= otherEvent.end);
    } else {
      throw new Error('Parameter must be an Event instance or have start/end properties');
    }
  }

  /**
   * Check if event contains a specific datetime
   * @param {Date|string} datetime - The datetime to check
   * @returns {boolean} True if the datetime falls within the event
   */
  contains(datetime) {
    if (!(datetime instanceof Date)) {
      datetime = new Date(datetime);
    }
    return datetime >= this.start && datetime <= this.end;
  }

  /**
   * Clone the event with optional updates
   * @param {Partial<import('../../types.js').EventData>} [updates={}] - Properties to update in the clone
   * @returns {Event} New Event instance with updated properties
   */
  clone(updates = {}) {
    return new Event({
      id: this.id,
      title: this.title,
      start: new Date(this.start),
      end: new Date(this.end),
      allDay: this.allDay,
      description: this.description,
      location: this.location,
      color: this.color,
      backgroundColor: this.backgroundColor,
      borderColor: this.borderColor,
      textColor: this.textColor,
      recurring: this.recurring,
      recurrenceRule: this.recurrenceRule,
      timeZone: this.timeZone,
      status: this.status,
      visibility: this.visibility,
      organizer: this.organizer ? { ...this.organizer } : null,
      attendees: this.attendees.map(a => ({ ...a })),
      reminders: this.reminders.map(r => ({ ...r })),
      categories: [...this.categories],
      attachments: this.attachments.map(a => ({ ...a })),
      conferenceData: this.conferenceData ? { ...this.conferenceData } : null,
      metadata: { ...this.metadata },
      ...updates
    });
  }

  /**
   * Convert event to plain object
   * @returns {import('../../types.js').EventData} Plain object representation of the event
   */
  toObject() {
    return {
      id: this.id,
      title: this.title,
      start: this.start.toISOString(),
      end: this.end.toISOString(),
      allDay: this.allDay,
      description: this.description,
      location: this.location,
      color: this.color,
      backgroundColor: this.backgroundColor,
      borderColor: this.borderColor,
      textColor: this.textColor,
      recurring: this.recurring,
      recurrenceRule: this.recurrenceRule,
      timeZone: this.timeZone,
      status: this.status,
      visibility: this.visibility,
      organizer: this.organizer,
      attendees: this.attendees,
      reminders: this.reminders,
      categories: this.categories,
      attachments: this.attachments,
      conferenceData: this.conferenceData,
      metadata: { ...this.metadata }
    };
  }

  /**
   * Create Event from plain object
   * @param {import('../../types.js').EventData} obj - Plain object with event properties
   * @returns {Event} New Event instance
   */
  static fromObject(obj) {
    return new Event(obj);
  }

  /**
   * Compare events for equality
   * @param {Event} other - The other event
   * @returns {boolean} True if events are equal
   */
  equals(other) {
    if (!(other instanceof Event)) return false;

    return (
      this.id === other.id &&
      this.title === other.title &&
      this.start.getTime() === other.start.getTime() &&
      this.end.getTime() === other.end.getTime() &&
      this.allDay === other.allDay &&
      this.description === other.description &&
      this.location === other.location &&
      this.recurring === other.recurring &&
      this.recurrenceRule === other.recurrenceRule &&
      this.status === other.status
    );
  }

  // ============ Attendee Management Methods ============

  /**
   * Add an attendee to the event
   * @param {import('../../types.js').Attendee} attendee - Attendee to add
   * @returns {boolean} True if attendee was added, false if already exists
   */
  addAttendee(attendee) {
    if (!attendee || !attendee.email) {
      throw new Error('Attendee must have an email');
    }

    // Check if attendee already exists
    if (this.hasAttendee(attendee.email)) {
      return false;
    }

    // Generate ID if not provided
    if (!attendee.id) {
      attendee.id = `attendee_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    // Set defaults
    attendee.responseStatus = attendee.responseStatus || 'needs-action';
    attendee.role = attendee.role || 'required';

    this.attendees.push(attendee);
    return true;
  }

  /**
   * Remove an attendee from the event
   * @param {string} emailOrId - Email or ID of the attendee to remove
   * @returns {boolean} True if attendee was removed
   */
  removeAttendee(emailOrId) {
    const index = this.attendees.findIndex(
      a => a.email === emailOrId || a.id === emailOrId
    );

    if (index !== -1) {
      this.attendees.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Update an attendee's response status
   * @param {string} email - Attendee's email
   * @param {import('../../types.js').AttendeeResponseStatus} responseStatus - New response status
   * @returns {boolean} True if attendee was updated
   */
  updateAttendeeResponse(email, responseStatus) {
    const attendee = this.getAttendee(email);
    if (attendee) {
      attendee.responseStatus = responseStatus;
      attendee.responseTime = new Date();
      return true;
    }
    return false;
  }

  /**
   * Get an attendee by email
   * @param {string} email - Attendee's email
   * @returns {import('../../types.js').Attendee|null} The attendee or null
   */
  getAttendee(email) {
    return this.attendees.find(a => a.email === email) || null;
  }

  /**
   * Check if an attendee exists
   * @param {string} email - Attendee's email
   * @returns {boolean} True if attendee exists
   */
  hasAttendee(email) {
    return this.attendees.some(a => a.email === email);
  }

  /**
   * Get attendees by response status
   * @param {import('../../types.js').AttendeeResponseStatus} status - Response status to filter by
   * @returns {import('../../types.js').Attendee[]} Filtered attendees
   */
  getAttendeesByStatus(status) {
    return this.attendees.filter(a => a.responseStatus === status);
  }

  /**
   * Get count of attendees by response status
   * @returns {Object.<string, number>} Count by status
   */
  getAttendeeCounts() {
    return this.attendees.reduce((counts, attendee) => {
      const status = attendee.responseStatus || 'needs-action';
      counts[status] = (counts[status] || 0) + 1;
      return counts;
    }, {});
  }

  // ============ Reminder Management Methods ============

  /**
   * Add a reminder to the event
   * @param {import('../../types.js').Reminder} reminder - Reminder to add
   * @returns {boolean} True if reminder was added
   */
  addReminder(reminder) {
    if (!reminder || typeof reminder.minutesBefore !== 'number') {
      throw new Error('Reminder must have minutesBefore property');
    }

    // Generate ID if not provided
    if (!reminder.id) {
      reminder.id = `reminder_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    // Set defaults
    reminder.method = reminder.method || 'popup';
    reminder.enabled = reminder.enabled !== false;

    // Check for duplicate
    const duplicate = this.reminders.some(
      r => r.method === reminder.method && r.minutesBefore === reminder.minutesBefore
    );

    if (duplicate) {
      return false;
    }

    this.reminders.push(reminder);
    return true;
  }

  /**
   * Remove a reminder from the event
   * @param {string} reminderId - ID of the reminder to remove
   * @returns {boolean} True if reminder was removed
   */
  removeReminder(reminderId) {
    const index = this.reminders.findIndex(r => r.id === reminderId);
    if (index !== -1) {
      this.reminders.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Get active reminders
   * @returns {import('../../types.js').Reminder[]} Active reminders
   */
  getActiveReminders() {
    return this.reminders.filter(r => r.enabled !== false);
  }

  /**
   * Get reminder trigger times
   * @returns {Date[]} Array of dates when reminders should trigger
   */
  getReminderTriggerTimes() {
    return this.getActiveReminders().map(reminder => {
      const triggerTime = new Date(this.start);
      triggerTime.setMinutes(triggerTime.getMinutes() - reminder.minutesBefore);
      return triggerTime;
    });
  }

  // ============ Category Management Methods ============

  /**
   * Add a category to the event
   * @param {string} category - Category to add
   * @returns {boolean} True if category was added
   */
  addCategory(category) {
    if (!category || typeof category !== 'string') {
      throw new Error('Category must be a non-empty string');
    }

    const normalizedCategory = category.trim().toLowerCase();
    if (!this.hasCategory(normalizedCategory)) {
      this.categories.push(normalizedCategory);
      return true;
    }
    return false;
  }

  /**
   * Remove a category from the event
   * @param {string} category - Category to remove
   * @returns {boolean} True if category was removed
   */
  removeCategory(category) {
    const normalizedCategory = category.trim().toLowerCase();
    const index = this.categories.findIndex(
      c => c.toLowerCase() === normalizedCategory
    );

    if (index !== -1) {
      this.categories.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Check if event has a specific category
   * @param {string} category - Category to check
   * @returns {boolean} True if event has the category
   */
  hasCategory(category) {
    const normalizedCategory = category.trim().toLowerCase();
    return this.categories.some(c => c.toLowerCase() === normalizedCategory);
  }

  /**
   * Check if event has any of the specified categories
   * @param {string[]} categories - Categories to check
   * @returns {boolean} True if event has any of the categories
   */
  hasAnyCategory(categories) {
    return categories.some(category => this.hasCategory(category));
  }

  /**
   * Check if event has all of the specified categories
   * @param {string[]} categories - Categories to check
   * @returns {boolean} True if event has all of the categories
   */
  hasAllCategories(categories) {
    return categories.every(category => this.hasCategory(category));
  }

  // ============ Validation Methods ============

  /**
   * Validate attendees
   * @private
   * @throws {Error} If attendees are invalid
   */
  _validateAttendees() {
    for (const attendee of this.attendees) {
      if (!attendee.email) {
        throw new Error('All attendees must have an email address');
      }
      if (!attendee.name) {
        attendee.name = attendee.email; // Use email as fallback name
      }
      if (!this._isValidEmail(attendee.email)) {
        throw new Error(`Invalid attendee email: ${attendee.email}`);
      }
    }
  }

  /**
   * Validate reminders
   * @private
   * @throws {Error} If reminders are invalid
   */
  _validateReminders() {
    for (const reminder of this.reminders) {
      if (typeof reminder.minutesBefore !== 'number' || reminder.minutesBefore < 0) {
        throw new Error('Reminder minutesBefore must be a positive number');
      }

      const validMethods = ['email', 'popup', 'sms'];
      if (!validMethods.includes(reminder.method)) {
        throw new Error(`Invalid reminder method: ${reminder.method}`);
      }
    }
  }

  /**
   * Validate email address
   * @private
   * @param {string} email - Email to validate
   * @returns {boolean} True if email is valid
   */
  _isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  // ============ Enhanced Getters ============

  /**
   * Check if the event is cancelled
   * @returns {boolean} True if event is cancelled
   */
  get isCancelled() {
    return this.status === 'cancelled';
  }

  /**
   * Check if the event is tentative
   * @returns {boolean} True if event is tentative
   */
  get isTentative() {
    return this.status === 'tentative';
  }

  /**
   * Check if the event is confirmed
   * @returns {boolean} True if event is confirmed
   */
  get isConfirmed() {
    return this.status === 'confirmed';
  }

  /**
   * Check if the event is private
   * @returns {boolean} True if event is private
   */
  get isPrivate() {
    return this.visibility === 'private';
  }

  /**
   * Check if the event is public
   * @returns {boolean} True if event is public
   */
  get isPublic() {
    return this.visibility === 'public';
  }

  /**
   * Check if the event has attendees
   * @returns {boolean} True if event has attendees
   */
  get hasAttendees() {
    return this.attendees.length > 0;
  }

  /**
   * Check if the event has reminders
   * @returns {boolean} True if event has reminders
   */
  get hasReminders() {
    return this.reminders.length > 0;
  }

  /**
   * Check if the event is a meeting (has attendees or conference data)
   * @returns {boolean} True if event is a meeting
   */
  get isMeeting() {
    return this.hasAttendees || this.conferenceData !== null;
  }

  /**
   * Check if the event is virtual (has conference data)
   * @returns {boolean} True if event is virtual
   */
  get isVirtual() {
    return this.conferenceData !== null;
  }
}

/**
 * DateUtils - Date manipulation utilities
 * Pure functions, no external dependencies
 * Locker Service compatible
 */
class DateUtils {
  /**
   * Get the start of a day
   * @param {Date} date - The date
   * @returns {Date}
   */
  static startOfDay(date) {
    const result = new Date(date);
    result.setHours(0, 0, 0, 0);
    return result;
  }

  /**
   * Get the end of a day
   * @param {Date} date - The date
   * @returns {Date}
   */
  static endOfDay(date) {
    const result = new Date(date);
    result.setHours(23, 59, 59, 999);
    return result;
  }

  /**
   * Get the start of a week
   * @param {Date} date - The date
   * @param {number} [weekStartsOn=0] - 0 = Sunday, 1 = Monday, etc.
   * @returns {Date} Start of the week
   */
  static startOfWeek(date, weekStartsOn = 0) {
    const result = new Date(date);
    const day = result.getDay();
    const diff = (day < weekStartsOn ? 7 : 0) + day - weekStartsOn;

    // Use setTime to handle month/year boundaries correctly
    result.setTime(result.getTime() - (diff * 24 * 60 * 60 * 1000));
    result.setHours(0, 0, 0, 0);
    return result;
  }

  /**
   * Get the end of a week
   * @param {Date} date - The date
   * @param {number} weekStartsOn - 0 = Sunday, 1 = Monday, etc.
   * @returns {Date}
   */
  static endOfWeek(date, weekStartsOn = 0) {
    const result = DateUtils.startOfWeek(date, weekStartsOn);
    // Use setTime to handle month/year boundaries correctly
    result.setTime(result.getTime() + (6 * 24 * 60 * 60 * 1000));
    result.setHours(23, 59, 59, 999);
    return result;
  }

  /**
   * Get the start of a month
   * @param {Date} date - The date
   * @returns {Date}
   */
  static startOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
  }

  /**
   * Get the end of a month
   * @param {Date} date - The date
   * @returns {Date}
   */
  static endOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
  }

  /**
   * Get the start of a year
   * @param {Date} date - The date
   * @returns {Date}
   */
  static startOfYear(date) {
    return new Date(date.getFullYear(), 0, 1, 0, 0, 0, 0);
  }

  /**
   * Get the end of a year
   * @param {Date} date - The date
   * @returns {Date}
   */
  static endOfYear(date) {
    return new Date(date.getFullYear(), 11, 31, 23, 59, 59, 999);
  }

  /**
   * Add days to a date
   * @param {Date} date - The date
   * @param {number} days - Number of days to add (can be negative)
   * @returns {Date}
   */
  static addDays(date, days) {
    const result = new Date(date);
    // Use setTime to handle month/year boundaries correctly
    result.setTime(result.getTime() + (days * 24 * 60 * 60 * 1000));
    return result;
  }

  /**
   * Add weeks to a date
   * @param {Date} date - The date
   * @param {number} weeks - Number of weeks to add
   * @returns {Date}
   */
  static addWeeks(date, weeks) {
    return DateUtils.addDays(date, weeks * 7);
  }

  /**
   * Add months to a date
   * @param {Date} date - The date
   * @param {number} months - Number of months to add
   * @returns {Date}
   */
  static addMonths(date, months) {
    const result = new Date(date);
    const dayOfMonth = result.getDate();
    result.setMonth(result.getMonth() + months);

    // Handle edge case where day doesn't exist in new month
    if (result.getDate() !== dayOfMonth) {
      result.setDate(0); // Go to last day of previous month
    }

    return result;
  }

  /**
   * Add years to a date
   * @param {Date} date - The date
   * @param {number} years - Number of years to add
   * @returns {Date}
   */
  static addYears(date, years) {
    const result = new Date(date);
    result.setFullYear(result.getFullYear() + years);
    return result;
  }

  /**
   * Check if a date is today
   * @param {Date} date - The date to check
   * @returns {boolean}
   */
  static isToday(date) {
    const today = new Date();
    return date.toDateString() === today.toDateString();
  }

  /**
   * Check if a date is in the past
   * @param {Date} date - The date to check
   * @returns {boolean}
   */
  static isPast(date) {
    return date < new Date();
  }

  /**
   * Check if a date is in the future
   * @param {Date} date - The date to check
   * @returns {boolean}
   */
  static isFuture(date) {
    return date > new Date();
  }

  /**
   * Check if two dates are on the same day
   * @param {Date} date1 - First date
   * @param {Date} date2 - Second date
   * @returns {boolean}
   */
  static isSameDay(date1, date2) {
    return date1.getFullYear() === date2.getFullYear() &&
           date1.getMonth() === date2.getMonth() &&
           date1.getDate() === date2.getDate();
  }

  /**
   * Check if two dates are in the same week
   * @param {Date} date1 - First date
   * @param {Date} date2 - Second date
   * @param {number} weekStartsOn - 0 = Sunday, 1 = Monday, etc.
   * @returns {boolean}
   */
  static isSameWeek(date1, date2, weekStartsOn = 0) {
    const week1Start = DateUtils.startOfWeek(date1, weekStartsOn);
    const week2Start = DateUtils.startOfWeek(date2, weekStartsOn);
    return week1Start.toDateString() === week2Start.toDateString();
  }

  /**
   * Check if two dates are in the same month
   * @param {Date} date1 - First date
   * @param {Date} date2 - Second date
   * @returns {boolean}
   */
  static isSameMonth(date1, date2) {
    return date1.getFullYear() === date2.getFullYear() &&
           date1.getMonth() === date2.getMonth();
  }

  /**
   * Check if two dates are in the same year
   * @param {Date} date1 - First date
   * @param {Date} date2 - Second date
   * @returns {boolean}
   */
  static isSameYear(date1, date2) {
    return date1.getFullYear() === date2.getFullYear();
  }

  /**
   * Get the difference in days between two dates
   * @param {Date} date1 - First date
   * @param {Date} date2 - Second date
   * @returns {number}
   */
  static differenceInDays(date1, date2) {
    const diff = date1.getTime() - date2.getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  }

  /**
   * Get the difference in weeks between two dates
   * @param {Date} date1 - First date
   * @param {Date} date2 - Second date
   * @returns {number}
   */
  static differenceInWeeks(date1, date2) {
    return Math.floor(DateUtils.differenceInDays(date1, date2) / 7);
  }

  /**
   * Get the difference in months between two dates
   * @param {Date} date1 - First date
   * @param {Date} date2 - Second date
   * @returns {number}
   */
  static differenceInMonths(date1, date2) {
    const yearDiff = date1.getFullYear() - date2.getFullYear();
    const monthDiff = date1.getMonth() - date2.getMonth();
    return yearDiff * 12 + monthDiff;
  }

  /**
   * Get the week number of a date
   * @param {Date} date - The date
   * @returns {number}
   */
  static getWeekNumber(date) {
    const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
    const pastDaysOfYear = (date - firstDayOfYear) / 86400000;
    return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
  }

  /**
   * Get the day of week for a date
   * @param {Date} date - The date
   * @param {number} weekStartsOn - 0 = Sunday, 1 = Monday, etc.
   * @returns {number} 0-6 where 0 is the first day of the week
   */
  static getDayOfWeek(date, weekStartsOn = 0) {
    const day = date.getDay();
    return (day - weekStartsOn + 7) % 7;
  }

  /**
   * Get days in a month
   * @param {Date} date - Any date in the month
   * @returns {number}
   */
  static getDaysInMonth(date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  }

  /**
   * Format a date using Intl.DateTimeFormat
   * @param {Date} date - The date to format
   * @param {string} locale - The locale
   * @param {Object} options - Intl.DateTimeFormat options
   * @returns {string}
   */
  static format(date, locale = 'en-US', options = {}) {
    return new Intl.DateTimeFormat(locale, options).format(date);
  }

  /**
   * Get month name
   * @param {Date} date - The date
   * @param {string} locale - The locale
   * @param {string} format - 'long', 'short', or 'narrow'
   * @returns {string}
   */
  static getMonthName(date, locale = 'en-US', format = 'long') {
    return DateUtils.format(date, locale, { month: format });
  }

  /**
   * Get day name
   * @param {Date} date - The date
   * @param {string} locale - The locale
   * @param {string} format - 'long', 'short', or 'narrow'
   * @returns {string}
   */
  static getDayName(date, locale = 'en-US', format = 'long') {
    return DateUtils.format(date, locale, { weekday: format });
  }

  /**
   * Format time
   * @param {Date} date - The date
   * @param {string} locale - The locale
   * @param {boolean} use24Hour - Use 24-hour format
   * @returns {string}
   */
  static formatTime(date, locale = 'en-US', use24Hour = false) {
    return DateUtils.format(date, locale, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: !use24Hour
    });
  }

  /**
   * Parse a time string (HH:MM) to hours and minutes
   * @param {string} timeString - Time string like "09:30"
   * @returns {{hours: number, minutes: number}}
   */
  static parseTime(timeString) {
    const [hours, minutes] = timeString.split(':').map(Number);
    return { hours, minutes };
  }

  /**
   * Set time on a date
   * @param {Date} date - The date
   * @param {string} timeString - Time string like "09:30"
   * @returns {Date}
   */
  static setTime(date, timeString) {
    const result = new Date(date);
    const { hours, minutes } = DateUtils.parseTime(timeString);
    result.setHours(hours, minutes, 0, 0);
    return result;
  }

  /**
   * Check if a year is a leap year
   * @param {number} year - The year
   * @returns {boolean}
   */
  static isLeapYear(year) {
    return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  }

  /**
   * Get an array of dates between start and end
   * @param {Date} start - Start date
   * @param {Date} end - End date
   * @returns {Date[]}
   */
  static getDateRange(start, end) {
    const dates = [];
    const current = new Date(start);
    const endTime = end.getTime();

    while (current.getTime() <= endTime) {
      dates.push(new Date(current));
      // Use setTime to handle month/year boundaries correctly
      current.setTime(current.getTime() + (24 * 60 * 60 * 1000));
    }

    return dates;
  }

  /**
   * Clone a date
   * @param {Date} date - The date to clone
   * @returns {Date}
   */
  static clone(date) {
    return new Date(date);
  }

  /**
   * Validate if a value is a valid date
   * @param {*} value - Value to check
   * @returns {boolean}
   */
  static isValidDate(value) {
    return value instanceof Date && !isNaN(value.getTime());
  }

  /**
   * Convert a date to a specific timezone
   * @param {Date} date - The date to convert
   * @param {string} timeZone - IANA timezone string (e.g., 'America/New_York')
   * @returns {Date} - Date object adjusted for timezone
   */
  static toTimeZone(date, timeZone) {
    // Get the date string in the target timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });

    const parts = formatter.formatToParts(date);
    const dateObj = {};
    parts.forEach(part => {
      if (part.type !== 'literal') {
        dateObj[part.type] = part.value;
      }
    });

    // Create new date in the target timezone
    return new Date(
      `${dateObj.year}-${dateObj.month}-${dateObj.day}T${dateObj.hour}:${dateObj.minute}:${dateObj.second}`
    );
  }

  /**
   * Get timezone offset in minutes for a date
   * @param {Date} date - The date
   * @param {string} timeZone - IANA timezone string
   * @returns {number} - Offset in minutes
   */
  static getTimezoneOffset(date, timeZone) {
    const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
    const tzDate = new Date(date.toLocaleString('en-US', { timeZone }));
    return (utcDate.getTime() - tzDate.getTime()) / 60000;
  }

  /**
   * Check if DST is in effect for a date in a timezone
   * @param {Date} date - The date to check
   * @param {string} timeZone - IANA timezone string
   * @returns {boolean}
   */
  static isDST(date, timeZone) {
    const jan = new Date(date.getFullYear(), 0, 1);
    const jul = new Date(date.getFullYear(), 6, 1);
    const janOffset = DateUtils.getTimezoneOffset(jan, timeZone);
    const julOffset = DateUtils.getTimezoneOffset(jul, timeZone);
    const currentOffset = DateUtils.getTimezoneOffset(date, timeZone);

    return Math.max(janOffset, julOffset) === currentOffset;
  }

  /**
   * Add time accounting for DST transitions
   * @param {Date} date - The date
   * @param {number} hours - Hours to add
   * @param {string} timeZone - IANA timezone string
   * @returns {Date}
   */
  static addHoursWithDST(date, hours, timeZone) {
    const result = new Date(date);
    const originalOffset = DateUtils.getTimezoneOffset(date, timeZone);

    // Add hours
    result.setTime(result.getTime() + (hours * 60 * 60 * 1000));

    // Check if DST transition occurred
    const newOffset = DateUtils.getTimezoneOffset(result, timeZone);
    if (originalOffset !== newOffset) {
      // Adjust for DST change
      const dstAdjustment = (newOffset - originalOffset) * 60000;
      result.setTime(result.getTime() + dstAdjustment);
    }

    return result;
  }

  /**
   * Create a date in a specific timezone
   * @param {number} year
   * @param {number} month - 0-indexed
   * @param {number} day
   * @param {number} hour
   * @param {number} minute
   * @param {number} second
   * @param {string} timeZone - IANA timezone string
   * @returns {Date}
   */
  static createInTimeZone(year, month, day, hour = 0, minute = 0, second = 0, timeZone) {
    // Create date string in ISO format
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;

    // Parse the local date in the target timezone
    const localDate = new Date(`${dateStr}T${timeStr}`);

    // Get offset and adjust
    const offset = DateUtils.getTimezoneOffset(localDate, timeZone);
    const utcTime = localDate.getTime() + (offset * 60000);

    return new Date(utcTime);
  }
}

/**
 * RecurrenceEngine - Handles expansion of recurring events
 * Supports a subset of RFC 5545 (iCalendar) RRULE specification
 */
class RecurrenceEngine {
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
    const tzManager = new TimezoneManager();

    // Work in event's timezone for accurate recurrence calculation
    let currentDate = new Date(event.start);
    let count = 0;

    // If UNTIL is specified, use it as the range end
    if (rule.until && rule.until < rangeEnd) {
      rangeEnd = rule.until;
    }

    // Track DST transitions for proper timezone handling
    let lastOffset = tzManager.getTimezoneOffset(currentDate, eventTimezone);

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
      currentDate = this.getNextOccurrence(currentDate, rule, eventTimezone);
      count++;

      // Check COUNT limit
      if (rule.count && count >= rule.count) {
        break;
      }
    }

    return occurrences;
  }

  /**
   * Parse an RRULE string into a rule object
   * @param {string|import('../../types.js').RecurrenceRule} ruleString - RRULE string (e.g., "FREQ=DAILY;INTERVAL=1;COUNT=10") or rule object
   * @returns {import('../../types.js').RecurrenceRule} Parsed rule object
   */
  static parseRule(ruleString) {
    const rule = {
      freq: null,
      interval: 1,
      count: null,
      until: null,
      byDay: [],
      byMonthDay: [],
      byMonth: [],
      bySetPos: [],
      exceptions: []
    };

    if (typeof ruleString === 'object') {
      return { ...rule, ...ruleString };
    }

    const parts = ruleString.split(';');
    parts.forEach(part => {
      const [key, value] = part.split('=');
      switch (key.toUpperCase()) {
        case 'FREQ':
          rule.freq = value.toUpperCase();
          break;
        case 'INTERVAL':
          rule.interval = parseInt(value, 10);
          break;
        case 'COUNT':
          rule.count = parseInt(value, 10);
          break;
        case 'UNTIL':
          rule.until = this.parseDate(value);
          break;
        case 'BYDAY':
          rule.byDay = value.split(',');
          break;
        case 'BYMONTHDAY':
          rule.byMonthDay = value.split(',').map(d => parseInt(d, 10));
          break;
        case 'BYMONTH':
          rule.byMonth = value.split(',').map(m => parseInt(m, 10));
          break;
        case 'BYSETPOS':
          rule.bySetPos = value.split(',').map(p => parseInt(p, 10));
          break;
      }
    });

    return rule;
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
      case 'DAILY':
        next.setDate(next.getDate() + rule.interval);
        break;

      case 'WEEKLY':
        if (rule.byDay && rule.byDay.length > 0) {
          // Find next day that matches byDay
          next.setDate(next.getDate() + 1);
          while (!this.matchesByDay(next, rule.byDay)) {
            next.setDate(next.getDate() + 1);
          }
        } else {
          // Simple weekly recurrence
          next.setDate(next.getDate() + (7 * rule.interval));
        }
        break;

      case 'MONTHLY':
        if (rule.byMonthDay && rule.byMonthDay.length > 0) {
          // Specific day(s) of month
          const currentMonth = next.getMonth();
          next.setMonth(currentMonth + rule.interval);
          next.setDate(rule.byMonthDay[0]); // Use first specified day
        } else if (rule.byDay && rule.byDay.length > 0) {
          // Specific weekday of month (e.g., "2nd Tuesday")
          next.setMonth(next.getMonth() + rule.interval);
          this.setToWeekdayOfMonth(next, rule.byDay[0], rule.bySetPos[0] || 1);
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
        next.setTime(next.getTime() + (24 * 60 * 60 * 1000)); // Daily fallback
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
      'SU': 0, 'MO': 1, 'TU': 2, 'WE': 3,
      'TH': 4, 'FR': 5, 'SA': 6
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
      'SU': 0, 'MO': 1, 'TU': 2, 'WE': 3,
      'TH': 4, 'FR': 5, 'SA': 6
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
      date.setDate(date.getDate() + (7 * (position - 1)));
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
      } else {
        // Simple date exception
        const exceptionDate = exDate instanceof Date ? exDate : new Date(exDate);
        return exceptionDate.toDateString() === dateStr;
      }
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
      } else {
        return new Date(year, month, day, hour, minute, second);
      }
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
      'SU': 'Sunday', 'MO': 'Monday', 'TU': 'Tuesday',
      'WE': 'Wednesday', 'TH': 'Thursday', 'FR': 'Friday',
      'SA': 'Saturday'
    };

    // Extract day code if it has a number prefix
    const match = dayCode.match(/^(-?\d+)?([A-Z]{2})$/);
    const code = match ? match[2] : dayCode;
    const position = match && match[1] ? parseInt(match[1], 10) : null;

    let name = dayNames[code] || dayCode;

    if (position) {
      const ordinals = ['', '1st', '2nd', '3rd', '4th', '5th'];
      const ordinal = position === -1 ? 'Last' : (ordinals[position] || `${position}th`);
      name = `${ordinal} ${name}`;
    }

    return name;
  }
}

/**
 * LRU (Least Recently Used) Cache implementation
 * Provides O(1) get and put operations
 */
class LRUCache {
  /**
   * Create a new LRU Cache
   * @param {number} capacity - Maximum number of items in cache
   */
  constructor(capacity = 100) {
    this.capacity = capacity;
    this.cache = new Map();
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  /**
   * Get a value from the cache
   * @param {string} key - Cache key
   * @returns {*} Cached value or undefined
   */
  get(key) {
    if (!this.cache.has(key)) {
      this.misses++;
      return undefined;
    }

    // Move to end (most recently used)
    const value = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, value);
    this.hits++;
    return value;
  }

  /**
   * Put a value in the cache
   * @param {string} key - Cache key
   * @param {*} value - Value to cache
   */
  put(key, value) {
    // Remove if exists to update position
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.capacity) {
      // Remove least recently used (first item)
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
      this.evictions++;
    }

    this.cache.set(key, value);
  }

  /**
   * Check if key exists in cache
   * @param {string} key - Cache key
   * @returns {boolean} True if key exists
   */
  has(key) {
    return this.cache.has(key);
  }

  /**
   * Remove a key from the cache
   * @param {string} key - Cache key
   * @returns {boolean} True if key was removed
   */
  delete(key) {
    return this.cache.delete(key);
  }

  /**
   * Clear all cached items
   */
  clear() {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache stats
   */
  getStats() {
    const hitRate = this.hits + this.misses > 0
      ? (this.hits / (this.hits + this.misses) * 100).toFixed(2)
      : 0;

    return {
      size: this.cache.size,
      capacity: this.capacity,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      hitRate: `${hitRate}%`
    };
  }

  /**
   * Get all keys in order (least to most recently used)
   * @returns {string[]} Array of keys
   */
  keys() {
    return Array.from(this.cache.keys());
  }

  /**
   * Get cache size
   * @returns {number} Number of items in cache
   */
  get size() {
    return this.cache.size;
  }
}

/**
 * PerformanceOptimizer - Optimizes calendar operations for large datasets
 * Includes caching, lazy loading, and batch processing
 */


class PerformanceOptimizer {
  constructor(config = {}) {
    // Configuration
    this.config = {
      enableCache: true,
      cacheCapacity: 500,
      maxIndexDays: 365,
      batchSize: 100,
      enableMetrics: true,
      cleanupInterval: 3600000, // 1 hour in ms
      maxIndexAge: 30 * 24 * 60 * 60 * 1000, // 30 days in ms
      ...config
    };

    // Caches
    this.eventCache = new LRUCache(this.config.cacheCapacity);
    this.queryCache = new LRUCache(Math.floor(this.config.cacheCapacity / 2));
    this.dateRangeCache = new LRUCache(Math.floor(this.config.cacheCapacity / 4));

    // Lazy loading tracking
    this.lazyIndexes = new Map(); // eventId -> Set of date strings
    this.pendingIndexes = new Map(); // eventId -> Promise

    // Batch processing
    this.batchQueue = [];
    this.batchTimer = null;
    this.batchCallbacks = [];

    // Performance metrics
    this.metrics = {
      operations: {},
      averageTimes: {},
      slowQueries: []
    };

    // Cleanup timer
    this.cleanupTimer = null;
    if (this.config.cleanupInterval > 0) {
      this.startCleanupTimer();
    }
  }

  /**
   * Measure operation performance
   * @param {string} operation - Operation name
   * @param {Function} fn - Function to measure
   * @returns {*} Function result
   */
  measure(operation, fn) {
    if (!this.config.enableMetrics) {
      return fn();
    }

    const start = performance.now();
    try {
      const result = fn();
      const duration = performance.now() - start;
      this.recordMetric(operation, duration);
      return result;
    } catch (error) {
      const duration = performance.now() - start;
      this.recordMetric(operation, duration, true);
      throw error;
    }
  }

  /**
   * Measure async operation performance
   * @param {string} operation - Operation name
   * @param {Function} fn - Async function to measure
   * @returns {Promise<*>} Function result
   */
  async measureAsync(operation, fn) {
    if (!this.config.enableMetrics) {
      return await fn();
    }

    const start = performance.now();
    try {
      const result = await fn();
      const duration = performance.now() - start;
      this.recordMetric(operation, duration);
      return result;
    } catch (error) {
      const duration = performance.now() - start;
      this.recordMetric(operation, duration, true);
      throw error;
    }
  }

  /**
   * Record performance metric
   * @private
   */
  recordMetric(operation, duration, isError = false) {
    if (!this.metrics.operations[operation]) {
      this.metrics.operations[operation] = {
        count: 0,
        totalTime: 0,
        errors: 0,
        min: Infinity,
        max: 0
      };
    }

    const metric = this.metrics.operations[operation];
    metric.count++;
    metric.totalTime += duration;
    metric.min = Math.min(metric.min, duration);
    metric.max = Math.max(metric.max, duration);

    if (isError) {
      metric.errors++;
    }

    // Update average
    this.metrics.averageTimes[operation] = metric.totalTime / metric.count;

    // Track slow queries
    if (duration > 100) {
      this.metrics.slowQueries.push({
        operation,
        duration,
        timestamp: new Date(),
        isError
      });

      // Keep only last 100 slow queries
      if (this.metrics.slowQueries.length > 100) {
        this.metrics.slowQueries.shift();
      }
    }
  }

  /**
   * Get performance metrics
   * @returns {Object} Performance metrics
   */
  getMetrics() {
    const summary = {
      cacheStats: {
        event: this.eventCache.getStats(),
        query: this.queryCache.getStats(),
        dateRange: this.dateRangeCache.getStats()
      },
      operations: {},
      slowestOperations: [],
      recentSlowQueries: this.metrics.slowQueries.slice(-10)
    };

    // Process operations
    for (const [op, data] of Object.entries(this.metrics.operations)) {
      summary.operations[op] = {
        count: data.count,
        avgTime: `${(data.totalTime / data.count).toFixed(2)}ms`,
        minTime: `${data.min.toFixed(2)}ms`,
        maxTime: `${data.max.toFixed(2)}ms`,
        totalTime: `${data.totalTime.toFixed(2)}ms`,
        errors: data.errors,
        errorRate: `${((data.errors / data.count) * 100).toFixed(2)}%`
      };
    }

    // Find slowest operations
    summary.slowestOperations = Object.entries(this.metrics.averageTimes)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([op, time]) => ({
        operation: op,
        avgTime: `${time.toFixed(2)}ms`
      }));

    return summary;
  }

  /**
   * Check if event should use lazy indexing
   * @param {import('../events/Event.js').Event} event - Event to check
   * @returns {boolean} True if should use lazy indexing
   */
  shouldUseLazyIndexing(event) {
    const daySpan = Math.ceil(
      (event.end - event.start) / (24 * 60 * 60 * 1000)
    );
    return daySpan > this.config.maxIndexDays;
  }

  /**
   * Create lazy index markers for large events
   * @param {import('../events/Event.js').Event} event - Event to index
   * @returns {Object} Index boundaries
   */
  createLazyIndexMarkers(event) {
    const markers = {
      eventId: event.id,
      start: event.start,
      end: event.end,
      indexed: new Set(),
      pending: false
    };

    // Index first and last month only initially
    const startMonth = new Date(event.start.getFullYear(), event.start.getMonth(), 1);
    const endMonth = new Date(event.end.getFullYear(), event.end.getMonth(), 1);

    markers.indexed.add(this.getMonthKey(startMonth));
    if (this.getMonthKey(startMonth) !== this.getMonthKey(endMonth)) {
      markers.indexed.add(this.getMonthKey(endMonth));
    }

    this.lazyIndexes.set(event.id, markers);
    return markers;
  }

  /**
   * Expand lazy index for a specific date range
   * @param {string} eventId - Event ID
   * @param {Date} rangeStart - Start of range to index
   * @param {Date} rangeEnd - End of range to index
   * @returns {Promise<Set<string>>} Indexed date strings
   */
  async expandLazyIndex(eventId, rangeStart, rangeEnd) {
    const markers = this.lazyIndexes.get(eventId);
    if (!markers) {
      return new Set();
    }

    // Check if already pending
    if (markers.pending) {
      return this.pendingIndexes.get(eventId);
    }

    markers.pending = true;

    const promise = new Promise((resolve) => {
      // Simulate async indexing (in real app, could be in worker)
      setTimeout(() => {
        const indexed = new Set();
        const current = new Date(rangeStart);

        while (current <= rangeEnd) {
          const dateStr = current.toDateString();
          if (!markers.indexed.has(dateStr)) {
            indexed.add(dateStr);
            markers.indexed.add(dateStr);
          }
          current.setDate(current.getDate() + 1);
        }

        markers.pending = false;
        this.pendingIndexes.delete(eventId);
        resolve(indexed);
      }, 0);
    });

    this.pendingIndexes.set(eventId, promise);
    return promise;
  }

  /**
   * Get month key for date
   * @private
   */
  getMonthKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  /**
   * Cache event with TTL
   * @param {string} key - Cache key
   * @param {*} value - Value to cache
   * @param {string} cacheType - Type of cache to use
   */
  cache(key, value, cacheType = 'event') {
    if (!this.config.enableCache) return;

    switch (cacheType) {
      case 'event':
        this.eventCache.put(key, value);
        break;
      case 'query':
        this.queryCache.put(key, value);
        break;
      case 'dateRange':
        this.dateRangeCache.put(key, value);
        break;
    }
  }

  /**
   * Get from cache
   * @param {string} key - Cache key
   * @param {string} cacheType - Type of cache
   * @returns {*} Cached value or undefined
   */
  getFromCache(key, cacheType = 'event') {
    if (!this.config.enableCache) return undefined;

    switch (cacheType) {
      case 'event':
        return this.eventCache.get(key);
      case 'query':
        return this.queryCache.get(key);
      case 'dateRange':
        return this.dateRangeCache.get(key);
      default:
        return undefined;
    }
  }

  /**
   * Invalidate caches for an event
   * @param {string} eventId - Event ID
   */
  invalidateEventCaches(eventId) {
    // Remove from event cache
    this.eventCache.delete(eventId);

    // Clear query cache (conservative approach)
    // In production, track which queries include this event
    this.queryCache.clear();
    this.dateRangeCache.clear();
  }

  /**
   * Batch operation for efficiency
   * @param {Function} operation - Operation to batch
   * @returns {Promise} Batch result
   */
  batch(operation) {
    return new Promise((resolve, reject) => {
      this.batchQueue.push(operation);
      this.batchCallbacks.push({ resolve, reject });

      if (this.batchQueue.length >= this.config.batchSize) {
        this.processBatch();
      } else if (!this.batchTimer) {
        // Process batch after 10ms if not full
        this.batchTimer = setTimeout(() => this.processBatch(), 10);
      }
    });
  }

  /**
   * Process batched operations
   * @private
   */
  processBatch() {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    if (this.batchQueue.length === 0) return;

    const operations = this.batchQueue.splice(0);
    const callbacks = this.batchCallbacks.splice(0);

    // Process all operations
    const results = [];
    const errors = [];

    operations.forEach((op, index) => {
      try {
        results[index] = op();
      } catch (error) {
        errors[index] = error;
      }
    });

    // Resolve callbacks
    callbacks.forEach((callback, index) => {
      if (errors[index]) {
        callback.reject(errors[index]);
      } else {
        callback.resolve(results[index]);
      }
    });
  }

  /**
   * Start cleanup timer for old indexes
   * @private
   */
  startCleanupTimer() {
    this.cleanupTimer = setInterval(() => {
      this.cleanupOldIndexes();
    }, this.config.cleanupInterval);
  }

  /**
   * Clean up old indexes
   * @private
   */
  cleanupOldIndexes() {
    const now = Date.now();
    const maxAge = this.config.maxIndexAge;

    // Clean up lazy indexes for events that are too old
    for (const [eventId, markers] of this.lazyIndexes) {
      if (markers.end.getTime() < now - maxAge) {
        this.lazyIndexes.delete(eventId);
      }
    }

    // Clean up slow query log
    if (this.metrics.slowQueries.length > 100) {
      this.metrics.slowQueries = this.metrics.slowQueries.slice(-100);
    }
  }

  /**
   * Optimize query by checking cache first
   * @param {string} queryKey - Unique query identifier
   * @param {Function} queryFn - Function to execute if not cached
   * @returns {*} Query result
   */
  optimizeQuery(queryKey, queryFn) {
    // Check cache first
    const cached = this.getFromCache(queryKey, 'query');
    if (cached !== undefined) {
      return cached;
    }

    // Execute query and cache result
    const result = this.measure(`query:${queryKey}`, queryFn);
    this.cache(queryKey, result, 'query');
    return result;
  }

  /**
   * Destroy optimizer and clean up resources
   */
  destroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    this.eventCache.clear();
    this.queryCache.clear();
    this.dateRangeCache.clear();
    this.lazyIndexes.clear();
    this.pendingIndexes.clear();
  }
}

/**
 * ConflictDetector - Detects scheduling conflicts between events
 * Checks for time overlaps, attendee conflicts, and resource conflicts
 */


class ConflictDetector {
  /**
   * Create a new ConflictDetector
   * @param {import('../events/EventStore.js').EventStore} eventStore - Event store instance
   */
  constructor(eventStore) {
    this.eventStore = eventStore;
    this.conflictIdCounter = 0;
  }

  /**
   * Check for conflicts for a specific event
   * @param {import('../events/Event.js').Event|import('../../types.js').EventData} event - Event to check
   * @param {import('../../types.js').ConflictCheckOptions} [options={}] - Check options
   * @returns {import('../../types.js').ConflictSummary} Conflict summary
   */
  checkConflicts(event, options = {}) {
    // Default options
    const opts = {
      checkAttendees: true,
      checkResources: true,
      checkLocation: true,
      ignoreAllDay: false,
      excludeEventIds: [],
      includeStatuses: ['confirmed', 'tentative'],
      bufferMinutes: 0,
      ...options
    };

    // Ensure we have an Event object
    if (!event.start || !event.end) {
      throw new Error('Event must have start and end dates');
    }

    const conflicts = [];
    const affectedEventIds = new Set();
    const affectedAttendees = new Set();

    // Get potential conflicting events in the time range
    const searchStart = new Date(event.start.getTime() - opts.bufferMinutes * 60000);
    const searchEnd = new Date(event.end.getTime() + opts.bufferMinutes * 60000);

    const potentialConflicts = this.eventStore.getEventsInRange(searchStart, searchEnd, false)
      .filter(e => {
        // Exclude self
        if (e.id === event.id) return false;
        // Exclude specified event IDs
        if (opts.excludeEventIds.includes(e.id)) return false;
        // Filter by status
        if (!opts.includeStatuses.includes(e.status)) return false;
        // Ignore all-day events if specified
        if (opts.ignoreAllDay && (e.allDay || event.allDay)) return false;
        // Ignore cancelled events
        if (e.status === 'cancelled') return false;
        return true;
      });

    // Check each potential conflict
    for (const conflictingEvent of potentialConflicts) {
      const eventConflicts = this._detectEventConflicts(
        event,
        conflictingEvent,
        opts
      );

      if (eventConflicts.length > 0) {
        conflicts.push(...eventConflicts);
        affectedEventIds.add(event.id);
        affectedEventIds.add(conflictingEvent.id);

        // Track affected attendees
        if (event.attendees) {
          event.attendees.forEach(a => affectedAttendees.add(a.email));
        }
        if (conflictingEvent.attendees) {
          conflictingEvent.attendees.forEach(a => affectedAttendees.add(a.email));
        }
      }
    }

    // Build summary
    return this._buildConflictSummary(conflicts, affectedEventIds, affectedAttendees);
  }

  /**
   * Check for conflicts between two specific events
   * @param {import('../events/Event.js').Event} event1 - First event
   * @param {import('../events/Event.js').Event} event2 - Second event
   * @param {import('../../types.js').ConflictCheckOptions} [options={}] - Check options
   * @returns {import('../../types.js').ConflictDetails[]} Array of conflicts
   */
  checkEventPairConflicts(event1, event2, options = {}) {
    const opts = {
      checkAttendees: true,
      checkResources: true,
      checkLocation: true,
      bufferMinutes: 0,
      ...options
    };

    return this._detectEventConflicts(event1, event2, opts);
  }

  /**
   * Get busy periods for a set of attendees
   * @param {string[]} attendeeEmails - Attendee email addresses
   * @param {Date} start - Start of period
   * @param {Date} end - End of period
   * @param {Object} [options={}] - Options
   * @returns {Array<{start: Date, end: Date, eventIds: string[]}>} Busy periods
   */
  getBusyPeriods(attendeeEmails, start, end, options = {}) {
    const opts = {
      includeStatuses: ['confirmed', 'tentative'],
      mergePeriods: true,
      ...options
    };

    const busyPeriods = [];
    const events = this.eventStore.getEventsInRange(start, end, false);

    // Find events with these attendees
    const attendeeEvents = events.filter(event => {
      if (!opts.includeStatuses.includes(event.status)) return false;
      if (event.status === 'cancelled') return false;

      return event.attendees && event.attendees.some(attendee =>
        attendeeEmails.includes(attendee.email)
      );
    });

    // Convert to busy periods
    attendeeEvents.forEach(event => {
      busyPeriods.push({
        start: event.start,
        end: event.end,
        eventIds: [event.id]
      });
    });

    // Merge overlapping periods if requested
    if (opts.mergePeriods && busyPeriods.length > 1) {
      return this._mergeBusyPeriods(busyPeriods);
    }

    return busyPeriods.sort((a, b) => a.start - b.start);
  }

  /**
   * Get free time slots
   * @param {Date} start - Start of search period
   * @param {Date} end - End of search period
   * @param {number} duration - Required duration in minutes
   * @param {Object} [options={}] - Options
   * @returns {Array<{start: Date, end: Date}>} Free time slots
   */
  getFreePeriods(start, end, duration, options = {}) {
    const opts = {
      attendeeEmails: [],
      businessHoursOnly: false,
      businessHours: { start: '09:00', end: '17:00' },
      excludeWeekends: false,
      ...options
    };

    const freePeriods = [];

    // Get busy periods
    const busyPeriods = opts.attendeeEmails.length > 0
      ? this.getBusyPeriods(opts.attendeeEmails, start, end)
      : this._getAllBusyPeriods(start, end);

    // Find gaps between busy periods
    let currentTime = new Date(start);

    for (const busy of busyPeriods) {
      if (currentTime < busy.start) {
        // Found a gap
        const gapDuration = (busy.start - currentTime) / 60000; // minutes
        if (gapDuration >= duration) {
          // Check if within business hours if required
          if (!opts.businessHoursOnly || this._isWithinBusinessHours(currentTime, busy.start, opts)) {
            freePeriods.push({
              start: new Date(currentTime),
              end: new Date(busy.start)
            });
          }
        }
      }
      currentTime = new Date(Math.max(currentTime.getTime(), busy.end.getTime()));
    }

    // Check final period
    if (currentTime < end) {
      const gapDuration = (end - currentTime) / 60000;
      if (gapDuration >= duration) {
        if (!opts.businessHoursOnly || this._isWithinBusinessHours(currentTime, end, opts)) {
          freePeriods.push({
            start: new Date(currentTime),
            end: new Date(end)
          });
        }
      }
    }

    return freePeriods;
  }

  /**
   * Detect conflicts between two events
   * @private
   */
  _detectEventConflicts(event1, event2, options) {
    const conflicts = [];

    // Check time overlap with buffer
    const hasTimeOverlap = this._checkTimeOverlap(
      event1,
      event2,
      options.bufferMinutes
    );

    if (hasTimeOverlap) {
      // Time conflict
      const timeConflict = this._createTimeConflict(event1, event2);
      conflicts.push(timeConflict);

      // Check attendee conflicts (only if time overlaps)
      if (options.checkAttendees) {
        const attendeeConflicts = this._checkAttendeeConflicts(event1, event2);
        conflicts.push(...attendeeConflicts);
      }

      // Check resource conflicts (only if time overlaps)
      if (options.checkResources) {
        const resourceConflicts = this._checkResourceConflicts(event1, event2);
        conflicts.push(...resourceConflicts);
      }

      // Check location conflicts (only if time overlaps)
      if (options.checkLocation) {
        const locationConflict = this._checkLocationConflict(event1, event2);
        if (locationConflict) {
          conflicts.push(locationConflict);
        }
      }
    }

    return conflicts;
  }

  /**
   * Check for time overlap between events
   * @private
   */
  _checkTimeOverlap(event1, event2, bufferMinutes = 0) {
    const buffer = bufferMinutes * 60000; // Convert to milliseconds

    const start1 = event1.start.getTime() - buffer;
    const end1 = event1.end.getTime() + buffer;
    const start2 = event2.start.getTime();
    const end2 = event2.end.getTime();

    return !(end1 <= start2 || end2 <= start1);
  }

  /**
   * Create time conflict details
   * @private
   */
  _createTimeConflict(event1, event2) {
    const overlapStart = new Date(Math.max(event1.start.getTime(), event2.start.getTime()));
    const overlapEnd = new Date(Math.min(event1.end.getTime(), event2.end.getTime()));
    const overlapMinutes = (overlapEnd - overlapStart) / 60000;

    // Determine severity based on overlap duration and event importance
    let severity = 'low';
    if (overlapMinutes >= 60) {
      severity = 'high';
    } else if (overlapMinutes >= 30) {
      severity = 'medium';
    }

    // Increase severity for confirmed events
    if (event1.status === 'confirmed' && event2.status === 'confirmed') {
      severity = severity === 'low' ? 'medium' : severity === 'medium' ? 'high' : 'critical';
    }

    return {
      id: `conflict_${++this.conflictIdCounter}`,
      type: 'time',
      severity,
      eventId: event1.id,
      conflictingEventId: event2.id,
      description: `Time overlap: ${event1.title} conflicts with ${event2.title}`,
      overlapStart,
      overlapEnd,
      overlapMinutes,
      metadata: {
        event1Title: event1.title,
        event2Title: event2.title,
        event1Status: event1.status,
        event2Status: event2.status
      }
    };
  }

  /**
   * Check for attendee conflicts
   * @private
   */
  _checkAttendeeConflicts(event1, event2) {
    const conflicts = [];

    if (!event1.attendees || !event2.attendees) {
      return conflicts;
    }

    const conflictingAttendees = [];

    for (const attendee1 of event1.attendees) {
      for (const attendee2 of event2.attendees) {
        if (attendee1.email === attendee2.email) {
          // Same attendee in both events
          conflictingAttendees.push(attendee1.email);
        }
      }
    }

    if (conflictingAttendees.length > 0) {
      // Determine severity based on attendee responses
      let severity = 'medium';

      // Check if any conflicting attendee has accepted both
      const hasAcceptedBoth = conflictingAttendees.some(email => {
        const a1 = event1.attendees.find(a => a.email === email);
        const a2 = event2.attendees.find(a => a.email === email);
        return a1?.responseStatus === 'accepted' && a2?.responseStatus === 'accepted';
      });

      if (hasAcceptedBoth) {
        severity = 'critical';
      }

      conflicts.push({
        id: `conflict_${++this.conflictIdCounter}`,
        type: 'attendee',
        severity,
        eventId: event1.id,
        conflictingEventId: event2.id,
        description: `Attendee conflict: ${conflictingAttendees.length} attendee(s) double-booked`,
        conflictingAttendees,
        metadata: {
          attendeeCount: conflictingAttendees.length,
          attendeeEmails: conflictingAttendees
        }
      });
    }

    return conflicts;
  }

  /**
   * Check for resource conflicts
   * @private
   */
  _checkResourceConflicts(event1, event2) {
    const conflicts = [];

    // Check if events have resource attendees
    const resources1 = event1.attendees?.filter(a => a.resource) || [];
    const resources2 = event2.attendees?.filter(a => a.resource) || [];

    for (const resource1 of resources1) {
      for (const resource2 of resources2) {
        if (resource1.email === resource2.email) {
          conflicts.push({
            id: `conflict_${++this.conflictIdCounter}`,
            type: 'resource',
            severity: 'critical', // Resource conflicts are always critical
            eventId: event1.id,
            conflictingEventId: event2.id,
            description: `Resource conflict: ${resource1.name} is double-booked`,
            conflictingResource: resource1.email,
            metadata: {
              resourceName: resource1.name,
              resourceEmail: resource1.email
            }
          });
        }
      }
    }

    return conflicts;
  }

  /**
   * Check for location conflicts
   * @private
   */
  _checkLocationConflict(event1, event2) {
    if (!event1.location || !event2.location) {
      return null;
    }

    // Normalize locations for comparison
    const loc1 = event1.location.trim().toLowerCase();
    const loc2 = event2.location.trim().toLowerCase();

    if (loc1 === loc2) {
      return {
        id: `conflict_${++this.conflictIdCounter}`,
        type: 'location',
        severity: 'high', // Location conflicts are typically high severity
        eventId: event1.id,
        conflictingEventId: event2.id,
        description: `Location conflict: ${event1.location} is double-booked`,
        metadata: {
          location: event1.location
        }
      };
    }

    return null;
  }

  /**
   * Build conflict summary
   * @private
   */
  _buildConflictSummary(conflicts, affectedEventIds, affectedAttendees) {
    const conflictsByType = {};
    const conflictsBySeverity = {};

    // Count by type and severity
    for (const conflict of conflicts) {
      conflictsByType[conflict.type] = (conflictsByType[conflict.type] || 0) + 1;
      conflictsBySeverity[conflict.severity] = (conflictsBySeverity[conflict.severity] || 0) + 1;
    }

    return {
      hasConflicts: conflicts.length > 0,
      totalConflicts: conflicts.length,
      conflicts,
      conflictsByType,
      conflictsBySeverity,
      affectedEventIds: Array.from(affectedEventIds),
      affectedAttendees: Array.from(affectedAttendees)
    };
  }

  /**
   * Merge overlapping busy periods
   * @private
   */
  _mergeBusyPeriods(periods) {
    if (periods.length <= 1) return periods;

    // Sort by start time
    periods.sort((a, b) => a.start - b.start);

    const merged = [periods[0]];

    for (let i = 1; i < periods.length; i++) {
      const current = periods[i];
      const last = merged[merged.length - 1];

      if (current.start <= last.end) {
        // Overlapping or adjacent, merge them
        last.end = new Date(Math.max(last.end.getTime(), current.end.getTime()));
        last.eventIds.push(...current.eventIds);
      } else {
        // No overlap, add as new period
        merged.push(current);
      }
    }

    return merged;
  }

  /**
   * Get all busy periods
   * @private
   */
  _getAllBusyPeriods(start, end) {
    const events = this.eventStore.getEventsInRange(start, end, false)
      .filter(e => e.status !== 'cancelled');

    return events.map(event => ({
      start: event.start,
      end: event.end,
      eventIds: [event.id]
    })).sort((a, b) => a.start - b.start);
  }

  /**
   * Check if time period is within business hours
   * @private
   */
  _isWithinBusinessHours(start, end, options) {
    // Simple implementation - can be enhanced
    const startHour = start.getHours();
    const endHour = end.getHours();

    const businessStart = parseInt(options.businessHours.start.split(':')[0]);
    const businessEnd = parseInt(options.businessHours.end.split(':')[0]);

    return startHour >= businessStart && endHour <= businessEnd;
  }
}

/**
 * EventStore - Manages calendar events with efficient querying
 * Uses Map for O(1) lookups and spatial indexing concepts for date queries
 * Now with performance optimizations for large datasets
 */
class EventStore {
  constructor(config = {}) {
    // Primary storage - Map for O(1) ID lookups
    /** @type {Map<string, Event>} */
    this.events = new Map();

    // Indices for efficient queries (using UTC for consistent indexing)
    this.indices = {
      /** @type {Map<string, Set<string>>} UTC Date string -> Set of event IDs */
      byDate: new Map(),
      /** @type {Map<string, Set<string>>} YYYY-MM (UTC) -> Set of event IDs */
      byMonth: new Map(),
      /** @type {Set<string>} Set of recurring event IDs */
      recurring: new Set(),
      /** @type {Map<string, Set<string>>} Category -> Set of event IDs */
      byCategory: new Map(),
      /** @type {Map<string, Set<string>>} Status -> Set of event IDs */
      byStatus: new Map()
    };

    // Timezone manager for conversions
    this.timezoneManager = new TimezoneManager();

    // Default timezone for the store (can be overridden)
    this.defaultTimezone = config.timezone || this.timezoneManager.getSystemTimezone();

    // Performance optimizer
    this.optimizer = new PerformanceOptimizer(config.performance);

    // Conflict detector
    this.conflictDetector = new ConflictDetector(this);

    // Batch operation state
    this.isBatchMode = false;
    this.batchNotifications = [];
    this.batchBackup = null; // For rollback support

    // Change tracking
    /** @type {number} */
    this.version = 0;
    /** @type {Set<import('../../types.js').EventListener>} */
    this.listeners = new Set();
  }

  /**
   * Add an event to the store
   * @param {Event|import('../../types.js').EventData} event - The event to add
   * @returns {Event} The added event
   * @throws {Error} If event with same ID already exists
   */
  addEvent(event) {
    return this.optimizer.measure('addEvent', () => {
      if (!(event instanceof Event)) {
        event = new Event(event);
      }

      if (this.events.has(event.id)) {
        throw new Error(`Event with id ${event.id} already exists`);
      }

      // Store the event
      this.events.set(event.id, event);

      // Cache the event
      this.optimizer.cache(event.id, event, 'event');

      // Update indices
      this._indexEvent(event);

      // Notify listeners (batch if in batch mode)
      if (this.isBatchMode) {
        this.batchNotifications.push({
          type: 'add',
          event,
          version: ++this.version
        });
      } else {
        this._notifyChange({
          type: 'add',
          event,
          version: ++this.version
        });
      }

      return event;
    });
  }

  /**
   * Update an existing event
   * @param {string} eventId - The event ID
   * @param {Partial<import('../../types.js').EventData>} updates - Properties to update
   * @returns {Event} The updated event
   * @throws {Error} If event not found
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
   * @returns {Event|null} The event or null if not found
   */
  getEvent(eventId) {
    // Check cache first
    const cached = this.optimizer.getFromCache(eventId, 'event');
    if (cached) {
      return cached;
    }

    // Get from store
    const event = this.events.get(eventId) || null;

    // Cache if found
    if (event) {
      this.optimizer.cache(eventId, event, 'event');
    }

    return event;
  }

  /**
   * Get all events
   * @returns {Event[]} Array of all events
   */
  getAllEvents() {
    return Array.from(this.events.values());
  }

  /**
   * Query events with filters
   * @param {import('../../types.js').QueryFilters} [filters={}] - Query filters
   * @returns {Event[]} Filtered events
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

    // Filter by status
    if (filters.status) {
      results = results.filter(event => event.status === filters.status);
    }

    // Filter by categories
    if (filters.categories && filters.categories.length > 0) {
      results = results.filter(event =>
        filters.matchAllCategories
          ? event.hasAllCategories(filters.categories)
          : event.hasAnyCategory(filters.categories)
      );
    }

    // Filter by having attendees
    if (filters.hasOwnProperty('hasAttendees')) {
      results = results.filter(event => filters.hasAttendees ? event.hasAttendees : !event.hasAttendees);
    }

    // Filter by organizer email
    if (filters.organizerEmail) {
      results = results.filter(event =>
        event.organizer && event.organizer.email === filters.organizerEmail
      );
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
   * @param {string} [timezone] - Timezone for the query (defaults to store timezone)
   * @returns {Event[]} Events occurring on the date, sorted by start time
   */
  getEventsForDate(date, timezone = null) {
    timezone = timezone || this.defaultTimezone;

    // Convert the date to UTC range for the timezone
    const startOfDayLocal = new Date(date);
    startOfDayLocal.setHours(0, 0, 0, 0);
    const endOfDayLocal = new Date(date);
    endOfDayLocal.setHours(23, 59, 59, 999);

    // Convert to UTC for querying
    const startUTC = this.timezoneManager.toUTC(startOfDayLocal, timezone);
    const endUTC = this.timezoneManager.toUTC(endOfDayLocal, timezone);

    // Use UTC date strings for index lookup
    const dateStr = startUTC.toDateString();
    const eventIds = this.indices.byDate.get(dateStr) || new Set();

    return Array.from(eventIds)
      .map(id => this.events.get(id))
      .filter(event => {
        if (!event) return false;
        // Additional check to ensure event actually overlaps with the day in the given timezone
        return event.startUTC <= endUTC && event.endUTC >= startUTC;
      })
      .sort((a, b) => {
        // Sort by start time in the specified timezone
        const aStart = a.getStartInTimezone(timezone);
        const bStart = b.getStartInTimezone(timezone);
        const timeCompare = aStart - bStart;
        if (timeCompare !== 0) return timeCompare;
        return b.duration - a.duration; // Longer events first
      });
  }

  /**
   * Get events that overlap with a given time range
   * @param {Date} start - Start time
   * @param {Date} end - End time
   * @param {string} [excludeId=null] - Optional event ID to exclude (useful when checking for conflicts)
   * @returns {Event[]} Array of overlapping events
   */
  getOverlappingEvents(start, end, excludeId = null) {
    const overlapping = [];

    // Get all events in the date range
    const startDate = DateUtils.startOfDay(start);
    const endDate = DateUtils.endOfDay(end);
    const dates = DateUtils.getDateRange(startDate, endDate);

    // Collect all events from those dates
    const checkedIds = new Set();
    dates.forEach(date => {
      const dateStr = date.toDateString();
      const eventIds = this.indices.byDate.get(dateStr) || new Set();

      eventIds.forEach(id => {
        if (!checkedIds.has(id) && id !== excludeId) {
          checkedIds.add(id);
          const event = this.events.get(id);

          if (event && event.overlaps({ start, end })) {
            overlapping.push(event);
          }
        }
      });
    });

    return overlapping.sort((a, b) => a.start - b.start);
  }

  /**
   * Check if an event would conflict with existing events
   * @param {Date} start - Start time
   * @param {Date} end - End time
   * @param {string} excludeId - Optional event ID to exclude
   * @returns {boolean} True if there are conflicts
   */
  hasConflicts(start, end, excludeId = null) {
    return this.getOverlappingEvents(start, end, excludeId).length > 0;
  }

  /**
   * Get events grouped by overlapping time slots
   * Useful for calculating event positions in week/day views
   * @param {Date} date - The date to analyze
   * @param {boolean} timedOnly - Only include timed events (not all-day)
   * @returns {Array<Event[]>} Array of event groups that overlap
   */
  getOverlapGroups(date, timedOnly = true) {
    let events = this.getEventsForDate(date);

    if (timedOnly) {
      events = events.filter(e => !e.allDay);
    }

    const groups = [];
    const processed = new Set();

    events.forEach(event => {
      if (processed.has(event.id)) return;

      // Start a new group with this event
      const group = [event];
      processed.add(event.id);

      // Find all events that overlap with any event in this group
      let i = 0;
      while (i < group.length) {
        const currentEvent = group[i];

        events.forEach(otherEvent => {
          if (!processed.has(otherEvent.id) && currentEvent.overlaps(otherEvent)) {
            group.push(otherEvent);
            processed.add(otherEvent.id);
          }
        });

        i++;
      }

      groups.push(group);
    });

    return groups;
  }

  /**
   * Calculate positions for overlapping events (for rendering)
   * @param {Event[]} events - Array of overlapping events
   * @returns {Map<string, {column: number, totalColumns: number}>} Position data for each event
   */
  calculateEventPositions(events) {
    const positions = new Map();

    if (events.length === 0) return positions;

    // Sort by start time, then by duration (longer events first)
    events.sort((a, b) => {
      const startDiff = a.start - b.start;
      if (startDiff !== 0) return startDiff;
      return (b.end - b.start) - (a.end - a.start);
    });

    // Track which columns are occupied at each time
    const columns = [];

    events.forEach(event => {
      // Find the first available column
      let column = 0;
      while (column < columns.length) {
        const columnEvents = columns[column];
        const hasConflict = columnEvents.some(e => e.overlaps(event));

        if (!hasConflict) {
          break;
        }
        column++;
      }

      // Add event to the column
      if (!columns[column]) {
        columns[column] = [];
      }
      columns[column].push(event);

      positions.set(event.id, {
        column: column,
        totalColumns: 0 // Will be updated after all events are placed
      });
    });

    // Update total columns for all events
    const totalColumns = columns.length;
    positions.forEach(pos => {
      pos.totalColumns = totalColumns;
    });

    return positions;
  }

  /**
   * Get events for a date range
   * @param {Date} start - Start date
   * @param {Date} end - End date
   * @param {boolean|string} expandRecurring - Whether to expand recurring events, or timezone string
   * @param {string} [timezone] - Timezone for the query (if expandRecurring is boolean)
   * @returns {Event[]}
   */
  getEventsInRange(start, end, expandRecurring = true, timezone = null) {
    // Handle overloaded parameters
    if (typeof expandRecurring === 'string') {
      timezone = expandRecurring;
      expandRecurring = true;
    }

    timezone = timezone || this.defaultTimezone;

    // Convert range to UTC for querying
    const startUTC = this.timezoneManager.toUTC(start, timezone);
    const endUTC = this.timezoneManager.toUTC(end, timezone);

    // Query using UTC times
    const baseEvents = this.queryEvents({
      start: startUTC,
      end: endUTC,
      sort: 'start'
    });

    if (!expandRecurring) {
      return baseEvents;
    }

    // Expand recurring events
    const expandedEvents = [];
    baseEvents.forEach(event => {
      if (event.recurring && event.recurrenceRule) {
        const occurrences = this.expandRecurringEvent(event, start, end, timezone);
        expandedEvents.push(...occurrences);
      } else {
        expandedEvents.push(event);
      }
    });

    return expandedEvents.sort((a, b) => {
      // Sort by start time in the specified timezone
      const aStart = a.getStartInTimezone(timezone);
      const bStart = b.getStartInTimezone(timezone);
      return aStart - bStart;
    });
  }

  /**
   * Expand a recurring event into individual occurrences
   * @param {Event} event - The recurring event
   * @param {Date} rangeStart - Start of the expansion range
   * @param {Date} rangeEnd - End of the expansion range
   * @param {string} [timezone] - Timezone for the expansion
   * @returns {Event[]} Array of event occurrences
   */
  expandRecurringEvent(event, rangeStart, rangeEnd, timezone = null) {
    if (!event.recurring || !event.recurrenceRule) {
      return [event];
    }

    timezone = timezone || this.defaultTimezone;

    // Expand in the event's timezone for accurate recurrence calculation
    const eventTimezone = event.timeZone || timezone;
    const occurrences = RecurrenceEngine.expandEvent(event, rangeStart, rangeEnd);

    return occurrences.map((occurrence, index) => {
      // Create a new event instance for each occurrence
      const occurrenceEvent = event.clone({
        id: `${event.id}_occurrence_${index}`,
        start: occurrence.start,
        end: occurrence.end,
        timeZone: eventTimezone,
        metadata: {
          ...event.metadata,
          recurringEventId: event.id,
          occurrenceIndex: index
        }
      });

      return occurrenceEvent;
    });
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
    // Check if should use lazy indexing for large date ranges
    if (this.optimizer.shouldUseLazyIndexing(event)) {
      this._indexEventLazy(event);
      return;
    }

    // Use UTC times for consistent indexing across timezones
    const startDate = DateUtils.startOfDay(new Date(event.startUTC || event.start));
    const endDate = DateUtils.endOfDay(new Date(event.endUTC || event.end));

    // For each day the event spans (in UTC), add to date index
    const dates = DateUtils.getDateRange(startDate, endDate);

    dates.forEach(date => {
      const dateStr = date.toDateString();

      if (!this.indices.byDate.has(dateStr)) {
        this.indices.byDate.set(dateStr, new Set());
      }
      this.indices.byDate.get(dateStr).add(event.id);
    });

    // Index by month(s) using UTC
    `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}`;
    `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}`;

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

    // Index by categories
    if (event.categories && event.categories.length > 0) {
      event.categories.forEach(category => {
        if (!this.indices.byCategory.has(category)) {
          this.indices.byCategory.set(category, new Set());
        }
        this.indices.byCategory.get(category).add(event.id);
      });
    }

    // Index by status
    if (event.status) {
      if (!this.indices.byStatus.has(event.status)) {
        this.indices.byStatus.set(event.status, new Set());
      }
      this.indices.byStatus.get(event.status).add(event.id);
    }

    // Index recurring events
    if (event.recurring) {
      this.indices.recurring.add(event.id);
    }
  }

  /**
   * Lazy index for events with large date ranges
   * @private
   */
  _indexEventLazy(event) {
    // Create lazy index markers
    this.optimizer.createLazyIndexMarkers(event);

    // Index only the boundaries initially
    const startDate = DateUtils.startOfDay(event.start);
    const endDate = DateUtils.endOfDay(event.end);

    // Index first week
    const firstWeekEnd = new Date(startDate);
    firstWeekEnd.setDate(firstWeekEnd.getDate() + 7);
    const firstWeekDates = DateUtils.getDateRange(startDate,
      firstWeekEnd < endDate ? firstWeekEnd : endDate);

    firstWeekDates.forEach(date => {
      const dateStr = date.toDateString();
      if (!this.indices.byDate.has(dateStr)) {
        this.indices.byDate.set(dateStr, new Set());
      }
      this.indices.byDate.get(dateStr).add(event.id);
    });

    // Index last week if different from first
    if (endDate > firstWeekEnd) {
      const lastWeekStart = new Date(endDate);
      lastWeekStart.setDate(lastWeekStart.getDate() - 7);
      const lastWeekDates = DateUtils.getDateRange(
        lastWeekStart > startDate ? lastWeekStart : startDate,
        endDate
      );

      lastWeekDates.forEach(date => {
        const dateStr = date.toDateString();
        if (!this.indices.byDate.has(dateStr)) {
          this.indices.byDate.set(dateStr, new Set());
        }
        this.indices.byDate.get(dateStr).add(event.id);
      });
    }

    // Index months as normal
    const currentMonth = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    while (currentMonth <= endDate) {
      const monthKey = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}`;
      if (!this.indices.byMonth.has(monthKey)) {
        this.indices.byMonth.set(monthKey, new Set());
      }
      this.indices.byMonth.get(monthKey).add(event.id);
      currentMonth.setMonth(currentMonth.getMonth() + 1);
    }

    // Index other properties normally
    if (event.categories && event.categories.length > 0) {
      event.categories.forEach(category => {
        if (!this.indices.byCategory.has(category)) {
          this.indices.byCategory.set(category, new Set());
        }
        this.indices.byCategory.get(category).add(event.id);
      });
    }

    if (event.status) {
      if (!this.indices.byStatus.has(event.status)) {
        this.indices.byStatus.set(event.status, new Set());
      }
      this.indices.byStatus.get(event.status).add(event.id);
    }

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
      indexedCategories: this.indices.byCategory.size,
      indexedStatuses: this.indices.byStatus.size,
      version: this.version,
      performanceMetrics: this.optimizer.getMetrics()
    };
  }

  // ============ Batch Operations ============

  /**
   * Start batch mode for bulk operations
   * Delays notifications until batch is committed
   * @param {boolean} [enableRollback=false] - Enable rollback support (creates backup)
   */
  startBatch(enableRollback = false) {
    this.isBatchMode = true;
    this.batchNotifications = [];

    // Create backup for rollback if requested
    if (enableRollback) {
      this.batchBackup = {
        events: new Map(this.events),
        indices: {
          byDate: new Map(Array.from(this.indices.byDate.entries()).map(([k, v]) => [k, new Set(v)])),
          byMonth: new Map(Array.from(this.indices.byMonth.entries()).map(([k, v]) => [k, new Set(v)])),
          recurring: new Set(this.indices.recurring),
          byCategory: new Map(Array.from(this.indices.byCategory.entries()).map(([k, v]) => [k, new Set(v)])),
          byStatus: new Map(Array.from(this.indices.byStatus.entries()).map(([k, v]) => [k, new Set(v)]))
        },
        version: this.version
      };
    }
  }

  /**
   * Commit batch operations
   * Sends all notifications at once
   */
  commitBatch() {
    if (!this.isBatchMode) return;

    this.isBatchMode = false;

    // Clear backup after successful commit
    this.batchBackup = null;

    // Send a single bulk notification
    if (this.batchNotifications.length > 0) {
      this._notifyChange({
        type: 'batch',
        changes: this.batchNotifications,
        count: this.batchNotifications.length,
        version: ++this.version
      });
    }

    this.batchNotifications = [];
  }

  /**
   * Rollback batch operations
   * Restores state to before batch started
   */
  rollbackBatch() {
    if (!this.isBatchMode) return;

    this.isBatchMode = false;

    // Restore backup if available
    if (this.batchBackup) {
      this.events = this.batchBackup.events;
      this.indices = this.batchBackup.indices;
      this.version = this.batchBackup.version;
      this.batchBackup = null;

      // Clear cache
      this.optimizer.clearCache();
    }

    this.batchNotifications = [];
  }

  /**
   * Execute batch operation with automatic rollback on error
   * @param {Function} operation - Operation to execute
   * @param {boolean} [enableRollback=true] - Enable automatic rollback on error
   * @returns {*} Result of operation
   * @throws {Error} If operation fails
   */
  async executeBatch(operation, enableRollback = true) {
    this.startBatch(enableRollback);

    try {
      const result = await operation();
      this.commitBatch();
      return result;
    } catch (error) {
      if (enableRollback) {
        this.rollbackBatch();
      }
      throw error;
    }
  }

  /**
   * Add multiple events in batch
   * @param {Array<Event|import('../../types.js').EventData>} events - Events to add
   * @returns {Event[]} Added events
   */
  addEvents(events) {
    return this.optimizer.measure('addEvents', () => {
      this.startBatch();
      const results = [];
      const errors = [];

      for (const eventData of events) {
        try {
          results.push(this.addEvent(eventData));
        } catch (error) {
          errors.push({ event: eventData, error: error.message });
        }
      }

      this.commitBatch();

      if (errors.length > 0) {
        console.warn(`Failed to add ${errors.length} events:`, errors);
      }

      return results;
    });
  }

  /**
   * Update multiple events in batch
   * @param {Array<{id: string, updates: Object}>} updates - Update operations
   * @returns {Event[]} Updated events
   */
  updateEvents(updates) {
    return this.optimizer.measure('updateEvents', () => {
      this.startBatch();
      const results = [];
      const errors = [];

      for (const { id, updates: eventUpdates } of updates) {
        try {
          results.push(this.updateEvent(id, eventUpdates));
        } catch (error) {
          errors.push({ id, error: error.message });
        }
      }

      this.commitBatch();

      if (errors.length > 0) {
        console.warn(`Failed to update ${errors.length} events:`, errors);
      }

      return results;
    });
  }

  /**
   * Remove multiple events in batch
   * @param {string[]} eventIds - Event IDs to remove
   * @returns {number} Number of events removed
   */
  removeEvents(eventIds) {
    return this.optimizer.measure('removeEvents', () => {
      this.startBatch();
      let removed = 0;

      for (const id of eventIds) {
        if (this.removeEvent(id)) {
          removed++;
        }
      }

      this.commitBatch();
      return removed;
    });
  }

  // ============ Performance Methods ============

  /**
   * Get performance metrics
   * @returns {Object} Performance metrics
   */
  getPerformanceMetrics() {
    return this.optimizer.getMetrics();
  }

  /**
   * Clear all caches
   */
  clearCaches() {
    this.optimizer.eventCache.clear();
    this.optimizer.queryCache.clear();
    this.optimizer.dateRangeCache.clear();
  }

  /**
   * Optimize indices by removing old or irrelevant entries
   * @param {Date} [cutoffDate] - Remove indices older than this date
   */
  optimizeIndices(cutoffDate) {
    if (!cutoffDate) {
      cutoffDate = new Date();
      cutoffDate.setMonth(cutoffDate.getMonth() - 6); // Default: 6 months ago
    }

    cutoffDate.toDateString();
    let removed = 0;

    // Clean up date indices
    for (const [dateStr, eventIds] of this.indices.byDate) {
      const date = new Date(dateStr);
      if (date < cutoffDate) {
        // Check if any events still need this index
        let stillNeeded = false;
        for (const eventId of eventIds) {
          const event = this.events.get(eventId);
          if (event && event.end >= cutoffDate) {
            stillNeeded = true;
            break;
          }
        }

        if (!stillNeeded) {
          this.indices.byDate.delete(dateStr);
          removed++;
        }
      }
    }

    console.log(`Optimized indices: removed ${removed} old date entries`);
    return removed;
  }

  /**
   * Destroy the store and clean up resources
   */
  destroy() {
    this.clear();
    this.optimizer.destroy();
    this.listeners.clear();
  }

  // ============ Conflict Detection Methods ============

  /**
   * Check for conflicts for an event
   * @param {Event|import('../../types.js').EventData} event - Event to check
   * @param {import('../../types.js').ConflictCheckOptions} [options={}] - Check options
   * @returns {import('../../types.js').ConflictSummary} Conflict summary
   */
  checkConflicts(event, options = {}) {
    return this.conflictDetector.checkConflicts(event, options);
  }

  /**
   * Check conflicts between two events
   * @param {string} eventId1 - First event ID
   * @param {string} eventId2 - Second event ID
   * @param {import('../../types.js').ConflictCheckOptions} [options={}] - Check options
   * @returns {import('../../types.js').ConflictDetails[]} Conflicts between events
   */
  checkEventPairConflicts(eventId1, eventId2, options = {}) {
    const event1 = this.getEvent(eventId1);
    const event2 = this.getEvent(eventId2);

    if (!event1 || !event2) {
      throw new Error('One or both events not found');
    }

    return this.conflictDetector.checkEventPairConflicts(event1, event2, options);
  }

  /**
   * Get all conflicts in a date range
   * @param {Date} start - Start date
   * @param {Date} end - End date
   * @param {import('../../types.js').ConflictCheckOptions} [options={}] - Check options
   * @returns {import('../../types.js').ConflictSummary} All conflicts in range
   */
  getAllConflicts(start, end, options = {}) {
    const events = this.getEventsInRange(start, end, false);
    const allConflicts = [];
    const checkedPairs = new Set();

    for (let i = 0; i < events.length; i++) {
      for (let j = i + 1; j < events.length; j++) {
        const pairKey = `${events[i].id}-${events[j].id}`;
        if (!checkedPairs.has(pairKey)) {
          checkedPairs.add(pairKey);
          const conflicts = this.conflictDetector.checkEventPairConflicts(
            events[i],
            events[j],
            options
          );
          allConflicts.push(...conflicts);
        }
      }
    }

    return this.conflictDetector._buildConflictSummary(
      allConflicts,
      new Set(events.map(e => e.id)),
      new Set()
    );
  }

  /**
   * Get busy periods for attendees
   * @param {string[]} attendeeEmails - Attendee emails
   * @param {Date} start - Start date
   * @param {Date} end - End date
   * @param {Object} [options={}] - Options
   * @returns {Array<{start: Date, end: Date, eventIds: string[]}>} Busy periods
   */
  getBusyPeriods(attendeeEmails, start, end, options = {}) {
    return this.conflictDetector.getBusyPeriods(attendeeEmails, start, end, options);
  }

  /**
   * Get free periods for scheduling
   * @param {Date} start - Start date
   * @param {Date} end - End date
   * @param {number} durationMinutes - Required duration in minutes
   * @param {Object} [options={}] - Options
   * @returns {Array<{start: Date, end: Date}>} Free periods
   */
  getFreePeriods(start, end, durationMinutes, options = {}) {
    return this.conflictDetector.getFreePeriods(start, end, durationMinutes, options);
  }

  /**
   * Add event with conflict checking
   * @param {Event|import('../../types.js').EventData} event - Event to add
   * @param {boolean} [allowConflicts=true] - Whether to allow adding with conflicts
   * @returns {{event: Event, conflicts: import('../../types.js').ConflictSummary}} Result
   */
  addEventWithConflictCheck(event, allowConflicts = true) {
    // Check conflicts before adding
    const conflicts = this.checkConflicts(event);

    if (!allowConflicts && conflicts.hasConflicts) {
      throw new Error(`Cannot add event: ${conflicts.totalConflicts} conflicts detected`);
    }

    // Add the event
    const addedEvent = this.addEvent(event);

    return {
      event: addedEvent,
      conflicts
    };
  }

  /**
   * Find events with conflicts
   * @param {Object} [options={}] - Options
   * @returns {Array<{event: Event, conflicts: import('../../types.js').ConflictDetails[]}>} Events with conflicts
   */
  findEventsWithConflicts(options = {}) {
    const eventsWithConflicts = [];
    const allEvents = this.getAllEvents();

    for (const event of allEvents) {
      const conflicts = this.checkConflicts(event, options);
      if (conflicts.hasConflicts) {
        eventsWithConflicts.push({
          event,
          conflicts: conflicts.conflicts
        });
      }
    }

    return eventsWithConflicts;
  }
}

/**
 * StateManager - Central state management for the calendar
 * Implements an immutable state pattern with change notifications
 */
class StateManager {
  /**
   * Create a new StateManager instance
   * @param {Partial<import('../../types.js').CalendarState>} [initialState={}] - Initial state values
   */
  constructor(initialState = {}) {
    this.state = {
      // Current view configuration
      view: 'month', // 'month', 'week', 'day', 'list'
      currentDate: new Date(),

      // UI state
      selectedEventId: null,
      selectedDate: null,
      hoveredEventId: null,
      hoveredDate: null,

      // Display options
      weekStartsOn: 0, // 0 = Sunday, 1 = Monday, etc.
      showWeekNumbers: false,
      showWeekends: true,
      fixedWeekCount: true, // Always show 6 weeks in month view

      // Time configuration
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      locale: 'en-US',
      hourFormat: '12h', // '12h' or '24h'

      // Business hours (for week/day views)
      businessHours: {
        start: '09:00',
        end: '17:00'
      },

      // Filters
      filters: {
        searchTerm: '',
        categories: [],
        showAllDay: true,
        showTimed: true
      },

      // Interaction flags
      isDragging: false,
      isResizing: false,
      isCreating: false,

      // Loading states
      isLoading: false,
      loadingMessage: '',

      // Error state
      error: null,

      // Custom metadata
      metadata: {},

      // Apply initial state overrides
      ...initialState
    };

    // Observers for state changes
    this.listeners = new Map();
    this.globalListeners = new Set();

    // History for undo/redo (optional)
    this.history = [];
    this.historyIndex = -1;
    this.maxHistorySize = 50;
  }

  /**
   * Get the current state
   * @returns {import('../../types.js').CalendarState} Current state (frozen)
   */
  getState() {
    return Object.freeze({ ...this.state });
  }

  /**
   * Get a specific state value
   * @param {keyof import('../../types.js').CalendarState} key - The state key
   * @returns {any} The state value
   */
  get(key) {
    return this.state[key];
  }

  /**
   * Update state with partial updates
   * @param {Object|Function} updates - Object with updates or updater function
   */
  setState(updates) {
    const oldState = this.state;

    // Support function updater pattern
    if (typeof updates === 'function') {
      updates = updates(oldState);
    }

    // Create new state with updates
    const newState = {
      ...oldState,
      ...updates,
      // Preserve nested objects
      filters: updates.filters ? { ...oldState.filters, ...updates.filters } : oldState.filters,
      businessHours: updates.businessHours ? { ...oldState.businessHours, ...updates.businessHours } : oldState.businessHours,
      metadata: updates.metadata ? { ...oldState.metadata, ...updates.metadata } : oldState.metadata
    };

    // Check if state actually changed
    if (this._hasChanged(oldState, newState)) {
      this.state = newState;

      // Add to history (store the new state)
      this._addToHistory(newState);

      // Notify listeners
      this._notifyListeners(oldState, newState);
    }
  }

  /**
   * Set the current view
   * @param {string} view - The view type
   */
  setView(view) {
    const validViews = ['month', 'week', 'day', 'list'];
    if (!validViews.includes(view)) {
      throw new Error(`Invalid view: ${view}. Must be one of: ${validViews.join(', ')}`);
    }
    this.setState({ view });
  }

  /**
   * Set the current date
   * @param {Date} date - The date to set
   */
  setCurrentDate(date) {
    if (!(date instanceof Date)) {
      date = new Date(date);
    }
    if (isNaN(date.getTime())) {
      throw new Error('Invalid date');
    }
    this.setState({ currentDate: date });
  }

  /**
   * Navigate to the next period (month/week/day based on view)
   */
  navigateNext() {
    const { view, currentDate } = this.state;
    const newDate = new Date(currentDate);

    switch (view) {
      case 'month':
        newDate.setMonth(newDate.getMonth() + 1);
        break;
      case 'week':
        newDate.setDate(newDate.getDate() + 7);
        break;
      case 'day':
        newDate.setDate(newDate.getDate() + 1);
        break;
    }

    this.setCurrentDate(newDate);
  }

  /**
   * Navigate to the previous period
   */
  navigatePrevious() {
    const { view, currentDate } = this.state;
    const newDate = new Date(currentDate);

    switch (view) {
      case 'month':
        newDate.setMonth(newDate.getMonth() - 1);
        break;
      case 'week':
        newDate.setDate(newDate.getDate() - 7);
        break;
      case 'day':
        newDate.setDate(newDate.getDate() - 1);
        break;
    }

    this.setCurrentDate(newDate);
  }

  /**
   * Navigate to today
   */
  navigateToday() {
    this.setCurrentDate(new Date());
  }

  /**
   * Select an event
   * @param {string} eventId - The event ID to select
   */
  selectEvent(eventId) {
    this.setState({ selectedEventId: eventId });
  }

  /**
   * Clear event selection
   */
  clearEventSelection() {
    this.setState({ selectedEventId: null });
  }

  /**
   * Select a date
   * @param {Date} date - The date to select
   */
  selectDate(date) {
    if (!(date instanceof Date)) {
      date = new Date(date);
    }
    this.setState({ selectedDate: date });
  }

  /**
   * Clear date selection
   */
  clearDateSelection() {
    this.setState({ selectedDate: null });
  }

  /**
   * Set loading state
   * @param {boolean} isLoading - Loading state
   * @param {string} message - Optional loading message
   */
  setLoading(isLoading, message = '') {
    this.setState({
      isLoading,
      loadingMessage: message
    });
  }

  /**
   * Set error state
   * @param {Error|string|null} error - The error
   */
  setError(error) {
    this.setState({
      error: error ? (error instanceof Error ? error.message : error) : null
    });
  }

  /**
   * Update filters
   * @param {Object} filters - Filter updates
   */
  updateFilters(filters) {
    this.setState({
      filters: {
        ...this.state.filters,
        ...filters
      }
    });
  }

  /**
   * Subscribe to all state changes
   * @param {Function} callback - Callback function
   * @returns {Function} Unsubscribe function
   */
  subscribe(callback) {
    this.globalListeners.add(callback);

    return () => {
      this.globalListeners.delete(callback);
    };
  }

  /**
   * Subscribe to specific state key changes
   * @param {string|string[]} keys - State key(s) to watch
   * @param {Function} callback - Callback function
   * @returns {Function} Unsubscribe function
   */
  watch(keys, callback) {
    const keyArray = Array.isArray(keys) ? keys : [keys];

    keyArray.forEach(key => {
      if (!this.listeners.has(key)) {
        this.listeners.set(key, new Set());
      }
      this.listeners.get(key).add(callback);
    });

    return () => {
      keyArray.forEach(key => {
        const callbacks = this.listeners.get(key);
        if (callbacks) {
          callbacks.delete(callback);
          if (callbacks.size === 0) {
            this.listeners.delete(key);
          }
        }
      });
    };
  }

  /**
   * Check if undo is available
   * @returns {boolean} True if undo is available
   */
  canUndo() {
    return this.historyIndex > 0;
  }

  /**
   * Check if redo is available
   * @returns {boolean} True if redo is available
   */
  canRedo() {
    return this.historyIndex < this.history.length - 1;
  }

  /**
   * Get the number of undo operations available
   * @returns {number} Number of undo operations
   */
  getUndoCount() {
    return this.historyIndex;
  }

  /**
   * Get the number of redo operations available
   * @returns {number} Number of redo operations
   */
  getRedoCount() {
    return this.history.length - 1 - this.historyIndex;
  }

  /**
   * Undo the last state change
   * @returns {boolean} True if undo was performed
   */
  undo() {
    if (!this.canUndo()) {
      return false;
    }

    this.historyIndex--;
    const previousState = this.history[this.historyIndex];
    const currentState = this.state;

    // Update state without adding to history
    this.state = { ...previousState };

    // Notify listeners
    this._notifyListeners(currentState, this.state);

    return true;
  }

  /**
   * Redo the next state change
   * @returns {boolean} True if redo was performed
   */
  redo() {
    if (!this.canRedo()) {
      return false;
    }

    this.historyIndex++;
    const nextState = this.history[this.historyIndex];
    const currentState = this.state;

    // Update state without adding to history
    this.state = { ...nextState };

    // Notify listeners
    this._notifyListeners(currentState, this.state);

    return true;
  }

  /**
   * Reset state to initial values
   */
  reset() {
    const initialState = this.history[0] || {};
    this.setState(initialState);
    this.history = [initialState];
    this.historyIndex = 0;
  }

  /**
   * Check if state has changed
   * @private
   */
  _hasChanged(oldState, newState) {
    return !this._deepEqual(oldState, newState);
  }

  /**
   * Deep equality check optimized for state comparison
   * @private
   * @param {*} a - First value
   * @param {*} b - Second value
   * @param {Set} seen - Track circular references
   * @returns {boolean} True if values are deeply equal
   */
  _deepEqual(a, b, seen = new Set()) {
    // Same reference
    if (a === b) return true;

    // Different types or null/undefined
    if (a == null || b == null) return a === b;
    if (typeof a !== typeof b) return false;

    // Primitives
    if (typeof a !== 'object') return a === b;

    // Check for circular references
    if (seen.has(a) || seen.has(b)) return false;
    seen.add(a);
    seen.add(b);

    // Arrays
    if (Array.isArray(a)) {
      if (!Array.isArray(b) || a.length !== b.length) {
        seen.delete(a);
        seen.delete(b);
        return false;
      }

      for (let i = 0; i < a.length; i++) {
        if (!this._deepEqual(a[i], b[i], seen)) {
          seen.delete(a);
          seen.delete(b);
          return false;
        }
      }

      seen.delete(a);
      seen.delete(b);
      return true;
    }

    // Dates
    if (a instanceof Date && b instanceof Date) {
      const result = a.getTime() === b.getTime();
      seen.delete(a);
      seen.delete(b);
      return result;
    }

    // Objects
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);

    if (aKeys.length !== bKeys.length) {
      seen.delete(a);
      seen.delete(b);
      return false;
    }

    // Sort keys for consistent comparison
    aKeys.sort();
    bKeys.sort();

    // Compare keys
    for (let i = 0; i < aKeys.length; i++) {
      if (aKeys[i] !== bKeys[i]) {
        seen.delete(a);
        seen.delete(b);
        return false;
      }
    }

    // Compare values
    for (const key of aKeys) {
      if (!this._deepEqual(a[key], b[key], seen)) {
        seen.delete(a);
        seen.delete(b);
        return false;
      }
    }

    seen.delete(a);
    seen.delete(b);
    return true;
  }

  /**
   * Add state to history
   * @private
   */
  _addToHistory(state) {
    // Remove any future history if we're not at the end
    if (this.historyIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.historyIndex + 1);
    }

    // Add new state
    this.history.push({ ...state });
    this.historyIndex++;

    // Limit history size
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
      this.historyIndex--;
    }
  }

  /**
   * Notify listeners of state changes
   * @private
   */
  _notifyListeners(oldState, newState) {
    // Notify global listeners
    for (const callback of this.globalListeners) {
      try {
        callback(newState, oldState);
      } catch (error) {
        console.error('Error in state listener:', error);
      }
    }

    // Notify specific key listeners
    for (const [key, callbacks] of this.listeners) {
      if (oldState[key] !== newState[key]) {
        for (const callback of callbacks) {
          try {
            callback(newState[key], oldState[key], newState, oldState);
          } catch (error) {
            console.error(`Error in state listener for key "${key}":`, error);
          }
        }
      }
    }
  }
}

/**
 * Calendar - Main calendar class with full timezone support
 * Pure JavaScript, no DOM dependencies
 * Framework agnostic, Locker Service compatible
 */
class Calendar {
  /**
   * Create a new Calendar instance
   * @param {import('../../types.js').CalendarConfig} [config={}] - Configuration options
   */
  constructor(config = {}) {
    // Initialize timezone manager first
    this.timezoneManager = new TimezoneManager();

    // Initialize configuration
    this.config = {
      view: 'month',
      date: new Date(),
      weekStartsOn: 0, // 0 = Sunday
      locale: 'en-US',
      timeZone: config.timeZone || this.timezoneManager.getSystemTimezone(),
      showWeekNumbers: false,
      showWeekends: true,
      fixedWeekCount: true,
      businessHours: {
        start: '09:00',
        end: '17:00'
      },
      ...config
    };

    // Initialize core components with timezone support
    this.eventStore = new EventStore({ timezone: this.config.timeZone });
    this.state = new StateManager({
      view: this.config.view,
      currentDate: this.config.date,
      weekStartsOn: this.config.weekStartsOn,
      locale: this.config.locale,
      timeZone: this.config.timeZone,
      showWeekNumbers: this.config.showWeekNumbers,
      showWeekends: this.config.showWeekends,
      fixedWeekCount: this.config.fixedWeekCount,
      businessHours: this.config.businessHours
    });

    // Event emitter for calendar events
    this.listeners = new Map();

    // Plugins
    this.plugins = new Set();

    // View instances (lazy loaded)
    this.views = new Map();

    // Set up internal listeners
    this._setupInternalListeners();

    // Load initial events if provided
    if (config.events) {
      this.setEvents(config.events);
    }
  }

  /**
   * Set the calendar view
   * @param {import('../../types.js').ViewType} viewType - The view type ('month', 'week', 'day', 'list')
   * @param {Date} [date=null] - Optional date to navigate to
   */
  setView(viewType, date = null) {
    this.state.setView(viewType);

    if (date) {
      this.state.setCurrentDate(date);
    }

    this._emit('viewChange', {
      view: viewType,
      date: date || this.state.get('currentDate')
    });
  }

  /**
   * Get the current view type
   * @returns {import('../../types.js').ViewType} The current view type
   */
  getView() {
    return this.state.get('view');
  }

  /**
   * Navigate to the next period
   */
  next() {
    this.state.navigateNext();
    this._emit('navigate', {
      direction: 'next',
      date: this.state.get('currentDate'),
      view: this.state.get('view')
    });
  }

  /**
   * Navigate to the previous period
   */
  previous() {
    this.state.navigatePrevious();
    this._emit('navigate', {
      direction: 'previous',
      date: this.state.get('currentDate'),
      view: this.state.get('view')
    });
  }

  /**
   * Navigate to today
   */
  today() {
    this.state.navigateToday();
    this._emit('navigate', {
      direction: 'today',
      date: this.state.get('currentDate'),
      view: this.state.get('view')
    });
  }

  /**
   * Navigate to a specific date
   * @param {Date} date - The date to navigate to
   */
  goToDate(date) {
    this.state.setCurrentDate(date);
    this._emit('navigate', {
      direction: 'goto',
      date: date,
      view: this.state.get('view')
    });
  }

  /**
   * Get the current date
   * @returns {Date}
   */
  getCurrentDate() {
    return new Date(this.state.get('currentDate'));
  }

  /**
   * Add an event
   * @param {import('../events/Event.js').Event|import('../../types.js').EventData} eventData - Event data or Event instance
   * @returns {import('../events/Event.js').Event} The added event
   */
  addEvent(eventData) {
    const event = this.eventStore.addEvent(eventData);

    this._emit('eventAdd', { event });

    return event;
  }

  /**
   * Update an event
   * @param {string} eventId - The event ID
   * @param {Object} updates - Properties to update
   * @returns {Event} The updated event
   */
  updateEvent(eventId, updates) {
    const oldEvent = this.eventStore.getEvent(eventId);
    const event = this.eventStore.updateEvent(eventId, updates);

    this._emit('eventUpdate', { event, oldEvent });

    return event;
  }

  /**
   * Remove an event
   * @param {string} eventId - The event ID
   * @returns {boolean} True if removed
   */
  removeEvent(eventId) {
    const event = this.eventStore.getEvent(eventId);
    const removed = this.eventStore.removeEvent(eventId);

    if (removed) {
      this._emit('eventRemove', { event });
    }

    return removed;
  }

  /**
   * Get an event by ID
   * @param {string} eventId - The event ID
   * @returns {Event|null}
   */
  getEvent(eventId) {
    return this.eventStore.getEvent(eventId);
  }

  /**
   * Get all events
   * @returns {Event[]}
   */
  getEvents() {
    return this.eventStore.getAllEvents();
  }

  /**
   * Set all events (replaces existing)
   * @param {Event[]} events - Array of events
   */
  setEvents(events) {
    this.eventStore.loadEvents(events);
    this._emit('eventsSet', { events: this.getEvents() });
  }

  /**
   * Query events with filters
   * @param {Object} filters - Query filters
   * @returns {Event[]}
   */
  queryEvents(filters) {
    return this.eventStore.queryEvents(filters);
  }

  /**
   * Get events for a specific date
   * @param {Date} date - The date
   * @param {string} [timezone] - Timezone for the query (defaults to calendar timezone)
   * @returns {Event[]}
   */
  getEventsForDate(date, timezone = null) {
    return this.eventStore.getEventsForDate(date, timezone || this.config.timeZone);
  }

  /**
   * Get events in a date range
   * @param {Date} start - Start date
   * @param {Date} end - End date
   * @param {string} [timezone] - Timezone for the query (defaults to calendar timezone)
   * @returns {Event[]}
   */
  getEventsInRange(start, end, timezone = null) {
    return this.eventStore.getEventsInRange(start, end, true, timezone || this.config.timeZone);
  }

  /**
   * Set the calendar's timezone
   * @param {string} timezone - IANA timezone identifier
   */
  setTimezone(timezone) {
    const parsedTimezone = this.timezoneManager.parseTimezone(timezone);
    const previousTimezone = this.config.timeZone;

    this.config.timeZone = parsedTimezone;
    this.eventStore.defaultTimezone = parsedTimezone;
    this.state.setState({ timeZone: parsedTimezone });

    this._emit('timezoneChange', {
      timezone: parsedTimezone,
      previousTimezone: previousTimezone
    });
  }

  /**
   * Get the current timezone
   * @returns {string} Current timezone
   */
  getTimezone() {
    return this.config.timeZone;
  }

  /**
   * Convert a date from one timezone to another
   * @param {Date} date - Date to convert
   * @param {string} fromTimezone - Source timezone
   * @param {string} toTimezone - Target timezone
   * @returns {Date} Converted date
   */
  convertTimezone(date, fromTimezone, toTimezone) {
    return this.timezoneManager.convertTimezone(date, fromTimezone, toTimezone);
  }

  /**
   * Convert a date to the calendar's timezone
   * @param {Date} date - Date to convert
   * @param {string} fromTimezone - Source timezone
   * @returns {Date} Date in calendar timezone
   */
  toCalendarTimezone(date, fromTimezone) {
    return this.timezoneManager.convertTimezone(date, fromTimezone, this.config.timeZone);
  }

  /**
   * Convert a date from the calendar's timezone
   * @param {Date} date - Date in calendar timezone
   * @param {string} toTimezone - Target timezone
   * @returns {Date} Converted date
   */
  fromCalendarTimezone(date, toTimezone) {
    return this.timezoneManager.convertTimezone(date, this.config.timeZone, toTimezone);
  }

  /**
   * Format a date in a specific timezone
   * @param {Date} date - Date to format
   * @param {string} [timezone] - Timezone for formatting (defaults to calendar timezone)
   * @param {Object} [options] - Formatting options
   * @returns {string} Formatted date string
   */
  formatInTimezone(date, timezone = null, options = {}) {
    return this.timezoneManager.formatInTimezone(
      date,
      timezone || this.config.timeZone,
      options
    );
  }

  /**
   * Get list of common timezones with offsets
   * @returns {Array<{value: string, label: string, offset: string}>} Timezone list
   */
  getTimezones() {
    return this.timezoneManager.getCommonTimezones();
  }

  /**
   * Get overlapping event groups for a date
   * @param {Date} date - The date to check
   * @param {boolean} timedOnly - Only include timed events
   * @returns {Array<Event[]>} Array of event groups that overlap
   */
  getOverlapGroups(date, timedOnly = true) {
    return this.eventStore.getOverlapGroups(date, timedOnly);
  }

  /**
   * Calculate event positions for rendering
   * @param {Event[]} events - Array of overlapping events
   * @returns {Map<string, {column: number, totalColumns: number}>} Position data
   */
  calculateEventPositions(events) {
    return this.eventStore.calculateEventPositions(events);
  }

  /**
   * Get the current view's data
   * @returns {import('../../types.js').MonthViewData|import('../../types.js').WeekViewData|import('../../types.js').DayViewData|import('../../types.js').ListViewData|null} View-specific data
   */
  getViewData() {
    const view = this.state.get('view');
    const currentDate = this.state.get('currentDate');

    switch (view) {
      case 'month':
        return this._getMonthViewData(currentDate);
      case 'week':
        return this._getWeekViewData(currentDate);
      case 'day':
        return this._getDayViewData(currentDate);
      case 'list':
        return this._getListViewData(currentDate);
      default:
        return null;
    }
  }

  /**
   * Get month view data
   * @private
   */
  _getMonthViewData(date) {
    const year = date.getFullYear();
    const month = date.getMonth();
    const weekStartsOn = this.state.get('weekStartsOn');
    const fixedWeekCount = this.state.get('fixedWeekCount');

    // Get the first day of the month
    const firstDay = new Date(year, month, 1);

    // Get the last day of the month
    const lastDay = new Date(year, month + 1, 0);

    // Calculate the start date (beginning of the week containing the first day)
    const startDate = DateUtils.startOfWeek(firstDay, weekStartsOn);

    // Calculate weeks
    const weeks = [];
    let currentDate = new Date(startDate);

    // Generate weeks
    const maxWeeks = fixedWeekCount ? 6 : Math.ceil((lastDay.getDate() + DateUtils.getDayOfWeek(firstDay, weekStartsOn)) / 7);

    for (let weekIndex = 0; weekIndex < maxWeeks; weekIndex++) {
      const week = {
        weekNumber: DateUtils.getWeekNumber(currentDate),
        days: []
      };

      for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
        const dayDate = new Date(currentDate);
        const isCurrentMonth = dayDate.getMonth() === month;
        const isToday = DateUtils.isToday(dayDate);
        const isWeekend = dayDate.getDay() === 0 || dayDate.getDay() === 6;

        week.days.push({
          date: dayDate,
          dayOfMonth: dayDate.getDate(),
          isCurrentMonth,
          isToday,
          isWeekend,
          events: this.getEventsForDate(dayDate)
        });

        // Use DateUtils.addDays to handle month boundaries correctly
        currentDate = DateUtils.addDays(currentDate, 1);
      }

      weeks.push(week);
    }

    return {
      type: 'month',
      year,
      month,
      monthName: DateUtils.getMonthName(date, this.state.get('locale')),
      weeks,
      startDate,
      endDate: new Date(currentDate.getTime() - 1) // Last moment of the view
    };
  }

  /**
   * Get week view data
   * @private
   */
  _getWeekViewData(date) {
    const weekStartsOn = this.state.get('weekStartsOn');
    const startDate = DateUtils.startOfWeek(date, weekStartsOn);
    const endDate = DateUtils.endOfWeek(date, weekStartsOn);

    const days = [];
    const currentDate = new Date(startDate);

    for (let i = 0; i < 7; i++) {
      const dayDate = new Date(currentDate);
      days.push({
        date: dayDate,
        dayOfWeek: dayDate.getDay(),
        dayName: DateUtils.getDayName(dayDate, this.state.get('locale')),
        isToday: DateUtils.isToday(dayDate),
        isWeekend: dayDate.getDay() === 0 || dayDate.getDay() === 6,
        events: this.getEventsForDate(dayDate),
        // Add overlap groups for positioning overlapping events
        overlapGroups: this.eventStore.getOverlapGroups(dayDate, true),
        getEventPositions: (events) => this.eventStore.calculateEventPositions(events)
      });
      // Move to next day
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return {
      type: 'week',
      weekNumber: DateUtils.getWeekNumber(startDate),
      startDate,
      endDate,
      days
    };
  }

  /**
   * Get day view data
   * @private
   */
  _getDayViewData(date) {
    const events = this.getEventsForDate(date);

    // Separate all-day and timed events
    const allDayEvents = events.filter(e => e.allDay);
    const timedEvents = events.filter(e => !e.allDay);

    // Create hourly slots for timed events
    const hours = [];
    for (let hour = 0; hour < 24; hour++) {
      const hourDate = new Date(date);
      hourDate.setHours(hour, 0, 0, 0);
      const hourEnd = new Date(date);
      hourEnd.setHours(hour + 1, 0, 0, 0);

      hours.push({
        hour,
        time: DateUtils.formatTime(hourDate, this.state.get('locale')),
        events: timedEvents.filter(event => {
          // Check if event occurs during this hour (not just starts)
          // Event occurs in this hour if it overlaps with the hour slot
          return event.start < hourEnd && event.end > hourDate;
        })
      });
    }

    return {
      type: 'day',
      date,
      dayName: DateUtils.getDayName(date, this.state.get('locale')),
      isToday: DateUtils.isToday(date),
      allDayEvents,
      hours
    };
  }

  /**
   * Get list view data
   * @private
   */
  _getListViewData(date) {
    // Get events for the next 30 days
    const startDate = new Date(date);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 30);

    const events = this.getEventsInRange(startDate, endDate);

    // Group events by day
    const groupedEvents = new Map();

    events.forEach(event => {
      const dateKey = event.start.toDateString();
      if (!groupedEvents.has(dateKey)) {
        groupedEvents.set(dateKey, {
          date: new Date(event.start),
          events: []
        });
      }
      groupedEvents.get(dateKey).events.push(event);
    });

    // Convert to sorted array
    const days = Array.from(groupedEvents.values())
      .sort((a, b) => a.date - b.date)
      .map(day => ({
        ...day,
        dayName: DateUtils.getDayName(day.date, this.state.get('locale')),
        isToday: DateUtils.isToday(day.date)
      }));

    return {
      type: 'list',
      startDate,
      endDate,
      days,
      totalEvents: events.length
    };
  }

  /**
   * Select an event
   * @param {string} eventId - Event ID to select
   */
  selectEvent(eventId) {
    const event = this.getEvent(eventId);
    if (event) {
      this.state.selectEvent(eventId);
      this._emit('eventSelect', { event });
    }
  }

  /**
   * Clear event selection
   */
  clearEventSelection() {
    const eventId = this.state.get('selectedEventId');
    this.state.clearEventSelection();

    if (eventId) {
      this._emit('eventDeselect', { eventId });
    }
  }

  /**
   * Select a date
   * @param {Date} date - Date to select
   */
  selectDate(date) {
    this.state.selectDate(date);
    this._emit('dateSelect', { date });
  }

  /**
   * Clear date selection
   */
  clearDateSelection() {
    const date = this.state.get('selectedDate');
    this.state.clearDateSelection();

    if (date) {
      this._emit('dateDeselect', { date });
    }
  }

  /**
   * Subscribe to calendar events
   * @param {string} eventName - Event name
   * @param {Function} callback - Callback function
   * @returns {Function} Unsubscribe function
   */
  on(eventName, callback) {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, new Set());
    }
    this.listeners.get(eventName).add(callback);

    return () => this.off(eventName, callback);
  }

  /**
   * Unsubscribe from calendar events
   * @param {string} eventName - Event name
   * @param {Function} callback - Callback function
   */
  off(eventName, callback) {
    const callbacks = this.listeners.get(eventName);
    if (callbacks) {
      callbacks.delete(callback);
      if (callbacks.size === 0) {
        this.listeners.delete(eventName);
      }
    }
  }

  /**
   * Emit an event
   * @private
   */
  _emit(eventName, data) {
    const callbacks = this.listeners.get(eventName);
    if (callbacks) {
      callbacks.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in event listener for "${eventName}":`, error);
        }
      });
    }
  }

  /**
   * Set up internal listeners
   * @private
   */
  _setupInternalListeners() {
    // Listen to state changes
    this.state.subscribe((newState, oldState) => {
      this._emit('stateChange', { newState, oldState });
    });

    // Listen to event store changes
    this.eventStore.subscribe((change) => {
      this._emit('eventStoreChange', change);
    });
  }

  /**
   * Install a plugin
   * @param {Object} plugin - Plugin object with install method
   */
  use(plugin) {
    if (this.plugins.has(plugin)) {
      console.warn('Plugin already installed');
      return;
    }

    if (typeof plugin.install === 'function') {
      plugin.install(this);
      this.plugins.add(plugin);
    } else {
      throw new Error('Plugin must have an install method');
    }
  }

  /**
   * Destroy the calendar and clean up
   */
  destroy() {
    // Clear all listeners
    this.listeners.clear();

    // Clear stores
    this.eventStore.clear();

    // Clear plugins
    this.plugins.forEach(plugin => {
      if (typeof plugin.uninstall === 'function') {
        plugin.uninstall(this);
      }
    });
    this.plugins.clear();

    this._emit('destroy');
  }
}// Test workflow

/**
 * Lightning Calendar Core - Main entry point
 * A modern, lightweight, framework-agnostic calendar library
 * Optimized for Salesforce Lightning and Locker Service
 */


// Version
const VERSION = '0.1.0';

export { Calendar, DateUtils, Event, EventStore, StateManager, VERSION, Calendar as default };
//# sourceMappingURL=calendar-core.esm.js.map
