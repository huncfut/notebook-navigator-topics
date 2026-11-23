# Topic Graph cycle repair

This plan is tracked in [issue #3](https://github.com/huncfut/notebook-navigator-topics/issues/3). The layout revision below is approved.

## Goal

Show which parent links make a Topics section cyclical and let users remove those links directly from the graph.

## Proposed changes

- Open the affected section in a dedicated Obsidian workspace tab from the Navigator warning, section menu, or Topics settings. Use Notebook Navigator's settings-row and button conventions for the Topics settings controls.
- Draw topic nodes as labeled vertices, with arrows pointing from child to parent. Center the graph on the detected cycles when it opens and keep them in focus as depth changes. Use a distinct theme-aware color for cycle nodes and arrows. Support self-loops, reciprocal links, and multiple disconnected cycles. Omit leaf notes and their links at every depth.
- Provide a depth slider with four stops. For depths 1 and 2, follow incoming and outgoing links while preserving the direction of the arrows.

| Depth | Visible topic nodes and links |
| --- | --- |
| **0** (default) | Cycle nodes and the links that participate in cycles. |
| **1** | Cycle nodes, every link touching them, and those links’ other endpoints. |
| **2** | Depth 1 plus every link touching its newly visible neighbors and those links’ other endpoints. |
| **Full** | All topic nodes and links in the section, including disconnected and isolated nodes. |

- Reveal **Remove link** on edge hover and keyboard focus, with a selection action for touch. Save changes to the child note’s configured relationship property and refresh the graph and Navigator warning. Preserve note opening and the existing add-link workflow, including its warning when a new link would create a cycle.
- Reuse the Topics graph and controller, Navigator warning entry points, and Notebook Navigator’s workspace and settings patterns. The pinned Navigator source has no graph renderer. [Obsidian’s core Graph View has no supported custom rendering API](https://forum.obsidian.md/t/graph-rendering-api/73378), so use a dedicated renderer with pan, zoom, and fit controls.

## Layout revision

- Arrange links from left to right, keeping children on the left and parents on the right. Use the existing cycle groups as blocks when assigning columns so every link between blocks flows forward. Keep connected branches together and stack disconnected groups vertically.
- Lay out the members of each cycle in a consistent order. Give returning links, reciprocal links, and self-loops distinct curved paths so users can identify and select each arrow. Keep label boxes clear of the arrow paths where links cross intermediate columns.
- Replace circles and separate labels with rounded, softly filled cards using Obsidian theme colors. Use smooth curves and rounded line caps, with a distinct theme-aware highlight for cycle cards and arrows.
- Keep node positions stable across depth settings. Preserve cycle centering, pan, zoom, fit, and the existing link-edit interactions.

## Verification

- Cover all four depth stops, traversal in both directions, exclusion of leaf notes, and inclusion of disconnected topic nodes at Full.
- Cover multiple cycles, self-loops, and reciprocal links. Verify that removing a link updates the stored property and the cycle warning, and that adding a link still checks for cycles.
- Check that links between cycle groups and ordinary nodes always point right, including shared parents and disconnected branches. Check that node positions are deterministic, cards do not overlap, and reciprocal and self-loop paths have separate action targets.
- Run the focused, upstream, and installer suites against pinned Notebook Navigator 3.5.1 using disposable copies. The user handles manual checks in Obsidian.

## Node editing and crossing reduction

- Replace **Manage parent links** with an editor bound to the selected node. Show the section's configured relationship property and its stored values, including unresolved links and links to notes outside the section. Support adding, editing, and removing individual entries, with Save and Cancel. Preserve unrelated frontmatter and untouched values, and detect concurrent property edits before saving. Reuse Topics link parsing and controller persistence, including confirmation when a change introduces a cycle.
- Click a node to select it and Shift-click to open its note in a new tab. Make selection and opening available from the keyboard. Keep selection distinct from a drag through a movement threshold.
- Drag A onto B to append a parent link to B on A while keeping A's other parents. Use the same controller operation as existing link edits. Clear drag feedback on cancel or drop outside a target, ignore self-drops, and avoid duplicate links. Refresh the property editor, graph, and Navigator warning after saving.
- Add a Sugiyama-style crossing-minimization pass to the existing layered layout. Sweep in both directions using the median positions of connected neighbors, then try adjacent swaps. Keep cycle blocks together and account for long links as they pass through intermediate columns. Compare the candidate against the current ordering with a crossing count and keep the better result, with deterministic ties. Compute the layout once for all depth settings so changing depth keeps existing node positions.
- Verify populated and empty property editing, scalar and list values, unresolved links, concurrent updates, cycle confirmation, and drag direction and deduplication. Add a layout fixture with avoidable crossings and verify that it improves while preserving cycle behavior, card clearance, and depth stability. Run the code-based checks listed above.

References: [ELK layered layout](https://eclipse.dev/elk/blog/posts/2025/25-08-21-layered.html) and [Eades and Wormald on the median heuristic](https://doi.org/10.1007/BF01187020).

## File Properties styling

- Replace the bottom editor's stacked inputs with a compact property row. Show the selected note in the panel header, put a type icon and the configured property name on the left, and show the value on the right. Render lists as wrapping chips with inline edit and remove actions and an inline add control. Render an existing scalar as a single value. Offer a stacked layout when the pane is too narrow for both columns.
- Reuse Obsidian's Properties and multi-select theme variables, Notebook Navigator's Obsidian icon component, and its file path suggestion helpers with the public Obsidian suggestion popover. Convert picked files to links through Obsidian's link generator. Keep the graph panel's controls scoped to its relationship property and keep typed and unresolved links editable.
- Show Save and Cancel only while editing. Keep the shared frontmatter save, stale-edit detection, and cycle confirmation. The public API exposes the building blocks and frontmatter access. Embedding Obsidian's complete File Properties widget would require private internals.
- Verify scalar and list markup, chips and their accessible actions, the empty state, and draft persistence. Cover keyboard controls and link generation in code-based tests. Run the existing build and test suites using disposable copies without opening Obsidian.
