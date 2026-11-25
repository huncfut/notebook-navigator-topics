import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const project = fileURLToPath(new URL('../', import.meta.url));
export const version = '3.5.1';
export const revision = '44215001884fa57351e6eb387355fbe5eb660975';

export async function applyOverlay(directory) {
    const expectedRoot = join(await realpath(project), '.work');
    const destination = await realpath(directory);
    const workPath = relative(expectedRoot, destination);
    if (!workPath || workPath.startsWith(`..${sep}`) || workPath === '..' || destination !== join(expectedRoot, workPath)) {
        throw new Error('The overlay can only modify a disposable copy inside this project’s .work directory.');
    }
    const manifest = JSON.parse(await readFile(join(destination, 'manifest.json'), 'utf8'));
    if (manifest.id !== 'notebook-navigator' || manifest.version !== version) {
        throw new Error(`The source copy must be Notebook Navigator ${version}.`);
    }
    execFileSync('git', ['apply', '--whitespace=error-all', join(project, 'scripts', 'native-topics.patch')], {
        cwd: destination,
        env: { ...process.env, GIT_CEILING_DIRECTORIES: dirname(destination) },
        stdio: 'inherit'
    });

    const target = join(destination, 'src', 'topics');
    await mkdir(target);
    for (const file of [
        'graph.ts',
        'config.ts',
        'controller.ts',
        'browse.ts',
        'modals.tsx',
        'settings.ts',
        'topic-section-modal.ts',
        'topic-icon-editor.ts',
        'navigation.ts',
        'topic-drop.ts',
        'topic-filter.ts',
        'topic-graph-data.ts',
        'topic-graph-workspace.ts',
        'topic-graph-view.tsx',
        'topic-graph-panel.tsx',
        'topic-graph-canvas.tsx'
    ]) {
        await copyFile(join(project, 'src', file), join(target, file));
    }
    const css = await readFile(join(project, 'src', 'styles.css'), 'utf8');
    const styleModule = await readFile(join(project, 'src', 'styles.ts'), 'utf8');
    await writeFile(
        join(target, 'styles.ts'),
        styleModule.replace("'__TOPICS_CSS__'", () => JSON.stringify(css))
    );
}
