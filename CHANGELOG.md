# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.4] - 2025-10-22

### Changed

- **Major:** Completely rewrote sync command with 6-step bottom-up synchronization architecture
  - **Step A:** Analyze entrypoints - Finds newest entrypoint across all relays and extracts target site index d-tag
  - **Step B:** Analyze versions - Maps all versions to their site indexes across relays (version series tracking)
  - **Step C:** Check completeness - Verifies each version has complete resources (assets + manifests + site index)
  - **Step D:** Identify source relays - Nominates source relay for each complete version
  - **Step E & F:** Build sync plan - Creates deletion and sync plans:
    - Deletes orphaned versions (no complete source)
    - Deletes incomplete versions (missing assets/manifests)
    - Deletes old entrypoints (using kind 5 deletion events)
    - Syncs complete versions bottom-up: assets → manifests → site indexes → entrypoints
    - Updates entrypoints to point to newest version
  - Events are now matched by semantic content (content hash, d-tag) not event ID
  - Proper handling of addressable events (31126 site indexes with d-tags)
  - Proper handling of replaceable events (11126 entrypoints)
  - Comprehensive sync plan display showing deletions and syncs per relay
  - Progress indicators for deletion and publication operations

### Added

- `createDeletionEvent()` import for proper kind 5 deletion events
- `displaySyncPlan()` - Shows detailed sync plan before execution
- `executeSyncPlan()` - Executes sync plan with proper deletion-before-publish ordering
- `analyzeEntrypoints()` - Step A implementation
- `analyzeSiteIndexVersions()` - Step B implementation  
- `analyzeVersionCompleteness()` - Step C implementation
- `identifySourceRelays()` - Step D implementation
- `buildSyncPlan()` - Steps E & F implementation
- Version series tracking across relays (e.g., 0.1.0, 0.1.2, 0.3.0, 1.0.0)

### Fixed

- Sync no longer incorrectly reports missing entrypoints when different event IDs point to same content
- Sync correctly handles replaceable events and explicitly deletes old ones before publishing new
- Sync correctly identifies latest version even if different relays have different timestamps
- Updated `createEntrypointEvent()` to include relay hint as third element in `a` tag (required by relay validation)
- Proper content-based deduplication for assets (by x-tag) and manifests (by d-tag)

## [1.3.3] - 2025-10-22

### Fixed

- **Critical:** Fixed global npm package working directory issue
  - Changed `nw-publisher.mjs` to use `process.cwd()` instead of `__dirname` when spawning command scripts
  - This ensures commands run in the user's current directory, not the package installation directory
  - Resolves the root cause of `.env` file not being found when running as global package
  - Now properly loads environment variables from the user's working directory

## [1.3.2] - 2025-10-22

### Fixed

- **Critical:** Fixed dotenv not loading `.env` file when running as global npm package
  - Updated all commands to explicitly load `.env` from current working directory
  - Affects: cleanup, delete-orphans, status, sync, versions, publish commands
  - Users can now run `nw-publisher` globally without environment variable issues

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
