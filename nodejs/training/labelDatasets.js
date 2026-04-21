import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Paths
const DATASET_DIR = join(__dirname, '..', '..', 'dataset');
const CSV_FILE = join(DATASET_DIR, 'cv-other-train.csv');
const AUDIO_DIR = join(DATASET_DIR, 'training data');
const OUTPUT_FILE = join(__dirname, '..', 'labels.json');

/**
 * Clean sentence by removing punctuation and converting to lowercase
 */
function cleanSentence(text) {
    return text.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "").trim();
}

async function main() {
    console.log('Loading CSV:', CSV_FILE);
    const content = fs.readFileSync(CSV_FILE, 'utf-8');
    const lines = content.split('\n');
    
    const labels = {};
    let count = 0;

    // The first line might be a header if it was standard CV, 
    // but looking at previous dump it seems to be raw data or the user added it.
    // Let's assume it's data based on the dump.
    
    for (const line of lines) {
        if (!line.trim()) continue;
        
        const parts = line.split(',');
        if (parts.length < 2) continue;
        
        const rawPath = parts[0]; // e.g. "cv-other-train/sample-000007.mp3"
        const sentence = cleanSentence(parts[1]);
        
        // Extract filename from the path in CSV
        const filename = path.basename(rawPath);
        const fullAudioPath = join(AUDIO_DIR, filename);
        
        if (fs.existsSync(fullAudioPath)) {
            labels[filename] = {
                sentence: sentence,
                path: fullAudioPath
            };
            count++;
        }
        
        // if (count >= 1000) break; // Removed limit as requested
    }

    console.log(`Found ${count} matching audio files with labels.`);
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(labels, null, 2));
    console.log('Wrote labels to', OUTPUT_FILE);
}

main().catch(console.error);
