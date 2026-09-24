# Administration and Installation Manual

Instructions for installers and administrators covering installation, configuration, CAD conversion API integration, confidential operations, security, and troubleshooting.

## Installation

Add as a plugin from the GROWI administration screen.

1. GROWI Admin Screen → Open **Plugins**
2. Register this repository's URL:

   ```
   https://github.com/kawakin26/growi-plugin-custom-map
   ```
3. After installation, enable the plugin

```{note}
Operation requires build artifacts (`assets/client-entry-*.js` and `.vite/manifest.json` in the `dist/` directory). If you modify the source, build according to the procedure in {doc}`extending`, commit, and then reinstall from the GROWI side.
```

```{important}
Do not add `.git` at the end of the repository URL at installation. GROWI will fail with a 404 when constructing the ZIP download path.
```

## Configuration (`GROWI_CUSTOM_MAP_CONFIG`)

Changing the default stock page or using the CAD conversion API is done via a global configuration called `window.GROWI_CUSTOM_MAP_CONFIG`. **This configuration is optional** and plugins work (for image operations) even without it.

### Where to Write Configuration

In the GROWI admin screen, go to **Customization** (`/admin/customize`) → **"Custom Script"** field and paste the following JavaScript, then save. The configuration is loaded on all pages.

```js
window.GROWI_CUSTOM_MAP_CONFIG = {
  // Default stock page for searching floor plans and photos. Default is /media-library.
  defaultSrc: '/media-library',

  // CAD conversion API endpoint. Only set this if using CAD (.dxf/.jww).
  // Include the conversion endpoint (/convert) at the end. If not set, CAD features are off.
  // ※ If the API server is not deployed or stopped, do not set this line (or comment it out like below).
  //   Keeping the setting while the API is unavailable causes unstable behavior.
  // cadConvertApi: 'https://<same domain as GROWI>/cad/convert',

  // Pin diameter (px) when minimized (label hidden, blinking). Independent from syntax pinSize.
  // Default is 24. Clamped to 8-64.
  minimizedPinSize: 24,
};
```

```{note}
After saving, reload the page (or hard refresh if needed) to apply. Since custom scripts run on all pages, it's sufficient to just assign `window.GROWI_CUSTOM_MAP_CONFIG`.
```

### Each Item

```{list-table}
:header-rows: 1
:widths: 22 58 20

* - Key
  - Description
  - Default
* - `defaultSrc`
  - Stock page path where images are searched when `src` / `photoSrc` are omitted. The GUI edit image list also refers to this
  - `/media-library`
* - `cadConvertApi`
  - CAD conversion API `/convert` endpoint URL. When set, converts `.dxf` / `.jww` and displays them. If not set, CAD features are off
  - None
* - `minimizedPinSize`
  - Pin diameter (px) when minimized (label hidden, blinking). Independent from syntax `pinSize`. Clamped to 8-64
  - `24`
```

```{tip}
To avoid CORS issues, place the `cadConvertApi` as a **reverse proxy subpath on the same domain as GROWI** (e.g., `https://gw.example.com/cad/convert`). For configuration details, see [growi-cad-convert-api](https://github.com/kawakin26/growi-cad-convert-api).
```

```{warning}
**If the conversion API server is not deployed or is stopped, do not set `cadConvertApi` (comment out the line).**

When `cadConvertApi` is set, the plugin switches to operating on the assumption that an API exists, such as "displaying via registered assets" and "obtaining registered asset lists in map creation/editing". If the API server is stopped in this state, image resolution fails, maps don't display, lists can't be retrieved, and so on—operation becomes unstable.

