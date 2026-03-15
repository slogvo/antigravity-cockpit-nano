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
import { credentialStorage } from './auth/credential_storage';
import { oauthService } from './auth/oauth_service';

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

    // Initialize Credential Storage (for authorized mode)
    credentialStorage.initialize(context);

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
        }),
        vscode.commands.registerCommand('antigravity.switchAccount', async () => {
            // Proactively scan logs before showing the menu to catch latest logins
            await credentialStorage.scanLocalIdeAccounts();
            
            const status = await credentialStorage.getAuthorizationStatus();
            const discovered = await credentialStorage.getDiscoveredEmails();
            
            const items: (vscode.QuickPickItem & { account?: { email: string; isActive: boolean; isInvalid?: boolean }; isDiscovered?: boolean })[] = [];

            // 1. Existing authorized accounts
            if (status.accounts && status.accounts.length > 0) {
                items.push(...status.accounts.map(acc => ({
                    label: acc.email,
                    description: acc.isActive ? '(Active)' : '',
                    detail: acc.isInvalid ? 'Invalid / Expired' : undefined,
                    account: acc,
                })));
            }

            // 2. Discovered accounts (not yet in Nano)
            const existingEmails = new Set((status.accounts || []).map(a => a.email));
            const newDiscovered = discovered.filter(email => !existingEmails.has(email));

            if (newDiscovered.length > 0) {
                items.push({ label: 'Detected accounts from IDE (Sign in required)', kind: vscode.QuickPickItemKind.Separator });
                items.push(...newDiscovered.map(email => ({
                    label: email,
                    description: '$(mail) Not signed in',
                    detail: 'Click to sign in with this account',
                    isDiscovered: true,
                })));
            }
            // 3. Always show "Sign in with new account" at the bottom
            if (items.length > 0) {
                items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
            }
            items.push({
                label: '$(add) Sign in with a new account',
                description: 'Add another Google account',
            });

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select active account',
            });

            if (selected) {
                if (selected.label.includes('Sign in with a new account') || selected.isDiscovered) {
                    await vscode.commands.executeCommand('antigravity.login');
                } else if (selected.account) {
                    await credentialStorage.setActiveAccount(selected.label, true);
                    vscode.window.showInformationMessage(`Switched to account: ${selected.label}`);
                    reactor.syncTelemetry();
                }
            }
        }),
        vscode.commands.registerCommand('antigravity.syncAccounts', async () => {
            logger.info('User triggered manual account sync');
            await credentialStorage.importFromSharedFolder();
            vscode.window.showInformationMessage('Accounts synced from shared folder.');
            reactor.syncTelemetry();
        }),
        vscode.commands.registerCommand('antigravity.login', async () => {
            logger.info('User triggered manual login');
            const success = await oauthService.startAuthorization();
            if (success) {
                reactor.syncTelemetry();
            }
        }),
        vscode.commands.registerCommand('antigravity.logout', async () => {
            const active = await credentialStorage.getActiveAccount();
            if (!active) {
                vscode.window.showInformationMessage('No active account to logout.');
                return;
            }

            const confirm = await vscode.window.showWarningMessage(
                `Are you sure you want to logout from ${active}?`,
                { modal: true },
                'Logout',
            );

            if (confirm === 'Logout') {
                await credentialStorage.removeAccount(active); 
                vscode.window.showInformationMessage(`Logged out from ${active}.`);
                reactor.syncTelemetry();
            }
        }),
        vscode.commands.registerCommand('antigravity.debugAccount', async () => {
            const active = await credentialStorage.getActiveAccount();
            const isManual = await credentialStorage.isManualAccount();
            const status = await credentialStorage.getAuthorizationStatus();
            
            const info = [
                `Active Account: ${active || 'None'}`,
                `Selection Mode: ${isManual ? 'Manual (User selected)' : 'Auto (Synced from Cockpit)'}`,
                `Is Authorized: ${status.isAuthorized}`,
                `Total Known Accounts: ${status.accounts?.length || 0}`,
            ].join('\n');

            vscode.window.showInformationMessage('Antigravity Debug Info', { modal: true, detail: info });
        }),
        vscode.commands.registerCommand('antigravity.showStatusBarMenu', async () => {
            const active = await credentialStorage.getActiveAccount();
            const status = await credentialStorage.getAuthorizationStatus();
            const discovered = await credentialStorage.getDiscoveredEmails();
            
            const items: (vscode.QuickPickItem & { action?: string, email?: string })[] = [
                {
                    label: '$(dashboard) Open Nano Monitor',
                    description: 'View full quota details',
                    action: 'open',
                },
                { label: '', kind: vscode.QuickPickItemKind.Separator },
            ];

            if (active) {
                items.push({
                    label: `$(account) Active: ${active}`,
                    description: status.isAuthorized ? '(Authorized)' : '(Offline)',
                    detail: 'Click to switch or logout',
                    action: 'switch',
                });
            } else {
                items.push({ 
                    label: '$(key) Sign In with Google', 
                    description: 'Enable premium model tracking',
                    action: 'login',
                });

                // Add discovered accounts for quick login
                if (discovered.length > 0) {
                    items.push({ label: 'Detected accounts from IDE', kind: vscode.QuickPickItemKind.Separator });
                    for (const email of discovered) {
                        items.push({
                            label: `$(mail) Log in as ${email}`,
                            action: 'login',
                            email,
                        });
                    }
                }
            }

            items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
            items.push({ label: '$(sync) Refresh Quota', action: 'refresh' });
            items.push({ label: '$(cloud-download) Sync from Cockpit', action: 'sync' });

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Antigravity Quick Menu',
            });

            if (!selected) {
                return;
            }

            switch (selected.action) {
                case 'open': vscode.commands.executeCommand('antigravity.openNano'); break;
                case 'login': vscode.commands.executeCommand('antigravity.login'); break;
                case 'switch': vscode.commands.executeCommand('antigravity.switchAccount'); break;
                case 'refresh': vscode.commands.executeCommand('antigravity.refreshNano'); break;
                case 'sync': vscode.commands.executeCommand('antigravity.syncAccounts'); break;
            }
        }),
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

    // Cập nhật giao diện ngay lập tức khi thay đổi cấu hình (như Pin model)
    configService.onConfigChange((config) => {
        const snapshot = reactor.getLatestSnapshot();
        if (snapshot) {
            statusBar.update(snapshot, config);
            if (NanoPanel.currentPanel) {
                NanoPanel.currentPanel.update(snapshot);
            }
        }
    });

    // Listen to configuration changes and immediately update UI without calling API
    configService.onConfigChange((config) => {
        const snapshot = reactor.getLatestSnapshot();
        if (snapshot) {
            statusBar.update(snapshot, config);
            if (NanoPanel.currentPanel) {
                // Update Panel with newest config
                NanoPanel.currentPanel.update(snapshot);
            }
        }
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
    credentialStorage.dispose();
    reactor?.shutdown();
    logger.dispose();
}
