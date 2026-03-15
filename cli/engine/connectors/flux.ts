/**
 * Flux Connector — builds ComfyUI workflows for Flux models
 *
 * Flux specifics:
 * - No negative prompt (single CLIP encode)
 * - Low CFG (1.0-2.0 typical)
 * - Uses "simple" or "sgm_uniform" scheduler
 * - Fewer steps needed (8-20)
 * - Dual CLIP (clip_l + t5xxl) but CheckpointLoaderSimple handles it
 */
import type { Connector, ConnectorRequest } from './types.js';

export const fluxConnector: Connector = {
  id: 'flux',
  name: 'Flux (Dev/Schnell)',
  model_patterns: ['flux*', '*flux*'],
  supports_negative: false,
  defaults: {
    steps: 8,
    cfg: 1.0,
    sampler: 'euler',
    scheduler: 'simple',
    width: 512,
    height: 512
  },

  buildWorkflow(model: string, req: ConnectorRequest): Record<string, any> {
    return {
      '1': {
        class_type: 'CheckpointLoaderSimple',
        inputs: { ckpt_name: model }
      },
      '2': {
        class_type: 'CLIPTextEncode',
        inputs: {
          text: req.prompt,
          clip: ['1', 1]
        }
      },
      // Empty conditioning for negative (Flux ignores it but KSampler needs it)
      '3': {
        class_type: 'CLIPTextEncode',
        inputs: {
          text: '',
          clip: ['1', 1]
        }
      },
      '4': {
        class_type: 'EmptyLatentImage',
        inputs: {
          width: req.width,
          height: req.height,
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
          seed: req.seed,
          steps: req.steps,
          cfg: req.cfg,
          sampler_name: req.sampler || 'euler',
          scheduler: req.scheduler || 'simple',
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
};
