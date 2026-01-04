/**
 * Antigravity Cockpit - QuickPick View
 * Use VSCode native QuickPick API to display quota information
 * Used in environments where Webview is unavailable (e.g., ArchLinux + VSCode OSS)
 */

import * as vscode from 'vscode';
import { QuotaSnapshot } from '../shared/types';
import { configService } from '../shared/config_service';
import { logger } from '../shared/log_service';
import { t } from '../shared/i18n';
import { DISPLAY_MODE } from '../shared/constants';
import { ReactorCore } from '../engine/reactor';

/** Button ID */
const BUTTON_ID = {
    RENAME: 'rename',
    RESET: 'reset',
};

/** QuickPick Item Extension Interface */
interface QuotaQuickPickItem extends vscode.QuickPickItem {
    /** Model ID (Used for pinning operations, non-grouping mode) */
    modelId?: string;
    /** Group ID (Grouping mode) */
    groupId?: string;
    /** List of model IDs in the group */
    groupModelIds?: string[];
    /** Action Type */
    action?: 'openActions' | 'refresh' | 'logs' | 'settings' | 'switchToWebview' | 'toggleGrouping' | 'autoGroup' | 'back';
    /** Original label (Used to display original name when renaming) */
    originalLabel?: string;
}

/** Custom Button Interface */
interface IdentifiableButton extends vscode.QuickInputButton {
    id: string;
}

/** Title Bar Button ID */
const TITLE_BUTTON_ID = {
    REFRESH: 'refresh',
    TOGGLE_GROUPING: 'toggleGrouping',
    AUTO_GROUP: 'autoGroup',
    LOGS: 'logs',
    SETTINGS: 'settings',
    SWITCH_WEBVIEW: 'switchWebview',
} as const;

/**
 * QuickPick View Manager
 */
export class QuickPickView {
    private lastSnapshot?: QuotaSnapshot;
    private refreshCallback?: () => void;
    private lastRefreshTime: number = 0;

    constructor() {
        logger.debug('QuickPickView initialized');
    }

    /**
     * Set refresh callback
     */
    onRefresh(callback: () => void): void {
        this.refreshCallback = callback;
    }

    /**
     * Update data snapshot
     */
    updateSnapshot(snapshot: QuotaSnapshot): void {
        this.lastSnapshot = snapshot;
    }

    /**
     * Show main menu
     */
    async show(): Promise<void> {
        if (!this.lastSnapshot) {
            vscode.window.showWarningMessage(t('dashboard.connecting'));
            return;
        }

        const config = configService.getConfig();
        
        if (config.groupingEnabled && this.lastSnapshot.groups) {
            await this.showGroupedView();
        } else {
            await this.showModelView();
        }
    }

    /**
     * Show model list in non-grouping mode
     */
    private async showModelView(): Promise<void> {
        const pick = vscode.window.createQuickPick<QuotaQuickPickItem>();
        pick.title = t('dashboard.title');
        pick.placeholder = t('quickpick.placeholder');
        pick.matchOnDescription = false;
        pick.matchOnDetail = false;
        pick.canSelectMany = false;

        pick.items = this.buildModelItems();

        // Title Bar Buttons
        const config = configService.getConfig();
        pick.buttons = this.buildTitleButtons(config.groupingEnabled);

        let currentActiveItem: QuotaQuickPickItem | undefined;

        pick.onDidChangeActive(items => {
            currentActiveItem = items[0] as QuotaQuickPickItem;
        });

        pick.onDidAccept(async () => {
            if (!currentActiveItem) {return;}

            // Handle model pinning toggle
            if (currentActiveItem.modelId) {
                const targetModelId = currentActiveItem.modelId;
                await configService.togglePinnedModel(targetModelId);
                
                // Local refresh
                const config = configService.getConfig();
                const isPinnedNow = config.pinnedModels.some(
                    p => p.toLowerCase() === targetModelId.toLowerCase(),
                );
                
                const currentItems = [...pick.items] as QuotaQuickPickItem[];
                const targetIndex = currentItems.findIndex(item => item.modelId === targetModelId);
                
                if (targetIndex >= 0) {
                    const oldItem = currentItems[targetIndex];
                    const newPinIcon = isPinnedNow ? '$(pinned)' : '$(circle-outline)';
                    const newLabel = oldItem.label.replace(/^\$\((pinned|circle-outline)\)/, newPinIcon);
                    
                    const updatedItem: QuotaQuickPickItem = { ...oldItem, label: newLabel };
                    currentItems[targetIndex] = updatedItem;
                    
                    pick.items = currentItems;
                    pick.activeItems = [updatedItem];
                }
            }
        });

        // Handle button click (Rename/Reset)
        pick.onDidTriggerItemButton(async (event) => {
            const item = event.item as QuotaQuickPickItem;
            const button = event.button as IdentifiableButton;
            
            if (!item.modelId) {return;}

            if (button.id === BUTTON_ID.RENAME) {
                await this.handleRename(pick, item.modelId, item.originalLabel || '', false);
            } else if (button.id === BUTTON_ID.RESET) {
                await this.handleReset(pick, item.modelId, item.originalLabel || '', false);
            }
        });

        // Handle title bar button click
        pick.onDidTriggerButton(async (button) => {
            const btn = button as IdentifiableButton;
            pick.hide();
            await this.handleTitleButtonClick(btn.id);
        });

        pick.onDidHide(() => pick.dispose());
        pick.show();
    }

