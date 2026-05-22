#!/bin/bash
# Quick Setup Script for Inoxpran Chatbot Training

echo "🚀 Setting up Inoxpran Chatbot with Product Knowledge Base..."
echo ""

# Check if required files exist
if [ ! -f "PRODUCT_KNOWLEDGE_BASE.json" ]; then
    echo "❌ Error: PRODUCT_KNOWLEDGE_BASE.json not found!"
    exit 1
fi

if [ ! -f ".env" ]; then
    echo "❌ Error: .env file not found!"
    exit 1
fi

echo "✅ Found required files"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not installed!"
    exit 1
fi

echo "✅ Node.js found: $(node --version)"
echo ""

# Start backend in background (if needed)
read -p "Start backend server? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Starting backend server..."
    cd backend
    npm install --silent 2>/dev/null
    npm run dev &
    BACKEND_PID=$!
    echo "✅ Backend started (PID: $BACKEND_PID)"
    sleep 3
    cd ..
fi

echo ""
echo "🔄 Uploading knowledge base..."
echo ""

# Run the upload script
node upload-knowledge-base.js

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Setup complete!"
    echo ""
    echo "📝 Next steps:"
    echo "  1. Start frontend: cd frontend && npm run dev"
    echo "  2. Open http://localhost:5173"
    echo "  3. Test chatbot with: 'Bếp từ đơn INOXPRAN INP6101 có những tính năng gì?'"
    echo ""
else
    echo ""
    echo "❌ Upload failed. Check the error above."
    exit 1
fi
