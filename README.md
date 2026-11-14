# Detailing Studio

A React + TypeScript + Vite configurator with real, locally bundled Three.js vehicles (BMW X5 G05 and Ferrari 458 Italia), a reconstructed empty-garage photograph, live PBR body paint, six finishes, a full customization panel, a 3D interior view and vehicle-only 360° rotation. No stock sedan or primitive placeholder is used.

## What's new in v2

- **Interior view.** Exterior / Interior switch at the top. Inside, drag to look around, scroll to change field of view, arrows look left/right (Up/Down on the keyboard tilt). Seats: Driver, Passenger, Rear (BMW) and Driver, Passenger (Ferrari). The camera flies smoothly between outside and inside.
- **Customize panel.** Wheel finish (7), brake calipers (6, BMW only — the Ferrari model has no caliper mesh), interior trim (7), ambient cabin light (7 incl. off), window tint slider, headlights/taillights on, and open doors/hood/tailgate (BMW, using the model's real hinge pivots).
- **Paint.** 12 swatches + a custom color picker. Finishes: Gloss, Matte, Satin, Metallic (procedural flakes under a smooth clearcoat), Pearl (iridescent), Chrome.
- **Graphics.** Neutral tone mapping (true paint colors), studio reflection environment matching the garage (ceiling LED strips, softboxes, orange columns), real-time fading floor reflection, baked depth-based contact shadow, soft key-light shadow, rim light, up to 2× pixel ratio, anisotropic texture filtering.
- **Fixed:** the BMW source file only contains the left half of the hood paint (the right half rendered as a black hole into the engine bay). It is now mirrored back in on load (`mirror` in the catalog).
- The background photograph is unchanged.

## v2.5: generated BMW X5 interior

The X5 cabin geometry (seats, steering wheel, dash, door cards) was untextured near-black. `src/lib/interior.ts` now generates a luxury interior inspired by the X5 reference photo, with no image files:

- **Quilted leather seats**: diamond quilting with stitching on cushions and the surfaces you sit against, plain grained leather on seat backs and bolsters. Colour follows Customize → Interior trim (default is now Cognac).
- **Leather door cards and console trim** with grain; the headliner and pillars stay dark above the window line (`top`).
- **Inlay band** across the dash and doors with a chrome line above it and an ambient light strip below it (the strip follows the Ambient light colour). Customize → Trim inlay: Fineline Wood, Open-pore Walnut, Carbon, Aluminium, Piano Black.
- **Soft-touch black dash**, black leather steering wheel.
- **Digital instrument cluster** behind the wheel and a **floating centre display** (navigation, media, climate), drawn on canvas with no brand logos.
- Everything is computed in the shader in vehicle space, so no UVs are needed. Settings live in the catalog under `interiorStyle` (mesh groups, band/chrome/top heights, screen positions), so another car with untextured cabin geometry can use the same system.
- Limits: the inlay band and headliner line are horizontal height bands, not modelled trim pieces; the gear selector, buttons and vents keep the original geometry and get the dash material.

## v2.4 fixes

- **Dark square under the cars fixed.** The baked contact-shadow texture was cleared with the opaque garage background colour, so the whole 7 × 7 m shadow plane showed as a dark square on the floor. It is now cleared to transparent, leaving only the soft shadow under the car.
- Ferrari doors, front trunk and engine cover open (see v2.3 notes).

## v2.3: Lamborghini, opening parts everywhere, rim designs, carbon fibre

- **Lamborghini Aventador SVJ 63 (2019)**, 2.0 MB. Converted from USDZ like the others; its 1,640 separate objects were merged to one mesh per material (about 23 draw calls) by the splitter's `collapse` option.
- **Doors, hoods and trunks now open on the Porsche, Mercedes and Lamborghini.** Those models had every door welded into one body mesh. `scripts/split-parts.mjs` finds the geometry islands (door skin, inner panel, glass, handle, door-mounted mirror) inside a box per part and moves them under a new hinge node. Configs live in `scripts/split-configs/`; use `scripts/mesh-islands.mjs` to find the boxes for a new car. Porsche: both doors, front trunk, engine lid. Mercedes: 4 doors, hood, side-hinged rear door with the spare wheel. Lamborghini: scissor doors (open upward) and front trunk. Ferrari (v2.4): both doors with their mirrors, front trunk and engine cover (`scripts/split-configs/ferrari-458.json`; the file is now meshopt instead of Draco, 2.4 MB).
  - The hinge is an empty node with the part as its child, because meshopt quantization re-centres mesh nodes and would otherwise move the pivot. A test checks this for every catalog opening.
  - The swing direction test now also prefers upward motion, so lids and scissor doors never open into the floor.
- **Rim designs** (Customize → Rim design): Original, Five Spoke, Split Ten, Mesh, Turbine, Y-Spoke, Deep Dish. They are procedural (`src/lib/wheels.ts`), fitted to the four wheels measured from each car's rim geometry, and use the Wheel finish colours. For the Lamborghini, whose rim and tyre share one material, custom rims bring their own tyre and brake disc (`wheels.replaceTires`).
- **Carbon fibre** (Customize → Carbon fiber): Roof, Hood, Rear deck, Lower kit, Full body. A procedural 2×2 twill weave in the paint shader, projected in vehicle space inside zones derived from each car's body bounds, under a reduced clear coat. Opened parts keep their carbon (the shader maps them back to their closed position). Zones are approximate boxes, not exact panel cut lines: e.g. Hood covers the middle of the bonnet, and Lower kit is everything below about 22% of the body height.
- Brighter metal: the reflection capture has extra soft panels (not visible in the room), so silver rims and chrome no longer look dark.
- **Provenance caveat:** the Lamborghini's texture names include `AventadorSVJRewardRecycled_2019`, the asset naming used in the Forza Horizon games. The uploader's CC BY label is very likely not theirs to grant. Like the Mercedes, treat it as a demo car and do not use it on a public or commercial site.

## v2.2: 3D garage, Porsche 930 and Mercedes G-Class

- **Real 3D garage replaces the flat photo** (`src/lib/garage.ts`, all procedural, no downloads): orange/graphite checker tile floor with a real-time fading reflection, black slatted walls, orange columns, angled LED strips in a black ceiling, an illuminated DETAILING sign and vinyl wrap-roll racks. The car's reflection map is captured from this same room, so paint reflects the actual garage. `public/images/garage-background.png` is no longer used.
- **Camera orbits the car** instead of the car spinning in front of a picture: drag left/right to orbit, up/down to change height; arrows, 360° and keyboard still work. From the interior you now see the real room through the glass.
- **Porsche 911 Turbo (930) 1975** (Lionsharp Studios, CC BY 4.0, 3.1 MB) and **Mercedes-Benz G-Class Brabus** (KINGSLEY_king, CC BY 4.0, 10 MB). Both were downloaded as USDZ and converted with `scripts/usd_to_gltf.py` (needs `pip install usd-core`), then compressed with `gltf-transform optimize ... --compress meshopt --texture-compress webp --texture-size 2048 --flatten false --join false --palette false --simplify false`. Keep those four `false` flags: flattening or joining would destroy the part structure the configurator relies on.
- Neither model has separate doors (the Porsche body is one mesh, the Mercedes is merged by material), so "Doors & trunk" shows as not available for them. The Porsche interior is basic and dark (one black plastic mesh); the Mercedes has a detailed cockpit, and its seat leather is recolorable.
- New catalog fields: `hide` (nodes removed before measuring, e.g. the Porsche's baked shadow plane and a stray oversized helper) and `parts.*.nodes` (match parts by ancestor node name).
- **Mercedes provenance caveat:** its materials are named like a game/mod asset (`tgn_brabus_g900_2020_*`, `leather02_weave_*`). The uploader labels it CC BY, but that may not be theirs to grant. Treat it as a demo car and verify before any commercial use. The year shown (2020) comes from those asset names, not from documentation.

## v2.1: doors, hotspots, instant switching

- **Door direction fixed.** The BMW source file mirrors the right-side door pivots, so a fixed angle sign opened the right doors into the cabin. `prepareOpenings` now test-rotates each hinged part both ways and keeps the direction that moves it away from the car, so new models also open correctly without hand-tuning signs.
- **Manual open/close per part.** Customize → Doors & trunk: front/rear left/right doors, hood, tailgate, charging flap, plus Open all / Close all. You can also click the part on the car, or the round hotspot on it (orange = open), like the Porsche configurator.
- **Instant switching.** Prepared cars stay cached on the GPU, the other cars are prefetched in the background after the first load, shaders are precompiled (`compileAsync`), and changing the car in the selector loads it right away. Switching between already loaded cars measured about 20–35 ms.

### How the Porsche configurator does it

The Porsche 3D view (`configurator.porsche.com`, `viz-mode=3d`) is not WebGL. It is **Unreal Engine Pixel Streaming**: the page shows a `<video>` with a WebRTC MediaStream (`pixelstreaming_video_track_label`, 1536 × 864), negotiated via `prs.porsche.com/matchmaker/signalingserver`. A cloud GPU renders the CAD-quality car and streams frames; option clicks are sent over a data channel and applied as material/mesh switches in a scene where every option is already loaded, so the next streamed frame shows the change. Still images come from a server render endpoint (`prs.porsche.com/iod/image/...`) with the configuration encoded in the URL. This application uses client-side WebGL instead (no per-user GPU servers); option changes are also applied on the next frame, and quality is limited by the 3D model files.

## Start

Install Node.js 22.18+ (or 24 LTS), then:

```sh
npm ci
npm run dev
```

Open the URL printed by Vite. Click **Apply** to load the installed car. Drag horizontally to rotate; use mouse wheel / touch pinch to zoom. The bottom arrows rotate by 30°. The 360° button toggles automatic rotation. View contains zoom and home controls. Keyboard support on the canvas: arrows, +, -, Home. Reset restores the empty garage, default vehicle, white paint, Gloss, rotation and zoom.

```sh
npm test
npm run build
npm run preview
```

`dist/` is the static production site. Serve over HTTP(S); do not double-click index.html. Everything needed for rendering is bundled locally. Inter font is requested from Google Fonts, with an Arial/Helvetica fallback.

## Important model-year distinction

**The installed, authentic asset is the BMW X5 (G05), 2018. The requested 2023 asset is NOT included.** BMW Car IT's official open model is documented as 2018. Therefore the selector honestly shows 2018; it does not mislabel it as 2023. Only installed/available catalog entries are selectable. The information button also discloses this.

Asset source: https://github.com/bmwcarit/digital-car-3d
Creator: BMW Car IT GmbH; CC BY 4.0. License: public/licenses/bmw-cc-by-4.0.txt.
Changes: rebuilt the complete car hierarchy from the Ramses project, assembled original glTF meshes with the original door/wheel transforms, converted to a single GLB, compressed with Meshopt, normalized for the studio, and adapted paint, glass, tires, chrome and lighting. Badge, license plate and tire normal textures come from the same licensed repository. This application is not affiliated with BMW.

### Ferrari 458 Italia

File: `public/models/ferrari-458-italia.glb` (1.7 MB, Draco), downloaded from the three.js repository (`examples/models/gltf/ferrari.glb`, tag r180). Model by vicent091036 on Sketchfab (https://sketchfab.com/models/57bf6cc56931426e87494f554df1dab6), credited the same way the three.js car example credits it. **The license could not be confirmed from Sketchfab during this update — verify it on that page before commercial use.** The model is an open-top body with a full cockpit; the exact model year is not documented, so the selector shows 2010 (458 Italia launch). Materials were retuned in `src/lib/materials.ts`. Not affiliated with Ferrari.

## Install the correct 2023 car or another vehicle

1. Obtain a properly licensed self-contained GLB for the exact vehicle and year. The model should be in its closed, assembled rest pose, Y-up. Embed its image textures; meshopt and Draco compression are supported. Keep each deployed file below 25 MB. Supply attribution and follow the model's license.
2. Put the requested file at `public/models/bmw-x5-g05-2023.glb`.
3. Copy the entry in `public/catalog.example.json` into `public/catalog.json`, leaving the existing entry if you want both. Set `paintMaterials` to the **exact** names of painted body materials in the GLB, as inspected in Blender or a glTF inspector. Do not include rim paint, glass, lights, chrome, trim, or tires. Alternatively mark actual paint materials with glTF `extras: {"bodyPaint": true}`.
4. Set `available: true` only after the real file is installed and licensed. Update attribution/source. Set its accurate physical length in meters. `rotation` is an initial yaw angle in radians. Put the desired default entry first.
5. Optional extras (see the two entries in `public/catalog.json` for working examples): `parts` (rims, calipers, interior, glass, headlights, taillights — each `{materials?, meshes?}`, mesh names match by prefix), `cabin` (forward vector, light position and seat eye points in meters in the normalized, centered vehicle space), `openings` (hinge node, axis, open angle in radians) and `mirror` (meshes whose symmetric half is missing). Missing parts are shown as "Not available" in the Customize panel.
6. Restart / rebuild. The Brand → Model → Year selectors derive their choices from installed catalog entries. Add BMW X3/X6/3 Series/5 Series, Mercedes or Toyota using the same schema; none are falsely advertised as present.
7. Verify body selection and rendering on a WebGL 2-capable browser. Apply handles unavailable/unreadable assets without replacing them with an unrelated vehicle. An existing vehicle stays visible if its replacement fails.

A model with no correctly configured paint materials is rejected with an understandable error. Non-paint materials are preserved except for the specific BMW material adaptations in `src/lib/materials.ts`.

## Product inventory

Edit `src/data/products.ts`. The 12 demo products have names, hex colors, product codes, availability, supported finish types, optional brand and optional texture reference. Only `available: true` products appear. The current renderer uses hex and the selected finish; a texture reference is catalog metadata for a later texture-based inventory renderer, not an implemented texture-upload feature. These are demonstration colors, not a real shop's verified stock list.

Gloss, Matte, Satin, Metallic, Pearl and Chrome change physical roughness, metalness, clearcoat and iridescence on `MeshPhysicalMaterial`; they are not CSS filters. Metallic and Pearl add procedural micro-flakes (shader-injected normal perturbation under a smooth clearcoat, no UVs needed). This is still an approximation, not a spectral simulation. Wheel, caliper, interior and ambient-light options live in the same file. Product screenshots cannot guarantee an actual vinyl color match.

## Architecture

- `src/App.tsx`: catalog, selection, the customization `Look` state, exterior/interior mode and seats, loading/error states, Apply/Reset and responsive navigation.
- `src/components/GarageScene.tsx`: transparent WebGL layer, real GLB loading, studio reflection environment, floor reflection (`Reflector` with a fading shader), baked contact shadow, camera framing, exterior rotation, interior look-around camera with fly-in transition, door animation, touch and zoom. The photograph never rotates.
- `src/lib/materials.ts`: exact paint-material matching, physical finishes with flakes, per-model material tuning, part collection (each part gets its own material copies), tint/lamp helpers, symmetric-half mirroring, physical-size normalization and resource cleanup.
- `src/components/Header.tsx`, `Selectors.tsx`, `Icons.tsx`: real accessible HTML/SVG controls.
- `public/images/garage-background.png`: background alone, with all original screenshot UI removed using built-in image generation.
- `public/models/`: the licensed BMW and its textures, and the Ferrari 458.
- `tests/model.test.mjs`: asset, geometry and material tests against the actual bundled model.
- `scripts/assemble-bmw.py`: reproducible source assembly script (source glTF/RCA inputs downloaded from the official repository, not included twice).

The renderer uses Neutral tone mapping, sRGB output, a procedural studio reflection environment (ceiling LED strips, softboxes, orange columns), hemisphere/key/fill/rim lighting, a transparent shadow catcher, a depth-rendered blurred contact shadow (re-baked when doors move) and a real-time floor reflection that fades with distance over the photographed tiles. Camera matching and grounding are approximations; physical photorealism is not claimed. Rendering sleeps when the scene is static and disposes geometry, materials and textures when replaced.

## Validation and limitations

- v2.3: six automated tests pass (the sixth checks that every catalog opening is an empty hinge node in its GLB). Checked in the browser: Lamborghini load, scissor doors and front trunk, Y-Spoke rims with generated tyres; Porsche doors, front trunk and engine lid, Five Spoke rims, carbon roof/hood; Mercedes doors, hood and carbon hood/lower kit, Turbine rims; BMW Deep Dish in Gold. Not checked visually: every rim design on every car, the Mercedes rear door, and the Lamborghini and Porsche interiors after the split.
- v2.1: five automated tests pass (the fifth checks that every BMW door, the hood and tailgate swing outward). Doors/hotspots/click-to-open and cached switching checked in the browser; the charging flap was only checked by the test, not visually.
- v2: TypeScript and Vite production build passed. Four automated tests pass (the fourth covers part recoloring, the hood mirror fix and door hinge nodes). On Node 22.10 run them with `node --experimental-strip-types --test tests/*.test.mjs`; Node 22.18+ works with `npm test`.
- v2: GPU rendering was checked in a WebGL browser at 1024 × 768 and 375 × 812: exterior BMW and Ferrari, Metallic paint, black wheels/red calipers, open doors/hood/tailgate, BMW and Ferrari interior views, cognac trim, Customize panel on mobile. Pearl white was checked; lights-on works but the glow is subtle on the BMW (no bloom pass, since the canvas is transparent over the photo). Not checked visually: Chrome finish and the rear seat; frame rate on low-end phones was not measured.
- v1: Three automated tests passed against the actual compressed GLB: installed catalog/files; assembled geometry with four tires on the same floor and 4.920 × 1.731 × 2.236 m dimensions; black/red/white body recoloring across four finishes without changing non-paint material color or roughness.
- UI inspected at desktop and 390 × 844 mobile iframe dimensions. Color/finish selection, Reset, View controls and WebGL-unavailable error handling checked in the browser.
- v1 note: **The supplied cloud QA browser has WebGL disabled. Actual GPU rendering, reflections, mouse-drag rotation and zoom could not be visually tested there.** They are implemented, but a final visual check is required on a WebGL 2-enabled desktop browser. No claim is made that these GPU interactions passed browser QA.
- 2023 BMW X5, payments, customer accounts and shop inventory synchronization are not included.

## Garage background generation

Built-in image generation edited the supplied reference, preserving the camera, checker tiles, black walls, LEDs, orange columns, roll racks and DETAILING sign, while removing the header, selection/color panels, buttons and arrows. The generated background is a separate image; all interactive controls are HTML. It is a close reconstruction, not a claim of pixel-for-pixel identity.
