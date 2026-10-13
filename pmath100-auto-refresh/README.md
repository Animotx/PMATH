# PMath100 Login Auto Refresh

Automatically reloads `https://pmath100.com/login` every 10 seconds while that exact page is open. It does not run on the dashboard or other pages, and it does not click or interact with page controls.

## Load or update in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this folder, or click the existing extension's **Reload** button to apply the update.
4. Open or reload `https://pmath100.com/login`.

The refresh timer starts automatically on the login page. When you navigate away, the page script and timer stop. Returning to the login page starts it again.
