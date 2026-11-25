# Topics settings layout

Tracked in [issue #4](https://github.com/huncfut/notebook-navigator-topics/issues/4).

## Goal

Give Topics its own page in Notebook Navigator’s Navigation Pane settings, using the same settings framework as Folders & folder notes and Tags & properties.

## Changes

- Add Topics as the last page in the Navigation Pane group in `SettingsPaneDefinitions.ts`. Let Notebook Navigator render and index the page through its existing settings tab.
- Use native setting rows for the global Topics folder toggle and note-opening dropdown. Save through the existing Topics controller and keep the settings file compatible with existing vaults.
- Follow File operations & templates → Commands for the section list and individual section editors. Share the list styling, use Obsidian `Setting` controls in the editor, and keep section-specific actions, including Topic Graph, on each row.
- Route the Topics tree settings shortcut through Notebook Navigator’s existing settings entry point.

## Verification

- Check that the native page is last in Navigation Pane and contains the two global controls and the Sections row.
- Verify that section saves and removals target the correct section, invalid settings are rejected, and concurrent updates to other sections or global preferences are preserved.
- Run the focused and upstream suites against pinned Notebook Navigator 3.5.1 and the installer suite against the resulting bundle. The user handles in-app checks.
