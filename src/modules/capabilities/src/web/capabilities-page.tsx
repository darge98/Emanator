import type { Policy, PolicyGroup } from '@emanator/policies';
import { type PolicyChoices, PolicyLegend, ToolPolicyList } from '@emanator/policies/web';
import {
  ArrowClockwise,
  Check,
  DotsThree,
  Info,
  MagnifyingGlass,
  PencilSimple,
  Plug,
  PlugsConnected,
  Plus,
  Trash,
  WarningCircle,
  X,
  XCircle,
} from '@phosphor-icons/react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { type Capability, type CapabilityStatus, suggestSlug } from '../domain/capability.ts';
import type { CatalogItem } from '../domain/catalog.ts';
import styles from './capabilities-page.module.css';
// Google's own product icons, from its CDN (www.gstatic.com/images/branding/productlogos).
import calendarLogo from './logos/calendar.svg';
import driveLogo from './logos/drive.svg';
import gmailLogo from './logos/gmail.svg';
import tasksLogo from './logos/tasks.svg';

/** A Capability as the API sends it: dates are ISO strings. */
type CapabilityDto = Omit<Capability, 'createdAt' | 'updatedAt'> & {
  createdAt: string;
  updatedAt: string;
};

type CatalogItemDto = Omit<CatalogItem, 'capability'> & { capability?: CapabilityDto };

interface ConnectOutcomeDto {
  capability: CapabilityDto;
  authorizationUrl?: string;
}

/** The editor keeps every field as text until saving. */
interface Draft {
  title: string;
  slug: string;
  url: string;
  scopes: string;
  enabled: boolean;
  clientId: string;
  /** Empty keeps the stored secret, unless `removeSecret` is set. */
  clientSecret: string;
  removeSecret: boolean;
}

/** One tile of the page: a catalog entry, or a custom server the Owner added. */
interface Entry {
  /** The catalog entry's id, or the custom Capability's. */
  key: string;
  title: string;
  description: string;
  icon: Glyph;
  capability?: CapabilityDto;
  item?: CatalogItemDto;
}

/** Draws a tile's icon at the given size. */
type Glyph = (props: { size: number }) => ReactNode;

/** A service's own logo, as its maker publishes it. */
const logo =
  (src: string): Glyph =>
  ({ size }) => <img src={src} width={size} height={size} alt="" />;

const CUSTOM_SERVER: Glyph = ({ size }) => <Plug size={size} />;

const ICONS: Record<string, Glyph> = {
  gmail: logo(gmailLogo),
  calendar: logo(calendarLogo),
  drive: logo(driveLogo),
  tasks: logo(tasksLogo),
};

