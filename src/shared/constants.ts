/**
 * Antigravity Cockpit - Constant Definitions
 * Centrally manage all hardcoded magic values
 */

/** Quota Health Default Thresholds */
export const QUOTA_THRESHOLDS = {
    /** Healthy Threshold (> 50%) */
    HEALTHY: 50,
    /** Warning Default Threshold (> 30%) - Yellow */
    WARNING_DEFAULT: 30,
    /** Critical Default Threshold (<= 10%) - Red */
    CRITICAL_DEFAULT: 10,
} as const;

/** Feedback URL */
export const FEEDBACK_URL = 'https://github.com/jlcodes99/vscode-antigravity-cockpit/issues';

/** Time Related Constants (ms) */
export const TIMING = {
    /** Default Refresh Interval */
    DEFAULT_REFRESH_INTERVAL_MS: 120000,
    /** Process Scan Retry Interval */
    PROCESS_SCAN_RETRY_MS: 100,
    /** HTTP Request Timeout (10s, compatible with WSL2 and other slow environments) */
    HTTP_TIMEOUT_MS: 10000,
    /** Process Command Execution Timeout (Increased to 15000ms to accommodate PowerShell cold start on some Windows environments) */
    PROCESS_CMD_TIMEOUT_MS: 15000,
    /** Refresh Cooldown (Seconds) */
    REFRESH_COOLDOWN_SECONDS: 60,
    /** Max Consecutive Retries for Runtime Sync Failures */
    MAX_CONSECUTIVE_RETRY: 5,
} as const;

/** UI Related Constants */
export const UI = {
    /** Status Bar Priority */
    STATUS_BAR_PRIORITY: 100,
    /** Card Minimum Width */
    CARD_MIN_WIDTH: 280,
} as const;

/** Endpoint Paths */
export const API_ENDPOINTS = {
    GET_USER_STATUS: '/exa.language_server_pb.LanguageServerService/GetUserStatus',
    GET_UNLEASH_DATA: '/exa.language_server_pb.LanguageServerService/GetUnleashData',
} as const;

/** Target Process Name Mapping */
export const PROCESS_NAMES = {
    windows: 'language_server_windows_x64.exe',
    darwin_arm: 'language_server_macos_arm',
    darwin_x64: 'language_server_macos',
    linux: 'language_server_linux',
} as const;

/** Configuration Keys */
export const CONFIG_KEYS = {
    REFRESH_INTERVAL: 'refreshInterval',
    SHOW_PROMPT_CREDITS: 'showPromptCredits',
    PINNED_MODELS: 'pinnedModels',
    MODEL_ORDER: 'modelOrder',
    MODEL_CUSTOM_NAMES: 'modelCustomNames',
    LOG_LEVEL: 'logLevel',
    NOTIFICATION_ENABLED: 'notificationEnabled',
    STATUS_BAR_FORMAT: 'statusBarFormat',
    GROUPING_ENABLED: 'groupingEnabled',
    GROUPING_CUSTOM_NAMES: 'groupingCustomNames',
    GROUPING_SHOW_IN_STATUS_BAR: 'groupingShowInStatusBar',
    PINNED_GROUPS: 'pinnedGroups',
    GROUP_ORDER: 'groupOrder',
    GROUP_MAPPINGS: 'groupMappings',
    WARNING_THRESHOLD: 'warningThreshold',
    CRITICAL_THRESHOLD: 'criticalThreshold',
    DISPLAY_MODE: 'displayMode',
    PROFILE_HIDDEN: 'profileHidden',
    VIEW_MODE: 'viewMode',
    DATA_MASKED: 'dataMasked',
} as const;

/** Status Bar Display Format */
export const STATUS_BAR_FORMAT = {
    /** Icon Only Mode: Shows only 🚀 */
    ICON: 'icon',
    /** Dot Only Mode: Shows only 🟢🟡🔴 */
    DOT: 'dot',
    /** Percent Only Mode: Shows only percentage */
    PERCENT: 'percent',
    /** Compact Mode: Status Dot + Percentage */
    COMPACT: 'compact',
    /** Name + Percent Mode: Model Name + Percentage (No Status Dot) */
    NAME_PERCENT: 'namePercent',
    /** Standard Mode: Status Dot + Model Name + Percentage (Default) */
    STANDARD: 'standard',
} as const;

/** Log Levels */
export const LOG_LEVELS = {
    DEBUG: 'debug',
    INFO: 'info',
    WARN: 'warn',
    ERROR: 'error',
} as const;

/** Display Modes */
export const DISPLAY_MODE = {
    /** Webview Panel (Default) */
    WEBVIEW: 'webview',
    /** QuickPick Menu (Compatibility Mode) */
    QUICKPICK: 'quickpick',
} as const;
