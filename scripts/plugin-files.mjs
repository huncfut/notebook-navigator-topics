import { createHash } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { project, revision, version } from './overlay.mjs';

const pluginId = 'notebook-navigator';
const originalHash = 'be5f8c2b5ac55fbdf525e9b1ddf5b08fd3df7f58aef12d7b2a67acee2dc7f3e0';
const backupName = '.notebook-navigator-topics-backup';
const lockName = '.notebook-navigator-topics-lock';
const hash = contents => createHash('sha256').update(contents).digest('hex');

async function statOrNull(path) {
    try {
        return await lstat(path);
    } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
    }
}

async function readRegularFile(path) {
    const info = await statOrNull(path);
    if (!info?.isFile()) throw new Error(`Expected a regular file: ${path}`);
    return { contents: await readFile(path), mode: info.mode & 0o777 };
}

async function readJSON(path) {
    const { contents } = await readRegularFile(path);
    try {
        return JSON.parse(contents);
    } catch {
        throw new Error(`Invalid JSON in ${path}.`);
    }
}

async function writeNewFile(path, contents, mode = 0o600) {
    const output = await open(path, 'wx', mode);
    try {
        await output.chmod(mode);
        await output.writeFile(contents);
        await output.sync();
    } finally {
        await output.close();
    }
}

async function requireDirectory(path) {
    if (!(await statOrNull(path))?.isDirectory()) {
        throw new Error(`Expected a directory without symlinks: ${path}`);
    }
    return path;
}

async function checkVersion(directory) {
    const manifest = await readJSON(join(directory, 'manifest.json'));
    if (manifest?.id !== pluginId) throw new Error(`Expected the ${pluginId} plugin ID.`);
    if (manifest.version !== version) {
        throw new Error(`Notebook Navigator ${version} is required. Found ${manifest.version ?? 'no version'}.`);
    }
}

async function getPluginDirectory(vaultPath) {
    const vault = await realpath(vaultPath);
    const upstream = join(project, '..', 'notebook-navigator');
    const protectedPath = await realpath(upstream).catch(error => {
        if (error.code !== 'ENOENT') throw error;
        return upstream;
    });
    const subpath = relative(protectedPath, vault);
    if (!subpath || (!isAbsolute(subpath) && subpath !== '..' && !subpath.startsWith(`..${sep}`))) {
        throw new Error('The upstream Notebook Navigator checkout is read-only.');
    }
    const obsidian = await requireDirectory(join(vault, '.obsidian'));
    const plugins = await requireDirectory(join(obsidian, 'plugins'));
    const directory = await requireDirectory(join(plugins, pluginId));
    await checkVersion(directory);
    return directory;
}

async function getBundle(directory) {
    const metadata = await readJSON(join(directory, 'build.json'));
    const { contents } = await readRegularFile(join(directory, 'main.js'));
    if (
        metadata?.version !== version ||
        metadata.revision !== revision ||
        metadata.sha256 !== hash(contents) ||
        metadata.sha256 === originalHash
    ) {
        throw new Error('The expansion bundle does not match its build metadata. Build the pinned expansion again.');
    }
    return { contents, sha256: metadata.sha256 };
}

async function getBackup(directory) {
    const location = join(directory, backupName);
    if (!(await statOrNull(location))) return null;
    await requireDirectory(location);
    const metadata = await readJSON(join(location, 'backup.json'));
    const { contents } = await readRegularFile(join(location, 'main.js'));
    if (
        metadata?.version !== version ||
        metadata.original !== originalHash ||
        hash(contents) !== originalHash ||
        typeof metadata.installed !== 'string' ||
        !/^[a-f0-9]{64}$/.test(metadata.installed) ||
        metadata.installed === originalHash ||
        !Number.isInteger(metadata.mode) ||
        metadata.mode < 0 ||
        metadata.mode > 0o777
    ) {
        throw new Error('The original Notebook Navigator backup is invalid.');
    }
    return { ...metadata, contents };
}

