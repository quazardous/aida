/**
 * MCP Tools — Job system (persistent async GPU tasks)
 *
 * Jobs survive across agent sessions. An agent that reconnects
 * can call job_list/job_status to see what completed while it was away.
 *
 * Flow:
 *   job_submit → returns immediately with job_id
 *   job_status → poll progress
 *   job_list   → see all jobs (any session)
 *   job_collect → integrate results into tree
 *   job_cancel  → abort a queued/running job
 */
import type { Store } from '../managers/store.js';
import type { Engine } from '../engine/index.js';
import { ok, err } from './types.js';
import type { ToolDefinition } from './types.js';
import type { JobType } from '../lib/types.js';

export function createJobTools(store: Store, engine: Engine, treePath: string): ToolDefinition[] {
  return [
    {
      tool: {
        name: 'job_submit',
        description: 'Submit an async job (render, batch render, LoRA training, etc.). Returns immediately with a job_id. Use job_status to track progress.',
        inputSchema: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['render', 'render_batch', 'style_extract', 'lora_train', 'clip_embed', 'upscale'],
              description: 'Job type'
            },
            node_id: { type: 'string', description: 'Node this job is for' },
            params: {
              type: 'object',
              description: 'Job-specific parameters. For render: {variation_ids, negative_prompt}. For render_batch: {node_id, pass, count}. For lora_train: {base_model, steps, lr}.',
              properties: {
                variation_ids: { type: 'array', items: { type: 'string' } },
                negative_prompt: { type: 'string' },
                pass: { type: 'number' },
                count: { type: 'number' },
                base_model: { type: 'string' },
                steps: { type: 'number' },
                lr: { type: 'number' }
              }
            }
          },
          required: ['type', 'node_id', 'params']
        }
      },
      handler: (args) => {
        try {
          const node = store.getNode(args.node_id);
          if (!node) return err(`Node not found: ${args.node_id}`);

          const job = store.submitJob(args.type as JobType, args.node_id, args.params);

          return ok({
            success: true,
            data: {
              job_id: job.id,
              type: job.type,
              status: job.status,
              node_id: job.node_id,
              message: `Job ${job.id} queued. Use job_status to track progress.`
            },
            next_actions: [{
              tool: 'job_status',
              args: { id: job.id },
              reason: 'Check job progress',
              priority: 'low'
            }]
          });
        } catch (e: any) {
          return err(e.message);
        }
      }
    },
    {
      tool: {
        name: 'job_status',
        description: 'Get the current status of a job. Works across sessions — the job state is persisted in SQLite.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Job ID' }
          },
          required: ['id']
        }
      },
      handler: (args) => {
        const job = store.getJob(args.id);
        if (!job) return err(`Job not found: ${args.id}`);

        const data: Record<string, any> = {
          id: job.id,
          type: job.type,
          status: job.status,
          node_id: job.node_id,
          progress: job.progress,
          created_at: job.created_at,
          started_at: job.started_at,
          completed_at: job.completed_at
        };

        if (job.error) data.error = job.error;
        if (job.result) data.result = job.result;

        // Duration info
        if (job.started_at) {
          const start = new Date(job.started_at).getTime();
          const end = job.completed_at ? new Date(job.completed_at).getTime() : Date.now();
          data.duration_seconds = Math.round((end - start) / 1000);
        }

        const nextActions: any[] = [];
        if (job.status === 'completed') {
          nextActions.push({
            tool: 'job_collect',
            args: { id: job.id },
            reason: 'Collect job results and integrate into tree',
            priority: 'high'
          });
        }

        return ok({ success: true, data, next_actions: nextActions });
      }
    },
    {
      tool: {
        name: 'job_list',
        description: 'List all jobs, optionally filtered by status or node. Essential for resuming work across sessions.',
        inputSchema: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['queued', 'running', 'completed', 'failed', 'cancelled', 'collected'],
              description: 'Filter by status'
            },
            node_id: { type: 'string', description: 'Filter by node' }
          }
        }
      },
      handler: (args) => {
        const jobs = store.getJobs(args.status, args.node_id);

        const summary = {
          queued: jobs.filter(j => j.status === 'queued').length,
          running: jobs.filter(j => j.status === 'running').length,
          completed: jobs.filter(j => j.status === 'completed').length,
          failed: jobs.filter(j => j.status === 'failed').length,
          cancelled: jobs.filter(j => j.status === 'cancelled').length,
          collected: jobs.filter(j => j.status === 'collected').length
        };

        return ok({
          success: true,
          data: {
            jobs: jobs.map(j => ({
              id: j.id,
              type: j.type,
              status: j.status,
              node_id: j.node_id,
              progress: j.progress,
              created_at: j.created_at,
              error: j.error
            })),
            count: jobs.length,
            summary
          }
        });
      }
    },
    {
      tool: {
        name: 'job_cancel',
        description: 'Cancel a queued or running job.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Job ID' },
            reason: { type: 'string', description: 'Why cancel' }
          },
          required: ['id']
        }
      },
      handler: (args) => {
        const job = store.getJob(args.id);
        if (!job) return err(`Job not found: ${args.id}`);

        if (job.status !== 'queued' && job.status !== 'running') {
          return err(`Cannot cancel job in status "${job.status}"`);
        }

        store.updateJobStatus(args.id, 'cancelled', {
          error: args.reason || 'Cancelled by user'
        });

        return ok({
          success: true,
          data: { id: args.id, status: 'cancelled', reason: args.reason }
        });
      }
    },
    {
      tool: {
        name: 'job_collect',
        description: 'Collect results from a completed job and integrate them into the tree (link images to variations, register LoRAs, etc.).',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Job ID' }
          },
          required: ['id']
        }
      },
      handler: (args) => {
        const result = store.collectJobResults(args.id);

        if (!result.collected) {
          return err(result.message);
        }

        const job = store.getJob(args.id);

        return ok({
          success: true,
          data: {
            id: args.id,
            collected: true,
            type: job?.type,
            result: job?.result,
            message: result.message
          },
          next_actions: [{
            tool: 'job_list',
            args: { status: 'completed' },
            reason: 'Check for other completed jobs to collect',
            priority: 'low'
          }]
        });
      }
    },
    {
      tool: {
        name: 'job_retry',
        description: 'Retry a failed job by re-queuing it with the same parameters.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Failed job ID to retry' }
          },
          required: ['id']
        }
      },
      handler: (args) => {
        const job = store.getJob(args.id);
        if (!job) return err(`Job not found: ${args.id}`);
        if (job.status !== 'failed') return err(`Can only retry failed jobs (status: ${job.status})`);

        const newJob = store.submitJob(job.type, job.node_id, job.params);

        return ok({
          success: true,
          data: {
            original_id: args.id,
            new_job_id: newJob.id,
            type: newJob.type,
            status: newJob.status
          }
        });
      }
    }
  ];
}
