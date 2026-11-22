import type { Plugin } from 'obsidian';

const css = '__TOPICS_CSS__';

export function registerTopicsStyles(plugin: Plugin): void {
    const styles = new Map<Document, HTMLStyleElement>();

    function mount(document: Document) {
        if (styles.has(document)) return;
        const style = document.createElement('style');
        style.dataset.notebookNavigatorTopics = 'true';
        style.textContent = css;
        document.head.appendChild(style);
        styles.set(document, style);
    }

    mount(document);
    plugin.app.workspace.iterateAllLeaves(leaf => mount(leaf.view.containerEl.ownerDocument));
    plugin.registerEvent(plugin.app.workspace.on('window-open', (_, window) => mount(window.document)));
    plugin.registerEvent(
        plugin.app.workspace.on('window-close', (_, window) => {
            styles.get(window.document)?.remove();
            styles.delete(window.document);
        })
    );
    plugin.register(() => {
        for (const style of styles.values()) style.remove();
        styles.clear();
    });
}
