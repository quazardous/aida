/**
 * MCP Tool shared types (mirrors Sailing pattern)
 */

export interface ToolDefinition {
  tool: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  };
  handler: (args: any) => ToolResult | Promise<ToolResult>;
}

export interface NextAction {
  tool: string;
  args: Record<string, unknown>;
  reason: string;
  priority: 'high' | 'normal' | 'low';
}

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export function ok(data: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }]
  };
}

export function err(message: string, next_actions?: NextAction[]): ToolResult {
  const data: Record<string, unknown> = { success: false, error: message };
  if (next_actions) data.next_actions = next_actions;
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    isError: true
  };
}
