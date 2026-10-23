# Changelog

Newest version first. `make.js` reads the top entry: its heading gives the version and date, and its bullet points become the "What's new" list in the game's Updates screen. To ship an update, add a new entry at the top with a higher version and merge to `main`; the release workflow builds the APK and publishes it.

## 1.0.0 (2026-10-23)
- First Android app build. The game checks for new versions and downloads them from the Updates section of the Intel tab.
- Saves now carry over between versions, and the game keeps a backup of your last save before an update touches it.
- Includes everything so far: city provinces and roads, seven resources, city buildings, 16 unit types, research, the market, missions, the terrain map, and a late game that keeps going.
