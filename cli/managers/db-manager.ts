/**
 * AIDA Database Manager
 *
 * SQLite index for fast queries. Files (YAML) remain the source of truth.
 * The DB is a derived index that can be rebuilt from files.
 */
import Database from 'better-sqlite3';
import type { AidaNode, Gene, Wall, Attractor, Variation, Pass, Reference, Job, JobStatus, NodeStatus, Verdict } from '../lib/types.js';

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
    subject TEXT,
    subject_detail TEXT,
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

-- References (web research, image refs, inspiration sources)
CREATE TABLE IF NOT EXISTS refs (
    id TEXT PRIMARY KEY,
    node_id TEXT NOT NULL,
    type TEXT NOT NULL,            -- url, image, search, note
    source TEXT NOT NULL,          -- URL, file path, or search query
    title TEXT NOT NULL,
    description TEXT,
    axes_hint TEXT,                -- JSON array of axis IDs
    insights TEXT,                 -- JSON array of key takeaways
    tags TEXT,                     -- JSON array
    created_at TEXT NOT NULL,
    FOREIGN KEY (node_id) REFERENCES nodes(id)
);

-- Jobs (persistent async GPU tasks)
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,             -- render, render_batch, lora_train, etc.
    status TEXT NOT NULL DEFAULT 'queued',
    node_id TEXT NOT NULL,
    params TEXT NOT NULL,           -- JSON
    result TEXT,                    -- JSON (when completed)
    progress INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    FOREIGN KEY (node_id) REFERENCES nodes(id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_genome_node ON genome(node_id);
CREATE INDEX IF NOT EXISTS idx_genome_axis ON genome(axis);
CREATE INDEX IF NOT EXISTS idx_variations_node ON variations(node_id);
CREATE INDEX IF NOT EXISTS idx_variations_verdict ON variations(verdict);
CREATE INDEX IF NOT EXISTS idx_refs_node ON refs(node_id);
CREATE INDEX IF NOT EXISTS idx_refs_type ON refs(type);
CREATE INDEX IF NOT EXISTS idx_walls_node ON walls(node_id);
CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_nodes_status ON nodes(status);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_node ON jobs(node_id);
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
      INSERT INTO nodes (id, parent_id, type, name, status, path, depth, subject, subject_detail, contrast_with, created_at, updated_at)
      VALUES (@id, @parent_id, @type, @name, @status, @path, @depth, @subject, @subject_detail, @contrast_with, @created_at, @updated_at)
    `).run({
      ...node,
      subject: node.subject ?? null,
      subject_detail: node.subject_detail ?? null,
      contrast_with: node.contrast_with ?? null
    });
  }

  updateNodeSubject(id: string, subject: string, subjectDetail?: string): void {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE nodes SET subject = ?, subject_detail = ?, updated_at = ? WHERE id = ?')
      .run(subject, subjectDetail ?? null, now, id);
  }

  getNode(id: string): AidaNode | null {
    return this.db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) as AidaNode ?? null;
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
    return this.db.prepare('SELECT * FROM genome WHERE node_id = ? AND axis = ?').get(nodeId, axis) as (Gene & { family: string; layer: string }) ?? null;
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
    return this.db.prepare("SELECT * FROM passes WHERE status = 'active' ORDER BY id DESC LIMIT 1").get() as Pass ?? null;
  }

  closePass(id: number): void {
    const now = new Date().toISOString();
    this.db.prepare("UPDATE passes SET status = 'closed', closed_at = ? WHERE id = ?").run(now, id);
  }

  // === REFERENCES ===

  addRef(ref: Reference): void {
    this.db.prepare(`
      INSERT INTO refs (id, node_id, type, source, title, description, axes_hint, insights, tags, created_at)
      VALUES (@id, @node_id, @type, @source, @title, @description, @axes_hint, @insights, @tags, @created_at)
    `).run({
      ...ref,
      axes_hint: JSON.stringify(ref.axes_hint),
      insights: JSON.stringify(ref.insights),
      tags: JSON.stringify(ref.tags),
      description: ref.description ?? null
    });
  }

  getRefs(nodeId: string, type?: string): Reference[] {
    let sql = 'SELECT * FROM refs WHERE node_id = ?';
    const params: unknown[] = [nodeId];
    if (type) {
      sql += ' AND type = ?';
      params.push(type);
    }
    sql += ' ORDER BY created_at DESC';
    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(r => ({
      ...r,
      axes_hint: JSON.parse(r.axes_hint || '[]'),
      insights: JSON.parse(r.insights || '[]'),
      tags: JSON.parse(r.tags || '[]')
    }));
  }

  searchRefs(query: string): Reference[] {
    const rows = this.db.prepare(`
      SELECT * FROM refs
      WHERE title LIKE ? OR description LIKE ? OR source LIKE ?
      ORDER BY created_at DESC
    `).all(`%${query}%`, `%${query}%`, `%${query}%`) as any[];
    return rows.map(r => ({
      ...r,
      axes_hint: JSON.parse(r.axes_hint || '[]'),
      insights: JSON.parse(r.insights || '[]'),
      tags: JSON.parse(r.tags || '[]')
    }));
  }

  deleteRef(id: string): void {
    this.db.prepare('DELETE FROM refs WHERE id = ?').run(id);
  }

  // === JOBS ===

  createJob(job: Job): void {
    this.db.prepare(`
      INSERT INTO jobs (id, type, status, node_id, params, result, progress, error, created_at, started_at, completed_at)
      VALUES (@id, @type, @status, @node_id, @params, @result, @progress, @error, @created_at, @started_at, @completed_at)
    `).run({
      ...job,
      params: JSON.stringify(job.params),
      result: job.result ? JSON.stringify(job.result) : null,
      started_at: job.started_at ?? null,
      completed_at: job.completed_at ?? null
    });
  }

  getJob(id: string): Job | null {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as any ?? null;
    if (!row) return null;
    return {
      ...row,
      params: JSON.parse(row.params),
      result: row.result ? JSON.parse(row.result) : null
    };
  }

  getJobs(status?: JobStatus, nodeId?: string): Job[] {
    let sql = 'SELECT * FROM jobs WHERE 1=1';
    const params: unknown[] = [];
    if (status) { sql += ' AND status = ?'; params.push(status); }
    if (nodeId) { sql += ' AND node_id = ?'; params.push(nodeId); }
    sql += ' ORDER BY created_at DESC';
    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(r => ({
      ...r,
      params: JSON.parse(r.params),
      result: r.result ? JSON.parse(r.result) : null
    }));
  }

  updateJobStatus(id: string, status: JobStatus, extra?: { progress?: number; error?: string; result?: Record<string, any> }): void {
    const now = new Date().toISOString();
    let sql = 'UPDATE jobs SET status = ?';
    const params: unknown[] = [status];

    if (status === 'running') {
      sql += ', started_at = ?';
      params.push(now);
    }
    if (status === 'completed' || status === 'failed') {
      sql += ', completed_at = ?';
      params.push(now);
    }
    if (extra?.progress !== undefined) {
      sql += ', progress = ?';
      params.push(extra.progress);
    }
    if (extra?.error !== undefined) {
      sql += ', error = ?';
      params.push(extra.error);
    }
    if (extra?.result !== undefined) {
      sql += ', result = ?';
      params.push(JSON.stringify(extra.result));
    }

    sql += ' WHERE id = ?';
    params.push(id);
    this.db.prepare(sql).run(...params);
  }

  getNextQueuedJob(): Job | null {
    const row = this.db.prepare("SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1").get() as any ?? null;
    if (!row) return null;
    return { ...row, params: JSON.parse(row.params), result: row.result ? JSON.parse(row.result) : null };
  }

  // === QUERIES ===

  /**
   * Clear all data (for rebuild)
   */
  clearAll(): void {
    this.db.exec('DELETE FROM jobs');
    this.db.exec('DELETE FROM comments');
    this.db.exec('DELETE FROM passes');
    this.db.exec('DELETE FROM refs');
    this.db.exec('DELETE FROM variations');
    this.db.exec('DELETE FROM attractors');
    this.db.exec('DELETE FROM walls');
    this.db.exec('DELETE FROM genome');
    this.db.exec('DELETE FROM nodes');
  }

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
