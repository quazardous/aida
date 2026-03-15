/**
 * MCP Tools — Tree operations (status, search)
 */
import type { Store } from '../managers/store.js';
import { ok, err } from './types.js';
import type { ToolDefinition } from './types.js';

export function createTreeTools(store: Store): ToolDefinition[] {
  return [
    {
      tool: {
        name: 'tree_status',
        description: 'Get full tree status: all nodes with their status, dirty report, active pass.',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      handler: () => {
        const { nodes, dirty } = store.getTreeStatus();
        const activePass = store.getActivePass();

        // Build tree structure for display
        const tree: Record<string, any> = {};
        for (const node of nodes) {
          tree[node.id] = {
            name: node.name,
            type: node.type,
            status: node.status,
            depth: node.depth,
            parent: node.parent_id
          };
        }

        return ok({
          success: true,
          data: {
            tree,
            node_count: nodes.length,
            dirty_summary: {
              broken: dirty.broken.length,
              major: dirty.major.length,
              minor: dirty.minor.length
            },
            active_pass: activePass ? {
              id: activePass.id,
              root_node: activePass.root_node,
              strategy: activePass.strategy
            } : null
          }
        });
      }
    },
    {
      tool: {
        name: 'tree_search',
        description: 'Search nodes by axis values, status, or type.',
        inputSchema: {
          type: 'object',
          properties: {
            axis: { type: 'string', description: 'Axis to search on' },
            min_value: { type: 'number', description: 'Minimum value' },
            max_value: { type: 'number', description: 'Maximum value' },
            status: { type: 'string', description: 'Filter by status' },
            type: { type: 'string', description: 'Filter by node type' }
          }
        }
      },
      handler: (args) => {
        let results;

        if (args.axis) {
          results = store.searchByAxis(
            args.axis,
            args.min_value ?? 0,
            args.max_value ?? 1
          );
        } else {
          results = store.getTreeStatus().nodes;
        }

        if (args.status) {
          results = results.filter(n => n.status === args.status);
        }
        if (args.type) {
          results = results.filter(n => n.type === args.type);
        }

        return ok({
          success: true,
          data: {
            items: results.map(n => ({
              id: n.id,
              name: n.name,
              type: n.type,
              status: n.status
            })),
            count: results.length
          }
        });
      }
    }
  ];
}
