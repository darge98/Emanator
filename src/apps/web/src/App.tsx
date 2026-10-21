import { CapabilitiesPage } from '@emanator/capabilities/web';
import { DreamPanel } from '@emanator/dreams/web';
import { ModelPanel } from '@emanator/engine/web';
import { FacultiesPage } from '@emanator/faculties/web';
import { MemoryPage } from '@emanator/memory/web';
import { PersonaPage } from '@emanator/personas/web';
import { RoutinesPage } from '@emanator/routines/web';
import {
  Brain,
  Fingerprint,
  type Icon,
  Plug,
  SlidersHorizontal,
  Timer,
} from '@phosphor-icons/react';
import { type MouseEvent, useCallback, useEffect, useRef, useState } from 'react';
import { ConfirmDialog, type ConfirmRequest } from './confirm-dialog.tsx';

type Page = 'persona' | 'memory' | 'routines' | 'faculties' | 'capabilities';

const NAV: readonly { page: Page; title: string; Icon: Icon }[] = [
  { page: 'persona', title: 'Persona', Icon: Fingerprint },
  { page: 'memory', title: 'Memory', Icon: Brain },
  { page: 'routines', title: 'Routines', Icon: Timer },
  { page: 'faculties', title: 'Faculties', Icon: SlidersHorizontal },
  { page: 'capabilities', title: 'Capabilities', Icon: Plug },
];

const PAGES: readonly Page[] = NAV.map(({ page }) => page);

const LEAVE: ConfirmRequest = {
  title: 'Unsaved changes',
  body: 'If you leave this page now, the changes you have not saved will be lost.',
  confirm: 'Leave without saving',
  cancel: 'Stay here',
  tone: 'danger',
};

const pageFromHash = (): Page =>
  PAGES.find((page) => window.location.hash === `#${page}`) ?? 'persona';

export default function App() {
  const [page, setPage] = useState<Page>(pageFromHash);
  /** The question on screen, and how to hand its answer back to whoever asked. */
  const [asking, setAsking] = useState<{
    request: ConfirmRequest;
    resolve: (confirmed: boolean) => void;
  }>();
  const dirty = useRef(false);
  const current = useRef(page);
  current.current = page;
  const onDirtyChange = useCallback((value: boolean) => {
    dirty.current = value;
  }, []);

  useEffect(() => {
    const title = NAV.find((item) => item.page === page)?.title;
    document.title = title ? `${title} · Emanator` : 'Emanator';
  }, [page]);

  /** Pages ask through this, so every question uses the same dialog. */
  const confirm = useCallback(
    (request: ConfirmRequest) =>
      new Promise<boolean>((resolve) =>
        setAsking((previous) => {
          // A new question replaces one still open, which counts as a no.
          previous?.resolve(false);
          return { request, resolve };
        }),
      ),
    [],
  );

  const answer = useCallback(
    (confirmed: boolean) => {
      asking?.resolve(confirmed);
      setAsking(undefined);
    },
    [asking],
  );

  const askToLeave = useCallback(
    async (target: Page) => {
      if (!(await confirm(LEAVE))) return;
      dirty.current = false;
      window.location.hash = target;
    },
    [confirm],
  );

  useEffect(() => {
    // Back and forward: put the address back and ask before leaving unsaved edits.
    const follow = () => {
      const target = pageFromHash();
      if (target === current.current) return;
      if (dirty.current) {
        window.history.replaceState(null, '', `#${current.current}`);
        void askToLeave(target);
        return;
      }
      setPage(target);
    };
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, [askToLeave]);

  /** Sidebar links ask first, without touching the history, when edits would be lost. */
  function navigate(target: Page, event: MouseEvent) {
    if (target === page || !dirty.current) return;
    event.preventDefault();
    void askToLeave(target);
  }

  const footer = (
    <footer className="footer">
      <span>emanator</span>
      <span>·</span>
      <span>Your space, your rules.</span>
    </footer>
  );

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Main navigation">
        {/* biome-ignore lint/a11y/useValidAnchor: real links; the click only asks before losing unsaved edits */}
        <a
          className="brand"
          href="#persona"
          aria-label="Emanator"
          onClick={(event) => navigate('persona', event)}
        >
          <img src="/assets/emanator.svg" alt="" />
          <span>emanator</span>
        </a>
        <div className="nav-group">
          <div className="nav-label">Your Agent</div>
          <nav className="nav">
            {NAV.map(({ page: target, title, Icon }) => (
              <a
                key={target}
                className={`nav-item ${page === target ? 'active' : ''}`}
                href={`#${target}`}
                aria-current={page === target ? 'page' : undefined}
                onClick={(event) => navigate(target, event)}
              >
                <Icon size={18} weight={page === target ? 'fill' : 'regular'} aria-hidden="true" />
                <span>{title}</span>
              </a>
            ))}
          </nav>
        </div>
        <div className="sidebar-bottom">
          <span className="agent-mark" aria-hidden="true" />
          Personal Agent
          <span className="version">v1</span>
        </div>
      </aside>
      <main className="main">
        {page === 'capabilities' ? (
          <CapabilitiesPage footer={footer} onDirtyChange={onDirtyChange} confirm={confirm} />
        ) : page === 'faculties' ? (
          <FacultiesPage footer={footer} onDirtyChange={onDirtyChange} />
        ) : page === 'memory' ? (
          <MemoryPage footer={footer} dream={<DreamPanel />} confirm={confirm} />
        ) : page === 'routines' ? (
          <RoutinesPage footer={footer} onDirtyChange={onDirtyChange} confirm={confirm} />
        ) : (
          <PersonaPage
            footer={footer}
            model={<ModelPanel />}
            onDirtyChange={onDirtyChange}
            confirm={confirm}
          />
        )}
      </main>
      {asking && <ConfirmDialog request={asking.request} onAnswer={answer} />}
    </div>
  );
}
