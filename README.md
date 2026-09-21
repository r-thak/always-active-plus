# Always Active Plus

This extension protects against web pages tracking the activity state of the page. Some websites use this track to only offer services when the tab is active. By installing this extension a small script is injected into every webpage which overwrites the "document.visibilityState", and "document.hidden" properties to pretend the tab is always in the active state (document.visibilityState = 'visible' and document.hidden = false).

It also suppresses DOM event paths that can expose a transition to another app: focus/blur and focus-boundary events, visibility changes, page hiding, pointer capture loss, and mouse/pointer boundary events caused by moving onto an external overlay. Configure keyboard events to block from the options page using a `KeyboardEvent.key`, `KeyboardEvent.code`, or numeric `keyCode` value; `AltGraph` is blocked by default. A hostname policy can opt out with `"keyboard"`, `"mouseleave"`, or `"mouseout"`.

By default, hostnames are an opt-in list. The options page can switch to all-sites mode, where the same list becomes a set of hostname exceptions.

## YouTube Preview
[![YouTube Preview](https://img.youtube.com/vi/7gr44trZr_o/0.jpg)](https://www.youtube.com/watch?v=7gr44trZr_o)

## Development

```sh
node --test test/*.test.js
npx --yes web-ext@10.4.0 lint --source-dir v3
npx --yes web-ext@10.4.0 build --source-dir v3
```

Tagged versions are validated, submitted to Firefox Add-ons, and attached to a
GitHub Release automatically. See [Firefox release setup](docs/FIREFOX_SUBMISSION.md).

## Links

- [Source code](https://github.com/r-thak/always-active-plus)
- [Issue tracker](https://github.com/r-thak/always-active-plus/issues)
- [Privacy statement](PRIVACY.md)

## License

Always Active Plus is released under [MPL-2.0](LICENSE).
