import { FacultiesPage } from '@emanator/faculties/web';
import { PersonaPage } from '@emanator/personas/web';
import { RoutinesPage } from '@emanator/routines/web';
import { type MouseEvent, useCallback, useEffect, useRef, useState } from 'react';
import { LeaveDialog } from './leave-dialog.tsx';

type Page = 'persona' | 'routines' | 'faculties';

const PAGES: readonly Page[] = ['persona', 'routines', 'faculties'];

const pageFromHash = (): Page =>
  PAGES.find((page) => window.location.hash === `#${page}`) ?? 'persona';

export default function App() {
  const [language, setLanguage] = useState<'it' | 'en'>(() => {
    try {
      return localStorage.getItem('emanator-language') === 'en' ? 'en' : 'it';
    } catch {
      return 'it';
    }
  });

  const [page, setPage] = useState<Page>(pageFromHash);
  /** The page the Owner tried to open while the current one has unsaved edits. */
  const [pending, setPending] = useState<Page>();
  const dirty = useRef(false);
  const current = useRef(page);
  current.current = page;
  const onDirtyChange = useCallback((value: boolean) => {
    dirty.current = value;
  }, []);

  useEffect(() => {
    // Back and forward: put the address back and ask before leaving unsaved edits.
    const follow = () => {
      const target = pageFromHash();
      if (target === current.current) return;
      if (dirty.current) {
        window.history.replaceState(null, '', `#${current.current}`);
        setPending(target);
        return;
      }
      setPage(target);
    };
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, []);

  /** Sidebar links ask first, without touching the history, when edits would be lost. */
  function navigate(target: Page, event: MouseEvent) {
    if (target === page || !dirty.current) return;
    event.preventDefault();
    setPending(target);
  }

  const stay = useCallback(() => setPending(undefined), []);
  function leave() {
    if (!pending) return;
    dirty.current = false;
    setPending(undefined);
    window.location.hash = pending;
  }

  useEffect(() => {
    document.documentElement.lang = language;
    try {
      localStorage.setItem('emanator-language', language);
    } catch {
      /* language still works for this session */
    }
  }, [language]);

  const languageControl = (
    <fieldset className="language-switch">
      <legend className="visually-hidden">Language</legend>
      <button
        type="button"
        className={language === 'it' ? 'selected' : ''}
        onClick={() => setLanguage('it')}
        aria-pressed={language === 'it'}
      >
        IT
      </button>
      <button
        type="button"
        className={language === 'en' ? 'selected' : ''}
        onClick={() => setLanguage('en')}
        aria-pressed={language === 'en'}
      >
        EN
      </button>
    </fieldset>
  );
  const footer = (
    <footer className="footer">
      <span>emanator</span>
      <span>·</span>
      <span>{language === 'it' ? 'Il tuo spazio, le tue regole.' : 'Your space, your rules.'}</span>
    </footer>
  );

  return (
    <div className="app-shell">
      <aside
        className="sidebar"
        aria-label={language === 'it' ? 'Navigazione principale' : 'Main navigation'}
      >
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
        <div className="nav-label">{language === 'it' ? 'PERSONALE' : 'PERSONAL'}</div>
        <nav className="nav">
          {/* biome-ignore lint/a11y/useValidAnchor: as above */}
          <a
            className={`nav-item ${page === 'persona' ? 'active' : ''}`}
            href="#persona"
            aria-current={page === 'persona' ? 'page' : undefined}
            onClick={(event) => navigate('persona', event)}
          >
            <span className="nav-icon" aria-hidden="true">
              ◉
            </span>
            Persona
          </a>
          {/* biome-ignore lint/a11y/useValidAnchor: as above */}
          <a
            className={`nav-item ${page === 'routines' ? 'active' : ''}`}
            href="#routines"
            aria-current={page === 'routines' ? 'page' : undefined}
            onClick={(event) => navigate('routines', event)}
          >
            <span className="nav-icon" aria-hidden="true">
              ◷
            </span>
            {language === 'it' ? 'Routine' : 'Routines'}
          </a>
          {/* biome-ignore lint/a11y/useValidAnchor: as above */}
          <a
            className={`nav-item ${page === 'faculties' ? 'active' : ''}`}
            href="#faculties"
            aria-current={page === 'faculties' ? 'page' : undefined}
            onClick={(event) => navigate('faculties', event)}
          >
            <span className="nav-icon" aria-hidden="true">
              ◇
            </span>
            {language === 'it' ? 'Facoltà' : 'Faculties'}
          </a>
        </nav>
        <div className="sidebar-bottom">
          <span className="online-dot" />
          {language === 'it' ? 'Agent personale' : 'Personal Agent'}
          <span className="version">v1</span>
        </div>
      </aside>
      <main className="main">
        {page === 'faculties' ? (
          <FacultiesPage
            language={language}
            languageControl={languageControl}
            footer={footer}
            onDirtyChange={onDirtyChange}
          />
        ) : page === 'routines' ? (
          <RoutinesPage
            language={language}
            languageControl={languageControl}
            footer={footer}
            onDirtyChange={onDirtyChange}
          />
        ) : (
          <PersonaPage
            language={language}
            languageControl={languageControl}
            footer={footer}
            onDirtyChange={onDirtyChange}
          />
        )}
      </main>
      {pending && <LeaveDialog language={language} onStay={stay} onLeave={leave} />}
    </div>
  );
}
