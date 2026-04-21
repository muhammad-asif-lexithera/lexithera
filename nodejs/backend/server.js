// server.js - Backend API with pre-stored reference audio library

import express from 'express';
import multer from 'multer';
import cors from 'cors';
import { readFile, writeFile, unlink, readdir, mkdir } from 'fs/promises';
import fs from 'fs/promises';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import * as wavDecoder from 'wav-decoder';
import { MPEGDecoder } from 'mpg123-decoder';
import { pipeline } from '@xenova/transformers';
import dotenv from 'dotenv';

// Import our MFCC and DTW modules
import { computeMFCC } from './lib/mfcc.js';
import { dtwDistance } from './lib/dtw.js';
import { resampleAudio } from './lib/utils.js';

// Import authentication system
import { initializeDatabase, supabase } from './database.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import userRoutes from './routes/user.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Reference audio library path
const REFERENCE_AUDIO_DIR = join(__dirname, 'references');


const app = express();
const PORT = process.env.PORT || 3001;

// Initialize database
await initializeDatabase();

// Middleware
app.use(cors());
app.use(express.json());

// Request logger for debugging
app.use((req, res, next) => {
    console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
    next();
});

// Authentication routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/user', userRoutes);

// Serve static files AFTER API routes
app.use(express.static(join(__dirname, 'public'), { extensions: ['html'] }));
app.use('/references', express.static(REFERENCE_AUDIO_DIR));


// Configure multer for user audio uploads only
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, join(__dirname, 'uploads'));
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const upload = multer({
    storage,
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'audio/wav' || file.mimetype === 'audio/wave' || file.mimetype === 'audio/mpeg' || file.mimetype === 'audio/mp3') {
            cb(null, true);
        } else {
            cb(new Error('Only WAV and MP3 files are allowed'));
        }
    }
});

// Load audio file and preprocess from Buffer
async function loadAudioFromBuffer(buffer, filename, targetSr = 16000) {
    let audio; let sampleRate;
    if (filename.toLowerCase().endsWith('.mp3')) {
        const decoder = new MPEGDecoder(); await decoder.ready;
        const decoded = decoder.decode(buffer);
        if (decoded.channelData.length > 1) {
            audio = new Float32Array(decoded.channelData[0].length);
            for (let i = 0; i < audio.length; i++) {
                let sum = 0;
                for (let ch = 0; ch < decoded.channelData.length; ch++) sum += decoded.channelData[ch][i];
                audio[i] = sum / decoded.channelData.length;
            }
        } else audio = decoded.channelData[0];
        sampleRate = decoded.sampleRate;
    } else {
        const audioData = await wavDecoder.decode(buffer);
        sampleRate = audioData.sampleRate;
        audio = audioData.channelData[0];
        if (audioData.channelData.length > 1) {
            audio = new Float32Array(audioData.channelData[0].length);
            for (let i = 0; i < audio.length; i++) {
                let sum = 0;
                for (let ch = 0; ch < audioData.channelData.length; ch++) sum += audioData.channelData[ch][i];
                audio[i] = sum / audioData.channelData.length;
            }
        }
    }
    if (sampleRate !== targetSr) audio = resampleAudio(audio, sampleRate, targetSr);
    return { audio, sampleRate: targetSr };
}

