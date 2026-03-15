/**
 * AIDA Store — Orchestrates file (YAML) + DB (SQLite) operations
 *
 * Files are the source of truth. DB is the derived index.
 * All mutations go through the store to keep both in sync.
 */
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { DbManager } from './db-manager.js';
import { resolveGenome, buildPromptFromGenome, buildMoodText } from '../lib/genome-resolver.js';
import type { NodeGenomeData, ResolvedGenome, AxisPromptData } from '../lib/genome-resolver.js';
import type {
  AidaNode, Gene, Genome, Wall, Attractor, Variation, Pass, Reference, Job, JobType, JobStatus,
  NodeStatus, Verdict, Transform, AxisDef, Tweak, DirtyReport
} from '../lib/types.js';

interface StoreConfig {
  treePath: string;
  dbPath: string;
  axesPath: string;
}

interface NodeFile {
  node: {
    id: string;
    name: string;
    type: string;
    parent?: string;
    status: NodeStatus;
    contrast_with?: string;
    coupled_axes?: { axis: string; coupling: 'mirror' }[];
    genome?: {
      universal?: Record<string, { value: number; confidence: number; mode?: string }>;
      custom?: Record<string, { value: number; confidence: number; mode?: string; scope?: string }>;
    };
    transforms?: Transform[];
    walls?: Omit<Wall, 'id' | 'node_id'>[];
    attractors?: Omit<Attractor, 'id' | 'node_id'>[];
  };
}

export class Store {
  private db: DbManager;
  private treePath: string;
  private axesPath: string;
  private axes: Map<string, AxisDef> = new Map();

  constructor(config: StoreConfig) {
    this.treePath = config.treePath;
    this.axesPath = config.axesPath;
    this.db = new DbManager(config.dbPath);
    this.loadAxes();
  }

  close(): void {
    this.db.close();
  }

  // === AXES ===

  private loadAxes(): void {
    // Load universal axes
    const universalPath = path.join(this.axesPath, 'universal.yaml');
    if (fs.existsSync(universalPath)) {
      const content = yaml.load(fs.readFileSync(universalPath, 'utf-8')) as any;
      if (content?.families) {
        for (const [familyId, family] of Object.entries(content.families) as any[]) {
          for (const axis of family.axes || []) {
            this.axes.set(axis.id, {
              ...axis,
              family: familyId,
              layer: 'universal',
              range: axis.range || [0, 1],
              type: axis.type || 'bipolar'
            });
          }
        }
      }
    }

    // Load custom axes
    const customPath = path.join(this.axesPath, 'custom.yaml');
    if (fs.existsSync(customPath)) {
      const content = yaml.load(fs.readFileSync(customPath, 'utf-8')) as any;
      if (content?.axes) {
        for (const axis of content.axes) {
          this.axes.set(axis.id, { ...axis, layer: 'custom' });
        }
      }
    }
  }

  getAxis(id: string): AxisDef | undefined {
    return this.axes.get(id);
  }

  getAllAxes(): AxisDef[] {
    return Array.from(this.axes.values());
  }

  getAxesByFamily(family: string): AxisDef[] {
    return this.getAllAxes().filter(a => a.family === family);
  }

  /**
   * Create a custom axis, persist to custom.yaml, and add to all existing nodes.
   */
  createCustomAxis(axisDef: AxisDef): void {
    if (this.axes.has(axisDef.id)) {
      throw new Error(`Axis "${axisDef.id}" already exists`);
    }

    // Register in memory
    this.axes.set(axisDef.id, axisDef);

    // Persist to custom.yaml
    const customPath = path.join(this.axesPath, 'custom.yaml');
    let content: any = { axes: [] };
    if (fs.existsSync(customPath)) {
      content = yaml.load(fs.readFileSync(customPath, 'utf-8')) as any || { axes: [] };
      if (!content.axes) content.axes = [];
    }

    content.axes.push({
      id: axisDef.id,
      poles: axisDef.poles,
      family: axisDef.family,
      description: axisDef.description,
      distinct_from: axisDef.distinct_from,
      scope: axisDef.scope,
      prompt_map: axisDef.prompt_map
    });

    fs.writeFileSync(customPath, yaml.dump(content, { lineWidth: 120, noRefs: true }));

    // Add to all existing nodes at default value 0.5, confidence 0
    const allNodes = this.db.getAllNodes();
    for (const node of allNodes) {
      this.db.setGene(node.id, {
        axis: axisDef.id,
        value: 0.5,
        confidence: 0,
        mode: 'inherit',
        family: axisDef.family,
        layer: 'custom'
      });
    }
  }

