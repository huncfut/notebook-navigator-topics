import type { App } from 'obsidian';
import type { MetadataService } from '../services/MetadataService';
import { reportTopicsError } from './controller';

export async function openTopicIconEditor(
    app: App,
    metadataService: MetadataService,
    title: string,
    defaultIcon: string,
    customIcon: string | undefined,
    save: (icon: string | null) => Promise<void>
): Promise<void> {
    const { AppearanceModal } = await import('../modals/AppearanceModal');
    new AppearanceModal(app, {
        title,
        metadataService,
        initialTab: 'icon',
        defaultIcon,
        icon: {
            initial: customIcon ?? null,
            apply: async icon => {
                try {
                    await save(icon);
                } catch (error) {
                    reportTopicsError(error);
                    throw error;
                }
            }
        }
    }).open();
}
