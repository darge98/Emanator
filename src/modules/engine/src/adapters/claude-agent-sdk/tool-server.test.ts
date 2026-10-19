import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  defineTool,
  type JsonObjectSchema,
  type JsonSchemaToolDefinition,
  type ToolDefinition,
} from '../../domain/tool.ts';
import { createHarnessToolServer } from './tool-server.ts';

const echo = defineTool({
  name: 'echo',
  description: 'Repeats a word.',
  input: { word: z.string().min(1) },
  hints: { readOnly: true },
  run: async ({ word }) => ({ text: `echo ${word}` }),
});

const orderSchema: JsonObjectSchema = {
  type: 'object',
  properties: {
    order: {
      type: 'object',
      properties: { id: { type: 'string' }, region: { type: 'string', enum: ['eu', 'us'] } },
      required: ['id'],
    },
    tags: { type: 'array', items: { type: 'string' } },
  },
  required: ['order'],
};

const received: Record<string, unknown>[] = [];
const lookup: JsonSchemaToolDefinition = {
  name: 'lookup_order',
  description: 'Looks up an order.',
  inputSchema: structuredClone(orderSchema),
  hints: { readOnly: false, destructive: true },
  run: async (input) => {
    received.push(input);
    return { text: 'found' };
  },
};

let client: Client | undefined;

async function connect(tools: ToolDefinition[]): Promise<Client> {
  const { instance } = createHarnessToolServer(tools);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await instance.connect(serverSide);
  client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientSide);
  return client;
}

afterEach(async () => {
  await client?.close();
  client = undefined;
  received.length = 0;
});

describe('createHarnessToolServer', () => {
  it('lists zod Tools as JSON Schema and JSON Schema Tools unchanged', async () => {
    const { tools } = await (await connect([echo, lookup])).listTools();

    expect(tools.map(({ name }) => name)).toEqual(['echo', 'lookup_order']);
    expect(tools[0]?.inputSchema).toMatchObject({
      type: 'object',
      properties: { word: { type: 'string', minLength: 1 } },
      required: ['word'],
    });
    expect(tools[1]?.inputSchema).toEqual(orderSchema);
    expect(tools[1]?.annotations).toEqual({ readOnlyHint: false, destructiveHint: true });
  });

  it('hands JSON Schema Tools their arguments as they are', async () => {
    const result = await (await connect([lookup])).callTool({
      name: 'lookup_order',
      arguments: { order: { id: 'A1', region: 'eu' }, tags: ['x'] },
    });

    expect(result).toMatchObject({ content: [{ type: 'text', text: 'found' }], isError: false });
    expect(received).toEqual([{ order: { id: 'A1', region: 'eu' }, tags: ['x'] }]);
  });

  it('checks the input of zod Tools before running them', async () => {
    const mcp = await connect([echo]);

    expect(await mcp.callTool({ name: 'echo', arguments: { word: 'hi' } })).toMatchObject({
      content: [{ text: 'echo hi' }],
      isError: false,
    });
    const invalid = await mcp.callTool({ name: 'echo', arguments: { word: '' } });
    expect(invalid.isError).toBe(true);
    expect(JSON.stringify(invalid.content)).toContain('Invalid input for \\"echo\\"');
  });

  it('turns a crash or an unknown Tool into an error result', async () => {
    const broken = defineTool({
      name: 'broken',
      description: 'Always fails.',
      input: {},
      run: async () => {
        throw new Error('boom');
      },
    });
    const mcp = await connect([broken]);

    expect(await mcp.callTool({ name: 'broken', arguments: {} })).toMatchObject({
      content: [{ text: 'Tool "broken" failed: boom' }],
      isError: true,
    });
    expect(await mcp.callTool({ name: 'missing', arguments: {} })).toMatchObject({
      content: [{ text: 'There is no Tool called "missing".' }],
      isError: true,
    });
  });
});
