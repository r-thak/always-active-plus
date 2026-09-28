# Always Active Plus

This extension protects against web pages tracking the activity state of the page. Some websites use this track to only offer services when the tab is active. By installing this extension a small script is injected into every webpage which overwrites the "document.visibilityState", and "document.hidden" properties to pretend the tab is always in the active state (document.visibilityState = 'visible' and document.hidden = false).

It also suppresses DOM event paths that can expose a transition to another app: focus/blur and focus-boundary events, visibility changes, page hiding, pointer capture loss, and mouse/pointer boundary events caused by moving onto an external overlay. Configure keyboard events to block from the options page using a `KeyboardEvent.key`, `KeyboardEvent.code`, or numeric `keyCode` value; `AltGraph` is blocked by default. A hostname policy can opt out with `"keyboard"`, `"mouseleave"`, or `"mouseout"`.

The options page has mouse re-entry controls. Interpolation at 0 leaves mouse movement immediate; higher values make generated mouse and pointer move events follow a smooth curve through buffered positions more slowly after the browser loses focus. The interpolation, start smoothness, and stop smoothness settings use their raw 0–2 values in the motion calculations. When another app covers the browser without sending an exit event, a pause in mouse input followed by a distant move starts the same smoothing from the last position seen by the page. Start and stop smoothness control acceleration and braking. The defaults are 0.13 interpolation, 0.01 start smoothness, and 0.01 stop smoothness. A second return joins the unfinished path in order. A mouse click ends interpolation and moves the generated cursor position to the click. Native movement resumes when the generated cursor catches up.

By default, the extension is enabled on all sites. The options page can switch to
an opt-in hostname list; in all-sites mode, the hostname list is a set of
exceptions.

## YouTube Preview
[![YouTube Preview](https://img.youtube.com/vi/7gr44trZr_o/0.jpg)](https://www.youtube.com/watch?v=7gr44trZr_o)

## Development

```sh
node --test test/*.test.js
node scripts/test-browser-interpolation.mjs
npx --yes web-ext@10.5.0 lint --source-dir v3
npx --yes web-ext@10.5.0 build --source-dir v3
```

The browser interpolation test drives real Chrome mouse input through the injected script. Set `TEST_UNPACKED=1` to load and test the unpacked extension through Chrome DevTools, including its content script registration. Add `TEST_SITE=1` to test the DPIonMouse movement canvas directly; this requires network access. Add `TEST_CANVAS_ONLY=1` to verify that leaving just the canvas does not interpolate, `TEST_OVERLAY=1` to verify that a DOM overlay does not interpolate, `TEST_OS_OVERLAY=1` to test an in-canvas return after a quiet overlay gap, `TEST_SECOND_ENTRY=1` to test two focus returns in order. Set `TEST_SETTINGS=1` to measure each slider's effect in Chrome. Set `CHROME_BIN` to a Chromium-based browser binary if Chrome is installed elsewhere.

To create a Chrome-compatible MV3 build and ZIP package:

```sh
node scripts/build-chrome.mjs
```

The unpacked extension is written to `dist/chrome`; load that directory through
Chrome's **Extensions** page with Developer mode enabled. The corresponding ZIP
is written to `dist/packages` for Chrome Web Store upload.

Tagged versions are validated, submitted to Firefox Add-ons, and attached to a
GitHub Release automatically. See [Firefox release setup](docs/FIREFOX_SUBMISSION.md).

## Links

- [Source code](https://github.com/r-thak/always-active-plus)
- [Issue tracker](https://github.com/r-thak/always-active-plus/issues)
- [Privacy statement](PRIVACY.md)

## License

Always Active Plus is released under [MPL-2.0](LICENSE).
