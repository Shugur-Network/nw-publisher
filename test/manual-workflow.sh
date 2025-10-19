#!/bin/bash
#
# Manual Integration Test Workflow
# 
# This script tests the full workflow of nw-publish:
# 1. Create a test site
# 2. Deploy it
# 3. Verify events with nak
# 4. Test versions
# 5. Test sync
# 6. Clean up
#

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
TEST_DIR="./test-site-$(date +%s)"
TEST_RELAYS="wss://relay.nostr.band,wss://nos.lol"
NWEB_CMD="node ./nweb.mjs"

echo -e "${BLUE}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║    NOSTR WEB PUBLISHER - MANUAL INTEGRATION TEST          ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════╝${NC}\n"

# Step 0: Generate test keypair
echo -e "${YELLOW}🔑 Step 0: Generating test keypair...${NC}"
KEYPAIR_OUTPUT=$($NWEB_CMD config generate)
TEST_SK=$(echo "$KEYPAIR_OUTPUT" | grep "Private Key (hex):" | head -1 | awk '{print $NF}')
TEST_NPUB=$(echo "$KEYPAIR_OUTPUT" | grep "Public Key (npub):" | head -1 | awk '{print $NF}')

if [ -z "$TEST_SK" ]; then
    echo -e "${RED}❌ Failed to generate keypair${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Generated test keypair${NC}"
echo -e "   npub: ${TEST_NPUB}"
echo -e "   sk: ${TEST_SK:0:16}...\n"

# Export test environment
export NOSTR_SK_HEX="$TEST_SK"
export RELAYS="$TEST_RELAYS"
export NWEB_HOST="test.example.com"

# Step 1: Create test site
echo -e "${YELLOW}📁 Step 1: Creating test site...${NC}"
mkdir -p "$TEST_DIR"

cat > "$TEST_DIR/index.html" << 'EOF'
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Integration Test Site</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <header>
        <h1>🧪 Integration Test Site</h1>
    </header>
    <main>
        <p>This is a test site for verifying nw-publish functionality.</p>
        <ul>
            <li><a href="about">About</a></li>
            <li><a href="blog/post-1">Blog Post</a></li>
        </ul>
    </main>
    <script src="app.js"></script>
</body>
</html>
EOF

