/**
 * MCP Tools — References (web research, URLs, inspiration sources)
 *
 * During mood exploration and bestiary design, the agent can:
 * - Store URLs suggested by the user
 * - Record search queries and their findings
 * - Store insights extracted from web research
 * - Link references to specific axes they inform
 *
 * The agent uses its native WebSearch/WebFetch to do the actual research,
 * then stores the findings here for persistence and genome influence.
 */
import type { Store } from '../managers/store.js';
import { ok, err } from './types.js';
import type { ToolDefinition } from './types.js';
import type { Reference } from '../lib/types.js';

export function createReferenceTools(store: Store): ToolDefinition[] {
  return [
    {
      tool: {
        name: 'ref_add',
        description: 'Add a reference to a node (URL, image, search result, or note). References inform the artistic direction with background depth.',
        inputSchema: {
          type: 'object',
          properties: {
            node_id: { type: 'string', description: 'Node ID to attach reference to' },
            type: {
              type: 'string',
              enum: ['url', 'image', 'search', 'note'],
              description: 'Reference type'
            },
            source: { type: 'string', description: 'URL, file path, search query, or free text' },
            title: { type: 'string', description: 'Short title' },
            description: { type: 'string', description: 'What this reference is about' },
            axes_hint: {
              type: 'array',
              items: { type: 'string' },
              description: 'Which axes this reference informs (e.g. ["température", "vécu"])'
            },
            insights: {
              type: 'array',
              items: { type: 'string' },
              description: 'Key takeaways extracted from this reference'
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Tags for organization'
            }
          },
          required: ['node_id', 'type', 'source', 'title']
        }
      },
      handler: (args) => {
        try {
          const node = store.getNode(args.node_id);
          if (!node) return err(`Node not found: ${args.node_id}`);

          const ref = store.addRef(
            args.node_id,
            args.type,
            args.source,
            args.title,
            args.description,
            args.axes_hint || [],
            args.insights || [],
            args.tags || []
          );

          const nextActions: any[] = [];

          // If insights mention axes, suggest genome updates
          if (args.insights && args.insights.length > 0 && args.axes_hint && args.axes_hint.length > 0) {
            nextActions.push({
              tool: 'genome_bulk_update',
              args: {
                node_id: args.node_id,
                updates: args.axes_hint.map((axis: string) => ({ axis, confidence: undefined }))
              },
              reason: 'Reference insights may inform genome axes',
              priority: 'low'
            });
          }

          // Suggest searching for more if it's a URL
          if (args.type === 'url') {
            nextActions.push({
              tool: 'ref_list',
              args: { node_id: args.node_id },
              reason: 'View all references for this node',
              priority: 'low'
            });
          }

          return ok({
            success: true,
            data: ref,
            next_actions: nextActions
          });
        } catch (e: any) {
          return err(e.message);
        }
      }
    },
    {
      tool: {
        name: 'ref_list',
        description: 'List references for a node, optionally filtered by type.',
        inputSchema: {
          type: 'object',
          properties: {
            node_id: { type: 'string', description: 'Node ID' },
            type: {
              type: 'string',
              enum: ['url', 'image', 'search', 'note'],
              description: 'Filter by type'
            }
          },
          required: ['node_id']
        }
      },
      handler: (args) => {
        const node = store.getNode(args.node_id);
        if (!node) return err(`Node not found: ${args.node_id}`);

        const refs = store.getRefs(args.node_id, args.type);

        return ok({
          success: true,
          data: {
            node_id: args.node_id,
            refs: refs.map(r => ({
              id: r.id,
              type: r.type,
              source: r.source,
              title: r.title,
              description: r.description,
              axes_hint: r.axes_hint,
              insights: r.insights,
              tags: r.tags
            })),
            count: refs.length
          }
        });
      }
    },
    {
      tool: {
        name: 'ref_search',
        description: 'Search across all references (title, description, source).',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' }
          },
          required: ['query']
        }
      },
      handler: (args) => {
        const refs = store.searchRefs(args.query);
        return ok({
          success: true,
          data: {
            query: args.query,
            refs: refs.map(r => ({
              id: r.id,
              node_id: r.node_id,
              type: r.type,
              source: r.source,
              title: r.title,
              insights: r.insights
            })),
            count: refs.length
          }
        });
      }
    },
    {
      tool: {
        name: 'ref_remove',
        description: 'Remove a reference.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Reference ID' }
          },
          required: ['id']
        }
      },
      handler: (args) => {
        try {
          store.removeRef(args.id);
          return ok({ success: true, data: { removed: args.id } });
        } catch (e: any) {
          return err(e.message);
        }
      }
    },
    {
      tool: {
        name: 'ref_store_research',
        description: 'Store the results of a web research session. Call this after using WebSearch/WebFetch to persist findings.',
        inputSchema: {
          type: 'object',
          properties: {
            node_id: { type: 'string', description: 'Node ID' },
            query: { type: 'string', description: 'The search query used' },
            findings: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  url: { type: 'string' },
                  title: { type: 'string' },
                  insight: { type: 'string', description: 'What was learned from this source' }
                },
                required: ['title', 'insight']
              },
              description: 'List of findings from the research'
            },
            axes_affected: {
              type: 'array',
              items: { type: 'string' },
              description: 'Which genome axes were informed by this research'
            },
            summary: { type: 'string', description: 'Overall summary of research findings' }
          },
          required: ['node_id', 'query', 'findings']
        }
      },
      handler: (args) => {
        try {
          const node = store.getNode(args.node_id);
          if (!node) return err(`Node not found: ${args.node_id}`);

          const refs: Reference[] = [];

          // Store the search query itself
          const searchRef = store.addRef(
            args.node_id,
            'search',
            args.query,
            `Research: ${args.query}`,
            args.summary || null,
            args.axes_affected || [],
            args.findings.map((f: any) => f.insight),
            ['research']
          );
          refs.push(searchRef);

          // Store each finding with a URL as a separate reference
          for (const finding of args.findings) {
            if (finding.url) {
              const urlRef = store.addRef(
                args.node_id,
                'url',
                finding.url,
                finding.title,
                finding.insight,
                args.axes_affected || [],
                [finding.insight],
                ['research']
              );
              refs.push(urlRef);
            }
          }

          return ok({
            success: true,
            data: {
              node_id: args.node_id,
              query: args.query,
              refs_created: refs.length,
              refs: refs.map(r => ({ id: r.id, type: r.type, title: r.title }))
            },
            next_actions: args.axes_affected?.length > 0 ? [{
              tool: 'genome_bulk_update',
              args: {
                node_id: args.node_id,
                updates: args.axes_affected.map((a: string) => ({ axis: a }))
              },
              reason: 'Research findings may require genome adjustments',
              priority: 'normal'
            }] : []
          });
        } catch (e: any) {
          return err(e.message);
        }
      }
    }
  ];
}
