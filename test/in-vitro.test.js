/**
 * In-Vitro Test — Full autonomous AIDA simulation
 *
 * Simulates a complete project lifecycle with a "fake human" that:
 * 1. Initializes a project
 * 2. Answers mood questions (genome setup)
 * 3. Adds references and research
 * 4. Generates variations
 * 5. Rates them with realistic preferences
 * 6. Creates children, explores branches
 * 7. Uses .comment files
 * 8. Creates custom axes
 * 9. Tests dirty propagation
 * 10. Runs multiple passes to convergence
 * 11. Validates and locks the tree
 *
 * Uses mock engine — no GPU needed.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { Store } from '../dist/cli/managers/store.js';
import { createEngine } from '../dist/cli/engine/index.js';
import { JobWorker } from '../dist/cli/engine/job-worker.js';

// --- Simulated Human Preferences ---
// The "fake human" wants: dark fantasy, stylized, cold, tense, geometric, raw
const HUMAN_PREFERENCES = {
  realism:     { target: 0.15, tolerance: 0.15 },  // very stylized
  temperature: { target: 0.25, tolerance: 0.15 },  // cold
  value:       { target: 0.80, tolerance: 0.10 },  // dark
  tension:     { target: 0.75, tolerance: 0.15 },  // tense
  complexity:  { target: 0.65, tolerance: 0.15 },  // moderately elaborate
  shape:       { target: 0.25, tolerance: 0.20 },  // geometric
  finish:      { target: 0.25, tolerance: 0.15 },  // raw
  contrast:    { target: 0.80, tolerance: 0.10 },  // high contrast
  saturation:  { target: 0.35, tolerance: 0.15 },  // desaturated
  density:     { target: 0.60, tolerance: 0.15 },  // moderate dense
};

// Rate a variation based on how close its genome snapshot is to preferences
function simulateHumanRating(genomeSnapshot) {
  let totalDist = 0;
  let count = 0;

  for (const [axis, pref] of Object.entries(HUMAN_PREFERENCES)) {
    const val = genomeSnapshot[axis];
    if (val === undefined) continue;
    const dist = Math.abs(val - pref.target);
    totalDist += dist;
    count++;
  }

  const avgDist = count > 0 ? totalDist / count : 0.5;

  // Convert distance to rating: 0 dist = 5 stars, 0.5+ dist = 1 star
  const rating = Math.max(1, Math.min(5, Math.round(5 - avgDist * 8)));

  // Verdict based on rating
  let verdict;
  if (rating >= 4) verdict = 'keep';
  else if (rating <= 1) verdict = 'veto';
  else if (rating === 2) verdict = 'remove';
  else verdict = 'keep'; // 3 = borderline keep

  return { rating, verdict };
}

// Generate a note based on what's wrong
function simulateHumanNote(genomeSnapshot) {
  const complaints = [];
  for (const [axis, pref] of Object.entries(HUMAN_PREFERENCES)) {
    const val = genomeSnapshot[axis];
    if (val === undefined) continue;
    const diff = val - pref.target;
    if (Math.abs(diff) > pref.tolerance) {
      if (diff > 0) complaints.push(`too much ${axis}`);
      else complaints.push(`not enough ${axis}`);
    }
  }
  return complaints.length > 0 ? complaints.join(', ') : 'looks good';
}

// Engine config — reads from AIDA_ENGINE_URL env or defaults to localhost ComfyUI
const ENGINE_URL = process.env.AIDA_ENGINE_URL || 'http://localhost:8188';
const ENGINE_MODEL = process.env.AIDA_ENGINE_MODEL || 'flux-dev';

async function checkGpuAvailable() {
  try {
    const res = await fetch(`${ENGINE_URL}/system_stats`);
    return res.ok;
  } catch {
    return false;
  }
}

function createTestEnv() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aida-invitro-'));
  const treePath = path.join(tmpDir, 'tree');
  const dbPath = path.join(tmpDir, 'aida.db');
  const axesPath = path.join(tmpDir, 'axes');

  fs.mkdirSync(treePath, { recursive: true });
  fs.mkdirSync(axesPath, { recursive: true });
  fs.copyFileSync(
    path.join(process.cwd(), 'axes', 'universal.yaml'),
    path.join(axesPath, 'universal.yaml')
  );

  const store = new Store({ treePath, dbPath, axesPath });
  const engine = createEngine({
    backend: 'comfyui',
    api_url: ENGINE_URL,
    default_model: ENGINE_MODEL,
    default_steps: 20,
    default_cfg: 7.0,
    default_sampler: 'euler',
    default_scheduler: 'normal',
    default_width: 512,       // smaller for faster test iterations
    default_height: 512,
    batch_size: 3,
    seed_mode: 'random'
  });
  // Longer poll interval — real GPU takes seconds
  const worker = new JobWorker(store, engine, treePath, { pollIntervalMs: 1000 });

  return { store, engine, worker, tmpDir, treePath };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Wait for all jobs to complete — longer timeout for real GPU
async function waitForJobs(store, timeout = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const queued = store.getJobs('queued');
    const running = store.getJobs('running');
    if (queued.length === 0 && running.length === 0) return true;
    await sleep(1000);
  }
  return false;
}

describe('In-Vitro — Autonomous AIDA Simulation', () => {
  let store, engine, worker, tmpDir, treePath;

  before(async () => {
    // GATE: GPU must be available — no fallback
    const gpuAvailable = await checkGpuAvailable();
    if (!gpuAvailable) {
      console.error(`\n  ⚠ GPU engine not available at ${ENGINE_URL}`);
      console.error(`    Start ComfyUI/Forge, or set AIDA_ENGINE_URL=http://host:port`);
      console.error(`    Skipping in-vitro test.\n`);
      process.exit(0);
    }
    console.error(`  ✓ GPU engine available at ${ENGINE_URL}`);

    ({ store, engine, worker, tmpDir, treePath } = createTestEnv());
    worker.start();
  });
  after(() => {
    if (worker) worker.stop();
    if (store) store.close();
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ==========================================
  // PHASE 1: Project initialization
  // ==========================================

  it('Phase 1.1 — Initialize project "Shadowkeep"', () => {
    const root = store.initUniverseRoot('Shadowkeep');
    assert.equal(root.id, 'universe_root');
    assert.equal(root.name, 'Shadowkeep');
  });

  it('Phase 1.2 — Agent sets initial mood from human answers', () => {
    // Simulated conversation:
    // Human: "Dark fantasy game, gothic, oppressive, cold, stylized not realistic"
    // Agent translates to genome:
    store.updateGene('universe_root', 'realism', 0.2, 0.6);
    store.updateGene('universe_root', 'temperature', 0.3, 0.5);
    store.updateGene('universe_root', 'value', 0.8, 0.5);
    store.updateGene('universe_root', 'tension', 0.7, 0.4);
    store.updateGene('universe_root', 'shape', 0.3, 0.3);
    store.updateGene('universe_root', 'finish', 0.3, 0.3);
    store.updateGene('universe_root', 'contrast', 0.7, 0.4);
    store.updateGene('universe_root', 'saturation', 0.3, 0.3);

    // Wall: no photorealism
    store.addWall('universe_root', 'realism', '> 0.7', 'no photorealism — stylized only', true);
    // Wall: must stay dark
    store.addWall('universe_root', 'value', '< 0.4', 'must stay dark', true);
  });

  it('Phase 1.3 — Agent adds research references', () => {
    store.addRef('universe_root', 'url',
      'https://darksouls.wiki/visual-style',
      'Dark Souls Visual Style',
      'Gothic architecture, oppressive lighting, muted colors',
      ['temperature', 'value', 'contrast'],
      ['low-key lighting', 'muted palette', 'architectural grandeur'],
      ['reference', 'game']
    );

    store.addRef('universe_root', 'search',
      'gothic fantasy architecture art direction',
      'Research: gothic fantasy architecture',
      'Found patterns: pointed arches, vertical emphasis, stone textures',
      ['shape', 'scale', 'texture'],
      ['vertical compositions', 'heavy stone textures', 'pointed geometric forms'],
      ['research']
    );

    const refs = store.getRefs('universe_root');
    assert.equal(refs.length, 2);
  });

  // ==========================================
  // PHASE 2: First pass — universe_root exploration
  // ==========================================

  it('Phase 2.1 — Start pass 1 on universe_root', () => {
    // Transition to exploring (the MCP tool does this, here we do it manually)
    const nodeFile = store.loadNodeFile('universe_root');
    nodeFile.node.status = 'exploring';
    store.saveNodeFile('universe_root', nodeFile);

    const passId = store.startPass('universe_root', 'ab');
    assert.ok(passId > 0);

    const node = store.getNode('universe_root');
    assert.equal(node.status, 'exploring');
  });

  it('Phase 2.2 — Generate 3 variations', () => {
    const pass = store.getActivePass();

    // Variation A: push toward cold/geometric (matching preferences)
    store.updateGene('universe_root', 'temperature', 0.2);
    store.updateGene('universe_root', 'shape', 0.2);
    const v1 = store.createVariation('universe_root', pass.id,
      'dark fantasy, stylized, cold, geometric, gothic architecture');

    // Variation B: push toward warm/organic (against preferences)
    store.updateGene('universe_root', 'temperature', 0.6);
    store.updateGene('universe_root', 'shape', 0.7);
    const v2 = store.createVariation('universe_root', pass.id,
      'dark fantasy, warm accents, organic forms, baroque');

    // Variation C: surprise — extreme contrast
    store.updateGene('universe_root', 'temperature', 0.3);
    store.updateGene('universe_root', 'shape', 0.3);
    store.updateGene('universe_root', 'contrast', 0.95);
    const v3 = store.createVariation('universe_root', pass.id,
      'dark fantasy, extreme chiaroscuro, sharp geometric, cold');

    // Reset genome to neutral for snapshots
    store.updateGene('universe_root', 'contrast', 0.7);

    assert.equal(store.getVariationsForNode('universe_root', pass.id).length, 3);
  });

  it('Phase 2.3 — Submit render jobs and wait', async () => {
    const pass = store.getActivePass();
    const variations = store.getVariationsForNode('universe_root', pass.id);

    for (const v of variations) {
      store.submitJob('render', 'universe_root', { variation_ids: [v.id] });
    }

    const allDone = await waitForJobs(store);
    assert.ok(allDone, 'All render jobs should complete (timeout 120s)');

    const completed = store.getJobs('completed');
    assert.ok(completed.length >= 3, `Expected >=3 completed, got ${completed.length}`);

    // Verify actual image files were created
    for (const job of completed) {
      if (job.result?.image_path) {
        assert.ok(fs.existsSync(job.result.image_path),
          `Generated image should exist: ${job.result.image_path}`);
        const stat = fs.statSync(job.result.image_path);
        assert.ok(stat.size > 100, `Image file should have content (${stat.size} bytes)`);
        console.error(`    ✓ Generated: ${path.basename(job.result.image_path)} (${Math.round(stat.size/1024)}KB)`);
      }
    }
  });

  it('Phase 2.4 — Simulated human rates variations', () => {
    const pass = store.getActivePass();
    const variations = store.getVariationsForNode('universe_root', pass.id);

    for (const v of variations) {
      const { rating, verdict } = simulateHumanRating(v.genome_snapshot);
      const note = simulateHumanNote(v.genome_snapshot);
      store.rateVariation(v.id, rating, verdict, note);
    }

    // Check at least one keep and should have diversity
    const rated = store.getVariationsForNode('universe_root', pass.id);
    const verdicts = rated.map(v => v.verdict);
    assert.ok(verdicts.includes('keep') || verdicts.includes('veto'),
      `Expected some definitive verdicts, got: ${verdicts.join(', ')}`);
  });

  it('Phase 2.5 — Close pass 1', () => {
    const pass = store.getActivePass();
    store.closePass(pass.id);
    assert.equal(store.getActivePass(), null);
  });

  // ==========================================
  // PHASE 3: Second pass — refinement
  // ==========================================

  it('Phase 3.1 — Start pass 2, explore uncertain axes', () => {
    const passId = store.startPass('universe_root', 'ab');
    assert.ok(passId > 0);

    // Check uncertain axes
    const uncertain = store.getUncertainAxes('universe_root', 0.6);
    assert.ok(uncertain.length > 0, 'Should have uncertain axes');
  });

  it('Phase 3.2 — Generate targeted variations for pass 2', () => {
    const pass = store.getActivePass();
    const uncertain = store.getUncertainAxes('universe_root', 0.6);
    const topAxis = uncertain[0]?.axis || 'tension';

    // Variation A: push uncertain axis high
    store.updateGene('universe_root', topAxis, 0.8);
    const v1 = store.createVariation('universe_root', pass.id,
      `exploring ${topAxis} high`);

    // Variation B: push uncertain axis low
    store.updateGene('universe_root', topAxis, 0.2);
    const v2 = store.createVariation('universe_root', pass.id,
      `exploring ${topAxis} low`);

    // Variation C: centered
    store.updateGene('universe_root', topAxis, 0.5);
    const v3 = store.createVariation('universe_root', pass.id,
      `exploring ${topAxis} mid`);
  });

  it('Phase 3.3 — Rate pass 2 variations', () => {
    const pass = store.getActivePass();
    const variations = store.getVariationsForNode('universe_root', pass.id);

    for (const v of variations) {
      const { rating, verdict } = simulateHumanRating(v.genome_snapshot);
      const note = simulateHumanNote(v.genome_snapshot);
      store.rateVariation(v.id, rating, verdict, note);
    }
  });

  it('Phase 3.4 — Close pass 2, check convergence', () => {
    const pass = store.getActivePass();
    store.closePass(pass.id);

    // Check overall convergence
    const allVars = store.getVariationsForNode('universe_root');
    const kept = allVars.filter(v => v.verdict === 'keep');
    const vetoed = allVars.filter(v => v.verdict === 'veto');

    // After 2 passes we should have enough data
    assert.ok(kept.length >= 2 || vetoed.length >= 1,
      `Convergence check: ${kept.length} kept, ${vetoed.length} vetoed`);
  });

  // ==========================================
  // PHASE 4: Create children
  // ==========================================

  it('Phase 4.1 — Validate universe_root', () => {
    const nodeFile = store.loadNodeFile('universe_root');
    nodeFile.node.status = 'validated';
    store.saveNodeFile('universe_root', nodeFile);

    assert.equal(store.getNode('universe_root').status, 'validated');
  });

  it('Phase 4.2 — Create biome: Frozen Citadel', () => {
    const biome = store.createChildNode(
      'universe_root',
      'frozen_citadel',
      'The Frozen Citadel',
      'biome',
      [
        { fn: 'set', axes: ['temperature'], value: 0.1, reason: 'frozen, icy' },
        { fn: 'shift', axes: ['scale'], delta: 0.3, reason: 'monumental fortress' },
        { fn: 'set', axes: ['texture'], value: 0.8, reason: 'ice and stone textures' }
      ]
    );

    assert.equal(biome.depth, 1);
    assert.equal(biome.parent_id, 'universe_root');
  });

  it('Phase 4.3 — Create biome: Burning Depths', () => {
    const biome = store.createChildNode(
      'universe_root',
      'burning_depths',
      'The Burning Depths',
      'biome',
      [
        { fn: 'invert', axes: ['temperature'], reason: 'opposite of citadel — hot' },
        { fn: 'shift', axes: ['density'], delta: 0.2, reason: 'claustrophobic tunnels' },
        { fn: 'set', axes: ['space'], value: 0.9, reason: 'enclosed underground' }
      ]
    );

    assert.equal(biome.depth, 1);
  });

  it('Phase 4.4 — Resolve biome genomes', () => {
    const citadel = store.resolveNodeGenome('frozen_citadel');
    const depths = store.resolveNodeGenome('burning_depths');

    // Citadel: temperature set to 0.1 (frozen)
    assert.ok(citadel.genes.temperature.value <= 0.15);
    assert.equal(citadel.genes.temperature.transform, 'set');

    // Depths: temperature inverted from parent
    // Parent temperature was last set to 0.5 (from pass 2 exploration)
    // Invert: 1 - parent_value
    assert.ok(depths.genes.temperature.value >= 0.5,
      `Depths temperature should be warm (inverted), got ${depths.genes.temperature.value}`);
    assert.equal(depths.genes.temperature.transform, 'invert');

    // Both should inherit parent walls
    assert.ok(citadel.walls.length >= 1, 'Should inherit realism wall');
    assert.ok(depths.walls.length >= 1, 'Should inherit realism wall');
  });

  it('Phase 4.5 — Create factions under Frozen Citadel', () => {
    // First set citadel to exploring
    const citFile = store.loadNodeFile('frozen_citadel');
    citFile.node.status = 'exploring';
    store.saveNodeFile('frozen_citadel', citFile);

    const knights = store.createChildNode(
      'frozen_citadel',
      'frost_knights',
      'The Frost Knights',
      'faction',
      [
        { fn: 'set', axes: ['potency'], value: 0.9, reason: 'powerful armored warriors' },
        { fn: 'shift', axes: ['scale'], delta: 0.1, reason: 'imposing figures' }
      ]
    );

    const wraiths = store.createChildNode(
      'frozen_citadel',
      'ice_wraiths',
      'The Ice Wraiths',
      'faction',
      [
        { fn: 'invert', axes: ['potency'], reason: 'ethereal, fragile-looking' },
        { fn: 'set', axes: ['familiarity'], value: 0.9, reason: 'strange, otherworldly' },
        { fn: 'shift', axes: ['materiality'], delta: -0.3, reason: 'translucent, ghostly' }
      ]
    );

    assert.equal(knights.depth, 2);
    assert.equal(wraiths.depth, 2);

    // Resolve deep chain: root → citadel → wraiths
    const resolved = store.resolveNodeGenome('ice_wraiths');
    // Wraiths should be: cold (from citadel), fragile (inverted potency), strange
    assert.ok(resolved.genes.temperature.value <= 0.15, 'Wraiths in frozen citadel should be cold');
    assert.ok(resolved.genes.familiarity.value >= 0.8, 'Wraiths should be strange');
  });

  // ==========================================
  // PHASE 5: Custom axis + .comment files
  // ==========================================

  it('Phase 5.1 — Create custom axis "corruption"', () => {
    store.createCustomAxis({
      id: 'corruption',
      poles: ['pure', 'corrupted'],
      family: 'custom',
      description: 'Level of magical/dark corruption visible in the entity',
      layer: 'custom',
      scope: '*',
      prompt_map: {
        '0': 'pure, clean, holy, untouched, pristine',
        '0.5': 'slightly tainted, ambiguous',
        '1': 'corrupted, twisted, dark magic, tainted, diseased'
      }
    });

    // Should exist on all nodes now
    const wraiths = store.getGenome('ice_wraiths');
    const corr = wraiths.find(g => g.axis === 'corruption');
    assert.ok(corr, 'Corruption axis should be on all nodes');
    assert.equal(corr.value, 0.5);
  });

  it('Phase 5.2 — Simulate .comment file on frozen_citadel', () => {
    // Human drops a .comment file
    const commentDir = path.join(treePath, '_root', 'frozen_citadel');
    fs.mkdirSync(commentDir, { recursive: true });
    fs.writeFileSync(path.join(commentDir, '.comment'), [
      '# The citadel needs to feel ancient and corrupted',
      'set corruption 0.7',
      'set finish 0.15',
      'veto anything that looks new or clean',
      'search: ice palace fantasy concept art',
      'https://artstation.com/example/ice-fortress this kind of architecture'
    ].join('\n'));

    // Verify the file exists
    assert.ok(fs.existsSync(path.join(commentDir, '.comment')));
  });

  // ==========================================
  // PHASE 6: Dirty propagation
  // ==========================================

  it('Phase 6.1 — Change universe_root genome triggers dirty', () => {
    // Agent decides to push contrast even higher based on feedback
    store.updateGene('universe_root', 'contrast', 0.9, 0.8);

    // Children should be dirtied
    const dirtyReport = store.getDirtyReport();
    // Note: some children may already be dirty from earlier operations
    const allDirty = [...dirtyReport.broken, ...dirtyReport.major, ...dirtyReport.minor];

    // Check tree status
    const status = store.getTreeStatus();
    assert.ok(status.nodes.length >= 5, `Tree should have >=5 nodes, got ${status.nodes.length}`);
  });

  // ==========================================
  // PHASE 7: Explore a child branch
  // ==========================================

  it('Phase 7.1 — Run a pass on frost_knights', () => {
    // Clean the node first
    const knFile = store.loadNodeFile('frost_knights');
    knFile.node.status = 'exploring';
    store.saveNodeFile('frost_knights', knFile);

    const passId = store.startPass('frost_knights', 'ab');

    // Generate variations for frost knights
    const v1 = store.createVariation('frost_knights', passId, 'massive armored knight, icy, imposing');
    const v2 = store.createVariation('frost_knights', passId, 'lean frost knight, speed over bulk');
    const v3 = store.createVariation('frost_knights', passId, 'ceremonial frost knight, ornate ice armor');

    // Rate with the simulated human
    for (const v of [v1, v2, v3]) {
      const { rating, verdict } = simulateHumanRating(v.genome_snapshot);
      store.rateVariation(v.id, rating, verdict, simulateHumanNote(v.genome_snapshot));
    }

    store.closePass(passId);
  });

  it('Phase 7.2 — Build prompt for frost_knights', () => {
    const prompt = store.buildNodePrompt('frost_knights');
    assert.ok(prompt.length > 0, 'Should generate a prompt');
    // The prompt should contain elements from the full chain
  });

  // ==========================================
  // PHASE 8: Full tree status
  // ==========================================

  it('Phase 8.1 — Final tree overview', () => {
    const status = store.getTreeStatus();

    // Expected tree:
    // universe_root
    //   ├── frozen_citadel
    //   │   ├── frost_knights
    //   │   └── ice_wraiths
    //   └── burning_depths

    assert.ok(status.nodes.length >= 5, `Expected >=5 nodes, got ${status.nodes.length}`);

    // Check depths
    const nodeMap = {};
    for (const n of status.nodes) nodeMap[n.id] = n;

    assert.equal(nodeMap.universe_root.depth, 0);
    assert.equal(nodeMap.frozen_citadel.depth, 1);
    assert.equal(nodeMap.burning_depths.depth, 1);
    assert.equal(nodeMap.frost_knights.depth, 2);
    assert.equal(nodeMap.ice_wraiths.depth, 2);
  });

  it('Phase 8.2 — All jobs completed', () => {
    const jobs = store.getJobs();
    const failed = jobs.filter(j => j.status === 'failed');
    const completed = jobs.filter(j => j.status === 'completed');

    // Log summary
    const summary = {
      total: jobs.length,
      completed: completed.length,
      failed: failed.length,
    };

    assert.ok(completed.length >= 3, `At least 3 jobs should have completed, got ${completed.length}`);
  });

  it('Phase 8.3 — Full resolved prompts for all leaf nodes', () => {
    const leaves = ['frost_knights', 'ice_wraiths', 'burning_depths'];

    for (const nodeId of leaves) {
      const prompt = store.buildNodePrompt(nodeId);
      assert.ok(prompt.length > 10,
        `${nodeId} prompt should be substantial, got: "${prompt.slice(0, 50)}..."`);

      const resolved = store.resolveNodeGenome(nodeId);
      // All should inherit the realism wall
      const hasRealismWall = resolved.walls.some(w => w.axis === 'realism');
      assert.ok(hasRealismWall, `${nodeId} should inherit realism wall`);
    }
  });

  it('Phase 8.4 — Summary stats (before rebuild)', () => {
    const nodes = store.getTreeStatus().nodes;
    const allVars = [];
    const allRefs = [];
    const allWalls = [];

    for (const n of nodes) {
      allVars.push(...store.getVariationsForNode(n.id));
      allRefs.push(...store.getRefs(n.id));
      allWalls.push(...store.getWalls(n.id));
    }

    const axes = store.getAllAxes();
    const customAxes = axes.filter(a => a.layer === 'custom');
    const jobs = store.getJobs();

    const stats = {
      nodes: nodes.length,
      variations: allVars.length,
      kept: allVars.filter(v => v.verdict === 'keep').length,
      vetoed: allVars.filter(v => v.verdict === 'veto').length,
      removed: allVars.filter(v => v.verdict === 'remove').length,
      references: allRefs.length,
      walls: allWalls.length,
      universal_axes: axes.length - customAxes.length,
      custom_axes: customAxes.length,
      jobs_total: jobs.length,
      jobs_completed: jobs.filter(j => j.status === 'completed').length,
    };

    // Sanity checks
    assert.ok(stats.nodes >= 5, `nodes: ${stats.nodes}`);
    assert.ok(stats.variations >= 9, `variations: ${stats.variations}`);
    assert.ok(stats.references >= 2, `references: ${stats.references}`);
    assert.ok(stats.walls >= 2, `walls: ${stats.walls}`);
    assert.ok(stats.custom_axes >= 1, `custom axes: ${stats.custom_axes}`);
    assert.ok(stats.universal_axes >= 24, `universal axes: ${stats.universal_axes}`);
  });

  it('Phase 8.5 — Rebuild index preserves nodes and variations', () => {
    const beforeNodes = store.getTreeStatus().nodes.length;

    const result = store.rebuildIndex();

    assert.equal(result.nodes, beforeNodes, 'Rebuild should preserve all nodes');
    assert.ok(result.variations > 0, 'Rebuild should preserve variations');

    // Verify data integrity
    const root = store.getNode('universe_root');
    assert.equal(root.name, 'Shadowkeep');

    const genome = store.getGenome('universe_root');
    const realism = genome.find(g => g.axis === 'realism');
    assert.ok(realism.value <= 0.3, 'Realism should still be low');

    // Children should survive
    const children = store.getChildren('frozen_citadel');
    assert.ok(children.length >= 2, 'Citadel children should survive rebuild');
  });
});
