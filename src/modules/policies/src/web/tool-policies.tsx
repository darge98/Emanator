import type { Policy, ToolPolicy } from '../domain/policy.ts';
import styles from './tool-policies.module.css';

const ALL_POLICIES: readonly Policy[] = ['allow', 'ask', 'deny'];

const t = {
  byDefault: 'default',
  legend: 'What each Policy means',
  defaultMeaning: 'the default Policy',
  meaning: {
    allow: 'uses it on its own',
    ask: 'asks you on Telegram first',
    deny: 'never uses it',
  },
  policy: { allow: 'Allow', ask: 'Ask', deny: 'Deny' },
} satisfies {
  policy: Record<Policy, string>;
  meaning: Record<Policy, string>;
  [key: string]: unknown;
};

/** The Tools' Policies being edited, by Tool name. */
export type PolicyChoices = Record<string, Policy>;

/** What each Policy means, shown once above the Tools. */
export function PolicyLegend() {
  return (
    <ul className={styles.legend} aria-label={t.legend}>
      {ALL_POLICIES.map((policy) => (
        <li key={policy}>
          <strong className={styles[policy]}>{t.policy[policy]}</strong>
          {t.meaning[policy]}
        </li>
      ))}
      <li>
        <span className={styles['default-dot']} aria-hidden="true" />
        {t.defaultMeaning}
      </li>
    </ul>
  );
}

interface ToolPolicyListProps {
  tools: readonly ToolPolicy[];
  draft: PolicyChoices;
  disabled: boolean;
  onChange: (tool: string, policy: Policy) => void;
}

/** One row per Tool, offering only the Policies it can enforce. */
export function ToolPolicyList({ tools, draft, disabled, onChange }: ToolPolicyListProps) {
  return (
    <ul className={`panel ${styles.tools}`}>
      {tools.map((tool) => (
        <ToolRow
          key={tool.name}
          tool={tool}
          value={draft[tool.name] ?? tool.policy}
          disabled={disabled}
          onChange={(policy) => onChange(tool.name, policy)}
        />
      ))}
    </ul>
  );
}

function ToolRow({
  tool,
  value,
  disabled,
  onChange,
}: {
  tool: ToolPolicy;
  value: Policy;
  disabled: boolean;
  onChange: (policy: Policy) => void;
}) {
  const choices = tool.choices ?? ALL_POLICIES;
  return (
    <li className={styles.tool} data-changed={value !== tool.policy}>
      <div className={styles['tool-copy']}>
        <strong>{tool.title}</strong>
        <code>{tool.name}</code>
      </div>
      <fieldset className={`segmented ${styles.choices}`} disabled={disabled}>
        <legend className="visually-hidden">{tool.title}</legend>
        {choices.map((policy) => (
          <button
            type="button"
            key={policy}
            className={styles[policy]}
            aria-pressed={value === policy}
            onClick={() => onChange(policy)}
          >
            {t.policy[policy]}
            {policy === tool.defaultPolicy && (
              <>
                <span className={styles['default-dot']} aria-hidden="true" />
                <span className="visually-hidden"> ({t.byDefault})</span>
              </>
            )}
          </button>
        ))}
      </fieldset>
    </li>
  );
}
