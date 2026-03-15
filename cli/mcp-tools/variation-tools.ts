/**
 * MCP Tools — Variation operations (create, rate, compare)
 */
import type { Store } from '../managers/store.js';
import { ok, err } from './types.js';
import type { ToolDefinition } from './types.js';
import type { Verdict, Tweak } from '../lib/types.js';

export function createVariationTools(store: Store): ToolDefinition[] {
  return [
    {
      tool: {
        name: 'variation_create',
        description: 'Create a new variation for a node at a given pass. Snapshots the current genome.',
        inputSchema: {
          type: 'object',
          properties: {
            node_id: { type: 'string', description: 'Node ID' },
            pass: { type: 'number', description: 'Pass number' },
            prompt_used: { type: 'string', description: 'The prompt used for generation' }
          },
          required: ['node_id', 'pass']
        }
      },
      handler: (args) => {
        try {
          const node = store.getNode(args.node_id);
          if (!node) return err(`Node not found: ${args.node_id}`);

          const variation = store.createVariation(args.node_id, args.pass, args.prompt_used);

          return ok({
            success: true,
            data: variation,
            next_actions: [{
              tool: 'variation_rate',
              args: { id: variation.id, rating: null, verdict: 'pending' },
              reason: 'Rate this variation after reviewing the generated asset',
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
        name: 'variation_rate',
        description: 'Rate a variation: assign rating (1-5), verdict, notes, and optional axis tweaks.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Variation ID' },
            rating: { type: 'number', minimum: 1, maximum: 5, description: 'Rating 1-5' },
            verdict: {
              type: 'string',
              enum: ['keep', 'remove', 'veto', 'rework', 'expand', 'spawn'],
              description: 'Verdict'
            },
            notes: { type: 'string', description: 'Free text notes' },
            tweaks: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  axis: { type: 'string' },
                  direction: { type: 'string', enum: ['more', 'less', 'much_more', 'much_less'] },
                  note: { type: 'string' }
                },
                required: ['axis', 'direction']
              },
              description: 'Axis adjustments'
            }
          },
          required: ['id', 'rating', 'verdict']
        }
      },
      handler: (args) => {
        try {
          const variation = store.getVariationsForNode('').length >= 0 ? null : null; // dummy
          // Get variation by looking it up
          const allNodes = store.getTreeStatus().nodes;
          let found = false;

          for (const node of allNodes) {
            const vars = store.getVariationsForNode(node.id);
            const v = vars.find(v => v.id === args.id);
            if (v) {
              store.rateVariation(args.id, args.rating, args.verdict as Verdict, args.notes, args.tweaks);
              found = true;

              // Build next actions based on verdict
              const nextActions: any[] = [];

              if (args.verdict === 'veto' && args.tweaks) {
                // Convert tweaks to walls
                for (const tweak of args.tweaks) {
                  const axisDef = store.getAxis(tweak.axis);
                  if (!axisDef) continue;

                  const snapshot = v.genome_snapshot[tweak.axis];
                  if (snapshot !== undefined) {
                    const condition = snapshot > 0.5 ? `> ${(snapshot - 0.1).toFixed(1)}` : `< ${(snapshot + 0.1).toFixed(1)}`;
                    nextActions.push({
                      tool: 'wall_add',
                      args: {
                        node_id: node.id,
                        axis: tweak.axis,
                        condition,
                        reason: args.notes || `Vetoed in variation ${args.id}`
                      },
                      reason: `Veto implies wall on ${tweak.axis}`,
                      priority: 'high'
                    });
                  }
                }
              }

              if (args.verdict === 'expand') {
                nextActions.push({
                  tool: 'variation_create',
                  args: { node_id: node.id, pass: v.pass },
                  reason: 'Generate more variations in this direction',
                  priority: 'high'
                });
              }

              return ok({
                success: true,
                data: {
                  id: args.id,
                  node_id: node.id,
                  rating: args.rating,
                  verdict: args.verdict
                },
                next_actions: nextActions
              });
            }
          }

          if (!found) return err(`Variation not found: ${args.id}`);
          return err(`Variation not found: ${args.id}`);
        } catch (e: any) {
          return err(e.message);
        }
      }
    },
    {
      tool: {
        name: 'variation_list',
        description: 'List variations for a node, optionally filtered by pass or verdict.',
        inputSchema: {
          type: 'object',
          properties: {
            node_id: { type: 'string', description: 'Node ID' },
            pass: { type: 'number', description: 'Filter by pass number' },
            verdict: { type: 'string', description: 'Filter by verdict' }
          },
          required: ['node_id']
        }
      },
      handler: (args) => {
        const node = store.getNode(args.node_id);
        if (!node) return err(`Node not found: ${args.node_id}`);

        let variations = store.getVariationsForNode(args.node_id, args.pass);
        if (args.verdict) {
          variations = variations.filter(v => v.verdict === args.verdict);
        }

        // Compact output
        const items = variations.map(v => ({
          id: v.id,
          pass: v.pass,
          rating: v.rating,
          verdict: v.verdict,
          notes: v.notes,
          asset_path: v.asset_path,
          tags: v.tags
        }));

        return ok({ success: true, data: { node_id: args.node_id, items, count: items.length } });
      }
    },
    {
      tool: {
        name: 'variation_compare',
        description: 'Compare two variations axis by axis, showing deltas.',
        inputSchema: {
          type: 'object',
          properties: {
            var_a: { type: 'string', description: 'First variation ID' },
            var_b: { type: 'string', description: 'Second variation ID' }
          },
          required: ['var_a', 'var_b']
        }
      },
      handler: (args) => {
        // Find both variations
        const allNodes = store.getTreeStatus().nodes;
        let varA: any = null;
        let varB: any = null;

        for (const node of allNodes) {
          const vars = store.getVariationsForNode(node.id);
          for (const v of vars) {
            if (v.id === args.var_a) varA = v;
            if (v.id === args.var_b) varB = v;
          }
        }

        if (!varA) return err(`Variation not found: ${args.var_a}`);
        if (!varB) return err(`Variation not found: ${args.var_b}`);

        // Compute deltas
        const allAxes = new Set([
          ...Object.keys(varA.genome_snapshot),
          ...Object.keys(varB.genome_snapshot)
        ]);

        const deltas: Array<{ axis: string; a: number; b: number; delta: number }> = [];
        for (const axis of allAxes) {
          const a = varA.genome_snapshot[axis] ?? 0.5;
          const b = varB.genome_snapshot[axis] ?? 0.5;
          const delta = Math.abs(a - b);
          if (delta > 0.01) {
            deltas.push({ axis, a, b, delta });
          }
        }

        // Sort by largest delta
        deltas.sort((a, b) => b.delta - a.delta);

        return ok({
          success: true,
          data: {
            var_a: args.var_a,
            var_b: args.var_b,
            rating_a: varA.rating,
            rating_b: varB.rating,
            verdict_a: varA.verdict,
            verdict_b: varB.verdict,
            deltas,
            total_delta: deltas.reduce((sum, d) => sum + d.delta, 0)
          }
        });
      }
    }
  ];
}
