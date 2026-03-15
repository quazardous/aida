/**
 * In-Vitro Test — Fully autonomous AIDA simulation
 *
 * Picks a random quote, interprets it as an artistic brief,
 * generates real images via GPU, rates them autonomously,
 * builds a tree, and converges toward a coherent DA.
 *
 * All output in ./var/in-vitro/ — inspect images after the run.
 * Requires real GPU (ComfyUI/Forge). No mock fallback.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { Store } from '../dist/cli/managers/store.js';
import { createEngine } from '../dist/cli/engine/index.js';
import { JobWorker } from '../dist/cli/engine/job-worker.js';

// ============================================================
// QUOTES — random starting point for the DA
// ============================================================
const QUOTES = [
  {
    text: "In the middle of difficulty lies opportunity", author: "Einstein",
    universe: { subject: "A vast underground forge city", detail: "Stone halls lit by rivers of molten metal, massive cogwheel mechanisms, bridges over lava channels, workers in heat-resistant armor" },
    branches: [
      { id: "forge_heart", name: "The Forge Heart", subject: "The central foundry chamber", detail: "A cathedral-sized hall where the main furnace burns, molten metal cascading down carved stone channels, the air thick with sparks and heat shimmer" },
      { id: "crystal_mines", name: "The Crystal Mines", subject: "Deep crystal mining tunnels", detail: "Narrow passages carved through veins of luminescent crystal, the walls themselves glow faintly, mining equipment abandoned among the formations" }
    ]
  },
  {
    text: "The only way out is through", author: "Robert Frost",
    universe: { subject: "A frozen mountain pass", detail: "A treacherous path cutting through ice-covered peaks, ancient stone markers half-buried in snow, the remains of old caravans scattered along the trail" },
    branches: [
      { id: "ice_gate", name: "The Ice Gate", subject: "A massive frozen gateway", detail: "Two colossal ice-covered pillars framing a narrow passage, runes carved deep into the frost, icicles hanging like teeth from the arch above" },
      { id: "warm_cave", name: "The Warm Cave", subject: "A geothermal cave shelter", detail: "A hidden cave warmed by hot springs, steam rising from turquoise pools, moss and ferns growing in the warmth, a traveler's refuge" }
    ]
  },
  {
    text: "Between the idea and the reality falls the shadow", author: "T.S. Eliot",
    universe: { subject: "A library that exists between dimensions", detail: "Impossible architecture of floating bookshelves, staircases that lead to other realities, light filtering through pages as if through stained glass" },
    branches: [
      { id: "reading_room", name: "The Reading Room", subject: "The central reading chamber", detail: "A circular room where books float in orbits around a central light, readers sitting in suspended chairs, shadows of text projected on the domed ceiling" },
      { id: "shadow_stacks", name: "The Shadow Stacks", subject: "The forbidden archive wing", detail: "Shelves stretching into darkness, books chained to their places, the air cold and the light retreating, whispers emanating from closed volumes" }
    ]
  },
  {
    text: "We are such stuff as dreams are made on", author: "Shakespeare",
    universe: { subject: "A floating island above the clouds", detail: "An island of white stone and flowering trees suspended in golden sky, waterfalls pouring off the edges into mist, delicate bridges connecting smaller floating rocks" },
    branches: [
      { id: "cloud_garden", name: "The Cloud Garden", subject: "A garden growing in open sky", detail: "Terraced gardens on the island's edge, plants with translucent petals catching sunlight, roots growing down into empty air, butterflies made of light" },
      { id: "dream_tower", name: "The Dream Tower", subject: "A tall crystalline spire", detail: "A tower of faceted crystal rising from the island's center, each facet reflecting a different sky, the interior spiraling upward through rooms of shifting color" }
    ]
  },
  {
    text: "The universe is under no obligation to make sense to you", author: "Tyson",
    universe: { subject: "A deep space observation station", detail: "A brutalist concrete structure floating in the void, massive telescope arrays pointed at impossible nebulae, interior corridors lit by the glow of unknown stars" },
    branches: [
      { id: "observation_deck", name: "The Observation Deck", subject: "The main viewing platform", detail: "A glass-floored platform over the void, control panels flickering with alien data, chairs facing an overwhelming vista of colliding galaxies" },
      { id: "signal_room", name: "The Signal Room", subject: "The radio telescope control center", detail: "Banks of analog equipment receiving signals from dead civilizations, oscilloscope screens dancing with patterns, magnetic tape reels spinning slowly" }
    ]
  },
  {
    text: "All that glitters is not gold", author: "Shakespeare",
    universe: { subject: "An opulent merchant palace hiding rot", detail: "A Renaissance palazzo with gilded facades and marble columns, but the gold is peeling, the marble cracked, weeds pushing through the courtyard tiles" },
    branches: [
      { id: "throne_room", name: "The Throne Room", subject: "The grand reception hall", detail: "A vast hall with a golden throne on a raised dais, chandeliers of crystal, frescoed ceilings — but cobwebs in the corners and dust on every surface" },
      { id: "cellar", name: "The Cellar", subject: "The hidden basement", detail: "Damp stone vaults below the palace, the real machinery of power: forged documents, hidden passages, rats running between barrels of counterfeit coins" }
    ]
  },
  {
    text: "In a dark time, the eye begins to see", author: "Roethke",
    universe: { subject: "A lighthouse on a storm-battered cliff", detail: "A solitary lighthouse of dark stone perched on eroding cliffs, the beam cutting through rain and spray, the sea raging below, a keeper's cottage clinging to the rock" },
    branches: [
      { id: "lantern_room", name: "The Lantern Room", subject: "The lighthouse lamp chamber", detail: "The glass-enclosed room at the top, the massive Fresnel lens rotating slowly, prisms splitting light into rainbows on the walls, the storm visible in every direction" },
      { id: "shore_wreck", name: "The Shore Wreck", subject: "A shipwreck on the rocks below", detail: "The broken hull of a wooden ship wedged between boulders, barnacles and kelp covering the timber, the figurehead still visible, waves crashing through the ribs" }
    ]
  },
  {
    text: "The wound is the place where the light enters you", author: "Rumi",
    universe: { subject: "An ancient temple split by an earthquake", detail: "A stone temple cracked open by a geological fault, golden light pouring through the fracture, vines and flowers growing in the breach, the sacred and the broken coexisting" },
    branches: [
      { id: "inner_sanctum", name: "The Inner Sanctum", subject: "The fractured holy chamber", detail: "The deepest room of the temple, split in two by the fault, sunlight streaming through the crack onto a stone altar, moss and golden wildflowers growing from the break" },
      { id: "healing_pool", name: "The Healing Pool", subject: "A natural pool formed in the ruins", detail: "Water collected in a basin formed by collapsed walls, clear and still, reflecting the broken ceiling and the sky beyond, offerings floating on the surface" }
    ]
  },
  {
    text: "Not all those who wander are lost", author: "Tolkien",
    universe: { subject: "A crossroads in an ancient forest", detail: "A meeting of paths in a dense old-growth forest, weathered stone markers covered in moss, shafts of light piercing the canopy, the sense of many travelers having passed" },
    branches: [
      { id: "old_bridge", name: "The Old Bridge", subject: "A crumbling stone bridge over a ravine", detail: "A single-arch bridge of fitted stone spanning a deep gorge, tree roots growing through the masonry, mist rising from the river far below, a lantern hanging from a post" },
      { id: "wayshrine", name: "The Wayshrine", subject: "A small roadside shrine", detail: "A weathered stone alcove sheltering a carved figure, offerings of coins and wildflowers, a worn bench for travelers, lichen and moss softening every edge" }
    ]
  },
  {
    text: "We look at the world once in childhood. The rest is memory", author: "Glück",
    universe: { subject: "An abandoned schoolhouse in a field", detail: "A small wooden schoolhouse standing alone in an overgrown meadow, paint peeling, windows broken, a rusted bell in the tower, wildflowers growing through the porch boards" },
    branches: [
      { id: "classroom", name: "The Classroom", subject: "The main teaching room", detail: "Rows of small wooden desks facing a chalkboard with faded writing, a globe with countries that no longer exist, sunlight falling on dust motes, a forgotten coat on a hook" },
      { id: "playground", name: "The Playground", subject: "The overgrown schoolyard", detail: "A rusted swing set and a tilted seesaw in tall grass, a hopscotch grid still faintly visible on cracked concrete, a ball wedged under a bush, the fence half-fallen" }
    ]
  },
  {
    text: "The sea is everything", author: "Jules Verne",
    universe: { subject: "A submarine exploration vessel", detail: "A brass and glass submersible hovering over an ocean trench, bioluminescent creatures drifting past the portholes, the vessel's searchlight illuminating ancient coral formations" },
    branches: [
      { id: "bridge", name: "The Bridge", subject: "The submarine command center", detail: "A circular room of polished brass and riveted steel, a panoramic viewport showing the deep ocean, navigation instruments glowing amber, a captain's chair bolted to the deck" },
      { id: "abyss_window", name: "The Abyss Window", subject: "The deep observation blister", detail: "A transparent dome at the vessel's belly, nothing but black water below, occasional flashes of bioluminescence, the pressure groaning against the glass" }
    ]
  },
  {
    text: "There is a crack in everything, that's how the light gets in", author: "Leonard Cohen",
    universe: { subject: "A walled city with light breaking through", detail: "A dense medieval city of stone walls and narrow streets, but cracks in every surface letting golden light pour through, as if the city is a shell around something luminous" },
    branches: [
      { id: "market_square", name: "The Market Square", subject: "The central market plaza", detail: "A cobblestone square surrounded by leaning buildings, market stalls with torn awnings, light streaming through cracks in the walls and between roof tiles, casting golden patterns on everything" },
      { id: "cathedral_ruin", name: "The Cathedral Ruin", subject: "The broken cathedral", detail: "A gothic cathedral with its roof collapsed, the remaining walls and pillars framing open sky, light flooding the nave through the destruction, wildflowers growing from the rubble" }
    ]
  },
];

// ============================================================
// QUOTE → GENOME interpreter
// Word associations → axis values. Crude but autonomous.
// ============================================================
const WORD_AXIS_MAP = {
  // dark / shadow / night → dark, tense, desaturated
  dark: { value: 0.85, tension: 0.7, saturation: 0.3 },
  shadow: { value: 0.8, contrast: 0.8, tension: 0.6 },
  night: { value: 0.9, temperature: 0.2, saturation: 0.2 },
  // light / gold / glitter → bright, warm, saturated
  light: { value: 0.2, contrast: 0.7, temperature: 0.6 },
  gold: { temperature: 0.8, saturation: 0.7, finish: 0.8 },
  glitter: { saturation: 0.9, contrast: 0.8, complexity: 0.7 },
  // dream / memory / childhood → soft, warm, organic
  dream: { realism: 0.2, familiarity: 0.8, tension: 0.3, shape: 0.7 },
  memory: { finish: 0.3, familiarity: 0.6, saturation: 0.4 },
  childhood: { temperature: 0.7, evaluation: 0.7, tension: 0.2 },
  // sea / water / wander → movement, open, cool
  sea: { movement: 0.8, space: 0.1, temperature: 0.3, scale: 0.8 },
  wander: { movement: 0.7, space: 0.1, density: 0.3 },
  lost: { familiarity: 0.7, readability: 0.2, tension: 0.6 },
  // universe / world / everything → monumental, complex
  universe: { scale: 0.9, complexity: 0.8, density: 0.7 },
  world: { scale: 0.7, complexity: 0.6 },
  everything: { density: 0.8, complexity: 0.7, palette: 0.7 },
  // wound / crack / difficulty → raw, tense, textured
  wound: { finish: 0.1, tension: 0.9, texture: 0.9, evaluation: 0.2 },
  crack: { finish: 0.2, texture: 0.8, contrast: 0.8 },
  difficulty: { tension: 0.8, complexity: 0.7 },
  // through / way / opportunity → dynamic, active
  through: { movement: 0.7, activity: 0.7 },
  opportunity: { evaluation: 0.7, activity: 0.6, temperature: 0.6 },
  // idea / sense / eye → readable, cerebral
  idea: { readability: 0.7, realism: 0.3, materiality: 0.3 },
  eye: { readability: 0.8, contrast: 0.7 },
  sense: { readability: 0.6, balance: 0.3 },
};

function interpretQuote(quote) {
  const genome = {};
  const words = quote.text.toLowerCase().split(/\W+/);

  for (const word of words) {
    const mapping = WORD_AXIS_MAP[word];
    if (mapping) {
      for (const [axis, val] of Object.entries(mapping)) {
        if (!genome[axis]) genome[axis] = { total: 0, count: 0 };
        genome[axis].total += val;
        genome[axis].count += 1;
      }
    }
  }

  // Average and build result
  const result = {};
  for (const [axis, { total, count }] of Object.entries(genome)) {
    result[axis] = total / count;
  }
  return result;
}

// Derive preferences from the interpreted genome (for rating)
function buildPreferences(interpreted) {
  const prefs = {};
  for (const [axis, value] of Object.entries(interpreted)) {
    prefs[axis] = { target: value, tolerance: 0.2 };
  }
  return prefs;
}

function simulateRating(genomeSnapshot, preferences) {
  let totalDist = 0;
  let count = 0;

  for (const [axis, pref] of Object.entries(preferences)) {
    const val = genomeSnapshot[axis];
    if (val === undefined) continue;
    totalDist += Math.abs(val - pref.target);
    count++;
  }

  const avgDist = count > 0 ? totalDist / count : 0.5;
  const rating = Math.max(1, Math.min(5, Math.round(5 - avgDist * 8)));

  let verdict;
  if (rating >= 4) verdict = 'keep';
  else if (rating <= 1) verdict = 'veto';
  else if (rating === 2) verdict = 'remove';
  else verdict = 'keep';

  return { rating, verdict };
}

function simulateNote(genomeSnapshot, preferences) {
  const complaints = [];
  for (const [axis, pref] of Object.entries(preferences)) {
    const val = genomeSnapshot[axis];
    if (val === undefined) continue;
    const diff = val - pref.target;
    if (Math.abs(diff) > pref.tolerance) {
      complaints.push(diff > 0 ? `too much ${axis}` : `not enough ${axis}`);
    }
  }
  return complaints.length > 0 ? complaints.join(', ') : 'looks good';
}

// ============================================================
// ENV
// ============================================================
const ENGINE_URL = process.env.AIDA_ENGINE_URL || 'http://localhost:8188';
const ENGINE_MODEL = process.env.AIDA_ENGINE_MODEL || 'flux1-dev-fp8.safetensors';

async function checkGpuAvailable() {
  try { return (await fetch(`${ENGINE_URL}/system_stats`)).ok; }
  catch { return false; }
}

function createTestEnv() {
  const tmpDir = path.join(process.cwd(), 'var', 'in-vitro');
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });

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
    default_steps: 0, default_cfg: 0,
    default_sampler: '', default_scheduler: '',
    default_width: 512, default_height: 512,
    batch_size: 3, seed_mode: 'random'
  });
  const worker = new JobWorker(store, engine, treePath, { pollIntervalMs: 1000 });
  return { store, engine, worker, tmpDir, treePath };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForJobs(store, timeout = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const q = store.getJobs('queued');
    const r = store.getJobs('running');
    if (q.length === 0 && r.length === 0) return true;
    await sleep(1000);
  }
  return false;
}

// ============================================================
// THE TEST
// ============================================================
describe('In-Vitro — Autonomous DA from a random quote', () => {
  let store, worker, tmpDir, treePath;
  let quote, interpreted, preferences;

  before(async () => {
    const gpuAvailable = await checkGpuAvailable();
    if (!gpuAvailable) {
      console.error(`\n  ⚠ GPU not available at ${ENGINE_URL} — skipping\n`);
      process.exit(0);
    }

    // Pick random quote
    quote = QUOTES[Math.floor(Math.random() * QUOTES.length)];
    interpreted = interpretQuote(quote);
    preferences = buildPreferences(interpreted);

    console.error(`\n  Quote: "${quote.text}" — ${quote.author}`);
    console.error(`  Interpreted axes: ${Object.entries(interpreted).map(([k,v]) => `${k}:${v.toFixed(2)}`).join(', ')}`);
    console.error(`  GPU: ${ENGINE_URL}, Model: ${ENGINE_MODEL}\n`);

    ({ store, worker, tmpDir, treePath } = createTestEnv());

    // Save the brief for reference
    fs.writeFileSync(path.join(tmpDir, 'BRIEF.md'), [
      `# In-Vitro DA Brief`,
      ``,
      `> "${quote.text}" — ${quote.author}`,
      ``,
      `## Universe`,
      `**${quote.universe.subject}**`,
      quote.universe.detail,
      ``,
      `## Bestiary`,
      ...quote.branches.map(b => `- **${b.name}**: ${b.subject}\n  ${b.detail}`),
      ``,
      `## Interpreted Genome`,
      ...Object.entries(interpreted).map(([k,v]) => `- **${k}**: ${v.toFixed(2)}`),
      ``,
      `## Model: ${ENGINE_MODEL}`,
      `## Date: ${new Date().toISOString()}`,
    ].join('\n'));

    worker.start();
  });

  after(() => {
    if (worker) worker.stop();

    // Write final report
    if (store) {
      const nodes = store.getTreeStatus().nodes;
      const allVars = [];
      for (const n of nodes) allVars.push(...store.getVariationsForNode(n.id));

      const report = [
        `# In-Vitro Results`,
        ``,
        `> "${quote.text}" — ${quote.author}`,
        ``,
        `## Tree (${nodes.length} nodes)`,
        ...nodes.map(n => `- ${' '.repeat(n.depth * 2)}${n.id} [${n.status}] (${n.type})`),
        ``,
        `## Variations (${allVars.length})`,
        ...allVars.map(v => `- ${v.id}: ${v.verdict} ${v.rating ? v.rating + '/5' : ''} ${v.notes || ''}`),
        ``,
        `## Final Genome (universe_root)`,
        ...store.getGenome('universe_root')
          .filter(g => g.confidence > 0)
          .sort((a,b) => b.confidence - a.confidence)
          .map(g => `- **${g.axis}**: ${g.value.toFixed(2)} (confidence: ${g.confidence.toFixed(2)})`),
      ].join('\n');

      fs.writeFileSync(path.join(tmpDir, 'RESULTS.md'), report);
      store.close();
    }

    console.error(`\n  Output at: ${tmpDir}`);
    console.error(`  See BRIEF.md and RESULTS.md\n`);
  });

  // ==========================================
  // PHASE 1 — Brief → Genome
  // ==========================================

  it('Phase 1 — Initialize from quote + set subject', () => {
    store.initUniverseRoot(quote.text.slice(0, 40));

    // Set the SUBJECT — what this universe IS
    store.updateNodeSubject(
      'universe_root',
      quote.universe.subject,
      quote.universe.detail
    );

    // Apply interpreted genome (style)
    for (const [axis, value] of Object.entries(interpreted)) {
      try {
        store.updateGene('universe_root', axis, value, 0.5);
      } catch { /* axis might not exist */ }
    }

    // Set exploring
    const nf = store.loadNodeFile('universe_root');
    nf.node.status = 'exploring';
    store.saveNodeFile('universe_root', nf);

    // Verify prompt now contains the subject
    const prompt = store.buildNodePrompt('universe_root');
    assert.ok(prompt.includes(quote.universe.subject),
      `Prompt should contain subject "${quote.universe.subject}"`);
    console.error(`    Subject: ${quote.universe.subject}`);

    const genome = store.getGenome('universe_root');
    assert.ok(genome.length >= 20);
  });

  // ==========================================
  // PHASE 2 — Pass 1: generate + rate
  // ==========================================

  it('Phase 2.1 — Generate 3 variations', () => {
    const passId = store.startPass('universe_root', 'ab');

    // Build prompts from resolved genome
    const prompt = store.buildNodePrompt('universe_root');
    assert.ok(prompt.length > 0, 'Should have a non-empty prompt');

    // Create 3 variations with slightly different prompts
    const uncertain = store.getUncertainAxes('universe_root', 0.6);
    const topAxes = uncertain.slice(0, 3).map(u => u.axis);

    for (let i = 0; i < 3; i++) {
      // Mutate one uncertain axis per variation
      if (topAxes[i]) {
        const gene = store.getGenome('universe_root').find(g => g.axis === topAxes[i]);
        if (gene) {
          const dir = i === 0 ? 0.8 : i === 1 ? 0.2 : Math.random();
          store.updateGene('universe_root', topAxes[i], dir);
        }
      }
      const varPrompt = store.buildNodePrompt('universe_root');
      store.createVariation('universe_root', passId, varPrompt);
    }

    assert.equal(store.getVariationsForNode('universe_root', passId).length, 3);
  });

  it('Phase 2.2 — Render via GPU', async () => {
    const pass = store.getActivePass();
    const variations = store.getVariationsForNode('universe_root', pass.id);

    for (const v of variations) {
      store.submitJob('render', 'universe_root', { variation_ids: [v.id] });
    }

    const done = await waitForJobs(store);
    assert.ok(done, 'Render jobs should complete within 120s');

    const completed = store.getJobs('completed');
    assert.ok(completed.length >= 3);

    for (const job of completed) {
      if (job.result?.image_path && fs.existsSync(job.result.image_path)) {
        const kb = Math.round(fs.statSync(job.result.image_path).size / 1024);
        console.error(`    ✓ ${path.basename(path.dirname(job.result.image_path))}: ${kb}KB`);
      }
    }
  });

  it('Phase 2.3 — Rate variations', () => {
    const pass = store.getActivePass();
    const variations = store.getVariationsForNode('universe_root', pass.id);

    for (const v of variations) {
      const { rating, verdict } = simulateRating(v.genome_snapshot, preferences);
      const note = simulateNote(v.genome_snapshot, preferences);
      store.rateVariation(v.id, rating, verdict, note);
      console.error(`    ${v.id}: ${rating}/5 ${verdict} — ${note}`);
    }
  });

  it('Phase 2.4 — Close pass 1', () => {
    const pass = store.getActivePass();
    store.closePass(pass.id);
  });

  // ==========================================
  // PHASE 3 — Pass 2: refine
  // ==========================================

  it('Phase 3.1 — Pass 2: targeted exploration', () => {
    const passId = store.startPass('universe_root', 'ab');
    const uncertain = store.getUncertainAxes('universe_root', 0.7);

    console.error(`    Uncertain axes: ${uncertain.map(u => `${u.axis}(${u.confidence.toFixed(2)})`).join(', ')}`);

    for (let i = 0; i < 3; i++) {
      if (uncertain[i]) {
        const axis = uncertain[i].axis;
        const dir = i % 2 === 0 ? 0.8 : 0.2;
        store.updateGene('universe_root', axis, dir);
      }
      const prompt = store.buildNodePrompt('universe_root');
      store.createVariation('universe_root', passId, prompt);
    }
  });

  it('Phase 3.2 — Render pass 2', async () => {
    const pass = store.getActivePass();
    const variations = store.getVariationsForNode('universe_root', pass.id);

    for (const v of variations) {
      store.submitJob('render', 'universe_root', { variation_ids: [v.id] });
    }

    const done = await waitForJobs(store);
    assert.ok(done, 'Pass 2 render should complete');
  });

  it('Phase 3.3 — Rate + close pass 2', () => {
    const pass = store.getActivePass();
    const variations = store.getVariationsForNode('universe_root', pass.id);

    for (const v of variations) {
      const { rating, verdict } = simulateRating(v.genome_snapshot, preferences);
      store.rateVariation(v.id, rating, verdict, simulateNote(v.genome_snapshot, preferences));
    }

    store.closePass(pass.id);
  });

  // ==========================================
  // PHASE 4 — Build tree from the quote
  // ==========================================

  it('Phase 4.1 — Validate root, create bestiary branches with subjects', () => {
    const nf = store.loadNodeFile('universe_root');
    nf.node.status = 'validated';
    store.saveNodeFile('universe_root', nf);

    // Create branches from the bestiary — each with a concrete SUBJECT
    const brA = quote.branches[0];
    const brB = quote.branches[1];

    store.createChildNode('universe_root', brA.id, brA.name, 'zone');
    store.updateNodeSubject(brA.id, brA.subject, brA.detail);

    store.createChildNode('universe_root', brB.id, brB.name, 'zone',
      [{ fn: 'invert', axes: ['temperature', 'value', 'tension'] }]
    );
    store.updateNodeSubject(brB.id, brB.subject, brB.detail);

    const children = store.getChildren('universe_root');
    assert.equal(children.length, 2);

    // Verify prompts now contain concrete subjects
    const promptA = store.buildNodePrompt(brA.id);
    const promptB = store.buildNodePrompt(brB.id);
    assert.ok(promptA.includes(brA.subject), `Branch A prompt should contain "${brA.subject}"`);
    assert.ok(promptB.includes(brB.subject), `Branch B prompt should contain "${brB.subject}"`);

    console.error(`    ${brA.name}: ${brA.subject}`);
    console.error(`    ${brB.name}: ${brB.subject} (inverted temperature, value, tension)`);
  });

  it('Phase 4.2 — Resolve children genomes', () => {
    const brA = quote.branches[0];
    const brB = quote.branches[1];
    const resolvedA = store.resolveNodeGenome(brA.id);
    const resolvedB = store.resolveNodeGenome(brB.id);

    if (resolvedA.genes.temperature && resolvedB.genes.temperature) {
      const delta = Math.abs(resolvedA.genes.temperature.value - resolvedB.genes.temperature.value);
      console.error(`    Temperature delta: ${delta.toFixed(2)} (A: ${resolvedA.genes.temperature.value.toFixed(2)}, B: ${resolvedB.genes.temperature.value.toFixed(2)})`);
    }

    // Show mood text for each
    console.error(`\n    --- ${brA.name} mood ---`);
    console.error(`    ${store.buildNodeMoodText(brA.id).split('\n').slice(0, 4).join('\n    ')}`);
    console.error(`\n    --- ${brB.name} mood ---`);
    console.error(`    ${store.buildNodeMoodText(brB.id).split('\n').slice(0, 4).join('\n    ')}`);
  });

  it('Phase 4.3 — Generate branch comparison', async () => {
    const branchIds = quote.branches.map(b => b.id);

    for (const branchId of branchIds) {
      const bnf = store.loadNodeFile(branchId);
      bnf.node.status = 'exploring';
      store.saveNodeFile(branchId, bnf);

      const passId = store.startPass(branchId, 'ab');
      const prompt = store.buildNodePrompt(branchId);
      const v = store.createVariation(branchId, passId, prompt);
      store.submitJob('render', branchId, { variation_ids: [v.id] });
      store.closePass(passId);
    }

    const done = await waitForJobs(store);
    assert.ok(done, 'Branch renders should complete');

    const completed = store.getJobs('completed');
    for (const job of completed) {
      if (job.result?.image_path && fs.existsSync(job.result.image_path)) {
        const kb = Math.round(fs.statSync(job.result.image_path).size / 1024);
        console.error(`    ✓ ${job.node_id}: ${kb}KB`);
      }
    }
  });

  // ==========================================
  // PHASE 5 — Final check
  // ==========================================

  it('Phase 5 — Final state', () => {
    const status = store.getTreeStatus();
    assert.ok(status.nodes.length >= 3);

    const allVars = [];
    for (const n of status.nodes) {
      allVars.push(...store.getVariationsForNode(n.id));
    }
    assert.ok(allVars.length >= 8, `Should have >=8 variations, got ${allVars.length}`);

    const jobs = store.getJobs();
    const completed = jobs.filter(j => j.status === 'completed');
    console.error(`\n    Final: ${status.nodes.length} nodes, ${allVars.length} variations, ${completed.length} images rendered`);
    console.error(`    Quote: "${quote.text}"`);
  });
});
