import * as vscode from 'vscode';
import { QuotaSnapshot } from '../shared/types';
import { logger } from '../shared/log_service';

/**
 * NanoPanel - A lightweight Webview Panel
 * Focused on Antigravity Cockpit Nano Monitor with local assets.
 */
export class NanoPanel {
    public static currentPanel: NanoPanel | undefined;
    private static readonly viewType = 'antigravity.nano';
    private readonly panel: vscode.WebviewPanel;
    private readonly extensionUri: vscode.Uri;
    private readonly version: string;
    private _disposables: vscode.Disposable[] = [];

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, version: string) {
        this.panel = panel;
        this.extensionUri = extensionUri;
        this.version = version;

        // Set initial HTML
        this.panel.webview.html = this.getHtmlForWebview();

        // Listen for when the panel is disposed
        this.panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Handle messages from the webview
        this.panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'refresh':
                        vscode.commands.executeCommand('antigravity.refreshNano');
                        return;
                    case 'recordUsage':
                        vscode.commands.executeCommand('antigravity.recordUsage', message.modelId);
                        return;
                }
            },
            null,
            this._disposables
        );
    }

    public static createOrShow(extensionUri: vscode.Uri, version: string = '1.0.0') {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (NanoPanel.currentPanel) {
            NanoPanel.currentPanel.panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            NanoPanel.viewType,
            'Antigravity Cockpit Nano',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'assets')],
                retainContextWhenHidden: true,
            },
        );

        NanoPanel.currentPanel = new NanoPanel(panel, extensionUri, version);
    }

    public update(snapshot: QuotaSnapshot) {
        this.panel.webview.postMessage({
            type: 'update',
            data: snapshot,
        });
    }

    public dispose() {
        NanoPanel.currentPanel = undefined;
        this.panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private getHtmlForWebview(): string {
        const cspNonce = getNonce();

        // Convert local assets to Webview URIs
        const geminiUri = this.panel.webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'assets', 'gemini.svg'),
        );
        const claudeUri = this.panel.webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'assets', 'claude.svg'),
        );
        const gptUri = this.panel.webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'assets', 'gpt.svg'),
        );

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${this.panel.webview.cspSource} data:; style-src 'unsafe-inline'; script-src 'nonce-${cspNonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Antigravity Cockpit Nano</title>
    <style>
        :root {
            --accent-green: #4ade80;
            --accent-pink: #f472b6;
            --accent-yellow: #fbbf24;
            --text-primary: #f1f5f9;
            --text-secondary: #94a3b8;
            --bg-main: #020617;
            --border-card: rgba(51, 65, 85, 0.5);
        }
        body {
            font-family: var(--vscode-font-family), "Inter", "Segoe UI", sans-serif;
            background-color: var(--bg-main);
            color: var(--text-primary);
            padding: 48px;
            margin: 0;
            display: flex;
            justify-content: center;
        }

        #app {
            width: 100%;
            max-width: 980px;
        }

        .main-container {
            display: flex;
            flex-direction: column;
            gap: 24px;
            margin-bottom: 32px;
        }

        .title-group h1 {
            margin: 0;
            font-size: 20px;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0px;
            color: #ffffff;
        }

        .user-info {
            font-size: 16px;
            font-weight: 400;
            color: #f8fafc;
            display: flex;
            align-items: center;
        }
        .user-info .label {
            color: var(--text-secondary);
            margin-right: 8px;
            font-size: 14px;
        }

        .refresh-row {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .refresh-btn {
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.08);
            color: var(--text-secondary);
            cursor: pointer;
            padding: 6px 16px;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            transition: all 0.2s ease;
            outline: none;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            height: 32px;
        }

        .refresh-btn:hover {
            background: rgba(255, 255, 255, 0.08);
            color: #ffffff;
            border-color: rgba(255, 255, 255, 0.15);
        }

        .refresh-btn svg {
            width: 16px;
            height: 16px;
        }

        .refresh-btn.loading svg {
            animation: spin 1s linear infinite;
        }

        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }

        .refresh-hint {
            font-size: 10px;
            color: #64748b;
            font-weight: 400;
        }

        .refresh-label {
            font-size: 11px;
            font-weight: 600;
            color: var(--accent-yellow);
            margin-left: 4px;
        }

        .grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 32px;
        }

        @media (max-width: 900px) {
            .grid { grid-template-columns: 1fr; }
        }

        .card {
            border: 0.5px solid var(--border-card);
            padding: 24px;
            border-radius: 16px;
            display: flex;
            flex-direction: column;
            gap: 32px;
            transition: all 0.2s ease;
        }
        .card:hover {
            border-color: #4755693c;
            background: rgba(30, 41, 59, 0.2);
            transform: translateY(-2px);
        }

        .card-top {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
        }

        .model-meta {
            display: flex;
            align-items: center;
            gap: 14px;
        }

        .m-icon {
            width: 32px;
            height: 32px;
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .m-icon img { width: 100%; height: 100%; object-fit: contain; }

        .m-title {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .m-name {
            font-size: 16px;
            font-weight: 700;
            color: #ffffff;
        }

        .badge {
            font-size: 9px;
            padding: 4px 8px;
            margin-top: 4px;
            border-radius: 20px;
            font-weight: 500;
            text-transform: uppercase;
            width: fit-content;
            letter-spacing: 0.5px;
        }
        .badge-healthy { background: rgba(74, 222, 128, 0.1); color: var(--accent-green); border: 1px solid rgba(74, 222, 128, 0.2); }
        .badge-warning { background: rgba(251, 191, 36, 0.1); color: var(--accent-yellow); border: 1px solid rgba(251, 191, 36, 0.2); }
        .badge-danger { background: rgba(244, 114, 182, 0.1); color: var(--accent-pink); border: 1px solid rgba(244, 114, 182, 0.2); }

        .pct {
            font-size: 16px;
            font-weight: 600;
            color: #ffffff;
            font-variant-numeric: tabular-nums;
        }

        .p-bg {
            height: 6px;
            background: rgba(255,255,255,0.05);
            border-radius: 4px;
            overflow: hidden;
        }
        .p-fill {
            height: 100%;
            background: var(--accent-green);
            transition: width 1.2s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .p-fill.warning { background: var(--accent-yellow); }
        .p-fill.danger { background: var(--accent-pink); }

        .reset-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 12px;
            color: var(--text-secondary);
            padding-top: 12px;
            border-top: 1px solid rgba(255,255,255,0.03);
        }
        .r-val { color: #e2e8f0; font-weight: 600; }

        .footer {
            margin-top: 64px;
            text-align: center;
            color: #475569;
            font-size: 12px;
            letter-spacing: 1px;
        }
    </style>
</head>
<body>
    <div id="app">
        <div class="main-container">
            <div class="title-group">
                <h1>ANTIGRAVITY COCKPIT NANO MONITOR</h1>
            </div>

            <div class="user-info">
                <span class="label">Logged in as:</span>
                <span id="email-text">Loading user profile...</span>
            </div>

            <div class="refresh-row">
                <button id="refresh-btn" class="refresh-btn" title="Refresh Quota">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M23 4v6h-6"></path>
                        <path d="M1 20v-6h6"></path>
                        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                    </svg>
                    <span>REFRESH</span>
                    <span class="refresh-label"></span>
                </button>
                <div class="refresh-hint">Update latest quota from API</div>
            </div>
        </div>

        <main id="model-container" class="grid"></main>

        <footer class="footer">
            
        </footer>
    </div>

    <script nonce="${cspNonce}">
        const vscode = acquireVsCodeApi();
        let currentSnapshot = null;

        const ASSETS = {
            gemini: "${geminiUri}",
            claude: "${claudeUri}",
            gpt: "${gptUri}"
        };

        function getIconSrc(name) {
            const low = name.toLowerCase();
            if (low.includes('gemini')) return ASSETS.gemini;
            if (low.includes('claude')) return ASSETS.claude;
            if (low.includes('gpt') || low.includes('chatgpt')) return ASSETS.gpt;
            return null;
        }


        // Refresh Logic
        const refreshBtn = document.getElementById('refresh-btn');
        let refreshCooldown = 0;

        refreshBtn.addEventListener('click', () => {
            if (refreshCooldown > 0) return;

            // Start spinning
            refreshBtn.classList.add('loading');
            
            // Send refresh signal
            vscode.postMessage({ command: 'refresh' });

            // Start cooldown (60 seconds)
            refreshCooldown = 60;
            updateRefreshUI();
        });

        function updateRefreshUI() {
            const label = refreshBtn.querySelector('.refresh-label');
            if (refreshCooldown > 0) {
                refreshBtn.disabled = true;
                refreshBtn.style.opacity = "0.7";
                label.textContent = \`(\${refreshCooldown}s)\`;
                refreshCooldown--;
                setTimeout(updateRefreshUI, 1000);
            } else {
                refreshBtn.disabled = false;
                refreshBtn.style.opacity = "1";
                refreshBtn.classList.remove('loading');
                label.textContent = '';
            }
        }

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'update') {
                currentSnapshot = message.data;
                render();
                // Stop spinning when we get an update
                refreshBtn.classList.remove('loading');
            }
        });

        function render() {
            if (!currentSnapshot) return;

            const emailText = document.getElementById('email-text');
            emailText.textContent = (currentSnapshot.userInfo && currentSnapshot.userInfo.email) 
                ? currentSnapshot.userInfo.email 
                : 'Not Logged In';

            const container = document.getElementById('model-container');
            if (currentSnapshot.models && currentSnapshot.models.length > 0) {
                container.innerHTML = currentSnapshot.models.map(m => {
                    const pct = m.remainingPercentage || 0;
                    let color = '';
                    let status = 'HEALTHY';
                    let bClass = 'badge-healthy';

                    if (pct < 15) { color = 'danger'; status = 'CRITICAL'; bClass = 'badge-danger'; }
                    else if (pct < 40) { color = 'warning'; status = 'WARNING'; bClass = 'badge-warning'; }

                    const resetIn = m.timeUntilResetFormatted || 'N/A';
                    const resetAt = m.resetTimeDisplay ? \`at \${m.resetTimeDisplay}\` : '';
                    const src = getIconSrc(m.label);
                    const iconHtml = src ? \`<img src="\${src}" alt="logo" />\` : '';

                    return \`
                        <div class="card">
                            <div class="card-top">
                                <div class="model-meta">
                                    <div class="m-icon">\${iconHtml}</div>
                                    <div class="m-title">
                                        <span class="m-name">\${escapeHtml(m.label)}</span>
                                        <span class="badge \${bClass}">\${status}</span>
                                    </div>
                                </div>
                                <div class="pct">\${pct.toFixed(2)}%</div>
                            </div>
                            
                            <div>
                                <div class="p-bg">
                                    <div class="p-fill \${color}" style="width: \${pct}%"></div>
                                </div>
                                <div class="reset-row">
                                    <span>Reset in <span class="r-val">\${resetIn}</span></span>
                                    <span>\${resetAt}</span>
                                </div>
                            </div>
                        </div>
                    \`;
                }).join('');
            }
        }

        function escapeHtml(unsafe) {
            return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
        }
    </script>
</body>
</html>`;
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
