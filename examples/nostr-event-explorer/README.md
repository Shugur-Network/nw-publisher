# Nostr Event Explorer

A fully functional, decentralized web application for exploring events on the Nostr protocol. Built to demonstrate the capabilities of Nostr Web - hosting complete applications on Nostr relays.

## Overview

The Nostr Event Explorer is a real-time event browser that connects to multiple Nostr relays, allowing users to search, filter, and inspect events from the Nostr network. What makes it special is that the entire application is hosted on Nostr Web, with no traditional servers required.

## Features

### 🔍 Real-time Event Search

- Connect to multiple Nostr relays simultaneously
- Search and filter events by:
  - Event kind (metadata, text notes, reactions, etc.)
  - Author (public key or npub)
  - Content (full-text search)
  - Relay source

### ⚡ Live Feed

- Subscribe to real-time event streams
- Watch new events appear as they're published
- See the Nostr protocol in action

### 📊 Detailed Event Inspection

- View full event JSON structure
- Inspect signatures, tags, and metadata
- See which relays have the event
- Copy event data for analysis

### 🎨 Multiple Views

- **List View**: Compact list of events
- **Card View**: Grid layout with visual cards
- Responsive design works on all devices

### 📈 Real-time Statistics

- Events loaded count
- Active relay connections
- Unique event kinds discovered

## Technical Details

### Technology Stack

- **Vanilla JavaScript**: No frameworks, no build tools, just pure JS
- **WebSocket API**: Direct connections to Nostr relays
- **CSS Grid/Flexbox**: Modern, responsive layout
- **Nostr Protocol**: Native implementation of NIPs 01, 02

### Nostr Implementation

The app implements core Nostr protocol features:

- **REQ messages**: Subscribe to events with filters
- **EVENT messages**: Receive and process events
- **CLOSE messages**: Unsubscribe from feeds
- **Multiple relay support**: Parallel connections to relays
- **Event deduplication**: Handle same event from multiple relays

### Event Kinds Supported

The explorer recognizes and displays:

- **0** - Metadata (set profile info)
- **1** - Text Note (short-form posts)
- **3** - Contacts (follow lists)
- **4** - Encrypted DM
- **5** - Event Deletion
- **6** - Repost
- **7** - Reaction (likes)
- **40-44** - Channel events
- **30023** - Long-form Content
- **And more...**

### Design Pattern

This application follows the design patterns established by the `nostr-web-info` example:

- **Clean, minimal design** inspired by capsules.shugur.com
- **Consistent typography** and spacing
- **Smooth animations** and transitions
- **Accessible UI** with keyboard navigation
- **Mobile-first** responsive design

## File Structure

```
nostr-event-explorer/
├── index.html          # Main explorer page
├── about.html          # About page
├── style.css          # Shared stylesheet
├── app.js             # Core Nostr functionality
└── README.md          # This file
```

## Usage

### Testing Locally

1. **Open in browser:**

   ```bash
   open index.html
   # or start a local server
   python3 -m http.server 8000
   # Then visit http://localhost:8000
   ```

2. **Use the explorer:**
   - Wait for relays to connect (stats will update)
   - Use filters to search for specific events
   - Click "Start Live Feed" for real-time events
   - Click any event to see full details

### Publishing to Nostr Web

1. **Set up environment:**

   ```bash
   cd ../..
   cp .env.example .env
   # Edit .env with your NOSTR_SK_HEX and RELAYS
   ```

2. **Publish the site:**

   ```bash
   nw-publisher publish examples/nostr-event-explorer
   ```

3. **Add DNS record:**

   - Copy the generated DNS TXT record
   - Add it to `_nweb.yourdomain.com`
   - Wait for DNS propagation

4. **Access via Nostr Web:**
   - Use the Nostr Web browser extension
   - Navigate to your domain
   - The app loads from Nostr relays!

## How It Works

### 1. Relay Connection

On startup, the app connects to multiple popular Nostr relays via WebSocket:

```javascript
const CONFIG = {
  relays: [
    "wss://shu01.shugur.net",
    "wss://relay.damus.io",
    "wss://relay.nostr.band",
    "wss://nos.lol",
    "wss://relay.snort.social",
    "wss://nostr.wine",
  ],
};
```

### 2. Event Subscription

The app sends REQ messages to subscribe to events:

```javascript
["REQ", <subscription_id>, <filters>]
```

Filters can specify:

- Event kinds
- Authors
- Time ranges
- Content patterns

### 3. Event Processing

When relays respond with EVENT messages:

```javascript
["EVENT", <subscription_id>, <event>]
```

The app:

- Validates the event structure
- Applies client-side filters
- Deduplicates across relays
- Updates the UI in real-time

### 4. UI Rendering

Events are displayed with:

- Event kind badge (color-coded)
- Timestamp (relative or absolute)
- Content preview (truncated)
- Author pubkey (truncated)
- Tag count and relay count

## Use Cases

### For Developers

- **Learn Nostr**: See events in their raw form
- **Debug clients**: Verify your app publishes correctly
- **Test relays**: Check which relays accept your events

### For Users

- **Content discovery**: Find specific posts or users
- **Network monitoring**: Watch Nostr activity in real-time
- **Event inspection**: Verify signatures and authenticity

### For the Ecosystem

- **Nostr Web demo**: Shows what's possible with decentralized hosting
- **Reference implementation**: Example of Nostr protocol integration
- **Educational tool**: Help newcomers understand Nostr

## Features to Try

1. **Search by kind**: Filter for specific event types (kind 1 for text notes)
2. **Live feed**: Watch events stream in real-time
3. **Event details**: Click any event to see full JSON
4. **Author search**: Enter a pubkey to see all events from that user
5. **Content search**: Find events containing specific words
6. **Relay filter**: See events from a specific relay

## Performance

The app is optimized for real-time use:

- **Event limiting**: Maximum 100 events in memory
- **Efficient rendering**: Only updates changed elements
- **Relay pooling**: Parallel connections for speed
- **Lazy evaluation**: Filters applied before rendering

## Browser Support

- **Chrome/Edge**: 90+ (full support)
- **Firefox**: 88+ (full support)
- **Safari**: 14+ (full support)
- **Mobile**: iOS Safari 14+, Chrome Android 90+

## Known Limitations

1. **No event verification**: Signatures are displayed but not cryptographically verified
2. **Limited history**: Only stores most recent 100 events
3. **Client-side filtering**: Content search happens after fetching
4. **No persistence**: Events cleared on page reload

## Future Enhancements

- [ ] Event signature verification
- [ ] Export events as JSON
- [ ] Bookmark/save events
- [ ] Author profile resolution (kind 0)
- [ ] Event threading (replies/quotes)
- [ ] Advanced filter builder
- [ ] Custom relay configuration
- [ ] Event statistics/analytics
- [ ] Dark mode toggle

## Contributing

This is an open-source example application. Feel free to:

- Fork and modify for your needs
- Submit improvements or bug fixes
- Use as a template for your own Nostr apps
- Learn from the implementation

## License

MIT License - Same as the Nostr Web project

## Resources

- **Nostr Protocol**: https://github.com/nostr-protocol/nips
- **Nostr Web Docs**: https://docs.shugur.com/nostr-web
- **NIP-01**: Basic protocol flow
- **NIP-02**: Contact list and petnames

---

**Built with ❤️ for the Nostr ecosystem**

_Demonstrating that powerful, decentralized web applications can be built without traditional hosting infrastructure._
