# LexiThera Backend API

Backend server for voice comparison with word-level error detection using MFCC and DTW algorithms.

## Features

- 🎤 **Voice Recording Support**: Accept audio from microphone or file upload
- 🔍 **Word-Level Analysis**: Detect errors in individual words
- 📊 **MFCC & DTW**: Advanced speech comparison algorithms
- 🤖 **Whisper Integration**: Automatic speech-to-text transcription
- ⚡ **Two Comparison Modes**: Full analysis or fast simple comparison

## Installation

```bash
cd backend
npm install
```

## Start Server

```bash
npm start
```

Server runs on: `http://localhost:3000`

## API Endpoints

### 1. Full Comparison with Transcription

**POST** `/api/compare`

Compares user audio with reference, provides word-level error detection.

**Request:**
- `Content-Type`: `multipart/form-data`
- `referenceText`: String - The expected text
- `userAudio`: File - User's WAV recording
- `referenceAudio`: File - Reference WAV audio

**Response:**
```json
{
  "success": true,
  "transcription": {
    "reference": "hello world",
    "user": "helo world"
  },
  "overall": {
    "totalWords": 2,
    "correctWords": 1,
    "errorWords": 1,
    "accuracy": "50.00",
    "averageConfidence": "75.50"
  },
  "wordAnalysis": [
    {
      "wordIndex": 0,
      "referenceWord": "hello",
      "userWord": "helo",
      "dtwDistance": 245.67,
      "hasError": true,
      "severity": "moderate",
      "confidence": 65.5,
      "isMatch": false,
      "startTime": 0.0,
      "endTime": 0.5
    }
  ],
  "errorSummary": {
    "minor": 0,
    "moderate": 1,
    "major": 0
  }
}
```

### 2. Simple Comparison (Faster)

**POST** `/api/compare-simple`

Quick comparison without transcription.

**Request:**
- `Content-Type`: `multipart/form-data`
- `userAudio`: File - User's WAV recording
- `referenceAudio`: File - Reference WAV audio

**Response:**
```json
{
  "success": true,
  "dtwDistance": 123.45,
  "hasError": false,
  "severity": "correct",
  "confidence": 95.5,
  "mfccFrames": {
    "reference": 99,
    "user": 98
  }
}
```

### 3. Health Check

**GET** `/api/health`

Check if server is running.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-12-01T08:13:21.000Z",
  "service": "LexiThera Voice Comparison API"
}
```

## Testing

### Using the Test Client

1. Start the server:
   ```bash
   npm start
   ```

2. Open `test-client.html` in your browser

3. Options:
   - **Record from microphone** - Click "Start Recording"
   - **Upload files** - Select WAV files

4. Click "Compare Audio" for full analysis or "Simple Compare" for quick check

### Using cURL

**Full Comparison:**
```bash
curl -X POST http://localhost:3000/api/compare \
  -F "referenceText=hello world" \
  -F "userAudio=@user_recording.wav" \
  -F "referenceAudio=@reference.wav"
```

**Simple Comparison:**
```bash
curl -X POST http://localhost:3000/api/compare-simple \
  -F "userAudio=@user_recording.wav" \
  -F "referenceAudio=@reference.wav"
```

## Error Detection Thresholds

| DTW Distance | Severity | Confidence |
|--------------|----------|------------|
| < 150 | Correct | > 90% |
| 150-300 | Minor | 70-90% |
| 300-450 | Moderate | 50-70% |
| > 450 | Major | < 50% |

## Audio Requirements

- **Format**: WAV (PCM)
- **Sample Rate**: 16kHz (auto-resampled)
- **Channels**: Mono (auto-converted)
- **Bit Depth**: 16-bit recommended

## Architecture

```
Backend/
├── server.js           # Express server with API endpoints
├── package.json        # Dependencies
├── test-client.html    # Web UI for testing
└── uploads/            # Temporary audio storage
```

## How It Works

1. **Audio Upload**: User records or uploads WAV file
2. **Preprocessing**: Convert to mono, resample to 16kHz
3. **Segmentation**: Split audio into words using silence detection
4. **MFCC Extraction**: Compute Mel-Frequency Cepstral Coefficients
5. **DTW Comparison**: Calculate Dynamic Time Warping distance
6. **Transcription**: Use Whisper to get text (optional)
7. **Error Detection**: Compare DTW distance against thresholds
8. **Response**: Return word-level analysis with errors

## Integration Example

```javascript
// Frontend JavaScript
const formData = new FormData();
formData.append('referenceText', 'hello world');
formData.append('userAudio', audioBlob);
formData.append('referenceAudio', referenceFile);

const response = await fetch('http://localhost:3000/api/compare', {
  method: 'POST',
  body: formData
});

const result = await response.json();
console.log('Accuracy:', result.overall.accuracy);
console.log('Errors:', result.wordAnalysis.filter(w => w.hasError));
```

## Notes

- First Whisper model load takes ~30 seconds (downloads model)
- Subsequent requests are faster (model cached in memory)
- Uploaded files are automatically deleted after processing
- CORS enabled for cross-origin requests
