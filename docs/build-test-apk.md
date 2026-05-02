# Building a Bundie test APK (Solana Mobile / Seeker TWA)

This is the local-machine half of the TWA setup. The webapp side
(manifest, MWA wiring, icons, assetlinks scaffold) is already in the
repo — this doc covers everything you need to do on a workstation
with Java + Android SDK to produce a signed APK you can sideload.

**This produces a TEST APK only.** It does not submit to the Solana
dApp Store — no Publisher Portal, no KYC, no SOL cost.

---

## Prerequisites

- **Java 17+** (`brew install openjdk@17` or `apt install openjdk-17-jdk`)
- **Android command-line tools** (Android Studio installs these; or
  download from https://developer.android.com/studio#cmdline-tools).
  The `ANDROID_HOME` env var must point at the SDK root.
- **Node 18+** + `npm` (for Bubblewrap)
- An **Android device** (Seeker, Saga, or any Android phone) in USB
  debug mode for `adb install`, OR a way to send the APK to a tester.

---

## One-time: generate signing keystore

The keystore signs every APK. **Keep the file and password forever** —
every future update to the same `package_name` MUST be signed by it.
Lose it and you can't ship updates without changing the package name
(and re-doing the assetlinks dance).

```bash
keytool -genkey -v -keystore bundie-release.keystore \
  -alias bundie -keyalg RSA -keysize 2048 -validity 10000
```

Stash the keystore file, alias, and password in your password manager
or a secure vault.

---

## Build steps

### 1. Install Bubblewrap

```bash
npm i -g @bubblewrap/cli
```

### 2. Initialize the project

```bash
mkdir bundie-twa && cd bundie-twa
bubblewrap init --manifest https://app.solana.bundie.fi/manifest.json
```

When prompted:
- **Domain:** `app.solana.bundie.fi`
- **Application name:** `Bundie`
- **Short name:** `Bundie`
- **Application id (package name):** `fi.bundie.app` — must match
  `manifest.json#id` and the `package_name` in
  `packages/web/public/.well-known/assetlinks.json`
- **Display mode:** `standalone`
- **Status bar color:** `#0a0a0f`
- **Splash screen color:** `#0a0a0f`
- **Icon URL:** `https://app.solana.bundie.fi/icons/icon-512.png`
- **Maskable icon URL:** `https://app.solana.bundie.fi/icons/icon-maskable.png`
- **Use existing keystore?** `Yes` → point at the keystore from the
  previous step.

### 3. Trim the locale list (optional, smaller APK)

Edit the generated `app/build.gradle`:

```gradle
android {
    defaultConfig {
        // ... existing fields ...
        resConfigs "en"   // <- add this line
    }
}
```

### 4. Get the SHA-256 fingerprint

```bash
keytool -list -v -keystore bundie-release.keystore -alias bundie | grep SHA256
```

Copy the hex string (looks like `AB:CD:EF:...`).

### 5. Update assetlinks.json on the live webapp

Edit `packages/web/public/.well-known/assetlinks.json` (in the
Bundie monorepo). Replace `REPLACE_WITH_YOUR_KEYSTORE_SHA256_FINGERPRINT`
with the fingerprint from step 4. Then commit + push + redeploy
`bundie-app`. **Verify it's live before building the APK:**

```bash
curl https://app.solana.bundie.fi/.well-known/assetlinks.json
```

Without a matching fingerprint here the TWA will show the Chrome
browser bar instead of fullscreen.

### 6. Build the signed APK

```bash
bubblewrap build
```

This produces:
- `app-release-signed.apk` — install this
- `app-release-bundle.aab` — for Google Play submission only

### 7. Install on a device

```bash
# Connected via USB with adb
adb install app-release-signed.apk

# Or push the APK to the device and tap to install (Android 8+ asks
# you to enable "Install unknown apps" for the file manager / browser
# the first time).
```

---

## Verifying the install

1. Launch the app from the home screen.
2. The first launch should be **fullscreen with no Chrome address
   bar**. If you see the address bar, the assetlinks check failed —
   double-check step 5.
3. Connect a wallet. You should see the on-device Solana wallet
   (Phantom / Solflare / Backpack mobile) prompt — that's MWA via
   `@solana-mobile/wallet-standard-mobile` working.

---

## Updating the test APK

For a new version:

```bash
cd bundie-twa
bubblewrap update    # pulls latest manifest changes
bubblewrap build
adb install -r app-release-signed.apk   # -r reinstalls keeping data
```

---

## Future: shipping to the dApp Store

When you're ready to publish (separate from this test flow):

1. Sign up at https://publish.solanamobile.com — KYC/KYB.
2. Connect publisher wallet (Phantom/Solflare browser ext) — this
   wallet must be permanent.
3. Pick storage provider (ArDrive recommended).
4. Click "New dApp", fill metadata, upload icons + screenshots.
5. Click "New Version", upload `app-release-signed.apk`.
6. Approve on-chain signing requests (~0.2 SOL).
7. Review takes 3–5 business days.