- For easy-to-use operations without CAD or when the API server is stopped, do not set `cadConvertApi` (or comment it out). The plugin automatically switches to "easy-operation mode" where it directly references attached images from the stock page (default `/media-library`).
- Only set `cadConvertApi` when you have deployed and running the API server and want to use CAD conversion or registered asset delivery.
```

## Image Preparation and Stock Pages

Images can be collected in a **dedicated stock page** for sharing and referenced by filename from any page.

- Specify the **original filename at upload time** in `file` and `photo`.
- Attach images to the reference page (whether stored in S3, GCS, local storage, or MongoDB, reference URLs are standardized to `/attachment/{id}` format, so operation is the same).

When `src` is omitted, the default reference destination for floor plan images is the `/media-library` page. By collecting floor plans there, each page can reference them by just specifying `file`. The GUI edit image list also displays images from this page. To change the default page name, configure `defaultSrc`.

## CAD Drawing Usage (Optional)

You can specify CAD drawings (`.dxf` / `.jww`) in `file`. Conversion is delegated to an **external conversion API** in this design. Both DXF and JWW are supported (conversion is handled by the API [growi-cad-convert-api](https://github.com/kawakin26/growi-cad-convert-api)).

- When `cadConvertApi` is set, if `file` is a CAD file, the plugin queries the conversion API, obtains the converted image (SVG), and displays it.
- If the conversion API is not set, not running, or conversion fails, it falls back to normal attachment resolution → static path.

### Integration with the conversion API (registered-asset method)

The normal workflow of this plugin is the **"registered-asset method."** A CAD file (or image) is **registered with the API once** on the stock page (`POST /assets`), and the map syntax references it by its **registered name** (not the original raw file name). At display time, the plugin resolves the registered asset (`GET /assets`) and the API delivers the converted SVG (or the original image).

- **Do not specify a raw CAD file name directly in the syntax.** Referencing by registered name is the premise. If you write a raw file name directly, ordinary viewers usually lack view permission for the stock page (`/media-library`) and cannot display it (i.e., it does not coexist with a private-stock setup).
- Registered assets are **delivered by the API independently of GROWI permissions**, so even if you restrict the stock page to be viewable only by the editing group, the maps are shown to everyone.
- For the API server-side settings (`GROWI_BASE_URL` / `GROWI_TOKEN`, auth method, reverse proxy, caching, etc.), see the README of [growi-cad-convert-api](https://github.com/kawakin26/growi-cad-convert-api). Keep the token in the **API server's environment variables**, and **never write it in this plugin's syntax or custom script** (the token is not exposed to the browser).

```{note}
The conversion API also has `/convert` (an endpoint that converts CAD on the fly), but it is normally not used in the current GUI workflow (the registered-asset method is the canonical path). See the [growi-cad-convert-api](https://github.com/kawakin26/growi-cad-convert-api) README for details.
```

## Map Asset Registration (For MAP Editors)

If the CAD upload orientation is incorrect, or if you want to **deliver images via API** to viewers, MAP editors can **register assets under alternative names** (no CAD software needed). This feature is only available when the conversion API is configured.

1. Open the stock page (default `/media-library`)
2. Click the **"📋 Register Map Assets"** button in the bottom right
3. On the **"Register Diagrams" tab**, select a CAD or image (filter by filename; type badges distinguish CAD/image, registered items are green with "Done" badge)
4. **For CAD**: Choose orientation with `0/90/180/270°` buttons and confirm in preview / **For images**: Confirm original preview (no rotation option)
5. Enter a **registration name** (name to use in syntax `file`; recommend a different name than the original) and click **"Register with this orientation"** / **"Register this image"**
6. Thereafter, writing `file="<registration name>"` in the syntax displays that asset

Registration characteristics:

- **CAD**: **SVG with baked orientation** is saved on the API side and behaves as an independent asset cut off from the original CAD (deleting the original CAD later doesn't affect display). Orientation cannot be changed. To change it, **re-register under a different name**.
- **Image**: The original is taken into the API and subsequently delivered via API. Since no rotation is applied, correct the orientation with image editing software beforehand.
- **Deletion is not available via UI** (to avoid breaking existing pages; future server management tools will handle this).

```{note}
The "Register Map Assets" button appears only when the conversion API (`cadConvertApi`) is configured and the current page is the stock page (`defaultSrc`). By limiting view/edit permissions of the stock page to the MAP editor group, registration operations can be restricted to editors.
```

## Confidential Operation (Hide media-library and Show Only Maps)

Registered assets are **delivered via API**, so even if the stock page (`/media-library`) is limited to **edit group only** viewing, registered maps (CAD and images) are shown to viewers. Because delivery is independent of the original file's attachment permissions, you can operate in a way that "shows media-library only to editors, shows maps to everyone."

```{important}
Hiding media-library is fundamentally for "behind-the-scenes organization" and is not a security boundary (neither registered assets nor attachments protect against third parties who know the delivery URL). If you don't need CAD conversion and want easy use, you can abandon confidentiality and operate with a public stock page. When doing confidential operations, **register all CAD and images beforehand** to use on maps (direct reference of unregistered files won't display after confidentiality).
```

## Security (When Publishing the Conversion API)

```{caution}
The conversion API pointed to by `cadConvertApi` has **write endpoints** like registration (`POST /assets`) and deletion (`DELETE /assets`) (there is also a convert endpoint `POST /convert`, but it is normally not used in the current workflow). Publishing these carelessly to the internet risks third parties arbitrarily registering/deleting assets—breaking maps on published pages.