  // === NODE OPERATIONS ===

  /**
   * Initialize universe_root node
   */
  initUniverseRoot(name: string): AidaNode {
    const now = new Date().toISOString();
    const nodeId = 'universe_root';
    const nodePath = '_root';

    // Create directory
    const dirPath = path.join(this.treePath, nodePath);
    fs.mkdirSync(dirPath, { recursive: true });
    fs.mkdirSync(path.join(dirPath, 'variations'), { recursive: true });

    // Create default genome with all universal axes at 0.5
    const genome: Record<string, { value: number; confidence: number; mode: string }> = {};
    for (const axis of this.axes.values()) {
      if (axis.layer === 'universal') {
        genome[axis.id] = { value: 0.5, confidence: 0.0, mode: 'inherit' };
      }
    }

    // Write _node.yaml
    const nodeFile: NodeFile = {
      node: {
        id: nodeId,
        name,
        type: 'universe_root',
        status: 'draft',
        genome: { universal: genome }
      }
    };

    fs.writeFileSync(
      path.join(dirPath, '_node.yaml'),
      yaml.dump(nodeFile, { lineWidth: 120, noRefs: true })
    );

    // Index in DB
    const node: AidaNode = {
      id: nodeId,
      name,
      type: 'universe_root',
      parent_id: null,
      status: 'draft',
      path: nodePath,
      depth: 0,
      created_at: now,
      updated_at: now
    };

    this.db.transaction(() => {
      this.db.createNode(node);

      // Index genome
      for (const [axisId, gene] of Object.entries(genome)) {
        const axisDef = this.axes.get(axisId);
        this.db.setGene(nodeId, {
          axis: axisId,
          value: gene.value,
          confidence: gene.confidence,
          mode: gene.mode as any,
          family: axisDef?.family || 'unknown',
          layer: axisDef?.layer || 'universal'
        });
      }
    });

    return node;
  }

  /**
   * Create a child node under a parent. Inherits parent genome as starting point.
   */
  createChildNode(
    parentId: string,
    id: string,
    name: string,
    type: string,
    transforms?: Transform[]
  ): AidaNode {
    const parent = this.db.getNode(parentId);
    if (!parent) throw new Error(`Parent not found: ${parentId}`);

    const now = new Date().toISOString();
    const nodePath = path.join(parent.path, id);
    const depth = parent.depth + 1;

    // Create directory
    const dirPath = path.join(this.treePath, nodePath);
    fs.mkdirSync(dirPath, { recursive: true });
    fs.mkdirSync(path.join(dirPath, 'variations'), { recursive: true });
    fs.mkdirSync(path.join(dirPath, 'references'), { recursive: true });

    // Inherit parent genome as starting point
    const parentGenome = this.db.getGenome(parentId);
    const genome: Record<string, { value: number; confidence: number; mode: string }> = {};
    for (const g of parentGenome) {
      genome[g.axis] = { value: g.value, confidence: 0, mode: 'inherit' };
    }

    // Write _node.yaml
    const nodeFile: NodeFile = {
      node: {
        id,
        name,
        type,
        parent: parentId,
        status: 'draft',
        genome: { universal: genome },
        transforms: transforms || []
      }
    };

    fs.writeFileSync(
      path.join(dirPath, '_node.yaml'),
      yaml.dump(nodeFile, { lineWidth: 120, noRefs: true })
    );

    // Index in DB
    const node: AidaNode = {
      id,
      name,
      type,
      parent_id: parentId,
      status: 'draft',
      path: nodePath,
      depth,
      created_at: now,
      updated_at: now
    };

    this.db.transaction(() => {
      this.db.createNode(node);
      for (const [axisId, gene] of Object.entries(genome)) {
        const axisDef = this.axes.get(axisId);
        this.db.setGene(id, {
          axis: axisId,
          value: gene.value,
          confidence: gene.confidence,
          mode: gene.mode as any,
          family: axisDef?.family || 'unknown',
          layer: axisDef?.layer || 'universal'
        });
      }
    });

    return node;
  }

