/**
 * AIDA Database Manager
 *
 * SQLite index for fast queries. Files (YAML) remain the source of truth.
 * The DB is a derived index that can be rebuilt from files.
 */
import Database from 'better-sqlite3';
import type { AidaNode, Gene, Wall, Attractor, Variation, Pass, NodeStatus, Verdict } from '../lib/types.js';

const SCHEMA_SQL = `
-- Nodes
CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY,
    parent_id TEXT,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    path TEXT NOT NULL,
    depth INTEGER NOT NULL DEFAULT 0,
    contrast_with TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Genome (one row per axis per node)
CREATE TABLE IF NOT EXISTS genome (
    node_id TEXT NOT NULL,
    axis TEXT NOT NULL,
    value REAL NOT NULL,
    confidence REAL NOT NULL DEFAULT 0.0,
    mode TEXT NOT NULL DEFAULT 'inherit',
    layer TEXT NOT NULL DEFAULT 'universal',
    family TEXT NOT NULL,
    PRIMARY KEY (node_id, axis),
    FOREIGN KEY (node_id) REFERENCES nodes(id)
);

-- Walls
CREATE TABLE IF NOT EXISTS walls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id TEXT NOT NULL,
    axis TEXT NOT NULL,
    condition TEXT NOT NULL,
    reason TEXT NOT NULL,
    propagate INTEGER NOT NULL DEFAULT 0,
    source_variation TEXT,
    pass INTEGER,
    FOREIGN KEY (node_id) REFERENCES nodes(id)
);

-- Attractors
CREATE TABLE IF NOT EXISTS attractors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id TEXT NOT NULL,
    genes TEXT NOT NULL,          -- JSON { axis: value, ... }
    weight INTEGER NOT NULL DEFAULT 1,
    label TEXT,
    FOREIGN KEY (node_id) REFERENCES nodes(id)
);

-- Variations
CREATE TABLE IF NOT EXISTS variations (
    id TEXT PRIMARY KEY,
    node_id TEXT NOT NULL,
    pass INTEGER NOT NULL,
    genome_snapshot TEXT NOT NULL, -- JSON { axis: value, ... }
    rating INTEGER,
    verdict TEXT NOT NULL DEFAULT 'pending',
    notes TEXT,
    tags TEXT,                    -- JSON array
    tweaks TEXT,                  -- JSON array
    asset_path TEXT,
    prompt_used TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (node_id) REFERENCES nodes(id)
);

-- Passes
CREATE TABLE IF NOT EXISTS passes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    strategy TEXT NOT NULL DEFAULT 'ab',
    root_node TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    closed_at TEXT
);

-- Comments tracking
CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL,
    content TEXT NOT NULL,
    processed INTEGER NOT NULL DEFAULT 0,
    processed_at TEXT,
    actions TEXT                  -- JSON array of parsed actions
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_genome_node ON genome(node_id);
CREATE INDEX IF NOT EXISTS idx_genome_axis ON genome(axis);
CREATE INDEX IF NOT EXISTS idx_variations_node ON variations(node_id);
CREATE INDEX IF NOT EXISTS idx_variations_verdict ON variations(verdict);
CREATE INDEX IF NOT EXISTS idx_walls_node ON walls(node_id);
CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_nodes_status ON nodes(status);
`;

