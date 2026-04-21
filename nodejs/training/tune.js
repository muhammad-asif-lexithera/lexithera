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

const LABELS_FILE = join(__dirname, '..', 'labels.json');

async function evaluate(samples, config) {
    let corrected = 0;
    const total = samples.length;
    
    // Split into 80% train / 20% test for internal validation
    const splitIdx = Math.floor(total * 0.8);
    const trainSet = samples.slice(0, splitIdx);
    const valSet = samples.slice(splitIdx);

    const startTime = Date.now();

    for (const valSample of valSet) {
        let minDistance = Infinity;
        let predicted = null;

        for (const trainSample of trainSet) {
            const dist = dtwDistance(trainSample.features, valSample.features, {
                window: config.dtwWindow,
                normalize: true
            });

            if (dist < minDistance) {
                minDistance = dist;
                predicted = trainSample.sentence;
            }
        }

        if (predicted === valSample.sentence) {
            corrected++;
        }
    }

    const accuracy = (corrected / valSet.length) * 100;
    const timeTaken = (Date.now() - startTime) / 1000;
    return { accuracy, timeTaken };
}

import { Worker } from 'worker_threads';
import os from 'os';
import { program } from 'commander';

async function evaluateParallel(samples, config) {
    const total = samples.length;
    const splitIdx = Math.floor(total * 0.8);
    const trainSet = samples.slice(0, splitIdx);
    const valSet = samples.slice(splitIdx);

    const numWorkers = Math.max(1, os.cpus().length - 1);
    const chunkSize = Math.ceil(valSet.length / numWorkers);
    
    const startTime = Date.now();

    const workerPromises = [];
    for (let i = 0; i < numWorkers; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, valSet.length);
        const valChunk = valSet.slice(start, end);

        if (valChunk.length === 0) continue;

        workerPromises.push(new Promise((resolve, reject) => {
            const worker = new Worker(join(__dirname, '..', 'lib/workers/dtwWorker.js'), {
                workerData: { 
                    valSet: valChunk, 
                    trainSet, 
                    config 
                }
            });
            worker.on('message', resolve);
            worker.on('error', reject);
        }));
    }

    const workerResults = await Promise.all(workerPromises);
    const flatResults = workerResults.flat();

    let corrected = 0;
    for (const res of flatResults) {
        if (res.predicted === res.actual) corrected++;
    }

    const accuracy = (corrected / valSet.length) * 100;
    const timeTaken = (Date.now() - startTime) / 1000;
    return { accuracy, timeTaken };
}

async function main() {
    program
        .option('--gpu', 'Use hardware acceleration (Whisper on GPU, Training on Multi-core)')
        .parse(process.argv);
    
    const options = program.opts();
    if (options.gpu) {
        console.log('--- HIGH PERFORMANCE MODE ENABLED ---');
        console.log('Using Parallel CPU Workers for Tuning/Training...');
    }

    const labels = JSON.parse(fs.readFileSync(LABELS_FILE, 'utf-8'));
    const decoder = new MPEGDecoder();
    await decoder.ready;

    // Use samples that have at least 2 occurrences for valid evaluation
    const sentenceGroup = {};
    for (const filename in labels) {
        const sentence = labels[filename].sentence;
        if (!sentenceGroup[sentence]) sentenceGroup[sentence] = [];
        sentenceGroup[sentence].push(filename);
    }

    const eligibleSentences = Object.keys(sentenceGroup).filter(s => sentenceGroup[s].length >= 2);
    console.log(`Found ${eligibleSentences.length} sentences with multiple samples.`);

    const subsetFiles = [];
    for (const s of eligibleSentences) {
        subsetFiles.push(...sentenceGroup[s]);
    }

    // Limit subset for faster tuning (tuning on 74k samples is overkill for hyperparams)
    const limit = options.gpu ? 2000 : 500;
    const tuneFiles = subsetFiles.slice(0, limit);

    console.log(`Pre-loading audio for ${tuneFiles.length} samples...`);
    const rawSignals = [];
    for (const filename of tuneFiles) {
        const item = labels[filename];
        if (!item || !item.path) continue;
        
        try {
            const buffer = fs.readFileSync(item.path);
            const { channelData, sampleRate } = decoder.decode(buffer);
            let audio = channelData[0];
            if (channelData.length > 1) {
                audio = new Float32Array(channelData[0].length);
                for (let i = 0; i < audio.length; i++) audio[i] = (channelData[0][i] + channelData[1][i]) / 2;
            }
            if (sampleRate !== 16000) audio = resampleAudio(audio, sampleRate, 16000);
            rawSignals.push({ audio, sentence: item.sentence });
            await decoder.reset();
        } catch (e) {
            console.error(`Skipping ${filename}: ${e.message}`);
        }
    }

    const grid = {
        numCeps: [13, 15, 20],
        frameSize: [0.025, 0.035],
        dtwWindow: [null, 10, 30]
    };

    let bestConfig = null;
    let bestAccuracy = -1;

    console.log(`Starting Parallel Grid Search (Depth: ${grid.numCeps.length * grid.frameSize.length * grid.dtwWindow.length})...`);
    for (const numCeps of grid.numCeps) {
        for (const frameSize of grid.frameSize) {
            // Extract features for this MFCC config
            const samplesWithFeatures = rawSignals.map(s => ({
                sentence: s.sentence,
                features: computeMFCC(s.audio, 16000, numCeps, 26, 512, { frameSize, doCMN: true })
            }));

            for (const dtwWindow of grid.dtwWindow) {
                const config = { numCeps, frameSize, dtwWindow };
                process.stdout.write(`Testing: ${JSON.stringify(config)} ... `);
                
                const result = await evaluateParallel(samplesWithFeatures, config);
                console.log(`Accuracy: ${result.accuracy.toFixed(2)}% (Time: ${result.timeTaken.toFixed(1)}s)`);

                if (result.accuracy > bestAccuracy) {
                    bestAccuracy = result.accuracy;
                    bestConfig = config;
                }
            }
        }
    }

    console.log('\n--- Grid Search Results ---');
    console.log('Best Accuracy:', bestAccuracy.toFixed(2) + '%');
    console.log('Best Configuration:', JSON.stringify(bestConfig, null, 2));
    
    fs.writeFileSync(join(__dirname, '..', 'best_config.json'), JSON.stringify(bestConfig, null, 2));
}

main().catch(console.error);
