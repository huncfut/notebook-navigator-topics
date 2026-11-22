# Notebook Navigator Topics objective

Notebook Navigator Topics lets Obsidian users browse their notes by relationships stored in note properties. Notes can stay in their existing folders while the same file appears under several topics. This gives users folder-like navigation for a knowledge base organized through links.

Users define independent sections for different ways of browsing the same vault. Each section specifies which notes act as expandable topics, which act as leaf notes, and which property lists a child note’s parents. For example, one section can organize concepts and their related notes, while another organizes people by the organizations they work for.

The underlying model is a directed graph intended to be acyclic. The navigation presents it as a tree in which a note can appear along multiple paths. Each occurrence refers to the same Obsidian note. Root topics, nested topics, and leaf notes should feel familiar to people who already use Notebook Navigator’s folders and file list.

The extension helps users maintain that hierarchy as it changes. It identifies cycles, surfaces the notes and links involved, and lets users repair the relationships from within Obsidian. Users can save intermediate changes during a reorganization and continue browsing while resolving a cycle.

Notebook Navigator Topics is an independent extension with version-matched, reversible installation. Its project files live in the expansion repository, and the upstream Notebook Navigator source checkout stays read-only.

See [PLAN.md](PLAN.md) for the approved first-release scope and verification steps.