  getChildren(parentId: string): AidaNode[] {
    return this.db.getChildren(parentId);
  }

  getNode(id: string): AidaNode | null {
    return this.db.getNode(id);
  }

  /**
   * Build ancestor chain from root to target node (inclusive).
   * Returns array of NodeGenomeData ready for the resolver.
   */
  getAncestorChain(nodeId: string): NodeGenomeData[] {
    const chain: NodeGenomeData[] = [];
    let currentId: string | null = nodeId;

    // Walk up to root
    const nodeIds: string[] = [];
    while (currentId) {
      nodeIds.unshift(currentId);
      const node = this.db.getNode(currentId);
      if (!node) break;
      currentId = node.parent_id;
    }

    // Build NodeGenomeData for each
    for (const nid of nodeIds) {
      const genome = this.db.getGenome(nid);
      const genesMap: Record<string, any> = {};
      for (const g of genome) {
        genesMap[g.axis] = g;
      }

      const nodeFile = this.loadNodeFile(nid);
      const transforms: Transform[] = nodeFile?.node?.transforms || [];
      const walls = this.db.getWalls(nid);

      chain.push({
        node_id: nid,
        genes: genesMap,
        transforms,
        walls
      });
    }

    return chain;
  }

  /**
   * Resolve the effective genome for a node (full inheritance chain + transforms).
   */
  resolveNodeGenome(nodeId: string): ResolvedGenome {
    const chain = this.getAncestorChain(nodeId);

    // Build sibling genomes for mirror transforms
    const node = this.db.getNode(nodeId);
    const siblings = new Map<string, Record<string, number>>();
    if (node?.contrast_with) {
      const siblingGenome = this.db.getGenome(node.contrast_with);
      const siblingMap: Record<string, number> = {};
      for (const g of siblingGenome) siblingMap[g.axis] = g.value;
      siblings.set(node.contrast_with, siblingMap);
    }

    return resolveGenome(chain, siblings);
  }

  /**
   * Get axis prompt data for all axes (evocation + tokens + legacy prompt_map).
   */
  private getAxisPromptData(): Map<string, AxisPromptData> {
    const data = new Map<string, AxisPromptData>();
    for (const axis of this.axes.values()) {
      data.set(axis.id, {
        evocation: axis.evocation,
        tokens: axis.tokens,
        prompt_map: axis.prompt_map
      });
    }
    return data;
  }

  /**
   * Build a generation prompt from a node's resolved genome.
   * Structure: [SUBJECT] + [STYLE evocations] + [WEIGHTED TOKENS]
   *
   * Without a subject, the prompt is style-only (abstract).
   * With a subject, the prompt grounds the style in concrete content.
   */
  buildNodePrompt(nodeId: string, threshold: number = 0.2): string {
    const node = this.db.getNode(nodeId);
    const resolved = this.resolveNodeGenome(nodeId);
    const stylePrompt = buildPromptFromGenome(resolved, this.getAxisPromptData(), threshold);

    if (node?.subject) {
      // Subject first (what), then style (how)
      return `${node.subject}. ${node.subject_detail || ''}. ${stylePrompt}`.replace(/\.\s*\./g, '.').trim();
    }

    return stylePrompt;
  }

