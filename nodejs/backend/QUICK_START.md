# LexiThera Backend - Quick Start

## Updated Workflow

✅ **User only records their voice** - No need to upload reference audio!  
✅ **Reference audio pre-stored** on server in `references/` folder

---

## Setup

### 1. Add Reference Audio Files

Place your reference WAV files in:
```
nodejs/backend/references/
```

Example:
```
references/
├── hello_world.wav
├── good_morning.wav
└── thank_you.wav
```

### 2. Start Server

```powershell
.\start-backend.bat
```

Or:
```bash
cd nodejs/backend
npm start
```

### 3. Open Test Client

Navigate to: **http://localhost:3000**

---

## How to Use

1. **Select Reference** - Choose from dropdown (auto-loaded from server)
2. **Record Voice** - Click "Start Recording" and speak
3. **Compare** - Click "Full Analysis" or "Quick Compare"
4. **View Results** - See word-by-word errors with accuracy

---

## API Endpoints

### Get Available References
```http
GET /api/references
```

Response:
```json
{
  "success": true,
  "references": [
    {
      "id": "hello_world.wav",
      "name": "hello_world",
      "displayName": "hello world"
    }
  ]
}
```

### Compare with Reference
```http
POST /api/compare-with-reference
Content-Type: multipart/form-data

referenceId: "hello_world.wav"
referenceText: "hello world"
userAudio: <recorded WAV file>
```

### Quick Compare
```http
POST /api/compare-simple-with-reference
Content-Type: multipart/form-data

referenceId: "hello_world.wav"
userAudio: <recorded WAV file>
```

---

## File Structure

```
backend/
├── server.js              # API server
├── references/            # ⭐ Place reference audio here
│   ├── hello_world.wav
│   └── ...
├── uploads/               # Temporary user recordings
├── public/
│   └── index.html        # Test client UI
└── package.json
```

---

## Features

✅ Microphone recording  
✅ Pre-stored reference library  
✅ Word-level error detection  
✅ MFCC + DTW comparison  
✅ Whisper transcription  
✅ Beautiful web UI  

**Ready to use!** 🚀
