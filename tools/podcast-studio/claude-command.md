---
description: Update Podcast Studio to the latest version (keeps your files and chapters)
---
Update Podcast Studio, which is installed in `{{ROOT}}`.

1. Run `"{{ROOT}}/podcast-studio" update` and read its output.
2. If it says it's up to date, tell the user so in one line.
3. If it says the Studio is busy (exit code 4), tell the user which file is still transcribing or exporting,
   and offer to wait or to update anyway (`"{{ROOT}}/podcast-studio" update --force`; that job restarts afterwards).
4. If it updated and says the Studio was stopped, start it again in the background with
   `"{{ROOT}}/podcast-studio" start` and tell the user to refresh the Studio page in the browser.
5. If setup reports something missing, follow "Install / set up" in `{{ROOT}}/CLAUDE.md`.
6. Finish with one short line: the new version date and the change it lists. If the update failed, say why in plain words.
