/**
 * Antigravity Cockpit - Lightweight Error Reporting Service
 * Directly uses Sentry API, no SDK dependency for smaller size
 */

import * as https from 'https';
import * as vscode from 'vscode';
import * as os from 'os';
import { configService } from './config_service';
import { TIMING } from './constants';

// Sentry DSN - Injected via esbuild define at build time
const SENTRY_DSN = process.env.SENTRY_DSN || '';

let telemetryEnabled = true;
let extensionVersion = 'unknown';
let verboseLogging = false;

// Parse DSN
interface SentryConfig {
    publicKey: string;
    host: string;
    projectId: string;
}

function parseDsn(dsn: string): SentryConfig | null {
    if (!dsn) {
        return null;
    }
    try {
        // DSN format: https://<public_key>@<host>/<project_id>
        const url = new URL(dsn);
        const publicKey = url.username;
        const host = url.host;
        const projectId = url.pathname.replace('/', '');
        return { publicKey, host, projectId };
    } catch {
        return null;
    }
}

const sentryConfig = parseDsn(SENTRY_DSN);

/**
 * Initialize Error Reporter
 */
export function initErrorReporter(version: string): void {
    extensionVersion = version;
    
    // Check if user has disabled telemetry
    const config = vscode.workspace.getConfiguration('agCockpit');
    telemetryEnabled = config.get<boolean>('telemetryEnabled', true);
    verboseLogging = config.get<boolean>('telemetryDebug', false);
    
    // Also respect VS Code global telemetry settings
    const vscodeConfig = vscode.workspace.getConfiguration('telemetry');
    const vscodeLevel = vscodeConfig.get<string>('telemetryLevel', 'all');
    if (vscodeLevel === 'off') {
        telemetryEnabled = false;
    }
    
    if (!telemetryEnabled) {
        if (verboseLogging) {
            console.log('[ErrorReporter] Telemetry disabled by user');
        }
        return;
    }

    if (!sentryConfig) {
        if (verboseLogging) {
            console.log('[ErrorReporter] Sentry DSN not configured');
        }
        return;
    }

    if (verboseLogging) {
        console.log('[ErrorReporter] Lightweight error reporter initialized');
    }
}

/**
 * Error Classification - Helps quickly distinguish user environment issues vs extension bugs
 */
type ErrorCategory = 
    | 'network_timeout'      // Network Timeout - User Environment
    | 'connection_refused'   // Connection Refused - Service Not Started
    | 'dns_failure'         // DNS Failure - Network Problem
    | 'proxy_error'         // Proxy Problem - User Environment
    | 'permission_denied'   // Permission Problem - User Environment
    | 'cmd_timeout'         // Command Timeout - System Lag
    | 'parse_error'         // Parse Error - Extension Bug
    | 'null_reference'      // Null Reference - Extension Bug
    | 'process_not_found'   // Process Not Found - User Environment
    | 'unauthorized'        // Not Logged In - User Action
    | 'unknown';            // Unknown

/**
 * Auto-classify based on error message
 */
function classifyError(error: Error): ErrorCategory {
    const msg = error.message.toLowerCase();
    
    // Network related (User Environment)
    if (msg.includes('etimedout') || msg.includes('timed out')) {
        return 'network_timeout';
    }
    if (msg.includes('econnrefused') || msg.includes('connection refused')) {
        return 'connection_refused';
    }
    if (msg.includes('enotfound') || msg.includes('getaddrinfo')) {
        return 'dns_failure';
    }
    if (msg.includes('proxy') || msg.includes('407')) {
        return 'proxy_error';
    }
    
    // Permission/System related (User Environment)
    if (msg.includes('permission') || msg.includes('access denied') || msg.includes('eacces')) {
        return 'permission_denied';
    }
    if (msg.includes('timeout') && (msg.includes('command') || msg.includes('powershell'))) {
        return 'cmd_timeout';
    }
    if (msg.includes('process') && (msg.includes('not found') || msg.includes('no matching'))) {
        return 'process_not_found';
    }
    if (msg.includes('not logged in') || msg.includes('unauthorized')) {
        return 'unauthorized';
    }
    
    // Code issue (Extension Bug)
    if (msg.includes('json') || msg.includes('parse') || msg.includes('unexpected token')) {
        return 'parse_error';
    }
    if (msg.includes('undefined') || msg.includes('null') || msg.includes('cannot read prop')) {
        return 'null_reference';
    }
    
    return 'unknown';
}

/**
 * Get proxy configuration status
 */
