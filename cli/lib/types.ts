/**
 * AIDA Core Types
 */

// --- Node statuses ---
export type NodeStatus =
  | 'draft'
  | 'exploring'
  | 'validated'
  | 'locked'
  | 'dirty'
  | 'dirty:minor'
  | 'dirty:major'
  | 'dirty:broken';

// --- Variation verdicts ---
export type Verdict =
  | 'pending'
  | 'keep'
  | 'remove'
  | 'veto'
  | 'rework'
  | 'expand'
  | 'spawn';

// --- Transform functions ---
export type TransformFn =
  | 'inherit'
  | 'set'
  | 'invert'
  | 'shift'
  | 'scale'
  | 'clamp'
  | 'mirror'
  | 'noise'
  | 'map';

// --- Axis definition ---
export interface AxisDef {
  id: string;
  poles: [string, string];
  range?: [number, number];       // default [0, 1]
  type?: 'bipolar' | 'hue_angle'; // default bipolar
  description: string;
  family: string;
  layer: 'universal' | 'custom';
  prompt_map?: Record<string, string>;
  // Custom axis extras
  origin?: string;
  distinct_from?: string;
  scope?: string;                 // glob pattern for applicable nodes
}

// --- Gene (single axis value in a genome) ---
export interface Gene {
  axis: string;
  value: number;
  confidence: number;
  mode: TransformFn;
}

// --- Transform (applied to an axis or group) ---
export interface Transform {
  fn: TransformFn;
  axes: string[];               // axis ids or patterns like "color.*"
  // fn-specific params
  value?: number;               // for set
  delta?: number;               // for shift
  factor?: number;              // for scale
  range?: [number, number];     // for clamp
  source?: string;              // for mirror (sibling node id)
  amplitude?: number;           // for noise
  curve?: [number, number][];   // for map
  except?: string[];            // exclude specific axes
  reason?: string;
}

// --- Wall (deny constraint) ---
export interface Wall {
  id?: number;
  node_id: string;
  axis: string;
  condition: string;            // e.g. "> 0.7", "< 0.2"
  reason: string;
  propagate: boolean;
  source_variation?: string;
  pass?: number;
}

// --- Attractor (positive pattern) ---
export interface Attractor {
  id?: number;
  node_id: string;
  genes: Record<string, number>; // { axis: value, ... }
  weight: number;
  label: string;
}

// --- Node ---
export interface AidaNode {
  id: string;
  name: string;
  type: string;                 // universe_root, biome, faction, entity, object, meta
  parent_id: string | null;
  status: NodeStatus;
  path: string;                 // filesystem path relative to tree root
  depth: number;

  // Relations
  contrast_with?: string;       // sibling node id
  coupled_axes?: { axis: string; coupling: 'mirror' }[];

  created_at: string;
  updated_at: string;
}

// --- Genome (full set of genes for a node) ---
export interface Genome {
  universal: Record<string, Gene>;
  custom: Record<string, Gene>;
}

// --- Variation ---
export interface Variation {
  id: string;
  node_id: string;
  pass: number;
  genome_snapshot: Record<string, number>; // flat axis→value at generation time

  // Rating & verdict
  rating: number | null;        // 1-5
  verdict: Verdict;
  notes: string | null;
  tags: string[];

  // Tweaks from review
  tweaks: Tweak[];

  // Assets
  asset_path: string | null;    // path to generated image
  prompt_used: string | null;

  created_at: string;
}

// --- Tweak (review adjustment) ---
export interface Tweak {
  axis: string;
  direction: 'more' | 'less' | 'much_more' | 'much_less';
  note?: string;
}

// --- Pass ---
export interface Pass {
  id: number;
  strategy: 'ab' | 'abc' | 'tournament' | 'contrast';
  root_node: string;            // starting node for the pass
  status: 'active' | 'closed';
  created_at: string;
  closed_at: string | null;
}

// --- Reference (web research, image ref, inspiration source) ---
export interface Reference {
  id: string;
  node_id: string;
  type: 'url' | 'image' | 'search' | 'note';
  source: string;                // URL, file path, or search query
  title: string;
  description: string | null;    // what was extracted/learned
  axes_hint: string[];           // which axes this reference informs
  insights: string[];            // key takeaways extracted by agent
  tags: string[];
  created_at: string;
}

// --- Comment action (parsed from .comment file) ---
export interface CommentAction {
  tool: string;
  args: Record<string, unknown>;
  raw_line: string;
}

// --- Dirty report ---
export interface DirtyReport {
  node_id: string;
  severity: 'minor' | 'major' | 'broken';
  reason: string;
  affected_axes: string[];
  auto_cleanable: boolean;
}