const t = {
  page: 'Capabilities',
  eyebrow: 'Your Agent',
  intro: 'Connect your accounts so your Agent can work with them.',
  search: 'Search Capabilities',
  add: 'Add',
  addCustom: 'Add a custom MCP server',
  added: 'Yours',
  available: 'Available',
  nothingFound: 'Nothing matches your search.',
  empty: 'Nothing to connect yet.',
  loading: 'Loading Capabilities…',
  loadError: 'Could not load your Capabilities.',
  retry: 'Try again',
  ready: 'Ready',
  saving: 'Saving…',
  saved: 'Changes saved',
  close: 'Close',
  details: (title: string) => `${title}: details`,
  connectTo: (title: string) => `Connect ${title}`,
  connected: (title: string) => `“${title}” is connected.`,
  authorizationFailed: 'The authorization did not complete.',
  status: {
    disconnected: 'Not connected',
    connected: 'Connected',
    'needs-auth': 'Needs authorization',
    error: 'Error',
  } satisfies Record<CapabilityStatus, string>,
  off: 'Off',
  needsSetup: 'Needs setup',
  missingEnv: (variables: string[]) =>
    `Add ${variables.join(' and ')} to .env, then restart the Harness.`,
  customServer: 'Custom MCP server',
  connect: 'Connect',
  reconnect: 'Reconnect',
  connecting: 'Connecting…',
  refresh: 'Refresh Tools',
  disconnect: 'Disconnect',
  edit: 'Edit',
  tools: 'Tools',
  noTools: 'No Tools yet: connect it to list them.',
  loadingTools: 'Loading Tools…',
  savePolicies: 'Save Policies',
  discard: 'Discard',
  nextTurn: 'Policies apply from the next turn.',
  newTitle: 'Custom MCP server',
  editTitle: 'Edit custom server',
  editorHint:
    'Changing the address, the client or the scopes disconnects it: connect it again after.',
  trustHint:
    'Its Tools start from the Policies the server itself suggests, which nothing checks. Add only servers you trust, and review their Policies once connected.',
  title: 'Name',
  titleHint: 'E.g. Notion · Work',
  slug: 'Slug',
  slugHelp: 'Prefixes its Tool names. It cannot change later.',
  url: 'MCP server address',
  urlHint: 'https://…/mcp',
  scopes: 'OAuth scopes',
  scopesHint: 'One per line',
  scopesHelp: 'Leave empty to ask for the scopes the server lists. Ask only for what you need.',
  clientId: 'Client ID',
  clientIdHint: 'Leave empty to register automatically',
  clientIdHelp: 'Only for servers that need a client you registered yourself.',
  clientSecret: 'Client secret',
  secretStored: 'Stored · type to replace it',
  secretRemoved: 'Will be removed when you save',
  removeSecret: 'Remove secret',
  keepSecret: 'Keep secret',
  enabledLabel: 'On',
  enabledHelp: 'When off, your Agent gets none of its Tools, but the connection stays.',
  cancel: 'Cancel',
  save: 'Save',
  delete: 'Delete',
  confirmDelete: (title: string) => ({
    title: `Delete “${title}”?`,
    body: 'Its connection and the Policies of its Tools go with it.',
    confirm: 'Delete',
    cancel: 'Keep it',
    tone: 'danger' as const,
  }),
  confirmDisconnect: (title: string) => ({
    title: `Disconnect “${title}”?`,
    body: 'Its authorization and the Policies of its Tools are forgotten. You can connect it again at any time.',
    confirm: 'Disconnect',
    cancel: 'Keep it',
    tone: 'danger' as const,
  }),
  confirmDiscard: {
    title: 'Discard your changes?',
    body: 'The edits you made have not been saved.',
    confirm: 'Discard changes',
    cancel: 'Keep editing',
    tone: 'danger' as const,
  },
  saveError: 'Save failed.',
  actionError: 'The action failed.',
};

type Copy = typeof t;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers,
  });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      message = body.error || message;
    } catch {
      /* use status */
    }
    throw new Error(message);
  }
  return (response.status === 204 ? undefined : response.json()) as Promise<T>;
}

const emptyDraft = (): Draft => ({
  title: '',
  slug: '',
  url: '',
  scopes: '',
  enabled: true,
  clientId: '',
  clientSecret: '',
  removeSecret: false,
});

function toDraft(capability: CapabilityDto): Draft {
  return {
    ...emptyDraft(),
    title: capability.title,
    slug: capability.slug,
    url: capability.url,
    scopes: capability.scopes.join('\n'),
    enabled: capability.enabled,
    clientId: capability.clientId ?? '',
  };
}

/** What the API receives; the server does the real validation. */
function toInput(draft: Draft, isNew: boolean): unknown {
  const secret = draft.removeSecret ? '' : draft.clientSecret.trim() || undefined;
  return {
    title: draft.title,
    ...(isNew && draft.slug.trim() && { slug: draft.slug.trim() }),
    url: draft.url,
    scopes: draft.scopes.split(/\s+/).filter(Boolean),
    enabled: draft.enabled,
    ...(draft.clientId.trim() && { clientId: draft.clientId.trim() }),
    ...(secret !== undefined && { clientSecret: secret }),
  };
}

const STATUS_TONE: Record<CapabilityStatus, string | undefined> = {
  disconnected: undefined,
  connected: 'success',
  'needs-auth': 'warn',
  error: 'danger',
};