export function getProxyStatus(): { configured: boolean; type: string } {
    try {
        const httpConfig = vscode.workspace.getConfiguration('http');
        const proxy = httpConfig.get<string>('proxy', '');
        if (proxy) {
            return { configured: true, type: 'http.proxy' };
        }
        
        // Check environment variables
        if (process.env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.https_proxy) {
            return { configured: true, type: 'env_var' };
        }
        
        return { configured: false, type: 'none' };
    } catch {
        return { configured: false, type: 'unknown' };
    }
}

/**
 * Build Sentry Event - Contains enhanced diagnostic info
 */
function buildEvent(error: Error, context?: Record<string, unknown>): object {
    const errorCategory = classifyError(error);
    const proxyStatus = getProxyStatus();
    const user = getUserContext();
    const appContext = getAppContext();
    const runtimeContext = getRuntimeContext();
    const uiKindLabel = getUiKindLabel(vscode.env.uiKind);
    
    // Determine if likely a user environment issue
    const likelyUserEnvIssue = [
        'network_timeout', 'connection_refused', 'dns_failure', 
        'proxy_error', 'permission_denied', 'cmd_timeout', 'process_not_found',
        'unauthorized'
    ].includes(errorCategory);
    
    return {
        event_id: generateEventId(),
        timestamp: new Date().toISOString(),
        platform: 'node',
        level: 'error',
        release: `antigravity-cockpit@${extensionVersion}`,
        environment: 'production',
        // Tags - For Sentry filtering and grouping
        tags: {
            error_category: errorCategory,
            likely_user_env: likelyUserEnvIssue ? 'yes' : 'no',
            proxy_configured: proxyStatus.configured ? 'yes' : 'no',
            os_type: os.platform(),
            editor: vscode.env.appName,
            uri_scheme: vscode.env.uriScheme,
            ui_kind: uiKindLabel,
            remote_name: vscode.env.remoteName ?? 'local',
            ...(context && (context as { test_event?: boolean }).test_event ? { test_event: 'yes' } : {}),
        },
        // Contexts - Detailed diagnostic info
        contexts: {
            os: {
                name: os.platform(),
                version: os.release(),
            },
            vscode: {
                version: vscode.version,
                app_name: vscode.env.appName,
                uri_scheme: vscode.env.uriScheme,
                ui_kind: vscode.env.uiKind,
                remote_name: vscode.env.remoteName ?? 'local',
            },
            diagnostic: {
                error_category: errorCategory,
                proxy_status: proxyStatus,
                node_version: process.version,
                arch: os.arch(),
                raw_stack: error.stack,  // Raw stack for human readability
            },
            ...(appContext ? { app: appContext } : {}),
            ...(runtimeContext ? { runtime: runtimeContext } : {}),
            ...(context ? { custom: context } : {}),
        },
        user,
        exception: {
            values: [{
                type: error.name,
                value: error.message,
                stacktrace: parseStacktrace(error.stack),
            }],
        },
    };
}

/**
 * Generate Event ID
 */
