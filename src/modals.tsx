import { Modal, type TFile } from 'obsidian';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { validateConfig, type TopicsConfig } from './config';
import type { TopicsController } from './controller';
import { openTopicGraph } from './topic-graph-workspace';
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
    const hasUnsavedChanges = JSON.stringify(draft) !== JSON.stringify(initial);

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
            <fieldset className="nn-topics-settings-group" disabled={saving}>
                <TopicSettingRow name="Show Topics folder">
                    <input
                        type="checkbox"
                        checked={draft.showFolder}
                        onChange={event => setDraft({ ...draft, showFolder: event.target.checked })}
                    />
                </TopicSettingRow>
                <TopicSettingRow name="Open node notes in">
                    <select
                        value={draft.openNodeIn}
                        onChange={event => setDraft({ ...draft, openNodeIn: event.target.value === 'new-tab' ? 'new-tab' : 'current-tab' })}
                    >
                        <option value="current-tab">Current tab</option>
                        <option value="new-tab">New tab</option>
                    </select>
                </TopicSettingRow>
            </fieldset>
            {draft.sections.map((section, index) => {
                const graph = snapshot.graphs.get(section.id);
                const hasCycles = !!graph?.cycles.length;
                return (
                    <fieldset className="nn-topics-settings-group" key={section.id} disabled={saving}>
                        <legend className="setting-item-name">{section.name.trim() || `Section ${index + 1}`}</legend>
                        <TopicSettingRow name="Section name">
                            <input value={section.name} onChange={event => editSection(section, { name: event.target.value })} required />
                        </TopicSettingRow>
                        <TopicSettingRow name="Node filter">
                            <input
                                value={section.nodeFilter}
                                placeholder="property=value"
                                onChange={event => editSection(section, { nodeFilter: event.target.value })}
                                required
                            />
                        </TopicSettingRow>
                        <TopicSettingRow name="Leaf filter">
                            <input
                                value={section.leafFilter}
                                placeholder="property=value OR property=other"
                                onChange={event => editSection(section, { leafFilter: event.target.value })}
                            />
                        </TopicSettingRow>
                        <TopicSettingRow name="Relationship property">
                            <input
                                value={section.relationshipProperty}
                                onChange={event => editSection(section, { relationshipProperty: event.target.value })}
                                required
                            />
                        </TopicSettingRow>
                        <TopicSettingRow name="Hidden note paths, one per line">
                            <textarea
                                rows={3}
                                value={section.hidden.join('\n')}
                                onChange={event => editSection(section, { hidden: event.target.value.split('\n') })}
                            />
                        </TopicSettingRow>
                        <div className="nn-topics-actions">
                            {graph && (
                                <button
                                    type="button"
                                    className={hasCycles ? 'nn-topics-warning' : undefined}
                                    disabled={hasUnsavedChanges}
                                    onClick={() => {
                                        close();
                                        openTopicGraph(controller, section.id);
                                    }}
                                >
                                    {hasCycles ? 'Topic links form a cycle. Open Topic Graph' : 'Open Topic Graph'}
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
                        </div>
                    </fieldset>
                );
            })}
            {hasUnsavedChanges && <p className="setting-item-description">Save settings before opening Topic Graph.</p>}
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

function TopicSettingRow({ name, children }: { name: string; children: ReactNode }) {
    return (
        <label className="setting-item">
            <span className="setting-item-info">
                <span className="setting-item-name">{name}</span>
            </span>
            <span className="setting-item-control">{children}</span>
        </label>
    );
}
