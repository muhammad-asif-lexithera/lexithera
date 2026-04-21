import sqlite3 from 'sqlite3';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

dotenv.config({ path: path.join(dirname(fileURLToPath(import.meta.url)), '..', '.env') });

const __dirname = dirname(fileURLToPath(import.meta.url));

const dbPath = path.join(__dirname, '..', 'lexithera.db');
const db = new sqlite3.Database(dbPath);

console.log('Loading Supabase client...', process.env.SUPABASE_URL);

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env file');
    process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: {
        persistSession: false
    }
});

// Promisify sqlite queries
function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function get(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

async function createBucketIfNotExists(bucketName) {
    const { data, error } = await supabase.storage.getBucket(bucketName);
    if (error && error.message.includes('not found')) {
        console.log(`Creating bucket: ${bucketName}...`);
        const { data: createData, error: createError } = await supabase.storage.createBucket(bucketName, { public: true });
        if (createError) {
            console.error(`Failed to create bucket ${bucketName}:`, createError);
        } else {
            console.log(`Bucket ${bucketName} created.`);
        }
    } else if (error) {
        console.error(`Error checking bucket ${bucketName}:`, error);
    } else {
        console.log(`Bucket ${bucketName} already exists.`);
    }
}

async function migrateData() {
    console.log('Starting Migration...');

    // 1. Users
    console.log('Migrating users...');
    const users = await all(`SELECT * FROM users`);
    if (users.length > 0) {
        // Clear existing local doctor_id relations to avoid insert conflicts, insert all, then update
        const usersToInsert = users.map(u => ({ ...u, doctor_id: null }));
        const { error: userErr } = await supabase.from('users').upsert(usersToInsert);
        if (userErr) console.error('Error inserting users:', userErr);

        // Update doctor_ids
        for (const u of users) {
            if (u.doctor_id) {
                await supabase.from('users').update({ doctor_id: u.doctor_id }).eq('id', u.id);
            }
        }
        console.log(`Migrated ${users.length} users.`);
    }

    // 2. practice_results
    console.log('Migrating practice_results...');
    const practice_results = await all(`SELECT * FROM practice_results`);
    if (practice_results.length > 0) {
        const { error: prErr } = await supabase.from('practice_results').upsert(practice_results);
        if (prErr) console.error('Error inserting practice_results:', prErr);
        else console.log(`Migrated ${practice_results.length} practice_results.`);
    }

    // 3. reference_audios
    console.log('Migrating reference_audios...');
    const reference_audios = await all(`SELECT * FROM reference_audios`);
    if (reference_audios.length > 0) {
        const { error: refErr } = await supabase.from('reference_audios').upsert(reference_audios);
        if (refErr) console.error('Error inserting reference_audios:', refErr);
        else console.log(`Migrated ${reference_audios.length} reference_audios.`);
    }

    // 4. live_sessions
    console.log('Migrating live_sessions...');
    const live_sessions = await all(`SELECT * FROM live_sessions`);
    if (live_sessions.length > 0) {
        const { error: lsErr } = await supabase.from('live_sessions').upsert(live_sessions);
        if (lsErr) console.error('Error inserting live_sessions:', lsErr);
        else console.log(`Migrated ${live_sessions.length} live_sessions.`);
    }

    // 5. Buckets and Files
    await createBucketIfNotExists('references');
    await createBucketIfNotExists('uploads');

    console.log('Uploading reference audio files...');
    const referencesDir = path.join(__dirname, '..', 'references');
    try {
        const files = await fs.readdir(referencesDir);
        for (const file of files) {
            if (file.endsWith('.wav') || file.endsWith('.mp3')) {
                const filePath = path.join(referencesDir, file);
                const fileData = await fs.readFile(filePath);
                const { error: uploadError } = await supabase.storage.from('references').upload(file, fileData, {
                    contentType: file.endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav',
                    upsert: true
                });
                if (uploadError) {
                    console.error(`Failed to upload ${file}:`, uploadError);
                } else {
                    console.log(`Uploaded ${file}`);
                }
            }
        }
    } catch (e) {
        console.log('Could not read references directory or no files found.', e.message);
    }

    console.log('Migration complete!');
    process.exit(0);
}

migrateData().catch(console.error);
