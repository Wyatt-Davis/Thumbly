# Changelog

All notable changes to Thumbly are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-10-20

### Added

- Paste a YouTube link, or a bare video ID, and download a cropped JPEG thumbnail.
- Links can be a normal video, a Short, a Live URL, a youtu.be link, an embed link, or an 11-character video ID.
- Drag a crop at 16:9, 9:16, or 1:1. Original keeps the thumbnail's own size and does not scale it.
- Choose an export size for cropped ratios: 512, 1024, 1280, or 1920 on the long side.
- Batch mode: one link per line, saved together as a zip. JSZip 3.10.1 is included in the page.
- A recent list that remembers the aspect ratio and crop for each video.
- Filename templates with `{title}`, `{channel}`, `{date}`, and `{aspect}`.
- Light and dark themes.
- Keyboard shortcuts.
- A single-file page and an equivalent split source under `src/`.

[1.0.0]: https://github.com/Wyatt-Davis/Thumbly/releases/tag/v1.0.0
