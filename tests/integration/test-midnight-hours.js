/**
 * Midnight must format as hour 00, never 24. Older ICU builds (Node 18,
 * older Safari) return "24" for hour12: false, which shifted midnight
 * occurrences onto the wrong day; hourCycle: 'h23' is stable everywhere.
 */
import { TimezoneManager } from '../../core/timezone/TimezoneManager.js';
import { DateUtils } from '../../core/calendar/DateUtils.js';

let failed = 0;
function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.error(`  ❌ ${message}`);
  }
}

console.log('=== Midnight hour formatting ===');
const tz = TimezoneManager.getInstance();
// 2025-06-14T11:00:00Z is exactly midnight in Pacific/Pago_Pago (UTC-11)
const midnightPago = new Date(Date.UTC(2025, 5, 14, 11, 0, 0));
const midnightUTC = new Date(Date.UTC(2025, 5, 14, 0, 0, 0));

const hourPart = zone => date =>
  tz._getFormatter(zone).formatToParts(date).find(p => p.type === 'hour').value;
assert(hourPart('Pacific/Pago_Pago')(midnightPago) === '00', 'Pago Pago midnight hour part is 00');
assert(hourPart('UTC')(midnightUTC) === '00', 'UTC midnight hour part is 00');
assert(hourPart('Pacific/Kiritimati')(new Date(Date.UTC(2025, 5, 13, 10, 0, 0))) === '00', 'Kiritimati midnight hour part is 00');

const roundTrip = tz.fromUTC(tz.toUTC(midnightPago, 'Pacific/Pago_Pago'), 'Pacific/Pago_Pago');
assert(roundTrip.getTime() === midnightPago.getTime(), 'toUTC/fromUTC round-trips local midnight');

const display = tz.formatInTimezone(midnightPago, 'Pacific/Pago_Pago');
assert(typeof display === 'string' && !/24:00/.test(display), `formatInTimezone never renders 24:00 (got "${display}")`);

const parts = DateUtils.getDateParts
  ? DateUtils.getDateParts(midnightUTC, 'UTC')
  : null;
assert(parts === null || Number(parts.hour) === 0, `DateUtils reports hour 0 at midnight${parts ? ` (got ${parts.hour})` : ''}`);

if (failed > 0) {
  console.error(`❌ Midnight hour test failed: ${failed} assertion(s)`);
  process.exit(1);
}
console.log('✅ Midnight hour test complete!');
process.exit(0);
