const fs = require('fs');
require('dotenv').config();
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');

// R2 Configuration
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY;
const R2_SECRET_KEY = process.env.R2_SECRET_KEY;
const R2_BUCKET = process.env.R2_BUCKET;

function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(dateString) {
  return new Date(dateString).toLocaleString();
}

async function listR2Files() {
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY,
      secretAccessKey: R2_SECRET_KEY,
    },
  });

  const command = new ListObjectsV2Command({
    Bucket: R2_BUCKET,
  });

  try {
    const response = await client.send(command);
    
    if (!response.Contents || response.Contents.length === 0) {
      console.log('📦 No files found in R2 bucket:', R2_BUCKET);
      return;
    }

    console.log(`📦 Files in R2 bucket: ${R2_BUCKET}\n`);
    console.log('Filename'.padEnd(40) + 'Size'.padEnd(12) + 'Last Modified');
    console.log('-'.repeat(80));

    response.Contents.forEach(file => {
      const filename = file.Key.padEnd(40);
      const size = formatSize(file.Size).padEnd(12);
      const modified = formatDate(file.LastModified);
      console.log(`${filename}${size}${modified}`);
    });

    console.log(`\n✅ Total files: ${response.Contents.length}`);
  } catch (error) {
    console.error('❌ Failed to list files:', error.message);
    process.exit(1);
  }
}

async function main() {
  // Check if R2 credentials exist
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY || !R2_SECRET_KEY || !R2_BUCKET) {
    console.log('❌ R2 credentials not found in .env file.');
    console.log('   Please set R2_ACCOUNT_ID, R2_ACCESS_KEY, R2_SECRET_KEY, and R2_BUCKET');
    process.exit(1);
  }

  await listR2Files();
}

main().catch(error => {
  console.error('❌ Error:', error);
  process.exit(1);
});