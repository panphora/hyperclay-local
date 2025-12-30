const {
  validateFileName,
  validateFolderName,
  validateSiteName,
  validateUploadName,
  validateUploadPath,
  validateFullPath,
  getFileType
} = require('../../src/sync-engine/validation');

describe('validateFolderName', () => {
  test('accepts valid folder names', () => {
    expect(validateFolderName('my-folder').valid).toBe(true);
    expect(validateFolderName('folder_name').valid).toBe(true);
    expect(validateFolderName('folder123').valid).toBe(true);
    expect(validateFolderName('a').valid).toBe(true);
  });

  test('rejects empty names', () => {
    expect(validateFolderName('').valid).toBe(false);
    expect(validateFolderName('   ').valid).toBe(false);
  });

  test('rejects uppercase letters', () => {
    expect(validateFolderName('MyFolder').valid).toBe(false);
    expect(validateFolderName('FOLDER').valid).toBe(false);
  });

  test('rejects spaces', () => {
    expect(validateFolderName('my folder').valid).toBe(false);
  });

  test('rejects special characters', () => {
    expect(validateFolderName('folder.name').valid).toBe(false);
    expect(validateFolderName('folder@name').valid).toBe(false);
    expect(validateFolderName('folder!').valid).toBe(false);
  });

  test('rejects names over 255 characters', () => {
    const longName = 'a'.repeat(256);
    expect(validateFolderName(longName).valid).toBe(false);
  });
});

describe('validateSiteName', () => {
  test('accepts valid site names', () => {
    expect(validateSiteName('my-site').valid).toBe(true);
    expect(validateSiteName('MySite').valid).toBe(true);
    expect(validateSiteName('site123').valid).toBe(true);
    expect(validateSiteName('a').valid).toBe(true);
  });

  test('strips .html extension before validation', () => {
    expect(validateSiteName('my-site.html').valid).toBe(true);
    expect(validateSiteName('my-site.HTML').valid).toBe(true);
  });

  test('rejects empty names', () => {
    expect(validateSiteName('').valid).toBe(false);
    expect(validateSiteName('.html').valid).toBe(false);
  });

  test('rejects names over 63 characters', () => {
    const longName = 'a'.repeat(64);
    expect(validateSiteName(longName).valid).toBe(false);
    expect(validateSiteName('a'.repeat(63)).valid).toBe(true);
  });

  test('rejects spaces and special characters', () => {
    expect(validateSiteName('my site').valid).toBe(false);
    expect(validateSiteName('my_site').valid).toBe(false);
    expect(validateSiteName('my.site').valid).toBe(false);
  });

  test('rejects names starting or ending with hyphen', () => {
    expect(validateSiteName('-mysite').valid).toBe(false);
    expect(validateSiteName('mysite-').valid).toBe(false);
    expect(validateSiteName('-').valid).toBe(false);
  });

  test('rejects consecutive hyphens', () => {
    expect(validateSiteName('my--site').valid).toBe(false);
    expect(validateSiteName('a---b').valid).toBe(false);
  });

  test('rejects Windows reserved names', () => {
    const reserved = ['con', 'prn', 'aux', 'nul', 'com1', 'com9', 'lpt1', 'lpt9'];
    for (const name of reserved) {
      expect(validateSiteName(name).valid).toBe(false);
      expect(validateSiteName(name.toUpperCase()).valid).toBe(false);
    }
  });
});

