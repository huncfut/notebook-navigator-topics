export interface TopicSection {
    id: string;
    name: string;
    nodeFilter: string;
    leafFilter: string;
    relationshipProperty: string;
    hidden: string[];
    icons?: Record<string, string>;
}

export interface TopicNote {
    path: string;
    properties: Readonly<Record<string, unknown>>;
}

export interface TopicLink {
    child: string;
    parent: string;
}

export interface TopicGraph {
    nodes: ReadonlySet<string>;
    roots: string[];
    children: ReadonlyMap<string, string[]>;
    leaves: ReadonlyMap<string, string[]>;
    parents: ReadonlyMap<string, string[]>;
    cycles: TopicLink[][];
}

const matchesKey = (left: string, right: string) => left.normalize('NFC').toLowerCase() === right.normalize('NFC').toLowerCase();
const sortPaths = (left: string, right: string) =>
    left.localeCompare(right, undefined, { numeric: true }) || (left < right ? -1 : Number(left > right));

export function propertyKey(properties: Readonly<Record<string, unknown>>, key: string): string | undefined {
    if (Object.prototype.hasOwnProperty.call(properties, key)) return key;
    return Object.keys(properties).find(candidate => matchesKey(candidate, key));
}

export function propertyValues(value: unknown): readonly unknown[] {
    return Array.isArray(value) ? value : value == null ? [] : [value];
}

export interface TopicRequirement {
    key: string;
    value: string;
}

export function parseTopicRequirements(expression: string): TopicRequirement[] {
    if (!expression.trim()) return [];
    return expression
        .trim()
        .split(/\s+OR\s+/i)
        .map(condition => {
            const separator = condition.indexOf('=');
            const key = condition.slice(0, separator).trim();
            const value = condition
                .slice(separator + 1)
                .trim()
                .normalize('NFC');
            if (separator < 1 || !key || !value) throw new Error('Use property=value conditions joined by OR.');
            return { key, value };
        });
}

export function compileFilter(expression: string): (properties: TopicNote['properties']) => boolean {
    const conditions = parseTopicRequirements(expression);
    return properties =>
        conditions.some(({ key, value }) => {
            const existingKey = propertyKey(properties, key);
            if (existingKey === undefined) return false;
            return propertyValues(properties[existingKey]).some(
                candidate =>
                    (typeof candidate === 'string' || typeof candidate === 'number' || typeof candidate === 'boolean') &&
                    String(candidate).normalize('NFC') === value
            );
        });
}

