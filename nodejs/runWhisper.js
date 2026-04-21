#!/usr/bin/env node
// runWhisper.js - Whisper-based speech transcription

import { program } from 'commander';
import { writeFile } from 'fs/promises';
import { pipeline } from '@xenova/transformers';

/**
 * Simple G2P (Grapheme-to-Phoneme) converter
 * This is a simplified version - for production, use a proper G2P library
 * @param {string} text - Input text
 * @returns {Array<string>} Phoneme array
 */
function simpleG2P(text) {
    // Basic phoneme mapping (simplified ARPAbet-like)
    const phonemeMap = {
        'a': ['AE'],
        'b': ['B'],
        'c': ['K'],
        'd': ['D'],
        'e': ['EH'],
        'f': ['F'],
        'g': ['G'],
        'h': ['HH'],
        'i': ['IH'],
        'j': ['JH'],
        'k': ['K'],
        'l': ['L'],
        'm': ['M'],
        'n': ['N'],
        'o': ['OW'],
        'p': ['P'],
        'q': ['K', 'W'],
        'r': ['R'],
        's': ['S'],
        't': ['T'],
        'u': ['UH'],
        'v': ['V'],
        'w': ['W'],
        'x': ['K', 'S'],
        'y': ['Y'],
        'z': ['Z'],
        'sh': ['SH'],
        'ch': ['CH'],
        'th': ['TH']
    };

    const phonemes = [];
    const words = text.toLowerCase().split(/\s+/);

    for (const word of words) {
        if (!word) continue;

        let i = 0;
        while (i < word.length) {
            // Check for digraphs
            if (i < word.length - 1) {
                const digraph = word.slice(i, i + 2);
                if (phonemeMap[digraph]) {
                    phonemes.push(...phonemeMap[digraph]);
                    i += 2;
                    continue;
                }
            }

            // Single character
            const char = word[i];
            if (phonemeMap[char]) {
                phonemes.push(...phonemeMap[char]);
            }
            i++;
        }
    }

    return phonemes;
}

/**
 * Main transcription function
 */
async function main() {
    program
        .requiredOption('--audio <path>', 'Audio file path')
        .option('--outjson <path>', 'Output JSON file path', 'user_whisper.json')
        .option('--model <name>', 'Whisper model name', 'Xenova/whisper-small')
        .option('--gpu', 'Use GPU acceleration (requires CUDA)')
        .parse(process.argv);

    const options = program.opts();

    console.log('Loading Whisper model:', options.model);
    console.log('This may take a while on first run (downloading model)...');

    // Create ASR pipeline
    const pipelineOptions = {};
    if (options.gpu) {
        pipelineOptions.device = 'cuda';
    }

    const transcriber = await pipeline('automatic-speech-recognition', options.model, pipelineOptions);

    console.log('Transcribing audio:', options.audio);
    const result = await transcriber(options.audio, {
        language: 'english',
        task: 'transcribe',
        return_timestamps: true
    });

    const text = result.text.trim();
    console.log('Transcription:', text);

    // Convert to phonemes using simple G2P
    const phonemes = simpleG2P(text);

    // Format output
    const output = {
        text: text,
        segments: result.chunks || [],
        phonemes: phonemes
    };

    await writeFile(options.outjson, JSON.stringify(output, null, 2));

    console.log('Wrote', options.outjson);
    console.log('Phonemes:', phonemes.join(' '));
}

main().catch(err => {
    console.error('Error:', err.message);
    console.error('Stack:', err.stack);
    process.exit(1);
});
