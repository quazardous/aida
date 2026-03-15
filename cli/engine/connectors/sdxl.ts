/**
 * SDXL Connector — builds ComfyUI workflows for SDXL models
 *
 * SDXL specifics:
 * - Supports negative prompt
 * - CFG 5-8 typical
 * - 1024x1024 native resolution
 * - Standard KSampler
 */
import type { Connector, ConnectorRequest } from './types.js';

export const sdxlConnector: Connector = {
  id: 'sdxl',
  name: 'Stable Diffusion XL',
  model_patterns: ['*sdxl*', '*sd_xl*', '*SDXL*'],
  supports_negative: true,
  defaults: {
    steps: 25,
    cfg: 7.0,
    sampler: 'euler',
    scheduler: 'normal',
    width: 1024,
    height: 1024
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
      '3': {
        class_type: 'CLIPTextEncode',
        inputs: {
          text: req.negative_prompt || '',
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
          scheduler: req.scheduler || 'normal',
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
