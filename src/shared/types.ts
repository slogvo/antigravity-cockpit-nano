/**
 * Antigravity Cockpit - Type Definitions
 * Complete type system to avoid using any
 */

// ============ Quota Types ============

/** Prompt Credits Info */
export interface PromptCreditsInfo {
    /** Available credits */
    available: number;
    /** Monthly quota */
    monthly: number;
    /** Used percentage */
    usedPercentage: number;
    /** Remaining percentage */
    remainingPercentage: number;
}

/** Model Quota Info */
export interface ModelQuotaInfo {
    /** Display label */
    label: string;
    /** Model ID */
    modelId: string;
    /** Remaining fraction (0-1) */
    remainingFraction?: number;
    /** Remaining percentage (0-100) */
    remainingPercentage?: number;
    /** Is exhausted */
    isExhausted: boolean;
    /** Reset time */
    resetTime: Date;
    /** Time until reset in ms */
    timeUntilReset: number;
    /** Formatted reset countdown */
    timeUntilResetFormatted: string;
    /** Formatted reset time display */
    resetTimeDisplay: string;
    /** Whether supports image input */
    supportsImages?: boolean;
    /** Whether is recommended */
    isRecommended?: boolean;
    /** Tag title (e.g., "New") */
    tagTitle?: string;
    /** Supported MIME types map */
    supportedMimeTypes?: Record<string, boolean>;
}

/** Quota Group - Collection of models sharing the same quota */
export interface QuotaGroup {
    /** Group unique ID (generated based on remainingFraction + resetTime) */
    groupId: string;
    /** Group name (user defined or auto generated) */
    groupName: string;
    /** Properties of models in the group */
    models: ModelQuotaInfo[];
    /** Shared remaining percentage */
    remainingPercentage: number;
    /** Shared reset time */
    resetTime: Date;
    /** Formatted reset time display */
    resetTimeDisplay: string;
    /** Formatted reset countdown */
    timeUntilResetFormatted: string;
    /** Is exhausted */
    isExhausted: boolean;
}

/** Quota Snapshot */
export interface QuotaSnapshot {
    /** Timestamp */
    timestamp: Date;
    /** Prompt Credits */
    promptCredits?: PromptCreditsInfo;
    /** User Info */
    userInfo?: UserInfo;
    /** Model List */
    models: ModelQuotaInfo[];
    /** Quota Groups (generated when grouping is enabled) */
    groups?: QuotaGroup[];
    /** Connection Status */
    isConnected: boolean;
    /** Error Message */
    errorMessage?: string;
}

/** Quota Health Level */
export enum QuotaLevel {
    /** Normal (> 50%) */
    Normal = 'normal',
    /** Warning (20-50%) */
    Warning = 'warning',
    /** Critical (< 20%) */
    Critical = 'critical',
    /** Depleted (0%) */
    Depleted = 'depleted',
}

// ============ API Response Types ============

/** Model or Alias */
export interface ModelOrAlias {
    model: string;
}

/** Quota Info */
export interface QuotaInfo {
    remainingFraction?: number;
    resetTime: string;
}

/** Client Model Config */
export interface ClientModelConfig {
    label: string;
    modelOrAlias?: ModelOrAlias;
    quotaInfo?: QuotaInfo;
    supportsImages?: boolean;
    isRecommended?: boolean;
    allowedTiers?: string[];
    /** Tag title (e.g., "New") */
    tagTitle?: string;
    /** Supported MIME types map */
    supportedMimeTypes?: Record<string, boolean>;
}

/** Team Config */
export interface DefaultTeamConfig {
    allowMcpServers?: boolean;
    allowAutoRunCommands?: boolean;
    allowBrowserExperimentalFeatures?: boolean;
    [key: string]: boolean | string | number | undefined;
}

/** Plan Info */
export interface PlanInfo {
    teamsTier: string;
    planName: string;
    monthlyPromptCredits: number;
    monthlyFlowCredits: number;
    
