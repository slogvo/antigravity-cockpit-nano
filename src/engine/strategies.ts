/**
 * Antigravity Cockpit - Platform Strategies
 * Process detection strategies for different operating systems
 */

import { logger } from '../shared/log_service';
import { PlatformStrategy, ProcessInfo } from '../shared/types';

/**
 * Windows Platform Strategy
 */
export class WindowsStrategy implements PlatformStrategy {
    /**
     * Check if command line belongs to Antigravity process
     * Exact match: Must satisfy all following conditions:
     * 1. Must have --extension_server_port argument
     * 2. Must have --csrf_token argument
     * 3. Must have --app_data_dir antigravity argument
     */
    private isAntigravityProcess(commandLine: string): boolean {
        // Condition 1: Must contain --extension_server_port argument
        if (!commandLine.includes('--extension_server_port')) {
            return false;
        }

        // Condition 2: Must contain --csrf_token argument
        if (!commandLine.includes('--csrf_token')) {
            return false;
        }

        // Condition 3: Must have --app_data_dir antigravity argument (most reliable indicator)
        return /--app_data_dir\s+antigravity\b/i.test(commandLine);
    }

    /**
     * Get process list command by process name
     * Use PowerShell only
     */
    getProcessListCommand(processName: string): string {
        const utf8Header = '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ';
        // Use single quotes to wrap Filter argument, escape internal name value with double single quotes
        // chcp 65001 >nul ensures CMD environment runs in UTF-8 to avoid garbled text
        return `chcp 65001 >nul && powershell -NoProfile -Command "${utf8Header}Get-CimInstance Win32_Process -Filter 'name=''${processName}''' | Select-Object ProcessId,CommandLine | ConvertTo-Json"`;
    }

    /**
     * Get process list command by keyword (Find all processes containing csrf_token)
     * This is a fallback solution when search by process name fails
     */
    getProcessByKeywordCommand(): string {
        const utf8Header = '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ';
        // chcp 65001 >nul ensures CMD environment runs in UTF-8
        return `chcp 65001 >nul && powershell -NoProfile -Command "${utf8Header}Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'csrf_token' } | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json"`;
    }

    parseProcessInfo(stdout: string): ProcessInfo[] {
        logger.debug('[WindowsStrategy] Parsing JSON process info...');

        try {
            // Clean up possible non-JSON impurities (although chcp 65001 should solve most issues, defensive programming)
            const jsonStart = stdout.indexOf('[');
            const jsonObjectStart = stdout.indexOf('{');
            let cleanStdout = stdout;

            if (jsonStart >= 0 || jsonObjectStart >= 0) {
                // Find earliest JSON start symbol
                const start = (jsonStart >= 0 && jsonObjectStart >= 0) 
                    ? Math.min(jsonStart, jsonObjectStart) 
                    : Math.max(jsonStart, jsonObjectStart);
                cleanStdout = stdout.substring(start);
            }

            let data = JSON.parse(cleanStdout.trim());
            if (!Array.isArray(data)) {
                data = [data];
            }

            if (data.length === 0) {
                logger.debug('[WindowsStrategy] JSON array is empty');
                return [];
            }

            const totalCount = data.length;
            const candidates: ProcessInfo[] = [];

            for (const item of data) {
                const commandLine = item.CommandLine || '';
                if (!commandLine || !this.isAntigravityProcess(commandLine)) {
                    continue;
                }

                const pid = item.ProcessId;
                if (!pid) { continue; }

                const portMatch = commandLine.match(/--extension_server_port[=\s]+(\d+)/);
                const tokenMatch = commandLine.match(/--csrf_token[=\s]+([a-f0-9-]+)/i);

                if (!tokenMatch?.[1]) {
                    logger.warn(`[WindowsStrategy] Cannot extract CSRF Token from PID ${pid}`);
                    continue;
                }

                const extensionPort = portMatch?.[1] ? parseInt(portMatch[1], 10) : 0;
                const csrfToken = tokenMatch[1];

                candidates.push({ pid, extensionPort, csrfToken });
            }

            logger.info(`[WindowsStrategy] Found ${totalCount} language_server processes, ${candidates.length} belong to Antigravity`);

            if (candidates.length === 0) {
                logger.warn('[WindowsStrategy] No valid Antigravity process found');
                return [];
            }

            return candidates;
        } catch (e) {
            const error = e instanceof Error ? e : new Error(String(e));
            // Log stdout preview for diagnosis
            const stdoutPreview = stdout.length > 200 ? stdout.substring(0, 200) + '...' : stdout;
            logger.debug(`[WindowsStrategy] JSON parse failed: ${error.message}. Output preview: ${stdoutPreview}`);
            return [];
        }
    }

    getPortListCommand(pid: number): string {
        return `chcp 65001 >nul && netstat -ano | findstr "${pid}" | findstr "LISTENING"`;
    }

