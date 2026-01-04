export const window = {
    showInformationMessage: jest.fn(),
    showErrorMessage: jest.fn(),
    showWarningMessage: jest.fn(),
    createStatusBarItem: jest.fn(() => ({
        show: jest.fn(),
        tooltip: '',
        text: '',
        command: '',
    })),
};

export const workspace = {
    getConfiguration: jest.fn(() => ({
        get: jest.fn(),
        update: jest.fn(),
    })),
    onDidChangeConfiguration: jest.fn(),
};

export const commands = {
    registerCommand: jest.fn(),
};

export const EventEmitter = jest.fn(() => ({
    event: jest.fn(),
    fire: jest.fn(),
}));

export const Uri = {
    file: jest.fn((path) => ({ path })),
    parse: jest.fn((url) => ({ url })),
    joinPath: jest.fn((uri, ...parts) => ({ path: [...uri.path.split('/'), ...parts].join('/') })),
};

export const StatusBarAlignment = {
    Left: 1,
    Right: 2,
};

export enum ExtensionMode {
    Production = 1,
    Development = 2,
    Test = 3,
}

export default {
    window,
    workspace,
    commands,
    Uri,
    EventEmitter,
    StatusBarAlignment,
    ExtensionMode,
};
