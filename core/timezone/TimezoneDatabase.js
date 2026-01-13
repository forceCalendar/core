/**
 * TimezoneDatabase - Comprehensive IANA timezone database
 * Contains timezone rules for all major zones worldwide
 */

export class TimezoneDatabase {
  constructor() {
    // Comprehensive IANA timezone offset data (Standard Time)
    // Offsets in minutes from UTC
    this.timezones = {
      // UTC
      UTC: { offset: 0, dst: null },
      GMT: { offset: 0, dst: null },

      // Africa
      'Africa/Abidjan': { offset: 0, dst: null },
      'Africa/Accra': { offset: 0, dst: null },
      'Africa/Addis_Ababa': { offset: 180, dst: null },
      'Africa/Algiers': { offset: 60, dst: null },
      'Africa/Cairo': { offset: 120, dst: null },
      'Africa/Casablanca': {
        offset: 60,
        dst: {
          start: { month: 3, week: -1, day: 0 },
          end: { month: 10, week: -1, day: 0 },
          offset: 60
        }
      },
      'Africa/Johannesburg': { offset: 120, dst: null },
      'Africa/Lagos': { offset: 60, dst: null },
      'Africa/Nairobi': { offset: 180, dst: null },

      // Americas
      'America/Anchorage': {
        offset: -540,
        dst: {
          start: { month: 3, week: 2, day: 0 },
          end: { month: 11, week: 1, day: 0 },
          offset: 60
        }
      },
      'America/Argentina/Buenos_Aires': { offset: -180, dst: null },
      'America/Bogota': { offset: -300, dst: null },
      'America/Caracas': { offset: -240, dst: null },
      'America/Chicago': {
        offset: -360,
        dst: {
          start: { month: 3, week: 2, day: 0 },
          end: { month: 11, week: 1, day: 0 },
          offset: 60
        }
      },
      'America/Denver': {
        offset: -420,
        dst: {
          start: { month: 3, week: 2, day: 0 },
          end: { month: 11, week: 1, day: 0 },
          offset: 60
        }
      },
      'America/Detroit': {
        offset: -300,
        dst: {
          start: { month: 3, week: 2, day: 0 },
          end: { month: 11, week: 1, day: 0 },
          offset: 60
        }
      },
      'America/Halifax': {
        offset: -240,
        dst: {
          start: { month: 3, week: 2, day: 0 },
          end: { month: 11, week: 1, day: 0 },
          offset: 60
        }
      },
      'America/Los_Angeles': {
        offset: -480,
        dst: {
          start: { month: 3, week: 2, day: 0 },
          end: { month: 11, week: 1, day: 0 },
          offset: 60
        }
      },
      'America/Mexico_City': {
        offset: -360,
        dst: {
          start: { month: 4, week: 1, day: 0 },
          end: { month: 10, week: -1, day: 0 },
          offset: 60
        }
      },
      'America/New_York': {
        offset: -300,
        dst: {
          start: { month: 3, week: 2, day: 0 },
          end: { month: 11, week: 1, day: 0 },
          offset: 60
        }
      },
      'America/Phoenix': { offset: -420, dst: null },
      'America/Regina': { offset: -360, dst: null },
      'America/Santiago': {
        offset: -180,
        dst: {
          start: { month: 9, week: 1, day: 0 },
          end: { month: 4, week: 1, day: 0 },
          offset: 60
        }
      },
      'America/Sao_Paulo': {
        offset: -180,
        dst: {
          start: { month: 10, week: 3, day: 0 },
          end: { month: 2, week: 3, day: 0 },
          offset: 60
        }
      },
      'America/St_Johns': {
        offset: -210,
        dst: {
          start: { month: 3, week: 2, day: 0 },
          end: { month: 11, week: 1, day: 0 },
          offset: 60
        }
      },
      'America/Toronto': {
        offset: -300,
        dst: {
          start: { month: 3, week: 2, day: 0 },
          end: { month: 11, week: 1, day: 0 },
          offset: 60
        }
      },
      'America/Vancouver': {
        offset: -480,
        dst: {
          start: { month: 3, week: 2, day: 0 },
          end: { month: 11, week: 1, day: 0 },
          offset: 60
        }
      },

      // Asia
      'Asia/Baghdad': { offset: 180, dst: null },
      'Asia/Bangkok': { offset: 420, dst: null },
      'Asia/Dubai': { offset: 240, dst: null },
      'Asia/Hong_Kong': { offset: 480, dst: null },
      'Asia/Jakarta': { offset: 420, dst: null },
      'Asia/Jerusalem': {
        offset: 120,
        dst: {
          start: { month: 3, week: -1, day: 5 },
          end: { month: 10, week: -1, day: 0 },
          offset: 60
        }
      },
      'Asia/Karachi': { offset: 300, dst: null },
      'Asia/Kolkata': { offset: 330, dst: null },
      'Asia/Kuala_Lumpur': { offset: 480, dst: null },
      'Asia/Manila': { offset: 480, dst: null },
      'Asia/Seoul': { offset: 540, dst: null },
      'Asia/Shanghai': { offset: 480, dst: null },
      'Asia/Singapore': { offset: 480, dst: null },
      'Asia/Taipei': { offset: 480, dst: null },
      'Asia/Tehran': {
        offset: 210,
        dst: {
          start: { month: 3, week: 4, day: 0 },
          end: { month: 9, week: 4, day: 0 },
          offset: 60
        }
      },
      'Asia/Tokyo': { offset: 540, dst: null },

      // Atlantic
      'Atlantic/Azores': {
        offset: -60,
        dst: {
          start: { month: 3, week: -1, day: 0 },
          end: { month: 10, week: -1, day: 0 },
          offset: 60
        }
      },
      'Atlantic/Bermuda': {
        offset: -240,
        dst: {
          start: { month: 3, week: 2, day: 0 },
          end: { month: 11, week: 1, day: 0 },
          offset: 60
        }
      },
      'Atlantic/Reykjavik': { offset: 0, dst: null },

      // Australia & Pacific
      'Australia/Adelaide': {
        offset: 570,
        dst: {
          start: { month: 10, week: 1, day: 0 },
          end: { month: 4, week: 1, day: 0 },
          offset: 60
        }
      },
      'Australia/Brisbane': { offset: 600, dst: null },
      'Australia/Darwin': { offset: 570, dst: null },
      'Australia/Hobart': {
        offset: 600,
        dst: {
          start: { month: 10, week: 1, day: 0 },
          end: { month: 4, week: 1, day: 0 },
          offset: 60
        }
      },
      'Australia/Melbourne': {
        offset: 600,
        dst: {
          start: { month: 10, week: 1, day: 0 },
          end: { month: 4, week: 1, day: 0 },
          offset: 60
        }
      },
      'Australia/Perth': { offset: 480, dst: null },
      'Australia/Sydney': {
        offset: 600,
        dst: {
          start: { month: 10, week: 1, day: 0 },
          end: { month: 4, week: 1, day: 0 },
          offset: 60
        }
      },

      // Europe
      'Europe/Amsterdam': {
        offset: 60,
        dst: {
          start: { month: 3, week: -1, day: 0 },
          end: { month: 10, week: -1, day: 0 },
          offset: 60
        }
      },
      'Europe/Athens': {
        offset: 120,
        dst: {
          start: { month: 3, week: -1, day: 0 },
          end: { month: 10, week: -1, day: 0 },
          offset: 60
        }
      },
      'Europe/Berlin': {
        offset: 60,
        dst: {
          start: { month: 3, week: -1, day: 0 },
          end: { month: 10, week: -1, day: 0 },
          offset: 60
        }
      },
      'Europe/Brussels': {
        offset: 60,
        dst: {
          start: { month: 3, week: -1, day: 0 },
          end: { month: 10, week: -1, day: 0 },
          offset: 60
        }
      },
      'Europe/Budapest': {
        offset: 60,
        dst: {
          start: { month: 3, week: -1, day: 0 },
          end: { month: 10, week: -1, day: 0 },
          offset: 60
        }
      },
      'Europe/Copenhagen': {
        offset: 60,
        dst: {
          start: { month: 3, week: -1, day: 0 },
          end: { month: 10, week: -1, day: 0 },
          offset: 60
        }
      },
      'Europe/Dublin': {
        offset: 0,
        dst: {
          start: { month: 3, week: -1, day: 0 },
          end: { month: 10, week: -1, day: 0 },
          offset: 60
        }
      },
      'Europe/Helsinki': {
        offset: 120,
        dst: {
          start: { month: 3, week: -1, day: 0 },
          end: { month: 10, week: -1, day: 0 },
          offset: 60
        }
      },
      'Europe/Istanbul': { offset: 180, dst: null },
      'Europe/Kiev': {
        offset: 120,
        dst: {
          start: { month: 3, week: -1, day: 0 },
          end: { month: 10, week: -1, day: 0 },
          offset: 60
        }
      },
      'Europe/Lisbon': {
        offset: 0,
        dst: {
          start: { month: 3, week: -1, day: 0 },
          end: { month: 10, week: -1, day: 0 },
          offset: 60
        }
      },
      'Europe/London': {
        offset: 0,
        dst: {
          start: { month: 3, week: -1, day: 0 },
          end: { month: 10, week: -1, day: 0 },
          offset: 60
        }
      },
      'Europe/Madrid': {
        offset: 60,
        dst: {
          start: { month: 3, week: -1, day: 0 },
          end: { month: 10, week: -1, day: 0 },
          offset: 60
        }
      },
      'Europe/Moscow': { offset: 180, dst: null },
      'Europe/Oslo': {
        offset: 60,
        dst: {
          start: { month: 3, week: -1, day: 0 },
          end: { month: 10, week: -1, day: 0 },
          offset: 60
        }
      },
      'Europe/Paris': {
        offset: 60,
        dst: {
          start: { month: 3, week: -1, day: 0 },
          end: { month: 10, week: -1, day: 0 },
          offset: 60
        }
      },
      'Europe/Prague': {
        offset: 60,
        dst: {
          start: { month: 3, week: -1, day: 0 },
          end: { month: 10, week: -1, day: 0 },
          offset: 60
        }
      },
      'Europe/Rome': {
        offset: 60,
        dst: {
          start: { month: 3, week: -1, day: 0 },
          end: { month: 10, week: -1, day: 0 },
          offset: 60
        }
      },
      'Europe/Stockholm': {
        offset: 60,
        dst: {
          start: { month: 3, week: -1, day: 0 },
          end: { month: 10, week: -1, day: 0 },
          offset: 60
        }
      },
      'Europe/Vienna': {
        offset: 60,
        dst: {
          start: { month: 3, week: -1, day: 0 },
          end: { month: 10, week: -1, day: 0 },
          offset: 60
        }
      },
      'Europe/Warsaw': {
        offset: 60,
        dst: {
          start: { month: 3, week: -1, day: 0 },
          end: { month: 10, week: -1, day: 0 },
          offset: 60
        }
      },
      'Europe/Zurich': {
        offset: 60,
        dst: {
          start: { month: 3, week: -1, day: 0 },
          end: { month: 10, week: -1, day: 0 },
          offset: 60
        }
      },

      // Indian
      'Indian/Maldives': { offset: 300, dst: null },
      'Indian/Mauritius': { offset: 240, dst: null },

      // Pacific
      'Pacific/Auckland': {
        offset: 720,
        dst: {
          start: { month: 9, week: -1, day: 0 },
          end: { month: 4, week: 1, day: 0 },
          offset: 60
        }
      },
      'Pacific/Fiji': {
        offset: 720,
        dst: {
          start: { month: 11, week: 1, day: 0 },
          end: { month: 1, week: 3, day: 0 },
          offset: 60
        }
      },
      'Pacific/Guam': { offset: 600, dst: null },
      'Pacific/Honolulu': { offset: -600, dst: null },
      'Pacific/Midway': { offset: -660, dst: null },
      'Pacific/Noumea': { offset: 660, dst: null },
      'Pacific/Pago_Pago': { offset: -660, dst: null },
      'Pacific/Port_Moresby': { offset: 600, dst: null },
      'Pacific/Tahiti': { offset: -600, dst: null }
    };

    // Timezone aliases and abbreviations
    this.aliases = {
      // Common abbreviations to IANA
      EST: 'America/New_York',
      EDT: 'America/New_York',
      CST: 'America/Chicago',
      CDT: 'America/Chicago',
      MST: 'America/Denver',
      MDT: 'America/Denver',
      PST: 'America/Los_Angeles',
      PDT: 'America/Los_Angeles',
      AKST: 'America/Anchorage',
      AKDT: 'America/Anchorage',
      HST: 'Pacific/Honolulu',
      AST: 'America/Halifax',
      ADT: 'America/Halifax',
      NST: 'America/St_Johns',
      NDT: 'America/St_Johns',
      BST: 'Europe/London',
      IST: 'Asia/Kolkata',
      WET: 'Europe/Lisbon',
      WEST: 'Europe/Lisbon',
      CET: 'Europe/Paris',
      CEST: 'Europe/Paris',
      EET: 'Europe/Athens',
      EEST: 'Europe/Athens',
      MSK: 'Europe/Moscow',
      JST: 'Asia/Tokyo',
      KST: 'Asia/Seoul',
      CST_CN: 'Asia/Shanghai',
      HKT: 'Asia/Hong_Kong',
      SGT: 'Asia/Singapore',
      AEST: 'Australia/Sydney',
      AEDT: 'Australia/Sydney',
      ACST: 'Australia/Adelaide',
      ACDT: 'Australia/Adelaide',
      AWST: 'Australia/Perth',
      NZST: 'Pacific/Auckland',
      NZDT: 'Pacific/Auckland',

      // City/Country aliases
      'US/Eastern': 'America/New_York',
      'US/Central': 'America/Chicago',
      'US/Mountain': 'America/Denver',
      'US/Pacific': 'America/Los_Angeles',
      'US/Alaska': 'America/Anchorage',
      'US/Hawaii': 'Pacific/Honolulu',
      'Canada/Eastern': 'America/Toronto',
      'Canada/Central': 'America/Regina',
      'Canada/Mountain': 'America/Denver',
      'Canada/Pacific': 'America/Vancouver',
      'Canada/Atlantic': 'America/Halifax',
      'Canada/Newfoundland': 'America/St_Johns',
      'Mexico/General': 'America/Mexico_City',
      'Brazil/East': 'America/Sao_Paulo',
      'Chile/Continental': 'America/Santiago',
      GB: 'Europe/London',
      'GB-Eire': 'Europe/London',
      Eire: 'Europe/Dublin',
      Israel: 'Asia/Jerusalem',
      Japan: 'Asia/Tokyo',
      Singapore: 'Asia/Singapore',
      Hongkong: 'Asia/Hong_Kong',
      ROK: 'Asia/Seoul',
      PRC: 'Asia/Shanghai',
      'Australia/NSW': 'Australia/Sydney',
      'Australia/Victoria': 'Australia/Melbourne',
      'Australia/Queensland': 'Australia/Brisbane',
      'Australia/South': 'Australia/Adelaide',
      'Australia/Tasmania': 'Australia/Hobart',
      'Australia/West': 'Australia/Perth',
      'Australia/North': 'Australia/Darwin',
      NZ: 'Pacific/Auckland'
    };
  }