    // Feature Flags
    browserEnabled?: boolean;
    knowledgeBaseEnabled?: boolean;
    canBuyMoreCredits?: boolean;
    hasAutocompleteFastMode?: boolean;
    cascadeWebSearchEnabled?: boolean;
    canGenerateCommitMessages?: boolean;
    hasTabToJump?: boolean;
    allowStickyPremiumModels?: boolean;
    allowPremiumCommandModels?: boolean;
    canCustomizeAppIcon?: boolean;
    cascadeCanAutoRunCommands?: boolean;
    canAllowCascadeInBackground?: boolean;
    
    // Limit Config
    maxNumChatInputTokens?: string | number;
    maxNumPremiumChatMessages?: string | number;
    maxCustomChatInstructionCharacters?: string | number;
    maxNumPinnedContextItems?: string | number;
    maxLocalIndexSize?: string | number;
    monthlyFlexCreditPurchaseAmount?: number;
    
    // Team Config
    defaultTeamConfig?: DefaultTeamConfig;
    
    /** Extended Fields - Support other properties returned by API */
    [key: string]: string | number | boolean | object | undefined;
}

/** Plan Status */
export interface PlanStatus {
    planInfo: PlanInfo;
    availablePromptCredits: number;
    availableFlowCredits: number;
}

/** Model Sort Group */
export interface ModelSortGroup {
    modelLabels: string[];
}

/** Client Model Sort */
export interface ClientModelSort {
    name: string;
    groups: ModelSortGroup[];
}

/** Cascade Model Config Data */
export interface CascadeModelConfigData {
    clientModelConfigs: ClientModelConfig[];
    clientModelSorts?: ClientModelSort[];
}

/** User Status */
export interface UserStatus {
    name: string;
    email: string;
    planStatus?: PlanStatus;
    cascadeModelConfigData?: CascadeModelConfigData;
    acceptedLatestTermsOfService?: boolean;
    userTier?: {
        name: string;
        id: string;
        description: string;
        upgradeSubscriptionUri?: string;
        upgradeSubscriptionText?: string;
    };
}

/** Server User Status Response */
export interface ServerUserStatusResponse {
    userStatus: UserStatus;
    /** Error message returned by server */
    message?: string;
    /** Error code returned by server */
    code?: string;
}

// ============ Process Detection Types ============

/** Environment Scan Result */
export interface EnvironmentScanResult {
    /** Extension Port */
    extensionPort: number;
    /** Connect Port */
    connectPort: number;
    /** CSRF Token */
    csrfToken: string;
}

/** Scan Diagnostics */
export interface ScanDiagnostics {
    /** Scan Method */
    scan_method: 'process_name' | 'keyword' | 'unknown';
    /** Target Process Name */
    target_process: string;
    /** Scan Attempts */
    attempts: number;
    /** Found Candidates Count */
    found_candidates: number;
    /** Candidate Ports */
    ports?: number[];
    /** Verified Port */
    verified_port?: number | null;
    /** Verification Success */
    verification_success?: boolean;
}

/** Process Info */
export interface ProcessInfo {
    /** Process ID */
    pid: number;
    /** Extension Port */
    extensionPort: number;
    /** CSRF Token */
    csrfToken: string;
}

