import { reportTopicsError, type TopicsController } from './controller';

export const TOPIC_GRAPH_VIEW = 'notebook-navigator-topic-graph';

export async function revealTopicGraph(controller: TopicsController, sectionId: string): Promise<void> {
    const { workspace } = controller.app;
    const existing = workspace.getLeavesOfType(TOPIC_GRAPH_VIEW).find(leaf => leaf.getViewState().state?.sectionId === sectionId);
    const leaf = existing ?? workspace.getLeaf('tab');
    if (!existing) {
        try {
            await leaf.setViewState({ type: TOPIC_GRAPH_VIEW, state: { sectionId }, active: true });
        } catch (error) {
            leaf.detach();
            throw error;
        }
    }
    await workspace.revealLeaf(leaf);
}

export function openTopicGraph(controller: TopicsController, sectionId: string): void {
    void revealTopicGraph(controller, sectionId).catch(reportTopicsError);
}
