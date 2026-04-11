import * as vscode from "vscode";
import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";

// ── Types ────────────────────────────────────────────────────────────────────

interface HistoryEntry {
  label: string;
  startTime: string;
  duration: string;
  status: "success" | "error" | "cancelled";
  steps: { name: string; duration: string; status: string }[];
}

// ── Activate ─────────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {
  const provider = new GulpRunnerViewProvider(context.extensionUri, context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      GulpRunnerViewProvider.viewType,
      provider,
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("gulpRunner.openPanel", () => {
      vscode.commands.executeCommand("workbench.view.extension.gulpRunner");
    }),
  );
}

// ── Provider ─────────────────────────────────────────────────────────────────

class GulpRunnerViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "gulpRunner.mainView";

  private _view?: vscode.WebviewView;
  private _runningProcess?: cp.ChildProcess;
  private _watchProcess?: cp.ChildProcess;
  private _watching = false;
  private _cancelled = false;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext,
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };
    webviewView.webview.html = this._getHtml();

    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case "ready":
          this._sendHistory();
          await this._checkWorkspace();
          await this._checkVersions();
          break;
        case "runBuildUIPackage":
          await this._runPipeline("Build UI Package", [
            { cmd: "gulp clean", label: "gulp clean" },
            { cmd: "gulp build", label: "gulp build" },
            { cmd: "gulp bundle --ship", label: "gulp bundle --ship" },
            {
              cmd: "gulp package-solution --ship",
              label: "gulp package-solution --ship",
            },
          ]);
          break;
        case "toggleWatch":
          this._watching ? this._stopWatch() : this._startWatch();
          break;
        case "runNpmInstall":
          await this._runPipeline("NPM Install", [
            { cmd: "npm install", label: "npm install" },
          ]);
          break;
        case "runCleanModules":
          await this._cleanNodeModules();
          break;
        case "cancelRun":
          this._cancelRun();
          break;
        case "clearHistory":
          this._context.globalState.update("gulpRunnerHistory", []);
          this._postMessage("historyCleared", "");
          break;
      }
    });
  }

  // ── Workspace auto-detect ─────────────────────────────────────────────────

  private async _checkWorkspace() {
    const cwd = this._getCwd();
    if (!cwd) {
      this._postMessage(
        "workspaceStatus",
        JSON.stringify({ ok: false, reason: "No folder open" }),
      );
      return;
    }
    const hasGulp = fs.existsSync(path.join(cwd, "gulpfile.js"));
    const hasPkg = fs.existsSync(path.join(cwd, "package.json"));
    let isSpfx = false;
    if (hasPkg) {
      try {
        const pkg = JSON.parse(
          fs.readFileSync(path.join(cwd, "package.json"), "utf8"),
        );
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        isSpfx = Object.keys(deps).some((k) => k.startsWith("@microsoft/sp-"));
      } catch {}
    }
    this._postMessage(
      "workspaceStatus",
      JSON.stringify({
        ok: hasGulp && hasPkg,
        isSpfx,
        hasGulp,
        hasPkg,
        folder: path.basename(cwd),
      }),
    );
  }

  // ── Node / Gulp version checker ───────────────────────────────────────────

  private async _checkVersions() {
    const run = (cmd: string): Promise<string> =>
      new Promise((resolve) => {
        cp.exec(cmd, (err, stdout) => resolve(err ? "N/A" : stdout.trim()));
      });

    const [node, npm, gulp] = await Promise.all([
      run("node -v"),
      run("npm -v"),
      run("gulp -v"),
    ]);

    const gulpMatch = gulp.match(/[\d]+\.[\d]+\.[\d]+/);
    const gulpVer = gulpMatch ? gulpMatch[0] : gulp;

    this._postMessage("versions", JSON.stringify({ node, npm, gulp: gulpVer }));
  }

  // ── Generic pipeline runner ───────────────────────────────────────────────

  private async _runPipeline(
    pipelineName: string,
    commands: { cmd: string; label: string }[],
  ) {
    const cwd = this._getCwd();
    if (!cwd) {
      this._postMessage("error", "❌ No workspace folder open.");
      this._postMessage("done", "");
      return;
    }

    this._cancelled = false;
    const pipelineStart = Date.now();
    const stepResults: { name: string; duration: string; status: string }[] =
      [];

    this._postMessage("start", pipelineName);
    this._postMessage("log", `📁 ${cwd}`);

    for (const command of commands) {
      if (this._cancelled) {
        break;
      }
      const stepStart = Date.now();
      const success = await this._runCommand(command.cmd, command.label, cwd);
      const stepDuration = this._formatDuration(Date.now() - stepStart);
      stepResults.push({
        name: command.label,
        duration: stepDuration,
        status: this._cancelled ? "cancelled" : success ? "success" : "error",
      });
      if (!success && !this._cancelled) {
        this._postMessage(
          "error",
          `❌ Pipeline stopped: ${command.label} failed`,
        );
        this._saveHistory(pipelineName, pipelineStart, stepResults, "error");
        this._postMessage("done", "");
        vscode.window.showErrorMessage(
          `Gulp Runner: "${command.label}" failed!`,
        );
        return;
      }
    }

    const totalDuration = this._formatDuration(Date.now() - pipelineStart);
    const finalStatus = this._cancelled ? "cancelled" : "success";

    if (!this._cancelled) {
      this._postMessage(
        "success",
        `✅ ${pipelineName} completed in ${totalDuration}`,
      );
      vscode.window.showInformationMessage(
        `✅ Gulp Runner: ${pipelineName} done in ${totalDuration}`,
      );
    }

    this._saveHistory(pipelineName, pipelineStart, stepResults, finalStatus);
    this._postMessage("done", "");
  }

  // ── Single command runner ─────────────────────────────────────────────────

  private _runCommand(
    cmd: string,
    label: string,
    cwd: string,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      this._postMessage("step", label);

      const proc = cp.spawn(cmd, [], {
        cwd,
        shell: true,
        env: { ...process.env },
      });
      this._runningProcess = proc;

      const errors: string[] = [];

      proc.stdout.on("data", (d: Buffer) => {
        d.toString()
          .split("\n")
          .filter((l) => l.trim())
          .forEach((l) => {
            this._postMessage("output", l);
            if (/error|Error|ERROR/.test(l) && !/0 errors/.test(l)) {
              errors.push(l.trim());
            }
          });
      });

      proc.stderr.on("data", (d: Buffer) => {
        d.toString()
          .split("\n")
          .filter((l) => l.trim())
          .forEach((l) => {
            this._postMessage("stderr", l);
            errors.push(l.trim());
          });
      });

      proc.on("close", (code) => {
        this._runningProcess = undefined;
        const duration = this._formatDuration(Date.now() - Date.now());
        if (code === 0) {
          this._postMessage(
            "stepDone",
            JSON.stringify({ label, duration: "" }),
          );
          resolve(true);
        } else {
          this._postMessage(
            "stepFailed",
            JSON.stringify({ label, duration: "" }),
          );
          if (errors.length > 0) {
            const topErrors = errors.slice(-10);
            this._postMessage("errorSummary", JSON.stringify(topErrors));
          }
          resolve(false);
        }
      });

      proc.on("error", (err) => {
        this._runningProcess = undefined;
        this._postMessage("error", `✖ ${err.message}`);
        resolve(false);
      });
    });
  }

  // ── Watch mode ────────────────────────────────────────────────────────────

  private _startWatch() {
    const cwd = this._getCwd();
    if (!cwd) {
      return;
    }

    this._postMessage("watchStatus", "starting");
    this._postMessage("log", "👁 Starting gulp serve (watch mode)…");

    const proc = cp.spawn("gulp serve", [], {
      cwd,
      shell: true,
      env: { ...process.env },
    });
    this._watchProcess = proc;
    this._watching = true;
    this._postMessage("watchStatus", "running");

    proc.stdout.on("data", (d: Buffer) => {
      d.toString()
        .split("\n")
        .filter((l) => l.trim())
        .forEach((l) => this._postMessage("output", l));
    });
    proc.stderr.on("data", (d: Buffer) => {
      d.toString()
        .split("\n")
        .filter((l) => l.trim())
        .forEach((l) => this._postMessage("stderr", l));
    });
    proc.on("close", () => {
      this._watching = false;
      this._watchProcess = undefined;
      this._postMessage("watchStatus", "stopped");
      this._postMessage("log", "👁 Watch mode stopped.");
    });
  }

  private _stopWatch() {
    if (this._watchProcess) {
      this._watchProcess.kill("SIGTERM");
      this._watchProcess = undefined;
      this._watching = false;
      this._postMessage("watchStatus", "stopped");
      this._postMessage("log", "⛔ Watch mode stopped by user.");
    }
  }

  // ── Clean node_modules ────────────────────────────────────────────────────

  private async _cleanNodeModules() {
    const cwd = this._getCwd();
    if (!cwd) {
      return;
    }

    const confirm = await vscode.window.showWarningMessage(
      "This will delete node_modules and run npm install. This may take several minutes.",
      "Yes, proceed",
      "Cancel",
    );
    if (confirm !== "Yes, proceed") {
      return;
    }

    await this._runPipeline("Clean & Reinstall", [
      {
        cmd:
          process.platform === "win32"
            ? "rmdir /s /q node_modules"
            : "rm -rf node_modules",
        label: "Remove node_modules",
      },
      { cmd: "npm install", label: "npm install" },
    ]);
  }

  // ── Cancel ────────────────────────────────────────────────────────────────

  private _cancelRun() {
    this._cancelled = true;
    if (this._runningProcess) {
      this._runningProcess.kill("SIGTERM");
      this._runningProcess = undefined;
      this._postMessage("error", "⛔ Cancelled by user.");
      this._postMessage("done", "");
    }
  }

  // ── History ───────────────────────────────────────────────────────────────

  private _saveHistory(
    label: string,
    startMs: number,
    steps: { name: string; duration: string; status: string }[],
    status: "success" | "error" | "cancelled",
  ) {
    const history: HistoryEntry[] = this._context.globalState.get(
      "gulpRunnerHistory",
      [],
    );
    const entry: HistoryEntry = {
      label,
      startTime: new Date(startMs).toLocaleString(),
      duration: this._formatDuration(Date.now() - startMs),
      status,
      steps,
    };
    history.unshift(entry);
    const trimmed = history.slice(0, 20);
    this._context.globalState.update("gulpRunnerHistory", trimmed);
    this._postMessage("historyUpdate", JSON.stringify(trimmed));
  }

  private _sendHistory() {
    const history: HistoryEntry[] = this._context.globalState.get(
      "gulpRunnerHistory",
      [],
    );
    this._postMessage("historyUpdate", JSON.stringify(history));
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private _getCwd(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  private _formatDuration(ms: number): string {
    if (ms < 1000) {
      return `${ms}ms`;
    }
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    if (m === 0) {
      return `${s}s`;
    }
    return `${m}m ${s % 60}s`;
  }

  private _postMessage(type: string, text: string) {
    this._view?.webview.postMessage({ type, text });
  }

  // ── Webview HTML ──────────────────────────────────────────────────────────

  private _getHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Gulp Runner</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: 'Segoe UI', system-ui, sans-serif;
  background: var(--vscode-sideBar-background);
  color: var(--vscode-foreground);
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-size: 12px;
}

.main-scroll {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  scrollbar-width: thin;
  scrollbar-color: var(--vscode-scrollbarSlider-background) transparent;
}

.section {
  border-bottom: 1px solid var(--vscode-panel-border);
  padding: 8px 10px;
}
.section-title {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--vscode-sideBarTitle-foreground);
  margin-bottom: 7px;
  display: flex;
  align-items: center;
  gap: 5px;
}

