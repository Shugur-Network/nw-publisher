# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.1] - 2025-10-22

### Fixed

- **Critical:** Fixed site index → manifest reference lookup in `delete-orphans.mjs` (was looking in 'e' tags instead of JSON content)
- **Critical:** Fixed site index → manifest reference lookup in `cleanup-utils.mjs` (was looking in 'e' tags instead of JSON content)
- **Medium:** Fixed manifest → asset reference lookup in `cleanup.mjs` version cleanup (was looking in JSON content instead of 'e' tags)
- **Medium:** Added try-finally blocks to ensure relay connections are properly closed in error scenarios (prevents memory leaks)
- **Medium:** Fixed route extraction in `relay-query.mjs` version history (was looking in tags instead of JSON content)
- **Low:** Fixed version history logic error where current version always defaulted to "0.1.0"

### Changed

- Improved reliability of orphan cleanup functionality
- Enhanced resource cleanup to prevent WebSocket connection leaks

## [1.3.0] - 2025-10-22

### Added

- Initial release with full CLI functionality
- Deploy static sites to Nostr relays
- Version management and tracking
- Relay status monitoring
- Cross-relay synchronization
- Event cleanup tools (full, orphan, and version-specific)
- Smart caching with content-addressed deduplication
- DNS TXT record generation
- Multi-relay publishing with retry logic
