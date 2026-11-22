import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { applyOverlay, project, revision, version } from './overlay.mjs';

function run(command, args, cwd) {
    const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed.`);
}

export async function prepareSource(upstream, directory, offline) {
    const archive = spawn('git', ['-C', upstream, 'archive', revision], { stdio: ['ignore', 'pipe', 'inherit'] });
    const extract = spawn('tar', ['-xf', '-', '-C', directory], { stdio: ['pipe', 'inherit', 'inherit'] });
    const wait = process =>
        new Promise((resolve, reject) => {
            process.once('error', reject);
            process.once('close', status =>
                status === 0 ? resolve() : reject(new Error('Could not extract the pinned upstream source.'))
            );
        });
    await Promise.all([pipeline(archive.stdout, extract.stdin), wait(archive), wait(extract)]);
    await applyOverlay(directory);
    run('npm', ['ci', '--no-audit', '--no-fund', ...(offline ? ['--offline'] : [])], directory);
}

const argumentsList = process.argv.slice(2);
const positionals = argumentsList.filter(argument => !argument.startsWith('--'));
const flags = new Set(argumentsList.filter(argument => argument.startsWith('--')));
if (positionals.length > 1 || [...flags].some(flag => !['--offline', '--test', '--upstream-tests'].includes(flag))) {
    console.error('Usage: node scripts/build.mjs [upstream-repo] [--offline] [--test] [--upstream-tests]');
    process.exitCode = 1;
} else {
    const upstream = resolve(positionals[0] ?? join(project, '..', 'notebook-navigator'));
    const parent = join(project, '.work');
    await mkdir(parent, { recursive: true });
    const directory = await mkdtemp(join(parent, 'upstream-'));
    try {
        await prepareSource(upstream, directory, flags.has('--offline'));
        run('npm', ['run', 'build'], directory);
        if (flags.has('--test') || flags.has('--upstream-tests')) {
            await copyFile(join(project, 'tests', 'topics.test.ts'), join(directory, 'tests', 'topics.test.ts'));
            run('npm', flags.has('--upstream-tests') ? ['test'] : ['test', '--', 'tests/topics.test.ts'], directory);
        }
        const output = join(project, 'dist');
        await mkdir(output, { recursive: true });
        const bundle = await readFile(join(directory, 'main.js'));
        const sha256 = createHash('sha256').update(bundle).digest('hex');
        await writeFile(join(output, 'main.js'), bundle);
        await writeFile(join(output, 'build.json'), JSON.stringify({ version, revision, sha256 }, null, 2) + '\n');
        console.log(`Built Notebook Navigator Topics ${version} in dist/.`);
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}
