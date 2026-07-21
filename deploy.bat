@echo off
rem DealFlow AI - one-command prod-local deploy (passes args through, e.g.
rem   deploy.bat -Mode node
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy.ps1" %*
