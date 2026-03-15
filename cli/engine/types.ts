/**
 * Engine types — abstraction layer for image generation backends
 */

export interface EngineConfig {
  backend: 'comfyui' | 'forge' | 'cloud' | 'mock';
  api_url: string;
  api_key?: string;
  default_model: string;
  default_steps: number;
  default_cfg: number;
  default_sampler: string;
  default_scheduler: string;
  default_width: number;
  default_height: number;
  batch_size: number;
  seed_mode: 'random' | 'incremental' | 'fixed';
  fixed_seed?: number;
}

export interface GenerationRequest {
  prompt: string;
  negative_prompt?: string;
  width?: number;
  height?: number;
  steps?: number;
  cfg?: number;
  sampler?: string;
  scheduler?: string;
  seed?: number;
  model?: string;
  // IP-Adapter style reference
  style_image?: string;
  style_weight?: number;
}

export interface GenerationResult {
  success: boolean;
  image_path?: string;
  seed_used?: number;
  prompt_used?: string;
  error?: string;
  duration_ms?: number;
}

export interface Engine {
  name: string;
  isAvailable(): Promise<boolean>;
  generate(request: GenerationRequest, outputPath: string): Promise<GenerationResult>;
  generateBatch(requests: GenerationRequest[], outputDir: string): Promise<GenerationResult[]>;
}
