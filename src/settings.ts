import type { Setting, SettingDefinitionItem } from 'obsidian';
import { strings } from '../i18n';
import { getIconService } from '../services/icons';
import { ConfirmModal } from '../modals/ConfirmModal';
import { createGroupDefinition, createRenderDefinition } from '../settings/nativeSettingControls';
import { addSettingsEditorListButton, addSettingsEditorListItem, createSettingsEditorList } from '../settings/settingsEditorList';
import type { SettingsTabContext } from '../settings/tabs/SettingsTabContext';
import { defaultTopicIcon, type TopicsConfig } from './config';
import { getTopicsController, reportTopicsError, type TopicsSnapshot } from './controller';
import type { TopicSection } from './graph';
import { openTopicIconEditor } from './topic-icon-editor';
import { revealTopicGraph } from './topic-graph-workspace';
import { TopicSectionModal } from './topic-section-modal';

export function createTopicsSettingDefinitions(context: SettingsTabContext): SettingDefinitionItem[] {
    return [
        createGroupDefinition(undefined, [
            createTopicToggle(context, 'Show Topics folder', 'Show the Topics folder in the navigation pane.', 'showFolder'),
            createTopicPreference(
                context,
                'Open node notes in',
                'Choose where to open the note for a topic node.',
                'openNodeIn',
                (setting, change) => {
                    let refresh: (value: TopicsConfig['openNodeIn'], ready: boolean) => void = () => {};
                    setting.addDropdown(dropdown => {
                        dropdown.selectEl.setAttribute('aria-label', 'Open node notes in');
                        dropdown.addOption('current-tab', 'Current tab').addOption('new-tab', 'New tab');
                        dropdown.onChange(value => change(value === 'new-tab' ? value : 'current-tab'));
                        refresh = (value, ready) => dropdown.setValue(value).setDisabled(!ready);
                    });
                    return refresh;
                }
            )
        ]),
        createGroupDefinition('Icons', [
            createTopicToggle(context, 'Show topic icons', 'Show icons for Topics in the navigation pane.', 'showIcons'),
            createRenderDefinition({
                name: 'Default topic icon',
                desc: 'Use this icon when a topic has no custom or node-note icon.',
                render: setting => renderDefaultTopicIcon(setting, context)
            }),
            createTopicToggle(
                context,
                'Use node-note icons',
                'Use each node note’s Navigator icon before falling back to the default.',
                'useNodeNoteIcons'
            )
        ]),
        createGroupDefinition('Colors', [
            createTopicToggle(context, 'Use node-note colors', 'Use the node note’s color on its topic row.', 'useNodeNoteColors'),
            createTopicToggle(
                context,
                'Use node-note background colors',
                'Use the node note’s background color on its topic row.',
                'useNodeNoteBackgroundColors'
            )
        ]),
        createGroupDefinition(undefined, [
            createRenderDefinition({
                name: 'Sections',
                desc: 'Configure which notes appear in each section and how they are linked.',
                render: setting =>
                    renderTopicSections(
                        setting.setName('Sections').setDesc('Configure which notes appear in each section and how they are linked.'),
                        context
                    )
            })
        ])
    ];
}

type TopicToggleKey = 'showFolder' | 'showIcons' | 'useNodeNoteIcons' | 'useNodeNoteColors' | 'useNodeNoteBackgroundColors';

function createTopicToggle(context: SettingsTabContext, name: string, desc: string, key: TopicToggleKey) {
    return createTopicPreference(context, name, desc, key, (setting, change) => {
        let refresh: (value: boolean, ready: boolean) => void = () => {};
        setting.addToggle(toggle => {
            toggle.toggleEl.setAttribute('aria-label', name);
            toggle.onChange(change);
            refresh = (value, ready) => toggle.setValue(value).setDisabled(!ready);
        });
        return refresh;
    });
}

function createTopicPreference<Key extends TopicToggleKey | 'openNodeIn'>(
    { plugin }: SettingsTabContext,
    name: string,
    desc: string,
    key: Key,
    addControl: (setting: Setting, change: (value: TopicsConfig[Key]) => void) => (value: TopicsConfig[Key], ready: boolean) => void
) {
    return createRenderDefinition({
        name,
        desc,
        render: setting => {
            setting.setName(name).setDesc(desc);
            const controller = getTopicsController(plugin);
            const updateControl = addControl(setting, value => {
                void controller
                    .updateConfig(config => ({ ...config, [key]: value }))
                    .catch(error => {
                        refresh();
                        reportTopicsError(error);
                    });
            });
            const refresh = () => {
                const { config, ready } = controller.getSnapshot();
                updateControl(config[key], ready);
            };
            refresh();
            return controller.subscribe(refresh);
        }
    });
}

