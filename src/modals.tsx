import { Modal, type TFile } from 'obsidian';
import { type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { TopicsController } from './controller';
import type { TopicRequirement } from './graph';

class TopicsModal extends Modal {
    private root?: Root;

    constructor(
        controller: TopicsController,
        private readonly title: string,
        private readonly render: (close: () => void) => ReactNode,
        private readonly onDismiss?: () => void
    ) {
        super(controller.app);
    }

    onOpen(): void {
        this.setTitle(this.title);
        this.contentEl.classList.add('nn-topics-modal');
        this.root = createRoot(this.contentEl);
        this.root.render(this.render(() => this.close()));
    }

    onClose(): void {
        this.root?.unmount();
        this.root = undefined;
        this.onDismiss?.();
    }
}

export function chooseTopicLeafRequirement(
    controller: TopicsController,
    file: TFile,
    choices: TopicRequirement[]
): Promise<TopicRequirement | null> {
    return new Promise(resolve =>
        new TopicsModal(
            controller,
            'Choose a leaf requirement',
            close => (
                <>
                    <p>{file.basename}</p>
                    <div className="nn-topics-actions">
                        {choices.map(choice => (
                            <button
                                key={JSON.stringify(choice)}
                                type="button"
                                onClick={() => {
                                    resolve(choice);
                                    close();
                                }}
                            >
                                {choice.key}={choice.value}
                            </button>
                        ))}
                        <button type="button" onClick={close}>
                            Skip note
                        </button>
                    </div>
                </>
            ),
            () => resolve(null)
        ).open()
    );
}
