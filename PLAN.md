# Notebook Navigator Topics first-release plan

Approved scope for Notebook Navigator `3.5.1`. See [OBJECTIVE.md](OBJECTIVE.md) for the extension’s long-term objective.

## 1. Configure topic sections

- Allow users to create multiple independent sections. Each section has a name, a node filter, a leaf filter, and a relationship property.
- Support filters in the form `property=value` with conditions joined by `OR`. A note that matches both filters is a node.
- Read parent links from the child note’s configured relationship property. If Audio lists Music as a parent, Audio appears beneath Music. A node can appear under every matching parent in the section.

| Example section | Node filter | Leaf filter | Relationship property |
| --- | --- | --- | --- |
| Koncepty | `Typ=koncept` | `Typ=notatka OR Typ=osoba OR Typ=myśl` | `Powiązania` |
| Organizacje | `Typ=organizacja` | `Typ=osoba` | `Pracuje w` |

Use `Powiązane` when verifying against the development vault’s existing notes. The example property names are user configuration.

## 2. Browse topics in Notebook Navigator

- Show nodes in the left navigation tree. Place nodes with no matching parent at the section root and allow nesting through multiple levels.
- List a selected node’s direct leaf notes in the right pane, following folder browsing. A leaf with multiple matching parents appears in each parent’s list. A leaf without a matching parent stays out of the section.
- Make the node name open its underlying note, following Notebook Navigator’s folder-note behavior. Provide an opening preference for the current tab or a new tab.
- Enable **Show Topics folder** by default. With the setting enabled, group the sections under the collapsible **Topics** folder. With it disabled, show the sections at the top level.
- Provide a per-section hide list and **Hide / Unhide** context-menu actions. Hiding a node applies to all its occurrences in that section. Use Notebook Navigator’s **Show hidden items** control to expose hidden nodes for unhiding.

## 3. Detect and repair cycles

- Detect existing cycles, including cycles introduced by edits in Obsidian’s Properties editor. Show clickable warnings on the affected section’s root entry and in its settings. Both open the same repair tool.
- List the notes and links involved in each detected cycle. Let users open the notes and add or remove parent links in the section’s configured relationship property.
- Warn before saving a link that would create a cycle, and let the user save after the warning. This supports rearranging a hierarchy across several edits.
- Keep the section browsable by omitting relationships that participate in cycles from the displayed hierarchy while preserving the affected notes and their other relationships. The display leaves the stored links intact until the user edits them.

## 4. Build and install

- Build in the expansion repository and treat the sibling `notebook-navigator/` checkout as read-only. Match the expansion version to Notebook Navigator `3.5.1` and tag the release `v3.5.1`.
- Provide separate install and uninstall scripts. Each requires a vault path and targets `.obsidian/plugins/notebook-navigator/` in that vault.
- Before writing, the installer verifies the plugin ID, exact version, and supported build, then backs up the files it will replace. The uninstaller verifies the expansion’s installed files before restoring the originals. Both stop when verification fails, including after an upstream plugin update. Preserve vault notes and plugin settings during installation and removal.

## 5. Verify and track the release

- Use the existing `Powiązane` data in `dev-vault` and dedicated test notes to verify independent sections, deep nesting, multiple parents, node priority, root placement, and the exclusion of unlinked leaves.
- Verify the folder toggle, node-note opening in both tab modes, right-pane leaf lists, and section-wide hide and unhide behavior across multiple branches.
- Verify the warnings and repair tool with an existing cycle and a cycle introduced in Obsidian. Confirm that a warned edit can be saved, that the tree remains usable, and that repairing the cycle clears the warnings.
- Check that installation rejects an incompatible version or unsupported build, uninstall restores the original plugin files, and uninstall refuses to overwrite a newer upstream installation. Verify that the scripts preserve notes and settings.
- Track implementation in GitHub issues. Use issue branches from `main` and link each pull request to its issue. Get approval for material changes to this plan before implementing them.
