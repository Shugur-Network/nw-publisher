/**
 * Nostr Event Explorer - Interactive Features
 * A functional Nostr event explorer hosted on Nostr Web
 */

// ===== Configuration =====
const CONFIG = {
  relays: [
    "wss://shu01.shugur.com",
    "wss://shu01.shugur.net",
    "wss://relay.damus.io",
    "wss://relay.nostr.band",
    "wss://nos.lol",
    "wss://relay.snort.social",
  ],
  maxCachedEvents: 500, // Total events to keep in cache
  eventsPerPage: 20, // Events to show per page
  reconnectDelay: 3000,
  eventTimeout: 5000, // Reduced timeout for faster response
};

// ===== State Management =====
const state = {
  relays: new Map(),
  events: new Map(), // All cached events
  eventCache: [], // Ordered array for pagination
  subscriptions: new Map(),
  filters: {
    kind: null,
    author: null,
    content: null,
    relay: null,
  },
  view: "list",
  isLive: false,
  pagination: {
    currentPage: 1,
    totalPages: 1,
  },
  stats: {
    eventCount: 0,
    relayCount: 0,
    kindCount: 0,
  },
};

// ===== Utility Functions =====
function truncateText(text, maxLength = 200) {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength) + "...";
}

function formatTimestamp(timestamp) {
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diff = now - date;

  // Less than a minute
  if (diff < 60000) {
    return "Just now";
  }

  // Less than an hour
  if (diff < 3600000) {
    const minutes = Math.floor(diff / 60000);
    return `${minutes}m ago`;
  }

  // Less than a day
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return `${hours}h ago`;
  }

  // Otherwise show date
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

function truncatePubkey(pubkey) {
  if (!pubkey) return "";
  return `${pubkey.substring(0, 8)}...${pubkey.substring(pubkey.length - 8)}`;
}

function getKindName(kind) {
  const kindNames = {
    0: "Metadata",
    1: "Text Note",
    2: "Relay Recommendation",
    3: "Contacts",
    4: "Encrypted DM",
    5: "Event Deletion",
    6: "Repost",
    7: "Reaction",
    8: "Badge Award",
    40: "Channel Creation",
    41: "Channel Metadata",
    42: "Channel Message",
    43: "Channel Hide",
    44: "Channel Mute",
    1063: "File Metadata",
    1984: "Reporting",
    9734: "Zap Request",
    9735: "Zap",
    10000: "Mute List",
    10001: "Pin List",
    10002: "Relay List",
    22242: "Client Auth",
    30000: "Categorized People",
    30001: "Categorized Bookmarks",
    30008: "Profile Badges",
    30009: "Badge Definition",
    30017: "Create/Update Stall",
    30018: "Create/Update Product",
    30023: "Long-form Content",
    30024: "Draft Long-form",
    30078: "App-specific Data",
  };

  return kindNames[kind] || `Kind ${kind}`;
}

function getKindClass(kind) {
  if (kind === 0) return "kind-0";
  if (kind === 1) return "kind-1";
  if (kind === 3) return "kind-3";
  if (kind === 4) return "kind-4";
  if (kind === 5) return "kind-5";
  if (kind === 6) return "kind-6";
  if (kind === 7) return "kind-7";
  if (kind >= 40 && kind <= 44) return "kind-channel";
  return "kind-other";
}

// ===== WebSocket Management =====
function connectToRelay(relayUrl) {
  if (state.relays.has(relayUrl)) {
    return state.relays.get(relayUrl);
  }

  console.log(`[Relay] Connecting to ${relayUrl}`);

  const ws = new WebSocket(relayUrl);
  const relay = {
    ws,
    url: relayUrl,
    connected: false,
    eventCount: 0,
  };

  ws.onopen = () => {
    console.log(`[Relay] Connected to ${relayUrl}`);
    relay.connected = true;
    updateRelayFilter();
  };

  ws.onclose = () => {
    console.log(`[Relay] Disconnected from ${relayUrl}`);
    relay.connected = false;
    state.relays.delete(relayUrl);

    // Attempt to reconnect
    setTimeout(() => {
      if (!state.relays.has(relayUrl)) {
        connectToRelay(relayUrl);
      }
    }, CONFIG.reconnectDelay);
  };

  ws.onerror = (error) => {
    console.error(`[Relay] Error from ${relayUrl}:`, error);
  };

  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      handleRelayMessage(relayUrl, message);
    } catch (error) {
      console.error(`[Relay] Failed to parse message from ${relayUrl}:`, error);
    }
  };

  state.relays.set(relayUrl, relay);
  return relay;
}