/** The dashboard comes back here from an authorization page with the outcome in the query. */
function takeAuthorizationOutcome(): { authorized?: string; error?: string } {
  const params = new URLSearchParams(window.location.search);
  const authorized = params.get('authorized') ?? undefined;
  const error = params.get('authorization_error') ?? undefined;
  if (authorized || error) {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash}`);
  }
  return { ...(authorized && { authorized }), ...(error && { error }) };
}

/** Catalog entries first, then the custom servers the Owner added. */
function entriesOf(catalog: CatalogItemDto[], capabilities: CapabilityDto[]): Entry[] {
  return [
    ...catalog.map((item) => ({
      key: item.id,
      title: item.title,
      description: item.description,
      icon: ICONS[item.icon] ?? CUSTOM_SERVER,
      item,
      ...(item.capability && { capability: item.capability }),
    })),
    ...capabilities
      .filter(({ catalogId }) => !catalogId)
      .map((capability) => {
        const address = new URL(capability.url);
        return {
          key: capability.id,
          title: capability.title,
          description: `${address.host}${address.pathname}`,
          icon: CUSTOM_SERVER,
          capability,
        };
      }),
  ];
}

/** Whether the tile's button opens the details: once connected, or while setup is missing. */
function opensDetails({ capability, item }: Entry): boolean {
  if (item?.missing.length) return true;
  return capability !== undefined && capability.status !== 'disconnected';
}

/** A small note next to the name, only when something needs the Owner's eye. */
function noteOf({ capability, item }: Entry, t: Copy): { text: string; tone?: string } | undefined {
  if (!capability) return item?.missing.length ? { text: t.needsSetup, tone: 'warn' } : undefined;
  if (capability.status !== 'connected') {
    return { text: t.status[capability.status], tone: STATUS_TONE[capability.status] };
  }
  return capability.enabled ? undefined : { text: t.off };
}

interface CapabilitiesPageProps {
  footer: ReactNode;
  /** Told whenever unsaved edits appear or go away, so the app can guard navigation. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Asks the Owner a yes/no question in the dashboard's dialog. */
  confirm: (question: {
    title: string;
    body: string;
    confirm: string;
    cancel: string;
    tone?: 'danger' | 'default';
  }) => Promise<boolean>;
}

/** What the dialog shows: one entry's details, or the editor of a custom server. */
type Open = { kind: 'details'; key: string } | { kind: 'editor'; id?: string } | undefined;

type Message = { kind: 'error' | 'success'; text: string };

/** Capabilities as a catalog: connect what you need, and open one to see its Tools. */
export function CapabilitiesPage({ footer, onDirtyChange, confirm }: CapabilitiesPageProps) {
  const [capabilities, setCapabilities] = useState<CapabilityDto[]>([]);
  const [catalog, setCatalog] = useState<CatalogItemDto[]>([]);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Open>();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [pristine, setPristine] = useState<Draft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Message>();
  /** Bumped after a connection or a refresh, to reload the open Tools. */
  const [toolsVersion, setToolsVersion] = useState(0);
  const [busy, setBusy] = useState<string>();
  const [policiesDirty, setPoliciesDirty] = useState(false);
  const editorDirty = open?.kind === 'editor' && JSON.stringify(draft) !== JSON.stringify(pristine);
  const dirty = editorDirty || policiesDirty;

  const entries = entriesOf(catalog, capabilities);
  const needle = query.trim().toLowerCase();
  const shown = entries.filter(
    ({ title, description }) => !needle || `${title} ${description}`.toLowerCase().includes(needle),
  );
  const yours = shown.filter(({ capability }) => capability);
  const available = shown.filter(({ capability }) => !capability);
  const opened = open?.kind === 'details' ? entries.find(({ key }) => key === open.key) : undefined;

  const load = useCallback(async () => {
    try {
      const [list, items] = await Promise.all([
        request<CapabilityDto[]>('/api/capabilities'),
        request<CatalogItemDto[]>('/api/capabilities/catalog'),
      ]);
      setCapabilities(list);
      setCatalog(items);
      setLoadState('ready');
      return { list, items };
    } catch {
      // A failed refresh keeps the list already shown.
      setLoadState((state) => (state === 'loading' ? 'error' : state));
      return undefined;
    }
  }, []);

  useEffect(() => {
    const outcome = takeAuthorizationOutcome();
    void load().then((loaded) => {
      if (outcome.error) {
        setMessage({ kind: 'error', text: `${t.authorizationFailed} ${outcome.error}` });
      } else if (outcome.authorized && loaded) {
        const capability = loaded.list.find(({ id }) => id === outcome.authorized);
        setMessage({ kind: 'success', text: t.connected(capability?.title ?? '') });
        // Back from the authorization page: show what was just connected.
        if (capability) setOpen({ kind: 'details', key: capability.catalogId ?? capability.id });
      }
    });
  }, [load]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);

  /** Opens something else in the dialog, asking first when edits would be lost. */
  async function show(next: Open) {
    if (dirty && !(await confirm(t.confirmDiscard))) return;
    setPoliciesDirty(false);
    if (next?.kind === 'editor') {
      const capability = capabilities.find(({ id }) => id === next.id);
      const value = capability ? toDraft(capability) : emptyDraft();
      setDraft(value);
      setPristine(value);
    }
    setOpen(next);
    if (next) setMessage(undefined);
  }

  async function save() {
    if (open?.kind !== 'editor') return;
    setSaving(true);
    setMessage(undefined);
    try {
      const body = JSON.stringify(toInput(draft, open.id === undefined));
      const saved = open.id
        ? await request<CapabilityDto>(`/api/capabilities/${open.id}`, { method: 'PUT', body })
        : await request<CapabilityDto>('/api/capabilities', { method: 'POST', body });
      await load();
      setOpen({ kind: 'details', key: saved.id });
      setMessage({ kind: 'success', text: t.saved });
    } catch (error) {
      setMessage({ kind: 'error', text: `${t.saveError} ${(error as Error).message}` });
    } finally {
      setSaving(false);
    }
  }

  /** Deletes a custom server, or disconnects a catalog entry, which stays in the catalog. */
  async function remove(capability: CapabilityDto) {
    const question = capability.catalogId
      ? t.confirmDisconnect(capability.title)
      : t.confirmDelete(capability.title);
    if (!(await confirm(question))) return;
    try {
      await request(`/api/capabilities/${capability.id}`, { method: 'DELETE' });
      setPoliciesDirty(false);
      setOpen(undefined);
      await load();
    } catch (error) {
      setMessage({ kind: 'error', text: `${t.actionError} ${(error as Error).message}` });
    }
  }

  /** Connects, or sends the browser to the authorization page, which comes back here. */
  async function connect(entry: Entry) {
    setBusy(entry.key);
    setMessage(undefined);
    try {
      const path = entry.item
        ? `/api/capabilities/catalog/${entry.item.id}`
        : `/api/capabilities/${entry.key}`;
      const outcome = await request<ConnectOutcomeDto>(`${path}/connect`, { method: 'POST' });
      if (outcome.authorizationUrl) {
        window.location.assign(outcome.authorizationUrl);
        return;
      }
      setMessage({ kind: 'success', text: t.connected(outcome.capability.title) });
      setToolsVersion((version) => version + 1);
      await load();
      setOpen({ kind: 'details', key: entry.key });
    } catch (error) {
      setMessage({ kind: 'error', text: `${t.actionError} ${(error as Error).message}` });
      await load();
    }
    setBusy(undefined);
  }

  async function setEnabled(id: string, enabled: boolean) {
    setMessage(undefined);
    try {
      await request(`/api/capabilities/${id}/enabled`, {
        method: 'PUT',
        body: JSON.stringify({ enabled }),
      });
    } catch (error) {
      setMessage({ kind: 'error', text: `${t.actionError} ${(error as Error).message}` });
    }
    await load();
  }

  async function refresh(entry: Entry) {
    if (!entry.capability) return;
    setBusy(entry.key);
    setMessage(undefined);
    try {
      await request(`/api/capabilities/${entry.capability.id}/tools`, { method: 'POST' });
      setToolsVersion((version) => version + 1);
    } catch (error) {
      setMessage({ kind: 'error', text: `${t.actionError} ${(error as Error).message}` });
    }
    await load();
    setBusy(undefined);
  }

  /** The tile's button: connects what is ready, opens the rest. */
  function act(entry: Entry) {
    if (opensDetails(entry)) void show({ kind: 'details', key: entry.key });
    else void connect(entry);
  }

  const status = saving ? t.saving : message?.kind === 'success' ? message.text : t.ready;
  const tone = saving ? 'saving' : message?.kind === 'success' ? 'saved' : 'idle';
  const editing =
    open?.kind === 'editor' ? capabilities.find(({ id }) => id === open.id) : undefined;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <span className="eyebrow">{t.eyebrow}</span>
          <h1>{t.page}</h1>
          <p>{t.intro}</p>
        </div>
        <div className="page-actions">
          <span className="status" data-tone={tone} aria-live="polite">
            {status}
          </span>
        </div>
      </header>

      <div className={styles.toolbar}>
        <label className={styles.search}>
          <MagnifyingGlass size={16} aria-hidden="true" />
          <span className="visually-hidden">{t.search}</span>
          <input
            className="input"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t.search}
          />
        </label>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void show({ kind: 'editor' })}
          title={t.addCustom}
        >
          <Plus size={16} weight="bold" aria-hidden="true" />
          {t.add}
        </button>
      </div>

      {message?.kind === 'error' && !open && (
        <div className={`notice ${styles.notice}`} data-tone="error" role="alert">
          <WarningCircle size={16} aria-hidden="true" />
          {message.text}
        </div>
      )}

      {loadState === 'loading' ? (
        <div className="skeleton-stack" role="status" aria-label={t.loading}>
          <span className="skeleton" />
          <span className="skeleton" />
        </div>
      ) : loadState === 'error' ? (
        <div className="state" data-tone="error" role="alert">
          <span className="state-icon">
            <WarningCircle size={22} aria-hidden="true" />
          </span>
          <h2>{t.loadError}</h2>
          <button type="button" className="btn btn-secondary" onClick={() => void load()}>
            <ArrowClockwise size={16} aria-hidden="true" />
            {t.retry}
          </button>
        </div>
      ) : (
        <div className={styles.groups}>
          {shown.length === 0 && (
            <p className={styles.empty}>{needle ? t.nothingFound : t.empty}</p>
          )}
          {[
            { id: 'yours', title: t.added, list: yours },
            { id: 'available', title: t.available, list: available },
          ]
            .filter(({ list }) => list.length > 0)
            .map(({ id, title, list }) => (
              <section key={id} aria-labelledby={`capabilities-${id}`}>
                <h2 id={`capabilities-${id}`} className={styles['group-title']}>
                  {title}
                </h2>
                <ul className={styles.grid}>
                  {list.map((entry) => (
                    <EntryTile
                      key={entry.key}
                      entry={entry}
                      t={t}
                      busy={busy === entry.key}
                      onOpen={() => void show({ kind: 'details', key: entry.key })}
                      onAct={() => act(entry)}
                    />
                  ))}
                </ul>
              </section>
            ))}
        </div>
      )}

      {opened && (
        <Dialog labelledBy="capability-dialog-title" onClose={() => void show(undefined)}>
          <EntryDetails
            entry={opened}
            t={t}
            busy={busy === opened.key}
            error={message?.kind === 'error' ? message.text : undefined}
            toolsVersion={toolsVersion}
            onClose={() => void show(undefined)}
            onConnect={() => void connect(opened)}
            onRefresh={() => void refresh(opened)}
            onEnabledChange={(enabled) =>
              opened.capability && void setEnabled(opened.capability.id, enabled)
            }
            onRemove={() => opened.capability && void remove(opened.capability)}
            onEdit={() => void show({ kind: 'editor', id: opened.key })}
            onPoliciesDirty={setPoliciesDirty}
          />
        </Dialog>
      )}

      {open?.kind === 'editor' && (
        <Dialog labelledBy="capability-editor-title" onClose={() => void show(undefined)}>
          <CapabilityEditor
            t={t}
            isNew={open.id === undefined}
            stored={editing}
            draft={draft}
            onChange={setDraft}
            saving={saving}
            dirty={editorDirty}
            error={message?.kind === 'error' ? message.text : undefined}
            onSave={() => void save()}
            onCancel={() => void show(undefined)}
            {...(editing && { onDelete: () => void remove(editing) })}
          />
        </Dialog>
      )}

      {footer}
    </div>
  );
}

function EntryTile({
  entry,
  t,
  busy,
  onOpen,
  onAct,
}: {
  entry: Entry;
  t: Copy;
  busy: boolean;
  onOpen: () => void;
  onAct: () => void;
}) {
  const note = noteOf(entry, t);
  const opens = opensDetails(entry);
  return (
    <li className={styles.tile}>
      <button type="button" className={styles['tile-main']} onClick={onOpen}>
        <span className={styles.icon} aria-hidden="true">
          <entry.icon size={24} />
        </span>
        <span className={styles['tile-copy']}>
          <span className={styles['tile-title']}>
            {entry.title}
            {note && (
              <span className="badge" data-tone={note.tone}>
                {note.text}
              </span>
            )}
          </span>
          <span className={styles['tile-description']}>{entry.description}</span>
        </span>
      </button>
      <button
        type="button"
        className="icon-button"
        onClick={onAct}
        disabled={busy}
        aria-label={opens ? t.details(entry.title) : t.connectTo(entry.title)}
        title={opens ? t.details(entry.title) : t.connectTo(entry.title)}
      >
        {busy ? (
          <span className="spinner" aria-hidden="true" />
        ) : opens ? (
          <DotsThree size={20} weight="bold" aria-hidden="true" />
        ) : (
          <Plus size={20} aria-hidden="true" />
        )}
      </button>
    </li>
  );
}

/**
 * A modal over the page. Escape and the backdrop close it, unless the shell's own question
 * is open on top, which takes them for itself.
 */
function Dialog({
  labelledBy,
  onClose,
  children,
}: {
  labelledBy: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('[role="alertdialog"]')) return;
      close.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, []);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a click outside the dialog closes it; Escape does the same from the keyboard
    // biome-ignore lint/a11y/useKeyWithClickEvents: as above
    <div
      className="dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) close.current();
      }}
    >
      <div
        ref={panel}
        className={`dialog ${styles.dialog}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}

