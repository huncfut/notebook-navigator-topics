import { App, Notice, TFile, normalizePath, type Plugin } from 'obsidian';
import { defaultConfig, validateConfig, type TopicsConfig } from './config';
import {
    buildGraph,
    linkPath,
    propertyKey,
    propertyValues,
    resolveParentLinks,
    wouldIntroduceCycle,
    type TopicGraph,
    type TopicNote,
    type TopicRequirement
} from './graph';

import { planTopicDrop, type TopicDropPlan } from './topic-drop';
import type { TopicTarget } from './topic-filter';

type DropResult = Exclude<TopicDropPlan['status'], 'choice'> | 'cancelled' | 'failed';
type ChooseLeafRequirement = (file: TFile, choices: TopicRequirement[]) => Promise<TopicRequirement | null>;

export interface TopicsSnapshot {
    config: TopicsConfig;
    graphs: ReadonlyMap<string, TopicGraph>;
    ready: boolean;
}

export interface TopicRelationship {
    property: string;
    key: string | undefined;
    value: unknown;
}

type RelationshipEdit = { value: unknown } | 'cycle';

export class TopicsController {
    private snapshot: TopicsSnapshot = { config: defaultConfig, graphs: new Map(), ready: false };
    private readonly listeners = new Set<() => void>();
    private readonly notes = new Map<string, TopicNote>();
    private readonly settingsPath: string;
    private pending: ReturnType<typeof setTimeout> | undefined;
    private queue: Promise<unknown> = Promise.resolve();
    private stopped = false;
    readonly app: App;

    constructor(plugin: Plugin) {
        this.app = plugin.app;
        const { metadataCache, vault, workspace } = this.app;
        const directory = plugin.manifest.dir ?? `${vault.configDir}/plugins/${plugin.manifest.id}`;
        this.settingsPath = normalizePath(`${directory}/topics-settings.json`);

        plugin.registerEvent(
            metadataCache.on('changed', (file, _, cache) => {
                this.notes.set(file.path, { path: file.path, properties: cache.frontmatter ?? {} });
                this.scheduleRefresh();
            })
        );
        // Resolution can change without an edit to the file that holds the parent link.
        plugin.registerEvent(metadataCache.on('resolved', () => this.scheduleRefresh()));
        plugin.registerEvent(
            vault.on('rename', (file, oldPath) => {
                for (const path of this.notes.keys()) {
                    if (path === oldPath || path.startsWith(`${oldPath}/`)) this.notes.delete(path);
                }
                this.scheduleRefresh();
                if (
                    !this.snapshot.config.sections.some(section =>
                        section.hidden.some(path => path === oldPath || path.startsWith(`${oldPath}/`))
                    )
                )
                    return;
                void this.updateConfig(config => ({
                    ...config,
                    sections: config.sections.map(section => ({
                        ...section,
                        hidden: section.hidden.map(path =>
                            path === oldPath || path.startsWith(`${oldPath}/`) ? `${file.path}${path.slice(oldPath.length)}` : path
                        )
                    }))
                })).catch(reportTopicsError);
            })
        );
        plugin.registerEvent(
            vault.on('delete', file => {
                for (const path of this.notes.keys()) {
                    if (path === file.path || path.startsWith(`${file.path}/`)) this.notes.delete(path);
                }
                this.scheduleRefresh();
            })
        );
        plugin.registerEvent(vault.on('create', () => this.scheduleRefresh()));
        workspace.onLayoutReady(() => this.scheduleRefresh());
        plugin.register(() => {
            this.stopped = true;
            clearTimeout(this.pending);
            this.listeners.clear();
        });
        this.queue = this.load();
    }

