/**
 * MCP Tools — Generation (prompt building + engine call + variation creation)
 */
import path from 'path';
import type { Store } from '../managers/store.js';
import type { Engine, EngineConfig } from '../engine/index.js';
import { resolveGenome, buildPromptFromGenome } from '../lib/genome-resolver.js';
import type { NodeGenomeData } from '../lib/genome-resolver.js';
import { ok, err } from './types.js';
import type { ToolDefinition } from './types.js';

export function createGenerateTools(store: Store, engine: Engine, treePath: string): ToolDefinition[] {
  return [
    {
      tool: {
        name: 'generate_variations',
        description: 'Generate N variations for a node. Resolves genome, builds prompts, calls engine, creates variation records.',
        inputSchema: {
          type: 'object',
          properties: {
            node_id: { type: 'string', description: 'Node ID' },
            count: { type: 'number', description: 'Number of variations (default 3)' },
            pass: { type: 'number', description: 'Pass number (default: active pass)' },
            prompt_override: { type: 'string', description: 'Override the auto-generated prompt' },
            negative_prompt: { type: 'string', description: 'Negative prompt' },
            surprise: { type: 'boolean', description: 'Add a surprise variation with random mutation (default true)' }
          },
          required: ['node_id']
        }
      },
      handler: (args) => {
        try {
          const node = store.getNode(args.node_id);
          if (!node) return err(`Node not found: ${args.node_id}`);

          // Determine pass
          let passNum = args.pass;
          if (!passNum) {
            const activePass = store.getActivePass();
            if (!activePass) {
              return err('No active pass. Start one with pass_start.', [{
                tool: 'pass_start',
                args: { root_node: args.node_id },
                reason: 'Start a pass before generating',
                priority: 'high'
              }]);
            }
            passNum = activePass.id;
          }

          const count = args.count || 3;

          // Resolve genome
          // For now, only universe_root (single-node chain)
          // TODO: build full ancestor chain for child nodes
          const genome = store.getGenome(args.node_id);
          const genesMap: Record<string, any> = {};
          for (const g of genome) {
            genesMap[g.axis] = g;
          }
          const nodeData: NodeGenomeData = {
            node_id: args.node_id,
            genes: genesMap,
            transforms: [],
            walls: store.getWalls(args.node_id)
          };
          const resolved = resolveGenome([nodeData]);

          // Check for violations
          if (resolved.violations.length > 0) {
            return err(
              `Genome has wall violations: ${resolved.violations.map(v => `${v.axis} (${v.value} ${v.wall.condition})`).join(', ')}`,
              [{
                tool: 'node_get',
                args: { id: args.node_id },
                reason: 'Inspect genome and walls',
                priority: 'high'
              }]
            );
          }

          // Build prompt maps from axes
          const promptMaps = new Map<string, Record<string, string>>();
          for (const axis of store.getAllAxes()) {
            if (axis.prompt_map) {
              promptMaps.set(axis.id, axis.prompt_map);
            }
          }

          // Identify uncertain axes for A/B exploration
          const uncertain = store.getUncertainAxes(args.node_id, 0.5);
          const topUncertain = uncertain.slice(0, 3).map(u => u.axis);

          // Generate variation prompts
          const variations: Array<{ id: string; prompt: string; label: string }> = [];

          for (let i = 0; i < count; i++) {
            let label: string;
            let modifiedResolved = { ...resolved };

            if (i === count - 1 && args.surprise !== false && count >= 3) {
              // Surprise variation: random mutation on a random uncertain axis
              label = 'surprise';
              if (topUncertain.length > 0) {
                const randomAxis = topUncertain[Math.floor(Math.random() * topUncertain.length)];
                const gene = resolved.genes[randomAxis];
                if (gene) {
                  modifiedResolved = {
                    ...resolved,
                    genes: {
                      ...resolved.genes,
                      [randomAxis]: { ...gene, value: Math.random() }
                    }
                  };
                }
              }
            } else if (topUncertain.length > 0 && i < topUncertain.length) {
              // A/B on uncertain axes: push one direction
              const axis = topUncertain[i % topUncertain.length];
              const gene = resolved.genes[axis];
              if (gene) {
                const direction = i % 2 === 0 ? 0.8 : 0.2;
                label = `explore_${axis}_${direction > 0.5 ? 'high' : 'low'}`;
                modifiedResolved = {
                  ...resolved,
                  genes: {
                    ...resolved.genes,
                    [axis]: { ...gene, value: direction }
                  }
                };
              } else {
                label = `variation_${i + 1}`;
              }
            } else {
              label = `variation_${i + 1}`;
            }

            const prompt = args.prompt_override || buildPromptFromGenome(modifiedResolved, promptMaps, 0.2);

            // Create variation in store
            const variation = store.createVariation(args.node_id, passNum, prompt);
            variations.push({ id: variation.id, prompt, label: label! });
          }

          // Return without actually calling engine (async — agent decides)
          return ok({
            success: true,
            data: {
              node_id: args.node_id,
              pass: passNum,
              count: variations.length,
              variations: variations.map(v => ({
                id: v.id,
                label: v.label,
                prompt: v.prompt
              })),
              uncertain_axes: topUncertain,
              message: `${variations.length} variations created. Use generate_render to produce images.`
            },
            next_actions: [{
              tool: 'generate_render',
              args: { variation_ids: variations.map(v => v.id) },
              reason: 'Render the generated variations',
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
        name: 'generate_render',
        description: 'Submit a render job for variation images. Returns immediately with a job_id — use job_status to track progress.',
        inputSchema: {
          type: 'object',
          properties: {
            variation_ids: {
              type: 'array',
              items: { type: 'string' },
              description: 'Variation IDs to render'
            },
            negative_prompt: { type: 'string', description: 'Negative prompt for all' }
          },
          required: ['variation_ids']
        }
      },
      handler: (args) => {
        // Find the node for these variations
        let nodeId: string | null = null;
        for (const varId of args.variation_ids) {
          const allNodes = store.getTreeStatus().nodes;
          for (const n of allNodes) {
            const vars = store.getVariationsForNode(n.id);
            if (vars.find(v => v.id === varId)) {
              nodeId = n.id;
              break;
            }
          }
          if (nodeId) break;
        }

        if (!nodeId) return err('No valid variations found');

        // Submit as a job instead of blocking
        const job = store.submitJob(
          args.variation_ids.length > 1 ? 'render_batch' : 'render',
          nodeId,
          {
            variation_ids: args.variation_ids,
            negative_prompt: args.negative_prompt
          }
        );

        return ok({
          success: true,
          data: {
            job_id: job.id,
            type: job.type,
            status: 'queued',
            variation_count: args.variation_ids.length,
            message: `Render job ${job.id} queued. Use job_status to track progress.`
          },
          next_actions: [{
            tool: 'job_status',
            args: { id: job.id },
            reason: 'Check render progress',
            priority: 'normal'
          }]
        });
      }
    },
    {
      tool: {
        name: 'generate_prompt_preview',
        description: 'Preview the prompt that would be generated from a node\'s current genome without creating variations.',
        inputSchema: {
          type: 'object',
          properties: {
            node_id: { type: 'string', description: 'Node ID' }
          },
          required: ['node_id']
        }
      },
      handler: (args) => {
        const node = store.getNode(args.node_id);
        if (!node) return err(`Node not found: ${args.node_id}`);

        const genome = store.getGenome(args.node_id);
        const genesMap: Record<string, any> = {};
        for (const g of genome) genesMap[g.axis] = g;

        const nodeData: NodeGenomeData = {
          node_id: args.node_id,
          genes: genesMap,
          transforms: [],
          walls: store.getWalls(args.node_id)
        };
        const resolved = resolveGenome([nodeData]);

        const promptMaps = new Map<string, Record<string, string>>();
        for (const axis of store.getAllAxes()) {
          if (axis.prompt_map) promptMaps.set(axis.id, axis.prompt_map);
        }

        const prompt = buildPromptFromGenome(resolved, promptMaps, 0.2);

        // Also show per-axis contributions
        const contributions: Array<{ axis: string; value: number; confidence: number; fragment: string }> = [];
        for (const [axisId, gene] of Object.entries(resolved.genes)) {
          if (Math.abs(gene.value - 0.5) < 0.2 && gene.confidence < 0.5) continue;
          const map = promptMaps.get(axisId);
          if (!map) continue;

          const keys = Object.keys(map).map(Number).sort((a, b) => a - b);
          let closest = keys[0];
          for (const k of keys) {
            if (Math.abs(gene.value - k) < Math.abs(gene.value - closest)) closest = k;
          }

          contributions.push({
            axis: axisId,
            value: gene.value,
            confidence: gene.confidence,
            fragment: map[closest.toString()] || ''
          });
        }

        return ok({
          success: true,
          data: {
            node_id: args.node_id,
            prompt,
            contributions: contributions.sort((a, b) => Math.abs(b.value - 0.5) - Math.abs(a.value - 0.5))
          }
        });
      }
    }
  ];
}
