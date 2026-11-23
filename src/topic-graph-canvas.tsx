import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { ObsidianIcon } from '../components/ObsidianIcon';
import {
    getGraphBounds,
    topicCard,
    type TopicGraphDisplay,
    type GraphBounds,
    type TopicGraphViewMode,
    type GraphEdge
} from './topic-graph-data';

const panDirections = new Map<string, [number, number]>([
    ['ArrowUp', [0, 36]],
    ['ArrowDown', [0, -36]],
    ['ArrowLeft', [36, 0]],
    ['ArrowRight', [-36, 0]]
]);

interface Camera {
    x: number;
    y: number;
    scale: number;
}

interface GraphCanvasProps {
    display: TopicGraphDisplay;
    view: TopicGraphViewMode;
    busy: boolean;
    title: (path: string) => string;
    onFocus: (path: string) => void;
    onOpen: (path: string) => void;
    onConnect: (child: string, parent: string) => void;
    onRemove: (edge: GraphEdge) => Promise<boolean>;
}

function fit(viewport: GraphBounds, bounds: ReturnType<typeof getGraphBounds>): Camera {
    const scale = Math.min(viewport.width / bounds.width, viewport.height / bounds.height, 1);
    return { x: -bounds.x * scale, y: -bounds.y * scale, scale };
}

function activate(event: KeyboardEvent<SVGElement>, action: () => void): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    action();
}

interface PointerStart {
    id: number;
    x: number;
    y: number;
    node: string | undefined;
    moved: boolean;
}

export function graphNodeGesture(child: string, target: string | undefined, moved: boolean, shift: boolean) {
    if (moved) return target && target !== child ? { action: 'connect' as const, child, parent: target } : undefined;
    return target === child ? { action: shift ? ('open' as const) : ('focus' as const), child } : undefined;
}