    getSnapshot = (): TopicsSnapshot => this.snapshot;

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };

    private publish(): void {
        for (const listener of this.listeners) listener();
    }

    private async load(): Promise<void> {
        let config = defaultConfig;
        try {
            if (await this.app.vault.adapter.exists(this.settingsPath)) {
                config = validateConfig(JSON.parse(await this.app.vault.adapter.read(this.settingsPath)));
            }
        } catch (error) {
            reportTopicsError(error);
        }
        if (this.stopped) return;
        this.snapshot = { ...this.snapshot, config, ready: true };
        this.refresh();
    }

    private scheduleRefresh(): void {
        if (this.stopped || this.pending !== undefined) return;
        this.pending = setTimeout(() => {
            this.pending = undefined;
            if (this.snapshot.ready && !this.stopped) this.refresh();
        }, 40);
    }

    private resolveLink = (link: string, source: string): string | undefined =>
        this.app.metadataCache.getFirstLinkpathDest(link, source)?.path;

    private refresh(): void {
        if (this.snapshot.config.sections.length === 0) {
            this.snapshot = { ...this.snapshot, graphs: new Map() };
            this.publish();
            return;
        }
        const notes = this.app.vault.getMarkdownFiles().map(file => {
            const metadata = this.notes.get(file.path);
            return metadata ?? { path: file.path, properties: this.app.metadataCache.getFileCache(file)?.frontmatter ?? {} };
        });
        const graphs = new Map(this.snapshot.config.sections.map(section => [section.id, buildGraph(notes, section, this.resolveLink)]));
        this.snapshot = { ...this.snapshot, graphs };
        this.publish();
    }

    private enqueue<T>(operation: () => Promise<T>): Promise<T> {
        const pending = this.queue.then(operation);
        this.queue = pending.catch(() => undefined);
        return pending;
    }

    updateConfig(update: (config: TopicsConfig) => TopicsConfig): Promise<void> {
        return this.enqueue(async () => {
            const config = validateConfig(update(this.snapshot.config));
            const { adapter } = this.app.vault;
            const contents = JSON.stringify(config, null, 2);
            if (await adapter.exists(this.settingsPath)) await adapter.process(this.settingsPath, () => contents);
            else await adapter.write(this.settingsPath, contents);
            this.snapshot = { ...this.snapshot, config };
            this.refresh();
        });
    }

    setHidden(sectionId: string, path: string, hidden: boolean): Promise<void> {
        return this.updateConfig(config => ({
            ...config,
            sections: config.sections.map(section => {
                if (section.id !== sectionId) return section;
                const entries = new Set(section.hidden);
                if (hidden) entries.add(path);
                else entries.delete(path);
                return { ...section, hidden: [...entries] };
            })
        }));
    }

    readRelationship(sectionId: string, path: string): TopicRelationship | undefined {
        const section = this.snapshot.config.sections.find(item => item.id === sectionId);
        const file = this.app.vault.getFileByPath(path);
        if (!section || !file || !this.snapshot.graphs.get(sectionId)?.nodes.has(path)) return undefined;
        const properties = this.notes.get(path)?.properties ?? this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
        const key = propertyKey(properties, section.relationshipProperty);
        return { property: section.relationshipProperty, key, value: key === undefined ? undefined : properties[key] };
    }

    saveRelationship(
        sectionId: string,
        child: string,
        expected: TopicRelationship,
        values: readonly unknown[],
        allowCycle = false
    ): Promise<'saved' | 'cycle'> {
        return this.mutateRelationship(sectionId, child, (current, graph) => {
            if (
                current.property !== expected.property ||
                current.key !== expected.key ||
                JSON.stringify(current.value) !== JSON.stringify(expected.value)
            ) {
                throw new Error('The linking property changed while you were editing. Cancel to load the current values.');
            }

            if (JSON.stringify(propertyValues(current.value)) === JSON.stringify(values)) return { value: current.value };

            const targets = (value: unknown) =>
                resolveParentLinks({ path: child, properties: { [current.property]: value } }, current.property, this.resolveLink);
            const previous = targets(current.value);
            const parents = new Map(graph.parents).set(child, previous);
            if (!allowCycle && targets(values).some(parent => wouldIntroduceCycle({ ...graph, parents }, child, parent))) return 'cycle';

            return {
                value:
                    Array.isArray(current.value) || values.length > 1 || (current.key === undefined && values.length === 1)
                        ? [...values]
                        : values[0]
            };
        });
    }

    editParent(
        sectionId: string,
        childPath: string,
        parentPath: string,
        operation: 'add' | 'remove',
        allowCycle = false
    ): Promise<'saved' | 'cycle'> {
        return this.mutateRelationship(sectionId, childPath, (current, graph) => {
            const parent = this.app.vault.getFileByPath(parentPath);
            if (!parent || !graph.nodes.has(parentPath)) throw new Error('The parent note has changed. Select the note again.');

            const entries = propertyValues(current.value);
            const kept = entries.filter(value => {
                const target = linkPath(value);
                return !target || this.resolveLink(target, childPath) !== parentPath;
            });
            if (operation === 'remove' && kept.length !== entries.length) {
                return { value: Array.isArray(current.value) ? kept : undefined };
            }
            if (operation === 'add' && kept.length === entries.length) {
                const parents = graph.parents.get(childPath)?.includes(parentPath)
                    ? new Map(graph.parents).set(childPath, [])
                    : graph.parents;
                if (!allowCycle && wouldIntroduceCycle({ ...graph, parents }, childPath, parentPath)) return 'cycle';
                return { value: [...entries, this.app.fileManager.generateMarkdownLink(parent, childPath)] };
            }
            return { value: current.value };
        });
    }

    private mutateRelationship(
        sectionId: string,
        childPath: string,
        edit: (current: TopicRelationship, graph: TopicGraph) => RelationshipEdit
    ): Promise<'saved' | 'cycle'> {
        return this.enqueue(async () => {
            this.refresh();
            const section = this.snapshot.config.sections.find(item => item.id === sectionId);
            const graph = this.snapshot.graphs.get(sectionId);
            const child = this.app.vault.getFileByPath(childPath);
            if (!section || !graph?.nodes.has(childPath) || !child) {
                throw new Error('The section or note has changed. Select the note again.');
            }

            const cycle = new Error('Topic link would create a cycle.');
            let changed: TopicNote['properties'] | undefined;
            try {
                await this.app.fileManager.processFrontMatter(child, properties => {
                    const property = section.relationshipProperty;
                    const key = propertyKey(properties, property);
                    const current = key === undefined ? undefined : properties[key];
                    const next = edit({ property, key, value: current }, graph);
                    if (next === 'cycle') throw cycle;
                    if (next.value === current) return;
                    if (next.value === undefined && key !== undefined) delete properties[key];
                    else {
                        Object.defineProperty(properties, key ?? property, {
                            value: next.value,
                            writable: true,
                            configurable: true,
                            enumerable: true
                        });
                    }
                    changed = { ...properties };
                });
            } catch (error) {
                if (error === cycle) return 'cycle';
                throw error;
            }
            if (changed) {
                this.notes.set(childPath, { path: childPath, properties: changed });
                this.refresh();
            }
            return 'saved';
        });
    }

    async attachLeaves(target: TopicTarget, files: readonly TFile[], choose: ChooseLeafRequirement): Promise<Map<DropResult, number>> {
        const counts = new Map<DropResult, number>();
        for (const file of new Set(files)) {
            let status: DropResult;
            try {
                let result: TopicDropPlan | { status: 'cancelled' } = await this.attachLeaf(target, file);
                if (result.status === 'choice') {
                    const selected = await choose(file, result.choices);
                    result = selected ? await this.attachLeaf(target, file, selected) : { status: 'cancelled' };
                }
                status = result.status === 'choice' ? 'conflict' : result.status;
            } catch (error) {
                console.error('Could not link a note to the topic:', file.path, error);
                status = 'failed';
            }
            counts.set(status, (counts.get(status) ?? 0) + 1);
        }
        return counts;
    }

    private attachLeaf(target: TopicTarget, file: TFile, selected?: TopicRequirement): Promise<TopicDropPlan> {
        return this.enqueue(async () => {
            const { vault, metadataCache, fileManager } = this.app;
            const section = this.snapshot.config.sections.find(section => section.id === target.sectionId);
            const parent = vault.getFileByPath(target.path);
            if (
                this.stopped ||
                !section ||
                !parent ||
                !this.snapshot.graphs.get(section.id)?.nodes.has(target.path) ||
                file.extension !== 'md' ||
                vault.getFileByPath(file.path) !== file
            )
                return { status: 'ineligible' };

            const newLink = fileManager.generateMarkdownLink(parent, file.path);
            const plan = (properties: TopicNote['properties']) =>
                planTopicDrop(section, properties, newLink, link => this.resolveLink(link, file.path) === parent.path, selected);
            const cached = this.notes.get(file.path)?.properties ?? metadataCache.getFileCache(file)?.frontmatter ?? {};
            let result = plan(cached);
            if (result.status !== 'linked') return result;

            let changed: TopicNote['properties'] | undefined;
            await fileManager.processFrontMatter(file, properties => {
                result = plan(properties);
                if (result.status !== 'linked') return;
                for (const [key, value] of Object.entries(result.changes)) {
                    Object.defineProperty(properties, key, { value, writable: true, configurable: true, enumerable: true });
                }
                changed = { ...properties };
            });
            if (changed) {
                this.notes.set(file.path, { path: file.path, properties: changed });
                this.refresh();
            }
            return result;
        });
    }

    title(path: string): string {
        return this.app.vault.getFileByPath(path)?.basename ?? path;
    }

    async open(path: string, newTab: boolean): Promise<void> {
        const file = this.app.vault.getFileByPath(path);
        if (file instanceof TFile) await this.app.workspace.getLeaf(newTab ? 'tab' : false).openFile(file, { active: true });
    }
}

const controllers = new WeakMap<Plugin, TopicsController>();

export function getTopicsController(plugin: Plugin): TopicsController {
    const existing = controllers.get(plugin);
    if (existing) return existing;
    const controller = new TopicsController(plugin);
    controllers.set(plugin, controller);
    return controller;
}

export function reportTopicsError(error: unknown): void {
    new Notice(error instanceof Error ? error.message : 'Notebook Navigator Topics could not complete the action.');
}
