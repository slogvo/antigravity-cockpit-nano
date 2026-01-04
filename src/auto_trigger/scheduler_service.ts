/**
 * Antigravity Cockpit - Scheduler Service
 * Scheduler Service: parse cron expressions, calculate next run time, manage scheduled tasks
 */

import { ScheduleConfig, ScheduleRepeatMode, DayOfWeek, CrontabParseResult } from './types';
import { CronExpressionParser } from 'cron-parser';
import { logger } from '../shared/log_service';

const MAX_TIMER_DELAY_MS = 2_147_483_647; // setTimeout max delay approx 24.8 days
const LOCAL_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/**
 * Cron Expression Parser
 * Supports standard 5-field format: minute hour day month day-of-week
 */
class CronParser {
    /**
     * Convert visual configuration to crontab expression
     */
    static configToCrontab(config: ScheduleConfig): string {
        switch (config.repeatMode) {
            case 'daily':
                return this.dailyToCrontab(config.dailyTimes || []);
            case 'weekly':
                return this.weeklyToCrontab(config.weeklyDays || [], config.weeklyTimes || []);
            case 'interval':
                return this.intervalToCrontab(
                    config.intervalHours || 4,
                    config.intervalStartTime || '00:00',
                    config.intervalEndTime
                );
            default:
                return '0 8 * * *'; // Default daily 8:00
        }
    }

    /**
     * Daily mode to crontab
     * Example: ["07:00", "12:00", "17:00"] -> "0 7,12,17 * * *"
     */
    private static dailyToCrontab(times: string[]): string {
        if (times.length === 0) {
            return '0 8 * * *';
        }

        const hours = new Set<number>();
        const minutes = new Set<number>();

        for (const time of times) {
            const [h, m] = time.split(':').map(Number);
            hours.add(h);
            minutes.add(m);
        }

        // If minutes are same for all times, use simple format
        if (minutes.size === 1) {
            const minute = Array.from(minutes)[0];
            const hourList = Array.from(hours).sort((a, b) => a - b).join(',');
            return `${minute} ${hourList} * * *`;
        }

        // Otherwise need multiple expressions (return expression for first time point)
        const [h, m] = times[0].split(':').map(Number);
        return `${m} ${h} * * *`;
    }

    /**
     * Weekly mode to crontab
     * Example: days=[1,2,3,4,5], times=["08:00"] -> "0 8 * * 1-5"
     */
    private static weeklyToCrontab(days: number[], times: string[]): string {
        if (days.length === 0 || times.length === 0) {
            return '0 8 * * 1-5';
        }

        const sortedDays = [...days].sort((a, b) => a - b);
        let dayExpr: string;

        // Check if consecutive
        if (this.isConsecutive(sortedDays)) {
            dayExpr = `${sortedDays[0]}-${sortedDays[sortedDays.length - 1]}`;
        } else {
            dayExpr = sortedDays.join(',');
        }

        const [h, m] = times[0].split(':').map(Number);
        return `${m} ${h} * * ${dayExpr}`;
    }

    /**
     * Interval mode to crontab
     * Example: interval=4, start="07:00", end="23:00" -> "0 7,11,15,19,23 * * *"
     */
    private static intervalToCrontab(
        intervalHours: number,
        startTime: string,
        endTime?: string
    ): string {
        const [startH, startM] = startTime.split(':').map(Number);
        const endH = endTime ? parseInt(endTime.split(':')[0], 10) : 23;

        const hours: number[] = [];
        for (let h = startH; h <= endH; h += intervalHours) {
            hours.push(h);
        }

        if (hours.length === 0) {
            hours.push(startH);
        }

        return `${startM} ${hours.join(',')} * * *`;
    }

    /**
     * Check if array is consecutive
     */
    private static isConsecutive(arr: number[]): boolean {
        if (arr.length <= 1) return true;
        for (let i = 1; i < arr.length; i++) {
            if (arr[i] !== arr[i - 1] + 1) {
                return false;
            }
        }
        return true;
    }

    /**
     * Parse crontab expression
     */
    static parse(crontab: string): CrontabParseResult {
        try {
            const parts = crontab.trim().split(/\s+/);
            if (parts.length !== 5) {
                return {
                    valid: false,
                    error: 'Invalid crontab format, 5 fields required',
                };
            }

            const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

            // Generate human-readable description
            const description = this.generateDescription(minute, hour, dayOfMonth, month, dayOfWeek);

            const interval = CronExpressionParser.parse(crontab, {
                currentDate: new Date(),
                tz: LOCAL_TIMEZONE,
            });
            const nextRuns: Date[] = [];
            for (let i = 0; i < 5; i++) {
                nextRuns.push(interval.next().toDate());
            }

            return {
                valid: true,
                description,
                nextRuns,
            };
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            return {
                valid: false,
                error: err.message,
            };
        }
    }

