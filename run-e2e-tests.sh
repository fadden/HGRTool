#!/bin/bash

# HGRTool E2E Test Runner
# This script runs Playwright tests and provides a summary

set -e

echo "=========================================="
echo "HGRTool E2E Test Suite"
echo "=========================================="
echo ""

# Create output directory
mkdir -p test-output

# Check if Playwright is installed
if ! command -v npx &> /dev/null; then
    echo "Error: npx not found. Please install Node.js and npm."
    exit 1
fi

# Check if browsers are installed
if [ ! -d "$HOME/Library/Caches/ms-playwright" ]; then
    echo "Playwright browsers not found. Installing..."
    npm run playwright:install
fi

echo "Running E2E tests..."
echo ""

# Run tests
if [ "$1" == "--headed" ]; then
    echo "Running in HEADED mode (browser visible)"
    npm run test:e2e:headed
elif [ "$1" == "--debug" ]; then
    echo "Running in DEBUG mode"
    npm run test:e2e:debug
elif [ "$1" == "--ui" ]; then
    echo "Running with Playwright UI"
    npm run test:e2e:ui
else
    echo "Running in HEADLESS mode"
    npm run test:e2e
fi

echo ""
echo "=========================================="
echo "Test Results"
echo "=========================================="
echo ""
echo "Screenshots saved to: test-output/"
ls -lh test-output/*.png 2>/dev/null || echo "No screenshots found"
echo ""
echo "Test report: playwright-report/index.html"
echo ""
echo "To view test report, run: npx playwright show-report"
echo ""
