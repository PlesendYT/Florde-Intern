FLORDE — Website Project
=========================

Structure:

florde-website/
├── index.html            Home page
├── features.html         Features (Editor, Terminal, Git, Docker, Browser, MCP, Connected Apps)
├── providers.html        27 AI Providers + Task Router
├── tools.html            13 Code Intelligence Tools + Security
├── download.html         Download page (links to the folders below)
│
├── assets/
│   ├── css/style.css     Shared stylesheet for all pages
│   ├── js/main.js        Terminal animation + scroll effects
│   └── img/florde-icon.svg  Placeholder logo
│
└── downloads/              <-- Place your built files here
    ├── windows-exe/         Florde-Setup.exe
    ├── linux-deb/           florde.deb
    ├── linux-appimage/      Florde.AppImage
    ├── macos-dmg/           Florde.dmg
    └── icon/                icon.ico, icon.icns, icon.png

View Locally
------------
Open index.html in your browser (double-click, no server needed).

Adding Files
------------
1. Build your app (npm run build / build:win / build:linux / build:mac).
2. Copy the output files into the matching downloads/ subfolder.
3. Check the expected filename in each subfolder's README.txt —
   or update the links in download.html if you use different names.
4. Replace assets/img/florde-icon.svg with your real logo if needed.

Design
------
Dark purple/blue color scheme. Fonts: Sora (headings),
Inter (body text), JetBrains Mono (terminal/labels).
All colors and variables are centralized in assets/css/style.css (:root).
