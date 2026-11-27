# Topic icons

Tracked in [issue #4](https://github.com/huncfut/notebook-navigator-topics/issues/4).

## Goal

Configure Topics icons independently of folder icons and make individual topics visually recognizable.

## Changes

- Add Topics settings for icon visibility, the default icon, and using node-note icons. Use a network icon as the built-in default and leave node-note icons opt-in.
- Reuse Navigator’s appearance editor from the Topics settings page and the topic node context menu. Allow a custom icon for each node within a section and let users clear it to return to the configured fallback.
- Resolve the icon in this order when icons are enabled. Use the topic override, the node note’s Navigator icon when enabled, then the Topics default. Use the same icon in the navigation row and the selected topic’s list header. Preserve overrides across note renames and folder moves.

## Verification

- Check settings saved before icon preferences existed, icon precedence, repeated occurrences of a node, section isolation, and renaming a note with an override.
- Run the pinned Notebook Navigator code tests and the installer suite against a disposable vault. The user handles in-app checks.
