/**
 * Engine factory — creates the right engine based on config
 */
import type { Engine, EngineConfig } from './types.js';
import { MockEngine } from './mock-engine.js';
import { ComfyUIEngine } from './comfyui-engine.js';

export function createEngine(config: EngineConfig): Engine {
  switch (config.backend) {
    case 'comfyui':
    case 'forge':
      // Forge uses the same API as ComfyUI
      return new ComfyUIEngine(config);

    case 'mock':
      return new MockEngine();

    case 'cloud':
      // TODO: implement cloud engine (replicate, fal.ai, etc.)
      throw new Error('Cloud engine not yet implemented');

    default:
      throw new Error(`Unknown engine backend: ${config.backend}`);
  }
}

export type { Engine, EngineConfig, GenerationRequest, GenerationResult } from './types.js';
