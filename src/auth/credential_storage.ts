/**
 * Antigravity Nano - Credential Storage
 * Simplified version that reads credentials from shared folder
 * (synced by vscode-antigravity-cockpit)
 */

import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { OAuthCredential, AccountInfo, AuthorizationStatus } from './types';
import { logger } from '../shared/log_service';

const CREDENTIALS_KEY = 'antigravity.nano.credentials';
const ACTIVE_ACCOUNT_KEY = 'antigravity.nano.activeAccount';
const IS_MANUAL_ACCOUNT_KEY = 'antigravity.nano.isManualAccount';
const DISCOVERED_EMAILS_KEY = 'antigravity.nano.discoveredEmails';
const FILE_WATCH_DEBOUNCE_MS = 1000;

interface CredentialsStorage {
    accounts: Record<string, OAuthCredential>;
}

interface SharedCredentials {
    accounts: Record<string, {
        email: string;
        accessToken: string;
        refreshToken: string;
        expiresAt: string;
        projectId?: string;
    }>;
}

class CredentialStorage {
    private secretStorage?: vscode.SecretStorage;
    private globalState?: vscode.Memento;
    private initialized = false;
    private fileWatcher?: fs.FSWatcher;
    private debounceTimer?: ReturnType<typeof setTimeout>;

    initialize(context: vscode.ExtensionContext): void {
        this.secretStorage = context.secrets;
        this.globalState = context.globalState;
        this.initialized = true;
        logger.info('[CredentialStorage] Initialized');
        
        // Try to import from shared folder on init
        this.importFromSharedFolder();
        
        // Start watching shared folder for runtime changes
        this.startFileWatcher();

        // Scan for local IDE accounts for easier discovery
        this.scanLocalIdeAccounts();
    }

    private ensureInitialized(): void {
        if (!this.initialized || !this.secretStorage || !this.globalState) {
            throw new Error('CredentialStorage not initialized');
        }
    }

    private getSharedDir(): string {
        return path.join(os.homedir(), '.antigravity_cockpit');
    }

    /**
     * Start watching shared folder for credential changes
     */
    private startFileWatcher(): void {
        const sharedDir = this.getSharedDir();
        
        if (!fs.existsSync(sharedDir)) {
            logger.debug(`[CredentialStorage] Shared folder not found: ${sharedDir}, skipping file watcher`);
            return;
        }

        try {
            this.fileWatcher = fs.watch(sharedDir, (eventType, filename) => {
                if (!filename) {return;}
                
                const relevantFiles = ['credentials.json', 'current_account.json'];
                if (!relevantFiles.includes(filename)) {return;}

                logger.debug(`[CredentialStorage] File change detected: ${filename} (${eventType})`);

                // Debounce to avoid multiple triggers
                if (this.debounceTimer) {
                    clearTimeout(this.debounceTimer);
                }
                this.debounceTimer = setTimeout(() => {
                    logger.info(`[CredentialStorage] Re-syncing from shared folder (triggered by ${filename} change)`);
                    this.importFromSharedFolder();
                }, FILE_WATCH_DEBOUNCE_MS);
            });

            logger.info(`[CredentialStorage] File watcher started on: ${sharedDir}`);
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.warn(`[CredentialStorage] Failed to start file watcher: ${err.message}`);
        }
    }