function subscribeToEvents(filters, specificRelayUrl = null) {
  const subscriptionId = generateSubscriptionId();

  console.log(
    `[Subscription] Creating subscription ${subscriptionId}`,
    filters,
    specificRelayUrl ? `on ${specificRelayUrl}` : "on all relays"
  );

  state.subscriptions.set(subscriptionId, filters);

  // If specific relay is selected, only query that relay
  if (specificRelayUrl) {
    const relay = state.relays.get(specificRelayUrl);
    if (relay && relay.connected) {
      const reqMessage = JSON.stringify(["REQ", subscriptionId, filters]);
      relay.ws.send(reqMessage);
      console.log(`[Subscription] Sent to ${specificRelayUrl}`);
    }
  } else {
    // Query all connected relays
    state.relays.forEach((relay) => {
      if (relay.connected) {
        const reqMessage = JSON.stringify(["REQ", subscriptionId, filters]);
        relay.ws.send(reqMessage);
      }
    });
  }

  return subscriptionId;
}

function closeSubscription(subscriptionId) {
  console.log(`[Subscription] Closing subscription ${subscriptionId}`);

  state.relays.forEach((relay) => {
    if (relay.connected) {
      const closeMessage = JSON.stringify(["CLOSE", subscriptionId]);
      relay.ws.send(closeMessage);
    }
  });

  state.subscriptions.delete(subscriptionId);
}

function generateSubscriptionId() {
  return "sub_" + Math.random().toString(36).substring(2, 15);
}

function handleRelayMessage(relayUrl, message) {
  const [type, subscriptionId, event] = message;

  if (type === "EVENT") {
    handleEvent(relayUrl, event);
  } else if (type === "EOSE") {
    console.log(`[Relay] End of stored events from ${relayUrl}`);
  } else if (type === "NOTICE") {
    console.log(`[Relay] Notice from ${relayUrl}: ${subscriptionId}`);
  }
}

function handleEvent(relayUrl, event) {
  if (!event || !event.id) return;

  // Apply filters
  if (state.filters.kind && event.kind !== parseInt(state.filters.kind)) {
    return;
  }

  if (state.filters.author && event.pubkey !== state.filters.author) {
    return;
  }

  if (
    state.filters.content &&
    !event.content.toLowerCase().includes(state.filters.content.toLowerCase())
  ) {
    return;
  }

  // Note: Don't filter by relay here if relay filter is set
  // because we already query only that specific relay in subscribeToEvents

  // Add relay info to event
  if (!event.relays) {
    event.relays = [];
  }
  if (!event.relays.includes(relayUrl)) {
    event.relays.push(relayUrl);
  }

  // Store or update event
  const existing = state.events.get(event.id);
  if (existing) {
    // Merge relay lists
    event.relays = [...new Set([...existing.relays, ...event.relays])];
  } else {
    state.stats.eventCount++;
  }

  state.events.set(event.id, event);

  // Update relay stats
  const relay = state.relays.get(relayUrl);
  if (relay) {
    relay.eventCount++;
  }

  // Smart caching: limit total events by removing oldest
  if (state.events.size > CONFIG.maxCachedEvents) {
    // Sort by timestamp and remove oldest
    const sortedEvents = Array.from(state.events.values()).sort(
      (a, b) => b.created_at - a.created_at
    );
    const toRemove = sortedEvents.slice(CONFIG.maxCachedEvents);
    toRemove.forEach((e) => {
      state.events.delete(e.id);
      state.stats.eventCount--;
    });
  }

  updateEventCache();
  renderCurrentPage();
}

// ===== Pagination Functions =====
function updateEventCache() {
  // Update the ordered cache for pagination
  state.eventCache = Array.from(state.events.values()).sort(
    (a, b) => b.created_at - a.created_at
  );

  // Update pagination info
  state.pagination.totalPages = Math.ceil(
    state.eventCache.length / CONFIG.eventsPerPage
  );

  // Ensure current page is valid
  if (state.pagination.currentPage > state.pagination.totalPages) {
    state.pagination.currentPage = Math.max(1, state.pagination.totalPages);
  }
}

