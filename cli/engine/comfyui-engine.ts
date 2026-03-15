/**
 * ComfyUI Engine — generates images via the ComfyUI API
 *
 * Uses Connectors to build model-specific workflows.
 * The engine handles API communication, the connector handles workflow structure.
 *
 * ComfyUI API:
 * - POST /prompt — submit a workflow
 * - GET /history/{prompt_id} — check status
 * - GET /view?filename=... — download result
 */
import fs from 'fs';
import path from 'path';
import type { Engine, GenerationRequest, GenerationResult, EngineConfig } from './types.js';
import { getConnector } from './connectors/index.js';
import type { ConnectorRequest } from './connectors/index.js';

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
    const model = request.model || this.config.default_model;
    const seed = request.seed ?? Math.floor(Math.random() * 999999999);

    // Find the right connector for this model
    const connector = getConnector(model);

    // Build request with connector defaults as fallback
    const connectorReq: ConnectorRequest = {
      prompt: request.prompt,
      negative_prompt: connector.supports_negative ? request.negative_prompt : undefined,
      width: request.width || connector.defaults.width,
      height: request.height || connector.defaults.height,
      steps: request.steps || connector.defaults.steps,
      cfg: request.cfg || connector.defaults.cfg,
      seed,
      sampler: request.sampler || connector.defaults.sampler,
      scheduler: request.scheduler || connector.defaults.scheduler,
      style_image: request.style_image,
      style_weight: request.style_weight
    };

    // Build workflow via connector
    const workflow = connector.buildWorkflow(model, connectorReq);

    try {
      // Submit workflow
      const submitRes = await fetch(`${this.apiUrl}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: workflow })
      });

      if (!submitRes.ok) {
        const errText = await submitRes.text();
        return { success: false, error: `ComfyUI submit failed (${connector.id}): ${errText}` };
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

    for (let i = 0; i < requests.length; i++) {
      const outputPath = path.join(outputDir, `${(i + 1).toString().padStart(3, '0')}.png`);
      const result = await this.generate(requests[i], outputPath);
      results.push(result);
    }

    return results;
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