  /**
   * Build a mood board text from a node's resolved genome.
   * Evocative descriptions only — for human reading, not for the generator.
   */
  buildNodeMoodText(nodeId: string, threshold: number = 0.2): string {
    const node = this.db.getNode(nodeId);
    const resolved = this.resolveNodeGenome(nodeId);
    const moodText = buildMoodText(resolved, this.getAxisPromptData(), threshold);

    if (node?.subject) {
      return `# ${node.name}\n${node.subject}\n${node.subject_detail || ''}\n\n## Mood\n${moodText}`;
    }

    return moodText;
  }

  /**
   * Update a node's subject (what it IS, not how it looks).
   */
  updateNodeSubject(nodeId: string, subject: string, subjectDetail?: string): void {
    this.db.updateNodeSubject(nodeId, subject, subjectDetail);

    // Sync to YAML
    const nodeFile = this.loadNodeFile(nodeId);
    if (nodeFile) {
      (nodeFile.node as any).subject = subject;
      (nodeFile.node as any).subject_detail = subjectDetail || null;
      this.saveNodeFile(nodeId, nodeFile);
    }
  }

  /**
   * Load full node data from YAML file
   */
  loadNodeFile(nodeId: string): NodeFile | null {
    const node = this.db.getNode(nodeId);
    if (!node) return null;

    const filePath = path.join(this.treePath, node.path, '_node.yaml');
    if (!fs.existsSync(filePath)) return null;

    return yaml.load(fs.readFileSync(filePath, 'utf-8')) as NodeFile;
  }

  /**
   * Save node data back to YAML and sync DB
   */
  saveNodeFile(nodeId: string, data: NodeFile): void {
    const node = this.db.getNode(nodeId);
    if (!node) throw new Error(`Node not found: ${nodeId}`);

    const filePath = path.join(this.treePath, node.path, '_node.yaml');
    fs.writeFileSync(filePath, yaml.dump(data, { lineWidth: 120, noRefs: true }));

    // Sync status to DB
    if (data.node.status !== node.status) {
      this.db.updateNodeStatus(nodeId, data.node.status);
    }

    // Sync genome to DB
    if (data.node.genome?.universal) {
      for (const [axisId, gene] of Object.entries(data.node.genome.universal)) {
        const axisDef = this.axes.get(axisId);
        this.db.setGene(nodeId, {
          axis: axisId,
          value: gene.value,
          confidence: gene.confidence,
          mode: (gene.mode || 'inherit') as any,
          family: axisDef?.family || 'unknown',
          layer: 'universal'
        });
      }
    }
    if (data.node.genome?.custom) {
      for (const [axisId, gene] of Object.entries(data.node.genome.custom)) {
        const axisDef = this.axes.get(axisId);
        this.db.setGene(nodeId, {
          axis: axisId,
          value: gene.value,
          confidence: gene.confidence,
          mode: (gene.mode || 'inherit') as any,
          family: axisDef?.family || 'custom',
          layer: 'custom'
        });
      }
    }
  }

  // === GENOME OPERATIONS ===

  getGenome(nodeId: string): (Gene & { family: string; layer: string })[] {
    return this.db.getGenome(nodeId);
  }

  updateGene(nodeId: string, axis: string, value: number, confidence?: number): void {
    const gene = this.db.getGene(nodeId, axis);
    if (!gene) throw new Error(`Axis ${axis} not found on node ${nodeId}`);

    const newGene = {
      ...gene,
      value: Math.max(0, Math.min(1, value)),
      confidence: confidence !== undefined ? confidence : gene.confidence
    };

    this.db.setGene(nodeId, newGene);

    // Sync to YAML
    const nodeFile = this.loadNodeFile(nodeId);
    if (nodeFile) {
      const genomeSection = gene.layer === 'custom' ? 'custom' : 'universal';
      if (!nodeFile.node.genome) nodeFile.node.genome = {};
      if (!nodeFile.node.genome[genomeSection]) nodeFile.node.genome[genomeSection] = {};
      nodeFile.node.genome[genomeSection]![axis] = {
        value: newGene.value,
        confidence: newGene.confidence,
        mode: newGene.mode
      };
      this.saveNodeFile(nodeId, nodeFile);
    }
  }

