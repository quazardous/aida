/**
 * AIDA MCP Server
 *
 * Exposes the AIDA tree store via Model Context Protocol.
 * Launched by Claude Code as a stdio MCP server.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

import { Store } from '../cli/managers/store.js';
import { createNodeTools } from '../cli/mcp-tools/node-tools.js';
import { createGenomeTools } from '../cli/mcp-tools/genome-tools.js';
import { createVariationTools } from '../cli/mcp-tools/variation-tools.js';
import { createPassTools } from '../cli/mcp-tools/pass-tools.js';
import { createDirtyTools } from '../cli/mcp-tools/dirty-tools.js';
import { createTreeTools } from '../cli/mcp-tools/tree-tools.js';
import { createCommentTools } from '../cli/mcp-tools/comment-tools.js';
import { createGenerateTools } from '../cli/mcp-tools/generate-tools.js';
import { createReferenceTools } from '../cli/mcp-tools/reference-tools.js';
import { createMutationTools } from '../cli/mcp-tools/mutation-tools.js';
import { createEngine } from '../cli/engine/index.js';
import type { EngineConfig } from '../cli/engine/index.js';
import type { ToolDefinition } from '../cli/mcp-tools/types.js';

// --- Resolve project paths ---

function findProjectRoot(): string {
  // Walk up from CWD looking for .aida/config.yaml
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.aida', 'config.yaml'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  // Fallback: use CWD
  return process.cwd();
}

function loadConfig(projectRoot: string): Record<string, any> {
  const configPath = path.join(projectRoot, '.aida', 'config.yaml');
  if (!fs.existsSync(configPath)) {
    return {};
  }
  return yaml.load(fs.readFileSync(configPath, 'utf-8')) as Record<string, any> || {};
}

// --- Main ---

async function main() {
  const projectRoot = findProjectRoot();
  const config = loadConfig(projectRoot);

  // Resolve paths from config (TODO: use paths-schema profiles)
  const treePath = path.join(projectRoot, '.aida', 'tree');
  const dbPath = path.join(projectRoot, '.aida', 'aida.db');
  const axesPath = path.join(projectRoot, '.aida', 'axes');

  // Ensure directories exist
  fs.mkdirSync(treePath, { recursive: true });
  fs.mkdirSync(axesPath, { recursive: true });

  // Create store
  const store = new Store({ treePath, dbPath, axesPath });

  // Create engine from config
  const engineConfig: EngineConfig = {
    backend: config.engine?.backend || 'mock',
    api_url: config.engine?.api_url || 'http://localhost:8188',
    api_key: config.engine?.api_key,
    default_model: config.engine?.default_model || 'flux-dev',
    default_steps: config.engine?.default_steps || 25,
    default_cfg: config.engine?.default_cfg || 7.0,
    default_sampler: config.engine?.default_sampler || 'euler',
    default_scheduler: config.engine?.default_scheduler || 'normal',
    default_width: config.engine?.default_width || 1024,
    default_height: config.engine?.default_height || 1024,
    batch_size: config.engine?.batch_size || 3,
    seed_mode: config.engine?.seed_mode || 'random',
    fixed_seed: config.engine?.fixed_seed
  };
  const engine = createEngine(engineConfig);

  // Collect all tools
  const allTools: ToolDefinition[] = [
    ...createNodeTools(store),
    ...createGenomeTools(store),
    ...createVariationTools(store),
    ...createPassTools(store),
    ...createDirtyTools(store),
    ...createTreeTools(store),
    ...createCommentTools(store, treePath),
    ...createGenerateTools(store, engine, treePath),
    ...createReferenceTools(store),
    ...createMutationTools(store)
  ];

  // Build handler map
  const handlers = new Map<string, ToolDefinition['handler']>();
  for (const t of allTools) {
    handlers.set(t.tool.name, t.handler);
  }

  // Create MCP server
  const server = new Server(
    { name: 'aida-tree', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  // List tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allTools.map(t => t.tool)
  }));

  // Call tool
  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<any> => {
    const { name, arguments: args } = request.params;
    const handler = handlers.get(name);

    if (!handler) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
        isError: true
      };
    }

    try {
      return await handler(args || {});
    } catch (e: any) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: e.message }) }],
        isError: true
      };
    }
  });

  // Start stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Cleanup on exit
  process.on('SIGINT', () => {
    store.close();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    store.close();
    process.exit(0);
  });
}

main().catch((e) => {
  console.error('AIDA MCP server failed to start:', e);
  process.exit(1);
});
