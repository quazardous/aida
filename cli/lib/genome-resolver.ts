/**
 * Genome Resolver
 *
 * Resolves the effective genome for any node by walking up
 * the inheritance chain and applying transforms at each level.
 *
 * Resolution order:
 *   1. Start from universe_root genome
 *   2. Walk down to target node
 *   3. At each level, apply transforms (inherit/set/invert/shift/scale/clamp/mirror/noise/map)
 *   4. Check walls at each level
 *   5. Return resolved genome with provenance
 */

import type { Gene, Transform, Wall, TransformFn } from './types.js';

export interface ResolvedGene {
  axis: string;
  value: number;
  confidence: number;
  source: string;         // node_id that last set this value
  transform: TransformFn; // transform applied at this level
  family: string;
  layer: string;
}

export interface ResolvedGenome {
  genes: Record<string, ResolvedGene>;
  walls: Wall[];
  violations: WallViolation[];
}

export interface WallViolation {
  axis: string;
  value: number;
  wall: Wall;
}

export interface NodeGenomeData {
  node_id: string;
  genes: Record<string, Gene & { family: string; layer: string }>;
  transforms: Transform[];
  walls: Wall[];
}

/**
 * Resolve genome for a target node given the full ancestor chain.
 *
 * @param chain - Array of NodeGenomeData from root to target (inclusive).
 *                chain[0] = universe_root, chain[chain.length-1] = target
 * @param siblings - Map of sibling node genomes (for mirror transforms)
 */
export function resolveGenome(
  chain: NodeGenomeData[],
  siblings: Map<string, Record<string, number>> = new Map()
): ResolvedGenome {
  if (chain.length === 0) {
    return { genes: {}, walls: [], violations: [] };
  }

  // Start with root's genome
  const root = chain[0];
  const resolved: Record<string, ResolvedGene> = {};

  for (const [axisId, gene] of Object.entries(root.genes)) {
    resolved[axisId] = {
      axis: axisId,
      value: gene.value,
      confidence: gene.confidence,
      source: root.node_id,
      transform: 'inherit',
      family: gene.family,
      layer: gene.layer
    };
  }

  // Collect all walls
  const allWalls: Wall[] = [...root.walls.filter(w => w.propagate)];

  // Walk down the chain applying transforms
  for (let i = 1; i < chain.length; i++) {
    const node = chain[i];

    // Apply transforms
    for (const transform of node.transforms) {
      const targetAxes = resolveAxesPattern(transform.axes, Object.keys(resolved), transform.except);
      for (const axisId of targetAxes) {
        const parent = resolved[axisId];
        if (!parent) continue;

        const newValue = applyTransform(
          transform.fn,
          parent.value,
          transform,
          siblings
        );

        resolved[axisId] = {
          ...parent,
          value: clamp01(newValue),
          source: node.node_id,
          transform: transform.fn
        };
      }
    }

    // Apply own gene values (set/override from node's own genome)
    for (const [axisId, gene] of Object.entries(node.genes)) {
      if (gene.mode === 'inherit') continue; // inherit = use parent value

      if (gene.mode === 'set' || !resolved[axisId]) {
        resolved[axisId] = {
          axis: axisId,
          value: gene.value,
          confidence: gene.confidence,
          source: node.node_id,
          transform: gene.mode as TransformFn,
          family: gene.family,
          layer: gene.layer
        };
      }
    }

    // Accumulate walls
    for (const wall of node.walls) {
      allWalls.push(wall);
      if (!wall.propagate) {
        // Non-propagating walls only apply at this level and below in this pass
      }
    }
  }

  // Check wall violations
  const violations: WallViolation[] = [];
  for (const wall of allWalls) {
    const gene = resolved[wall.axis];
    if (!gene) continue;
    if (violatesWall(gene.value, wall.condition)) {
      violations.push({ axis: wall.axis, value: gene.value, wall });
    }
  }

  return { genes: resolved, walls: allWalls, violations };
}

// --- Transform application ---

function applyTransform(
  fn: TransformFn,
  parentValue: number,
  transform: Transform,
  siblings: Map<string, Record<string, number>>
): number {
  switch (fn) {
    case 'inherit':
      return parentValue;

    case 'set':
      return transform.value ?? parentValue;

    case 'invert':
      return 1 - parentValue;

    case 'shift':
      return parentValue + (transform.delta ?? 0);

    case 'scale':
      return parentValue * (transform.factor ?? 1);

    case 'clamp': {
      const [min, max] = transform.range ?? [0, 1];
      return Math.max(min, Math.min(max, parentValue));
    }

    case 'mirror': {
      if (!transform.source) return parentValue;
      const siblingGenome = siblings.get(transform.source);
      if (!siblingGenome) return parentValue;
      // Mirror all specified axes — take first axis from the transform
      // The actual axis is handled per-axis in the caller
      const siblingValue = Object.values(siblingGenome)[0] ?? parentValue;
      return 1 - siblingValue;
    }

    case 'noise': {
      const amp = transform.amplitude ?? 0.1;
      return parentValue + (Math.random() * 2 - 1) * amp;
    }

    case 'map': {
      if (!transform.curve || transform.curve.length < 2) return parentValue;
      return interpolateCurve(parentValue, transform.curve);
    }

    default:
      return parentValue;
  }
}

// --- Axis pattern matching ---

