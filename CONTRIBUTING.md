# Contributing

Questions, bug reports, and ideas are welcome. You do not need to know how to code to open an issue. Describe what you clicked, what you expected, and what happened. A public video link is useful when a particular thumbnail misbehaves.

## Changing the app

The files in `src/` are the source. `index.html` at the root of the repository is generated from them, and that generated file is what the website serves.

1. Edit `src/index.html`, `src/styles.css`, or `src/app.js`.
2. Rebuild the single-file page:

   ```bash
   node scripts/build.mjs
   ```

3. Check the result:

   ```bash
   node scripts/build.mjs --check
   node scripts/check.mjs
   ```

Node.js 18 or newer is enough. There is nothing to install.

Open `src/index.html` in a browser to try the split version, and open the rebuilt `index.html` to try the single-file version. Both should behave the same way.

Please commit the rebuilt `index.html` together with the `src/` change. Continuous integration fails when the published page does not match `src/`.

## Pull requests

Keep the change focused. Say what a person using Thumbly will notice. The pull request template has a short checklist.