    /**
     * Show group list in grouping mode
     */
    private async showGroupedView(): Promise<void> {
        const pick = vscode.window.createQuickPick<QuotaQuickPickItem>();
        pick.title = t('dashboard.title') + ' - ' + t('grouping.title');
        pick.placeholder = t('quickpick.placeholderGrouped');
        pick.matchOnDescription = false;
        pick.matchOnDetail = false;
        pick.canSelectMany = false;

        pick.items = this.buildGroupItems();

        // Title Bar Buttons
        const config = configService.getConfig();
        pick.buttons = this.buildTitleButtons(config.groupingEnabled);

        let currentActiveItem: QuotaQuickPickItem | undefined;

        pick.onDidChangeActive(items => {
            currentActiveItem = items[0] as QuotaQuickPickItem;
        });

        pick.onDidAccept(async () => {
            if (!currentActiveItem) {return;}

            // Handle group pinning toggle
            if (currentActiveItem.groupId) {
                const targetGroupId = currentActiveItem.groupId;
                await configService.togglePinnedGroup(targetGroupId);
                
                // Local refresh
                const config = configService.getConfig();
                const isPinnedNow = config.pinnedGroups.includes(targetGroupId);
                
                const currentItems = [...pick.items] as QuotaQuickPickItem[];
                const targetIndex = currentItems.findIndex(item => item.groupId === targetGroupId);
                
                if (targetIndex >= 0) {
                    const oldItem = currentItems[targetIndex];
                    const newPinIcon = isPinnedNow ? '$(pinned)' : '$(circle-outline)';
                    const newLabel = oldItem.label.replace(/^\$\((pinned|circle-outline)\)/, newPinIcon);
                    
                    const updatedItem: QuotaQuickPickItem = { ...oldItem, label: newLabel };
                    currentItems[targetIndex] = updatedItem;
                    
                    pick.items = currentItems;
                    pick.activeItems = [updatedItem];
                }
            }
        });

        // Handle button click (Rename group/Reset group name)
        pick.onDidTriggerItemButton(async (event) => {
            const item = event.item as QuotaQuickPickItem;
            const button = event.button as IdentifiableButton;
            
            if (!item.groupId || !item.groupModelIds) {return;}

            if (button.id === BUTTON_ID.RENAME) {
                await this.handleGroupRename(pick, item.groupModelIds, item.originalLabel || '');
            } else if (button.id === BUTTON_ID.RESET) {
                await this.handleGroupReset(pick, item.groupModelIds, item.originalLabel || '');
            }
        });

        // Handle title bar button click
        pick.onDidTriggerButton(async (button) => {
            const btn = button as IdentifiableButton;
            pick.hide();
            await this.handleTitleButtonClick(btn.id);
        });

        pick.onDidHide(() => pick.dispose());
        pick.show();
    }

