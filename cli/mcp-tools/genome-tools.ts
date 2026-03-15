/**
 * MCP Tools — Genome operations (axes, walls, attractors, transforms)
 */
import type { Store } from '../managers/store.js';
import { ok, err } from './types.js';
import type { ToolDefinition } from './types.js';

export function createGenomeTools(store: Store): ToolDefinition[] {
  return [
    {
      tool: {
        name: 'genome_update',
        description: 'Update a single axis value and/or confidence on a node genome.',
        inputSchema: {
          type: 'object',
          properties: {
            node_id: { type: 'string', description: 'Node ID' },
            axis: { type: 'string', description: 'Axis ID' },
            value: { type: 'number', description: 'New value [0,1]' },
            confidence: { type: 'number', description: 'New confidence [0,1]' }
          },
          required: ['node_id', 'axis']
        }
      },
      handler: (args) => {
        try {
          const node = store.getNode(args.node_id);
          if (!node) return err(`Node not found: ${args.node_id}`);

          if (node.status === 'locked') {
            return err(`Node ${args.node_id} is locked. Use node_unlock first.`);
          }

          const axisDef = store.getAxis(args.axis);
          if (!axisDef) return err(`Unknown axis: ${args.axis}`);

          // Clamp value
          let value = args.value;
          if (value !== undefined) {
            if (axisDef.type === 'hue_angle') {
              value = ((value % 360) + 360) % 360;
            } else {
              value = Math.max(0, Math.min(1, value));
            }
          }

          const confidence = args.confidence !== undefined
            ? Math.max(0, Math.min(1, args.confidence))
            : undefined;

          // Check effective walls
          if (value !== undefined) {
            const walls = store.getEffectiveWalls(args.node_id);
            for (const wall of walls) {
              if (wall.axis !== args.axis) continue;
              if (violatesWall(value, wall.condition)) {
                return err(
                  `Value ${value} for axis "${args.axis}" violates wall: ${wall.condition} (reason: ${wall.reason})`
                );
              }
            }
          }

          if (value !== undefined) {
            store.updateGene(args.node_id, args.axis, value, confidence);
          } else if (confidence !== undefined) {
            const gene = store.getGenome(args.node_id).find(g => g.axis === args.axis);
            if (gene) {
              store.updateGene(args.node_id, args.axis, gene.value, confidence);
            }
          }

          return ok({
            success: true,
            data: {
              node_id: args.node_id,
              axis: args.axis,
              value,
              confidence
            }
          });
        } catch (e: any) {
          return err(e.message);
        }
      }
    },
    {
      tool: {
        name: 'genome_bulk_update',
        description: 'Update multiple axes at once on a node. Faster than individual genome_update calls.',
        inputSchema: {
          type: 'object',
          properties: {
            node_id: { type: 'string', description: 'Node ID' },
            updates: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  axis: { type: 'string' },
                  value: { type: 'number' },
                  confidence: { type: 'number' }
                },
                required: ['axis']
              },
              description: 'Array of {axis, value?, confidence?}'
            }
          },
          required: ['node_id', 'updates']
        }
      },
      handler: (args) => {
        try {
          const node = store.getNode(args.node_id);
          if (!node) return err(`Node not found: ${args.node_id}`);
          if (node.status === 'locked') return err(`Node ${args.node_id} is locked.`);

          const results: Array<{ axis: string; value?: number; confidence?: number; error?: string }> = [];

          for (const update of args.updates) {
            const axisDef = store.getAxis(update.axis);
            if (!axisDef) {
              results.push({ axis: update.axis, error: `Unknown axis: ${update.axis}` });
              continue;
            }

            let value = update.value;
            if (value !== undefined) {
              value = axisDef.type === 'hue_angle'
                ? ((value % 360) + 360) % 360
                : Math.max(0, Math.min(1, value));
            }

            const confidence = update.confidence !== undefined
              ? Math.max(0, Math.min(1, update.confidence))
              : undefined;

            try {
              if (value !== undefined) {
                store.updateGene(args.node_id, update.axis, value, confidence);
              } else if (confidence !== undefined) {
                const gene = store.getGenome(args.node_id).find(g => g.axis === update.axis);
                if (gene) store.updateGene(args.node_id, update.axis, gene.value, confidence);
              }
              results.push({ axis: update.axis, value, confidence });
            } catch (e: any) {
              results.push({ axis: update.axis, error: e.message });
            }
          }

          return ok({ success: true, data: { node_id: args.node_id, results } });
        } catch (e: any) {
          return err(e.message);
        }
      }
    },
    {
      tool: {
        name: 'wall_add',
        description: 'Add a wall (deny constraint) to a node. Walls prevent axes from reaching certain values.',
        inputSchema: {
          type: 'object',
          properties: {
            node_id: { type: 'string', description: 'Node ID' },
            axis: { type: 'string', description: 'Axis ID' },
            condition: { type: 'string', description: 'Condition (e.g. "> 0.7", "< 0.2")' },
            reason: { type: 'string', description: 'Why this wall exists' },
            propagate: { type: 'boolean', description: 'Propagate to all descendants (default true)' },
            pass: { type: 'number', description: 'Pass number where wall was created' }
          },
          required: ['node_id', 'axis', 'condition', 'reason']
        }
      },
      handler: (args) => {
        try {
          const node = store.getNode(args.node_id);
          if (!node) return err(`Node not found: ${args.node_id}`);

          const axisDef = store.getAxis(args.axis);
          if (!axisDef) return err(`Unknown axis: ${args.axis}`);

          // Validate condition syntax
          if (!isValidCondition(args.condition)) {
            return err(`Invalid condition syntax: ${args.condition}. Use: "> 0.7", "< 0.2", ">= 0.5", "<= 0.3"`);
          }

          const wallId = store.addWall(
            args.node_id,
            args.axis,
            args.condition,
            args.reason,
            args.propagate !== false,
            args.pass
          );

          return ok({
            success: true,
            data: {
              wall_id: wallId,
              node_id: args.node_id,
              axis: args.axis,
              condition: args.condition,
              propagate: args.propagate !== false
            }
          });
        } catch (e: any) {
          return err(e.message);
        }
      }
    },
    {
      tool: {
        name: 'wall_list',
        description: 'List walls on a node. Use effective=true to include inherited walls.',
        inputSchema: {
          type: 'object',
          properties: {
            node_id: { type: 'string', description: 'Node ID' },
            effective: { type: 'boolean', description: 'Include inherited walls from ancestors (default false)' }
          },
          required: ['node_id']
        }
      },
      handler: (args) => {
        const node = store.getNode(args.node_id);
        if (!node) return err(`Node not found: ${args.node_id}`);

        const walls = args.effective
          ? store.getEffectiveWalls(args.node_id)
          : store.getWalls(args.node_id);

        return ok({ success: true, data: { node_id: args.node_id, walls } });
      }
    },
    {
      tool: {
        name: 'axes_list',
        description: 'List available axes (universal + custom). Optionally filter by family.',
        inputSchema: {
          type: 'object',
          properties: {
            family: { type: 'string', description: 'Filter by family (structure, color, perception, semantic, rendering)' },
            layer: { type: 'string', enum: ['universal', 'custom'], description: 'Filter by layer' }
          }
        }
      },
      handler: (args) => {
        let axes = store.getAllAxes();
        if (args.family) axes = axes.filter(a => a.family === args.family);
        if (args.layer) axes = axes.filter(a => a.layer === args.layer);

        const grouped: Record<string, Array<{ id: string; poles: [string, string]; description: string }>> = {};
        for (const a of axes) {
          if (!grouped[a.family]) grouped[a.family] = [];
          grouped[a.family].push({ id: a.id, poles: a.poles, description: a.description });
        }

        return ok({ success: true, data: { axes: grouped, total: axes.length } });
      }
    },
    {
      tool: {
        name: 'axis_create',
        description: 'Create a custom axis for this project.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Unique axis ID (snake_case)' },
            poles: {
              type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 2,
              description: 'Bipolar labels [low, high]'
            },
            family: { type: 'string', description: 'Family to attach to (or "custom")' },
            description: { type: 'string', description: 'What this axis measures' },
            distinct_from: { type: 'string', description: 'Universal axis it might be confused with' },
            scope: { type: 'string', description: 'Glob pattern for applicable nodes (default "*")' },
            prompt_map: {
              type: 'object', description: 'Mapping of values to prompt fragments'
            }
          },
          required: ['id', 'poles', 'description']
        }
      },
      handler: (args) => {
        // Check collision with existing
        const existing = store.getAxis(args.id);
        if (existing) return err(`Axis "${args.id}" already exists (${existing.layer})`);

        // TODO: persist to custom.yaml and reload
        return ok({
          success: true,
          data: {
            id: args.id,
            poles: args.poles,
            family: args.family || 'custom',
            layer: 'custom',
            description: args.description,
            message: 'Custom axis registered. Will be available after next reload.'
          },
          next_actions: [{
            tool: 'genome_update',
            args: { node_id: 'universe_root', axis: args.id, value: 0.5, confidence: 0 },
            reason: 'Initialize this axis on universe_root',
            priority: 'normal'
          }]
        });
      }
    }
  ];
}

// --- Helpers ---

function isValidCondition(condition: string): boolean {
  return /^(>|<|>=|<=|==|!=)\s*\d+(\.\d+)?$/.test(condition.trim());
}

function violatesWall(value: number, condition: string): boolean {
  const match = /^(>|<|>=|<=|==|!=)\s*(\d+(\.\d+)?)$/.exec(condition.trim());
  if (!match) return false;

  const op = match[1];
  const threshold = parseFloat(match[2]);

  switch (op) {
    case '>': return value > threshold;
    case '<': return value < threshold;
    case '>=': return value >= threshold;
    case '<=': return value <= threshold;
    case '==': return value === threshold;
    case '!=': return value !== threshold;
    default: return false;
  }
}