interface EntryDetailsProps {
  entry: Entry;
  t: Copy;
  busy: boolean;
  error: string | undefined;
  toolsVersion: number;
  onClose: () => void;
  onConnect: () => void;
  onRefresh: () => void;
  onEnabledChange: (enabled: boolean) => void;
  onRemove: () => void;
  onEdit: () => void;
  onPoliciesDirty: (dirty: boolean) => void;
}

function EntryDetails({
  entry,
  t,
  busy,
  error,
  toolsVersion,
  onClose,
  onConnect,
  onRefresh,
  onEnabledChange,
  onRemove,
  onEdit,
  onPoliciesDirty,
}: EntryDetailsProps) {
  const { capability, item } = entry;
  const connected = capability?.status === 'connected';
  const missing = item?.missing ?? [];
  return (
    <>
      <div className={styles['dialog-head']}>
        <span className={styles.icon} aria-hidden="true">
          <entry.icon size={24} />
        </span>
        <div className={styles['dialog-heading']}>
          <h2 id="capability-dialog-title">{entry.title}</h2>
          <p>{item ? entry.description : `${t.customServer} · ${entry.description}`}</p>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label={t.close}>
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      <div className={styles['dialog-status']}>
        {capability ? (
          <span className="badge" data-tone={STATUS_TONE[capability.status]}>
            {t.status[capability.status]}
          </span>
        ) : (
          <span className="badge" data-tone={missing.length > 0 ? 'warn' : undefined}>
            {missing.length > 0 ? t.needsSetup : t.status.disconnected}
          </span>
        )}
        {capability && (
          <label className={styles['row-switch']}>
            {t.enabledLabel}
            <input
              type="checkbox"
              className="switch"
              checked={capability.enabled}
              onChange={(event) => onEnabledChange(event.target.checked)}
            />
          </label>
        )}
      </div>

      {missing.length > 0 && (
        <p className="hint">
          <WarningCircle size={16} aria-hidden="true" />
          {t.missingEnv(missing)}
        </p>
      )}
      {item?.requires && !connected && (
        <p className="hint">
          <Info size={16} aria-hidden="true" />
          {item.requires}
        </p>
      )}
      {capability?.lastError && !connected && (
        <p className={styles['row-error']}>{capability.lastError}</p>
      )}
      {error && (
        <div className="notice" data-tone="error" role="alert">
          <WarningCircle size={16} aria-hidden="true" />
          {error}
        </div>
      )}

      <div className={styles['dialog-actions']}>
        {capability && !item && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit}>
            <PencilSimple size={16} aria-hidden="true" />
            {t.edit}
          </button>
        )}
        {capability && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onRemove} disabled={busy}>
            {item ? (
              <XCircle size={16} aria-hidden="true" />
            ) : (
              <Trash size={16} aria-hidden="true" />
            )}
            {item ? t.disconnect : t.delete}
          </button>
        )}
        {connected && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onRefresh}
            disabled={busy}
          >
            <ArrowClockwise size={16} aria-hidden="true" />
            {t.refresh}
          </button>
        )}
        <button
          type="button"
          className={`btn btn-sm ${connected ? 'btn-secondary' : 'btn-primary'}`}
          onClick={onConnect}
          disabled={busy || missing.length > 0}
        >
          {busy ? (
            <span className="spinner" aria-hidden="true" />
          ) : (
            <PlugsConnected size={16} aria-hidden="true" />
          )}
          {busy ? t.connecting : connected ? t.reconnect : t.connect}
        </button>
      </div>

      {capability && (
        <section className={styles['dialog-tools']} aria-label={t.tools}>
          <h3>{t.tools}</h3>
          <CapabilityTools
            key={toolsVersion}
            slug={capability.slug}
            t={t}
            onDirtyChange={onPoliciesDirty}
          />
        </section>
      )}
    </>
  );
}

