import { getBoard, isBoardId } from '../boards/registry';
import { supportsOta } from '../boards/types';
import type { Project } from '../projects/types';

/**
 * Whether a project builds for over-the-air upload: flagged "sube por WiFi" and on a board
 * that supports it. Then the compile request carries the board's `otaOptions` and the
 * generator links SomLink; otherwise neither happens (USB-only projects stay as they are).
 */
export function isOtaProject(
  project: Pick<Project, 'boardId' | 'uploadOverWifi'> | null | undefined,
): boolean {
  if (!project?.uploadOverWifi || !isBoardId(project.boardId)) return false;
  return supportsOta(getBoard(project.boardId));
}