    /**
     * Full sync credentials from shared folder (cockpit is source of truth)
     * - Always updates existing accounts with latest credentials
     * - Removes accounts that no longer exist in shared file
     * - Ensures active account is valid
     */
    async importFromSharedFolder(): Promise<void> {
        try {
            const sharedDir = this.getSharedDir();
            const credentialsFile = path.join(sharedDir, 'credentials.json');
            
            logger.debug(`[CredentialStorage] Reading shared file: ${credentialsFile}`);
            
            if (!fs.existsSync(credentialsFile)) {
                logger.info('[CredentialStorage] No shared credentials file found');
                return;
            }
            
            const content = fs.readFileSync(credentialsFile, 'utf-8');
            const data = JSON.parse(content) as SharedCredentials;
            
            const sharedAccountEmails = Object.keys(data.accounts || {});
            logger.debug(`[CredentialStorage] Found ${sharedAccountEmails.length} accounts in shared file: [${sharedAccountEmails.join(', ')}]`);
            
            if (!data.accounts || sharedAccountEmails.length === 0) {
                return;
            }
            
            const storage = await this.getCredentialsStorage();
            const localAccountsBefore = Object.keys(storage.accounts);
            logger.debug(`[CredentialStorage] Local accounts before sync: [${localAccountsBefore.join(', ')}]`);
            
            let updated = 0;
            
            // Always update/add accounts from shared file (source of truth)
            for (const [email, cred] of Object.entries(data.accounts)) {
                logger.debug(`[CredentialStorage] Syncing account: ${email} | hasRefreshToken=${!!cred.refreshToken} | expiresAt=${cred.expiresAt} | projectId=${cred.projectId || 'none'}`);
                storage.accounts[email] = {
                    clientId: '',
                    clientSecret: '',
                    accessToken: cred.accessToken,
                    refreshToken: cred.refreshToken,
                    expiresAt: cred.expiresAt,
                    projectId: cred.projectId,
                    scopes: [],
                    email: cred.email,
                };
                updated++;
            }
            
            if (updated > 0) {
                await this.saveCredentialsStorage(storage);
                logger.info(`[CredentialStorage] Synced from shared folder: ${updated} accounts updated/added`);
            } else {
                logger.debug('[CredentialStorage] No changes detected during sync');
            }
            
            // Ensure active account is valid
            const activeAccountBefore = await this.getActiveAccount();
            logger.debug(`[CredentialStorage] Active account before sync: ${activeAccountBefore || 'none'}`);
            
            if (!activeAccountBefore || !storage.accounts[activeAccountBefore]) {
                const emails = Object.keys(storage.accounts);
                const fallback = emails.length > 0 ? emails[0] : null;
                logger.debug(`[CredentialStorage] Active account invalid, falling back to: ${fallback || 'none'}`);
                await this.setActiveAccount(fallback);
            }
            
            // Only sync active account from shared file if NOT manually set by user
            const isManual = await this.isManualAccount();
            const currentAccountFile = path.join(sharedDir, 'current_account.json');
            
            if (!isManual && fs.existsSync(currentAccountFile)) {
                const currentContent = fs.readFileSync(currentAccountFile, 'utf-8');
                const currentData = JSON.parse(currentContent) as { email: string };
                logger.debug(`[CredentialStorage] current_account.json found, email: ${currentData.email}`);
                if (currentData.email && storage.accounts[currentData.email]) {
                    await this.setActiveAccount(currentData.email, false);
                    logger.info(`[CredentialStorage] Active account synced from cockpit: ${currentData.email}`);
                }
            } else if (isManual) {
                logger.debug('[CredentialStorage] Account manually set, skipping sync from current_account.json');
            }
            
            const activeAccountAfter = await this.getActiveAccount();
            logger.info(`[CredentialStorage] Sync complete. Active account: ${activeAccountAfter || 'none'} | Total accounts: ${Object.keys(storage.accounts).length}`);
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.warn(`[CredentialStorage] Failed to sync from shared folder: ${err.message}`);
        }
    }

    /**
     * Scan local IDE directories to find potential account emails
     * Helpful for discovery when user hasn't logged in yet
     */
    async scanLocalIdeAccounts(): Promise<string[]> {
        const emails = new Set<string>();
        
        // 1. Check Antigravity IDE (Standalone) - Recursive scan for logs
        const agDir = path.join(os.homedir(), 'AppData', 'Roaming', 'Antigravity');
        const agLogsDir = path.join(agDir, 'logs');
        if (fs.existsSync(agLogsDir)) {
            const scanLogs = (dir: string, depth = 0) => {
                if (depth > 10) {
                    return; // Super robust depth
                }
                try {
                    const entries = fs.readdirSync(dir, { withFileTypes: true });
                    for (const entry of entries) {
                        const fullPath = path.join(dir, entry.name);
                        if (entry.isDirectory()) {
                            scanLogs(fullPath, depth + 1);
                        } else if (entry.isFile() && (entry.name.endsWith('.log') || entry.name.includes('log'))) {
                            const content = fs.readFileSync(fullPath, 'utf-8');
                            const matches = content.match(/[a-zA-Z0-9._%+-]+@gmail\.com/g);
                            if (matches) { matches.forEach(m => emails.add(m)); }
                        }
                    }
                } catch {
                    // Ignore read errors
                }
            };
            scanLogs(agLogsDir);
        }

        // 2. Check Cursor
        const cursorDir = path.join(os.homedir(), 'AppData', 'Roaming', 'Cursor', 'User', 'globalStorage');
        const cursorStorage = path.join(cursorDir, 'storage.json');
        if (fs.existsSync(cursorStorage)) {
            try {
                const content = fs.readFileSync(cursorStorage, 'utf-8');
                const matches = content.match(/[a-zA-Z0-9._%+-]+@gmail\.com/g);
                if (matches) { matches.forEach(m => emails.add(m)); }
            } catch {
                // Ignore storage read errors
            }
        }

        const discovered = Array.from(emails);
        if (discovered.length > 0) {
            await this.globalState?.update(DISCOVERED_EMAILS_KEY, discovered);
            logger.info(`[CredentialStorage] Discovered ${discovered.length} potential accounts from local IDEs: ${discovered.join(', ')}`);
        }
        return discovered;
    }

    async getDiscoveredEmails(): Promise<string[]> {
        this.ensureInitialized();
        return this.globalState!.get<string[]>(DISCOVERED_EMAILS_KEY, []);
    }

    private async getCredentialsStorage(): Promise<CredentialsStorage> {
        this.ensureInitialized();
        try {
            const json = await this.secretStorage!.get(CREDENTIALS_KEY);
            if (!json) {
                return { accounts: {} };
            }
            return JSON.parse(json) as CredentialsStorage;
        } catch {
            return { accounts: {} };
        }
    }