function generateEventId(): string {
    return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * Parse Stacktrace
 */
function parseStacktrace(stack?: string): object | undefined {
    if (!stack) {
        return undefined;
    }
    
    const frames = stack.split('\n')
        .slice(1) // Skip first line (error message)
        .map(line => {
            const match = line.match(/at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/);
            if (match) {
                return {
                    function: match[1],
                    filename: match[2],
                    lineno: parseInt(match[3], 10),
                    colno: parseInt(match[4], 10),
                };
            }
            return null;
        })
        .filter(Boolean)
        .reverse(); // Sentry expects newest frame last
    
    return frames.length > 0 ? { frames } : undefined;
}

/**
 * Send event to Sentry
 */
function sendEvent(event: object): void {
    if (!sentryConfig) {
        if (verboseLogging) {
            console.log('[ErrorReporter] Skip send: Sentry DSN not configured');
        }
        return;
    }

    const data = JSON.stringify(event);
    
    const options: https.RequestOptions = {
        hostname: sentryConfig.host,
        port: 443,
        path: `/api/${sentryConfig.projectId}/store/`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${sentryConfig.publicKey}, sentry_client=antigravity-cockpit/1.0`,
            'Content-Length': Buffer.byteLength(data),
        },
        timeout: 5000,
    };

    const req = https.request(options, (res) => {
        if (verboseLogging) {
            console.log(`[ErrorReporter] Response status: ${res.statusCode}`);
        }
        if (res.statusCode === 200 && verboseLogging) {
            console.log('[ErrorReporter] Event sent successfully');
        }
    });

    req.on('error', (err) => {
        if (verboseLogging) {
            console.log(`[ErrorReporter] Send failed: ${err.message}`);
        }
        // Silently fail, do not affect main program
    });

    req.on('timeout', () => {
        req.destroy();
        if (verboseLogging) {
            console.log('[ErrorReporter] Send timed out');
        }
    });

    req.write(data);
    req.end();
}

/**
 * Capture Error
 */
export function captureError(error: Error, context?: Record<string, unknown>): void {
    if (!telemetryEnabled || !sentryConfig) {
        if (verboseLogging) {
            console.log('[ErrorReporter] captureError skipped (disabled or missing DSN)');
        }
        return;
    }

    try {
        const event = buildEvent(error, context);
        if (verboseLogging) {
            console.log('[ErrorReporter] Sending error event');
        }
        sendEvent(event);
    } catch {
        // Silently fail
    }
}

/**
 * Capture Message
 */
export function captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info'): void {
    if (!telemetryEnabled || !sentryConfig) {
        if (verboseLogging) {
            console.log('[ErrorReporter] captureMessage skipped (disabled or missing DSN)');
        }
        return;
    }

    try {
        const user = getUserContext();
        const event = {
            event_id: generateEventId(),
            timestamp: new Date().toISOString(),
            platform: 'node',
            level,
            release: `antigravity-cockpit@${extensionVersion}`,
            message,
            user,
        };
        if (verboseLogging) {
            console.log('[ErrorReporter] Sending message event');
        }
        sendEvent(event);
    } catch {
        // Silently fail
    }
}

/**
 * Get Anonymous User Info (For Sentry Users Stats)
 */
function getUserContext(): { id?: string; session_id?: string } | undefined {
    const user: { id?: string; session_id?: string } = {};

    // machineId is anonymous stable ID provided by VS Code
    if (vscode.env.machineId) {
        user.id = vscode.env.machineId;
    }

    // sessionId is temporary session ID
    if (vscode.env.sessionId) {
        user.session_id = vscode.env.sessionId;
    }

    return Object.keys(user).length > 0 ? user : undefined;
}

/**
 * Get App Context (No sensitive content)
 */
function getAppContext(): {
    refresh_interval_sec: number;
    display_mode: string;
    view_mode: string;
    grouping_enabled: boolean;
    grouping_show_in_status_bar: boolean;
    notification_enabled: boolean;
    show_prompt_credits: boolean;
    status_bar_format: string;
    data_masked: boolean;
    warning_threshold: number;
    critical_threshold: number;
    log_level: string;
} | undefined {
    try {
        const config = configService.getConfig();
        return {
            refresh_interval_sec: config.refreshInterval,
            display_mode: config.displayMode,
            view_mode: config.viewMode,
            grouping_enabled: config.groupingEnabled,
            grouping_show_in_status_bar: config.groupingShowInStatusBar,
            notification_enabled: config.notificationEnabled,
            show_prompt_credits: config.showPromptCredits,
            status_bar_format: config.statusBarFormat,
            data_masked: config.dataMasked,
            warning_threshold: config.warningThreshold,
            critical_threshold: config.criticalThreshold,
            log_level: config.logLevel,
        };
    } catch {
        return undefined;
    }
}

/**
 * Get Runtime Constants Context
 */
function getRuntimeContext(): {
    http_timeout_ms: number;
    process_cmd_timeout_ms: number;
    process_scan_retry_ms: number;
    max_consecutive_retry: number;
} {
    return {
        http_timeout_ms: TIMING.HTTP_TIMEOUT_MS,
        process_cmd_timeout_ms: TIMING.PROCESS_CMD_TIMEOUT_MS,
        process_scan_retry_ms: TIMING.PROCESS_SCAN_RETRY_MS,
        max_consecutive_retry: TIMING.MAX_CONSECUTIVE_RETRY,
    };
}

/**
 * Get UI Kind Label
 */
function getUiKindLabel(kind: vscode.UIKind | undefined): string {
    if (kind === vscode.UIKind.Web) {
        return 'web';
    }
    if (kind === vscode.UIKind.Desktop) {
        return 'desktop';
    }
    return 'unknown';
}

/**
 * Flush pending events (Compatible interface, lightweight version does not need it)
 */
export async function flushEvents(): Promise<void> {
    // Lightweight version uses async request, no need to wait
    return Promise.resolve();
}