function goToPage(page) {
  if (page < 1 || page > state.pagination.totalPages) return;
  state.pagination.currentPage = page;
  renderCurrentPage();
}

function renderCurrentPage() {
  const container = document.getElementById("eventsContainer");
  const loadingState = document.getElementById("loadingState");
  const emptyState = document.getElementById("emptyState");
  const paginationContainer = document.getElementById("paginationContainer");

  if (!container) return;

  if (state.eventCache.length === 0) {
    container.style.display = "none";
    paginationContainer.style.display = "none";
    loadingState.style.display = "none";
    emptyState.style.display = "block";
    return;
  }

  // Calculate pagination
  const startIdx = (state.pagination.currentPage - 1) * CONFIG.eventsPerPage;
  const endIdx = startIdx + CONFIG.eventsPerPage;
  const pageEvents = state.eventCache.slice(startIdx, endIdx);

  // Update container
  container.style.display = state.view === "list" ? "flex" : "grid";
  container.className = state.view === "list" ? "events-list" : "events-cards";
  loadingState.style.display = "none";
  emptyState.style.display = "none";

  // Render events for current page
  container.innerHTML = pageEvents
    .map((event) => {
      const kindClass = getKindClass(event.kind);
      const content = truncateText(event.content, 120);
      const pubkey = truncatePubkey(event.pubkey);
      const time = formatTimestamp(event.created_at);

      return `
        <div class="${state.view === "list" ? "event-item" : "event-card"}" 
             onclick="showEventModal('${event.id}')">
          <div class="event-header">
            <span class="event-kind-badge ${kindClass}">Kind ${
        event.kind
      }</span>
            <span class="event-time">${time}</span>
          </div>
          <div class="event-content">
            ${content || "(No content)"}
          </div>
          <div class="event-footer">
            <span class="event-author">${pubkey}</span>
          </div>
        </div>
      `;
    })
    .join("");

  // Update pagination UI
  if (state.pagination.totalPages > 1) {
    paginationContainer.style.display = "flex";
    document.getElementById("currentPage").textContent =
      state.pagination.currentPage;
    document.getElementById("totalPages").textContent =
      state.pagination.totalPages;

    const prevBtn = document.getElementById("prevPage");
    const nextBtn = document.getElementById("nextPage");

    prevBtn.disabled = state.pagination.currentPage === 1;
    nextBtn.disabled =
      state.pagination.currentPage === state.pagination.totalPages;
  } else {
    paginationContainer.style.display = "none";
  }
}

// ===== UI Updates =====
function updateStats() {
  const connectedRelays = Array.from(state.relays.values()).filter(
    (r) => r.connected
  ).length;
  const uniqueKinds = new Set(
    Array.from(state.events.values()).map((e) => e.kind)
  ).size;

  state.stats.relayCount = connectedRelays;
  state.stats.kindCount = uniqueKinds;

  document.getElementById("eventCount").textContent = state.stats.eventCount;
  document.getElementById("relayCount").textContent = state.stats.relayCount;
  document.getElementById("kindCount").textContent = state.stats.kindCount;
}

function updateRelayFilter() {
  const relayFilter = document.getElementById("relayFilter");
  if (!relayFilter) return;

  // Clear existing options except first
  while (relayFilter.options.length > 1) {
    relayFilter.remove(1);
  }

  // Add connected relays
  state.relays.forEach((relay) => {
    if (relay.connected) {
      const option = document.createElement("option");
      option.value = relay.url;
      option.textContent = relay.url.replace("wss://", "");
      relayFilter.appendChild(option);
    }
  });
}

// Legacy renderEvents - now calls renderCurrentPage
function renderEvents() {
  updateEventCache();
  renderCurrentPage();
}