    /**
     * Generate Human-Readable Description
     */
    private static generateDescription(
        minute: string,
        hour: string,
        dayOfMonth: string,
        month: string,
        dayOfWeek: string
    ): string {
        if (dayOfMonth !== '*' || month !== '*') {
            return 'Custom Schedule';
        }

        if (minute.includes('/') || hour.includes('/') || dayOfWeek.includes('/')) {
            return 'Custom Schedule';
        }

        const parts: string[] = [];

        // Time Description
        if (minute === '0' && hour === '*') {
            parts.push('Every hour on the hour');
        } else if (minute.includes(',') && hour.includes(',')) {
            parts.push(`Every day at ${hour.replace(',', ', ')}:${minute}`);
        } else if (hour.includes(',')) {
            parts.push(`Every day at ${hour.split(',').map(h => `${h}:${minute.padStart(2, '0')}`).join(', ')}`);
        } else if (hour !== '*' && minute !== '*') {
            parts.push(`Every day at ${hour}:${minute.padStart(2, '0')}`);
        }

        // Day of Week Description
        if (dayOfWeek !== '*') {
            const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            if (dayOfWeek === '1-5') {
                parts.push('Weekdays');
            } else if (dayOfWeek === '0,6' || dayOfWeek === '6,0') {
                parts.push('Weekends');
            } else {
                const days = this.expandField(dayOfWeek, 0, 6).map(d => dayNames[d]);
                parts.push(days.join(', '));
            }
        }

        return parts.join(' ') || 'Custom Schedule';
    }

    /**
     * Expand cron field to number array
     */
    private static expandField(field: string, min: number, max: number): number[] {
        if (field === '*') {
            return Array.from({ length: max - min + 1 }, (_, i) => min + i);
        }

        const result: number[] = [];

        for (const part of field.split(',')) {
            if (part.includes('-')) {
                const [start, end] = part.split('-').map(Number);
                for (let i = start; i <= end; i++) {
                    result.push(i);
                }
            } else if (part.startsWith('*/')) {
                const step = parseInt(part.slice(2), 10);
                for (let i = min; i <= max; i += step) {
                    result.push(i);
                }
            } else {
                result.push(parseInt(part, 10));
            }
        }

        return [...new Set(result)].sort((a, b) => a - b);
    }

    /**
     * Calculate next n run times
     */
    static getNextRuns(crontab: string, count: number): Date[] {
        try {
            const results: Date[] = [];
            const interval = CronExpressionParser.parse(crontab, {
                currentDate: new Date(),
                tz: LOCAL_TIMEZONE,
            });

            for (let i = 0; i < count; i++) {
                results.push(interval.next().toDate());
            }

            return results;
        } catch {
            return [];
        }
    }
}

/**
 * Scheduler Service
 */
class SchedulerService {
    private timer?: ReturnType<typeof setTimeout>;
    private schedule?: ScheduleConfig;
    private onTrigger?: () => Promise<void>;

    /**
     * Set Schedule Configuration
     */
    setSchedule(config: ScheduleConfig, onTrigger: () => Promise<void>): void {
        this.schedule = config;
        this.onTrigger = onTrigger;

        if (config.enabled) {
            this.start();
        } else {
            this.stop();
        }
    }

    /**
     * Start Scheduler
     */
    start(): void {
        if (!this.schedule || !this.onTrigger) {
            logger.warn('[SchedulerService] Cannot start: no schedule or trigger handler');
            return;
        }

        if (this.timer) {
            logger.info('[SchedulerService] Scheduler already running, restarting...');
            this.stop();
        }

        this.scheduleNextRun();
        logger.info('[SchedulerService] Scheduler started');
    }

    /**
     * Stop Scheduler
     */
    stop(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        logger.info('[SchedulerService] Scheduler stopped');
    }

    /**
     * Get Next Run Time
     */
    getNextRunTime(): Date | null {
        if (!this.schedule || !this.schedule.enabled) {
            return null;
        }

        const crontab = this.schedule.crontab || CronParser.configToCrontab(this.schedule);
        const nextRuns = CronParser.getNextRuns(crontab, 1);
        return nextRuns.length > 0 ? nextRuns[0] : null;
    }

    /**
     * Parse configuration and return description
     */
    describeSchedule(config: ScheduleConfig): string {
        const crontab = config.crontab || CronParser.configToCrontab(config);
        const result = CronParser.parse(crontab);
        return result.description || crontab;
    }

    /**
     * Validate crontab expression
     */
    validateCrontab(crontab: string): CrontabParseResult {
        return CronParser.parse(crontab);
    }

    /**
     * Convert Configuration to crontab
     */
    configToCrontab(config: ScheduleConfig): string {
        return CronParser.configToCrontab(config);
    }

    /**
     * Schedule Next Run
     */
    private scheduleNextRun(): void {
        if (!this.schedule || !this.onTrigger) return;

        const nextRun = this.getNextRunTime();
        if (!nextRun) {
            logger.warn('[SchedulerService] No next run time calculated');
            return;
        }

        const delay = nextRun.getTime() - Date.now();
        if (delay < 0) {
            // If passed, recalculate next minute
            this.timer = setTimeout(() => this.scheduleNextRun(), 60000);
            return;
        }

        if (delay > MAX_TIMER_DELAY_MS) {
            logger.info('[SchedulerService] Next run is far in the future; scheduling a checkpoint.');
            this.timer = setTimeout(() => this.scheduleNextRun(), MAX_TIMER_DELAY_MS);
            return;
        }

        logger.info(`[SchedulerService] Next run scheduled at ${nextRun.toLocaleString()} (in ${Math.round(delay / 60000)} minutes)`);

        this.timer = setTimeout(async () => {
            try {
                logger.info('[SchedulerService] Executing scheduled trigger');
                await this.onTrigger!();
            } catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                logger.error(`[SchedulerService] Trigger failed: ${err.message}`);
            }

            // Schedule next run (if still enabled)
            if (this.schedule && this.schedule.enabled) {
                this.scheduleNextRun();
            } else {
                logger.info('[SchedulerService] Schedule disabled, stopping loop');
                this.timer = undefined;
            }
        }, delay);
    }
}

// Export Singleton and Utilities
export const schedulerService = new SchedulerService();
export { CronParser };
