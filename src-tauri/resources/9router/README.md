# 9Router Runtime Resource

This directory is populated by `npm.cmd run nine-router:bundle` before Windows installer and release builds.

Generated runtime files are intentionally ignored by Git because they include a bundled Node runtime and the installed `9router` npm package. Tauri still keeps this directory as the stable resource mount point so packaged installers can include `resources/9router`.
