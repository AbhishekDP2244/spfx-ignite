# 🔥 Gulp Runner — VS Code Extension

A chatbot-style sidebar panel to run your SharePoint Framework (SPFx) Gulp build pipeline with a single click — no terminal juggling required.

---

## ✨ Features

- **Sidebar panel** docked in the Activity Bar for quick access
- **Build UI Package** button — runs all 4 SPFx commands in sequence:
  1. `gulp clean`
  2. `gulp build`
  3. `gulp bundle --ship`
  4. `gulp package-solution --ship`
- **Visual pipeline stepper** — 4-node indicator showing active / completed / failed steps at a glance
- **Live output streaming** — stdout and stderr printed in real time as the commands run
- **Color-coded log** — cyan for step headers, yellow for warnings, green for success, red for errors
- **Cancel button** — kill the running process mid-flight
- **Auto-stop on failure** — pipeline halts immediately if any command exits with a non-zero code

---

## 📋 Prerequisites

| Tool | Version |
|------|---------|
| VS Code | 1.85+ |
| Node.js | 20+ (recommended) or 18.x |
| Gulp CLI | Installed globally (`npm i -g gulp-cli`) |

---

## 🚀 Getting Started

### Run in Development Mode (no packaging needed)

1. Clone or unzip this repository
2. Open the folder in VS Code
3. Install dependencies:
   ```bash
   npm install
   ```
4. Compile TypeScript:
   ```bash
   npm run compile
   ```
5. Press **F5** — a new *Extension Development Host* window opens
6. Click the **🔥 Gulp Runner** icon in the Activity Bar
7. Open your SPFx project folder in that window and click **Build UI Package**

---

## 📦 Packaging as a `.vsix`

To install the extension permanently or share it with your team:

### Using Node.js 20+
```bash
npm install -g @vscode/vsce
vsce package
```

### Using Node.js 18 (use local vsce to avoid compatibility issues)
```bash
npm install --save-dev @vscode/vsce@2.15.0
npx vsce package
```

This produces a file like `gulp-runner-0.0.1.vsix`.

### Install the `.vsix` in VS Code
```
Extensions panel → ⋯ (three dots menu) → Install from VSIX…
```

---

## 🗂 Project Structure

```
gulp-runner-extension/
├── src/
│   └── extension.ts        ← Extension logic + webview HTML/CSS/JS
├── media/
│   └── icon.svg            ← Activity Bar icon
├── out/                    ← Compiled JS output (auto-generated)
│   ├── extension.js
│   └── extension.js.map
├── .vscodeignore           ← Files excluded from the .vsix package
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
| `npm run watch` | Watch mode — recompiles on file save |
| `npx vsce package` | Bundle into a `.vsix` installer |

---

## ➕ Adding More Buttons

The extension is built to grow. To add a new command flow:

1. **Add a new method** in `src/extension.ts` (copy `_runBuildUIPackage` as a template):
   ```typescript
   private async _runDeploy() {
     const commands = [
       { cmd: 'gulp deploy', label: 'gulp deploy' },
     ];
     // ... same pattern
   }
   ```

2. **Handle the new message type** in the `onDidReceiveMessage` switch:
   ```typescript
   case 'runDeploy':
     await this._runDeploy();
     break;
   ```

3. **Add a button** in `_getHtmlForWebview`:
   ```html
   <button class="btn btn-secondary" onclick="vscode.postMessage({ type: 'runDeploy' })">
     🚀 Deploy
   </button>
   ```

---

## 🐛 Troubleshooting

| Problem | Fix |
|---------|-----|
| `gulp: command not found` | Run `npm install -g gulp-cli` |
| `No workspace folder found` | Open your SPFx project folder before running |
| `vsce package` fails on Node 18 | Use `npx vsce package` with local vsce 2.15.0 (see Packaging section) |
| Extension not appearing | Run `npm run compile` then reload VS Code (`Ctrl+Shift+P` → *Reload Window*) |
| Commands run in wrong directory | Ensure you have only one workspace folder open, or set the correct root |

---

## 📄 License

MIT — free to use, modify, and distribute.
