/**
 * Antigravity Nano - OAuth Credential Types
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
    isInvalid?: boolean;
    isForbidden?: boolean;
}

export interface AccountInfo {
    email: string;
    isActive: boolean;
    expiresAt?: string;
    isInvalid?: boolean;
}

export interface AuthorizationStatus {
    isAuthorized: boolean;
    email?: string;
    expiresAt?: string;
    accounts?: AccountInfo[];
    activeAccount?: string;
}