describe('validateUploadName', () => {
  test('accepts valid upload names', () => {
    expect(validateUploadName('image.png').valid).toBe(true);
    expect(validateUploadName('my-file.pdf').valid).toBe(true);
    expect(validateUploadName('document_v2.docx').valid).toBe(true);
  });

  test('accepts names with spaces (more permissive than sites)', () => {
    expect(validateUploadName('my file.png').valid).toBe(true);
    expect(validateUploadName('document (1).pdf').valid).toBe(true);
  });

  test('rejects empty names', () => {
    expect(validateUploadName('').valid).toBe(false);
    expect(validateUploadName('   ').valid).toBe(false);
  });

  test('rejects names starting or ending with dots', () => {
    expect(validateUploadName('.hidden').valid).toBe(false);
    expect(validateUploadName('file.').valid).toBe(false);
  });

  test('rejects control characters', () => {
    expect(validateUploadName('file\x00name').valid).toBe(false);
    expect(validateUploadName('file\nname').valid).toBe(false);
  });

  test('rejects path separators and special chars', () => {
    expect(validateUploadName('path/file').valid).toBe(false);
    expect(validateUploadName('path\\file').valid).toBe(false);
    expect(validateUploadName('file<>name').valid).toBe(false);
    expect(validateUploadName('file:name').valid).toBe(false);
    expect(validateUploadName('file"name').valid).toBe(false);
    expect(validateUploadName('file|name').valid).toBe(false);
    expect(validateUploadName('file?name').valid).toBe(false);
    expect(validateUploadName('file*name').valid).toBe(false);
  });

  test('rejects full-width punctuation (server sanitizes these)', () => {
    expect(validateUploadName('file：name.txt').valid).toBe(false); // full-width colon
    expect(validateUploadName('file？name.txt').valid).toBe(false); // full-width question
    expect(validateUploadName('file｜name.txt').valid).toBe(false); // full-width pipe
    expect(validateUploadName('file，name.txt').valid).toBe(false); // full-width comma
    expect(validateUploadName('file。name.txt').valid).toBe(false); // full-width period
    expect(validateUploadName('file！name.txt').valid).toBe(false); // full-width exclamation
  });

  test('rejects Windows reserved names', () => {
    expect(validateUploadName('con.txt').valid).toBe(false);
    expect(validateUploadName('PRN.pdf').valid).toBe(false);
    expect(validateUploadName('COM1.doc').valid).toBe(false);
  });

  test('rejects names over 255 bytes', () => {
    const longName = 'a'.repeat(252) + '.png'; // 256 bytes
    expect(validateUploadName(longName).valid).toBe(false);

    const okName = 'a'.repeat(251) + '.png'; // 255 bytes
    expect(validateUploadName(okName).valid).toBe(true);
  });
});

describe('validateUploadPath', () => {
  test('accepts valid paths', () => {
    expect(validateUploadPath('image.png').valid).toBe(true);
    expect(validateUploadPath('folder/image.png').valid).toBe(true);
    expect(validateUploadPath('a/b/c/d/e/image.png').valid).toBe(true); // 5 folders
  });

  test('rejects empty paths', () => {
    expect(validateUploadPath('').valid).toBe(false);
  });

  test('rejects paths deeper than 5 folders', () => {
    expect(validateUploadPath('a/b/c/d/e/f/image.png').valid).toBe(false); // 6 folders
    expect(validateUploadPath('1/2/3/4/5/6/7/file.txt').valid).toBe(false); // 7 folders
  });

  test('validates folder names in path', () => {
    expect(validateUploadPath('valid-folder/image.png').valid).toBe(true);
    expect(validateUploadPath('Invalid Folder/image.png').valid).toBe(false); // space
    expect(validateUploadPath('UPPERCASE/image.png').valid).toBe(false);
  });

  test('validates filename in path', () => {
    expect(validateUploadPath('folder/valid-file.png').valid).toBe(true);
    expect(validateUploadPath('folder/.hidden').valid).toBe(false);
  });
});

describe('validateFullPath (for sites)', () => {
  test('accepts valid site paths', () => {
    expect(validateFullPath('site.html').valid).toBe(true);
    expect(validateFullPath('folder/site.html').valid).toBe(true);
  });

  test('validates folder depth', () => {
    expect(validateFullPath('a/b/c/d/e/site.html').valid).toBe(true); // 5 folders
    expect(validateFullPath('a/b/c/d/e/f/site.html').valid).toBe(false); // 6 folders
  });

  test('validates folder names', () => {
    expect(validateFullPath('valid-folder/site.html').valid).toBe(true);
    expect(validateFullPath('Invalid Folder/site.html').valid).toBe(false);
  });
});

describe('getFileType', () => {
  test('identifies directories', () => {
    expect(getFileType('anything', true)).toBe('folder');
  });

  test('identifies HTML files as sites', () => {
    expect(getFileType('mysite.html')).toBe('site');
    expect(getFileType('folder/site.html')).toBe('site');
  });

  test('identifies other files as uploads', () => {
    expect(getFileType('image.png')).toBe('upload');
    expect(getFileType('document.pdf')).toBe('upload');
    expect(getFileType('styles.css')).toBe('upload');
  });
});
