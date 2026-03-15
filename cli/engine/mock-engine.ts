/**
 * Mock Engine — generates placeholder images for testing without GPU
 */
import fs from 'fs';
import path from 'path';
import type { Engine, GenerationRequest, GenerationResult, EngineConfig } from './types.js';

export class MockEngine implements Engine {
  name = 'mock';

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async generate(request: GenerationRequest, outputPath: string): Promise<GenerationResult> {
    const start = Date.now();
    const seed = request.seed ?? Math.floor(Math.random() * 999999);

    // Write a text file as placeholder (no actual image generation)
    const dir = path.dirname(outputPath);
    fs.mkdirSync(dir, { recursive: true });

    const placeholder = [
      `MOCK GENERATION`,
      `================`,
      `Prompt: ${request.prompt}`,
      `Negative: ${request.negative_prompt || 'none'}`,
      `Size: ${request.width || 1024}x${request.height || 1024}`,
      `Steps: ${request.steps || 25}`,
      `CFG: ${request.cfg || 7}`,
      `Seed: ${seed}`,
      `Model: ${request.model || 'mock'}`,
      `Style ref: ${request.style_image || 'none'}`,
      `Generated: ${new Date().toISOString()}`
    ].join('\n');

    // Write as .txt alongside what would be the .png
    const txtPath = outputPath.replace(/\.png$/, '.mock.txt');
    fs.writeFileSync(txtPath, placeholder);

    return {
      success: true,
      image_path: txtPath,
      seed_used: seed,
      prompt_used: request.prompt,
      duration_ms: Date.now() - start
    };
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
}