/* ── Workspace badge ── */
.ws-badge {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 7px; border-radius: 4px; font-size: 11px;
  background: var(--vscode-editor-inactiveSelectionBackground);
}
.ws-badge.ok    { border-left: 3px solid var(--vscode-terminal-ansiGreen); }
.ws-badge.warn  { border-left: 3px solid var(--vscode-terminal-ansiYellow); }
.ws-badge.error { border-left: 3px solid var(--vscode-errorForeground); }
.ws-dot  { font-size: 14px; }
.ws-info { display: flex; flex-direction: column; gap: 1px; }
.ws-name { font-weight: 600; }
.ws-sub  { font-size: 10px; color: var(--vscode-descriptionForeground); }

/* ── Version chips ── */
.version-row { display: flex; gap: 5px; flex-wrap: wrap; }
.chip {
  background: var(--vscode-editor-inactiveSelectionBackground);
  border-radius: 10px; padding: 2px 8px; font-size: 10px;
  display: flex; align-items: center; gap: 3px;
}
.chip-label { color: var(--vscode-descriptionForeground); }
.chip-val   { font-weight: 600; font-family: monospace; }

/* ── Buttons ── */
.btn {
  width: 100%; padding: 7px 10px; border: none; border-radius: 4px;
  font-size: 11.5px; font-weight: 600; cursor: pointer;
  display: flex; align-items: center; justify-content: center; gap: 6px;
  transition: opacity 0.15s, transform 0.1s; margin-bottom: 5px;
}
.btn:last-child { margin-bottom: 0; }
.btn:active  { transform: scale(0.98); }
.btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }
.btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
.btn-primary:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
.btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
.btn-secondary:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground); }
.btn-watch { background: #1a472a; color: #a3e6b4; border: 1px solid #2d6a4f; }
.btn-watch.active { background: #4a1010; color: #ffaaaa; border-color: #8b2020; }
.btn-watch:hover:not(:disabled) { opacity: 0.85; }
.btn-danger {
  background: transparent; color: var(--vscode-errorForeground);
  border: 1px solid var(--vscode-errorForeground);
  font-size: 11px; padding: 5px 10px; opacity: 0.8;
}
.btn-danger:hover:not(:disabled) { opacity: 1; }

/* ── Pipeline stepper ── */
.pipeline { display: flex; align-items: flex-start; padding: 6px 4px 2px; }
.step-node {
  display: flex; flex-direction: column; align-items: center;
  flex: 1; position: relative;
}
.step-node:not(:last-child)::after {
  content: ''; position: absolute; top: 7px; left: 50%;
  width: 100%; height: 2px; background: var(--vscode-panel-border);
  z-index: 0; transition: background 0.3s;
}
.step-node.done:not(:last-child)::after  { background: var(--vscode-terminal-ansiGreen); }
.step-node.error:not(:last-child)::after { background: var(--vscode-errorForeground); }
.step-dot {
  width: 14px; height: 14px; border-radius: 50%;
  background: var(--vscode-panel-border); border: 2px solid var(--vscode-panel-border);
  z-index: 1; position: relative; display: flex; align-items: center;
  justify-content: center; font-size: 7px; transition: all 0.25s;
}
.step-node.active .step-dot { background: var(--vscode-button-background); border-color: var(--vscode-button-background); animation: pulse 1s infinite; }
.step-node.done  .step-dot  { background: var(--vscode-terminal-ansiGreen); border-color: var(--vscode-terminal-ansiGreen); color: white; }
.step-node.error .step-dot  { background: var(--vscode-errorForeground); border-color: var(--vscode-errorForeground); color: white; }
.step-label { font-size: 8.5px; margin-top: 3px; text-align: center; color: var(--vscode-descriptionForeground); max-width: 50px; line-height: 1.2; word-break: break-all; }
.step-timer { font-size: 8px; color: var(--vscode-terminal-ansiGreen); text-align: center; margin-top: 1px; }
@keyframes pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(0,120,212,0.4); } 50% { box-shadow: 0 0 0 4px transparent; } }
@keyframes spin  { to { transform: rotate(360deg); } }
.spinner { width: 8px; height: 8px; border: 1.5px solid currentColor; border-top-color: transparent; border-radius: 50%; animation: spin 0.6s linear infinite; }

