/**
 * Antigravity Cockpit - Auto Trigger Types
 * Auto Trigger Type Definitions
 */

/**
 * OAuth Credential Data
 */
export interface OAuthCredential {
    clientId: string;
    clientSecret: string;
    accessToken: string;
    refreshToken: string;
    expiresAt: string;  // ISO 8601 format
    projectId?: string;
    scopes: string[];
    email?: string;
}

/**
 * Authorization Status
 */
export interface AuthorizationStatus {
    isAuthorized: boolean;
    email?: string;
    expiresAt?: string;
    lastRefresh?: string;
}

/**
 * Schedule Repeat Mode
 */
export type ScheduleRepeatMode = 'daily' | 'weekly' | 'interval';

/**
 * Day of Week
 */
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;  // 0 = Sunday

/**
 * Schedule Configuration
 */
export interface ScheduleConfig {
    enabled: boolean;
    repeatMode: ScheduleRepeatMode;
    
    // Daily Mode
    dailyTimes?: string[];  // ["07:00", "12:00", "17:00"]
    
    // Weekly Mode
    weeklyDays?: number[];  // [1, 2, 3, 4, 5] = Weekdays (0 = Sunday)
    weeklyTimes?: string[];
    
    // Interval Mode
    intervalHours?: number;
    intervalStartTime?: string;  // "07:00"
    intervalEndTime?: string;    // "22:00" (Optional, whole day if omitted)
    
    // Advanced: Raw crontab expression
    crontab?: string;
    
    /** Selected model list (for triggering) */
    selectedModels: string[];
}

/**
 * Trigger Record
 */
export interface TriggerRecord {
    timestamp: string;  // ISO 8601
    success: boolean;
    prompt?: string;    // Request content sent
    message?: string;   // AI Reply
    duration?: number;  // ms
    triggerType?: 'manual' | 'auto'; // Trigger type: Manual Test | Auto Trigger
}

/**
 * Model Information (for auto-trigger)
 */
export interface ModelInfo {
    /** Model ID (for API calls, e.g. gemini-3-pro-high) */
    id: string;
    /** Display Name (e.g. Gemini 3 Pro (High)) */
    displayName: string;
    /** Model Constant (for quota matching, e.g. MODEL_PLACEHOLDER_M8) */
    modelConstant: string;
}

/**
 * Auto Trigger State
 */
export interface AutoTriggerState {
    authorization: AuthorizationStatus;
    schedule: ScheduleConfig;
    lastTrigger?: TriggerRecord;
    recentTriggers: TriggerRecord[];  // Recent 10 records
    nextTriggerTime?: string;  // ISO 8601
    /** Available model list (Filtered, contains only models displayed in quota) */
    availableModels: ModelInfo[];
}

/**
 * Webview Message Type
 */
export interface AutoTriggerMessage {
    type: 
        | 'auto_trigger_get_state'
        | 'auto_trigger_start_auth'
        | 'auto_trigger_revoke_auth'
        | 'auto_trigger_save_schedule'
        | 'auto_trigger_test_trigger'
        | 'auto_trigger_state_update';
    data?: {
        models?: string[];
        [key: string]: unknown;
    };
}

/**
 * Crontab Parse Result
 */
export interface CrontabParseResult {
    valid: boolean;
    description?: string;  // Human-readable description
    nextRuns?: Date[];     // Next run times
    error?: string;
}

/**
 * Preset Schedule Template
 */
export interface SchedulePreset {
    id: string;
    name: string;
    description: string;
    config: Partial<ScheduleConfig>;
}

/**
 * Preset Schedule Template List
 */
export const SCHEDULE_PRESETS: SchedulePreset[] = [
    {
        id: 'morning',
        name: 'Morning Pre-trigger',
        description: 'Trigger once daily at 7:00 AM',
        config: {
            repeatMode: 'daily',
            dailyTimes: ['07:00'],
            selectedModels: ['gemini-3-flash'],
        },
    },
    {
        id: 'workday',
        name: 'Workday Pre-trigger',
        description: 'Trigger at 8:00 AM on weekdays',
        config: {
            repeatMode: 'weekly',
            weeklyDays: [1, 2, 3, 4, 5],
            weeklyTimes: ['08:00'],
            selectedModels: ['gemini-3-flash'],
        },
    },
    {
        id: 'every4h',
        name: 'Trigger every 4 hours',
        description: 'Trigger every 4 hours starting from 7:00 AM',
        config: {
            repeatMode: 'interval',
            intervalHours: 4,
            intervalStartTime: '07:00',
            intervalEndTime: '23:00',
            selectedModels: ['gemini-3-flash'],
        },
    },
];
