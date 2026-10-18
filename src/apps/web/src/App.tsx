import { PersonaPage } from '@emanator/personas/web';
import { RoutinesPage } from '@emanator/routines/web';
import { useEffect, useState } from 'react';

type Page = 'persona' | 'routines';

const pageFromHash = (): Page => (window.location.hash === '#routines' ? 'routines' : 'persona');

export default function App() {
  const [language, setLanguage] = useState<'it' | 'en'>(() => {
    try {
      return localStorage.getItem('emanator-language') === 'en' ? 'en' : 'it';
    } catch {
      return 'it';
    }
  });

  const [page, setPage] = useState<Page>(pageFromHash);

  useEffect(() => {
    const follow = () => setPage(pageFromHash());
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, []);

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
        <a className="brand" href="#persona" aria-label="Emanator">
          <img src="/assets/emanator.svg" alt="" />
          <span>emanator</span>
        </a>
        <div className="nav-label">{language === 'it' ? 'PERSONALE' : 'PERSONAL'}</div>
        <nav className="nav">
          <a
            className={`nav-item ${page === 'persona' ? 'active' : ''}`}
            href="#persona"
            aria-current={page === 'persona' ? 'page' : undefined}
          >
            <span className="nav-icon" aria-hidden="true">
              ◉
            </span>
            Persona
          </a>
          <a
            className={`nav-item ${page === 'routines' ? 'active' : ''}`}
            href="#routines"
            aria-current={page === 'routines' ? 'page' : undefined}
          >
            <span className="nav-icon" aria-hidden="true">
              ◷
            </span>
            {language === 'it' ? 'Routine' : 'Routines'}
          </a>
        </nav>
        <div className="sidebar-bottom">
          <span className="online-dot" />
          {language === 'it' ? 'Agent personale' : 'Personal Agent'}
          <span className="version">v1</span>
        </div>
      </aside>
      <main className="main">
        {page === 'routines' ? (
          <RoutinesPage language={language} languageControl={languageControl} footer={footer} />
        ) : (
          <PersonaPage language={language} languageControl={languageControl} footer={footer} />
        )}
      </main>
    </div>
  );
}