    parseListeningPorts(stdout: string): number[] {
        const portRegex = /(?:127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d+)\s+\S+\s+LISTENING/gi;
        const ports: number[] = [];
        let match;

        while ((match = portRegex.exec(stdout)) !== null) {
            const port = parseInt(match[1], 10);
            if (!ports.includes(port)) {
                ports.push(port);
            }
        }

        logger.debug(`[WindowsStrategy] Parsed ${ports.length} ports: ${ports.join(', ')}`);
        return ports.sort((a, b) => a - b);
    }

    getErrorMessages(): { processNotFound: string; commandNotAvailable: string; requirements: string[] } {
        return {
            processNotFound: 'language_server process not found',
            commandNotAvailable: 'PowerShell command failed; please check system permissions',
            requirements: [
                'Antigravity is running',
                'language_server_windows_x64.exe process is running',
                'The system has permission to run PowerShell and netstat commands',
            ],
        };
    }

    getDiagnosticCommand(): string {
        const utf8Header = '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ';
        return `chcp 65001 >nul && powershell -NoProfile -Command "${utf8Header}Get-Process | Where-Object { $_.ProcessName -match 'language|antigravity' } | Select-Object Id,ProcessName,Path | Format-Table -AutoSize"`;
    }
}

/**
 * Unix (macOS/Linux) Platform Strategy
 */
export class UnixStrategy implements PlatformStrategy {
    private platform: string;
    private targetPid: number = 0;
    /** Available port detection command: 'lsof', 'ss', or 'netstat' */
    private availablePortCommand: 'lsof' | 'ss' | 'netstat' | null = null;
    /** Whether command availability has been checked */
    private portCommandChecked: boolean = false;

    constructor(platform: string) {
        this.platform = platform;
        logger.debug(`[UnixStrategy] Initialized, platform: ${platform}`);
    }

    /**
     * Detect available port detection command on system
     * Priority: lsof > ss > netstat
     */
    private async detectAvailablePortCommand(): Promise<void> {
        if (this.portCommandChecked) {
            return;
        }
        this.portCommandChecked = true;

        // Use dynamic import to avoid top-level dependency
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);

        const commands = ['lsof', 'ss', 'netstat'] as const;

        for (const cmd of commands) {
            try {
                await execAsync(`which ${cmd}`, { timeout: 3000 });
                this.availablePortCommand = cmd;
                logger.info(`[UnixStrategy] Port command available: ${cmd}`);
                return;
            } catch {
                // Command not available, try next
            }
        }