/* ── Chat log ── */
.chat-area {
  flex: 1; min-height: 120px; max-height: 260px; overflow-y: auto;
  padding: 6px 8px; display: flex; flex-direction: column; gap: 2px;
  scrollbar-width: thin; scrollbar-color: var(--vscode-scrollbarSlider-background) transparent;
}
.msg { display: flex; gap: 5px; align-items: flex-start; animation: fadeIn 0.15s ease both; }
@keyframes fadeIn { from { opacity:0; transform:translateY(3px); } to { opacity:1; transform:none; } }
.msg-icon { font-size: 11px; flex-shrink: 0; margin-top: 1px; width: 13px; text-align: center; }
.msg-text { font-size: 10.5px; line-height: 1.4; font-family: 'Cascadia Code','Fira Code','Consolas',monospace; word-break: break-word; flex: 1; }
.msg.system   .msg-text { color: var(--vscode-descriptionForeground); font-style: italic; font-family: inherit; }
.msg.step     .msg-text { color: var(--vscode-terminal-ansiCyan); font-weight: 600; }
.msg.output   .msg-text { color: var(--vscode-terminal-foreground, var(--vscode-foreground)); font-size: 10px; }
.msg.stderr   .msg-text { color: var(--vscode-terminal-ansiYellow); font-size: 10px; }
.msg.error    .msg-text { color: var(--vscode-errorForeground); font-weight: 600; }
.msg.success  .msg-text { color: var(--vscode-terminal-ansiGreen); font-weight: 700; font-family: inherit; }
.msg.stepdone .msg-text { color: var(--vscode-terminal-ansiGreen); }
.divider { height: 1px; background: var(--vscode-panel-border); margin: 3px 0; opacity: 0.4; }
.empty-log { display: flex; align-items: center; justify-content: center; height: 60px; color: var(--vscode-descriptionForeground); font-size: 10.5px; font-style: italic; }

