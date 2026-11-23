import type { TopicGraph, TopicLink } from './graph';

export const graphDepths = ['0', '1', '2', 'Full'] as const;
export type GraphDepth = 0 | 1 | 2 | 3;

interface Point {
    x: number;
    y: number;
}

export interface GraphBounds {
    width: number;
    height: number;
}

export interface GraphEdge extends TopicLink {
    id: string;
    cyclic: boolean;
    depth: GraphDepth;
    path: string;
    action: Point;
    route: readonly Point[];
}

interface GraphVertex {
    path: string;
    position: Point;
    depth: GraphDepth;
}

interface Block {
    paths: string[];
    cyclic: boolean;
    parents: Set<Block>;
    children: Set<Block>;
    column: number;
    row: number;
}

interface GridPosition {
    column: number;
    row: number;
}

interface Detour {
    side: 'above' | 'below';
    lane: number;
}

export const topicCard = { width: 160, height: 40, radius: 14 };
const halfWidth = topicCard.width / 2;
const halfHeight = topicCard.height / 2;
const columnGap = 256;
const boundsPadding = 52;
const laneGap = 24;

const edgeId = ({ child, parent }: TopicLink) => JSON.stringify([child, parent]);
const compareBlocks = (a: Block, b: Block) => (a.paths[0] < b.paths[0] ? -1 : a.paths[0] > b.paths[0] ? 1 : 0);

function orderCycle(paths: string[], graph: TopicGraph): string[] {
    const members = new Set(paths);
    const ordered = new Set<string>();
    const pending = [paths[0]];
    while (pending.length) {
        const path = pending.pop()!;
        if (ordered.has(path)) continue;
        ordered.add(path);
        const parents = graph.parents.get(path) ?? [];
        pending.push(
            ...parents
                .filter(parent => members.has(parent) && !ordered.has(parent))
                .sort()
                .reverse()
        );
    }
    return [...ordered];
}

interface LayerLink {
    from: Block;
    to: Block;
    start: number;
    end: number;
}

function countCrossings(links: readonly LayerLink[]): number {
    const strips = new Map<number, { left: number; right: number }[]>();
    for (const { from, to, start, end } of links) {
        const slope = (to.row - from.row) / (end - start);
        for (let column = start; column < end; column++) {
            const strip = strips.get(column) ?? [];
            strip.push({
                left: from.row + slope * (column - start),
                right: column + 1 === end ? to.row : from.row + slope * (column + 1 - start)
            });
            strips.set(column, strip);
        }
    }

    let crossings = 0;
    for (const strip of strips.values()) {
        if (strip.length < 2) continue;
        // Count inversions in right-hand order. Sorting ties prevents shared endpoints from counting as crossings.
        strip.sort((a, b) => a.left - b.left || a.right - b.right);
        const order = [...new Set(strip.map(segment => segment.right))].sort((a, b) => a - b);
        const ranks = new Map(order.map((row, rank) => [row, rank + 1]));
        const counts = new Uint32Array(order.length + 1);
        strip.forEach(({ right }, index) => {
            const rank = ranks.get(right)!;
            let seen = 0;
            for (let i = rank; i > 0; i -= i & -i) seen += counts[i];
            crossings += index - seen;
            for (let i = rank; i < counts.length; i += i & -i) counts[i]++;
        });
    }
    return crossings;
}

