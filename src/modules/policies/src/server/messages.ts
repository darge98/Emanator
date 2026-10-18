import type { Approval, ApprovalStatus } from '../domain/approval.ts';

// What the Harness says about Approvals. Italian, like the other Telegram messages.

export const APPROVE_LABEL = 'Sì';
export const DENY_LABEL = 'No';

/** Long inputs are cut: the message has to fit on a phone screen. */
const MAX_INPUT_CHARS = 800;

export function approvalRequest({ tool, input }: Approval, reminder: boolean): string {
  const ask = `🔐 **Posso usare ${tool}?**`;
  return [reminder ? `⏰ **Promemoria** · ${ask}` : ask, ...inputBlock(input)].join('\n\n');
}

const OUTCOMES: Record<Exclude<ApprovalStatus, 'pending'>, string> = {
  approved: '✅ Approvata.',
  denied: '❌ Negata.',
  expired: '⌛ Scaduta senza risposta: vale come un no.',
};

/** Replaces the request once it is decided, without buttons. */
export function approvalOutcome(approval: Approval): string {
  const outcome = approval.status === 'pending' ? '' : OUTCOMES[approval.status];
  return [approvalRequest(approval, false), outcome].filter(Boolean).join('\n\n');
}

/** For a button whose request the Harness no longer knows. */
export const approvalGone = '⌛ Questa richiesta non è più valida.';

function inputBlock(input: Record<string, unknown>): string[] {
  if (Object.keys(input).length === 0) return [];
  let json = JSON.stringify(input, null, 2);
  if (json.length > MAX_INPUT_CHARS) json = `${json.slice(0, MAX_INPUT_CHARS)}…`;
  // A fence inside the input would close the code block early.
  return [`\`\`\`json\n${json.replaceAll('```', '`​``')}\n\`\`\``];
}
