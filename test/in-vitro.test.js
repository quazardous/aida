/**
 * In-Vitro Test — Fully autonomous AIDA simulation
 *
 * Follows the real AIDA workflow phases:
 *   Phase 1: Mood Exploration (TEXT ONLY — genome calibration)
 *   Phase 2: Universe Description (TEXT ONLY — set subject)
 *   Phase 3: Bestiary (TEXT ONLY — create entities with detailed sheets)
 *   Phase 4: First Render (IMAGES — now we have concrete subjects)
 *   Phase 5: Rating & Convergence (A/B testing passes)
 *   Phase 6: Branch Exploration (children with contrasting styles)
 *
 * All output in ./var/in-vitro/. Requires real GPU.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { Store } from '../dist/cli/managers/store.js';
import { createEngine } from '../dist/cli/engine/index.js';
import { JobWorker } from '../dist/cli/engine/job-worker.js';

// ============================================================
// PROJECT BRIEFS — each quote spawns a complete project
// ============================================================
const PROJECTS = [
  {
    quote: { text: "In a dark time, the eye begins to see", author: "Roethke" },
    // Phase 1: mood keywords → genome values
    mood: {
      value: 0.85, tension: 0.7, saturation: 0.3,
      readability: 0.8, contrast: 0.7, finish: 0.3,
      realism: 0.3, texture: 0.7
    },
    walls: [
      { axis: 'realism', condition: '> 0.7', reason: 'stylized only — not photographic' },
      { axis: 'value', condition: '< 0.3', reason: 'must remain dark' }
    ],
    // Phase 2: universe description
    universe: {
      subject: "A lighthouse on a storm-battered cliff",
      detail: "A solitary lighthouse of dark stone perched on eroding cliffs, the beam cutting through rain and spray, the sea raging below, a keeper's cottage clinging to the rock"
    },
    // Phase 3: bestiary — concrete entities with full descriptions
    bestiary: [
      {
        id: "lantern_room", name: "The Lantern Room", type: "zone",
        subject: "The lighthouse lamp chamber at the top of the tower",
        detail: "A glass-enclosed room housing a massive Fresnel lens. The lens rotates slowly, splitting light into rainbows on curved walls. Rain streaks the glass panels. The storm is visible in every direction — sea merging with sky at the horizon. Brass mechanisms click and turn. The floor vibrates with each wave impact below.",
        transforms: [
          { fn: 'set', axes: ['contrast'], value: 0.9, reason: 'extreme light/dark from the lamp' },
          { fn: 'set', axes: ['readability'], value: 0.9, reason: 'clear focal point — the lens' }
        ]
      },
      {
        id: "shore_wreck", name: "The Shore Wreck", type: "zone",
        subject: "A shipwreck wedged between rocks at the base of the cliff",
        detail: "The broken hull of a wooden sailing vessel driven onto the boulders. Barnacles and kelp encrust the timber. The figurehead — a woman with outstretched arms — is still visible, facing the open sea. Waves crash through gaps in the ribs. Rope and canvas hang from the mast stump. Seabirds nest in the wreckage.",
        transforms: [
          { fn: 'shift', axes: ['finish'], delta: -0.15, reason: 'more raw, decayed' },
          { fn: 'shift', axes: ['texture'], delta: 0.15, reason: 'barnacles, weathered wood' },
          { fn: 'invert', axes: ['tension'], reason: 'eerie calm vs the storm above' }
        ]
      }
    ]
  },
  {
    quote: { text: "The wound is the place where the light enters you", author: "Rumi" },
    mood: {
      value: 0.6, tension: 0.5, contrast: 0.8,
      temperature: 0.6, finish: 0.3, texture: 0.8,
      evaluation: 0.6, shape: 0.6
    },
    walls: [
      { axis: 'realism', condition: '> 0.7', reason: 'not photorealistic' }
    ],
    universe: {
      subject: "An ancient temple split by an earthquake",
      detail: "A stone temple cracked open by a geological fault. Golden light pours through the fracture. Vines and flowers grow in the breach. The sacred and the broken coexist — destruction has made it more beautiful."
    },
    bestiary: [
      {
        id: "inner_sanctum", name: "The Inner Sanctum", type: "zone",
        subject: "The fractured holy chamber at the temple's heart",
        detail: "The deepest room, split in two by the fault line. Sunlight streams through the crack onto a stone altar covered in moss. Golden wildflowers grow from the break. Incense holders lie scattered but the air still smells of cedar. The walls bear faded murals — half destroyed, half perfect.",
        transforms: [
          { fn: 'set', axes: ['contrast'], value: 0.9, reason: 'light pouring through the crack' },
          { fn: 'set', axes: ['temperature'], value: 0.7, reason: 'warm golden light' }
        ]
      },
      {
        id: "healing_pool", name: "The Healing Pool", type: "zone",
        subject: "A natural pool formed in the temple ruins",
        detail: "Water has collected in a basin formed by collapsed walls. The pool is clear and still, reflecting the broken ceiling and the sky beyond. Offerings float on the surface — flower petals, small wooden boats, folded paper. Ferns grow along the edges. The sound of dripping water echoes.",
        transforms: [
          { fn: 'set', axes: ['tension'], value: 0.15, reason: 'profound calm' },
          { fn: 'set', axes: ['movement'], value: 0.2, reason: 'still water' },
          { fn: 'shift', axes: ['evaluation'], delta: 0.2, reason: 'beautiful, sacred' }
        ]
      }
    ]
  },
  {
    quote: { text: "The sea is everything", author: "Jules Verne" },
    mood: {
      movement: 0.8, space: 0.1, temperature: 0.3,
      scale: 0.8, density: 0.4, saturation: 0.5,
      potency: 0.7, materiality: 0.7
    },
    walls: [
      { axis: 'space', condition: '> 0.6', reason: 'must feel vast, not enclosed' }
    ],
    universe: {
      subject: "A brass and glass submersible exploring an ocean trench",
      detail: "A Victorian-era submarine of riveted brass plates and thick glass portholes, hovering over the edge of a deep ocean trench. Bioluminescent creatures drift past. The vessel's searchlight illuminates ancient coral formations. Pressure gauges tremble at their limits."
    },
    bestiary: [
      {
        id: "bridge", name: "The Bridge", type: "zone",
        subject: "The submarine command center",
        detail: "A circular room of polished brass and riveted steel plate. A panoramic viewport dominates the forward wall, showing the deep ocean in shades of blue-black. Navigation instruments glow amber. A leather captain's chair is bolted to the deck. Speaking tubes connect to other compartments. Charts are pinned to every surface.",
        transforms: [
          { fn: 'set', axes: ['temperature'], value: 0.6, reason: 'warm brass and amber instruments' },
          { fn: 'set', axes: ['space'], value: 0.7, reason: 'enclosed submarine interior' }
        ]
      },
      {
        id: "abyss_window", name: "The Abyss Window", type: "zone",
        subject: "The deep observation blister beneath the vessel",
        detail: "A transparent glass dome at the submarine's belly. Nothing but black water below, dropping into an unseen abyss. Occasional flashes of bioluminescence — ghostly jellyfish, anglerfish lures, unknown organisms pulsing with cold light. The pressure makes the glass groan. The observer sits alone in a small chair, surrounded by darkness.",
        transforms: [
          { fn: 'set', axes: ['value'], value: 0.95, reason: 'near-total darkness' },
          { fn: 'set', axes: ['tension'], value: 0.8, reason: 'pressure, isolation, the void' },
          { fn: 'invert', axes: ['temperature'], reason: 'cold deep water vs warm bridge' }
        ]
      }
    ]
  }
];

// ============================================================
// SIMULATED HUMAN — rates based on genome distance
// ============================================================
function buildPreferences(mood) {
  const prefs = {};
  for (const [axis, value] of Object.entries(mood)) {
    prefs[axis] = { target: value, tolerance: 0.2 };
  }
  return prefs;
}

function simulateRating(genomeSnapshot, preferences) {
  let totalDist = 0, count = 0;
  for (const [axis, pref] of Object.entries(preferences)) {
    const val = genomeSnapshot[axis];
    if (val === undefined) continue;
    totalDist += Math.abs(val - pref.target);
    count++;
  }
  const avgDist = count > 0 ? totalDist / count : 0.5;
  const rating = Math.max(1, Math.min(5, Math.round(5 - avgDist * 8)));
  const verdict = rating >= 4 ? 'keep' : rating <= 1 ? 'veto' : rating === 2 ? 'remove' : 'keep';
  return { rating, verdict };
}

function simulateNote(genomeSnapshot, preferences) {
  const issues = [];
  for (const [axis, pref] of Object.entries(preferences)) {
    const val = genomeSnapshot[axis];
    if (val === undefined) continue;
    const diff = val - pref.target;
    if (Math.abs(diff) > pref.tolerance) {
      issues.push(diff > 0 ? `too much ${axis}` : `not enough ${axis}`);
    }
  }
  return issues.length > 0 ? issues.join(', ') : 'looks good';
}

// ============================================================
// ENV & HELPERS
// ============================================================
const ENGINE_URL = process.env.AIDA_ENGINE_URL || 'http://localhost:8188';
const ENGINE_MODEL = process.env.AIDA_ENGINE_MODEL || 'flux1-dev-fp8.safetensors';

async function checkGpu() {
  try { return (await fetch(`${ENGINE_URL}/system_stats`)).ok; }
  catch { return false; }
}

function createEnv() {
  const dir = path.join(process.cwd(), 'var', 'in-vitro');
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  const treePath = path.join(dir, 'tree');
  const dbPath = path.join(dir, 'aida.db');
  const axesPath = path.join(dir, 'axes');
  fs.mkdirSync(treePath, { recursive: true });
  fs.mkdirSync(axesPath, { recursive: true });
  fs.copyFileSync(path.join(process.cwd(), 'axes', 'universal.yaml'), path.join(axesPath, 'universal.yaml'));
  const store = new Store({ treePath, dbPath, axesPath });
  const engine = createEngine({
    backend: 'comfyui', api_url: ENGINE_URL, default_model: ENGINE_MODEL,
    default_steps: 0, default_cfg: 0, default_sampler: '', default_scheduler: '',
    default_width: 512, default_height: 512, batch_size: 3, seed_mode: 'random'
  });
  const worker = new JobWorker(store, engine, treePath, { pollIntervalMs: 1000 });
  return { store, worker, dir, treePath };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitJobs(store, timeout = 180000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (store.getJobs('queued').length === 0 && store.getJobs('running').length === 0) return true;
    await sleep(1000);
  }
  return false;
}

// ============================================================
// THE TEST
// ============================================================
describe('In-Vitro — Full DA workflow simulation', () => {
  let store, worker, dir, treePath;
  let project, preferences;

  before(async () => {
    if (!(await checkGpu())) {
      console.error(`\n  ⚠ GPU not available at ${ENGINE_URL} — skipping\n`);
      process.exit(0);
    }

    project = PROJECTS[Math.floor(Math.random() * PROJECTS.length)];
    preferences = buildPreferences(project.mood);

    console.error(`\n  ═══════════════════════════════════════════`);
    console.error(`  Quote: "${project.quote.text}" — ${project.quote.author}`);
    console.error(`  Universe: ${project.universe.subject}`);
    console.error(`  Bestiary: ${project.bestiary.map(e => e.name).join(', ')}`);
    console.error(`  ═══════════════════════════════════════════\n`);

    ({ store, worker, dir, treePath } = createEnv());
    worker.start();
  });

  after(() => {
    if (worker) worker.stop();
    if (store) {
      // Write final report
      const nodes = store.getTreeStatus().nodes;
      const allVars = [];
      for (const n of nodes) allVars.push(...store.getVariationsForNode(n.id));

      const report = [
        `# In-Vitro Results`,
        ``,
        `> "${project.quote.text}" — ${project.quote.author}`,
        ``,
        `## Universe`,
        `**${project.universe.subject}**`,
        project.universe.detail,
        ``,
        `## Tree (${nodes.length} nodes)`,
        ...nodes.map(n => {
          const subj = n.subject ? ` — ${n.subject}` : '';
          return `- ${' '.repeat(n.depth * 2)}**${n.name}** [${n.status}]${subj}`;
        }),
        ``,
        `## Variations (${allVars.length})`,
        ...allVars.map(v => `- \`${v.id}\`: ${v.verdict} ${v.rating ? v.rating + '/5' : ''} ${v.notes || ''}`),
        ``,
        `## Prompts Used`,
        ...allVars.filter(v => v.prompt_used).map(v =>
          `### ${v.id}\n\`\`\`\n${v.prompt_used}\n\`\`\``
        ),
        ``,
        `## Mood Texts`,
        ...nodes.filter(n => n.subject).map(n =>
          `### ${n.name}\n${store.buildNodeMoodText(n.id)}`
        ),
      ].join('\n');

      fs.writeFileSync(path.join(dir, 'RESULTS.md'), report);
      store.close();
    }
    console.error(`\n  Output: ${dir}`);
    console.error(`  See RESULTS.md\n`);
  });

  // ══════════════════════════════════════════
  // PHASE 1: Mood Exploration (TEXT ONLY)
  // ══════════════════════════════════════════

  it('Phase 1 — Mood exploration (text only, no images)', () => {
    console.error(`  ── Phase 1: Mood Exploration ──`);

    store.initUniverseRoot(project.quote.text.slice(0, 50));

    // Set genome from mood interpretation
    for (const [axis, value] of Object.entries(project.mood)) {
      try { store.updateGene('universe_root', axis, value, 0.5); }
      catch { /* axis might not exist */ }
    }

    // Set walls (what we DON'T want)
    for (const wall of project.walls) {
      store.addWall('universe_root', wall.axis, wall.condition, wall.reason, true);
    }

    console.error(`    Mood: ${Object.entries(project.mood).map(([k,v]) => `${k}:${v}`).join(', ')}`);
    console.error(`    Walls: ${project.walls.map(w => `${w.axis} ${w.condition}`).join(', ')}`);

    // NO images generated — this phase is text only
    const genome = store.getGenome('universe_root');
    assert.ok(genome.length >= 20);
  });

  // ══════════════════════════════════════════
  // PHASE 2: Universe Description (TEXT ONLY)
  // ══════════════════════════════════════════

  it('Phase 2 — Universe description (text only)', () => {
    console.error(`  ── Phase 2: Universe Description ──`);

    store.updateNodeSubject(
      'universe_root',
      project.universe.subject,
      project.universe.detail
    );

    console.error(`    Subject: ${project.universe.subject}`);
    console.error(`    Detail: ${project.universe.detail.slice(0, 80)}...`);

    // Verify mood text is rich
    const mood = store.buildNodeMoodText('universe_root');
    assert.ok(mood.includes(project.universe.subject));
    console.error(`    Mood text: ${mood.split('\n').length} lines`);

    // Still NO images
  });

  // ══════════════════════════════════════════
  // PHASE 3: Bestiary (TEXT ONLY)
  // ══════════════════════════════════════════

  it('Phase 3 — Bestiary creation (text only)', () => {
    console.error(`  ── Phase 3: Bestiary ──`);

    // Set universe_root to exploring so we can create children
    const nf = store.loadNodeFile('universe_root');
    nf.node.status = 'exploring';
    store.saveNodeFile('universe_root', nf);

    for (const entity of project.bestiary) {
      store.createChildNode('universe_root', entity.id, entity.name, entity.type, entity.transforms);
      store.updateNodeSubject(entity.id, entity.subject, entity.detail);

      // Preview what the prompt WOULD look like (but don't generate yet)
      const prompt = store.buildNodePrompt(entity.id);
      const mood = store.buildNodeMoodText(entity.id);

      console.error(`    ${entity.name}:`);
      console.error(`      Subject: ${entity.subject}`);
      console.error(`      Prompt preview: ${prompt.slice(0, 100)}...`);
    }

    const children = store.getChildren('universe_root');
    assert.equal(children.length, project.bestiary.length);

    // Still NO images — bestiary is text only
  });

  // ══════════════════════════════════════════
  // PHASE 4: First Render (IMAGES)
  // Now we have concrete subjects — generation makes sense
  // ══════════════════════════════════════════

  it('Phase 4.1 — Generate universe_root variations', () => {
    console.error(`  ── Phase 4: First Render ──`);

    const passId = store.startPass('universe_root', 'ab');

    // Generate 3 variations for the universe (the lighthouse/temple/submarine)
    for (let i = 0; i < 3; i++) {
      const uncertain = store.getUncertainAxes('universe_root', 0.6);
      if (uncertain[i]) {
        const dir = i % 2 === 0 ? 0.8 : 0.2;
        store.updateGene('universe_root', uncertain[i].axis, dir);
      }
      const prompt = store.buildNodePrompt('universe_root');
      store.createVariation('universe_root', passId, prompt);
    }

    assert.equal(store.getVariationsForNode('universe_root', passId).length, 3);
  });

  it('Phase 4.2 — Render universe_root via GPU', async () => {
    const pass = store.getActivePass();
    const vars = store.getVariationsForNode('universe_root', pass.id);
    for (const v of vars) {
      store.submitJob('render', 'universe_root', { variation_ids: [v.id] });
    }

    assert.ok(await waitJobs(store), 'Universe renders should complete');

    for (const j of store.getJobs('completed')) {
      if (j.result?.image_path && fs.existsSync(j.result.image_path)) {
        console.error(`    ✓ ${path.basename(path.dirname(j.result.image_path))}: ${Math.round(fs.statSync(j.result.image_path).size/1024)}KB`);
      }
    }
  });

  // ══════════════════════════════════════════
  // PHASE 5: Rating & Convergence
  // ══════════════════════════════════════════

  it('Phase 5.1 — Rate universe_root variations', () => {
    console.error(`  ── Phase 5: Rating ──`);

    const pass = store.getActivePass();
    const vars = store.getVariationsForNode('universe_root', pass.id);

    for (const v of vars) {
      const { rating, verdict } = simulateRating(v.genome_snapshot, preferences);
      const note = simulateNote(v.genome_snapshot, preferences);
      store.rateVariation(v.id, rating, verdict, note);
      console.error(`    ${v.id}: ${rating}/5 ${verdict} — ${note}`);
    }

    store.closePass(pass.id);
  });

  // ══════════════════════════════════════════
  // PHASE 6: Bestiary Render (children)
  // Each entity gets its own image with its own subject + inherited style
  // ══════════════════════════════════════════

  it('Phase 6.1 — Render each bestiary entity', async () => {
    console.error(`  ── Phase 6: Bestiary Render ──`);

    for (const entity of project.bestiary) {
      const bnf = store.loadNodeFile(entity.id);
      bnf.node.status = 'exploring';
      store.saveNodeFile(entity.id, bnf);

      const passId = store.startPass(entity.id, 'ab');
      const prompt = store.buildNodePrompt(entity.id);
      const v = store.createVariation(entity.id, passId, prompt);
      store.submitJob('render', entity.id, { variation_ids: [v.id] });
      store.closePass(passId);

      console.error(`    Queued: ${entity.name}`);
    }

    assert.ok(await waitJobs(store), 'Bestiary renders should complete');

    for (const j of store.getJobs('completed')) {
      if (j.result?.image_path && fs.existsSync(j.result.image_path)) {
        console.error(`    ✓ ${j.node_id}: ${Math.round(fs.statSync(j.result.image_path).size/1024)}KB`);
      }
    }
  });

  // ══════════════════════════════════════════
  // PHASE 7: Final Report
  // ══════════════════════════════════════════

  it('Phase 7 — Final state', () => {
    console.error(`  ── Phase 7: Summary ──`);

    const nodes = store.getTreeStatus().nodes;
    const allVars = [];
    for (const n of nodes) allVars.push(...store.getVariationsForNode(n.id));
    const jobs = store.getJobs();
    const completed = jobs.filter(j => j.status === 'completed');

    assert.ok(nodes.length >= 3, `Expected >=3 nodes, got ${nodes.length}`);
    assert.ok(allVars.length >= 5, `Expected >=5 variations, got ${allVars.length}`);
    assert.ok(completed.length >= 5, `Expected >=5 completed jobs, got ${completed.length}`);

    console.error(`    ${nodes.length} nodes, ${allVars.length} variations, ${completed.length} images`);
    console.error(`    Quote: "${project.quote.text}"`);
  });
});
