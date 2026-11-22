import {
    compileFilter,
    linkPath,
    parseTopicRequirements,
    propertyKey,
    propertyValues,
    type TopicRequirement,
    type TopicSection
} from './graph';

type Properties = Record<string, unknown>;

export type TopicDropPlan =
    | { status: 'linked'; changes: Properties }
    | { status: 'choice'; choices: TopicRequirement[] }
    | { status: 'already-linked' | 'node' | 'ineligible' | 'conflict' };

export function planTopicDrop(
    section: TopicSection,
    properties: Readonly<Properties>,
    newLink: string,
    isTargetLink: (path: string) => boolean,
    selected?: TopicRequirement
): TopicDropPlan {
    const matchesNode = compileFilter(section.nodeFilter);
    const matchesLeaf = compileFilter(section.leafFilter);
    if (matchesNode(properties)) return { status: 'node' };

    const relationshipKey = propertyKey(properties, section.relationshipProperty) ?? section.relationshipProperty;
    const relationship = propertyKey(properties, relationshipKey) === undefined ? undefined : properties[relationshipKey];
    const links = propertyValues(relationship);
    if (links.some(value => typeof value !== 'string')) return { status: 'conflict' };
    const alreadyLinked = links.some(value => {
        const path = linkPath(value);
        return path !== null && isTargetLink(path);
    });
    const changes = alreadyLinked ? {} : { [relationshipKey]: [...links, newLink] };
    const afterLink = { ...properties, ...changes };
    if (matchesNode(afterLink)) return { status: 'node' };
    if (matchesLeaf(afterLink)) return alreadyLinked ? { status: 'already-linked' } : { status: 'linked', changes };
    if (!section.leafFilter.trim()) return { status: 'ineligible' };

    const available: { requirement: TopicRequirement; changes: Properties }[] = [];
    for (const requirement of parseTopicRequirements(section.leafFilter)) {
        const existingKey = propertyKey(afterLink, requirement.key);
        const key = existingKey ?? requirement.key;
        if (propertyKey({ [relationshipKey]: true }, key) !== undefined) continue;
        const current = existingKey === undefined ? undefined : afterLink[key];
        if (current != null && (!Array.isArray(current) || current.some(value => typeof value !== 'string'))) continue;

        const next = { ...changes, [key]: Array.isArray(current) ? [...current, requirement.value] : requirement.value };
        const finalProperties = { ...properties, ...next };
        if (!matchesLeaf(finalProperties) || matchesNode(finalProperties)) continue;
        if (available.some(option => option.requirement.key === key && option.requirement.value === requirement.value)) continue;
        available.push({ requirement: { key, value: requirement.value }, changes: next });
    }
    const choice = selected
        ? available.find(option => option.requirement.key === selected.key && option.requirement.value === selected.value)
        : available.length === 1
          ? available[0]
          : undefined;
    if (choice) return { status: 'linked', changes: choice.changes };
    if (available.length > 1 && !selected) return { status: 'choice', choices: available.map(option => option.requirement) };
    return { status: 'conflict' };
}
