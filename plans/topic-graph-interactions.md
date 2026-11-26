# Topic Graph interaction updates

Tracked in [issue #7](https://github.com/huncfut/notebook-navigator-topics/issues/7).

## Goal

Make the current graph mode easy to identify and let a node drop add or remove its parent relationship.

## Changes

- Move Full graph and Cycle view into an icon group inside the graph. Show the active mode, make Cycle view visibly unavailable when the section has no cycles, and give both controls accessible names and tooltips.
- Drag a child onto a parent to add the relationship when absent or remove it when present. Use the existing frontmatter update and cycle confirmation flow.
- Keep edge removal available and give a drop target feedback about the action it will perform.

## Verification

- Cover graph mode controls, directed relationship toggling, and the existing cycle confirmation flow.
- Run focused and full upstream tests against pinned Notebook Navigator 3.5.1 with the read-only development vault fixture.
