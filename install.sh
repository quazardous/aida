#!/bin/bash
#
# AIDA - Artistic Intelligence & Direction for Agents
# Standalone installer (copies files into target project)
#
# Usage:
#   curl -sSL https://raw.githubusercontent.com/quazardous/aida/main/install.sh | bash
#   curl -sSL .../install.sh | bash -s -- --profile=split
#

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

REPO_RAW="https://raw.githubusercontent.com/quazardous/aida/main"

# Defaults
PROFILE="default"
DRY_RUN=false
RESET=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --profile=*) PROFILE="${1#*=}"; shift ;;
    --dry-run)   DRY_RUN=true; shift ;;
    --reset)     RESET=true; shift ;;
    *) echo -e "${RED}Unknown option: $1${NC}"; exit 1 ;;
  esac
done

echo -e "${BLUE}Installing AIDA (profile: $PROFILE)...${NC}"

# --- Helpers ---
do_mkdir() {
  if [ "$DRY_RUN" = true ]; then
    [ ! -d "$1" ] && echo "  Would create: $1"
  else
    mkdir -p "$1"
  fi
}

do_cp_protected() {
  local src="$1" dest="$2"
  if [ -f "$dest" ] && [ "$RESET" != true ]; then
    echo -e "  ${YELLOW}Preserved: $dest${NC}"
    return
  fi
  if [ "$DRY_RUN" = true ]; then
    echo "  Would copy: $dest"
  else
    curl -sSL "$src" > "$dest"
    echo -e "  ${GREEN}Created: $dest${NC}"
  fi
}

do_cp() {
  local src="$1" dest="$2"
  if [ "$DRY_RUN" = true ]; then
    echo "  Would copy: $dest"
  else
    curl -sSL "$src" > "$dest"
    echo -e "  ${GREEN}Created: $dest${NC}"
  fi
}

# --- Create directories ---
echo -e "${BLUE}Creating directories...${NC}"
do_mkdir .aida/tree/_root/variations
do_mkdir .aida/axes
do_mkdir .aida/engine/workflows
do_mkdir .aida/reviews
do_mkdir .aida/snapshots
do_mkdir .aida/references
do_mkdir .aida/generated
do_mkdir .claude/skills/aida
do_mkdir .claude/commands/art

# --- Config (protected — not overwritten unless --reset) ---
echo -e "${BLUE}Installing config...${NC}"
do_cp_protected "$REPO_RAW/templates/config.yaml" ".aida/config.yaml"

# --- Axes (always updated) ---
echo -e "${BLUE}Installing axes...${NC}"
do_cp "$REPO_RAW/axes/universal.yaml" ".aida/axes/universal.yaml"

# --- Skill & commands (always updated) ---
echo -e "${BLUE}Installing skill & commands...${NC}"
do_cp "$REPO_RAW/skill/aida.md" ".claude/skills/aida/aida.md"
# do_cp "$REPO_RAW/commands/art/..." ".claude/commands/art/..."

# --- MCP server ---
echo -e "${BLUE}Installing MCP server...${NC}"
do_cp "$REPO_RAW/mcp/aida-server.js" ".aida/aida-server.js"

# --- MCP registration ---
echo -e "${BLUE}Registering MCP server...${NC}"
if [ "$DRY_RUN" != true ]; then
  MCP_FILE=".claude/mcp.json"
  SERVER_PATH="$(pwd)/.aida/aida-server.js"
  if [ -f "$MCP_FILE" ]; then
    # Merge if aida-tree not already registered
    if ! grep -q '"aida-tree"' "$MCP_FILE" 2>/dev/null; then
      # Merge only aida-tree key — preserves all existing MCP servers
      node -e "
        const fs = require('fs');
        let existing;
        try { existing = JSON.parse(fs.readFileSync('$MCP_FILE', 'utf-8')); }
        catch(e) { console.error('Cannot parse $MCP_FILE:', e.message); process.exit(1); }
        if (!existing.mcpServers) existing.mcpServers = {};
        existing.mcpServers['aida-tree'] = { command: 'node', args: ['$SERVER_PATH'] };
        fs.writeFileSync('$MCP_FILE', JSON.stringify(existing, null, 2) + '\n');
      " && echo -e "  ${GREEN}Merged aida-tree into $MCP_FILE (existing servers preserved)${NC}" \
        || echo -e "  ${RED}Failed to merge — edit $MCP_FILE manually${NC}"
    else
      echo -e "  ${YELLOW}aida-tree already registered${NC}"
    fi
  else
    cat > "$MCP_FILE" << MCPEOF
{
  "mcpServers": {
    "aida-tree": {
      "command": "node",
      "args": ["$SERVER_PATH"]
    }
  }
}
MCPEOF
    echo -e "  ${GREEN}Created $MCP_FILE${NC}"
  fi
fi

# --- Apply profile to config ---
if [ "$DRY_RUN" != true ] && [ -f .aida/config.yaml ]; then
  sed -i "s/^paths_profile:.*/paths_profile: $PROFILE/" .aida/config.yaml
fi

# --- .gitignore additions ---
if [ "$DRY_RUN" != true ]; then
  for pattern in ".aida/aida.db" ".aida/generated/" ".aida/engine/loras/" ".aida/engine/embeddings/" ".aida/state.json"; do
    grep -qxF "$pattern" .gitignore 2>/dev/null || echo "$pattern" >> .gitignore
  done
  echo -e "  ${GREEN}Updated .gitignore${NC}"
fi

echo ""
echo -e "${GREEN}AIDA installed!${NC}"
echo -e "  Profile: $PROFILE"
echo -e "  Config: .aida/config.yaml"
echo -e "  Run: claude → /art:status"