/* ── Error summary ── */
.error-summary { background: rgba(200,0,0,0.08); border: 1px solid var(--vscode-errorForeground); border-radius: 4px; padding: 6px 8px; margin-top: 4px; }
.error-summary-title { font-size: 10px; font-weight: 700; color: var(--vscode-errorForeground); margin-bottom: 4px; }
.error-line { font-size: 9.5px; font-family: monospace; color: var(--vscode-errorForeground); line-height: 1.4; opacity: 0.85; white-space: pre-wrap; word-break: break-all; }

/* ── History ── */
.history-list { display: flex; flex-direction: column; gap: 4px; }
.history-empty { font-size: 10.5px; color: var(--vscode-descriptionForeground); font-style: italic; padding: 4px 0; }
.history-item { background: var(--vscode-editor-inactiveSelectionBackground); border-radius: 4px; padding: 5px 7px; border-left: 3px solid var(--vscode-panel-border); cursor: pointer; }
.history-item.success   { border-left-color: var(--vscode-terminal-ansiGreen); }
.history-item.error     { border-left-color: var(--vscode-errorForeground); }
.history-item.cancelled { border-left-color: var(--vscode-terminal-ansiYellow); }
.history-item:hover { opacity: 0.85; }
.history-row  { display: flex; justify-content: space-between; align-items: center; }
.history-name { font-weight: 600; font-size: 10.5px; }
.history-dur  { font-size: 9.5px; color: var(--vscode-descriptionForeground); font-family: monospace; }
.history-time { font-size: 9px; color: var(--vscode-descriptionForeground); margin-top: 1px; }
.history-steps { display: none; margin-top: 4px; }
.history-item.expanded .history-steps { display: block; }
.history-step-row { display: flex; justify-content: space-between; font-size: 9.5px; padding: 1px 0; color: var(--vscode-descriptionForeground); }
.history-step-row.s { color: var(--vscode-terminal-ansiGreen); }
.history-step-row.e { color: var(--vscode-errorForeground); }

