/**
 * Antigravity Cockpit - Credential Storage
 * Secure storage service for OAuth credentials
 * Uses VS Code's SecretStorage API to securely store sensitive information
 */

import * as vscode from 'vscode';
import { OAuthCredential, AuthorizationStatus } from './types';
import { logger } from '../shared/log_service';

const CREDENTIAL_KEY = 'antigravity.autoTrigger.credential';
const STATE_KEY = 'antigravity.autoTrigger.state';

    /**
     * Credential Storage Service
     * Singleton pattern, initialized via initialize()
     */
class CredentialStorage {
    private secretStorage?: vscode.SecretStorage;
    private globalState?: vscode.Memento;
    private initialized = false;

    /**
     * Initialize Storage Service
     * @param context VS Code Extension Context
     */
    initialize(context: vscode.ExtensionContext): void {
        this.secretStorage = context.secrets;
        this.globalState = context.globalState;
        this.initialized = true;
        logger.info('[CredentialStorage] Initialized');
    }

    /**
     * Check if Initialized
     */
    private ensureInitialized(): void {
        if (!this.initialized || !this.secretStorage || !this.globalState) {
            throw new Error('CredentialStorage not initialized. Call initialize() first.');
        }
    }

    /**
     * Save OAuth Credential
     */
    async saveCredential(credential: OAuthCredential): Promise<void> {
        this.ensureInitialized();
        try {
            const json = JSON.stringify(credential);
            await this.secretStorage!.store(CREDENTIAL_KEY, json);
            logger.info('[CredentialStorage] Credential saved successfully');
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.error(`[CredentialStorage] Failed to save credential: ${err.message}`);
            throw err;
        }
    }

    /**
     * Get OAuth Credential
     */
    async getCredential(): Promise<OAuthCredential | null> {
        this.ensureInitialized();
        try {
            const json = await this.secretStorage!.get(CREDENTIAL_KEY);
            if (!json) {
                return null;
            }
            return JSON.parse(json) as OAuthCredential;
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.error(`[CredentialStorage] Failed to get credential: ${err.message}`);
            return null;
        }
    }

    /**
     * Delete OAuth Credential
     */
    async deleteCredential(): Promise<void> {
        this.ensureInitialized();
        try {
            await this.secretStorage!.delete(CREDENTIAL_KEY);
            logger.info('[CredentialStorage] Credential deleted');
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.error(`[CredentialStorage] Failed to delete credential: ${err.message}`);
            throw err;
        }
    }

    /**
     * Check for Valid Credential
     */
    async hasValidCredential(): Promise<boolean> {
        const credential = await this.getCredential();
        if (!credential) {
            return false;
        }

        // Check if refresh_token exists (can refresh access_token with refresh_token)
        if (!credential.refreshToken) {
            return false;
        }

        return true;
    }

    /**
     * Get Authorization Status
     */
    async getAuthorizationStatus(): Promise<AuthorizationStatus> {
        const credential = await this.getCredential();
        
        if (!credential || !credential.refreshToken) {
            return {
                isAuthorized: false,
            };
        }

        return {
            isAuthorized: true,
            email: credential.email,
            expiresAt: credential.expiresAt,
        };
    }

    /**
     * Update access_token (Called after refresh)
     */
    async updateAccessToken(accessToken: string, expiresAt: string): Promise<void> {
        const credential = await this.getCredential();
        if (!credential) {
            throw new Error('No credential to update');
        }

        credential.accessToken = accessToken;
        credential.expiresAt = expiresAt;
        await this.saveCredential(credential);
        logger.info('[CredentialStorage] Access token updated');
    }

    /**
     * Save General State Data (Non-sensitive)
     */
    async saveState<T>(key: string, value: T): Promise<void> {
        this.ensureInitialized();
        await this.globalState!.update(`${STATE_KEY}.${key}`, value);
    }

    /**
     * Get General State Data
     */
    getState<T>(key: string, defaultValue: T): T {
        this.ensureInitialized();
        return this.globalState!.get(`${STATE_KEY}.${key}`, defaultValue);
    }
}

// Export Singleton
export const credentialStorage = new CredentialStorage();