function minimizeCrossings(component: Block[], parentsByPath: ReadonlyMap<string, string[]>, byPath: ReadonlyMap<string, Block>) {
    const groups = new Map<string, Block[]>();
    for (const block of component) {
        // Blocks with the same span can exchange rows without moving individual cycle nodes or colliding with other spans.
        const key = `${block.column}:${block.paths.length}`;
        const group = groups.get(key) ?? [];
        group.push(block);
        groups.set(key, group);
    }
    const forward = [...groups.values()].filter(group => group.length > 1).sort((a, b) => a[0].column - b[0].column);
    if (!forward.length) return;

    const links: LayerLink[] = [];
    const incoming = new Map<Block, Block[]>();
    const outgoing = new Map<Block, Block[]>();
    let span = 0;
    for (const from of component) {
        for (const [offset, path] of from.paths.entries()) {
            for (const parent of parentsByPath.get(path) ?? []) {
                const to = byPath.get(parent)!;
                if (from === to) continue;
                const start = from.column + offset;
                const end = to.column + to.paths.indexOf(parent);
                span += end - start;
                // Bound the number of projected segments for unusually dense sections.
                if (span > 20_000) return;
                links.push({ from, to, start, end });
                const children = incoming.get(to) ?? [];
                const parents = outgoing.get(from) ?? [];
                children.push(from);
                parents.push(to);
                incoming.set(to, children);
                outgoing.set(from, parents);
            }
        }
    }

    let best = countCrossings(links);
    if (best === 0) return;
    let bestRows = component.map(block => block.row);
    const reverse = [...forward].reverse();
    for (const [sweep, neighbors] of [
        [forward, incoming],
        [reverse, outgoing],
        [forward, incoming],
        [reverse, outgoing]
    ] as const) {
        for (const group of sweep) {
            const slots = group.map(block => block.row).sort((a, b) => a - b);
            const ordered = group
                .map(block => {
                    const rows =
                        neighbors
                            .get(block)
                            ?.map(peer => peer.row)
                            .sort((a, b) => a - b) ?? [];
                    const middle = Math.floor(rows.length / 2);
                    const median = rows.length ? (rows[middle] + rows[Math.floor((rows.length - 1) / 2)]) / 2 : block.row;
                    return { block, median };
                })
                .sort((a, b) => a.median - b.median || a.block.row - b.block.row);
            ordered.forEach(({ block }, index) => {
                block.row = slots[index];
            });
        }
        const score = countCrossings(links);
        if (score < best) {
            best = score;
            bestRows = component.map(block => block.row);
            if (best === 0) return;
        }
    }

    component.forEach((block, index) => {
        block.row = bestRows[index];
    });
    // Try adjacent swaps on smaller layouts, retaining each swap only if the score improves.
    let attempts = 0;
    for (const group of forward) {
        const ordered = [...group].sort((a, b) => a.row - b.row);
        for (let index = 1; index < ordered.length; index++) {
            if (best === 0 || ++attempts * span > 100_000) return;
            const left = ordered[index - 1];
            const right = ordered[index];
            [left.row, right.row] = [right.row, left.row];
            const score = countCrossings(links);
            if (score < best) {
                best = score;
                [ordered[index - 1], ordered[index]] = [right, left];
            } else [left.row, right.row] = [right.row, left.row];
        }
    }
}

function layoutBlocks(graph: TopicGraph, links: TopicLink[], reduceCrossings: boolean): Map<string, GridPosition> {
    const byPath = new Map<string, Block>();
    function addBlock(paths: string[], cyclic: boolean) {
        const block: Block = { paths, cyclic, parents: new Set(), children: new Set(), column: 0, row: 0 };
        for (const path of paths) byPath.set(path, block);
    }

    for (const cycle of graph.cycles) {
        const paths = [...new Set(cycle.map(link => link.child))].sort();
        addBlock(orderCycle(paths, graph), true);
    }
    for (const path of [...graph.nodes].sort()) {
        if (!byPath.has(path)) addBlock([path], false);
    }
    for (const { child, parent } of links) {
        const from = byPath.get(child)!;
        const to = byPath.get(parent)!;
        if (from === to) continue;
        from.parents.add(to);
        to.children.add(from);
    }

    const visited = new Set<Block>();
    const components: Block[][] = [];
    for (const block of byPath.values()) {
        if (visited.has(block)) continue;
        const component = [block];
        visited.add(block);
        for (const member of component) {
            for (const neighbor of [...member.children, ...member.parents]) {
                if (visited.has(neighbor)) continue;
                visited.add(neighbor);
                component.push(neighbor);
            }
        }
        components.push(component.sort(compareBlocks));
    }
    // Cycle components precede unrelated components, keeping the initial focus compact.
    components.sort((a, b) => Number(b.some(block => block.cyclic)) - Number(a.some(block => block.cyclic)) || compareBlocks(a[0], b[0]));

    const grid = new Map<string, GridPosition>();
    let firstRow = 0;
    for (const component of components) {
        const indegrees = new Map(component.map(block => [block, block.children.size]));
        const ready = component.filter(block => block.children.size === 0);
        const nextRow = new Map<number, number>();
        let lastRow = firstRow;
        for (const block of ready) {
            const endColumn = block.column + block.paths.length;
            const children = [...block.children];
            const preferred = children.length
                ? Math.round(children.reduce((sum, child) => sum + child.row, 0) / children.length)
                : firstRow;
            block.row = preferred;
            for (let column = block.column; column < endColumn; column++) {
                block.row = Math.max(block.row, nextRow.get(column) ?? firstRow);
            }
            for (let column = block.column; column < endColumn; column++) nextRow.set(column, block.row + 1);
            lastRow = Math.max(lastRow, block.row);
            for (const parent of block.parents) {
                // A cycle block spans one column per member. External links clear the entire block.
                parent.column = Math.max(parent.column, endColumn);
                const remaining = indegrees.get(parent)! - 1;
                indegrees.set(parent, remaining);
                if (remaining === 0) ready.push(parent);
            }
        }
        if (reduceCrossings) minimizeCrossings(component, graph.parents, byPath);
        for (const block of ready) {
            block.paths.forEach((path, index) => {
                grid.set(path, { column: block.column + index, row: block.row });
            });
        }
        firstRow = lastRow + 2;
    }
    return grid;
}

