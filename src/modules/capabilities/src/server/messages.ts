import type { Capability } from '../domain/capability.ts';

// What the Harness says about Capabilities. Italian, like the other Telegram messages.

export function needsAuthorizationNotice({ title }: Capability, pageUrl: string): string {
  return [
    `🔌 **${title}** va autorizzata di nuovo.`,
    `Finché non lo fai non posso usarla: aprila nella dashboard (${pageUrl}) e premi Connect.`,
  ].join('\n\n');
}
