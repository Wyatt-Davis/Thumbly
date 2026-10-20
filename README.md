<p align="center">
  <img src="assets/icon-512.png" alt="Thumbly" width="96" height="96">
</p>

<h1 align="center">Thumbly</h1>

<p align="center">
  Crop and download YouTube thumbnails in your browser.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-111111" alt="MIT License"></a>
  <a href="https://github.com/Wyatt-Davis/Thumbly/actions/workflows/ci.yml"><img src="https://github.com/Wyatt-Davis/Thumbly/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
</p>

<p align="center">
  <a href="https://wyatt-davis.github.io/Thumbly/"><strong>Open the live app</strong></a>
</p>

Paste a YouTube link. Thumbly fetches the best thumbnail it can find, lets you frame a crop, and saves a JPEG on your computer. There is no account and no upload step.

<table>
  <tr>
    <td><img src="docs/screenshots/main.png" alt="Main view with a loaded thumbnail and a crop box" width="280"></td>
    <td><img src="docs/screenshots/batch.png" alt="Batch download window with several links" width="280"></td>
    <td><img src="docs/screenshots/light.png" alt="The same tool in light mode" width="280"></td>
  </tr>
  <tr>
    <td align="center">Main view</td>
    <td align="center">Batch download</td>
    <td align="center">Light mode</td>
  </tr>
</table>

## Features

- Normal videos, Shorts, Live links, `youtu.be` links, embed links, and a bare 11-character video ID.
- Drag a crop at **16:9**, **9:16**, or **1:1**. **Original** keeps the thumbnail's own pixel size and does not scale it.
- Export sizes for cropped ratios: 512, 1024, 1280 (the default), or 1920 on the long side. A 16:9 export at 1280 is 1280×720. A 9:16 export at 1280 is 720×1280.
- Shorts open at 9:16. Other links open at 1:1. You can change the ratio from the menu.
- Black bars baked into some 4:3 YouTube thumbnails are trimmed before the crop.
- Batch mode saves many links as one zip file. The zip library (JSZip) is included in the page, so that part does not depend on a CDN.
- A recent list of the last 10 videos, with the ratio and crop remembered.
- Filename templates.
- Light and dark themes, stored in this browser.
- Keyboard shortcuts.

## How to use

### On the website

