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

    initialize(context: vscode.ExtensionContext): void {
        this.secretStorage = context.secrets;
        this.globalState = context.globalState;
        this.initialized = true;
        logger.info('[CredentialStorage] Initialized');
        
        // Try to import from shared folder on init
        this.importFromSharedFolder();
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
     * Import credentials from shared folder (synced by cockpit)
     */
    async importFromSharedFolder(): Promise<void> {
        try {
            const sharedDir = this.getSharedDir();
            const credentialsFile = path.join(sharedDir, 'credentials.json');
            
            if (!fs.existsSync(credentialsFile)) {
                logger.info('[CredentialStorage] No shared credentials file found');
                return;
            }
            
            const content = fs.readFileSync(credentialsFile, 'utf-8');
            const data = JSON.parse(content) as SharedCredentials;
            
            if (!data.accounts || Object.keys(data.accounts).length === 0) {
                return;
            }
            
            const storage = await this.getCredentialsStorage();
            let imported = 0;
            
            for (const [email, cred] of Object.entries(data.accounts)) {
                if (!storage.accounts[email]) {
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
                    imported++;
                }
            }
            
            if (imported > 0) {
                await this.saveCredentialsStorage(storage);
                logger.info(`[CredentialStorage] Imported ${imported} account(s) from shared folder`);
                
                // Set first account as active if no active account
                const activeAccount = await this.getActiveAccount();
                if (!activeAccount) {
                    const emails = Object.keys(storage.accounts);
                    if (emails.length > 0) {
                        await this.setActiveAccount(emails[0]);
                    }
                }
            }
            
            // Also sync active account from shared file
            const currentAccountFile = path.join(sharedDir, 'current_account.json');
            if (fs.existsSync(currentAccountFile)) {
                const currentContent = fs.readFileSync(currentAccountFile, 'utf-8');
                const currentData = JSON.parse(currentContent) as { email: string };
                if (currentData.email && storage.accounts[currentData.email]) {
                    await this.setActiveAccount(currentData.email);
                }
            }
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.warn(`[CredentialStorage] Failed to import from shared folder: ${err.message}`);
        }
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

    async setActiveAccount(email: string | null): Promise<void> {
        this.ensureInitialized();
        await this.globalState!.update(ACTIVE_ACCOUNT_KEY, email);
        logger.info(`[CredentialStorage] Active account set to: ${email || 'none'}`);
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

    async getAllCredentials(): Promise<Record<string, OAuthCredential>> {
        const storage = await this.getCredentialsStorage();
        return storage.accounts;
    }

    async deleteCredential(): Promise<void> {
        this.ensureInitialized();
        await this.secretStorage!.delete(CREDENTIALS_KEY);
        await this.setActiveAccount(null);
        logger.info('[CredentialStorage] All credentials deleted');
    }
}

export const credentialStorage = new CredentialStorage();
