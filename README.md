# Notebook Navigator Topics

Browse Obsidian notes as overlapping folder-like hierarchies based on their properties. See the [project objective](OBJECTIVE.md) and the [first-release plan](plans/first-release.md) for the original scope. The [native integration plan](plans/native-integration.md) maps the upstream components used by Topics. The [Topic Graph plan](plans/topic-graph.md) describes the proposed cycle repair view.

## Build and install

Use Node.js 24 LTS or a supported newer LTS release, Git, and tar. The source overlay targets Notebook Navigator `3.5.1` at commit `44215001884fa57351e6eb387355fbe5eb660975`. The build reads that commit from the upstream Git repository and removes the temporary source copy after building. By default, it looks for a sibling `notebook-navigator` checkout.

```sh
node scripts/build.mjs
node install.mjs "/path/to/your/vault"
```

Pass a different upstream source path to the build script if needed. Add `--offline` to use an already populated npm cache. The installer requires the supported stock Notebook Navigator `3.5.1` bundle in the vault’s default Obsidian configuration directory. Close Obsidian for installation or removal so it cannot update the plugin at the same time.

Open Obsidian and go to **Settings → Notebook Navigator → Navigation Pane → Topics**. Select **Add section** and set it up with a node filter, an optional leaf filter, and the relationship property. The filter syntax supports `property=value` and `OR`, as in `Typ=notatka OR Typ=osoba`. The relationship property holds a single internal link or a list of internal links to parents. For example, a child whose `Powiązane` list contains `[[Music]]` appears beneath Music.

Click a topic row to list its direct leaf notes in Navigator's file pane. Click the topic name to open its note, or the chevron to expand its children. Use Navigator's search bar, sort, and grouping controls within the selected topic. Right-click a node to hide it in its section. Use Navigator’s **Show hidden items** toggle or edit the section’s hide list to unhide it.

Click a section’s cycle warning to open **Topic Graph** in a separate tab. Notes with no parents share the leftmost column. Arrows run from parents to children. Highlighted arrows trace cycles, with curved links looping back. Hover over or select an arrow to remove its parent link. The graph opens in Full view. Click a note to center a view of that note and its immediate parents and children. Use **Back to full** to return to the whole graph or **Cycle view** to see just the cycles. **Fit graph** frames the current view. The section settings also open the graph. Shift-click a note to open it in a new tab. Drag a child note onto a parent to add the link.

On desktop, drop one or more Markdown notes onto a topic to append its link to the section's relationship property. Eligible notes keep their existing metadata. If a note needs a leaf requirement, Topics adds an unambiguous value or asks you to choose. It preserves conflicting scalar values and skips notes that are already topic nodes in that section.

Use the same search modifier as for tags (Cmd on macOS with the corresponding Navigator setting) to toggle a topic filter in the current list. Add Shift to combine topic, tag, and property operands with OR. Queries that also contain name, date, or path terms follow Navigator's standard mixed-filter behavior. Topic filters use Navigator's built-in filter search.

## Uninstall

```sh
node uninstall.mjs "/path/to/your/vault"
```

The script restores the exact backed-up `main.js` after verifying the installed expansion. Obsidian settings and notes, including any link edits you saved, stay in the vault. Topics settings are kept in `topics-settings.json` for future reinstalls.

If a script is interrupted and a subsequent invocation reports a vault lock, first verify that neither installer script is running. Remove only the `.notebook-navigator-topics-lock` directory inside the target plugin directory and retry. Keep the separate backup directory for restoration.

## Tests

```sh
node scripts/build.mjs --upstream-tests
node --test tests/installer.test.mjs
```

Use `--test` for the Topics suite alone. Set `TOPICS_DEV_VAULT` to run the optional read-only graph check against a development vault. The installer suite copies the stock plugin into disposable vaults and cleans them up. By default, it uses the sibling `dev-vault` as the source for the stock plugin files. Set `TOPICS_STOCK_PLUGIN` to use another directory containing the stock `3.5.1` assets.

## Upstream source

Notebook Navigator is by Johan Sanneblad. This project builds a modified version through a source overlay. The pinned upstream source and its license are available in the [Notebook Navigator repository](https://github.com/johansan/notebook-navigator/tree/44215001884fa57351e6eb387355fbe5eb660975). See [LICENSE](LICENSE).
