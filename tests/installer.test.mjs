import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
const source = resolve(process.env.TOPICS_STOCK_PLUGIN ?? join(project, '..', 'dev-vault', '.obsidian', 'plugins', 'notebook-navigator'));
const built = join(project, 'dist', 'main.js');
const stateName = '.notebook-navigator-topics-backup';
const lockName = '.notebook-navigator-topics-lock';
const manifest = { id: 'notebook-navigator', version: '3.5.1' };

async function fixture(t) {
    const vault = await mkdtemp(join(tmpdir(), 'Navigator Topics Vault '));
    t.after(() => rm(vault, { recursive: true, force: true }));
    const plugin = join(vault, '.obsidian', 'plugins', 'notebook-navigator');
    await mkdir(plugin, { recursive: true });
    for (const filename of ['manifest.json', 'main.js', 'styles.css']) await copyFile(join(source, filename), join(plugin, filename));
    await writeFile(join(plugin, 'data.json'), '{"mySetting":"preserve this"}\n');
    await writeFile(join(vault, 'Original Note.md'), '---\nTyp: koncept\n---\n# Original\n');
    const main = join(plugin, 'main.js');
    const original = await readFile(main);
    const settings = await readFile(join(plugin, 'data.json'));
    const style = await readFile(join(plugin, 'styles.css'));
    const note = await readFile(join(vault, 'Original Note.md'));
    return { vault, plugin, main, original, settings, style, note, backup: join(plugin, stateName) };
}

function invoke(action, ...args) {
    const processResult = spawnSync(process.execPath, [join(project, `${action}.mjs`), ...args], { encoding: 'utf8' });
    assert.ifError(processResult.error);
    return processResult;
}
function invokeAsync(action, ...args) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [join(project, `${action}.mjs`), ...args], { stdio: 'ignore' });
        child.once('error', reject);
        child.once('close', resolve);
    });
}
function success(result, message) {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, message);
}
function failure(result, message) {
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, message);
}

async function assertUntouched(item) {
    assert.deepEqual(await readFile(join(item.plugin, 'data.json')), item.settings);
    assert.deepEqual(await readFile(join(item.plugin, 'styles.css')), item.style);
    assert.deepEqual(await readFile(join(item.vault, 'Original Note.md')), item.note);
    assert.equal((await readdir(item.plugin)).includes(lockName), false);
}

test('the stock fixture is the pinned build and the expansion bundle matches its build metadata', async () => {
    const stock = createHash('sha256')
        .update(await readFile(join(source, 'main.js')))
        .digest('hex');
    const expansion = createHash('sha256')
        .update(await readFile(built))
        .digest('hex');
    const metadata = JSON.parse(await readFile(join(project, 'dist', 'build.json'), 'utf8'));
    assert.equal(stock, 'be5f8c2b5ac55fbdf525e9b1ddf5b08fd3df7f58aef12d7b2a67acee2dc7f3e0');
    assert.equal(metadata.version, '3.5.1');
    assert.equal(metadata.sha256, expansion);
    assert.notEqual(expansion, stock);
});

test('installs and uninstalls a real bundle, preserves files, and supports retries', async t => {
    const item = await fixture(t);
    await chmod(item.main, 0o640);
    success(invoke('install', item.vault), /Installed Notebook Navigator Topics 3\.5\.1/);
    assert.deepEqual(await readFile(item.main), await readFile(built));
    assert.deepEqual(await readFile(join(item.backup, 'main.js')), item.original);
    assert.equal((await lstat(item.main)).mode & 0o777, 0o640);
    success(invoke('install', item.vault), /already installed/);
    await writeFile(join(item.plugin, 'topics-settings.json'), '{"showFolder":false}');
    success(invoke('uninstall', item.vault), /restored the original/);
    assert.deepEqual(await readFile(item.main), item.original);
    assert.equal((await lstat(item.main)).mode & 0o777, 0o640);
    assert.equal(await readFile(join(item.plugin, 'topics-settings.json'), 'utf8'), '{"showFolder":false}');
    assert.equal((await readdir(item.plugin)).includes(stateName), false);
    success(invoke('uninstall', item.vault), /already uninstalled/);
    await assertUntouched(item);
});