function showEventModal(eventId) {
  const event = state.events.get(eventId);
  if (!event) return;

  const modal = document.getElementById("eventModal");
  const modalBody = document.getElementById("eventModalBody");

  const kindName = getKindName(event.kind);
  const pubkey = event.pubkey;
  const content = event.content || "(No content)";
  const timestamp = new Date(event.created_at * 1000).toLocaleString();
  const relays = event.relays.join("\n");
  const tags =
    event.tags && event.tags.length > 0
      ? JSON.stringify(event.tags, null, 2)
      : "[]";
  const fullJson = JSON.stringify(event, null, 2);

  modalBody.innerHTML = `
    <div class="event-detail">
      <div class="detail-section">
        <div class="detail-label">Event ID</div>
        <div class="detail-value">${event.id}</div>
      </div>

      <div class="detail-section">
        <div class="detail-label">Kind</div>
        <div class="detail-value">${event.kind} - ${kindName}</div>
      </div>

      <div class="detail-section">
        <div class="detail-label">Author (Public Key)</div>
        <div class="detail-value">${pubkey}</div>
      </div>

      <div class="detail-section">
        <div class="detail-label">Created At</div>
        <div class="detail-value">${timestamp}</div>
      </div>

      <div class="detail-section">
        <div class="detail-label">Content</div>
        <div class="detail-value">${content}</div>
      </div>

      <div class="detail-section">
        <div class="detail-label">Tags</div>
        <div class="detail-value detail-json">${tags}</div>
      </div>

      <div class="detail-section">
        <div class="detail-label">Signature</div>
        <div class="detail-value">${event.sig}</div>
      </div>

      <div class="detail-section">
        <div class="detail-label">Relays</div>
        <div class="detail-value">${relays}</div>
      </div>

      <div class="detail-section">
        <div class="detail-label">Full JSON</div>
        <div class="detail-value detail-json">${fullJson}</div>
      </div>
    </div>
  `;

  modal.style.display = "flex";
}

function closeEventModal() {
  const modal = document.getElementById("eventModal");
  modal.style.display = "none";
}

// ===== Event Handlers =====
function initializeEventHandlers() {
  // Mobile navigation
  const navToggle = document.querySelector(".nav-toggle");
  const navLinks = document.querySelector(".nav-links");

  if (navToggle && navLinks) {
    navToggle.addEventListener("click", () => {
      navLinks.classList.toggle("active");
      const spans = navToggle.querySelectorAll("span");
      spans[0].style.transform = navLinks.classList.contains("active")
        ? "rotate(45deg) translateY(6px)"
        : "none";
      spans[1].style.opacity = navLinks.classList.contains("active")
        ? "0"
        : "1";
      spans[2].style.transform = navLinks.classList.contains("active")
        ? "rotate(-45deg) translateY(-6px)"
        : "none";
    });
  }

  // Search button
  const searchBtn = document.getElementById("searchBtn");
  if (searchBtn) {
    searchBtn.addEventListener("click", handleSearch);
  }

  // Clear filters button
  const clearFiltersBtn = document.getElementById("clearFilters");
  if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener("click", handleClearFilters);
  }

  // Live toggle button
  const liveToggle = document.getElementById("liveToggle");
  if (liveToggle) {
    liveToggle.addEventListener("click", handleLiveToggle);
  }

  // View toggle
  const viewButtons = document.querySelectorAll(".view-btn");
  viewButtons.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const view = e.currentTarget.dataset.view;
      state.view = view;

      viewButtons.forEach((b) => b.classList.remove("active"));
      e.currentTarget.classList.add("active");

      renderCurrentPage();
    });
  });

  // Pagination buttons
  const prevPageBtn = document.getElementById("prevPage");
  const nextPageBtn = document.getElementById("nextPage");

  if (prevPageBtn) {
    prevPageBtn.addEventListener("click", () => {
      goToPage(state.pagination.currentPage - 1);
    });
  }

  if (nextPageBtn) {
    nextPageBtn.addEventListener("click", () => {
      goToPage(state.pagination.currentPage + 1);
    });
  }

  // Modal close
  const modalClose = document.querySelector(".modal-close");
  const modalOverlay = document.querySelector(".modal-overlay");

  if (modalClose) {
    modalClose.addEventListener("click", closeEventModal);
  }

  if (modalOverlay) {
    modalOverlay.addEventListener("click", closeEventModal);
  }

  // Escape key to close modal
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeEventModal();
    }
  });
}

