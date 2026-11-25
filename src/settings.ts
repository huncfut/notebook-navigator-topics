import type { Setting, SettingDefinitionItem } from 'obsidian';
import { ConfirmModal } from '../modals/ConfirmModal';
import { createGroupDefinition, createRenderDefinition } from '../settings/nativeSettingControls';
import { addSettingsEditorListButton, addSettingsEditorListItem, createSettingsEditorList } from '../settings/settingsEditorList';
import type { SettingsTabContext } from '../settings/tabs/SettingsTabContext';
import type { TopicsConfig } from './config';
import { getTopicsController, reportTopicsError, type TopicsSnapshot } from './controller';
import type { TopicSection } from './graph';
import { revealTopicGraph } from './topic-graph-workspace';
import { TopicSectionModal } from './topic-section-modal';

export function createTopicsSettingDefinitions(context: SettingsTabContext): SettingDefinitionItem[] {
    return [
        createGroupDefinition(undefined, [
            createTopicPreference(
                context,
                'Show Topics folder',
                'Show the Topics folder in the navigation pane.',
                'showFolder',
                (setting, change) => {
                    let refresh: (value: boolean, ready: boolean) => void = () => {};
                    setting.addToggle(toggle => {
                        toggle.toggleEl.setAttribute('aria-label', 'Show Topics folder');
                        toggle.onChange(change);
                        refresh = (value, ready) => toggle.setValue(value).setDisabled(!ready);
                    });
                    return refresh;
                }
            ),
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

function createTopicPreference<Key extends 'showFolder' | 'openNodeIn'>(
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
