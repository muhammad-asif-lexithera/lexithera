import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const LABELS_FILE = join(__dirname, '..', 'labels.json');

function main() {
    const labels = JSON.parse(fs.readFileSync(LABELS_FILE, 'utf-8'));
    const sentences = {};
    
    for (const file in labels) {
        const text = labels[file].sentence;
        sentences[text] = (sentences[text] || 0) + 1;
    }
    
    const sorted = Object.entries(sentences).sort((a,b) => b[1] - a[1]);
    
    console.log('Top 20 sentences by frequency:');
    console.table(sorted.slice(0, 20));
    
    const uniqueCount = Object.keys(sentences).length;
    console.log(`Total samples: ${Object.keys(labels).length}`);
    console.log(`Unique sentences: ${uniqueCount}`);
}

main();
