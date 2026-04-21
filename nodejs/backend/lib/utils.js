// utils.js - Helper utilities for audio processing

/**
 * Calculate Euclidean distance between two vectors
 * @param {Array|Float32Array} vec1 - First vector
 * @param {Array|Float32Array} vec2 - Second vector
 * @returns {number} Euclidean distance
 */
export function euclideanDistance(vec1, vec2) {
  if (vec1.length !== vec2.length) {
    throw new Error('Vectors must have same length');
  }
  
  let sum = 0;
  for (let i = 0; i < vec1.length; i++) {
    const diff = vec1[i] - vec2[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

/**
 * Resample audio data to target sample rate
 * @param {Float32Array} audioData - Input audio samples
 * @param {number} originalSampleRate - Original sample rate
 * @param {number} targetSampleRate - Target sample rate
 * @returns {Float32Array} Resampled audio
 */
export function resampleAudio(audioData, originalSampleRate, targetSampleRate) {
  if (originalSampleRate === targetSampleRate) {
    return audioData;
  }
  
  const ratio = targetSampleRate / originalSampleRate;
  const newLength = Math.round(audioData.length * ratio);
  const resampled = new Float32Array(newLength);
  
  // Linear interpolation resampling
  for (let i = 0; i < newLength; i++) {
    const srcIndex = i / ratio;
    const srcIndexFloor = Math.floor(srcIndex);
    const srcIndexCeil = Math.min(srcIndexFloor + 1, audioData.length - 1);
    const fraction = srcIndex - srcIndexFloor;
    
    resampled[i] = audioData[srcIndexFloor] * (1 - fraction) + 
                   audioData[srcIndexCeil] * fraction;
  }
  
  return resampled;
}

/**
 * Compute Discrete Cosine Transform (DCT Type-II)
 * @param {Array<Array<number>>} input - 2D array (frames x features)
 * @param {number} numCoeffs - Number of coefficients to keep
 * @returns {Array<Array<number>>} DCT coefficients
 */
export function dct(input, numCoeffs) {
  const numFrames = input.length;
  const N = input[0].length;
  const output = [];
  
  for (let frameIdx = 0; frameIdx < numFrames; frameIdx++) {
    const frame = input[frameIdx];
    const dctFrame = [];
    
    for (let k = 0; k < numCoeffs; k++) {
      let sum = 0;
      for (let n = 0; n < N; n++) {
        sum += frame[n] * Math.cos(Math.PI * k * (n + 0.5) / N);
      }
      // Orthonormal scaling
      const scale = k === 0 ? Math.sqrt(1 / N) : Math.sqrt(2 / N);
      dctFrame.push(sum * scale);
    }
    output.push(dctFrame);
  }
  
  return output;
}

/**
 * Apply Hamming window to a frame
 * @param {number} frameLength - Length of the frame
 * @returns {Float32Array} Hamming window coefficients
 */
export function hammingWindow(frameLength) {
  const window = new Float32Array(frameLength);
  for (let i = 0; i < frameLength; i++) {
    window[i] = 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (frameLength - 1));
  }
  return window;
}

/**
 * Convert stereo to mono by averaging channels
 * @param {Float32Array} audioData - Interleaved stereo audio
 * @param {number} numChannels - Number of channels
 * @returns {Float32Array} Mono audio
 */
export function stereoToMono(audioData, numChannels) {
  if (numChannels === 1) {
    return audioData;
  }
  
  const monoLength = Math.floor(audioData.length / numChannels);
  const mono = new Float32Array(monoLength);
  
  for (let i = 0; i < monoLength; i++) {
    let sum = 0;
    for (let ch = 0; ch < numChannels; ch++) {
      sum += audioData[i * numChannels + ch];
    }
    mono[i] = sum / numChannels;
  }
  
  return mono;
}
/**
 * Trim silence from start and end of audio
 * @param {Float32Array} audioData - Input audio
 * @param {number} threshold - Amplitude threshold (default: 0.01)
 * @returns {Float32Array} Trimmed audio
 */
export function trimSilence(audioData, threshold = 0.01) {
  let start = 0;
  while (start < audioData.length && Math.abs(audioData[start]) < threshold) {
    start++;
  }
  
  let end = audioData.length - 1;
  while (end > start && Math.abs(audioData[end]) < threshold) {
    end--;
  }
  
  return audioData.slice(start, end + 1);
}
