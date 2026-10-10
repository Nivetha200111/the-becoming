# Design and interaction guide

## Direction

A peaceful little world worth returning to each day, styled as Renaissance × Genshin × Studio Ghibli:

- **Renaissance:** illuminated-manuscript parchment, gold-leaf frames with corner ornaments, lapis-ultramarine panels, Cinzel inscriptional caps and Cormorant Garamond prose, Tuscan cypress trees and a warm varnish vignette on the 3D scene.
- **Genshin:** gilded pill buttons, waypoint-style area tiles, character cards with a coloured banner and stars, rarity stars on quests, and the dark notice band for toasts.
- **Ghibli:** soft painted skies, lush meadows, warm lantern light and calm pacing.

The tokens live at the top of `style.css` (`--paper`, `--lapis`, `--gold`, `--display`, `--serif`, `--ui`). Fonts come from Google Fonts and fall back to Georgia and the system sans-serif. The design should encourage one meaningful action without overwhelming the player. Keep the world as the visual center and let progress be visible in the landscape and character.

3D labels are laid out each frame in `layoutLabels()` in world3d.js: the most important and nearest labels go first. Any label that would cover another label or the map controls lifts or slides aside, and fades out only when there is no room.

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

## Beyond the sea

Four realms sit across the Sea of Possibility, each built in `world3d.js` by its own builder (`buildFlorentia`, `buildSkyGarden`, `buildBathhouse`, `buildStarfall`) and listed in `REALMS`:

| Realm | Mood | Things to do |
| --- | --- | --- |
| Florentia | Renaissance city: duomo, bell tower, loggia, fountain, cypress avenue, vineyard | Paint at the easel (the canvas fills in as she paints), rest by the fountain |
| The Sky Gardens | Floating ruins above the clouds, waterfalls, a mossy stone gardener | Meditate at the overlook, watch the clouds |
| Lantern Bathhouse | Red lacquer bathhouse, koi pond and bridge, hot spring, sea train | Soak in the hot spring |
| Starfall Shrine | A waypoint statue, floating crystal, glowing lilies | Make a wish, rest by the waypoint |
| Kobra Kai | The LeetCode dojo: black-and-gold hall, cobra statues, training yard, Sensei Fletcher | Grind LeetCode at the laptop desk, train kata on the mat |
| Hush Hollow | A quiet wood under an orange-pink sky, full of cats, dogs and butterflies | Scroll her phone on the picnic blanket (the animals gather round), sit by the pond |

