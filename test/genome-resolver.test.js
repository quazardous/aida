import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveGenome, buildPromptFromGenome, buildMoodText } from '../dist/cli/lib/genome-resolver.js';

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
      makeGene('temperature', 0.7),
      makeGene('tension', 0.3),
    ]);

    const result = resolveGenome([root]);

    assert.equal(result.genes.temperature.value, 0.7);
    assert.equal(result.genes.tension.value, 0.3);
    assert.equal(result.genes.temperature.source, 'root');
  });
});

describe('Genome Resolver - Inheritance', () => {
  it('should inherit parent values by default', () => {
    const root = makeNodeData('root', [
      makeGene('temperature', 0.8),
      makeGene('tension', 0.6),
    ]);
    const child = makeNodeData('child', [
      makeGene('temperature', 0.8, 0.5, 'inherit'),
      makeGene('tension', 0.6, 0.5, 'inherit'),
    ]);

    const result = resolveGenome([root, child]);

    assert.equal(result.genes.temperature.value, 0.8);
    assert.equal(result.genes.tension.value, 0.6);
    // Source remains root since child inherits
    assert.equal(result.genes.temperature.source, 'root');
  });
});

describe('Genome Resolver - Transforms', () => {
  it('should apply invert transform', () => {
    const root = makeNodeData('root', [
      makeGene('temperature', 0.8),
      makeGene('tension', 0.6),
    ]);
    const child = makeNodeData('child', [
      makeGene('temperature', 0.8, 0.5, 'inherit'),
      makeGene('tension', 0.6, 0.5, 'inherit'),
    ], [
      { fn: 'invert', axes: ['temperature'] }
    ]);

    const result = resolveGenome([root, child]);

    assert.ok(Math.abs(result.genes.temperature.value - 0.2) < 0.001);
    assert.equal(result.genes.temperature.source, 'child');
    assert.equal(result.genes.temperature.transform, 'invert');
    // tension untouched
    assert.equal(result.genes.tension.value, 0.6);
  });

  it('should apply shift transform', () => {
    const root = makeNodeData('root', [
      makeGene('potency', 0.7),
    ]);
    const child = makeNodeData('child', [
      makeGene('potency', 0.7, 0.5, 'inherit'),
    ], [
      { fn: 'shift', axes: ['potency'], delta: -0.3 }
    ]);

    const result = resolveGenome([root, child]);
    assert.ok(Math.abs(result.genes.potency.value - 0.4) < 0.001);
  });

  it('should apply scale transform', () => {
    const root = makeNodeData('root', [
      makeGene('contrast', 0.6),
    ]);
    const child = makeNodeData('child', [
      makeGene('contrast', 0.6, 0.5, 'inherit'),
    ], [
      { fn: 'scale', axes: ['contrast'], factor: 1.5 }
    ]);

    const result = resolveGenome([root, child]);
    assert.ok(Math.abs(result.genes.contrast.value - 0.9) < 0.001);
  });

  it('should clamp scaled values to [0, 1]', () => {
    const root = makeNodeData('root', [
      makeGene('contrast', 0.8),
    ]);
    const child = makeNodeData('child', [
      makeGene('contrast', 0.8, 0.5, 'inherit'),
    ], [
      { fn: 'scale', axes: ['contrast'], factor: 2.0 }
    ]);

    const result = resolveGenome([root, child]);
    assert.equal(result.genes.contrast.value, 1.0);
  });

  it('should apply clamp transform', () => {
    const root = makeNodeData('root', [
      makeGene('complexity', 0.9),
    ]);
    const child = makeNodeData('child', [
      makeGene('complexity', 0.9, 0.5, 'inherit'),
    ], [
      { fn: 'clamp', axes: ['complexity'], range: [0.3, 0.6] }
    ]);

    const result = resolveGenome([root, child]);
    assert.equal(result.genes.complexity.value, 0.6);
  });

  it('should apply set transform (override)', () => {
    const root = makeNodeData('root', [
      makeGene('temperature', 0.8),
    ]);
    const child = makeNodeData('child', [
      makeGene('temperature', 0.8, 0.5, 'inherit'),
    ], [
      { fn: 'set', axes: ['temperature'], value: 0.2 }
    ]);

    const result = resolveGenome([root, child]);
    assert.equal(result.genes.temperature.value, 0.2);
    assert.equal(result.genes.temperature.source, 'child');
  });

  it('should apply map transform with curve', () => {
    const root = makeNodeData('root', [
      makeGene('value', 0.5),
    ]);
    const child = makeNodeData('child', [
      makeGene('value', 0.5, 0.5, 'inherit'),
    ], [
      { fn: 'map', axes: ['value'], curve: [[0, 0.2], [0.5, 0.8], [1, 0.9]] }
    ]);

    const result = resolveGenome([root, child]);
    assert.ok(Math.abs(result.genes.value.value - 0.8) < 0.001);
  });

  it('should apply transforms with axis patterns', () => {
    const root = makeNodeData('root', [
      makeGene('temperature', 0.8, 0.5, 'inherit', 'color'),
      makeGene('saturation', 0.6, 0.5, 'inherit', 'color'),
      makeGene('tension', 0.7, 0.5, 'inherit', 'perception'),
    ]);
    const child = makeNodeData('child', [
      makeGene('temperature', 0.8, 0.5, 'inherit', 'color'),
      makeGene('saturation', 0.6, 0.5, 'inherit', 'color'),
      makeGene('tension', 0.7, 0.5, 'inherit', 'perception'),
    ], [
      // Invert all axes (wildcard)
      { fn: 'invert', axes: ['*'], except: ['tension'] }
    ]);

    const result = resolveGenome([root, child]);
    assert.ok(Math.abs(result.genes.temperature.value - 0.2) < 0.001);
    assert.ok(Math.abs(result.genes.saturation.value - 0.4) < 0.001);
    assert.equal(result.genes.tension.value, 0.7); // excepted
  });
});

