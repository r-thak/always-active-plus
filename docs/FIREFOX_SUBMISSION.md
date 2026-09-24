# Firefox Add-ons release setup

Always Active Plus uses the stable Firefox add-on ID
`{f624adbf-e99a-451e-b3ee-582fe07c54d4}`. Do not change this ID after the
first AMO submission; Firefox uses it to associate future versions with the
same installation.

## One-time setup

1. Sign in to the [AMO Developer Hub](https://addons.mozilla.org/developers/)
   and accept the current Firefox Add-on Distribution Agreement.
2. Create credentials on the
   [AMO API keys page](https://addons.mozilla.org/developers/addon/api/key/).
3. In the GitHub repository, open **Settings → Secrets and variables → Actions**
   and create these repository secrets:
   - `AMO_API_KEY`: the AMO API key (JWT issuer).
   - `AMO_API_SECRET`: the AMO API secret (JWT secret).
4. Review `amo-metadata.json`. Its metadata is used to create the first public
   listing. Complete any additional listing text, screenshots, and support
   details requested by AMO after the first submission.

## Publish a version

1. Update `version` in `v3/manifest.json`. Firefox versions must always
   increase.
2. Commit and push the release changes.
3. Create and push a matching tag, for example:

   ```sh
   git tag v1.0.0
   git push origin v1.0.0
   ```

The `Firefox add-on` workflow runs tests, lints and packages the extension,
submits it to AMO's listed channel, and creates a GitHub Release containing the
validated package and checksum. The first AMO submission creates the listing;
later tags submit updates to the same listing. Once Mozilla approves a listed
version, Firefox distributes it automatically, so the manifest must not define
a custom `update_url`.

## Reviewer notes

The extension ships readable JavaScript directly from `v3`; it has no
transpilation, minification, bundling, remote code, or third-party runtime
libraries. A separate source-code upload is therefore unnecessary. The exact
package can be reproduced with:

```sh
node --test test/*.test.js
npx --yes web-ext@10.5.0 lint --source-dir v3
npx --yes web-ext@10.5.0 build --source-dir v3
```

See Mozilla's [web-ext signing documentation](https://extensionworkshop.com/documentation/develop/getting-started-with-web-ext/#sign-and-submit-your-extension-for-publication)
and [source submission rules](https://extensionworkshop.com/documentation/publish/source-code-submission/).