/** User Info */
export interface UserInfo {
    name: string;
    email: string;
    planName: string;
    tier: string;
    browserEnabled: boolean;
    knowledgeBaseEnabled: boolean;
    canBuyMoreCredits: boolean;
    hasAutocompleteFastMode: boolean;
    monthlyPromptCredits: number;
    monthlyFlowCredits: number;
    availablePromptCredits: number;
    availableFlowCredits: number;
    cascadeWebSearchEnabled: boolean;
    canGenerateCommitMessages: boolean;
    allowMcpServers: boolean;
    maxNumChatInputTokens: string;
    tierDescription: string;
    upgradeUri: string;
    upgradeText: string;
    // New fields
    teamsTier: string;
    hasTabToJump: boolean;
    allowStickyPremiumModels: boolean;
    allowPremiumCommandModels: boolean;
    maxNumPremiumChatMessages: string;
    maxCustomChatInstructionCharacters: string;
    maxNumPinnedContextItems: string;
    maxLocalIndexSize: string;
    monthlyFlexCreditPurchaseAmount: number;
    canCustomizeAppIcon: boolean;
    cascadeCanAutoRunCommands: boolean;
    canAllowCascadeInBackground: boolean;
    allowAutoRunCommands: boolean;
    allowBrowserExperimentalFeatures: boolean;
    acceptedLatestTermsOfService: boolean;
    userTierId: string;
}

// ============ UI Related Types ============

/** Webview Message Types */
export type WebviewMessageType = 
    | 'init'
    | 'refresh'
    | 'togglePin'
    | 'toggleCredits'
    | 'updateOrder'
    | 'resetOrder'
    | 'retry'
    | 'openLogs'
    | 'rerender'
    | 'renameGroup'
    | 'toggleGrouping'
    | 'promptRenameGroup'
    | 'toggleGroupPin'
    | 'updateGroupOrder'
    | 'autoGroup'
    | 'updateNotificationEnabled'
    | 'updateThresholds'
    | 'renameModel'
    | 'updateStatusBarFormat'
    | 'toggleProfile'
    | 'updateViewMode'
    | 'updateDisplayMode'
    | 'updateDataMasked'
    | 'openCustomGrouping'
    | 'saveCustomGrouping'
    | 'previewAutoGroup'
    // Auto Trigger
    | 'tabChanged'
    | 'autoTrigger.authorize'
    | 'autoTrigger.revoke'
    | 'autoTrigger.saveSchedule'
    | 'autoTrigger.test'
    | 'autoTrigger.validateCrontab'
    | 'autoTrigger.getState'
    | 'autoTrigger.clearHistory'
    // Feature Guide
    | 'guide.checkItOut'
    | 'guide.dontShowAgain'
    // Announcements
    | 'announcement.getState'
    | 'announcement.markAsRead'
    | 'announcement.markAllAsRead'
    // General
    | 'openUrl'
    | 'executeCommand';

/** Webview Message */
export interface WebviewMessage {
    command: WebviewMessageType;
    modelId?: string;
    order?: string[];
    /** Group ID */
    groupId?: string;
    /** New Group Name */
    groupName?: string;
    /** Current Group Name (for promptRenameGroup) */
    currentName?: string;
    /** All Model IDs in Group */
    modelIds?: string[];
    /** Enable Notification (updateThresholds) */
    notificationEnabled?: boolean;
    /** Warning Threshold (updateThresholds) */
    warningThreshold?: number;
    /** Critical Threshold (updateThresholds) */
    criticalThreshold?: number;
    /** Status Bar Format (updateStatusBarFormat) */
    statusBarFormat?: string;
    /** View Mode (updateViewMode) */
    viewMode?: string;
    /** Display Mode (updateDisplayMode) */
    displayMode?: 'webview' | 'quickpick';
    /** Data Masked Status (updateDataMasked) */
    dataMasked?: boolean;
    /** Custom Group Mappings (saveCustomGrouping) */
    customGroupMappings?: Record<string, string>;
    /** Custom Group Names (saveCustomGrouping) */
    customGroupNames?: Record<string, string>;
    // Auto Trigger
    /** Tab Name (tabChanged) */
    tab?: string;
    /** Schedule Config (autoTrigger.saveSchedule) */
    schedule?: ScheduleConfig;
    /** Crontab Expression (autoTrigger.validateCrontab) */
    crontab?: string;
    /** Manual Test Model List (autoTrigger.test) */
    models?: string[];
    // Announcements
    /** Announcement ID (announcement.markAsRead) */
    id?: string;
    /** URL (openUrl) */
    url?: string;
    /** Command ID (executeCommand) */
    commandId?: string;
    /** Command Arguments (executeCommand) */
    commandArgs?: unknown[];
}

