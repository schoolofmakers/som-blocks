import * as Blockly from 'blockly/core';
import { useEffect, useRef } from 'react';
import { t, type Lang } from '../i18n/messages';
import { arduinoGenerator } from './arduino-generator';
import { registerBuiltInFamilies } from './index';
import { applyLocale, buildToolbox } from './registry';

// Blockly's sprites and sounds are copied from node_modules/blockly/media into our own
// bundle by the `blocklyMedia` plugin in vite.config.ts, so the editor never fetches them
// from a third-party CDN and keeps working offline.
export const BLOCKLY_MEDIA_URL = `${import.meta.env.BASE_URL}blockly-media/`;

// Wider-than-default scrollbars so a finger can grab them on tablets.
const SCROLLBAR_THICKNESS = 20;

function workspaceOptions(): Blockly.BlocklyOptions {
  return {
    toolbox: buildToolbox(),
    media: BLOCKLY_MEDIA_URL,
    renderer: 'zelos',
    trashcan: true,
    sounds: true,
    grid: { spacing: 24, length: 3, colour: '#d4d4d8', snap: true },
    zoom: {
      controls: true,
      wheel: true,
      pinch: true,
      startScale: 0.9,
      maxScale: 3,
      minScale: 0.4,
      scaleSpeed: 1.2,
    },
    move: { scrollbars: true, drag: true, wheel: true },
  };
}

interface BlocklyWorkspaceProps {
  lang: Lang;
  /** Called with the full sketch after mount and after every non-UI workspace change. */
  onCodeChange?: (code: string) => void;
  /** Selected board id; a change regenerates the code (pin blocks read the board's pins). */
  boardId?: string;
  /** Workspace to show; a new `key` replaces the blocks with `state` (opening a project). */
  load?: { key: string; state: unknown } | null;
  /** Called with the serialized workspace after every non-UI change (autosave). */
  onWorkspaceChange?: (state: WorkspaceState) => void;
  /** `load.state` could not be loaded; the workspace is left empty. */
  onLoadError?: (error: unknown) => void;
}

type WorkspaceState = ReturnType<typeof Blockly.serialization.workspaces.save>;

/**
 * Replace the blocks with `state`. Events are off while loading, so a load is never echoed
 * back as a change (no autosave of what was just opened). Returns the error if it failed.
 */
function loadState(state: unknown, workspace: Blockly.Workspace): unknown {
  Blockly.Events.disable();
  try {
    workspace.clear();
    Blockly.serialization.workspaces.load(state as WorkspaceState, workspace);
    return undefined;
  } catch (error) {
    workspace.clear();
    return error;
  } finally {
    Blockly.Events.enable();
  }
}

export function BlocklyWorkspace({
  lang,
  onCodeChange,
  boardId,
  load,
  onWorkspaceChange,
  onLoadError,
}: BlocklyWorkspaceProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<Blockly.WorkspaceSvg | null>(null);
  const lastBoardId = useRef(boardId);
  const onCodeRef = useRef(onCodeChange);
  // Blocks survive a re-inject (language change, StrictMode double mount).
  const savedState = useRef<WorkspaceState | null>(null);
  const loadRef = useRef(load);
  const loadedKey = useRef<string | undefined>(undefined);
  const onWorkspaceRef = useRef(onWorkspaceChange);
  const onLoadErrorRef = useRef(onLoadError);

  useEffect(() => {
    onCodeRef.current = onCodeChange;
    onWorkspaceRef.current = onWorkspaceChange;
    onLoadErrorRef.current = onLoadError;
    loadRef.current = load;
  }, [onCodeChange, onWorkspaceChange, onLoadError, load]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    registerBuiltInFamilies();
    // Rendered block labels are fixed at creation, so a language change re-injects.
    applyLocale(lang);
    Blockly.Scrollbar.scrollbarThickness = SCROLLBAR_THICKNESS;
    const workspace = Blockly.inject(host, workspaceOptions());
    workspaceRef.current = workspace;
    if (savedState.current) {
      loadState(savedState.current, workspace);
    } else if (loadRef.current) {
      const error = loadState(loadRef.current.state, workspace);
      loadedKey.current = loadRef.current.key;
      if (error !== undefined) onLoadErrorRef.current?.(error);
    }

    const emitCode = () => onCodeRef.current?.(arduinoGenerator.workspaceToCode(workspace));
    workspace.addChangeListener((event: Blockly.Events.Abstract) => {
      if (event.isUiEvent) return;
      emitCode();
      onWorkspaceRef.current?.(Blockly.serialization.workspaces.save(workspace));
    });
    emitCode();

    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => Blockly.svgResize(workspace));
    resizeObserver?.observe(host);

    return () => {
      resizeObserver?.disconnect();
      savedState.current = Blockly.serialization.workspaces.save(workspace);
      workspaceRef.current = null;
      workspace.dispose();
    };
  }, [lang]);

  // Opening another project: swap the blocks in place (no re-inject).
  const loadKey = load?.key;
  useEffect(() => {
    const workspace = workspaceRef.current;
    const next = loadRef.current;
    if (!workspace || !next || next.key !== loadKey || loadedKey.current === loadKey) return;
    loadedKey.current = loadKey;
    const error = loadState(next.state, workspace);
    onCodeRef.current?.(arduinoGenerator.workspaceToCode(workspace));
    if (error !== undefined) onLoadErrorRef.current?.(error);
  }, [loadKey]);

  // A board change emits no workspace event, so regenerate explicitly. Mount (and a
  // StrictMode re-run) already emitted from the inject effect, so only real changes count.
  useEffect(() => {
    if (lastBoardId.current === boardId) return;
    lastBoardId.current = boardId;
    const workspace = workspaceRef.current;
    if (workspace) onCodeRef.current?.(arduinoGenerator.workspaceToCode(workspace));
  }, [boardId]);

  return (
    <div
      ref={hostRef}
      data-testid="blockly-workspace"
      role="region"
      aria-label={t('UI_WORKSPACE_LABEL', lang)}
      className="relative min-h-[60dvh] flex-1 overflow-hidden rounded-lg border border-border"
    />
  );
}
