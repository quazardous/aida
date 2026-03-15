/**
 * MCP Tools — Pass operations (start, advance, close, status)
 */
import type { Store } from '../managers/store.js';
import { ok, err } from './types.js';
import type { ToolDefinition } from './types.js';

export function createPassTools(store: Store): ToolDefinition[] {
  return [
    {
      tool: {
        name: 'pass_start',
        description: 'Start a new exploration pass. Sets the root node to "exploring" if in draft.',
        inputSchema: {
          type: 'object',
          properties: {
            root_node: { type: 'string', description: 'Starting node (default: universe_root)' },
            strategy: {
              type: 'string',
              enum: ['ab', 'abc', 'tournament', 'contrast'],
              description: 'Pass strategy (default: ab)'
            }
          }
        }
      },
      handler: (args) => {
        try {
          const rootNode = args.root_node || 'universe_root';
          const node = store.getNode(rootNode);
          if (!node) return err(`Node not found: ${rootNode}`);

          // Check no active pass
          const active = store.getActivePass();
          if (active) {
            return err(`A pass is already active (pass ${active.id}). Close it first.`, [{
              tool: 'pass_close',
              args: { id: active.id },
              reason: 'Close active pass before starting a new one',
              priority: 'high'
            }]);
          }

          // Auto-transition draft → exploring
          if (node.status === 'draft') {
            const nodeFile = store.loadNodeFile(rootNode);
            if (nodeFile) {
              nodeFile.node.status = 'exploring';
              store.saveNodeFile(rootNode, nodeFile);
            }
          }

          const passId = store.startPass(rootNode, args.strategy || 'ab');

          return ok({
            success: true,
            data: {
              pass_id: passId,
              root_node: rootNode,
              strategy: args.strategy || 'ab'
            },
            next_actions: [{
              tool: 'variation_create',
              args: { node_id: rootNode, pass: passId },
              reason: 'Generate first variation for this pass',
              priority: 'high'
            }]
          });
        } catch (e: any) {
          return err(e.message);
        }
      }
    },
    {
      tool: {
        name: 'pass_status',
        description: 'Get status of the current or specified pass.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'number', description: 'Pass ID (default: active pass)' }
          }
        }
      },
      handler: (args) => {
        const pass = args.id
          ? null // TODO: get pass by id
          : store.getActivePass();

        if (!pass) return err('No active pass found.');

        // Get variations for this pass
        const node = store.getNode(pass.root_node);
        if (!node) return err(`Root node not found: ${pass.root_node}`);

        const variations = store.getVariationsForNode(pass.root_node, pass.id);
        const pending = variations.filter(v => v.verdict === 'pending');
        const rated = variations.filter(v => v.verdict !== 'pending');

        // Calculate convergence
        const kept = variations.filter(v => v.verdict === 'keep');
        const ratings = kept.map(v => v.rating).filter((r): r is number => r !== null);
        const spread = ratings.length > 1
          ? Math.max(...ratings) - Math.min(...ratings)
          : null;

        // Uncertain axes
        const uncertain = store.getUncertainAxes(pass.root_node, 0.5);

        return ok({
          success: true,
          data: {
            pass_id: pass.id,
            strategy: pass.strategy,
            root_node: pass.root_node,
            status: pass.status,
            variations: {
              total: variations.length,
              pending: pending.length,
              rated: rated.length,
              by_verdict: {
                keep: variations.filter(v => v.verdict === 'keep').length,
                remove: variations.filter(v => v.verdict === 'remove').length,
                veto: variations.filter(v => v.verdict === 'veto').length,
                rework: variations.filter(v => v.verdict === 'rework').length,
                expand: variations.filter(v => v.verdict === 'expand').length
              }
            },
            convergence: {
              rating_spread: spread,
              uncertain_axes: uncertain.map(a => ({ axis: a.axis, confidence: a.confidence })),
              uncertain_count: uncertain.length
            },
            validatable: kept.length >= 2
              && variations.some(v => v.verdict === 'veto')
              && (spread !== null && spread <= 1)
          }
        });
      }
    },
    {
      tool: {
        name: 'pass_close',
        description: 'Close the current pass. Summarizes learnings and genome delta.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'number', description: 'Pass ID (default: active pass)' }
          }
        }
      },
      handler: (args) => {
        const pass = args.id ? null : store.getActivePass();
        if (!pass) return err('No active pass found.');

        const variations = store.getVariationsForNode(pass.root_node, pass.id);
        const pending = variations.filter(v => v.verdict === 'pending');

        if (pending.length > 0) {
          return err(`${pending.length} variations still pending. Rate them before closing.`, [{
            tool: 'variation_list',
            args: { node_id: pass.root_node, pass: pass.id, verdict: 'pending' },
            reason: 'View pending variations',
            priority: 'high'
          }]);
        }

        store.closePass(pass.id);

        // Compute summary
        const kept = variations.filter(v => v.verdict === 'keep');
        const vetoed = variations.filter(v => v.verdict === 'veto');

        const nextActions: any[] = [];

        // Can we validate?
        if (kept.length >= 2 && vetoed.length >= 1) {
          nextActions.push({
            tool: 'node_set_status',
            args: { id: pass.root_node, status: 'validated' },
            reason: 'Node has enough kept/vetoed variations to be validated',
            priority: 'normal'
          });
        }

        // Or start next pass?
        nextActions.push({
          tool: 'pass_start',
          args: { root_node: pass.root_node },
          reason: 'Start next refinement pass',
          priority: 'normal'
        });

        return ok({
          success: true,
          data: {
            pass_id: pass.id,
            closed: true,
            summary: {
              total_variations: variations.length,
              kept: kept.length,
              vetoed: vetoed.length,
              removed: variations.filter(v => v.verdict === 'remove').length,
              reworked: variations.filter(v => v.verdict === 'rework').length
            }
          },
          next_actions: nextActions
        });
      }
    }
  ];
}
