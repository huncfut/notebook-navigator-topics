import { Modal, Setting, type App } from 'obsidian';
import { strings } from '../i18n';
import type { TopicSection } from './graph';

/** Edits a local draft and saves it through the Topics settings page. */
export class TopicSectionModal extends Modal {
    private readonly draft: TopicSection;
    private saving = false;

    constructor(
        app: App,
        private readonly original: TopicSection | undefined,
        private readonly onSave: (draft: TopicSection) => Promise<void>
    ) {
        super(app);
        this.draft = original
            ? { ...original }
            : {
                  id: globalThis.crypto.randomUUID(),
                  name: '',
                  nodeFilter: '',
                  leafFilter: '',
                  relationshipProperty: '',
                  hidden: []
              };
    }

    onOpen(): void {
        this.setTitle(this.original ? 'Edit topic section' : 'Add topic section');
        const form = this.contentEl.createEl('form');

        const fields: { key: 'name' | 'nodeFilter' | 'leafFilter' | 'relationshipProperty'; name: string; placeholder?: string }[] = [
            { key: 'name', name: 'Section name' },
            { key: 'nodeFilter', name: 'Node filter', placeholder: 'property=value' },
            { key: 'leafFilter', name: 'Leaf filter', placeholder: 'property=value OR property=other' },
            { key: 'relationshipProperty', name: 'Relationship property' }
        ];
        const controls = fields.map(({ key, name, placeholder }) =>
            new Setting(form).setName(name).addText(text => {
                text.inputEl.setAttribute('aria-label', name);
                text.inputEl.required = key !== 'leafFilter';
                if (placeholder) text.setPlaceholder(placeholder);
                text.setValue(this.draft[key]).onChange(value => {
                    this.draft[key] = value;
                });
            })
        );

        controls.push(
            new Setting(form)
                .setName('Hidden note paths')
                .setDesc('Enter one vault-relative note path per line.')
                .addTextArea(text => {
                    text.inputEl.setAttribute('aria-label', 'Hidden note paths');
                    text.inputEl.rows = 3;
                    text.setValue(this.draft.hidden.join('\n')).onChange(value => {
                        this.draft.hidden = value.split('\n');
                    });
                })
        );

        const errorEl = form.createDiv({ cls: 'nn-topics-warning', attr: { role: 'alert' } });
        const buttons = form.createDiv('nn-button-container');
        const cancel = buttons.createEl('button', { text: strings.common.cancel, attr: { type: 'button' } });
        const save = buttons.createEl('button', { text: strings.common.save, cls: 'mod-cta', attr: { type: 'submit' } });
        const setSaving = (saving: boolean) => {
            this.saving = saving;
            save.disabled = saving;
            cancel.disabled = saving;
            controls.forEach(setting => setting.setDisabled(saving));
        };
        cancel.addEventListener('click', () => this.close());
        form.addEventListener('submit', event => {
            event.preventDefault();
            if (this.saving) return;
            setSaving(true);
            errorEl.setText('');

            void this.onSave({ ...this.draft })
                .then(() => this.close())
                .catch((error: unknown) => {
                    errorEl.setText(error instanceof Error ? error.message : 'The topic section could not be saved.');
                })
                .finally(() => setSaving(false));
        });
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
