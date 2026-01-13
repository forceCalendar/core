/**
 * SearchWorkerManager - Offloads search indexing to Web Workers
 * Provides scalable search for large event datasets
 */

export class SearchWorkerManager {
  constructor(eventStore) {
    this.eventStore = eventStore;
    this.workerSupported = typeof Worker !== 'undefined';
    this.worker = null;
    this.indexReady = false;
    this.pendingSearches = [];

    // Fallback to main thread if workers not available
    this.fallbackIndex = null;

    // Configuration
    this.config = {
      chunkSize: 100, // Events per indexing batch
      maxWorkers: 4, // Max parallel workers
      indexThreshold: 1000, // Use workers above this event count
      cacheSize: 50 // LRU cache for search results
    };

    // Search result cache
    this.searchCache = new Map();
    this.cacheOrder = [];

    this.initializeWorker();
  }

  /**
   * Initialize the search worker
   */
  initializeWorker() {
    if (!this.workerSupported) {
      // Use InvertedIndex as fallback
      this.fallbackIndex = new InvertedIndex();
      return;
    }

    // Create worker from inline code to avoid separate file requirement
    const workerCode = `
            let index = {};
            let events = {};
            let config = {};

            // Build inverted index
            function buildIndex(eventBatch) {
                for (const event of eventBatch) {
                    events[event.id] = event;

                    // Index each field
                    const fields = ['title', 'description', 'location', 'category'];
                    for (const field of fields) {
                        const value = event[field];
                        if (!value) continue;

                        // Tokenize and index
                        const tokens = tokenize(value.toLowerCase());
                        for (const token of tokens) {
                            if (!index[token]) {
                                index[token] = new Set();
                            }
                            index[token].add(event.id);
                        }
                    }
                }
            }

            // Tokenize text
            function tokenize(text) {
                // Split on word boundaries and filter
                return text.split(/\\W+/).filter(token =>
                    token.length > 1 && !stopWords.has(token)
                );
            }

            // Common stop words to ignore
            const stopWords = new Set([
                'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on',
                'at', 'to', 'for', 'of', 'with', 'by', 'from', 'is',
                'are', 'was', 'were', 'been', 'be'
            ]);

            // Search the index
            function search(query, options) {
                const queryTokens = tokenize(query.toLowerCase());
                const results = new Map();

                // Find matching events
                for (const token of queryTokens) {
                    // Exact match
                    if (index[token]) {
                        for (const eventId of index[token]) {
                            if (!results.has(eventId)) {
                                results.set(eventId, 0);
                            }
                            results.set(eventId, results.get(eventId) + 10);
                        }
                    }

                    // Prefix match for autocomplete
                    if (options.prefixMatch) {
                        for (const indexToken in index) {
                            if (indexToken.startsWith(token)) {
                                for (const eventId of index[indexToken]) {
                                    if (!results.has(eventId)) {
                                        results.set(eventId, 0);
                                    }
                                    results.set(eventId, results.get(eventId) + 5);
                                }
                            }
                        }
                    }
                }

                // Sort by relevance and return
                const sorted = Array.from(results.entries())
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, options.limit || 100)
                    .map(([id, score]) => ({
                        event: events[id],
                        score
                    }));

                return sorted;
            }

            // Message handler
            self.onmessage = function(e) {
                const { type, data } = e.data;

                switch(type) {
                    case 'init':
                        config = data.config;
                        postMessage({ type: 'ready' });
                        break;

                    case 'index':
                        buildIndex(data.events);
                        postMessage({
                            type: 'indexed',
                            count: Object.keys(events).length
                        });
                        break;

                    case 'search':
                        const results = search(data.query, data.options);
                        postMessage({
                            type: 'results',
                            id: data.id,
                            results
                        });
                        break;

                    case 'clear':
                        index = {};
                        events = {};
                        postMessage({ type: 'cleared' });
                        break;
                }
            };
        `;

    // Create worker from blob
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(blob);

    try {
      this.worker = new Worker(workerUrl);
      this.setupWorkerHandlers();

      // Initialize worker
      this.worker.postMessage({
        type: 'init',
        data: { config: this.config }
      });

      // Clean up blob URL
      URL.revokeObjectURL(workerUrl);
    } catch (error) {
      console.warn('Worker creation failed, falling back to main thread:', error);
      this.workerSupported = false;
      this.fallbackIndex = new InvertedIndex();
    }
  }

  /**
   * Setup worker message handlers
   */
  setupWorkerHandlers() {
    this.worker.onmessage = e => {
      const { type, data } = e.data;

      switch (type) {
        case 'ready':
          this.indexReady = true;
          this.indexEvents();
          break;

        case 'indexed':
          // Process pending searches
          this.processPendingSearches();
          break;

        case 'results':
          this.handleSearchResults(e.data);
          break;
      }
    };

    this.worker.onerror = error => {
      console.error('Worker error:', error);
      // Fallback to main thread
      this.workerSupported = false;
      this.fallbackIndex = new InvertedIndex();
    };
  }

  /**
   * Index all events
   */
  async indexEvents() {
    const events = this.eventStore.getAllEvents();

    // Use main thread for small datasets
    if (events.length < this.config.indexThreshold) {
      if (this.fallbackIndex) {
        this.fallbackIndex.buildIndex(events);
      }
      return;
    }

    // Chunk events for worker
    if (this.worker && this.indexReady) {
      for (let i = 0; i < events.length; i += this.config.chunkSize) {
        const chunk = events.slice(i, i + this.config.chunkSize);
        this.worker.postMessage({
          type: 'index',
          data: { events: chunk }
        });
      }
    }
  }

