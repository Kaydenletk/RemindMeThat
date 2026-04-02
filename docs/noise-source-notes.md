# Noise Source Notes

Date checked: 2026-04-02

## Recommendation

For the shipping extension:

- Keep `white`, `pink`, and `brown` procedural in `offscreen/offscreen.js`.
- Use real audio files only when a texture actually benefits from recorded or authored material.
- Treat `black noise` as `dark noise` or a bass-heavy brown-noise variant.

Reason:

- The current procedural engine already avoids bundle bloat.
- The best public CC0 references we found are high quality, but each HQ preview is roughly 33-35 MB.
- Bundling all three long-form files directly would make the extension package unnecessarily heavy.

## Best sources found

The machine-readable manifest lives at [assets/audio/sources.json](/Users/khanhle/Desktop/Remindmethat/assets/audio/sources.json).

Primary picks:

- Rain: `morsine / 607070`
- Forest: `BurghRecords / 456123`
- Ocean: `INNORECORDS / 456899`
- Cafe: `CVLTIV8R / 813868`
- White noise: `PhoenixSTW / 846711`
- Pink noise: `PhoenixSTW / 846717`
- Brown noise: `PhoenixSTW / 846714`
- Black noise substitute: `hear-no-elvis / 591482`

Current packaged assets:

- [rain-base.mp3](/Users/khanhle/Desktop/Remindmethat/assets/sounds/rain-base.mp3)
- [forest-base.mp3](/Users/khanhle/Desktop/Remindmethat/assets/sounds/forest-base.mp3)
- [ocean-base.mp3](/Users/khanhle/Desktop/Remindmethat/assets/sounds/ocean-base.mp3)
- [cafe-base.mp3](/Users/khanhle/Desktop/Remindmethat/assets/sounds/cafe-base.mp3)
- [dark-base.mp3](/Users/khanhle/Desktop/Remindmethat/assets/sounds/dark-base.mp3)

These were derived from CC0 Freesound HQ preview sources and trimmed/re-encoded for extension use.

Forest note:

- The forest asset now uses a more popular BurghRecords recording and no longer layers synthetic chirps in the engine.
- That change was intentional to make the forest preset sound more like a real field recording and less like an algorithmic ambience generator.

## Licensing

- All listed sources are CC0 on Freesound.
- The public pages expose HQ preview URLs that can be fetched without login.
- The original file download links still require Freesound login, even for CC0 entries.

## Practical next step

If you decide to ship file-based noise later, the right flow is:

1. Download the HQ preview or full original manually.
2. Trim it to a seamless 20-60 second loop.
3. Re-encode to a smaller shipping format such as `ogg` or `mp3`.
4. Only then add it to the extension package.