function handleSearch() {
  // Get filter values
  const kindFilter = document.getElementById("kindFilter").value;
  const authorFilter = document.getElementById("authorFilter").value.trim();
  const contentFilter = document.getElementById("contentFilter").value.trim();
  const relayFilter = document.getElementById("relayFilter").value;

  // Update state filters
  state.filters.kind = kindFilter || null;
  state.filters.author = authorFilter || null;
  state.filters.content = contentFilter || null;
  state.filters.relay = relayFilter || null;

  // Clear existing events and reset pagination
  state.events.clear();
  state.eventCache = [];
  state.pagination.currentPage = 1;
  state.pagination.totalPages = 1;
  state.stats.eventCount = 0;

  // Close existing subscriptions
  state.subscriptions.forEach((_, id) => closeSubscription(id));

  // Create new subscription with filters
  const filters = {
    limit: 100, // Increased limit for faster loading
  };

  if (state.filters.kind) {
    filters.kinds = [parseInt(state.filters.kind)];
  }

  if (state.filters.author) {
    filters.authors = [state.filters.author];
  }

  // Query specific relay if selected, otherwise query all
  subscribeToEvents(filters, state.filters.relay);

  // Show loading state
  const loadingState = document.getElementById("loadingState");
  loadingState.style.display = "block";

  // Hide after timeout if no events
  setTimeout(() => {
    if (state.events.size === 0) {
      loadingState.style.display = "none";
      const emptyState = document.getElementById("emptyState");
      emptyState.innerHTML = `
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
        </svg>
        <h3>No events found</h3>
        <p>Try adjusting your search filters or wait for new events.</p>
      `;
      emptyState.style.display = "block";
    } else {
      loadingState.style.display = "none";
    }
  }, CONFIG.eventTimeout);
}

function handleClearFilters() {
  // Reset filter inputs
  document.getElementById("kindFilter").value = "";
  document.getElementById("authorFilter").value = "";
  document.getElementById("contentFilter").value = "";
  document.getElementById("relayFilter").value = "";

  // Reset state filters
  state.filters = {
    kind: null,
    author: null,
    content: null,
    relay: null,
  };

  // Trigger new search
  handleSearch();
}

function handleLiveToggle() {
  const liveToggle = document.getElementById("liveToggle");
  state.isLive = !state.isLive;

  if (state.isLive) {
    liveToggle.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="6" y="4" width="4" height="16" />
        <rect x="14" y="4" width="4" height="16" />
      </svg>
      Stop Live Feed
    `;
    liveToggle.classList.add("btn-primary");
    liveToggle.classList.remove("btn-secondary");

    // Start live subscription with current search criteria
    const filters = {
      limit: 100,
    };

    if (state.filters.kind) {
      filters.kinds = [parseInt(state.filters.kind)];
    }

    if (state.filters.author) {
      filters.authors = [state.filters.author];
    }

    // Use current relay filter if set
    subscribeToEvents(filters, state.filters.relay);
  } else {
    liveToggle.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
      Start Live Feed
    `;
    liveToggle.classList.remove("btn-primary");
    liveToggle.classList.add("btn-secondary");

    // Stop subscriptions
    state.subscriptions.forEach((_, id) => closeSubscription(id));
  }
}

// ===== Animations =====
function initializeAnimations() {
  const observerOptions = {
    threshold: 0.1,
    rootMargin: "0px 0px -50px 0px",
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = "1";
        entry.target.style.transform = "translateY(0)";
      }
    });
  }, observerOptions);

  document.querySelectorAll(".fade-in-up").forEach((el) => {
    el.style.opacity = "0";
    el.style.transform = "translateY(30px)";
    el.style.transition = "opacity 0.8s ease, transform 0.8s ease";
    observer.observe(el);
  });
}

// ===== Initialization =====
function initialize() {
  console.log("[App] Initializing Nostr Event Explorer...");

  // Initialize event handlers
  initializeEventHandlers();

  // Initialize animations
  initializeAnimations();

  // Connect to relays
  CONFIG.relays.forEach((relayUrl) => {
    connectToRelay(relayUrl);
  });

  // Wait for user to click search button - don't auto-load events
  console.log("[App] Ready - Click 'Search Events' to load events");

  console.log("[App] Initialization complete");
}

// Make showEventModal available globally
window.showEventModal = showEventModal;

// Start the app when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialize);
} else {
  initialize();
}