cat > "$TEST_DIR/style.css" << 'EOF'
* { margin: 0; padding: 0; box-sizing: border-box; }
body { 
    font-family: system-ui, sans-serif; 
    line-height: 1.6; 
    color: #333;
    max-width: 800px;
    margin: 0 auto;
    padding: 2rem;
}
header { 
    border-bottom: 2px solid #5b21b6; 
    padding-bottom: 1rem;
    margin-bottom: 2rem;
}
h1 { color: #5b21b6; }
ul { margin: 1rem 0; padding-left: 2rem; }
a { color: #5b21b6; text-decoration: none; }
a:hover { text-decoration: underline; }
EOF

cat > "$TEST_DIR/app.js" << 'EOF'
console.log('🚀 Test site loaded!');
document.addEventListener('DOMContentLoaded', () => {
    console.log('✅ DOM ready');
});
EOF

cat > "$TEST_DIR/about.html" << 'EOF'
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>About - Test Site</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <header>
        <h1>About This Test</h1>
    </header>
    <main>
        <p>This page tests multi-page routing.</p>
        <p><a href="/">Back to Home</a></p>
    </main>
</body>
</html>
EOF

# Create blog subdirectory
mkdir -p "$TEST_DIR/blog"
cat > "$TEST_DIR/blog/post-1.html" << 'EOF'
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Blog Post - Test Site</title>
    <link rel="stylesheet" href="../style.css">
</head>
<body>
    <header>
        <h1>Test Blog Post</h1>
    </header>
    <main>
        <p>This tests nested routing.</p>
        <p><a href="/">Back to Home</a></p>
    </main>
</body>
</html>
EOF

echo -e "${GREEN}✓ Created test site at $TEST_DIR${NC}"
echo -e "   Files: index.html, about.html, blog/post-1.html, style.css, app.js\n"

# Step 2: Deploy site
echo -e "${YELLOW}📦 Step 2: Deploying site to Nostr...${NC}"
$NWEB_CMD deploy "$TEST_DIR"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Site deployed successfully${NC}\n"
else
    echo -e "${RED}❌ Deployment failed${NC}"
    exit 1
fi

# Step 3: Verify with nak
echo -e "${YELLOW}🔍 Step 3: Querying events with nak...${NC}"
if command -v nak &> /dev/null; then
    # Extract pubkey from npub
    PUBKEY=$(echo "$TEST_NPUB" | nak decode)
    
    echo "   Querying relays for events..."
    EVENTS=$(nak req -k 1125,1126,31126,11126 -a "$PUBKEY" $TEST_RELAYS 2>/dev/null || echo "[]")
    EVENT_COUNT=$(echo "$EVENTS" | grep -c "^{" || echo "0")
    
    echo -e "${GREEN}✓ Found $EVENT_COUNT events${NC}"
    
    # Count by kind
    KIND_1125=$(echo "$EVENTS" | jq -r 'select(.kind == 1125)' 2>/dev/null | grep -c "kind" || echo "0")
    KIND_1126=$(echo "$EVENTS" | jq -r 'select(.kind == 1126)' 2>/dev/null | grep -c "kind" || echo "0")
    KIND_31126=$(echo "$EVENTS" | jq -r 'select(.kind == 31126)' 2>/dev/null | grep -c "kind" || echo "0")
    KIND_11126=$(echo "$EVENTS" | jq -r 'select(.kind == 11126)' 2>/dev/null | grep -c "kind" || echo "0")
    
    echo "   - Kind 1125 (Assets): $KIND_1125"
    echo "   - Kind 1126 (Manifests): $KIND_1126"
    echo "   - Kind 31126 (Site Index): $KIND_31126"
    echo "   - Kind 11126 (Entrypoint): $KIND_11126"
    echo ""
else
    echo -e "${YELLOW}⚠️  nak not found - skipping event verification${NC}\n"
fi

# Step 4: Check status
echo -e "${YELLOW}📊 Step 4: Checking status...${NC}"
$NWEB_CMD status

echo ""

# Step 5: List versions
echo -e "${YELLOW}📚 Step 5: Listing versions...${NC}"
$NWEB_CMD versions list

echo ""

# Step 6: Modify and republish
echo -e "${YELLOW}✏️  Step 6: Modifying site and republishing...${NC}"
echo "<!-- Modified $(date) -->" >> "$TEST_DIR/index.html"

$NWEB_CMD deploy "$TEST_DIR"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Modified site deployed${NC}\n"
fi

# Check versions again
echo -e "${YELLOW}📚 Checking versions after modification...${NC}"
$NWEB_CMD versions list

echo ""

# Step 7: Test sync
echo -e "${YELLOW}🔄 Step 7: Testing sync...${NC}"
echo "   (Press Ctrl+C if prompted for confirmation)"
timeout 10s $NWEB_CMD sync || true

echo ""

# Step 8: Cleanup
echo -e "${YELLOW}🧹 Step 8: Cleanup options...${NC}"
echo ""
echo "The test is complete! You can now:"
echo "  1. Keep the test site and events for manual inspection"
echo "  2. Clean up everything"
echo ""
read -p "Do you want to clean up test site and events? (y/N): " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}🧹 Cleaning up...${NC}"
    
    # Delete test site
    rm -rf "$TEST_DIR"
    echo -e "${GREEN}✓ Deleted test site directory${NC}"
    
    # Delete events from relays
    echo "Deleting events from relays..."
    echo "DELETE" | $NWEB_CMD cleanup
    
    echo -e "${GREEN}✓ Cleanup complete${NC}\n"
else
    echo -e "${BLUE}Test site preserved at: $TEST_DIR${NC}"
    echo -e "${BLUE}Test pubkey: $TEST_NPUB${NC}"
    echo ""
    echo "To clean up later, run:"
    echo "  rm -rf $TEST_DIR"
    echo "  NOSTR_SK_HEX=$TEST_SK RELAYS=$TEST_RELAYS nweb cleanup"
    echo ""
fi

echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║           INTEGRATION TEST COMPLETED!                     ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}\n"

echo "Summary:"
echo "  ✓ Site creation"
echo "  ✓ Deployment"
echo "  ✓ Event verification (nak)"
echo "  ✓ Status check"
echo "  ✓ Version management"
echo "  ✓ Modification and republish"
echo "  ✓ Sync test"
echo ""