- Protect on the API side. **Do not write a protective token in this plugin's settings (`GROWI_CUSTOM_MAP_CONFIG`)** (custom scripts run on all pages and tokens expose to viewer browsers).
- When using the "Register Map Assets" UI from browser, **protect registration and deletion paths with IP restriction or BASIC authentication on the reverse proxy (Apache, etc.)**.
- For specific countermeasures (`ADMIN_TOKEN`, limiting `CORS_ORIGINS`, Apache configuration examples, etc.), see [growi-cad-convert-api README security section](https://github.com/kawakin26/growi-cad-convert-api/blob/main/README.md#security).
```

## Troubleshooting

### "Map file not found" displayed

- **With Conversion API**: Verify that the name specified in `file` matches the **registered asset name**. Registered maps can be selected from "🛠️ Create Map" in edit mode (the registration name is auto-filled). If you're directly writing raw filenames from media-library in `file`, in confidential operations it can't be resolved and shows this message (ask a MAP editor to register it).
- **Without Conversion API**: Check that the `file` **attachment filename** matches attachments on the stock page (default `/media-library`) and that the page is viewable (public visibility).
- Reference photos (`photo`) are always resolved from attachments on the page where the syntax was written in either mode.

### GUI Map List Is Empty

- **With Conversion API**: When MAP editors register maps (CAD/images) from "📋 Register Map Assets", they appear here. Also verify that the conversion API (`cadConvertApi`) is correctly configured and running (if not set or stopped, can't retrieve registered assets).
- **Without Conversion API**: The list is built from images attached to the stock page (default `/media-library`). Check that the stock page has images attached and that it's viewable.

### Edit Button Not Appearing

Check that you're in edit mode (URL ends with `#edit`). It won't display in view mode.

### Markers Not Displayed After Configuration Change

Right after changing custom scripts or configuration, browser-cached old scripts and new configuration temporarily coexist, and markers may not render. **Force reload the page (hard refresh: Windows/Linux `Ctrl+Shift+R`, Mac `Cmd+Shift+R`)** to resolve. This is not a plugin bug but a temporary cache-related phenomenon during configuration application.

### Images from Different Pages Not Resolving

The plugin obtains page IDs and attachment lists via GROWI APIs (`/_api/v3/page`, `/_api/v3/attachment/list`). If GROWI version produces different API response structures, check these responses in your browser developer tools Network tab and adjust how `getPageIdByPath` / `getAttachmentsForPage` in `src/common.ts` extract data (see {doc}`extending`).

### Syntax Not Applied / Script Not Loading

Check these in order:

1. Is the plugin **enabled** in the admin screen?
2. Are build artifacts (`dist/assets/client-entry-*.js` and `dist/.vite/manifest.json`) **committed to the repository** (did you run `npm run build` and push)?
3. Does the page's HTML source have `<script src="/static/plugins/{org}/{repo}/dist/assets/client-entry-*.js">` injected?
4. If updated, after pushing to GitHub, **reinstall** from the admin plugin card (GROWI re-fetches the ZIP, so it must be pushed first)

The path where GROWI delivers plugins is `/static/plugins/{org}/{repo}/...` (not `/plugins/...`).
