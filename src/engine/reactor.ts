/**
 * Antigravity Cockpit - Reactor Core
 * Responsible for communicating with Antigravity API and fetching quota data
 */

import * as https from 'https';
import { 
    QuotaSnapshot, 
    ModelQuotaInfo, 
    PromptCreditsInfo, 
    ServerUserStatusResponse,
    ClientModelConfig,
    QuotaGroup,
    ScanDiagnostics,
} from '../shared/types';
import { logger } from '../shared/log_service';
import { configService } from '../shared/config_service';
import { t } from '../shared/i18n';
import { TIMING, API_ENDPOINTS } from '../shared/constants';
import { captureError } from '../shared/error_reporter';
import { AntigravityError, isServerError } from '../shared/errors';
import { autoTriggerController } from '../auto_trigger/controller';



/**
 * Reactor Core Class
 * Manages communication with backend API
 */
export class ReactorCore {
    private port: number = 0;
    private token: string = '';

    private updateHandler?: (data: QuotaSnapshot) => void;
    private errorHandler?: (error: Error) => void;
    private pulseTimer?: ReturnType<typeof setInterval>;
    public currentInterval: number = 0;
    private lastScanDiagnostics?: ScanDiagnostics;
    
    /** Cached last quota snapshot */
    private lastSnapshot?: QuotaSnapshot;
    /** Cached last raw API response (used for regenerating groups during reprocess) */
    private lastRawResponse?: ServerUserStatusResponse;
    /** Whether quota data has been successfully fetched (used to decide whether to report subsequent errors) */
    private hasSuccessfulSync: boolean = false;

    constructor() {
        logger.debug('ReactorCore Online');
    }

    /**
     * Engage reactor, set connection parameters
     */
    engage(port: number, token: string, diagnostics?: ScanDiagnostics): void {
        this.port = port;
        this.token = token;
        this.lastScanDiagnostics = diagnostics;
        logger.info(`Reactor Engaged: :${port}`);
    }

    /**
     * Get the latest quota snapshot
     */
    getLatestSnapshot(): QuotaSnapshot | undefined {
        return this.lastSnapshot;
    }