.clear-btn { background: none; border: none; color: var(--vscode-descriptionForeground); font-size: 9.5px; cursor: pointer; padding: 2px 4px; border-radius: 3px; margin-left: auto; }
.clear-btn:hover { color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground); }
</style>
</head>
<body>

<!-- 1. Workspace Status -->
<div class="section">
  <div class="section-title">📁 Workspace</div>
  <div class="ws-badge warn" id="wsBadge">
    <span class="ws-dot">⏳</span>
    <div class="ws-info">
      <span class="ws-name">Checking...</span>
      <span class="ws-sub" id="wsSub"></span>
    </div>
  </div>
</div>

<!-- 2. Environment Versions -->
<div class="section">
  <div class="section-title">🔧 Environment</div>
  <div class="version-row">
    <div class="chip"><span class="chip-label">node</span><span class="chip-val" id="vNode">…</span></div>
    <div class="chip"><span class="chip-label">npm</span><span class="chip-val" id="vNpm">…</span></div>
    <div class="chip"><span class="chip-label">gulp</span><span class="chip-val" id="vGulp">…</span></div>
  </div>
</div>

<!-- 3. Actions -->
<div class="section">
  <div class="section-title">⚡ Actions</div>
  <button class="btn btn-primary"   id="btnBuild"   onclick="send('runBuildUIPackage')">🔥 Build UI Package</button>
  <button class="btn btn-watch"     id="btnWatch"   onclick="send('toggleWatch')">👁 Start Watch Mode</button>
  <button class="btn btn-secondary" id="btnInstall" onclick="send('runNpmInstall')">📦 NPM Install</button>
  <button class="btn btn-secondary" id="btnClean"   onclick="send('runCleanModules')" style="color:#ffaaaa">🗑 Clean Node Modules</button>
</div>

<!-- 4. Pipeline Stepper -->
<div class="section" id="pipelineSection" style="display:none">
  <div class="section-title" id="pipelineTitle">Pipeline</div>
  <div class="pipeline" id="pipeline"></div>