1. Open [wyatt-davis.github.io/Thumbly](https://wyatt-davis.github.io/Thumbly/).
2. Paste a YouTube link into the box. The thumbnail loads on its own.
3. Drag the frame if you want a different part of the picture. **Re-center** puts it back in the middle.
4. Open the menu (the icon at the top right) to change the shape, the export size, or the filename.
5. Click **Download**. You get a JPEG.

The sun/moon button next to the menu switches between dark and light.

### Download one file and open it

The whole app is a single HTML file. It does not need to be installed, and it does not need a build step to run.

- On the website, open the menu and choose **Download HTML**. That saves `Thumbly.html`. Double-click the file to open it in your browser.
- Or download `thumbly.html` from the [v1.0.0 release](https://github.com/Wyatt-Davis/Thumbly/releases/tag/v1.0.0) and open that.
- Or save [`index.html`](index.html) from this repository (use **Raw**, then **Save as**) and open the saved file.

The page still asks YouTube for the picture, so you need a network connection when you paste a link. Favicon files live next to `index.html` in this repository. A lone downloaded HTML file still runs if those images are absent.

### From the source files

```bash
git clone https://github.com/Wyatt-Davis/Thumbly.git
cd Thumbly
```

Open `src/index.html` in a browser. That copy is split into HTML, CSS, and JavaScript, and it behaves the same way as the single file.

## Batch download

Click **Batch**, or press `B`. Paste one YouTube link per line and click **Download**.

Each picture is center-cropped using the shape and size shown in that window (those two settings are separate from the crop you dragged on the main page). Duplicate links are skipped. The file is named `thumbly-batch-1x1-1280x1280.zip`, with the ratio and size filled in. Original exports are named `thumbly-batch-original.zip`.

## Keyboard shortcuts

Single-letter shortcuts wait until you are not typing in a text field, no dialog is open, and you are not holding Ctrl, Cmd, or Alt.

| Key | Action |
| --- | --- |
| Enter | Download the current thumbnail. Works when the link box is focused, or when nothing is focused, and a thumbnail is on screen. |
| Enter | In the filename dialog, Enter saves the template. |
| Esc | Close the open dialog. If no dialog is open, close the menu. |
| B | Open batch download. |
| R | Re-center the crop. Works when a video is loaded. |
| C | Clear the link and the preview. |
| Tab | Move through the buttons of an open dialog, staying inside it. Shift+Tab moves backward. |

## Filename templates

The default name is the video title. Open the menu and choose **Filename** to change the pattern. The same pattern is used for single downloads and batch downloads.

| Token | Replaced with |
| --- | --- |
| `{title}` | The video title. If the title cannot be looked up, the video ID is used. |
| `{channel}` | The channel name. Empty if the lookup fails. |
| `{date}` | Today's date on your computer, as `YYYY-MM-DD`. |
| `{aspect}` | `1x1`, `16x9`, `9x16`, or `original`. |

An example pattern is `{channel} {title} {aspect}`. The result is cleaned into a safe file name: accents are stripped, words are joined with hyphens, and the name is limited in length. Tokens this app no longer offers (`{id}` and `{size}`) are removed from a pattern that was saved by an older copy. Any other `{token}` is ignored, and the dialog tells you so.

## Privacy

Thumbly runs in your browser. The project has no server and no account.

- Your browser requests thumbnail images from YouTube's image servers (`img.youtube.com` and `i.ytimg.com`).
- Your browser requests the title and channel name from [noembed.com](https://noembed.com/), which provides a YouTube oEmbed response. That is what fills in `{title}` and `{channel}`.
- Settings and the recent list stay in this browser's `localStorage`. The keys are `thumbly-theme`, `thumbly-export-size`, `thumbly-aspect`, `thumbly-filename-template`, and `thumbly-recent`.
- A recent entry stores the video ID, title, aspect ratio, crop position, and a thumbnail URL. It does not store the image itself.

YouTube and noembed see the requests your browser makes to them, the same as if you opened those addresses yourself. If storage is blocked, Thumbly still runs; it just will not remember settings after you leave.

## Browser support

Thumbly works in current versions of Chrome, Edge, Firefox, and Safari. It needs a browser that can draw to a canvas, download a file, and run modern JavaScript.

The website is the comfortable way to use it on a phone. Saving files, and opening a downloaded HTML file, is more reliable on a computer.

## Project structure

```
index.html                 Single-file app. GitHub Pages serves this.
src/index.html             Same app, split into separate files.
src/styles.css             Styles.
src/app.js                 Page script.
src/vendor/jszip.min.js    JSZip 3.10.1, with its license banner.
assets/                    Icons, manifest images, and the social preview.
manifest.webmanifest       Web app manifest.
scripts/build.mjs          Inlines src/ into index.html.
scripts/check.mjs          Sanity checks used by CI.
docs/screenshots/          README images.
```

`src/` is the source of truth. The root `index.html` is generated. Both copies are functionally the same: classic `<script>` tags, no modules, so each one opens directly from disk (`file://`) as well as from the site.

Paths inside the page are relative. The site is published from the repository root, which GitHub Pages serves at `/Thumbly/`.

## Development

Requirements: Node.js 18 or newer. No packages to install.

```bash
node scripts/build.mjs            # write index.html
node scripts/build.mjs --check    # fail if index.html is out of date
node scripts/check.mjs            # icons, license, paths, and page structure
```

`npm run build` and `npm run check` call the same scripts. This repository is not an npm package.

Continuous integration runs both checks on every push to `main` and on pull requests. Edit the files in `src/`, rebuild, and commit `index.html` with the change.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Issues are welcome, including reports written without any code.

## License

[MIT](LICENSE) © 2026 Wyatt Davis.

JSZip is dual-licensed MIT and GPLv3 and is used here under MIT. pako, which JSZip bundles, is MIT. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Credit

Thumbly is made by [Wyatt Davis](https://github.com/Wyatt-Davis).