  // === VARIATION OPERATIONS ===

  createVariation(nodeId: string, pass: number, promptUsed?: string): Variation {
    const now = new Date().toISOString();
    const existing = this.db.getVariationsForNode(nodeId, pass);
    const varNum = (existing.length + 1).toString().padStart(3, '0');
    const varId = `${nodeId}_p${pass}_v${varNum}`;

    // Snapshot current genome
    const genome = this.db.getGenome(nodeId);
    const snapshot: Record<string, number> = {};
    for (const g of genome) {
      snapshot[g.axis] = g.value;
    }

    const node = this.db.getNode(nodeId);
    if (!node) throw new Error(`Node not found: ${nodeId}`);

    // Create variation directory
    const varDir = path.join(this.treePath, node.path, 'variations', varId);
    fs.mkdirSync(varDir, { recursive: true });

    const variation: Variation = {
      id: varId,
      node_id: nodeId,
      pass,
      genome_snapshot: snapshot,
      rating: null,
      verdict: 'pending',
      notes: null,
      tags: [],
      tweaks: [],
      asset_path: null,
      prompt_used: promptUsed ?? null,
      created_at: now
    };

    // Write meta.yaml
    fs.writeFileSync(
      path.join(varDir, 'meta.yaml'),
      yaml.dump({ variation }, { lineWidth: 120, noRefs: true })
    );

    // Index in DB
    this.db.createVariation(variation);

    return variation;
  }

  rateVariation(varId: string, rating: number, verdict: Verdict, notes?: string, tweaks?: Tweak[]): void {
    this.db.rateVariation(varId, rating, verdict, notes);

    // Load variation to get node and path
    const variation = this.db.getVariation(varId);
    if (!variation) return;

    const node = this.db.getNode(variation.node_id);
    if (!node) return;

    // Update meta.yaml
    const metaPath = path.join(this.treePath, node.path, 'variations', varId, 'meta.yaml');
    if (fs.existsSync(metaPath)) {
      const meta = yaml.load(fs.readFileSync(metaPath, 'utf-8')) as any;
      meta.variation.rating = rating;
      meta.variation.verdict = verdict;
      meta.variation.notes = notes ?? null;
      if (tweaks) meta.variation.tweaks = tweaks;
      fs.writeFileSync(metaPath, yaml.dump(meta, { lineWidth: 120, noRefs: true }));
    }
  }

  getVariationsForNode(nodeId: string, pass?: number): Variation[] {
    return this.db.getVariationsForNode(nodeId, pass);
  }

  // === WALL OPERATIONS ===

  addWall(nodeId: string, axis: string, condition: string, reason: string, propagate: boolean = true, pass?: number): number {
    const wall: Wall = {
      node_id: nodeId,
      axis,
      condition,
      reason,
      propagate,
      pass
    };

    const wallId = this.db.addWall(wall);

    // Sync to YAML
    const nodeFile = this.loadNodeFile(nodeId);
    if (nodeFile) {
      if (!nodeFile.node.walls) nodeFile.node.walls = [];
      nodeFile.node.walls.push({ axis, condition, reason, propagate });
      this.saveNodeFile(nodeId, nodeFile);
    }

    return wallId;
  }

  getWalls(nodeId: string): Wall[] {
    return this.db.getWalls(nodeId);
  }

  getEffectiveWalls(nodeId: string): Wall[] {
    return this.db.getEffectiveWalls(nodeId);
  }

  // === PASS OPERATIONS ===

