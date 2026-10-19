import { randomUUID } from 'node:crypto';
import { type Database, runMigrations, transaction } from '@emanator/shared/server';
import type { Approval, ApprovalStatus } from '../domain/approval.ts';
import type { Policy } from '../domain/policy.ts';
import { policyMigrations } from './migrations.ts';

type Row = Record<string, unknown>;

/** Policies are configuration and Approvals runtime state, both in PostgreSQL (ADR 0007). */
export class PolicyStore {
  constructor(private readonly db: Database) {}

  async init(): Promise<void> {
    await runMigrations(this.db, 'policies', policyMigrations);
  }

  /** The Policies the Owner chose, by Tool name. */
  async policies(): Promise<Map<string, Policy>> {
    const { rows } = await this.db.query('SELECT tool, policy FROM tool_policies');
    return new Map(rows.map((row) => [String(row.tool), row.policy as Policy]));
  }

  /** Replaces every choice at once, so a save from the dashboard applies whole or not at all. */
  async replacePolicies(policies: ReadonlyMap<string, Policy>): Promise<void> {
    await transaction(this.db, async (client) => {
      await client.query('DELETE FROM tool_policies');
      const now = new Date();
      for (const [tool, policy] of policies) {
        await client.query(
          'INSERT INTO tool_policies (tool, policy, updated_at) VALUES ($1, $2, $3)',
          [tool, policy, now],
        );
      }
    });
  }

  async createApproval(
    tool: string,
    input: Record<string, unknown>,
    threadId: string | undefined,
  ): Promise<Approval> {
    const approval: Approval = {
      id: randomUUID(),
      tool,
      input,
      ...(threadId !== undefined && { threadId }),
      status: 'pending',
      messageIds: [],
      requestedAt: new Date(),
    };
    await this.db.query(
      `INSERT INTO approvals (id, tool, input, thread_id, status, requested_at)
       VALUES ($1, $2, $3, $4, 'pending', $5)`,
      [approval.id, tool, JSON.stringify(input), threadId ?? null, approval.requestedAt],
    );
    return approval;
  }

  async getApproval(id: string): Promise<Approval | undefined> {
    const {
      rows: [row],
    } = await this.db.query('SELECT * FROM approvals WHERE id = $1', [id]);
    return row ? toApproval(row) : undefined;
  }

  async addApprovalMessage(id: string, messageId: string): Promise<void> {
    await this.db.query(
      'UPDATE approvals SET message_ids = message_ids || $2::jsonb WHERE id = $1',
      [id, JSON.stringify([messageId])],
    );
  }

  /**
   * Decides a pending Approval and returns it, or undefined when it was already decided:
   * of two answers racing, e.g. a press and the expiry, only the first counts.
   */
  async decideApproval(
    id: string,
    status: Exclude<ApprovalStatus, 'pending'>,
  ): Promise<Approval | undefined> {
    const {
      rows: [row],
    } = await this.db.query(
      `UPDATE approvals SET status = $2, decided_at = $3
       WHERE id = $1 AND status = 'pending' RETURNING *`,
      [id, status, new Date()],
    );
    return row ? toApproval(row) : undefined;
  }

  /** Expires every pending Approval, e.g. those whose turn ended with the last process. */
  async expirePendingApprovals(): Promise<Approval[]> {
    const { rows } = await this.db.query(
      `UPDATE approvals SET status = 'expired', decided_at = $1
       WHERE status = 'pending' RETURNING *`,
      [new Date()],
    );
    return rows.map(toApproval);
  }
}

function toApproval(row: Row): Approval {
  return {
    id: String(row.id),
    tool: String(row.tool),
    input: row.input as Record<string, unknown>,
    ...(row.thread_id !== null && { threadId: String(row.thread_id) }),
    status: row.status as ApprovalStatus,
    messageIds: row.message_ids as string[],
    requestedAt: row.requested_at as Date,
    ...(row.decided_at !== null && { decidedAt: row.decided_at as Date }),
  };
}