export class DbManager {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA_SQL);
  }

  close(): void {
    this.db.close();
  }

  // === NODES ===

  createNode(node: AidaNode): void {
    this.db.prepare(`
      INSERT INTO nodes (id, parent_id, type, name, status, path, depth, contrast_with, created_at, updated_at)
      VALUES (@id, @parent_id, @type, @name, @status, @path, @depth, @contrast_with, @created_at, @updated_at)
    `).run({
      ...node,
      contrast_with: node.contrast_with ?? null
    });
  }

  getNode(id: string): AidaNode | null {
    return this.db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) as AidaNode | null;
  }

  getChildren(parentId: string): AidaNode[] {
    return this.db.prepare('SELECT * FROM nodes WHERE parent_id = ?').all(parentId) as AidaNode[];
  }

  updateNodeStatus(id: string, status: NodeStatus): void {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE nodes SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id);
  }

  getAllNodes(): AidaNode[] {
    return this.db.prepare('SELECT * FROM nodes ORDER BY depth, name').all() as AidaNode[];
  }

  getNodesByStatus(status: string): AidaNode[] {
    // Support dirty:* with LIKE
    if (status.startsWith('dirty')) {
      return this.db.prepare('SELECT * FROM nodes WHERE status LIKE ?').all(`${status}%`) as AidaNode[];
    }
    return this.db.prepare('SELECT * FROM nodes WHERE status = ?').all(status) as AidaNode[];
  }

  deleteNode(id: string): void {
    this.db.prepare('DELETE FROM genome WHERE node_id = ?').run(id);
    this.db.prepare('DELETE FROM walls WHERE node_id = ?').run(id);
    this.db.prepare('DELETE FROM attractors WHERE node_id = ?').run(id);
    this.db.prepare('DELETE FROM variations WHERE node_id = ?').run(id);
    this.db.prepare('DELETE FROM nodes WHERE id = ?').run(id);
  }

  // === GENOME ===

  setGene(nodeId: string, gene: Gene & { family: string; layer: string }): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO genome (node_id, axis, value, confidence, mode, layer, family)
      VALUES (@node_id, @axis, @value, @confidence, @mode, @layer, @family)
    `).run({
      node_id: nodeId,
      axis: gene.axis,
      value: gene.value,
      confidence: gene.confidence,
      mode: gene.mode,
      layer: gene.layer,
      family: gene.family
    });
  }

  getGenome(nodeId: string): (Gene & { family: string; layer: string })[] {
    return this.db.prepare('SELECT * FROM genome WHERE node_id = ?').all(nodeId) as (Gene & { family: string; layer: string })[];
  }

  getGene(nodeId: string, axis: string): (Gene & { family: string; layer: string }) | null {
    return this.db.prepare('SELECT * FROM genome WHERE node_id = ? AND axis = ?').get(nodeId, axis) as (Gene & { family: string; layer: string }) | null;
  }

  // === WALLS ===

  addWall(wall: Wall): number {
    const result = this.db.prepare(`
      INSERT INTO walls (node_id, axis, condition, reason, propagate, source_variation, pass)
      VALUES (@node_id, @axis, @condition, @reason, @propagate, @source_variation, @pass)
    `).run({
      ...wall,
      propagate: wall.propagate ? 1 : 0,
      source_variation: wall.source_variation ?? null,
      pass: wall.pass ?? null
    });
    return result.lastInsertRowid as number;
  }

  getWalls(nodeId: string): Wall[] {
    return this.db.prepare('SELECT * FROM walls WHERE node_id = ?').all(nodeId) as Wall[];
  }

  /**
   * Get all walls that apply to a node (own + propagated from ancestors)
   */
  getEffectiveWalls(nodeId: string): Wall[] {
    return this.db.prepare(`
      WITH RECURSIVE ancestors(id, parent_id) AS (
        SELECT id, parent_id FROM nodes WHERE id = ?
        UNION ALL
        SELECT n.id, n.parent_id FROM nodes n
        JOIN ancestors a ON n.id = a.parent_id
      )
      SELECT w.* FROM walls w
      JOIN ancestors a ON w.node_id = a.id
      WHERE w.propagate = 1 OR w.node_id = ?
    `).all(nodeId, nodeId) as Wall[];
  }

  // === ATTRACTORS ===

  addAttractor(attractor: Attractor): number {
    const result = this.db.prepare(`
      INSERT INTO attractors (node_id, genes, weight, label)
      VALUES (@node_id, @genes, @weight, @label)
    `).run({
      ...attractor,
      genes: JSON.stringify(attractor.genes)
    });
    return result.lastInsertRowid as number;
  }

  getAttractors(nodeId: string): Attractor[] {
    const rows = this.db.prepare('SELECT * FROM attractors WHERE node_id = ?').all(nodeId) as any[];
    return rows.map(r => ({ ...r, genes: JSON.parse(r.genes) }));
  }

  // === VARIATIONS ===

  createVariation(v: Variation): void {
    this.db.prepare(`
      INSERT INTO variations (id, node_id, pass, genome_snapshot, rating, verdict, notes, tags, tweaks, asset_path, prompt_used, created_at)
      VALUES (@id, @node_id, @pass, @genome_snapshot, @rating, @verdict, @notes, @tags, @tweaks, @asset_path, @prompt_used, @created_at)
    `).run({
      ...v,
      genome_snapshot: JSON.stringify(v.genome_snapshot),
      tags: JSON.stringify(v.tags),
      tweaks: JSON.stringify(v.tweaks),
      asset_path: v.asset_path ?? null,
      prompt_used: v.prompt_used ?? null
    });
  }

  getVariation(id: string): Variation | null {
    const row = this.db.prepare('SELECT * FROM variations WHERE id = ?').get(id) as any;
    if (!row) return null;
    return {
      ...row,
      genome_snapshot: JSON.parse(row.genome_snapshot),
      tags: JSON.parse(row.tags || '[]'),
      tweaks: JSON.parse(row.tweaks || '[]')
    };
  }

  getVariationsForNode(nodeId: string, pass?: number): Variation[] {
    let sql = 'SELECT * FROM variations WHERE node_id = ?';
    const params: unknown[] = [nodeId];
    if (pass !== undefined) {
      sql += ' AND pass = ?';
      params.push(pass);
    }
    sql += ' ORDER BY pass, created_at';
    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(r => ({
      ...r,
      genome_snapshot: JSON.parse(r.genome_snapshot),
      tags: JSON.parse(r.tags || '[]'),
      tweaks: JSON.parse(r.tweaks || '[]')
    }));
  }

  rateVariation(id: string, rating: number | null, verdict: Verdict, notes?: string): void {
    this.db.prepare(`
      UPDATE variations SET rating = ?, verdict = ?, notes = ? WHERE id = ?
    `).run(rating, verdict, notes ?? null, id);
  }

  getVariationsByVerdict(verdict: Verdict, nodeId?: string): Variation[] {
    let sql = 'SELECT * FROM variations WHERE verdict = ?';
    const params: unknown[] = [verdict];
    if (nodeId) {
      sql += ' AND node_id = ?';
      params.push(nodeId);
    }
    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(r => ({
      ...r,
      genome_snapshot: JSON.parse(r.genome_snapshot),
      tags: JSON.parse(r.tags || '[]'),
      tweaks: JSON.parse(r.tweaks || '[]')
    }));
  }

  // === PASSES ===

  createPass(pass: Omit<Pass, 'id'>): number {
    const result = this.db.prepare(`
      INSERT INTO passes (strategy, root_node, status, created_at)
      VALUES (@strategy, @root_node, @status, @created_at)
    `).run(pass);
    return result.lastInsertRowid as number;
  }

  getActivePass(): Pass | null {
    return this.db.prepare("SELECT * FROM passes WHERE status = 'active' ORDER BY id DESC LIMIT 1").get() as Pass | null;
  }

  closePass(id: number): void {
    const now = new Date().toISOString();
    this.db.prepare("UPDATE passes SET status = 'closed', closed_at = ? WHERE id = ?").run(now, id);
  }

  // === QUERIES ===

  /**
   * Search nodes by axis value range
   */
  searchByAxis(axis: string, minVal: number, maxVal: number): AidaNode[] {
    return this.db.prepare(`
      SELECT n.* FROM nodes n
      JOIN genome g ON n.id = g.node_id
      WHERE g.axis = ? AND g.value >= ? AND g.value <= ?
    `).all(axis, minVal, maxVal) as AidaNode[];
  }

  /**
   * Get axes with low confidence for a node (exploration targets)
   */
  getUncertainAxes(nodeId: string, threshold: number = 0.5): (Gene & { family: string })[] {
    return this.db.prepare(`
      SELECT * FROM genome WHERE node_id = ? AND confidence < ? ORDER BY confidence ASC
    `).all(nodeId, threshold) as (Gene & { family: string })[];
  }

  /**
   * Get dirty nodes grouped by severity
   */
  getDirtyReport(): { broken: AidaNode[]; major: AidaNode[]; minor: AidaNode[] } {
    return {
      broken: this.getNodesByStatus('dirty:broken'),
      major: this.getNodesByStatus('dirty:major'),
      minor: this.getNodesByStatus('dirty:minor')
    };
  }

  // === TRANSACTION HELPER ===

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}