  startPass(rootNode: string, strategy: 'ab' | 'abc' | 'tournament' | 'contrast' = 'ab'): number {
    return this.db.createPass({
      strategy,
      root_node: rootNode,
      status: 'active',
      created_at: new Date().toISOString(),
      closed_at: null
    });
  }

  getActivePass(): Pass | null {
    return this.db.getActivePass();
  }

  closePass(passId: number): void {
    this.db.closePass(passId);
  }

  // === DIRTY OPERATIONS ===

  /**
   * Mark a node and its descendants as dirty.
   * Axis-aware: computes severity per child based on their transforms.
   *
   * @param changedAxes If provided, only these axes changed — allows
   *   computing per-child severity based on how each child uses those axes.
   */
  dirtySubtree(
    nodeId: string,
    severity: 'minor' | 'major' | 'broken',
    reason: string,
    changedAxes?: string[]
  ): DirtyReport[] {
    const reports: DirtyReport[] = [];

    const markDirty = (nid: string, sev: 'minor' | 'major' | 'broken', parentChangedAxes?: string[]) => {
      const node = this.db.getNode(nid);
      if (!node) return;

      // Don't dirty locked nodes — they need explicit unlock
      if (node.status === 'locked') return;

      // If we know which axes changed, compute severity per child
      let childSev = sev;
      const affectedAxes: string[] = [];

      if (parentChangedAxes && parentChangedAxes.length > 0) {
        const nodeFile = this.loadNodeFile(nid);
        const transforms: Transform[] = nodeFile?.node?.transforms || [];

        // Check how this child uses each changed axis
        let hasInvertOrMirror = false;
        let hasSetOrClamp = false;
        let hasInherit = false;

        for (const axis of parentChangedAxes) {
          // Find which transform applies to this axis
          let axisTransform: string = 'inherit'; // default

          for (const t of transforms) {
            const matchesAxis = t.axes.some(pattern => {
              if (pattern === '*') return !(t.except?.includes(axis));
              if (pattern.endsWith('*')) return axis.startsWith(pattern.slice(0, -1));
              return pattern === axis;
            });
            if (matchesAxis) {
              axisTransform = t.fn;
              break;
            }
          }

          switch (axisTransform) {
            case 'set':
            case 'clamp':
              // Protected — parent change doesn't affect this child on this axis
              hasSetOrClamp = true;
              break;
            case 'invert':
            case 'mirror':
              // Major impact — the result flips
              hasInvertOrMirror = true;
              affectedAxes.push(axis);
              break;
            default:
              // inherit, shift, scale, noise, map — value changes proportionally
              hasInherit = true;
              affectedAxes.push(axis);
              break;
          }
        }

        // Determine severity
        if (affectedAxes.length === 0) {
          // All changed axes are protected by set/clamp — not dirty
          return;
        } else if (hasInvertOrMirror) {
          childSev = 'major';
        } else if (hasInherit) {
          childSev = 'minor';
        }
      }

      const status: NodeStatus = `dirty:${childSev}`;
      this.db.updateNodeStatus(nid, status);

      reports.push({
        node_id: nid,
        severity: childSev,
        reason,
        affected_axes: affectedAxes,
        auto_cleanable: childSev === 'minor'
      });

      // Recurse to children
      const children = this.db.getChildren(nid);
      for (const child of children) {
        markDirty(child.id, childSev === 'broken' ? 'major' : childSev, affectedAxes.length > 0 ? affectedAxes : parentChangedAxes);
      }
    };

    markDirty(nodeId, severity, changedAxes);
    return reports;
  }

  getDirtyReport(): { broken: AidaNode[]; major: AidaNode[]; minor: AidaNode[] } {
    return this.db.getDirtyReport();
  }

  // === SEARCH ===

  searchByAxis(axis: string, min: number, max: number): AidaNode[] {
    return this.db.searchByAxis(axis, min, max);
  }

  getUncertainAxes(nodeId: string, threshold?: number): (Gene & { family: string })[] {
    return this.db.getUncertainAxes(nodeId, threshold);
  }

