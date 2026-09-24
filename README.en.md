# growi-plugin-custom-map

[日本語](./README.md) | **English**

> [!NOTE]
> This is a translation. The [Japanese version](./README.md) is the canonical document; if there is any discrepancy, the Japanese version takes precedence.

A [GROWI](https://growi.org/) plugin that displays pre-uploaded floor plans (such as per-floor maps of a building) by referencing them from within wiki documents using their **original file names**.

You can place multiple markers (like Google Maps pins) on a floor plan and attach a label, reference photos, and a description to each marker. The map opens in a modal and supports moving and zooming via drag, wheel/pan, and pinch.

Furthermore, without writing the syntax by hand, you can **place markers by clicking on the floor plan from the GUI (a floating button) in the edit screen, and the syntax is generated and inserted automatically**.

## Features

### Viewing
- Reference attached images by their **original file name at upload time** (no need to be aware of random attachment IDs)
- Place **multiple markers** on a single floor plan. Specify **position, label, reference photos, color, and description** per marker
- Specify the **center coordinates and magnification** of the initial view to zoom into any area
- Rotate the entire floor plan **in 90° steps** (to correct orientation mismatches from photographing/scanning; works for both CAD and regular images; markers and labels always stay upright even when rotated)
- **Drag / one-finger pan** and **wheel / pinch zoom** inside the modal (smartphone-friendly)
- **Left-click / tap a marker or label to toggle minimize / restore** (lets you check parts hidden by labels). While minimized, the label is hidden and the pin **blinks** to indicate its position. It **auto-restores** after a set number of seconds (default 15)
- **Right-click / long-tap a marker or label to pop up its reference photos and description**
- A marker with a **description / note (`desc`)** set has a **blinking pin** to signal its presence
- The label text color is **automatically chosen as black / white** according to the background color (readable even with light-colored labels)

### Editing (GUI)
- Display **floating buttons "🛠️ 地図を作成 (Create Map)" and "🖊️ 地図を編集 (Edit Map)"** on the edit screen
- **Create Map (new)**: Select a floor plan from the **list of registered map assets** (CAD/images registered by a MAP editor) (filterable by registered name or original file name). Even if the stock page is kept private, general editors can still choose a map
- **Edit Map (existing)**: List the existing `:::custom-map` blocks in the current page, select one, and **edit it again in the GUI**. On confirmation, the original syntax is **overwritten in place** (the page reloads)
- A guard against accidental insertion inside syntax: when the cursor is inside an existing `:::custom-map`, pressing "🛠️ 地図を作成 (Create Map)" shows a message prompting you to use "Edit Map" instead of inserting a new block
- **Place markers by clicking** while **zooming / panning** the floor plan (coordinates are calculated automatically, with fine numeric adjustment available)
- In the side panel, edit **label, reference photos, color (preset palette), description, and coordinates**, **select / delete** markers, and specify the whole-map settings (launch button text, auto-restore seconds, initial view, and **rotation**)
- **Switch rotation (0 / 90 / 180 / 270°) with buttons**, reflected instantly in the preview
- **On confirmation, the `:::custom-map` syntax is inserted at the cursor position**

### CAD Drawings (optional)
- Display CAD drawings (`.dxf` / `.jww`) by **converting them to SVG via a conversion API** (**both DXF and JWW supported**)
- When the conversion API is unset, not running, or conversion fails, it **falls back** to the normal image workflow (no configuration is needed if you don't use CAD)
- You can **register a drawing with a confirmed orientation under a different name** (the "Register Map Asset" UI described later). For users who don't have CAD software, a MAP editor can fix the reference orientation in advance
- The conversion API is provided by a separate repository, [growi-cad-convert-api](https://github.com/kawakin26/growi-cad-convert-api)

### Register Map Asset (CAD/Image / optional)
- On the stock page (default `/media-library`), display the **floating button "📋 地図アセットの登録 (Register Map Asset)"** (only when the conversion API is configured)
- **"Register Drawing" tab**: Lists the CAD (`.dxf` / `.jww`) and **images (`.png` / `.jpg`, etc.)** in the page (**filterable by file name**, with a type badge, and registered ones marked with **color coding + a "done" badge**). You can **register under a different name**
  - **CAD**: Confirm the `0/90/180/270°` orientation in the preview and register with that orientation **baked into the SVG**. You can register the same drawing at multiple angles as many times as you like
  - **Image**: Register by **importing the original into the API as-is** (no rotation; correct the orientation in advance with image-editing software). It is then **delivered via the API**
- **"Registered List" tab**: List and review registered assets (view only). From each asset's **"Re-register at another angle" / "Re-register under another name"**, you can register again while carrying over the source file
- A registered asset is displayed simply by specifying its **registered name** in the syntax's `file`

> [!TIP]
> Because **registered assets are delivered via the API**, even if you restrict the stock page (`/media-library`) to be **viewable only by the editing group**, the registered maps (CAD/images) are still shown to viewers. This is useful when you want to keep media-library private while still showing the maps (it does not depend on the source file's attachment permissions).

> [!IMPORTANT]
> **How a map is referenced comes in two tiers depending on "whether the conversion API exists."**
>
> | | Image storage | Reference path | Keeping the stock page (media-library) private |
> |---|---|---|---|
> | **With conversion API** | The API server's storage (imported at registration) | API delivery (independent of GROWI permissions) | **Possible** (the map is shown even if viewable only by the editing group) |
> | **Without conversion API (easy setup)** | GROWI page attachments | GROWI standard `/attachment/{id}` (**follows view permissions**) | **Not possible** (you must be able to view the page holding the image, i.e., it must be public) |
>
> In the no-API setup, you must keep the stock page holding the map images (default `/media-library`) viewable. Specify `file="<attachment file name>"` directly in the syntax.
>
> Note that keeping media-library private is originally an organizational measure to "not show the backstage," not a security boundary (neither registered assets nor attachments protect against a third party who knows the delivery URL). If you don't need CAD conversion and want an easy setup, it's fine to give up privacy and make the stock page public.

> [!NOTE]
> **Deleting a registration cannot be done from the UI.** It risks breaking maps on existing pages that reference the registered name, and it is difficult to safely confirm that no page references it (deletion is planned for a future server management tool that involves searching usages and backups). To change the orientation, **re-register under a different name** instead of deleting.

## Installation

Add it as a plugin from the GROWI admin screen.

1. Open the GROWI admin screen → **Plugins**
2. Register this repository's URL

   ```
   https://github.com/kawakin26/growi-plugin-custom-map
   ```
3. After installation, enable the plugin

> [!NOTE]
> Operation requires the build artifacts (`assets/client-entry-*.js` and `.vite/manifest.json` under `dist/`). If you change the source, build it with the steps described later, commit it, and then reinstall it on the GROWI side.

> [!IMPORTANT]
> Do not append `.git` to the end of the repository URL at installation time. GROWI will get a 404 and fail when it assembles the ZIP download path.

## Usage (GUI editing)

You can create maps in the GUI without writing the syntax by hand.

1. Open the page in **edit mode** and **place the cursor where you want to insert the syntax** (the syntax is inserted at the **cursor position just before** you click the button)
2. Click the **"🛠️ 地図を作成 (Create Map)"** button at the bottom right of the screen
3. Select a floor plan (selecting it auto-fills the syntax's `file`)
   - **With conversion API**: Select from the **list of registered map assets** (CAD/images registered by a MAP editor) (filterable by registered name or original file name). `file` is filled with the **registered name**
   - **Without conversion API (easy setup)**: Select from the **attached-image list** of the stock page (default `/media-library`). `file` is filled with the **attachment file name**
4. **Click on the floor plan to place markers** (you can zoom in with wheel / pinch to specify fine positions)
5. In the right panel, enter the selected marker's **label, reference photos, color, and description** (fine adjustment of X/Y coordinates is also possible). You can **delete** unneeded markers
6. If needed, adjust the **whole-map settings** (launch button text, auto-restore seconds, initial view center/magnification, rotation). **Rotation** switches with the `0° / 90° / 180° / 270°` buttons and is reflected in the preview immediately
7. With **"Confirm and insert"**, the `:::custom-map` syntax is **inserted at the cursor position**

The inserted syntax can also be edited by hand (see the next section for the syntax spec).

> [!IMPORTANT]
> The syntax is inserted at the **cursor position just before you click the "🛠️ 地図を作成 (Create Map)" button**. To make it land where you intend, **check the cursor position before pressing the button** (place the cursor on the target line/paragraph, then click the button). When the cursor is inside an existing `:::custom-map`, a new block is not inserted; instead, a message prompting you to use "Edit Map" is shown to prevent accidental insertion.

> [!NOTE]
> **With the conversion API**, the GUI's floor-plan list is obtained from the **map assets registered in the API** (`GET /assets`). This is so that general editors can still choose a map even in a private setup where the stock page (`/media-library`) is restricted to be viewable only by the editing group. If you want to use a drawing that isn't listed here, ask a MAP editor to register it from "Register Map Asset."
>
> **Without the conversion API**, the **attached-image list** of the stock page (default `/media-library`) is shown as-is. In this setup, the images in the list follow the stock page's view permissions, so you must keep the stock page viewable (i.e., not private).

### Editing an existing map

You can re-edit a map already inserted in a page from the GUI.

1. Open the page in **edit mode**
2. Click the **"🖊️ 地図を編集 (Edit Map)"** button at the bottom right of the screen
3. From the **list of maps in this page** (`:::custom-map` blocks), select the map you want to edit
4. Edit markers (add / move / delete), labels, colors, descriptions, rotation, initial view, etc. in the GUI
5. With **"Save changes"**, the original syntax is **overwritten in place** (the page reloads after saving)

> [!IMPORTANT]
> "Edit Map" targets the **saved page body**. If you have unsaved changes while editing, save the page first, then use "Edit Map" (to avoid losing the unsaved changes).

> [!NOTE]
> The list shows only maps that reference a registered asset (registered name) as editable targets. Maps using the old scheme (directly referencing a raw file name in media-library) are shown as "not a registered asset" and cannot be edited. In that case, recreate them with the new scheme using "Create Map."

## Usage (writing the syntax directly)

Instead of using the GUI, you can write the Markdown [directive syntax](https://github.com/remarkjs/remark-directive) directly.

````md
:::custom-map{file="1F_floorplan.png" cx="50" cy="40" scale="2" rotate="90" link="Open the 1F guide map" restore="15"}
- x=30 y=40 label="Reception" photo="reception.jpg" color="#ff3b30"
- x=70 y=55 label="Meeting Room A" photo="room_a.jpg" desc="Reservation required|Ext. 101"
- x=20 y=80 label="Emergency Exit" photo="exit.jpg" color="#34c759" desc="Keep locked|Contact the security office at night"
:::
````

- The attributes of the container (`:::custom-map{ ... }`) are the **whole-floor-plan settings**
- Each **bullet-list line in the body corresponds to one marker**

### Whole-floor-plan settings (container attributes)

| Attribute | Description | Default |
|------|------|--------|
| `file` | The floor plan's **registered asset name** (**required/recommended**; auto-filled when selected in the GUI). For backward compatibility, an attachment's original file name (`.png` / `.dxf` / `.jww`, etc.) can also be specified, but it may be unresolvable in a private setup | — |
| `src` | The path of the reference page to look for the floor-plan image | Default page (see below) |
| `cx` | Center X coordinate of the initial view (% of the image, 0–100) | `50` |
| `cy` | Center Y coordinate of the initial view (% of the image, 0–100) | `50` |
| `scale` | Initial magnification. A factor relative to the magnification at which the image fits the viewport | `1` |
| `rotate` | Rotation angle of the whole floor plan (one of `0` / `90` / `180` / `270`; clockwise, degrees). Used to correct orientation mismatches | `0` |
| `link` | The text of the launch button that opens the floor plan | `マップを開く` (Open the map) |
| `restore` | Time (seconds) until a minimized marker auto-restores | `15` |
| `pinSize` | Marker pin diameter (px, common to the whole map). Clamped to `6`–`48` | `12` |
| `labelSize` | Marker label font size (px, common to the whole map). Clamped to `8`–`40` | `12` |

### Per-marker settings (bullet list)

| Key | Description | Default |
|------|------|--------|
| `x` | Marker's horizontal position (% of the image, 0–100, **required**) | `50` |
| `y` | Marker's vertical position (% of the image, 0–100, **required**) | `50` |
| `label` | Label text shown on the marker | none |
| `photo` | Original file name of the reference photo shown on right-click / long-tap | none |
| `photoSrc` | The page path to look for the reference photo | The page where the syntax is written → the map's resolution target |
| `desc` | Description / note (line breaks with `\|`). When set, the pin **blinks** and it is shown in the right-click / long-tap popup | none |
| `color` | Color of the pin and label (CSS color) | `#ff3b30` |

> [!TIP]
> If a value contains spaces, enclose it in double quotes (`"..."`) (e.g., `label="Meeting Room 1"`).

## Operations (viewing modal)

| Operation | Behavior |
|------|------|
| Click the launch button | Show the floor plan in a modal |
| Drag / one-finger swipe in the modal | Move the view (pan) |
| Wheel / two-finger pinch | Zoom in / out centered on the cursor (midpoint) |
| Left-click / tap a marker or label | Minimize / restore that marker and label (toggle) |
| Right-click / long-tap a marker or label | Pop up the reference photos and description |
| Click the background / × button | Close |

A minimized marker hides its label and its pin enters a blinking state. The pin diameter at this time is a fixed value unrelated to `pinSize` (default 24px, changeable with `minimizedPinSize`), slightly larger so its position is clear and easy to tap even when the label is gone. After the number of seconds specified by `restore` (default 15) elapses, it automatically returns to normal.

## Preparing images and the stock page

You can consolidate images on a shared **stock page** and reference them by file name from any page.

- Specify the **original file name at upload time** for `file` / `photo`
- Attach the images to the reference page (whether stored on S3, GCS, locally, or in MongoDB, the reference URL is unified to the `/attachment/{id}` format, so behavior is the same)

### Default stock page

When `src` is omitted, the floor-plan image is looked up on the `/media-library` page by default. If you attach floor plans there together, each page can reference them just by specifying `file`. The GUI editor's image list also shows the images on this page.

If you want to change the default page name or use the CAD conversion API, specify `defaultSrc` / `cadConvertApi` in the **settings (`GROWI_CUSTOM_MAP_CONFIG`)** described later. When unset, `defaultSrc` uses `/media-library` and the CAD conversion feature is off.

## Settings (`GROWI_CUSTOM_MAP_CONFIG`)

Changing the default stock page and using the CAD conversion API are done via a global setting called `window.GROWI_CUSTOM_MAP_CONFIG`. **This setting is optional** and works even when unset (for the image workflow).

### Where to write it

Paste and save the following JavaScript in the GROWI admin screen's **Customize screen (`/admin/customize`) → "Custom script"** field. The setting is loaded on all pages.

```js
window.GROWI_CUSTOM_MAP_CONFIG = {
  // Default stock page to look for floor plans and photos. Defaults to /media-library.
  defaultSrc: '/media-library',

  // CAD conversion API endpoint. Set this only when you use CAD (.dxf/.jww).
  // Include up to the conversion endpoint (/convert). If unset, the CAD feature is off.
  // * When the API server is not deployed or is stopped, do not set this line (or comment
  //   it out as below). Leaving only the setting makes behavior unstable (see the note below).
  // cadConvertApi: 'https://<same domain as GROWI>/cad/convert',

  // Pin diameter (px) in the minimized (label-hidden, blinking) state. A fixed value
  // unrelated to the syntax's pinSize. Defaults to 24. Clamped to 8–64.
  minimizedPinSize: 24,
};
```

> [!NOTE]
> After saving, reload the page (hard-reload if necessary) to apply. Since the custom script runs on all pages, writing just the assignment to `window.GROWI_CUSTOM_MAP_CONFIG` is enough.

### Each item

| Key | Description | Default |
|------|------|--------|
| `defaultSrc` | The stock page path to look for images when `src` / `photoSrc` is omitted. The GUI editor's image list also looks here | `/media-library` |
| `cadConvertApi` | The `/convert` endpoint URL of the CAD conversion API. When set, `.dxf` / `.jww` are converted and displayed. If unset, the CAD feature is off | none |
| `minimizedPinSize` | Pin diameter (px) in the minimized (label-hidden, blinking) state. A fixed value unrelated to the syntax's `pinSize`. Clamped to `8`–`64` | `24` |

> [!TIP]
> If you place the conversion API on a **subpath of the same domain as GROWI** (e.g., `https://gw.example.com/cad/convert`) via a reverse proxy, you can use `cadConvertApi` without worrying about CORS. For configuration details, see [growi-cad-convert-api](https://github.com/kawakin26/growi-cad-convert-api).

> [!WARNING]
> **When the conversion API server is not deployed or is stopped, do not set `cadConvertApi` (comment out the setting line).**
>
> When `cadConvertApi` is set, the plugin switches to behavior that assumes the API exists, such as "display via registered assets" and "the registered-asset list in Create/Edit Map." In this state, if the API server is stopped, behavior becomes unstable: image resolution fails so maps don't display, lists can't be fetched, and so on.
>
> - For the **easy setup that doesn't use CAD**, or **when the API server is stopped**, do not set `cadConvertApi` (or comment it out). In this case, the plugin automatically operates in the easy-setup mode of "directly reference the attached images of the stock page (default `/media-library`)" (map creation, display, and editing all complete with attached images).
> - Set `cadConvertApi` only when you have deployed and are running the API server and want to use CAD conversion or registered-asset delivery.

> [!CAUTION]
> **Security when publishing the conversion API (for operators)**
>
> The conversion API that `cadConvertApi` points to has **write endpoints** such as register (`POST /assets`) and delete (`DELETE /assets`) (there is also a convert endpoint `POST /convert`, but it is normally not used in the current workflow). If you expose these to the internet unprotected, a third party may register/delete assets at will (i.e., break the maps on published pages).
>
> - The countermeasures are done on the conversion API side. **Do not write a protection token in this plugin's settings (`GROWI_CUSTOM_MAP_CONFIG`)** (the custom script runs on all pages, so the token would be exposed in viewers' browsers).
> - In a setup that uses the browser's "Register Map Asset" UI, **protect the register/delete paths on the reverse proxy (Apache, etc.) side with source-IP restrictions or BASIC authentication**.
> - For concrete countermeasures (`ADMIN_TOKEN`, restricting `CORS_ORIGINS`, Apache config examples, etc.), see the [Security section of the growi-cad-convert-api README](https://github.com/kawakin26/growi-cad-convert-api/blob/main/README.en.md#security).

## Using CAD drawings (optional)

You can specify a CAD drawing (`.dxf` / `.jww`) in `file`. The design delegates conversion to an **external conversion API**. Both DXF and JWW are supported (conversion is handled by the API side, [growi-cad-convert-api](https://github.com/kawakin26/growi-cad-convert-api)).

- When you set the conversion API endpoint in `window.GROWI_CUSTOM_MAP_CONFIG.cadConvertApi`, and `file` is a CAD file, the plugin queries the conversion API and displays the retrieved **converted image (SVG)**.
- When the conversion API is **unset, not running, or conversion fails**, it **falls back** to the normal attachment resolution → static path.

### Registering a map asset (for MAP editors)

When the orientation at which a CAD was uploaded is incorrect, or when you want to **deliver an image via the API** to show it to viewers, a MAP editor can **register an asset under a different name** (no CAD software needed).

1. Open the stock page (default `/media-library`)
2. Click the **"📋 地図アセットの登録 (Register Map Asset)"** button at the bottom right
3. In the **"Register Drawing" tab**, select a CAD or an image (filterable by file name; a type badge distinguishes CAD / image; registered ones have a green + "done" badge)
4. **For CAD**: Select the orientation with the `0/90/180/270°` buttons and check it in the preview / **For an image**: Check the original preview (no rotation specification)
5. Enter a **registered name** (the name used in the syntax's `file`; a name that doesn't collide with the original is recommended) and click **"Register at this orientation" / "Register this image"**
6. Afterward, writing `file="<registered name>"` in the syntax displays that asset

- **CAD**: An **SVG with the specified angle baked in** is saved on the API side and behaves as an independent asset decoupled from the source CAD (it keeps displaying even if you later delete the source CAD). **The orientation cannot be changed.** If you want to change it, or when you fix the CAD, **re-register under a different name** (you can register any number of angle variants from the same source CAD).
- **Image**: The **original is imported into the API as-is** and delivered via the API thereafter (it keeps displaying even if you later delete the original attachment). Since it is not rotated, correct the orientation in advance with image-editing software.
- Existing registrations can be checked in the **"Registered List" tab**, and you can add registrations from each asset's "Re-register at another angle" / "Re-register under another name."
- **Deletion cannot be done from the UI** (a measure to avoid breaking existing pages; planned for a future server management tool).
- The syntax's `rotate` (CSS rotation at display time) is applied **on top of** the orientation baked in at CAD registration (can be layered at display time for both images and CAD).

> [!TIP]
> Because registered assets are **delivered via the API**, even if you restrict the stock page (`/media-library`) to be **viewable only by the editing group**, the registered maps (CAD/images) are still shown to viewers. Since it does not depend on the source file's attachment permissions, a setup of "show media-library only to editors, but show the maps to everyone" is possible.

> [!NOTE]
> This button is shown only when the conversion API (`cadConvertApi`) is configured and the current page is the stock page (`defaultSrc`). If you limit the view/edit permissions of the stock page to the MAP editing group, you can limit the registration operation to editors.

### Integration with the conversion API (registered-asset method)

The normal workflow of this plugin is the **"registered-asset method."** A CAD file (or image) is **registered with the API once** on the stock page (`POST /assets`), and the map syntax references it by its **registered name** (not the original raw file name). At display time, the plugin resolves the registered asset (`GET /assets`) and the API delivers the converted SVG (or the original image).

- **Do not specify a raw CAD file name directly in the syntax.** Referencing by registered name is the premise. If you write a raw file name directly, ordinary viewers usually lack view permission for the stock page (`/media-library`) and cannot display it (i.e., it does not coexist with a private-stock setup).
- Registered assets are **delivered by the API independently of GROWI permissions**, so even if you restrict the stock page to be viewable only by the editing group, the maps are shown to everyone.
- For the API server-side settings (`GROWI_BASE_URL` / `GROWI_TOKEN`, auth method, reverse proxy, caching, etc.), see the README of [growi-cad-convert-api](https://github.com/kawakin26/growi-cad-convert-api). Keep the token in the **API server's environment variables**, and **never write it in this plugin's syntax or custom script** (the token is not exposed to the browser).

> [!NOTE]
> The conversion API also has `/convert` (an endpoint that converts CAD on the fly), but it is normally not used in the current GUI workflow (the registered-asset method is the canonical path). See the [growi-cad-convert-api](https://github.com/kawakin26/growi-cad-convert-api) README for details.

### Image resolution order

- **Floor plan (`file`)**:
  1. Resolve the **registered asset** (the CAD's baked SVG / the image original) via the **API delivery URL** (when `file` is a registered name; for both CAD and images; it displays even when the stock is private and does not depend on viewer permissions) = the **canonical path**
  2. If not found, resolve the attachment directly from the page where the syntax is written / the stock page (the path used in a no-conversion-API setup)
- **Reference photo (`photo`)**: The `photoSrc`-specified page → the page where the syntax is written itself → the same resolution target as the floor plan (attachment resolution)

Attachment resolution matches `originalName` / `fileName` from the page's attachment list to resolve the URL. If not found, it falls back to `/images/maps/{file name}`.

> [!IMPORTANT]
> The view permission of an attachment follows its **source page**. Users without view permission on the stock page cannot see the images. Create the stock page in a scope viewable by everyone you want to share with.

## Development

### Requirements

- Node.js
- npm

### Setup and build

```bash
npm install
npm run build
```

- The entry is `client-entry.tsx` at the repository root (placed at the root to match the Vite manifest key to GROWI's expectation). The implementation is split under `src/`
  - `src/common.ts`: Utilities shared by viewing and editing (attachment resolution, reading settings, label text-color decision, etc.)
  - `src/viewer.ts`: Viewing feature (syntax → map modal). `activateViewer`
  - `src/editor.ts`: GUI editing feature (floating buttons on the edit screen; "Create Map" = new insertion, "Edit Map" = read and re-edit/overwrite the existing `:::custom-map` in the page body). `activateEditor`
  - `src/register.ts`: Map-asset registration feature (floating button on the stock page → register CAD with a specified orientation under a different name, register an image as-is; deletion removed from the UI). `activateRegister`
  - `client-entry.tsx` **launches each feature in an independent try-catch**, so if one breaks it doesn't affect the others (risk isolation). The editing and registration features depend on the DOM and may break with GROWI updates, but even then the viewing feature keeps working
- The build uses [Vite](https://vitejs.dev/) (`vite build`, the same configuration as the official script plugin)
- Build artifacts are output to `dist/`
  - `dist/assets/client-entry-*.js`: The bundled plugin body
  - `dist/.vite/manifest.json`: The build manifest (**required for GROWI to resolve the script it injects**)

> [!IMPORTANT]
> GROWI **does not build** the repository at installation time. Since it uses the files in the ZIP as-is, **build and commit** `dist/` (including `.vite/manifest.json` and `assets/`) before pushing. Without the manifest, even if GROWI detects the plugin, it will not inject the `<script>`, and the syntax will not take effect.

### Project structure

```
.
├── client-entry.tsx       # Entry (launches viewer and editor in independent try-catch)
├── src/
│   ├── common.ts          # Shared utilities (attachment resolution + asset registration API client)
│   ├── viewer.ts          # Viewing feature (directive conversion + map modal)
│   ├── editor.ts          # GUI editing feature (floating buttons + marker placement UI)
│   └── register.ts        # Map-asset registration (CAD orientation registration / image original registration UI)
├── dist/                  # Build artifacts (committed)
│   ├── assets/
│   │   └── client-entry-*.js
│   └── .vite/
│       └── manifest.json
├── vite.config.ts
├── package.json
├── tsconfig.json
├── LICENSE
├── README.md              # Japanese version (main, canonical document)
└── README.en.md           # English version (translation; this file)
```

### About how the editing feature is launched

GROWI's script plugins have no official extension point to extend the editor's toolbar or commands (only `growiFacade.markdownRenderer` is published). Therefore, the editing feature does not depend on the editor's toolbar DOM; instead, it uses an approach of **showing a floating button in a corner of the screen once it detects the edit screen (URL hash `#edit` + CodeMirror display)**. Syntax insertion is done by saving the cursor position (DOM Range) just before opening, restoring it at insertion time, and using `execCommand('insertText')`.

## Troubleshooting

- **"Map file not found" is displayed**:
  - **With conversion API**: Check that the name specified in `file` matches a **registered asset name**. Registered maps can be chosen from "🛠️ 地図を作成 (Create Map)" on the edit screen (the registered name is auto-filled). If you write a raw media-library file directly in `file`, it cannot be resolved in a private setup and this message appears (ask a MAP editor to register it).
  - **Without conversion API**: Check that the **attachment file name** in `file` matches an attachment on the stock page (default `/media-library`), and that the page is in a viewable scope.
  - The reference photo (`photo`) is resolved from the attachments of the page where the syntax is written, in either setup.
- **The GUI's map list is empty**:
  - **With conversion API**: When a MAP editor registers a map (CAD/image) from "📋 地図アセットの登録 (Register Map Asset)," it appears here. Also check that the conversion API (`cadConvertApi`) is correctly configured and running (if unset or stopped, registered assets can't be fetched).
  - **Without conversion API**: The list is built from the attached images of the stock page (default `/media-library`). Check that images are attached to the stock page and that the page is viewable.
- **The edit button doesn't appear**: Check that you are in edit mode (URL ending in `#edit`). It is not shown in view mode.
- **Markers (pins/labels) don't appear right after changing the settings (`GROWI_CUSTOM_MAP_CONFIG`)**: Right after rewriting the custom script or settings, the old script cached in the browser and the new settings can temporarily coexist, and markers may not be drawn. **Force-reload the page (hard reload: `Ctrl+Shift+R` on Windows/Linux, `Cmd+Shift+R` on Mac)** to resolve it. This is not a bug in the plugin itself, but a temporary phenomenon due to caching when applying settings.
- **Images on another page aren't resolved**: The plugin retrieves the page ID and attachment list via GROWI's API (`/_api/v3/page`, `/_api/v3/attachment/list`). If the API response structure differs by GROWI version, check these responses in the Network tab of the browser's developer tools and adjust how `getPageIdByPath` / `getAttachmentsForPage` in `src/common.ts` extract them.
- **The syntax isn't reflected / the script isn't loaded**: Check the following in order.
  1. Whether the plugin is **enabled** in the admin screen
  2. Whether `dist/.vite/manifest.json` and `dist/assets/client-entry-*.js` are **committed** to the repository (whether you pushed after `npm run build`)
  3. Whether `<script src="/static/plugins/{org}/{repo}/dist/assets/client-entry-*.js">` is injected into the page's HTML source
  4. If updated, **reinstall** from the plugin card in the admin screen after pushing to GitHub (GROWI re-fetches the ZIP, so it must be pushed)
  - The path from which GROWI serves the plugin is `/static/plugins/{org}/{repo}/...` (not `/plugins/...`).

## License

Published under the [MIT License](./LICENSE). Copyright (c) 2026 kawakin.

## Related repositories

- [growi-plugin-custom-map](https://github.com/kawakin26/growi-plugin-custom-map) — This repository (the viewing + GUI editing plugin)
- [growi-cad-convert-api](https://github.com/kawakin26/growi-cad-convert-api) — The conversion API for CAD (DXF/JWW) conversion and map-asset registration (optional)