function routePositions(grid: ReadonlyMap<string, GridPosition>, links: TopicLink[]) {
    const detours = new Map<string, Detour>();
    const rows = new Map<number, { above: number[]; below: number[] }>();
    const loopRows = new Set<number>();
    const spans = links
        .flatMap(link => {
            const source = grid.get(link.child)!;
            const target = grid.get(link.parent)!;
            const distance = target.column - source.column;
            if (distance === 0) loopRows.add(source.row);
            if (distance === 0 || distance === 1) return [];
            return [
                {
                    id: edgeId(link),
                    row: source.row,
                    side: distance < 0 ? ('below' as const) : ('above' as const),
                    start: Math.min(source.column, target.column),
                    end: Math.max(source.column, target.column)
                }
            ];
        })
        .sort((first, second) => first.start - second.start || first.end - second.end);
    for (const { id, row, side, start, end } of spans) {
        const rowLanes = rows.get(row) ?? { above: [], below: [] };
        const lanes = rowLanes[side];
        const free = lanes.findIndex(lastEnd => lastEnd < start);
        const lane = free === -1 ? lanes.length : free;
        lanes[lane] = end;
        rows.set(row, rowLanes);
        detours.set(id, { side, lane });
    }

    const rowCenters = new Map<number, number>();
    let nextTop = 0;
    let previousRow = -1;
    for (const row of [...new Set([...grid.values()].map(position => position.row))].sort((a, b) => a - b)) {
        const lanes = rows.get(row);
        const aboveLanes = lanes?.above.length ?? 0;
        const above = halfHeight + (aboveLanes || loopRows.has(row) ? 46 + aboveLanes * laneGap : 0);
        const below = halfHeight + (lanes?.below.length ?? 0) * laneGap;
        const center = nextTop + above + (row - previousRow - 1) * 44;
        rowCenters.set(row, center);
        nextTop = center + below + 16;
        previousRow = row;
    }
    // Ranking follows the stored child-to-parent links. The visible graph reads from parents to children.
    const positions = new Map([...grid].map(([path, { column, row }]) => [path, { x: -column * columnGap, y: rowCenters.get(row)! }]));
    return { positions, detours };
}

function toward(point: Point, neighbor: Point, distance: number): Point {
    const dx = neighbor.x - point.x;
    const dy = neighbor.y - point.y;
    const fraction = Math.min(0.5, distance / Math.hypot(dx, dy));
    return { x: point.x + fraction * dx, y: point.y + fraction * dy };
}

function roundedPath(points: readonly Point[]): string {
    const [first, ...rest] = points;
    const last = rest.pop()!;
    const corners = rest.map((point, index) => {
        const before = toward(point, points[index], 12);
        const after = toward(point, points[index + 2], 12);
        return `L ${before.x} ${before.y} Q ${point.x} ${point.y} ${after.x} ${after.y}`;
    });
    return `M ${first.x} ${first.y} ${corners.join(' ')} L ${last.x} ${last.y}`;
}