</div>

<!-- 5. Log -->
<div class="section" style="flex-shrink:0">
  <div class="section-title">
    📋 Log
    <button class="clear-btn" onclick="clearLog()">clear</button>
  </div>
  <div class="chat-area" id="chatArea">
    <div class="empty-log" id="emptyLog">No output yet</div>
  </div>
  <div id="errorSummaryBox" style="display:none; padding: 0 0 4px"></div>
  <div style="padding: 4px 0 2px; display:none" id="cancelBar">
    <button class="btn btn-danger" onclick="send('cancelRun')">⛔ Cancel</button>
  </div>
</div>

<!-- 6. History -->
<div class="section" style="flex-shrink:0; padding-bottom: 10px">
  <div class="section-title">
    🕐 History
    <button class="clear-btn" onclick="send('clearHistory')">clear</button>
  </div>
  <div class="history-list" id="historyList">
    <div class="history-empty">No runs yet</div>
  </div>
</div>

<script>
const vscode      = acquireVsCodeApi();
const chatArea    = document.getElementById('chatArea');
const cancelBar   = document.getElementById('cancelBar');
const btnBuild    = document.getElementById('btnBuild');
const btnWatch    = document.getElementById('btnWatch');
const btnInstall  = document.getElementById('btnInstall');
const btnClean    = document.getElementById('btnClean');
const pSection    = document.getElementById('pipelineSection');
const pTitle      = document.getElementById('pipelineTitle');
const pipeline    = document.getElementById('pipeline');
const errBox      = document.getElementById('errorSummaryBox');
const historyList = document.getElementById('historyList');
const wsBadge     = document.getElementById('wsBadge');

let stepNodes = [];
let stepMap   = {};

function send(type) { vscode.postMessage({ type }); }

function setRunning(val) {
  [btnBuild, btnInstall, btnClean].forEach(b => b.disabled = val);
  cancelBar.style.display = val ? 'block' : 'none';
}

// ── Log helpers ──────────────────────────────────────────────
function addMsg(cls, icon, text) {
  document.getElementById('emptyLog')?.remove();
  const d = document.createElement('div');
  d.className = 'msg ' + cls;
  d.innerHTML = '<span class="msg-icon">' + icon + '</span><span class="msg-text">' + esc(text) + '</span>';
  chatArea.appendChild(d);
  chatArea.scrollTop = chatArea.scrollHeight;
}
function addDivider() {
  const d = document.createElement('div');
  d.className = 'divider';
  chatArea.appendChild(d);
}
function clearLog() {
  chatArea.innerHTML = '';
  errBox.style.display = 'none';
}
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Pipeline stepper ─────────────────────────────────────────
function getOrCreateStep(label) {
  if (stepMap[label] !== undefined) return stepMap[label];
  const idx = Object.keys(stepMap).length;
  stepMap[label] = idx;
  const node = document.createElement('div');
  node.className = 'step-node';
  const short = label.replace('gulp ','').replace(' --ship','').replace('npm ','');
  node.innerHTML =
    '<div class="step-dot" id="sd' + idx + '">•</div>' +
    '<div class="step-label">' + esc(short) + '</div>' +
    '<div class="step-timer" id="st' + idx + '"></div>';
  pipeline.appendChild(node);
  stepNodes.push(node);
  return idx;
}

function activateStep(idx) {
  if (stepNodes[idx]) {
    stepNodes[idx].className = 'step-node active';
    document.getElementById('sd'+idx).innerHTML = '<div class="spinner"></div>';
  }
}

function completeStep(idx, ok, duration) {
  if (stepNodes[idx]) {
    stepNodes[idx].className = 'step-node ' + (ok ? 'done' : 'error');
    document.getElementById('sd'+idx).textContent = ok ? '✓' : '✗';
    if (duration) document.getElementById('st'+idx).textContent = duration;
  }
}

