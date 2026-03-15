#!/bin/bash

# Antigravity Nano - Quality Check Script

# 1. Formatting Check (if Prettier exists, otherwise skip)
if command -v npx &> /dev/null; then
  echo "Running Lint..."
  npm run lint
  if [ $? -ne 0 ]; then
    echo "❌ Linting failed!"
    exit 1
  fi
fi

# 2. Compilation Check
echo "Compiling project..."
npm run compile
if [ $? -ne 0 ]; then
  echo "❌ Compilation failed!"
  exit 1
fi

# 3. Unit Tests
echo "Running Unit Tests..."
npm test
if [ $? -ne 0 ]; then
  echo "❌ Unit tests failed!"
  exit 1
fi

echo "✅ All checks passed! The code is solid. 🚀"
exit 0
