/**
 * End-to-end check of the Claude Agent SDK Engine against the Owner's real account.
 * Meant to run in Docker, where no Claude Code login from the host can leak in:
 *
 *   docker compose run --rm engine-smoke        # asks you to approve in the terminal
 *   docker compose run --rm -T engine-smoke     # no terminal: approvals are answered automatically
 *
 * It uses tiny prompts and cheap models where possible, but every turn spends real quota.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { buildQueryOptions } from '../src/adapters/claude-agent-sdk/options.ts';
import {
  defineTool,
  type EngineEvent,
  type PermissionDecider,
  type ToolDefinition,
  type TurnRequest,
} from '../src/index.ts';
import {
  ClaudeAgentSdkEngine,
  type ClaudeAgentSdkEngineConfig,
  engineCredentialsFromEnv,
} from '../src/server.ts';

const FAST_MODEL = process.env.SMOKE_FAST_MODEL ?? 'haiku';
const MAIN_MODEL = process.env.SMOKE_MAIN_MODEL ?? 'sonnet';
const EXTRA_MODELS = (process.env.SMOKE_EXTRA_MODELS ?? 'opus').split(',').filter(Boolean);
const APPROVAL_DELAY_MS = 3000;
const interactive = process.stdin.isTTY === true;

type Status = 'pass' | 'fail' | 'warn' | 'info';
interface Check {
  name: string;
  status: Status;
  details: string[];
}

interface TurnOutcome {
  events: EngineEvent[];
  started?: Extract<EngineEvent, { type: 'turn.started' }>;
  completed?: Extract<EngineEvent, { type: 'turn.completed' }>;
  failed?: Extract<EngineEvent, { type: 'turn.failed' }>;
}

const config = await loadConfig();
const engine = new ClaudeAgentSdkEngine(config);
const usageEvents: Extract<EngineEvent, { type: 'usage.limit' }>[] = [];
const checks: Check[] = [];

const plan = await probePlan();
checks.push(await checkAuthAndIsolation());
checks.push(...(await checkFacultiesAndApprovals()));
checks.push(...(await checkSessionsAndModels()));
checks.push(checkUsageSignals());
checks.push(checkUsageWindows());

const report = renderReport();
console.log(`\n${report}`);
const reportPath = join(dataDir(), 'smoke-report.md');
await writeFile(reportPath, report);
console.log(`Report saved to ${reportPath}`);
process.exitCode = checks.some((check) => check.status === 'fail') ? 1 : 0;

// --- Checks ---------------------------------------------------------------

async function checkAuthAndIsolation(): Promise<Check> {
  const turn = await runTurn('auth', {
    prompt: 'Reply with exactly one word: ready',
    model: FAST_MODEL,
  });
  const expected = config.credentials.kind === 'subscription-token' ? 'subscription' : 'api-key';
  const ok =
    turn.completed !== undefined &&
    turn.started?.credentials === expected &&
    turn.started.tools.length === 0;

  return {
    name: 'Authentication and isolation',
    status: ok ? 'pass' : 'fail',
    details: [
      `credentials reported: ${turn.started?.credentials ?? 'n/a'} (expected ${expected})`,
      `plan reported by the usage API: ${plan.subscription ?? 'n/a'}`,
      `Claude Code version: ${plan.claudeCodeVersion ?? 'n/a'}`,
      `tools visible to the model: ${JSON.stringify(turn.started?.tools ?? null)} (expected [])`,
      `model: ${turn.started?.model ?? 'n/a'}`,
      `reply: ${JSON.stringify(turn.completed?.text ?? turn.failed?.message ?? null)}`,
    ],
  };
}

async function checkFacultiesAndApprovals(): Promise<Check[]> {
  const prompt =
    'Call the get_time tool, then call the send_note tool with a note containing the time you got. ' +
    'Finish with one short sentence saying whether the note was sent.';

  const approved = await approvalScenario(prompt, interactive ? 'ask-owner' : 'allow');
  const denied = await approvalScenario(prompt, 'deny');

  return [
    {
      name: `Faculty + Approval granted${interactive ? ' (answered by you)' : ' (auto, after a delay)'}`,
      status:
        approved.calledTime &&
        approved.asked &&
        approved.waitedMs >= (interactive ? 0 : APPROVAL_DELAY_MS) &&
        approved.notes.length === (approved.answer === 'allow' ? 1 : 0) &&
        approved.turn.completed !== undefined
          ? 'pass'
          : 'fail',
      details: approved.details,
    },
    {
      name: 'Faculty + Approval denied (auto, after a delay)',
      status:
        denied.asked &&
        denied.notes.length === 0 &&
        denied.waitedMs >= APPROVAL_DELAY_MS &&
        denied.turn.completed !== undefined
          ? 'pass'
          : 'fail',
      details: denied.details,
    },
  ];
}

async function approvalScenario(prompt: string, mode: 'ask-owner' | 'allow' | 'deny') {
  const notes: string[] = [];
  let asked = false;
  let waitedMs = 0;
  let answer: 'allow' | 'deny' | undefined;

  const getTime = defineTool({
    name: 'get_time',
    description: 'Returns the current time as an ISO 8601 string.',
    input: {},
    hints: { readOnly: true },
    run: async () => ({ text: new Date().toISOString() }),
  });
  const sendNote = defineTool({
    name: 'send_note',
    description: 'Sends a short note to the Owner.',
    input: { note: z.string().describe('The text of the note') },
    hints: { readOnly: false },
    run: async ({ note }) => {
      notes.push(note);
      return { text: 'Note delivered.' };
    },
  });

  // Stand-in for the Policies module: get_time is "allow", send_note is "ask".
  const decidePermission: PermissionDecider = async (request) => {
    if (request.tool === 'get_time') return { behavior: 'allow' };
    if (request.tool !== 'send_note') return { behavior: 'deny', reason: 'Unknown tool.' };

    asked = true;
    const start = Date.now();
    answer =
      mode === 'ask-owner'
        ? await askOwner(`Approve send_note(${JSON.stringify(request.input)})? [y/N] `)
        : await delayed(mode);
    waitedMs = Date.now() - start;
    return answer === 'allow'
      ? { behavior: 'allow' }
      : { behavior: 'deny', reason: 'The Owner did not approve sending this note.' };
  };

  const turn = await runTurn(`approval:${mode}`, {
    prompt,
    model: FAST_MODEL,
    tools: [getTime, sendNote] as ToolDefinition[],
    decidePermission,
  });
  const called = turn.events.filter((e) => e.type === 'tool.called').map((e) => e.tool);

  return {
    turn,
    notes,
    asked,
    waitedMs,
    answer,
    calledTime: called.includes('get_time'),
    details: [
      `tools called: ${JSON.stringify(called)}`,
      `approval asked: ${asked}, answer: ${answer ?? 'n/a'}, waited ${waitedMs} ms`,
      `notes delivered: ${JSON.stringify(notes)}`,
      `denials reported: ${JSON.stringify(turn.events.filter((e) => e.type === 'tool.denied').map((e) => e.tool))}`,
      `reply: ${JSON.stringify(turn.completed?.text ?? turn.failed?.message ?? null)}`,
    ],
  };
}

async function checkSessionsAndModels(): Promise<Check[]> {
  const first = await runTurn('session:remember', {
    prompt: 'Remember this code word for later: lampone. Reply only with: OK',
    model: FAST_MODEL,
  });
  const second = first.completed
    ? await runTurn('session:recall', {
        prompt: 'What code word did I ask you to remember? Reply with just the word.',
        model: MAIN_MODEL,
        session: first.completed.session,
      })
    : undefined;

  const recalled = second?.completed?.text.toLowerCase().includes('lampone') ?? false;
  const checks: Check[] = [
    {
      name: 'Session resume with a different model per turn',
      status: recalled && first.started?.model !== second?.started?.model ? 'pass' : 'fail',
      details: [
        `turn 1: model ${first.started?.model ?? 'n/a'}, session ${first.completed?.session.id ?? 'n/a'}`,
        `turn 2: model ${second?.started?.model ?? 'n/a'}, session ${second?.completed?.session.id ?? 'n/a'}`,
        `recalled: ${JSON.stringify(second?.completed?.text ?? second?.failed?.message ?? null)}`,
      ],
    },
  ];

  for (const model of EXTRA_MODELS) {
    const turn = await runTurn(`model:${model}`, { prompt: 'Reply with exactly: ok', model });
    checks.push({
      name: `Model "${model}" on this plan`,
      status: 'info',
      details: [
        turn.completed
          ? `available: ${turn.started?.model ?? model}`
          : `not available: ${turn.failed?.reason ?? 'n/a'} — ${turn.failed?.message ?? ''}`,
      ],
    });
  }
  return checks;
}

function checkUsageSignals(): Check {
  const last = usageEvents.at(-1);
  return {
    name: 'Usage limit signals',
    status: last || plan.rateLimits ? 'pass' : 'fail',
    details: [
      `usage.limit events received: ${usageEvents.length}`,
      `last event: ${last ? JSON.stringify(last) : 'n/a'}`,
      `raw rate_limit_info seen by the probe: ${plan.rawRateLimitInfo.length ? JSON.stringify(plan.rawRateLimitInfo) : 'none'}`,
      `usage API windows: ${plan.rateLimits ? JSON.stringify(plan.rateLimits) : 'n/a'}`,
    ],
  };
}

/** Per-window utilization comes from an undocumented SDK field: losing it degrades, never breaks. */
function checkUsageWindows(): Check {
  const windows = usageEvents.findLast((event) => event.windows)?.windows;
  return {
    name: 'Usage per window (undocumented SDK field, best-effort)',
    status: windows ? 'pass' : 'warn',
    details: windows
      ? windows.map(
          (w) =>
            `${w.name}: ${Math.round(w.utilization * 100)}% used, resets ${w.resetsAt?.toISOString() ?? 'n/a'}`,
        )
      : [
          'No per-window utilization received. The Engine still works, but usage percentages are gone:',
          'check whether this SDK version renamed or dropped `unifiedWindows` in rate_limit_event.',
        ],
  };
}

