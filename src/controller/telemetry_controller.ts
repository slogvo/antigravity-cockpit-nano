
import * as vscode from 'vscode';
import { ReactorCore } from '../engine/reactor';
import { StatusBarController } from './status_bar_controller';
import { CockpitHUD } from '../view/hud';
import { QuickPickView } from '../view/quickpick_view';
import { configService, CockpitConfig } from '../shared/config_service';
import { logger } from '../shared/log_service';
import { t } from '../shared/i18n';
import { QuotaSnapshot } from '../shared/types';
import { QUOTA_THRESHOLDS, TIMING } from '../shared/constants';

export class TelemetryController {
    private notifiedModels: Set<string> = new Set();
    private lastSuccessfulUpdate: Date | null = null;
    private consecutiveFailures: number = 0;

    constructor(
        private reactor: ReactorCore,
        private statusBar: StatusBarController,
        private hud: CockpitHUD,
        private quickPickView: QuickPickView,
        private onRetry: () => Promise<void>,
    ) {
        this.setupTelemetryHandling();
    }

    public resetNotifications(): void {
        this.notifiedModels.clear();
    }

    private setupTelemetryHandling(): void {
        this.reactor.onTelemetry(async (snapshot: QuotaSnapshot) => {
            let config = configService.getConfig();

            // Record last successful update time
            this.lastSuccessfulUpdate = new Date();
            this.consecutiveFailures = 0; // Reset consecutive failure count

            // Successfully fetched data, reset error state
            this.statusBar.reset();

            // Check quota and send notifications
            this.checkAndNotifyQuota(snapshot, config);

            // Automatically generate group mappings and re-render when grouping is enabled by default
            if (config.groupingEnabled && Object.keys(config.groupMappings).length === 0 && snapshot.models.length > 0) {
                const newMappings = ReactorCore.calculateGroupMappings(snapshot.models);
                await configService.updateGroupMappings(newMappings);
                logger.info(`Auto-grouped on first run: ${Object.keys(newMappings).length} models`);
                this.reactor.reprocess();
                return;
            }

            // Automatically add new groups to pinnedGroups (show all in status bar by default when grouping is first enabled)
            if (config.groupingEnabled && snapshot.groups && snapshot.groups.length > 0) {
                const currentPinnedGroups = config.pinnedGroups;
                const allGroupIds = snapshot.groups.map(g => g.groupId);

                // If pinnedGroups is empty, it means grouping is enabled for the first time, auto-pin all
                if (currentPinnedGroups.length === 0) {
                    logger.info(`Auto-pinning all ${allGroupIds.length} groups to status bar`);
                    await configService.updateConfig('pinnedGroups', allGroupIds);
                    // Re-fetch config
                    config = configService.getConfig();
                }
            }

            // Update Dashboard (using potentially updated config)
            this.hud.refreshView(snapshot, {
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
                lastSuccessfulUpdate: this.lastSuccessfulUpdate,
                statusBarFormat: config.statusBarFormat,
                profileHidden: config.profileHidden,
                viewMode: config.viewMode,
                displayMode: config.displayMode,
                dataMasked: config.dataMasked,
                groupMappings: config.groupMappings,
            });

            // Update QuickPick view data
            this.quickPickView.updateSnapshot(snapshot);

            // Update status bar
            this.statusBar.update(snapshot, config);
        });

        this.reactor.onMalfunction(async (err: Error) => {
            logger.error(`Reactor Malfunction: ${err.message}`);

            // If connection refused (ECONNREFUSED), port might have changed, or signal lost/corrupted, re-scan immediately
            if (err.message.includes('ECONNREFUSED') || 
                err.message.includes('Signal Lost') || 
                err.message.includes('Signal Corrupted')) {
                
                // Increment consecutive failure count
                this.consecutiveFailures++;
                
                // If consecutive failure count is within threshold, try auto-reconnect
                if (this.consecutiveFailures <= TIMING.MAX_CONSECUTIVE_RETRY) {
                    logger.warn(`Connection issue detected (attempt ${this.consecutiveFailures}/${TIMING.MAX_CONSECUTIVE_RETRY}), initiating immediate re-scan protocol...`);
                    // Immediately try to restart system (re-scan port)
                    await this.onRetry();
                    return;
                } else {
                    logger.error(`Connection failed after ${this.consecutiveFailures} consecutive attempts. Stopping auto-retry.`);
                }
            }


            this.statusBar.setError(err.message);

            // Show system popup
            vscode.window.showErrorMessage(
                `${t('notify.bootFailed')}: ${err.message}`,
                t('help.retry'),
                t('help.openLogs'),
            ).then(selection => {
                if (selection === t('help.retry')) {
                    vscode.commands.executeCommand('agCockpit.retry');
                } else if (selection === t('help.openLogs')) {
                    logger.show();
                }
            });
        });
    }

    private checkAndNotifyQuota(snapshot: QuotaSnapshot, config: CockpitConfig): void {
        if (!config.notificationEnabled) {
            return;
        }

        const warningThreshold = config.warningThreshold ?? QUOTA_THRESHOLDS.WARNING_DEFAULT;
        const criticalThreshold = config.criticalThreshold ?? QUOTA_THRESHOLDS.CRITICAL_DEFAULT;

        for (const model of snapshot.models) {
            const pct = model.remainingPercentage ?? 0;
            const notifyKey = `${model.modelId}-${pct <= criticalThreshold ? 'critical' : 'warning'}`;

            // If this state has already been notified, skip
            if (this.notifiedModels.has(notifyKey)) {
                continue;
            }

            // Critical threshold notification (Red)
            if (pct <= criticalThreshold && pct > 0) {
                // Clear previous warning notification record (if any)
                this.notifiedModels.delete(`${model.modelId}-warning`);
                this.notifiedModels.add(notifyKey);

                vscode.window.showWarningMessage(
                    t('threshold.notifyCritical', { model: model.label, percent: pct.toFixed(1) }),
                    t('dashboard.refresh'),
                ).then(selection => {
                    if (selection === t('dashboard.refresh')) {
                        this.reactor.syncTelemetry();
                    }
                });
                logger.info(`Critical threshold notification sent for ${model.label}: ${pct}%`);
            }
            // Warning threshold notification (Yellow)
            else if (pct <= warningThreshold && pct > criticalThreshold) {
                this.notifiedModels.add(notifyKey);

                vscode.window.showInformationMessage(
                    t('threshold.notifyWarning', { model: model.label, percent: pct.toFixed(1) }),
                );
                logger.info(`Warning threshold notification sent for ${model.label}: ${pct}%`);
            }
            // Clear notification record when quota recovers
            else if (pct > warningThreshold) {
                this.notifiedModels.delete(`${model.modelId}-warning`);
                this.notifiedModels.delete(`${model.modelId}-critical`);
            }
        }
    }
}
