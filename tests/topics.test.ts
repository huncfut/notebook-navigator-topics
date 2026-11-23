import { getNavigationItemSearchMatch } from '../src/components/navigationPane/navigationPaneItemState';
import { useNavigationSearchHighlights } from '../src/hooks/navigationPane/useNavigationSearchHighlights';
import {
    useNavigationPaneTreeInteractions,
    type NavigationPaneTreeInteractionsResult
} from '../src/hooks/navigationPane/useNavigationPaneTreeInteractions';
import { formatTopicFilter, parseTopicFilter } from '../src/topics/topic-filter';
import { buildSearchNavFilterState, updateFilterQueryWithTopic } from '../src/utils/filterSearch';
import { planTopicDrop } from '../src/topics/topic-drop';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parse } from 'yaml';
import { App, TFile, type Plugin } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { topicRows } from '../src/topics/browse';
import { defaultConfig, validateConfig } from '../src/topics/config';
import { getTopicsController, type TopicsController } from '../src/topics/controller';
import {
    buildGraph,
    compileFilter,
    linkPath,
    visibleNodes,
    wouldIntroduceCycle,
    type TopicNote,
    type TopicSection
} from '../src/topics/graph';
import { buildTopicNavigationItems, getSelectedTopic, topicBranchPrefix, topicOccurrenceId, topicsGroupId } from '../src/topics/navigation';
import { ItemType, NavigationPaneItemType } from '../src/types';
import { getFilesForNavigationSelection } from '../src/utils/selectionUtils';
import { buildNavigationPathIndexMap, getNavigationIndex } from '../src/utils/navigationIndex';
import { buildSearchableNameData, filterListPaneFiles } from '../src/hooks/listPaneData/searchPipeline';
import { DEFAULT_SETTINGS } from '../src/settings/defaultSettings';
import type { IndexedDBStorage } from '../src/storage/IndexedDBStorage';
import { createTestTFile } from './utils/createTestTFile';
import { TopicsSettings } from '../src/topics/modals';
import { graphNodeGesture, TopicGraphCanvas } from '../src/topics/topic-graph-canvas';
import { buildTopicGraphDisplay, getGraphBounds, topicCard, type GraphDepth } from '../src/topics/topic-graph-data';
import { TopicGraphPanel } from '../src/topics/topic-graph-panel';
import { revealTopicGraph, TOPIC_GRAPH_VIEW } from '../src/topics/topic-graph-workspace';
import { registerTopicsStyles } from '../src/topics/styles';

const section: TopicSection = {
    id: 'concepts',
    name: 'Koncepty',
    nodeFilter: 'Typ=koncept',
    leafFilter: 'Typ=notatka OR Typ=osoba OR Typ=myśl OR Typ=koncept',
    relationshipProperty: 'Powiązane',
    hidden: []
};
const organizations: TopicSection = {
    id: 'organizations',
    name: 'Organizacje',
    nodeFilter: 'Typ=organizacja',
    leafFilter: 'Typ=osoba',
    relationshipProperty: 'Pracuje w',
    hidden: []
};
const wiki = (name: string) => `[[${name}]]`;
const path = (name: string) => `${name}.md`;
const note = (name: string, type: string, ...parents: string[]): TopicNote => ({
    path: path(name),
    properties: { Typ: type, Powiązane: parents.map(wiki) }
});
const resolveFixtureLink = (link: string) => (link.endsWith('.md') ? link : path(link));
const graphFor = (notes: TopicNote[], settings = section) => buildGraph(notes, settings, resolveFixtureLink);

const fixtures = [
    note('Music', 'koncept'),
    note('Technology', 'koncept'),
    note('Audio', 'koncept', 'Music', 'Technology', 'Unresolved'),
    note('Live Sound', 'koncept', 'Audio'),
    note('Cable Guide', 'notatka', 'Audio', 'Live Sound', 'Audio'),
    note('Unlinked', 'myśl'),
    note('Linked to Leaf', 'notatka', 'Cable Guide'),
    note('Venue', 'organizacja'),
    { path: path('Alex'), properties: { Typ: 'osoba', Powiązane: ['[[Music]]'], 'Pracuje w': '[[Venue]]' } }
];

describe('filters and settings', () => {
    it('supports OR, list properties, scalar values and Polish property keys', () => {
        const filter = compileFilter(' Typ = notatka OR Typ=osoba or Rok=2026 OR pracuje w=studio ');
        expect(filter({ typ: ['notatka', 'other'] })).toBe(true);
        expect(filter({ Rok: 2026 })).toBe(true);
        expect(filter({ 'Pracuje w': 'studio' })).toBe(true);
        expect(filter({ Typ: 'koncept', Other: 'osoba' })).toBe(false);
        expect(compileFilter('Typ=myśl')({ Typ: 'mys\u0301l' })).toBe(true);
        expect(compileFilter('Typ=myśl')({ Typ: 'mys\u0301ł' })).toBe(false);
        expect(compileFilter('')(fixtures[0].properties)).toBe(false);
    });

    it.each(['Typ', 'Typ=', '=koncept', 'Typ=koncept OR Typ', 'Typ=koncept OR =x'])('rejects malformed filter %s', expression => {
        expect(() => compileFilter(expression)).toThrow('property=value');
    });

    it('validates and normalizes saved settings with no duplicate hidden paths', () => {
        expect(validateConfig(defaultConfig)).toEqual(defaultConfig);
        const saved = validateConfig({
            ...defaultConfig,
            sections: [{ ...section, name: ' Koncepty ', hidden: [' Music.md', '', 'Music.md'] }]
        });
        expect(saved.sections[0].name).toBe('Koncepty');
        expect(saved.sections[0].hidden).toEqual(['Music.md']);
        expect(() => validateConfig({ ...defaultConfig, sections: [section, section] })).toThrow();
        expect(() => validateConfig({ ...defaultConfig, sections: [{ ...section, relationshipProperty: '' }] })).toThrow();
        expect(() => validateConfig({ ...defaultConfig, sections: [{ ...section, nodeFilter: '' }] })).toThrow();
        expect(() => validateConfig({ ...defaultConfig, openNodeIn: 'window' })).toThrow();
        expect(() => validateConfig(null)).toThrow();
    });
});