    /**
     * Build menu items for non-grouping mode
     */
    private buildModelItems(): QuotaQuickPickItem[] {
        const items: QuotaQuickPickItem[] = [];
        const snapshot = this.lastSnapshot;
        const config = configService.getConfig();

        if (snapshot && snapshot.models.length > 0) {
            const pinnedModels = config.pinnedModels;
            const customNames = config.modelCustomNames || {};
            
            const renameButton: IdentifiableButton = {
                iconPath: new vscode.ThemeIcon('edit'),
                tooltip: t('model.rename'),
                id: BUTTON_ID.RENAME,
            };
            const resetButton: IdentifiableButton = {
                iconPath: new vscode.ThemeIcon('discard'),
                tooltip: t('model.reset'),
                id: BUTTON_ID.RESET,
            };

            for (const model of snapshot.models) {
                const pct = model.remainingPercentage ?? 0;
                const bar = this.drawProgressBar(pct);
                const isPinned = pinnedModels.some(
                    p => p.toLowerCase() === model.modelId.toLowerCase(),
                );

                const pinIcon = isPinned ? '$(pinned)' : '$(circle-outline)';
                const displayName = customNames[model.modelId] || model.label;
                const hasCustomName = !!customNames[model.modelId];

                // Calculate specific reset time
                const resetTimeStr = model.resetTime 
                    ? new Date(model.resetTime).toLocaleString('zh-CN', { 
                        year: 'numeric', 
                        month: '2-digit', 
                        day: '2-digit', 
                        hour: '2-digit', 
                        minute: '2-digit',
                        hour12: false, 
                    })
                    : '-';
                const countdown = model.timeUntilResetFormatted || '-';

                items.push({
                    label: `${pinIcon} ${displayName}`,
                    description: '',
                    detail: `    ${bar} ${pct.toFixed(1)}% | ${t('dashboard.resetTime')}: ${countdown} (${resetTimeStr})`,
                    modelId: model.modelId,
                    originalLabel: model.label,
                    buttons: hasCustomName ? [renameButton, resetButton] : [renameButton],
                });
            }
        } else {
            items.push({
                label: `$(info) ${t('quickpick.noData')}`,
                description: t('dashboard.connecting'),
            });
        }

        return items;
    }

    /**
     * Build menu items for grouping mode
     */
    private buildGroupItems(): QuotaQuickPickItem[] {
        const items: QuotaQuickPickItem[] = [];
        const snapshot = this.lastSnapshot;
        const config = configService.getConfig();

        if (snapshot && snapshot.groups && snapshot.groups.length > 0) {
            const pinnedGroups = config.pinnedGroups;
            const customNames = config.groupingCustomNames || {};
            
            const renameButton: IdentifiableButton = {
                iconPath: new vscode.ThemeIcon('edit'),
                tooltip: t('grouping.rename'),
                id: BUTTON_ID.RENAME,
            };
            const resetButton: IdentifiableButton = {
                iconPath: new vscode.ThemeIcon('discard'),
                tooltip: t('model.reset'),
                id: BUTTON_ID.RESET,
            };

            for (const group of snapshot.groups) {
                const pct = group.remainingPercentage ?? 0;
                const bar = this.drawProgressBar(pct);
                const isPinned = pinnedGroups.includes(group.groupId);

                const pinIcon = isPinned ? '$(pinned)' : '$(circle-outline)';
                
                // Use custom name (via Anchor Consensus Mechanism)
                const firstModelId = group.models[0]?.modelId;
                const displayName = (firstModelId && customNames[firstModelId]) || group.groupName;
                const hasCustomName = !!(firstModelId && customNames[firstModelId]);
                
                // List of model names in group
                const modelNames = group.models.map(m => 
                    config.modelCustomNames?.[m.modelId] || m.label,
                ).join(', ');

                // Calculate specific reset time (use reset time of the first model in group)
                const firstModel = group.models[0];
                const resetTimeStr = firstModel?.resetTime 
                    ? new Date(firstModel.resetTime).toLocaleString('zh-CN', { 
                        year: 'numeric', 
                        month: '2-digit', 
                        day: '2-digit', 
                        hour: '2-digit', 
                        minute: '2-digit',
                        hour12: false, 
                    })
                    : '-';
                const countdown = group.timeUntilResetFormatted || firstModel?.timeUntilResetFormatted || '-';

                items.push({
                    label: `${pinIcon} ${displayName}`,
                    description: `(${modelNames})`,
                    detail: `    ${bar} ${pct.toFixed(1)}% | ${t('dashboard.resetTime')}: ${countdown} (${resetTimeStr})`,
                    groupId: group.groupId,
                    groupModelIds: group.models.map(m => m.modelId),
                    originalLabel: group.groupName,
                    buttons: hasCustomName ? [renameButton, resetButton] : [renameButton],
                });
            }
        } else {
            items.push({
                label: `$(info) ${t('quickpick.noData')}`,
                description: t('dashboard.connecting'),
            });
        }

        return items;
    }