    /**
     * Transmit HTTP Info
     */
    private async transmit<T>(endpoint: string, payload: object): Promise<T> {
        return new Promise((resolve, reject) => {
            // Guard against unengaged reactor
            if (!this.port) {
                reject(new AntigravityError('Antigravity Error: System not ready (Reactor not engaged)'));
                return;
            }

            const data = JSON.stringify(payload);
            const opts: https.RequestOptions = {
                hostname: '127.0.0.1',
                port: this.port,
                path: endpoint,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(data),
                    'Connect-Protocol-Version': '1',
                    'X-Codeium-Csrf-Token': this.token,
                },
                rejectUnauthorized: false,
                timeout: TIMING.HTTP_TIMEOUT_MS,
                agent: false, // Bypass proxy, connect directly to localhost
            };

            logger.info(`Transmitting signal to ${endpoint}`, JSON.parse(data));

            const req = https.request(opts, res => {
                let body = '';
                res.on('data', c => (body += c));
                res.on('end', () => {
                    logger.info(`Signal Received (${res.statusCode}):`, {
                        statusCode: res.statusCode,
                        bodyLength: body.length,
                    });
                    // logger.debug('Signal Body:', body); // Uncomment to view full response

                    // Check for empty body (often happens during process startup)
                    if (!body || body.trim().length === 0) {
                        logger.warn('Received empty response from API');
                        reject(new Error('Signal Corrupted: Empty response from server'));
                        return;
                    }

                    try {
                        resolve(JSON.parse(body) as T);
                    } catch (e) {
                        const error = e instanceof Error ? e : new Error(String(e));
                        
                        // Log body preview for diagnosis
                        const bodyPreview = body.length > 200 ? body.substring(0, 200) + '...' : body;
                        logger.error(`JSON parse failed. Response preview: ${bodyPreview}`);
                        
                        reject(new Error(`Signal Corrupted: ${error.message}`));
                    }
                });
            });

            req.on('error', (e) => reject(new Error(`Connection Failed: ${e.message}`)));
            req.on('timeout', () => {
                req.destroy();
                reject(new AntigravityError('Signal Lost: Request timed out'));
            });

            req.write(data);
            req.end();
        });
    }

    /**
     * Register telemetry update callback
     */
    onTelemetry(cb: (data: QuotaSnapshot) => void): void {
        this.updateHandler = cb;
    }

    /**
     * Register malfunction callback
     */
    onMalfunction(cb: (error: Error) => void): void {
        this.errorHandler = cb;
    }

    /**
     * Start periodic synchronization
     */
    startReactor(interval: number): void {
        this.shutdown();
        this.currentInterval = interval;
        logger.info(`Reactor Pulse: ${interval}ms`);

        // Use retry-enabled initial sync on startup, fails automatically retry
        this.initWithRetry();

        // Periodic sync (fail without retry, wait for next cycle)
        this.pulseTimer = setInterval(() => {
            this.syncTelemetry();
        }, interval);
    }

    /**
     * Initial sync with retry
     * Called only on startup, automatically retries on failure, seamless to user
     * @param maxRetries Maximum retry attempts
     * @param currentRetry Current retry attempt
     */
    private async initWithRetry(
        maxRetries: number = 3,
        currentRetry: number = 0,
    ): Promise<void> {
        try {
            await this.syncTelemetryCore();
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            
            if (currentRetry < maxRetries) {
                // Still have retries, use exponential backoff
                const delay = 2000 * (currentRetry + 1);  // 2s, 4s, 6s
                logger.warn(`Init sync failed, retry ${currentRetry + 1}/${maxRetries} in ${delay}ms: ${err.message}`);
                
                await this.delay(delay);
                return this.initWithRetry(maxRetries, currentRetry + 1);
            }
            
            // Exceeded max retries, trigger error callback
            logger.error(`Init sync failed after ${maxRetries} retries: ${err.message}`);
            
            // Do not report server-side errors (e.g., "Not logged in"), as these are not extension bugs
            if (!isServerError(err)) {
                captureError(err, {
                    phase: 'initSync',
                    retryCount: currentRetry,
                    maxRetries,
                    endpoint: API_ENDPOINTS.GET_USER_STATUS,
                    host: '127.0.0.1',
                    port: this.port,
                    timeout_ms: TIMING.HTTP_TIMEOUT_MS,
                    interval_ms: this.currentInterval,
                    has_token: Boolean(this.token),
                    scan: this.lastScanDiagnostics,
                });
            }
            if (this.errorHandler) {
                this.errorHandler(err);
            }
        }
    }

    /**
     * Delay for specified milliseconds
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Shutdown reactor
     */
    shutdown(): void {
        if (this.pulseTimer) {
            clearInterval(this.pulseTimer);
            this.pulseTimer = undefined;
        }
    }

    /**
     * Sync telemetry data (For timer calls, with built-in error handling)
     */
    async syncTelemetry(): Promise<void> {
        try {
            await this.syncTelemetryCore();
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.error(`Telemetry Sync Failed: ${err.message}`);
            
            // Only report if quota has never been successfully fetched; subsequent periodic sync failures are not reported
            // Do not report server-side errors (e.g., "Not logged in"), as these are not extension bugs
            if (!this.hasSuccessfulSync && !isServerError(err)) {
                captureError(err, {
                    phase: 'telemetrySync',
                    endpoint: API_ENDPOINTS.GET_USER_STATUS,
                    host: '127.0.0.1',
                    port: this.port,
                    timeout_ms: TIMING.HTTP_TIMEOUT_MS,
                    interval_ms: this.currentInterval,
                    has_token: Boolean(this.token),
                    scan: this.lastScanDiagnostics,
                });
            }
            if (this.errorHandler) {
                this.errorHandler(err);
            }
        }
    }

    /**
     * Sync telemetry data core logic (Can throw exception, for retry mechanism)
     */
    private async syncTelemetryCore(): Promise<void> {
        const raw = await this.transmit<ServerUserStatusResponse>(
            API_ENDPOINTS.GET_USER_STATUS,
            {
                metadata: {
                    ideName: 'antigravity',
                    extensionName: 'antigravity',
                    locale: 'en',
                },
            },
        );

        this.lastRawResponse = raw; // Cache raw response
        const telemetry = this.decodeSignal(raw);
        this.lastSnapshot = telemetry; // Cache the latest snapshot

        // Print key quota info
        const maxLabelLen = Math.max(...telemetry.models.map(m => m.label.length));
        const quotaSummary = telemetry.models.map(m => {
            const pct = m.remainingPercentage !== undefined ? m.remainingPercentage.toFixed(2) + '%' : 'N/A';
            return `    ${m.label.padEnd(maxLabelLen)} : ${pct}`;
        }).join('\n');
        
        logger.info(`Quota Update:\n${quotaSummary}`);

        // Mark quota data as successfully fetched, subsequent periodic sync failures will not be reported
        this.hasSuccessfulSync = true;

        if (this.updateHandler) {
            this.updateHandler(telemetry);
        }
    }

    /**
     * Reprocess the latest telemetry data
     * Used to update UI when configuration changes without re-requesting API
     */
    reprocess(): void {
        if (this.lastRawResponse && this.updateHandler) {
            logger.info('Reprocessing cached telemetry data with latest config');
            // Re-call decodeSignal to generate groups based on latest config
            const telemetry = this.decodeSignal(this.lastRawResponse);
            this.lastSnapshot = telemetry;
            this.updateHandler(telemetry);
        } else if (this.lastSnapshot && this.updateHandler) {
            // If no raw response, fallback to old behavior
            logger.info('Reprocessing cached snapshot (no raw response)');
            this.updateHandler(this.lastSnapshot);
        } else {
            logger.warn('Cannot reprocess: no cached data available');
        }
    }

    /**
     * Check if cache exists
     */
    get hasCache(): boolean {
        return !!this.lastSnapshot;
    }

    /**
     * Decode server response
     */
    private decodeSignal(data: ServerUserStatusResponse): QuotaSnapshot {
        // Verify response data structure
        if (!data || !data.userStatus) {
            // If server returns error message, pass through to user, not an extension bug
            if (data && typeof data.message === 'string') {
                throw new AntigravityError(t('error.serverError', { message: data.message }));
            }

            throw new Error(t('error.invalidResponse', { 
                details: data ? JSON.stringify(data).substring(0, 100) : 'empty response', 
            }));
        }
        
        const status = data.userStatus;
        const plan = status.planStatus?.planInfo;
        const credits = status.planStatus?.availablePromptCredits;

        let promptCredits: PromptCreditsInfo | undefined;

        if (plan && credits !== undefined) {
            const monthlyLimit = Number(plan.monthlyPromptCredits);
            const availableVal = Number(credits);

            if (monthlyLimit > 0) {
                promptCredits = {
                    available: availableVal,
                    monthly: monthlyLimit,
                    usedPercentage: ((monthlyLimit - availableVal) / monthlyLimit) * 100,
                    remainingPercentage: (availableVal / monthlyLimit) * 100,
                };
            }
        }

        const userInfo: import('../shared/types').UserInfo = {
            name: status.name || 'Unknown User',
            email: status.email || 'N/A',
            planName: plan?.planName || 'N/A',
            tier: status.userTier?.name || plan?.teamsTier || 'N/A',
            browserEnabled: plan?.browserEnabled === true,
            knowledgeBaseEnabled: plan?.knowledgeBaseEnabled === true,
            canBuyMoreCredits: plan?.canBuyMoreCredits === true,
            hasAutocompleteFastMode: plan?.hasAutocompleteFastMode === true,
            monthlyPromptCredits: plan?.monthlyPromptCredits || 0,
            monthlyFlowCredits: plan?.monthlyFlowCredits || 0,
            availablePromptCredits: status.planStatus?.availablePromptCredits || 0,
            availableFlowCredits: status.planStatus?.availableFlowCredits || 0,
            cascadeWebSearchEnabled: plan?.cascadeWebSearchEnabled === true,
            canGenerateCommitMessages: plan?.canGenerateCommitMessages === true,
            allowMcpServers: plan?.defaultTeamConfig?.allowMcpServers === true,
            maxNumChatInputTokens: String(plan?.maxNumChatInputTokens ?? 'N/A'),
            tierDescription: status.userTier?.description || 'N/A',
            upgradeUri: status.userTier?.upgradeSubscriptionUri || '',
            upgradeText: status.userTier?.upgradeSubscriptionText || '',
            
            // New fields population
            teamsTier: plan?.teamsTier || 'N/A',
            hasTabToJump: plan?.hasTabToJump === true,
            allowStickyPremiumModels: plan?.allowStickyPremiumModels === true,
            allowPremiumCommandModels: plan?.allowPremiumCommandModels === true,
            maxNumPremiumChatMessages: String(plan?.maxNumPremiumChatMessages ?? 'N/A'),
            maxCustomChatInstructionCharacters: String(plan?.maxCustomChatInstructionCharacters ?? 'N/A'),
            maxNumPinnedContextItems: String(plan?.maxNumPinnedContextItems ?? 'N/A'),
            maxLocalIndexSize: String(plan?.maxLocalIndexSize ?? 'N/A'),
            monthlyFlexCreditPurchaseAmount: Number(plan?.monthlyFlexCreditPurchaseAmount) || 0,
            canCustomizeAppIcon: plan?.canCustomizeAppIcon === true,
            cascadeCanAutoRunCommands: plan?.cascadeCanAutoRunCommands === true,
            canAllowCascadeInBackground: plan?.canAllowCascadeInBackground === true,
            allowAutoRunCommands: plan?.defaultTeamConfig?.allowAutoRunCommands === true,
            allowBrowserExperimentalFeatures: plan?.defaultTeamConfig?.allowBrowserExperimentalFeatures === true,
            acceptedLatestTermsOfService: status.acceptedLatestTermsOfService === true,
            userTierId: status.userTier?.id || 'N/A',
        };

        const configs: ClientModelConfig[] = status.cascadeModelConfigData?.clientModelConfigs || [];
        const modelSorts = status.cascadeModelConfigData?.clientModelSorts || [];

        // Build sort order map (from clientModelSorts)
        const sortOrderMap = new Map<string, number>();
        if (modelSorts.length > 0) {
            // Use first sort config (usually "Recommended")
            const primarySort = modelSorts[0];
            let index = 0;
            for (const group of primarySort.groups) {
                for (const label of group.modelLabels) {
                    sortOrderMap.set(label, index++);
                }
            }
        }

        const models: ModelQuotaInfo[] = configs
            .filter((m): m is ClientModelConfig & { quotaInfo: NonNullable<ClientModelConfig['quotaInfo']> } => 
                !!m.quotaInfo,
            )
            .map((m) => {
                const reset = new Date(m.quotaInfo.resetTime);
                const now = new Date();
                const delta = reset.getTime() - now.getTime();

                return {
                    label: m.label,
                    modelId: m.modelOrAlias?.model || 'unknown',
                    remainingFraction: m.quotaInfo.remainingFraction,
                    remainingPercentage: m.quotaInfo.remainingFraction !== undefined 
                        ? m.quotaInfo.remainingFraction * 100 
                        : undefined,
                    isExhausted: m.quotaInfo.remainingFraction === 0,
                    resetTime: reset,
                    resetTimeDisplay: this.formatIso(reset),
                    timeUntilReset: delta,
                    timeUntilResetFormatted: this.formatDelta(delta),
                    // Model capability fields
                    supportsImages: m.supportsImages,
                    isRecommended: m.isRecommended,
                    tagTitle: m.tagTitle,
                    supportedMimeTypes: m.supportedMimeTypes,
                };
            });

        // Sort: Prefer clientModelSorts, otherwise sort by label alphabetically
        models.sort((a, b) => {
            const indexA = sortOrderMap.get(a.label);
            const indexB = sortOrderMap.get(b.label);

            // Both in sort list, use sort list order
            if (indexA !== undefined && indexB !== undefined) {
                return indexA - indexB;
            }
            // Only a is in sort list, a comes first
            if (indexA !== undefined) {
                return -1;
            }
            // Only b is in sort list, b comes first
            if (indexB !== undefined) {
                return 1;
            }
            // Neither in sort list, sort by label alphabetically
            return a.label.localeCompare(b.label);
        });

        // Grouping logic: Use stored groupMappings for grouping
        const config = configService.getConfig();
        let groups: QuotaGroup[] | undefined;
        
        if (config.groupingEnabled) {
            const groupMap = new Map<string, ModelQuotaInfo[]>();
            const savedMappings = config.groupMappings;
            const hasSavedMappings = Object.keys(savedMappings).length > 0;
            
            if (hasSavedMappings) {
                // Use stored group mappings
                for (const model of models) {
                    const groupId = savedMappings[model.modelId];
                    if (groupId) {
                        if (!groupMap.has(groupId)) {
                            groupMap.set(groupId, []);
                        }
                        groupMap.get(groupId)!.push(model);
                    } else {
                        // New model, standalone group (use its own modelId as groupId)
                        groupMap.set(model.modelId, [model]);
                    }
                }
                
                // Auto-grouping check: Check if quotas of models in each group are consistent
                // If inconsistent, only remove inconsistent models from group (preserve user custom settings)
                const modelsToRemove: string[] = [];
                
                for (const [groupId, groupModels] of groupMap) {
                    if (groupModels.length <= 1) {
                        continue; // Single model group does not need check
                    }
                    
                    // Check if quota signature (remainingFraction + resetTime) of all models in group matches
                    // Use majority rule: find most common quota signature, remove non-conforming models
                    const signatureCount = new Map<string, { count: number; fraction: number; resetTime: number }>();
                    
                    for (const model of groupModels) {
                        const fraction = model.remainingFraction ?? 0;
                        const resetTime = model.resetTime.getTime();
                        const signature = `${fraction.toFixed(6)}_${resetTime}`;
                        
                        if (!signatureCount.has(signature)) {
                            signatureCount.set(signature, { count: 0, fraction, resetTime });
                        }
                        signatureCount.get(signature)!.count++;
                    }
                    
                    // Find most common signature (majority)
                    let majoritySignature = '';
                    let maxCount = 0;
                    for (const [sig, data] of signatureCount) {
                        if (data.count > maxCount) {
                            maxCount = data.count;
                            majoritySignature = sig;
                        }
                    }
                    
                    // Mark models not matching majority to be removed from group
                    for (const model of groupModels) {
                        const fraction = model.remainingFraction ?? 0;
                        const resetTime = model.resetTime.getTime();
                        const signature = `${fraction.toFixed(6)}_${resetTime}`;
                        
                        if (signature !== majoritySignature) {
                            logger.info(`[GroupCheck] Removing model "${model.label}" from group "${groupId}" due to quota mismatch`);
                            modelsToRemove.push(model.modelId);
                        }
                    }
                }
                
                // Update groupMappings, remove inconsistent models
                if (modelsToRemove.length > 0) {
                    const newMappings = { ...savedMappings };
                    for (const modelId of modelsToRemove) {
                        delete newMappings[modelId];
                    }
                    
                    configService.updateGroupMappings(newMappings).catch(err => {
                        logger.warn(`Failed to save updated groupMappings: ${err}`);
                    });
                    
                    // Remove these models from groupMap and create independent groups for them
                    for (const modelId of modelsToRemove) {
                        // Remove from original group
                        for (const [gid, gModels] of groupMap) {
                            const idx = gModels.findIndex(m => m.modelId === modelId);
                            if (idx !== -1) {
                                const [removedModel] = gModels.splice(idx, 1);
                                // Create independent group
                                groupMap.set(modelId, [removedModel]);
                                break;
                            }
                        }
                    }
                    
                    // Clean up empty groups
                    for (const [gid, gModels] of groupMap) {
                        if (gModels.length === 0) {
                            groupMap.delete(gid);
                        }
                    }
                    
                    logger.info(`[GroupCheck] Removed ${modelsToRemove.length} models from groups due to quota mismatch`);
                }
            } else {
                // No stored mappings, each model in its own group
                for (const model of models) {
                    groupMap.set(model.modelId, [model]);
                }
            }
            
            // Convert to QuotaGroup array
            groups = [];
            let groupIndex = 1;
            
            for (const [groupId, groupModels] of groupMap) {
                // Anchor Consensus: Find custom names of models in group
                let groupName = '';
                const customNames = config.groupingCustomNames;
                
                // Count votes for each custom name
                const nameVotes = new Map<string, number>();
                for (const model of groupModels) {
                    const customName = customNames[model.modelId];
                    if (customName) {
                        nameVotes.set(customName, (nameVotes.get(customName) || 0) + 1);
                    }
                }
                
                // Choose name with most votes
                if (nameVotes.size > 0) {
                    let maxVotes = 0;
                    for (const [name, votes] of nameVotes) {
                        if (votes > maxVotes) {
                            maxVotes = votes;
                            groupName = name;
                        }
                    }
                }
                
                // If no custom name, use default name
                if (!groupName) {
                    if (groupModels.length === 1) {
                        groupName = groupModels[0].label;
                    } else {
                        groupName = `Group ${groupIndex}`;
                    }
                }
                
                const firstModel = groupModels[0];
                // Calculate average/min quota of all models in group
                const minPercentage = Math.min(...groupModels.map(m => m.remainingPercentage ?? 0));
                
                groups.push({
                    groupId,
                    groupName,
                    models: groupModels,
                    remainingPercentage: minPercentage,
                    resetTime: firstModel.resetTime,
                    resetTimeDisplay: firstModel.resetTimeDisplay,
                    timeUntilResetFormatted: firstModel.timeUntilResetFormatted,
                    isExhausted: groupModels.some(m => m.isExhausted),
                });
                
                groupIndex++;
            }
            
            // Sort by min index of models in original list, maintaining relative order
            const modelIndexMap = new Map<string, number>();
            models.forEach((m, i) => modelIndexMap.set(m.modelId, i));

            groups.sort((a, b) => {
                // Get min index of models in group A
                const minIndexA = Math.min(...a.models.map(m => modelIndexMap.get(m.modelId) ?? 99999));
                // Get min index of models in group B
                const minIndexB = Math.min(...b.models.map(m => modelIndexMap.get(m.modelId) ?? 99999));
                return minIndexA - minIndexB;
            });
            
            logger.debug(`Grouping enabled: ${groups.length} groups created (saved mappings: ${hasSavedMappings})`);
        }

        // Pass model constants in quota to AutoTriggerController for filtering triggerable models
        const quotaModelConstants = models.map(m => m.modelId);
        autoTriggerController.setQuotaModels(quotaModelConstants);

        return {
            timestamp: new Date(),
            promptCredits,
            userInfo,
            models,
            groups,
            isConnected: true,
        };
    }

    /**
     * Format date (Automatic Internationalization)
     */
    private formatIso(d: Date): string {
        const dateStr = d.toLocaleDateString(undefined, {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        });
        const timeStr = d.toLocaleTimeString(undefined, {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        });
        return `${dateStr} ${timeStr}`;
    }

    /**
     * Format time delta
     * - < 60 mins: Show Xm
     * - < 24 hours: Show Xh Ym
     * - >= 24 hours: Show Xd Yh Zm
     */
    private formatDelta(ms: number): string {
        if (ms <= 0) {
            return t('dashboard.online');
        }
        const totalMinutes = Math.ceil(ms / 60000);
        
        // Less than 60 minutes: Show minutes only
        if (totalMinutes < 60) {
            return `${totalMinutes}m`;
        }
        
        const totalHours = Math.floor(totalMinutes / 60);
        const remainingMinutes = totalMinutes % 60;
        
        // Less than 24 hours: Show hours and minutes
        if (totalHours < 24) {
            return `${totalHours}h ${remainingMinutes}m`;
        }
        
        // >= 24 hours: Show days, hours, minutes
        const days = Math.floor(totalHours / 24);
        const remainingHours = totalHours % 24;
        return `${days}d ${remainingHours}h ${remainingMinutes}m`;
    }

    /**
     * Create offline snapshot
     */
    static createOfflineSnapshot(errorMessage?: string): QuotaSnapshot {
        return {
            timestamp: new Date(),
            models: [],
            isConnected: false,
            errorMessage,
        };
    }

    /**
     * Calculate group mappings based on current quota info
     * Return modelId -> groupId mapping
     */
    static calculateGroupMappings(models: ModelQuotaInfo[]): Record<string, string> {
        // 1. Try to group by quota status (legacy logic)
        const statsMap = new Map<string, string[]>();
        for (const model of models) {
            const fingerprint = `${model.remainingFraction?.toFixed(6)}_${model.resetTime.getTime()}`;
            if (!statsMap.has(fingerprint)) {
                statsMap.set(fingerprint, []);
            }
            statsMap.get(fingerprint)!.push(model.modelId);
        }

        // 2. Check if all models fall into same large group
        // This usually happens when all models are full (or status completely identical), grouping by status is meaningless
        if (statsMap.size === 1 && models.length > 1) {
            logger.info('Auto-grouping detected degenerate state (all models identical), falling back to ID-based fallback grouping.');
            return this.groupBasedOnSeries(models);
        }
        
        // 3. Normal case: Use quota fingerprint to generate mappings
        const mappings: Record<string, string> = {};
        for (const [, modelIds] of statsMap) {
            const stableGroupId = modelIds.sort().join('_');
            for (const modelId of modelIds) {
                mappings[modelId] = stableGroupId;
            }
        }
        
        return mappings;
    }

    /**
     * Hardcoded fallback grouping logic based on Model ID
     */
    private static groupBasedOnSeries(models: ModelQuotaInfo[]): Record<string, string> {
        const seriesMap = new Map<string, string[]>();

        // Define hardcoded grouping rules
        const GROUPS = {
            GEMINI: ['MODEL_PLACEHOLDER_M8', 'MODEL_PLACEHOLDER_M7'],
            GEMINI_FLASH: ['MODEL_PLACEHOLDER_M18'],
            CLAUDE_GPT: [
                'MODEL_CLAUDE_4_5_SONNET',
                'MODEL_CLAUDE_4_5_SONNET_THINKING',
                'MODEL_PLACEHOLDER_M12', // Claude Opus 4.5 Thinking
                'MODEL_OPENAI_GPT_OSS_120B_MEDIUM',
            ],
        };

        for (const model of models) {
            const id = model.modelId;
            let groupName = 'Other';

            if (GROUPS.GEMINI.includes(id)) {
                groupName = 'Gemini';
            } else if (GROUPS.GEMINI_FLASH.includes(id)) {
                groupName = 'Gemini Flash';
            } else if (GROUPS.CLAUDE_GPT.includes(id)) {
                groupName = 'Claude';
            }

            if (!seriesMap.has(groupName)) {
                seriesMap.set(groupName, []);
            }
            seriesMap.get(groupName)!.push(id);
        }

        const mappings: Record<string, string> = {};
        for (const [, modelIds] of seriesMap) {
            const stableGroupId = modelIds.sort().join('_');
            for (const modelId of modelIds) {
                mappings[modelId] = stableGroupId;
            }
        }
        return mappings;
    }
}

// 保持向后兼容
export type quota_snapshot = QuotaSnapshot;
export type model_quota_info = ModelQuotaInfo;
