import type { TopicGraph } from './graph';

export interface TopicRow {
    key: string;
    path: string;
    ancestors: readonly string[];
    level: number;
    hasChildren: boolean;
    expanded: boolean;
    hidden: boolean;
}

export function topicRows(
    graph: TopicGraph,
    hidden: ReadonlySet<string>,
    showHidden: boolean,
    isExpanded: (key: string) => boolean
): TopicRow[] {
    const rows: TopicRow[] = [];
    const stack = [...graph.roots]
        .reverse()
        .map(path => ({ key: JSON.stringify(path), path, ancestors: [] as readonly string[], level: 0 }));
    while (stack.length) {
        const row = stack.pop()!;
        const isHidden = hidden.has(row.path);
        if (isHidden && !showHidden) continue;
        const children = (graph.children.get(row.path) ?? []).filter(path => showHidden || !hidden.has(path));
        const expanded = isExpanded(row.key);
        rows.push({ ...row, hasChildren: children.length > 0, expanded, hidden: isHidden });
        if (!expanded) continue;
        for (let index = children.length - 1; index >= 0; index--) {
            const child = children[index];
            stack.push({
                key: `${row.key}/${JSON.stringify(child)}`,
                path: child,
                ancestors: [...row.ancestors, row.path],
                level: row.level + 1
            });
        }
    }
    return rows;
}
