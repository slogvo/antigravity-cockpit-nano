/**
 * Antigravity Nano - Extension Entry Point
 * Minimal entry point for the Lite version
 */

import * as vscode from 'vscode';
import { ProcessHunter } from './engine/hunter';
import { ReactorCore } from './engine/reactor';
import { logger } from './shared/log_service';
import { StatusBarController } from './controller/status_bar_controller';
import { configService } from './shared/config_service';
import { NanoPanel } from './nano/nano_panel';
import { QuotaSnapshot } from './shared/types';

// Global Instances
let hunter: ProcessHunter;
let reactor: ReactorCore;
let statusBar: StatusBarController;
let hasWarnedLowQuota = false;

function checkLowQuota(snapshot: QuotaSnapshot) {
    // Find lowest quota model
    let minQuota = 100;
    for (const m of snapshot.models) {
        if (m.remainingPercentage !== undefined && m.remainingPercentage < minQuota) {
            minQuota = m.remainingPercentage;
        }
    }

    // Reset warning flag if quota recovers
    if (minQuota > 25) {
        hasWarnedLowQuota = false;
    }

    // Trigger warning if below 20% and not yet warned
    if (minQuota < 20 && !hasWarnedLowQuota) {
        hasWarnedLowQuota = true;
        vscode.window.showWarningMessage(`Antigravity Quota Low: ${minQuota.toFixed(1)}% remaining.`);
    }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    // Initialize Logger
    logger.init();
    logger.info('Antigravity Nano: Systems Online');

    // Initialize Core Modules
    hunter = new ProcessHunter();
    reactor = new ReactorCore();
    statusBar = new StatusBarController(context);

    // Register Nano Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity.openNano', () => {
            const version = context.extension.packageJSON.version || '1.0.0';
            NanoPanel.createOrShow(context.extensionUri, version);
            
            // If we have cached data, update immediately for instant display
            if (reactor.lastSnapshot) {
                NanoPanel.currentPanel?.update(reactor.lastSnapshot);
            }
            
            // Force fetch fresh data in background to ensure freshness
            logger.info('Panel opened - triggering background refresh');
            reactor.syncTelemetry();
        }),
        vscode.commands.registerCommand('antigravity.refreshNano', () => {
            logger.info('User triggered manual refresh from Nano');
            reactor.syncTelemetry();
        }),
        vscode.commands.registerCommand('antigravity.recordUsage', (modelId: string) => {
            logger.info(`Recording usage for model: ${modelId}`);
            reactor.recordModelUsage(modelId);
        })
    );

    // Hook up Data Stream
    reactor.onTelemetry((snapshot) => {
        // Update Status Bar
        statusBar.update(snapshot, configService.getConfig());

        // Update Panel if open
        if (NanoPanel.currentPanel) {
            NanoPanel.currentPanel.update(snapshot);
        }

        // Low Quota Warning (Nano Phase 5)
        checkLowQuota(snapshot);
    });

    // Boot Systems
    await bootSystems();
}

/**
 * Boot Systems
 */
async function bootSystems(): Promise<void> {
    statusBar.setLoading();
    try {
        const info = await hunter.scanEnvironment(3);
        if (info) {
            reactor.engage(info.connectPort, info.csrfToken, hunter.getLastDiagnostics());
            reactor.startReactor(configService.getRefreshIntervalMs());
            statusBar.setReady();
            logger.info('System boot successful');
        } else {
            console.log('Boot failed: No connection info found.');
             // In Nano, maybe we just show offline status
             statusBar.setOffline();
        }
    }
    catch (e) {
        logger.error('Boot Error', e instanceof Error ? e : new Error(String(e)));
        statusBar.setError('Boot Error');
    }
}

export async function deactivate(): Promise<void> {
    reactor?.shutdown();
    logger.dispose();
}
