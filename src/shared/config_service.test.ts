import { configService } from './config_service';
import * as vscode from 'vscode';

describe('ConfigService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should retrieve configuration correctly', () => {
        const mockGet = jest.fn((key, defaultValue) => defaultValue);
        (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
            get: mockGet,
            update: jest.fn()
        });

        const config = configService.getConfig();
        expect(config).toBeDefined();
        expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith('agCockpit');
    });

    it('should toggle pinned models correctly', async () => {
        const pinnedModels = ['model-1'];
        const mockConfig = {
            get: jest.fn().mockReturnValue(pinnedModels),
            update: jest.fn().mockResolvedValue(true)
        };
        (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue(mockConfig);

        // Toggle existing model (should remove it)
        await configService.togglePinnedModel('model-1');
        expect(mockConfig.update).toHaveBeenCalledWith('pinnedModels', [], vscode.ConfigurationTarget.Global);

        // Toggle new model (should add it)
        mockConfig.get.mockReturnValue([]);
        await configService.togglePinnedModel('model-2');
        expect(mockConfig.update).toHaveBeenCalledWith('pinnedModels', ['model-2'], vscode.ConfigurationTarget.Global);
    });

    it('should check if model is pinned (case insensitive)', () => {
        (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
            get: jest.fn().mockReturnValue(['Model-X', 'model-y']),
            update: jest.fn()
        });

        expect(configService.isModelPinned('model-x')).toBe(true);
        expect(configService.isModelPinned('MODEL-Y')).toBe(true);
        expect(configService.isModelPinned('model-z')).toBe(false);
    });

    it('should register and notify config change listeners', () => {
        const listener = jest.fn();
        configService.onConfigChange(listener);

        // Simulate configuration change event from VS Code
        // We need to find the call to onDidChangeConfiguration
        const calls = (vscode.workspace.onDidChangeConfiguration as jest.Mock).mock.calls;
        if (calls.length > 0) {
            const onDidChangeConfiguration = calls[0][0];
            const mockEvent = {
                affectsConfiguration: jest.fn().mockReturnValue(true)
            };
            onDidChangeConfiguration(mockEvent);
            expect(listener).toHaveBeenCalled();
        }
    });
});
