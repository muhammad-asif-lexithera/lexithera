// dtw.js - Dynamic Time Warping implementation

import { euclideanDistance } from './utils.js';

/**
 * Calculate DTW distance between two sequences
 * @param {Array<Array<number>>} seq1 - First sequence (frames x features)
 * @param {Array<Array<number>>} seq2 - Second sequence (frames x features)
 * @returns {number} DTW distance
 */
/**
 * Calculate DTW distance between two sequences
 * @param {Array<Array<number>>} seq1 - First sequence (frames x features)
 * @param {Array<Array<number>>} seq2 - Second sequence (frames x features)
 * @param {Object} options - DTW options
 * @param {number} options.window - Sakoe-Chiba window width (null for Infinity)
 * @param {boolean} options.normalize - Whether to normalize by sequence length (default: true)
 * @returns {number} DTW distance
 */
export function dtwDistance(seq1, seq2, options = {}) {
    const {
        window = null,
        normalize = true
    } = options;

    const n = seq1.length;
    const m = seq2.length;

    if (n === 0 || m === 0) return Infinity;

    // Use a window if specified
    const w = window !== null ? Math.max(window, Math.abs(n - m)) : Math.max(n, m);

    // Space-optimized DTW: only keep current and previous rows
    let prevRow = new Float32Array(m + 1).fill(Infinity);
    let currRow = new Float32Array(m + 1).fill(Infinity);

    prevRow[0] = 0;

    // Fill the DTW rows
    for (let i = 1; i <= n; i++) {
        currRow.fill(Infinity);
        const start = Math.max(1, i - w);
        const end = Math.min(m, i + w);

        for (let j = start; j <= end; j++) {
            const cost = euclideanDistance(seq1[i - 1], seq2[j - 1]);
            const minPrev = Math.min(
                prevRow[j],     // insertion
                currRow[j - 1], // deletion
                prevRow[j - 1]  // match
            );
            currRow[j] = cost + minPrev;
        }
        // Swap rows
        [prevRow, currRow] = [currRow, prevRow];
    }

    const finalDistance = prevRow[m];

    if (normalize) {
        return finalDistance / (n + m);
    }

    return finalDistance;
}
