const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');
require('dotenv').config();

// R2 Configuration - matching list-remote-files.js
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY;
const R2_SECRET_KEY = process.env.R2_SECRET_KEY;
const R2_BUCKET = process.env.R2_BUCKET;

// Configure S3 client for Cloudflare R2
const s3Client = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY,
    secretAccessKey: R2_SECRET_KEY,
  },
});

const BUCKET_NAME = R2_BUCKET;

async function removeRemoteFiles() {
  try {
    console.log('🔍 Checking files in R2 bucket:', BUCKET_NAME);
    console.log('');

    // First, list all objects in the bucket
    const listCommand = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
    });

    const listResponse = await s3Client.send(listCommand);
    
    if (!listResponse.Contents || listResponse.Contents.length === 0) {
      console.log('📁 Bucket is already empty - no files to remove');
      return;
    }

    console.log(`📦 Found ${listResponse.Contents.length} files to remove:`);
    console.log('');

    // Sort files by last modified date (newest first) for display
    const sortedFiles = listResponse.Contents.sort((a, b) => 
      new Date(b.LastModified) - new Date(a.LastModified)
    );

    sortedFiles.forEach((file, index) => {
      const sizeInMB = (file.Size / (1024 * 1024)).toFixed(2);
      const lastModified = new Date(file.LastModified).toLocaleString();
      
      console.log(`${index + 1}. ${file.Key}`);
      console.log(`   📏 Size: ${sizeInMB} MB`);
      console.log(`   📅 Modified: ${lastModified}`);
      console.log('');
    });

    // Calculate total size
    const totalSize = listResponse.Contents.reduce((sum, file) => sum + file.Size, 0);
    const totalSizeInMB = (totalSize / (1024 * 1024)).toFixed(2);
    
    console.log(`📊 Total to remove: ${listResponse.Contents.length} files, ${totalSizeInMB} MB`);
    console.log('');

    // Prepare objects for deletion
    const objectsToDelete = listResponse.Contents.map(file => ({
      Key: file.Key
    }));

    console.log('🗑️  Starting deletion process...');
    console.log('');

    // Delete objects in batches (S3 allows up to 1000 objects per delete request)
    const batchSize = 1000;
    let deletedCount = 0;

    for (let i = 0; i < objectsToDelete.length; i += batchSize) {
      const batch = objectsToDelete.slice(i, i + batchSize);
      
      const deleteCommand = new DeleteObjectsCommand({
        Bucket: BUCKET_NAME,
        Delete: {
          Objects: batch,
          Quiet: false // Set to false to get detailed results
        }
      });

      const deleteResponse = await s3Client.send(deleteCommand);
      
      if (deleteResponse.Deleted) {
        deletedCount += deleteResponse.Deleted.length;
        console.log(`✅ Deleted batch ${Math.floor(i / batchSize) + 1}: ${deleteResponse.Deleted.length} files`);
        
        // Show first few deleted files in each batch
        deleteResponse.Deleted.slice(0, 3).forEach(deleted => {
          console.log(`   🗑️  ${deleted.Key}`);
        });
        
        if (deleteResponse.Deleted.length > 3) {
          console.log(`   ... and ${deleteResponse.Deleted.length - 3} more files`);
        }
        console.log('');
      }

      if (deleteResponse.Errors && deleteResponse.Errors.length > 0) {
        console.log('❌ Some files failed to delete:');
        deleteResponse.Errors.forEach(error => {
          console.log(`   ❌ ${error.Key}: ${error.Message}`);
        });
        console.log('');
      }
    }

    console.log('🎉 Deletion completed!');
    console.log(`📊 Successfully deleted ${deletedCount} files from bucket: ${BUCKET_NAME}`);
    console.log(`💾 Freed up ${totalSizeInMB} MB of storage space`);

  } catch (error) {
    console.error('❌ Error removing files:', error.message);
    
    // Provide more specific error guidance
    if (error.name === 'AccessDenied') {
      console.error('💡 Make sure your R2 credentials have delete permissions');
    } else if (error.name === 'NoSuchBucket') {
      console.error('💡 Check that the bucket name is correct in your environment variables');
    } else if (error.name === 'NetworkingError') {
      console.error('💡 Check your internet connection and R2 endpoint configuration');
    }
    
    process.exit(1);
  }
}

// Add confirmation prompt for safety
async function confirmDeletion() {
  // Check if we're in a CI environment or if --force flag is passed
  const isForced = process.argv.includes('--force') || process.env.CI;
  
  if (isForced) {
    console.log('🔥 Force mode enabled - skipping confirmation');
    return true;
  }

  // Simple confirmation without external dependencies
  console.log('⚠️  WARNING: This will permanently delete ALL files in the R2 bucket!');
  console.log('');
  console.log('To proceed, type "DELETE ALL" (case sensitive):');
  
  return new Promise((resolve) => {
    process.stdin.once('data', (data) => {
      const input = data.toString().trim();
      if (input === 'DELETE ALL') {
        resolve(true);
      } else {
        console.log('❌ Deletion cancelled - input did not match "DELETE ALL"');
        resolve(false);
      }
    });
  });
}

// Main execution
async function main() {
  // Check if R2 credentials exist
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY || !R2_SECRET_KEY || !R2_BUCKET) {
    console.log('❌ R2 credentials not found in .env file.');
    console.log('   Please set R2_ACCOUNT_ID, R2_ACCESS_KEY, R2_SECRET_KEY, and R2_BUCKET');
    process.exit(1);
  }

  console.log('🧹 Hyperclay Local - R2 Bucket Cleaner');
  console.log('=====================================');
  console.log('');

  const confirmed = await confirmDeletion();
  
  if (confirmed) {
    await removeRemoteFiles();
  } else {
    console.log('✋ Operation cancelled by user');
    process.exit(0);
  }
}

// Run the function
main();