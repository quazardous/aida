/**
 * Connector Registry — auto-detects the right connector for a model
 */
import type { Connector } from './types.js';
import { matchConnector } from './types.js';
import { fluxConnector } from './flux.js';
import { sdxlConnector } from './sdxl.js';
import { sd15Connector } from './sd15.js';

// Ordered by priority — first match wins
const CONNECTORS: Connector[] = [
  fluxConnector,
  sdxlConnector,
  sd15Connector
];

/**
 * Get the right connector for a model filename.
 * Falls back to sd15 if nothing matches.
 */
export function getConnector(model: string): Connector {
  return matchConnector(model, CONNECTORS) || sd15Connector;
}

/**
 * List all available connectors.
 */
export function listConnectors(): Connector[] {
  return CONNECTORS;
}

export type { Connector, ConnectorRequest } from './types.js';
