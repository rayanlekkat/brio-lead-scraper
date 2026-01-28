#!/bin/bash
# Railway Volume Setup Script
# Run this to add a volume to your Railway service

# Install Railway CLI if not installed
# npm install -g @railway/cli

# Login to Railway
railway login

# Link to your project
railway link

# Add a volume
railway volume create data --mount /app/data

echo "✅ Volume created! Your data will now persist across deployments."
echo "🔄 Redeploy your app for the volume to take effect."
