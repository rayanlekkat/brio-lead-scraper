@echo off
title Deploy Brio Lead Scraper
cd /d "c:\Users\Rayan\OneDrive\Desktop\Brio Nettoyage\lead-scraper-app"
echo Deploying to Railway...
git add -A
git commit -m "Update"
git push
echo.
echo Done! Railway will auto-deploy in ~30 seconds.
echo Check: https://brio-lead-scraper-production.up.railway.app
pause
