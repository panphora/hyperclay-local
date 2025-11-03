# Documentation

## 📚 Overview

Complete documentation for building and signing HyperclayLocal installers for macOS and Windows.

---

## 🚀 Quick Start

**New to code signing?** Start here:
- **[Quick Start: GitHub Actions](./QUICK_START_GITHUB_ACTIONS.md)** - Set up automated builds in 5 minutes

---

## 📖 Platform-Specific Guides

### Windows
- **[Windows Signing Solution](./WINDOWS_SIGNING_SOLUTION.md)** - Complete technical documentation
  - Problem analysis (11 attempts documented)
  - Why GitHub Actions is the solution
  - Step-by-step setup
  - Troubleshooting guide

### macOS
- See `.github/workflows/build-and-sign-macos.yml` for workflow details
- Uses Apple's notarization service
- Requires Apple Developer Program membership

---

## 🔧 Reference Documentation

- **[Signing Fix Log](./SIGNING_FIX_LOG.md)** - Detailed investigation log
  - Every attempt documented
  - Technical details of failures
  - Root cause analysis

- **[GitHub Actions Setup](./GITHUB_ACTIONS_SETUP.md)** - Detailed workflow setup

- **[Quick Guide](./SIGNING_FIX_QUICK_GUIDE.md)** - Quick reference for solutions

---

## 🎯 For Developers

### Daily Workflow
```bash
# Develop locally (any platform)
npm run dev

# Test your changes
# ... make changes ...

# Get signed installers
git add .
git commit -m "Your changes"
git push origin main

# Wait ~10 minutes
# Download from GitHub Actions → Artifacts
```

### Understanding the Solution

**The Challenge**: ARM64 Windows can't run Microsoft's x64 code signing tools

**The Solution**: GitHub Actions with x64 Windows runners

**Key Insight**: Cloud CI/CD solves local platform limitations

---

## 🔐 Security

### Secrets Storage
- All credentials stored encrypted in GitHub
- Never exposed in logs
- Can be rotated anytime

### What Gets Signed
- **macOS**: DMG installer (notarized by Apple)
- **Windows**: EXE installer (Azure Trusted Signing)
- Both produce verifiable, trusted signatures

---

## 🆘 Troubleshooting

### Common Issues

**Workflow fails at signing step**
- Check GitHub secrets are correct (no extra spaces)
- Verify credentials are still valid
- See detailed logs in Actions UI

**Can't download artifacts**
- Must be logged in to GitHub
- Artifacts expire after 90 days
- Re-run workflow to generate new ones

**Want to sign locally**
- macOS: Possible with Xcode + Apple Developer account
- Windows x64: Possible with Azure setup
- Windows ARM64: Use GitHub Actions (local signing broken)

---

## 📊 Statistics

**Investigation Time**: ~2 hours systematic debugging
**Attempts Documented**: 11 different approaches
**Final Solution**: GitHub Actions (works 100% reliably)
**Cost**: $0 (included with GitHub)

---

## 🎓 Lessons Learned

1. ARM64 Windows support for dev tools is still incomplete
2. Cloud CI/CD is more reliable than local builds for signing
3. Document workarounds thoroughly - saves time later
4. Test platform compatibility early in projects
5. Microsoft recommends x64 for Windows development

---

## 🔗 External Resources

- [Azure Trusted Signing Docs](https://learn.microsoft.com/en-us/azure/trusted-signing/)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Electron Builder](https://www.electron.build/)
- [Apple Notarization Guide](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution)

---

**Last Updated**: November 2, 2025
**Status**: ✅ Production-ready
**Platforms**: macOS, Windows
**Signing Method**: GitHub Actions + Cloud Services
