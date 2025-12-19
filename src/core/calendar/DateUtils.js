/**
 * DateUtils - Date manipulation utilities
 * Pure functions, no external dependencies
 * Locker Service compatible
 */
export class DateUtils {
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
   * @param {number} weekStartsOn - 0 = Sunday, 1 = Monday, etc.
   * @returns {Date}
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

    // Use Intl API to get the UTC time for this local time in the timezone
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

    // Parse the local date in the target timezone
    const localDate = new Date(`${dateStr}T${timeStr}`);

    // Get offset and adjust
    const offset = DateUtils.getTimezoneOffset(localDate, timeZone);
    const utcTime = localDate.getTime() + (offset * 60000);

    return new Date(utcTime);
  }
}