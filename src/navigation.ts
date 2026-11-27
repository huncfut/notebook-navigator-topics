import { useSyncExternalStore } from 'react';
import type { Plugin } from 'obsidian';
import type { MetadataService } from '../services/MetadataService';
import { NavigationPaneItemType } from '../types';
import type { VirtualFolderItem } from '../types/virtualization';
import { topicRows } from './browse';
import type { TopicsConfig } from './config';
import { getTopicsController, type TopicsSnapshot } from './controller';
import type { TopicSection } from './graph';

export interface TopicSelection {
    sectionId: string;
    path: string;
    ancestors: readonly string[];
}

export type TopicItem =
    | { kind: 'group' }
    | { kind: 'section'; sectionId: string; warning: boolean }
    | { kind: 'node'; selection: TopicSelection; hidden: boolean };

const topicNamespace = 'topics:';
export const topicsGroupId = topicNamespace + 'group';
export const topicSectionId = (sectionId: string): string => `topics:section:${JSON.stringify(sectionId)}`;
export const topicBranchPrefix = (sectionId: string): string => `topics:node:${JSON.stringify(sectionId)}:`;
export const topicListKey = ({ sectionId, path }: TopicSelection): string => JSON.stringify([sectionId, path]);

export const topicOccurrenceId = ({ sectionId, path, ancestors }: TopicSelection): string =>
    topicBranchPrefix(sectionId) + [...ancestors, path].map(part => JSON.stringify(part)).join('/');

export function updateTopicExpansion(
    current: ReadonlySet<string>,
    snapshot: TopicsSnapshot,
    showHidden: boolean,
    expanded: boolean,
    selected?: TopicSelection | null
): Set<string> {
    const next = new Set([...current].filter(id => !id.startsWith(topicNamespace)));
    if (!expanded && !selected && snapshot.config.showFolder) next.add(topicsGroupId);
    for (const section of snapshot.config.sections) {
        if (!expanded) {
            if (selected?.sectionId !== section.id) next.add(topicSectionId(section.id));
            continue;
        }
        const graph = snapshot.graphs.get(section.id);
        if (!graph) continue;
        const prefix = topicBranchPrefix(section.id);
        for (const row of topicRows(graph, new Set(section.hidden), showHidden, () => true)) {
            if (row.hasChildren) next.add(prefix + row.key);
        }
    }
    selected?.ancestors.forEach((path, index) => {
        next.add(topicOccurrenceId({ sectionId: selected.sectionId, path, ancestors: selected.ancestors.slice(0, index) }));
    });
    return next;
}

export function useTopicsSnapshot(plugin: Plugin): TopicsSnapshot {
    const controller = getTopicsController(plugin);
    return useSyncExternalStore(controller.subscribe, controller.getSnapshot);
}

export function getSelectedTopic(snapshot: TopicsSnapshot, selection: TopicSelection | null | undefined, showHidden: boolean) {
    if (!selection) return null;
    const section = snapshot.config.sections.find(item => item.id === selection.sectionId);
    const graph = snapshot.graphs.get(selection.sectionId);
    if (!section || !graph?.nodes.has(selection.path)) return null;

    const chain = [...selection.ancestors, selection.path];
    const first = chain[0];
    if (!graph.roots.includes(first)) return null;
    const hidden = showHidden ? null : new Set(section.hidden);
    for (const [index, path] of chain.entries()) {
        if (hidden?.has(path)) return null;
        if (index !== 0 && !graph.children.get(chain[index - 1])?.includes(path)) return null;
    }
    return { section, path: selection.path, leaves: graph.leaves.get(selection.path) ?? [] };
}

export function getTopicIconOverride(section: TopicSection, path: string): string | undefined {
    return section.icons && Object.prototype.hasOwnProperty.call(section.icons, path) ? section.icons[path] : undefined;
}

export function resolveTopicIcon(
    config: TopicsConfig,
    node?: { section: TopicSection; path: string },
    getNoteIcon?: (path: string) => string | undefined
): string | undefined {
    if (!config.showIcons) return undefined;
    if (!node) return config.defaultIcon;
    return (
        getTopicIconOverride(node.section, node.path) ??
        (config.useNodeNoteIcons ? getNoteIcon?.(node.path) : undefined) ??
        config.defaultIcon
    );
}

export function buildTopicNavigationItems(
    snapshot: TopicsSnapshot,
    expandedVirtualFolders: ReadonlySet<string>,
    showHidden: boolean,
    getTitle: (path: string) => string,
    noteMetadata?: Partial<Pick<MetadataService, 'getFileIcon' | 'getFileColor' | 'getFileBackgroundColor'>>,
    countLeaves?: (paths: readonly string[]) => number
): VirtualFolderItem[] {
    if (!snapshot.ready || snapshot.config.sections.length === 0) return [];
    const items: VirtualFolderItem[] = [];
    const { config } = snapshot;
    const defaultIcon = resolveTopicIcon(config);
    const getNoteIcon = (path: string) => noteMetadata?.getFileIcon?.(path);
    const add = (
        id: string,
        name: string,
        level: number,
        topic: TopicItem,
        hasChildren: boolean,
        icon: string | undefined,
        count?: number
    ) => {
        const path = topic.kind === 'node' ? topic.selection.path : undefined;
        items.push({
            type: NavigationPaneItemType.VIRTUAL_FOLDER,
            data: { id, name, icon },
            key: id,
            level,
            topic,
            hasChildren,
            showFileCount: count !== undefined,
            noteCount: count === undefined ? undefined : { current: count, descendants: 0, total: count },
            color: path && config.useNodeNoteColors ? noteMetadata?.getFileColor?.(path) : undefined,
            backgroundColor: path && config.useNodeNoteBackgroundColors ? noteMetadata?.getFileBackgroundColor?.(path) : undefined
        });
    };
    const sectionLevel = config.showFolder ? 1 : 0;
    if (config.showFolder) {
        const expanded = !expandedVirtualFolders.has(topicsGroupId);
        add(topicsGroupId, 'Topics', 0, { kind: 'group' }, true, defaultIcon);
        if (!expanded) return items;
    }
    for (const section of snapshot.config.sections) {
        const graph = snapshot.graphs.get(section.id);
        if (!graph) continue;
        const id = topicSectionId(section.id);
        const hidden = new Set(section.hidden);
        const hasChildren = graph.roots.some(path => showHidden || !hidden.has(path));
        const expanded = !expandedVirtualFolders.has(id);
        add(
            id,
            section.name,
            sectionLevel,
            { kind: 'section', sectionId: section.id, warning: graph.cycles.length > 0 },
            hasChildren,
            defaultIcon
        );
        if (!hasChildren || !expanded) continue;
        const prefix = topicBranchPrefix(section.id);
        const rows = topicRows(graph, hidden, showHidden, key => expandedVirtualFolders.has(prefix + key));
        const leafCounts = new Map<string, number>();
        for (const row of rows) {
            const selection = { sectionId: section.id, path: row.path, ancestors: row.ancestors };
            let count = leafCounts.get(row.path);
            if (count === undefined && countLeaves) {
                count = countLeaves(graph.leaves.get(row.path) ?? []);
                leafCounts.set(row.path, count);
            }
            add(
                prefix + row.key,
                getTitle(row.path),
                sectionLevel + 1 + row.level,
                { kind: 'node', selection, hidden: row.hidden },
                row.hasChildren,
                resolveTopicIcon(config, { section, path: row.path }, getNoteIcon),
                count
            );
        }
    }
    return items;
}