  /**
   * Search with caching and worker support
   */
  async search(query, options = {}) {
    const cacheKey = JSON.stringify({ query, options });

    // Check cache
    if (this.searchCache.has(cacheKey)) {
      return this.searchCache.get(cacheKey);
    }

    // Use appropriate search method
    let results;
    if (this.worker && this.indexReady) {
      results = await this.workerSearch(query, options);
    } else if (this.fallbackIndex) {
      results = this.fallbackIndex.search(query, options);
    } else {
      // Direct search as last resort
      results = this.directSearch(query, options);
    }

    // Cache results
    this.cacheResults(cacheKey, results);

    return results;
  }

  /**
   * Search using worker
   */
  workerSearch(query, options) {
    return new Promise(resolve => {
      const searchId = Date.now() + Math.random();

      this.pendingSearches.push({
        id: searchId,
        resolve
      });

      this.worker.postMessage({
        type: 'search',
        data: {
          id: searchId,
          query,
          options
        }
      });
    });
  }

  /**
   * Direct search without worker
   */
  directSearch(query, options) {
    const events = this.eventStore.getAllEvents();
    const queryLower = query.toLowerCase();
    const results = [];

    for (const event of events) {
      let score = 0;

      // Check each field
      const fields = options.fields || ['title', 'description', 'location'];
      for (const field of fields) {
        const value = event[field];
        if (!value) continue;

        const valueLower = value.toLowerCase();
        if (valueLower.includes(queryLower)) {
          score += field === 'title' ? 20 : 10;
        }
      }

      if (score > 0) {
        results.push({ event, score });
      }
    }

    // Sort and limit
    results.sort((a, b) => b.score - a.score);
    if (options.limit) {
      return results.slice(0, options.limit);
    }

    return results;
  }

  /**
   * Handle search results from worker
   */
  handleSearchResults(data) {
    const pending = this.pendingSearches.find(s => s.id === data.id);
    if (pending) {
      pending.resolve(data.results);
      this.pendingSearches = this.pendingSearches.filter(s => s.id !== data.id);
    }
  }

  /**
   * Process any pending searches
   */
  processPendingSearches() {
    // Re-trigger pending searches after indexing
    for (const search of this.pendingSearches) {
      // Will be handled by worker
    }
  }

  /**
   * Cache search results with LRU eviction
   */
  cacheResults(key, results) {
    // Add to cache
    this.searchCache.set(key, results);
    this.cacheOrder.push(key);

    // Evict old entries
    while (this.cacheOrder.length > this.config.cacheSize) {
      const oldKey = this.cacheOrder.shift();
      this.searchCache.delete(oldKey);
    }
  }

  /**
   * Clear index and cache
   */
  clear() {
    this.searchCache.clear();
    this.cacheOrder = [];

    if (this.worker) {
      this.worker.postMessage({ type: 'clear' });
    }
    if (this.fallbackIndex) {
      this.fallbackIndex.clear();
    }
  }

  /**
   * Destroy worker and clean up
   */
  destroy() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.clear();
  }
}

/**
 * InvertedIndex - Efficient inverted index for text search
 * Used as fallback when Web Workers not available
 */
export class InvertedIndex {
  constructor() {
    this.index = new Map(); // term -> Set of event IDs
    this.events = new Map(); // event ID -> event
    this.fieldBoosts = {
      title: 2.0,
      description: 1.0,
      location: 1.5,
      category: 1.5
    };
  }

  /**
   * Build inverted index from events
   */
  buildIndex(events) {
    this.clear();

    for (const event of events) {
      this.events.set(event.id, event);

      // Index each field with boost factors
      for (const [field, boost] of Object.entries(this.fieldBoosts)) {
        const value = event[field];
        if (!value) continue;

        const tokens = this.tokenize(value);
        for (const token of tokens) {
          if (!this.index.has(token)) {
            this.index.set(token, new Map());
          }

          const eventScores = this.index.get(token);
          const currentScore = eventScores.get(event.id) || 0;
          eventScores.set(event.id, currentScore + boost);
        }
      }
    }
  }

  /**
   * Tokenize text into searchable terms
   */
  tokenize(text) {
    return text
      .toLowerCase()
      .split(/\W+/)
      .filter(token => token.length > 1);
  }

  /**
   * Search the index
   */
  search(query, options = {}) {
    const queryTokens = this.tokenize(query);
    const scores = new Map();

    // Aggregate scores from all matching terms
    for (const token of queryTokens) {
      // Exact matches
      if (this.index.has(token)) {
        const eventScores = this.index.get(token);
        for (const [eventId, tokenScore] of eventScores) {
          const currentScore = scores.get(eventId) || 0;
          scores.set(eventId, currentScore + tokenScore);
        }
      }

      // Prefix matches for autocomplete
      if (options.prefixMatch) {
        for (const [indexToken, eventScores] of this.index) {
          if (indexToken.startsWith(token)) {
            for (const [eventId, tokenScore] of eventScores) {
              const currentScore = scores.get(eventId) || 0;
              scores.set(eventId, currentScore + tokenScore * 0.5);
            }
          }
        }
      }
    }

    // Convert to results array
    const results = Array.from(scores.entries())
      .map(([eventId, score]) => ({
        event: this.events.get(eventId),
        score
      }))
      .sort((a, b) => b.score - a.score);

    // Apply limit
    if (options.limit) {
      return results.slice(0, options.limit);
    }

    return results;
  }

  /**
   * Clear the index
   */
  clear() {
    this.index.clear();
    this.events.clear();
  }
}
