# Tab Volume privacy policy

Effective date: October 20, 2026.

Tab Volume lets you control the playback volume of individual browser tabs. Audio processing takes place locally in your browser.

## Data used by the extension

The extension reads open tab titles, URLs, favicon URLs, audible status, and mute status to display and identify audio tabs. This information is processed locally and is not sent to the developer or a server.

Remember volume is optional and off by default. When enabled, it saves volume preferences in the extension's local browser storage. Each preference contains a tab title, the URL origin, and a volume value. The origin includes the protocol, hostname, and port when applicable. URL paths, queries, and fragments are not saved. These preferences survive browser restarts and are not synced or transmitted by the extension. The Remember volume setting itself is also saved locally.

When you authorize a tab and adjust its volume away from 100%, the extension captures that tab's audio and routes it through a local Web Audio gain node. With Remember volume enabled, opening the extension on a matching tab can also start capture to restore its saved volume. It does not capture video. Audio is not recorded, saved, or uploaded. Capture stops when you reset the volume to 100%, close the tab, or the browser ends the audio stream.

Your light or dark theme preference is saved in the extension's local browser storage. It is not synced or transmitted by the extension.

## Network requests and sharing

To display tab icons, your browser may request the favicon URLs supplied by the tabs. These requests go to the hosts serving those icons and are subject to their privacy policies. The extension sets a no-referrer policy for these images.

Tab Volume has no developer-operated server, analytics, advertising, or user accounts. It does not sell user data or send tab metadata or audio to third parties.

Tab Volume uses tab information and audio only to provide its volume controls. Its use of user data complies with the Chrome Web Store User Data Policy, including the Limited Use requirements. User data is not used for advertising, profiling, credit decisions, or unrelated purposes, and the developer does not have access to read or listen to it.

## Your controls

Audio control starts after you invoke the extension on a tab and change its volume, or when opening the extension restores a saved volume. After a browser restart, you must open the extension on a matching tab to restore its saved volume.

You can enable or disable Remember volume in Settings. Disabling it stops saving and restoring volume preferences but keeps previously saved data and does not change audio already being controlled. While Remember volume is enabled, resetting a tab to 100% removes the saved preference for its current title and origin. Resetting to 100% also stops that tab's capture.

You can uninstall the extension to remove its saved volume preferences, memory setting, theme preference, and access to your tabs.

## Contact and changes

Questions about this policy can be submitted through the [project's issue tracker](https://github.com/mateusbadalotti/tab-volume/issues). Any policy changes will be published on this page with an updated effective date.
