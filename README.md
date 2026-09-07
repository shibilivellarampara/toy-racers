# Toy Racers

Top-down toy car racing PWA. Installable on Android and iOS. Play solo, or race friends over a shared Wi-Fi/hotspot with no backend server and no accounts — pairing is done by scanning QR codes between phones.

## Why no Bluetooth?

An installed PWA on iOS runs on WebKit, which has never implemented the Web Bluetooth API and Apple has given no sign it will. So a Bluetooth-based PWA would only ever work Android-to-Android, not with iPhone friends. Instead, multiplayer here uses **WebRTC data channels** with **no signaling server** — ICE candidates are exchanged by literally scanning a QR code off the other player's screen. Both devices just need to be reachable on the same local network (same Wi-Fi, or one phone's mobile hotspot). No internet connection is required, and `iceServers` is intentionally left empty so nothing ever leaves the LAN.

If you ever need real Bluetooth specifically (e.g. for two phones with no shared network at all), that requires wrapping this app natively with Capacitor/Cordova and a BLE plugin, distributed via the App Store/Play Store instead of installed as a plain PWA. Not implemented here.

## Running it

```bash
npm install
npm run dev
```

This starts an HTTPS dev server (self-signed cert) on your machine and prints a `Network:` URL like `https://192.168.1.23:5173`. HTTPS is required in dev because:
- Camera access (`getUserMedia`, used for QR scanning) only works in a secure context.
- Service worker registration (needed to test "Add to Home Screen") only works in a secure context.

To test on a phone:
1. Make sure the phone and your dev machine are on the **same Wi-Fi network**.
2. Open the `Network:` HTTPS URL on the phone's browser.
3. Accept the self-signed certificate warning (Chrome/Safari will warn once — proceed anyway; this is only for local testing).
4. To test the full multiplayer flow, repeat on a second phone.

If your OS firewall blocks incoming connections to the dev server, allow Node.js/vite through it, or test on your dev machine's own browser first with `npm run dev -- --host` disabled SSL via `NO_SSL=1 npm run dev`.

## Building & deploying for real use

```bash
npm run build
npm run preview   # sanity-check the production build locally
```

`dist/` is a static site — deploy it to any static HTTPS host (Vercel, Netlify, GitHub Pages, S3+CloudFront, etc.). A real (non-self-signed) HTTPS certificate is required for camera access and installability outside of local dev.

### Installing on a phone

- **Android (Chrome)**: visit the site, tap the "Install app" prompt or menu → "Add to Home screen".
- **iOS (Safari)**: visit the site, tap Share → "Add to Home Screen". iOS ignores the manifest's `display: fullscreen`/orientation hints to some degree, but the app still installs and runs full-screen without Safari's UI.

## How multiplayer pairing works

1. Host taps **Host a Race**, then **+ Add Player**. This generates a WebRTC offer, shown as a QR code.
2. The joining friend taps **Join a Race** → **Scan Host's Invite**, scans that code with their camera. Their device generates an answer and shows it as its own QR code.
3. The host taps **Scan Their Answer Code** and scans the friend's screen. The data channel connects and the friend appears in the roster.
4. Repeat step 1–3 for each additional friend (host relays state between all connected guests — a star topology, so no one else needs to scan each other).
5. Host taps **Start Race** — everyone gets a synced 3-2-1 countdown and races the same track for 3 laps.

Each car simulates its own physics locally and broadcasts position ~20 times/second; the host is authoritative for lap/finish order to keep placements consistent across devices.

## Project structure

- `src/game/` — physics (`physics.ts`), track/collision (`track.ts`), rendering (`renderer.ts`), input (`input.ts`), the fixed-timestep loop (`loop.ts`), and race/session orchestration (`race.ts`).
- `src/net/` — WebRTC plumbing with no signaling server (`webrtc.ts`), QR encode/scan (`qr.ts`), the host/guest lobby state machines (`lobby.ts`), and the wire protocol (`protocol.ts`).
- `src/ui/` — small DOM helper (`dom.ts`) and the single `App` class (`screens.ts`) that owns all screens (menu, host/join lobby, HUD, results) and wires game + net together.
- `scripts/` — one-off icon generation from SVG source (not part of the app bundle).

## Known limitations / good next steps

- Only one track (oval) and a fixed 3-lap race; no track selection.
- No mid-race reconnect if a guest's connection drops.
- No sound.
- Car/track art is procedurally drawn with canvas primitives, not illustrated sprites — swap `drawCar`/`drawTrack` in `src/game/renderer.ts` for real art if desired.
- Orientation is locked in the manifest to landscape, but neither Android nor iOS reliably enforces that for an installed PWA, so there's a portrait "please rotate" hint (CSS-only, not a hard block) instead.