function resolveAxesPattern(
  patterns: string[],
  allAxes: string[],
  except?: string[]
): string[] {
  const result = new Set<string>();
  const exceptSet = new Set(except || []);

  for (const pattern of patterns) {
    if (pattern.includes('*')) {
      // Wildcard: "color.*" or "custom.*" or "*"
      const prefix = pattern.replace('*', '');
      for (const axis of allAxes) {
        if (axis.startsWith(prefix) || prefix === '') {
          if (!exceptSet.has(axis)) result.add(axis);
        }
      }
    } else {
      // Exact match
      if (allAxes.includes(pattern) && !exceptSet.has(pattern)) {
        result.add(pattern);
      }
    }
  }

  return Array.from(result);
}

// --- Helpers ---

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
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

function interpolateCurve(x: number, curve: [number, number][]): number {
  // Linear interpolation on a piecewise curve
  if (x <= curve[0][0]) return curve[0][1];
  if (x >= curve[curve.length - 1][0]) return curve[curve.length - 1][1];

  for (let i = 0; i < curve.length - 1; i++) {
    const [x0, y0] = curve[i];
    const [x1, y1] = curve[i + 1];
    if (x >= x0 && x <= x1) {
      const t = (x - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }

  return x;
}

// --- Prompt builder ---

export interface AxisPromptData {
  evocation?: Record<string, string>;
  tokens?: { low?: string[]; high?: string[]; [key: string]: string[] | undefined };
  prompt_map?: Record<string, string>;  // legacy
}

/**
 * Build a generation prompt from a resolved genome.
 *
 * For each significant axis:
 *   1. Pick the closest evocation text (natural language)
 *   2. Add weighted tokens: (cold:1.2), (warm:0.3) based on axis value
 *   3. Fallback to legacy prompt_map if no evocation/tokens
 */
export function buildPromptFromGenome(
  resolved: ResolvedGenome,
  axisData: Map<string, AxisPromptData>,
  threshold: number = 0.3
): string {
  const evocations: string[] = [];
  const weightedTokens: string[] = [];

  for (const [axisId, gene] of Object.entries(resolved.genes)) {
    const data = axisData.get(axisId);
    if (!data) continue;

    // Skip axes near center with low confidence
    if (Math.abs(gene.value - 0.5) < threshold && gene.confidence < 0.5) continue;

    // 1. Evocation text
    if (data.evocation) {
      const evoc = pickClosestEntry(gene.value, data.evocation);
      if (evoc) evocations.push(evoc);
    }

    // 2. Weighted tokens
    if (data.tokens) {
      const tokens = buildWeightedTokens(gene.value, data.tokens);
      if (tokens.length > 0) weightedTokens.push(...tokens);
    }

    // 3. Legacy fallback
    if (!data.evocation && !data.tokens && data.prompt_map) {
      const legacy = pickClosestEntry(gene.value, data.prompt_map);
      if (legacy) evocations.push(legacy);
    }
  }

  // Combine: evocations first (scene-setting), then weighted tokens (fine-tuning)
  const parts: string[] = [];
  if (evocations.length > 0) parts.push(evocations.join('. '));
  if (weightedTokens.length > 0) parts.push(weightedTokens.join(', '));

  return parts.join(', ');
}

/**
 * Build a mood board text (evocations only, no tokens).
 */
export function buildMoodText(
  resolved: ResolvedGenome,
  axisData: Map<string, AxisPromptData>,
  threshold: number = 0.2
): string {
  const evocations: string[] = [];

  for (const [axisId, gene] of Object.entries(resolved.genes)) {
    const data = axisData.get(axisId);
    if (!data?.evocation) continue;
    if (Math.abs(gene.value - 0.5) < threshold && gene.confidence < 0.5) continue;

    const evoc = pickClosestEntry(gene.value, data.evocation);
    if (evoc) evocations.push(evoc);
  }

  return evocations.join('\n');
}

// --- Helpers ---

function pickClosestEntry(value: number, map: Record<string, string>): string | null {
  const keys = Object.keys(map).map(Number).sort((a, b) => a - b);
  if (keys.length === 0) return null;

  let closest = keys[0];
  let minDist = Math.abs(value - closest);

  for (const key of keys) {
    const dist = Math.abs(value - key);
    if (dist < minDist) {
      closest = key;
      minDist = dist;
    }
  }

  return map[closest.toString()] || null;
}

/**
 * Build weighted tokens from axis value.
 * value near 0 → low tokens weighted high, high tokens weighted low
 * value near 1 → high tokens weighted high, low tokens weighted low
 */
function buildWeightedTokens(
  value: number,
  tokens: { low?: string[]; high?: string[]; [key: string]: string[] | undefined }
): string[] {
  const result: string[] = [];

  if (tokens.low && tokens.high) {
    // Bipolar axis
    const lowWeight = Math.max(0.1, 1.3 - value * 1.2);   // 0→1.3, 0.5→0.7, 1→0.1
    const highWeight = Math.max(0.1, value * 1.2 + 0.1);   // 0→0.1, 0.5→0.7, 1→1.3

    // Only include tokens with weight > 0.5 to avoid noise
    if (lowWeight > 0.5) {
      // Pick top 2-3 tokens, not all
      const count = lowWeight > 1.0 ? 3 : 2;
      for (const token of tokens.low.slice(0, count)) {
        result.push(`(${token}:${lowWeight.toFixed(1)})`);
      }
    }
    if (highWeight > 0.5) {
      const count = highWeight > 1.0 ? 3 : 2;
      for (const token of tokens.high.slice(0, count)) {
        result.push(`(${token}:${highWeight.toFixed(1)})`);
      }
    }
  }

  return result;
}
