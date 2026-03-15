/**
 * MCP Tools — Node operations
 */
import type { Store } from '../managers/store.js';
import { ok, err } from './types.js';
import type { ToolDefinition, NextAction } from './types.js';

export function createNodeTools(store: Store): ToolDefinition[] {
  return [
    {
      tool: {
        name: 'node_init',
        description: 'Initialize the universe_root node. Must be called once before anything else.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Project/universe name' }
          },
          required: ['name']
        }
      },
      handler: (args) => {
        try {
          const existing = store.getNode('universe_root');
          if (existing) {
            return err('universe_root already exists', [{
              tool: 'node_get',
              args: { id: 'universe_root' },
              reason: 'View existing universe root',
              priority: 'high'
            }]);
          }
          const node = store.initUniverseRoot(args.name);
          return ok({
            success: true,
            data: node,
            next_actions: [{
              tool: 'tree_status',
              args: {},
              reason: 'View tree after initialization',
              priority: 'normal'
            }, {
              tool: 'pass_start',
              args: { root_node: 'universe_root' },
              reason: 'Start first exploration pass',
              priority: 'normal'
            }]
          });
        } catch (e: any) {
          return err(e.message);
        }
      }
    },
    {
      tool: {
        name: 'node_get',
        description: 'Get node details: genome, walls, status, variations count.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Node ID' },
            include_genome: { type: 'boolean', description: 'Include full genome (default true)' },
            include_walls: { type: 'boolean', description: 'Include walls (default true)' }
          },
          required: ['id']
        }
      },
      handler: (args) => {
        const node = store.getNode(args.id);
        if (!node) return err(`Node not found: ${args.id}`);

        const data: Record<string, unknown> = { ...node };

        if (args.include_genome !== false) {
          const genome = store.getGenome(args.id);
          // Group by family
          const grouped: Record<string, Record<string, unknown>> = {};
          for (const g of genome) {
            if (!grouped[g.family]) grouped[g.family] = {};
            grouped[g.family][g.axis] = { value: g.value, confidence: g.confidence, mode: g.mode };
          }
          data.genome = grouped;
        }

        if (args.include_walls !== false) {
          data.walls = store.getWalls(args.id);
          data.effective_walls = store.getEffectiveWalls(args.id);
        }

        const variations = store.getVariationsForNode(args.id);
        data.variations_count = variations.length;
        data.variations_by_verdict = {
          pending: variations.filter(v => v.verdict === 'pending').length,
          kept: variations.filter(v => v.verdict === 'keep').length,
          removed: variations.filter(v => v.verdict === 'remove').length,
          vetoed: variations.filter(v => v.verdict === 'veto').length
        };

        // Uncertain axes
        const uncertain = store.getUncertainAxes(args.id, 0.5);
        data.uncertain_axes = uncertain.map(a => ({ axis: a.axis, confidence: a.confidence }));

        return ok({ success: true, data });
      }
    },
    {
      tool: {
        name: 'node_resolve',
        description: 'Compute resolved genome for a node (merge full inheritance chain).',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Node ID' }
          },
          required: ['id']
        }
      },
      handler: (args) => {
        const node = store.getNode(args.id);
        if (!node) return err(`Node not found: ${args.id}`);

        // For universe_root, resolved = own genome
        // TODO: for children, resolve up the chain with transforms
        const genome = store.getGenome(args.id);
        const resolved: Record<string, { value: number; confidence: number; source: string }> = {};
        for (const g of genome) {
          resolved[g.axis] = { value: g.value, confidence: g.confidence, source: args.id };
        }

        const walls = store.getEffectiveWalls(args.id);

        return ok({
          success: true,
          data: {
            node_id: args.id,
            resolved_genome: resolved,
            effective_walls: walls
          }
        });
      }
    },
    {
      tool: {
        name: 'node_set_status',
        description: 'Change node status (draft → exploring → validated → locked).',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Node ID' },
            status: {
              type: 'string',
              enum: ['draft', 'exploring', 'validated', 'locked'],
              description: 'New status'
            }
          },
          required: ['id', 'status']
        }
      },
      handler: (args) => {
        const node = store.getNode(args.id);
        if (!node) return err(`Node not found: ${args.id}`);

        // Validation rules
        if (args.status === 'validated') {
          const variations = store.getVariationsForNode(args.id);
          const kept = variations.filter(v => v.verdict === 'keep');
          const vetoed = variations.filter(v => v.verdict === 'veto');

          if (kept.length < 2) {
            return err(`Cannot validate: need at least 2 kept variations (have ${kept.length})`);
          }
          if (vetoed.length < 1) {
            return err('Cannot validate: need at least 1 vetoed variation (must know what you DON\'T want)');
          }
        }

        if (args.status === 'exploring' && node.status === 'draft') {
          // OK — starting exploration
        } else if (args.status === 'validated' && node.status === 'exploring') {
          // OK — validated after exploration
        } else if (args.status === 'locked' && node.status === 'validated') {
          // OK — locking validated node
        } else if (node.status.startsWith('dirty') && ['exploring', 'draft'].includes(args.status)) {
          // OK — resetting dirty node
        } else if (node.status === args.status) {
          return ok({ success: true, data: { message: 'Status unchanged', node_id: args.id, status: args.status } });
        }

        // TODO: update YAML file too
        const nodeFile = store.loadNodeFile(args.id);
        if (nodeFile) {
          nodeFile.node.status = args.status as any;
          store.saveNodeFile(args.id, nodeFile);
        }

        return ok({ success: true, data: { node_id: args.id, old_status: node.status, new_status: args.status } });
      }
    }
  ];
}
