# Design and interaction guide

## Direction

A peaceful little world worth returning to each day: sage greens, warm parchment, muted gold, rounded surfaces, serif headings and compact sans-serif controls. The design should encourage one meaningful action without overwhelming the player. Keep the canvas world as the visual center and let progress be visible in the landscape and character.

## Current art

The world is rendered in 3D by `public/game/world3d.js` (three.js, vendored under `public/game/vendor/three`). Game logic still lives on the 1100 × 720 logical map: app.js moves `state.position` in logical units and the save format is unchanged. world3d.js maps that map to metres (`toW`/`toL`, 0.08 m per unit), turns keyboard movement relative to the camera, keeps the avatar out of buildings, trees and the sea, and raycasts clicks back to logical coordinates. The 2D canvas helpers in app.js/party.js remain as the fallback when WebGL2 is unavailable.

Everything is generated in code: a heightfield island with flattened pads under each landmark and dirt paths from camp, a depth-tinted water shader with shoreline foam, a sky shader with clouds that also lights the scene through an environment map, instanced grass, flowers, trees, bushes and rocks with wind, eight landmarks built from primitives with procedural stone, roof and wood textures, and cel-shaded characters with ink outlines built as skinned meshes. Normal mode is a clear afternoon; Recovery mode turns the world to dusk with lanterns and fireflies. Locked areas sit behind a shimmering barrier until their level.

Where to tune things in world3d.js:

| Change | Look for |
| --- | --- |
| Time-of-day colours, sun, fog, bloom | `PRESETS` |
| Landmark placement, pad size, label height | `SITES` |
| A landmark's model | `buildSite()` |
| Terrain shape and colours | `rawHeight()` and the terrain colour block in `start()` |
| Tree, bush and rock shapes | `treeGeometry()`, `rockGeometry()` |
| Character outfits and hair | `lookFor()`, `PLAYER_LOOK`, `hair()` |
| Density per device | `Q` quality tiers (phone, tablet, desktop); resolution also adapts to the frame rate |

When the local design server runs, `window.world3d` exposes the scene, camera and presets in the browser console for inspection.

## Characters

| Character | Place | Role |
| --- | --- | --- |
| Jane | Camp | Life guide |
| Lelouch | Camp | Master orchestrator |
| Carmy | Work citadel | Work guide |
| Gilfoyle | Engineering forge | Engineering guide |
| Goggins | Grove | Training and recovery guide |
| Beth | Tower | SPM study guide |
| Beatrix | Temple | Claude architecture guide |
| Dexter | Lab | Automation guide |

Characters connect to the quests in their area. The Party roster displays all eight, while interactions in locked areas follow level requirements. Dialogue is authored text rather than live AI output.

## Responsive review

Inspect approximately 360px, 768px and 1440px widths. Check navigation wrapping, Party cards, map labels, modal scrolling, touch controls, and short-height landscape screens. Preserve visible focus, readable contrast, non-hover access to actions, reduced-motion travel, and mobile device backup/export controls. Don’t turn the world into an image: avatar movement and NPC interaction must remain functional.

## Safe places to begin

Adjust colors, spacing and typography in style.css; improve map buildings and player art in app.js; customize each bot's sprite/portrait in party.js; revise titles and descriptions in data.js without changing IDs. The current implementation is intentionally small and mostly vanilla JavaScript inside a Next.js shell.
