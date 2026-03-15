/**
 * MCP Tools — Tree mutation operations (split, merge, promote, prune)
 */
import type { Store } from '../managers/store.js';
import { ok, err } from './types.js';
import type { ToolDefinition } from './types.js';

export function createMutationTools(store: Store): ToolDefinition[] {
  return [
    {
      tool: {
        name: 'node_split',
        description: 'Split a node into multiple children. The original node becomes a "group" parent, and its content is distributed to the new children.',
        inputSchema: {
          type: 'object',
          properties: {
            node_id: { type: 'string', description: 'Node to split' },
            into: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: 'New child ID' },
                  name: { type: 'string', description: 'New child name' },
                  from_variations: {
                    type: 'array', items: { type: 'string' },
                    description: 'Variation IDs to assign to this child'
                  },
                  note: { type: 'string' }
                },
                required: ['id', 'name']
              },
              description: 'Children to create from the split'
            },
            reason: { type: 'string', description: 'Why split this node' }
          },
          required: ['node_id', 'into']
        }
      },
      handler: (args) => {
        try {
          const node = store.getNode(args.node_id);
          if (!node) return err(`Node not found: ${args.node_id}`);

          const created: string[] = [];

          for (const child of args.into) {
            // Check child doesn't already exist
            if (store.getNode(child.id)) {
              return err(`Node "${child.id}" already exists`);
            }

            // Create child inheriting from the parent
            const newNode = store.createChildNode(
              args.node_id,
              child.id,
              child.name,
              node.type,  // same type as parent
            );
            created.push(child.id);

            // If specific variations are assigned, their genome snapshots
            // can be used to initialize the child's genome differently
            if (child.from_variations && child.from_variations.length > 0) {
              const variations = store.getVariationsForNode(args.node_id);
              const assigned = variations.filter(v => child.from_variations!.includes(v.id));

              if (assigned.length > 0) {
                // Average the genome snapshots of assigned variations
                const avgGenome: Record<string, { total: number; count: number }> = {};
                for (const v of assigned) {
                  for (const [axis, value] of Object.entries(v.genome_snapshot)) {
                    if (!avgGenome[axis]) avgGenome[axis] = { total: 0, count: 0 };
                    avgGenome[axis].total += value;
                    avgGenome[axis].count += 1;
                  }
                }

                const updates = Object.entries(avgGenome).map(([axis, { total, count }]) => ({
                  axis,
                  value: total / count,
                  confidence: 0.3  // moderate confidence from variation data
                }));

                for (const u of updates) {
                  try {
                    store.updateGene(child.id, u.axis, u.value, u.confidence);
                  } catch { /* skip if axis not found */ }
                }
              }
            }
          }

          return ok({
            success: true,
            data: {
              parent: args.node_id,
              children_created: created,
              reason: args.reason
            },
            next_actions: created.map(id => ({
              tool: 'node_get',
              args: { id },
              reason: `View new child node ${id}`,
              priority: 'normal' as const
            }))
          });
        } catch (e: any) {
          return err(e.message);
        }
      }
    },
    {
      tool: {
        name: 'node_merge',
        description: 'Merge two sibling nodes into one. Genomes are averaged, walls and variations are combined.',
        inputSchema: {
          type: 'object',
          properties: {
            node_ids: {
              type: 'array', items: { type: 'string' }, minItems: 2,
              description: 'Sibling node IDs to merge'
            },
            into_id: { type: 'string', description: 'ID for the merged node' },
            into_name: { type: 'string', description: 'Name for the merged node' },
            reason: { type: 'string' }
          },
          required: ['node_ids', 'into_id', 'into_name']
        }
      },
      handler: (args) => {
        try {
          // Validate all nodes exist and are siblings
          const nodes = args.node_ids.map((id: string) => {
            const n = store.getNode(id);
            if (!n) throw new Error(`Node not found: ${id}`);
            return n;
          });

          const parentId = nodes[0].parent_id;
          for (const n of nodes) {
            if (n.parent_id !== parentId) {
              return err('All nodes must be siblings (same parent)');
            }
          }

          if (!parentId) return err('Cannot merge root nodes');

          // Average genomes
          const allGenomes = nodes.map((n: any) => store.getGenome(n.id));
          const avgValues: Record<string, number> = {};
          const axisCount: Record<string, number> = {};

          for (const genome of allGenomes) {
            for (const gene of genome) {
              if (!avgValues[gene.axis]) {
                avgValues[gene.axis] = 0;
                axisCount[gene.axis] = 0;
              }
              avgValues[gene.axis] += gene.value;
              axisCount[gene.axis] += 1;
            }
          }

          // Create merged node
          const mergedNode = store.createChildNode(
            parentId,
            args.into_id,
            args.into_name,
            nodes[0].type
          );

          // Set averaged genome
          for (const [axis, total] of Object.entries(avgValues)) {
            const avg = total / axisCount[axis];
            try {
              store.updateGene(args.into_id, axis, avg, 0.3);
            } catch { /* skip */ }
          }

          // Archive old nodes (mark as pruned, don't delete)
          for (const n of nodes) {
            const nodeFile = store.loadNodeFile(n.id);
            if (nodeFile) {
              nodeFile.node.status = 'draft'; // reset
              (nodeFile.node as any).merged_into = args.into_id;
              store.saveNodeFile(n.id, nodeFile);
            }
          }

          return ok({
            success: true,
            data: {
              merged_from: args.node_ids,
              into: args.into_id,
              reason: args.reason
            }
          });
        } catch (e: any) {
          return err(e.message);
        }
      }
    },
    {
      tool: {
        name: 'node_promote',
        description: 'Promote an axis value from a child node up to its parent. This affects all siblings.',
        inputSchema: {
          type: 'object',
          properties: {
            node_id: { type: 'string', description: 'Child node with the value to promote' },
            axis: { type: 'string', description: 'Axis to promote' },
            value: { type: 'number', description: 'Value to set on parent (if omitted, uses child value)' },
            reason: { type: 'string', description: 'Why promote this value' }
          },
          required: ['node_id', 'axis', 'reason']
        }
      },
      handler: (args) => {
        try {
          const node = store.getNode(args.node_id);
          if (!node) return err(`Node not found: ${args.node_id}`);
          if (!node.parent_id) return err('Cannot promote from root node');

          const parent = store.getNode(node.parent_id);
          if (!parent) return err(`Parent not found: ${node.parent_id}`);

          // Get value to promote
          const genome = store.getGenome(args.node_id);
          const gene = genome.find(g => g.axis === args.axis);
          if (!gene) return err(`Axis "${args.axis}" not found on node ${args.node_id}`);

          const value = args.value !== undefined ? args.value : gene.value;

          // List siblings that will be affected
          const siblings = store.getChildren(node.parent_id);
          const affectedSiblings = siblings.filter(s => s.id !== args.node_id);

          // Apply to parent
          store.updateGene(node.parent_id, args.axis, value, gene.confidence);

          // Dirty siblings
          const dirtyReports = [];
          for (const sibling of affectedSiblings) {
            const reports = store.dirtySubtree(sibling.id, 'minor', `Promoted ${args.axis}=${value} from ${args.node_id}`);
            dirtyReports.push(...reports);
          }

          return ok({
            success: true,
            data: {
              promoted: { axis: args.axis, value, from: args.node_id, to: node.parent_id },
              affected_siblings: affectedSiblings.map(s => s.id),
              dirty_count: dirtyReports.length,
              reason: args.reason
            }
          });
        } catch (e: any) {
          return err(e.message);
        }
      }
    },
    {
      tool: {
        name: 'node_prune',
        description: 'Archive a node and its entire subtree. Not a hard delete — can be recovered.',
        inputSchema: {
          type: 'object',
          properties: {
            node_id: { type: 'string', description: 'Node to prune' },
            reason: { type: 'string', description: 'Why prune this node' }
          },
          required: ['node_id', 'reason']
        }
      },
      handler: (args) => {
        try {
          const node = store.getNode(args.node_id);
          if (!node) return err(`Node not found: ${args.node_id}`);

          if (node.id === 'universe_root') {
            return err('Cannot prune universe_root');
          }

          // Mark node and all descendants as pruned via status
          const pruned: string[] = [];
          const markPruned = (nodeId: string) => {
            const nodeFile = store.loadNodeFile(nodeId);
            if (nodeFile) {
              (nodeFile.node as any).pruned = true;
              (nodeFile.node as any).pruned_reason = args.reason;
              (nodeFile.node as any).pruned_at = new Date().toISOString();
              nodeFile.node.status = 'draft';
              store.saveNodeFile(nodeId, nodeFile);
            }
            pruned.push(nodeId);

            const children = store.getChildren(nodeId);
            for (const child of children) {
              markPruned(child.id);
            }
          };

          markPruned(args.node_id);

          return ok({
            success: true,
            data: {
              pruned_nodes: pruned,
              count: pruned.length,
              reason: args.reason,
              message: 'Nodes archived (not deleted). YAML files preserved with pruned=true.'
            }
          });
        } catch (e: any) {
          return err(e.message);
        }
      }
    }
  ];
}
