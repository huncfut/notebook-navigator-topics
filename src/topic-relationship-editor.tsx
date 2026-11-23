import { AbstractInputSuggest, type App, type TFile } from 'obsidian';
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ObsidianIcon } from '../components/ObsidianIcon';
import { buildPathSuggestionItems, renderPathSuggestion, type PathSuggestionItem } from '../suggest/pathInputSuggestUtils';
import type { TopicRelationship } from './controller';
import { linkPath, propertyValues } from './graph';

interface Entry {
    id: number;
    value: unknown;
}

interface Draft {
    expected: TopicRelationship;
    entries: Entry[];
}

interface InlineEdit {
    expected: TopicRelationship;
    id: number;
    value: string;
}

interface RelationshipEditorProps {
    app: App;
    notePath: string;
    title: string;
    relationship: TopicRelationship;
    busy: boolean;
    onSave: (expected: TopicRelationship, values: readonly unknown[], onSaved: () => void) => void;
    onCancel: () => void;
}

function valueLabel(value: unknown): string {
    if (typeof value !== 'string') return JSON.stringify(value) ?? '';
    if (!linkPath(value)) return value;
    const wiki = /^\[\[([^|]+)(?:\|([^\]]+))?\]\]$/.exec(value.trim());
    if (wiki) return wiki[2] ?? wiki[1];
    return /^\[([^\]]*)\]/.exec(value.trim())?.[1] || value;
}

export function stageRelationshipEntry(entries: Entry[], id: number, value: string): Entry[] {
    const current = entries.find(entry => entry.id === id);
    if (current) return current.value === value ? entries : entries.map(entry => (entry.id === id ? { id, value } : entry));
    return value.trim() ? [...entries, { id, value }] : entries;
}

export function relationshipEditKey(key: string, suggestionsOpen: boolean): 'apply' | 'cancel' | undefined {
    if (suggestionsOpen) return undefined;
    if (key === 'Enter') return 'apply';
    if (key === 'Escape') return 'cancel';
}