/** The Policies of one Capability's Tools, saved on their own. */
function CapabilityTools({
  slug,
  t,
  onDirtyChange,
}: {
  slug: string;
  t: Copy;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [group, setGroup] = useState<PolicyGroup>();
  const [draft, setDraft] = useState<PolicyChoices>({});
  const [state, setState] = useState<'loading' | 'ready' | 'saving' | 'error'>('loading');
  const [error, setError] = useState('');
  const dirty = group?.tools.some((tool) => draft[tool.name] !== tool.policy) ?? false;

  const show = useCallback(
    (groups: PolicyGroup[]) => {
      const mine = groups.find(({ kind, name }) => kind === 'capability' && name === slug);
      setGroup(mine);
      setDraft(Object.fromEntries((mine?.tools ?? []).map((tool) => [tool.name, tool.policy])));
    },
    [slug],
  );

  useEffect(() => {
    let alive = true;
    request<PolicyGroup[]>('/api/policies')
      .then((groups) => {
        if (!alive) return;
        show(groups);
        setState('ready');
      })
      .catch(() => {
        if (alive) setState('error');
      });
    return () => {
      alive = false;
    };
  }, [show]);

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  async function save() {
    setState('saving');
    setError('');
    try {
      // Only this Capability's Tools: the other Policies stay as they are.
      show(
        await request<PolicyGroup[]>('/api/policies', {
          method: 'PUT',
          body: JSON.stringify({ policies: draft }),
        }),
      );
    } catch (failure) {
      setError(`${t.saveError} ${(failure as Error).message}`);
    }
    setState('ready');
  }

  if (state === 'loading')
    return (
      <div className={`${styles.tools} ${styles.muted}`} role="status">
        <span className="spinner" aria-hidden="true" />
        {t.loadingTools}
      </div>
    );
  if (state === 'error')
    return (
      <div className={styles.tools}>
        <p className="notice" data-tone="error">
          {t.actionError}
        </p>
      </div>
    );
  if (!group?.tools.length)
    return <div className={`${styles.tools} ${styles.muted}`}>{t.noTools}</div>;

  const saving = state === 'saving';
  return (
    <form
      className={styles.tools}
      aria-label={t.tools}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <PolicyLegend />
      <ToolPolicyList
        tools={group.tools}
        draft={draft}
        disabled={saving}
        onChange={(tool: string, policy: Policy) =>
          setDraft((current) => ({ ...current, [tool]: policy }))
        }
      />
      {error && (
        <div className="notice" data-tone="error" role="alert">
          <WarningCircle size={16} aria-hidden="true" />
          {error}
        </div>
      )}
      <div className={styles['tools-footer']}>
        <p className="hint">{t.nextTurn}</p>
        <div className="save-bar-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() =>
              setDraft(Object.fromEntries(group.tools.map((tool) => [tool.name, tool.policy])))
            }
            disabled={!dirty || saving}
          >
            {t.discard}
          </button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={!dirty || saving}>
            {saving ? (
              <span className="spinner" aria-hidden="true" />
            ) : (
              <Check size={16} weight="bold" aria-hidden="true" />
            )}
            {saving ? t.saving : t.savePolicies}
          </button>
        </div>
      </div>
    </form>
  );
}

