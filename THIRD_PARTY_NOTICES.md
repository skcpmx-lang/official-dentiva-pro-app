# Dentiva Pro — Third-party notices

Dentiva Pro is proprietary software © 2026 Shohan Khan. It is built on the open-source components listed
below, each of which is used under its own licence. This file is generated from the installed dependency
tree by `npm run audit:deps --write` and is verified by the same script in CI, so it always matches what
the installer actually contains. Nothing here is fetched at run time: every component is bundled inside
the installed application.

Generated: 2026-09-30

## Components

| Component | Version | Licence | Project |
|---|---|---|---|
| @fontsource/inter | 5.3.0 | OFL-1.1 | https://github.com/fontsource/font-files |
| @fontsource/noto-sans-bengali | 5.3.0 | OFL-1.1 | https://github.com/fontsource/font-files |
| better-sqlite3 | 13.0.3 | MIT | https://github.com/WiseLibs/better-sqlite3 |
| cookie | 1.1.1 | MIT | https://github.com/jshttp/cookie |
| fflate | 0.8.3 | MIT | https://github.com/101arrowz/fflate |
| lucide-react | 1.49.0 | ISC | https://github.com/lucide-icons/lucide |
| node-addon-api | 8.9.2 | MIT | https://github.com/nodejs/node-addon-api |
| react | 19.3.0 | MIT | https://github.com/react/react |
| react-dom | 19.3.0 | MIT | https://github.com/react/react |
| react-router | 7.18.4 | MIT | https://github.com/remix-run/react-router |
| react-router-dom | 7.18.4 | MIT | https://github.com/remix-run/react-router |
| scheduler | 0.28.0 | MIT | https://github.com/react/react |
| set-cookie-parser | 2.7.2 | MIT | https://github.com/nfriedly/set-cookie-parser |
| zod | 4.6.5 | MIT | https://github.com/colinhacks/zod |
| zustand | 5.0.15 | MIT | https://github.com/pmndrs/zustand |

## Licence texts

### ISC

Applies to: lucide-react 1.49.0

### MIT

Applies to: better-sqlite3 13.0.3, cookie 1.1.1, fflate 0.8.3, node-addon-api 8.9.2, react 19.3.0, react-dom 19.3.0, react-router 7.18.4, react-router-dom 7.18.4, scheduler 0.28.0, set-cookie-parser 2.7.2, zod 4.6.5, zustand 5.0.15

### OFL-1.1

Applies to: @fontsource/inter 5.3.0, @fontsource/noto-sans-bengali 5.3.0


## Notes

* SQLite is in the public domain; `better-sqlite3` is the MIT-licensed binding that exposes it to the
  application.
* Inter and Noto Sans Bengali are bundled under the SIL Open Font License 1.1 so that text and Bengali
  script render identically on every machine with no font installation and no network access.
* Electron bundles Chromium, Node.js and their own third-party components; their notices are included in
  the application package under `licenses`.
* No component in this list requires the application to publish source, and no component contacts a
  network service.