function renderDefaultTopicIcon(setting: Setting, { app, plugin }: SettingsTabContext): () => void {
    const controller = getTopicsController(plugin);
    setting.setName('Default topic icon').setDesc('Use this icon when a topic has no custom or node-note icon.');
    const preview = setting.controlEl.createSpan({ cls: 'nn-setting-template-command-icon', attr: { 'aria-hidden': 'true' } });
    let refresh: () => void = () => {};
    setting.addButton(button => {
        button.setButtonText(strings.contextMenu.tag.changeIcon).onClick(() => {
            const { metadataService } = plugin;
            if (!metadataService) return;
            const { defaultIcon } = controller.getSnapshot().config;
            void openTopicIconEditor(
                app,
                metadataService,
                'Default topic icon',
                defaultTopicIcon,
                defaultIcon === defaultTopicIcon ? undefined : defaultIcon,
                icon => controller.updateConfig(config => ({ ...config, defaultIcon: icon ?? defaultTopicIcon }))
            ).catch(reportTopicsError);
        });
        refresh = () => {
            const { config, ready } = controller.getSnapshot();
            getIconService().renderIcon(preview, config.defaultIcon, 16);
            button.setDisabled(!ready || !plugin.metadataService);
        };
    });
    refresh();
    return controller.subscribe(refresh);
}

function renderTopicSections(setting: Setting, { app, plugin }: SettingsTabContext): () => void {
    const controller = getTopicsController(plugin);
    const list = createSettingsEditorList(setting);
    let lastConfig: TopicsConfig | undefined;
    let wasReady = false;
    let graphButtons: { section: TopicSection; button: HTMLButtonElement }[] = [];

    const openEditor = (original?: TopicSection) => {
        new TopicSectionModal(app, original, draft => controller.saveSection(draft, original)).open();
    };

    const renderList = ({ config, ready }: TopicsSnapshot) => {
        lastConfig = config;
        wasReady = ready;
        graphButtons = [];
        list.empty();
        if (!ready || config.sections.length === 0) {
            list.createEl('li', { text: ready ? 'No topic sections.' : 'Loading topic sections…' });
            return;
        }

        for (const section of config.sections) {
            const controls = addSettingsEditorListItem(list, section.name, section.relationshipProperty);
            const graphButton = addSettingsEditorListButton(controls, 'git-fork', `Open Topic Graph for ${section.name}`, () => {
                void revealTopicGraph(controller, section.id)
                    .then(() => plugin.closeSettings())
                    .catch(reportTopicsError);
            });
            graphButtons.push({ section, button: graphButton });
            addSettingsEditorListButton(controls, 'pencil', `Edit ${section.name}`, () => openEditor(section));
            addSettingsEditorListButton(controls, 'x', `Remove ${section.name}`, () => {
                new ConfirmModal(
                    app,
                    `Remove ${section.name}?`,
                    'This removes the Topics section from the navigation pane.',
                    () => controller.removeSection(section.id).catch(reportTopicsError),
                    'Remove section'
                ).open();
            });
        }
    };

    let refresh: () => void = () => {};
    setting.addButton(add => {
        add.setButtonText('Add section').onClick(() => openEditor());
        refresh = () => {
            const snapshot = controller.getSnapshot();
            add.setDisabled(!snapshot.ready);
            if (lastConfig !== snapshot.config || wasReady !== snapshot.ready) {
                renderList(snapshot);
            }
            for (const { section, button } of graphButtons) {
                const hasCycles = Boolean(snapshot.graphs.get(section.id)?.cycles.length);
                const label = hasCycles
                    ? `Topic links form a cycle. Open Topic Graph for ${section.name}`
                    : `Open Topic Graph for ${section.name}`;
                button.setAttribute('aria-label', label);
                button.title = label;
                button.toggleClass('nn-topics-warning', hasCycles);
            }
        };
    });
    refresh();
    const unsubscribe = controller.subscribe(refresh);
    return () => {
        unsubscribe();
        list.remove();
    };
}
