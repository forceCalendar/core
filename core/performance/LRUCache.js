/**
 * LRU (Least Recently Used) Cache implementation
 * Provides O(1) get and put operations
 */
export class LRUCache {
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
    const hitRate =
      this.hits + this.misses > 0 ? ((this.hits / (this.hits + this.misses)) * 100).toFixed(2) : 0;

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
