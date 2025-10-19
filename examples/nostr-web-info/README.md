# Nostr Web Info Site

A beautiful, informative website about Nostr Web (NIP-YY/ZZ) that showcases the protocol's capabilities.

## Overview

This 3-page website serves as:

- **Educational resource** about Nostr Web protocol
- **Demo showcase** of what's possible with decentralized static sites
- **Default website** (`nweb.shugur.com`) for the Nostr Web browser extension
- **Reference implementation** for developers

## Pages

### 1. Home (`index.html`)

- Hero section with value proposition
- Statistics cards (100% decentralized, 0 hosting fees, ∞ availability)
- Overview of what Nostr Web is
- How it works (3-step process)
- Use cases (journalism, documentation, portfolios, etc.)
- Call-to-action sections

### 2. Features (`features.html`)

- Core features with detailed descriptions
- Feature comparison table (Nostr Web vs traditional hosting)
- Developer experience benefits
- Current limitations (being transparent)
- Visual cards with icons

### 3. Technical (`technical.html`)

- Protocol overview (NIP-YY and NIP-ZZ)
- Event kinds reference table (40000-40003, 34235, 34236)
- Architecture and data flow diagram
- Security model (author verification, SRI, CSP, sandboxing)
- Publisher CLI documentation
- Extension setup and usage
- Advanced topics (multi-page sites, caching strategy)
- FAQ section

## Design System

### Colors

- **White**: `#ffffff` (backgrounds)
- **Light Gray**: `#fafafa` (alternate sections)
- **Black**: `#0a0a0a` (text, buttons)
- **Gray**: `#666666` (secondary text)
- **Border**: `#e0e0e0` (subtle borders)

### Typography

- **Font**: System font stack (-apple-system, BlinkMacSystemFont, Segoe UI, Roboto)
- **Headings**: 700 weight, tight letter-spacing
- **Body**: 400 weight, 1.6 line-height
- **Code**: SF Mono, Monaco, monospace

### Components

- **Cards**: White background, 1px border, 12px radius, hover effects
- **Buttons**: Black primary, white secondary, smooth transitions
- **Navigation**: Sticky header, active link indicators
- **Animations**: Fade-in on scroll, smooth hover states

### Layout

- **Max Width**: 1200px container
- **Grid**: 2-3 column responsive layouts
- **Spacing**: Consistent 1rem/2rem/4rem/6rem scale
- **Mobile**: Single column, hamburger menu, optimized touch targets

## Interactive Features

### JavaScript (`app.js`)

- **Mobile navigation** with animated hamburger menu
- **Smooth scrolling** for anchor links
- **Intersection Observer** for fade-in animations
- **Active nav highlighting** based on scroll position
- **Code block copy** functionality with visual feedback
- **Stat counter animations** on scroll into view
- **External link icons** (↗) added automatically
- **Keyboard navigation** enhancements
- **Lazy loading** images for performance
- **Scroll progress bar** (optional, commented out)
- **Console easter egg** with project info

## File Structure

```text
nostr-web-info/
├── index.html          # Home page
├── features.html       # Features page
├── technical.html      # Technical documentation
├── style.css          # Shared stylesheet
├── app.js             # Interactive features
└── README.md          # This file
```

## Testing Locally

1. **Open in browser:**

   ```bash
   open index.html
   # or
   python3 -m http.server 8000
   # Then visit http://localhost:8000
   ```

2. **Check responsiveness:**

   - Test desktop (1920×1080, 1440×900)
   - Test tablet (768×1024)
   - Test mobile (375×667, 414×896)

3. **Verify features:**
   - Navigation works (smooth scrolling, active states)
   - Mobile menu toggles correctly
   - Code blocks have copy buttons
   - Cards have hover effects
   - Animations trigger on scroll
   - All links work

## Publishing to Nostr

1. **Set up environment:**

   ```bash
   cd ../../publisher
   cp .env.example .env
   # Edit .env with your NOSTR_SK_HEX and RELAYS
   ```

2. **Publish the site:**

   ```bash
   nweb deploy examples/nostr-web-info
   # Or from the example directory
   cd examples/nostr-web-info && nweb deploy .
   ```

3. **Add DNS record:**

   - Copy content from `_nweb.txt.json`
   - Add TXT record at `_nweb.yourdomain.com`
   - Wait for DNS propagation (5-30 minutes)

4. **Test in extension:**
   - Load extension in Chrome
   - Enter your domain in viewer
   - Verify site loads with all styles and scripts

## Setting as Default Website

To make this the default website for new extension users:

1. **Publish to Nostr** (see above)
2. **Update extension settings:**

   ```javascript
   // In extension/shared/constants.js
   const DEFAULT_SITE = "yourdomain.com";
   ```

3. **Test first-run experience:**
   - Clear extension storage
   - Open viewer
   - Verify this site loads automatically

## Performance Optimization

The site is optimized for fast loading:

- **No external dependencies** (no CDN, no jQuery)
- **Inline SVGs** for icons (no icon fonts)
- **Minimal CSS** (~15KB unminified)
- **Minimal JS** (~8KB unminified)
- **Lazy loading** for images
- **Semantic HTML** for accessibility
- **Mobile-first** responsive design

## Accessibility Features

- **Semantic HTML5** elements
- **ARIA labels** on interactive elements
- **Keyboard navigation** support
- **Focus indicators** on interactive elements
- **Reduced motion** media query support
- **High contrast** color ratios (WCAG AA)
- **Alt text** on all images (when added)

## Browser Support

- **Chrome/Edge**: 90+ (full support)
- **Firefox**: 88+ (full support)
- **Safari**: 14+ (full support)
- **Mobile browsers**: iOS Safari 14+, Chrome Android 90+

## Future Enhancements

- [ ] Add hero screenshot/demo video
- [ ] Create custom illustrations for features
- [ ] Add interactive event explorer
- [ ] Include live relay status indicators
- [ ] Add dark mode toggle
- [ ] Implement search functionality
- [ ] Add blog/changelog section
- [ ] Include community showcase
- [ ] Add i18n for multiple languages

## License

MIT License - Same as Nostr Web project

---

**Nostr Web** — Build websites that can't be taken down.
