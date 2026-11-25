import { compileFilter, type TopicSection } from './graph';

export const defaultTopicIcon = 'lucide-network';

export interface TopicsConfig {
    showFolder: boolean;
    showIcons: boolean;
    defaultIcon: string;
    useNodeNoteIcons: boolean;
    openNodeIn: 'current-tab' | 'new-tab';
    sections: TopicSection[];
}

export const defaultConfig: TopicsConfig = {
    showFolder: true,
    showIcons: true,
    defaultIcon: defaultTopicIcon,
    useNodeNoteIcons: false,
    openNodeIn: 'current-tab',
    sections: []
};

export function validateConfig(value: unknown): TopicsConfig {
    if (!value || typeof value !== 'object') throw new Error('Topics settings must be an object.');
    const config = value as Partial<TopicsConfig>;
    if (
        typeof config.showFolder !== 'boolean' ||
        (config.openNodeIn !== 'current-tab' && config.openNodeIn !== 'new-tab') ||
        !Array.isArray(config.sections)
    )
        throw new Error('Topics settings are invalid.');

    const ids = new Set<string>();
    const sections = config.sections.map(section => {
        if (
            !section ||
            typeof section.id !== 'string' ||
            !section.id ||
            ids.has(section.id) ||
            typeof section.name !== 'string' ||
            !section.name.trim() ||
            typeof section.relationshipProperty !== 'string' ||
            !section.relationshipProperty.trim() ||
            typeof section.nodeFilter !== 'string' ||
            !section.nodeFilter.trim() ||
            typeof section.leafFilter !== 'string' ||
            !Array.isArray(section.hidden) ||
            section.hidden.some(path => typeof path !== 'string')
        ) {
            throw new Error('Each topic section needs a unique ID, name, node filter, and relationship property.');
        }
        compileFilter(section.nodeFilter);
        compileFilter(section.leafFilter);
        ids.add(section.id);
        const { icons, ...fields } = section;
        const validIcons =
            icons && typeof icons === 'object' && !Array.isArray(icons)
                ? Object.entries(icons).filter(([path, icon]) => path.length > 0 && typeof icon === 'string' && icon.trim())
                : [];
        return {
            ...fields,
            name: section.name.trim(),
            nodeFilter: section.nodeFilter.trim(),
            leafFilter: section.leafFilter.trim(),
            relationshipProperty: section.relationshipProperty.trim(),
            hidden: [...new Set(section.hidden.map(path => path.trim()).filter(Boolean))],
            ...(validIcons.length > 0 ? { icons: Object.fromEntries(validIcons.map(([path, icon]) => [path, icon.trim()])) } : {})
        };
    });
    return {
        showFolder: config.showFolder,
        showIcons: typeof config.showIcons === 'boolean' ? config.showIcons : defaultConfig.showIcons,
        defaultIcon: typeof config.defaultIcon === 'string' ? config.defaultIcon.trim() || defaultTopicIcon : defaultTopicIcon,
        useNodeNoteIcons: typeof config.useNodeNoteIcons === 'boolean' ? config.useNodeNoteIcons : defaultConfig.useNodeNoteIcons,
        openNodeIn: config.openNodeIn,
        sections
    };
}
