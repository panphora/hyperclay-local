const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

// R2 Configuration
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY;
const R2_SECRET_KEY = process.env.R2_SECRET_KEY;
const R2_BUCKET = process.env.R2_BUCKET;

function getContentType(filename) {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case '.dmg':
      return 'application/x-apple-diskimage';
    case '.exe':
      return 'application/x-msdos-program';
    case '.appimage':
      return 'application/x-executable';
    default:
      return 'application/octet-stream';
  }
}

async function uploadToR2(filePath, filename) {
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY,
      secretAccessKey: R2_SECRET_KEY,
    },
  });

  const fileContent = fs.readFileSync(filePath);
  const contentType = getContentType(filename);
  
  const command = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: filename,
    Body: fileContent,
    ContentType: contentType,
  });
  
  await client.send(command);
  const sizeMB = (fs.statSync(filePath).size / (1024 * 1024)).toFixed(1);
  console.log(`✅ Uploaded ${filename} (${sizeMB}MB)`);
}

async function main() {
  // Check if R2 credentials exist
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY || !R2_SECRET_KEY || !R2_BUCKET) {
    console.log('⚠️  R2 credentials not found in .env file. Skipping uploads.');
    return;
  }

  // Find distributable files in dist directory
  const distDir = path.join(__dirname, 'dist');
  if (!fs.existsSync(distDir)) {
    console.log('❌ dist directory not found.');
    return;
  }

  const files = fs.readdirSync(distDir);
  const distributables = files.filter(file => 
    file.endsWith('.dmg') || 
    file.endsWith('.exe') || 
    file.endsWith('.AppImage')
  );

  if (distributables.length === 0) {
    console.log('❌ No distributable files found.');
    return;
  }

  console.log(`📦 Uploading ${distributables.length} file(s) to R2...\n`);

  // Upload each file
  for (const file of distributables) {
    try {
      const normalizedFilename = file.replace(/\s+/g, '-');
      await uploadToR2(path.join(distDir, file), normalizedFilename);
    } catch (error) {
      console.error(`❌ Failed to upload ${file}:`, error.message);
    }
  }

  console.log(`\n✅ Upload complete! Files available in R2 bucket: ${R2_BUCKET}`);
}

main().catch(error => {
  console.error('❌ Error:', error);
  process.exit(1);
});