# Reki performance and ordinary-user usability design

**Date:** 2026-07-27
**Scope:** Keep the approved silver-mist / yolk-yellow look and the existing feature set. Make animation preview responsive and reduce first-use friction without changing export fidelity.

## Evidence

- In a real front-end browser run, the current preview loop writes `motionTimeMs` to `Workbench` state on every `requestAnimationFrame`. A single glitch layer measured about 29 ms per frame, with roughly 2.6 seconds of script work in a 3-second sample.
- Every tick reaches the complete workbench tree and every canvas layer. Static markers rebuild even when they do not animate.
- Repeated local-fragment slider values create cached canvases without a per-image bound.
- The mobile breakpoint removes the only original-comparison control. Path creation also has no visible in-progress guide.

## Chosen interaction and performance model

1. **One lightweight preview clock.** Keep the exact clock in a ref. Publish display/canvas time at a capped 30 fps, which is sufficient for the intended short stylised preview and halves React work before layer-level optimisations. Scrubbing remains immediate. The exported video/GIF remains on its existing full rendering path and is not reduced.
2. **Only animated layers repaint.** Memoize canvas nodes with a semantic comparison: a static layer ignores preview-time changes; an animated layer receives them. Selection, source, geometry, styles, effects, and image changes still repaint normally.
3. **Bound expensive local previews.** Use a small per-source LRU cache for effected fragment canvases. Touch cache entries on reuse and evict the oldest after a fixed entry/byte budget. No effect is silently added or changed.
4. **Progressive disclosure for motion.** A static layer shows the animation choice and a compact explanation first. Detailed duration/delay/loop/amplitude/direction controls appear only after an animation is selected. This avoids presenting seven irrelevant controls to a first-time editor.
5. **Make creation state explicit.** While drawing a node path, show a red draft line plus a concise visible helper. `Enter`/double-click completes; `Escape` cancels the draft instead of merely clearing selection.
6. **Keep essential mobile actions available.** Add an accessible original-comparison action to the mobile dock; the compact top control remains available instead of being entirely hidden. Rename the generic export entry point to `导出` while retaining format-specific confirmation labels.
7. **Use human-facing layer vocabulary.** Replace internal type identifiers with short Chinese type labels in the layer list and inspector badge.
8. **Respect reduced-motion preference.** Changing a layer’s animation does not auto-play where the operating system asks for reduced motion. Users can still explicitly press Play, and exports are unchanged.
9. **Release memory after comparison.** Only mount the original-comparison pane while it is visible, so closing it releases its rendered side-by-side surface.

## Acceptance criteria

- Animation preview has no console errors; React time updates are capped at 30 fps and do not update static annotation or fragment nodes on timeline-only ticks.
- Local fragment preview cache evicts least-recently used generated canvases beyond the configured budget.
- Static and motion export behaviour remains unchanged, and the full test suite passes.
- Original comparison is reachable on mobile, path creation visibly communicates draft/completion/cancel behaviour, and layer labels are understandable without knowing internal IDs.
- Browser smoke test verifies a glitch preview no longer regresses the measured 3-second frame cadence and stays responsive enough for direct manipulation.
