# Hello World Example

A minimal Nostr Web site demonstrating the basic structure and publishing workflow.

## Structure

```
hello-world/
├── index.html      # Main page
├── style.css       # Styles
└── app.js          # JavaScript
```

## Features

- Single-page static site
- Responsive design
- Simple navigation
- CSS and JavaScript assets

## Publishing

To publish this site to Nostr:

```bash
# From the repository root
nw-publisher deploy examples/hello-world

# Or from this directory
cd examples/hello-world
nw-publisher deploy .
```

This will:

1. Convert files to Nostr events (kinds 40000-40003, 34235, 34236)
2. Publish to configured relays
3. Generate DNS TXT record JSON

## Configuration

Set environment variables in `publisher/.env`:

```env
NOSTR_SK_HEX=<your-hex-private-key>
RELAYS=wss://relay.damus.io,wss://nos.lol
NWEB_HOST=example.com
```

## DNS Setup

Add the generated `_nweb.txt.json` content to your DNS:

```
_nweb.example.com  TXT  "<json-content>"
```

## Testing

1. **Install the Nostr Web Browser extension**
   - Chrome: https://chromewebstore.google.com/detail/nostr-web-browser/hhdngjdmlabdachflbdfapkogadodkif
   - Firefox: https://addons.mozilla.org/en-US/firefox/addon/nostr-web-browser/
2. Navigate to your domain
3. Extension detects `_nweb.<domain>` record
4. Site loads from Nostr relays

---

For more information, see the [Publisher README](../../publisher/README.md).