export function linkPath(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    const wiki = /^\[\[([^|#\]]+)(?:[#|][^\]]*)?\]\]$/.exec(text);
    if (wiki) return wiki[1].trim();
    const markdown = /^\[[^\]]*\]\((.+)\)$/.exec(text);
    if (!markdown) return null;
    const target = markdown[1]
        .trim()
        .replace(/^<(.+)>$/, '$1')
        .split('#', 1)[0];
    if (!target || /^(?:[\w+.-]+:|\/\/)/.test(target)) return null;
    try {
        return decodeURIComponent(target);
    } catch {
        return null;
    }
}

export function resolveParentLinks(
    note: TopicNote,
    relationshipProperty: string,
    resolveLink: (link: string, sourcePath: string) => string | undefined
): string[] {
    const key = propertyKey(note.properties, relationshipProperty);
    const found = new Set<string>();
    if (key === undefined) return [];
    for (const value of propertyValues(note.properties[key])) {
        const target = linkPath(value);
        const parent = target ? resolveLink(target, note.path) : undefined;
        if (parent) found.add(parent);
    }
    return [...found];
}

function addToIndex(index: Map<string, string[]>, key: string, value: string): void {
    const entries = index.get(key);
    if (entries) entries.push(value);
    else index.set(key, [value]);
}

// Find strongly connected components with iterative depth-first passes.
function findCycles(
    nodes: ReadonlySet<string>,
    parents: ReadonlyMap<string, string[]>,
    children: ReadonlyMap<string, string[]>
): TopicLink[][] {
    const visited = new Set<string>();
    const finished: string[] = [];
    for (const path of nodes) {
        if (visited.has(path)) continue;
        visited.add(path);
        const stack = [{ path, index: 0 }];
        while (stack.length) {
            const frame = stack[stack.length - 1];
            const next = parents.get(frame.path)?.[frame.index++];
            if (next === undefined) {
                finished.push(frame.path);
                stack.pop();
            } else if (!visited.has(next)) {
                visited.add(next);
                stack.push({ path: next, index: 0 });
            }
        }
    }

    visited.clear();
    const cycles: TopicLink[][] = [];
    for (const path of finished.reverse()) {
        if (visited.has(path)) continue;
        const component = new Set<string>();
        const stack = [path];
        visited.add(path);
        while (stack.length) {
            const member = stack.pop()!;
            component.add(member);
            for (const next of children.get(member) ?? []) {
                if (visited.has(next)) continue;
                visited.add(next);
                stack.push(next);
            }
        }
        const links: TopicLink[] = [];
        for (const member of component) {
            for (const parent of parents.get(member) ?? []) {
                if (component.has(parent)) links.push({ child: member, parent });
            }
        }
        if (links.length) cycles.push(links);
    }
    return cycles;
}

export function buildGraph(
    notes: readonly TopicNote[],
    section: TopicSection,
    resolveLink: (link: string, sourcePath: string) => string | undefined
): TopicGraph {
    const nodeFilter = compileFilter(section.nodeFilter);
    const leafFilter = compileFilter(section.leafFilter);
    const nodes = new Set(notes.filter(note => nodeFilter(note.properties)).map(note => note.path));
    const parents = new Map<string, string[]>();
    const children = new Map<string, string[]>();
    const leaves = new Map<string, string[]>();

    for (const note of notes) {
        const isNode = nodes.has(note.path);
        if (!isNode && !leafFilter(note.properties)) continue;
        const attached = resolveParentLinks(note, section.relationshipProperty, resolveLink).filter(path => nodes.has(path));
        if (isNode && attached.length > 0) parents.set(note.path, attached);
        for (const parent of attached) addToIndex(isNode ? children : leaves, parent, note.path);
    }

    const cycles = findCycles(nodes, parents, children);
    const cyclicParents = new Map<string, Set<string>>();
    for (const { child, parent } of cycles.flat()) {
        const excluded = cyclicParents.get(child) ?? new Set<string>();
        excluded.add(parent);
        cyclicParents.set(child, excluded);
    }

    const roots = [...nodes].filter(child => !parents.get(child)?.some(parent => !cyclicParents.get(child)?.has(parent)));
    for (const [parent, paths] of children) {
        children.set(parent, paths.filter(child => !cyclicParents.get(child)?.has(parent)).sort(sortPaths));
    }
    for (const paths of leaves.values()) paths.sort(sortPaths);
    return { nodes, roots: roots.sort(sortPaths), children, leaves, parents, cycles };
}

export function wouldIntroduceCycle(graph: TopicGraph, child: string, parent: string): boolean {
    if (!graph.nodes.has(child) || !graph.nodes.has(parent) || graph.parents.get(child)?.includes(parent)) return false;
    const visited = new Set<string>();
    const stack = [parent];
    while (stack.length) {
        const current = stack.pop()!;
        if (current === child) return true;
        if (visited.has(current)) continue;
        visited.add(current);
        for (const ancestor of graph.parents.get(current) ?? []) stack.push(ancestor);
    }
    return false;
}

export function visibleNodes(graph: TopicGraph, hidden: ReadonlySet<string>, showHidden: boolean): ReadonlySet<string> {
    if (showHidden || hidden.size === 0) return graph.nodes;
    const visible = new Set<string>();
    const stack = [...graph.roots];
    while (stack.length) {
        const path = stack.pop()!;
        if (visible.has(path) || hidden.has(path)) continue;
        visible.add(path);
        for (const child of graph.children.get(path) ?? []) stack.push(child);
    }
    return visible;
}
