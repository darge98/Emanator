import { useEffect, useRef } from 'react';

const copy = {
  it: {
    title: 'Modifiche non salvate',
    body: 'Se lasci questa pagina adesso, le modifiche che non hai salvato andranno perse.',
    stay: 'Resta qui',
    leave: 'Esci senza salvare',
  },
  en: {
    title: 'Unsaved changes',
    body: 'If you leave this page now, the changes you have not saved will be lost.',
    stay: 'Stay here',
    leave: 'Leave without saving',
  },
};

interface LeaveDialogProps {
  language: 'it' | 'en';
  onStay: () => void;
  onLeave: () => void;
}

/** Asks before navigating away from unsaved edits. Escape means stay. */
export function LeaveDialog({ language, onStay, onLeave }: LeaveDialogProps) {
  const t = copy[language];
  const stay = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    stay.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onStay();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [onStay]);

  return (
    <div className="dialog-backdrop">
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="leave-title"
        aria-describedby="leave-body"
        onKeyDown={(event) => {
          // Keep Tab between the two buttons.
          if (event.key !== 'Tab') return;
          const buttons = event.currentTarget.querySelectorAll('button');
          const first = buttons[0];
          const last = buttons[buttons.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <h2 id="leave-title">{t.title}</h2>
        <p id="leave-body">{t.body}</p>
        <div className="dialog-actions">
          <button type="button" className="dialog-button danger" onClick={onLeave}>
            {t.leave}
          </button>
          <button type="button" className="dialog-button primary" onClick={onStay} ref={stay}>
            {t.stay}
          </button>
        </div>
      </div>
    </div>
  );
}
