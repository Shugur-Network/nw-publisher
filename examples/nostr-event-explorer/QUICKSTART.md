# Quick Start Guide - Nostr Event Explorer

## What is this?

A fully functional Nostr event explorer web app that demonstrates the power of Nostr Web. It connects to real Nostr relays, fetches events in real-time, and allows users to search, filter, and inspect events from the network.

## Quick Start

### 1. Test Locally

```bash
# Navigate to the example
cd examples/nostr-event-explorer

# Open in browser
open index.html

# Or use a local server
python3 -m http.server 8000
# Visit http://localhost:8000
```

### 2. How to Use

1. **Wait for connections**: The app will connect to 5 Nostr relays
2. **See statistics update**: Event count, relay count, and kind count
3. **Search events**: Use filters to find specific events
4. **Click events**: View full event details including JSON
5. **Try live feed**: Click "Start Live Feed" for real-time events

### 3. Publish to Nostr Web

```bash
# From the nw-publisher root directory
nw-publisher publish examples/nostr-event-explorer

# Follow prompts to add DNS record
# Access via Nostr Web browser extension
```

## Files Created

- `index.html` - Main explorer interface
- `about.html` - About page explaining the app
- `style.css` - Complete styling (matching nostr-web-info design)
- `app.js` - Full Nostr WebSocket implementation
- `README.md` - Comprehensive documentation

## Key Features

✅ **Real WebSocket connections** to Nostr relays
✅ **Live event streaming** with filters
✅ **Event search** by kind, author, content
✅ **Detailed inspection** with full JSON view
✅ **Multiple views** (list and cards)
✅ **Responsive design** for all devices
✅ **Clean UI** matching nostr-web-info patterns
✅ **No dependencies** - pure vanilla JS

## Design Patterns Used

This app strictly follows the nostr-web-info design patterns:

- Same CSS variables and color scheme
- Identical navigation and footer
- Consistent typography and spacing
- Similar animations and transitions
- Mobile-first responsive approach
- Clean, minimal aesthetic

## What Makes It Special

1. **Fully functional**: Not just a demo, it actually works!
2. **Real Nostr integration**: Connects to live relays via WebSocket
3. **Educational**: Great for learning how Nostr works
4. **Decentralized hosting**: Entire app hosted on Nostr Web
5. **No servers needed**: Zero hosting infrastructure

## Try These Features

1. Filter for **kind 1** events to see text notes (posts)
2. Click **"Start Live Feed"** to watch events stream in
3. Click any event to see **full JSON structure**
4. Search for a specific **pubkey** to see their events
5. Try **content search** to find specific words

## Technical Highlights

- **Vanilla JavaScript**: No frameworks or build tools
- **WebSocket API**: Direct relay connections
- **Event deduplication**: Handles same event from multiple relays
- **Real-time UI updates**: Efficient rendering
- **Nostr protocol**: Implements NIPs 01, 02 correctly

---

**This is a complete, working example of what's possible with Nostr Web!**
