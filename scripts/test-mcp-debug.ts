#!/usr/bin/env tsx

// Load environment variables from .env file
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from the project root
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { testMCPConfiguration } from "../lib/agent/reactAgent";

async function main() {
  console.log("🚀 Testing MCP Configuration...\n");
  
  // Check if required environment variables are present
  if (!process.env.OPENAI_API_KEY) {
    console.error("❌ OPENAI_API_KEY not found in environment variables");
    console.log("Available env vars:", Object.keys(process.env).filter(key => key.includes('OPENAI')));
    process.exit(1);
  }
  
  console.log("✅ OpenAI API key found");

  // Test 1: Memory server (should work)
  console.log("1. Testing memory server:");
  await testMCPConfiguration(["memory"], "test-user-123");
  
  console.log("\n" + "=".repeat(50) + "\n");
  
  // Test 2: Multiple servers including memory
  console.log("2. Testing multiple servers:");
  await testMCPConfiguration(["memory", "sequential-thinking"], "test-user-123");
  
  console.log("\n" + "=".repeat(50) + "\n");
  
  // Test 3: Gmail server (requires OAuth)
//   console.log("3. Testing Gmail server (requires OAuth):");
//   await testMCPConfiguration(["gmail-mcp-server"], "test-user-123");
  
//   console.log("\n" + "=".repeat(50) + "\n");
  
  // Test 4: Empty servers
  console.log("4. Testing empty servers:");
  await testMCPConfiguration([], "test-user-123");
  
  console.log("\n✅ MCP Configuration test completed!");
}

main().catch(console.error); 