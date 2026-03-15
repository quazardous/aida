import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveGenome, buildPromptFromGenome } from '../dist/cli/lib/genome-resolver.js';

function makeGene(axis, value, confidence = 0.5, mode = 'inherit', family = 'test', layer = 'universal') {
  return { axis, value, confidence, mode, family, layer };
}

function makeNodeData(id, genes, transforms = [], walls = []) {
  const genesMap = {};
  for (const g of genes) genesMap[g.axis] = g;
  return { node_id: id, genes: genesMap, transforms, walls };
}

describe('Genome Resolver - Single node (root)', () => {
  it('should return root genome as-is', () => {
    const root = makeNodeData('root', [
      makeGene('température', 0.7),
      makeGene('tension', 0.3),
    ]);

    const result = resolveGenome([root]);

    assert.equal(result.genes.température.value, 0.7);
    assert.equal(result.genes.tension.value, 0.3);
    assert.equal(result.genes.température.source, 'root');
  });
});

describe('Genome Resolver - Inheritance', () => {
  it('should inherit parent values by default', () => {
    const root = makeNodeData('root', [
      makeGene('température', 0.8),
      makeGene('tension', 0.6),
    ]);
    const child = makeNodeData('child', [
      makeGene('température', 0.8, 0.5, 'inherit'),
      makeGene('tension', 0.6, 0.5, 'inherit'),
    ]);

    const result = resolveGenome([root, child]);

    assert.equal(result.genes.température.value, 0.8);
    assert.equal(result.genes.tension.value, 0.6);
    // Source remains root since child inherits
    assert.equal(result.genes.température.source, 'root');
  });
});

describe('Genome Resolver - Transforms', () => {
  it('should apply invert transform', () => {
    const root = makeNodeData('root', [
      makeGene('température', 0.8),
      makeGene('tension', 0.6),
    ]);
    const child = makeNodeData('child', [
      makeGene('température', 0.8, 0.5, 'inherit'),
      makeGene('tension', 0.6, 0.5, 'inherit'),
    ], [
      { fn: 'invert', axes: ['température'] }
    ]);

    const result = resolveGenome([root, child]);

    assert.ok(Math.abs(result.genes.température.value - 0.2) < 0.001);
    assert.equal(result.genes.température.source, 'child');
    assert.equal(result.genes.température.transform, 'invert');
    // tension untouched
    assert.equal(result.genes.tension.value, 0.6);
  });

  it('should apply shift transform', () => {
    const root = makeNodeData('root', [
      makeGene('puissance', 0.7),
    ]);
    const child = makeNodeData('child', [
      makeGene('puissance', 0.7, 0.5, 'inherit'),
    ], [
      { fn: 'shift', axes: ['puissance'], delta: -0.3 }
    ]);

    const result = resolveGenome([root, child]);
    assert.ok(Math.abs(result.genes.puissance.value - 0.4) < 0.001);
  });

  it('should apply scale transform', () => {
    const root = makeNodeData('root', [
      makeGene('contraste', 0.6),
    ]);
    const child = makeNodeData('child', [
      makeGene('contraste', 0.6, 0.5, 'inherit'),
    ], [
      { fn: 'scale', axes: ['contraste'], factor: 1.5 }
    ]);

    const result = resolveGenome([root, child]);
    assert.ok(Math.abs(result.genes.contraste.value - 0.9) < 0.001);
  });

  it('should clamp scaled values to [0, 1]', () => {
    const root = makeNodeData('root', [
      makeGene('contraste', 0.8),
    ]);
    const child = makeNodeData('child', [
      makeGene('contraste', 0.8, 0.5, 'inherit'),
    ], [
      { fn: 'scale', axes: ['contraste'], factor: 2.0 }
    ]);

    const result = resolveGenome([root, child]);
    assert.equal(result.genes.contraste.value, 1.0);
  });

  it('should apply clamp transform', () => {
    const root = makeNodeData('root', [
      makeGene('complexité', 0.9),
    ]);
    const child = makeNodeData('child', [
      makeGene('complexité', 0.9, 0.5, 'inherit'),
    ], [
      { fn: 'clamp', axes: ['complexité'], range: [0.3, 0.6] }
    ]);

    const result = resolveGenome([root, child]);
    assert.equal(result.genes.complexité.value, 0.6);
  });

  it('should apply set transform (override)', () => {
    const root = makeNodeData('root', [
      makeGene('température', 0.8),
    ]);
    const child = makeNodeData('child', [
      makeGene('température', 0.8, 0.5, 'inherit'),
    ], [
      { fn: 'set', axes: ['température'], value: 0.2 }
    ]);

    const result = resolveGenome([root, child]);
    assert.equal(result.genes.température.value, 0.2);
    assert.equal(result.genes.température.source, 'child');
  });

  it('should apply map transform with curve', () => {
    const root = makeNodeData('root', [
      makeGene('valeur', 0.5),
    ]);
    const child = makeNodeData('child', [
      makeGene('valeur', 0.5, 0.5, 'inherit'),
    ], [
      { fn: 'map', axes: ['valeur'], curve: [[0, 0.2], [0.5, 0.8], [1, 0.9]] }
    ]);

    const result = resolveGenome([root, child]);
    assert.ok(Math.abs(result.genes.valeur.value - 0.8) < 0.001);
  });

  it('should apply transforms with axis patterns', () => {
    const root = makeNodeData('root', [
      makeGene('température', 0.8, 0.5, 'inherit', 'color'),
      makeGene('saturation', 0.6, 0.5, 'inherit', 'color'),
      makeGene('tension', 0.7, 0.5, 'inherit', 'perception'),
    ]);
    const child = makeNodeData('child', [
      makeGene('température', 0.8, 0.5, 'inherit', 'color'),
      makeGene('saturation', 0.6, 0.5, 'inherit', 'color'),
      makeGene('tension', 0.7, 0.5, 'inherit', 'perception'),
    ], [
      // Invert all axes (wildcard)
      { fn: 'invert', axes: ['*'], except: ['tension'] }
    ]);

    const result = resolveGenome([root, child]);
    assert.ok(Math.abs(result.genes.température.value - 0.2) < 0.001);
    assert.ok(Math.abs(result.genes.saturation.value - 0.4) < 0.001);
    assert.equal(result.genes.tension.value, 0.7); // excepted
  });
});

