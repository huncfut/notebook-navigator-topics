import { Modal, type TFile } from 'obsidian';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { validateConfig, type TopicsConfig } from './config';
import { reportTopicsError, type TopicsController } from './controller';
import type { TopicRequirement, TopicSection } from './graph';

class TopicsModal extends Modal {
    private root?: Root;

    constructor(
        controller: TopicsController,
        private readonly title: string,
        private readonly render: (close: () => void) => ReactNode,
        private readonly onDismiss?: () => void
    ) {
        super(controller.app);
    }

    onOpen(): void {
        this.setTitle(this.title);
        this.contentEl.classList.add('nn-topics-modal');
        this.root = createRoot(this.contentEl);
        this.root.render(this.render(() => this.close()));
    }

    onClose(): void {
        this.root?.unmount();
        this.root = undefined;
        this.onDismiss?.();
    }
}

export function chooseTopicLeafRequirement(
    controller: TopicsController,
    file: TFile,
    choices: TopicRequirement[]
): Promise<TopicRequirement | null> {
    return new Promise(resolve =>
        new TopicsModal(
            controller,
            'Choose a leaf requirement',
            close => (
                <>
                    <p>{file.basename}</p>
                    <div className="nn-topics-actions">
                        {choices.map(choice => (
                            <button
                                key={JSON.stringify(choice)}
                                type="button"
                                onClick={() => {
                                    resolve(choice);
                                    close();
                                }}
                            >
                                {choice.key}={choice.value}
                            </button>
                        ))}
                        <button type="button" onClick={close}>
                            Skip note
                        </button>
                    </div>
                </>
            ),
            () => resolve(null)
        ).open()
    );
}

export function openTopicsSettings(controller: TopicsController): void {
    new TopicsModal(controller, 'Topics settings', close => <TopicsSettings controller={controller} close={close} />).open();
}

export function openCycleRepair(controller: TopicsController, sectionId: string): void {
    new TopicsModal(controller, 'Repair topic cycles', () => <CycleRepair controller={controller} sectionId={sectionId} />).open();
}

export function TopicsSettings({ controller, close }: { controller: TopicsController; close: () => void }) {
    const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
    if (!snapshot.ready) return <p>Loading Topics settings…</p>;
    return <TopicsSettingsForm controller={controller} initial={snapshot.config} close={close} />;
}

