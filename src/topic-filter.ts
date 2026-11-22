import type { TopicSelection } from './navigation';

export type TopicTarget = Pick<TopicSelection, 'sectionId' | 'path'>;

export function formatTopicFilter({ sectionId, path }: TopicTarget): string {
    return `topic:${encodeURIComponent(sectionId)}/${encodeURIComponent(path)}`;
}

export function parseTopicFilter(token: string): TopicTarget | null {
    const match = /^topic:([^/]+)\/(.+)$/i.exec(token);
    if (!match) return null;
    try {
        return { sectionId: decodeURIComponent(match[1]), path: decodeURIComponent(match[2]) };
    } catch {
        return null;
    }
}

// Use the native property operand machinery for boolean composition, with a
// reserved key whose only value comes from Topics' resolved leaf membership.
const topicOperandPrefix = '\u0000';

export function topicOperandKey(target: TopicTarget): string {
    return topicOperandPrefix + formatTopicFilter(target);
}

export function topicTargetFromOperand(key: string): TopicTarget | null {
    return key.startsWith(topicOperandPrefix) ? parseTopicFilter(key.slice(topicOperandPrefix.length)) : null;
}
