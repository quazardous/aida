/**
 * ComfyUI Engine — generates images via the ComfyUI API
 *
 * ComfyUI exposes a REST + WebSocket API:
 * - POST /prompt — submit a workflow
 * - GET /history/{prompt_id} — check status
 * - GET /view?filename=... — download result
 */
import fs from 'fs';
import path from 'path';
import type { Engine, GenerationRequest, GenerationResult, EngineConfig } from './types.js';

export class ComfyUIEngine implements Engine {
  name = 'comfyui';
  private apiUrl: string;
  private config: EngineConfig;

  constructor(config: EngineConfig) {
    this.apiUrl = config.api_url.replace(/\/$/, '');
    this.config = config;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.apiUrl}/system_stats`);
      return res.ok;
    } catch {
      return false;
    }
  }

  async generate(request: GenerationRequest, outputPath: string): Promise<GenerationResult> {
    const start = Date.now();
    const seed = request.seed ?? Math.floor(Math.random() * 999999999);

    const workflow = this.buildWorkflow(request, seed);

    try {
      // Submit workflow
      const submitRes = await fetch(`${this.apiUrl}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: workflow })
      });

      if (!submitRes.ok) {
        const errText = await submitRes.text();
        return { success: false, error: `ComfyUI submit failed: ${errText}` };
      }

      const { prompt_id } = await submitRes.json() as { prompt_id: string };

      // Poll for completion
      const result = await this.waitForResult(prompt_id);
      if (!result.success) return result;

      // Download image
      const dir = path.dirname(outputPath);
      fs.mkdirSync(dir, { recursive: true });

      const imageRes = await fetch(`${this.apiUrl}/view?filename=${result.filename}&type=output`);
      if (!imageRes.ok) {
        return { success: false, error: 'Failed to download generated image' };
      }

      const buffer = Buffer.from(await imageRes.arrayBuffer());
      fs.writeFileSync(outputPath, buffer);

      return {
        success: true,
        image_path: outputPath,
        seed_used: seed,
        prompt_used: request.prompt,
        duration_ms: Date.now() - start
      };
    } catch (e: any) {
      return { success: false, error: e.message, duration_ms: Date.now() - start };
    }
  }

  async generateBatch(requests: GenerationRequest[], outputDir: string): Promise<GenerationResult[]> {
    fs.mkdirSync(outputDir, { recursive: true });
    const results: GenerationResult[] = [];

    // Sequential for now — ComfyUI queues internally
    for (let i = 0; i < requests.length; i++) {
      const outputPath = path.join(outputDir, `${(i + 1).toString().padStart(3, '0')}.png`);
      const result = await this.generate(requests[i], outputPath);
      results.push(result);
    }

    return results;
  }

  // --- Internal ---

  private buildWorkflow(request: GenerationRequest, seed: number): Record<string, any> {
    // Basic txt2img workflow
    // This is a minimal ComfyUI API workflow — real projects will use
    // custom workflow templates from .aida/engine/workflows/
    return {
      '1': {
        class_type: 'CheckpointLoaderSimple',
        inputs: {
          ckpt_name: request.model || this.config.default_model
        }
      },
      '2': {
        class_type: 'CLIPTextEncode',
        inputs: {
          text: request.prompt,
          clip: ['1', 1]
        }
      },
      '3': {
        class_type: 'CLIPTextEncode',
        inputs: {
          text: request.negative_prompt || '',
          clip: ['1', 1]
        }
      },
      '4': {
        class_type: 'EmptyLatentImage',
        inputs: {
          width: request.width || this.config.default_width,
          height: request.height || this.config.default_height,
          batch_size: 1
        }
      },
      '5': {
        class_type: 'KSampler',
        inputs: {
          model: ['1', 0],
          positive: ['2', 0],
          negative: ['3', 0],
          latent_image: ['4', 0],
          seed,
          steps: request.steps || this.config.default_steps,
          cfg: request.cfg || this.config.default_cfg,
          sampler_name: request.sampler || this.config.default_sampler,
          scheduler: request.scheduler || this.config.default_scheduler,
          denoise: 1.0
        }
      },
      '6': {
        class_type: 'VAEDecode',
        inputs: {
          samples: ['5', 0],
          vae: ['1', 2]
        }
      },
      '7': {
        class_type: 'SaveImage',
        inputs: {
          images: ['6', 0],
          filename_prefix: 'aida'
        }
      }
    };
  }

  private async waitForResult(promptId: string, maxWait: number = 300000): Promise<{ success: boolean; filename?: string; error?: string }> {
    const start = Date.now();

    while (Date.now() - start < maxWait) {
      await new Promise(resolve => setTimeout(resolve, 1000));

      try {
        const res = await fetch(`${this.apiUrl}/history/${promptId}`);
        if (!res.ok) continue;

        const history = await res.json() as Record<string, any>;
        const entry = history[promptId];
        if (!entry) continue;

        if (entry.status?.completed) {
          // Find output image
          const outputs = entry.outputs;
          for (const nodeId of Object.keys(outputs)) {
            const images = outputs[nodeId]?.images;
            if (images && images.length > 0) {
              return { success: true, filename: images[0].filename };
            }
          }
          return { success: false, error: 'No output images found' };
        }

        if (entry.status?.status_str === 'error') {
          return { success: false, error: 'ComfyUI workflow execution failed' };
        }
      } catch {
        // Retry
      }
    }

    return { success: false, error: `Timeout waiting for generation (${maxWait}ms)` };
  }
}