// --- Plumbing ---------------------------------------------------------------

async function runTurn(
  label: string,
  request: Omit<TurnRequest, 'decidePermission'> & Partial<TurnRequest>,
) {
  console.log(`\n▶ ${label}`);
  const outcome: TurnOutcome = { events: [] };
  for await (const event of engine.runTurn({
    decidePermission: async () => ({ behavior: 'deny', reason: 'No tools expected here.' }),
    ...request,
  })) {
    console.log(`  ${event.type} ${JSON.stringify(withoutType(event))}`);
    outcome.events.push(event);
    if (event.type === 'turn.started') outcome.started = event;
    if (event.type === 'turn.completed') outcome.completed = event;
    if (event.type === 'turn.failed') outcome.failed = event;
    if (event.type === 'usage.limit') usageEvents.push(event);
  }
  return outcome;
}

/** Asks the SDK directly for plan and limits; this API is experimental, so it stays out of the Engine port. */
async function probePlan() {
  console.log('\n▶ plan probe');
  const found: {
    subscription?: string | null;
    claudeCodeVersion?: string;
    rateLimits?: unknown;
    rawRateLimitInfo: unknown[];
  } = { rawRateLimitInfo: [] };

  const abortController = new AbortController();
  const run = query({
    prompt: single('Reply with exactly: ok'),
    options: {
      ...buildQueryOptions({
        request: {
          prompt: '',
          model: FAST_MODEL,
          decidePermission: async () => ({ behavior: 'allow' }),
        },
        config,
        canUseTool: async () => ({ behavior: 'deny', message: 'No tools in the probe.' }),
        abortController,
      }),
    },
  });

  try {
    for await (const message of run) {
      if (message.type === 'system' && message.subtype === 'init') {
        found.claudeCodeVersion = message.claude_code_version;
        try {
          const usage = await run.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({
            skipBehaviors: true,
          });
          found.subscription = usage.subscription_type;
          found.rateLimits = usage.rate_limits;
        } catch (error) {
          console.log(
            `  usage API unavailable: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      if (message.type === 'rate_limit_event') found.rawRateLimitInfo.push(message.rate_limit_info);
    }
  } catch (error) {
    console.log(`  probe failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  console.log(`  ${JSON.stringify(found)}`);
  return found;
}

async function loadConfig(): Promise<ClaudeAgentSdkEngineConfig> {
  const configDir = join(dataDir(), 'claude');
  const workingDirectory = join(dataDir(), 'workspace');
  await mkdir(configDir, { recursive: true });
  await mkdir(workingDirectory, { recursive: true });

  return {
    credentials: engineCredentialsFromEnv(),
    configDir,
    defaultModel: MAIN_MODEL,
    defaultWorkingDirectory: workingDirectory,
  };
}

function dataDir(): string {
  return process.env.EMANATOR_DATA_DIR ?? join(process.cwd(), 'data');
}

async function askOwner(question: string): Promise<'allow' | 'deny'> {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const reply = await readline.question(`  ${question}`);
    return reply.trim().toLowerCase().startsWith('y') ? 'allow' : 'deny';
  } finally {
    readline.close();
  }
}

async function delayed(answer: 'allow' | 'deny'): Promise<'allow' | 'deny'> {
  console.log(`  (approval pending, answering "${answer}" in ${APPROVAL_DELAY_MS} ms)`);
  await new Promise((resolve) => setTimeout(resolve, APPROVAL_DELAY_MS));
  return answer;
}

async function* single(prompt: string): AsyncIterable<SDKUserMessage> {
  yield { type: 'user', message: { role: 'user', content: prompt }, parent_tool_use_id: null };
}

function withoutType(event: EngineEvent): Record<string, unknown> {
  const { type: _type, ...rest } = event;
  return rest;
}

function renderReport(): string {
  const icon: Record<Status, string> = { pass: '✅', fail: '❌', warn: '⚠️', info: 'ℹ️' };
  const lines = [
    '# Engine smoke report',
    '',
    `- Date: ${new Date().toISOString()}`,
    `- Credentials: ${config.credentials.kind}`,
    `- Models: fast=${FAST_MODEL}, main=${MAIN_MODEL}, extra=${EXTRA_MODELS.join(',') || 'none'}`,
    `- Approvals: ${interactive ? 'interactive' : 'automatic'}`,
    '',
  ];
  for (const check of checks) {
    lines.push(
      `## ${icon[check.status]} ${check.name}`,
      '',
      ...check.details.map((d) => `- ${d}`),
      '',
    );
  }
  return lines.join('\n');
}