interface CapabilityEditorProps {
  t: Copy;
  isNew: boolean;
  /** The saved Capability being edited, for what the draft can't show, like its secret. */
  stored: CapabilityDto | undefined;
  draft: Draft;
  onChange: (draft: Draft) => void;
  saving: boolean;
  dirty: boolean;
  error: string | undefined;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
}

function CapabilityEditor({
  t,
  isNew,
  stored,
  draft,
  onChange,
  saving,
  dirty,
  error,
  onSave,
  onCancel,
  onDelete,
}: CapabilityEditorProps) {
  // A secret belongs to its client: a new client ID won't keep it.
  const secretStored =
    (stored?.hasClientSecret ?? false) && draft.clientId.trim() === (stored?.clientId ?? '');
  return (
    <form
      className={styles.editor}
      aria-labelledby="capability-editor-title"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <div className={styles['editor-heading']}>
        <h2 id="capability-editor-title">{isNew ? t.newTitle : t.editTitle}</h2>
        <p>{t.editorHint}</p>
      </div>
      <p className="hint">
        <WarningCircle size={16} aria-hidden="true" />
        {t.trustHint}
      </p>
      <div className={styles['field-grid']}>
        <div className="field">
          <label htmlFor="capability-title">{t.title}</label>
          <input
            id="capability-title"
            className="input"
            value={draft.title}
            onChange={(e) => onChange({ ...draft, title: e.target.value })}
            placeholder={t.titleHint}
            maxLength={100}
            disabled={saving}
          />
        </div>
        <div className="field">
          <label htmlFor="capability-slug">{t.slug}</label>
          <input
            id="capability-slug"
            className="input mono"
            value={draft.slug}
            onChange={(e) => onChange({ ...draft, slug: e.target.value })}
            placeholder={suggestSlug(draft.title) || 'gmail-work'}
            maxLength={40}
            disabled={saving || !isNew}
            aria-describedby="capability-slug-help"
          />
          <small id="capability-slug-help" className="field-hint">
            {t.slugHelp}
          </small>
        </div>
      </div>
      <div className="field">
        <label htmlFor="capability-url">{t.url}</label>
        <input
          id="capability-url"
          className="input mono"
          type="url"
          value={draft.url}
          onChange={(e) => onChange({ ...draft, url: e.target.value })}
          placeholder={t.urlHint}
          maxLength={2000}
          disabled={saving}
        />
      </div>
      <div className="field">
        <label htmlFor="capability-scopes">{t.scopes}</label>
        <textarea
          id="capability-scopes"
          className="textarea mono"
          value={draft.scopes}
          onChange={(e) => onChange({ ...draft, scopes: e.target.value })}
          placeholder={t.scopesHint}
          rows={3}
          disabled={saving}
          aria-describedby="capability-scopes-help"
        />
        <small id="capability-scopes-help" className="field-hint">
          {t.scopesHelp}
        </small>
      </div>
      <div className={styles['field-grid']}>
        <div className="field">
          <label htmlFor="capability-client-id">{t.clientId}</label>
          <input
            id="capability-client-id"
            className="input mono"
            value={draft.clientId}
            onChange={(e) => onChange({ ...draft, clientId: e.target.value })}
            placeholder={t.clientIdHint}
            maxLength={500}
            disabled={saving}
            aria-describedby="capability-client-id-help"
            autoComplete="off"
          />
          <small id="capability-client-id-help" className="field-hint">
            {t.clientIdHelp}
          </small>
        </div>
        <div className="field">
          <div className="label-row">
            <label className="label" htmlFor="capability-client-secret">
              {t.clientSecret}
            </label>
            {secretStored && (
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  onChange({ ...draft, removeSecret: !draft.removeSecret, clientSecret: '' })
                }
                disabled={saving}
              >
                {draft.removeSecret ? t.keepSecret : t.removeSecret}
              </button>
            )}
          </div>
          <input
            id="capability-client-secret"
            className="input mono"
            type="password"
            value={draft.clientSecret}
            onChange={(e) => onChange({ ...draft, clientSecret: e.target.value })}
            placeholder={draft.removeSecret ? t.secretRemoved : secretStored ? t.secretStored : ''}
            maxLength={500}
            disabled={saving || draft.removeSecret || !draft.clientId.trim()}
            autoComplete="new-password"
          />
        </div>
      </div>

      <label className={styles.toggle}>
        <span>
          <strong>{t.enabledLabel}</strong>
          <small>{t.enabledHelp}</small>
        </span>
        <input
          type="checkbox"
          className="switch"
          checked={draft.enabled}
          onChange={(e) => onChange({ ...draft, enabled: e.target.checked })}
          disabled={saving}
        />
      </label>

      {error && (
        <div className="notice" data-tone="error" role="alert">
          <WarningCircle size={16} aria-hidden="true" />
          {error}
        </div>
      )}

      <div className={styles['editor-footer']}>
        {onDelete ? (
          <button type="button" className="btn btn-danger" onClick={onDelete} disabled={saving}>
            <Trash size={16} aria-hidden="true" />
            {t.delete}
          </button>
        ) : (
          <span />
        )}
        <div className="save-bar-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>
            {t.cancel}
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={saving || !dirty || !draft.title.trim() || !draft.url.trim()}
          >
            {saving ? (
              <span className="spinner" aria-hidden="true" />
            ) : (
              <Check size={16} weight="bold" aria-hidden="true" />
            )}
            {saving ? t.saving : t.save}
          </button>
        </div>
      </div>
    </form>
  );
}