test('rejects the wrong plugin ID, wrong version, or invalid manifest before writing', async t => {
    const item = await fixture(t);
    const path = join(item.plugin, 'manifest.json');
    for (const [value, message] of [
        [JSON.stringify({ ...manifest, id: 'something-else' }), /plugin ID/],
        [JSON.stringify({ ...manifest, version: '3.5.10' }), /3\.5\.1 is required/],
        ['malformed', /Invalid JSON/]
    ]) {
        await writeFile(path, value);
        failure(invoke('install', item.vault), message);
        failure(invoke('uninstall', item.vault), message);
    }
    assert.deepEqual(await readFile(item.main), item.original);
    assert.equal((await readdir(item.plugin)).includes(stateName), false);
    await assertUntouched(item);
});

test('rejects a modified same-version bundle', async t => {
    const item = await fixture(t);
    await writeFile(item.main, 'Modified stock build');
    failure(invoke('install', item.vault), /unsupported or modified/);
    assert.equal(await readFile(item.main, 'utf8'), 'Modified stock build');
    assert.equal((await readdir(item.plugin)).includes(stateName), false);
    await assertUntouched(item);
});

test('uninstall preserves a newer upstream installation and the original backup', async t => {
    const item = await fixture(t);
    success(invoke('install', item.vault), /Installed/);
    await writeFile(join(item.plugin, 'manifest.json'), JSON.stringify({ ...manifest, version: '3.6.0' }));
    await writeFile(item.main, 'New upstream build');
    failure(invoke('uninstall', item.vault), /3\.5\.1 is required/);
    assert.equal(await readFile(item.main, 'utf8'), 'New upstream build');
    assert.deepEqual(await readFile(join(item.backup, 'main.js')), item.original);
    await assertUntouched(item);
});

test('uninstall refuses a tampered installed expansion or corrupted backup', async t => {
    const item = await fixture(t);
    success(invoke('install', item.vault), /Installed/);
    await writeFile(item.main, 'Tampered expansion');
    failure(invoke('uninstall', item.vault), /does not match/);
    assert.equal(await readFile(item.main, 'utf8'), 'Tampered expansion');
    await copyFile(built, item.main);
    await writeFile(join(item.backup, 'main.js'), 'Tampered backup');
    failure(invoke('uninstall', item.vault), /backup is invalid/);
    assert.deepEqual(await readFile(item.main), await readFile(built));
    await assertUntouched(item);
});

test('rejects symlinked plugin directories and bundle files without following them', async t => {
    const item = await fixture(t);
    const external = join(item.vault, 'outside');
    await rename(item.plugin, external);
    await symlink(external, item.plugin, 'dir');
    failure(invoke('install', item.vault), /without symlinks/);
    failure(invoke('uninstall', item.vault), /without symlinks/);
    await rm(item.plugin);
    await rename(external, item.plugin);
    const realFile = join(item.vault, 'outside.js');
    await rename(item.main, realFile);
    await symlink(realFile, item.main);
    failure(invoke('install', item.vault), /regular file/);
    failure(invoke('uninstall', item.vault), /regular file/);
    assert.deepEqual(await readFile(realFile), item.original);
    await assertUntouched(item);
});

test('resumes prepared installation and cleans up an already restored bundle', async t => {
    const item = await fixture(t);
    success(invoke('install', item.vault), /Installed/);
    await writeFile(item.main, item.original);
    success(invoke('install', item.vault), /Installed/);
    assert.deepEqual(await readFile(item.main), await readFile(built));
    await writeFile(item.main, item.original);
    success(invoke('uninstall', item.vault), /restored the original/);
    assert.equal((await readdir(item.plugin)).includes(stateName), false);
    assert.deepEqual(await readFile(item.main), item.original);
    await assertUntouched(item);
});

test('serializes concurrent CLI operations and preserves the restore point', async t => {
    const item = await fixture(t);
    await mkdir(join(item.plugin, lockName));
    failure(invoke('install', item.vault), /operation holds the vault lock/);
    assert.deepEqual(await readFile(item.main), item.original);
    await rm(join(item.plugin, lockName), { recursive: true });
    const statuses = await Promise.all([invokeAsync('install', item.vault), invokeAsync('install', item.vault)]);
    assert.ok(statuses.includes(0));
    assert.deepEqual(await readFile(item.main), await readFile(built));
    assert.deepEqual(await readFile(join(item.backup, 'main.js')), item.original);
    success(invoke('uninstall', item.vault), /restored the original/);
    await assertUntouched(item);
});

test('requires an explicit vault and offers usage help', () => {
    for (const command of ['install', 'uninstall']) {
        const missing = invoke(command);
        assert.equal(missing.status, 1);
        assert.match(missing.stdout, /Usage/);
        success(invoke(command, '--help'), /Usage/);
        failure(invoke(command, join(tmpdir(), 'nonexistent-vault-2348')), /ENOENT/);
    }
});
