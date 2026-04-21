#!/usr/bin/env node
// compareSpeech.js - Main speech comparison script

import { program } from 'commander';
import { readFile, writeFile } from 'fs/promises';
import * as wavDecoder from 'wav-decoder';
import { computeMFCC } from './lib/mfcc.js';
import { dtwDistance } from './lib/dtw.js';
import { resampleAudio, stereoToMono } from './lib/utils.js';
import { basename } from 'path';

// Phoneme hints database
const PHONEME_HINTS = {
    'b': 'Add voicing; feel vibration in throat (voiced bilabial stop).',
    'p': 'No voicing; focus on a burst with lips closed then release (voiceless bilabial stop).',
    'm': 'Close lips and hum (nasal), lower velum to allow nasal airflow.',
    'ae': 'Lower tongue and open mouth more (low-front vowel).',
    'i': 'Raise tongue front and spread lips (high-front vowel).',
    'u': 'Raise tongue back and round lips (high-back rounded vowel).',
    't': 'Voiceless alveolar stop - tongue touches alveolar ridge.',
    'd': 'Voiced alveolar stop - tongue touches alveolar ridge with voicing.',
    's': 'Voiceless alveolar fricative - continuous airflow.',
    'sh': 'Voiceless postalveolar fricative - tongue further back.',
    'r': 'Alveolar approximant - tongue near alveolar ridge.',
    'l': 'Alveolar lateral approximant - air flows around tongue sides.'
};

/**
 * Load and preprocess audio file
 * @param {string} path - Path to WAV file
 * @param {number} targetSr - Target sample rate (default: 16000)
 * @returns {Promise<{audio: Float32Array, sampleRate: number}>}
 */
async function loadAudio(path, targetSr = 16000) {
    const buffer = await readFile(path);
    const audioData = await wavDecoder.decode(buffer);

    // Convert to mono if needed
    let audio = audioData.channelData[0]; // Get first channel
    if (audioData.channelData.length > 1) {
        // Average all channels
        audio = new Float32Array(audioData.channelData[0].length);
        for (let i = 0; i < audio.length; i++) {
            let sum = 0;
            for (let ch = 0; ch < audioData.channelData.length; ch++) {
                sum += audioData.channelData[ch][i];
            }
            audio[i] = sum / audioData.channelData.length;
        }
    }

    // Resample if needed
    if (audioData.sampleRate !== targetSr) {
        audio = resampleAudio(audio, audioData.sampleRate, targetSr);
    }

    return { audio, sampleRate: targetSr };
}

/**
 * Detect phoneme key from reference filename
 * @param {string} refPath - Reference file path
 * @returns {string|null} Detected phoneme key
 */
function detectPhonemeKey(refPath) {
    const filename = basename(refPath).toLowerCase();
    const keys = ['b', 'p', 'm', 'ae', 'i', 'u', 't', 'd', 's', 'sh', 'r', 'l'];

    for (const key of keys) {
        if (filename.includes('_' + key) ||
            filename.startsWith(key + '.') ||
            filename.split('_').includes(key)) {
            return key;
        }
    }

    return null;
}

/**
 * Main comparison function
 */
async function main() {
    program
        .requiredOption('--ref <path>', 'Reference audio file path')
        .requiredOption('--input <path>', 'Input audio file path')
        .option('--outjson <path>', 'Output JSON file path', 'dtw_result.json')
        .option('--num-ceps <number>', 'Number of cepstral coefficients', '13')
        .parse(process.argv);

    const options = program.opts();
    const numCeps = parseInt(options.numCeps);

    console.log('Loading reference audio:', options.ref);
    const refData = await loadAudio(options.ref);

    console.log('Loading input audio:', options.input);
    const inputData = await loadAudio(options.input);

    console.log('Computing MFCC features for reference...');
    const mfccRef = computeMFCC(refData.audio, refData.sampleRate, numCeps);

    console.log('Computing MFCC features for input...');
    const mfccInput = computeMFCC(inputData.audio, inputData.sampleRate, numCeps);

    console.log('Calculating DTW distance...');
    const distance = dtwDistance(mfccRef, mfccInput);

    // Detect phoneme and get hint
    const candidateKey = detectPhonemeKey(options.ref);
    const suggestedHint = PHONEME_HINTS[candidateKey] || 'Practice while watching the animation.';

    const result = {
        distance: distance,
        mfcc_ref_frames: mfccRef.length,
        mfcc_input_frames: mfccInput.length,
        suggested_hint: suggestedHint,
        suggested_key: candidateKey || ''
    };

    await writeFile(options.outjson, JSON.stringify(result, null, 2));

    console.log('Wrote', options.outjson);
    console.log('DTW distance =', distance);
    console.log('Hint:', suggestedHint);
}

main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
