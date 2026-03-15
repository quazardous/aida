.PHONY: build test test-watch clean install dev-install lint check help

# Default target
help:
	@echo "AIDA — Artistic Intelligence & Direction for Agents"
	@echo ""
	@echo "Usage: make <target>"
	@echo ""
	@echo "Targets:"
	@echo "  build        Build TypeScript → dist/"
	@echo "  test         Build + run all tests"
	@echo "  test-watch   Watch mode (rebuild + test on changes)"
	@echo "  check        Type-check without emitting"
	@echo "  clean        Remove dist/ and *.db"
	@echo "  install      npm install dependencies"
	@echo "  mcp          Start MCP server (stdio)"
	@echo "  dev-install  Dev-install into target project (usage: make dev-install TARGET=../myproject)"
	@echo ""

# Build
build:
	npx tsc

# Type-check only
check:
	npx tsc --noEmit

# Test (build first)
test: build
	node --test test/*.test.js

# Watch mode: rebuild + retest on .ts changes
test-watch:
	@echo "Watching for changes..."
	@while true; do \
		npx tsc && node --test test/*.test.js ; \
		inotifywait -qre modify --include '\.ts$$' cli/ mcp/ test/ 2>/dev/null || sleep 2; \
	done

# Clean build artifacts
clean:
	rm -rf dist/
	rm -f .aida/aida.db

# Install dependencies
install:
	npm install

# Start MCP server
mcp: build
	node dist/mcp/aida-server.js

# Dev-install into a target project
# Usage: make dev-install TARGET=../myproject
dev-install: build
ifndef TARGET
	@echo "Error: specify TARGET=../myproject"
	@exit 1
endif
	cd $(TARGET) && $(CURDIR)/devinstall.sh
