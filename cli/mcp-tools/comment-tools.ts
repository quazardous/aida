/**
 * MCP Tools — Comment processing
 *
 * Parses .comment files dropped by the human in the tree,
 * extracts actions, and returns them for the agent to execute.
 */
import fs from 'fs';
import path from 'path';
import type { Store } from '../managers/store.js';
import { ok, err } from './types.js';
import type { ToolDefinition } from './types.js';
import type { CommentAction } from '../lib/types.js';

export function createCommentTools(store: Store, treePath: string): ToolDefinition[] {
  return [
    {
      tool: {
        name: 'comment_pending',
        description: 'List all unprocessed .comment files in the tree.',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      handler: () => {
        const comments = findCommentFiles(treePath);
        return ok({
          success: true,
          data: {
            pending: comments.map(c => ({
              path: c.relativePath,
              content: c.content,
              location: c.location
            })),
            count: comments.length
          }
        });
      }
    },
    {
      tool: {
        name: 'comment_process',
        description: 'Parse a .comment file and return extracted actions. Does NOT execute them.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative path to .comment file within the tree' }
          },
          required: ['path']
        }
      },
      handler: (args) => {
        const fullPath = path.join(treePath, args.path);
        if (!fs.existsSync(fullPath)) {
          return err(`.comment file not found: ${args.path}`);
        }

        const content = fs.readFileSync(fullPath, 'utf-8');
        const location = detectLocation(args.path);
        const actions = parseComment(content, location);

        return ok({
          success: true,
          data: {
            path: args.path,
            location,
            raw_content: content,
            actions,
            action_count: actions.length
          }
        });
      }
    },
    {
      tool: {
        name: 'comment_mark_processed',
        description: 'Mark a .comment file as processed and write a .response.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative path to .comment file' },
            response: { type: 'string', description: 'Response text to write in .response file' }
          },
          required: ['path', 'response']
        }
      },
      handler: (args) => {
        const fullPath = path.join(treePath, args.path);
        if (!fs.existsSync(fullPath)) {
          return err(`.comment file not found: ${args.path}`);
        }

        // Rename .comment to .comment.done
        fs.renameSync(fullPath, fullPath + '.done');

        // Write .response
        const responsePath = fullPath.replace(/\.comment$/, '.response');
        fs.writeFileSync(responsePath, args.response);

        return ok({
          success: true,
          data: {
            processed: fullPath + '.done',
            response_written: responsePath
          }
        });
      }
    }
  ];
}

// --- Comment file discovery ---

interface CommentFile {
  absolutePath: string;
  relativePath: string;
  content: string;
  location: CommentLocation;
}

interface CommentLocation {
  node_id: string | null;
  variation_id: string | null;
  scope: 'root' | 'node' | 'variation';
}

function findCommentFiles(treePath: string): CommentFile[] {
  const results: CommentFile[] = [];
  walkDir(treePath, (filePath) => {
    if (path.basename(filePath) === '.comment') {
      const relativePath = path.relative(treePath, filePath);
      results.push({
        absolutePath: filePath,
        relativePath,
        content: fs.readFileSync(filePath, 'utf-8'),
        location: detectLocation(relativePath)
      });
    }
  });
  return results;
}

function walkDir(dir: string, callback: (filePath: string) => void): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath, callback);
    } else {
      callback(fullPath);
    }
  }
}

function detectLocation(relativePath: string): CommentLocation {
  const parts = relativePath.split(path.sep);

  // Root .comment
  if (parts.length === 1) {
    return { node_id: 'universe_root', variation_id: null, scope: 'root' };
  }

  // Inside a variation directory?
  const varIdx = parts.indexOf('variations');
  if (varIdx >= 0 && varIdx + 1 < parts.length - 1) {
    const varId = parts[varIdx + 1];
    // Infer node_id from path before 'variations'
    const nodeId = inferNodeId(parts.slice(0, varIdx));
    return { node_id: nodeId, variation_id: varId, scope: 'variation' };
  }

  // Node-level .comment
  const nodeId = inferNodeId(parts.slice(0, -1));
  return { node_id: nodeId, variation_id: null, scope: 'node' };
}

