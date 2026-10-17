import { Component, type ReactNode } from 'react';
import { t, type Lang } from '../i18n/messages';

interface Props {
  lang: Lang;
  children: ReactNode;
}

interface State {
  failed: boolean;
}

/**
 * Keeps a failed lazy chunk (offline, or a deploy replaced it) inside the serial panel instead
 * of unmounting the whole editor. React.lazy caches the rejected import, so the way back is a
 * page reload, which the message offers.
 */
export class PanelErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    console.error('serial panel failed to load', error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const { lang } = this.props;
    return (
      <div
        role="alert"
        data-testid="serial-load-failed"
        className="flex items-center gap-2 text-sm"
      >
        <span className="text-danger">{t('UI_SERIAL_LOAD_FAILED', lang)}</span>
        <button
          type="button"
          className="min-h-9 rounded border border-border px-2 py-1 text-xs"
          onClick={() => window.location.reload()}
        >
          {t('UI_SERIAL_RELOAD', lang)}
        </button>
      </div>
    );
  }
}
