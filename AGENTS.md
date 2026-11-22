# Notebook Navigator Topics

## Workspace boundaries

- Treat the sibling `../notebook-navigator/` repository as strictly read-only. Never modify its files or Git state, install dependencies there, or run commands that generate files there. If a build needs to modify upstream source, copy it into this repository first.
- Keep project source, scripts, documentation, and build output in this repository. Use the sibling `../dev-vault/` as a read-only fixture for automated tests. The installer and uninstaller may write only to the installed Notebook Navigator plugin directory in the vault supplied explicitly to the script. Preserve vault notes and plugin settings.

## Language

- Use English for all project work, including plans, code, comments, documentation, script output, commit messages, GitHub issues, and pull requests. The Polish notes and files in the development vault are test data. Preserve their language and contents.

## Planning and GitHub workflow

- Define the goal, proposed changes, and verification steps in a plan. Use a GitHub issue to track the work and get the user's approval before implementing any change or fix. If the plan changes materially, get approval for the revised plan before proceeding.
- Create one branch per approved issue from `main`. Use names such as `feat/12-topic-tree` and `fix/18-uninstall-version-check`. Follow the testing approach below and link the pull request to the issue.
- Keep `main` as the reviewed branch and use pull requests to merge into it. For an empty repository, prepare the initial commit on `chore/bootstrap` and establish `main` from the approved commit.

## Notebook Navigator integration

- Before implementing comparable behavior for Topics, trace how folders, tags, or properties implement it in the pinned Notebook Navigator source. Identify the relevant structures, classes, functions, and the data flow from the user interaction through state to rendering or persistence.
- Integrate Topics into the existing components, data models, hooks, and handlers. Reuse Navigator's navigation rows, selection and file-list pipelines, search parsing and highlights, drag-and-drop dispatch, and theme classes wherever they fit. Extend the shared entry points so Topics follows the same settings, gestures, and presentation as comparable Navigator features.
- Keep Topics-specific code focused on its own data and behavior, such as the topic graph and leaf requirements. Apply upstream changes through the project's overlay against the pinned source in a disposable checkout.

## Testing approach

- Run code-based tests only. The user handles manual checks in Obsidian. Use disposable vaults for any tests that write files.
- Run focused Topics tests while iterating with `node scripts/build.mjs --test`. Before handing off a change to the plugin, run `node scripts/build.mjs --upstream-tests` against the pinned Notebook Navigator version. Set `TOPICS_DEV_VAULT` to the development vault path when the read-only graph check applies.
- Run `node --test tests/installer.test.mjs` after building when verifying installation, removal, or a bundle intended for installation. Cover changes to shared entry points through the existing upstream suite and add targeted regression tests where the existing suite misses the behavior.

## Installation and versioning

- Provide separate install and uninstall scripts. Each takes a vault path explicitly and targets its `.obsidian/plugins/notebook-navigator/` directory.
- Match each expansion release to the exact upstream plugin version and tag it `v<upstream-version>`. For example, expansion release `3.5.1` targets Notebook Navigator `3.5.1`.
- Before replacing files, the installer must verify the plugin ID, exact version, and supported build, then back up the original files it will replace.
- Before restoring the originals, the uninstaller must verify that the files it will replace or remove belong to the installed expansion. Both scripts must stop before making changes if their checks fail, including when Notebook Navigator has been updated since installation.
