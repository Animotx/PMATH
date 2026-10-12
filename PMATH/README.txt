PMath Schedule Controller (Chrome MV3)

Install: extract this folder, open chrome://extensions, enable Developer mode, choose Load unpacked, and select the “PMath Schedule Controller” folder.

The floating panel and toolbar popup each have an Enable/Disable control. The extension uses the computer's local clock. Scheduled active windows are 7:00 AM–12:12 PM and 12:20 PM–6:21 PM. From 6:21 PM it follows the site's logout link when available. During active windows it clicks the site's normal login button only if the browser has already filled both login fields, then navigates to the math game page after login.

It does not store or read credentials and does not answer, submit, or skip questions. Keep Chrome open and signed in to the desktop for alarms and schedule actions. Refresh recovery is limited to five attempts per ten minutes when an unavailable-service message is detected.

The provided login HTML shows #loginForm, the userName and passWord fields, and #loginBtn. The extension uses the supplied game path and the site's logout link pattern from your request. If the site changes its routes or wording, adjust content.js accordingly.
