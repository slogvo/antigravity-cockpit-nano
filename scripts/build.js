const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

async function build() {
    const isWatch = process.argv.includes('--watch');
    const isProduction = process.argv.includes('--production');

    // Read Sentry DSN
    let sentryDsn = process.env.SENTRY_DSN || '';
    const envLocalPath = path.join(__dirname, '../.env.local');
    if (!sentryDsn && fs.existsSync(envLocalPath)) {
        const envContent = fs.readFileSync(envLocalPath, 'utf-8');
        const match = envContent.match(/SENTRY_DSN=(.+)/);
        if (match) {
            sentryDsn = match[1].trim();
        }
    }
    
    if (isProduction && !sentryDsn) {
        console.warn('Warning: SENTRY_DSN not set. Error reporting will be disabled.');
    }

    // 1. Bundle Extension Code
    const extensionContext = await esbuild.context({
        entryPoints: ['./src/extension.ts'],
        bundle: true,
        external: ['vscode'],
        format: 'cjs',
        platform: 'node',
        outfile: './out/extension.js',
        sourcemap: !isProduction,
        minify: isProduction,
        define: {
            'process.env.SENTRY_DSN': JSON.stringify(sentryDsn),
        },
    });

    if (isWatch) {
        await extensionContext.watch();
        console.log('Watching for changes...');
    } else {
        await extensionContext.rebuild();
        await extensionContext.dispose();
        console.log('Build finished successfully.');
    }
}

build().catch(err => {
    console.error(err);
    process.exit(1);
});
