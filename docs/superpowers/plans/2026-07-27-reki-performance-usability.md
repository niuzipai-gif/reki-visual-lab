# Reki performance and usability implementation plan

> User pre-authorised direct scoped improvements. Implement in small verified tasks while preserving current visuals and feature coverage.

1. Add failing tests for the preview clock cap, static-node memo behaviour, LRU fragment cache, mobile comparison access, path draft feedback, copy changes, and reduced-motion playback.
2. Isolate/cap the animation-preview update loop; memoize canvas nodes and bound the fragment preview cache. Run the focused canvas/motion tests, then performance smoke test in a real browser.
3. Improve ordinary-user flow: compact static-motion inspector, visible path draft helper and cancellation, comparison action on mobile, Chinese layer type labels, accurate export wording, and comparison pane unmount. Run focused component tests.
4. Audit all existing flows: import/replacement, markers, extraction/source holes, effects, animations, undo/redo, comparison, export variants, AI guidance. Run full tests, build, Sites verification, browser smoke, push, and deploy.

## Files expected to change

- `src/Workbench.jsx`, `src/features/canvas/EditorCanvas.jsx`, `src/features/canvas/AnnotationNode.jsx`, `src/features/fragments/FragmentNode.jsx`, `src/features/fragments/fragmentComposite.js`
- Motion, tool, export, mobile dock components and their tests
- `src/styles.css`, `AGENTS.md`, this plan and design record

## Verification commands

Run `npm test -- --run`, `npm run build`, `npm run test:sites`, and `git diff --check`.
