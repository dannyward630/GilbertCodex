# Gilbert Codex Promo Assets

This folder contains a lightweight promotional scene for sharing Gilbert Codex as an open-source desktop agent workspace.

## Outputs

- `gilbert-codex-promo.webm`: 1280x720 promo video, no audio, suitable for GitHub Releases, issue attachments, project pages, and social posts.
- `gilbert-codex-promo-poster.png`: static frame for README previews and link cards.
- `promo.html`: source scene. Open it in a browser to preview the animation.

## Refreshing The Video

The renderer uses Playwright to open the HTML scene and record the canvas animation with the browser's built-in WebM encoder.

```powershell
node docs/promo/render-promo-video.mjs
```

If Playwright is not available in the local environment, install it outside the app runtime or run the scene manually in a Chromium-based browser and use a screen recorder. This promo tooling is intentionally kept out of the production dependency graph.

## GitHub Sharing Notes

GitHub READMEs are friendlier to images than repo-hosted video tags. Use the poster image in README copy, and upload the WebM to a GitHub Release, discussion, issue, pull request, or social post when you want autoplay-style video sharing.