    /**
     * Handle model rename
     */
    private async handleRename(
        pick: vscode.QuickPick<QuotaQuickPickItem>,
        modelId: string,
        originalLabel: string,
        _isGroup: boolean,
    ): Promise<void> {
        const config = configService.getConfig();
        const currentName = config.modelCustomNames?.[modelId] || originalLabel;
        
        pick.hide();
        
        const newName = await vscode.window.showInputBox({
            prompt: t('model.renamePrompt'),
            value: currentName,
            placeHolder: originalLabel,
        });
        
        if (newName !== undefined) {
            await configService.updateModelName(modelId, newName);
            
            const displayName = newName.trim() || originalLabel;
            vscode.window.showInformationMessage(t('model.renamed', { name: displayName }));
        }
        
        await this.show();
    }

    /**
     * Handle model name reset
     */
    private async handleReset(
        pick: vscode.QuickPick<QuotaQuickPickItem>,
        modelId: string,
        originalLabel: string,
        _isGroup: boolean,
    ): Promise<void> {
        await configService.updateModelName(modelId, '');
        vscode.window.showInformationMessage(t('model.renamed', { name: originalLabel }));
        
        // Local refresh
        pick.items = this.buildModelItems();
    }

    /**
     * Handle group rename
     */
    private async handleGroupRename(
        pick: vscode.QuickPick<QuotaQuickPickItem>,
        modelIds: string[],
        originalLabel: string,
    ): Promise<void> {
        const config = configService.getConfig();
        const firstModelId = modelIds[0];
        const currentName = config.groupingCustomNames?.[firstModelId] || originalLabel;
        
        pick.hide();
        
        const newName = await vscode.window.showInputBox({
            prompt: t('grouping.renamePrompt'),
            value: currentName,
            placeHolder: originalLabel,
        });
        
        if (newName !== undefined && newName.trim()) {
            await configService.updateGroupName(modelIds, newName.trim());
            vscode.window.showInformationMessage(t('model.renamed', { name: newName }));
        }
        
        await this.show();
    }

    /**
     * Handle group name reset
     */
    private async handleGroupReset(
        pick: vscode.QuickPick<QuotaQuickPickItem>,
        modelIds: string[],
        originalLabel: string,
    ): Promise<void> {
        // Clear custom group names for all models
        const config = configService.getConfig();
        const customNames = { ...config.groupingCustomNames };
        
        for (const modelId of modelIds) {
            delete customNames[modelId];
        }
        
        await configService.updateConfig('groupingCustomNames', customNames);
        vscode.window.showInformationMessage(t('model.renamed', { name: originalLabel }));
        
        // Refresh view
        pick.items = this.buildGroupItems();
    }

    /**
     * Draw progress bar
     */
    private drawProgressBar(percentage: number): string {
        const total = 10;
        const filled = Math.round((percentage / 100) * total);
        const empty = total - filled;
        return '▓'.repeat(filled) + '░'.repeat(empty);
    }

