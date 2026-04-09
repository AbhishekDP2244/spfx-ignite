import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
  const provider = new GulpRunnerViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      GulpRunnerViewProvider.viewType,
      provider
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gulpRunner.openPanel', () => {
      vscode.commands.executeCommand('workbench.view.extension.gulpRunner');
    })
  );
}

class GulpRunnerViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'gulpRunner.mainView';

  private _view?: vscode.WebviewView;
  private _terminal?: vscode.Terminal;
  private _runningProcess?: cp.ChildProcess;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case 'runBuildUIPackage':
          await this._runBuildUIPackage();
          break;
        case 'cancelRun':
          this._cancelRun();
          break;
      }
    });
  }

  private async _runBuildUIPackage() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      this._postMessage('error', '❌ No workspace folder found. Please open a project first.');
      this._postMessage('done', '');
      return;
    }

    const cwd = workspaceFolders[0].uri.fsPath;
    const commands = [
      { cmd: 'gulp clean', label: 'gulp clean' },
      { cmd: 'gulp build', label: 'gulp build' },
      { cmd: 'gulp bundle --ship', label: 'gulp bundle --ship' },
      { cmd: 'gulp package-solution --ship', label: 'gulp package-solution --ship' },
    ];

    this._postMessage('start', '');
    this._postMessage('log', `📁 Working directory: ${cwd}`);

    for (const command of commands) {
      const success = await this._runCommand(command.cmd, command.label, cwd);
      if (!success) {
        this._postMessage('error', `❌ Pipeline stopped due to error in: ${command.label}`);
        this._postMessage('done', '');
        return;
      }
    }

    this._postMessage('success', '✅ Build UI Package completed successfully!');
    this._postMessage('done', '');
  }

  private _runCommand(cmd: string, label: string, cwd: string): Promise<boolean> {
    return new Promise((resolve) => {
      this._postMessage('step', `▶ Running: ${label}`);

      const proc = cp.spawn(cmd, [], {
        cwd,
        shell: true,
        env: { ...process.env },
      });

      this._runningProcess = proc;

      proc.stdout.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n').filter((l) => l.trim());
        lines.forEach((line) => this._postMessage('output', line));
      });

      proc.stderr.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n').filter((l) => l.trim());
        lines.forEach((line) => this._postMessage('stderr', line));
      });

      proc.on('close', (code) => {
        this._runningProcess = undefined;
        if (code === 0) {
          this._postMessage('stepDone', `✔ ${label} — done`);
          resolve(true);
        } else {
          this._postMessage('error', `✖ ${label} exited with code ${code}`);
          resolve(false);
        }
      });

      proc.on('error', (err) => {
        this._runningProcess = undefined;
        this._postMessage('error', `✖ Failed to run "${label}": ${err.message}`);
        resolve(false);
      });
    });
  }

  private _cancelRun() {
    if (this._runningProcess) {
      this._runningProcess.kill('SIGTERM');
      this._runningProcess = undefined;
      this._postMessage('error', '⛔ Pipeline cancelled by user.');
      this._postMessage('done', '');
    }
  }

  private _postMessage(type: string, text: string) {
    if (this._view) {
      this._view.webview.postMessage({ type, text });
    }
  }

  private _getHtmlForWebview(_webview: vscode.Webview): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
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
  }

  /* ── Header ── */
  .header {
    padding: 14px 12px 10px;
    border-bottom: 1px solid var(--vscode-panel-border);
    flex-shrink: 0;
  }
  .header-title {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--vscode-sideBarTitle-foreground);
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 10px;
  }
  .flame { font-size: 14px; }

  /* ── Button ── */
  .btn {
    width: 100%;
    padding: 9px 14px;
    border: none;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    transition: opacity 0.15s, transform 0.1s;
    letter-spacing: 0.02em;
  }
  .btn:active { transform: scale(0.98); }
  .btn:disabled { opacity: 0.45; cursor: not-allowed; transform: none; }

  .btn-primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  .btn-primary:hover:not(:disabled) {
    background: var(--vscode-button-hoverBackground);
  }

  .btn-cancel {
    background: transparent;
    color: var(--vscode-errorForeground);
    border: 1px solid var(--vscode-errorForeground);
    margin-top: 6px;
    font-size: 11px;
    padding: 6px 14px;
    opacity: 0.8;
  }
  .btn-cancel:hover:not(:disabled) { opacity: 1; }

  /* ── Pipeline steps indicator ── */
  .pipeline {
    display: flex;
    align-items: center;
    gap: 0;
    padding: 10px 12px 0;
    flex-shrink: 0;
  }
  .step-node {
    display: flex;
    flex-direction: column;
    align-items: center;
    flex: 1;
    position: relative;
  }
  .step-node:not(:last-child)::after {
    content: '';
    position: absolute;
    top: 8px;
    left: 50%;
    width: 100%;
    height: 2px;
    background: var(--vscode-panel-border);
    z-index: 0;
    transition: background 0.3s;
  }
  .step-node.done:not(:last-child)::after {
    background: var(--vscode-terminal-ansiGreen);
  }
  .step-dot {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--vscode-panel-border);
    border: 2px solid var(--vscode-panel-border);
    z-index: 1;
    position: relative;
    transition: all 0.3s;
    display: flex; align-items: center; justify-content: center;
    font-size: 8px;
  }
  .step-node.active .step-dot {
    background: var(--vscode-button-background);
    border-color: var(--vscode-button-background);
    animation: pulse 1s infinite;
  }
  .step-node.done .step-dot {
    background: var(--vscode-terminal-ansiGreen);
    border-color: var(--vscode-terminal-ansiGreen);
    color: white;
  }
  .step-node.error .step-dot {
    background: var(--vscode-errorForeground);
    border-color: var(--vscode-errorForeground);
    color: white;
  }
  .step-label {
    font-size: 9px;
    margin-top: 4px;
    text-align: center;
    color: var(--vscode-descriptionForeground);
    max-width: 52px;
    line-height: 1.2;
    word-break: break-all;
  }
  .step-node.active .step-label,
  .step-node.done .step-label {
    color: var(--vscode-foreground);
  }
  @keyframes pulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(var(--vscode-button-background), 0.4); }
    50% { box-shadow: 0 0 0 4px transparent; }
  }

  /* ── Chat log ── */
  .chat-area {
    flex: 1;
    overflow-y: auto;
    padding: 10px 10px 6px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    scrollbar-width: thin;
    scrollbar-color: var(--vscode-scrollbarSlider-background) transparent;
  }

  .msg {
    display: flex;
    gap: 6px;
    align-items: flex-start;
    animation: fadeSlide 0.2s ease both;
  }
  @keyframes fadeSlide {
    from { opacity: 0; transform: translateY(4px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .msg-icon {
    font-size: 13px;
    flex-shrink: 0;
    margin-top: 1px;
    width: 16px;
    text-align: center;
  }

  .msg-text {
    font-size: 11.5px;
    line-height: 1.5;
    font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
    word-break: break-word;
    flex: 1;
  }

  .msg.system .msg-text  { color: var(--vscode-descriptionForeground); font-style: italic; font-family: 'Segoe UI', sans-serif; font-size: 11px; }
  .msg.step .msg-text    { color: var(--vscode-terminal-ansiCyan); font-weight: 600; font-size: 11.5px; }
  .msg.output .msg-text  { color: var(--vscode-terminal-foreground, var(--vscode-foreground)); font-size: 11px; }
  .msg.stderr .msg-text  { color: var(--vscode-terminal-ansiYellow); font-size: 11px; }
  .msg.error .msg-text   { color: var(--vscode-errorForeground); font-weight: 600; }
  .msg.success .msg-text { color: var(--vscode-terminal-ansiGreen); font-weight: 700; font-size: 12px; font-family: 'Segoe UI', sans-serif; }
  .msg.stepdone .msg-text{ color: var(--vscode-terminal-ansiGreen); }

  .spinner {
    display: inline-block;
    width: 10px; height: 10px;
    border: 2px solid var(--vscode-button-background);
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
    flex-shrink: 0;
    margin-top: 3px;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Divider / clear ── */
  .divider {
    height: 1px;
    background: var(--vscode-panel-border);
    margin: 4px 0;
    opacity: 0.5;
    flex-shrink: 0;
  }
  .clear-btn {
    align-self: flex-end;
    background: none;
    border: none;
    color: var(--vscode-descriptionForeground);
    font-size: 10px;
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 3px;
    flex-shrink: 0;
  }
  .clear-btn:hover { color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground); }

  .footer { padding: 8px 12px 10px; flex-shrink: 0; border-top: 1px solid var(--vscode-panel-border); }
  .footer-hint { font-size: 10px; color: var(--vscode-descriptionForeground); text-align: center; margin-top: 6px; }

  .empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    color: var(--vscode-descriptionForeground);
    font-size: 11px;
    text-align: center;
    padding: 0 20px;
    opacity: 0.7;
  }
  .empty-state .big { font-size: 28px; }
</style>
</head>
<body>

<!-- Header -->
<div class="header">
  <div class="header-title">
    <span class="flame">🔥</span> Gulp Runner
  </div>
  <button class="btn btn-primary" id="btnBuild" onclick="runBuild()">
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polygon points="5 3 19 12 5 21 5 3"/>
    </svg>
    Build UI Package
  </button>
</div>

<!-- Pipeline Steps Indicator -->
<div class="pipeline" id="pipeline" style="display:none">
  <div class="step-node" id="sn0">
    <div class="step-dot" id="sd0">•</div>
    <div class="step-label">clean</div>
  </div>
  <div class="step-node" id="sn1">
    <div class="step-dot" id="sd1">•</div>
    <div class="step-label">build</div>
  </div>
  <div class="step-node" id="sn2">
    <div class="step-dot" id="sd2">•</div>
    <div class="step-label">bundle</div>
  </div>
  <div class="step-node" id="sn3">
    <div class="step-dot" id="sd3">•</div>
    <div class="step-label">package</div>
  </div>
</div>

<!-- Chat log -->
<div class="chat-area" id="chatArea">
  <div class="empty-state" id="emptyState">
    <div class="big">⚡</div>
    <div>Click <strong>Build UI Package</strong><br>to start the pipeline</div>
  </div>
</div>

<!-- Footer -->
<div class="footer">
  <button class="btn btn-cancel" id="btnCancel" style="display:none" onclick="cancelRun()">
    ⛔ Cancel
  </button>
  <div class="footer-hint" id="footerHint">4 gulp tasks will run in sequence</div>
</div>

<script>
  const vscode = acquireVsCodeApi();
  const chatArea = document.getElementById('chatArea');
  const emptyState = document.getElementById('emptyState');
  const btnBuild = document.getElementById('btnBuild');
  const btnCancel = document.getElementById('btnCancel');
  const pipeline = document.getElementById('pipeline');
  const footerHint = document.getElementById('footerHint');

  const STEPS = ['gulp clean', 'gulp build', 'gulp bundle --ship', 'gulp package-solution --ship'];
  let currentStep = -1;
  let running = false;

  function runBuild() {
    vscode.postMessage({ type: 'runBuildUIPackage' });
  }

  function cancelRun() {
    vscode.postMessage({ type: 'cancelRun' });
  }

  function setRunning(val) {
    running = val;
    btnBuild.disabled = val;
    btnCancel.style.display = val ? 'flex' : 'none';
    pipeline.style.display = val || currentStep >= 0 ? 'flex' : 'none';
  }

  function resetStepNodes() {
    for (let i = 0; i < 4; i++) {
      const sn = document.getElementById('sn' + i);
      const sd = document.getElementById('sd' + i);
      sn.className = 'step-node';
      sd.textContent = '•';
    }
    currentStep = -1;
  }

  function activateStep(index) {
    currentStep = index;
    const sn = document.getElementById('sn' + index);
    const sd = document.getElementById('sd' + index);
    if (sn) { sn.className = 'step-node active'; sd.innerHTML = '<div class="spinner" style="width:7px;height:7px;border-width:1.5px;margin:0"></div>'; }
  }

  function completeStep(index, success) {
    const sn = document.getElementById('sn' + index);
    const sd = document.getElementById('sd' + index);
    if (sn) {
      sn.className = 'step-node ' + (success ? 'done' : 'error');
      sd.textContent = success ? '✓' : '✗';
    }
  }

  function addMsg(cls, icon, text) {
    if (emptyState && emptyState.parentNode) emptyState.remove();
    const div = document.createElement('div');
    div.className = 'msg ' + cls;
    div.innerHTML = \`<span class="msg-icon">\${icon}</span><span class="msg-text">\${escHtml(text)}</span>\`;
    chatArea.appendChild(div);
    chatArea.scrollTop = chatArea.scrollHeight;
  }

  function addDivider() {
    const d = document.createElement('div');
    d.className = 'divider';
    chatArea.appendChild(d);
  }

  function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // Map step label → index
  const stepMap = {
    'gulp clean': 0,
    'gulp build': 1,
    'gulp bundle --ship': 2,
    'gulp package-solution --ship': 3
  };

  window.addEventListener('message', ({ data }) => {
    switch (data.type) {
      case 'start':
        resetStepNodes();
        chatArea.innerHTML = '';
        pipeline.style.display = 'flex';
        setRunning(true);
        footerHint.textContent = 'Running pipeline…';
        addMsg('system', '🚀', 'Starting Build UI Package pipeline…');
        addDivider();
        break;

      case 'log':
        addMsg('system', 'ℹ', data.text);
        break;

      case 'step': {
        // detect which step
        const label = data.text.replace('▶ Running: ', '').trim();
        const idx = stepMap[label];
        if (idx !== undefined) {
          if (currentStep >= 0 && currentStep !== idx) completeStep(currentStep, true);
          activateStep(idx);
        }
        addMsg('step', '▶', data.text);
        break;
      }

      case 'stepDone': {
        const label = data.text.replace(/^✔\s*/, '').replace(/ — done$/, '').trim();
        const idx = stepMap[label];
        if (idx !== undefined) completeStep(idx, true);
        addMsg('stepdone', '✔', data.text);
        addDivider();
        break;
      }

      case 'output':
        addMsg('output', ' ', data.text);
        break;

      case 'stderr':
        addMsg('stderr', '⚠', data.text);
        break;

      case 'error':
        if (currentStep >= 0) completeStep(currentStep, false);
        addMsg('error', '✖', data.text);
        break;

      case 'success':
        addMsg('success', '🎉', data.text);
        break;

      case 'done':
        setRunning(false);
        footerHint.textContent = '4 gulp tasks will run in sequence';
        break;
    }
  });
</script>
</body>
</html>`;
  }
}

export function deactivate() {}