describe('Genome Resolver - Walls', () => {
  it('should detect wall violations', () => {
    const root = makeNodeData('root', [
      makeGene('réalisme', 0.9),
    ], [], [
      { node_id: 'root', axis: 'réalisme', condition: '> 0.7', reason: 'no photorealism', propagate: true }
    ]);

    const result = resolveGenome([root]);
    assert.equal(result.violations.length, 1);
    assert.equal(result.violations[0].axis, 'réalisme');
  });

  it('should accumulate walls from parent', () => {
    const root = makeNodeData('root', [
      makeGene('réalisme', 0.5),
    ], [], [
      { node_id: 'root', axis: 'réalisme', condition: '> 0.7', reason: 'no photorealism', propagate: true }
    ]);
    const child = makeNodeData('child', [
      makeGene('réalisme', 0.5, 0.5, 'inherit'),
    ], [], [
      { node_id: 'child', axis: 'température', condition: '< 0.2', reason: 'not too cold', propagate: true }
    ]);

    const result = resolveGenome([root, child]);
    assert.equal(result.walls.length, 2);
  });
});

describe('Genome Resolver - Deep chain', () => {
  it('should resolve 3 levels deep with mixed transforms', () => {
    const root = makeNodeData('root', [
      makeGene('température', 0.5),
      makeGene('complexité', 0.5),
      makeGene('tension', 0.5),
    ]);
    const biome = makeNodeData('biome', [
      makeGene('température', 0.5, 0.5, 'inherit'),
      makeGene('complexité', 0.5, 0.5, 'inherit'),
      makeGene('tension', 0.5, 0.5, 'inherit'),
    ], [
      { fn: 'set', axes: ['température'], value: 0.8 },
      { fn: 'shift', axes: ['complexité'], delta: 0.2 },
    ]);
    const faction = makeNodeData('faction', [
      makeGene('température', 0.8, 0.5, 'inherit'),
      makeGene('complexité', 0.7, 0.5, 'inherit'),
      makeGene('tension', 0.5, 0.5, 'inherit'),
    ], [
      { fn: 'invert', axes: ['température'] },
    ]);

    const result = resolveGenome([root, biome, faction]);

    // température: root 0.5 → biome set 0.8 → faction invert → 0.2
    assert.ok(Math.abs(result.genes.température.value - 0.2) < 0.001);
    // complexité: root 0.5 → biome shift +0.2 → 0.7 → faction inherits → 0.7
    assert.ok(Math.abs(result.genes.complexité.value - 0.7) < 0.001);
    // tension: untouched through the chain
    assert.equal(result.genes.tension.value, 0.5);
  });
});

describe('Prompt Builder', () => {
  it('should build prompt from resolved genome', () => {
    const root = makeNodeData('root', [
      makeGene('température', 0.9, 0.8),
      makeGene('complexité', 0.1, 0.7),
      makeGene('tension', 0.5, 0.2), // near center + low confidence — skipped
    ]);

    const resolved = resolveGenome([root]);

    const promptMaps = new Map();
    promptMaps.set('température', {
      '0': 'cool colors, blue, icy',
      '0.5': 'neutral temperature',
      '1': 'warm colors, amber, golden'
    });
    promptMaps.set('complexité', {
      '0': 'minimal, simple, clean',
      '0.5': 'moderate detail',
      '1': 'elaborate, intricate, ornate'
    });
    promptMaps.set('tension', {
      '0': 'calm, serene',
      '0.5': 'moderate energy',
      '1': 'tense, aggressive'
    });

    const prompt = buildPromptFromGenome(resolved, promptMaps, 0.3);

    assert.ok(prompt.includes('warm'));
    assert.ok(prompt.includes('minimal'));
    assert.ok(!prompt.includes('moderate energy')); // skipped — near center
  });
});
