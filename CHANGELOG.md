# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2024-01-XX

### Added

- **Test infrastructure**: Comprehensive test suite with 14 passing tests
  - CLI smoke tests for all core commands
  - Utility unit tests for relay parsing functions
  - Node.js built-in test runner integration
  - npm test scripts with watch and coverage modes
- **CI/CD**: GitHub Actions workflow for automated testing
  - Tests run on Node.js 18.x, 20.x, and 22.x
  - Automated verification on push and pull requests
  - CI status badge in README

### Changed

- **Code cleanup**: Removed ~150 lines of incomplete/stub code
  - Removed incomplete command definitions from COMMANDS object
  - Removed dead switch case routing
  - Cleaned up stub handler functions

### Removed

- **Incomplete commands**: Removed references to unimplemented features
  - `nweb dns` - DNS management commands (coming in future release)
  - `nweb dev` - Local development server (coming in future release)
  - `nweb validate` - Site validation (coming in future release)
  - `nweb logs` - Deployment logs (coming in future release)
  - `nweb stats` - Site analytics (coming in future release)
- **Documentation**: Updated CLI-GUIDE.md and help text to reflect current command set

### Fixed

- Improved error handling and exit codes
- Better timeout handling for network-dependent operations

## [1.1.0] - Previous Release

### Added

- Modular architecture with src/lib/, src/utils/, src/commands/
- Complete refactoring of CLI codebase
- Improved relay management
- Version control features
- Sync and cleanup commands
- Status checking functionality

## [1.0.0] - Initial Release

### Added

- Basic static site publishing to Nostr
- Content-addressed assets with SHA256
- Multi-relay support
- DNS TXT record generation
- Cache management

---

## Roadmap

Future releases will add back the following features:

- **DNS Management** (`nweb dns`)
  - Verify DNS configuration
  - Automated DNS record generation
- **Development Tools** (`nweb dev`)
  - Local development server
  - Live reload functionality
  - Hot module replacement
- **Site Validation** (`nweb validate`)
  - Structure validation
  - Size checks
  - Configuration validation
- **Monitoring** (`nweb logs`, `nweb stats`)
  - Deployment logs
  - Site analytics
  - Traffic monitoring

[1.2.0]: https://github.com/Shugur-Network/nw-publisher/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/Shugur-Network/nw-publisher/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Shugur-Network/nw-publisher/releases/tag/v1.0.0
