// mfcc.js - Mel-Frequency Cepstral Coefficients implementation

import FFT from 'fft.js';
import { hammingWindow, dct, trimSilence } from './utils.js';

/**
 * Convert frequency in Hz to Mel scale
 * @param {number} hz - Frequency in Hz
 * @returns {number} Frequency in Mel scale
 */
export function hzToMel(hz) {
    return 2595.0 * Math.log10(1.0 + hz / 700.0);
}

/**
 * Convert frequency in Mel scale to Hz
 * @param {number} mel - Frequency in Mel scale
 * @returns {number} Frequency in Hz
 */
export function melToHz(mel) {
    return 700.0 * (Math.pow(10, mel / 2595.0) - 1.0);
}

/**
 * Create Mel-scale filterbanks
 * @param {number} nfilt - Number of filters (default: 26)
 * @param {number} nfft - FFT size (default: 512)
 * @param {number} samplerate - Sample rate in Hz (default: 16000)
 * @param {number} lowFreq - Low frequency cutoff (default: 0)
 * @param {number} highFreq - High frequency cutoff (default: samplerate/2)
 * @returns {Array<Float32Array>} Filterbank matrix
 */
export function getFilterbanks(nfilt = 26, nfft = 512, samplerate = 16000, lowFreq = 0, highFreq = null) {
    if (highFreq === null) {
        highFreq = samplerate / 2;
    }

    const lowMel = hzToMel(lowFreq);
    const highMel = hzToMel(highFreq);

    // Create equally spaced points in Mel scale
    const melPoints = [];
    for (let i = 0; i < nfilt + 2; i++) {
        melPoints.push(lowMel + (highMel - lowMel) * i / (nfilt + 1));
    }

    // Convert Mel points back to Hz
    const hzPoints = melPoints.map(mel => melToHz(mel));

    // Convert Hz to FFT bin numbers
    const bins = hzPoints.map(hz => Math.floor((nfft + 1) * hz / samplerate));

    // Create filterbank
    const fbank = [];
    const fftBins = Math.floor(nfft / 2) + 1;

    for (let m = 1; m <= nfilt; m++) {
        const filter = new Float32Array(fftBins);
        const fMinus = bins[m - 1];
        const fCenter = bins[m];
        const fPlus = bins[m + 1];

        // Rising slope
        if (fCenter !== fMinus) {
            for (let k = fMinus; k < fCenter; k++) {
                filter[k] = (k - fMinus) / (fCenter - fMinus);
            }
        }

        // Falling slope
        if (fPlus !== fCenter) {
            for (let k = fCenter; k < fPlus; k++) {
                filter[k] = (fPlus - k) / (fPlus - fCenter);
            }
        }

        fbank.push(filter);
    }

    return fbank;
}

/**
 * Compute MFCC features from audio signal
 * @param {Float32Array} signal - Audio signal
 * @param {number} samplerate - Sample rate in Hz (default: 16000)
 * @param {number} numCeps - Number of cepstral coefficients (default: 13)
 * @param {number} nfilt - Number of filters (default: 26)
 * @param {number} nfft - FFT size (default: 512)
 * @param {Object} options - Additional options
 * @param {number} options.frameSize - Frame size in seconds (default: 0.025)
 * @param {number} options.frameStride - Frame stride in seconds (default: 0.010)
 * @param {boolean} options.doCMN - Whether to apply Cepstral Mean Normalization (default: true)
 * @returns {Array<Array<number>>} MFCC features (frames x coefficients)
 */
export function computeMFCC(signal, samplerate = 16000, numCeps = 13, nfilt = 26, nfft = 512, options = {}) {
    const {
        frameSize = 0.025,
        frameStride = 0.010,
        doCMN = true,
        trim = true
    } = options;

    // Optional silence trimming
    const audioSignal = trim ? trimSilence(signal) : signal;

    // Pre-emphasis filter
    const emphasized = new Float32Array(audioSignal.length);
    emphasized[0] = audioSignal[0];
    for (let i = 1; i < audioSignal.length; i++) {
        emphasized[i] = audioSignal[i] - 0.97 * audioSignal[i - 1];
    }

    // Frame parameters
    const frameLength = Math.round(frameSize * samplerate);
    const frameStep = Math.round(frameStride * samplerate);
    
    // Ensure nfft is at least frameLength and a power of 2
    let actualNfft = nfft;
    if (frameLength > actualNfft) {
        actualNfft = Math.pow(2, Math.ceil(Math.log2(frameLength)));
    }

    const signalLength = emphasized.length;
    const numFrames = Math.ceil(Math.abs(signalLength - frameLength) / frameStep) + 1;

    // Pad signal
    const padSignalLength = numFrames * frameStep + frameLength;
    const padSignal = new Float32Array(padSignalLength);
    padSignal.set(emphasized);

    // Create frames
    const frames = [];
    for (let i = 0; i < numFrames; i++) {
        const frame = new Float32Array(frameLength);
        const startIdx = i * frameStep;
        for (let j = 0; j < frameLength; j++) {
            frame[j] = padSignal[startIdx + j];
        }
        frames.push(frame);
    }

    // Apply Hamming window
    const window = hammingWindow(frameLength);
    for (let i = 0; i < frames.length; i++) {
        for (let j = 0; j < frameLength; j++) {
            frames[i][j] *= window[j];
        }
    }

    // Compute FFT and power spectrum
    const fft = new FFT(actualNfft);
    const powFrames = [];

    for (let i = 0; i < frames.length; i++) {
        // Pad frame to actualNfft length
        const paddedFrame = new Float32Array(actualNfft);
        paddedFrame.set(frames[i]);

        // Compute FFT
        const complexOut = fft.createComplexArray();
        const realInput = Array.from(paddedFrame);
        fft.realTransform(complexOut, realInput);

        // Compute power spectrum (only positive frequencies)
        const powFrame = new Float32Array(Math.floor(actualNfft / 2) + 1);
        for (let j = 0; j < powFrame.length; j++) {
            const real = complexOut[2 * j];
            const imag = complexOut[2 * j + 1];
            powFrame[j] = (1.0 / actualNfft) * (real * real + imag * imag);
        }
        powFrames.push(powFrame);
    }

    // Apply Mel filterbanks
    const fbanks = getFilterbanks(nfilt, actualNfft, samplerate);
    const filterBanks = [];

    for (let i = 0; i < powFrames.length; i++) {
        const filterBank = [];
        for (let j = 0; j < fbanks.length; j++) {
            let sum = 0;
            for (let k = 0; k < powFrames[i].length; k++) {
                sum += powFrames[i][k] * fbanks[j][k];
            }
            // Numerical stability
            filterBank.push(sum === 0 ? Number.EPSILON : sum);
        }
        filterBanks.push(filterBank);
    }

    // Take logarithm
    const logFbank = filterBanks.map(frame =>
        frame.map(val => Math.log(val))
    );

    // Apply DCT
    let mfcc = dct(logFbank, numCeps);

    // Apply Cepstral Mean Normalization (CMN)
    if (doCMN && mfcc.length > 0) {
        const numCoeffs = mfcc[0].length;
        const means = new Array(numCoeffs).fill(0);
        
        for (let i = 0; i < mfcc.length; i++) {
            for (let j = 0; j < numCoeffs; j++) {
                means[j] += mfcc[i][j];
            }
        }
        for (let j = 0; j < numCoeffs; j++) {
            means[j] /= mfcc.length;
        }
        
        mfcc = mfcc.map(frame => 
            frame.map((val, j) => val - means[j])
        );
    }

    return mfcc;
}
