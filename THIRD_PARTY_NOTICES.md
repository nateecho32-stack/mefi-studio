# Third-party notices

Mefi's Studio AI+ is MIT licensed (see [LICENSE](LICENSE)). It ships one
runtime dependency of its own — none — and one development dependency,
Electron, whose own notices travel with it in `node_modules/electron`.

This file covers source that was **copied or adapted into this repository**
from another project. Each entry names the upstream file, what was taken, and
what was changed, so the provenance survives a `git log` that has been
squashed or a file that has since been reformatted.

---

## BetterC0de

- **Upstream:** <https://github.com/kerim0x1/bettercode>
- **License:** MIT
- **Copyright:** Copyright (c) 2026 BetterC0de contributors
- **Taken at:** commit on `main`, 22 September 2026

### Files derived from it

| This repository | Upstream file | Relationship |
| --- | --- | --- |
| `scripts/windows-command-line.cjs` | `apps/backend/src/security/windowsCommandLine.ts` | Port. The quoting algorithm, the argv/cmd two-layer split and the `^%` treatment are theirs, unchanged in behaviour. Transliterated from TypeScript to CommonJS, `throw`n errors carry `code` instead of `statusCode`, and a Studio-specific note about `windowsVerbatimArguments` was added to the header. |
| `scripts/provider-breaker.cjs` | `apps/backend/src/provider/circuitBreaker.ts` | Adaptation. The state machine is theirs — CLOSED/OPEN/HALF_OPEN, the generation counter that stops a pre-opening call from closing the circuit behind a failure, the half-open tolerance and the single in-flight probe. Rewritten as a factory with an injected clock and no module-level singleton, to match this repository's pure-module convention (see `scripts/brains.cjs`). |

Their test files were read for coverage but not copied; `tests/windows_command_line.test.mjs`
and `tests/provider_breaker.test.mjs` were written against the documented
behaviour.

### License text

```
MIT License

Copyright (c) 2026 BetterC0de contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Adding an entry

Copying or adapting third-party source means adding a row here in the same
change, with the upstream path and an honest description of what was altered.
A file that only inspired an approach, without carrying its code, does not
belong here — put that in the file's own header comment instead.
