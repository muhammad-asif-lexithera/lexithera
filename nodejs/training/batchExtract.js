import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { MPEGDecoder } from 'mpg123-decoder';
import { computeMFCC } from '../lib/mfcc.js';
import { resampleAudio } from '../lib/utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Paths
const LABELS_FILE = join(__dirname, '..', 'labels.json');
const CACHE_DIR = join(__dirname, '..', 'feature_cache');

if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR);
}

async function processFile(filename, item, decoder) {
    const cachePath = join(CACHE_DIR, `${filename}.json`);
    
    if (fs.existsSync(cachePath)) {
        return false; // Already cached
    }

    try {
        const buffer = fs.readFileSync(item.path);
        const { channelData, sampleRate } = decoder.decode(buffer);
        
        if (!channelData || channelData.length === 0) {
            console.error(`Error decoding ${filename}: No channel data`);
            return false;
        }

        // Downmix to mono if stereo
        let audio = channelData[0];
        if (channelData.length > 1) {
            audio = new Float32Array(channelData[0].length);
            for (let i = 0; i < audio.length; i++) {
                audio[i] = (channelData[0][i] + channelData[1][i]) / 2;
            }
        }

        // Resample to 16kHz
        const targetSr = 16000;
        if (sampleRate !== targetSr) {
            audio = resampleAudio(audio, sampleRate, targetSr);
        }

        // Extract MFCC
        const mfcc = computeMFCC(audio, targetSr, 13, 26, 512, {
            doCMN: true
        });

        fs.writeFileSync(cachePath, JSON.stringify(mfcc));
        
        // Prepare for next file
        await decoder.reset();
        return true;
    } catch (err) {
        console.error(`Error processing ${filename}:`, err.message);
        try { await decoder.reset(); } catch(e) {}
        return false;
    }
}

async function main() {
    const labels = JSON.parse(fs.readFileSync(LABELS_FILE, 'utf-8'));
    const files = Object.keys(labels);
    const concurrency = Math.max(1, os.cpus().length - 1);
    
    console.log(`Starting Parallel Feature Extraction (${concurrency} workers) for ${files.length} samples...`);
    
    // Initialize workers
    const workers = await Promise.all(
        Array.from({ length: concurrency }, async () => {
            const d = new MPEGDecoder();
            await d.ready;
            return d;
        })
    );

    let currentIndex = 0;
    let processedCount = 0;
    let newlyProcessed = 0;

    const runWorker = async (decoder) => {
        while (currentIndex < files.length) {
            const filename = files[currentIndex++];
            const item = labels[filename];
            
            const isNew = await processFile(filename, item, decoder);
            if (isNew) newlyProcessed++;
            processedCount++;

            if (processedCount % 100 === 0) {
                console.log(`Progress: ${processedCount} / ${files.length} (${newlyProcessed} new)...`);
            }
        }
    };

    // Start all workers
    await Promise.all(workers.map(w => runWorker(w)));

    // Cleanup
    for (const decoder of workers) {
        decoder.free();
    }

    console.log(`Feature extraction complete. Total processed: ${processedCount}, Newly extracted: ${newlyProcessed}`);
}

main().catch(console.error);