function TopicsSettingsForm({ controller, initial, close }: { controller: TopicsController; initial: TopicsConfig; close: () => void }) {
    const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
    const [draft, setDraft] = useState(initial);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    function editSection(section: TopicSection, change: Partial<TopicSection>) {
        setDraft(current => ({
            ...current,
            sections: current.sections.map(item => (item.id === section.id ? { ...item, ...change } : item))
        }));
    }

    async function save() {
        setSaving(true);
        setError('');
        try {
            const valid = validateConfig(draft);
            await controller.updateConfig(current => {
                if (current !== initial)
                    throw new Error('Topics settings changed while this window was open. Reopen the settings before editing them.');
                return valid;
            });
            close();
        } catch (error) {
            setError(error instanceof Error ? error.message : 'Topics settings could not be saved.');
        } finally {
            setSaving(false);
        }
    }

    return (
        <form
            onSubmit={event => {
                event.preventDefault();
                void save();
            }}
        >
            <fieldset disabled={saving}>
                <label className="nn-topics-field">
                    <span>Show Topics folder</span>
                    <input
                        type="checkbox"
                        checked={draft.showFolder}
                        onChange={event => setDraft({ ...draft, showFolder: event.target.checked })}
                    />
                </label>
                <label className="nn-topics-field">
                    <span>Open node notes in</span>
                    <select
                        value={draft.openNodeIn}
                        onChange={event => setDraft({ ...draft, openNodeIn: event.target.value === 'new-tab' ? 'new-tab' : 'current-tab' })}
                    >
                        <option value="current-tab">Current tab</option>
                        <option value="new-tab">New tab</option>
                    </select>
                </label>
            </fieldset>
            {draft.sections.map((section, index) => {
                const graph = snapshot.graphs.get(section.id);
                const hasCycles = !!graph?.cycles.length;
                return (
                    <fieldset className="nn-topics-section-settings" key={section.id} disabled={saving}>
                        <legend>{section.name.trim() || `Section ${index + 1}`}</legend>
                        <label className="nn-topics-field">
                            <span>Section name</span>
                            <input value={section.name} onChange={event => editSection(section, { name: event.target.value })} required />
                        </label>
                        <label className="nn-topics-field">
                            <span>Node filter</span>
                            <input
                                value={section.nodeFilter}
                                placeholder="property=value"
                                onChange={event => editSection(section, { nodeFilter: event.target.value })}
                                required
                            />
                        </label>
                        <label className="nn-topics-field">
                            <span>Leaf filter</span>
                            <input
                                value={section.leafFilter}
                                placeholder="property=value OR property=other"
                                onChange={event => editSection(section, { leafFilter: event.target.value })}
                            />
                        </label>
                        <label className="nn-topics-field">
                            <span>Relationship property</span>
                            <input
                                value={section.relationshipProperty}
                                onChange={event => editSection(section, { relationshipProperty: event.target.value })}
                                required
                            />
                        </label>
                        <label className="nn-topics-field">
                            <span>Hidden note paths, one per line</span>
                            <textarea
                                rows={3}
                                value={section.hidden.join('\n')}
                                onChange={event => editSection(section, { hidden: event.target.value.split('\n') })}
                            />
                        </label>
                        {graph && (
                            <button
                                type="button"
                                className={hasCycles ? 'nn-topics-warning' : undefined}
                                onClick={() => openCycleRepair(controller, section.id)}
                            >
                                {hasCycles ? 'Topic links form a cycle. Open repair tool' : 'Manage parent links'}
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() =>
                                setDraft(current => ({
                                    ...current,
                                    sections: current.sections.filter(item => item.id !== section.id)
                                }))
                            }
                        >
                            Remove section
                        </button>
                    </fieldset>
                );
            })}
            {error && <p role="alert">{error}</p>}
            <div className="nn-topics-actions">
                <button
                    type="button"
                    disabled={saving}
                    onClick={() =>
                        setDraft(current => ({
                            ...current,
                            sections: [
                                ...current.sections,
                                {
                                    id: globalThis.crypto.randomUUID(),
                                    name: '',
                                    nodeFilter: '',
                                    leafFilter: '',
                                    relationshipProperty: '',
                                    hidden: []
                                }
                            ]
                        }))
                    }
                >
                    Add section
                </button>
                <button type="submit" className="mod-cta" disabled={saving}>
                    Save settings
                </button>
            </div>
        </form>
    );
}

type PendingLink = { child: string; parent: string };

export function CycleRepair({ controller, sectionId }: { controller: TopicsController; sectionId: string }) {
    const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
    const [child, setChild] = useState('');
    const [parent, setParent] = useState('');
    const [pending, setPending] = useState<PendingLink | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const section = snapshot.config.sections.find(section => section.id === sectionId);
    const graph = snapshot.graphs.get(sectionId);
    if (!section || !graph) return <p>This topic section is unavailable.</p>;
    const linked = graph.parents.get(child)?.includes(parent) ?? false;
    const nodes = [...graph.nodes].sort(
        (left, right) => controller.title(left).localeCompare(controller.title(right)) || left.localeCompare(right)
    );

    async function edit(link: PendingLink, operation: 'add' | 'remove', allowCycle = false) {
        setBusy(true);
        setError('');
        try {
            const result = await controller.editParent(sectionId, link.child, link.parent, operation, allowCycle);
            setPending(result === 'cycle' ? link : null);
        } catch (error) {
            setError(error instanceof Error ? error.message : 'The link could not be saved.');
        } finally {
            setBusy(false);
        }
    }

    return (
        <div aria-busy={busy}>
            <p>
                Parent links in {section.name} are stored in <strong>{section.relationshipProperty}</strong> on each child note.
            </p>
            {graph.cycles.length === 0 ? (
                <p role="status">No cycles detected.</p>
            ) : (
                graph.cycles.map(links => (
                    <ul className="nn-topics-cycle" key={JSON.stringify(links)}>
                        {links.map(link => (
                            <li key={JSON.stringify(link)}>
                                <button
                                    type="button"
                                    className="nn-topics-inline"
                                    title={link.child}
                                    onClick={() => void controller.open(link.child, false).catch(reportTopicsError)}
                                >
                                    {controller.title(link.child)}
                                </button>
                                <span> lists </span>
                                <button
                                    type="button"
                                    className="nn-topics-inline"
                                    title={link.parent}
                                    onClick={() => void controller.open(link.parent, false).catch(reportTopicsError)}
                                >
                                    {controller.title(link.parent)}
                                </button>
                                <span> as a parent </span>
                                <button type="button" disabled={busy} onClick={() => void edit(link, 'remove')}>
                                    Remove link
                                </button>
                            </li>
                        ))}
                    </ul>
                ))
            )}
            <form
                onSubmit={event => {
                    event.preventDefault();
                    if (child && parent && !linked) void edit({ child, parent }, 'add');
                }}
            >
                <fieldset disabled={busy}>
                    <legend>Edit a parent link</legend>
                    <label className="nn-topics-field">
                        <span>Child note</span>
                        <select
                            value={child}
                            onChange={event => {
                                setChild(event.target.value);
                                setPending(null);
                            }}
                            required
                        >
                            <option value="">Select a note</option>
                            {nodes.map(path => (
                                <option key={path} value={path}>
                                    {path}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="nn-topics-field">
                        <span>Parent note</span>
                        <select
                            value={parent}
                            onChange={event => {
                                setParent(event.target.value);
                                setPending(null);
                            }}
                            required
                        >
                            <option value="">Select a note</option>
                            {nodes.map(path => (
                                <option key={path} value={path}>
                                    {path}
                                </option>
                            ))}
                        </select>
                    </label>
                    {linked ? (
                        <button type="button" onClick={() => void edit({ child, parent }, 'remove')}>
                            Remove selected link
                        </button>
                    ) : (
                        <button type="submit" disabled={!child || !parent}>
                            Add link
                        </button>
                    )}
                </fieldset>
            </form>
            {pending && (
                <div className="nn-topics-warning">
                    <p role="alert">This link would create a cycle.</p>
                    <button type="button" disabled={busy} onClick={() => void edit(pending, 'add', true)}>
                        Save anyway
                    </button>
                    <button type="button" disabled={busy} onClick={() => setPending(null)}>
                        Cancel
                    </button>
                </div>
            )}
            {error && <p role="alert">{error}</p>}
        </div>
    );
}
