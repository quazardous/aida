/**
 * SD 1.5 Connector — builds ComfyUI workflows for SD 1.5 models
 *
 * SD 1.5 specifics:
 * - Supports negative prompt
 * - CFG 7-12 typical
 * - 512x512 native resolution
 * - Lightweight, fast, 8GB comfortable
 */
import type { Connector, ConnectorRequest } from './types.js';

export const sd15Connector: Connector = {
  id: 'sd15',
  name: 'Stable Diffusion 1.5',
  model_patterns: ['*sd-v1*', '*sd_v1*', '*v1-5*', '*1.5*', '*dreamshaper*', '*deliberate*', '*realistic*'],
  supports_negative: true,
  defaults: {
    steps: 30,
    cfg: 7.5,
    sampler: 'euler_ancestral',
    scheduler: 'normal',
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
      '3': {
        class_type: 'CLIPTextEncode',
        inputs: {
          text: req.negative_prompt || 'ugly, blurry, low quality',
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
          sampler_name: req.sampler || 'euler_ancestral',
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