/** Schedule Config */
export interface ScheduleConfig {
    enabled: boolean;
    repeatMode: 'daily' | 'weekly' | 'interval';
    dailyTimes?: string[];
    weeklyDays?: number[];
    weeklyTimes?: string[];
    intervalHours?: number;
    intervalStartTime?: string;
    intervalEndTime?: string;
    crontab?: string;
    selectedModels: string[];
}

/** Dashboard Config */
export interface DashboardConfig {
    /** Show Prompt Credits */
    showPromptCredits: boolean;
    /** Pinned Models */
    pinnedModels: string[];
    /** Model Order */
    modelOrder: string[];
    /** Model Custom Names Map (modelId -> displayName) */
    modelCustomNames?: Record<string, string>;
    /** Enable Grouping */
    groupingEnabled: boolean;
    /** Group Custom Names Map (modelId -> groupName) */
    groupCustomNames: Record<string, string>;
    /** Show Groups in Status Bar */
    groupingShowInStatusBar: boolean;
    /** Pinned Groups */
    pinnedGroups: string[];
    /** Group Order */
    groupOrder: string[];
    /** Refresh Interval (seconds) */
    refreshInterval: number;
    /** Enable Notifications */
    notificationEnabled: boolean;
    /** Warning Threshold (%) */
    warningThreshold?: number;
    /** Critical Threshold (%) */
    criticalThreshold?: number;
    /** Last Successful Update Time */
    lastSuccessfulUpdate?: Date | null;
    /** Status Bar Format */
    statusBarFormat?: string;
    /** Hide Plan Details Panel */
    profileHidden?: boolean;
    /** View Mode (card | list) */
    viewMode?: string;
    /** Display Mode (webview | quickpick) */
    displayMode?: string;
    /** Mask Sensitive Data */
    dataMasked?: boolean;
    /** External URL */
    url?: string;
    /** Group Mappings (modelId -> groupId) */
    groupMappings?: Record<string, string>;
}

/** Status Bar Update Data */
export interface StatusBarUpdate {
    /** Display Text */
    text: string;
    /** Tooltip */
    tooltip: string;
    /** Background Color */
    backgroundColor?: string;
    /** Min Percentage (for color judgment) */
    minPercentage: number;
}

// ============ Platform Strategy Types ============

/** Platform Type */
export type PlatformType = 'windows' | 'darwin' | 'linux';

/** Platform Strategy Interface */
export interface PlatformStrategy {
    /** Get process list command */
    getProcessListCommand(processName: string): string;
    /** Parse process info */
    parseProcessInfo(stdout: string): ProcessInfo[];
    /** Get port list command */
    getPortListCommand(pid: number): string;
    /** Parse listening ports */
    parseListeningPorts(stdout: string): number[];
    /** Get diagnostic command (list all related processes for debugging) */
    getDiagnosticCommand(): string;
    /** Get error messages */
    getErrorMessages(): {
        processNotFound: string;
        commandNotAvailable: string;
        requirements: string[];
    };
}

// ============ Legacy Type Aliases (Backward Compatibility) ============

/** @deprecated Use ModelQuotaInfo */
export type model_quota_info = ModelQuotaInfo;

/** @deprecated Use PromptCreditsInfo */
export type prompt_credits_info = PromptCreditsInfo;

/** @deprecated Use QuotaSnapshot */
export type quota_snapshot = QuotaSnapshot;

/** @deprecated Use QuotaLevel */
export const quota_level = QuotaLevel;

/** @deprecated Use ServerUserStatusResponse */
export type server_user_status_response = ServerUserStatusResponse;

/** @deprecated Use EnvironmentScanResult */
export type environment_scan_result = EnvironmentScanResult;
