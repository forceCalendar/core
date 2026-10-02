import { TimezoneManager } from '../timezone/TimezoneManager.js';

const DAY = 86400000;

/**
 * Internal Date cursor whose calendar fields belong to the recurrence zone.
 * Its timestamp is always an instant. Setters use Date's compatible policy:
 * choose the earlier instant in a repeated hour, or move forward over a gap.
 */
export class RecurrenceDate extends Date {
  constructor(date, timezone) {
    super(date);
    this.timezone = timezone;
    this.manager = TimezoneManager.getInstance();
  }

  _offset(ms) {
    return this.manager.getTimezoneOffset(new Date(ms), this.timezone, true) * 60000;
  }

  _wall() {
    return new Date(this.getTime() - this._offset(this.getTime()));
  }

  _set(field, args) {
    const wall = this._wall();
    return this._resolve(wall[`setUTC${field}`](...args));
  }

  _resolve(target) {
    if (!Number.isFinite(target)) {
      return this.setTime(target);
    }

    // Offsets on either side cover both a fold and a gap, including zones
    // with a half-hour transition and the 24-hour International Date Line jump.
    const offsets = new Set([
      this._offset(target - 2 * DAY),
      this._offset(target),
      this._offset(target + 2 * DAY)
    ]);
    let earlier = Infinity;
    let forward = Infinity;
    let forwardWall = Infinity;
    for (const offset of offsets) {
      const instant = target + offset;
      const actualWall = instant - this._offset(instant);
      if (actualWall === target) {
        earlier = Math.min(earlier, instant);
      } else if (actualWall > target && actualWall < forwardWall) {
        forward = instant;
        forwardWall = actualWall;
      }
    }
    return this.setTime(earlier < Infinity ? earlier : forward);
  }

  getFullYear() {
    return this._wall().getUTCFullYear();
  }
  getMonth() {
    return this._wall().getUTCMonth();
  }
  getDate() {
    return this._wall().getUTCDate();
  }
  getDay() {
    return this._wall().getUTCDay();
  }
  getHours() {
    return this._wall().getUTCHours();
  }
  getMinutes() {
    return this._wall().getUTCMinutes();
  }
  getSeconds() {
    return this._wall().getUTCSeconds();
  }
  setFullYear(...args) {
    return this._set('FullYear', args);
  }
  setMonth(...args) {
    return this._set('Month', args);
  }
  setDate(...args) {
    return this._set('Date', args);
  }
  setHours(...args) {
    return this._set('Hours', args);
  }
  setMinutes(...args) {
    return this._set('Minutes', args);
  }
  setSeconds(...args) {
    return this._set('Seconds', args);
  }
}
