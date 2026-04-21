import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { MPEGDecoder } from 'mpg123-decoder';
import { computeMFCC } from '../lib/mfcc.js';
import { dtwDistance } from '../lib/dtw.js';
import { resampleAudio } from '../lib/utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATASET_DIR = join(__dirname, '..', '..', 'dataset');
const TEST_CSV = join(DATASET_DIR, 'cv-other-test.csv');
const TEST_AUDIO_DIR = join(DATASET_DIR, 'testing data');
const CONFIG_FILE = join(__dirname, '..', 'best_config.json');

import { Worker } from 'worker_threads';
import os from 'os';
import { program } from 'commander';

async function main() {
    program
        .option('--gpu', 'Use hardware acceleration (Whisper on GPU, Eval on Multi-core)')
        .parse(process.argv);
    
    const options = program.opts();
    
    console.log('--- Final Evaluation ---');
    if (options.gpu) console.log('Performance Mode: ON (Parallel CPU workers)');

    const METADATA_FILE = join(__dirname, '..', 'model_metadata.json');
    const TEMPLATES_DIR = join(__dirname, '..', 'model_templates');
    
    if (!fs.existsSync(METADATA_FILE)) {
        console.error('Model metadata not found. Please run train.js first.');
        return;
    }

    const metadata = JSON.parse(fs.readFileSync(METADATA_FILE, 'utf-8'));
    const config = fs.existsSync(CONFIG_FILE) ? JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) : {};
    
    // Load all templates into memory and pack them into a SharedArrayBuffer
    console.log(`Loading ${metadata.numClasses} templates into memory...`);
    const sentences = [];
    const templatesTmp = [];
    let totalFloats = 0;
    let numCoeffs = 0;

    for (const [sentence, filename] of Object.entries(metadata.templateFiles)) {
        const tplPath = join(TEMPLATES_DIR, filename);
        if (fs.existsSync(tplPath)) {
            const data = JSON.parse(fs.readFileSync(tplPath, 'utf-8'));
            const features = data.features;
            if (!features || features.length === 0) continue;
            
            const currentTemplateCoeffs = features[0].length;
            if (numCoeffs === 0) {
                numCoeffs = currentTemplateCoeffs;
            } else if (currentTemplateCoeffs !== numCoeffs) {
                console.warn(`Warning: Template for "${sentence}" has ${currentTemplateCoeffs} coeffs, expected ${numCoeffs}. Skipping.`);
                continue;
            }
            
            totalFloats += features.length * numCoeffs;
            templatesTmp.push({ features, numFrames: features.length });
            sentences.push(sentence);
        }
    }

    const numTemplates = sentences.length;
    console.log(`Packing ${numTemplates} templates into shared memory (${(totalFloats * 4 / 1024 / 1024).toFixed(1)} MB)...`);

    const sharedFeatures = new Float32Array(new SharedArrayBuffer(totalFloats * 4));
    const sharedMeta = new Int32Array(new SharedArrayBuffer(numTemplates * 2 * 4)); // [numFrames, offset]

    let currentOffset = 0;
    for (let i = 0; i < numTemplates; i++) {
        const t = templatesTmp[i];
        sharedMeta[i * 2] = t.numFrames;
        sharedMeta[i * 2 + 1] = currentOffset;
        
        for (let f = 0; f < t.numFrames; f++) {
            sharedFeatures.set(t.features[f], currentOffset + f * numCoeffs);
        }
        currentOffset += t.numFrames * numCoeffs;
    }

    const testContent = fs.readFileSync(TEST_CSV, 'utf-8');
    const testLines = testContent.split('\n').filter(l => l.trim() !== '');
    
    const decoder = new MPEGDecoder();
    await decoder.ready;

    let correct = 0;
    let total = 0;

    const testLimit = options.gpu ? 200 : 50;
    const testSubset = testLines.slice(0, testLimit);

    console.log(`Evaluating against ${numTemplates} templates (Limit: ${testLimit})...`);

    const numWorkers = Math.max(1, os.cpus().length - 1);
    const chunkSize = Math.ceil(testSubset.length / numWorkers);
    const workerPromises = [];

    // Pre-extract features for test subset
    console.log('Extracting features for test subset...');
    const testSamples = [];
    for (const line of testSubset) {
        const parts = line.split(',');
        const filename = path.basename(parts[0]);
        const sentence = parts[1].toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "").trim();
        const audioPath = join(TEST_AUDIO_DIR, filename);

        if (fs.existsSync(audioPath)) {
            try {
                const buffer = fs.readFileSync(audioPath);
                const { channelData, sampleRate } = decoder.decode(buffer);
                let audio = channelData[0];
                if (channelData.length > 1) {
                    audio = new Float32Array(channelData[0].length);
                    for (let i = 0; i < audio.length; i++) audio[i] = (channelData[0][i] + channelData[1][i]) / 2;
                }
                if (sampleRate !== 16000) audio = resampleAudio(audio, sampleRate, 16000);

                const features = computeMFCC(audio, 16000, config.numCeps || 13, 26, 512, {
                    frameSize: config.frameSize || 0.025,
                    doCMN: true,
                    trim: true
                });
                
                testSamples.push({ features, sentence });
                await decoder.reset();
            } catch (e) {}
        }
    }

    console.log(`Starting parallel classification on ${testSamples.length} samples with ${numWorkers} workers...`);

    for (let i = 0; i < numWorkers; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, testSamples.length);
        const chunk = testSamples.slice(start, end);
        if (chunk.length === 0) continue;

        workerPromises.push(new Promise((resolve, reject) => {
            const worker = new Worker(join(__dirname, '..', 'lib/workers/dtwWorker.js'), {
                workerData: { 
                    valSet: chunk, 
                    sharedFeatures,
                    sharedMeta,
                    sentences,
                    numCoeffs,
                    config: { dtwWindow: config.dtwWindow || 30 } 
                }
            });
            worker.on('message', resolve);
            worker.on('error', reject);
        }));
    }

    const workerResults = await Promise.all(workerPromises);
    const flatResults = workerResults.flat();

    for (const res of flatResults) {
        total++;
        if (res.predicted === res.actual) correct++;
    }

    console.log('\n--- Results ---');
    console.log(`Total Tested: ${total}`);
    console.log(`Correct: ${correct}`);
    console.log(`Accuracy: ${((correct / total) * 100).toFixed(2)}%`);
}

main().catch(console.error);