async function withLock(directory, action) {
    const lock = join(directory, lockName);
    try {
        await mkdir(lock, { mode: 0o700 });
    } catch (error) {
        if (error.code === 'EEXIST')
            throw new Error('Another Topics operation holds the vault lock. See README.md for interrupted operations.');
        throw error;
    }
    try {
        return await action(lock);
    } finally {
        await rm(lock, { force: true, recursive: true });
    }
}

async function installationState(directory, bundle) {
    await checkVersion(directory);
    const current = await readRegularFile(join(directory, 'main.js'));
    const currentHash = hash(current.contents);
    const backup = await getBackup(directory);
    if (backup && backup.installed !== bundle.sha256)
        throw new Error('This vault has a backup for a different expansion build. Uninstall it first.');
    if (backup && currentHash === backup.installed) return { installed: true, current, backup };
    if (currentHash !== originalHash) throw new Error('The installed Notebook Navigator bundle is an unsupported or modified build.');
    return { installed: false, current, backup };
}

export async function install(vault, buildDirectory = join(project, 'dist')) {
    const directory = await getPluginDirectory(vault);
    const bundle = await getBundle(buildDirectory);
    if ((await installationState(directory, bundle)).installed) return 'Notebook Navigator Topics is already installed.';

    return withLock(directory, async lock => {
        const { installed, current, backup } = await installationState(directory, bundle);
        if (installed) return 'Notebook Navigator Topics is already installed.';

        if (!backup) {
            const staged = join(lock, 'backup');
            await mkdir(staged, { mode: 0o700 });
            await writeNewFile(join(staged, 'main.js'), current.contents);
            await writeNewFile(
                join(staged, 'backup.json'),
                JSON.stringify(
                    {
                        version,
                        original: originalHash,
                        installed: bundle.sha256,
                        mode: current.mode
                    },
                    null,
                    2
                )
            );
            await rename(staged, join(directory, backupName));
        }
        const replacement = join(lock, 'main.js');
        await writeNewFile(replacement, bundle.contents, backup?.mode ?? current.mode);
        await checkVersion(directory);
        if (hash((await readRegularFile(join(directory, 'main.js'))).contents) !== originalHash) {
            throw new Error('Notebook Navigator changed during installation. The backup has been preserved.');
        }
        await rename(replacement, join(directory, 'main.js'));
        return `Installed Notebook Navigator Topics ${version}.`;
    });
}

async function restorationState(directory) {
    await checkVersion(directory);
    const backup = await getBackup(directory);
    const currentHash = hash((await readRegularFile(join(directory, 'main.js'))).contents);
    if (currentHash !== originalHash && currentHash !== backup?.installed) {
        throw new Error('The installed bundle does not match the Topics backup. No plugin files were replaced.');
    }
    return { backup, currentHash };
}

export async function uninstall(vault) {
    const directory = await getPluginDirectory(vault);
    if (!(await restorationState(directory)).backup) return 'Notebook Navigator Topics is already uninstalled.';

    return withLock(directory, async lock => {
        const { backup, currentHash } = await restorationState(directory);
        if (!backup) return 'Notebook Navigator Topics is already uninstalled.';
        if (currentHash === backup.installed) {
            const replacement = join(lock, 'main.js');
            await writeNewFile(replacement, backup.contents, backup.mode);
            await checkVersion(directory);
            if (hash((await readRegularFile(join(directory, 'main.js'))).contents) !== backup.installed) {
                throw new Error('Notebook Navigator changed during uninstall. The backup has been preserved.');
            }
            await rename(replacement, join(directory, 'main.js'));
        }
        // Move the backup inside the lock so interruption during cleanup cannot leave a partial backup.
        await rename(join(directory, backupName), join(lock, 'restored-backup'));
        return 'Uninstalled Notebook Navigator Topics and restored the original bundle.';
    });
}

export async function runVaultCommand(action, name) {
    const args = process.argv.slice(2);
    if (args.length !== 1 || !args[0] || args[0] === '--help') {
        console.log(`Usage: node ${name}.mjs "/path/to/vault"`);
        process.exitCode = args.length === 1 && args[0] === '--help' ? 0 : 1;
        return;
    }
    try {
        console.log(await action(args[0]));
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
