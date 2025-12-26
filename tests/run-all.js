#!/usr/bin/env node
/**
 * Test Runner - Runs all integration tests
 */

import { spawn } from 'child_process';
import { readdir } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const INTEGRATION_DIR = join(__dirname, 'integration');
const COLORS = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

async function runTest(testFile) {
    return new Promise((resolve) => {
        console.log(`${COLORS.cyan}Running ${testFile}...${COLORS.reset}`);

        const child = spawn('node', [join(INTEGRATION_DIR, testFile)], {
            stdio: 'inherit'
        });

        child.on('close', (code) => {
            if (code === 0) {
                console.log(`${COLORS.green}✅ ${testFile} passed${COLORS.reset}\n`);
                resolve({ file: testFile, passed: true });
            } else {
                console.log(`${COLORS.red}❌ ${testFile} failed${COLORS.reset}\n`);
                resolve({ file: testFile, passed: false });
            }
        });
    });
}

async function main() {
    console.log(`${COLORS.blue}========================================`);
    console.log(`       Force Calendar Core Tests`);
    console.log(`========================================${COLORS.reset}\n`);

    try {
        // Get all test files
        const files = await readdir(INTEGRATION_DIR);
        const testFiles = files.filter(f => f.startsWith('test-') && f.endsWith('.js'));

        if (testFiles.length === 0) {
            console.log(`${COLORS.yellow}No test files found!${COLORS.reset}`);
            return;
        }

        console.log(`Found ${testFiles.length} test files\n`);

        // Run all tests
        const results = [];
        for (const testFile of testFiles) {
            const result = await runTest(testFile);
            results.push(result);
        }

        // Summary
        console.log(`${COLORS.blue}========================================`);
        console.log(`                 Summary`);
        console.log(`========================================${COLORS.reset}\n`);

        const passed = results.filter(r => r.passed).length;
        const failed = results.filter(r => !r.passed).length;

        console.log(`Total: ${results.length} tests`);
        console.log(`${COLORS.green}Passed: ${passed}${COLORS.reset}`);
        console.log(`${COLORS.red}Failed: ${failed}${COLORS.reset}`);

        if (failed > 0) {
            console.log(`\n${COLORS.red}Failed tests:${COLORS.reset}`);
            results.filter(r => !r.passed).forEach(r => {
                console.log(`  - ${r.file}`);
            });
            process.exit(1);
        } else {
            console.log(`\n${COLORS.green}All tests passed! 🎉${COLORS.reset}`);
        }

    } catch (error) {
        console.error(`${COLORS.red}Error running tests:${COLORS.reset}`, error);
        process.exit(1);
    }
}

main();