// Segment audio into words using RMS energy windowing (more robust against background noise)
function segmentAudioByWords(audio, sampleRate, silenceThreshold = 0.02, minSilenceDuration = 0.2) {
    const minSilenceSamples = Math.floor(minSilenceDuration * sampleRate);
    const windowSize = Math.floor(0.02 * sampleRate); // 20ms window chunks
    const segments = [];

    // Calculate RMS energy per 20ms window
    const windowEnergies = [];
    for (let i = 0; i < audio.length; i += windowSize) {
        let sum = 0;
        let count = 0;
        for (let j = 0; j < windowSize && i + j < audio.length; j++) {
            sum += audio[i + j] * audio[i + j];
            count++;
        }
        windowEnergies.push(Math.sqrt(sum / count));
    }

    let inSilence = true;
    let segmentStartWin = 0;
    let silenceWins = 0;
    const requiredSilenceWins = Math.ceil(minSilenceDuration / 0.02);

    for (let w = 0; w < windowEnergies.length; w++) {
        if (windowEnergies[w] < silenceThreshold) {
            silenceWins++;
            if (!inSilence && silenceWins >= requiredSilenceWins) {
                // End of word found
                const endIndex = (w - requiredSilenceWins + 1) * windowSize;
                const startIndex = segmentStartWin * windowSize;
                if (endIndex > startIndex) {
                    segments.push({
                        start: startIndex,
                        end: endIndex,
                        audio: audio.slice(startIndex, endIndex)
                    });
                }
                inSilence = true;
            }
        } else {
            if (inSilence) {
                segmentStartWin = w;
                inSilence = false;
            }
            silenceWins = 0;
        }
    }

    if (!inSilence) {
        const startIndex = segmentStartWin * windowSize;
        if (audio.length > startIndex) {
            segments.push({
                start: startIndex,
                end: audio.length,
                audio: audio.slice(startIndex)
            });
        }
    }

    return segments;
}

// Compare two audio segments using MFCC and DTW
function compareSegments(refAudio, userAudio, sampleRate = 16000) {
    const mfccRef = computeMFCC(refAudio, sampleRate, 13);
    const mfccUser = computeMFCC(userAudio, sampleRate, 13);
    const distance = dtwDistance(mfccRef, mfccUser);

    return {
        distance,
        mfccRefFrames: mfccRef.length,
        mfccUserFrames: mfccUser.length
    };
}

// Determine if word has error based on DTW distance
function detectError(distance, threshold = 150) {
    return {
        hasError: distance > threshold,
        severity: distance < threshold ? 'correct' :
            distance < threshold * 2 ? 'minor' :
                distance < threshold * 3 ? 'moderate' : 'major',
        confidence: Math.max(0, Math.min(100, 100 - (distance / threshold) * 50))
    };
}

// Cache for Whisper model
let whisperModel = null;

async function getWhisperModel() {
    if (!whisperModel) {
        console.log('Loading Whisper model...');
        whisperModel = await pipeline('automatic-speech-recognition', 'Xenova/whisper-base');
        console.log('Whisper model loaded');
    }
    return whisperModel;
}

// API Endpoints

/**
 * GET /api/references
 * Get list of available reference audio files
 */
