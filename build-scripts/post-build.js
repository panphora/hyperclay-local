const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
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
    case '.yml':
      return 'text/yaml';
    case '.blockmap':
      return 'application/json';
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

async function uploadReleaseInfo(uploadedFiles, publicUrl) {
  const pkgPath = path.join(__dirname, '..', 'package.json');
  const version = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;

  let commit;
  try {
    commit = execSync('git rev-parse HEAD', { cwd: path.join(__dirname, '..'), encoding: 'utf8' }).trim();
  } catch (error) {
    throw new Error('Could not get git commit hash, so release-info.json cannot be written.');
  }

  const releaseInfo = {
    version: version,
    commit: commit,
    date: new Date().toISOString(),
    files: uploadedFiles.map(f => f.filename)
  };

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY,
      secretAccessKey: R2_SECRET_KEY,
    },
  });

  const command = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: 'release-info.json',
    Body: Buffer.from(JSON.stringify(releaseInfo, null, 2)),
    ContentType: 'application/json',
  });

  await client.send(command);
  console.log(`✅ Uploaded release-info.json (v${version}, commit: ${commit.slice(0, 7)})`);
}

function generateReport(uploadedFiles, publicUrl) {
  const reportPath = path.join(__dirname, '..', 'UPLOAD_REPORT.md');
  const pkgPath = path.join(__dirname, '..', 'package.json');
  const version = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;

  let markdown = '';

  // Group by platform
  const macFiles = uploadedFiles.filter(f => f.filename.includes('mac') || f.filename.endsWith('.dmg'));
  const winFiles = uploadedFiles.filter(f => f.filename.includes('Setup') || f.filename.endsWith('.exe'));
  const linuxFiles = uploadedFiles.filter(f => f.filename.includes('AppImage') || f.filename.includes('linux'));

  if (macFiles.length > 0) {
    markdown += `### macOS\n\n`;
    macFiles.forEach(file => {
      markdown += `- **${file.filename}** (${file.size})\n`;
      markdown += `  - ${file.url}\n\n`;
    });
  }

  // Always include Windows (uploaded by GitHub Actions)
  markdown += `### Windows\n\n`;
  if (winFiles.length > 0) {
    winFiles.forEach(file => {
      markdown += `- **${file.filename}** (${file.size})\n`;
      markdown += `  - ${file.url}\n\n`;
    });
  } else {
    // Windows is uploaded by GitHub Actions, not locally
    const winFilename = `HyperclayLocal-Setup-${version}.exe`;
    markdown += `- **${winFilename}** (uploaded by GitHub Actions)\n`;
    markdown += `  - ${publicUrl}/${winFilename}\n\n`;
  }

  if (linuxFiles.length > 0) {
    markdown += `### Linux\n\n`;
    linuxFiles.forEach(file => {
      markdown += `- **${file.filename}** (${file.size})\n`;
      markdown += `  - ${file.url}\n\n`;
    });
  }

  fs.writeFileSync(reportPath, markdown);
  console.log(`\n📄 Upload report generated: UPLOAD_REPORT.md`);
}

async function main() {
  // Check if R2 credentials exist
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY || !R2_SECRET_KEY || !R2_BUCKET) {
    console.error('❌ R2 credentials not found in .env file. Nothing was uploaded.');
    process.exit(1);
  }

  // Check for R2_PUBLIC_URL in .env, otherwise use default R2 URL
  const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || `https://${R2_BUCKET}.r2.dev`;

  // Find distributable files in executables directory
  const executablesDir = path.join(__dirname, '..', 'executables');
  if (!fs.existsSync(executablesDir)) {
    console.error('❌ executables/ directory not found.');
    console.error('   Run the build scripts first to generate executables.');
    process.exit(1);
  }

  const files = fs.readdirSync(executablesDir);
  const distributables = files.filter(file =>
    file.endsWith('.dmg') ||
    file.endsWith('.exe') ||
    file.endsWith('.AppImage')
  );

  if (distributables.length === 0) {
    console.error('❌ No distributable files found.');
    process.exit(1);
  }

  console.log(`📦 Uploading ${distributables.length} file(s) to R2...\n`);

  // Track uploaded files with URLs
  const uploadedFiles = [];
  const failedUploads = [];

  // Upload each file
  for (const file of distributables) {
    try {
      const normalizedFilename = file.replace(/\s+/g, '-');
      await uploadToR2(path.join(executablesDir, file), normalizedFilename);

      // Store file info with URL
      uploadedFiles.push({
        filename: normalizedFilename,
        url: `${R2_PUBLIC_URL}/${normalizedFilename}`,
        size: (fs.statSync(path.join(executablesDir, file)).size / (1024 * 1024)).toFixed(1) + 'MB'
      });
    } catch (error) {
      console.error(`❌ Failed to upload ${file}:`, error.message);
      failedUploads.push(file);
    }
  }

  console.log(`\n✅ Upload complete! Files available in R2 bucket: ${R2_BUCKET}`);

  // Generate markdown report
  if (uploadedFiles.length > 0) {
    generateReport(uploadedFiles, R2_PUBLIC_URL);

    // Upload release-info.json for hypercheck verification
    try {
      await uploadReleaseInfo(uploadedFiles, R2_PUBLIC_URL);
    } catch (error) {
      console.error('❌ Failed to upload release-info.json:', error.message);
      failedUploads.push('release-info.json');
    }
  }

  if (failedUploads.length > 0) {
    console.error(`\n❌ ${failedUploads.length} upload(s) failed: ${failedUploads.join(', ')}`);
    console.error('   Not recording this as a completed release.');
    process.exit(1);
  }
}

main().catch(error => {
  console.error('❌ Error:', error);
  process.exit(1);
});