import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { Store } from '../dist/cli/managers/store.js';

function createTempStore() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aida-test-'));
  const treePath = path.join(tmpDir, 'tree');
  const dbPath = path.join(tmpDir, 'aida.db');
  const axesPath = path.join(tmpDir, 'axes');

  fs.mkdirSync(treePath, { recursive: true });
  fs.mkdirSync(axesPath, { recursive: true });

  // Copy universal axes
  const srcAxes = path.join(process.cwd(), 'axes', 'universal.yaml');
  fs.copyFileSync(srcAxes, path.join(axesPath, 'universal.yaml'));

  const store = new Store({ treePath, dbPath, axesPath });
  return { store, tmpDir };
}

function cleanupTemp(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

describe('Store - Init', () => {
  let store, tmpDir;

  before(() => {
    ({ store, tmpDir } = createTempStore());
  });
  after(() => {
    store.close();
    cleanupTemp(tmpDir);
  });

  it('should load universal axes', () => {
    const axes = store.getAllAxes();
    assert.ok(axes.length >= 20, `Expected >=20 axes, got ${axes.length}`);

    const shape = store.getAxis('shape');
    assert.ok(shape);
    assert.deepEqual(shape.poles, ['geometric', 'organic']);
    assert.equal(shape.family, 'structure');
    assert.equal(shape.layer, 'universal');
  });

  it('should group axes by family', () => {
    const structure = store.getAxesByFamily('structure');
    assert.ok(structure.length >= 5);

    const color = store.getAxesByFamily('color');
    assert.ok(color.length >= 5);
  });
});

describe('Store - Universe Root', () => {
  let store, tmpDir;

  before(() => {
    ({ store, tmpDir } = createTempStore());
  });
  after(() => {
    store.close();
    cleanupTemp(tmpDir);
  });

  it('should initialize universe_root', () => {
    const node = store.initUniverseRoot('Test Project');

    assert.equal(node.id, 'universe_root');
    assert.equal(node.name, 'Test Project');
    assert.equal(node.type, 'universe_root');
    assert.equal(node.status, 'draft');
    assert.equal(node.depth, 0);
    assert.equal(node.parent_id, null);
  });

  it('should have a full genome at 0.5 / confidence 0', () => {
    const genome = store.getGenome('universe_root');
    assert.ok(genome.length >= 20);

    for (const gene of genome) {
      if (gene.axis === 'dominant_hue') continue; // hue_angle, different default
      assert.equal(gene.value, 0.5, `${gene.axis} should be 0.5`);
      assert.equal(gene.confidence, 0, `${gene.axis} confidence should be 0`);
    }
  });

  it('should persist node to YAML', () => {
    const nodeFile = store.loadNodeFile('universe_root');
    assert.ok(nodeFile);
    assert.equal(nodeFile.node.id, 'universe_root');
    assert.equal(nodeFile.node.name, 'Test Project');
  });

  it('should reject duplicate init', () => {
    assert.throws(() => store.initUniverseRoot('Duplicate'), /UNIQUE constraint/);
  });
});

describe('Store - Genome Operations', () => {
  let store, tmpDir;

  before(() => {
    ({ store, tmpDir } = createTempStore());
    store.initUniverseRoot('Genome Test');
  });
  after(() => {
    store.close();
    cleanupTemp(tmpDir);
  });

  it('should update a gene value', () => {
    store.updateGene('universe_root', 'temperature', 0.8);

    const genome = store.getGenome('universe_root');
    const temp = genome.find(g => g.axis === 'temperature');
    assert.ok(temp);
    assert.equal(temp.value, 0.8);
  });

  it('should update gene confidence', () => {
    store.updateGene('universe_root', 'temperature', 0.8, 0.7);

    const genome = store.getGenome('universe_root');
    const temp = genome.find(g => g.axis === 'temperature');
    assert.equal(temp.confidence, 0.7);
  });

  it('should clamp values to [0, 1]', () => {
    store.updateGene('universe_root', 'contrast', 1.5);
    const genome = store.getGenome('universe_root');
    const c = genome.find(g => g.axis === 'contrast');
    assert.equal(c.value, 1);

    store.updateGene('universe_root', 'contrast', -0.5);
    const genome2 = store.getGenome('universe_root');
    const c2 = genome2.find(g => g.axis === 'contrast');
    assert.equal(c2.value, 0);
  });

  it('should sync gene changes to YAML', () => {
    store.updateGene('universe_root', 'tension', 0.9, 0.6);

    const nodeFile = store.loadNodeFile('universe_root');
    const tensionYaml = nodeFile.node.genome.universal.tension;
    assert.equal(tensionYaml.value, 0.9);
    assert.equal(tensionYaml.confidence, 0.6);
  });

  it('should find uncertain axes', () => {
    // Set some confidences
    store.updateGene('universe_root', 'shape', 0.3, 0.9);
    store.updateGene('universe_root', 'complexity', 0.5, 0.1);

    const uncertain = store.getUncertainAxes('universe_root', 0.5);
    const uncertainIds = uncertain.map(u => u.axis);
    assert.ok(uncertainIds.includes('complexity'));
    assert.ok(!uncertainIds.includes('shape'));
  });
});

describe('Store - Walls', () => {
  let store, tmpDir;

  before(() => {
    ({ store, tmpDir } = createTempStore());
    store.initUniverseRoot('Wall Test');
  });
  after(() => {
    store.close();
    cleanupTemp(tmpDir);
  });

  it('should add a wall', () => {
    const wallId = store.addWall('universe_root', 'realism', '> 0.7', 'no photorealism', true);
    assert.ok(wallId > 0);

    const walls = store.getWalls('universe_root');
    assert.equal(walls.length, 1);
    assert.equal(walls[0].axis, 'realism');
    assert.equal(walls[0].condition, '> 0.7');
  });

  it('should persist wall to YAML', () => {
    const nodeFile = store.loadNodeFile('universe_root');
    assert.ok(nodeFile.node.walls);
    assert.equal(nodeFile.node.walls.length, 1);
    assert.equal(nodeFile.node.walls[0].axis, 'realism');
  });
});

describe('Store - Variations', () => {
  let store, tmpDir;

  before(() => {
    ({ store, tmpDir } = createTempStore());
    store.initUniverseRoot('Variation Test');
  });
  after(() => {
    store.close();
    cleanupTemp(tmpDir);
  });

  it('should create a variation with genome snapshot', () => {
    // Set some genome values first
    store.updateGene('universe_root', 'temperature', 0.7);
    store.updateGene('universe_root', 'tension', 0.8);

    const variation = store.createVariation('universe_root', 1, 'test prompt');

    assert.ok(variation.id.startsWith('universe_root_p1_v'));
    assert.equal(variation.node_id, 'universe_root');
    assert.equal(variation.pass, 1);
    assert.equal(variation.verdict, 'pending');
    assert.equal(variation.genome_snapshot.temperature, 0.7);
    assert.equal(variation.genome_snapshot.tension, 0.8);
  });

  it('should create multiple variations with sequential IDs', () => {
    const v2 = store.createVariation('universe_root', 1);
    const v3 = store.createVariation('universe_root', 1);

    assert.ok(v2.id.includes('v002'));
    assert.ok(v3.id.includes('v003'));
  });

  it('should rate a variation', () => {
    const variations = store.getVariationsForNode('universe_root', 1);
    const v = variations[0];

    store.rateVariation(v.id, 4, 'keep', 'great texture');

    const updated = store.getVariationsForNode('universe_root', 1);
    const rated = updated.find(u => u.id === v.id);
    assert.equal(rated.rating, 4);
    assert.equal(rated.verdict, 'keep');
    assert.equal(rated.notes, 'great texture');
  });

  it('should list variations by pass', () => {
    // Create pass 2 variations
    store.createVariation('universe_root', 2);

    const pass1 = store.getVariationsForNode('universe_root', 1);
    const pass2 = store.getVariationsForNode('universe_root', 2);
    const all = store.getVariationsForNode('universe_root');

    assert.equal(pass1.length, 3);
    assert.equal(pass2.length, 1);
    assert.equal(all.length, 4);
  });
});

describe('Store - Passes', () => {
  let store, tmpDir;

  before(() => {
    ({ store, tmpDir } = createTempStore());
    store.initUniverseRoot('Pass Test');
  });
  after(() => {
    store.close();
    cleanupTemp(tmpDir);
  });

  it('should start a pass', () => {
    const passId = store.startPass('universe_root', 'ab');
    assert.ok(passId > 0);

    const active = store.getActivePass();
    assert.ok(active);
    assert.equal(active.root_node, 'universe_root');
    assert.equal(active.strategy, 'ab');
    assert.equal(active.status, 'active');
  });

  it('should close a pass', () => {
    const active = store.getActivePass();
    store.closePass(active.id);

    const closed = store.getActivePass();
    assert.equal(closed, null);
  });
});

describe('Store - Dirty', () => {
  let store, tmpDir;

  before(() => {
    ({ store, tmpDir } = createTempStore());
    store.initUniverseRoot('Dirty Test');
  });
  after(() => {
    store.close();
    cleanupTemp(tmpDir);
  });

  it('should dirty a node', () => {
    const reports = store.dirtySubtree('universe_root', 'major', 'test dirty');
    assert.equal(reports.length, 1);
    assert.equal(reports[0].severity, 'major');

    const node = store.getNode('universe_root');
    assert.equal(node.status, 'dirty:major');
  });

  it('should report dirty nodes', () => {
    const report = store.getDirtyReport();
    assert.equal(report.major.length, 1);
    assert.equal(report.major[0].id, 'universe_root');
  });

  it('should respect locked nodes', () => {
    // Reset and lock
    const nodeFile = store.loadNodeFile('universe_root');
    nodeFile.node.status = 'locked';
    store.saveNodeFile('universe_root', nodeFile);

    // Try to dirty — should be ignored
    const reports = store.dirtySubtree('universe_root', 'major', 'should not dirty locked');
    assert.equal(reports.length, 0);
  });
});

describe('Store - Tree Status', () => {
  let store, tmpDir;

  before(() => {
    ({ store, tmpDir } = createTempStore());
    store.initUniverseRoot('Tree Test');
  });
  after(() => {
    store.close();
    cleanupTemp(tmpDir);
  });

  it('should return full tree status', () => {
    const status = store.getTreeStatus();
    assert.equal(status.nodes.length, 1);
    assert.equal(status.nodes[0].id, 'universe_root');
    assert.ok(status.dirty);
  });

  it('should search by axis value', () => {
    store.updateGene('universe_root', 'temperature', 0.9);
    const results = store.searchByAxis('temperature', 0.8, 1.0);
    assert.equal(results.length, 1);

    const noResults = store.searchByAxis('temperature', 0.0, 0.3);
    assert.equal(noResults.length, 0);
  });
});

describe('Store - Jobs', () => {
  let store, tmpDir;

  before(() => {
    ({ store, tmpDir } = createTempStore());
    store.initUniverseRoot('Job Test');
  });
  after(() => {
    store.close();
    cleanupTemp(tmpDir);
  });

  it('should submit a job', () => {
    const job = store.submitJob('render', 'universe_root', {
      variation_ids: ['v001'],
      negative_prompt: 'blurry'
    });
    assert.ok(job.id.startsWith('job_render_'));
    assert.equal(job.status, 'queued');
    assert.equal(job.node_id, 'universe_root');
    assert.equal(job.progress, 0);
    assert.deepEqual(job.params.variation_ids, ['v001']);
  });

  it('should list jobs', () => {
    const jobs = store.getJobs();
    assert.equal(jobs.length, 1);

    const queued = store.getJobs('queued');
    assert.equal(queued.length, 1);

    const running = store.getJobs('running');
    assert.equal(running.length, 0);
  });

  it('should update job status with progress', () => {
    const jobs = store.getJobs();
    const jobId = jobs[0].id;

    store.updateJobStatus(jobId, 'running', { progress: 30 });
    const running = store.getJob(jobId);
    assert.equal(running.status, 'running');
    assert.equal(running.progress, 30);
    assert.ok(running.started_at);
  });

  it('should complete job with result', () => {
    const jobs = store.getJobs('running');
    const jobId = jobs[0].id;

    store.updateJobStatus(jobId, 'completed', {
      progress: 100,
      result: { image_path: '/tmp/output.png', seed: 42 }
    });

    const completed = store.getJob(jobId);
    assert.equal(completed.status, 'completed');
    assert.equal(completed.progress, 100);
    assert.ok(completed.completed_at);
    assert.equal(completed.result.seed, 42);
  });

  it('should collect job results', () => {
    const jobs = store.getJobs('completed');
    const result = store.collectJobResults(jobs[0].id);
    assert.equal(result.collected, true);

    const collected = store.getJob(jobs[0].id);
    assert.equal(collected.status, 'collected');
  });

  it('should persist across getJob calls (simulates session resume)', () => {
    // Submit another job
    const job = store.submitJob('lora_train', 'universe_root', {
      base_model: 'flux-dev', steps: 1000, lr: 0.0001
    });

    // "Simulate session break" — just get the job by ID
    const retrieved = store.getJob(job.id);
    assert.equal(retrieved.type, 'lora_train');
    assert.equal(retrieved.status, 'queued');
    assert.equal(retrieved.params.steps, 1000);
  });

  it('should get next queued job', () => {
    const next = store.getNextQueuedJob();
    assert.ok(next);
    assert.equal(next.status, 'queued');
    assert.equal(next.type, 'lora_train');
  });
});