describe('property links', () => {
    it.each([
        ['[[Music]]', 'Music'],
        ['[[A/B#Section|alias]]', 'A/B'],
        ['[Alias](A%20B.md#Heading)', 'A B.md'],
        ['[Alias](<A B.md>)', 'A B.md'],
        ['[Alias](./A.md)', './A.md'],
        ['[site](https://example.com)', null],
        ['[broken](invalid%XY)', null],
        ['Music', null],
        [42, null]
    ])('parses %s as %s', (value, expected) => expect(linkPath(value)).toBe(expected));

    it('passes the child path to the resolver and deduplicates links to the same note', () => {
        const resolver = vi.fn((link: string, source: string) =>
            source === 'folder/Child.md' && link === 'Music' ? 'folder/Music.md' : undefined
        );
        const graph = buildGraph(
            [
                { path: 'folder/Music.md', properties: { Typ: 'koncept' } },
                { path: 'folder/Child.md', properties: { Typ: 'koncept', powiązane: ['[[Music|Alias]]', '[[Music#Heading]]'] } }
            ],
            section,
            resolver
        );
        expect(resolver).toHaveBeenCalledWith('Music', 'folder/Child.md');
        expect(graph.children.get('folder/Music.md')).toEqual(['folder/Child.md']);
    });
});