function edgeGeometry(source: Point, target: Point, detour?: Detour): Pick<GraphEdge, 'path' | 'action' | 'route'> {
    if (source === target) {
        const { x, y } = source;
        const top = y - halfHeight;
        const route = [
            { x: x - 26, y: top },
            { x: x - 56, y: top - 44 },
            { x: x + 56, y: top - 44 },
            { x: x + 26, y: top - 3 }
        ];
        return cubicEdge(route);
    }

    const direction = Math.sign(target.x - source.x);
    const portOffset = detour ? -8 * direction : 0;
    const start = { x: source.x + halfWidth * direction, y: source.y + portOffset };
    const end = { x: target.x - (halfWidth + 4) * direction, y: target.y + portOffset };
    const midpoint = (start.x + end.x) / 2;
    if (!detour) {
        const route = [start, { x: midpoint, y: start.y }, { x: midpoint, y: end.y }, end];
        return cubicEdge(route);
    }

    const startGutter = start.x + 22 * direction;
    const endGutter = end.x - 22 * direction;
    // Detour space is reserved around the child row.
    const laneY =
        detour.side === 'above' ? target.y - halfHeight - 56 - laneGap * detour.lane : target.y + halfHeight + 20 + laneGap * detour.lane;
    const route = [
        start,
        { x: startGutter, y: start.y },
        { x: startGutter, y: laneY },
        { x: endGutter, y: laneY },
        { x: endGutter, y: end.y },
        end
    ];
    return { path: roundedPath(route), action: { x: (startGutter + endGutter) / 2, y: laneY }, route };
}

function cubicEdge(route: readonly Point[]): Pick<GraphEdge, 'path' | 'action' | 'route'> {
    const [start, first, second, end] = route;
    return {
        path: `M ${start.x} ${start.y} C ${first.x} ${first.y} ${second.x} ${second.y} ${end.x} ${end.y}`,
        action: {
            x: (start.x + 3 * first.x + 3 * second.x + end.x) / 8,
            y: (start.y + 3 * first.y + 3 * second.y + end.y) / 8
        },
        route
    };
}

export function buildTopicGraphDisplay(graph: TopicGraph, reduceCrossings = true): { vertices: GraphVertex[]; edges: GraphEdge[] } {
    const cycleEdges = graph.cycles.flat();
    const cycleLinks = new Set(cycleEdges.map(edgeId));
    const depths = new Map<string, GraphDepth>(cycleEdges.map(({ child }) => [child, 0]));
    const links: TopicLink[] = [];
    const incoming = new Map<string, string[]>();
    // parents holds the stored links, including the edges suppressed in the navigation tree.
    for (const child of [...graph.parents.keys()].sort()) {
        for (const parent of [...graph.parents.get(child)!].sort()) {
            links.push({ child, parent });
            const children = incoming.get(parent) ?? [];
            children.push(child);
            incoming.set(parent, children);
        }
    }

    let frontier = [...depths.keys()];
    for (const depth of [1, 2] as const) {
        const neighbors: string[] = [];
        for (const path of frontier) {
            for (const neighbor of [...(graph.parents.get(path) ?? []), ...(incoming.get(path) ?? [])]) {
                if (depths.has(neighbor)) continue;
                depths.set(neighbor, depth);
                neighbors.push(neighbor);
            }
        }
        frontier = neighbors;
    }

    const { positions, detours } = routePositions(layoutBlocks(graph, links, reduceCrossings), links);
    const vertices = [...positions].map(([path, position]): GraphVertex => ({ path, position, depth: depths.get(path) ?? 3 }));
    const edges = links.map((link): GraphEdge => {
        const id = edgeId(link);
        const cyclic = cycleLinks.has(id);
        const nearest = Math.min(depths.get(link.child) ?? 3, depths.get(link.parent) ?? 3);
        const depth = cyclic ? 0 : nearest === 0 ? 1 : nearest === 1 ? 2 : 3;
        return {
            ...link,
            id,
            cyclic,
            depth,
            ...edgeGeometry(positions.get(link.parent)!, positions.get(link.child)!, detours.get(id))
        };
    });
    return { vertices, edges };
}

export function getGraphBounds(vertices: readonly GraphVertex[], edges: readonly GraphEdge[]): GraphBounds & Point {
    if (!vertices.length) return { x: 0, y: 0, width: 2 * boundsPadding, height: 2 * boundsPadding };
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    function include(x: number, y: number) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
    }
    for (const {
        position: { x, y }
    } of vertices) {
        include(x - halfWidth, y - halfHeight);
        include(x + halfWidth, y + halfHeight);
    }
    for (const { route } of edges) {
        for (const { x, y } of route) include(x, y);
    }
    return {
        x: (left + right) / 2,
        y: (top + bottom) / 2,
        width: right - left + 2 * boundsPadding,
        height: bottom - top + 2 * boundsPadding
    };
}
