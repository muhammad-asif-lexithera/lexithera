import { parentPort, workerData } from 'worker_threads';
import { dtwDistance } from '../dtw.js';

const { valSet, sharedFeatures, sharedMeta, sentences, numCoeffs, config, trainSet } = workerData;

const precalculatedTemplates = [];
let templateSentences = [];
let numTemplates = 0;

if (trainSet) {
    // Processing for tune.js (Normal Array)
    numTemplates = trainSet.length;
    for (let i = 0; i < numTemplates; i++) {
        precalculatedTemplates.push(trainSet[i].features);
        templateSentences.push(trainSet[i].sentence);
    }
} else {
    // Processing for evaluate.js (SharedArrayBuffer)
    numTemplates = sentences.length;
    templateSentences = sentences;
    try {
        for (let i = 0; i < numTemplates; i++) {
            const numFrames = sharedMeta[i * 2];
            const offset = sharedMeta[i * 2 + 1];
            
            const trainFeatures = [];
            for (let f = 0; f < numFrames; f++) {
                trainFeatures.push(sharedFeatures.subarray(offset + f * numCoeffs, offset + (f + 1) * numCoeffs));
            }
            precalculatedTemplates.push(trainFeatures);
        }
    } catch (err) {
        console.error("Worker initialization failed while mapping shared memory:");
        console.error(err);
        process.exit(1);
    }
}

const results = [];

for (let v = 0; v < valSet.length; v++) {
    const valSample = valSet[v];
    let minDistance = Infinity;
    let predicted = null;

    for (let i = 0; i < numTemplates; i++) {
        try {
            const trainFeatures = precalculatedTemplates[i];
            
            const dist = dtwDistance(trainFeatures, valSample.features, {
                window: config.dtwWindow,
                normalize: true
            });

            if (dist < minDistance) {
                minDistance = dist;
                predicted = templateSentences[i];
            }
        } catch (err) {
            console.error(`Worker error calculating DTW. Test Sample: "${valSample.sentence}", Template: "${templateSentences[i]}"`);
            console.error(err);
            process.exit(1);
        }
    }
    
    results.push({
        predicted,
        actual: valSample.sentence
    });
}

parentPort.postMessage(results);
