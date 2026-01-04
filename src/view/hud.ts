/**
 * Antigravity Cockpit - HUD View
 * Responsible for creating and managing Webview Dashboard
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { QuotaSnapshot, DashboardConfig, WebviewMessage } from '../shared/types';
import { logger } from '../shared/log_service';
import { configService } from '../shared/config_service';
import { i18n, t } from '../shared/i18n';

/**
 * CockpitHUD Class
 * Manages creation, update, and disposal of Webview panels
 */
export class CockpitHUD {
    public static readonly viewType = 'antigravity.cockpit';
    
    private panels: Map<string, vscode.WebviewPanel> = new Map();
    private cachedTelemetry?: QuotaSnapshot;
    private messageRouter?: (message: WebviewMessage) => void;
    private readonly extensionUri: vscode.Uri;
    private readonly context: vscode.ExtensionContext;

    constructor(extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
        this.extensionUri = extensionUri;
        this.context = context;
    }

    /**
     * Show HUD Panel
     * @param initialTab Optional initial tab (e.g., 'auto-trigger')
     * @returns Whether successfully opened
     */
    public async revealHud(initialTab?: string): Promise<boolean> {
        const column = vscode.window.activeTextEditor?.viewColumn;
        const existingPanel = this.panels.get('main');

        if (existingPanel) {
            existingPanel.reveal(column);
            this.refreshWithCachedData();
            // If initial tab is specified, send message to switch
            if (initialTab) {
                setTimeout(() => {
                    existingPanel.webview.postMessage({ type: 'switchTab', tab: initialTab });
                }, 100);
            }
            return true;
        }

        try {
            const panel = vscode.window.createWebviewPanel(
                CockpitHUD.viewType,
                t('dashboard.title'),
                column || vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    localResourceRoots: [this.extensionUri],
                    retainContextWhenHidden: true,
                },
            );

            this.panels.set('main', panel);

            panel.onDidDispose(() => {
                this.panels.delete('main');
            });

            panel.webview.onDidReceiveMessage((message: WebviewMessage) => {
                if (this.messageRouter) {
                    this.messageRouter(message);
                }
            });

            panel.webview.html = this.generateHtml(panel.webview);

            if (this.cachedTelemetry) {
                this.refreshWithCachedData();
            }

            // If initial tab is specified, delay sending message to switch
            if (initialTab) {
                setTimeout(() => {
                    panel.webview.postMessage({ type: 'switchTab', tab: initialTab });
                }, 500);
            }

            return true;
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.error(`Failed to create Webview panel: ${err.message}`);
            return false;
        }
    }

    /**
     * Refresh view with cached data
     */
    private refreshWithCachedData(): void {
        if (this.cachedTelemetry) {
            const config = configService.getConfig();
            this.refreshView(this.cachedTelemetry, {
                showPromptCredits: config.showPromptCredits,
                pinnedModels: config.pinnedModels,
                modelOrder: config.modelOrder,
                modelCustomNames: config.modelCustomNames,
                groupingEnabled: config.groupingEnabled,
                groupCustomNames: config.groupingCustomNames,
                groupingShowInStatusBar: config.groupingShowInStatusBar,
                pinnedGroups: config.pinnedGroups,
                groupOrder: config.groupOrder,
                refreshInterval: config.refreshInterval,
                notificationEnabled: config.notificationEnabled,
                warningThreshold: config.warningThreshold,
                criticalThreshold: config.criticalThreshold,
                statusBarFormat: config.statusBarFormat,
                profileHidden: config.profileHidden,
                viewMode: config.viewMode,
                displayMode: config.displayMode,
                dataMasked: config.dataMasked,
                groupMappings: config.groupMappings,
            });
        }
    }

    /**
     * Rehydrate from cache
     */
    public rehydrate(): void {
        this.refreshWithCachedData();
    }

    /**
     * Register message handler
     */
    public onSignal(handler: (message: WebviewMessage) => void): void {
        this.messageRouter = handler;
    }

    /**
     * Send message to Webview
     */
    public sendMessage(message: object): void {
        const panel = this.panels.get('main');
        if (panel) {
            panel.webview.postMessage(message);
        }
    }

    /**
     * Refresh view
     */
    public refreshView(snapshot: QuotaSnapshot, config: DashboardConfig): void {
        this.cachedTelemetry = snapshot;
        const panel = this.panels.get('main');
        
        if (panel) {
            // Convert data to Webview compatible format
            const webviewData = this.convertToWebviewFormat(snapshot);

            panel.webview.postMessage({
                type: 'telemetry_update',
                data: webviewData,
                config,
            });
        }
    }

    /**
     * Convert data format (camelCase to snake_case, compatible with Webview JS)
     */
    private convertToWebviewFormat(snapshot: QuotaSnapshot): object {
        return {
            timestamp: snapshot.timestamp,
            isConnected: snapshot.isConnected,
            errorMessage: snapshot.errorMessage,
            prompt_credits: snapshot.promptCredits ? {
                available: snapshot.promptCredits.available,
                monthly: snapshot.promptCredits.monthly,
                remainingPercentage: snapshot.promptCredits.remainingPercentage,
                usedPercentage: snapshot.promptCredits.usedPercentage,
            } : undefined,
            userInfo: snapshot.userInfo ? {
                name: snapshot.userInfo.name,
                email: snapshot.userInfo.email,
                planName: snapshot.userInfo.planName,
                tier: snapshot.userInfo.tier,
                browserEnabled: snapshot.userInfo.browserEnabled,
                knowledgeBaseEnabled: snapshot.userInfo.knowledgeBaseEnabled,
                canBuyMoreCredits: snapshot.userInfo.canBuyMoreCredits,
                hasAutocompleteFastMode: snapshot.userInfo.hasAutocompleteFastMode,
                monthlyPromptCredits: snapshot.userInfo.monthlyPromptCredits,
                monthlyFlowCredits: snapshot.userInfo.monthlyFlowCredits,
                availablePromptCredits: snapshot.userInfo.availablePromptCredits,
                availableFlowCredits: snapshot.userInfo.availableFlowCredits,
                cascadeWebSearchEnabled: snapshot.userInfo.cascadeWebSearchEnabled,
                canGenerateCommitMessages: snapshot.userInfo.canGenerateCommitMessages,
                allowMcpServers: snapshot.userInfo.allowMcpServers,
                maxNumChatInputTokens: snapshot.userInfo.maxNumChatInputTokens,
                tierDescription: snapshot.userInfo.tierDescription,
                upgradeUri: snapshot.userInfo.upgradeUri,
                upgradeText: snapshot.userInfo.upgradeText,
                // New fields
                teamsTier: snapshot.userInfo.teamsTier,
                hasTabToJump: snapshot.userInfo.hasTabToJump,
                allowStickyPremiumModels: snapshot.userInfo.allowStickyPremiumModels,
                allowPremiumCommandModels: snapshot.userInfo.allowPremiumCommandModels,
                maxNumPremiumChatMessages: snapshot.userInfo.maxNumPremiumChatMessages,
                maxCustomChatInstructionCharacters: snapshot.userInfo.maxCustomChatInstructionCharacters,
                maxNumPinnedContextItems: snapshot.userInfo.maxNumPinnedContextItems,
                maxLocalIndexSize: snapshot.userInfo.maxLocalIndexSize,
                monthlyFlexCreditPurchaseAmount: snapshot.userInfo.monthlyFlexCreditPurchaseAmount,
                canCustomizeAppIcon: snapshot.userInfo.canCustomizeAppIcon,
                cascadeCanAutoRunCommands: snapshot.userInfo.cascadeCanAutoRunCommands,
                canAllowCascadeInBackground: snapshot.userInfo.canAllowCascadeInBackground,
                allowAutoRunCommands: snapshot.userInfo.allowAutoRunCommands,
                allowBrowserExperimentalFeatures: snapshot.userInfo.allowBrowserExperimentalFeatures,
                acceptedLatestTermsOfService: snapshot.userInfo.acceptedLatestTermsOfService,
                userTierId: snapshot.userInfo.userTierId,
            } : undefined,
            models: snapshot.models.map(m => ({
                label: m.label,
                modelId: m.modelId,
                remainingPercentage: m.remainingPercentage,
                isExhausted: m.isExhausted,
                timeUntilResetFormatted: m.timeUntilResetFormatted,
                resetTimeDisplay: m.resetTimeDisplay,
                // Model capability fields
                supportsImages: m.supportsImages,
                isRecommended: m.isRecommended,
                tagTitle: m.tagTitle,
                supportedMimeTypes: m.supportedMimeTypes,
            })),
            groups: snapshot.groups?.map(g => ({
                groupId: g.groupId,
                groupName: g.groupName,
                remainingPercentage: g.remainingPercentage,
                resetTimeDisplay: g.resetTimeDisplay,
                timeUntilResetFormatted: g.timeUntilResetFormatted,
                isExhausted: g.isExhausted,
                models: g.models.map(m => ({
                    label: m.label,
                    modelId: m.modelId,
                    // Model capability fields
                    supportsImages: m.supportsImages,
                    isRecommended: m.isRecommended,
                    tagTitle: m.tagTitle,
                    supportedMimeTypes: m.supportedMimeTypes,
                })),
            })),
        };
    }

    /**
     * Dispose all panels
     */
    public dispose(): void {
        this.panels.forEach(panel => panel.dispose());
        this.panels.clear();
    }

    /**
     * Get Webview resource URI
     */
    private getWebviewUri(webview: vscode.Webview, ...pathSegments: string[]): vscode.Uri {
        return webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, ...pathSegments),
        );
    }

    /**
     * Read external resource file content
     */
    private readResourceFile(...pathSegments: string[]): string {
        try {
            const filePath = path.join(this.extensionUri.fsPath, ...pathSegments);
            return fs.readFileSync(filePath, 'utf8');
        } catch (e) {
            logger.error(`Failed to read resource file: ${pathSegments.join('/')}`, e);
            return '';
        }
    }

    /**
     * Generate HTML content
     */
    private generateHtml(webview: vscode.Webview): string {
        // Get external resource URIs
        const styleUri = this.getWebviewUri(webview, 'out', 'view', 'webview', 'dashboard.css');
        const listStyleUri = this.getWebviewUri(webview, 'out', 'view', 'webview', 'list_view.css');
        const autoTriggerStyleUri = this.getWebviewUri(webview, 'out', 'view', 'webview', 'auto_trigger.css');
        const scriptUri = this.getWebviewUri(webview, 'out', 'view', 'webview', 'dashboard.js');
        const autoTriggerScriptUri = this.getWebviewUri(webview, 'out', 'view', 'webview', 'auto_trigger.js');

        // Get localized text
        const translations = i18n.getAllTranslations();
        const translationsJson = JSON.stringify(translations);

        const timeOptions = [
            '06:00',
            '07:00',
            '08:00',
            '09:00',
            '10:00',
            '11:00',
            '12:00',
            '14:00',
            '16:00',
            '18:00',
            '20:00',
            '22:00',
        ];
        const renderTimeChips = (options: string[], selected: string): string => {
            return options.map(time => {
                const selectedClass = time === selected ? ' selected' : '';
                return `<div class="at-chip${selectedClass}" data-time="${time}">${time}</div>`;
            }).join('');
        };

        // CSP nonce
        const nonce = this.generateNonce();

        return `<!DOCTYPE html>
<html lang="${i18n.getLocale()}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src https: data:;">
    <title>${t('dashboard.title')}</title>
    <link rel="stylesheet" href="${styleUri}">
    <link rel="stylesheet" href="${listStyleUri}">
    <link rel="stylesheet" href="${autoTriggerStyleUri}">
</head>
<body>
    <header class="header">
        <div class="header-title">
            <span class="icon">🚀</span>
            <span>${t('dashboard.title')}</span>
        </div>
        <div class="controls">
            <button id="refresh-btn" class="refresh-btn" title="Manual Refresh (60s Cooldown)">
                ${t('dashboard.refresh')}
            </button>
            <button id="reset-order-btn" class="refresh-btn" title="Reset to default order">
                ${t('dashboard.resetOrder')}
            </button>
            <button id="toggle-grouping-btn" class="refresh-btn" title="${t('grouping.toggleHint')}">
                ${t('grouping.title')}
            </button>
            <button id="toggle-profile-btn" class="refresh-btn" title="${t('profile.togglePlan')}">
                ${t('profile.planDetails')}
            </button>
            <button id="announcement-btn" class="refresh-btn icon-only" title="${t('announcement.title')}">
                🔔<span id="announcement-badge" class="notification-badge hidden">0</span>
            </button>
            <button id="settings-btn" class="refresh-btn icon-only" title="${t('threshold.settings')}">
                ⚙️
            </button>
        </div>
    </header>

    <!-- Tab Navigation -->
    <nav class="tab-nav">
        <button class="tab-btn active" data-tab="quota">📊 ${t('dashboard.title')}</button>
        <button class="tab-btn" data-tab="auto-trigger">
            ${t('autoTrigger.tabTitle')} <span id="at-tab-status-dot" class="status-dot hidden">●</span>
        </button>
    </nav>

    <!-- Quota Tab Content -->
    <div id="tab-quota" class="tab-content active">
        <div id="status" class="status-connecting">
            <span class="spinner"></span>
            <span>${t('dashboard.connecting')}</span>
        </div>

        <div id="dashboard">
            <!-- Injected via JS -->
        </div>
    </div>

    <!-- Auto Trigger Tab Content -->
    <div id="tab-auto-trigger" class="tab-content">
        <div class="auto-trigger-compact">
            <!-- Description Card -->
            <div class="at-description-card">
                <div class="at-desc-title">${t('autoTrigger.descriptionTitle')}</div>
                <div class="at-desc-content">${t('autoTrigger.description')}</div>
            </div>

            <!-- Status Overview Card -->
            <div class="at-status-card" id="at-status-card">
                <!-- Auth Row -->
                <div class="at-row at-auth-row" id="at-auth-row">
                    <div class="at-auth-info">
                        <span class="at-auth-icon">⚠️</span>
                        <span class="at-auth-text">${t('autoTrigger.unauthorized')}</span>
                    </div>
                    <div class="at-auth-actions">
                        <button id="at-auth-btn" class="at-btn at-btn-primary">${t('autoTrigger.authorizeBtn')}</button>
                    </div>
                </div>

                <!-- Status Grid (hidden when unauthorized) -->
                <div class="at-status-grid" id="at-status-grid">
                    <div class="at-status-item">
                        <span class="at-label">⏰ ${t('autoTrigger.statusLabel') || 'Status'}</span>
                        <span class="at-value" id="at-status-value">${t('autoTrigger.disabled') || 'Disabled'}</span>
                    </div>
                    <div class="at-status-item">
                        <span class="at-label">📅 ${t('autoTrigger.modeLabel') || 'Mode'}</span>
                        <span class="at-value" id="at-mode-value">--</span>
                    </div>
                    <div class="at-status-item">
                        <span class="at-label">🤖 ${t('autoTrigger.modelsLabel') || 'Models'}</span>
                        <span class="at-value" id="at-models-value">--</span>
                    </div>
                    <div class="at-status-item">
                        <span class="at-label">⏭️ ${t('autoTrigger.nextTrigger')}</span>
                        <span class="at-value" id="at-next-value">--</span>
                    </div>
                </div>

                <!-- Action Buttons -->
                <div class="at-actions" id="at-actions">
                    <button id="at-config-btn" class="at-btn at-btn-secondary">
                        ⚙️ ${t('autoTrigger.configBtn') || 'Configure'}
                    </button>
                    <button id="at-test-btn" class="at-btn at-btn-accent">
                        ${t('autoTrigger.testBtn')}
                    </button>
                    <button id="at-history-btn" class="at-btn at-btn-secondary">
                        📜 ${t('autoTrigger.historyBtn') || 'History'} <span id="at-history-count">(0)</span>
                    </button>
                </div>
            </div>
        </div>
    </div>

    <!-- Config Modal -->
    <div id="at-config-modal" class="modal hidden">
        <div class="modal-content modal-content-medium">
            <div class="modal-header">
                <h3>${t('autoTrigger.scheduleSection')}</h3>
                <button id="at-config-close" class="close-btn">×</button>
            </div>
            <div class="modal-body at-config-body">
                <!-- Enable Toggle -->
                <div class="at-config-row">
                    <label>${t('autoTrigger.enableSchedule')}</label>
                    <label class="toggle-switch">
                        <input type="checkbox" id="at-enable-schedule">
                        <span class="toggle-slider"></span>
                    </label>
                </div>

                <!-- Mode Selection -->
                <div class="at-config-section">
                    <label>${t('autoTrigger.repeatMode')}</label>
                    <select id="at-mode-select" class="at-select">
                        <option value="daily">${t('autoTrigger.daily')}</option>
                        <option value="weekly">${t('autoTrigger.weekly')}</option>
                        <option value="interval">${t('autoTrigger.interval')}</option>
                    </select>
                </div>

                <!-- Daily Config -->
                <div id="at-config-daily" class="at-mode-config">
                    <label>${t('autoTrigger.selectTime')}</label>
                    <div class="at-time-grid" id="at-daily-times">
                        ${renderTimeChips(timeOptions, '08:00')}
                    </div>
                    <div class="at-custom-time-row">
                        <span class="at-custom-time-label">${t('autoTrigger.customTime')}</span>
                        <input type="time" id="at-daily-custom-time" class="at-input-time at-input-time-compact">
                        <button id="at-daily-add-time" class="at-btn at-btn-secondary at-btn-small">${t('autoTrigger.addTime')}</button>
                    </div>
                </div>

                <!-- Weekly Config -->
                <div id="at-config-weekly" class="at-mode-config hidden">
                    <label>${t('autoTrigger.selectDay')}</label>
                    <div class="at-day-grid" id="at-weekly-days">
                        <div class="at-chip selected" data-day="1">Mon</div>
                        <div class="at-chip selected" data-day="2">Tue</div>
                        <div class="at-chip selected" data-day="3">Wed</div>
                        <div class="at-chip selected" data-day="4">Thu</div>
                        <div class="at-chip selected" data-day="5">Fri</div>
                        <div class="at-chip" data-day="6">Sat</div>
                        <div class="at-chip" data-day="0">Sun</div>
                    </div>
                    <div class="at-quick-btns">
                        <button class="at-quick-btn" data-preset="workdays">${t('autoTrigger.workdays')}</button>
                        <button class="at-quick-btn" data-preset="weekend">${t('autoTrigger.weekend')}</button>
                        <button class="at-quick-btn" data-preset="all">${t('autoTrigger.allDays')}</button>
                    </div>
                    <label>${t('autoTrigger.selectTime')}</label>
                    <div class="at-time-grid" id="at-weekly-times">
                        ${renderTimeChips(timeOptions, '08:00')}
                    </div>
                    <div class="at-custom-time-row">
                        <span class="at-custom-time-label">${t('autoTrigger.customTime')}</span>
                        <input type="time" id="at-weekly-custom-time" class="at-input-time at-input-time-compact">
                        <button id="at-weekly-add-time" class="at-btn at-btn-secondary at-btn-small">${t('autoTrigger.addTime')}</button>
                    </div>
                </div>

                <!-- Interval Config -->
                <div id="at-config-interval" class="at-mode-config hidden">
                    <div class="at-interval-row">
                        <label>${t('autoTrigger.intervalLabel')}</label>
                        <input type="number" id="at-interval-hours" min="1" max="12" value="4" class="at-input-small">
                        <span>${t('autoTrigger.hours')}</span>
                    </div>
                    <div class="at-interval-row">
                        <label>${t('autoTrigger.from')}</label>
                        <input type="time" id="at-interval-start" value="07:00" class="at-input-time">
                        <label>${t('autoTrigger.to')}</label>
                        <input type="time" id="at-interval-end" value="22:00" class="at-input-time">
                    </div>
                </div>

                <!-- Model Selection -->
                <div class="at-config-section">
                    <label>${t('autoTrigger.modelSection')}</label>
                    <p class="at-hint">${t('autoTrigger.modelsHint')}</p>
                    <div id="at-config-models" class="at-model-list">
                        <div class="at-loading">${t('dashboard.connecting')}</div>
                    </div>
                </div>

                <!-- Crontab (Collapsed) -->
                <details class="at-advanced">
                    <summary>${t('autoTrigger.advanced')}</summary>
                    <div class="at-crontab-row">
                        <input type="text" id="at-crontab-input" placeholder="${t('autoTrigger.crontabPlaceholder')}" class="at-input">
                        <button id="at-crontab-validate" class="at-btn at-btn-small">${t('autoTrigger.validate')}</button>
                    </div>
                    <div id="at-crontab-result" class="at-crontab-result"></div>
                </details>

                <!-- Preview -->
                <div class="at-preview">
                    <label>${t('autoTrigger.preview')}</label>
                    <ul id="at-next-runs" class="at-preview-list">
                        <li>${t('autoTrigger.selectTimeHint')}</li>
                    </ul>
                </div>
            </div>
            <div class="modal-footer">
                <button id="at-config-cancel" class="btn-secondary">${t('customGrouping.cancel') || 'Cancel'}</button>
                <button id="at-config-save" class="btn-primary">💾 ${t('autoTrigger.saveBtn')}</button>
            </div>
        </div>
    </div>

    <!-- Test Modal -->
    <div id="at-test-modal" class="modal hidden">
        <div class="modal-content modal-content-small">
            <div class="modal-header">
                <h3>${t('autoTrigger.testBtn')}</h3>
                <button id="at-test-close" class="close-btn">×</button>
            </div>
            <div class="modal-body at-test-body">
                <label>${t('autoTrigger.selectModels')}</label>
                <div id="at-test-models" class="at-model-list">
                    <div class="at-loading">${t('dashboard.connecting')}</div>
                </div>
            </div>
            <div class="modal-footer">
                <button id="at-test-cancel" class="btn-secondary">${t('customGrouping.cancel') || 'Cancel'}</button>
                <button id="at-test-run" class="btn-primary">🚀 ${t('autoTrigger.triggerBtn') || 'Trigger'}</button>
            </div>
        </div>
    </div>

    <!-- History Modal -->
    <div id="at-history-modal" class="modal hidden">
        <div class="modal-content modal-content-medium">
            <div class="modal-header">
                <h3>${t('autoTrigger.historySection')}</h3>
                <button id="at-history-close" class="close-btn">×</button>
            </div>
            <div class="modal-body at-history-body">
                <div id="at-history-list" class="at-history-list">
                    <div class="at-no-data">${t('autoTrigger.noHistory')}</div>
                </div>
            </div>
            <div class="modal-footer">
                <button id="at-history-clear" class="btn-secondary" style="color: var(--vscode-errorForeground);">🗑️ ${t('autoTrigger.clearHistory')}</button>
            </div>
        </div>
    </div>

    <!-- Revoke Confirm Modal -->
    <div id="at-revoke-modal" class="modal hidden">
        <div class="modal-content modal-content-small">
            <div class="modal-header">
                <h3>⚠️ ${t('autoTrigger.revokeConfirmTitle') || 'Revoke Authorization'}</h3>
                <button id="at-revoke-close" class="close-btn">×</button>
            </div>
            <div class="modal-body" style="text-align: center; padding: 20px;">
                <p style="margin-bottom: 20px;">${t('autoTrigger.revokeConfirm')}</p>
            </div>
            <div class="modal-footer">
                <button id="at-revoke-cancel" class="btn-secondary">${t('customGrouping.cancel') || 'Cancel'}</button>
                <button id="at-revoke-confirm" class="btn-primary" style="background: var(--vscode-errorForeground);">🗑️ ${t('autoTrigger.confirmRevoke') || 'Confirm Revoke'}</button>
            </div>
        </div>
    </div>

    <div id="settings-modal" class="modal hidden">
        <div class="modal-content modal-content-wide">
            <div class="modal-header">
                <h3>⚙️ ${t('threshold.settings')}</h3>
                <button id="close-settings-btn" class="close-btn">×</button>
            </div>
            <div class="modal-body">
                <!-- Display Mode and View Mode moved to bottom -->

                <!-- Status bar style selection -->
                <div class="setting-item">
                    <label for="statusbar-format">📊 ${i18n.t('statusBarFormat.title')}</label>
                    <select id="statusbar-format" class="setting-select">
                        <option value="icon">${i18n.t('statusBarFormat.iconDesc')} - ${i18n.t('statusBarFormat.icon')}</option>
                        <option value="dot">${i18n.t('statusBarFormat.dotDesc')} - ${i18n.t('statusBarFormat.dot')}</option>
                        <option value="percent">${i18n.t('statusBarFormat.percentDesc')} - ${i18n.t('statusBarFormat.percent')}</option>
                        <option value="compact">${i18n.t('statusBarFormat.compactDesc')} - ${i18n.t('statusBarFormat.compact')}</option>
                        <option value="namePercent">${i18n.t('statusBarFormat.namePercentDesc')} - ${i18n.t('statusBarFormat.namePercent')}</option>
                        <option value="standard" selected>${i18n.t('statusBarFormat.standardDesc')} - ${i18n.t('statusBarFormat.standard')}</option>
                    </select>
                </div>
                
                <hr class="setting-divider">
                
                <div class="setting-item">
                    <label for="notification-enabled" class="checkbox-label">
                        <input type="checkbox" id="notification-enabled" checked>
                        <span>🔔 ${t('threshold.enableNotification')}</span>
                    </label>
                    <p class="setting-hint">${t('threshold.enableNotificationHint')}</p>
                </div>
                <div class="setting-item">
                    <label for="warning-threshold">🟡 ${t('threshold.warning')}</label>
                    <div class="setting-input-group">
                        <input type="number" id="warning-threshold" min="5" max="80" value="30">
                        <span class="unit">%</span>
                        <span class="range-hint">(5-80)</span>
                    </div>
                    <p class="setting-hint">${t('threshold.warningHint')}</p>
                </div>
                <div class="setting-item">
                    <label for="critical-threshold">🔴 ${t('threshold.critical')}</label>
                    <div class="setting-input-group">
                        <input type="number" id="critical-threshold" min="1" max="50" value="10">
                        <span class="unit">%</span>
                        <span class="range-hint">(1-50)</span>
                    </div>
                    <p class="setting-hint">${t('threshold.criticalHint')}</p>
                </div>

                <hr class="setting-divider">

                <!-- View mode selection -->
                <div class="setting-item">
                    <label for="view-mode-select">🎴 ${t('viewMode.title')}</label>
                    <select id="view-mode-select" class="setting-select">
                        <option value="card">🎴 ${t('viewMode.card')}</option>
                        <option value="list">☰ ${t('viewMode.list')}</option>
                    </select>
                </div>

                <!-- Display mode toggle -->
                <div class="setting-item">
                    <label for="display-mode-select">🖥️ ${t('displayMode.title') || 'Display Mode'}</label>
                    <select id="display-mode-select" class="setting-select">
                        <option value="webview">🎨 ${t('displayMode.webview') || 'Dashboard'}</option>
                        <option value="quickpick">⚡ ${t('displayMode.quickpick') || 'QuickPick'}</option>
                    </select>
                </div>
            </div>
        </div>
    </div>

    <div id="rename-modal" class="modal hidden">
        <div class="modal-content">
            <div class="modal-header">
                <h3>✏️ ${i18n.t('model.renameTitle')}</h3>
                <button id="close-rename-btn" class="close-btn">×</button>
            </div>
            <div class="modal-body">
                <div class="setting-item">
                    <label for="rename-input">${i18n.t('model.newName')}</label>
                    <div class="setting-input-group">
                        <input type="text" id="rename-input" placeholder="${i18n.t('model.namePlaceholder')}" maxlength="30">
                    </div>
                </div>
            </div>
            <div class="modal-footer modal-footer-space-between">
                <button id="reset-name-btn" class="btn-secondary">${i18n.t('model.reset')}</button>
                <button id="save-rename-btn" class="btn-primary">${i18n.t('model.ok')}</button>
            </div>
        </div>
    </div>

    <div id="custom-grouping-modal" class="modal hidden">
        <div class="modal-content modal-content-large">
            <div class="modal-header">
                <h3>⚙️ ${i18n.t('customGrouping.title')}</h3>
                <button id="close-custom-grouping-btn" class="close-btn">×</button>
            </div>
            <div class="modal-body custom-grouping-body">
                <div class="custom-grouping-hint">
                    💡 ${i18n.t('customGrouping.hint')}
                </div>
                <div class="custom-grouping-toolbar">
                    <button id="smart-group-btn" class="btn-accent">
                        <span class="icon">🪄</span>
                        ${i18n.t('customGrouping.smartGroup')}
                    </button>
                    <button id="add-group-btn" class="btn-secondary">
                        <span class="icon">➕</span>
                        ${i18n.t('customGrouping.addGroup')}
                    </button>
                </div>
                <div class="custom-grouping-content">
                    <div class="custom-groups-section">
                        <h4>📦 ${i18n.t('customGrouping.groupList')}</h4>
                        <div id="custom-groups-list" class="custom-groups-list">
                            <!-- Groups will be rendered here -->
                        </div>
                    </div>
                    <div class="ungrouped-section">
                        <h4>🎲 ${i18n.t('customGrouping.ungrouped')}</h4>
                        <p class="ungrouped-hint">${i18n.t('customGrouping.ungroupedHint')}</p>
                        <div id="ungrouped-models-list" class="ungrouped-models-list">
                            <!-- Ungrouped models will be rendered here -->
                        </div>
                    </div>
                </div>
            </div>
            <div class="modal-footer">
                <button id="cancel-custom-grouping-btn" class="btn-secondary">${i18n.t('customGrouping.cancel')}</button>
                <button id="save-custom-grouping-btn" class="btn-primary">💾 ${i18n.t('customGrouping.save')}</button>
            </div>
        </div>
    </div>

    <!-- Announcement List Modal -->
    <div id="announcement-list-modal" class="modal hidden">
        <div class="modal-content modal-content-medium">
            <div class="modal-header">
                <h3>🔔 ${t('announcement.title')}</h3>
                <button id="announcement-list-close" class="close-btn">×</button>
            </div>
            <div class="modal-body announcement-list-body">
                <div class="announcement-toolbar">
                    <button id="announcement-mark-all-read" class="btn-secondary btn-small">${t('announcement.markAllRead')}</button>
                </div>
                <div id="announcement-list" class="announcement-list">
                    <div class="announcement-empty">${t('announcement.empty')}</div>
                </div>
            </div>
        </div>
    </div>

    <!-- Announcement Popup Modal -->
    <div id="announcement-popup-modal" class="modal hidden">
        <div class="modal-content modal-content-medium announcement-popup-content">
            <div class="modal-header notification-header">
                <button id="announcement-popup-back" class="icon-btn back-btn hidden">←</button>
                <div class="announcement-header-title">
                    <span id="announcement-popup-type" class="announcement-type-badge"></span>
                    <h3 id="announcement-popup-title"></h3>
                </div>
                <button id="announcement-popup-close" class="close-btn">×</button>
            </div>
            <div class="modal-body announcement-popup-body">
                <div id="announcement-popup-content" class="announcement-content"></div>
            </div>
            <div class="modal-footer">
                <button id="announcement-popup-later" class="btn-secondary">${t('announcement.later')}</button>
                <button id="announcement-popup-action" class="btn-primary hidden"></button>
                <button id="announcement-popup-got-it" class="btn-primary">${t('announcement.gotIt')}</button>
            </div>
        </div>
    </div>

    <div id="toast" class="toast hidden"></div>

    <footer class="dashboard-footer">
        <div class="footer-content">
            <span class="footer-text">${i18n.t('footer.enjoyingThis')}</span>
            <div class="footer-links">
                <a href="https://github.com/slogvo/antigravity-cockpit-nano" target="_blank" class="footer-link star-link">
                    ⭐ Star
                </a>
                <a href="https://github.com/slogvo/antigravity-cockpit-nano/issues" target="_blank" class="footer-link feedback-link">
                    💬 ${i18n.t('footer.feedback')}
                </a>
                <a href="https://github.com/slogvo/antigravity-cockpit-nano/blob/master/docs/DONATE.md" target="_blank" class="footer-link donate-link">
                    ☕ ${i18n.t('footer.donate') || 'Donate'}
                </a>
            </div>
        </div>
    </footer>

    <script nonce="${nonce}">
        // Inject internationalization text
        window.__i18n = ${translationsJson};
        window.__autoTriggerI18n = ${translationsJson};
    </script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
    <script nonce="${nonce}" src="${autoTriggerScriptUri}"></script>
</body>
</html>`;
    }

    /**
     * Generate random nonce
     */
    private generateNonce(): string {
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let nonce = '';
        for (let i = 0; i < 32; i++) {
            nonce += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return nonce;
    }
}

// Keep backward compatible export alias
export { CockpitHUD as hud };
