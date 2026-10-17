import { expect, test, type Page } from '@playwright/test';

/** Drag the first block of the Código category (`include library [Wire.h]`) onto the canvas. */
async function dropIncludeBlock(page: Page): Promise<void> {
  await page.getByRole('treeitem', { name: 'Código' }).click();
  const flyoutBlock = page.locator('.blocklyFlyout .blocklyDraggable').first();
  await expect(flyoutBlock).toBeVisible();
  const target = await page.locator('.blocklyMainBackground').boundingBox();
  const source = await flyoutBlock.boundingBox();
  if (!target || !source) throw new Error('workspace or flyout block has no box');
  await page.mouse.move(source.x + 10, source.y + 10);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 });
  await page.mouse.up();
}

/** Every stored project as JSON text, read straight from IndexedDB. */
function storedProjects(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const request = indexedDB.open('som-blocks');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const all = db.transaction('projects').objectStore('projects').getAll();
          all.onsuccess = () => {
            db.close();
            resolve(JSON.stringify(all.result));
          };
          all.onerror = () => reject(all.error);
        };
      }),
  );
}

test('blocks are autosaved and come back after a reload', async ({ page }) => {
  await page.goto('/?lang=es');
  await expect(page.getByTestId('project-name')).toHaveValue('Mi proyecto');
  await dropIncludeBlock(page);
  const code = page.getByTestId('generated-code');
  await expect(code).toContainText('#include <Wire.h>');

  // Autosave lands within the 500 ms debounce.
  await expect.poll(() => storedProjects(page)).toContain('Wire.h');

  await page.reload();
  await expect(page.getByTestId('project-name')).toHaveValue('Mi proyecto');
  await expect(code).toContainText('#include <Wire.h>');
  await expect(page.locator('svg.blocklySvg > g.blocklyWorkspace .blocklyDraggable')).toHaveCount(
    1,
  );
});

test('a renamed project keeps its name across a reload', async ({ page }) => {
  await page.goto('/?lang=es');
  const name = page.getByTestId('project-name');
  await expect(name).toHaveValue('Mi proyecto');
  await name.fill('Semáforo');
  await name.press('Enter');
  await expect.poll(() => storedProjects(page)).toContain('Semáforo');
  await page.reload();
  await expect(page.getByTestId('project-name')).toHaveValue('Semáforo');
});

test('export downloads a .zip named after the sketch', async ({ page }) => {
  await page.goto('/?lang=es');
  await expect(page.getByTestId('project-name')).toHaveValue('Mi proyecto');
  await page.getByText('Proyectos', { exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Exportar (.zip)' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.zip$/);
  expect(download.suggestedFilename()).toBe('Mi_proyecto.zip');
  // No storage warning in a normal Chromium profile.
  await expect(page.getByTestId('projects-memory-only')).toHaveCount(0);
});

test('the projects menu stays inside a phone-width viewport', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/?lang=es');
  await page.getByText('Proyectos', { exact: true }).click();
  const box = await page.getByRole('menu').boundingBox();
  if (!box) throw new Error('projects menu has no box');
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(360);
});

test('without IndexedDB the editor still works in memory and says so', async ({ page }) => {
  // Firefox private browsing / strict ETP: indexedDB exists but every open() fails.
  await page.addInitScript(() => {
    IDBFactory.prototype.open = () => {
      throw new DOMException('A mutation operation was attempted', 'InvalidStateError');
    };
  });
  await page.goto('/?lang=es');
  await expect(page.getByTestId('projects-memory-only')).toContainText(
    'Este navegador no deja guardar proyectos',
  );
  await expect(page.getByTestId('project-name')).toHaveValue('Mi proyecto');
  await dropIncludeBlock(page);
  await expect(page.getByTestId('generated-code')).toContainText('#include <Wire.h>');
});

test('a corrupt saved workspace does not brick startup and the record is kept', async ({
  page,
}) => {
  await page.goto('/?lang=es');
  await expect(page.getByTestId('project-name')).toHaveValue('Mi proyecto');
  // Break the stored project behind the app's back: a block type this build doesn't have.
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('som-blocks');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const store = db.transaction('projects', 'readwrite').objectStore('projects');
          const all = store.getAll();
          all.onsuccess = () => {
            const [project] = all.result as { workspace: unknown; name: string }[];
            if (!project) return reject(new Error('no project stored'));
            project.name = 'Roto';
            project.workspace = { blocks: { blocks: [{ type: 'no_such_block' }] } };
            store.put(project).onsuccess = () => {
              db.close();
              resolve();
            };
          };
        };
      }),
  );

  await page.reload();
  await expect(page.getByTestId('project-notice')).toContainText('No se pudo abrir «Roto»');
  await expect(page.getByTestId('project-name')).toHaveValue('Mi proyecto');
  await expect(page.getByTestId('generated-code')).toContainText('void loop() {');
  await expect.poll(() => storedProjects(page)).toContain('no_such_block');
});
