import { uninstall, runVaultCommand } from './scripts/plugin-files.mjs';

await runVaultCommand(uninstall, 'uninstall');
