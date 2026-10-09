# Design and interaction guide

## Direction

A peaceful little world worth returning to each day: sage greens, warm parchment, muted gold, rounded surfaces, serif headings and compact sans-serif controls. The design should encourage one meaningful action without overwhelming the player. Keep the canvas world as the visual center and let progress be visible in the landscape and character.

## Current art

The map uses a 1100 × 720 logical canvas. app.js scales pointer coordinates to that space; retain this transform when changing the viewport. Island, trees, buildings and player art are canvas drawing helpers, while bot portraits and wardrobe details use inline SVG. Sprites are drawn in party.js after the base map. There are no separate raster assets to recover.

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
