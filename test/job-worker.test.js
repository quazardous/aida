/**
 * Job Worker test — verifies the worker picks up jobs and executes them via mock engine.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { Store } from '../dist/cli/managers/store.js';
import { MockEngine } from '../dist/cli/engine/mock-engine.js';
import { JobWorker } from '../dist/cli/engine/job-worker.js';

function createTempStore() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aida-worker-'));
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe('Job Worker', () => {
  let store, tmpDir, treePath, worker;

  before(() => {
    ({ store, tmpDir, treePath } = createTempStore());
    store.initUniverseRoot('Worker Test');
    // Set some genome to generate non-empty prompts
    store.updateGene('universe_root', 'temperature', 0.8, 0.7);
    store.updateGene('universe_root', 'realism', 0.2, 0.8);
  });
  after(() => {
    if (worker) worker.stop();
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should execute a render job via mock engine', async () => {
    // Create a variation first
    const passId = store.startPass('universe_root', 'ab');
    const variation = store.createVariation('universe_root', passId, 'dark stylized world');

    // Submit a render job
    const job = store.submitJob('render', 'universe_root', {
      variation_ids: [variation.id]
    });
    assert.equal(job.status, 'queued');

    // Create and start worker with fast polling
    const engine = new MockEngine();
    worker = new JobWorker(store, engine, treePath, { pollIntervalMs: 100 });
    worker.start();

    // Wait for the worker to pick it up and complete it
    let completed = false;
    for (let i = 0; i < 30; i++) {
      await sleep(100);
      const updated = store.getJob(job.id);
      if (updated.status === 'completed') {
        completed = true;
        break;
      }
    }

    assert.ok(completed, 'Job should have completed');

    const result = store.getJob(job.id);
    assert.equal(result.status, 'completed');
    assert.equal(result.progress, 100);
    assert.ok(result.result);
    assert.ok(result.result.variation_id);
    assert.ok(result.started_at);
    assert.ok(result.completed_at);

    worker.stop();
    worker = null;
  });

  it('should execute a batch render job', async () => {
    // Create multiple variations
    const v1 = store.createVariation('universe_root', 1, 'batch test 1');
    const v2 = store.createVariation('universe_root', 1, 'batch test 2');

    // Submit batch job
    const job = store.submitJob('render_batch', 'universe_root', {
      variation_ids: [v1.id, v2.id]
    });

    const engine = new MockEngine();
    worker = new JobWorker(store, engine, treePath, { pollIntervalMs: 100 });
    worker.start();

    let completed = false;
    for (let i = 0; i < 30; i++) {
      await sleep(100);
      const updated = store.getJob(job.id);
      if (updated.status === 'completed') {
        completed = true;
        break;
      }
    }

    assert.ok(completed, 'Batch job should have completed');

    const result = store.getJob(job.id);
    assert.equal(result.result.rendered, 2);
    assert.equal(result.result.failed, 0);

    worker.stop();
    worker = null;
  });

  it('should recover stuck jobs on startup', () => {
    // Manually set a job to running (simulates crash)
    const job = store.submitJob('render', 'universe_root', { variation_ids: ['fake'] });
    store.updateJobStatus(job.id, 'running');

    const engine = new MockEngine();
    worker = new JobWorker(store, engine, treePath, { pollIntervalMs: 100 });
    worker.start();

    // Stuck job should be marked as failed
    const recovered = store.getJob(job.id);
    assert.equal(recovered.status, 'failed');
    assert.ok(recovered.error.includes('crashed'));

    worker.stop();
    worker = null;
  });

  it('should process jobs in FIFO order', async () => {
    const j1 = store.submitJob('render', 'universe_root', { variation_ids: ['fake1'] });
    const j2 = store.submitJob('render', 'universe_root', { variation_ids: ['fake2'] });

    // j1 was submitted first, should be picked up first
    const next = store.getNextQueuedJob();
    assert.equal(next.id, j1.id);
  });
});
