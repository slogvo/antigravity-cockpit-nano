@echo off
echo Antigravity Nano - Quality Check Script

echo Running Lint...
call npm run lint
if %errorlevel% neq 0 (
    echo ❌ Linting failed!
    exit /b 1
)

echo Compiling project...
call npm run compile
if %errorlevel% neq 0 (
    echo ❌ Compilation failed!
    exit /b 1
)

echo Running Unit Tests...
call npm test
if %errorlevel% neq 0 (
    echo ❌ Unit tests failed!
    exit /b 1
)

echo ✅ All checks passed! The code is solid. 🚀
exit /b 0
