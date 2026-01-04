import * as vscode from 'vscode';
import { CockpitConfig } from '../shared/config_service';
import { t } from '../shared/i18n';
import { QuotaSnapshot } from '../shared/types';
import { STATUS_BAR_FORMAT, QUOTA_THRESHOLDS } from '../shared/constants';

export class StatusBarController {
    private statusBarItem: vscode.StatusBarItem;

    constructor(context: vscode.ExtensionContext) {
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100,
        );
        this.statusBarItem.command = 'antigravity.openNano';
        this.statusBarItem.text = t('statusBar.init');
        this.statusBarItem.tooltip = t('statusBar.tooltip');
        this.statusBarItem.show();

        context.subscriptions.push(this.statusBarItem);
    }

    public update(snapshot: QuotaSnapshot, config: CockpitConfig): void {
        // Icon only mode: show 🚀 directly
        if (config.statusBarFormat === STATUS_BAR_FORMAT.ICON) {
            this.statusBarItem.text = '🚀';
            this.statusBarItem.backgroundColor = undefined;
            this.statusBarItem.tooltip = this.generateQuotaTooltip(snapshot, config);
            return;
        }

        const statusTextParts: string[] = [];
        let minPercentage = 100;

        // Check if grouping display is enabled
        if (
            config.groupingEnabled &&
            config.groupingShowInStatusBar &&
            snapshot.groups &&
            snapshot.groups.length > 0
        ) {
            // Get pinned groups
            const monitoredGroups = snapshot.groups.filter(g =>
                config.pinnedGroups.includes(g.groupId),
            );

            if (monitoredGroups.length > 0) {
                // Sort pinned groups by config.groupOrder
                if (config.groupOrder.length > 0) {
                    monitoredGroups.sort((a, b) => {
                        const idxA = config.groupOrder.indexOf(a.groupId);
                        const idxB = config.groupOrder.indexOf(b.groupId);
                        // If both are in sort list, follow list order
                        if (idxA !== -1 && idxB !== -1) {
                            return idxA - idxB;
                        }
                        // If one is in list and one is not, list one comes first
                        if (idxA !== -1) {
                            return -1;
                        }
                        if (idxB !== -1) {
                            return 1;
                        }
                        // Neither in list, keep original order
                        return 0;
                    });
                }

                // Show pinned groups
                monitoredGroups.forEach(g => {
                    const pct = g.remainingPercentage;
                    const text = this.formatStatusBarText(
                        g.groupName,
                        pct,
                        config.statusBarFormat,
                        config,
                    );
                    if (text) {
                        statusTextParts.push(text);
                    }
                    if (pct < minPercentage) {
                        minPercentage = pct;
                    }
                });
            } else {
                // Show lowest quota group
                let lowestPct = 100;
                let lowestGroup = snapshot.groups[0];

                snapshot.groups.forEach(g => {
                    const pct = g.remainingPercentage;
                    if (pct < lowestPct) {
                        lowestPct = pct;
                        lowestGroup = g;
                    }
                });

                if (lowestGroup) {
                    const text = this.formatStatusBarText(
                        lowestGroup.groupName,
                        lowestPct,
                        config.statusBarFormat,
                        config,
                    );
                    if (text) {
                        statusTextParts.push(text);
                    } else {
                        // For dot-only or percent-only mode, show the lowest
                        const icon = this.getStatusIcon(lowestPct, lowestGroup.groupName);
                        statusTextParts.push(
                            config.statusBarFormat === STATUS_BAR_FORMAT.DOT
                                ? icon
                                : `${Math.floor(lowestPct)}%`,
                        );
                    }
                    minPercentage = lowestPct;
                }
            }
        } else {
            // Original logic: show models
            // Get pinned models
            const monitoredModels = snapshot.models.filter(m =>
                config.pinnedModels.some(
                    p =>
                        p.toLowerCase() === m.modelId.toLowerCase() ||
                        p.toLowerCase() === m.label.toLowerCase(),
                ),
            );

            if (monitoredModels.length > 0) {
                // Sort pinned models by config.modelOrder
                if (config.modelOrder.length > 0) {
                    monitoredModels.sort((a, b) => {
                        const idxA = config.modelOrder.indexOf(a.modelId);
                        const idxB = config.modelOrder.indexOf(b.modelId);
                        if (idxA !== -1 && idxB !== -1) {
                            return idxA - idxB;
                        }
                        if (idxA !== -1) {
                            return -1;
                        }
                        if (idxB !== -1) {
                            return 1;
                        }
                        return 0;
                    });
                }

                // Show pinned models
                monitoredModels.forEach(m => {
                    const pct = m.remainingPercentage ?? 0;
                    // Use custom name (if exists)
                    const displayName = config.modelCustomNames?.[m.modelId] || m.label;
                    const text = this.formatStatusBarText(
                        displayName,
                        pct,
                        config.statusBarFormat,
                        config,
                    );
                    if (text) {
                        statusTextParts.push(text);
                    }
                    if (pct < minPercentage) {
                        minPercentage = pct;
                    }
                });
            } else {
                // Show lowest quota model
                let lowestPct = 100;
                let lowestModel = snapshot.models[0];

                snapshot.models.forEach(m => {
                    const pct = m.remainingPercentage ?? 0;
                    if (pct < lowestPct) {
                        lowestPct = pct;
                        lowestModel = m;
                    }
                });

                if (lowestModel) {
                    // Use custom name (if exists)
                    const displayName =
                        config.modelCustomNames?.[lowestModel.modelId] || lowestModel.label;
                    const text = this.formatStatusBarText(
                        displayName,
                        lowestPct,
                        config.statusBarFormat,
                        config,
                    );
                    if (text) {
                        statusTextParts.push(text);
                    } else {
                        // For dot-only or percent-only mode, show the lowest
                        const icon = this.getStatusIcon(lowestPct, lowestModel.label);
                        statusTextParts.push(
                            config.statusBarFormat === STATUS_BAR_FORMAT.DOT
                                ? icon
                                : `${Math.floor(lowestPct)}%`,
                        );
                    }
                    minPercentage = lowestPct;
                }
            }
        }

        // Update status bar
        if (statusTextParts.length > 0) {
            this.statusBarItem.text = statusTextParts.join(' | ');
        } else {
            this.statusBarItem.text = 'Nano';
        }

        // Remove background color, use color dots before each item to distinguish
        this.statusBarItem.backgroundColor = undefined;

        // Update tooltip - Card layout shows quota details
        this.statusBarItem.tooltip = this.generateQuotaTooltip(snapshot, config);
    }

    public setLoading(text?: string): void {
        this.statusBarItem.text = `$(sync~spin) ${text || t('statusBar.connecting')}`;
        this.statusBarItem.backgroundColor = undefined;
    }

    public setOffline(): void {
        this.statusBarItem.text = `$(error) ${t('statusBar.offline')}`;
        this.statusBarItem.backgroundColor = new vscode.ThemeColor(
            'statusBarItem.warningBackground',
        );
    }

    public setError(message: string): void {
        this.statusBarItem.text = `$(error) ${t('statusBar.error')}`;
        this.statusBarItem.tooltip = message;
        this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    }

    public setReady(): void {
        this.statusBarItem.text = t('statusBar.ready');
        this.statusBarItem.backgroundColor = undefined;
    }

    public reset(): void {
        this.statusBarItem.backgroundColor = undefined;
        this.statusBarItem.tooltip = t('statusBar.tooltip');
    }

    private generateQuotaTooltip(
        snapshot: QuotaSnapshot,
        config: CockpitConfig,
    ): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        md.isTrusted = true;
        md.supportHtml = true;

        // Title row (Use tier to show userTier.name, consistent with plan details card)
        const planInfo = snapshot.userInfo?.tier ? ` | ${snapshot.userInfo.tier}` : '';
        md.appendMarkdown(`**🚀 ${t('dashboard.title')}${planInfo}**\n\n`);

        // Sorting logic consistent with dashboard
        const sortedModels = [...snapshot.models];
        if (config.modelOrder && config.modelOrder.length > 0) {
            // Sort by user drag order if custom order exists
            const orderMap = new Map<string, number>();
            config.modelOrder.forEach((id, index) => orderMap.set(id, index));
            sortedModels.sort((a, b) => {
                const idxA = orderMap.has(a.modelId) ? orderMap.get(a.modelId)! : 99999;
                const idxB = orderMap.has(b.modelId) ? orderMap.get(b.modelId)! : 99999;
                return idxA - idxB;
            });
        }
        // Keep original API order if no custom order

        // Build Markdown table
        md.appendMarkdown('| | | |\n');
        md.appendMarkdown('| :--- | :--- | :--- |\n');

        for (const model of sortedModels) {
            const pct = model.remainingPercentage ?? 0;
            const icon = this.getStatusIcon(pct, model.label);
            const bar = this.generateCompactProgressBar(pct);
            const resetTime = model.timeUntilResetFormatted || '-';

            // Use full model name
            const pctDisplay = (Math.floor(pct * 100) / 100).toFixed(2);
            md.appendMarkdown(
                `| ${icon} **${model.label}** | \`${bar}\` | ${pctDisplay}% → ${resetTime} |\n`,
            );
        }

        // Footer hint
        md.appendMarkdown(`\n---\n*${t('statusBar.tooltip')}*`);

        return md;
    }

    private generateCompactProgressBar(percentage: number): string {
        const total = 10;
        const filled = Math.round((percentage / 100) * total);
        const empty = total - filled;
        // Use ■ (U+25A0) and □ (U+25A1) which usually have consistent width in Windows UI fonts
        // Previous █ (Full Block) and ░ (Light Shade) had huge width difference in non-monospace fonts
        return '■'.repeat(filled) + '□'.repeat(empty);
    }

    private getStatusIcon(percentage: number, label: string): string {
        const low = label.toLowerCase();
        let icon = '✦︎'; // Gemini default
        if (low.includes('claude')) icon = '✴️';
        if (low.includes('gpt') || low.includes('chatgpt')) icon = '֎';

        return icon;
    }

    private formatStatusBarText(
        label: string,
        percentage: number,
        format: string,
        config?: CockpitConfig,
    ): string {
        const icon = this.getStatusIcon(percentage, label);
        const pct = `${Math.floor(percentage)}%`;

        switch (format) {
            case STATUS_BAR_FORMAT.ICON:
                return icon;
            case STATUS_BAR_FORMAT.DOT:
                return icon;
            case STATUS_BAR_FORMAT.PERCENT:
                return pct;
            case STATUS_BAR_FORMAT.COMPACT:
                return `${icon} ${pct}`;
            case STATUS_BAR_FORMAT.NAME_PERCENT:
                return `${label}: ${pct}`;
            case STATUS_BAR_FORMAT.STANDARD:
            default:
                return `${icon} ${label}: ${pct}`;
        }
    }
}