    /**
     * Handle action
     */
    private async handleAction(
        action: 'openActions' | 'refresh' | 'logs' | 'settings' | 'switchToWebview' | 'toggleGrouping' | 'autoGroup' | 'back',
    ): Promise<void> {
        switch (action) {
            case 'back':
                await this.show();
                break;
                
            case 'refresh': {
                const config = configService.getConfig();
                const cooldownSeconds = config.refreshInterval || 120;
                const now = Date.now();
                const elapsed = Math.floor((now - this.lastRefreshTime) / 1000);
                const remaining = cooldownSeconds - elapsed;
                
                if (remaining > 0) {
                    vscode.window.showWarningMessage(
                        t('quickpick.refreshCooldown', { seconds: remaining }) || `Please wait ${remaining} seconds before refreshing`,
                    );
                    await this.show();
                    return;
                }
                
                this.lastRefreshTime = now;
                if (this.refreshCallback) {
                    this.refreshCallback();
                }
                vscode.window.showInformationMessage(t('notify.refreshing'));
                // Return to main menu after refresh
                setTimeout(() => this.show(), 500);
                break;
            }
                
            case 'logs':
                vscode.commands.executeCommand('agCockpit.showLogs');
                break;
                
            case 'settings':
                vscode.commands.executeCommand('workbench.action.openSettings', 'agCockpit');
                break;
                
            case 'switchToWebview':
                await configService.updateConfig('displayMode', DISPLAY_MODE.WEBVIEW);
                vscode.window.showInformationMessage(t('quickpick.switchedToWebview'));
                vscode.commands.executeCommand('agCockpit.open');
                break;
                
            case 'toggleGrouping': {
                const newValue = await configService.toggleGroupingEnabled();
                const msg = newValue ? t('grouping.enable') : t('grouping.disable');
                vscode.window.showInformationMessage(msg);
                // Trigger data refresh to update group info
                if (this.refreshCallback) {
                    this.refreshCallback();
                }
                setTimeout(() => this.show(), 500);
                break;
            }
                
            case 'autoGroup':
                if (this.lastSnapshot && this.lastSnapshot.models.length > 0) {
                    const newMappings = ReactorCore.calculateGroupMappings(this.lastSnapshot.models);
                    await configService.updateGroupMappings(newMappings);
                    vscode.window.showInformationMessage(
                        `${t('grouping.autoGroup')}: ${Object.keys(newMappings).length} ${t('grouping.models')}`,
                    );
                    // Need to trigger data refresh to update groups
                    if (this.refreshCallback) {
                        this.refreshCallback();
                    }
                    setTimeout(() => this.show(), 500);
                }
                break;
        }
    }

    /**
     * Build title bar buttons
     */
    private buildTitleButtons(isGroupingEnabled: boolean): IdentifiableButton[] {
        const buttons: IdentifiableButton[] = [];

        // Refresh Button
        buttons.push({
            iconPath: new vscode.ThemeIcon('sync'),
            tooltip: t('dashboard.refresh'),
            id: TITLE_BUTTON_ID.REFRESH,
        });

        // Toggle Grouping Button
        buttons.push({
            iconPath: new vscode.ThemeIcon(isGroupingEnabled ? 'list-flat' : 'list-tree'),
            tooltip: isGroupingEnabled ? t('grouping.disable') : t('grouping.enable'),
            id: TITLE_BUTTON_ID.TOGGLE_GROUPING,
        });

        // Logs Button
        buttons.push({
            iconPath: new vscode.ThemeIcon('output'),
            tooltip: t('quickpick.openLogs'),
            id: TITLE_BUTTON_ID.LOGS,
        });

        // Settings Button
        buttons.push({
            iconPath: new vscode.ThemeIcon('gear'),
            tooltip: t('quickpick.openSettings'),
            id: TITLE_BUTTON_ID.SETTINGS,
        });

        // Switch to Webview Button
        buttons.push({
            iconPath: new vscode.ThemeIcon('browser'),
            tooltip: t('quickpick.switchToWebview'),
            id: TITLE_BUTTON_ID.SWITCH_WEBVIEW,
        });

        // Auto Group Button (Only show in grouping mode, placed at the end)
        if (isGroupingEnabled) {
            buttons.push({
                iconPath: new vscode.ThemeIcon('sparkle'),
                tooltip: t('grouping.autoGroup'),
                id: TITLE_BUTTON_ID.AUTO_GROUP,
            });
        }

        return buttons;
    }

    /**
     * Handle title bar button click
     */
    private async handleTitleButtonClick(buttonId: string): Promise<void> {
        switch (buttonId) {
            case TITLE_BUTTON_ID.REFRESH:
                await this.handleAction('refresh');
                break;
            case TITLE_BUTTON_ID.TOGGLE_GROUPING:
                await this.handleAction('toggleGrouping');
                break;
            case TITLE_BUTTON_ID.AUTO_GROUP:
                await this.handleAction('autoGroup');
                break;
            case TITLE_BUTTON_ID.LOGS:
                await this.handleAction('logs');
                break;
            case TITLE_BUTTON_ID.SETTINGS:
                await this.handleAction('settings');
                break;
            case TITLE_BUTTON_ID.SWITCH_WEBVIEW:
                await this.handleAction('switchToWebview');
                break;
        }
    }
}
