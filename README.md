# Screenly

*A little life on your desktop.*

**The name:** *Screen* + *-ly*, the English ending that turns a thing into a quality, as in *lively* or *friendly*. Screenly is what your screen becomes when characters live on it: lively. The characters belong to the screen, standing on your windows, hanging from the top edge and walking along the Dock.

Screenly puts animated animals and your own characters on your Mac. They walk along the bottom of the screen, hang from the top edge on a thread, swing, fly between windows and climb the screen edges. The overlay is click-through, so the characters never get in the way of your work.

## Requirements

- macOS 12 or later (Apple silicon or Intel)
- Node.js 20+ and npm (developed on Node 24)

## Install and run

```bash
npm install
npm run dev        # Vite dev server + Electron with hot reload
npm run build      # compile main, preload and renderer into out/
npm start          # run the built app
npm run typecheck  # TypeScript, no emit
npm run dist:mac   # build a .dmg / .zip with electron-builder
```

`dist:mac` produces an unsigned build. For distribution, set up an Apple Developer ID certificate and notarisation (`CSC_LINK`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`); see the electron-builder code-signing docs.

## Using it

- **Menu bar**: the paw icon has Open, Character Studio, Settings, Pause/Resume all, Hide/Show all, Focus mode, Allow interaction and Quit. Closing the window leaves Screenly running in the menu bar.
- **Default global shortcuts** (change them in Settings → Keyboard shortcuts):
  - ⌘⌥P pauses or resumes all characters
  - ⌘⌥H is the emergency hide/show
  - ⌘⌥S opens the panel
  - ⌘⌥I toggles interaction (turn it off and everything is click-through)
- **On the desktop**: drag a character to move it, click it for a reaction, or rub the cursor over it to pet it. A hanging character dropped after a drag swings from its anchor.

## Architecture

```
src/
  main/                 Electron main process (Node)
    index.ts            lifecycle, IPC handlers, control window, focus schedule
    store.ts            the single AppState, validation (mergeKnown/sanitize*), atomic JSON persistence
    overlay-manager.ts  one transparent always-on-top click-through window per display, cursor feed
    display-manager.ts  screen API helpers and change watching
    asset-manager.ts    screenly:// protocol, custom character files, import/export
    tray-manager.ts     menu bar icon (drawn at runtime) and menu
    shortcut-manager.ts global shortcuts with conflict reporting
  preload/index.ts      contextBridge API: named calls only, no raw ipcRenderer/fs
  shared/               types, defaults, IPC contract (used by both sides)
  renderer/
    overlay/            desktop overlay entry (render + report status only)
    engine/             Stage (PixiJS app + pointer handling), Entity (behaviour state machine,
                        pendulum physics, rendering), rigs (procedural characters), sound, textures
    control/            React control panel (Zustand store, pages, UI kit)
    studio/             Character Studio (import, image ops, editor, timeline, hanging editor, live preview)
```

**Data flow.** The main process owns `AppState`. The panel sends *patches* over IPC. Main validates each patch: unknown keys and type changes are dropped, and numbers are clamped. Main then persists the state and broadcasts it to the panel and to every overlay. Overlays render it and report live state and position about once a second. Main saves those positions quietly, which is why characters come back where they were after a restart. When the panel moves a character on purpose, it bumps `positionVersion`, which tells the overlay to jump to the new spot.

**Click-through.** Each overlay starts with `setIgnoreMouseEvents(true, { forward: true })`. Main sends the global cursor position about 30 times a second while the overlays are visible. The overlay hit-tests the cursor against its characters and asks main to make the window interactive only while the pointer is over one. Interaction off, Hide all and the emergency shortcut all force every overlay back to click-through.

**Behaviour engine.** Each `Entity` runs a state machine per behaviour:

- **walk**: idle, walking, running, sitting, looking, stretching, sleeping, interacting, dragging and landing (falling after a drop)
- **hang**: hanging, descending, ascending, swinging, dragging
- **fly**: flying, landing, perched
- **climb**: climbing, idle, looking
- **stationary**

Hanging uses a damped pendulum, integrated at 120 Hz substeps, with an energy pump that holds the configured amplitude. Movement speed and animation playback speed are independent settings.

**Performance.** The ticker is capped at the chosen FPS (30 by default) and stops completely when every character is paused or hidden. Filters (brightness) are created only when brightness ≠ 100%. Textures are cached per URL and released when a character is re-saved.

**Security.** Context isolation is on, Node integration is off, the renderers are sandboxed and a CSP is set. Every IPC handler that mutates state refuses calls from overlay windows. Custom character files may only live at `original/*` or `processed/*` with image extensions, and their magic bytes are checked. The asset protocol rejects path traversal. Nothing is uploaded, no screenshots are taken, and other apps are never inspected.

## Data on disk

`~/Library/Application Support/screenly/Screenly/`

```
settings/state.json                    settings, active characters, profiles, presets
characters/custom/<id>/original/       imported files, never modified or overwritten
characters/custom/<id>/processed/      edited frames (PNG)
characters/custom/<id>/configuration.json
```

Export writes a single `.screenly` file (JSON with base64 images). Import always creates a new character.

## Adding a built-in character

1. Draw a rig in `src/renderer/engine/rigs.ts`. Implement `draw(g, pose)` using the helpers (`ell`, `limb`, `curve`, `eye`), facing +x, and set `height`, `width`, `origin` (`feet`, `hang` or `center`), `view` and `gaitHz`. For a four-legged animal, `quadruped({...})` already gives walking, running, sitting, stretching and sleeping poses.
2. Add the id to `RigId` in `src/shared/types.ts` and to `RIGS`.
3. Add a `CharacterDefinition` to `BUILT_IN_CHARACTERS` in `src/shared/defaults.ts` with its behaviours, size and speed.
4. Optionally map sounds in `engine/sound.ts` (`RIG_SOUNDS`).

## Creating custom characters (Character Studio)

1. **Import**: PNG, JPEG, WebP or GIF, by drag and drop or the file picker. Several files become frames. Animated GIF and WebP files are split into frames with their timings (WebCodecs). Sprite sheets are sliced on a grid that you set or auto-detect, and you click cells to skip them.
2. **Prepare**: **AI remove background** (the ormbg segmentation model, Apache-2.0, run on this Mac with ONNX Runtime WebAssembly; the first use downloads the 176 MB model once from Hugging Face and images are never uploaded), a **Quick remove** for plain backgrounds (a gradient-aware flood fill from the border), a magic wand for enclosed gaps, automatic edge-colour cleanup, eraser and restore brushes (size and hardness), crop, trim, rotate (90° or free), flip, resize, shrink edge, feather, zoom and pan, undo/redo and reset. Edits can apply to all frames.
3. **Animate**: sequences for Idle, Walking, Running, Hanging, Flying, Climbing, Sleeping and Interacting. The timeline has thumbnails, per-frame durations, drag or arrow reordering, duplicate, remove, loop, play/pause, a scrubber and fps presets. Empty sequences fall back to Idle.
4. **Configure behaviour**: name, size, speed and facing, plus the behaviours your frames support. The hanging editor lets you click the image to set the suspension point. It has controls for thread length, thickness and colour, amplitude, frequency, damping, rotation, descent distance and speeds, return-to-top and idle sway, plus reusable hanging presets. Its live preview updates as you change settings.
5. **Preview and deploy**: a simulated desktop that runs the real engine, with test sliders and backgrounds. Then **Save character** or **Save and add to desktop**.

### Adding animation assets

For real limb movement, provide several frames: a GIF or animated WebP, a sprite sheet, or numbered PNGs. Put them in the Walking (or Running, Flying, Climbing) sequence. A single image is animated procedurally: it bobs and tilts while walking, breathes while idle, and swings while hanging.

## Not implemented yet (honest list)

- **Body-part segmentation and skeletal rigging** (layers, bones, pivots) and **AI-assisted segmentation**. The Studio says so in its UI; these are the next big pieces.
- **WebGPU acceleration for the AI cut-out.** It's switched off (`USE_WEBGPU` in `studio/aiMatte.ts`) because on some Macs the model exceeds the GPU's shader limits; the CPU path takes a few seconds per image.
- **Dragging a character from one display to another.** Moving between displays works from the Customise panel.
- **Characters interacting with each other.** They do avoid crowding on the ground.
- **Recorded sound effects.** The current sounds are short synthesised effects, and sound is off by default.
- Settings use a small validated JSON store rather than `electron-store`, and the Studio uses Canvas instead of `sharp`. This avoids native modules and ESM-only packaging issues, and needs no extra install.

## Known macOS limitations

- With **Show over full-screen apps** off (the default), the overlay uses the `floating` window level. It sits above normal windows but not over other apps' full-screen Spaces. Turning the setting on uses the `screen-saver` level and joins full-screen Spaces, but macOS can still keep it out of some full-screen or Stage Manager configurations.
- Characters live in each display's **work area**: below the menu bar and above the Dock (when the Dock is shown).
- The overlay windows are non-focusable panels. They never take keyboard focus, so global shortcuts are the keyboard interface.
- Mission Control and Exposé hide or move the overlay along with other windows; this is normal macOS behaviour.
- Unsigned builds have to be opened with right-click → Open the first time (Gatekeeper).
