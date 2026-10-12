Cazie's Flag Challenge Helper — Chrome unpacked extension

Install:
1. Extract the ZIP, if using the ZIP copy.
2. Open chrome://extensions in Chrome.
3. Turn on Developer mode.
4. Choose Load unpacked and select this folder (the folder containing manifest.json).
5. Disable/remove the old Tampermonkey copy so two copies do not run on the same page.

The extension injects the helper only on https://cazie-s.onrender.com/.
The current version uses the newest matching flag SVG in the chat history (including 900×600 and square SVGs), preventing an earlier challenge's flag from being reused. The “Capture current flag” button renders a preview of the newest flag. It compares all rect elements by normalized position, size, and fill color as an added signal, alongside the full image's 3:2 color and edge-pattern comparison against Flagpedia and flag-icons. A per-challenge fingerprint blocks duplicate submissions; if no result appears, auto-answering pauses instead of resubmitting. It submits with Send, waits for the result, and continues with Next Challenge. Low-confidence matches show the next closest candidate in the helper status. The earlier flag-question interface remains supported.
Automatic retries call Chrome's cache-bypassing tab reload API. Click the extension toolbar button to hard-refresh the current tab, or use Ctrl+Shift+Y. Change the shortcut at chrome://extensions/shortcuts.
