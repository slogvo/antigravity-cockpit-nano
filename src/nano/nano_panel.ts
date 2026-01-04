import * as vscode from 'vscode';
import { QuotaSnapshot } from '../shared/types';
import { logger } from '../shared/log_service';

/**
 * NanoPanel - A lightweight Webview Panel
 * Minimalist design, no dependencies on heavy frameworks.
 */
export class NanoPanel {
    public static currentPanel: NanoPanel | undefined;
    private static readonly viewType = 'antigravity.nano';
    private readonly panel: vscode.WebviewPanel;
    private readonly extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this.panel = panel;
        this.extensionUri = extensionUri;

        // Set initial HTML
        this.panel.webview.html = this.getHtmlForWebview();

        // Listen for when the panel is disposed
        this.panel.onDidDispose(() => this.dispose(), null, this._disposables);
    }

    /**
     * Create or show the Nano Panel
     */
    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (NanoPanel.currentPanel) {
            NanoPanel.currentPanel.panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            NanoPanel.viewType,
            'Nano',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'assets')],
                retainContextWhenHidden: true, 
            }
        );

        NanoPanel.currentPanel = new NanoPanel(panel, extensionUri);
    }

    /**
     * Send quota data to the view
     */
    public update(snapshot: QuotaSnapshot) {
        this.panel.webview.postMessage({
            type: 'update',
            data: snapshot
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

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${cspNonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Nano</title>
    <style>
        :root {
            --accent-green: #4ade80;
            --accent-pink: #f472b6;
            --accent-yellow: #fbbf24;
            --accent-blue: #60a5fa;
        }
        body {
            font-family: var(--vscode-font-family), "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background-color: #020b14; /* Darker navy theme matching screenshot */
            color: #e2e8f0;
            padding: 16px;
            margin: 0;
            font-size: 13px;
            overflow-x: hidden;
        }

        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
        }

        .header h2 {
            margin: 0;
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: #94a3b8;
        }

        .time-display {
            font-size: 11px;
            color: #94a3b8;
        }

        .user-info {
            font-size: 11px;
            color: #64748b;
            margin-bottom: 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        #email-display {
            opacity: 0.8;
        }

        /* Lang Switcher */
        .lang-switcher {
            display: flex;
            gap: 4px;
        }
        .lang-btn {
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.1);
            color: #94a3b8;
            padding: 2px 6px;
            font-size: 10px;
            cursor: pointer;
            border-radius: 3px;
        }
        .lang-btn.active {
            background: #334155;
            color: white;
            border-color: #475569;
        }

        .model-list {
            display: flex;
            flex-direction: column;
            gap: 16px;
        }

        .model-item {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        .model-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .model-left {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .model-name {
            font-weight: 600;
            font-size: 13px;
        }

        .status-badge {
            font-size: 9px;
            padding: 1px 5px;
            border-radius: 10px;
            text-transform: uppercase;
            font-weight: 800;
        }
        .badge-healthy { background: rgba(74, 222, 128, 0.1); color: var(--accent-green); }
        .badge-warning { background: rgba(251, 191, 36, 0.1); color: var(--accent-yellow); }
        .badge-danger { background: rgba(244, 114, 182, 0.1); color: var(--accent-pink); }

        .model-right {
            display: flex;
            flex-direction: column;
            align-items: flex-end;
        }

        .model-pct {
            font-weight: 700;
            font-size: 12px;
        }

        .model-reset-hint {
            font-size: 9px;
            opacity: 0.5;
            margin-top: 1px;
        }

        .progress-bar-bg {
            height: 3px;
            width: 100%;
            background-color: rgba(255, 255, 255, 0.05);
            border-radius: 1px;
            overflow: hidden;
        }

        .progress-bar-fill {
            height: 100%;
            background-color: var(--accent-green);
            transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .progress-bar-fill.warning { background-color: var(--accent-yellow); }
        .progress-bar-fill.danger { background-color: var(--accent-pink); }

        .footer {
            margin-top: 32px;
            padding-top: 16px;
            border-top: 1px solid rgba(255,255,255,0.05);
            font-size: 11px;
            color: #64748b;
            text-align: center;
        }

        .status-offline {
            color: #f87171;
            text-align: center;
            margin-top: 40px;
            font-weight: 500;
        }
    </style>
</head>
<body>
    <div id="app">
        <div class="header">
            <h2 id="title-label">NANO MONITOR</h2>
            <div class="time-display" id="clock">--:--:--</div>
        </div>

        <div class="user-info">
            <div id="email-display">Not logged in</div>
            <div class="lang-switcher">
                <button class="lang-btn active" onclick="setLang('en')" id="btn-en">EN</button>
                <button class="lang-btn" onclick="setLang('vi')" id="btn-vi">VI</button>
            </div>
        </div>

        <div id="model-container" class="model-list">
            <div style="text-align: center; opacity: 0.3; padding: 40px;">Initializing systems...</div>
        </div>

        <div class="footer" id="footer-text">
            Next Global Reset: --
        </div>
    </div>

    <script nonce="${cspNonce}">
        const vscode = acquireVsCodeApi();
        let currentSnapshot = null;
        let currentLang = 'en';

        const i18n = {
            en: {
                title: 'NANO MONITOR',
                healthy: 'Healthy',
                warning: 'Warning',
                danger: 'Critical',
                offline: 'System Offline',
                resetIn: 'Reset in',
                nextReset: 'Next Global Reset',
                loggedAs: 'Logged in as'
            },
            vi: {
                title: 'GIÁM SÁT NANO',
                healthy: 'Tốt',
                warning: 'Cảnh báo',
                danger: 'Nguy kịch',
                offline: 'Hệ thống ngoại tuyến',
                resetIn: 'Reset sau',
                nextReset: 'Lần Reset tới',
                loggedAs: 'Đăng nhập:'
            }
        };

        // Clock
        setInterval(() => {
            document.getElementById('clock').textContent = new Date().toLocaleTimeString();
        }, 1000);

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'update') {
                currentSnapshot = message.data;
                render();
            }
        });

        function setLang(lang) {
            currentLang = lang;
            document.getElementById('btn-en').classList.toggle('active', lang === 'en');
            document.getElementById('btn-vi').classList.toggle('active', lang === 'vi');
            render();
        }

        function render() {
            if (!currentSnapshot) return;

            const t = i18n[currentLang];
            document.getElementById('title-label').textContent = t.title;

            const emailEl = document.getElementById('email-display');
            if (currentSnapshot.userInfo && currentSnapshot.userInfo.email) {
                emailEl.textContent = \`\${t.loggedAs}: \${currentSnapshot.userInfo.email}\`;
            } else {
                emailEl.textContent = '';
            }

            const container = document.getElementById('model-container');
            const footer = document.getElementById('footer-text');

            if (!currentSnapshot.isConnected) {
                container.innerHTML = \`<div class="status-offline">\${t.offline}</div>\`;
                return;
            }

            if (currentSnapshot.models && currentSnapshot.models.length > 0) {
                container.innerHTML = currentSnapshot.models.map(m => {
                    const pct = m.remainingPercentage || 0;
                    let colorClass = '';
                    let statusLabel = t.healthy;
                    let badgeClass = 'badge-healthy';

                    if (pct < 15) {
                        colorClass = 'danger';
                        statusLabel = t.danger;
                        badgeClass = 'badge-danger';
                    } else if (pct < 40) {
                        colorClass = 'warning';
                        statusLabel = t.warning;
                        badgeClass = 'badge-warning';
                    }

                    const resetHint = m.timeUntilResetFormatted ? \`\${t.resetIn} \${m.timeUntilResetFormatted}\` : '';
                    const resetTime = m.resetTimeDisplay ? \` (\${m.resetTimeDisplay})\` : '';

                    return \`
                        <div class="model-item">
                            <div class="model-row">
                                <div class="model-left">
                                    <span class="model-name">\${escapeHtml(m.label)}</span>
                                    <span class="status-badge \${badgeClass}">\${statusLabel}</span>
                                </div>
                                <div class="model-right">
                                    <span class="model-pct">\${pct.toFixed(2)}%</span>
                                    <span class="model-reset-hint">\${resetHint}\${resetTime}</span>
                                </div>
                            </div>
                            <div class="progress-bar-bg">
                                <div class="progress-bar-fill \${colorClass}" style="width: \${pct}%"></div>
                            </div>
                        </div>
                    \`;
                }).join('');

                // Use the first model's reset as global hint for footer if available
                const globalReset = currentSnapshot.models[0].timeUntilResetFormatted;
                footer.textContent = \`\${t.nextReset}: \${globalReset || '--'}\`;

            } else {
                container.innerHTML = '<div style="text-align:center; opacity:0.3; padding: 40px;">No models detected</div>';
            }
        }

        function escapeHtml(unsafe) {
            return unsafe
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
        }
        
        // Initial render if data exists
        if (currentSnapshot) render();
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
