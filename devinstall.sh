#!/bin/bash
#
# AIDA Dev Install - Symlink mode from AIDA repo
#
# Usage: /path/to/aida/devinstall.sh [options]
#        Run from target project directory
#
# Creates symlinks to the aida repo — changes reflected immediately.
# For standalone installation, use install.sh instead.
#

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

AIDA_REPO="$(cd "$(dirname "$0")" && pwd)"

RESET=false
DRY_RUN=false
PROFILE="default"

while [[ $# -gt 0 ]]; do
  case $1 in
    --profile=*) PROFILE="${1#*=}"; shift ;;
    --dry-run)   DRY_RUN=true; shift ;;
    --reset)     RESET=true; shift ;;
    *) echo -e "${RED}Unknown option: $1${NC}"; exit 1 ;;
  esac
done

echo -e "${BLUE}Dev-installing AIDA from $AIDA_REPO...${NC}"

# --- Helpers ---
do_mkdir() {
  if [ "$DRY_RUN" = true ]; then
    [ ! -d "$1" ] && echo "  Would create: $1"
  else
    mkdir -p "$1"
  fi
}

do_ln() {
  local target="$1" link="$2"
  if [ "$DRY_RUN" = true ]; then
    echo "  Would link: $link → $target"
  else
    ln -sfn "$target" "$link"
    echo -e "  ${GREEN}Linked: $link → $target${NC}"
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
    cp "$src" "$dest"
    echo -e "  ${GREEN}Created: $dest${NC}"
  fi
}

# --- Create project-local directories (not symlinked) ---
echo -e "${BLUE}Creating project directories...${NC}"
do_mkdir .aida/tree/_root/variations
do_mkdir .aida/engine
do_mkdir .aida/reviews
do_mkdir .aida/snapshots
do_mkdir .aida/references
do_mkdir .aida/generated
do_mkdir .claude/skills
do_mkdir .claude/commands

# --- Symlinks to repo (changes reflected immediately) ---
echo -e "${BLUE}Creating symlinks...${NC}"
do_ln "$AIDA_REPO/axes" ".aida/axes"
do_ln "$AIDA_REPO/skill" ".claude/skills/aida"
do_ln "$AIDA_REPO/commands/art" ".claude/commands/art"

# Engine workflows — symlink to repo defaults
do_ln "$AIDA_REPO/engine/workflows" ".aida/engine/workflows"

# MCP server — symlink to built dist
do_ln "$AIDA_REPO/dist/mcp/aida-server.js" ".aida/aida-server.js"

# --- MCP registration ---
echo -e "${BLUE}Registering MCP server...${NC}"
if [ "$DRY_RUN" != true ]; then
  MCP_FILE=".claude/mcp.json"
  SERVER_PATH="$AIDA_REPO/dist/mcp/aida-server.js"
  if [ -f "$MCP_FILE" ]; then
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

# --- Config (copy, not symlink — project-specific) ---
echo -e "${BLUE}Installing config...${NC}"
do_cp_protected "$AIDA_REPO/templates/config.yaml" ".aida/config.yaml"

# Apply profile
if [ "$DRY_RUN" != true ] && [ -f .aida/config.yaml ]; then
  sed -i "s/^paths_profile:.*/paths_profile: $PROFILE/" .aida/config.yaml
fi

# --- .gitignore ---
if [ "$DRY_RUN" != true ]; then
  for pattern in ".aida/aida.db" ".aida/generated/" ".aida/engine/loras/" ".aida/engine/embeddings/" ".aida/state.json"; do
    grep -qxF "$pattern" .gitignore 2>/dev/null || echo "$pattern" >> .gitignore
  done
  echo -e "  ${GREEN}Updated .gitignore${NC}"
fi

echo ""
echo -e "${GREEN}AIDA dev-installed (symlinks to $AIDA_REPO)${NC}"
echo -e "  Profile: $PROFILE"
echo -e "  Config: .aida/config.yaml"
echo -e "  Run: claude → /art:status"
