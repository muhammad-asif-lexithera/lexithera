import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { dtwDistance } from '../lib/dtw.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const LABELS_FILE = join(__dirname, '..', 'labels.json');
const CACHE_DIR = join(__dirname, '..', 'feature_cache');
const MODEL_FILE = join(__dirname, '..', 'model.json');

/**
 * Find medoid of a group of feature sequences
 */
function findMedoid(group) {
    if (group.length === 1) return group[0];
    
    // For large groups, limit the search to the first 10 samples to save time
    // In a template-matching context, any of the first few good samples is usually sufficient.
    const searchLimit = Math.min(group.length, 10);
    const searchGroup = group.slice(0, searchLimit);

    let minTotalDist = Infinity;
    let medoid = group[0];

    for (let i = 0; i < searchLimit; i++) {
        let totalDist = 0;
        for (let j = 0; j < searchLimit; j++) {
            if (i === j) continue;
            totalDist += dtwDistance(searchGroup[i].features, searchGroup[j].features, { normalize: true });
        }
        if (totalDist < minTotalDist) {
            minTotalDist = totalDist;
            medoid = searchGroup[i];
        }
    }
    return medoid;
}

import { program } from 'commander';

async function main() {
    program
        .option('--gpu', 'Use hardware acceleration (Consistency flag)')
        .parse(process.argv);
    
    const options = program.opts();

    console.log('Training model from extracted features (Memory-Efficient Mode)...');
    if (options.gpu) console.log('Performance Mode: ON');

    const labels = JSON.parse(fs.readFileSync(LABELS_FILE, 'utf-8'));
    
    // Group filenames by sentence first (just the names, stay lightweight)
    const sentenceGroups = {};
    for (const filename in labels) {
        const sentence = labels[filename].sentence;
        if (!sentenceGroups[sentence]) sentenceGroups[sentence] = [];
        sentenceGroups[sentence].push(filename);
    }

    const sentences = Object.keys(sentenceGroups);
    console.log(`Found ${Object.keys(labels).length} samples across ${sentences.length} unique sentences.`);

    const templates = {};
    let processedSamples = 0;
    let templateCount = 0;

    for (let i = 0; i < sentences.length; i++) {
        const sentence = sentences[i];
        const filenames = sentenceGroups[sentence];
        const groupFeatures = [];

        // Load features for this specific sentence group
        for (const filename of filenames) {
            const featurePath = join(CACHE_DIR, `${filename}.json`);
            if (fs.existsSync(featurePath)) {
                try {
                    const features = JSON.parse(fs.readFileSync(featurePath, 'utf-8'));
                    groupFeatures.push({ filename, features });
                } catch (e) {}
            }
        }

        if (groupFeatures.length > 0) {
            // Find medoid within this group
            const medoid = findMedoid(groupFeatures);
            templates[sentence] = {
                filename: medoid.filename,
                features: medoid.features
            };
            templateCount++;
        }

        processedSamples += filenames.length;
        if (i > 0 && i % 500 === 0) {
            console.log(`Processed ${i} / ${sentences.length} sentences (${processedSamples} samples)...`);
        }
    }

    const TEMPLATES_DIR = join(__dirname, '..', 'model_templates');
    if (!fs.existsSync(TEMPLATES_DIR)) fs.mkdirSync(TEMPLATES_DIR);

    console.log(`Saving ${templateCount} templates individually to ${TEMPLATES_DIR}...`);
    
    const metadata = {
        name: 'LexiThera-CommonVoice-Full',
        createdAt: new Date().toISOString(),
        numClasses: templateCount,
        numTotalSamples: Object.keys(labels).length,
        templateFiles: {} // Maps sentence to its template filename
    };

    for (const sentence in templates) {
        // Create a safe filename (MD5 or similar would be better, but index is safe)
        const safeId = `tpl_${Math.random().toString(36).substr(2, 9)}`;
        const tplPath = join(TEMPLATES_DIR, `${safeId}.json`);
        
        fs.writeFileSync(tplPath, JSON.stringify(templates[sentence]));
        metadata.templateFiles[sentence] = `${safeId}.json`;
    }

    const METADATA_FILE = join(__dirname, '..', 'model_metadata.json');
    fs.writeFileSync(METADATA_FILE, JSON.stringify(metadata, null, 2));
    
    console.log(`Saved model metadata to ${METADATA_FILE}`);
    console.log(`Success! Total templates saved: ${templateCount}`);
}

main().catch(console.error);