export function attachRelationshipSuggestions(app: App, input: HTMLInputElement, notePath: string, onPick: (link: string) => void) {
    class RelationshipSuggest extends AbstractInputSuggest<PathSuggestionItem<TFile>> {
        showing = false;

        override open(): void {
            super.open();
            this.showing = true;
        }

        override close(): void {
            super.close();
            this.showing = false;
        }

        getSuggestions(query: string): PathSuggestionItem<TFile>[] {
            return buildPathSuggestionItems({
                items: app.vault.getMarkdownFiles(),
                query: query
                    .trim()
                    .replace(/^\[\[/, '')
                    .split(/[|#\]]/, 1)[0],
                limit: this.limit,
                getPath: file => file.path
            });
        }

        renderSuggestion(item: PathSuggestionItem<TFile>, el: HTMLElement): void {
            renderPathSuggestion(item, el);
        }

        override selectSuggestion(item: PathSuggestionItem<TFile>, event: MouseEvent | globalThis.KeyboardEvent): void {
            event.preventDefault();
            this.close();
            onPick(app.fileManager.generateMarkdownLink(item.item, notePath));
        }
    }

    const suggest = new RelationshipSuggest(app, input);
    suggest.limit = 10;
    return suggest;
}

function RelationshipInput({
    app,
    notePath,
    value,
    label,
    onChange,
    onApply,
    onCancel
}: {
    app: App;
    notePath: string;
    value: string;
    label: string;
    onChange: (value: string) => void;
    onApply: (value: string) => void;
    onCancel: () => void;
}) {
    const input = useRef<HTMLInputElement>(null);
    const suggest = useRef<ReturnType<typeof attachRelationshipSuggestions> | null>(null);
    const apply = useRef(onApply);

    useLayoutEffect(() => {
        apply.current = onApply;
    }, [onApply]);

    useLayoutEffect(() => {
        const element = input.current;
        if (!element) return;
        const popup = attachRelationshipSuggestions(app, element, notePath, link => apply.current(link));
        suggest.current = popup;
        element.focus({ preventScroll: true });
        element.select();
        return () => {
            popup.close();
            suggest.current = null;
        };
    }, [app, notePath]);

    function handleKey(event: KeyboardEvent<HTMLInputElement>) {
        if (event.nativeEvent.isComposing || event.defaultPrevented) return;
        const action = relationshipEditKey(event.key, suggest.current?.showing ?? false);
        if (!action) return;
        event.preventDefault();
        if (action === 'apply') onApply(value);
        else onCancel();
    }

    return (
        <span className="nn-topic-graph-value-input">
            <input
                ref={input}
                aria-label={label}
                placeholder="Search notes or enter a link"
                value={value}
                onChange={event => onChange(event.target.value)}
                onKeyDown={handleKey}
            />
            <button type="button" className="clickable-icon" aria-label="Apply value" title="Apply value" onClick={() => onApply(value)}>
                <ObsidianIcon name="check" aria-hidden />
            </button>
        </span>
    );
}

export function TopicRelationshipEditor({ app, notePath, title, relationship, busy, onSave, onCancel }: RelationshipEditorProps) {
    const [draft, setDraft] = useState<Draft | null>(null);
    const [editing, setEditing] = useState<InlineEdit | null>(null);
    const nextId = useRef(0);
    const form = useRef<HTMLFormElement>(null);
    const restoreFocus = useRef<number | 'add' | null>(null);
    const propertyId = useId();
    const entries = draft?.entries ?? propertyValues(relationship.value).map((value, index) => ({ id: index, value }));
    const isList = Array.isArray(relationship.value) || entries.length > 1 || relationship.key === undefined;

    useLayoutEffect(() => {
        const id = restoreFocus.current;
        if (editing || id === null) return;
        restoreFocus.current = null;
        const button =
            form.current?.querySelector<HTMLButtonElement>(`[data-edit-value="${id}"]`) ??
            form.current?.querySelector<HTMLButtonElement>('[data-add-value]');
        button?.focus({ preventScroll: true });
    }, [draft, editing]);

    function expected() {
        return draft?.expected ?? editing?.expected ?? structuredClone(relationship);
    }

    function start(id: number, value: string) {
        if (editing) {
            const staged = stageRelationshipEntry(entries, editing.id, editing.value);
            if (staged !== entries) setDraft({ expected: expected(), entries: staged });
        }
        setEditing({ id, value, expected: expected() });
    }

    function endEditing() {
        restoreFocus.current = editing?.id ?? 'add';
        setEditing(null);
    }

    function applyValue(value: string) {
        if (!editing) return;
        const staged = stageRelationshipEntry(entries, editing.id, value);
        if (staged !== entries) setDraft({ expected: expected(), entries: staged });
        endEditing();
    }

    function remove(id: number) {
        const staged = editing && editing.id !== id ? stageRelationshipEntry(entries, editing.id, editing.value) : entries;
        const retained = staged.filter(entry => entry.id !== id);
        const index = staged.findIndex(entry => entry.id === id);
        restoreFocus.current = (retained[index] ?? retained[index - 1])?.id ?? 'add';
        setDraft({ expected: expected(), entries: retained });
        setEditing(null);
    }

    const activeInput = editing && (
        <RelationshipInput
            key={editing.id}
            app={app}
            notePath={notePath}
            value={editing.value}
            label={`Edit ${relationship.property} value`}
            onChange={value => setEditing({ ...editing, value })}
            onApply={applyValue}
            onCancel={endEditing}
        />
    );

    return (
        <form
            ref={form}
            className="nn-topic-graph-editor"
            onSubmit={event => {
                event.preventDefault();
                if (busy || (!draft && !editing)) return;
                const staged = editing ? stageRelationshipEntry(entries, editing.id, editing.value) : entries;
                onSave(
                    expected(),
                    staged.map(entry => entry.value),
                    () => {
                        setDraft(null);
                        endEditing();
                    }
                );
            }}
        >
            <h3>{title}</h3>
            <fieldset disabled={busy}>
                <div className="nn-topic-graph-property-row" role="group" aria-labelledby={propertyId}>
                    <div className="nn-topic-graph-property-key" id={propertyId}>
                        <ObsidianIcon name={isList ? 'list' : 'text'} aria-hidden />
                        <span title={relationship.property}>{relationship.property}</span>
                    </div>
                    <div className="nn-topic-graph-property-values" data-layout={isList ? 'list' : 'scalar'}>
                        {entries.map((entry, index) => {
                            if (entry.id === editing?.id) return activeInput;
                            const label = valueLabel(entry.value);
                            const raw = typeof entry.value === 'string' ? entry.value : label;
                            return (
                                <span key={entry.id} className="nn-topic-graph-value" data-link={Boolean(linkPath(entry.value))}>
                                    {typeof entry.value === 'string' ? (
                                        <button
                                            type="button"
                                            className="nn-topic-graph-value-text"
                                            data-edit-value={entry.id}
                                            aria-label={`Edit value ${index + 1}: ${label}`}
                                            title={raw}
                                            onClick={() => start(entry.id, raw)}
                                        >
                                            {label || 'Empty value'}
                                        </button>
                                    ) : (
                                        <span className="nn-topic-graph-value-text" title={raw}>
                                            {label}
                                        </span>
                                    )}
                                    <button
                                        type="button"
                                        className="clickable-icon nn-topic-graph-value-remove"
                                        aria-label={`Remove value ${index + 1}: ${label}`}
                                        title="Remove value"
                                        onClick={() => remove(entry.id)}
                                    >
                                        <ObsidianIcon name="x" aria-hidden />
                                    </button>
                                </span>
                            );
                        })}
                        {editing && !entries.some(entry => entry.id === editing.id) && activeInput}
                    </div>
                </div>
                {!editing && (
                    <button
                        type="button"
                        className="clickable-icon nn-topic-graph-value-add"
                        data-add-value
                        onClick={() => start(--nextId.current, '')}
                    >
                        <ObsidianIcon name="plus" aria-hidden />
                        <span>Add value</span>
                    </button>
                )}
                {(draft || editing) && (
                    <div className="nn-topic-graph-editor-actions">
                        <button type="submit" className="mod-cta">
                            Save
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setDraft(null);
                                endEditing();
                                onCancel();
                            }}
                        >
                            Cancel
                        </button>
                    </div>
                )}
            </fieldset>
        </form>
    );
}
