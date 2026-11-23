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
    let typed = false;
    const markTyped = () => {
        typed = true;
    };

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

        reset(): void {
            typed = false;
            this.close();
        }

        dispose(): void {
            input.removeEventListener('input', markTyped, { capture: true });
            this.reset();
        }

        getSuggestions(query: string): PathSuggestionItem<TFile>[] {
            const value = query.trim();
            if (!typed || !value || value === '[' || /[|#\]]/.test(value)) return [];
            return buildPathSuggestionItems({
                items: app.vault.getMarkdownFiles(),
                query: value.replace(/^\[\[/, '').trim(),
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

    // Record real input before Obsidian handles it. Focus and programmatic prefills stay quiet.
    input.addEventListener('input', markTyped, { capture: true });
    const suggest = new RelationshipSuggest(app, input);
    suggest.limit = 10;
    return suggest;
}

export function TopicRelationshipEditor({ app, notePath, title, relationship, busy, onSave, onCancel }: RelationshipEditorProps) {
    const [draft, setDraft] = useState<Draft | null>(null);
    const [editing, setEditing] = useState<InlineEdit | null>(null);
    const nextId = useRef(0);
    const input = useRef<HTMLInputElement>(null);
    const suggest = useRef<ReturnType<typeof attachRelationshipSuggestions> | null>(null);
    const apply = useRef<(value: string) => void>(() => {});
    const selectOnEdit = useRef(false);
    const propertyId = useId();
    const entries = draft?.entries ?? propertyValues(relationship.value).map((value, index) => ({ id: index, value }));
    const isList = Array.isArray(relationship.value) || entries.length > 1 || relationship.key === undefined;

    useLayoutEffect(() => {
        if (!selectOnEdit.current) return;
        selectOnEdit.current = false;
        input.current?.focus({ preventScroll: true });
        input.current?.select();
    }, [editing]);

    useLayoutEffect(() => {
        const element = input.current;
        if (!element) return;
        const popup = attachRelationshipSuggestions(app, element, notePath, link => apply.current(link));
        suggest.current = popup;
        return () => {
            popup.dispose();
            suggest.current = null;
        };
    }, [app, notePath]);

    function expected() {
        return draft?.expected ?? editing?.expected ?? structuredClone(relationship);
    }

    function start(id: number, value: string) {
        if (editing) {
            const staged = stageRelationshipEntry(entries, editing.id, editing.value);
            if (staged !== entries) setDraft({ expected: expected(), entries: staged });
        }
        suggest.current?.reset();
        selectOnEdit.current = true;
        setEditing({ id, value, expected: expected() });
    }

    function endEditing() {
        suggest.current?.reset();
        setEditing(null);
    }

    function applyValue(value: string) {
        if (busy || !editing) return;
        const staged = stageRelationshipEntry(entries, editing.id, value);
        if (staged !== entries) setDraft({ expected: expected(), entries: staged });
        endEditing();
        input.current?.focus({ preventScroll: true });
    }

    useLayoutEffect(() => {
        apply.current = applyValue;
    });

    function remove(id: number) {
        const staged = editing && editing.id !== id ? stageRelationshipEntry(entries, editing.id, editing.value) : entries;
        setDraft({ expected: expected(), entries: staged.filter(entry => entry.id !== id) });
        endEditing();
        input.current?.focus({ preventScroll: true });
    }

    function handleKey(event: KeyboardEvent<HTMLInputElement>) {
        if (event.nativeEvent.isComposing || event.defaultPrevented) return;
        const action = relationshipEditKey(event.key, suggest.current?.showing ?? false);
        if (!action) return;
        event.preventDefault();
        if (action === 'apply') applyValue(event.currentTarget.value);
        else endEditing();
    }

    return (
        <form
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
                            if (entry.id === editing?.id) return null;
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
                        <input
                            ref={input}
                            className="nn-topic-graph-value-input"
                            aria-label={`Edit ${relationship.property} values`}
                            placeholder="Add value"
                            value={editing?.value ?? ''}
                            onChange={event => {
                                const value = event.target.value;
                                setEditing(editing ? { ...editing, value } : { id: --nextId.current, value, expected: expected() });
                            }}
                            onKeyDown={handleKey}
                        />
                    </div>
                </div>
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