describe('Genome Resolver - Walls', () => {
  it('should detect wall violations', () => {
    const root = makeNodeData('root', [
      makeGene('realism', 0.9),
    ], [], [
      { node_id: 'root', axis: 'realism', condition: '> 0.7', reason: 'no photorealism', propagate: true }
    ]);

    const result = resolveGenome([root]);
    assert.equal(result.violations.length, 1);
    assert.equal(result.violations[0].axis, 'realism');
  });

  it('should accumulate walls from parent', () => {
    const root = makeNodeData('root', [
      makeGene('realism', 0.5),
    ], [], [
      { node_id: 'root', axis: 'realism', condition: '> 0.7', reason: 'no photorealism', propagate: true }
    ]);
    const child = makeNodeData('child', [
      makeGene('realism', 0.5, 0.5, 'inherit'),
    ], [], [
      { node_id: 'child', axis: 'temperature', condition: '< 0.2', reason: 'not too cold', propagate: true }
    ]);

    const result = resolveGenome([root, child]);
    assert.equal(result.walls.length, 2);
  });
});

describe('Genome Resolver - Deep chain', () => {
  it('should resolve 3 levels deep with mixed transforms', () => {
    const root = makeNodeData('root', [
      makeGene('temperature', 0.5),
      makeGene('complexity', 0.5),
      makeGene('tension', 0.5),
    ]);
    const biome = makeNodeData('biome', [
      makeGene('temperature', 0.5, 0.5, 'inherit'),
      makeGene('complexity', 0.5, 0.5, 'inherit'),
      makeGene('tension', 0.5, 0.5, 'inherit'),
    ], [
      { fn: 'set', axes: ['temperature'], value: 0.8 },
      { fn: 'shift', axes: ['complexity'], delta: 0.2 },
    ]);
    const faction = makeNodeData('faction', [
      makeGene('temperature', 0.8, 0.5, 'inherit'),
      makeGene('complexity', 0.7, 0.5, 'inherit'),
      makeGene('tension', 0.5, 0.5, 'inherit'),
    ], [
      { fn: 'invert', axes: ['temperature'] },
    ]);

    const result = resolveGenome([root, biome, faction]);

    // temperature: root 0.5 → biome set 0.8 → faction invert → 0.2
    assert.ok(Math.abs(result.genes.temperature.value - 0.2) < 0.001);
    // complexity: root 0.5 → biome shift +0.2 → 0.7 → faction inherits → 0.7
    assert.ok(Math.abs(result.genes.complexity.value - 0.7) < 0.001);
    // tension: untouched through the chain
    assert.equal(result.genes.tension.value, 0.5);
  });
});

describe('Prompt Builder', () => {
  it('should build prompt with evocation + weighted tokens', () => {
    const root = makeNodeData('root', [
      makeGene('temperature', 0.9, 0.8),
      makeGene('complexity', 0.1, 0.7),
      makeGene('tension', 0.5, 0.2), // near center + low confidence — skipped
    ]);

    const resolved = resolveGenome([root]);

    const axisData = new Map();
    axisData.set('temperature', {
      evocation: {
        '0': 'Frozen stillness, icy blue light',
        '0.5': 'A neutral threshold',
        '1': 'Golden firelight embracing stone walls'
      },
      tokens: {
        low: ['cold', 'icy', 'frost'],
        high: ['warm', 'golden', 'amber']
      }
    });
    axisData.set('complexity', {
      evocation: {
        '0': 'Stripped to its essence, every element earns its place',
        '0.5': 'Enough detail to intrigue',
        '1': 'Layers upon layers of intricate ornamentation'
      },
      tokens: {
        low: ['minimal', 'simple', 'clean'],
        high: ['elaborate', 'intricate', 'ornate']
      }
    });
    axisData.set('tension', {
      evocation: {
        '0': 'Deep calm like still water',
        '0.5': 'A held breath',
        '1': 'Everything vibrating at breaking point'
      },
      tokens: {
        low: ['calm', 'serene'],
        high: ['tense', 'aggressive']
      }
    });

    const prompt = buildPromptFromGenome(resolved, axisData, 0.3);

    // Should contain evocations for temperature (0.9→firelight) and complexity (0.1→essence)
    assert.ok(prompt.includes('firelight'), `Expected "firelight" in: ${prompt}`);
    assert.ok(prompt.includes('essence'), `Expected "essence" in: ${prompt}`);
    // Should contain weighted tokens
    assert.ok(prompt.includes('(warm:'), `Expected weighted warm token in: ${prompt}`);
    assert.ok(prompt.includes('(minimal:'), `Expected weighted minimal token in: ${prompt}`);
    // Tension near center + low confidence — should be skipped
    assert.ok(!prompt.includes('calm'), `Should not include tension (near center): ${prompt}`);
  });

  it('should build mood text (evocations only, no tokens)', () => {
    const root = makeNodeData('root', [
      makeGene('temperature', 0.9, 0.8),
    ]);
    const resolved = resolveGenome([root]);

    const axisData = new Map();
    axisData.set('temperature', {
      evocation: {
        '0': 'Frozen stillness',
        '1': 'Golden firelight'
      },
      tokens: { low: ['cold'], high: ['warm'] }
    });

    const mood = buildMoodText(resolved, axisData, 0.2);
    assert.ok(mood.includes('firelight'));
    assert.ok(!mood.includes('(warm:'), 'Mood text should not include weighted tokens');
  });
});
