# Quick Start Guide - LexiThera Node.js

## PowerShell Execution Policy Issue - Solutions

### ✅ Solution 1: Use Batch Files (Easiest)

I've created helper batch files for you:

**Run Tests:**
```powershell
.\run-tests.bat
```

**Run Speech Comparison Demo:**
```powershell
.\run-comparison.bat
```

> **Note:** In PowerShell, you need the `.\` prefix. In CMD, you can just type `run-tests.bat`

### ✅ Solution 2: Use CMD Instead of PowerShell

Instead of running commands in PowerShell, use Command Prompt (CMD):

```cmd
cd nodejs
npm test
```

### ✅ Solution 3: Use `cmd /c` Prefix in PowerShell

```powershell
cmd /c "cd nodejs && npm test"
cmd /c "cd nodejs && node compareSpeech.js --ref test_ref.wav --input test_input_same.wav"
```

### Solution 4: Fix PowerShell Execution Policy (Optional)

If you want to fix PowerShell permanently, run PowerShell as **Administrator** and execute:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

---

## Quick Commands Reference

### Run Unit Tests
```cmd
cd nodejs
npm test
```

**Expected Output:**
```
Test Suites: 2 passed, 2 total
Tests:       14 passed, 14 total
```

### Compare Speech Files
```cmd
cd nodejs
node compareSpeech.js --ref <reference.wav> --input <user_audio.wav> --outjson result.json
```

**Example:**
```cmd
node compareSpeech.js --ref test_ref.wav --input test_input_same.wav --outjson result.json
```

### Transcribe Audio with Whisper
```cmd
cd nodejs
node runWhisper.js --audio <audio_file.wav> --outjson transcription.json
```

**Note:** First run will download the Whisper model (~150MB)

---

## Test Results Summary

✅ **All 14 tests passed** (0.763 seconds)
- ✅ MFCC module: 9 tests passed
- ✅ DTW module: 5 tests passed

✅ **Speech Comparison Verified:**
- Identical audio (440Hz vs 440Hz): DTW distance = 0
- Different audio (440Hz vs 880Hz): DTW distance = 2288.58

---

## Project Structure

```
LexiThera/
├── nodejs/                    # Node.js implementation
│   ├── lib/
│   │   ├── mfcc.js           # MFCC feature extraction
│   │   ├── dtw.js            # DTW distance calculation
│   │   └── utils.js          # Helper utilities
│   ├── test/
│   │   ├── mfcc.test.js      # MFCC tests
│   │   └── dtw.test.js       # DTW tests
│   ├── compareSpeech.js      # Main comparison CLI
│   ├── runWhisper.js         # Whisper transcription CLI
│   ├── generateTestAudio.js  # Test audio generator
│   ├── package.json          # Dependencies
│   └── README.md             # Full documentation
├── python/                    # Original Python code
├── run-tests.bat             # Helper: Run tests
└── run-comparison.bat        # Helper: Run demo
```

---

## Next Steps

1. ✅ **Tests are working** - All unit tests passed
2. ✅ **Speech comparison working** - DTW distance calculated correctly
3. 🔄 **Try with real speech** - Use actual speech recordings if available
4. 🔄 **Test Whisper** - Try speech-to-text transcription

---

## Need Help?

- **Full Documentation:** See `nodejs/README.md`
- **Code Analysis:** See artifact `code_functionality_report.md`
- **Verification Results:** See artifact `verification_results.md`