// ── Message handler ──────────────────────────────────────────
window.addEventListener('message', ({ data }) => {
  switch (data.type) {

    case 'start':
      chatArea.innerHTML = '';
      errBox.style.display = 'none';
      pipeline.innerHTML = '';
      stepNodes = []; stepMap = {};
      pSection.style.display = 'block';
      pTitle.textContent = data.text;
      setRunning(true);
      addMsg('system', '🚀', 'Starting ' + data.text + '…');
      addDivider();
      break;

    case 'step': {
      const idx = getOrCreateStep(data.text);
      // mark previous active step done
      Object.entries(stepMap).forEach(([l, j]) => {
        if (j < idx && stepNodes[j] && stepNodes[j].className.includes('active')) {
          completeStep(j, true, '');
        }
      });
      activateStep(idx);
      addMsg('step', '▶', data.text);
      break;
    }

    case 'stepDone': {
      const p = JSON.parse(data.text);
      const i = stepMap[p.label];
      completeStep(i, true, p.duration);
      addMsg('stepdone', '✔', p.label + (p.duration ? ' — ' + p.duration : ''));
      addDivider();
      break;
    }

    case 'stepFailed': {
      const p = JSON.parse(data.text);
      const i = stepMap[p.label];
      completeStep(i, false, p.duration);
      break;
    }

    case 'output': addMsg('output', ' ', data.text); break;
    case 'stderr': addMsg('stderr', '⚠', data.text); break;
    case 'log':    addMsg('system', 'ℹ', data.text); break;
    case 'error':  addMsg('error',  '✖', data.text); break;
    case 'success':addMsg('success','🎉', data.text); break;
    case 'done':   setRunning(false); break;

    case 'errorSummary': {
      const lines = JSON.parse(data.text);
      if (!lines.length) break;
      errBox.style.display = 'block';
      errBox.innerHTML =
        '<div class="error-summary">' +
        '<div class="error-summary-title">⚠ Error Summary (' + lines.length + ' lines)</div>' +
        lines.map(function(l) { return '<div class="error-line">' + esc(l) + '</div>'; }).join('') +
        '</div>';
      break;
    }

    case 'watchStatus':
      if (data.text === 'running') {
        btnWatch.textContent = '⏹ Stop Watch Mode';
        btnWatch.classList.add('active');
        [btnBuild, btnInstall, btnClean].forEach(b => b.disabled = true);
      } else {
        btnWatch.textContent = '👁 Start Watch Mode';
        btnWatch.classList.remove('active');
        [btnBuild, btnInstall, btnClean].forEach(b => b.disabled = false);
      }
      break;

    case 'versions': {
      const v = JSON.parse(data.text);
      document.getElementById('vNode').textContent = v.node;
      document.getElementById('vNpm').textContent  = v.npm;
      document.getElementById('vGulp').textContent = v.gulp;
      break;
    }

    case 'workspaceStatus': {
      const s = JSON.parse(data.text);
      const dot  = wsBadge.querySelector('.ws-dot');
      const name = wsBadge.querySelector('.ws-name');
      const sub  = wsBadge.querySelector('.ws-sub');
      if (!s.ok) {
        wsBadge.className = 'ws-badge error';
        dot.textContent  = '❌';
        name.textContent = s.reason || 'Not an SPFx project';
        sub.textContent  = 'Open an SPFx folder first';
      } else if (s.isSpfx) {
        wsBadge.className = 'ws-badge ok';
        dot.textContent  = '✅';
        name.textContent = s.folder;
        sub.textContent  = 'SPFx project detected';
      } else {
        wsBadge.className = 'ws-badge warn';
        dot.textContent  = '⚠️';
        name.textContent = s.folder;
        sub.textContent  = s.hasGulp ? 'Gulp found (not SPFx)' : 'No gulpfile.js found';
      }
      break;
    }

    case 'historyUpdate':
    case 'historyCleared':
      renderHistory(data.type === 'historyCleared' ? [] : JSON.parse(data.text));
      break;
  }
});

function renderHistory(history) {
  if (!history.length) {
    historyList.innerHTML = '<div class="history-empty">No runs yet</div>';
    return;
  }
  historyList.innerHTML = history.map(function(h) {
    return '<div class="history-item ' + h.status + '" onclick="this.classList.toggle(\'expanded\')">' +
      '<div class="history-row">' +
        '<span class="history-name">' + esc(h.label) + '</span>' +
        '<span class="history-dur">' + esc(h.duration) + '</span>' +
      '</div>' +
      '<div class="history-time">' + esc(h.startTime) + '</div>' +
      '<div class="history-steps">' +
        h.steps.map(function(s) {
          return '<div class="history-step-row ' + (s.status === 'success' ? 's' : 'e') + '">' +
            '<span>' + esc(s.name) + '</span><span>' + esc(s.duration) + '</span>' +
          '</div>';
        }).join('') +
      '</div>' +
    '</div>';
  }).join('');
}

vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
  }
}

export function deactivate() {}
