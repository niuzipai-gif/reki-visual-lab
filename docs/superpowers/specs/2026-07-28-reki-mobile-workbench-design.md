# Reki Mobile Workbench Interaction Design

## Goal

Make the mobile workbench feel like a focused image editor: the photo should be large enough to edit, drawing mode should be easy to leave, and compact menus should not hide most of the canvas.

## Evidence and scope

The 390 × 844 mobile audit showed three primary friction points:

1. The shared default zoom of 72% leaves a portrait 4:5 canvas surrounded by a large unused dark area.
2. After choosing a drawing tool, returning to selection requires reopening the tool sheet and choosing "选择" again.
3. The tools and presets sheets use the same tall, resizable 62vh presentation as AI and the inspector, leaving large empty space while obscuring the canvas.

This change is limited to the mobile presentation. Desktop panel behavior, existing canvas tools, AI scan, effects, layers, comparison, animation, and export contracts stay intact.

## Interaction decisions

### Canvas-first default

`Workbench` starts at 100% zoom when the viewport matches the existing 759px mobile breakpoint. Desktop retains its current 72% default. The mobile fitted canvas therefore uses the available width instead of presenting a deliberately shrunken image.

### Direct return to selection

The mobile dock replaces its duplicate "预设" entry with a direct "选择" action. Presets remain available in the persistent top quick-preset strip, so no capability is removed. Tapping "选择" sets the active tool to `select` and closes any mobile sheet in the same action. The button exposes selected state when the select tool is active.

### Dense sheets stay compact

The "工具" and "预设" sheets are marked compact. They render at 44vh, omit the resize handle, and retain the explicit close button. Their content already fits at that height; reserving the full inspector height is unnecessary. AI, style, and layers retain the existing adjustable height so long forms and layer stacks remain usable.

## Component boundaries

- `src/Workbench.jsx`: owns the responsive initial zoom and connects the dock's direct-selection event to editor state.
- `src/components/BottomDock.jsx`: renders the selection action and removes the redundant dock preset entry.
- `src/components/BottomSheet.jsx`: exposes a compact sheet variant without changing non-compact sheets.
- `src/styles.css`: applies mobile-only compact sheet geometry and preserves the existing desktop layout.

## Verification

- Unit test the dock selection action and comparison access.
- Workbench tests prove mobile zoom starts at 100%, direct selection closes a tool sheet, and compact tool/preset sheets do not present a resizer.
- Run all Vitest tests, the production build, and the Sites worker tests.
- Re-open the demo workbench at 390 × 844 and verify the initial canvas, tool picker, direct selection, AI panel, layers panel, comparison, and export entry.