    private async saveCredentialsStorage(storage: CredentialsStorage): Promise<void> {
        this.ensureInitialized();
        const json = JSON.stringify(storage);
        await this.secretStorage!.store(CREDENTIALS_KEY, json);
    }

    async getActiveAccount(): Promise<string | null> {
        this.ensureInitialized();
        return this.globalState!.get<string | null>(ACTIVE_ACCOUNT_KEY, null);
    }

    async setActiveAccount(email: string | null, manual: boolean = true): Promise<void> {
        this.ensureInitialized();
        await this.globalState!.update(ACTIVE_ACCOUNT_KEY, email);
        await this.globalState!.update(IS_MANUAL_ACCOUNT_KEY, manual && email !== null);
        logger.info(`[CredentialStorage] Active account set to: ${email || 'none'} (manual=${manual})`);
    }

    async isManualAccount(): Promise<boolean> {
        this.ensureInitialized();
        return this.globalState!.get<boolean>(IS_MANUAL_ACCOUNT_KEY, false);
    }

    async getCredential(): Promise<OAuthCredential | null> {
        const activeAccount = await this.getActiveAccount();
        if (!activeAccount) {
            const storage = await this.getCredentialsStorage();
            const emails = Object.keys(storage.accounts);
            if (emails.length > 0) {
                await this.setActiveAccount(emails[0]);
                return storage.accounts[emails[0]];
            }
            return null;
        }
        return await this.getCredentialForAccount(activeAccount);
    }

    async getCredentialForAccount(email: string): Promise<OAuthCredential | null> {
        const storage = await this.getCredentialsStorage();
        return storage.accounts[email] || null;
    }

    async hasValidCredential(): Promise<boolean> {
        const credential = await this.getCredential();
        return credential !== null && !!credential.refreshToken;
    }

    async getAuthorizationStatus(): Promise<AuthorizationStatus> {
        const credential = await this.getCredential();
        const storage = await this.getCredentialsStorage();
        const activeAccount = await this.getActiveAccount();

        const accounts: AccountInfo[] = Object.entries(storage.accounts).map(([email, cred]) => ({
            email,
            isActive: email === activeAccount,
            expiresAt: cred.expiresAt,
            isInvalid: cred.isInvalid,
        }));

        if (!credential || !credential.refreshToken) {
            return {
                isAuthorized: false,
                accounts,
                activeAccount: activeAccount || undefined,
            };
        }

        return {
            isAuthorized: true,
            email: credential.email,
            expiresAt: credential.expiresAt,
            accounts,
            activeAccount: activeAccount || undefined,
        };
    }

    async updateAccessToken(accessToken: string, expiresAt: string): Promise<void> {
        const activeAccount = await this.getActiveAccount();
        if (!activeAccount) {
            throw new Error('No active account to update');
        }

        const storage = await this.getCredentialsStorage();
        if (!storage.accounts[activeAccount]) {
            throw new Error('No credential to update');
        }

        storage.accounts[activeAccount].accessToken = accessToken;
        storage.accounts[activeAccount].expiresAt = expiresAt;
        await this.saveCredentialsStorage(storage);
    }

    async saveCredential(credential: OAuthCredential): Promise<void> {
        if (!credential.email) {
            throw new Error('Credential must have an email');
        }

        const storage = await this.getCredentialsStorage();
        storage.accounts[credential.email] = credential;
        await this.saveCredentialsStorage(storage);
        await this.setActiveAccount(credential.email, true);
        logger.info(`[CredentialStorage] Credential saved for: ${credential.email}`);
    }

    async getAllCredentials(): Promise<Record<string, OAuthCredential>> {
        const storage = await this.getCredentialsStorage();
        return storage.accounts;
    }

    async removeAccount(email: string): Promise<void> {
        const storage = await this.getCredentialsStorage();
        if (storage.accounts[email]) {
            delete storage.accounts[email];
            await this.saveCredentialsStorage(storage);
            
            const active = await this.getActiveAccount();
            if (active === email) {
                const remaining = Object.keys(storage.accounts);
                await this.setActiveAccount(remaining.length > 0 ? remaining[0] : null, false);
            }
            logger.info(`[CredentialStorage] Account removed: ${email}`);
        }
    }

    async deleteCredential(): Promise<void> {
        this.ensureInitialized();
        await this.secretStorage!.delete(CREDENTIALS_KEY);
        await this.setActiveAccount(null);
        logger.info('[CredentialStorage] All credentials deleted');
    }

    /**
     * Dispose file watcher and timers
     */
    dispose(): void {
        if (this.fileWatcher) {
            this.fileWatcher.close();
            this.fileWatcher = undefined;
        }
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = undefined;
        }
        logger.debug('[CredentialStorage] Disposed');
    }
}

export const credentialStorage = new CredentialStorage();