        logger.warn('[UnixStrategy] No port detection command available (lsof/ss/netstat)');
    }

    /**
     * Check if command line belongs to Antigravity process
     * Exact match: Must satisfy all following conditions:
     * 1. Must have --extension_server_port argument
     * 2. Must have --csrf_token argument
     * 3. Must have --app_data_dir antigravity argument
     */
    private isAntigravityProcess(commandLine: string): boolean {
        // Condition 1: Must contain --extension_server_port argument
        if (!commandLine.includes('--extension_server_port')) {
            return false;
        }

        // Condition 2: Must contain --csrf_token argument
        if (!commandLine.includes('--csrf_token')) {
            return false;
        }

        // Condition 3: Must have --app_data_dir antigravity argument (most reliable indicator)
        return /--app_data_dir\s+antigravity\b/i.test(commandLine);
    }

    getProcessListCommand(processName: string): string {
        // Use ps -ww to ensure command line is not truncated
        // -ww: unlimited width
        // -eo: custom output format
        // pid,ppid,args: Process ID, Parent Process ID, Full Command Line
        return `ps -ww -eo pid,ppid,args | grep "${processName}" | grep -v grep`;
    }

    parseProcessInfo(stdout: string): ProcessInfo[] {
        logger.debug('[UnixStrategy] Parsing process info...');

        const lines = stdout.split('\n').filter(line => line.trim());
        logger.debug(`[UnixStrategy] Output contains ${lines.length} lines`);

        const currentPid = process.pid;
        const candidates: Array<{ pid: number; ppid: number; extensionPort: number; csrfToken: string }> = [];

        for (const line of lines) {
            // ps -ww -eo pid,ppid,args format: "  PID  PPID COMMAND..."
            const parts = line.trim().split(/\s+/);
            if (parts.length < 3) {
                continue;
            }

            const pid = parseInt(parts[0], 10);
            const ppid = parseInt(parts[1], 10);
            const cmd = parts.slice(2).join(' ');

            if (isNaN(pid) || isNaN(ppid)) {
                continue;
            }

            const portMatch = cmd.match(/--extension_server_port[=\s]+(\d+)/);
            const tokenMatch = cmd.match(/--csrf_token[=\s]+([a-zA-Z0-9-]+)/i);

            // Must satisfy both: Has csrf_token and IS Antigravity process
            if (tokenMatch?.[1] && this.isAntigravityProcess(cmd)) {
                const extensionPort = portMatch?.[1] ? parseInt(portMatch[1], 10) : 0;
                const csrfToken = tokenMatch[1];
                candidates.push({ pid, ppid, extensionPort, csrfToken });
                logger.debug(`[UnixStrategy] Found candidate: PID=${pid}, PPID=${ppid}, ExtPort=${extensionPort}`);
            }
        }

        if (candidates.length === 0) {
            logger.warn('[UnixStrategy] No Antigravity process found');
            return [];
        }

        // Unix platform sort strategy: Child process of current process > Other processes
        // To improve success rate, we put child process first, but return all candidates
        return candidates.sort((a, b) => {
            if (a.ppid === currentPid) { return -1; }
            if (b.ppid === currentPid) { return 1; }
            return 0;
        });
    }

    getPortListCommand(pid: number): string {
        // Save target PID
        this.targetPid = pid;

        // macOS: Prefer lsof
        if (this.platform === 'darwin') {
            return `lsof -nP -a -iTCP -sTCP:LISTEN -p ${pid} 2>/dev/null | grep -E "^\\S+\\s+${pid}\\s"`;
        }

        // Linux: Choose based on detected available command
        switch (this.availablePortCommand) {
            case 'lsof':
                return `lsof -nP -a -iTCP -sTCP:LISTEN -p ${pid} 2>/dev/null | grep -E "^\\S+\\s+${pid}\\s"`;
            case 'ss':
                return `ss -tlnp 2>/dev/null | grep "pid=${pid},"`;
            case 'netstat':
                return `netstat -tulpn 2>/dev/null | grep ${pid}`;
            default:
                // Fallback: Try multiple commands
                return `ss -tlnp 2>/dev/null | grep "pid=${pid}," || lsof -nP -a -iTCP -sTCP:LISTEN -p ${pid} 2>/dev/null | grep -E "^\\S+\\s+${pid}\\s" || netstat -tulpn 2>/dev/null | grep ${pid}`;
        }
    }

    /**
     * Ensure port detection command is available (Call before getting port list)
     */
    async ensurePortCommandAvailable(): Promise<void> {
        await this.detectAvailablePortCommand();
    }

    parseListeningPorts(stdout: string): number[] {
        const ports: number[] = [];

        if (this.platform === 'darwin') {
            // macOS lsof output format (already filtered by PID with grep):
            // language_ 15684 jieli   12u  IPv4 0x310104...    0t0  TCP *:53125 (LISTEN)

            const lines = stdout.split('\n');
            logger.debug(`[UnixStrategy] lsof output ${lines.length} lines (filtered PID: ${this.targetPid})`);

            for (const line of lines) {
                if (!line.trim()) {
                    continue;
                }

                logger.debug(`[UnixStrategy] Parsing line: ${line.substring(0, 80)}...`);

                // Check if LISTEN state
                if (!line.includes('(LISTEN)')) {
                    continue;
                }

                // Extract port number - match *:PORT or IP:PORT format
                const portMatch = line.match(/[*\d.:]+:(\d+)\s+\(LISTEN\)/);
                if (portMatch) {
                    const port = parseInt(portMatch[1], 10);
                    if (!ports.includes(port)) {
                        ports.push(port);
                        logger.debug(`[UnixStrategy] ✅ Found port: ${port}`);
                    }
                }
            }

            logger.info(`[UnixStrategy] Parsed ${ports.length} target process ports: ${ports.join(', ') || '(none)'}`);
        } else {
            const ssRegex = /LISTEN\s+\d+\s+\d+\s+(?:\*|[\d.]+|\[[\da-f:]*\]):(\d+)/gi;
            let match;
            while ((match = ssRegex.exec(stdout)) !== null) {
                const port = parseInt(match[1], 10);
                if (!ports.includes(port)) {
                    ports.push(port);
                }
            }

            if (ports.length === 0) {
                const lsofRegex = /(?:TCP|UDP)\s+(?:\*|[\d.]+|\[[\da-f:]+\]):(\d+)\s+\(LISTEN\)/gi;
                while ((match = lsofRegex.exec(stdout)) !== null) {
                    const port = parseInt(match[1], 10);
                    if (!ports.includes(port)) {
                        ports.push(port);
                    }
                }
            }
        }

        logger.debug(`[UnixStrategy] Parsed ${ports.length} ports: ${ports.join(', ')}`);
        return ports.sort((a, b) => a - b);
    }

    getErrorMessages(): { processNotFound: string; commandNotAvailable: string; requirements: string[] } {
        return {
            processNotFound: 'Process not found',
            commandNotAvailable: 'Command check failed',
            requirements: ['lsof or netstat'],
        };
    }

    getDiagnosticCommand(): string {
        // List all processes containing 'language' or 'antigravity'
        return 'ps aux | grep -E \'language|antigravity\' | grep -v grep';
    }
}

// Export for backward compatibility
export type platform_strategy = PlatformStrategy;