  // === REFERENCES ===

  addRef(
    nodeId: string,
    type: string,
    source: string,
    title: string,
    description: string | null,
    axesHint: string[],
    insights: string[],
    tags: string[]
  ): Reference {
    const now = new Date().toISOString();
    const existing = this.db.getRefs(nodeId);
    const refNum = (existing.length + 1).toString().padStart(3, '0');
    const refId = `${nodeId}_ref_${refNum}`;

    const ref: Reference = {
      id: refId,
      node_id: nodeId,
      type: type as any,
      source,
      title,
      description,
      axes_hint: axesHint,
      insights,
      tags,
      created_at: now
    };

    this.db.addRef(ref);

    // Also write to refs.yaml in the node directory
    const node = this.db.getNode(nodeId);
    if (node) {
      const refsDir = path.join(this.treePath, node.path, 'references');
      fs.mkdirSync(refsDir, { recursive: true });
      const refFile = path.join(refsDir, `${refId}.yaml`);
      fs.writeFileSync(refFile, yaml.dump({ reference: ref }, { lineWidth: 120, noRefs: true }));
    }

    return ref;
  }

  getRefs(nodeId: string, type?: string): Reference[] {
    return this.db.getRefs(nodeId, type);
  }

  searchRefs(query: string): Reference[] {
    return this.db.searchRefs(query);
  }

  removeRef(refId: string): void {
    this.db.deleteRef(refId);
  }

  // === JOBS ===

  submitJob(type: JobType, nodeId: string, params: Record<string, any>): Job {
    const now = new Date().toISOString();
    const existing = this.db.getJobs(undefined, nodeId);
    const jobNum = (existing.length + 1).toString().padStart(4, '0');
    const jobId = `job_${type}_${jobNum}_${Date.now().toString(36)}`;

    const job: Job = {
      id: jobId,
      type,
      status: 'queued',
      node_id: nodeId,
      params,
      result: null,
      progress: 0,
      error: null,
      created_at: now,
      started_at: null,
      completed_at: null
    };

    this.db.createJob(job);
    return job;
  }

  getJob(id: string): Job | null {
    return this.db.getJob(id);
  }

  getJobs(status?: JobStatus, nodeId?: string): Job[] {
    return this.db.getJobs(status, nodeId);
  }

  updateJobStatus(id: string, status: JobStatus, extra?: { progress?: number; error?: string; result?: Record<string, any> }): void {
    this.db.updateJobStatus(id, status, extra);
  }

  getNextQueuedJob(): Job | null {
    return this.db.getNextQueuedJob();
  }

  /**
   * Collect job results: link completed job outputs to variations/nodes.
   */
  collectJobResults(jobId: string): { collected: boolean; message: string } {
    const job = this.db.getJob(jobId);
    if (!job) return { collected: false, message: `Job not found: ${jobId}` };
    if (job.status !== 'completed') return { collected: false, message: `Job ${jobId} is not completed (status: ${job.status})` };

    // Mark as collected
    this.db.updateJobStatus(jobId, 'collected');

    return { collected: true, message: `Job ${jobId} results collected` };
  }

  // === TREE STATUS ===

  getTreeStatus(): { nodes: AidaNode[]; dirty: { broken: AidaNode[]; major: AidaNode[]; minor: AidaNode[] } } {
    return {
      nodes: this.db.getAllNodes(),
      dirty: this.getDirtyReport()
    };
  }

  // === REBUILD ===

