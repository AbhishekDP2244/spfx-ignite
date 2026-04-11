# 🔥 Gulp Runner — VS Code Extension

> A chatbot-style sidebar panel to run your **SharePoint Framework (SPFx)** Gulp build pipeline with a single click — no terminal juggling, no context switching.

![Version](https://img.shields.io/badge/version-0.2.0-blue)
![VS Code](https://img.shields.io/badge/VS%20Code-1.85%2B-blue)
![License](https://img.shields.io/badge/license-MIT-green)

---

## ✨ What's Inside

Gulp Runner gives SPFx / React-for-SharePoint developers a persistent sidebar panel that replaces repetitive terminal commands with a clean, visual interface.

---

## 🖥 UI Overview

The panel is divided into six sections:

| Section | Purpose |
|---------|---------|
| 📁 **Workspace** | Auto-detects if the open folder is an SPFx project |
| 🔧 **Environment** | Shows live Node.js, npm, and Gulp versions |
| ⚡ **Actions** | Buttons to trigger all pipeline flows |
| 🔄 **Pipeline** | Visual step-by-step progress indicator |
| 📋 **Log** | Color-coded real-time output stream |
| 🕐 **History** | Last 20 runs with timings — click to expand |

---

## ⚡ Features

### 🔥 Build UI Package
Runs all 4 SPFx production build commands in sequence with a single click:
1. `gulp clean`
2. `gulp build`
3. `gulp bundle --ship`
4. `gulp package-solution --ship`

The pipeline stops automatically if any step fails, and shows exactly which step caused the problem.

---

### 👁 Watch Mode
Toggles `gulp serve` for local development. The button turns red while active — click it again to stop. All stdout/stderr streams live into the log panel.

---

### 📦 NPM Install
Runs `npm install` through the same pipeline UI with live output — useful after pulling changes from git.

---

### 🗑 Clean Node Modules
A nuclear reset button. Shows a confirmation dialog before:
1. Deleting `node_modules/` entirely
2. Running a fresh `npm install`

Useful when dependencies get into a broken state (happens often in SPFx projects).

---

### 📁 Workspace Auto-detect
On startup, the extension checks whether the open folder is a valid SPFx project by looking for:
- `gulpfile.js`
- `package.json` with `@microsoft/sp-*` dependencies

| Badge | Meaning |
|-------|---------|
| ✅ Green | Valid SPFx project detected |
| ⚠️ Yellow | Gulp found but not an SPFx project |
| ❌ Red | No folder open or missing files |

---

### 🔧 Node & Gulp Version Checker
Automatically runs `node -v`, `npm -v`, and `gulp -v` on load and displays the results as chips at the top of the panel. Instantly spot if someone is on the wrong Node version for SPFx — a very common source of build issues.

---

### ⏱ Build Timer
Every pipeline step shows how long it took (e.g. `2m 14s`), and the total pipeline time is shown in the success message. Helps teams benchmark and track improvements over time.

---

### 🔔 Build Notifications
When a long pipeline finishes (or fails), a VS Code popup notification appears — even if you've switched to another tab or window. You can kick off a build and keep working without watching the log.

---

### ⚠️ Error Summary Panel
After a failed build, instead of scrolling through hundreds of lines of gulp output, a red summary box appears below the log showing only the relevant error lines. Find the actual TypeScript or config error in seconds.

---

### 🕐 Command History Log
Every pipeline run is saved (last 20 entries) with:
- Pipeline name and status (success / error / cancelled)
- Timestamp
- Total duration
- Per-step breakdown (click any history entry to expand)

History persists across VS Code sessions.

---

### ⛔ Cancel Button
Appears while any pipeline is running. Kills the active process immediately via `SIGTERM`.

---

## 📋 Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| VS Code | 1.85+ | |
| Node.js | 16.x / 18.x | Match your SPFx version requirements |
| Gulp CLI | Any | `npm install -g gulp-cli` |
| SPFx | 1.x+ | Project must have `@microsoft/sp-*` dependencies |

---

## 🚀 Getting Started

### Run in Development Mode (no packaging needed)

```bash
# 1. Clone or unzip the project
cd gulp-runner-extension

# 2. Install dependencies
npm install

# 3. Compile TypeScript
npm run compile

# 4. Press F5 in VS Code
#    → Opens Extension Development Host window
#    → Click the 🔥 Gulp Runner icon in the Activity Bar
#    → Open your SPFx project folder and start building
```

---

## 📦 Packaging & Publishing

### Package as `.vsix`

**Node.js 20+:**
```bash
npm install -g @vscode/vsce
vsce package
```

**Node.js 18 (use local vsce):**
```bash
npm install --save-dev @vscode/vsce@2.15.0
npx vsce package
```

### Install `.vsix` locally
```
Extensions panel → ⋯ → Install from VSIX…
```

### Publish to Marketplace
```bash
npx vsce login AbhishekDP2244
npx vsce publish
```

Or drag and drop the `.vsix` at:
```
https://marketplace.visualstudio.com/manage
```

### Publish a new version
```bash
# Patch: 0.2.0 → 0.2.1
npx vsce publish patch

# Minor: 0.2.0 → 0.3.0
npx vsce publish minor
```

---

## 🗂 Project Structure

```
gulp-runner-extension/
├── src/
│   └── extension.ts          ← All extension logic + webview HTML/CSS/JS
├── media/
│   ├── icon.png              ← Marketplace icon (128×128)
│   └── icon.svg              ← Activity Bar icon
├── out/                      ← Compiled JS (auto-generated, don't edit)
│   ├── extension.js
│   └── extension.js.map
├── .vscodeignore             ← Files excluded from .vsix package
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

---

## 🛠 Available Scripts

| Command | Description |
|---------|-------------|
| `npm run compile` | Compile TypeScript once |
| `npm run watch` | Watch mode — recompile on save |
| `npx vsce package` | Build `.vsix` installer |
| `npx vsce publish` | Publish to VS Code Marketplace |

---

## ➕ Adding More Buttons

The extension is built to grow. To add a new pipeline:

**1. Add a handler** in the `onDidReceiveMessage` switch in `extension.ts`:
```typescript
case 'runDeploy':
  await this._runPipeline('Deploy to SharePoint', [
    { cmd: 'm365 spo app add --filePath ...', label: 'Upload .sppkg' },
    { cmd: 'm365 spo app deploy --name ...',  label: 'Deploy app' },
  ]);
  break;
```

**2. Add a button** in `_getHtml()`:
```html
<button class="btn btn-secondary" id="btnDeploy" onclick="send('runDeploy')">
  🚀 Deploy to SharePoint
</button>
```

**3. Disable it during runs** — add it to the `setRunning` array in the webview script:
```javascript
[btnBuild, btnInstall, btnClean, btnDeploy].forEach(b => b.disabled = val);
```

That's all — the pipeline stepper, log, history, timer, and notifications all work automatically for any new pipeline you add.

---

## 🐛 Troubleshooting

| Problem | Fix |
|---------|-----|
| `gulp: command not found` | Run `npm install -g gulp-cli` |
| `No workspace folder found` | Open your SPFx project folder before running |
| Workspace shows ⚠️ yellow | Check that `gulpfile.js` exists and `package.json` has `@microsoft/sp-*` deps |
| Version chips show `N/A` | Node or Gulp not on system PATH — restart VS Code after installing |
| Watch mode doesn't stop | Click the red **⏹ Stop Watch Mode** button, or reload VS Code window |
| `vsce package` fails on Node 18 | Use `npx vsce package` with local vsce `@2.15.0` |
| Extension not appearing after compile | `Ctrl+Shift+P` → **Developer: Reload Window** |
| History not persisting | This uses `globalState` — check extension host isn't sandboxed |

---

## 📅 Changelog

### v0.2.0
- ✅ Workspace auto-detect (SPFx project validation)
- ✅ Node / npm / Gulp version checker
- ✅ Watch mode (`gulp serve` toggle)
- ✅ NPM Install button
- ✅ Clean Node Modules (with confirmation)
- ✅ Build timer (per step + total)
- ✅ Build notifications (VS Code popup)
- ✅ Error summary panel
- ✅ Command history log (last 20 runs, persistent)

### v0.1.0 — v0.0.1
- ✅ Build UI Package pipeline (clean → build → bundle → package-solution)
- ✅ Pipeline step indicator
- ✅ Live log output
- ✅ Cancel button

---

## 📄 License

MIT — free to use, modify, and distribute.

---

## 🙌 Author

**Abhishek Panigrahi** — [Marketplace Profile](https://marketplace.visualstudio.com/publishers/AbhishekDP2244)