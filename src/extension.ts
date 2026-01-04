/**
 * Antigravity Cockpit - Extension Entry Point
 * Main entry point for the VS Code extension
 */

import * as vscode from 'vscode';
import { ProcessHunter } from './engine/hunter';
import { ReactorCore } from './engine/reactor';
import { logger } from './shared/log_service';
import { configService, CockpitConfig } from './shared/config_service';
import { t } from './shared/i18n';
import { CockpitHUD } from './view/hud';
import { QuickPickView } from './view/quickpick_view';
import { initErrorReporter, captureError, flushEvents } from './shared/error_reporter';

// Controllers
import { StatusBarController } from './controller/status_bar_controller';
import { CommandController } from './controller/command_controller';
import { MessageController } from './controller/message_controller';
import { TelemetryController } from './controller/telemetry_controller';
import { autoTriggerController } from './auto_trigger/controller';
import { announcementService } from './announcement';

// Global Module Instances
let hunter: ProcessHunter;
let reactor: ReactorCore;
let hud: CockpitHUD;
let quickPickView: QuickPickView;

// Controllers
let statusBar: StatusBarController;
let _commandController: CommandController;
let _messageController: MessageController;
let _telemetryController: TelemetryController;

let systemOnline = false;

// Auto-retry counter
let autoRetryCount = 0;
const MAX_AUTO_RETRY = 3;
const AUTO_RETRY_DELAY_MS = 5000;

/**
 * Extension Activation
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
    // Initialize Logger
    logger.init();

    // Get Extension Version
    const packageJson = await import('../package.json');
    const version = packageJson.version || 'unknown';

    // Initialize Error Reporter (after logger, before other modules)
    initErrorReporter(version);

    logger.info(`Antigravity Cockpit v${version} - Systems Online`);

    // Initialize Core Modules
    hunter = new ProcessHunter();
    reactor = new ReactorCore();
    hud = new CockpitHUD(context.extensionUri, context);
    quickPickView = new QuickPickView();

    // Set QuickPick Refresh Callback
    quickPickView.onRefresh(() => {
        reactor.syncTelemetry();
    });

    // Initialize Status Bar Controller
    statusBar = new StatusBarController(context);

    // Define retry/start callback
    const onRetry = async () => {
        systemOnline = false;
        await bootSystems();
    };

    // Initialize other controllers
    _telemetryController = new TelemetryController(reactor, statusBar, hud, quickPickView, onRetry);
    _messageController = new MessageController(context, hud, reactor, onRetry);
    _commandController = new CommandController(context, hud, quickPickView, reactor, onRetry);

    // Initialize Auto Trigger Controller
    autoTriggerController.initialize(context);

    // Initialize Announcement Service
    announcementService.initialize(context);

    // Listen for configuration changes
    context.subscriptions.push(
        configService.onConfigChange(handleConfigChange),
    );

    // Boot Systems
    await bootSystems();

    logger.info('Antigravity Cockpit Fully Operational');
}

/**
 * Handle Configuration Changes
 */
async function handleConfigChange(config: CockpitConfig): Promise<void> {
    logger.debug('Configuration changed', config);

    // Only restart Reactor if refresh interval changes
    const newInterval = configService.getRefreshIntervalMs();

    // Ignore if Reactor is already running and interval is unchanged
    if (systemOnline && reactor.currentInterval !== newInterval) {
        logger.info(`Refresh interval changed from ${reactor.currentInterval}ms to ${newInterval}ms. Restarting Reactor.`);
        reactor.startReactor(newInterval);
    }

    // For any config change, immediately reprocess recent data to update UI (e.g., status bar format)
    // This ensures data in lastSnapshot is re-rendered with new config
    reactor.reprocess();
}

/**
 * Boot Systems
 */
async function bootSystems(): Promise<void> {
    if (systemOnline) {
        return;
    }

    statusBar.setLoading();

    try {
        const info = await hunter.scanEnvironment(3);

        if (info) {
            reactor.engage(info.connectPort, info.csrfToken, hunter.getLastDiagnostics());
            reactor.startReactor(configService.getRefreshIntervalMs());
            systemOnline = true;
            autoRetryCount = 0; // Reset counter
            statusBar.setReady();
            logger.info('System boot successful');
        } else {
            // Auto-retry mechanism
            if (autoRetryCount < MAX_AUTO_RETRY) {
                autoRetryCount++;
                logger.info(`Auto-retry ${autoRetryCount}/${MAX_AUTO_RETRY} in ${AUTO_RETRY_DELAY_MS / 1000}s...`);
                statusBar.setLoading(`(${autoRetryCount}/${MAX_AUTO_RETRY})`);

                setTimeout(() => {
                    bootSystems();
                }, AUTO_RETRY_DELAY_MS);
            } else {
                autoRetryCount = 0; // Reset counter
                handleOfflineState();
            }
        }
    } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e));
        logger.error('Boot Error', error);
        captureError(error, {
            phase: 'boot',
            retryCount: autoRetryCount,
            maxRetries: MAX_AUTO_RETRY,
            retryDelayMs: AUTO_RETRY_DELAY_MS,
            refreshIntervalMs: configService.getRefreshIntervalMs(),
            scan: hunter.getLastDiagnostics(),
        });

        // Auto-retry mechanism (retry on error too)
        if (autoRetryCount < MAX_AUTO_RETRY) {
            autoRetryCount++;
            logger.info(`Auto-retry ${autoRetryCount}/${MAX_AUTO_RETRY} after error in ${AUTO_RETRY_DELAY_MS / 1000}s...`);
            statusBar.setLoading(`(${autoRetryCount}/${MAX_AUTO_RETRY})`);

            setTimeout(() => {
                bootSystems();
            }, AUTO_RETRY_DELAY_MS);
        } else {
            autoRetryCount = 0; // Reset counter
            statusBar.setError(error.message);

            // Show system error message
            vscode.window.showErrorMessage(
                `${t('notify.bootFailed')}: ${error.message}`,
                t('help.retry'),
                t('help.openLogs'),
            ).then(selection => {
                if (selection === t('help.retry')) {
                    vscode.commands.executeCommand('agCockpit.retry');
                } else if (selection === t('help.openLogs')) {
                    logger.show();
                }
            });
        }
    }
}

/**
 * Handle Offline State
 */
function handleOfflineState(): void {
    statusBar.setOffline();

    // Show message with action buttons
    vscode.window.showErrorMessage(
        t('notify.offline'),
        t('help.retry'),
        t('help.openLogs'),
    ).then(selection => {
        if (selection === t('help.retry')) {
            vscode.commands.executeCommand('agCockpit.retry');
        } else if (selection === t('help.openLogs')) {
            logger.show();
        }
    });

    // Update Dashboard to show offline state
    hud.refreshView(ReactorCore.createOfflineSnapshot(t('notify.offline')), {
        showPromptCredits: false,
        pinnedModels: [],
        modelOrder: [],
        groupingEnabled: false,
        groupCustomNames: {},
        groupingShowInStatusBar: false,
        pinnedGroups: [],
        groupOrder: [],
        refreshInterval: 120,
        notificationEnabled: false,
    });
}

/**
 * Deactivate Extension
 */
export async function deactivate(): Promise<void> {
    logger.info('Antigravity Cockpit: Shutting down...');

    // Flush pending error events
    await flushEvents();

    reactor?.shutdown();
    hud?.dispose();
    logger.dispose();
}