  /**
   * Rebuild DB index from YAML files.
   * Walks the tree directory, parses all _node.yaml and variation meta.yaml,
   * and re-indexes everything into SQLite.
   */
  rebuildIndex(): { nodes: number; variations: number; walls: number } {
    // Drop existing data
    this.db.clearAll();

    let nodeCount = 0;
    let variationCount = 0;
    let wallCount = 0;

    // Walk tree recursively
    const walkTree = (dir: string, parentId: string | null, depth: number) => {
      const nodeYaml = path.join(dir, '_node.yaml');
      if (!fs.existsSync(nodeYaml)) {
        // No _node.yaml at this level — still recurse into subdirectories
        // (handles the tree root directory which has no _node.yaml itself)
        if (fs.existsSync(dir)) {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            if (entry.name === 'variations' || entry.name.startsWith('.') || entry.name === 'references') continue;
            walkTree(path.join(dir, entry.name), parentId, depth);
          }
        }
        return;
      }

      const content = yaml.load(fs.readFileSync(nodeYaml, 'utf-8')) as NodeFile;
      if (!content?.node) return;

      const nodeData = content.node;
      const relativePath = path.relative(this.treePath, dir);
      const now = new Date().toISOString();

      // Index node
      const node: AidaNode = {
        id: nodeData.id,
        name: nodeData.name,
        type: nodeData.type,
        parent_id: parentId,
        status: nodeData.status || 'draft',
        path: relativePath,
        depth,
        contrast_with: nodeData.contrast_with,
        created_at: now,
        updated_at: now
      };

      this.db.createNode(node);
      nodeCount++;

      // Index genome
      if (nodeData.genome?.universal) {
        for (const [axisId, gene] of Object.entries(nodeData.genome.universal)) {
          const axisDef = this.axes.get(axisId);
          this.db.setGene(nodeData.id, {
            axis: axisId,
            value: gene.value,
            confidence: gene.confidence,
            mode: (gene.mode || 'inherit') as any,
            family: axisDef?.family || 'unknown',
            layer: 'universal'
          });
        }
      }
      if (nodeData.genome?.custom) {
        for (const [axisId, gene] of Object.entries(nodeData.genome.custom)) {
          const axisDef = this.axes.get(axisId);
          this.db.setGene(nodeData.id, {
            axis: axisId,
            value: gene.value,
            confidence: gene.confidence,
            mode: (gene.mode || 'inherit') as any,
            family: axisDef?.family || 'custom',
            layer: 'custom'
          });
        }
      }

      // Index walls
      if (nodeData.walls) {
        for (const wall of nodeData.walls) {
          this.db.addWall({
            node_id: nodeData.id,
            axis: wall.axis,
            condition: wall.condition,
            reason: wall.reason,
            propagate: wall.propagate
          });
          wallCount++;
        }
      }

      // Index variations
      const varsDir = path.join(dir, 'variations');
      if (fs.existsSync(varsDir)) {
        for (const varEntry of fs.readdirSync(varsDir, { withFileTypes: true })) {
          if (!varEntry.isDirectory()) continue;
          const metaPath = path.join(varsDir, varEntry.name, 'meta.yaml');
          if (!fs.existsSync(metaPath)) continue;

          const metaContent = yaml.load(fs.readFileSync(metaPath, 'utf-8')) as any;
          if (!metaContent?.variation) continue;

          const v = metaContent.variation;
          this.db.createVariation({
            id: v.id,
            node_id: v.node_id || nodeData.id,
            pass: v.pass || 0,
            genome_snapshot: v.genome_snapshot || {},
            rating: v.rating ?? null,
            verdict: v.verdict || 'pending',
            notes: v.notes ?? null,
            tags: v.tags || [],
            tweaks: v.tweaks || [],
            asset_path: v.asset_path ?? null,
            prompt_used: v.prompt_used ?? null,
            created_at: v.created_at || now
          });
          variationCount++;
        }
      }

      // Recurse into subdirectories (skip 'variations')
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (entry.name === 'variations' || entry.name.startsWith('.')) continue;
        walkTree(path.join(dir, entry.name), nodeData.id, depth + 1);
      }
    };

    this.db.transaction(() => {
      walkTree(this.treePath, null, 0);
    });

    return { nodes: nodeCount, variations: variationCount, walls: wallCount };
  }
}
