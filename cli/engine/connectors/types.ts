/**
 * Connector Types — abstraction layer between AIDA and model-specific workflows
 *
 * A connector knows how to build a ComfyUI workflow for a specific model family.
 * The engine calls the connector, the connector returns a workflow dict.
 * AIDA never needs to know if it's Flux, SDXL, SD1.5, etc.
 */

export interface ConnectorRequest {
  prompt: string;
  negative_prompt?: string;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  seed: number;
  // Optional overrides
  sampler?: string;
  scheduler?: string;
  // Style reference (IP-Adapter)
  style_image?: string;
  style_weight?: number;
}

export interface Connector {
  /** Connector ID (e.g. "flux", "sdxl", "sd15") */
  id: string;
  /** Human-readable name */
  name: string;
  /** Model file patterns this connector handles (glob) */
  model_patterns: string[];
  /** Default generation params for this model family */
  defaults: {
    steps: number;
    cfg: number;
    sampler: string;
    scheduler: string;
    width: number;
    height: number;
  };
  /** Can this connector handle negative prompts? */
  supports_negative: boolean;
  /** Build a ComfyUI workflow from a request */
  buildWorkflow(model: string, request: ConnectorRequest): Record<string, any>;
}

/**
 * Match a model filename to the right connector
 */
export function matchConnector(model: string, connectors: Connector[]): Connector | null {
  for (const c of connectors) {
    for (const pattern of c.model_patterns) {
      if (pattern.includes('*')) {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$', 'i');
        if (regex.test(model)) return c;
      } else if (model.toLowerCase().includes(pattern.toLowerCase())) {
        return c;
      }
    }
  }
  return null;
}
