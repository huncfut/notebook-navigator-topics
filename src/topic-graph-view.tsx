import { ItemView, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import { createRoot, type Root } from 'react-dom/client';
import type { TopicsController } from './controller';
import { TopicGraphPanel } from './topic-graph-panel';
import { TOPIC_GRAPH_VIEW } from './topic-graph-workspace';

export class TopicGraphView extends ItemView {
    private root?: Root;
    private sectionId = '';

    constructor(
        leaf: WorkspaceLeaf,
        private readonly controller: TopicsController
    ) {
        super(leaf);
    }

    getViewType(): string {
        return TOPIC_GRAPH_VIEW;
    }

    getDisplayText(): string {
        return 'Topic Graph';
    }

    getIcon(): string {
        return 'git-fork';
    }

    getState(): Record<string, unknown> {
        return { sectionId: this.sectionId };
    }

    async setState(state: unknown, result: ViewStateResult): Promise<void> {
        if (typeof state === 'object' && state !== null && 'sectionId' in state && typeof state.sectionId === 'string') {
            this.sectionId = state.sectionId;
            this.render();
        }
        await super.setState(state, result);
    }

    async onOpen(): Promise<void> {
        this.contentEl.classList.add('nn-topic-graph-content');
        this.root = createRoot(this.contentEl);
        this.render();
    }

    async onClose(): Promise<void> {
        this.root?.unmount();
        this.root = undefined;
        this.contentEl.classList.remove('nn-topic-graph-content');
    }

    private render(): void {
        if (this.sectionId) {
            this.root?.render(<TopicGraphPanel key={this.sectionId} controller={this.controller} sectionId={this.sectionId} />);
        }
    }
}
