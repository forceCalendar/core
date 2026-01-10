/**
 * RRuleParser - Full RFC 5545 compliant RRULE parser
 * Supports all RFC 5545 recurrence rule features
 */

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
                    rule.byWeekNo = this.parseIntList(value);
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
        const validFrequencies = ['SECONDLY', 'MINUTELY', 'HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];
        return validFrequencies.includes(freq) ? freq : 'DAILY';
    }

    /**
     * Parse BYDAY value
     * Returns array of strings like ['MO', '2TU', '-1FR'] for compatibility with RecurrenceEngine
     * @private
     */
    static parseByDay(value) {
        const days = value.split(',');
        const weekDays = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
        const result = [];

        for (const day of days) {
            const trimmed = day.trim().toUpperCase();
            const match = trimmed.match(/^([+-]?\d*)([A-Z]{2})$/);
            if (match) {
                const [_, nth, weekday] = match;
                if (weekDays.includes(weekday)) {
                    // Return string format for RecurrenceEngine compatibility
                    // e.g., 'MO', '2MO', '-1FR'
                    result.push(nth ? `${nth}${weekday}` : weekday);
                }
            }
        }

        return result;
    }

    /**
     * Parse comma-separated integer list
     * @private
     */
    static parseIntList(value) {
        return value.split(',').map(v => parseInt(v.trim(), 10)).filter(v => !isNaN(v));
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
     * Validate and normalize rule
     * @private
     */
    static validateRule(rule) {
        // Ensure frequency is set
        if (!rule.freq) {
            rule.freq = 'DAILY';
        }

        // Cannot have both COUNT and UNTIL
        if (rule.count && rule.until) {
            throw new Error('RRULE cannot have both COUNT and UNTIL');
        }

        // Validate interval
        if (rule.interval < 1) {
            rule.interval = 1;
        }

        // Validate by* arrays
        const validateArray = (arr, min, max) => {
            return arr.filter(v => v >= min && v <= max);
        };

        rule.byMonth = validateArray(rule.byMonth || [], 1, 12);
        rule.byMonthDay = validateArray(rule.byMonthDay || [], -31, 31).filter(v => v !== 0);
        rule.byYearDay = validateArray(rule.byYearDay || [], -366, 366).filter(v => v !== 0);
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
            const dayStr = rule.byDay.map(d => {
                return d.nth ? `${d.nth}${d.weekday}` : d.weekday;
            }).join(',');
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
            'SECONDLY': 'second',
            'MINUTELY': 'minute',
            'HOURLY': 'hour',
            'DAILY': 'day',
            'WEEKLY': 'week',
            'MONTHLY': 'month',
            'YEARLY': 'year'
        };

        const weekdayMap = {
            'SU': 'Sunday',
            'MO': 'Monday',
            'TU': 'Tuesday',
            'WE': 'Wednesday',
            'TH': 'Thursday',
            'FR': 'Friday',
            'SA': 'Saturday'
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

        // By day
        if (rule.byDay && rule.byDay.length > 0) {
            if (rule.freq === 'WEEKLY') {
                const days = rule.byDay.map(d => weekdayMap[d.weekday]).join(', ');
                description += ` on ${days}`;
            } else if (rule.freq === 'MONTHLY' || rule.freq === 'YEARLY') {
                const dayDescs = rule.byDay.map(d => {
                    if (d.nth) {
                        return `the ${nthMap[d.nth] || d.nth} ${weekdayMap[d.weekday]}`;
                    }
                    return weekdayMap[d.weekday];
                }).join(', ');
                description += ` on ${dayDescs}`;
            }
        }

        // By month day
        if (rule.byMonthDay && rule.byMonthDay.length > 0) {
            const days = rule.byMonthDay.map(d => {
                if (d < 0) {
                    return `${Math.abs(d)} day(s) from the end`;
                }
                return `day ${d}`;
            }).join(', ');
            description += ` on ${days}`;
        }

        // By month
        if (rule.byMonth && rule.byMonth.length > 0) {
            const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                              'July', 'August', 'September', 'October', 'November', 'December'];
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