describe('graph traversal and cycle safety', () => {
    it('browses independent sections with nested nodes and shared leaves', () => {
        const graph = graphFor(fixtures);
        expect(graph.roots).toEqual(['Music.md', 'Technology.md']);
        expect(graph.children.get('Music.md')).toEqual(['Audio.md']);
        expect(graph.children.get('Technology.md')).toEqual(['Audio.md']);
        expect(graph.children.get('Audio.md')).toEqual(['Live Sound.md']);
        expect(graph.leaves.get('Music.md')).toEqual(['Alex.md']);
        expect(graph.leaves.get('Audio.md')).toEqual(['Cable Guide.md']);
        expect(graph.leaves.get('Live Sound.md')).toEqual(['Cable Guide.md']);
        expect([...graph.leaves.values()].flat()).not.toContain('Unlinked.md');
        expect([...graph.leaves.values()].flat()).not.toContain('Linked to Leaf.md');
        expect(graph.cycles).toEqual([]);
        expect(graphFor(fixtures, organizations).roots).toEqual(['Venue.md']);
        expect(graphFor(fixtures, organizations).leaves.get('Venue.md')).toEqual(['Alex.md']);
    });

    it('represents fully cyclic components, self-links and external edges', () => {
        const graph = graphFor([
            note('A', 'koncept', 'B', 'Outside'),
            note('B', 'koncept', 'C'),
            note('C', 'koncept', 'A', 'B'),
            note('Self', 'koncept', 'Self'),
            note('Outside', 'koncept'),
            note('Descendant', 'koncept', 'C')
        ]);
        expect(graph.cycles).toHaveLength(2);
        expect(graph.cycles.flat()).toEqual(
            expect.arrayContaining([
                { child: 'A.md', parent: 'B.md' },
                { child: 'B.md', parent: 'C.md' },
                { child: 'C.md', parent: 'A.md' },
                { child: 'C.md', parent: 'B.md' },
                { child: 'Self.md', parent: 'Self.md' }
            ])
        );
        expect(graph.roots).toEqual(['B.md', 'C.md', 'Outside.md', 'Self.md']);
        expect(graph.children.get('Outside.md')).toEqual(['A.md']);
        expect(graph.children.get('C.md')).toEqual(['Descendant.md']);
        expect(graph.parents.get('A.md')).toEqual(['B.md', 'Outside.md']);
        expect(wouldIntroduceCycle(graph, 'A.md', 'B.md')).toBe(false);
        expect(wouldIntroduceCycle(graph, 'C.md', 'Descendant.md')).toBe(true);
    });

    it('expands from all cycles by incident links and excludes leaves at every depth', () => {
        const graph = graphFor([
            note('A', 'koncept', 'B', 'Parent'),
            note('B', 'koncept', 'A'),
            note('Self', 'koncept', 'Self'),
            note('Child', 'koncept', 'A'),
            note('Parent', 'koncept', 'Grandparent'),
            note('Grandchild', 'koncept', 'Child'),
            note('Grandparent', 'koncept', 'Third hop'),
            note('Third hop', 'koncept'),
            note('Isolated', 'koncept'),
            note('Unrelated child', 'koncept', 'Unrelated parent'),
            note('Unrelated parent', 'koncept'),
            note('Leaf', 'notatka', 'A')
        ]);
        const { vertices, edges } = buildTopicGraphDisplay(graph);
        const namesAt = (depth: number) =>
            vertices
                .filter(vertex => vertex.depth === depth)
                .map(vertex => vertex.path)
                .sort();
        const linksAt = (depth: number) => edges.filter(edge => edge.depth === depth).map(edge => [edge.child, edge.parent]);

        expect(namesAt(0)).toEqual(['A.md', 'B.md', 'Self.md']);
        expect(namesAt(1)).toEqual(['Child.md', 'Parent.md']);
        expect(namesAt(2)).toEqual(['Grandchild.md', 'Grandparent.md']);
        expect(namesAt(3)).toEqual(['Isolated.md', 'Third hop.md', 'Unrelated child.md', 'Unrelated parent.md']);
        expect(linksAt(0)).toEqual([
            ['A.md', 'B.md'],
            ['B.md', 'A.md'],
            ['Self.md', 'Self.md']
        ]);
        expect(linksAt(1)).toEqual([
            ['A.md', 'Parent.md'],
            ['Child.md', 'A.md']
        ]);
        expect(linksAt(2)).toEqual([
            ['Grandchild.md', 'Child.md'],
            ['Parent.md', 'Grandparent.md']
        ]);
        expect(linksAt(3)).toEqual([
            ['Grandparent.md', 'Third hop.md'],
            ['Unrelated child.md', 'Unrelated parent.md']
        ]);
        expect(edges.filter(edge => edge.cyclic)).toHaveLength(3);
        const [forward, reverse, loop] = edges.filter(edge => edge.cyclic);
        expect(forward.action).not.toEqual(reverse.action);
        expect(loop.path).toContain(' C ');
        expect(edges.every(edge => !edge.path.includes('NaN'))).toBe(true);
    });

    it('keeps a directed link between separate cycles outside depth zero', () => {
        const { edges } = buildTopicGraphDisplay(graphFor([note('A', 'koncept', 'A', 'B'), note('B', 'koncept', 'B')]));
        expect(edges.find(edge => edge.child !== edge.parent)).toMatchObject({ cyclic: false, depth: 1 });
    });

    it('draws arrows from parents on the left to children on the right without overlapping cards', () => {
        const notes = [
            note('A', 'koncept', 'A', 'B', 'Parent'),
            note('B', 'koncept', 'A', 'C'),
            note('C', 'koncept', 'C', 'Parent'),
            note('Child', 'koncept', 'A', 'Parent'),
            note('Sibling', 'koncept', 'Parent'),
            note('Parent', 'koncept'),
            note('Disconnected', 'koncept', 'Other'),
            note('Other', 'koncept')
        ];
        const display = buildTopicGraphDisplay(graphFor(notes));
        expect(buildTopicGraphDisplay(graphFor([...notes].reverse()))).toEqual(display);

        const positions = new Map(display.vertices.map(vertex => [vertex.path, vertex.position]));
        for (const edge of display.edges.filter(edge => !edge.cyclic)) {
            const parent = positions.get(edge.parent)!;
            const child = positions.get(edge.child)!;
            expect(parent.x).toBeLessThan(child.x);
            expect(edge.route[0].x).toBe(parent.x + topicCard.width / 2);
            expect(edge.route.at(-1)!.x).toBe(child.x - topicCard.width / 2 - 4);
        }
        expect(positions.get('Disconnected.md')!.y).toBeGreaterThan(positions.get('Parent.md')!.y);

        for (const [index, vertex] of display.vertices.entries()) {
            for (const other of display.vertices.slice(index + 1)) {
                expect(
                    Math.abs(vertex.position.x - other.position.x) >= topicCard.width ||
                        Math.abs(vertex.position.y - other.position.y) >= topicCard.height
                ).toBe(true);
            }
        }
        const shortcut = display.edges.find(edge => edge.child === 'A.md' && edge.parent === 'Parent.md')!;
        const [, , start, end] = shortcut.route;
        const intermediate = positions.get('B.md')!;
        expect(start.y).toBe(end.y);
        expect(start.y).toBeLessThan(intermediate.y - topicCard.height / 2);
        expect(start.x).toBeLessThan(intermediate.x - topicCard.width / 2);
        expect(end.x).toBeGreaterThan(intermediate.x + topicCard.width / 2);

        const cycleEdges = display.edges.filter(edge => edge.cyclic);
        expect(new Set(cycleEdges.map(edge => JSON.stringify(edge.action))).size).toBe(cycleEdges.length);
        const bounds = getGraphBounds(display.vertices, display.edges);
        for (const { x, y } of display.edges.flatMap(edge => edge.route)) {
            expect(Math.abs(x - bounds.x)).toBeLessThan(bounds.width / 2);
            expect(Math.abs(y - bounds.y)).toBeLessThan(bounds.height / 2);
        }
    });

    it('aligns parentless notes in the leftmost column across branches and components', () => {
        const graph = graphFor([
            note('Deep root', 'koncept'),
            note('Short root', 'koncept'),
            note('Middle', 'koncept', 'Deep root'),
            note('Shared child', 'koncept', 'Middle', 'Short root'),
            note('Independent root', 'koncept'),
            note('Independent child', 'koncept', 'Independent root'),
            note('Isolated', 'koncept'),
            note('Cycle A', 'koncept', 'Cycle B'),
            note('Cycle B', 'koncept', 'Cycle A')
        ]);
        const { vertices } = buildTopicGraphDisplay(graph);
        const columns = new Map(vertices.map(vertex => [vertex.path, vertex.position.x]));
        const left = Math.min(...columns.values());
        for (const root of ['Deep root', 'Short root', 'Independent root', 'Isolated']) {
            expect(columns.get(path(root))).toBe(left);
        }
        expect(columns.get(path('Middle'))).toBeGreaterThan(left);
        expect(columns.get(path('Shared child'))).toBeGreaterThan(columns.get(path('Middle'))!);
    });

    it('reveals more cards without moving the focused cycle on depth changes', () => {
        const display = buildTopicGraphDisplay(
            graphFor([note('A', 'koncept', 'B'), note('B', 'koncept', 'A', 'Parent'), note('Parent', 'koncept'), note('Other', 'koncept')])
        );
        const render = (depth: GraphDepth) =>
            renderToStaticMarkup(
                createElement(TopicGraphCanvas, {
                    display,
                    depth,
                    busy: false,
                    title: path => path,
                    onOpen: vi.fn(),
                    onConnect: vi.fn(),
                    onRemove: vi.fn(async () => true)
                })
            );
        const initial = render(0);
        const focus = initial.match(/<g transform="[^"]+scale\([^"]+"/g)?.[0];
        expect(focus).toBeDefined();
        expect(initial).toContain(`rx="${topicCard.radius}"`);
        expect(initial).not.toContain('Open Parent.md');
        expect(render(1)).toContain('Open Parent.md');
        for (const depth of [1, 2, 3] as const) expect(render(depth)).toContain(focus!);
        expect(render(3)).toContain('Open Other.md');
    });

    it('reduces avoidable crossings without changing the columns of any note', () => {
        const graph = graphFor([
            note('A', 'koncept', 'Y'),
            note('B', 'koncept', 'X'),
            note('C', 'koncept', 'X', 'Y'),
            note('X', 'koncept', 'Top'),
            note('Y', 'koncept', 'Top'),
            note('Top', 'koncept')
        ]);
        const original = buildTopicGraphDisplay(graph, false);
        const optimized = buildTopicGraphDisplay(graph);
        function crossings({ edges }: typeof original): number {
            return edges.reduce((count, edge, index) => {
                const [first, last] = [edge.route[0], edge.route.at(-1)!];
                for (const other of edges.slice(index + 1)) {
                    const [left, right] = [other.route[0], other.route.at(-1)!];
                    if (first.x === left.x && last.x === right.x && (first.y - left.y) * (last.y - right.y) < 0) count++;
                }
                return count;
            }, 0);
        }
        expect(original.vertices.map(vertex => vertex.position.x)).toEqual(optimized.vertices.map(vertex => vertex.position.x));
        expect(crossings(original)).toBeGreaterThan(0);
        expect(crossings(optimized)).toBe(0);
    });

    it('opens on Shift-click and connects the dragged child to its drop target', () => {
        expect(graphNodeGesture('A', 'A', false, false)).toBeUndefined();
        expect(graphNodeGesture('A', 'A', false, true)).toEqual({ action: 'open', child: 'A' });
        expect(graphNodeGesture('A', 'B', true, false)).toEqual({ action: 'connect', child: 'A', parent: 'B' });
        expect(graphNodeGesture('A', 'A', true, false)).toBeUndefined();
        expect(graphNodeGesture('A', undefined, true, false)).toBeUndefined();
        expect(graphNodeGesture('A', 'B', false, false)).toBeUndefined();
    });

    it('predicts added cycles without treating a shared descendant as a cycle', () => {
        const graph = graphFor(fixtures);
        expect(wouldIntroduceCycle(graph, 'Music.md', 'Live Sound.md')).toBe(true);
        expect(wouldIntroduceCycle(graph, 'Music.md', 'Music.md')).toBe(true);
        expect(wouldIntroduceCycle(graph, 'Music.md', 'Technology.md')).toBe(false);
        expect(wouldIntroduceCycle(graph, 'Music.md', 'Cable Guide.md')).toBe(false);
        expect(wouldIntroduceCycle(graph, 'Cable Guide.md', 'Music.md')).toBe(false);
    });

    it('handles a 15,000-note hierarchy without recursion limits', () => {
        const notes = Array.from({ length: 15_000 }, (_, i) => note(`Note ${i}`, 'koncept', ...(i ? [`Note ${i - 1}`] : [])));
        const graph = graphFor(notes);
        expect(graph.roots).toEqual(['Note 0.md']);
        expect(graph.nodes.size).toBe(15_000);
        expect(graph.cycles).toEqual([]);
        expect(wouldIntroduceCycle(graph, 'Note 0.md', 'Note 14999.md')).toBe(true);
    });

    it('agrees with independent reachability checks on 50 mixed graphs', () => {
        let seed = 0x2026;
        function random() {
            seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
            return seed / 0x100000000;
        }
        for (let run = 0; run < 50; run++) {
            const names = Array.from({ length: 9 }, (_, index) => `Node ${index}`);
            const parents = new Map(names.map(name => [path(name), names.filter(() => random() < 0.22).map(path)]));
            const graph = graphFor(
                names.map(name => note(name, 'koncept', ...(parents.get(path(name)) ?? []).map(path => path.slice(0, -3))))
            );
            const cyclic = [...parents]
                .flatMap(([child, links]) =>
                    links
                        .filter(parent => {
                            let reachable = new Set([parent]);
                            for (let i = 0; i < names.length; i++) {
                                reachable = new Set([...reachable, ...[...reachable].flatMap(node => parents.get(node) ?? [])]);
                            }
                            return reachable.has(child);
                        })
                        .map(parent => `${child}>${parent}`)
                )
                .sort();
            expect(
                graph.cycles
                    .flat()
                    .map(({ child, parent }) => `${child}>${parent}`)
                    .sort()
            ).toEqual(cyclic);
        }
    });
});

describe('navigation and the file list', () => {
    const config = { ...defaultConfig, sections: [section, organizations] };
    const graph = graphFor(fixtures);
    const snapshot = {
        config,
        ready: true,
        graphs: new Map([
            [section.id, graph],
            [organizations.id, graphFor(fixtures, organizations)]
        ])
    };
    const title = (path: string) => basename(path, '.md');

    it('expands independent paths to the same node and hides every occurrence in a section', () => {
        const expanded = new Set(['"Music.md"', '"Technology.md"', '"Music.md"/"Audio.md"']);
        const rows = topicRows(graph, new Set(), false, key => expanded.has(key));
        expect(rows.filter(row => row.path === 'Audio.md')).toHaveLength(2);
        expect(rows.filter(row => row.path === 'Live Sound.md')).toHaveLength(1);
        const hidden = new Set(['Audio.md']);
        expect(topicRows(graph, hidden, false, key => expanded.has(key)).map(row => row.path)).toEqual(['Music.md', 'Technology.md']);
        expect(topicRows(graph, hidden, true, key => expanded.has(key)).filter(row => row.hidden)).toHaveLength(2);
        expect(visibleNodes(graph, new Set(['Music.md']), false).has('Audio.md')).toBe(true);
        expect(visibleNodes(graph, new Set(['Music.md', 'Technology.md']), false).has('Audio.md')).toBe(false);
    });

    it('feeds native virtual rows and distinct occurrence keys to the navigation index', () => {
        const expanded = new Set(['"Music.md"', '"Technology.md"'].map(key => topicBranchPrefix(section.id) + key));
        const wrapped = buildTopicNavigationItems(snapshot, expanded, false, title, {});
        expect(wrapped.every(item => item.type === NavigationPaneItemType.VIRTUAL_FOLDER)).toBe(true);
        expect(wrapped[0].data.id).toBe(topicsGroupId);
        expect(wrapped.filter(item => item.data.name === 'Audio')).toHaveLength(2);
        expect(wrapped.some(item => item.data.name === 'Cable Guide')).toBe(false);
        const index = buildNavigationPathIndexMap(wrapped);
        const occurrence = (parent: string) => topicOccurrenceId({ sectionId: section.id, path: 'Audio.md', ancestors: [parent] });
        const first = getNavigationIndex(index, ItemType.TOPIC, occurrence('Music.md'));
        const second = getNavigationIndex(index, ItemType.TOPIC, occurrence('Technology.md'));
        expect(first).toBeDefined();
        expect(second).toBeDefined();
        expect(first).not.toBe(second);

        const collapsed = buildTopicNavigationItems(snapshot, new Set([topicsGroupId]), false, title, {});
        expect(collapsed).toHaveLength(1);
        const cyclic = graphFor([...fixtures, note('Loop', 'koncept', 'Loop')]);
        const unwrapped = buildTopicNavigationItems(
            {
                ...snapshot,
                config: { ...config, showFolder: false },
                graphs: new Map([
                    [section.id, cyclic],
                    [organizations.id, graphFor(fixtures, organizations)]
                ])
            },
            expanded,
            false,
            title,
            {}
        );
        expect(unwrapped.some(item => item.data.id === topicsGroupId)).toBe(false);
        expect(unwrapped.find(item => item.data.name === 'Koncepty')).toMatchObject({ level: 0, topic: { warning: true } });
        expect(unwrapped.find(item => item.data.name === 'Organizacje')).toMatchObject({ level: 0, topic: { warning: false } });
    });

    it('uses direct leaves as the base for Navigator filter search and Omnisearch', () => {
        const fixtureNotes = [
            ...fixtures,
            { ...note('Guide from another folder', 'notatka', 'Audio'), path: 'Other/Guide.md' },
            { ...note('Descendant guide', 'notatka', 'Live Sound'), path: 'Other/Descendant Guide.md' }
        ];
        const data = { ...snapshot, graphs: new Map(snapshot.graphs).set(section.id, graphFor(fixtureNotes)) };
        const selection = { sectionId: section.id, path: 'Audio.md', ancestors: ['Music.md'] };
        const selected = getSelectedTopic(data, selection, false)!;
        const app = new App();
        const files = new Map(fixtureNotes.map(note => [note.path, createTestTFile(note.path)]));
        app.vault.getFileByPath = vi.fn(filePath => files.get(filePath) ?? null);
        const baseFiles = getFilesForNavigationSelection(
            { selectionType: ItemType.TOPIC, selectedTopic: selection, topicLeafPaths: selected.leaves },
            DEFAULT_SETTINGS,
            { includeDescendantNotes: true, showHiddenItems: true },
            app,
            null,
            null,
            { orderResults: false }
        );
        expect(baseFiles.map(file => file.path).sort()).toEqual(['Cable Guide.md', 'Other/Guide.md']);
        const search = {
            app,
            baseFiles,
            getDB: () => ({ getFile: () => null }) as IndexedDBStorage,
            getFileTimestamps: () => ({ created: 0, modified: 0 }),
            omnisearchResult: null,
            searchableNames: new Map([['Other/Guide.md', buildSearchableNameData('Guide', { aliases: ['Manual'] })]]),
            settings: { alphabeticalDateMode: 'modified' as const },
            sortOption: 'alphabetical-asc' as const,
            trimmedQuery: 'Manual',
            useOmnisearch: false
        };
        expect(filterListPaneFiles(search).files).toEqual([files.get('Other/Guide.md')]);
        expect(
            filterListPaneFiles({
                ...search,
                trimmedQuery: 'Guide',
                useOmnisearch: true,
                omnisearchResult: { files: [files.get('Other/Guide.md')!, files.get('Other/Descendant Guide.md')!], meta: new Map() }
            }).files
        ).toEqual([files.get('Other/Guide.md')]);

        const hidden = { ...data, config: { ...config, sections: [{ ...section, hidden: ['Audio.md'] }, organizations] } };
        expect(getSelectedTopic(hidden, selection, false)).toBeNull();
        expect(getSelectedTopic(hidden, selection, true)?.leaves).toEqual(selected.leaves);
        expect(getSelectedTopic(data, { ...selection, sectionId: 'missing' }, true)).toBeNull();
    });
});

function mockVault(notes: TopicNote[]) {
    const files = new Map(notes.map(item => [item.path, new (TFile as unknown as new (path: string) => TFile)(item.path)]));
    const frontmatter = new Map(notes.map(item => [item.path, { ...item.properties }]));
    const storage = new Map<string, string>();
    const metadataEvents = new Map<string, (...args: any[]) => void>();
    const vaultEvents = new Map<string, (...args: any[]) => void>();
    const cleanup: Array<() => void> = [];
    const openFile = vi.fn(async () => {});
    const getLeaf = vi.fn(() => ({ openFile }));
    const plugin = {
        manifest: { id: 'notebook-navigator', dir: '.test/plugins/notebook-navigator' },
        registerEvent: vi.fn(),
        register: (callback: () => void) => cleanup.push(callback),
        app: {
            vault: {
                on: (event: string, listener: (...args: any[]) => void) => vaultEvents.set(event, listener),
                getMarkdownFiles: () => [...files.values()],
                getFileByPath: (path: string) => files.get(path),
                adapter: {
                    exists: async (path: string) => storage.has(path),
                    read: async (path: string) => storage.get(path),
                    write: async (path: string, contents: string) => {
                        storage.set(path, contents);
                    },
                    process: async (path: string, update: (current: string) => string) => {
                        const updated = update(storage.get(path)!);
                        storage.set(path, updated);
                        return updated;
                    }
                }
            },
            metadataCache: {
                on: (event: string, listener: (...args: any[]) => void) => metadataEvents.set(event, listener),
                getFileCache: (file: TFile) => ({ frontmatter: frontmatter.get(file.path) }),
                getFirstLinkpathDest: (link: string) => files.get(resolveFixtureLink(link))
            },
            workspace: { onLayoutReady: (callback: () => void) => callback(), getLeaf },
            fileManager: {
                processFrontMatter: async (file: TFile, apply: (properties: Record<string, unknown>) => void) =>
                    apply(frontmatter.get(file.path)!),
                generateMarkdownLink: (file: TFile) => wiki(file.basename)
            }
        }
    } as unknown as Plugin;
    const controller = getTopicsController(plugin);
    return {
        controller,
        files,
        frontmatter,
        storage,
        metadataEvents,
        vaultEvents,
        getLeaf,
        openFile,
        plugin,
        cleanup: () => cleanup.forEach(callback => callback())
    };
}

describe('topic drop and filter operands', () => {
    it('uses the native row highlight for every occurrence and clears it when the filter is removed', () => {
        const target = { sectionId: section.id, path: 'Audio.md' };
        const rows = buildTopicNavigationItems(
            { config: { ...defaultConfig, sections: [section] }, graphs: new Map([[section.id, graphFor(fixtures)]]), ready: true },
            new Set(['Music.md', 'Technology.md'].map(path => topicOccurrenceId({ sectionId: section.id, path, ancestors: [] }))),
            false,
            path => path,
            {}
        );
        const audio = rows.filter(row => row.topic?.kind === 'node' && row.topic.selection.path === target.path);
        expect(audio).toHaveLength(2);
        const other = rows.find(row => row.topic?.kind === 'node' && row.topic.selection.path === 'Music.md')!;
        function matches(query: string) {
            let result: unknown[];
            function Harness() {
                const highlights = useNavigationSearchHighlights({ searchNavFilters: buildSearchNavFilterState(query) });
                result = [...audio, other].map(row => getNavigationItemSearchMatch(row, highlights));
                return null;
            }
            renderToStaticMarkup(createElement(Harness));
            return result!;
        }
        const query = updateFilterQueryWithTopic('', target, 'AND');
        expect(matches(query)).toEqual(['include', 'include', undefined]);
        expect(matches('-' + query)).toEqual(['exclude', 'exclude', undefined]);
        expect(matches(updateFilterQueryWithTopic(query, target, 'AND'))).toEqual([undefined, undefined, undefined]);
    });

    it('appends to scalar and list relationship properties and preserves compatible metadata', () => {
        const single = { ...section, leafFilter: 'Typ=notatka' };
        expect(planTopicDrop(single, { powiązane: '[[Music]]' }, '[[Audio]]', () => false)).toEqual({
            status: 'linked',
            changes: { powiązane: ['[[Music]]', '[[Audio]]'], Typ: 'notatka' }
        });
        expect(planTopicDrop(single, { Typ: ['other'], Powiązane: ['[[Music]]'] }, '[[Audio]]', () => false)).toEqual({
            status: 'linked',
            changes: { Powiązane: ['[[Music]]', '[[Audio]]'], Typ: ['other', 'notatka'] }
        });
        expect(
            planTopicDrop(single, { Typ: 'notatka', Powiązane: '[Audio alias](Audio.md)' }, '[[Audio]]', path => path === 'Audio.md')
        ).toEqual({ status: 'already-linked' });
    });

    it('routes the macOS modifier and Shift through the shared tree handlers without selecting the topic', () => {
        const app = new App();
        const selection = { sectionId: section.id, path: 'Audio.md', ancestors: ['Music.md'] };
        const item = buildTopicNavigationItems(
            {
                config: { ...defaultConfig, sections: [section] },
                graphs: new Map([[section.id, graphFor(fixtures)]]),
                ready: true
            },
            new Set([topicOccurrenceId({ ...selection, path: 'Music.md', ancestors: [] })]),
            false,
            path => path,
            {}
        ).find(item => item.key === topicOccurrenceId(selection))!;
        const onSearch = vi.fn();
        const selectionDispatch = vi.fn();
        let handlers!: NavigationPaneTreeInteractionsResult;

        function Harness() {
            handlers = useNavigationPaneTreeInteractions({
                app,
                plugin: { app } as Plugin,
                topicOpenLocation: 'current-tab',
                commandQueue: null,
                settings: { ...DEFAULT_SETTINGS, multiSelectModifier: 'cmdCtrl' },
                uiState: { singlePane: false },
                expansionState: {
                    expandedFolders: new Set(),
                    expandedTags: new Set(),
                    expandedProperties: new Set(),
                    expandedVirtualFolders: new Set()
                },
                expansionDispatch: vi.fn(),
                selectionState: { selectionType: ItemType.FOLDER, selectedFolder: null, selectedTag: null, selectedProperty: null },
                selectionDispatch,
                uiDispatch: vi.fn(),
                propertyTreeService: null,
                tagTree: new Map(),
                propertyTree: new Map(),
                tagsVirtualFolderHasChildren: false,
                setShortcutsExpanded: vi.fn(),
                setRecentNotesExpanded: vi.fn(),
                clearActiveShortcut: vi.fn(),
                openFolderNoteInRightSidebar: vi.fn(),
                onModifySearchWithTag: vi.fn(),
                onModifySearchWithProperty: vi.fn(),
                onModifySearchWithTopic: onSearch
            });
            return null;
        }
        renderToStaticMarkup(createElement(Harness));
        const click = { metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, preventDefault: vi.fn(), stopPropagation: vi.fn() };
        handlers.handleTopicClick(item, click as unknown as React.MouseEvent);
        handlers.handleTopicNameClick(item, { ...click, shiftKey: true } as unknown as React.MouseEvent<HTMLSpanElement>);
        expect(onSearch.mock.calls).toEqual([
            [selection, 'AND'],
            [selection, 'OR']
        ]);
        expect(selectionDispatch).not.toHaveBeenCalled();
    });

    it('keeps exact section and path identity while toggling filters with native connectors', () => {
        const target = { sectionId: 'Section A', path: 'Upper/Łódź 100%.md' };
        const sameBasename = { sectionId: 'Section A', path: 'Lower/Łódź 100%.md' };
        const token = formatTopicFilter(target);
        expect(parseTopicFilter(token)).toEqual(target);
        const query = updateFilterQueryWithTopic('folder:Notes "My phrase"', target, 'AND');
        expect(query).toBe(`folder:Notes "My phrase" ${token}`);
        const expression = updateFilterQueryWithTopic(token, sameBasename, 'OR');
        expect(expression).toBe(`${token} OR ${formatTopicFilter(sameBasename)}`);
        expect(updateFilterQueryWithTopic(expression, target, 'AND')).toBe(formatTopicFilter(sameBasename));
    });
});

describe('Obsidian integration', () => {
    it('links eligible and newly classified drops, making both visible to running topic searches', async () => {
        const vault = mockVault([...fixtures, { path: 'Blank.md', properties: {} }, note('Conflict', 'unrelated')]);
        try {
            await vault.controller.updateConfig(() => ({ ...defaultConfig, sections: [section] }));
            const target = { sectionId: section.id, path: 'Audio.md' };
            const choose = vi.fn(async (_file, choices) => choices.find(choice => choice.value === 'notatka')!);
            const candidates = ['Alex.md', 'Blank.md', 'Conflict.md', 'Music.md'].map(path => vault.files.get(path)!);
            const before = vault.controller.getSnapshot();
            expect(await vault.controller.attachLeaves(target, candidates, choose)).toEqual(
                new Map([
                    ['linked', 2],
                    ['conflict', 1],
                    ['node', 1]
                ])
            );
            expect(choose).toHaveBeenCalledTimes(1);
            expect(vault.frontmatter.get('Alex.md')).toMatchObject({ Typ: 'osoba', Powiązane: ['[[Music]]', '[[Audio]]'] });
            expect(vault.frontmatter.get('Blank.md')).toEqual({ Typ: 'notatka', Powiązane: ['[[Audio]]'] });
            expect(vault.frontmatter.get('Conflict.md')).toMatchObject({ Typ: 'unrelated', Powiązane: [] });
            expect(await vault.controller.attachLeaves(target, candidates.slice(0, 2), choose)).toEqual(new Map([['already-linked', 2]]));
            const app = new App();
            const filter = (graphs: typeof before.graphs, query: string) =>
                filterListPaneFiles({
                    app,
                    baseFiles: candidates,
                    topicGraphs: graphs,
                    getDB: () => ({ getFile: () => null }) as IndexedDBStorage,
                    getFileTimestamps: () => ({ created: 0, modified: 0 }),
                    searchableNames: new Map(),
                    omnisearchResult: null,
                    settings: { alphabeticalDateMode: 'modified' },
                    sortOption: 'alphabetical-asc',
                    trimmedQuery: query,
                    useOmnisearch: false
                }).files.map(file => file.path);
            const query = updateFilterQueryWithTopic('', target, 'AND');
            const current = vault.controller.getSnapshot().graphs;
            expect(filter(before.graphs, query)).toEqual([]);
            expect(filter(current, query)).toEqual(['Alex.md', 'Blank.md']);
            const venue = { sectionId: section.id, path: 'Music.md' };
            expect(filter(current, updateFilterQueryWithTopic(query, venue, 'AND'))).toEqual(['Alex.md']);
            expect(filter(current, updateFilterQueryWithTopic(query, venue, 'OR'))).toEqual(['Alex.md', 'Blank.md']);
            expect(filter(current, updateFilterQueryWithTopic(query, target, 'AND'))).toEqual(candidates.map(file => file.path));
            expect(filter(current, `#missing OR ${query}`)).toEqual(['Alex.md', 'Blank.md']);
        } finally {
            vault.cleanup();
        }
    });

    it('saves settings separately and applies concurrent hide changes safely', async () => {
        const vault = mockVault(fixtures);
        try {
            const listener = vi.fn();
            const unsubscribe = vault.controller.subscribe(listener);
            expect(getTopicsController(vault.plugin)).toBe(vault.controller);
            await vault.controller.updateConfig(() => ({ ...defaultConfig, sections: [section, organizations] }));
            await Promise.all([
                vault.controller.setHidden(section.id, 'Audio.md', true),
                vault.controller.setHidden(section.id, 'Music.md', true)
            ]);
            const settingsFile = '.test/plugins/notebook-navigator/topics-settings.json';
            expect([...vault.storage.keys()]).toEqual([settingsFile]);
            expect(JSON.parse(vault.storage.get(settingsFile)!).sections[0].hidden).toEqual(['Audio.md', 'Music.md']);
            expect(JSON.parse(vault.storage.get(settingsFile)!).sections[1].hidden).toEqual([]);
            await vault.controller.setHidden(section.id, 'Audio.md', false);
            expect(listener).toHaveBeenCalled();
            unsubscribe();
            listener.mockClear();
            await vault.controller.setHidden(section.id, 'Music.md', false);
            expect(listener).not.toHaveBeenCalled();
        } finally {
            vault.cleanup();
        }
    });

    it('warns without writing, saves on confirmation, and repairs only the configured property', async () => {
        const vault = mockVault([
            { path: 'Music.md', properties: { Typ: 'koncept', powiązane: ['[[Unresolved]]'], titles: ['Original'] } },
            ...fixtures.filter(note => note.path !== 'Music.md')
        ]);
        try {
            await vault.controller.updateConfig(() => ({ ...defaultConfig, sections: [section] }));
            expect(await vault.controller.editParent(section.id, 'Music.md', 'Audio.md', 'add')).toBe('cycle');
            expect(vault.frontmatter.get('Music.md')?.powiązane).toEqual(['[[Unresolved]]']);
            expect(await vault.controller.editParent(section.id, 'Music.md', 'Audio.md', 'add', true)).toBe('saved');
            expect(vault.frontmatter.get('Music.md')).toEqual({
                Typ: 'koncept',
                powiązane: ['[[Unresolved]]', '[[Audio]]'],
                titles: ['Original']
            });
            expect(vault.controller.getSnapshot().graphs.get(section.id)?.cycles.flat()).toHaveLength(2);
            await vault.controller.editParent(section.id, 'Music.md', 'Audio.md', 'remove');
            expect(vault.frontmatter.get('Music.md')?.powiązane).toEqual(['[[Unresolved]]']);
            expect(vault.controller.getSnapshot().graphs.get(section.id)?.cycles).toEqual([]);
            await expect(vault.controller.editParent(section.id, 'Music.md', 'Alex.md', 'add')).rejects.toThrow('changed');
        } finally {
            vault.cleanup();
        }
    });

    it('detects a cycle from an external Properties edit and clears it after repair', async () => {
        vi.useFakeTimers();
        const vault = mockVault(fixtures);
        try {
            await vault.controller.updateConfig(() => ({ ...defaultConfig, sections: [section] }));
            const edited = { Typ: 'koncept', Powiązane: '[[Audio|Alias]]' };
            vault.frontmatter.set('Music.md', edited);
            vault.metadataEvents.get('changed')!(vault.files.get('Music.md'), '', { frontmatter: edited });
            await vi.advanceTimersByTimeAsync(50);
            expect(vault.controller.getSnapshot().graphs.get(section.id)?.cycles.flat()).toHaveLength(2);
            await vault.controller.editParent(section.id, 'Music.md', 'Audio.md', 'remove');
            expect(vault.frontmatter.get('Music.md')).toEqual({ Typ: 'koncept' });
            expect(vault.controller.getSnapshot().graphs.get(section.id)?.cycles).toEqual([]);
            const repaired = renderToStaticMarkup(createElement(TopicGraphPanel, { controller: vault.controller, sectionId: section.id }));
            expect(repaired).toContain('No cycles detected.');
            expect(repaired).not.toContain('Remove link');
        } finally {
            vault.cleanup();
            vi.useRealTimers();
        }
    });

    it('renders section configuration, existing warnings, and repair controls with affected links', async () => {
        const vault = mockVault([...fixtures, note('Loop', 'koncept', 'Loop')]);
        try {
            await vault.controller.updateConfig(() => ({ ...defaultConfig, sections: [section, organizations] }));
            const settings = renderToStaticMarkup(createElement(TopicsSettings, { controller: vault.controller, close: vi.fn() }));
            expect(settings).toContain('Show Topics folder');
            expect(settings).toContain('Current tab');
            expect(settings).toContain('New tab');
            expect(settings).toContain('Powiązane');
            expect(settings).toContain('Pracuje w');
            expect(settings).toContain('Topic links form a cycle. Open Topic Graph');
            expect(settings).toContain('Open Topic Graph');
            const repair = renderToStaticMarkup(createElement(TopicGraphPanel, { controller: vault.controller, sectionId: section.id }));
            expect(repair).toContain('<title>Loop.md</title>');
            expect(repair).toContain('Remove link Loop → Loop');
            expect(repair).toContain('aria-valuetext="0"');
            expect(repair).toContain('is-cyclic');
            expect(repair).toContain('marker-end=');
            expect(repair).not.toContain('Open Music.md');
            expect(repair).not.toContain('nn-topic-graph-editor');
            expect(repair).not.toContain('Venue.md');
            const healthy = renderToStaticMarkup(
                createElement(TopicGraphPanel, { controller: vault.controller, sectionId: organizations.id })
            );
            expect(healthy).toContain('No cycles detected.');
            expect(healthy).toContain('Show full section');
        } finally {
            vault.cleanup();
        }
    });

    it('opens a dedicated graph tab and reuses the one for the same section', async () => {
        const vault = mockVault(fixtures);
        const setViewState = vi.fn(async () => {});
        const revealLeaf = vi.fn(async () => {});
        const existing = { getViewState: () => ({ state: { sectionId: section.id } }) };
        const newLeaf = { setViewState, detach: vi.fn() };
        const getLeaf = vi.fn(() => newLeaf);
        Object.assign(vault.controller.app.workspace, {
            getLeavesOfType: vi.fn(() => [existing]),
            getLeaf,
            revealLeaf
        });
        try {
            await revealTopicGraph(vault.controller, section.id);
            expect(getLeaf).not.toHaveBeenCalled();
            expect(revealLeaf).toHaveBeenLastCalledWith(existing);

            await revealTopicGraph(vault.controller, organizations.id);
            expect(getLeaf).toHaveBeenCalledWith('tab');
            expect(setViewState).toHaveBeenCalledWith({
                type: TOPIC_GRAPH_VIEW,
                state: { sectionId: organizations.id },
                active: true
            });
            expect(revealLeaf).toHaveBeenLastCalledWith(newLeaf);
        } finally {
            vault.cleanup();
        }
    });

    it('saves and deduplicates a safe relationship, including a note with no relationship property', async () => {
        const vault = mockVault([...fixtures, { path: 'Other.md', properties: { Typ: 'koncept', keep: false } }]);
        try {
            await vault.controller.updateConfig(() => ({ ...defaultConfig, sections: [section] }));
            expect(await vault.controller.editParent(section.id, 'Other.md', 'Music.md', 'add')).toBe('saved');
            expect(await vault.controller.editParent(section.id, 'Other.md', 'Music.md', 'add')).toBe('saved');
            expect(vault.frontmatter.get('Other.md')).toEqual({ Typ: 'koncept', keep: false, Powiązane: ['[[Music]]'] });
            expect(vault.controller.getSnapshot().graphs.get(section.id)?.children.get('Music.md')).toContain('Other.md');
            await vault.controller.editParent(section.id, 'Other.md', 'Music.md', 'remove');
            expect(vault.frontmatter.get('Other.md')).toEqual({ Typ: 'koncept', keep: false, Powiązane: [] });
        } finally {
            vault.cleanup();
        }
    });

    it('opens the requested note in the current or a new tab', async () => {
        const vault = mockVault(fixtures);
        try {
            await vault.controller.open('Music.md', false);
            await vault.controller.open('Audio.md', true);
            await vault.controller.open('unresolved.md', false);
            expect(vault.getLeaf.mock.calls).toEqual([[false], ['tab']]);
            expect(vault.openFile.mock.calls).toEqual([
                [vault.files.get('Music.md'), { active: true }],
                [vault.files.get('Audio.md'), { active: true }]
            ]);
        } finally {
            vault.cleanup();
        }
    });
});

it('mounts bundled styles once per workspace document and removes them on window close and plugin unload', () => {
    function documentFixture() {
        const style = { dataset: {}, textContent: '', remove: vi.fn() };
        return { style, createElement: vi.fn(() => style), head: { appendChild: vi.fn() } };
    }
    const main = documentFixture();
    const popout = documentFixture();
    const extra = documentFixture();
    const callbacks = new Map<string, (_: unknown, window: unknown) => void>();
    const cleanup: Array<() => void> = [];
    const plugin = {
        app: {
            workspace: {
                iterateAllLeaves: (callback: (leaf: unknown) => void) => {
                    callback({ view: { containerEl: { ownerDocument: main } } });
                    callback({ view: { containerEl: { ownerDocument: popout } } });
                },
                on: (event: string, callback: (_: unknown, window: unknown) => void) => callbacks.set(event, callback)
            }
        },
        registerEvent: vi.fn(),
        register: (callback: () => void) => cleanup.push(callback)
    } as unknown as Plugin;
    vi.stubGlobal('document', main);
    try {
        registerTopicsStyles(plugin);
        expect(main.head.appendChild).toHaveBeenCalledTimes(1);
        expect(main.style.textContent).toContain('.nn-topics-settings-group');
        expect(main.style.textContent).toContain('.nn-topic-graph-content');
        expect(popout.head.appendChild).toHaveBeenCalledTimes(1);
        callbacks.get('window-open')!(null, { document: extra });
        expect(extra.head.appendChild).toHaveBeenCalledTimes(1);
        callbacks.get('window-close')!(null, { document: extra });
        expect(extra.style.remove).toHaveBeenCalledTimes(1);
        cleanup.forEach(callback => callback());
        expect(main.style.remove).toHaveBeenCalledTimes(1);
        expect(popout.style.remove).toHaveBeenCalledTimes(1);
        expect(extra.style.remove).toHaveBeenCalledTimes(1);
    } finally {
        vi.unstubAllGlobals();
    }
});

const devVault = process.env.TOPICS_DEV_VAULT;
it.skipIf(!devVault)('indexes the existing Polish development vault without modifying notes', () => {
    const notes: TopicNote[] = [];
    function visit(directory: string, prefix = '') {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            if (entry.name.startsWith('.')) continue;
            const file = join(directory, entry.name);
            const relativePath = `${prefix}${entry.name}`;
            if (entry.isDirectory()) visit(file, `${relativePath}/`);
            else if (entry.isFile() && entry.name.endsWith('.md')) {
                const data = readFileSync(file, 'utf8');
                const yaml = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(data);
                if (!yaml) continue;
                let properties: unknown;
                try {
                    properties = parse(yaml[1]);
                } catch {
                    continue;
                }
                if (properties && typeof properties === 'object' && !Array.isArray(properties))
                    notes.push({ path: relativePath, properties: properties as TopicNote['properties'] });
            }
        }
    }
    visit(devVault!);
    const byPath = new Set(notes.map(note => note.path));
    const byName = new Map(notes.map(note => [basename(note.path, '.md'), note.path]));
    const graph = buildGraph(notes, section, link => (byPath.has(path(link)) ? path(link) : byName.get(link)));
    expect(graph.nodes.size).toBeGreaterThan(10);
    expect(graph.roots.length).toBeGreaterThan(0);
    expect([...graph.children.values()].flat().length).toBeGreaterThan(0);
    expect([...graph.leaves.values()].flat().length).toBeGreaterThan(0);
    const { vertices, edges } = buildTopicGraphDisplay(graph);
    expect(vertices).toHaveLength(graph.nodes.size);
    expect(edges).toHaveLength([...graph.parents.values()].flat().length);
    expect(edges.every(edge => edge.route.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)))).toBe(true);
}, 60_000);
