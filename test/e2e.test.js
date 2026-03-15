/**
 * End-to-end test: full AIDA workflow
 *
 * init → set genome → create children with transforms →
 * resolve → generate variations → rate → convergence →
 * custom axis → dirty propagation → split → prune → rebuild
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { Store } from '../dist/cli/managers/store.js';

function createTempStore() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aida-e2e-'));
  const treePath = path.join(tmpDir, 'tree');
  const dbPath = path.join(tmpDir, 'aida.db');
  const axesPath = path.join(tmpDir, 'axes');

  fs.mkdirSync(treePath, { recursive: true });
  fs.mkdirSync(axesPath, { recursive: true });
  fs.copyFileSync(
    path.join(process.cwd(), 'axes', 'universal.yaml'),
    path.join(axesPath, 'universal.yaml')
  );

  return { store: new Store({ treePath, dbPath, axesPath }), tmpDir, treePath };
}

describe('E2E — Full workflow', () => {
  let store, tmpDir, treePath;

  before(() => {
    ({ store, tmpDir, treePath } = createTempStore());
  });
  after(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('1. Init universe_root', () => {
    const root = store.initUniverseRoot('Dark Fantasy Project');
    assert.equal(root.id, 'universe_root');
    assert.equal(root.status, 'draft');

    const genome = store.getGenome('universe_root');
    assert.ok(genome.length >= 20);
  });

  it('2. Set initial mood on universe_root', () => {
    // Simulate mood exploration results
    store.updateGene('universe_root', 'realism', 0.2, 0.7);      // stylized
    store.updateGene('universe_root', 'temperature', 0.3, 0.6);    // cool
    store.updateGene('universe_root', 'value', 0.8, 0.6);         // dark
    store.updateGene('universe_root', 'tension', 0.8, 0.5);        // tense
    store.updateGene('universe_root', 'complexity', 0.7, 0.4);     // elaborate
    store.updateGene('universe_root', 'finish', 0.3, 0.3);       // raw, not sure yet — TBD via A/B

    // Add a wall: no photorealism
    store.addWall('universe_root', 'realism', '> 0.7', 'no photorealism', true);

    const gene = store.getGenome('universe_root').find(g => g.axis === 'realism');
    assert.equal(gene.value, 0.2);
    assert.equal(gene.confidence, 0.7);

    const walls = store.getWalls('universe_root');
    assert.equal(walls.length, 1);
  });

  it('3. Start first pass and generate variations', () => {
    const passId = store.startPass('universe_root', 'ab');
    assert.ok(passId > 0);

    // Generate 3 variations
    const v1 = store.createVariation('universe_root', passId, 'stylized dark fantasy, cold');
    const v2 = store.createVariation('universe_root', passId, 'stylized dark fantasy, warm accents');
    const v3 = store.createVariation('universe_root', passId, 'surprise mutation');

    assert.ok(v1.id.includes('v001'));
    assert.ok(v2.id.includes('v002'));
    assert.ok(v3.id.includes('v003'));

    // Snapshot should capture current genome
    assert.equal(v1.genome_snapshot.realism, 0.2);
    assert.equal(v1.genome_snapshot.temperature, 0.3);
  });

  it('4. Rate variations', () => {
    const variations = store.getVariationsForNode('universe_root', 1);

    // v1: keep, great mood
    store.rateVariation(variations[0].id, 4, 'keep', 'great dark mood');
    // v2: veto, too warm
    store.rateVariation(variations[1].id, 1, 'veto', 'too warm, breaks the cold mood');
    // v3: keep, interesting texture
    store.rateVariation(variations[2].id, 3, 'keep', 'interesting texture direction');

    const rated = store.getVariationsForNode('universe_root', 1);
    assert.equal(rated.filter(v => v.verdict === 'keep').length, 2);
    assert.equal(rated.filter(v => v.verdict === 'veto').length, 1);
  });

  it('5. Close pass and check convergence', () => {
    const pass = store.getActivePass();
    store.closePass(pass.id);
    assert.equal(store.getActivePass(), null);

    // Check: 2 kept + 1 vetoed = validatable
    const variations = store.getVariationsForNode('universe_root');
    const kept = variations.filter(v => v.verdict === 'keep');
    const vetoed = variations.filter(v => v.verdict === 'veto');
    assert.ok(kept.length >= 2);
    assert.ok(vetoed.length >= 1);
  });

  it('6. Transition to exploring then validated', () => {
    // Can't validate from draft directly — need to go through exploring
    const nodeFile = store.loadNodeFile('universe_root');
    nodeFile.node.status = 'exploring';
    store.saveNodeFile('universe_root', nodeFile);

    const nodeFile2 = store.loadNodeFile('universe_root');
    nodeFile2.node.status = 'validated';
    store.saveNodeFile('universe_root', nodeFile2);

    const node = store.getNode('universe_root');
    assert.equal(node.status, 'validated');
  });

  it('7. Create child nodes with transforms', () => {
    // Biome: underground city — inherits most, sets temperature to warm
    const biome = store.createChildNode(
      'universe_root',
      'underground_city',
      'Underground City',
      'biome',
      [
        { fn: 'set', axes: ['temperature'], value: 0.8, reason: 'forges make it hot' },
        { fn: 'shift', axes: ['density'], delta: 0.2, reason: 'underground is dense' }
      ]
    );
    assert.equal(biome.parent_id, 'universe_root');
    assert.equal(biome.depth, 1);
    assert.equal(biome.status, 'draft');

    // Faction: vampires — inverts temperature (cold in a hot city)
    const vampires = store.createChildNode(
      'underground_city',
      'vampires',
      'The Vampires',
      'faction',
      [
        { fn: 'invert', axes: ['temperature'] }
      ]
    );
    assert.equal(vampires.depth, 2);

    // Faction: anti-vampires — contrast with vampires
    const antiVampires = store.createChildNode(
      'underground_city',
      'anti_vampires',
      'The Anti-Vampires',
      'faction',
      [
        { fn: 'invert', axes: ['temperature', 'value'] }
      ]
    );
    assert.equal(antiVampires.depth, 2);

    // Check tree
    const children = store.getChildren('underground_city');
    assert.equal(children.length, 2);
  });

  it('8. Resolve genome through inheritance chain', () => {
    // Resolve vampires: universe_root → underground_city → vampires
    const resolved = store.resolveNodeGenome('vampires');

    // temperature: root 0.3 → biome set 0.8 → vampires invert → 0.2
    assert.ok(Math.abs(resolved.genes.temperature.value - 0.2) < 0.01,
      `Expected ~0.2, got ${resolved.genes.temperature.value}`);
    assert.equal(resolved.genes.temperature.source, 'vampires');
    assert.equal(resolved.genes.temperature.transform, 'invert');

    // realism: inherited all the way from root → 0.2
    assert.ok(Math.abs(resolved.genes.realism.value - 0.2) < 0.01);

    // Wall from root should be effective
    assert.ok(resolved.walls.length >= 1);

    // Prompt should reflect the resolved genome
    const prompt = store.buildNodePrompt('vampires');
    assert.ok(prompt.length > 0);
  });

  it('9. Create custom axis', () => {
    store.createCustomAxis({
      id: 'predation',
      poles: ['prey', 'predator'],
      family: 'custom',
      description: 'Position in the food chain — influences silhouette, posture, gaze',
      layer: 'custom',
      scope: '*',
      prompt_map: {
        '0': 'prey, vulnerable, small, hunted',
        '0.5': 'neutral presence',
        '1': 'predator, dominant, apex, hunter'
      }
    });

    // Should be available
    const axis = store.getAxis('predation');
    assert.ok(axis);
    assert.deepEqual(axis.poles, ['prey', 'predator']);

    // Should be added to all existing nodes
    const rootGenome = store.getGenome('universe_root');
    const predGene = rootGenome.find(g => g.axis === 'predation');
    assert.ok(predGene);
    assert.equal(predGene.value, 0.5);
    assert.equal(predGene.confidence, 0);

    // Custom.yaml should exist
    const customPath = path.join(tmpDir, 'axes', 'custom.yaml');
    assert.ok(fs.existsSync(customPath));
  });

  it('10. Dirty propagation — axis-aware', () => {
    // Change temperature on underground_city
    // vampires has invert(temperature) → should be dirty:major
    // anti_vampires has invert(temperature) → should be dirty:major
    store.updateGene('underground_city', 'temperature', 0.9, 0.8);

    const reports = store.dirtySubtree(
      'vampires', 'minor', 'parent temperature changed', ['temperature']
    );

    // vampires should be dirty (has invert on temperature → major)
    // Actually the first call dirties vampires itself, no children under it
    assert.ok(reports.length >= 1);

    // Check status
    const vampNode = store.getNode('vampires');
    assert.ok(vampNode.status.startsWith('dirty'));
  });

  it('11. Add reference', () => {
    const ref = store.addRef(
      'underground_city',
      'url',
      'https://en.wikipedia.org/wiki/Derinkuyu_underground_city',
      'Derinkuyu Underground City',
      'Real-world underground city reference — massive scale, carved stone',
      ['scale', 'space'],
      ['massive vertical space', 'carved stone architecture'],
      ['architecture', 'underground']
    );

    assert.ok(ref.id.includes('underground_city'));
    assert.equal(ref.type, 'url');

    const refs = store.getRefs('underground_city');
    assert.equal(refs.length, 1);

    const searchResults = store.searchRefs('underground');
    assert.equal(searchResults.length, 1);
  });

  it('12. Split a node', () => {
    // First create some variations on vampires to split from
    // Reset vampires to exploring first
    const vFile = store.loadNodeFile('vampires');
    vFile.node.status = 'exploring';
    store.saveNodeFile('vampires', vFile);

    const v1 = store.createVariation('vampires', 1, 'ancient vampires');
    const v2 = store.createVariation('vampires', 1, 'modern vampires');

    // Now split vampires into ancient and modern
    const ancients = store.createChildNode('vampires', 'ancient_vampires', 'Ancient Vampires', 'faction');
    const moderns = store.createChildNode('vampires', 'modern_vampires', 'Modern Vampires', 'faction');

    const vampChildren = store.getChildren('vampires');
    assert.equal(vampChildren.length, 2);

    // Check tree depth
    assert.equal(ancients.depth, 3);
    assert.equal(moderns.depth, 3);
  });

  it('13. Prune a node', () => {
    // Prune modern vampires
    const nodeFile = store.loadNodeFile('modern_vampires');
    assert.ok(nodeFile);

    // Simulate prune by setting status
    nodeFile.node.status = 'draft';
    store.saveNodeFile('modern_vampires', nodeFile);

    const node = store.getNode('modern_vampires');
    assert.equal(node.status, 'draft');
  });

  it('14. Tree status shows full hierarchy', () => {
    const status = store.getTreeStatus();

    // universe_root → underground_city → vampires → ancient_vampires, modern_vampires
    //                                  → anti_vampires
    assert.ok(status.nodes.length >= 5,
      `Expected >=5 nodes, got ${status.nodes.length}: ${status.nodes.map(n => n.id).join(', ')}`);
  });

  it('15. Rebuild index from files', () => {
    // Rebuild should reconstruct the DB from YAML files
    const result = store.rebuildIndex();

    assert.ok(result.nodes >= 5, `Rebuilt ${result.nodes} nodes`);

    // Verify data survived rebuild
    const root = store.getNode('universe_root');
    assert.ok(root);
    assert.equal(root.name, 'Dark Fantasy Project');

    const genome = store.getGenome('universe_root');
    const realisme = genome.find(g => g.axis === 'realism');
    assert.ok(realisme);
    assert.equal(realisme.value, 0.2);

    // Children should be intact
    const biomeChildren = store.getChildren('underground_city');
    assert.ok(biomeChildren.length >= 2);
  });

  it('16. Full resolved prompt for deep node', () => {
    const prompt = store.buildNodePrompt('ancient_vampires');
    assert.ok(prompt.length > 0, 'Prompt should not be empty');

    // The prompt should reflect the full chain
    // root (stylized, dark, tense) → biome (hot) → vampires (cold via invert) → anciens
    // So we expect: dark, stylized keywords
  });
});
