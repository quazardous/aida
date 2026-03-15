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
import type {
  AidaNode, Gene, Genome, Wall, Attractor, Variation, Pass, Reference,
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

  getNode(id: string): AidaNode | null {
    return this.db.getNode(id);
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
   * Mark a node and its descendants as dirty
   */
  dirtySubtree(nodeId: string, severity: 'minor' | 'major' | 'broken', reason: string): DirtyReport[] {
    const reports: DirtyReport[] = [];

    const markDirty = (nid: string, sev: 'minor' | 'major' | 'broken') => {
      const node = this.db.getNode(nid);
      if (!node) return;

      // Don't dirty locked nodes — they need explicit unlock
      if (node.status === 'locked') return;

      const status: NodeStatus = `dirty:${sev}`;
      this.db.updateNodeStatus(nid, status);

      reports.push({
        node_id: nid,
        severity: sev,
        reason,
        affected_axes: [],
        auto_cleanable: sev === 'minor'
      });

      // Recurse to children (severity can attenuate)
      const children = this.db.getChildren(nid);
      for (const child of children) {
        markDirty(child.id, sev === 'broken' ? 'major' : sev);
      }
    };

    markDirty(nodeId, severity);
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
      if (!fs.existsSync(nodeYaml)) return;

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
