import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ObsidianIcon } from '../components/ObsidianIcon';
import { reportTopicsError, type TopicsController } from './controller';
import { TopicGraphCanvas } from './topic-graph-canvas';
import { buildTopicGraphDisplay, fullTopicGraphView, getTopicGraphView, type TopicGraphViewMode } from './topic-graph-data';

type Save = (allowCycle: boolean) => Promise<'saved' | 'cycle'>;

interface TopicGraphPanelProps {
    controller: TopicsController;
    sectionId: string;
    onSectionChange: (sectionId: string) => void;
}

export function TopicGraphPanel({ controller, sectionId, onSectionChange }: TopicGraphPanelProps) {
    const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
    const { sections } = snapshot.config;
    const section = sections.find(item => item.id === sectionId);
    const graph = snapshot.graphs.get(sectionId);
    const display = useMemo(() => graph && buildTopicGraphDisplay(graph), [graph]);
    const [previousSectionId, setPreviousSectionId] = useState(sectionId);
    const [requestedView, setView] = useState<TopicGraphViewMode>(fullTopicGraphView);
    const hasCycles = (graph?.cycles.length ?? 0) > 0;
    const view =
        (requestedView.kind === 'node' && !graph?.nodes.has(requestedView.path)) || (requestedView.kind === 'cycle' && !hasCycles)
            ? fullTopicGraphView
            : requestedView;
    const visibleDisplay = useMemo(() => display && getTopicGraphView(display, view), [display, view]);
    const [pending, setPending] = useState<Save | null>(null);
    const busyRef = useRef(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    if (previousSectionId !== sectionId) {
        setPreviousSectionId(sectionId);
        setView(fullTopicGraphView);
        setPending(null);
        setError('');
    } else if (graph && view !== requestedView) {
        setView(view);
    }

    if (!snapshot.ready) return <p role="status">Loading Topic Graph…</p>;
    if (sections.length === 0) return <p role="status">No topic sections are configured.</p>;

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

    function toggleParent(child: string, parent: string) {
        // A confirmed add should preserve a link that appeared while the warning was open.
        void save(allowCycle => controller.editParent(sectionId, child, parent, allowCycle ? 'add' : 'toggle', allowCycle));
    }

    return (
        <div className="nn-topic-graph" aria-busy={busy}>
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
                <div className="nn-topic-graph-overlay">
                    <div className="nn-topic-graph-heading">
                        <div className="nn-topic-graph-section-picker">
                            <select
                                className="dropdown nn-topic-graph-section-select"
                                aria-label="Topic section"
                                value={section?.id ?? ''}
                                disabled={busy || pending !== null}
                                onChange={event => onSectionChange(event.currentTarget.value)}
                            >
                                {!section && (
                                    <option value="" disabled>
                                        Choose a topic section
                                    </option>
                                )}
                                {sections.map(item => (
                                    <option key={item.id} value={item.id}>
                                        {item.name}
                                    </option>
                                ))}
                            </select>
                            <ObsidianIcon name="chevron-down" className="nn-topic-graph-section-chevron" aria-hidden />
                        </div>
                        {graph && (
                            <span role="status" className={hasCycles ? 'nn-topics-warning' : undefined}>
                                {hasCycles ? 'Cycles detected' : 'No cycles detected.'}
                            </span>
                        )}
                    </div>
                    <div className="nn-topic-graph-views" role="group" aria-label="Graph view">
                        <button
                            type="button"
                            className="clickable-icon"
                            aria-label="Full graph"
                            title="Full graph"
                            disabled={!graph}
                            aria-pressed={!!graph && view.kind === 'full'}
                            onClick={() => setView(fullTopicGraphView)}
                        >
                            <ObsidianIcon name="network" aria-hidden />
                        </button>
                        <button
                            type="button"
                            className="clickable-icon"
                            aria-label="Cycle view"
                            title={hasCycles ? 'Cycle view' : undefined}
                            disabled={!hasCycles}
                            aria-pressed={view.kind === 'cycle'}
                            onClick={() => {
                                if (view.kind !== 'cycle') setView({ kind: 'cycle' });
                            }}
                        >
                            <ObsidianIcon name="repeat" aria-hidden />
                        </button>
                    </div>
                </div>
                {graph && visibleDisplay ? (
                    <>
                        <TopicGraphCanvas
                            key={sectionId}
                            display={visibleDisplay}
                            view={view}
                            onFocus={path => {
                                if (view.kind !== 'node' || view.path !== path) setView({ kind: 'node', path });
                            }}
                            busy={busy || pending !== null}
                            hasParent={(child, parent) => graph.parents.get(child)?.includes(parent) ?? false}
                            onToggleParent={toggleParent}
                            title={path => controller.title(path)}
                            onOpen={path => void controller.open(path, true).catch(reportTopicsError)}
                            onRemove={edge => save(() => controller.editParent(sectionId, edge.child, edge.parent, 'remove'))}
                        />
                        {graph.nodes.size === 0 && <p className="nn-topic-graph-empty">No topic nodes in this section.</p>}
                    </>
                ) : (
                    <p className="nn-topic-graph-empty" role="status">
                        This topic section is unavailable.
                    </p>
                )}
            </div>
        </div>
    );
}
