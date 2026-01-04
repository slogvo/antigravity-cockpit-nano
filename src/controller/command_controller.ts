
import * as vscode from 'vscode';
import { CockpitHUD } from '../view/hud';
import { QuickPickView } from '../view/quickpick_view';
import { ReactorCore } from '../engine/reactor';
import { configService } from '../shared/config_service';
import { logger } from '../shared/log_service';
import { t } from '../shared/i18n';
import { DISPLAY_MODE, FEEDBACK_URL } from '../shared/constants';
import { announcementService } from '../announcement';

export class CommandController {
    constructor(
        private context: vscode.ExtensionContext,
        private hud: CockpitHUD,
        private quickPickView: QuickPickView,
        private reactor: ReactorCore,
        private onRetry: () => Promise<void>,
    ) {
        this.registerCommands();
    }

    private registerCommands(): void {
        // Open Dashboard
        this.context.subscriptions.push(
            vscode.commands.registerCommand('agCockpit.open', async (options?: { tab?: string }) => {
                const config = configService.getConfig();
                if (config.displayMode === DISPLAY_MODE.QUICKPICK) {
                    this.quickPickView.show();
                } else {
                    const success = await this.hud.revealHud(options?.tab);
                    if (!success) {
                        // Webview creation failed, guide user to switch to QuickPick mode
                        const selection = await vscode.window.showWarningMessage(
                            t('webview.failedPrompt'),
                            t('webview.switchToQuickPick'),
                            t('webview.cancel'),
                        );
                        if (selection === t('webview.switchToQuickPick')) {
                            await configService.updateConfig('displayMode', DISPLAY_MODE.QUICKPICK);
                            vscode.window.showInformationMessage(t('webview.switchedToQuickPick'));
                            this.reactor.reprocess();
                            this.quickPickView.show();
                        }
                    }
                }
            }),
        );

        // Manual Refresh
        this.context.subscriptions.push(
            vscode.commands.registerCommand('agCockpit.refresh', () => {
                this.reactor.syncTelemetry();
                vscode.window.showInformationMessage(t('notify.refreshing'));
            }),
        );

        // Show Logs
        this.context.subscriptions.push(
            vscode.commands.registerCommand('agCockpit.showLogs', () => {
                logger.show();
            }),
        );

        // Retry Connection
        this.context.subscriptions.push(
            vscode.commands.registerCommand('agCockpit.retry', async () => {
                await this.onRetry();
            }),
        );

        // Open Feedback Page
        this.context.subscriptions.push(
            vscode.commands.registerCommand('agCockpit.openFeedback', () => {
                vscode.env.openExternal(vscode.Uri.parse(FEEDBACK_URL));
            }),
        );

        // Set Warning Threshold
        this.context.subscriptions.push(
            vscode.commands.registerCommand('agCockpit.setWarningThreshold', async () => {
                const config = configService.getConfig();
                const input = await vscode.window.showInputBox({
                    prompt: t('threshold.setWarning', { value: config.warningThreshold }),
                    placeHolder: t('threshold.inputWarning'),
                    value: String(config.warningThreshold),
                    validateInput: (value) => {
                        const num = parseInt(value, 10);
                        if (isNaN(num) || num < 5 || num > 80) {
                            return t('threshold.invalid', { min: 5, max: 80 });
                        }
                        if (num <= config.criticalThreshold) {
                            return `Warning threshold must be greater than critical threshold (${config.criticalThreshold}%)`;
                        }
                        return null;
                    },
                });
                if (input) {
                    const newValue = parseInt(input, 10);
                    await configService.updateConfig('warningThreshold', newValue);
                    vscode.window.showInformationMessage(t('threshold.updated', { value: newValue }));
                    this.reactor.reprocess();
                }
            }),
        );

        // Set Critical Threshold
        this.context.subscriptions.push(
            vscode.commands.registerCommand('agCockpit.setCriticalThreshold', async () => {
                const config = configService.getConfig();
                const input = await vscode.window.showInputBox({
                    prompt: t('threshold.setCritical', { value: config.criticalThreshold }),
                    placeHolder: t('threshold.inputCritical'),
                    value: String(config.criticalThreshold),
                    validateInput: (value) => {
                        const num = parseInt(value, 10);
                        if (isNaN(num) || num < 1 || num > 50) {
                            return t('threshold.invalid', { min: 1, max: 50 });
                        }
                        if (num >= config.warningThreshold) {
                            return `Critical threshold must be less than warning threshold (${config.warningThreshold}%)`;
                        }
                        return null;
                    },
                });
                if (input) {
                    const newValue = parseInt(input, 10);
                    await configService.updateConfig('criticalThreshold', newValue);
                    vscode.window.showInformationMessage(t('threshold.updated', { value: newValue }));
                    this.reactor.reprocess();
                }
            }),
        );

        // Force Refresh Announcements
        this.context.subscriptions.push(
            vscode.commands.registerCommand('agCockpit.refreshAnnouncements', async () => {
                try {
                    const state = await announcementService.forceRefresh();
                    vscode.window.showInformationMessage(
                        t('announcement.refreshed').replace('{count}', String(state.announcements.length)),
                    );
                    // Update Announcement State in HUD
                    this.hud.sendMessage({
                        type: 'announcementState',
                        data: state,
                    });
                } catch (error) {
                    const err = error instanceof Error ? error : new Error(String(error));
                    vscode.window.showErrorMessage(`Failed to refresh announcements: ${err.message}`);
                }
            }),
        );
    }
}
