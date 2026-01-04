/**
 * Antigravity Cockpit - Auto Trigger Tab JS (Compact Layout)
 * Auto Trigger Frontend Logic - Compact Layout Version
 */

(function() {
    'use strict';

    // Get VS Code API
    const vscode = window.__vscodeApi || (window.__vscodeApi = acquireVsCodeApi());

    // Localization
    const i18n = window.__autoTriggerI18n || {};
    const t = (key) => i18n[key] || key;

    const baseTimeOptions = ['06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '14:00', '16:00', '18:00', '20:00', '22:00'];

    // State
    let currentState = null;
    let availableModels = [];
    let selectedModels = [];  // Get from state.schedule.selectedModels
    let testSelectedModels = [];
    
    // Config State
    let configEnabled = false;
    let configMode = 'daily';
    let configDailyTimes = ['08:00'];
    let configWeeklyDays = [1, 2, 3, 4, 5];
    let configWeeklyTimes = ['08:00'];
    let configIntervalHours = 4;
    let configIntervalStart = '07:00';
    let configIntervalEnd = '22:00';
    const baseDailyTimes = [...baseTimeOptions];
    const baseWeeklyTimes = [...baseTimeOptions];

    // ============ Initialization ============

    function init() {
        vscode.postMessage({ command: 'autoTrigger.getState' });
        bindEvents();
    }

    function bindEvents() {
        // Auth Button
        document.getElementById('at-auth-btn')?.addEventListener('click', () => {
            vscode.postMessage({ command: 'autoTrigger.authorize' });
        });

        // Config Button
        document.getElementById('at-config-btn')?.addEventListener('click', openConfigModal);
        document.getElementById('at-config-close')?.addEventListener('click', closeConfigModal);
        document.getElementById('at-config-cancel')?.addEventListener('click', closeConfigModal);
        document.getElementById('at-config-save')?.addEventListener('click', saveConfig);

        // Test Button
        document.getElementById('at-test-btn')?.addEventListener('click', openTestModal);
        document.getElementById('at-test-close')?.addEventListener('click', closeTestModal);
        document.getElementById('at-test-cancel')?.addEventListener('click', closeTestModal);
        document.getElementById('at-test-run')?.addEventListener('click', runTest);

        // History Button
        document.getElementById('at-history-btn')?.addEventListener('click', openHistoryModal);
        document.getElementById('at-history-close')?.addEventListener('click', closeHistoryModal);

        // Revoke Confirmation Modal
        document.getElementById('at-revoke-close')?.addEventListener('click', closeRevokeModal);
        document.getElementById('at-revoke-cancel')?.addEventListener('click', closeRevokeModal);
        document.getElementById('at-revoke-confirm')?.addEventListener('click', confirmRevoke);

        // Clear History
        document.getElementById('at-history-clear')?.addEventListener('click', () => {
            vscode.postMessage({ command: 'autoTrigger.clearHistory' });
            closeHistoryModal();
        });

        // Mode Selection
        document.getElementById('at-mode-select')?.addEventListener('change', (e) => {
            configMode = e.target.value;
            updateModeConfigVisibility();
            updateTimeChips();
            updatePreview();
        });

        // Enable Toggle
        document.getElementById('at-enable-schedule')?.addEventListener('change', (e) => {
            configEnabled = e.target.checked;
            updateModeConfigVisibility(); // Enable/Disable mode selector
        });

        // Time Selection - Daily
        document.getElementById('at-daily-times')?.addEventListener('click', (e) => {
            if (e.target.classList.contains('at-chip')) {
                const time = e.target.dataset.time;
                toggleTimeSelection(time, 'daily');
                updatePreview();
            }
        });

        bindCustomTimeInput('at-daily-custom-time', 'at-daily-add-time', 'daily');

        // Time Selection - Weekly
        document.getElementById('at-weekly-times')?.addEventListener('click', (e) => {
            if (e.target.classList.contains('at-chip')) {
                const time = e.target.dataset.time;
                toggleTimeSelection(time, 'weekly');
                updatePreview();
            }
        });

        bindCustomTimeInput('at-weekly-custom-time', 'at-weekly-add-time', 'weekly');

        // Day Selection
        document.getElementById('at-weekly-days')?.addEventListener('click', (e) => {
            if (e.target.classList.contains('at-chip')) {
                const day = parseInt(e.target.dataset.day, 10);
                toggleDaySelection(day);
                updatePreview();
            }
        });

        // Quick Buttons
        document.querySelectorAll('.at-quick-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const preset = btn.dataset.preset;
                if (preset === 'workdays') configWeeklyDays = [1, 2, 3, 4, 5];
                else if (preset === 'weekend') configWeeklyDays = [0, 6];
                else if (preset === 'all') configWeeklyDays = [0, 1, 2, 3, 4, 5, 6];
                updateDayChips();
                updatePreview();
            });
        });

        // Interval Config
        document.getElementById('at-interval-hours')?.addEventListener('change', (e) => {
            configIntervalHours = parseInt(e.target.value, 10) || 4;
            updatePreview();
        });
        document.getElementById('at-interval-start')?.addEventListener('change', (e) => {
            configIntervalStart = e.target.value;
            updatePreview();
        });
        document.getElementById('at-interval-end')?.addEventListener('change', (e) => {
            configIntervalEnd = e.target.value;
            updatePreview();
        });

        // Crontab Validation
        document.getElementById('at-crontab-validate')?.addEventListener('click', () => {
            const input = document.getElementById('at-crontab-input');
            const result = document.getElementById('at-crontab-result');
            if (input && result) {
                if (input.value.trim()) {
                    result.className = 'at-crontab-result';
                    result.style.color = 'var(--vscode-charts-green)';
                    result.textContent = t('autoTrigger.validateOnSave');
                } else {
                    result.className = 'at-crontab-result';
                    result.style.color = 'var(--vscode-errorForeground)';
                    result.textContent = t('autoTrigger.crontabEmpty');
                }
            }
        });
        
        // Crontab Input Listener: Disable normal mode config when there is input
        document.getElementById('at-crontab-input')?.addEventListener('input', (e) => {
            const hasCrontab = e.target.value.trim().length > 0;
            updateCrontabExclusivity(hasCrontab);
            if (hasCrontab) {
                updatePreview();  // Refresh Preview
            }
        });

        // Close Modal on Click Outside
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.classList.add('hidden');
                }
            });
        });
    }

    // ============ Modal Operations ============

    function openConfigModal() {
        loadConfigFromState();
        renderConfigModels();
        updateModeConfigVisibility();
        updateTimeChips();
        updateDayChips();
        updatePreview();
        document.getElementById('at-config-modal')?.classList.remove('hidden');
    }

    function closeConfigModal() {
        document.getElementById('at-config-modal')?.classList.add('hidden');
    }

    function openTestModal() {
        // Get available model IDs
        const availableIds = availableModels.map(m => m.id);
        
        // Filter selectedModels to keep only those in available model list
        const validSelected = selectedModels.filter(id => availableIds.includes(id));
        
        if (validSelected.length > 0) {
            testSelectedModels = [...validSelected];
        } else if (availableModels.length > 0) {
            // If no valid selection, default to the first available model
            testSelectedModels = [availableModels[0].id];
        } else {
            testSelectedModels = [];
        }
        
        renderTestModels();
        document.getElementById('at-test-modal')?.classList.remove('hidden');
    }

    function closeTestModal() {
        document.getElementById('at-test-modal')?.classList.add('hidden');
    }

    function openHistoryModal() {
        renderHistory();
        document.getElementById('at-history-modal')?.classList.remove('hidden');
    }

    function closeHistoryModal() {
        document.getElementById('at-history-modal')?.classList.add('hidden');
    }

    function openRevokeModal() {
        document.getElementById('at-revoke-modal')?.classList.remove('hidden');
    }

    function closeRevokeModal() {
        document.getElementById('at-revoke-modal')?.classList.add('hidden');
    }

    function confirmRevoke() {
        vscode.postMessage({ command: 'autoTrigger.revoke' });
        closeRevokeModal();
    }

    // ============ Config Operations ============

    function loadConfigFromState() {
        if (!currentState?.schedule) return;
        
        const s = currentState.schedule;
        configEnabled = s.enabled || false;
        configMode = s.repeatMode || 'daily';
        configDailyTimes = s.dailyTimes || ['08:00'];
        configWeeklyDays = s.weeklyDays || [1, 2, 3, 4, 5];
        configWeeklyTimes = s.weeklyTimes || ['08:00'];
        configIntervalHours = s.intervalHours || 4;
        configIntervalStart = s.intervalStartTime || '07:00';
        configIntervalEnd = s.intervalEndTime || '22:00';
        selectedModels = s.selectedModels || ['gemini-3-flash'];

        document.getElementById('at-enable-schedule').checked = configEnabled;
        document.getElementById('at-mode-select').value = configMode;
        document.getElementById('at-interval-hours').value = configIntervalHours;
        document.getElementById('at-interval-start').value = configIntervalStart;
        
        // Restore Crontab
        const crontabInput = document.getElementById('at-crontab-input');
        if (crontabInput) {
            crontabInput.value = s.crontab || '';
            // Update exclusivity state (Disable above config if Crontab is present)
            updateCrontabExclusivity(!!s.crontab);
        }
        document.getElementById('at-interval-end').value = configIntervalEnd;
    }

    function saveConfig() {
        const config = {
            enabled: configEnabled,
            repeatMode: configMode,
            dailyTimes: configDailyTimes,
            weeklyDays: configWeeklyDays,
            weeklyTimes: configWeeklyTimes,
            intervalHours: configIntervalHours,
            intervalStartTime: configIntervalStart,
            intervalEndTime: configIntervalEnd,
            selectedModels: selectedModels.length > 0 ? selectedModels : ['gemini-3-flash'],
            crontab: document.getElementById('at-crontab-input')?.value.trim() || undefined,
        };

        vscode.postMessage({
            command: 'autoTrigger.saveSchedule',
            schedule: config,
        });

        closeConfigModal();
    }

    let isTestRunning = false;  // Prevent duplicate clicks

    function getTestSelectedModelsFromDom() {
        const container = document.getElementById('at-test-models');
        if (!container) return [];
        return Array.from(container.querySelectorAll('.at-model-item.selected'))
            .map(el => el.dataset.model)
            .filter(Boolean);
    }
    
    function runTest() {
        if (isTestRunning) return;

        const pickedModels = getTestSelectedModelsFromDom();
        if (pickedModels.length > 0) {
            testSelectedModels = pickedModels;
        }
        
        if (testSelectedModels.length === 0) {
            // Use first available model as default
            const defaultModel = availableModels.length > 0 ? availableModels[0].id : 'gemini-3-flash';
            testSelectedModels = [defaultModel];
        }
        
        // Set loading state
        isTestRunning = true;
        const runBtn = document.getElementById('at-test-run');
        if (runBtn) {
            runBtn.disabled = true;
            runBtn.innerHTML = `<span class="at-spinner"></span> ${t('autoTrigger.testing')}`;
        }
        
        // Close modal
        closeTestModal();
        
        // Show status hint
        showTestingStatus();
        
        vscode.postMessage({
            command: 'autoTrigger.test',
            models: [...testSelectedModels],
        });
    }
    
    function showTestingStatus() {
        const statusCard = document.getElementById('at-status-card');
        if (!statusCard) return;
        
        // Add testing in progress banner
        let testingBanner = document.getElementById('at-testing-banner');
        if (!testingBanner) {
            testingBanner = document.createElement('div');
            testingBanner.id = 'at-testing-banner';
            testingBanner.className = 'at-testing-banner';
            statusCard.insertBefore(testingBanner, statusCard.firstChild);
        }
        testingBanner.innerHTML = `<span class="at-spinner"></span> ${t('autoTrigger.testingPleaseWait')}`;
        testingBanner.classList.remove('hidden');
    }
    
    function hideTestingStatus() {
        const testingBanner = document.getElementById('at-testing-banner');
        if (testingBanner) {
            testingBanner.classList.add('hidden');
        }
        
        // Reset button state
        isTestRunning = false;
        const runBtn = document.getElementById('at-test-run');
        if (runBtn) {
            runBtn.disabled = false;
            runBtn.innerHTML = `🚀 ${t('autoTrigger.runTest')}`;
        }
    }

    // ============ UI Update ============

    function updateCrontabExclusivity(hasCrontab) {
        // Disable normal mode config when Crontab has content
        const modeSelect = document.getElementById('at-mode-select');
        const dailyConfig = document.getElementById('at-config-daily');
        const weeklyConfig = document.getElementById('at-config-weekly');
        const intervalConfig = document.getElementById('at-config-interval');
        
        if (hasCrontab) {
            // Disable mode selection and configuration
            if (modeSelect) modeSelect.disabled = true;
            dailyConfig?.classList.add('at-disabled');
            weeklyConfig?.classList.add('at-disabled');
            intervalConfig?.classList.add('at-disabled');
        } else {
            // Restore
            if (modeSelect) modeSelect.disabled = false;
            dailyConfig?.classList.remove('at-disabled');
            weeklyConfig?.classList.remove('at-disabled');
            intervalConfig?.classList.remove('at-disabled');
        }
    }

    function updateModeConfigVisibility() {
        document.getElementById('at-config-daily')?.classList.toggle('hidden', configMode !== 'daily');
        document.getElementById('at-config-weekly')?.classList.toggle('hidden', configMode !== 'weekly');
        document.getElementById('at-config-interval')?.classList.toggle('hidden', configMode !== 'interval');
    }

    function updateTimeChips() {
        const times = configMode === 'daily' ? configDailyTimes : configWeeklyTimes;
        const containerId = configMode === 'daily' ? 'at-daily-times' : 'at-weekly-times';
        const baseTimes = configMode === 'daily' ? baseDailyTimes : baseWeeklyTimes;
        const container = document.getElementById(containerId);
        if (!container) return;

        container.querySelectorAll('.at-chip[data-custom="true"]').forEach(chip => {
            if (!times.includes(chip.dataset.time)) {
                chip.remove();
            }
        });

        times.forEach(time => {
            if (!baseTimes.includes(time) && !container.querySelector(`.at-chip[data-time="${time}"]`)) {
                const chip = document.createElement('div');
                chip.className = 'at-chip at-chip-custom';
                chip.dataset.time = time;
                chip.dataset.custom = 'true';
                chip.textContent = time;
                container.appendChild(chip);
            }
        });

        container.querySelectorAll('.at-chip').forEach(chip => {
            chip.classList.toggle('selected', times.includes(chip.dataset.time));
        });
    }

    function updateDayChips() {
        document.querySelectorAll('#at-weekly-days .at-chip').forEach(chip => {
            const day = parseInt(chip.dataset.day, 10);
            chip.classList.toggle('selected', configWeeklyDays.includes(day));
        });
    }

    function toggleTimeSelection(time, mode) {
        const arr = mode === 'daily' ? configDailyTimes : configWeeklyTimes;
        const idx = arr.indexOf(time);
        if (idx >= 0) {
            if (arr.length > 1) arr.splice(idx, 1);
        } else {
            arr.push(time);
        }
        arr.sort();
        updateTimeChips();
    }

    function bindCustomTimeInput(inputId, buttonId, mode) {
        const input = document.getElementById(inputId);
        const button = document.getElementById(buttonId);
        if (!input || !button) return;

        const addTime = () => {
            const normalized = normalizeTimeInput(input.value);
            if (!normalized) return;
            addCustomTime(normalized, mode);
            input.value = '';
            updatePreview();
        };

        button.addEventListener('click', addTime);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addTime();
            }
        });
    }

    function normalizeTimeInput(value) {
        const trimmed = String(value || '').trim();
        if (!trimmed) return null;

        const match = trimmed.match(/^(\d{1,2}):(\d{2})$/);
        if (!match) return null;

        const hour = parseInt(match[1], 10);
        const minute = parseInt(match[2], 10);
        if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
        if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

        return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }

    function addCustomTime(time, mode) {
        const arr = mode === 'daily' ? configDailyTimes : configWeeklyTimes;
        if (!arr.includes(time)) {
            arr.push(time);
            arr.sort();
        }
        updateTimeChips();
    }

    function toggleDaySelection(day) {
        const idx = configWeeklyDays.indexOf(day);
        if (idx >= 0) {
            if (configWeeklyDays.length > 1) configWeeklyDays.splice(idx, 1);
        } else {
            configWeeklyDays.push(day);
        }
        updateDayChips();
    }

    function renderConfigModels() {
        const container = document.getElementById('at-config-models');
        if (!container) return;

        if (availableModels.length === 0) {
            container.innerHTML = `<div class="at-no-data">${t('autoTrigger.noModels')}</div>`;
            return;
        }

        // availableModels is now an array of ModelInfo objects: { id, displayName, modelConstant }
        container.innerHTML = availableModels.map(model => {
            const isSelected = selectedModels.includes(model.id);
            return `<div class="at-model-item ${isSelected ? 'selected' : ''}" data-model="${model.id}">${model.displayName}</div>`;
        }).join('');

        container.querySelectorAll('.at-model-item').forEach(item => {
            item.addEventListener('click', () => {
                const modelId = item.dataset.model;
                const idx = selectedModels.indexOf(modelId);
                if (idx >= 0) {
                    if (selectedModels.length > 1) {
                        selectedModels.splice(idx, 1);
                        item.classList.remove('selected');
                    }
                } else {
                    selectedModels.push(modelId);
                    item.classList.add('selected');
                }
            });
        });
    }

    function renderTestModels() {
        const container = document.getElementById('at-test-models');
        if (!container) return;

        if (availableModels.length === 0) {
            container.innerHTML = `<div class="at-no-data">${t('autoTrigger.noModels')}</div>`;
            return;
        }

        // availableModels is now an array of ModelInfo objects: { id, displayName, modelConstant }
        // Test models are in single-selection mode
        container.innerHTML = availableModels.map(model => {
            const isSelected = testSelectedModels.length > 0 && testSelectedModels[0] === model.id;
            return `<div class="at-model-item ${isSelected ? 'selected' : ''}" data-model="${model.id}">${model.displayName}</div>`;
        }).join('');

        container.querySelectorAll('.at-model-item').forEach(item => {
            item.addEventListener('click', () => {
                const modelId = item.dataset.model;
                // Single selection mode: click to select current item, deselect others
                testSelectedModels = [modelId];
                // Update UI
                container.querySelectorAll('.at-model-item').forEach(el => {
                    el.classList.toggle('selected', el.dataset.model === modelId);
                });
            });
        });
    }

    function renderHistory() {
        const container = document.getElementById('at-history-list');
        if (!container) return;

        const triggers = currentState?.recentTriggers || [];
        
        if (triggers.length === 0) {
            container.innerHTML = `<div class="at-no-data">${t('autoTrigger.noHistory')}</div>`;
            return;
        }

        container.innerHTML = triggers.map(trigger => {
            const date = new Date(trigger.timestamp);
            const timeStr = date.toLocaleString();
            const icon = trigger.success ? '✅' : '❌';
            const statusText = trigger.success ? t('autoTrigger.success') : t('autoTrigger.failed');
            
            // Show request content and response
            let contentHtml = '';
            if (trigger.prompt) {
                contentHtml += `<div class="at-history-prompt">📤 ${escapeHtml(trigger.prompt)}</div>`;
            }
            if (trigger.message) {
                contentHtml += `<div class="at-history-response">📥 ${escapeHtml(trigger.message)}</div>`;
            }
            if (!contentHtml) {
                contentHtml = `<div class="at-history-message">${statusText}</div>`;
            }

            // Trigger type tag
            const typeLabel = trigger.triggerType === 'auto' ? t('autoTrigger.typeAuto') : t('autoTrigger.typeManual');
            const typeClass = trigger.triggerType === 'auto' ? 'at-history-type-auto' : 'at-history-type-manual';
            const typeBadge = `<span class="at-history-type-badge ${typeClass}">${typeLabel}</span>`;
            
            return `
                <div class="at-history-item">
                    <span class="at-history-icon">${icon}</span>
                    <div class="at-history-info">
                        <div class="at-history-time">${timeStr}${typeBadge}</div>
                        ${contentHtml}
                    </div>
                    ${trigger.duration ? `<span class="at-history-duration">${trigger.duration}ms</span>` : ''}
                </div>
            `;
        }).join('');
    }
    
    // HTML Escape Function
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function updatePreview() {
        const container = document.getElementById('at-next-runs');
        if (!container) return;

        // Check if there is Crontab input
        const crontabInput = document.getElementById('at-crontab-input');
        const crontab = crontabInput?.value?.trim();
        
        if (crontab) {
            // Calculate preview using Crontab
            const nextRuns = calculateCrontabNextRuns(crontab, 5);
            if (nextRuns.length === 0) {
                container.innerHTML = `<li style="color: var(--vscode-errorForeground)">Invalid Crontab expression</li>`;
                return;
            }
            container.innerHTML = nextRuns.map((date, idx) => {
                return `<li>${idx + 1}. ${formatDateTime(date)}</li>`;
            }).join('');
            return;
        }

        // Normal mode preview
        const config = {
            repeatMode: configMode,
            dailyTimes: configDailyTimes,
            weeklyDays: configWeeklyDays,
            weeklyTimes: configWeeklyTimes,
            intervalHours: configIntervalHours,
            intervalStartTime: configIntervalStart,
            intervalEndTime: configIntervalEnd,
        };

        const nextRuns = calculateNextRuns(config, 5);
        
        if (nextRuns.length === 0) {
            container.innerHTML = `<li>${t('autoTrigger.selectTimeHint')}</li>`;
            return;
        }

        container.innerHTML = nextRuns.map((iso, idx) => {
            const date = new Date(iso);
            return `<li>${idx + 1}. ${formatDateTime(date)}</li>`;
        }).join('');
    }
    
    // Parse Crontab and calculate next run time (Simplified version)
    function calculateCrontabNextRuns(crontab, count) {
        try {
            const parts = crontab.split(/\s+/);
            if (parts.length < 5) return [];
            
            const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
            const results = [];
            const now = new Date();
            
            // Simplified parsing: supports * and specific values
            const parseField = (field, max) => {
                if (field === '*') return Array.from({ length: max + 1 }, (_, i) => i);
                if (field.includes(',')) return field.split(',').map(Number);
                if (field.includes('-')) {
                    const [start, end] = field.split('-').map(Number);
                    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
                }
                if (field.includes('/')) {
                    const [, step] = field.split('/');
                    return Array.from({ length: Math.ceil(max / Number(step)) }, (_, i) => i * Number(step));
                }
                return [Number(field)];
            };
            
            const minutes = parseField(minute, 59);
            const hours = parseField(hour, 23);
            
            // Traverse the next 7 days
            for (let dayOffset = 0; dayOffset < 7 && results.length < count; dayOffset++) {
                for (const h of hours) {
                    for (const m of minutes) {
                        const date = new Date(now);
                        date.setDate(date.getDate() + dayOffset);
                        date.setHours(h, m, 0, 0);
                        if (date > now) {
                            results.push(date);
                            if (results.length >= count) break;
                        }
                    }
                    if (results.length >= count) break;
                }
            }
            
            return results;
        } catch {
            return [];
        }
    }

    function calculateNextRuns(config, count) {
        const now = new Date();
        const results = [];

        if (config.repeatMode === 'daily' && config.dailyTimes?.length) {
            for (let dayOffset = 0; dayOffset < 7 && results.length < count; dayOffset++) {
                for (const time of config.dailyTimes.sort()) {
                    const [h, m] = time.split(':').map(Number);
                    const date = new Date(now);
                    date.setDate(date.getDate() + dayOffset);
                    date.setHours(h, m, 0, 0);
                    if (date > now) {
                        results.push(date.toISOString());
                        if (results.length >= count) break;
                    }
                }
            }
        } else if (config.repeatMode === 'weekly' && config.weeklyDays?.length && config.weeklyTimes?.length) {
            for (let dayOffset = 0; dayOffset < 14 && results.length < count; dayOffset++) {
                const date = new Date(now);
                date.setDate(date.getDate() + dayOffset);
                const dayOfWeek = date.getDay();
                if (config.weeklyDays.includes(dayOfWeek)) {
                    for (const time of config.weeklyTimes.sort()) {
                        const [h, m] = time.split(':').map(Number);
                        date.setHours(h, m, 0, 0);
                        if (date > now) {
                            results.push(date.toISOString());
                            if (results.length >= count) break;
                        }
                    }
                }
            }
        } else if (config.repeatMode === 'interval') {
            const [startH, startM] = (config.intervalStartTime || '07:00').split(':').map(Number);
            const endH = config.intervalEndTime ? parseInt(config.intervalEndTime.split(':')[0], 10) : 22;
            const interval = config.intervalHours || 4;

            for (let dayOffset = 0; dayOffset < 7 && results.length < count; dayOffset++) {
                for (let h = startH; h <= endH; h += interval) {
                    const date = new Date(now);
                    date.setDate(date.getDate() + dayOffset);
                    date.setHours(h, startM, 0, 0);
                    if (date > now) {
                        results.push(date.toISOString());
                        if (results.length >= count) break;
                    }
                }
            }
        }

        return results.slice(0, count);
    }

    function formatDateTime(date) {
        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const timeStr = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

        if (date.toDateString() === now.toDateString()) {
            return `${t('time.today')} ${timeStr}`;
        } else if (date.toDateString() === tomorrow.toDateString()) {
            return `${t('time.tomorrow')} ${timeStr}`;
        } else {
            const dayKeys = ['time.sunday', 'time.monday', 'time.tuesday', 'time.wednesday', 
                           'time.thursday', 'time.friday', 'time.saturday'];
            return `${t(dayKeys[date.getDay()])} ${timeStr}`;
        }
    }

    // ============ State Update ============

    function updateState(state) {
        currentState = state;
        availableModels = state.availableModels || [];
        
        if (state.schedule?.selectedModels) {
            selectedModels = state.schedule.selectedModels;
        }

        // Hide testing status (receiving new state means test completed)
        hideTestingStatus();
        
        updateAuthUI(state.authorization);
        updateStatusUI(state);
        updateHistoryCount(state.recentTriggers?.length || 0);
    }

    function updateAuthUI(auth) {
        const authRow = document.getElementById('at-auth-row');
        const statusGrid = document.getElementById('at-status-grid');
        const actions = document.getElementById('at-actions');

        if (!authRow) return;

        if (auth?.isAuthorized) {
            authRow.innerHTML = `
                <div class="at-auth-info">
                    <span class="at-auth-icon">✅</span>
                    <span class="at-auth-text">${t('autoTrigger.authorized')}</span>
                    <span class="at-auth-email">${auth.email || ''}</span>
                </div>
                <div class="at-auth-actions">
                    <button id="at-reauth-btn" class="at-btn at-btn-secondary">${t('autoTrigger.reauthorizeBtn')}</button>
                    <button id="at-revoke-btn" class="at-btn at-btn-danger">${t('autoTrigger.revokeBtn')}</button>
                </div>
            `;
            statusGrid?.classList.remove('hidden');
            actions?.classList.remove('hidden');

            // Re-bind button events
            document.getElementById('at-reauth-btn')?.addEventListener('click', () => {
                vscode.postMessage({ command: 'autoTrigger.authorize' });
            });
            document.getElementById('at-revoke-btn')?.addEventListener('click', () => {
                openRevokeModal();
            });
        } else {
            authRow.innerHTML = `
                <div class="at-auth-info">
                    <span class="at-auth-icon">⚠️</span>
                    <span class="at-auth-text">${t('autoTrigger.unauthorized')}</span>
                </div>
                <div class="at-auth-actions">
                    <button id="at-auth-btn" class="at-btn at-btn-primary">${t('autoTrigger.authorizeBtn')}</button>
                </div>
            `;
            statusGrid?.classList.add('hidden');
            actions?.classList.add('hidden');

            document.getElementById('at-auth-btn')?.addEventListener('click', () => {
                vscode.postMessage({ command: 'autoTrigger.authorize' });
            });
        }
    }

    function updateStatusUI(state) {
        const schedule = state.schedule || {};
        
        // Status
        const statusValue = document.getElementById('at-status-value');
        if (statusValue) {
            statusValue.textContent = schedule.enabled ? t('autoTrigger.enabled') : t('autoTrigger.disabled');
            statusValue.style.color = schedule.enabled ? 'var(--vscode-charts-green)' : '';
        }

        // Update Tab Status Dot
        const tabDot = document.getElementById('at-tab-status-dot');
        if (tabDot) {
            // Only show status dot if authorized and enabled
            const isAuthorized = state.authorization?.isAuthorized;
            const isEnabled = schedule.enabled;
            if (isAuthorized && isEnabled) {
                tabDot.classList.remove('hidden');
            } else {
                tabDot.classList.add('hidden');
            }
        }

        // Mode - Supports Crontab
        const modeValue = document.getElementById('at-mode-value');
        if (modeValue) {
            let modeText = '--';
            if (schedule.crontab) {
                // Crontab Mode
                modeText = `Crontab: ${schedule.crontab}`;
            } else if (schedule.repeatMode === 'daily' && schedule.dailyTimes?.length) {
                modeText = `${t('autoTrigger.daily')} ${schedule.dailyTimes[0]}`;
            } else if (schedule.repeatMode === 'weekly') {
                modeText = `${t('autoTrigger.weekly')}`;
            } else if (schedule.repeatMode === 'interval') {
                modeText = `${t('autoTrigger.interval')} ${schedule.intervalHours || 4}h`;
            }
            modeValue.textContent = modeText;
        }

        // Models - Show full names of all selected models
        const modelsValue = document.getElementById('at-models-value');
        if (modelsValue) {
            const modelIds = schedule.selectedModels || ['gemini-3-flash'];
            // Find displayName from availableModels
            const getDisplayName = (id) => {
                const model = availableModels.find(m => m.id === id);
                return model?.displayName || id;
            };
            // Show all model names, comma separated
            const allNames = modelIds.map(id => getDisplayName(id));
            modelsValue.textContent = allNames.join(', ');
        }

        // Next Trigger
        const nextValue = document.getElementById('at-next-value');
        if (nextValue) {
            // Use correct field name nextTriggerTime
            if (schedule.enabled && state.nextTriggerTime) {
                const nextDate = new Date(state.nextTriggerTime);
                nextValue.textContent = formatDateTime(nextDate);
            } else if (schedule.enabled && schedule.crontab) {
                // If Crontab exists, calculate next trigger time on frontend
                const nextRuns = calculateCrontabNextRuns(schedule.crontab, 1);
                if (nextRuns.length > 0) {
                    nextValue.textContent = formatDateTime(nextRuns[0]);
                } else {
                    nextValue.textContent = '--';
                }
            } else {
                nextValue.textContent = '--';
            }
        }
    }

    function updateHistoryCount(count) {
        const countEl = document.getElementById('at-history-count');
        if (countEl) {
            countEl.textContent = `(${count})`;
        }
    }

    // ============ Message Listening ============

    window.addEventListener('message', event => {
        const message = event.data;
        
        switch (message.type) {
            case 'autoTriggerState':
                updateState(message.data);
                break;
        }
    });

    // Export
    window.AutoTriggerTab = {
        init,
        updateState,
    };

    // Initialization
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
