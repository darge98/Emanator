import type { PermissionDecider, PermissionDecision, PermissionRequest } from '@emanator/engine';
import { errorMessage, type Logger } from '@emanator/shared/server';
import {
  type Policy,
  PolicyValidationError,
  type ToolInfo,
  type ToolPolicy,
  validatePolicies,
} from '../domain/policy.ts';
import type { ApprovalService } from './approval-service.ts';
import type { PolicyStore } from './policy-store.ts';

export interface PolicyServiceDeps {
  store: Pick<PolicyStore, 'policies' | 'replacePolicies'>;
  approvals: Pick<ApprovalService, 'request'>;
  /** Every Tool the Agent can have, from Faculties and Capabilities. */
  tools: () => readonly ToolInfo[];
  logger: Logger;
}

/** Where and how a turn asks for Approvals. */
export interface DeciderContext {
  /** The thread to ask in; may open it, e.g. a Routine's topic. Undefined is General. */
  thread: () => Promise<string | undefined>;
  /** Called while an Approval is pending, e.g. to show a Run as waiting. */
  onWaiting?: (waiting: boolean) => void | Promise<void>;
}

/** Decides how the Agent may use each Tool: the Owner's choice, else the Tool's default. */
export class PolicyService {
  constructor(private readonly deps: PolicyServiceDeps) {}

  async list(): Promise<ToolPolicy[]> {
    const chosen = await this.deps.store.policies();
    return this.deps.tools().map((tool) => {
      const custom = chosen.get(tool.name);
      return { ...tool, policy: custom ?? tool.defaultPolicy, custom: custom !== undefined };
    });
  }

  /**
   * Saves the Owner's choices, `{ policies: { [tool]: policy } }`. A Tool left out, or set
   * to its default, goes back to the default. Nothing is saved if any choice is invalid.
   */
  async save(input: unknown): Promise<ToolPolicy[]> {
    const chosen = new Map<string, Policy>();
    for (const [tool, policy] of Object.entries(validatePolicies(input))) {
      const info = this.deps.tools().find(({ name }) => name === tool);
      if (!info) throw new PolicyValidationError(`There is no Tool called "${tool}".`);
      // A Policy the Engine can't enforce would be ignored without a word.
      if (info.choices && !info.choices.includes(policy)) {
        throw new PolicyValidationError(
          `"${tool}" can only be set to: ${info.choices.join(', ')}.`,
        );
      }
      if (policy !== info.defaultPolicy) chosen.set(tool, policy);
    }
    await this.deps.store.replacePolicies(chosen);
    return this.list();
  }

  /** A Tool nobody declared is denied: the Agent only has Tools the Owner can see. */
  async policyOf(tool: string): Promise<Policy> {
    return (await this.list()).find(({ name }) => name === tool)?.policy ?? 'deny';
  }

  /** Leaves out the denied Tools, so the model doesn't try them. */
  async usable<T extends { name: string }>(tools: readonly T[]): Promise<T[]> {
    const policies = await this.list();
    const denied = new Set(policies.filter((p) => p.policy === 'deny').map((p) => p.name));
    return tools.filter(({ name }) => !denied.has(name));
  }

  /**
   * The PermissionDecider of one turn. Anything that goes wrong while deciding denies the
   * Tool: a turn never fails, nor runs a Tool, because the Harness could not check it.
   */
  decider(context: DeciderContext): PermissionDecider {
    return async (request) => {
      try {
        return await this.decide(request, context);
      } catch (error) {
        this.deps.logger.error('Could not decide on a Tool use', {
          tool: request.tool,
          error: errorMessage(error),
        });
        return { behavior: 'deny', reason: 'The Harness could not check this use of the Tool.' };
      }
    };
  }

  private async decide(
    { tool, input, signal }: PermissionRequest,
    { thread, onWaiting }: DeciderContext,
  ): Promise<PermissionDecision> {
    const policy = await this.policyOf(tool);
    if (policy === 'allow') return { behavior: 'allow' };
    if (policy === 'deny') {
      return { behavior: 'deny', reason: 'The Owner does not allow this Tool.' };
    }
    const threadId = await thread();
    await this.reportWaiting(onWaiting, true);
    try {
      const status = await this.deps.approvals.request({ tool, input, threadId, signal });
      if (status === 'approved') return { behavior: 'allow' };
      return {
        behavior: 'deny',
        reason:
          status === 'denied'
            ? 'The Owner did not approve this use of the Tool.'
            : 'The Owner did not answer the Approval request in time.',
      };
    } finally {
      await this.reportWaiting(onWaiting, false);
    }
  }

  /** Only a status display depends on it, so a failure must not change the decision. */
  private async reportWaiting(
    onWaiting: DeciderContext['onWaiting'],
    waiting: boolean,
  ): Promise<void> {
    try {
      await onWaiting?.(waiting);
    } catch (error) {
      this.deps.logger.warn('Could not report a pending Approval', { error: errorMessage(error) });
    }
  }
}