export function TopicGraphCanvas({ display, view, busy, title, onFocus, onOpen, onConnect, onRemove }: GraphCanvasProps) {
    const svg = useRef<SVGSVGElement>(null);
    const drag = useRef<PointerStart | null>(null);
    const [connection, setConnection] = useState<{ child: string; target: string | undefined } | null>(null);
    const id = useId();
    const [viewport, setViewport] = useState({ width: 800, height: 600 });
    const [position, setPosition] = useState<{ view: TopicGraphViewMode; camera: Camera } | null>(null);
    const [selected, setSelected] = useState<string | null>(null);
    const { vertices, edges, center } = display;
    const bounds = getGraphBounds(vertices, edges);
    const focusBounds = center
        ? {
              ...center,
              width: bounds.width + 2 * Math.abs(bounds.x - center.x),
              height: bounds.height + 2 * Math.abs(bounds.y - center.y)
          }
        : bounds;
    const fitted = fit(viewport, focusBounds);
    const camera = position?.view === view ? position.camera : fitted;
    const currentCamera = (current: typeof position) => (current?.view === view ? current.camera : fitted);
    const minScale = Math.min(0.08, fitted.scale);

    useEffect(() => {
        const element = svg.current;
        const WindowResizeObserver = element?.ownerDocument.defaultView?.ResizeObserver;
        if (!element || !WindowResizeObserver) return;
        const observer = new WindowResizeObserver(([{ contentRect }]) => {
            if (contentRect.width && contentRect.height) {
                setViewport({ width: contentRect.width, height: contentRect.height });
            }
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        const element = svg.current;
        if (!element) return;
        const wheel = (event: WheelEvent) => {
            event.preventDefault();
            const rect = element.getBoundingClientRect();
            const x = event.clientX - rect.left - rect.width / 2;
            const y = event.clientY - rect.top - rect.height / 2;
            const factor = Math.exp(-Math.sign(event.deltaY) * Math.min(Math.abs(event.deltaY) * 0.004, 0.3));
            setPosition(current => ({ view, camera: zoomCamera(currentCamera(current), factor, minScale, x, y) }));
        };
        element.addEventListener('wheel', wheel, { passive: false });
        return () => element.removeEventListener('wheel', wheel);
    }, [view, fitted.x, fitted.y, fitted.scale, minScale]);

    function zoom(factor: number) {
        setPosition(current => ({ view, camera: zoomCamera(currentCamera(current), factor, minScale) }));
    }

    function pan(x: number, y: number) {
        setPosition(current => {
            const previous = currentCamera(current);
            return { view, camera: { ...previous, x: previous.x + x, y: previous.y + y } };
        });
    }

    async function remove(edge: GraphEdge) {
        svg.current?.focus({ preventScroll: true });
        if (await onRemove(edge)) setSelected(null);
    }

    function nodeAt(element: Element | null, canvas: SVGSVGElement): string | undefined {
        const node = element?.closest('[data-topic-node]');
        return node && canvas.contains(node) ? (node.getAttribute('data-topic-node') ?? undefined) : undefined;
    }

    function pointerMoved(pointer: PointerStart, event: PointerEvent<SVGSVGElement>): boolean {
        return pointer.moved || Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) >= 6;
    }

    function clearPointer() {
        const pointer = drag.current;
        drag.current = null;
        setConnection(null);
        if (pointer && svg.current?.hasPointerCapture(pointer.id)) svg.current.releasePointerCapture(pointer.id);
    }

    function pointerDown(event: PointerEvent<SVGSVGElement>) {
        if (drag.current || event.button !== 0) return;
        const canvas = event.currentTarget;
        const target = event.target as Element;
        const node = nodeAt(target, canvas);
        if (!node && target !== canvas) return;
        setSelected(null);
        if (node) target.closest<SVGGElement>('[data-topic-node]')?.focus({ preventScroll: true });
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, node, moved: false };
        canvas.setPointerCapture(event.pointerId);
    }

    function pointerMove(event: PointerEvent<SVGSVGElement>) {
        const pointer = drag.current;
        if (!pointer || pointer.id !== event.pointerId) return;
        const canvas = event.currentTarget;
        if (!pointer.node) {
            pan(event.clientX - pointer.x, event.clientY - pointer.y);
            pointer.x = event.clientX;
            pointer.y = event.clientY;
        } else if (!busy && pointerMoved(pointer, event)) {
            pointer.moved = true;
            const target = nodeAt(canvas.ownerDocument.elementFromPoint(event.clientX, event.clientY), canvas);
            const next = target === pointer.node ? undefined : target;
            setConnection(current =>
                current?.child === pointer.node && current?.target === next ? current : { child: pointer.node!, target: next }
            );
        }
    }

    function pointerUp(event: PointerEvent<SVGSVGElement>) {
        const pointer = drag.current;
        if (!pointer || pointer.id !== event.pointerId) return;
        clearPointer();
        if (!pointer.node) return;
        const canvas = event.currentTarget;
        const target = nodeAt(canvas.ownerDocument.elementFromPoint(event.clientX, event.clientY), canvas);
        const gesture = graphNodeGesture(pointer.node, target, pointerMoved(pointer, event), event.shiftKey);
        if (gesture?.action === 'connect' && !busy) onConnect(gesture.child, gesture.parent);
        if (gesture?.action === 'open') onOpen(gesture.child);
        if (gesture?.action === 'focus') onFocus(gesture.child);
    }

    function onKeyDown(event: KeyboardEvent<SVGSVGElement>) {
        if (event.key === 'Escape') {
            clearPointer();
            setSelected(null);
        }
        if (event.target !== event.currentTarget) return;
        const direction = panDirections.get(event.key);
        if (direction) pan(...direction);
        else if (event.key === '+' || event.key === '=') zoom(1.25);
        else if (event.key === '-') zoom(0.8);
        else return;
        event.preventDefault();
    }

    return (
        <div className="nn-topic-graph-canvas">
            <svg
                ref={svg}
                role="group"
                aria-label="Directed topic graph"
                tabIndex={0}
                onKeyDown={onKeyDown}
                onPointerDown={pointerDown}
                onPointerMove={pointerMove}
                onPointerUp={pointerUp}
                onPointerCancel={event => {
                    if (drag.current?.id === event.pointerId) clearPointer();
                }}
                onLostPointerCapture={event => {
                    if (drag.current?.id === event.pointerId) clearPointer();
                }}
            >
                <defs>
                    {[false, true].map(cyclic => (
                        <marker
                            key={String(cyclic)}
                            id={`${id}-arrow-${cyclic}`}
                            className={cyclic ? 'is-cyclic' : undefined}
                            viewBox="0 0 10 10"
                            refX="9"
                            refY="5"
                            markerWidth="7"
                            markerHeight="7"
                            orient="auto"
                        >
                            <path d="M 2 1.5 L 8.5 5 L 2 8.5" />
                        </marker>
                    ))}
                </defs>
                <g transform={`translate(${viewport.width / 2 + camera.x} ${viewport.height / 2 + camera.y}) scale(${camera.scale})`}>
                    {edges.map(edge => {
                        const label = `${title(edge.parent)} → ${title(edge.child)}`;
                        const isSelected = selected === edge.id;
                        const choose = () => setSelected(current => (current === edge.id ? null : edge.id));
                        return (
                            <g
                                key={edge.id}
                                className={`nn-topic-graph-edge${edge.cyclic ? ' is-cyclic' : ''}${isSelected ? ' is-selected' : ''}`}
                            >
                                <path className="nn-topic-graph-edge-line" d={edge.path} markerEnd={`url(#${id}-arrow-${edge.cyclic})`} />
                                <path
                                    className="nn-topic-graph-edge-target"
                                    d={edge.path}
                                    role="button"
                                    aria-label={`Select link ${label}`}
                                    aria-pressed={isSelected}
                                    tabIndex={0}
                                    onClick={choose}
                                    onKeyDown={event => activate(event, choose)}
                                >
                                    <title>{`${edge.parent} → ${edge.child}`}</title>
                                </path>
                                <g transform={`translate(${edge.action.x} ${edge.action.y}) scale(${1 / camera.scale})`}>
                                    <foreignObject x={-18} y={-18} width={36} height={36} className="nn-topic-graph-edge-action">
                                        <button
                                            type="button"
                                            className="clickable-icon"
                                            aria-label={`Remove link ${label}`}
                                            title={`Remove link ${label}`}
                                            disabled={busy}
                                            onClick={() => void remove(edge)}
                                        >
                                            <ObsidianIcon name="trash-2" aria-hidden />
                                        </button>
                                    </foreignObject>
                                </g>
                            </g>
                        );
                    })}
                    {vertices.map(vertex => {
                        const label = title(vertex.path);
                        const className = ['nn-topic-graph-node'];
                        if (vertex.cyclic) className.push('is-cyclic');
                        if (vertex.path === connection?.child) className.push('is-drag-source');
                        if (vertex.path === connection?.target) className.push('is-drop-target');
                        return (
                            <g
                                key={vertex.path}
                                className={className.join(' ')}
                                data-topic-node={vertex.path}
                                transform={`translate(${vertex.position.x} ${vertex.position.y})`}
                                role="button"
                                tabIndex={0}
                                aria-label={`Focus ${vertex.path}`}
                                aria-keyshortcuts="Enter Shift+Enter"
                                onClick={event => {
                                    if (event.detail === 0) (event.shiftKey ? onOpen : onFocus)(vertex.path);
                                }}
                                onKeyDown={event => activate(event, () => (event.shiftKey ? onOpen : onFocus)(vertex.path))}
                            >
                                <title>{vertex.path}</title>
                                <rect
                                    x={-topicCard.width / 2}
                                    y={-topicCard.height / 2}
                                    width={topicCard.width}
                                    height={topicCard.height}
                                    rx={topicCard.radius}
                                />
                                <foreignObject
                                    x={-topicCard.width / 2}
                                    y={-topicCard.height / 2}
                                    width={topicCard.width}
                                    height={topicCard.height}
                                    className="nn-topic-graph-node-label"
                                    aria-hidden="true"
                                >
                                    <div>{label}</div>
                                </foreignObject>
                            </g>
                        );
                    })}
                </g>
            </svg>
            {vertices.length > 0 && (
                <div className="nn-topic-graph-zoom" role="group" aria-label="Graph zoom">
                    <button type="button" className="clickable-icon" aria-label="Zoom out" title="Zoom out" onClick={() => zoom(0.8)}>
                        <ObsidianIcon name="minus" aria-hidden />
                    </button>
                    <button type="button" className="clickable-icon" aria-label="Zoom in" title="Zoom in" onClick={() => zoom(1.25)}>
                        <ObsidianIcon name="plus" aria-hidden />
                    </button>
                    <button
                        type="button"
                        className="clickable-icon"
                        aria-label="Fit graph"
                        title="Fit graph"
                        onClick={() => setPosition({ view, camera: fitted })}
                    >
                        <ObsidianIcon name="maximize" aria-hidden />
                    </button>
                </div>
            )}
        </div>
    );
}

function zoomCamera(camera: Camera, factor: number, minScale: number, x = 0, y = 0): Camera {
    const scale = Math.max(minScale, Math.min(3, camera.scale * factor));
    const ratio = scale / camera.scale;
    return { scale, x: x - (x - camera.x) * ratio, y: y - (y - camera.y) * ratio };
}
