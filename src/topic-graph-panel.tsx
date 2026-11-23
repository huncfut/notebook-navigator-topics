import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { reportTopicsError, type TopicsController } from './controller';
import type { TopicLink } from './graph';
import { TopicGraphCanvas } from './topic-graph-canvas';
import { buildTopicGraphDisplay, graphDepths, type GraphDepth } from './topic-graph-data';

type Save = (allowCycle: boolean) => Promise<'saved' | 'cycle'>;

export function TopicGraphPanel({ controller, sectionId }: { controller: TopicsController; sectionId: string }) {
    const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
    const section = snapshot.config.sections.find(item => item.id === sectionId);
    const graph = snapshot.graphs.get(sectionId);
    const display = useMemo(() => graph && buildTopicGraphDisplay(graph), [graph]);
    const [depth, setDepth] = useState<GraphDepth>(0);
    const [pending, setPending] = useState<Save | null>(null);
    const busyRef = useRef(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    if (!snapshot.ready) return <p role="status">Loading Topic Graph…</p>;
    if (!section || !graph || !display) return <p role="status">This topic section is unavailable.</p>;
    const hasCycles = graph.cycles.length > 0;

    async function save(operation: Save, allowCycle = false): Promise<boolean> {
        if (busyRef.current) return false;
        busyRef.current = true;
        setBusy(true);
        setError('');
        try {
            const result = await operation(allowCycle);
            setPending(result === 'cycle' ? () => operation : null);
            return result === 'saved';
        } catch (error) {
            setPending(null);
            setError(error instanceof Error ? error.message : 'The link could not be saved.');
            return false;
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    }

    function edit(link: TopicLink, operation: 'add' | 'remove') {
        return save(allowCycle => controller.editParent(sectionId, link.child, link.parent, operation, allowCycle));
    }

    return (
        <div className="nn-topic-graph" aria-busy={busy}>
            <header className="nn-topic-graph-toolbar">
                <div className="nn-topic-graph-heading">
                    <h2>{section.name}</h2>
                    <span role="status" className={hasCycles ? 'nn-topics-warning' : undefined}>
                        {hasCycles ? 'Cycles detected' : 'No cycles detected.'}
                    </span>
                </div>
                <div className="nn-topic-graph-depth">
                    <label>
                        <span>Depth</span>
                        <input
                            type="range"
                            min={0}
                            max={3}
                            step={1}
                            value={depth}
                            aria-valuetext={graphDepths[depth]}
                            onChange={event => setDepth(event.currentTarget.valueAsNumber as GraphDepth)}
                        />
                    </label>
                    <div className="nn-topic-graph-depth-stops" aria-hidden="true">
                        {graphDepths.map((label, index) => (
                            <span className={depth === index ? 'is-current' : undefined} key={label}>
                                {label}
                            </span>
                        ))}
                    </div>
                </div>
            </header>
            {error && (
                <p className="nn-topic-graph-message" role="alert">
                    {error}
                </p>
            )}
            {pending && (
                <div className="nn-topic-graph-message nn-topics-warning">
                    <p role="alert">This change would create a cycle.</p>
                    <div className="nn-topics-actions">
                        <button type="button" disabled={busy} onClick={() => void save(pending, true)}>
                            Save anyway
                        </button>
                        <button type="button" disabled={busy} onClick={() => setPending(null)}>
                            Cancel
                        </button>
                    </div>
                </div>
            )}
            <div className="nn-topic-graph-stage">
                <TopicGraphCanvas
                    display={display}
                    depth={depth}
                    busy={busy || pending !== null}
                    onConnect={(child, parent) => void edit({ child, parent }, 'add')}
                    title={path => controller.title(path)}
                    onOpen={path => void controller.open(path, true).catch(reportTopicsError)}
                    onRemove={edge => edit(edge, 'remove')}
                />
                {!hasCycles && depth !== 3 && (
                    <div className="nn-topic-graph-empty">
                        <button type="button" onClick={() => setDepth(3)}>
                            Show full section
                        </button>
                    </div>
                )}
                {depth === 3 && graph.nodes.size === 0 && <p className="nn-topic-graph-empty">No topic nodes in this section.</p>}
            </div>
        </div>
    );
}