Realms reuse the logical 1100 × 720 coordinate space (550, 360 is a realm's centre), so app.js movement and saving work unchanged. Board the sky ferry at the pier, or use the "Beyond the sea" cards under the area list, and it flies her there. Areas, guides and "Return to camp" sail her home automatically. Realms are places to wander, not XP sources.

## Nivetha and Mochi

Nivetha has a gold flower hairpin, earrings, a side braid, a sash and satchel, and gold trim on her cloak. Every character blinks, and expressions (`happy`, `closed`, `wide`) shape the eyes and mouth. Her activities live in `ACTS`: each one is a pose blended over the walk cycle, plus optional props, effects and an emote. Every unlocked landmark and every realm has a ✦ spot, and she does the matching activity there (anvil, ledger, book, training, meditation and so on). When left idle she stretches, hums, looks around, pets Mochi, yawns at night and eventually sits down. She cheers when a quest is claimed or a treasure is redeemed, gets a light pillar on level-up, and twirls in a new cloak. The action bar under the map has Wave, Cheer, Dance, Sit, Stretch and Pet Mochi (keys 1–6). Mochi, her cat, follows her, sits when she stops and closes her eyes when petted.

## Movement

Walls, fences, statues and fountains are traced from the landmark geometry into a 25 cm collision grid (`collisionMask`). Click-to-travel uses A* on that grid (`findPath`) and never teleports through things. Conversations end with the Leave button, Esc, or by walking away.

## The Treasury

Gold is the real-life reward currency, derived from claimed quests in `engine.js`: 40 gold per XP, boss battles ×1.5, +5% per day of an unbroken streak (up to +50%). Tiers: Common (any level), Rare (level 2), Epic (level 4), Legendary (level 6) and Mythic, which stays sealed until the `offer-40lpa` milestone quest is claimed (+1,500,000 gold). Redemptions are stored in `state.rewards`, an optional array that keeps save version 1 compatible. Catalogue prices live in `TIERS`, and changing one invalidates redemptions saved at the old price.

Kobra Kai: tap ⚔ LeetCode in the action bar, choose "I'm doing LeetCode" when talking to Gilfoyle, or accept a LeetCode quest. Gilfoyle calls her over and the ferry takes her to the dojo, where she sits down at the desk. Sensei Fletcher offers a problem, kata or today's LeetCode quest. A realm can set its own sky (`R.sky`), which `applySky` blends in while she is there. Hush Hollow uses this for its permanent golden hour.

Saves: Treasury redemptions are also packed into hidden `custom-reward-*` custom quests by `lib/save-store.mjs` on every write and unpacked on every read. They therefore survive even a save backend that drops unknown fields, which `tests/treasury.test.mjs` covers.

## Veer

Veer is Nivetha's Kombai: a tan-red coat, black muzzle, folded rose ears, a curled tail, and a red collar with a gold tag. He is built with `makeDog(..., { muzzle, ears: 'rose', collar, scale })` and driven by `veerFrame()`. He follows on her right everywhere, including the realms and the ferry. When she stops he sits and looks up at her, and when she sits down (rest, campfire, phone, meditation, LeetCode) he lies down with his head on her lap. "Pet Veer" (key 6) gives him a cuddle, and Mochi can still be petted by clicking her. He also appears in her portrait.

## Full screen

The ⛶ button on the map (or F with the map focused) puts the world in full screen. It uses the browser Fullscreen API on `.world-frame` and falls back to a fixed overlay (`.immersive`) where that API is missing, such as on iPhones. While full screen is on, the action bar and toasts move inside the frame as a compact overlay, and quest scrolls mount inside it. Esc or the button exits. The Next.js iframe allows `fullscreen`.

## Character motor and companion placement

`physics.js` owns movement at 120 fixed steps per second: acceleration, braking, swept body footprints, wall sliding, terrain slope limits and gravity. Shift runs, Space jumps, and touch players have a Jump button. `app.js` hands movement to the 3D motor while WebGL is active; the renderer never corrects a second movement simulation. Travel callbacks run only on actual arrival. Paths use the same body footprint as movement.

Veer and Mochi use collision-aware follower motors and choose clear resting footprints. Veer rests beside Nivetha during LeetCode rather than targeting the desk or laptop. Both pets re-anchor at realm arrival and board the ferry in distinct positions.

## Arena outfits

`outfits.js` defines fourteen outfits, one per home arena and overseas realm. Auto dress chooses the current realm or nearby unlocked area. The Wardrobe also lets Nivetha pin any outfit or return to automatic dressing. Outfits have different silhouettes (gi, apron, coat, yukata, running kit and robes), and changing clothes preserves expressions, activity props and the earned cloak colour.

## Chat and fullscreen

Chat opens from the top navigation, the world action bar or a guide's conversation. The dialog uses plain-text message rendering and remains inside the fullscreen world. Fullscreen also keeps settings and quest dialogs accessible and handles rapid repeated toggles. Chat is a Notion mailbox for the actual existing Grok bots, with no paid AI API calls. Messages wait for a matching bot Reply and unavailable connections do not show pretend replies.

Companions use conservative circular bounds for the whole visible animal through turns and resting poses. Each pet sweeps against the player and peer, restores separation if the player walks into it, and leaves extra space for seated activities. Their sky ferry has a wider deck so the side-by-side formation stays aboard.
