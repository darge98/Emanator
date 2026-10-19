import { useEffect, useRef } from 'react';

/** What a page asks the Owner before an action that loses work or data. */
export interface ConfirmRequest {
  title: string;
  body: string;
  /** Label of the button that goes ahead. */
  confirm: string;
  /** Label of the button that keeps things as they are. */
  cancel: string;
  /** `danger` when going ahead deletes or discards something. */
  tone?: 'danger' | 'default';
}

interface ConfirmDialogProps {
  request: ConfirmRequest;
  onAnswer: (confirmed: boolean) => void;
}

/** A modal yes/no question. Escape and the backdrop mean no, which also has the focus. */
export function ConfirmDialog({ request, onAnswer }: ConfirmDialogProps) {
  const cancel = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cancel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onAnswer(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [onAnswer]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a click outside the dialog cancels; Escape does the same from the keyboard
    // biome-ignore lint/a11y/useKeyWithClickEvents: as above
    <div
      className="dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onAnswer(false);
      }}
    >
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
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
        <h2 id="confirm-title">{request.title}</h2>
        <p id="confirm-body">{request.body}</p>
        <div className="dialog-actions">
          <button
            type="button"
            className={`btn ${request.tone === 'danger' ? 'btn-danger' : 'btn-secondary'}`}
            onClick={() => onAnswer(true)}
          >
            {request.confirm}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onAnswer(false)}
            ref={cancel}
          >
            {request.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}
