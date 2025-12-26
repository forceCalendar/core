/**
 * Force Calendar Core - Main entry point
 * A modern, lightweight, framework-agnostic calendar library
 * Optimized for Salesforce and Locker Service
 */

// Core exports
export { Calendar } from './calendar/Calendar.js';
export { Event } from './events/Event.js';
export { EventStore } from './events/EventStore.js';
export { StateManager } from './state/StateManager.js';
export { DateUtils } from './calendar/DateUtils.js';

// ICS Import/Export
export { ICSParser } from './ics/ICSParser.js';
export { ICSHandler } from './ics/ICSHandler.js';

// Search and Filtering
export { EventSearch } from './search/EventSearch.js';

// Version
export const VERSION = '0.2.0';

// Default export
export { Calendar as default } from './calendar/Calendar.js';