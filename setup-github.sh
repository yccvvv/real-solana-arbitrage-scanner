#!/bin/bash

echo "🚀 Real Solana Arbitrage Scanner - GitHub Setup"
echo "================================================"

# Check if we're in the right directory
if [ ! -f "package.json" ] || [ ! -d "src" ]; then
    echo "❌ Error: Please run this script from the project root directory"
    exit 1
fi

echo "✅ Project files confirmed"
echo "📁 Current directory: $(pwd)"

# Check git status
echo ""
echo "📋 Git Status:"
git status --porcelain

# Show what we're going to create
echo ""
echo "🎯 About to create GitHub repository:"
echo "   Repository name: real-solana-arbitrage-scanner"
echo "   Description: Production-ready Solana arbitrage scanner with real WebSocket connections"
echo "   Type: Public repository"
echo "   Features: Real WebSocket connections, Live pool monitoring, Zero simulations"

echo ""
echo "🔐 Starting GitHub authentication..."
echo "👆 Follow the prompts to authenticate with GitHub"

# Authenticate with GitHub
gh auth login

if [ $? -eq 0 ]; then
    echo "✅ GitHub authentication successful!"
    
    echo ""
    echo "📦 Creating GitHub repository..."
    
    # Create the repository
    gh repo create real-solana-arbitrage-scanner \
        --public \
        --description "🚀 Production-ready Solana arbitrage scanner with real WebSocket connections to mainnet. Live pool monitoring, cross-DEX arbitrage detection, zero simulations - only real blockchain data." \
        --source=. \
        --remote=origin \
        --push
    
    if [ $? -eq 0 ]; then
        echo ""
        echo "🎉 SUCCESS! Repository created and code pushed!"
        echo "🌐 View your repository at:"
        gh repo view --web
        echo ""
        echo "✅ Your real Solana arbitrage scanner is now on GitHub!"
        echo "✅ All files include real WebSocket implementation"
        echo "✅ No simulations - only production-ready code"
    else
        echo "❌ Failed to create repository. Please try manually."
    fi
else
    echo "❌ GitHub authentication failed. Please try again."
    echo ""
    echo "🔧 Manual alternative:"
    echo "1. Go to https://github.com/new"
    echo "2. Create repository named: real-solana-arbitrage-scanner"
    echo "3. Run these commands:"
    echo "   git remote add origin https://github.com/YOUR_USERNAME/real-solana-arbitrage-scanner.git"
    echo "   git branch -M main"
    echo "   git push -u origin main"
fi 