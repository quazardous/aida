/**
 * AIDA Paths Schema - Single source of truth for path configuration
 *
 * Defines all valid path keys with:
 * - default: default value (may contain placeholders)
 * - description: human-readable description
 * - category: grouping for display
 * - profiles: per-profile overrides
 */

type ProfileOverrides = Partial<Record<'haven' | 'split' | 'external', string>>;

export type PathEntry = {
  default: string;
  description: string;
  category: 'data' | 'state' | 'engine' | 'project';
  profiles?: ProfileOverrides;
};

export const PATHS_SCHEMA: Record<string, PathEntry> = {
  // === DATA: artistic tree & assets ===
  tree: {
    default: '.aida/tree',
    description: 'Node tree (universe_root, biomes, entities...)',
    category: 'data',
    profiles: {
      haven: '${haven}/tree',
      external: '${art_dir}/tree'
    }
  },
  references: {
    default: '.aida/references',
    description: 'User-imported reference images',
    category: 'data',
    profiles: {
      haven: '${haven}/references',
      external: '${art_dir}/references'
    }
  },
  generated: {
    default: '.aida/generated',
    description: 'Final generated outputs',
    category: 'data',
    profiles: {
      haven: '${haven}/generated',
      external: '${art_dir}/generated'
    }
  },
  reviews: {
    default: '.aida/reviews',
    description: 'Review history per pass',
    category: 'data',
    profiles: {
      haven: '${haven}/reviews'
    }
  },
  snapshots: {
    default: '.aida/snapshots',
    description: 'Tree snapshots for rollback',
    category: 'data',
    profiles: {
      haven: '${haven}/snapshots'
    }
  },
  axes: {
    default: '.aida/axes',
    description: 'Axes definitions (universal + custom)',
    category: 'data'
  },

  // === STATE: index & counters ===
  db: {
    default: '.aida/aida.db',
    description: 'SQLite index (nodes, genome, variations, walls)',
    category: 'state',
    profiles: {
      haven: '${haven}/aida.db'
    }
  },
  state: {
    default: '.aida/state.json',
    description: 'ID counters, current pass, etc.',
    category: 'state',
    profiles: {
      haven: '${haven}/state.json'
    }
  },
  config: {
    default: '.aida/config.yaml',
    description: 'AIDA project configuration',
    category: 'state'
    // always in project, no profile override
  },

  // === ENGINE: GPU generation backend ===
  engine: {
    default: '.aida/engine',
    description: 'Generation backend config (ComfyUI, Forge...)',
    category: 'engine'
  },
  workflows: {
    default: '.aida/engine/workflows',
    description: 'ComfyUI workflows',
    category: 'engine'
  },
  loras: {
    default: '.aida/engine/loras',
    description: 'Project-trained LoRAs',
    category: 'engine',
    profiles: {
      external: '${models_dir}/loras'
    }
  },
  embeddings: {
    default: '.aida/engine/embeddings',
    description: 'Aesthetic embeddings, style tokens',
    category: 'engine',
    profiles: {
      external: '${models_dir}/embeddings'
    }
  },

  // === PROJECT: Claude Code integration ===
  skill: {
    default: '.claude/skills/aida',
    description: 'Claude Code skill',
    category: 'project'
  },
  commands: {
    default: '.claude/commands/art',
    description: '/art:* slash commands',
    category: 'project'
  }
};

export const CATEGORIES: Record<string, string> = {
  data: 'Artistic data (tree, variations, references)',
  state: 'State & index',
  engine: 'GPU generation backend',
  project: 'Claude Code integration'
};

/**
 * Get default value for a path key, with optional profile override
 */
export function getPathDefault(key: string, profile: string | null = null): string | null {
  const schema = PATHS_SCHEMA[key];
  if (!schema) return null;

  if (profile && schema.profiles?.[profile as keyof ProfileOverrides]) {
    return schema.profiles[profile as keyof ProfileOverrides]!;
  }
  return schema.default;
}

/**
 * Get all path keys
 */
export function getPathKeys(): string[] {
  return Object.keys(PATHS_SCHEMA);
}

/**
 * Get schema for a key
 */
export function getPathSchema(key: string): PathEntry | null {
  return PATHS_SCHEMA[key] || null;
}
