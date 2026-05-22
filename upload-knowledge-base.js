#!/usr/bin/env node

/**
 * Script để upload Inoxpran Product Knowledge Base lên backend
 * Chạy: node upload-knowledge-base.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load từ .env file
const loadEnv = () => {
    const envPath = path.resolve(__dirname, '.env');
    if (!fs.existsSync(envPath)) {
        console.error('❌ File .env không tìm thấy!');
        process.exit(1);
    }
    
    const content = fs.readFileSync(envPath, 'utf8');
    const env = {};
    content.split('\n').forEach(line => {
        const [key, ...rest] = line.trim().split('=');
        if (key && !key.startsWith('#')) {
            env[key] = rest.join('=').trim().replace(/^['"]|['"]$/g, '');
        }
    });
    return env;
};

const env = loadEnv();
const BACKEND_URL = env.VITE_PUBLIC_API_BASE || 'http://localhost:3056/v1/api';
const API_KEY = env.VITE_PUBLIC_API_KEY || env.API_KEY || '';

// Load knowledge base JSON
const loadKnowledgeBase = () => {
    const kbPath = path.resolve(__dirname, 'PRODUCT_KNOWLEDGE_BASE.json');
    if (!fs.existsSync(kbPath)) {
        console.error('❌ File PRODUCT_KNOWLEDGE_BASE.json không tìm thấy!');
        process.exit(1);
    }
    
    try {
        const content = fs.readFileSync(kbPath, 'utf8');
        return JSON.parse(content);
    } catch (err) {
        console.error('❌ Lỗi khi parse JSON:', err.message);
        process.exit(1);
    }
};

const uploadKnowledgeBase = async () => {
    console.log('🚀 Bắt đầu upload Inoxpran Product Knowledge Base...\n');
    
    const knowledgeBase = loadKnowledgeBase();
    const documents = knowledgeBase.agentKnowledge?.documents || [];
    
    if (!documents.length) {
        console.error('❌ Không có documents trong knowledge base!');
        process.exit(1);
    }
    
    console.log(`📚 Chuẩn bị upload ${documents.length} documents...`);
    console.log(`   URL: ${BACKEND_URL}/site-settings/agent-knowledge`);
    console.log(`   Payload size: ${JSON.stringify(knowledgeBase).length} bytes\n`);
    
    try {
        const response = await fetch(`${BACKEND_URL}/site-settings/agent-knowledge`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                ...(API_KEY ? { 'x-api-key': API_KEY } : {})
            },
            body: JSON.stringify(knowledgeBase)
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            console.error('❌ Upload thất bại!');
            console.error('Status:', response.status);
            console.error('Response:', JSON.stringify(data, null, 2));
            process.exit(1);
        }
        
        // Parse response - có thể có cấu trúc khác nhau
        const uploadedCount = data.metadata?.documents?.length || documents.length;
        
        console.log('✅ Upload thành công!');
        console.log(`📊 Thông tin:
  - Documents uploaded: ${uploadedCount}
  - Categories:
    * Product info: ${documents.filter(d => d.category === 'product_info').length}
    * Manual: ${documents.filter(d => d.category === 'manual').length}
    * Warranty: ${documents.filter(d => d.category === 'warranty_policy').length}
    * Shipping: ${documents.filter(d => d.category === 'shipping_policy').length}
    * General: ${documents.filter(d => d.category === 'general_policy').length}
  - Updated at: ${data.metadata?.updatedAt || 'N/A'}\n`);
        
        console.log('💡 Chatbot sẽ cập nhật knowledge trong 5 phút tới');
        console.log('🧪 Thử hỏi chatbot: "Bếp từ đơn INOXPRAN INP6101 có những tính năng gì?" để kiểm tra');
        
    } catch (err) {
        console.error('❌ Lỗi khi gửi request:', err.message);
        console.error('\nGợi ý: Hãy chắc chắn rằng:');
        console.error('  1. Backend server đang chạy (http://localhost:3056)');
        console.error('  2. .env file chứa API_KEY/VITE_PUBLIC_API_KEY nếu cần');
        console.error('  3. URL backend chính xác');
        console.error('\nChạy: npm run dev (ở thư mục backend)');
        process.exit(1);
    }
};

// Run
uploadKnowledgeBase();
