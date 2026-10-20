<p align="center">
  <img src="assets/apple-touch-icon.png" alt="Thumbly" width="96" height="96">
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

Paste a YouTube link. Thumbly loads the best thumbnail it can find, lets you frame a crop, and saves a JPEG. There is no account and no upload.

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
- Drag a crop at **16:9**, **9:16**, or **1:1**. **Original** keeps the thumbnail's own size and does not scale it.
- Export sizes for cropped ratios: 512, 1024, 1280 (the default), or 1920 on the long side.
- Shorts open at 9:16. Other links open at 1:1.
- Batch mode saves many links as one zip. JSZip is included in the page.
- A recent list that remembers the ratio and crop.
- Filename templates, light and dark themes, and keyboard shortcuts.

## How to use

### On the website

1. Open [wyatt-davis.github.io/Thumbly](https://wyatt-davis.github.io/Thumbly/).
2. Paste a YouTube link. The thumbnail loads on its own.
3. Drag the frame if you want a different part of the picture. **Re-center** puts it back in the middle.
4. Open the menu (top right) to change the shape, the export size, or the filename.
5. Click **Download**.

The sun/moon button switches between dark and light.

### One file, no install

- On the site, open the menu and choose **Download HTML**, then open `Thumbly.html`.
- Or download [thumbly.html from the v1.0.0 release](https://github.com/Wyatt-Davis/Thumbly/releases/download/v1.0.0/thumbly.html) and open it.
- Or save [`index.html`](index.html) from this repository (**Raw**, then **Save as**) and open it.

Fetching a thumbnail needs a network connection. A lone downloaded HTML file still runs if the favicon files are not beside it.

### From a clone

```bash
git clone https://github.com/Wyatt-Davis/Thumbly.git
cd Thumbly
```

Open `src/index.html` in a browser. It is the same app, split into HTML, CSS, and JavaScript.

## Batch download

Click **Batch**, or press `B`. Paste one link per line and click **Download**.

Each picture is center-cropped with the shape and size shown in that window. Duplicate links are skipped. The zip is named `thumbly-batch-1x1-1280x1280.zip`, with the ratio and size filled in. Original exports are named `thumbly-batch-original.zip`.

## Keyboard shortcuts

Single-letter shortcuts are ignored while you are typing, while a dialog is open, or while Ctrl, Cmd, or Alt is held.

| Key | Action |
| --- | --- |
| Enter | Download the current thumbnail, when the link box is focused or nothing is focused. |
| Enter | In the filename dialog, save the template. |
| Esc | Close the open dialog, or close the menu. |
| B | Open batch download. |
| R | Re-center the crop, when a video is loaded. |
| C | Clear the link and the preview. |
| Tab | Move through an open dialog. Shift+Tab moves backward. |

## Filename templates

The default name is the video title. The menu's **Filename** item edits the pattern used for single downloads and batch downloads.

| Token | Replaced with |
| --- | --- |
| `{title}` | The video title, or the video ID if the title cannot be looked up. |
| `{channel}` | The channel name, or nothing if the lookup fails. |
| `{date}` | Today's date on your computer, as `YYYY-MM-DD`. |
| `{aspect}` | `1x1`, `16x9`, `9x16`, or `original`. |

`{channel} {title} {aspect}` is a valid pattern. The result is turned into a safe file name. Saved patterns that still contain `{id}` or `{size}` have those tokens removed on load. Any other `{token}` is ignored, and the dialog says so.

## Privacy

Thumbly runs in your browser. It has no server and no account.

- Thumbnail images come from YouTube (`img.youtube.com` and `i.ytimg.com`).
- The title and channel name come from [noembed.com](https://noembed.com/).
- Theme, export size, aspect ratio, filename pattern, and the recent list stay in this browser's `localStorage` (`thumbly-theme`, `thumbly-export-size`, `thumbly-aspect`, `thumbly-filename-template`, `thumbly-recent`).
- A recent entry stores the video ID, title, ratio, crop position, and a thumbnail URL.

YouTube and noembed see those requests. If storage is blocked, the page still runs and forgets settings when you leave.

## Browser support

Current Chrome, Edge, Firefox, and Safari. The website is the easy way to use it on a phone. Saving a file, and opening a downloaded HTML file, is more reliable on a computer.

## Project structure

```
index.html              Single-file app. This is what GitHub Pages serves.
src/index.html          Same app, split into files. Open this one directly too.
src/styles.css
src/app.js
src/vendor/jszip.min.js JSZip 3.10.1
assets/                 Favicons and the social preview image.
scripts/build.mjs       Inlines src/ into index.html.
docs/screenshots/       Images used above.
```

`src/` is the source. Paths are relative, so the site works at `/Thumbly/` on GitHub Pages. Both copies use plain `<script>` tags, so they open from disk as well as from the site.

## Development

Node.js 18 or newer. Nothing to install.

```bash
node scripts/build.mjs          # write index.html
node scripts/build.mjs --check  # fail if index.html is out of date
```

Edit the files in `src/`, rebuild, and commit `index.html` with the change. CI runs the check on every push to `main` and on pull requests.

## Contributing

Open an issue or a pull request.

## License

[MIT](LICENSE) © 2026 [Wyatt Davis](https://github.com/Wyatt-Davis).

JSZip 3.10.1 is dual-licensed MIT and GPLv3 and is used here under MIT. The copy includes pako, which is MIT. Details are at the bottom of the license file.
