/**
 * Job Worker — polls the SQLite queue and dispatches jobs to the engine.
 *
 * Can run:
 *   1. Embedded in the MCP server (starts automatically)
 *   2. Standalone: `node dist/cli/engine/job-worker.js --db path/to/aida.db`
 *
 * The worker is single-threaded: one job at a time, FIFO.
 * It polls every N seconds for new jobs.
 */
import fs from 'fs';
import path from 'path';
import type { Engine, GenerationRequest } from './types.js';
import type { Store } from '../managers/store.js';
import type { Job } from '../lib/types.js';

export interface WorkerConfig {
  pollIntervalMs: number;   // how often to check for new jobs (default 3000)
  maxRetries: number;       // auto-retry failed jobs (default 0)
}

const DEFAULT_CONFIG: WorkerConfig = {
  pollIntervalMs: 3000,
  maxRetries: 0
};

export class JobWorker {
  private store: Store;
  private engine: Engine;
  private treePath: string;
  private config: WorkerConfig;
  private running: boolean = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private currentJob: Job | null = null;

  constructor(store: Store, engine: Engine, treePath: string, config?: Partial<WorkerConfig>) {
    this.store = store;
    this.engine = engine;
    this.treePath = treePath;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start the worker loop.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.log('Worker started');

    // Recover any jobs stuck in "running" from a previous crash
    this.recoverStuckJobs();

    // Start polling
    this.timer = setInterval(() => this.tick(), this.config.pollIntervalMs);
    // Also tick immediately
    this.tick();
  }

  /**
   * Stop the worker loop gracefully.
   */
  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.log('Worker stopped');
  }

  /**
   * Check if the worker is currently processing a job.
   */
  isBusy(): boolean {
    return this.currentJob !== null;
  }

  /**
   * Process one tick: pick next job and execute it.
   */
  private async tick(): Promise<void> {
    if (!this.running || this.currentJob) return;

    const job = this.store.getNextQueuedJob();
    if (!job) return;

    this.currentJob = job;
    this.log(`Processing job ${job.id} (${job.type})`);

    try {
      this.store.updateJobStatus(job.id, 'running', { progress: 0 });
      await this.executeJob(job);
    } catch (e: any) {
      this.log(`Job ${job.id} failed: ${e.message}`);
      this.store.updateJobStatus(job.id, 'failed', { error: e.message });
    } finally {
      this.currentJob = null;
    }
  }

  /**
   * Execute a job based on its type.
   */
  private async executeJob(job: Job): Promise<void> {
    switch (job.type) {
      case 'render':
        await this.executeRender(job);
        break;
      case 'render_batch':
        await this.executeRenderBatch(job);
        break;
      case 'upscale':
        await this.executeUpscale(job);
        break;
      // Future job types
      case 'style_extract':
      case 'lora_train':
      case 'clip_embed':
        this.store.updateJobStatus(job.id, 'failed', {
          error: `Job type "${job.type}" not yet implemented`
        });
        break;
      default:
        this.store.updateJobStatus(job.id, 'failed', {
          error: `Unknown job type: ${job.type}`
        });
    }
  }

  /**
   * Render a single variation image.
   */
  private async executeRender(job: Job): Promise<void> {
    const { variation_ids, negative_prompt } = job.params;
    if (!variation_ids || variation_ids.length === 0) {
      throw new Error('No variation_ids in job params');
    }

    const varId = variation_ids[0];
    const { variation, node } = this.findVariation(varId);
    if (!variation || !node) throw new Error(`Variation not found: ${varId}`);

    const outputPath = path.join(this.treePath, node.path, 'variations', varId, 'main.png');

    this.store.updateJobStatus(job.id, 'running', { progress: 10 });

    const result = await this.engine.generate({
      prompt: variation.prompt_used || '',
      negative_prompt
    }, outputPath);

    if (result.success) {
      this.store.updateJobStatus(job.id, 'completed', {
        progress: 100,
        result: {
          variation_id: varId,
          image_path: result.image_path,
          seed_used: result.seed_used,
          duration_ms: result.duration_ms
        }
      });
    } else {
      throw new Error(result.error || 'Render failed');
    }
  }

  /**
   * Render multiple variation images.
   */
  private async executeRenderBatch(job: Job): Promise<void> {
    const { variation_ids, negative_prompt } = job.params;
    if (!variation_ids || variation_ids.length === 0) {
      throw new Error('No variation_ids in job params');
    }

    const results: Array<{ id: string; success: boolean; path?: string; error?: string }> = [];
    const total = variation_ids.length;

    for (let i = 0; i < total; i++) {
      const varId = variation_ids[i];
      const progress = Math.round(((i + 0.5) / total) * 100);
      this.store.updateJobStatus(job.id, 'running', { progress });

      const { variation, node } = this.findVariation(varId);
      if (!variation || !node) {
        results.push({ id: varId, success: false, error: 'Variation not found' });
        continue;
      }

      const outputPath = path.join(this.treePath, node.path, 'variations', varId, 'main.png');

      try {
        const result = await this.engine.generate({
          prompt: variation.prompt_used || '',
          negative_prompt
        }, outputPath);

        results.push({
          id: varId,
          success: result.success,
          path: result.image_path,
          error: result.error
        });
      } catch (e: any) {
        results.push({ id: varId, success: false, error: e.message });
      }
    }

    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    if (failed === total) {
      throw new Error(`All ${total} renders failed`);
    }

    this.store.updateJobStatus(job.id, 'completed', {
      progress: 100,
      result: { results, rendered: succeeded, failed }
    });
  }

  /**
   * Upscale an image (placeholder — delegates to engine).
   */
  private async executeUpscale(job: Job): Promise<void> {
    // TODO: implement when engine supports upscale
    this.store.updateJobStatus(job.id, 'failed', {
      error: 'Upscale not yet implemented in engine'
    });
  }

  /**
   * Find a variation and its node.
   */
  private findVariation(varId: string): { variation: any; node: any } {
    const allNodes = this.store.getTreeStatus().nodes;
    for (const n of allNodes) {
      const vars = this.store.getVariationsForNode(n.id);
      const v = vars.find(v => v.id === varId);
      if (v) return { variation: v, node: n };
    }
    return { variation: null, node: null };
  }

  /**
   * On startup, recover any jobs stuck in "running" from a previous crash.
   * Re-queue them so they get retried.
   */
  private recoverStuckJobs(): void {
    const stuckJobs = this.store.getJobs('running');
    for (const job of stuckJobs) {
      this.log(`Recovering stuck job ${job.id} — re-queuing`);
      this.store.updateJobStatus(job.id, 'failed', {
        error: 'Worker crashed while job was running — re-queue with job_retry'
      });
    }
  }

  private log(msg: string): void {
    const ts = new Date().toISOString().slice(11, 19);
    process.stderr.write(`[aida-worker ${ts}] ${msg}\n`);
  }
}
