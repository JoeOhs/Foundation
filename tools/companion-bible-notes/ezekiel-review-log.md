
## Checks and in-app test
- ocr-check: 113 words (all real words/transliterations) and 56 number pairs flagged; pairs triaged in context, none changed.
- In-app (tauri dev, real DB backed up, sha1 92bca7ef… restored and verified): install OK; Companion Bible follows Pane 1; Structure renders nested; notes link refs; "Hos. 5. 3" jumped Pane 1; "Ap. 4. II." opened Appendix 4 (top: section fallback). Not exercised: "View original page", reinstall-duplicate check, hover tie.
- Bundle restored with git checkout; ezekiel-pages.pdf removed; port 1420 free.