function inferNodeId(pathParts: string[]): string | null {
  // _root → universe_root
  if (pathParts.includes('_root')) return 'universe_root';
  // Last meaningful directory name
  const last = pathParts[pathParts.length - 1];
  return last || null;
}

// --- Comment parsing ---

function parseComment(content: string, location: CommentLocation): CommentAction[] {
  const actions: CommentAction[] = [];
  const lines = content.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));

  for (const line of lines) {
    const action = parseLine(line, location);
    if (action) actions.push(action);
  }

  return actions;
}

function parseLine(line: string, location: CommentLocation): CommentAction | null {
  // --- Rating shorthand: "4 keep super grain +vécu -balance" ---
  const ratingMatch = /^([1-5])\s+(keep|remove|veto|rework|expand|spawn)\s*(.*)$/.exec(line);
  if (ratingMatch && location.variation_id) {
    const [, rating, verdict, rest] = ratingMatch;
    const tweaks = parseTweaks(rest);
    const notes = rest.replace(/[+-]\w+/g, '').replace(/"([^"]+)"/, '$1').trim() || null;

    return {
      tool: 'variation_rate',
      args: {
        id: location.variation_id,
        rating: parseInt(rating),
        verdict,
        notes,
        tweaks: tweaks.length > 0 ? tweaks : undefined
      },
      raw_line: line
    };
  }

  // --- Veto shorthand: "veto ..." ---
  const vetoMatch = /^(veto|jamais|pas de)\s+(.+)$/i.exec(line);
  if (vetoMatch && location.node_id) {
    return {
      tool: 'wall_add',
      args: {
        node_id: location.node_id,
        axis: '_semantic',
        condition: '_from_text',
        reason: vetoMatch[2],
        propagate: true
      },
      raw_line: line
    };
  }

  // --- Set axis: "set température 0.2" ---
  const setMatch = /^set\s+(\w+)\s+([0-9.]+)$/i.exec(line);
  if (setMatch && location.node_id) {
    return {
      tool: 'genome_update',
      args: {
        node_id: location.node_id,
        axis: setMatch[1],
        value: parseFloat(setMatch[2])
      },
      raw_line: line
    };
  }

  // --- Split: "split forgerons → maitres + apprentis" ---
  const splitMatch = /^split\s+(\w+)\s*[→>]\s*(.+)$/i.exec(line);
  if (splitMatch) {
    const children = splitMatch[2].split(/\s*\+\s*/).map(s => s.trim());
    return {
      tool: 'node_split',
      args: {
        node_id: splitMatch[1],
        into: children.map(c => ({ id: c.toLowerCase().replace(/\s+/g, '_'), name: c }))
      },
      raw_line: line
    };
  }

  // --- Promote: "promote vécu 0.8 reason" ---
  const promoteMatch = /^promote\s+(\w+)\s+([0-9.]+)\s*(.*)$/i.exec(line);
  if (promoteMatch && location.node_id) {
    return {
      tool: 'node_promote',
      args: {
        node_id: location.node_id,
        axis: promoteMatch[1],
        value: parseFloat(promoteMatch[2]),
        reason: promoteMatch[3].replace(/^"(.+)"$/, '$1') || undefined
      },
      raw_line: line
    };
  }

  // --- Prune: "prune faction_mineurs" ---
  const pruneMatch = /^prune\s+(\w+)\s*(.*)$/i.exec(line);
  if (pruneMatch) {
    return {
      tool: 'node_prune',
      args: {
        node_id: pruneMatch[1],
        reason: pruneMatch[2] || undefined
      },
      raw_line: line
    };
  }

  // --- Free text note (anything else) ---
  if (location.node_id) {
    return {
      tool: '_note',
      args: {
        node_id: location.node_id,
        text: line
      },
      raw_line: line
    };
  }

  return null;
}

function parseTweaks(text: string): Array<{ axis: string; direction: string }> {
  const tweaks: Array<{ axis: string; direction: string }> = [];
  const tweakRegex = /([+-])(\w+)/g;
  let match;
  while ((match = tweakRegex.exec(text)) !== null) {
    tweaks.push({
      axis: match[2],
      direction: match[1] === '+' ? 'more' : 'less'
    });
  }
  return tweaks;
}
