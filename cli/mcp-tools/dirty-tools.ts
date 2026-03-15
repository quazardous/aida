/**
 * MCP Tools — Dirty operations (propagation, clean, revalidate)
 */
import type { Store } from '../managers/store.js';
import { ok, err } from './types.js';
import type { ToolDefinition } from './types.js';

export function createDirtyTools(store: Store): ToolDefinition[] {
  return [
    {
      tool: {
        name: 'dirty_subtree',
        description: 'Mark a node and its descendants as dirty. Use after changing a parent genome.',
        inputSchema: {
          type: 'object',
          properties: {
            node_id: { type: 'string', description: 'Node ID to dirty' },
            severity: {
              type: 'string',
              enum: ['minor', 'major', 'broken'],
              description: 'Dirty severity (default: major)'
            },
            reason: { type: 'string', description: 'Why this subtree is being dirtied' }
          },
          required: ['node_id', 'reason']
        }
      },
      handler: (args) => {
        try {
          const node = store.getNode(args.node_id);
          if (!node) return err(`Node not found: ${args.node_id}`);

          const severity = args.severity || 'major';
          const reports = store.dirtySubtree(args.node_id, severity as any, args.reason);

          return ok({
            success: true,
            data: {
              node_id: args.node_id,
              severity,
              reason: args.reason,
              affected: reports.length,
              reports: reports.map(r => ({
                node_id: r.node_id,
                severity: r.severity,
                auto_cleanable: r.auto_cleanable
              }))
            }
          });
        } catch (e: any) {
          return err(e.message);
        }
      }
    },
    {
      tool: {
        name: 'dirty_status',
        description: 'Get all dirty nodes grouped by severity.',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      handler: () => {
        const report = store.getDirtyReport();
        return ok({
          success: true,
          data: {
            broken: report.broken.map(n => ({ id: n.id, name: n.name, type: n.type })),
            major: report.major.map(n => ({ id: n.id, name: n.name, type: n.type })),
            minor: report.minor.map(n => ({ id: n.id, name: n.name, type: n.type })),
            total: report.broken.length + report.major.length + report.minor.length
          }
        });
      }
    },
    {
      tool: {
        name: 'dirty_clean',
        description: 'Attempt to auto-clean a dirty:minor node by recalculating its resolved genome.',
        inputSchema: {
          type: 'object',
          properties: {
            node_id: { type: 'string', description: 'Node ID to clean' }
          },
          required: ['node_id']
        }
      },
      handler: (args) => {
        const node = store.getNode(args.node_id);
        if (!node) return err(`Node not found: ${args.node_id}`);

        if (!node.status.startsWith('dirty')) {
          return err(`Node ${args.node_id} is not dirty (status: ${node.status})`);
        }

        if (node.status === 'dirty:broken') {
          return err('Cannot auto-clean a dirty:broken node. Manual resolution required.', [{
            tool: 'node_get',
            args: { id: args.node_id },
            reason: 'Inspect the broken node to understand the conflict',
            priority: 'high'
          }]);
        }

        if (node.status === 'dirty:major') {
          return err('Cannot auto-clean a dirty:major node. A new pass is needed.', [{
            tool: 'pass_start',
            args: { root_node: args.node_id },
            reason: 'Start a revalidation pass',
            priority: 'high'
          }]);
        }

        // dirty:minor — recalculate resolved genome
        // For universe_root, just reset to exploring
        // TODO: for children, resolve from parent chain
        const nodeFile = store.loadNodeFile(args.node_id);
        if (nodeFile) {
          nodeFile.node.status = 'exploring';
          store.saveNodeFile(args.node_id, nodeFile);
        }

        return ok({
          success: true,
          data: {
            node_id: args.node_id,
            old_status: node.status,
            new_status: 'exploring',
            message: 'Node cleaned. Genome recalculated from parent chain.'
          }
        });
      }
    }
  ];
}