app.get('/api/references', async (req, res) => {
    try {
        // Fetch valid references directly from Supabase
        const { data: dbReferences, error } = await supabase
            .from('reference_audios')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw new Error(error.message);

        // In a true migration, the DB matches the Supabase Storage Bucket exactly.
        const validReferences = dbReferences.map(ref => ({
            id: ref.filename, 
            dbId: ref.id,
            name: ref.display_name,
            displayName: ref.display_name,
            word: ref.display_name, // Mapping display_name to word for frontend compatibility
            path: `${process.env.SUPABASE_URL}/storage/v1/object/public/references/${ref.filename}`,
            difficulty: ref.difficulty
        }));

        res.json({
            success: true,
            references: validReferences
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/references
 * Upload a new reference audio with difficulty details
 */
app.post('/api/references', upload.single('audio'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No audio file uploaded' });
        }

        const { displayName, difficulty } = req.body;

        // Move file content to Supabase references bucket
        const oldPath = req.file.path;
        const filename = req.file.filename;

        const fileData = await readFile(oldPath);
        const { error: uploadErr } = await supabase.storage.from('references').upload(filename, fileData, {
            contentType: req.file.mimetype,
            upsert: true
        });
        if (uploadErr) throw new Error(uploadErr.message);

        // Delete local temp file
        await unlink(oldPath).catch(() => {});

        // Insert into DB
        const { error: dbErr } = await supabase.from('reference_audios').insert([{
            filename: filename,
            display_name: displayName || filename,
            difficulty: difficulty || 'Basic'
        }]);
        if (dbErr) throw new Error(dbErr.message);

        res.json({
            success: true,
            message: 'Reference audio uploaded successfully',
            filename: filename
        });

    } catch (error) {
        console.error('Error uploading reference:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/transcribe-reference
 * Transcribe a reference audio file and return the text
 * Body: { referenceId: string }
 */
app.post('/api/transcribe-reference', async (req, res) => {
    try {
        const { referenceId } = req.body;

        if (!referenceId) {
            return res.status(400).json({
                success: false,
                error: 'referenceId is required'
            });
        }

        const { data, error } = await supabase.storage.from('references').download(referenceId);
        if (error) throw new Error(error.message);
        
        const buffer = Buffer.from(await data.arrayBuffer());
        const refData = await loadAudioFromBuffer(buffer, referenceId);

        // Get transcription using Whisper
        const transcriber = await getWhisperModel();
        const transcription = await transcriber(refData.audio);

        const transcriptionText = transcription.text || '';

        console.log('Transcription result:', transcriptionText);

        res.json({
            success: true,
            referenceId,
            text: transcriptionText.trim()
        });

    } catch (error) {
        console.error('Error transcribing reference audio:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/compare-with-reference
 * Compare user recording with a pre-stored reference audio
 * Body: { referenceId: string, referenceText: string }
 * Files: userAudio (WAV file)
 */
app.post('/api/compare-with-reference', upload.single('userAudio'), async (req, res) => {
    try {
        const { referenceId, referenceText } = req.body;
        const userAudioPath = req.file.path;

        if (!referenceId) {
            return res.status(400).json({
                success: false,
                error: 'referenceId is required'
            });
        }

        const { data: refBlob, error: refErr } = await supabase.storage.from('references').download(referenceId);
        if (refErr) throw new Error('Reference file not found in storage: ' + refErr.message);

        console.log('Processing audio comparison...');
        console.log('Reference:', referenceId);
        
        // Push user upload to uploads bucket asynchronously while we do the comparison
        const userBuffer = await readFile(userAudioPath);
        supabase.storage.from('uploads').upload(req.file.filename, userBuffer, { contentType: req.file.mimetype }).catch(e => console.error(e));

        // Load audio files
        const refData = await loadAudioFromBuffer(Buffer.from(await refBlob.arrayBuffer()), referenceId);
        const userData = await loadAudioFromBuffer(userBuffer, req.file.filename);

        // Segment audio into words
        const refSegments = segmentAudioByWords(refData.audio, refData.sampleRate);
        const userSegments = segmentAudioByWords(userData.audio, userData.sampleRate);

        // Get transcription for user audio
        const transcriber = await getWhisperModel();
        // Pass raw audio data (Float32Array) directly to Whisper to avoid AudioContext issue in Node.js
        const transcription = await transcriber(userData.audio);
        console.log('Transcription result:', JSON.stringify(transcription, null, 2));

        const transcriptionText = transcription.text || '';
        const userWords = transcriptionText.trim().toLowerCase().split(/\s+/);
        const referenceWords = referenceText ? referenceText.trim().toLowerCase().split(/\s+/) : [];

        console.log('User words:', userWords);
        console.log('Reference words:', referenceWords);

        // Helper to clean words (remove punctuation)
        const cleanWord = (w) => w.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "").trim();

        // Map the words more intelligently to the segments and temporally slice them to guarantee mathematically unique scores
        const wordComparisons = [];
        const numWords = Math.max(referenceWords.length, userWords.length);

        for (let i = 0; i < numWords; i++) {
            const refWordRaw = referenceWords[i] || '';
            const userWordRaw = userWords[i] || '';

            const refWord = cleanWord(refWordRaw);
            const userWord = cleanWord(userWordRaw);
            const isTextMatch = refWord === userWord && refWord !== '';

            let userAudioSlice = null;
            let refAudioSlice = null;
            let uStart = 0; let uEnd = 0;

            if (userSegments.length > 0 && refSegments.length > 0) {
                // Find which macro audio chunk this word mapped to proportionatly 
                const uSegIdx = Math.min(userWords.length > 0 ? Math.floor((i / userWords.length) * userSegments.length) : 0, Math.max(0, userSegments.length - 1));
                const rSegIdx = Math.min(referenceWords.length > 0 ? Math.floor((i / referenceWords.length) * refSegments.length) : 0, Math.max(0, refSegments.length - 1));

                const uSeg = userSegments[uSegIdx];
                const rSeg = refSegments[rSegIdx];

                // Track how many words share this identical chunk so we can uniformly subdivide it
                let uWordsInSeg = 0; let uWordLocalIdx = 0;
                let rWordsInSeg = 0; let rWordLocalIdx = 0;

                for (let j = 0; j < numWords; j++) {
                    if (Math.min(userWords.length > 0 ? Math.floor((j / userWords.length) * userSegments.length) : 0, Math.max(0, userSegments.length - 1)) === uSegIdx) {
                        if (j === i) uWordLocalIdx = uWordsInSeg;
                        uWordsInSeg++;
                    }
                    if (Math.min(referenceWords.length > 0 ? Math.floor((j / referenceWords.length) * refSegments.length) : 0, Math.max(0, refSegments.length - 1)) === rSegIdx) {
                        if (j === i) rWordLocalIdx = rWordsInSeg;
                        rWordsInSeg++;
                    }
                }

                // Sub-slice the macro chunk so each word gets its own acoustically UNIQUE contiguous Float32Array
                const uLen = Math.floor(uSeg.audio.length / Math.max(1, uWordsInSeg));
                const uOffset = uWordLocalIdx * uLen;
                userAudioSlice = uSeg.audio.slice(uOffset, uOffset + uLen);

                const rLen = Math.floor(rSeg.audio.length / Math.max(1, rWordsInSeg));
                const rOffset = rWordLocalIdx * rLen;
                refAudioSlice = rSeg.audio.slice(rOffset, rOffset + rLen);

                uStart = (uSeg.start + uOffset) / refData.sampleRate;
                uEnd = (uSeg.start + uOffset + uLen) / refData.sampleRate;
            }

            // If we managed to grab valid audio segments, run the complex DTW score
            if (userAudioSlice && refAudioSlice && userAudioSlice.length > 100 && refAudioSlice.length > 100) {
                const comparison = compareSegments(
                    refAudioSlice,
                    userAudioSlice,
                    refData.sampleRate
                );

                const normalizedDistance = comparison.distance / (comparison.mfccRefFrames + comparison.mfccUserFrames);
                const errorInfo = detectError(normalizedDistance, 50);

                // Word mismatch is ALWAYS an error
                const hasError = !isTextMatch || errorInfo.hasError;

                // If text is wrong, severity is at least 'moderate', and confidence is capped
                let finalSeverity = isTextMatch ? errorInfo.severity : (errorInfo.severity === 'major' ? 'major' : 'moderate');
                let finalConfidence = isTextMatch ? Math.max(85, errorInfo.confidence) : Math.min(60, errorInfo.confidence);

                wordComparisons.push({
                    wordIndex: i,
                    referenceWord: refWordRaw,
                    userWord: userWordRaw,
                    dtwDistance: normalizedDistance,
                    hasError: hasError,
                    severity: finalSeverity,
                    confidence: finalConfidence,
                    isMatch: isTextMatch,
                    startTime: uStart,
                    endTime: uEnd
                });
            } else {
                // If the audio segments are fundamentally missing/broken
                wordComparisons.push({
                    wordIndex: i,
                    referenceWord: refWordRaw,
                    userWord: userWordRaw,
                    hasError: !isTextMatch,
                    severity: isTextMatch ? 'correct' : 'major',
                    confidence: isTextMatch ? 85 : 0,
                    isMatch: isTextMatch,
                    isMissing: !userAudioSlice,
                    isExtra: !refAudioSlice,
                    note: 'Segment mapping mismatch'
                });
            }
        }

        // Calculate overall statistics
        const errorWords = wordComparisons.filter(w => w.hasError);
        const correctWords = wordComparisons.filter(w => !w.hasError);
        const accuracy = wordComparisons.length > 0 ? (correctWords.length / wordComparisons.length) * 100 : 0;

        const result = {
            success: true,
            transcription: {
                reference: referenceText || '',
                user: transcriptionText
            },
            overall: {
                totalWords: wordComparisons.length,
                correctWords: correctWords.length,
                errorWords: errorWords.length,
                accuracy: accuracy.toFixed(2),
                averageConfidence: wordComparisons.length > 0 ?
                    (wordComparisons.reduce((sum, w) => sum + (w.confidence || 0), 0) / wordComparisons.length).toFixed(2) : '0'
            },
            wordAnalysis: wordComparisons,
            errorSummary: {
                minor: errorWords.filter(w => w.severity === 'minor').length,
                moderate: errorWords.filter(w => w.severity === 'moderate').length,
                major: errorWords.filter(w => w.severity === 'major').length
            }
        };

        // Clean up uploaded file
        await unlink(userAudioPath);

        res.json(result);

    } catch (error) {
        console.error('Error processing audio:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/compare-simple-with-reference
 * Simple comparison with pre-stored reference (faster, no transcription)
 * Body: { referenceId: string }
 * Files: userAudio (WAV file)
 */
app.post('/api/compare-simple-with-reference', upload.single('userAudio'), async (req, res) => {
    try {
        const { referenceId } = req.body;
        const userAudioPath = req.file.path;

        if (!referenceId) {
            return res.status(400).json({
                success: false,
                error: 'referenceId is required'
            });
        }

        const { data: refBlob, error: refErr } = await supabase.storage.from('references').download(referenceId);
        if (refErr) throw new Error('Reference file not found in storage: ' + refErr.message);

        console.log('Processing simple audio comparison...');

        const userBuffer = await readFile(userAudioPath);
        supabase.storage.from('uploads').upload(req.file.filename, userBuffer, { contentType: req.file.mimetype }).catch(e => console.error(e));

        // Load audio files
        const refData = await loadAudioFromBuffer(Buffer.from(await refBlob.arrayBuffer()), referenceId);
        const userData = await loadAudioFromBuffer(userBuffer, req.file.filename);

        // Compute MFCC features
        const mfccRef = computeMFCC(refData.audio, refData.sampleRate, 13);
        const mfccUser = computeMFCC(userData.audio, userData.sampleRate, 13);

        // Calculate DTW distance
        const distance = dtwDistance(mfccRef, mfccUser);

        // Normalize distance
        const normalizedDistance = distance / (mfccRef.length + mfccUser.length);
        console.log(`Simple Compare: Raw=${distance}, Normalized=${normalizedDistance}`);

        const errorInfo = detectError(normalizedDistance, 50);

        const result = {
            success: true,
            referenceId,
            dtwDistance: distance,
            hasError: errorInfo.hasError,
            severity: errorInfo.severity,
            confidence: errorInfo.confidence,
            mfccFrames: {
                reference: mfccRef.length,
                user: mfccUser.length
            }
        };

        // Clean up uploaded file
        await unlink(userAudioPath);

        res.json(result);

    } catch (error) {
        console.error('Error processing audio:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/health
 * Health check endpoint
 */
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        service: 'LexiThera Voice Comparison API'
    });
});

// 404 Handler for API (Moved to end of all API routes)
app.use('/api/*', (req, res) => {
    console.log(`[${new Date().toLocaleTimeString()}] 404 NOT FOUND: ${req.method} ${req.originalUrl}`);
    res.status(404).json({ success: false, error: `Route ${req.originalUrl} not found` });
});


// ============================================
// Directory Setup (Local Only)
// ============================================

// Only create directories if not running on Vercel
if (!process.env.VERCEL) {
    try {
        await mkdir('uploads', { recursive: true });
        await mkdir(REFERENCE_AUDIO_DIR, { recursive: true });
        await mkdir('public', { recursive: true });
        console.log('✓ Directories created');
    } catch (err) {
        console.log('✓ Directories already exist');
    }
}

// ============================================
// Start Server
// ============================================

// Only start the server if not running on Vercel
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
    app.listen(PORT, () => {
        console.log(`🚀 LexiThera Backend API v1.2 running on http://localhost:${PORT}`);
        console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
        console.log(`📁 Reference library: http://localhost:${PORT}/api/references`);
        console.log(`🎤 Compare with reference: POST http://localhost:${PORT}/api/compare-with-reference`);
        console.log(`⚡ Simple compare: POST http://localhost:${PORT}/api/compare-simple-with-reference`);
        console.log(`\n📂 Place reference audio files in: ${REFERENCE_AUDIO_DIR}`);
    });
}

// Export the app for Vercel
export default app;
