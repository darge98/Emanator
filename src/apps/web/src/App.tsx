import { PersonaPage } from '@emanator/personas/web';
import { useEffect, useState } from 'react';

export default function App() {
  const [language, setLanguage] = useState<'it' | 'en'>(() => {
    try {
      return localStorage.getItem('emanator-language') === 'en' ? 'en' : 'it';
    } catch {
      return 'it';
    }
  });

  useEffect(() => {
    document.documentElement.lang = language;
    try {
      localStorage.setItem('emanator-language', language);
    } catch {
      /* language still works for this session */
    }
  }, [language]);

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
        <a className="nav-item active" href="#persona" aria-current="page">
          <span className="nav-icon" aria-hidden="true">
            ◉
          </span>
          Persona
        </a>
        <div className="sidebar-bottom">
          <span className="online-dot" />
          {language === 'it' ? 'Agent personale' : 'Personal Agent'}
          <span className="version">v1</span>
        </div>
      </aside>
      <main id="persona" className="main">
        <PersonaPage
          language={language}
          languageControl={
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
          }
          footer={
            <footer className="footer">
              <span>emanator</span>
              <span>·</span>
              <span>
                {language === 'it' ? 'Il tuo spazio, le tue regole.' : 'Your space, your rules.'}
              </span>
            </footer>
          }
        />
      </main>
    </div>
  );
}