  /**
   * Get timezone data by identifier
   * @param {string} timezone - Timezone identifier or alias
   * @returns {Object|null} Timezone data or null if not found
   */
  getTimezone(timezone) {
    // Check for alias first
    if (this.aliases[timezone]) {
      timezone = this.aliases[timezone];
    }

    return this.timezones[timezone] || null;
  }

  /**
   * Get all available timezone identifiers
   * @returns {string[]} Array of timezone identifiers
   */
  getAllTimezones() {
    return Object.keys(this.timezones);
  }

  /**
   * Check if a timezone identifier is valid
   * @param {string} timezone - Timezone identifier
   * @returns {boolean} True if valid
   */
  isValidTimezone(timezone) {
    return this.aliases[timezone] !== undefined || this.timezones[timezone] !== undefined;
  }

  /**
   * Resolve timezone alias to canonical identifier
   * @param {string} timezone - Timezone identifier or alias
   * @returns {string} Canonical timezone identifier
   */
  resolveAlias(timezone) {
    return this.aliases[timezone] || timezone;
  }

  /**
   * Get timezones by offset
   * @param {number} offsetMinutes - Offset in minutes from UTC
   * @returns {string[]} Array of timezone identifiers
   */
  getTimezonesByOffset(offsetMinutes) {
    return Object.entries(this.timezones)
      .filter(([_, data]) => data.offset === offsetMinutes)
      .map(([id, _]) => id);
  }

  /**
   * Get common timezones for quick selection
   * @returns {Object} Grouped timezones by region
   */
  getCommonTimezones() {
    return {
      Americas: [
        'America/New_York',
        'America/Chicago',
        'America/Denver',
        'America/Los_Angeles',
        'America/Toronto',
        'America/Mexico_City',
        'America/Sao_Paulo'
      ],
      Europe: [
        'Europe/London',
        'Europe/Paris',
        'Europe/Berlin',
        'Europe/Moscow',
        'Europe/Rome',
        'Europe/Madrid',
        'Europe/Amsterdam'
      ],
      Asia: [
        'Asia/Tokyo',
        'Asia/Shanghai',
        'Asia/Hong_Kong',
        'Asia/Singapore',
        'Asia/Kolkata',
        'Asia/Dubai',
        'Asia/Seoul'
      ],
      'Australia/Pacific': [
        'Australia/Sydney',
        'Australia/Melbourne',
        'Australia/Brisbane',
        'Australia/Perth',
        'Pacific/Auckland',
        'Pacific/Honolulu'
      ],
      Africa: ['Africa/Cairo', 'Africa/Lagos', 'Africa/Johannesburg', 'Africa/Nairobi']
    };
  }
}
